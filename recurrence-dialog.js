import { localInput, nextOccurrence, validateRule } from './schedule.js';

export function openRecurrence(existing, startValue, onDone) {
  const anchor = new Date(startValue);
  if (!Number.isFinite(anchor.getTime())) {
    return;
  }
  const rule = existing
    ? structuredClone(existing)
    : {
        unit: 'week',
        interval: 1,
        days: [anchor.getDay()],
        monthly: 'date',
        end: 'never',
        count: 10,
        until: localInput(anchor).slice(0, 10),
      };
  const dialog = document.createElement('dialog');
  dialog.className = 'recurrence-dialog';
  dialog.setAttribute('aria-labelledby', 'recurrence-title');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="recurrence-title">Custom recurrence</h2></div>
  <form><div class="repeat-every"><label for="interval">Repeat every</label><input id="interval" type="number" min="1" max="999" required aria-label="Repeat interval"><select id="unit" aria-label="Repeat unit"><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select></div>
  <fieldset id="weekly"><legend>Repeat on</legend><div class="weekday-row">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => '<button type="button" class="day-button" aria-label="' + day + '" aria-pressed="false" data-day="' + i + '">' + day[0] + '</button>').join('')}</div></fieldset>
  <label class="field" id="monthly">Repeat on<select id="month-pattern"><option value="date">Same day of the month</option><option value="weekday">Same weekday and week of the month</option></select></label>
  <fieldset><legend>Ends</legend><div class="end-row"><input id="end-never" name="ending" type="radio" value="never"><label for="end-never">Never</label></div><div class="end-row"><input id="end-on" name="ending" type="radio" value="on"><label for="end-on">On</label><input id="until" type="date" aria-label="Recurrence end date"></div><div class="end-row"><input id="end-after" name="ending" type="radio" value="after"><label for="end-after">After</label><input id="count" type="number" min="1" max="100000" aria-label="Number of occurrences"><span>occurrences</span></div></fieldset>
  <p class="timezone-note">Repeats at the start time in your device’s local time zone. Months without the selected date are skipped.</p><p class="recurrence-error" role="alert"></p><div class="dialog-actions"><button id="no-repeat" type="button" class="button subtle">No repeat</button><button id="cancel-repeat" type="button" class="button subtle">Cancel</button><button type="submit" class="button secondary">Done</button></div></form>`;
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector);
  $('#interval').value = rule.interval;
  $('#unit').value = rule.unit;
  $('#until').value = rule.until || localInput(anchor).slice(0, 10);
  $('#until').min = localInput(anchor).slice(0, 10);
  $('#count').value = rule.count || 10;
  $('#month-pattern').value = rule.monthly || 'date';
  $('#end-' + rule.end).checked = true;
  dialog.querySelectorAll('[data-day]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String((rule.days || [anchor.getDay()]).includes(Number(button.dataset.day))),
    );
    button.addEventListener('click', () =>
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')),
    );
  });
  function refresh() {
    $('#weekly').hidden = $('#unit').value !== 'week';
    $('#monthly').hidden = $('#unit').value !== 'month';
    $('#until').disabled = !$('#end-on').checked;
    $('#count').disabled = !$('#end-after').checked;
    $('#until').required = $('#end-on').checked;
    $('#count').required = $('#end-after').checked;
  }
  $('#unit').addEventListener('change', refresh);
  dialog
    .querySelectorAll('[name="ending"]')
    .forEach((input) => input.addEventListener('change', refresh));
  $('#cancel-repeat').addEventListener('click', () => dialog.close());
  $('#no-repeat').addEventListener('click', () => {
    onDone(null);
    dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const result = validateRule({
        unit: $('#unit').value,
        interval: Number($('#interval').value),
        days: [...dialog.querySelectorAll('[data-day][aria-pressed="true"]')].map((b) =>
          Number(b.dataset.day),
        ),
        monthly: $('#month-pattern').value,
        end: $('[name="ending"]:checked').value,
        until: $('#until').value,
        count: Number($('#count').value),
      });
      if (!nextOccurrence(anchor, result, anchor.getTime() - 1)) {
        throw new Error('The end date must include at least one wakeup.');
      }
      onDone(result);
      dialog.close();
    } catch (error) {
      $('.recurrence-error').textContent = error.message;
    }
  });
  refresh();
  dialog.showModal();
}
