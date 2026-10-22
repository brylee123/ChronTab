import { createRuleBuilder } from './rule-builder.js';
import { nextWake } from './date-engine.js';
import { iconMarkup } from './icons.js';
import { localInput, validateRule, describeRule, safeUrl } from './schedule.js';
import { api } from './api.js';
import { formatDate } from './ui-feedback.js';
import { openRecurrence } from './recurrence-dialog.js';

export { api } from './api.js';
export { showMessage, formatDate } from './ui-feedback.js';

const editorSessions = new WeakMap();

export function createEditor(
  container,
  { record = null, tab = null, initialDate = null, onSave, onError },
) {
  const session = Symbol('editor');
  editorSessions.set(container, session);
  const isCurrent = () => editorSessions.get(container) === session;
  let rule = record?.rule ? structuredClone(record.rule) : null;
  let dateLists = [],
    builder = null,
    loadingLists = true;
  const initial = new Date(
    record?.anchor || (initialDate ? initialDate + 'T09:00' : Date.now() + 3600000),
  );
  initial.setSeconds(0, 0);
  container.innerHTML = `
  <form id="snooze-form">
    <div id="url-fields" ${tab ? 'hidden' : ''}><label class="field">Tab title<input id="schedule-title" maxlength="500" placeholder="A name to remember it by"></label><label class="field">Website URL<input id="schedule-url" type="url" placeholder="https://example.com" required></label></div>
    <div class="quick-times"><button type="button" data-quick="hour">In an hour</button><button type="button" data-quick="tomorrow">Tomorrow, 9 AM</button><button type="button" data-quick="week">In a week</button></div>
    <label class="field"><span id="date-label">Wake this tab at</span><input type="datetime-local" id="wake-at" required></label>
    <label class="field"><span>Repeat</span><button type="button" id="repeat" class="recurrence-button">${iconMarkup('repeat')}<span id="repeat-text">Does not repeat</span><span class="arrow">${iconMarkup('chevron-down')}</span></button></label>
    <details class="date-rule-details" ${record?.conditions ? 'open' : ''}><summary>${iconMarkup('filter')}<span>Calendar lists &amp; date rules</span>${iconMarkup('chevron-down')}</summary><div id="date-rule-builder"></div></details><p id="date-rule-warning" class="rule-warning" role="alert"></p><p id="form-summary" class="form-summary" aria-live="polite"></p>
    <button class="button primary full" id="save-schedule" type="submit">${iconMarkup(tab ? 'sleep' : record ? 'edit' : 'plus')}${tab ? 'Snooze this tab' : record ? 'Save changes' : 'Schedule tab'}</button>
    <p class="form-note">${tab ? 'Saves the URL and closes this tab. Unsaved page work is not saved.' : record ? 'Saving resets the start date and completed occurrence count.' : 'The URL will open in a new tab when it’s time.'}</p>
  </form>`;
  const $ = (selector) => container.querySelector(selector);
  const listsReady = api('state')
    .then((data) => {
      if (!isCurrent()) {
        return;
      }
      dateLists = data.dateLists;
      loadingLists = false;
      builder = createRuleBuilder($('#date-rule-builder'), record?.conditions, dateLists, refresh);
      refresh();
    })
    .catch((error) => {
      if (!isCurrent()) {
        return;
      }
      loadingLists = false;
      onError(error.message);
    });
  $('#save-schedule').disabled = true;
  $('#wake-at').value = localInput(initial);
  $('#wake-at').min = localInput(Date.now() + 60000);
  $('#schedule-url').value = record?.url || tab?.url || '';
  $('#schedule-title').value = record?.title || tab?.title || '';
  $('#repeat').addEventListener('click', () =>
    openRecurrence(rule, $('#wake-at').value, (newRule) => {
      rule = newRule;
      refresh();
    }),
  );
  $('#wake-at').addEventListener('change', refresh);
  container.querySelectorAll('[data-quick]').forEach((button) =>
    button.addEventListener('click', () => {
      const date = new Date();
      if (button.dataset.quick === 'hour') {
        date.setHours(date.getHours() + 1);
      }
      if (button.dataset.quick === 'tomorrow') {
        date.setDate(date.getDate() + 1);
        date.setHours(9, 0, 0, 0);
      }
      if (button.dataset.quick === 'week') {
        date.setDate(date.getDate() + 7);
      }
      $('#wake-at').value = localInput(date);
      refresh();
    }),
  );
  function refresh() {
    if (!isCurrent()) {
      return;
    }
    $('#repeat-text').textContent = rule ? 'Custom recurrence…' : 'Does not repeat';
    $('#date-label').textContent = rule ? 'Start date and time' : 'Wake this tab at';
    const anchor = new Date($('#wake-at').value);
    if (!Number.isFinite(anchor.getTime())) {
      $('#form-summary').textContent = '';
      return;
    }
    const conflict = !rule && builder?.hasLists();
    $('#date-rule-warning').textContent = conflict
      ? 'Date-list rules conflict with Does not repeat. Select a recurrence or remove the date-list conditions before saving.'
      : '';
    $('#save-schedule').disabled = loadingLists || !builder || conflict;
    if (conflict) {
      $('#form-summary').textContent = '';
      return;
    }
    try {
      const conditions = builder?.value() || null;
      const candidate = { anchor: anchor.toISOString(), rule, completed: 0, conditions };
      const next = nextWake(candidate, dateLists, anchor.getTime() - 1, 0);
      let summary =
        (rule ? describeRule(rule, anchor) + ' · ' : '') +
        (next ? 'Next wake: ' + formatDate(next) : 'No dates match this rule.');
      if (next && rule && conditions) {
        let after = Date.parse(next),
          completed = 1;
        for (let i = 0; i < 2; i++) {
          const extra = nextWake(candidate, dateLists, after, completed);
          if (!extra) {
            break;
          }
          summary += ' → ' + formatDate(extra);
          after = Date.parse(extra);
          completed++;
        }
      }
      $('#form-summary').textContent = summary;
    } catch (error) {
      $('#form-summary').textContent = error.message;
    }
  }
  refresh();
  $('#snooze-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#save-schedule');
    button.disabled = true;
    try {
      await listsReady;
      if (!isCurrent()) {
        return;
      }
      if (!builder) {
        throw new Error('Date lists could not be loaded. Reopen this editor.');
      }
      if (!rule && builder.hasLists()) {
        throw new Error(
          'Date-list rules conflict with Does not repeat. Select a recurrence or remove the date lists.',
        );
      }
      const anchor = new Date($('#wake-at').value);
      if (!Number.isFinite(anchor.getTime()) || anchor <= new Date()) {
        throw new Error('Choose a future start date and time.');
      }
      const checkedRule = validateRule(rule);
      const conditions = builder.value();
      const next = nextWake(
        { anchor: anchor.toISOString(), rule: checkedRule, completed: 0, conditions },
        dateLists,
        anchor.getTime() - 1,
        0,
      );
      if (!next) {
        throw new Error('No dates match this recurrence. Adjust the start date or end date.');
      }
      const saved = {
        id: record?.id || crypto.randomUUID(),
        url: safeUrl($('#schedule-url').value),
        title: $('#schedule-title').value || $('#schedule-url').value,
        anchor: anchor.toISOString(),
        nextWake: next,
        rule: checkedRule,
        completed: 0,
        paused: record?.paused || false,
        pinned: record?.pinned || tab?.pinned || false,
        ...(conditions ? { conditions } : {}),
      };
      await onSave(saved);
    } catch (error) {
      onError(error.message);
    } finally {
      if (isCurrent()) {
        button.disabled = false;
        refresh();
      }
    }
  });
}
