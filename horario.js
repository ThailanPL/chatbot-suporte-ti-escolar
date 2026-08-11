'use strict';

function getZonedParts(date = new Date(), timezone = 'America/Fortaleza') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function isBusinessHours(date = new Date(), timezone = 'America/Fortaleza') {
  const current = getZonedParts(date, timezone);
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = weekdayMap[current.weekday];

  if (!weekday || weekday > 5) return false;

  const minutes = current.hour * 60 + current.minute;
  const morning = minutes >= 8 * 60 && minutes < 11 * 60 + 30;
  const afternoon = minutes >= 12 * 60 + 45 && minutes < 18 * 60;
  return morning || afternoon;
}

function getDateCode(date = new Date(), timezone = 'America/Fortaleza') {
  const parts = getZonedParts(date, timezone);
  return `${parts.year}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}`;
}

function absencePeriodKey(date = new Date(), timezone = 'America/Fortaleza') {
  const p = getZonedParts(date, timezone);
  return `${p.year}-${p.month}-${p.day}-${p.hour < 12 ? 'manha' : 'tarde'}`;
}

module.exports = {
  getZonedParts,
  isBusinessHours,
  getDateCode,
  absencePeriodKey,
};
