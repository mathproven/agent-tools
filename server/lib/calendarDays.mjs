// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
// packages/core/src/property/calendarDays.ts
var ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function isLeapYear(year) {
  return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
}
function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
function parseCivilDate(iso, label = "date") {
  const m = ISO.exec(typeof iso === "string" ? iso.trim() : "");
  if (!m) throw new Error(`The ${label} must be a date written as YYYY-MM-DD.`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200) throw new Error(`The ${label} has a year outside 1900 to 2200.`);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`The ${label} "${iso}" is not a real calendar date.`);
  }
  return { year, month, day };
}
function formatCivilDate(d) {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
function civilDayNumber(d) {
  const y = d.month <= 2 ? d.year - 1 : d.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function civilFromDayNumber(n) {
  if (!Number.isSafeInteger(n)) throw new Error("Day number must be a whole number.");
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}
function calendarDaysBetween(fromIso, toIso) {
  return civilDayNumber(parseCivilDate(toIso, "end date")) - civilDayNumber(parseCivilDate(fromIso, "start date"));
}
function addCalendarDays(iso, days) {
  if (!Number.isSafeInteger(days)) throw new Error("The number of days must be a whole number.");
  return formatCivilDate(civilFromDayNumber(civilDayNumber(parseCivilDate(iso)) + days));
}
function anniversary(iso, years) {
  if (!Number.isSafeInteger(years) || years < 0) throw new Error("Years must be a whole number, zero or more.");
  const d = parseCivilDate(iso);
  const year = d.year + years;
  return formatCivilDate({ year, month: d.month, day: Math.min(d.day, daysInMonth(year, d.month)) });
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var WEEKDAYS = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
function weekdayName(iso) {
  const n = civilDayNumber(parseCivilDate(iso));
  return WEEKDAYS[(n % 7 + 7) % 7];
}
function longDate(iso) {
  const d = parseCivilDate(iso);
  return `${weekdayName(iso)}, ${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

export {
  isLeapYear,
  daysInMonth,
  parseCivilDate,
  formatCivilDate,
  civilDayNumber,
  calendarDaysBetween,
  addCalendarDays,
  anniversary,
  weekdayName,
  longDate
};
