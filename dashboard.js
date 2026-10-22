import { MAX_IMPORT_BYTES } from './limits.js';
import './bootstrap.js';
import { createCalendar } from './calendar-view.js';
import { createListManager } from './list-manager.js';
import { describeExpression } from './rule-schema.js';
import { iconMarkup } from './icons.js';
import { api, createEditor, showMessage, formatDate } from './ui.js';
import { describeRule } from './schedule.js';
let tabs = [],
  dateLists = [],
  filter = 'all',
  busy = false,
  view = 'list',
  calendar = null,
  listManager = null;
const $ = (id) => document.getElementById(id);
function text(tag, className, value) {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = value;
  return e;
}
async function load() {
  try {
    const state = await api('state');
    tabs = state.tabs;
    dateLists = state.dateLists;
    render();
  } catch (error) {
    showMessage(error.message, true);
  }
}
function render() {
  $('total').textContent = tabs.length;
  $('nav-count').textContent = tabs.length;
  $('list-count').textContent = tabs.length;
  const today = new Date().toDateString();
  $('today').textContent = tabs.filter(
    (t) => !t.paused && new Date(t.nextWake).toDateString() === today,
  ).length;
  $('repeating').textContent = tabs.filter((t) => t.rule).length;
  const query = $('search').value.toLowerCase();
  const visible = tabs
    .filter(
      (t) =>
        (t.title + ' ' + t.url).toLowerCase().includes(query) &&
        (filter === 'all' ||
          (filter === 'once' && !t.rule) ||
          (filter === 'repeat' && t.rule) ||
          (filter === 'paused' && t.paused)),
    )
    .sort((a, b) =>
      $('sort').value === 'title'
        ? a.title.localeCompare(b.title)
        : Date.parse(a.nextWake) - Date.parse(b.nextWake),
    );
  $('list').replaceChildren();
  $('empty').hidden = visible.length > 0;
  $('empty').querySelector('h3').textContent = tabs.length
    ? 'No tabs here just yet.'
    : 'A little breathing room.';
  $('empty').querySelector('p').textContent = tabs.length
    ? 'Try another filter or search to find your snoozed tabs.'
    : 'Snooze a tab from the toolbar, or schedule a URL here. Everything you put off will have a place to come back to.';
  $('empty-add').hidden = tabs.length > 0;
  if (view === 'calendar') {
    calendar?.render();
  }
  if (view === 'lists') {
    listManager?.render();
  }
  for (const tab of visible) {
    const row = text('article', 'tab-row' + (tab.paused ? ' paused' : ''), '');
    const icon = text('span', 'site-icon', '');
    icon.innerHTML = iconMarkup(tab.rule ? 'repeat' : 'clock');
    icon.setAttribute('aria-hidden', 'true');
    row.append(icon);
    const info = text('div', 'tab-info', '');
    const link = text('a', 'tab-title', tab.title);
    link.href = tab.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = tab.url;
    info.append(link, text('div', 'tab-domain', new URL(tab.url).hostname));
    row.append(info);
    const schedule = text('div', 'tab-schedule', '');
    schedule.append(text('div', 'wake-date', tab.paused ? 'Paused' : formatDate(tab.nextWake)));
    schedule.append(
      text(
        'div',
        'repeat-label',
        describeRule(tab.rule, tab.anchor) +
          (tab.rule?.end === 'after' ? ' · ' + tab.completed + ' completed' : ''),
      ),
    );
    if (tab.conditions) {
      schedule.append(
        text(
          'div',
          'repeat-label rule-tag',
          describeExpression(tab.conditions.include, dateLists) +
            (tab.conditions.exclude ? ' · Exclusions applied' : ''),
        ),
      );
    }
    if (tab.error) {
      schedule.append(text('div', 'repeat-label error', tab.error));
    }
    row.append(schedule);
    const actions = text('div', 'tab-actions', '');
    const addAction = (label, title, action) => {
      const button = text('button', '', label);
      const actionIcon =
        action === 'wake'
          ? 'open-in-new'
          : action === 'toggle'
            ? tab.paused
              ? 'play'
              : 'pause'
            : action;
      button.insertAdjacentHTML('afterbegin', iconMarkup(actionIcon));
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-label', title + ' — ' + tab.title);
      button.addEventListener('click', async () => {
        if (busy) {
          return;
        }
        if (action === 'edit') {
          edit(tab);
          return;
        }
        if (action === 'delete' && !confirm('Delete this schedule?\n' + tab.title)) {
          return;
        }
        busy = true;
        button.disabled = true;
        try {
          await api(action, { id: tab.id });
          await load();
          showMessage(
            action === 'wake'
              ? 'Tab opened. Recurring schedules keep their next wakeup.'
              : action === 'delete'
                ? 'Schedule deleted.'
                : 'Schedule updated.',
          );
        } catch (error) {
          showMessage(error.message, true);
        } finally {
          busy = false;
          button.disabled = false;
        }
      });
      actions.append(button);
    };
    addAction('Open now', 'Open now', 'wake');
    addAction('Edit', 'Edit schedule', 'edit');
    addAction(
      tab.paused ? 'Resume' : 'Pause',
      tab.paused ? 'Resume schedule' : 'Pause schedule',
      'toggle',
    );
    addAction('', 'Delete schedule', 'delete');
    row.append(actions);
    $('list').append(row);
  }
}
function edit(record = null, initialDate = null) {
  $('edit-error').textContent = '';
  $('edit-heading').textContent = record ? 'Edit schedule' : 'Schedule a tab';
  createEditor($('editor'), {
    record,
    initialDate,
    onError: (message) => showMessage(message, true, 'edit-error'),
    onSave: async (value) => {
      await api('save', { record: value });
      $('edit-dialog').close();
      await load();
      showMessage('Schedule saved.');
    },
  });
  $('edit-dialog').showModal();
}
$('add').addEventListener('click', () => edit());
$('empty-add').addEventListener('click', () => edit());
$('close-editor').addEventListener('click', () => $('edit-dialog').close());
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
document.querySelectorAll('[data-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((b) => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    render();
  }),
);
$('view-all').addEventListener('click', () => {
  setView('list');
  document.querySelector('[data-filter="all"]').click();
  $('search').value = '';
  render();
});
$('export').addEventListener('click', async () => {
  try {
    const state = await api('state');
    const latest = state.tabs;
    const data = {
      format: 'chrontab',
      version: 2,
      exportedAt: new Date().toISOString(),
      tabs: latest,
      dateLists: state.dateLists,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chrontab-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showMessage('Exported ' + latest.length + ' schedule' + (latest.length === 1 ? '' : 's') + '.');
  } catch (error) {
    showMessage(error.message, true);
  }
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error('Backup must be smaller than 8 MB.');
    }
    const backup = JSON.parse(await file.text());
    const result = await api('import', { backup });
    await load();
    showMessage(
      'Imported ' +
        result.added +
        ' schedules. Skipped ' +
        result.skipped +
        ' existing IDs.' +
        (result.listsAdded !== undefined
          ? ' Date lists: ' + result.listsAdded + ' added, ' + result.listsSkipped + ' skipped.'
          : '') +
        ' Overdue tabs will reopen shortly.',
    );
  } catch (error) {
    showMessage(
      error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message,
      true,
    );
  } finally {
    event.target.value = '';
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.tabs || changes.dateLists)) {
    load();
  }
});
function setView(next) {
  view = next;
  $('list-view').hidden = next !== 'list';
  $('calendar-view').hidden = next !== 'calendar';
  $('date-lists-view').hidden = next !== 'lists';
  document
    .querySelectorAll('[data-view]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
  $('view-all').classList.toggle('selected', next === 'list');
  $('view-calendar').classList.toggle('selected', next === 'calendar');
  $('view-date-lists').classList.toggle('selected', next === 'lists');
  if (next === 'calendar') {
    calendar.render();
  }
  if (next === 'lists') {
    listManager.render();
  }
}
document
  .querySelectorAll('[data-view]')
  .forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('view-calendar').addEventListener('click', () => setView('calendar'));
$('view-date-lists').addEventListener('click', () => setView('lists'));
calendar = createCalendar($('calendar-view'), {
  getState: () => ({ tabs, dateLists }),
  onEdit: (record) => edit(record),
  onAdd: (key) => edit(null, key),
  onError: (message) => showMessage(message, true),
});
listManager = createListManager($('date-lists-view'), {
  getLists: () => dateLists,
  onSave: async (list) => {
    await api('save-list', { list });
    await load();
    showMessage('Date list saved. Assigned schedules were recalculated.');
  },
  onDelete: async (id) => {
    await api('delete-list', { id });
    await load();
    showMessage('Date list deleted.');
  },
  onError: (message) => showMessage(message, true),
});
await load();
if (new URLSearchParams(location.search).get('view') === 'lists') {
  setView('lists');
}
