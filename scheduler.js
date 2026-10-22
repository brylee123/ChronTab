import { safeUrl, normalizeRecord } from './schedule.js';
import { nextWake, dateAllowed } from './date-engine.js';
import { normalizeDateList, dateKey } from './date-lists.js';
import { checkReferences } from './rule-schema.js';
import { normalizeBackup, listsInUse, tabUsesList } from './backup.js';
import { MAX_SCHEDULES, MAX_DATE_LISTS } from './limits.js';

export const WAKE_ALARM = 'chrontab-wake';
export const RETRY_DELAY_MS = 60_000;
const PROGRESS_JOURNAL = 'chrontab-pending-progress';

/**
 * Owns storage mutations and serializes them across UI messages and alarm events.
 * The injected browser and clock keep scheduling independently testable.
 */
export function createScheduler(browser, { now = Date.now, reportError = console.error } = {}) {
  let queue = Promise.resolve();
  let pendingProgress = null;

  function enqueue(task) {
    const result = queue.then(task);
    // A rejected request must not poison subsequent operations. Its caller handles the error.
    queue = result.catch(() => {});
    return result;
  }

  async function flushProgress() {
    const session = browser.storage.session;
    if (!pendingProgress && session) {
      pendingProgress = (await session.get(PROGRESS_JOURNAL))[PROGRESS_JOURNAL] ?? null;
    }
    if (pendingProgress) {
      // Session storage survives normal service-worker suspension. Keep a secondary
      // journal until the local queue accepts the completed progress.
      if (session) {
        await session.set({ [PROGRESS_JOURNAL]: pendingProgress });
      }
      await browser.storage.local.set({ tabs: pendingProgress });
      if (session) {
        await session.remove(PROGRESS_JOURNAL);
      }
      pendingProgress = null;
    }
  }

  async function readState() {
    await flushProgress();
    return browser.storage.local.get({ tabs: [], dateLists: [] });
  }

  async function writeTabs(tabs) {
    await browser.storage.local.set({ tabs });
  }

  async function arm(tabs) {
    const active = tabs.filter((tab) => !tab.paused);
    if (active.length) {
      const nextTime = Math.min(...active.map((tab) => Date.parse(tab.nextWake)));
      await browser.alarms.create(WAKE_ALARM, { when: Math.max(now() + 1000, nextTime) });
    } else {
      await browser.alarms.clear(WAKE_ALARM);
    }

    // Badge failures must not interrupt an otherwise valid schedule.
    const results = await Promise.allSettled([
      browser.action.setBadgeText({ text: tabs.length ? String(tabs.length) : '' }),
      browser.action.setBadgeBackgroundColor({ color: '#c4b5fd' }),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        reportError(result.reason);
      }
    }
  }

  function reschedule(tab, lists, after) {
    try {
      const next = nextWake(tab, lists, after);
      return next
        ? { ...tab, nextWake: next, error: undefined }
        : {
            ...tab,
            paused: true,
            error: 'No remaining dates match this rule. Edit the schedule or its date lists.',
          };
    } catch (error) {
      return { ...tab, paused: true, error: error.message };
    }
  }

  async function wake(record, lists, currentTime, manual = false) {
    const completed = record.completed + 1;
    const next = nextWake(
      record,
      lists,
      Math.max(currentTime, Date.parse(record.nextWake)),
      completed,
    );
    // Calculate first; malformed rules should never open a tab and then fail to advance it.
    await browser.tabs.create({ url: safeUrl(record.url), active: manual, pinned: record.pinned });
    return next ? { ...record, completed, nextWake: next } : null;
  }

  async function processDueTabs() {
    try {
      const { tabs, dateLists } = await readState();
      const currentTime = now();
      const localNow = new Date(currentTime);
      const today = dateKey(localNow);
      const minuteOfDay = localNow.getHours() * 60 + localNow.getMinutes();
      const result = [];

      for (const [index, tab] of tabs.entries()) {
        if (tab.paused || Date.parse(tab.nextWake) > currentTime) {
          result.push(tab);
          continue;
        }
        try {
          if (tab.conditions && !dateAllowed(tab, today, dateLists, minuteOfDay)) {
            result.push(reschedule(tab, dateLists, currentTime));
          } else {
            const next = await wake(tab, dateLists, currentTime);
            if (next) {
              result.push(next);
            }
          }
        } catch (error) {
          result.push({
            ...tab,
            paused: true,
            error: 'Could not open this tab: ' + error.message + '. Resume or edit to retry.',
          });
          reportError(error);
        }
        // Retain completed progress until persistence succeeds. A retry within this
        // worker flushes it before opening anything, avoiding duplicate wakeups.
        pendingProgress = [...result, ...tabs.slice(index + 1)];
        await flushProgress();
      }
      await arm(result);
    } catch (error) {
      // A fired one-shot alarm is gone. Always schedule recovery after a storage/API failure.
      await browser.alarms.create(WAKE_ALARM, { when: now() + RETRY_DELAY_MS });
      throw error;
    }
  }

  async function saveSchedule(message, { tabs, dateLists }) {
    const record = normalizeRecord(message.record);
    checkReferences(record.conditions, dateLists);
    if (record.conditions) {
      const next = nextWake(record, dateLists, Date.parse(record.anchor) - 1, 0);
      if (!next) {
        throw new Error(
          'No dates match this rule. Adjust the start date, recurrence, or date lists.',
        );
      }
      record.nextWake = next;
    }
    const currentTime = now();
    if (Date.parse(record.anchor) <= currentTime || Date.parse(record.nextWake) <= currentTime) {
      throw new Error('Choose a future date and time.');
    }
    if (tabs.length >= MAX_SCHEDULES && !tabs.some((tab) => tab.id === record.id)) {
      throw new Error('The 5,000-tab limit has been reached.');
    }
    let source;
    if (Number.isInteger(message.tabId)) {
      source = await browser.tabs.get(message.tabId);
      if (source.incognito) {
        throw new Error('Private tabs cannot be snoozed.');
      }
      if (safeUrl(source.url) !== record.url) {
        throw new Error('The tab changed. Reopen the snooze popup and try again.');
      }
      record.title = source.title || record.url;
      record.pinned = source.pinned;
    }
    const updated = [...tabs.filter((tab) => tab.id !== record.id), record];
    await writeTabs(updated);
    await arm(updated);
    if (source) {
      try {
        await browser.tabs.remove(source.id);
      } catch {
        return { warning: 'Schedule saved, but the original tab could not be closed.' };
      }
    }
    return {};
  }

  async function saveList(message, { tabs, dateLists }) {
    const list = normalizeDateList(message.list);
    if (dateLists.length >= MAX_DATE_LISTS && !dateLists.some((item) => item.id === list.id)) {
      throw new Error('The 100-list limit has been reached.');
    }
    const updatedLists = [...dateLists.filter((item) => item.id !== list.id), list];
    const currentTime = now();
    const updatedTabs = tabs.map((tab) =>
      tabUsesList(tab, list.id) ? reschedule(tab, updatedLists, currentTime) : tab,
    );
    await browser.storage.local.set({ tabs: updatedTabs, dateLists: updatedLists });
    await arm(updatedTabs);
    return {};
  }

  async function deleteList(message, { tabs, dateLists }) {
    const used = listsInUse(message.id, tabs);
    if (used.length) {
      throw new Error(
        'This list is used by ' +
          used.length +
          ' schedule(s). Remove it from those rules before deleting it.',
      );
    }
    await browser.storage.local.set({
      dateLists: dateLists.filter((list) => list.id !== message.id),
    });
    return {};
  }

  async function importBackup(message, { tabs, dateLists }) {
    const incoming = normalizeBackup(message.backup, dateLists);
    const tabIds = new Set(tabs.map((tab) => tab.id));
    const listIds = new Set(dateLists.map((list) => list.id));
    const addedTabs = incoming.tabs.filter((tab) => !tabIds.has(tab.id));
    const addedLists = incoming.lists.filter((list) => !listIds.has(list.id));
    if (
      tabs.length + addedTabs.length > MAX_SCHEDULES ||
      dateLists.length + addedLists.length > MAX_DATE_LISTS
    ) {
      throw new Error('Import exceeds the schedule or date-list limit.');
    }
    const updatedTabs = [...tabs, ...addedTabs];
    await browser.storage.local.set({
      tabs: updatedTabs,
      dateLists: [...dateLists, ...addedLists],
    });
    await arm(updatedTabs);
    const result = { added: addedTabs.length, skipped: incoming.tabs.length - addedTabs.length };
    if (message.backup.version === 2) {
      Object.assign(result, {
        listsAdded: addedLists.length,
        listsSkipped: incoming.lists.length - addedLists.length,
      });
    }
    return result;
  }

  async function updateSchedule(message, { tabs, dateLists }) {
    let updated;
    switch (message.type) {
      case 'delete':
        updated = tabs.filter((tab) => tab.id !== message.id);
        break;
      case 'toggle':
        updated = tabs.map((tab) =>
          tab.id === message.id ? { ...tab, paused: !tab.paused, error: undefined } : tab,
        );
        break;
      case 'wake': {
        const tab = tabs.find((tab) => tab.id === message.id);
        if (!tab) {
          throw new Error('This schedule no longer exists.');
        }
        const next = await wake(tab, dateLists, now(), true);
        updated = tabs.filter((item) => item.id !== tab.id);
        if (next) {
          updated.push(next);
        }
        // Manual openings need the same persistence recovery as automatic openings.
        pendingProgress = updated;
        try {
          await flushProgress();
        } catch (error) {
          await browser.alarms.create(WAKE_ALARM, { when: now() + RETRY_DELAY_MS });
          throw error;
        }
        await arm(updated);
        return {};
      }
    }
    await writeTabs(updated);
    await arm(updated);
    return {};
  }

  const handlers = {
    list: (_message, state) => state.tabs,
    state: (_message, state) => state,
    save: saveSchedule,
    'save-list': saveList,
    'delete-list': deleteList,
    import: importBackup,
    delete: updateSchedule,
    toggle: updateSchedule,
    wake: updateSchedule,
  };

  async function dispatch(message) {
    if (!message || typeof message !== 'object' || !Object.hasOwn(handlers, message.type)) {
      throw new Error('Unknown action.');
    }
    return handlers[message.type](message, await readState());
  }

  return {
    handleMessage: (message) => enqueue(() => dispatch(message)),
    tick: () => enqueue(processDueTabs),
  };
}
