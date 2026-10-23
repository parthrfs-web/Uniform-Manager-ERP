function parseDate(dateValue) {
  const date = dateValue instanceof Date ? new Date(dateValue.getTime()) : new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new Error('A valid hold date is required to schedule its next review.');
  return date;
}

function calendarCycle(dateValue = new Date()) {
  const date = parseDate(dateValue);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function nextCalendarCycle(dateValue = new Date()) {
  const { year, month } = calendarCycle(dateValue);
  const firstOfNextMonth = new Date(year, month, 1);
  return { year: firstOfNextMonth.getFullYear(), month: firstOfNextMonth.getMonth() + 1 };
}

function localDateKey(dateValue = new Date()) {
  const date = parseDate(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function millisecondsUntilNextLocalDay(dateValue = new Date()) {
  const date = parseDate(dateValue);
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, nextDay.getTime() - date.getTime());
}

module.exports = { calendarCycle, nextCalendarCycle, localDateKey, millisecondsUntilNextLocalDay };
