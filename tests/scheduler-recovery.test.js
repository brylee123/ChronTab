import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, WAKE_ALARM, RETRY_DELAY_MS } from '../scheduler.js';

const CURRENT_TIME = Date.UTC(2027, 3, 1, 12);
function harness({ failWrites = false, failBadge = false, withSession = false } = {}) {
  let stored = {
    tabs: [
      {
        id: 'due',
        url: 'https://example.com/',
        title: 'Due tab',
        anchor: new Date(CURRENT_TIME - 60000).toISOString(),
        nextWake: new Date(CURRENT_TIME - 60000).toISOString(),
        rule: null,
        completed: 0,
        paused: false,
        pinned: false,
      },
    ],
    dateLists: [],
  };
  let writesFail = failWrites;
  const opened = [],
    alarms = new Map(),
    reported = [];
  const browser = {
    storage: {
      local: {
        get: async (defaults) => structuredClone({ ...defaults, ...stored }),
        set: async (update) => {
          if (writesFail) {
            throw new Error('Storage unavailable');
          }
          stored = structuredClone({ ...stored, ...update });
        },
      },
    },
    alarms: {
      create: async (name, options) => alarms.set(name, options),
      clear: async (name) => alarms.delete(name),
    },
    action: {
      setBadgeText: async () => {
        if (failBadge) {
          throw new Error('Badge unavailable');
        }
      },
      setBadgeBackgroundColor: async () => {},
    },
    tabs: {
      create: async (options) => {
        opened.push(options);
        return { id: opened.length };
      },
    },
  };
  if (withSession) {
    const journal = {};
    browser.storage.session = {
      get: async (key) => ({ [key]: structuredClone(journal[key]) }),
      set: async (update) => Object.assign(journal, structuredClone(update)),
      remove: async (key) => {
        delete journal[key];
      },
    };
  }
  const create = () =>
    createScheduler(browser, {
      now: () => CURRENT_TIME,
      reportError: (error) => reported.push(error),
    });
  const scheduler = create();
  return {
    scheduler,
    restart: create,
    opened,
    alarms,
    reported,
    recoverStorage: () => {
      writesFail = false;
    },
    get state() {
      return stored;
    },
  };
}

test('automatic wakeups recover a failed write without reopening completed tabs', async () => {
  const app = harness({ failWrites: true });
  await assert.rejects(app.scheduler.tick(), /Storage unavailable/);
  assert.equal(app.opened.length, 1);
  assert.equal(app.alarms.get(WAKE_ALARM).when, CURRENT_TIME + RETRY_DELAY_MS);
  assert.equal(app.state.tabs.length, 1);
  app.recoverStorage();
  await app.scheduler.tick();
  assert.equal(app.opened.length, 1);
  assert.deepEqual(app.state.tabs, []);
  assert.equal(app.alarms.size, 0);
});

test('manual opening progress is flushed before a later request after persistence failure', async () => {
  const app = harness({ failWrites: true });
  await assert.rejects(
    app.scheduler.handleMessage({ type: 'wake', id: 'due' }),
    /Storage unavailable/,
  );
  assert.equal(app.opened.length, 1);
  assert.equal(app.alarms.get(WAKE_ALARM).when, CURRENT_TIME + RETRY_DELAY_MS);
  app.recoverStorage();
  assert.deepEqual(await app.scheduler.handleMessage({ type: 'list' }), []);
  await app.scheduler.tick();
  assert.equal(app.opened.length, 1);
});

test('badge failures do not abort persisted wakeups or poison the queue', async () => {
  const app = harness({ failBadge: true });
  await app.scheduler.tick();
  assert.equal(app.opened.length, 1);
  assert.deepEqual(app.state.tabs, []);
  assert.equal(app.reported.length, 1);
  assert.deepEqual(await app.scheduler.handleMessage({ type: 'list' }), []);
});

test('malformed and prototype-named messages fail without poisoning subsequent requests', async () => {
  const app = harness();
  for (const message of [
    null,
    'save',
    { type: '__proto__' },
    { type: 'constructor' },
    { type: 'not-an-action' },
  ]) {
    await assert.rejects(app.scheduler.handleMessage(message), /Unknown action/);
  }
  assert.equal((await app.scheduler.handleMessage({ type: 'list' })).length, 1);
  assert.equal(app.opened.length, 0);
});

test('session progress survives a service-worker restart after a failed local write', async () => {
  const app = harness({ failWrites: true, withSession: true });
  await assert.rejects(app.scheduler.tick(), /Storage unavailable/);
  assert.equal(app.opened.length, 1);
  app.recoverStorage();
  const restarted = app.restart();
  await restarted.tick();
  assert.equal(app.opened.length, 1);
  assert.deepEqual(app.state.tabs, []);
  assert.equal(app.alarms.size, 0);
});
