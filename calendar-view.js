import { iconMarkup } from './icons.js';
import { dateKey, listDetails } from './date-lists.js';
import { previewOccurrences } from './date-engine.js';
const el = (tag, cls = '', value = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = value;
  return e;
};
export function createCalendar(host, { getState, onEdit, onAdd, onError }) {
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
    selected = null;
  const hiddenLists = new Set();
  function render() {
    const { tabs, dateLists } = getState();
    host.innerHTML =
      '<div class="calendar-toolbar"><div class="calendar-navigation"><button type="button" class="icon-button" id="calendar-prev" aria-label="Previous month">' +
      iconMarkup('left') +
      '</button><h2 id="calendar-month"></h2><button type="button" class="icon-button" id="calendar-next" aria-label="Next month">' +
      iconMarkup('right') +
      '</button><button type="button" class="button subtle" id="calendar-today">Today</button></div><p class="helper-text">Upcoming wakeups · local time · paused tabs hidden</p></div><div class="calendar-legend"></div><div class="calendar-overflow"><div class="month-weekdays">' +
      ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
        .map((d) => '<span>' + d + '</span>')
        .join('') +
      '</div><div class="month-grid" role="grid" aria-label="Snoozed tabs calendar"></div></div><div class="calendar-agenda"></div>';
    host.querySelector('#calendar-month').textContent = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(month);
    const change = (offset) => {
      month = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12);
      selected = null;
      render();
    };
    host.querySelector('#calendar-prev').onclick = () => change(-1);
    host.querySelector('#calendar-next').onclick = () => change(1);
    host.querySelector('#calendar-today').onclick = () => {
      const now = new Date();
      month = new Date(now.getFullYear(), now.getMonth(), 1, 12);
      selected = dateKey(now);
      render();
    };
    const legend = host.querySelector('.calendar-legend');
    for (const list of dateLists) {
      const label = el('label', 'calendar-list-toggle');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !hiddenLists.has(list.id);
      input.addEventListener('change', () => {
        input.checked ? hiddenLists.delete(list.id) : hiddenLists.add(list.id);
        render();
      });
      const icon = el('span');
      icon.innerHTML = iconMarkup(list.type);
      label.append(input, icon, document.createTextNode(list.name));
      legend.append(label);
    }
    if (!dateLists.length) {
      legend.append(
        el(
          'p',
          'helper-text',
          'Add regional holidays or your own date lists to show them alongside wakeups.',
        ),
      );
    }
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay(), 0, 0, 0, 0);
    const last = new Date(first);
    last.setDate(last.getDate() + 42);
    last.setMilliseconds(-1);
    const events = new Map();
    for (const tab of tabs.filter((t) => !t.paused)) {
      try {
        for (const date of previewOccurrences(tab, dateLists, first, last)) {
          const key = dateKey(date);
          if (!events.has(key)) {
            events.set(key, []);
          }
          events.get(key).push({ tab, date });
        }
      } catch (error) {
        onError(tab.title + ': ' + error.message);
      }
    }
    const grid = host.querySelector('.month-grid'),
      today = dateKey(new Date());
    for (let index = 0; index < 42; index++) {
      const d = new Date(first);
      d.setDate(d.getDate() + index);
      const key = dateKey(d);
      const cell = el(
        'div',
        'month-cell' +
          (d.getMonth() !== month.getMonth() ? ' outside' : '') +
          (key === today ? ' today' : '') +
          (key === selected ? ' selected-day' : ''),
      );
      cell.setAttribute('role', 'gridcell');
      const number = el('button', 'day-number', d.getDate());
      number.type = 'button';
      number.setAttribute('aria-label', 'View ' + key);
      number.onclick = () => {
        selected = key;
        render();
      };
      cell.append(number);
      const dayEvents = (events.get(key) || []).sort((a, b) => a.date.localeCompare(b.date));
      for (const event of dayEvents.slice(0, 3)) {
        const b = el('button', 'calendar-event');
        b.type = 'button';
        b.textContent =
          new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
            new Date(event.date),
          ) +
          ' ' +
          event.tab.title;
        b.title = event.tab.title;
        b.onclick = () => onEdit(event.tab);
        cell.append(b);
      }
      if (dayEvents.length > 3) {
        const more = el('button', 'calendar-more', '+' + (dayEvents.length - 3) + ' more');
        more.onclick = () => {
          selected = key;
          render();
        };
        cell.append(more);
      }
      const overlays = dateLists
        .filter((l) => !hiddenLists.has(l.id))
        .flatMap((list) => {
          const details = listDetails(list, key);
          return details.matches ? [{ list, details }] : [];
        });
      for (const { list, details } of overlays.slice(0, 2)) {
        const badge = el('div', 'calendar-overlay ' + list.type, details.names.join(', '));
        badge.title = list.name + ': ' + details.names.join(', ');
        cell.append(badge);
      }
      if (overlays.length > 2) {
        cell.append(el('span', 'helper-text', '+' + (overlays.length - 2) + ' lists'));
      }
      grid.append(cell);
    }
    const agenda = host.querySelector('.calendar-agenda');
    if (selected) {
      const head = el('div', 'section-heading compact');
      head.append(
        el(
          'h3',
          '',
          new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }).format(new Date(selected + 'T12:00')),
        ),
      );
      const add = el('button', 'button secondary');
      add.innerHTML = iconMarkup('plus');
      add.append('Schedule on this day');
      add.onclick = () => onAdd(selected);
      head.append(add);
      agenda.append(head);
      const dayEvents = events.get(selected) || [];
      if (!dayEvents.length) {
        agenda.append(el('p', 'helper-text', 'No tab wakeups on this day.'));
      }
      for (const event of dayEvents) {
        const b = el(
          'button',
          'agenda-event',
          new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
            new Date(event.date),
          ) +
            ' · ' +
            event.tab.title,
        );
        b.onclick = () => onEdit(event.tab);
        agenda.append(b);
      }
      for (const list of dateLists.filter((l) => !hiddenLists.has(l.id))) {
        const details = listDetails(list, selected);
        if (!details.matches) {
          continue;
        }
        let text = list.name + ': ' + details.names.join(', ');
        if (list.type === 'workday') {
          text +=
            ' · ' +
            (list.hours[new Date(selected + 'T12:00').getDay()] || [])
              .map((b) => b.start + '–' + b.end)
              .join(', ');
        }
        agenda.append(el('p', 'calendar-agenda-list', text));
      }
    } else {
      agenda.append(
        el(
          'p',
          'helper-text',
          'Select a day for all its wakeups and date-list details. Select a wakeup to edit it.',
        ),
      );
    }
  }
  render();
  return { render };
}
