export function minutes(value, allowMidnightEnd = false) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new Error('Use HH:MM for work hours.');
  }
  const [h, m] = value.split(':').map(Number);
  if (h === 24 && m === 0 && allowMidnightEnd) {
    return 1440;
  }
  if (h > 23 || m > 59) {
    throw new Error('Enter a valid time. End time may be 24:00.');
  }
  return h * 60 + m;
}
export function timeText(value) {
  return (
    String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0')
  );
}
export function normalizeHours(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Add weekly work-hour blocks.');
  }
  const hours = {};
  for (let day = 0; day < 7; day++) {
    const blocks = raw[day] || [];
    if (!Array.isArray(blocks) || blocks.length > 12) {
      throw new Error('Use up to 12 time blocks per day.');
    }
    const ranges = blocks
      .map((block) => {
        const start = minutes(block.start),
          end = minutes(block.end, true);
        if (start >= end) {
          throw new Error(
            'A work block must end after it starts. Split overnight shifts across two days.',
          );
        }
        return { start, end };
      })
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range.start < previous.end) {
        throw new Error('Work-hour blocks on the same day cannot overlap.');
      }
      if (previous && range.start === previous.end) {
        previous.end = range.end;
      } else {
        merged.push({ ...range });
      }
    }
    hours[day] = merged.map((r) => ({ start: timeText(r.start), end: timeText(r.end) }));
  }
  if (!Object.values(hours).some((blocks) => blocks.length)) {
    throw new Error('Select at least one work-hour block.');
  }
  return hours;
}
export function defaultHours() {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      day,
      day > 0 && day < 6 ? [{ start: '09:00', end: '17:00' }] : [],
    ]),
  );
}
export function insideHours(hours, day, time) {
  const blocks = hours[day] || [];
  if (time === undefined) {
    return blocks.length > 0;
  }
  const value = typeof time === 'number' ? time : minutes(time);
  return blocks.some((b) => value >= minutes(b.start) && value < minutes(b.end, true));
}
