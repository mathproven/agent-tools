// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  calendarDaysBetween,
  daysInMonth,
  formatCivilDate,
  formatUSD,
  lawAssertBalances,
  lawAssertTransactions,
  lawBigSum,
  lawBuildLedgers,
  lawClientKey,
  lawClientLabel,
  lawSortByDate,
  parseCivilDate,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/law/dormantBalances.ts
var LAW_DORMANT_MAX = { years: 100, months: 1200 };
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function lawDormantPeriodText(period, unit) {
  return plural(period, unit === "years" ? "year" : "month");
}
function periodMonthsOf(period, unit) {
  if (unit !== "years" && unit !== "months") throw new Error("The period must be in years or in months.");
  const max = LAW_DORMANT_MAX[unit];
  if (!Number.isSafeInteger(period) || period < 1 || period > max) throw new Error(`Type the period as a whole number of ${unit} from 1 to ${max}.`);
  return unit === "years" ? period * 12 : period;
}
function monthsBefore(iso, months) {
  const d = parseCivilDate(iso, "as-of date");
  const index = d.year * 12 + (d.month - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  if (year < 1900) throw new Error("Type a shorter period: this one reaches back before 1900.");
  return formatCivilDate({ year, month, day: Math.min(d.day, daysInMonth(year, month)) });
}
function lawDormantCutoff(asOf, period, unit) {
  return monthsBefore(asOf, periodMonthsOf(period, unit));
}
function lawDormantAge(lastActivity, asOf) {
  const last = parseCivilDate(lastActivity, "last activity date");
  const at = parseCivilDate(asOf, "as-of date");
  const totalDays = calendarDaysBetween(lastActivity, asOf);
  if (totalDays < 0) throw new Error(`The last activity date ${lastActivity} is after the as-of date ${asOf}.`);
  let months = (at.year - last.year) * 12 + (at.month - last.month);
  if (Math.min(at.day, daysInMonth(last.year, last.month)) < last.day) months -= 1;
  return { months, days: calendarDaysBetween(lastActivity, monthsBefore(asOf, months)), totalDays };
}
function lawDormantAgeText(age) {
  if (!age) return "";
  const years = Math.floor(age.months / 12);
  const months = age.months - years * 12;
  const parts = [];
  if (years) parts.push(plural(years, "year"));
  if (months) parts.push(plural(months, "month"));
  if (age.days || parts.length === 0) parts.push(plural(age.days, "day"));
  return parts.join(", ");
}
function validate(input) {
  lawAssertTransactions(input.transactions);
  parseCivilDate(input.asOf, "as-of date");
  const months = periodMonthsOf(input.period, input.unit);
  monthsBefore(input.asOf, months);
  const carried = input.carriedIn ?? [];
  lawAssertBalances(carried, "carried-in balance");
  for (const c of carried) {
    const name = lawClientLabel(c.client);
    if (!c.lastActivity || c.lastActivity.trim() === "") throw new Error(`Type the last activity date for the carried-in balance of ${name}.`);
    parseCivilDate(c.lastActivity, `last activity date for ${name}`);
    if (c.lastActivity > input.asOf) throw new Error(`The last activity date typed for ${name} (${c.lastActivity}) is after the as-of date (${input.asOf}).`);
  }
  return months;
}
function groupOf(balance, lastActivity, cutoff) {
  if (balance === 0 || balance === 0n) return "zero";
  if (balance < 0) return "below";
  return lastActivity < cutoff ? "listed" : "active";
}
function byLastActivity(a, b) {
  if (a.lastActivity !== b.lastActivity) return a.lastActivity < b.lastActivity ? -1 : 1;
  const ka = lawClientKey(a.client);
  const kb = lawClientKey(b.client);
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}
function buildDormantReport(input) {
  const periodMonths = validate(input);
  const cutoff = monthsBefore(input.asOf, periodMonths);
  const carried = input.carriedIn ?? [];
  const counted = input.transactions.filter((t) => t.date <= input.asOf);
  const ledgers = lawBuildLedgers(
    counted,
    carried.map((c) => ({ client: c.client, balance: c.balance }))
  );
  const carriedBy = new Map(carried.map((c) => [lawClientKey(c.client), c]));
  const clients = [];
  let unassignedTotal = 0;
  for (const ledger of ledgers) {
    if (ledger.client === "") {
      unassignedTotal = ledger.closing;
      continue;
    }
    let last = carriedBy.get(lawClientKey(ledger.client))?.lastActivity ?? "";
    for (const e of ledger.entries) if (e.amount !== 0 && e.date > last) last = e.date;
    clients.push({
      client: ledger.client,
      carriedIn: ledger.opening,
      rows: ledger.entries.length,
      balance: ledger.closing,
      lastActivity: last,
      age: last ? lawDormantAge(last, input.asOf) : null,
      group: groupOf(ledger.closing, last, cutoff)
    });
  }
  const total = (group) => sum(clients.filter((c) => c.group === group).map((c) => c.balance));
  const figures = {
    asOf: input.asOf,
    period: input.period,
    unit: input.unit,
    periodMonths,
    cutoff,
    clients,
    listed: clients.filter((c) => c.group === "listed").sort(byLastActivity),
    belowZero: clients.filter((c) => c.group === "below").sort(byLastActivity),
    unassigned: lawSortByDate(counted.filter((t) => lawClientKey(t.client) === "")),
    listedTotal: total("listed"),
    activeTotal: total("active"),
    belowZeroTotal: total("below"),
    unassignedTotal,
    trustTotal: sum([...carried.map((c) => c.balance), ...counted.map((t) => t.amount)]),
    transactionCount: input.transactions.length,
    counted: counted.length,
    afterAsOf: input.transactions.length - counted.length,
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyDormantReport(input, figures) };
}
var DAY_MS = 864e5;
function utcParts(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}
function utcDay(iso) {
  const [y, m, d] = utcParts(iso);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
function isoOfUtcDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
function utcMonthsBack(iso, k) {
  const [y, m, d] = utcParts(iso);
  const first = new Date(Date.UTC(y, m - 1 - k, 1));
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, length)) / DAY_MS);
}
function ageSecondWay(lastActivity, asOf) {
  const lastDay = utcDay(lastActivity);
  const [ly, lm] = utcParts(lastActivity);
  const [ay, am] = utcParts(asOf);
  let k = Math.max(0, (ay - ly) * 12 + (am - lm));
  while (k > 0 && utcMonthsBack(asOf, k) < lastDay) k--;
  while (utcMonthsBack(asOf, k + 1) >= lastDay) k++;
  return { months: k, days: utcMonthsBack(asOf, k) - lastDay, totalDays: utcDay(asOf) - lastDay };
}
var sameAge = (a, b) => a === null || b === null ? a === b : a.months === b.months && a.days === b.days && a.totalDays === b.totalDays;
var sameKeys = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
function verifyDormantReport(input, r) {
  const periodMonths = validate(input);
  const checks = new CheckList();
  const carried = input.carriedIn ?? [];
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the report; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const cutoff = isoOfUtcDay(utcMonthsBack(input.asOf, periodMonths));
  checks.that(
    "cutoff",
    `The cutoff is the as-of date (${input.asOf}) less ${lawDormantPeriodText(input.period, input.unit)}: ${cutoff}`,
    r.cutoff === cutoff && r.asOf === input.asOf && r.period === input.period && r.unit === input.unit && r.periodMonths === periodMonths,
    `the report shows the cutoff ${r.cutoff} for ${r.asOf} less ${r.periodMonths} month(s)`
  );
  const inRange = input.transactions.filter((t) => !(t.date > input.asOf));
  checks.that(
    "rows-counted",
    "Rows in = rows on or before the as-of date + rows after it (count)",
    r.transactionCount === input.transactions.length && r.counted === inRange.length && r.afterAsOf === input.transactions.length - inRange.length,
    `${input.transactions.length} in, ${inRange.length} on or before the as-of date; the report shows ${r.counted} and ${r.afterAsOf} after`
  );
  const later = input.transactions.filter((t) => t.date > input.asOf);
  checks.that(
    "none-after-as-of",
    "No row is dated after the as-of date",
    later.length === 0,
    `${later.length} row(s) are dated after the as-of date and are left out of every balance; first: row ${later[0]?.rowNumber} (${later[0]?.date})`,
    "warning"
  );
  const walk = /* @__PURE__ */ new Map();
  for (const c of carried) walk.set(lawClientKey(c.client), { carried: BigInt(c.balance), balance: BigInt(c.balance), rows: 0, last: c.lastActivity });
  let unassigned = 0n;
  const unassignedRows = [];
  for (const t of inRange) {
    const key = lawClientKey(t.client);
    if (key === "") {
      unassigned += BigInt(t.amount);
      unassignedRows.push(String(t.rowNumber));
      continue;
    }
    const w = walk.get(key) ?? { carried: 0n, balance: 0n, rows: 0, last: "" };
    w.balance += BigInt(t.amount);
    w.rows++;
    if (t.amount !== 0 && t.date > w.last) w.last = t.date;
    walk.set(key, w);
  }
  const expected = (w) => groupOf(w.balance, w.last, cutoff);
  const shownKeys = r.clients.map((c) => lawClientKey(c.client));
  const shown = new Map(r.clients.map((c) => [lawClientKey(c.client), c]));
  checks.that(
    "each-client-once",
    "Every client or matter in the rows is in the report exactly once",
    shownKeys.length === walk.size && new Set(shownKeys).size === shownKeys.length && shownKeys.every((k) => k !== "" && walk.has(k)),
    `${walk.size} in the rows, ${shownKeys.length} in the report`
  );
  const off = { balance: [], last: [], group: [] };
  for (const [key, w] of walk) {
    const c = shown.get(key);
    if (!c || BigInt(c.balance) !== w.balance || BigInt(c.carriedIn) !== w.carried || c.rows !== w.rows) off.balance.push(c ? `${c.client}: ${formatUSD(Number(w.balance))} on the second pass, ${formatUSD(c.balance)} shown` : key);
    if (!c || c.lastActivity !== w.last) off.last.push(c ? `${c.client}: ${w.last || "none"} on the second walk, ${c.lastActivity || "none"} shown` : key);
    if (!c || c.group !== expected(w)) off.group.push(c ? `${c.client}: ${expected(w)}, shown as ${c.group}` : key);
  }
  checks.that("balances-readd", "Every client balance re-adds: carried-in balance + its rows on or before the as-of date (second pass)", off.balance.length === 0, `${off.balance.length} off; first: ${off.balance[0]}`);
  checks.that("last-activity", "Every last activity date matches a second walk of the rows (the latest row with an amount, or the date typed for a carried-in balance)", off.last.length === 0, `${off.last.length} off; first: ${off.last[0]}`);
  checks.that("groups", "Every client is in one group by its own balance and last activity: listed, active, zero, or below zero", off.group.length === 0, `${off.group.length} off; first: ${off.group[0]}`);
  const recent = /* @__PURE__ */ new Set();
  for (const t of inRange) if (t.amount !== 0 && t.date >= cutoff) recent.add(lawClientKey(t.client));
  for (const c of carried) if (c.lastActivity >= cutoff) recent.add(lawClientKey(c.client));
  const notDormant = r.listed.filter((c) => {
    const key = lawClientKey(c.client);
    const w = walk.get(key);
    return !w || recent.has(key) || w.balance <= 0n || BigInt(c.balance) !== w.balance || c.lastActivity !== w.last || c.group !== "listed";
  });
  checks.that("listed-dormant", `Every listed balance is above zero and its client has no activity on or after the cutoff (${cutoff}), read again from the rows`, notDormant.length === 0, `${notDormant.length} listed balance(s) do not qualify; first: ${notDormant[0]?.client}`);
  const expectListed = [...walk].filter(([, w]) => expected(w) === "listed").map(([k]) => k);
  checks.that("listed-complete", "Every balance above zero with no activity on or after the cutoff is listed, once", sameKeys(expectListed, r.listed.map((c) => lawClientKey(c.client))), `the second walk finds ${expectListed.length}, the list shows ${r.listed.length}`);
  const shortAge = r.listed.filter((c) => !c.age || c.age.months < periodMonths || c.age.months === periodMonths && c.age.days === 0);
  checks.that("listed-age", `Every listed age is longer than ${lawDormantPeriodText(input.period, input.unit)}`, shortAge.length === 0, `${shortAge.length} listed age(s) are not; first: ${shortAge[0]?.client}`);
  const expectBelow = [...walk].filter(([, w]) => w.balance < 0n).map(([k]) => k);
  const belowOk = sameKeys(expectBelow, r.belowZero.map((c) => lawClientKey(c.client))) && r.belowZero.every((c) => {
    const w = walk.get(lawClientKey(c.client));
    return !!w && BigInt(c.balance) === w.balance && c.lastActivity === w.last && c.group === "below";
  });
  checks.that("below-listed", "The list of balances below zero matches the second walk", belowOk, `the second walk finds ${expectBelow.length}, the list shows ${r.belowZero.length}`);
  const badAges = [...r.clients, ...r.listed, ...r.belowZero].filter((c) => !sameAge(c.age, c.lastActivity ? ageSecondWay(c.lastActivity, input.asOf) : null));
  checks.that("ages", "Every age counts back from the as-of date to the last activity date (second way)", badAges.length === 0, `${badAges.length} age(s) off; first: ${badAges[0]?.client}`);
  checks.that("unassigned-listed", "The list of rows with no client or matter is complete", sameKeys(unassignedRows, r.unassigned.map((t) => String(t.rowNumber))), `${unassignedRows.length} in the rows, ${r.unassigned.length} listed`);
  const trust = lawBigSum([...carried.map((c) => c.balance), ...inRange.map((t) => t.amount)]);
  const groupTotal = (group) => Number([...walk.values()].filter((w) => expected(w) === group).reduce((s, w) => s + w.balance, 0n));
  checks.cents("trust-total", "Carried-in balances + every row on or before the as-of date = trust total (second pass)", Number(trust), r.trustTotal);
  checks.cents("listed-total", "Listed balances add up to the listed total", groupTotal("listed"), r.listedTotal);
  checks.cents("active-total", "Active balances add up to the active total", groupTotal("active"), r.activeTotal);
  checks.cents("below-total", "Balances below zero add up to the below-zero total", groupTotal("below"), r.belowZeroTotal);
  checks.cents("unassigned-total", "Rows with no client or matter add up to their total", Number(unassigned), r.unassignedTotal);
  checks.cents(
    "groups-total",
    "Listed + active + below zero + no client or matter = trust total",
    Number(trust),
    Number(BigInt(r.listedTotal) + BigInt(r.activeTotal) + BigInt(r.belowZeroTotal) + BigInt(r.unassignedTotal))
  );
  checks.that("no-below-zero", "No client balance is below zero on the as-of date", expectBelow.length === 0, `${expectBelow.length} balance(s) below zero, listed on their own`, "warning");
  checks.that("all-assigned", "Every row on or before the as-of date has a client or matter", unassignedRows.length === 0, `${unassignedRows.length} row(s) have none`, "warning");
  checks.that("has-rows", "At least one row or carried-in balance is on or before the as-of date", inRange.length > 0 || carried.length > 0, "every row is dated after the as-of date", "warning");
  return checks.all;
}
var LAW_DORMANT_GROUP_LABELS = { listed: "Listed", active: "Active", zero: "Zero", below: "Below zero" };
var agedRows = (list) => [
  ["Client or matter", "Balance", "Last activity", "Age", "Days since last activity"],
  ...list.map((c) => [c.client, toDecimal(c.balance), c.lastActivity, lawDormantAgeText(c.age), c.age ? c.age.totalDays : ""])
];
function dormantReportTables(r) {
  const count = (group) => r.clients.filter((c) => c.group === group).length;
  return {
    settings: [
      ["Item", "Value"],
      ["As-of date", r.asOf],
      ["Period typed", lawDormantPeriodText(r.period, r.unit)],
      ["Cutoff (as-of date less the period)", r.cutoff],
      ["Listed", `Balances above zero with no activity on or after ${r.cutoff}`],
      ["Rows on or before the as-of date", r.counted],
      ["Rows after the as-of date, left out", r.afterAsOf]
    ],
    listed: agedRows(r.listed),
    belowZero: agedRows(r.belowZero),
    unassigned: [["Row", "Date", "Reference", "Description", "Amount"], ...r.unassigned.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, toDecimal(t.amount)])],
    totals: [
      ["Group", "Count", "Amount"],
      ["Listed: no activity since the cutoff", count("listed"), toDecimal(r.listedTotal)],
      ["Active", count("active"), toDecimal(r.activeTotal)],
      ["Zero", count("zero"), toDecimal(0)],
      ["Below zero", count("below"), toDecimal(r.belowZeroTotal)],
      ["Rows with no client or matter", r.unassigned.length, toDecimal(r.unassignedTotal)],
      ["Trust total", "", toDecimal(r.trustTotal)]
    ],
    clients: [
      ["Client or matter", "Carried in", "Rows", "Balance", "Last activity", "Age", "Group"],
      ...r.clients.map((c) => [c.client, toDecimal(c.carriedIn), c.rows, toDecimal(c.balance), c.lastActivity, lawDormantAgeText(c.age), LAW_DORMANT_GROUP_LABELS[c.group]])
    ]
  };
}

export {
  LAW_DORMANT_MAX,
  lawDormantPeriodText,
  lawDormantCutoff,
  lawDormantAge,
  lawDormantAgeText,
  buildDormantReport,
  verifyDormantReport,
  LAW_DORMANT_GROUP_LABELS,
  dormantReportTables
};
