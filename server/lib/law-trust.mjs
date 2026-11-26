// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  SITE_URL
} from "./present.mjs";
import {
  readXlsx,
  writeXlsx
} from "./fflate.mjs";
import {
  AgentInputError,
  columnsInput,
  mapColumns,
  oneFile
} from "./sheets.mjs";
import {
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader,
  verifyBankStatement
} from "./reconcile.mjs";
import {
  calendarDaysBetween,
  daysInMonth,
  formatCivilDate,
  parseCivilDate
} from "./calendarDays.mjs";
import {
  CheckList,
  assertCents,
  formatUSD,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/law/ledger.ts
var LAW_UNASSIGNED_LABEL = "(no client or matter)";
function lawClientKey(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
function lawClientLabel(name) {
  return name.trim() === "" ? LAW_UNASSIGNED_LABEL : name.trim().replace(/\s+/g, " ");
}
function lawAssertTransactions(transactions) {
  const seen = /* @__PURE__ */ new Set();
  for (const t of transactions) {
    if (!Number.isSafeInteger(t.rowNumber)) throw new Error("Every transaction needs a whole row number.");
    if (seen.has(t.rowNumber)) throw new Error(`Row number ${t.rowNumber} appears twice in the transaction list.`);
    seen.add(t.rowNumber);
    if (!isIsoDate(t.date)) throw new Error(`Row ${t.rowNumber}: "${t.date}" is not a valid date.`);
    assertCents(t.amount, `amount on row ${t.rowNumber}`);
  }
}
function lawAssertBalances(balances, what) {
  const seen = /* @__PURE__ */ new Set();
  for (const b of balances) {
    const key = lawClientKey(b.client);
    if (key === "") throw new Error(`Every ${what} needs a client or matter name.`);
    if (seen.has(key)) throw new Error(`"${b.client.trim()}" is listed twice in the ${what}s.`);
    seen.add(key);
    assertCents(b.balance, `${what} for ${b.client.trim()}`);
  }
}
function lawSortByDate(transactions) {
  return transactions.map((t, i) => ({ t, i })).sort((a, b) => a.t.date === b.t.date ? a.i - b.i : a.t.date < b.t.date ? -1 : 1).map((x) => x.t);
}
function lawBuildLedgers(transactions, openingBalances = []) {
  lawAssertTransactions(transactions);
  lawAssertBalances(openingBalances, "opening balance");
  const ledgers = /* @__PURE__ */ new Map();
  for (const b of openingBalances) ledgers.set(lawClientKey(b.client), { client: lawClientLabel(b.client), opening: b.balance, entries: [], closing: b.balance });
  for (const t of lawSortByDate(transactions)) {
    const key = lawClientKey(t.client);
    let ledger = ledgers.get(key);
    if (!ledger) {
      ledger = { client: key === "" ? "" : lawClientLabel(t.client), opening: 0, entries: [], closing: 0 };
      ledgers.set(key, ledger);
    }
    ledger.closing = assertCents(ledger.closing + t.amount, "ledger balance");
    ledger.entries.push({ rowNumber: t.rowNumber, date: t.date, description: t.description, reference: t.reference ?? "", amount: t.amount, balance: ledger.closing });
  }
  return [...ledgers.values()];
}
function lawBigSum(values) {
  let total = 0n;
  for (let i = values.length - 1; i >= 0; i--) total += BigInt(values[i]);
  return total;
}

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
  const count2 = (group) => r.clients.filter((c) => c.group === group).length;
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
      ["Listed: no activity since the cutoff", count2("listed"), toDecimal(r.listedTotal)],
      ["Active", count2("active"), toDecimal(r.activeTotal)],
      ["Zero", count2("zero"), toDecimal(0)],
      ["Below zero", count2("below"), toDecimal(r.belowZeroTotal)],
      ["Rows with no client or matter", r.unassigned.length, toDecimal(r.unassignedTotal)],
      ["Trust total", "", toDecimal(r.trustTotal)]
    ],
    clients: [
      ["Client or matter", "Carried in", "Rows", "Balance", "Last activity", "Age", "Group"],
      ...r.clients.map((c) => [c.client, toDecimal(c.carriedIn), c.rows, toDecimal(c.balance), c.lastActivity, lawDormantAgeText(c.age), LAW_DORMANT_GROUP_LABELS[c.group]])
    ]
  };
}

// packages/core/src/law/earnedFees.ts
var LAW_INVOICE_ROLES = ["date", "client", "invoice", "amount"];
var LAW_INVOICE_LABELS = {
  date: "Invoice date",
  client: "Client or matter",
  invoice: "Invoice number",
  amount: "Fees billed"
};
var INVOICE_SYNONYMS = {
  date: ["invoice date", "bill date", "billed date", "billing date", "date billed", "date"],
  client: ["client matter", "client", "matter", "client name", "matter name", "case", "file"],
  invoice: ["invoice number", "invoice no", "invoice num", "invoice", "bill number", "bill no", "number", "reference", "ref"],
  amount: ["fees billed", "fee amount", "fees", "amount billed", "billed amount", "billed", "invoice amount", "invoice total", "amount", "total"]
};
function lawGuessInvoiceColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, LAW_INVOICE_ROLES, INVOICE_SYNONYMS, atHeaderRow);
}
var cellAt = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
function lawExtractInvoices(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The invoice list has no rows under its header row.");
  const c = mapping.columns;
  for (const role of ["date", "client", "amount"]) {
    if (!Number.isSafeInteger(c[role]) || c[role] < 0) throw new Error(`No "${LAW_INVOICE_LABELS[role]}" column could be identified in the invoice list. Choose it in the column mapping.`);
  }
  const used = Object.values(c).filter((x) => x >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts of the invoice list. Each column can be used once.");
  const invoices = [];
  const problems = [];
  const totalRows = [];
  let ignoredRows = 0;
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = cellAt(row, c.date);
    const rawAmount = cellAt(row, c.amount);
    const client = cellAt(row, c.client).replace(/\s+/g, " ");
    if (!rawDate && row.some((x) => sheetIsTotalWord(x))) {
      totalRows.push(rowNumber);
      return;
    }
    if (!rawDate && !rawAmount) {
      ignoredRows++;
      return;
    }
    const reasons = [];
    let date = "";
    if (!rawDate) reasons.push("no invoice date");
    else {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    let amount = 0;
    if (!rawAmount) reasons.push("no amount billed");
    else {
      try {
        amount = pmCellToCents(rawAmount);
      } catch {
        reasons.push(`the amount "${rawAmount}" could not be read`);
      }
    }
    if (!client) reasons.push("no client or matter");
    if (reasons.length) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    invoices.push({ rowNumber, date, client, invoice: cellAt(row, c.invoice), amount });
  });
  if (invoices.length === 0 && problems.length === 0) throw new Error("No invoices were found under the header row. Check the header row and the column mapping.");
  return { invoices, problems, totalRows, ignoredRows };
}
function lawFeeWords(words) {
  const out = [];
  for (const w of words) {
    const word = w.trim().replace(/\s+/g, " ").toLowerCase();
    if (word && !out.includes(word)) out.push(word);
  }
  return out;
}
function lawFeeWordsFromText(text) {
  return lawFeeWords(text.split(/[,;]/));
}
var rowText = (t) => `${t.description} ${t.reference ?? ""}`.replace(/\s+/g, " ").toLowerCase();
function lawFeeHasWord(t, words) {
  const text = rowText(t);
  return words.some((w) => text.includes(w));
}
function validate2(input) {
  lawAssertTransactions(input.transactions);
  parseCivilDate(input.asOf, "as-of date");
  const from = input.from ?? "";
  if (from !== "") {
    parseCivilDate(from, "from date");
    if (from > input.asOf) throw new Error(`The from date (${from}) is after the as-of date (${input.asOf}).`);
  }
  const words = lawFeeWords(input.transferWords);
  if (words.length === 0) throw new Error("Type at least one word that marks a fee transfer in the trust list, such as the word its description uses for the firm account.");
  lawAssertBalances(input.carriedIn ?? [], "carried-in balance");
  const seen = /* @__PURE__ */ new Set();
  for (const inv of input.invoices) {
    if (!Number.isSafeInteger(inv.rowNumber)) throw new Error("Every invoice needs a whole row number.");
    if (seen.has(inv.rowNumber)) throw new Error(`Row number ${inv.rowNumber} appears twice in the invoice list.`);
    seen.add(inv.rowNumber);
    if (!isIsoDate(inv.date)) throw new Error(`Invoice row ${inv.rowNumber}: "${inv.date}" is not a valid date.`);
    if (lawClientKey(inv.client) === "") throw new Error(`Invoice row ${inv.rowNumber} has no client or matter.`);
    assertCents(inv.amount, `amount on invoice row ${inv.rowNumber}`);
  }
  return words;
}
var inWindow = (date, from, asOf) => date <= asOf && (from === "" || date >= from);
function buildEarnedFeesReport(input) {
  const words = validate2(input);
  const asOf = input.asOf;
  const from = input.from ?? "";
  const carried = input.carriedIn ?? [];
  const counted = lawSortByDate(input.transactions.filter((t) => t.date <= asOf));
  const invoices = lawSortByDate(input.invoices.filter((i) => inWindow(i.date, from, asOf)));
  const work = /* @__PURE__ */ new Map();
  const get = (name) => {
    const key = lawClientKey(name);
    let w = work.get(key);
    if (!w) {
      w = { client: lawClientLabel(name), carriedIn: 0, moneyIn: 0, otherOut: 0, transferredBefore: 0, balance: 0, invoices: [], transfers: [] };
      work.set(key, w);
    }
    return w;
  };
  for (const c of carried) {
    const w = get(c.client);
    w.carriedIn = c.balance;
    w.balance = c.balance;
  }
  const transfers = [];
  const markedMoneyIn = [];
  const unassigned = [];
  let moneyInTotal = 0;
  let otherOutTotal = 0;
  let transferredBeforeTotal = 0;
  let unassignedTotal = 0;
  let unassignedTransferTotal = 0;
  for (const t of counted) {
    const marked = lawFeeHasWord(t, words);
    const isTransfer = marked && t.amount < 0;
    if (marked && t.amount > 0) markedMoneyIn.push(t);
    const assigned = lawClientKey(t.client) !== "";
    const w = assigned ? get(t.client) : null;
    if (!assigned) {
      unassigned.push(t);
      unassignedTotal = assertCents(unassignedTotal + t.amount, "total of rows with no client");
    }
    if (t.amount >= 0) {
      moneyInTotal = assertCents(moneyInTotal + t.amount, "money in");
      if (w) w.moneyIn += t.amount;
    } else if (!isTransfer) {
      otherOutTotal = assertCents(otherOutTotal - t.amount, "money out");
      if (w) w.otherOut -= t.amount;
    } else if (from !== "" && t.date < from) {
      transferredBeforeTotal = assertCents(transferredBeforeTotal - t.amount, "fee transfers before the from date");
      if (w) w.transferredBefore -= t.amount;
    } else {
      transfers.push(t);
      if (w) w.transfers.push(t);
      else unassignedTransferTotal -= t.amount;
    }
    if (w) w.balance = assertCents(w.balance + t.amount, `trust balance for ${w.client}`);
  }
  for (const inv of invoices) get(inv.client).invoices.push(inv);
  const clients = [];
  const open = [];
  const ahead = [];
  for (const w of work.values()) {
    const billed = sum(w.invoices.map((i2) => i2.amount));
    const transferred = sum(w.transfers.map((t) => -t.amount));
    let pool = transferred + sum(w.invoices.filter((i2) => i2.amount < 0).map((i2) => -i2.amount));
    const mine = [];
    for (const inv of w.invoices) {
      if (inv.amount <= 0) continue;
      const covered = Math.min(pool, inv.amount);
      pool -= covered;
      if (inv.amount > covered) mine.push({ client: w.client, rowNumber: inv.rowNumber, invoice: inv.invoice, date: inv.date, billed: inv.amount, notTransferred: inv.amount - covered, ageDays: calendarDaysBetween(inv.date, asOf) });
    }
    open.push(...mine);
    let runTransferred = 0;
    let i = 0;
    let runBilled = 0;
    for (const t of w.transfers) {
      while (i < w.invoices.length && w.invoices[i].date <= t.date) runBilled += w.invoices[i++].amount;
      const before = runTransferred;
      runTransferred -= t.amount;
      const above = Math.min(-t.amount, runTransferred - Math.max(runBilled, before));
      if (runTransferred > runBilled && above > 0) {
        ahead.push({ client: w.client, rowNumber: t.rowNumber, date: t.date, reference: t.reference ?? "", description: t.description, amount: -t.amount, billedToDate: runBilled, transferredToDate: runTransferred, above });
      }
    }
    clients.push({
      client: w.client,
      carriedIn: w.carriedIn,
      moneyIn: w.moneyIn,
      otherOut: w.otherOut,
      transferredBefore: w.transferredBefore,
      balance: w.balance,
      invoiceCount: w.invoices.length,
      billed,
      transferCount: w.transfers.length,
      transferred,
      notTransferred: Math.max(billed - transferred, 0),
      aboveBilled: Math.max(transferred - billed, 0),
      oldestOpen: mine[0]?.date ?? "",
      oldestOpenDays: mine[0] ? mine[0].ageDays : null
    });
  }
  open.sort((a, b) => a.date === b.date ? a.rowNumber - b.rowNumber : a.date < b.date ? -1 : 1);
  ahead.sort((a, b) => a.date === b.date ? a.rowNumber - b.rowNumber : a.date < b.date ? -1 : 1);
  const figures = {
    asOf,
    from,
    words,
    clients,
    open,
    ahead,
    transfers,
    markedMoneyIn,
    unassigned,
    carriedTotal: sum(carried.map((c) => c.balance)),
    moneyInTotal,
    otherOutTotal,
    transferredBeforeTotal,
    transferTotal: sum(transfers.map((t) => -t.amount)),
    unassignedTransferTotal,
    unassignedTotal,
    trustTotal: sum([...carried.map((c) => c.balance), ...counted.map((t) => t.amount)]),
    billedTotal: sum(clients.map((c) => c.billed)),
    notTransferredTotal: sum(clients.map((c) => c.notTransferred)),
    aboveBilledTotal: sum(clients.map((c) => c.aboveBilled)),
    transactionCount: input.transactions.length,
    counted: counted.length,
    afterAsOf: input.transactions.length - counted.length,
    invoiceCount: input.invoices.length,
    invoicesCounted: invoices.length,
    invoicesBefore: input.invoices.filter((i) => from !== "" && i.date < from).length,
    invoicesAfter: input.invoices.filter((i) => i.date > asOf).length,
    transactionProblems: [...input.transactionProblems ?? []],
    invoiceProblems: [...input.invoiceProblems ?? []]
  };
  return { ...figures, checks: verifyEarnedFeesReport(input, figures) };
}
var DAY_MS2 = 864e5;
function utcDay2(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS2);
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var firstOf = (list) => list.length ? `${list.length} off; first: ${list[0]}` : "";
function verifyEarnedFeesReport(input, r) {
  validate2(input);
  const checks = new CheckList();
  const asOf = input.asOf;
  const from = input.from ?? "";
  const carried = input.carriedIn ?? [];
  const words = lawFeeWords(input.transferWords);
  const pattern = new RegExp(words.map(escapeRe).join("|"), "i");
  const marked = (t) => pattern.test(`${t.description} ${t.reference ?? ""}`.replace(/\s+/g, " "));
  checks.that("rows-read", "Every row of the trust list with data was read", r.transactionProblems.length === 0, `${r.transactionProblems.length} row(s) could not be read and are not in the report; first: row ${r.transactionProblems[0]?.rowNumber} (${r.transactionProblems[0]?.reason})`);
  checks.that("invoices-read", "Every row of the invoice list with data was read", r.invoiceProblems.length === 0, `${r.invoiceProblems.length} invoice row(s) could not be read and are not in the report; first: row ${r.invoiceProblems[0]?.rowNumber} (${r.invoiceProblems[0]?.reason})`);
  const inRange = input.transactions.filter((t) => !(t.date > asOf));
  checks.that(
    "rows-counted",
    "Trust rows in = rows on or before the as-of date + rows after it (count)",
    r.asOf === asOf && r.transactionCount === input.transactions.length && r.counted === inRange.length && r.afterAsOf === input.transactions.length - inRange.length,
    `${input.transactions.length} in, ${inRange.length} on or before ${asOf}; the report shows ${r.counted} and ${r.afterAsOf} after`
  );
  const invIn = input.invoices.filter((i) => !(i.date > asOf) && !(from !== "" && i.date < from));
  const invBefore = input.invoices.filter((i) => from !== "" && i.date < from).length;
  const invAfter = input.invoices.filter((i) => i.date > asOf).length;
  checks.that(
    "invoices-counted",
    from ? `Invoices in = before ${from} + counted + after ${asOf} (count)` : `Invoices in = counted + after ${asOf} (count)`,
    r.from === from && r.invoiceCount === input.invoices.length && r.invoicesCounted === invIn.length && r.invoicesBefore === invBefore && r.invoicesAfter === invAfter && invIn.length + invBefore + invAfter === input.invoices.length,
    `${input.invoices.length} in, ${invIn.length} counted; the report shows ${r.invoicesCounted}`
  );
  const second = /* @__PURE__ */ new Map();
  const at = (name) => {
    const key = lawClientKey(name);
    let s = second.get(key);
    if (!s) {
      s = { carried: 0n, balance: 0n, billed: 0n, transferred: 0n, invoices: [], transfers: [] };
      second.set(key, s);
    }
    return s;
  };
  for (const c of carried) {
    const s = at(c.client);
    s.carried = BigInt(c.balance);
    s.balance = BigInt(c.balance);
  }
  const transferRows = [];
  let moneyIn = 0n;
  let otherOut = 0n;
  let before = 0n;
  let unassignedTransfers = 0n;
  let unassigned = 0n;
  const unassignedRows = [];
  const markedIn = [];
  for (const t of inRange) {
    const key = lawClientKey(t.client);
    const amount = BigInt(t.amount);
    const fee = t.amount < 0 && marked(t);
    if (t.amount > 0 && marked(t)) markedIn.push(t.rowNumber);
    if (key === "") {
      unassigned += amount;
      unassignedRows.push(t.rowNumber);
    } else at(t.client).balance += amount;
    if (amount >= 0n) moneyIn += amount;
    else if (!fee) otherOut -= amount;
    else if (from !== "" && t.date < from) before -= amount;
    else {
      transferRows.push(t);
      if (key === "") unassignedTransfers -= amount;
      else {
        const s = at(t.client);
        s.transferred -= amount;
        s.transfers.push(t);
      }
    }
  }
  for (const inv of invIn) {
    const s = at(inv.client);
    s.billed += BigInt(inv.amount);
    s.invoices.push(inv);
  }
  const shownKeys = r.clients.map((c) => lawClientKey(c.client));
  const shown = new Map(r.clients.map((c) => [lawClientKey(c.client), c]));
  checks.that(
    "each-client-once",
    "Every client or matter in the two lists is in the report exactly once",
    shownKeys.length === second.size && new Set(shownKeys).size === shownKeys.length && shownKeys.every((k) => k !== "" && second.has(k)),
    `${second.size} in the lists, ${shownKeys.length} in the report`
  );
  const sameRows = (a, b) => a.length === b.length && [...a.map((x) => x.rowNumber)].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");
  checks.that("transfers-found", `The fee transfers are exactly the money-out rows that hold ${words.map((w) => `"${w}"`).join(" or ")}, dated ${from ? `from ${from} ` : ""}on or before ${asOf} (matched a second way)`, sameRows(r.transfers, transferRows.map((t) => t.rowNumber)) && r.words.join("\n") === words.join("\n"), `the second match finds ${transferRows.length}, the report shows ${r.transfers.length}`);
  const off = { billed: [], transferred: [], balance: [], split: [] };
  for (const [key, s] of second) {
    const c = shown.get(key);
    if (!c) continue;
    if (BigInt(c.billed) !== s.billed || c.invoiceCount !== s.invoices.length) off.billed.push(`${c.client}: ${formatUSD(Number(s.billed))} on the second pass, ${formatUSD(c.billed)} shown`);
    if (BigInt(c.transferred) !== s.transferred || c.transferCount !== s.transfers.length) off.transferred.push(`${c.client}: ${formatUSD(Number(s.transferred))} on the second pass, ${formatUSD(c.transferred)} shown`);
    if (BigInt(c.balance) !== s.balance || BigInt(c.carriedIn) !== s.carried) off.balance.push(`${c.client}: ${formatUSD(Number(s.balance))} on the second pass, ${formatUSD(c.balance)} shown`);
    const diff = s.billed - s.transferred;
    const notT2 = diff > 0n ? diff : 0n;
    const above2 = diff < 0n ? -diff : 0n;
    const shownSplit = BigInt(c.billed) - BigInt(c.transferred) === BigInt(c.notTransferred) - BigInt(c.aboveBilled);
    if (BigInt(c.notTransferred) !== notT2 || BigInt(c.aboveBilled) !== above2 || !shownSplit) off.split.push(`${c.client}: billed ${formatUSD(Number(s.billed))} less transferred ${formatUSD(Number(s.transferred))}`);
  }
  checks.that("client-billed", "Every client's fees billed re-add from its invoices (second pass)", off.billed.length === 0, firstOf(off.billed));
  checks.that("client-transferred", "Every client's fee transfers re-add from its trust rows (second pass)", off.transferred.length === 0, firstOf(off.transferred));
  checks.that("client-split", "For every client, billed less transferred = billed not transferred less transferred above billed, with at most one of the two above zero", off.split.length === 0, firstOf(off.split));
  checks.that("balances-readd", "Every client trust balance re-adds: carried-in balance + its rows on or before the as-of date (second pass)", off.balance.length === 0, firstOf(off.balance));
  const expectOpen = /* @__PURE__ */ new Map();
  for (const s of second.values()) {
    const diff = s.billed - s.transferred;
    let left = diff > 0n ? diff : 0n;
    const newestFirst = [...s.invoices].filter((i) => i.amount > 0).sort((a, b) => a.date === b.date ? b.rowNumber - a.rowNumber : a.date < b.date ? 1 : -1);
    for (const inv of newestFirst) {
      if (left <= 0n) break;
      const part = BigInt(inv.amount) < left ? BigInt(inv.amount) : left;
      expectOpen.set(inv.rowNumber, part);
      left -= part;
    }
  }
  const openOff = r.open.filter((o) => expectOpen.get(o.rowNumber) !== BigInt(o.notTransferred) || o.notTransferred > o.billed);
  checks.that(
    "open-invoices",
    "The amount billed and not transferred is on the newest invoices, each no more than its own amount (worked out newest first)",
    openOff.length === 0 && r.open.length === expectOpen.size && new Set(r.open.map((o) => o.rowNumber)).size === r.open.length,
    `the second way finds ${expectOpen.size} open invoice(s), the report shows ${r.open.length}${openOff[0] ? `; first off: row ${openOff[0].rowNumber}` : ""}`
  );
  const openByClient = /* @__PURE__ */ new Map();
  for (const o of r.open) openByClient.set(lawClientKey(o.client), (openByClient.get(lawClientKey(o.client)) ?? 0n) + BigInt(o.notTransferred));
  const openSumOff = r.clients.filter((c) => (openByClient.get(lawClientKey(c.client)) ?? 0n) !== BigInt(c.notTransferred));
  checks.that("open-sum", "Every client's open invoices add up to its billed not transferred", openSumOff.length === 0, `${openSumOff.length} off; first: ${openSumOff[0]?.client}`);
  const ageOff = r.open.filter((o) => o.ageDays !== utcDay2(asOf) - utcDay2(o.date));
  const oldestOff = r.clients.filter((c) => {
    const mine = r.open.filter((o) => lawClientKey(o.client) === lawClientKey(c.client));
    const oldest = mine.reduce((m, o) => m === "" || o.date < m ? o.date : m, "");
    return c.oldestOpen !== oldest || c.oldestOpenDays !== (oldest ? utcDay2(asOf) - utcDay2(oldest) : null);
  });
  checks.that("ages", `Every age is the days from the invoice date to ${asOf} (second way)`, ageOff.length === 0 && oldestOff.length === 0, `${ageOff.length + oldestOff.length} off; first: ${ageOff[0] ? `row ${ageOff[0].rowNumber}` : oldestOff[0]?.client}`);
  const expectAhead = /* @__PURE__ */ new Map();
  for (const s of second.values()) {
    const ordered = lawSortByDate(s.transfers);
    ordered.forEach((t, idx) => {
      const billedTo = s.invoices.filter((i) => i.date <= t.date).reduce((a, i) => a + BigInt(i.amount), 0n);
      const upTo = ordered.slice(0, idx + 1).reduce((a, x) => a - BigInt(x.amount), 0n);
      const prior = upTo + BigInt(t.amount);
      const floor = billedTo > prior ? billedTo : prior;
      const over = upTo - floor;
      if (upTo > billedTo && over > 0n) expectAhead.set(t.rowNumber, over < -BigInt(t.amount) ? over : -BigInt(t.amount));
    });
  }
  const aheadOff = r.ahead.filter((a) => expectAhead.get(a.rowNumber) !== BigInt(a.above));
  checks.that("ahead", "Every transfer that took a client's transfers above what was billed by its date is listed, with the part above (sums by date, a second way)", aheadOff.length === 0 && r.ahead.length === expectAhead.size, `the second way finds ${expectAhead.size}, the report shows ${r.ahead.length}`);
  checks.that("unassigned-listed", "The list of trust rows with no client or matter is complete", sameRows(r.unassigned, unassignedRows), `${unassignedRows.length} in the rows, ${r.unassigned.length} listed`);
  checks.that("marked-money-in", "Money-in rows holding a transfer word are listed and not counted as transfers", sameRows(r.markedMoneyIn, markedIn), `${markedIn.length} in the rows, ${r.markedMoneyIn.length} listed`);
  const allBilled = lawBigSum(invIn.map((i) => i.amount));
  const allTransfers = lawBigSum(transferRows.map((t) => -t.amount));
  const clientsBilled = lawBigSum(r.clients.map((c) => c.billed));
  const clientsTransferred = lawBigSum(r.clients.map((c) => c.transferred));
  const notT = lawBigSum(r.clients.map((c) => c.notTransferred));
  const above = lawBigSum(r.clients.map((c) => c.aboveBilled));
  checks.cents("billed-total", "Fees billed by client add up to the invoice list total (invoices counted, second pass)", Number(allBilled), Number(clientsBilled));
  checks.cents("billed-shown", "The billed total shown equals the invoice list total", Number(allBilled), r.billedTotal);
  checks.cents("transfer-total", "Fee transfers by client + fee transfers with no client = every fee transfer row (second pass)", Number(allTransfers), Number(clientsTransferred + BigInt(r.unassignedTransferTotal)));
  checks.cents("transfer-shown", "The fee transfer total shown equals every fee transfer row", Number(allTransfers), r.transferTotal);
  checks.cents("unassigned-transfers", "Fee transfers with no client or matter add up to their total", Number(unassignedTransfers), r.unassignedTransferTotal);
  checks.cents("not-transferred-total", "Billed not transferred adds up to its total", Number(notT), r.notTransferredTotal);
  checks.cents("above-total", "Transferred above billed adds up to its total", Number(above), r.aboveBilledTotal);
  checks.cents("net-total", "Billed − transferred (by client) = billed not transferred − transferred above billed", Number(allBilled - clientsTransferred), Number(notT - above));
  const trust = lawBigSum([...carried.map((c) => c.balance), ...inRange.map((t) => t.amount)]);
  const clientBalances = lawBigSum(r.clients.map((c) => c.balance));
  checks.cents("trust-total", "Carried-in balances + every trust row on or before the as-of date = trust balance (second pass)", Number(trust), r.trustTotal);
  checks.cents(
    "trust-movement",
    "Carried in + money in − other money out − fee transfers before the from date − fee transfers counted = trust balance",
    r.trustTotal,
    Number(BigInt(r.carriedTotal) + BigInt(r.moneyInTotal) - BigInt(r.otherOutTotal) - BigInt(r.transferredBeforeTotal) - BigInt(r.transferTotal))
  );
  checks.that(
    "movement-parts",
    "Money in, other money out, and fee transfers each re-add from the rows (second pass)",
    BigInt(r.moneyInTotal) === moneyIn && BigInt(r.otherOutTotal) === otherOut && BigInt(r.transferredBeforeTotal) === before && BigInt(r.carriedTotal) === lawBigSum(carried.map((c) => c.balance)),
    `money in ${formatUSD(Number(moneyIn))}, other out ${formatUSD(Number(otherOut))}, before the from date ${formatUSD(Number(before))} on the second pass`
  );
  checks.cents("balances-total", "Client trust balances + rows with no client or matter = trust balance", Number(trust), Number(clientBalances + BigInt(r.unassignedTotal)));
  checks.cents("unassigned-total", "Rows with no client or matter add up to their total", Number(unassigned), r.unassignedTotal);
  const aboveClients = r.clients.filter((c) => c.aboveBilled > 0);
  checks.that("none-above-billed", "No client's fee transfers are above its fees billed on the as-of date", aboveClients.length === 0, `${aboveClients.length} client(s), together ${formatUSD(Number(above))}; first: ${aboveClients[0]?.client}`, "warning");
  checks.that("none-ahead", "No fee transfer took a client's transfers above what was billed by its date", expectAhead.size === 0, `${expectAhead.size} transfer(s) listed`, "warning");
  const short = r.clients.filter((c) => c.notTransferred > 0 && c.balance < c.notTransferred);
  checks.that("balance-covers", "Every client's trust balance is at least its billed not transferred", short.length === 0, `${short.length} client(s) have less in trust than billed not transferred; first: ${short[0]?.client}`, "warning");
  checks.that("transfers-assigned", "Every fee transfer has a client or matter", unassignedTransfers === 0n && !transferRows.some((t) => lawClientKey(t.client) === ""), `${transferRows.filter((t) => lawClientKey(t.client) === "").length} fee transfer(s) have none and are in no client's figures`, "warning");
  checks.that("all-assigned", "Every trust row on or before the as-of date has a client or matter", unassignedRows.length === 0, `${unassignedRows.length} row(s) have none`, "warning");
  checks.that("no-marked-money-in", "No money-in row holds a transfer word", markedIn.length === 0, `${markedIn.length} money-in row(s) hold one and are not counted as transfers; first: row ${markedIn[0]}`, "warning");
  const trustKeys = /* @__PURE__ */ new Set([...carried.map((c) => lawClientKey(c.client)), ...inRange.map((t) => lawClientKey(t.client))]);
  const strangers = [...new Set(invIn.map((i) => lawClientKey(i.client)))].filter((k) => !trustKeys.has(k));
  checks.that("invoice-clients-in-trust", "Every client with an invoice has trust rows or a carried-in balance", strangers.length === 0, `${strangers.length} client(s) with invoices have none; first: ${shown.get(strangers[0] ?? "")?.client ?? strangers[0]}`, "warning");
  const numbers = /* @__PURE__ */ new Map();
  for (const inv of invIn) if (inv.invoice.trim() !== "") {
    const k = `${lawClientKey(inv.client)}
${inv.invoice.trim().toLowerCase()}`;
    numbers.set(k, (numbers.get(k) ?? 0) + 1);
  }
  const twice = [...numbers].filter(([, n]) => n > 1).map(([k]) => k.split("\n")[1]);
  checks.that("invoice-numbers-once", "No invoice number appears twice for the same client", twice.length === 0, `${twice.length} number(s) appear more than once; first: ${twice[0]}`, "warning");
  const later = input.transactions.filter((t) => t.date > asOf).length + invAfter;
  checks.that("none-after-as-of", "No trust row or invoice is dated after the as-of date", later === 0, `${later} row(s) are dated after ${asOf} and are left out`, "warning");
  checks.that("has-transfers", "At least one fee transfer was found in the trust list", transferRows.length > 0, "no money-out row holds a transfer word: check the words typed", "warning");
  return checks.all;
}
function earnedFeesTables(r) {
  return {
    settings: [
      ["Item", "Value"],
      ["As-of date", r.asOf],
      ["Invoices and fee transfers counted from", r.from || "the first row"],
      ["Words that mark a fee transfer", r.words.join(", ")],
      ["Trust rows on or before the as-of date", r.counted],
      ["Trust rows after the as-of date, left out", r.afterAsOf],
      ["Invoices counted", r.invoicesCounted],
      ["Invoices before the from date, left out", r.invoicesBefore],
      ["Invoices after the as-of date, left out", r.invoicesAfter]
    ],
    clients: [
      ["Client or matter", "Billed", "Transferred", "Billed not transferred", "Transferred above billed", "Oldest open invoice", "Days", "Trust balance"],
      ...r.clients.map((c) => [c.client, toDecimal(c.billed), toDecimal(c.transferred), toDecimal(c.notTransferred), toDecimal(c.aboveBilled), c.oldestOpen, c.oldestOpenDays ?? "", toDecimal(c.balance)]),
      ["Total", toDecimal(r.billedTotal), toDecimal(r.transferTotal - r.unassignedTransferTotal), toDecimal(r.notTransferredTotal), toDecimal(r.aboveBilledTotal), "", "", toDecimal(r.trustTotal - r.unassignedTotal)]
    ],
    open: [["Client or matter", "Row", "Invoice", "Invoice date", "Amount billed", "Not transferred", "Days"], ...r.open.map((o) => [o.client, o.rowNumber, o.invoice, o.date, toDecimal(o.billed), toDecimal(o.notTransferred), o.ageDays])],
    ahead: [
      ["Client or matter", "Row", "Date", "Reference", "Transfer", "Billed to that date", "Transferred to that date", "Above billed"],
      ...r.ahead.map((a) => [a.client, a.rowNumber, a.date, a.reference, toDecimal(a.amount), toDecimal(a.billedToDate), toDecimal(a.transferredToDate), toDecimal(a.above)])
    ],
    transfers: [["Row", "Date", "Reference", "Description", "Client or matter", "Transfer"], ...r.transfers.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, lawClientLabel(t.client), toDecimal(-t.amount)])],
    tieOut: [
      ["Line", "Amount"],
      ["Balances carried in", toDecimal(r.carriedTotal)],
      ["Money in", toDecimal(r.moneyInTotal)],
      ["Money out other than fee transfers", toDecimal(-r.otherOutTotal)],
      ...r.from ? [[`Fee transfers before ${r.from}`, toDecimal(-r.transferredBeforeTotal)]] : [],
      ["Fee transfers counted", toDecimal(-r.transferTotal)],
      ["Trust balance on the as-of date", toDecimal(r.trustTotal)],
      ["Client trust balances", toDecimal(r.trustTotal - r.unassignedTotal)],
      ["Rows with no client or matter", toDecimal(r.unassignedTotal)]
    ],
    unassigned: [["Row", "Date", "Reference", "Description", "Amount"], ...r.unassigned.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, toDecimal(t.amount)])]
  };
}

// packages/core/src/law/entries.ts
function lawAssertEntries(entries) {
  const seen = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.row)) throw new Error("Every entry needs a whole row number.");
    if (seen.has(e.row)) throw new Error(`Row ${e.row} appears twice in the entries.`);
    seen.add(e.row);
    if (e.date.trim() === "") throw new Error(`Row ${e.row} needs a date.`);
    if (!isIsoDate(e.date)) throw new Error(`Row ${e.row}: "${e.date}" is not a valid date.`);
    assertCents(e.received, `amount received on row ${e.row}`);
    assertCents(e.disbursed, `amount disbursed on row ${e.row}`);
    if (e.received < 0 || e.disbursed < 0) throw new Error(`Row ${e.row}: amounts are entered as positive numbers, in the received or the disbursed column.`);
    if (e.received === 0 && e.disbursed === 0) throw new Error(`Row ${e.row} needs an amount received or an amount disbursed.`);
    if (e.received > 0 && e.disbursed > 0) throw new Error(`Row ${e.row} has both an amount received and an amount disbursed. Enter them as two rows.`);
  }
}
function lawEntriesFromTxns(transactions) {
  const entries = [];
  const problems = [];
  for (const t of transactions) {
    if (t.amount === 0) {
      problems.push({ rowNumber: t.rowNumber, reason: "the amount is zero" });
      continue;
    }
    entries.push({ row: t.rowNumber, date: t.date, reference: t.reference ?? "", description: t.description, client: t.client, received: t.amount > 0 ? t.amount : 0, disbursed: t.amount < 0 ? -t.amount : 0 });
  }
  return { entries, problems };
}
function lawEntriesInDateOrder(entries) {
  return entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? -1 : 1).map((x) => x.e);
}

// packages/core/src/law/ledgerCard.ts
function validate3(input) {
  assertCents(input.opening, "opening balance");
  lawAssertEntries(input.entries);
}
function buildTrustCard(input) {
  validate3(input);
  let running = input.opening;
  const lines = lawEntriesInDateOrder(input.entries).map((e, i) => {
    running = assertCents(running + e.received - e.disbursed, "ledger balance");
    return { ...e, line: i + 1, balance: running };
  });
  const belowZero = [];
  if (input.opening < 0) belowZero.push({ line: 0, date: "", balance: input.opening });
  for (const l of lines) if (l.balance < 0) belowZero.push({ line: l.line, date: l.date, balance: l.balance });
  const figures = {
    lines,
    receiptsTotal: sum(input.entries.map((e) => e.received)),
    disbursementsTotal: sum(input.entries.map((e) => e.disbursed)),
    closing: running,
    lowest: lines.reduce((low, l) => l.balance < low ? l.balance : low, input.opening),
    belowZero
  };
  return { ...figures, checks: verifyTrustCard(input, figures) };
}
function verifyTrustCard(input, r) {
  validate3(input);
  const checks = new CheckList();
  const ordered = lawEntriesInDateOrder(input.entries);
  checks.equal("line-count", "Entries typed = lines on the card (count)", input.entries.length, r.lines.length);
  const placed = r.lines.length === ordered.length && r.lines.every((l, i) => {
    const e = ordered[i];
    return l.line === i + 1 && l.row === e.row && l.date === e.date && l.received === e.received && l.disbursed === e.disbursed;
  });
  checks.that("each-once", "Every entry is on the card once, with its own date and amount, in date order", placed);
  let balance = BigInt(input.opening);
  let lowest = balance;
  let readds = r.lines.length === ordered.length;
  const expectBelow = balance < 0n ? [`0||${balance}`] : [];
  ordered.forEach((e, i) => {
    balance += BigInt(e.received) - BigInt(e.disbursed);
    if (balance < lowest) lowest = balance;
    if (balance < 0n) expectBelow.push(`${i + 1}|${e.date}|${balance}`);
    const shown = r.lines[i];
    if (!shown || BigInt(shown.balance) !== balance) readds = false;
  });
  checks.that("running-readd", "Every balance on the card re-adds from the opening balance (second pass)", readds);
  const receipts = lawBigSum(input.entries.map((e) => e.received));
  const disbursements = lawBigSum(input.entries.map((e) => e.disbursed));
  checks.cents("receipts-total", "Amounts received add up to the receipts total", Number(receipts), r.receiptsTotal);
  checks.cents("disbursements-total", "Amounts disbursed add up to the disbursements total", Number(disbursements), r.disbursementsTotal);
  checks.cents("closing", "Opening balance + receipts − disbursements = closing balance", Number(BigInt(input.opening) + receipts - disbursements), r.closing);
  checks.that("closing-last", "The closing balance is the balance after the last line", BigInt(r.closing) === balance, `the last line carries ${formatUSD(Number(balance))}`);
  checks.cents("lowest", "The lowest balance shown matches the second pass", Number(lowest), r.lowest);
  const shownBelow = r.belowZero.map((d) => `${d.line}|${d.date}|${d.balance}`);
  checks.that("below-zero-listed", "The list of lines below zero matches a second walk of the card", expectBelow.length === shownBelow.length && expectBelow.every((x, i) => x === shownBelow[i]), `second walk found ${expectBelow.length}, the list shows ${shownBelow.length}`);
  const first = expectBelow[0]?.split("|");
  checks.that(
    "never-below-zero",
    "The balance never goes below zero",
    expectBelow.length === 0,
    first ? `${expectBelow.length} point(s) below zero; first: ${first[0] === "0" ? "the opening balance" : `line ${first[0]} on ${first[1]}`} at ${formatUSD(Number(first[2]))}` : void 0
  );
  checks.that("named", "The card names a client or matter", input.client.trim() !== "", "no client or matter name was typed", "warning");
  checks.that("has-entries", "At least one entry was typed", input.entries.length > 0, "the card has an opening balance and no lines", "warning");
  return checks.all;
}
function trustCardTables(input, r) {
  const amount = (cents) => cents === 0 ? "" : toDecimal(cents);
  return {
    card: [
      ["Line", "Date", "Reference", "Description", "Receipts", "Disbursements", "Balance"],
      ["", "", "", "Opening balance", "", "", toDecimal(input.opening)],
      ...r.lines.map((l) => [l.line, l.date, l.reference, l.description, amount(l.received), amount(l.disbursed), toDecimal(l.balance)]),
      ["", "", "", "Totals and closing balance", toDecimal(r.receiptsTotal), toDecimal(r.disbursementsTotal), toDecimal(r.closing)]
    ],
    summary: [
      ["Item", "Amount"],
      ["Opening balance", toDecimal(input.opening)],
      ["Plus receipts", toDecimal(r.receiptsTotal)],
      ["Less disbursements", toDecimal(-r.disbursementsTotal)],
      ["Closing balance", toDecimal(r.closing)],
      ["Lowest balance on the card", toDecimal(r.lowest)]
    ],
    belowZero: [["Line", "Date", "Balance"], ...r.belowZero.map((d) => [d.line === 0 ? "Opening balance" : d.line, d.date, toDecimal(d.balance)])]
  };
}

// packages/core/src/law/cashJournal.ts
function lawCheckNumber(reference) {
  const m = /^(?:(?:check|chk|ck|no)\.?\s*)*#?\s*(\d{1,6})$/i.exec(reference.trim());
  return m ? Number(m[1]) : null;
}
function validate4(input) {
  assertCents(input.opening, "opening balance");
  lawAssertEntries(input.entries);
}
function buildTrustCashJournal(input) {
  validate4(input);
  let running = input.opening;
  const lines = lawEntriesInDateOrder(input.entries).map((e, i) => {
    running = assertCents(running + e.received - e.disbursed, "journal balance");
    return { ...e, line: i + 1, balance: running };
  });
  const byClient = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const key = lawClientKey(l.client);
    let group = byClient.get(key);
    if (!group) {
      group = { client: key === "" ? "" : lawClientLabel(l.client), entries: 0, receipts: 0, disbursements: 0, net: 0 };
      byClient.set(key, group);
    }
    group.entries += 1;
    group.receipts = assertCents(group.receipts + l.received, "client receipts");
    group.disbursements = assertCents(group.disbursements + l.disbursed, "client disbursements");
    group.net = group.receipts - group.disbursements;
  }
  const carried = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const number = l.disbursed > 0 ? lawCheckNumber(l.reference) : null;
    if (number === null) continue;
    carried.set(number, [...carried.get(number) ?? [], l.line]);
  }
  const numbers = [...carried.keys()].sort((a, b) => a - b);
  const missingChecks = [];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] > 1) missingChecks.push({ from: numbers[i - 1] + 1, to: numbers[i] - 1 });
  }
  const figures = {
    lines,
    receiptsTotal: sum(input.entries.map((e) => e.received)),
    disbursementsTotal: sum(input.entries.map((e) => e.disbursed)),
    closing: running,
    clients: [...byClient.values()],
    checkNumbersUsed: [...carried.values()].reduce((n, at) => n + at.length, 0),
    repeatedChecks: numbers.filter((n) => carried.get(n).length > 1).map((n) => ({ number: n, lines: carried.get(n) })),
    missingChecks,
    belowZero: lines.filter((l) => l.balance < 0).map((l) => ({ line: l.line, date: l.date, balance: l.balance }))
  };
  return { ...figures, checks: verifyTrustCashJournal(input, figures) };
}
function verifyTrustCashJournal(input, r) {
  validate4(input);
  const checks = new CheckList();
  const ordered = lawEntriesInDateOrder(input.entries);
  checks.equal("line-count", "Entries in = journal lines out (count)", input.entries.length, r.lines.length);
  const placed = r.lines.length === ordered.length && r.lines.every((l, i) => {
    const e = ordered[i];
    return l.line === i + 1 && l.row === e.row && l.date === e.date && l.received === e.received && l.disbursed === e.disbursed && lawClientKey(l.client) === lawClientKey(e.client);
  });
  checks.that("each-once", "Every entry is in the journal once, with its own date, amount, and client, in date order", placed);
  let balance = BigInt(input.opening);
  let readds = r.lines.length === ordered.length;
  const expectBelow = [];
  ordered.forEach((e, i) => {
    balance += BigInt(e.received) - BigInt(e.disbursed);
    if (balance < 0n) expectBelow.push(`${i + 1}|${e.date}|${balance}`);
    const shown = r.lines[i];
    if (!shown || BigInt(shown.balance) !== balance) readds = false;
  });
  checks.that("running-readd", "Every journal balance re-adds from the opening balance (second pass)", readds);
  const receipts = lawBigSum(input.entries.map((e) => e.received));
  const disbursements = lawBigSum(input.entries.map((e) => e.disbursed));
  checks.cents("receipts-total", "Amounts received add up to the receipts total", Number(receipts), r.receiptsTotal);
  checks.cents("disbursements-total", "Amounts disbursed add up to the disbursements total", Number(disbursements), r.disbursementsTotal);
  checks.cents("closing", "Opening balance + receipts − disbursements = closing balance", Number(BigInt(input.opening) + receipts - disbursements), r.closing);
  checks.that("closing-last", "The closing balance is the balance after the last line", BigInt(r.closing) === balance, `the last line carries ${formatUSD(Number(balance))}`);
  const groups = /* @__PURE__ */ new Map();
  for (let i = input.entries.length - 1; i >= 0; i--) {
    const e = input.entries[i];
    const key = lawClientKey(e.client);
    const g = groups.get(key) ?? { entries: 0, receipts: 0n, disbursements: 0n };
    g.entries += 1;
    g.receipts += BigInt(e.received);
    g.disbursements += BigInt(e.disbursed);
    groups.set(key, g);
  }
  const shownKeys = r.clients.map((c) => lawClientKey(c.client));
  const groupsMatch = new Set(shownKeys).size === shownKeys.length && shownKeys.length === groups.size && r.clients.every((c) => {
    const g = groups.get(lawClientKey(c.client));
    return g !== void 0 && g.entries === c.entries && g.receipts === BigInt(c.receipts) && g.disbursements === BigInt(c.disbursements) && BigInt(c.net) === g.receipts - g.disbursements;
  });
  checks.that("clients-readd", "Every client subtotal matches a second grouping of the entries", groupsMatch);
  checks.cents("clients-receipts", "Client receipts subtotals add up to the journal receipts total", Number(receipts), Number(lawBigSum(r.clients.map((c) => c.receipts))));
  checks.cents("clients-disbursements", "Client disbursements subtotals add up to the journal disbursements total", Number(disbursements), Number(lawBigSum(r.clients.map((c) => c.disbursements))));
  checks.cents("clients-net", "Client net changes add up to closing balance − opening balance", Number(balance - BigInt(input.opening)), Number(lawBigSum(r.clients.map((c) => c.net))));
  const count2 = /* @__PURE__ */ new Map();
  ordered.forEach((e, i) => {
    const number = e.disbursed > 0 ? lawCheckNumber(e.reference) : null;
    if (number !== null) count2.set(number, [...count2.get(number) ?? [], i + 1]);
  });
  const used = [...count2.keys()];
  const low = used.reduce((m, n) => n < m ? n : m, Number.MAX_SAFE_INTEGER);
  const high = used.reduce((m, n) => n > m ? n : m, 0);
  const expectedMissing = used.length ? high - low + 1 - used.length : 0;
  const gapsOk = r.missingChecks.every((g) => Number.isSafeInteger(g.from) && Number.isSafeInteger(g.to) && g.from <= g.to && count2.has(g.from - 1) && count2.has(g.to + 1) && used.every((n) => n < g.from || n > g.to)) && r.missingChecks.reduce((n, g) => n + (g.to - g.from + 1), 0) === expectedMissing;
  const expectRepeats = used.filter((n) => count2.get(n).length > 1).sort((a, b) => a - b).map((n) => `${n}:${count2.get(n).join(",")}`);
  const repeatsOk = expectRepeats.length === r.repeatedChecks.length && r.repeatedChecks.every((c, i) => `${c.number}:${c.lines.join(",")}` === expectRepeats[i]);
  const usedCount = [...count2.values()].reduce((n, at) => n + at.length, 0);
  checks.that("checks-listed", "The check numbers used more than once and the numbers missing from the run match a second count", gapsOk && repeatsOk && r.checkNumbersUsed === usedCount, `second count: ${expectRepeats.length} repeated, ${expectedMissing} missing`);
  const shownBelow = r.belowZero.map((d) => `${d.line}|${d.date}|${d.balance}`);
  checks.that("below-zero-listed", "The list of lines below zero matches a second walk of the journal", expectBelow.length === shownBelow.length && expectBelow.every((x, i) => x === shownBelow[i]), `second walk found ${expectBelow.length}, the list shows ${shownBelow.length}`);
  checks.that("never-below-zero", "The journal balance never goes below zero", expectBelow.length === 0, `${expectBelow.length} line(s) listed`, "warning");
  const unassigned = input.entries.filter((e) => lawClientKey(e.client) === "").length;
  checks.that("all-assigned", "Every entry has a client or matter", unassigned === 0, `${unassigned} entr${unassigned === 1 ? "y has" : "ies have"} none`, "warning");
  checks.that("no-repeated-checks", "No check number is used more than once", expectRepeats.length === 0, `${expectRepeats.length} number(s) listed`, "warning");
  checks.that("no-missing-checks", "No check number is missing between the lowest and the highest used", expectedMissing === 0, `${expectedMissing} number(s) not in the journal`, "warning");
  checks.that("has-entries", "At least one entry was typed or imported", input.entries.length > 0, "the journal has an opening balance and no lines", "warning");
  return checks.all;
}
function trustCheckGapLabel(gap) {
  return gap.from === gap.to ? String(gap.from) : `${gap.from} to ${gap.to}`;
}
function trustCashTables(input, r) {
  const amount = (cents) => cents === 0 ? "" : toDecimal(cents);
  return {
    journal: [
      ["Line", "Date", "Reference", "Description", "Client or matter", "Receipts", "Disbursements", "Balance"],
      ["", "", "", "Opening balance", "", "", "", toDecimal(input.opening)],
      ...r.lines.map((l) => [l.line, l.date, l.reference, l.description, lawClientLabel(l.client), amount(l.received), amount(l.disbursed), toDecimal(l.balance)]),
      ["", "", "", "Totals and closing balance", "", toDecimal(r.receiptsTotal), toDecimal(r.disbursementsTotal), toDecimal(r.closing)]
    ],
    clients: [
      ["Client or matter", "Entries", "Receipts", "Disbursements", "Net change"],
      ...r.clients.map((c) => [lawClientLabel(c.client), c.entries, toDecimal(c.receipts), toDecimal(c.disbursements), toDecimal(c.net)]),
      ["Total", r.lines.length, toDecimal(sum(r.clients.map((c) => c.receipts))), toDecimal(sum(r.clients.map((c) => c.disbursements))), toDecimal(sum(r.clients.map((c) => c.net)))]
    ],
    summary: [
      ["Item", "Amount"],
      ["Opening balance", toDecimal(input.opening)],
      ["Plus receipts", toDecimal(r.receiptsTotal)],
      ["Less disbursements", toDecimal(-r.disbursementsTotal)],
      ["Closing balance", toDecimal(r.closing)]
    ],
    checkNumbers: [
      ["Finding", "Check number", "Journal lines"],
      ...r.repeatedChecks.map((c) => ["Used more than once", String(c.number), c.lines.join(", ")]),
      ...r.missingChecks.map((g) => ["Not in the journal", trustCheckGapLabel(g), ""])
    ],
    belowZero: [["Line", "Date", "Balance"], ...r.belowZero.map((d) => [d.line, d.date, toDecimal(d.balance)])]
  };
}

// packages/core/src/law/rebuild.ts
function validate5(input) {
  const { statement, clients } = input;
  assertCents(statement.openingBalance, "opening balance");
  assertCents(statement.closingBalance, "closing balance");
  if (clients.length !== statement.transactions.length) throw new Error(`There are ${statement.transactions.length} bank transactions but ${clients.length} client assignments.`);
  lawAssertBalances(input.openingBalances ?? [], "opening balance");
}
var asTxns = (input) => input.statement.transactions.map((t, i) => ({ rowNumber: i + 1, date: t.date, description: t.description, client: input.clients[i] ?? "", amount: t.amount }));
function rebuildTrustLedgers(input) {
  validate5(input);
  const opening = input.openingBalances ?? [];
  const txns = asTxns(input);
  const ledgers = lawBuildLedgers(txns, opening).filter((l) => lawClientKey(l.client) !== "");
  let running = input.statement.openingBalance;
  const journal = txns.map((t) => {
    running = assertCents(running + t.amount, "journal balance");
    return { line: t.rowNumber, date: t.date, description: t.description, client: lawClientKey(t.client) === "" ? "" : lawClientLabel(t.client), amount: t.amount, balance: running };
  });
  const figures = {
    ledgers,
    journal,
    unassigned: journal.filter((j) => j.client === ""),
    openingLedgerTotal: sum(opening.map((b) => b.balance)),
    ledgerTotal: sum(ledgers.map((l) => l.closing)),
    journalClosing: running,
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyTrustRebuild(input, figures) };
}
function verifyTrustRebuild(input, r) {
  validate5(input);
  const checks = new CheckList();
  const { statement } = input;
  const opening = input.openingBalances ?? [];
  for (const c of verifyBankStatement(statement)) checks.add({ ...c, id: `bank-${c.id}`, label: `Bank statement: ${c.label}` });
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the ledgers; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const seen = /* @__PURE__ */ new Map();
  let wrong = 0;
  for (const ledger of r.ledgers) {
    for (const e of ledger.entries) {
      seen.set(e.rowNumber, (seen.get(e.rowNumber) ?? 0) + 1);
      const t = statement.transactions[e.rowNumber - 1];
      if (!t || t.amount !== e.amount || t.date !== e.date || lawClientKey(input.clients[e.rowNumber - 1] ?? "") !== lawClientKey(ledger.client) || lawClientKey(ledger.client) === "") wrong++;
    }
  }
  const missing = statement.transactions.filter((_, i) => !seen.has(i + 1)).length;
  const repeated = [...seen.values()].filter((n) => n > 1).length;
  checks.that("each-once", "Every bank transaction appears in exactly one client ledger", missing === 0 && repeated === 0 && wrong === 0, `${missing} not in any ledger, ${repeated} in more than one, ${wrong} altered or under the wrong client`);
  const unassigned = input.clients.filter((c) => lawClientKey(c) === "").length;
  checks.that("unassigned-listed", "The list of transactions with no client or matter is complete", r.unassigned.length === unassigned && r.unassigned.every((j) => lawClientKey(input.clients[j.line - 1] ?? "") === ""), `${unassigned} in the input, ${r.unassigned.length} listed`);
  const openingByKey = new Map(opening.map((b) => [lawClientKey(b.client), b.balance]));
  let ledgersOk = opening.every((b) => r.ledgers.some((l) => lawClientKey(l.client) === lawClientKey(b.client)));
  let total = 0n;
  for (const ledger of r.ledgers) {
    let bal2 = BigInt(openingByKey.get(lawClientKey(ledger.client)) ?? 0);
    if (BigInt(ledger.opening) !== bal2) ledgersOk = false;
    for (const e of ledger.entries) {
      bal2 += BigInt(e.amount);
      if (BigInt(e.balance) !== bal2) ledgersOk = false;
    }
    if (BigInt(ledger.closing) !== bal2) ledgersOk = false;
    total += bal2;
  }
  checks.that("ledgers-readd", "Every ledger re-adds: opening balance + its entries = each running balance and the closing balance (second pass)", ledgersOk);
  checks.cents("ledger-total", "The ledger total shown = the ledger closing balances added a second way", Number(total), r.ledgerTotal);
  const openingTotal = lawBigSum(opening.map((b) => b.balance));
  checks.cents("opening-ledgers", "Client opening balances add up to the bank opening balance", statement.openingBalance, Number(openingTotal));
  checks.that("opening-shown", "The opening ledger total shown matches the second pass", BigInt(r.openingLedgerTotal) === openingTotal);
  checks.cents("ledgers-closing", "Sum of client ledgers = bank closing balance", statement.closingBalance, Number(total));
  let bal = BigInt(statement.openingBalance);
  let journalOk = r.journal.length === statement.transactions.length;
  statement.transactions.forEach((t, i) => {
    bal += BigInt(t.amount);
    const j = r.journal[i];
    if (!j || j.line !== i + 1 || j.amount !== t.amount || j.date !== t.date || BigInt(j.balance) !== bal || lawClientKey(j.client) !== lawClientKey(input.clients[i] ?? "")) journalOk = false;
  });
  checks.that("journal-readd", "The trust journal lists every bank transaction once and its running balance re-adds", journalOk && BigInt(r.journalClosing) === bal);
  checks.cents("journal-closing", "Trust journal closing balance = bank closing balance", statement.closingBalance, Number(bal));
  const negative = r.ledgers.filter((l) => l.closing < 0);
  checks.that("no-negative", "No client ledger closes below zero", negative.length === 0, `${negative.length} ledger(s) close below zero; first: ${negative[0]?.client} at ${formatUSD(negative[0]?.closing ?? 0)}`, "warning");
  return checks.all;
}
function trustRebuildTables(input, r) {
  return {
    summary: [
      ["Client or matter", "Opening balance", "Transactions", "Net change", "Closing balance"],
      ...r.ledgers.map((l) => [l.client, toDecimal(l.opening), l.entries.length, toDecimal(l.closing - l.opening), toDecimal(l.closing)]),
      ["Sum of client ledgers", toDecimal(r.openingLedgerTotal), r.ledgers.reduce((n, l) => n + l.entries.length, 0), toDecimal(r.ledgerTotal - r.openingLedgerTotal), toDecimal(r.ledgerTotal)],
      ["Bank statement", toDecimal(input.statement.openingBalance), input.statement.transactions.length, toDecimal(input.statement.closingBalance - input.statement.openingBalance), toDecimal(input.statement.closingBalance)]
    ],
    journal: [
      ["Line", "Date", "Description", "Client or matter", "Amount", "Balance"],
      ["", "", "Opening balance", "", "", toDecimal(input.statement.openingBalance)],
      ...r.journal.map((j) => [j.line, j.date, j.description, j.client || "(no client or matter)", toDecimal(j.amount), toDecimal(j.balance)])
    ],
    ledgers: [
      ["Client or matter", "Date", "Description", "Amount", "Balance"],
      ...r.ledgers.flatMap((l) => [[l.client, "", "Opening balance", "", toDecimal(l.opening)], ...l.entries.map((e) => [l.client, e.date, e.description, toDecimal(e.amount), toDecimal(e.balance)])])
    ]
  };
}

// packages/core/src/law/scanner.ts
function validate6(input) {
  lawAssertTransactions(input.transactions);
  lawAssertBalances(input.openingBalances ?? [], "opening balance");
  if (input.firmCeiling !== void 0) {
    assertCents(input.firmCeiling, "firm funds ceiling");
    if (input.firmCeiling < 0) throw new Error("The firm funds ceiling cannot be below zero.");
    if (!input.firmLedger || lawClientKey(input.firmLedger) === "") throw new Error("Name the firm funds ledger the ceiling applies to.");
  }
}
function endOfDay(ledger) {
  const out = [{ date: "", balance: ledger.opening }];
  for (const e of ledger.entries) {
    const last = out[out.length - 1];
    if (last.date === e.date) last.balance = e.balance;
    else out.push({ date: e.date, balance: e.balance });
  }
  return out;
}
function scanTrustLedgers(input) {
  validate6(input);
  const opening = input.openingBalances ?? [];
  const ledgers = lawBuildLedgers(input.transactions, opening);
  const firmKey = input.firmLedger ? lawClientKey(input.firmLedger) : "";
  const negatives = [];
  const overCeiling = [];
  for (const ledger of ledgers) {
    const key = lawClientKey(ledger.client);
    if (key === "") continue;
    for (const d of endOfDay(ledger)) {
      if (d.balance < 0) negatives.push({ client: ledger.client, date: d.date, balance: d.balance });
      if (input.firmCeiling !== void 0 && key === firmKey && d.balance > input.firmCeiling) overCeiling.push({ date: d.date, balance: d.balance, over: d.balance - input.firmCeiling });
    }
  }
  negatives.sort((a, b) => a.date === b.date ? 0 : a.date < b.date ? -1 : 1);
  const openingTotal = sum(opening.map((b) => b.balance));
  const days = [];
  let running = openingTotal;
  for (const t of lawSortByDate(input.transactions)) {
    running = assertCents(running + t.amount, "account balance");
    const last = days[days.length - 1];
    if (last && last.date === t.date) {
      last.movement += t.amount;
      last.accountBalance = running;
    } else days.push({ date: t.date, movement: t.amount, accountBalance: running });
  }
  const figures = {
    ledgers,
    unassigned: lawSortByDate(input.transactions.filter((t) => lawClientKey(t.client) === "")),
    negatives,
    overCeiling,
    days,
    openingTotal,
    closingTotal: running,
    transactionCount: input.transactions.length,
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyTrustScan(input, figures) };
}
function verifyTrustScan(input, r) {
  validate6(input);
  const checks = new CheckList();
  const opening = input.openingBalances ?? [];
  const sorted = lawSortByDate(input.transactions);
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the scan; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const byRow = new Map(input.transactions.map((t) => [t.rowNumber, t]));
  const placed = [];
  let misplaced = 0;
  for (const ledger of r.ledgers) {
    for (const e of ledger.entries) {
      placed.push(e.rowNumber);
      const t = byRow.get(e.rowNumber);
      if (!t || t.amount !== e.amount || t.date !== e.date || lawClientKey(t.client) !== lawClientKey(ledger.client)) misplaced++;
    }
  }
  checks.equal("count", "Transactions in = ledger entries out (count)", input.transactions.length, placed.length);
  checks.that("each-once", "Every transaction is in exactly one ledger, under its own client or matter", new Set(placed).size === placed.length && placed.length === input.transactions.length && misplaced === 0, `${placed.length - new Set(placed).size} repeated, ${misplaced} misplaced or altered`);
  checks.that("count-shown", "The transaction count shown matches the input", r.transactionCount === input.transactions.length);
  let ledgerMathOk = true;
  for (const ledger of r.ledgers) {
    let bal = BigInt(ledger.opening);
    for (const e of ledger.entries) {
      bal += BigInt(e.amount);
      if (BigInt(e.balance) !== bal) ledgerMathOk = false;
    }
    if (BigInt(ledger.closing) !== bal) ledgerMathOk = false;
  }
  const openingByKey = new Map(opening.map((b) => [lawClientKey(b.client), b.balance]));
  const openingsOk = r.ledgers.every((l) => l.opening === (openingByKey.get(lawClientKey(l.client)) ?? 0)) && opening.every((b) => r.ledgers.some((l) => lawClientKey(l.client) === lawClientKey(b.client)));
  checks.that("ledgers-readd", "Every ledger re-adds: opening balance + its entries = each running balance and the closing balance", ledgerMathOk && openingsOk);
  const dates = [...new Set(sorted.map((t) => t.date))];
  const openingTotal = lawBigSum(opening.map((b) => b.balance));
  let account = openingTotal;
  let badDates = 0;
  let firstBad = "";
  let pointer = 0;
  const shown = new Map(r.days.map((d) => [d.date, d]));
  for (const date of dates) {
    let movement = 0n;
    while (pointer < sorted.length && sorted[pointer].date === date) movement += BigInt(sorted[pointer++].amount);
    account += movement;
    let ledgerTotal = 0n;
    for (const ledger of r.ledgers) {
      let bal = ledger.opening;
      for (const e of ledger.entries) {
        if (e.date > date) break;
        bal = e.balance;
      }
      ledgerTotal += BigInt(bal);
    }
    const day = shown.get(date);
    if (ledgerTotal !== account || !day || BigInt(day.accountBalance) !== account || BigInt(day.movement) !== movement) {
      badDates++;
      if (!firstBad) firstBad = `${date}: ledgers ${formatUSD(Number(ledgerTotal))}, account ${formatUSD(Number(account))}`;
    }
  }
  checks.that("daily-readd", "At every date, the client ledger balances add up to the account balance (second pass)", badDates === 0 && r.days.length === dates.length, `${badDates} date(s) off; first: ${firstBad}`);
  checks.cents("opening-total", "Opening balances add up to the opening total shown", Number(openingTotal), r.openingTotal);
  checks.cents("closing-total", "Opening total + all transactions = closing total = sum of ledger closing balances", Number(account), r.closingTotal);
  checks.cents("closing-ledgers", "Ledger closing balances add up to the closing total", Number(lawBigSum(r.ledgers.map((l) => l.closing))), r.closingTotal);
  const firmKey = input.firmLedger ? lawClientKey(input.firmLedger) : "";
  const balance = /* @__PURE__ */ new Map();
  const expectNeg = [];
  const expectOver = [];
  const note = (key, date) => {
    const bal = balance.get(key);
    if (bal < 0n) expectNeg.push(`${key}|${date}|${bal}`);
    if (input.firmCeiling !== void 0 && key === firmKey && bal > BigInt(input.firmCeiling)) expectOver.push(`${date}|${bal}`);
  };
  for (const b of opening) {
    balance.set(lawClientKey(b.client), BigInt(b.balance));
    note(lawClientKey(b.client), "");
  }
  for (let i = 0; i < sorted.length; ) {
    const date = sorted[i].date;
    const touched = /* @__PURE__ */ new Set();
    for (; i < sorted.length && sorted[i].date === date; i++) {
      const key = lawClientKey(sorted[i].client);
      if (!balance.has(key)) {
        balance.set(key, 0n);
      }
      balance.set(key, balance.get(key) + BigInt(sorted[i].amount));
      touched.add(key);
    }
    for (const key of touched) if (key !== "") note(key, date);
  }
  const same = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  checks.that("negatives-listed", "The list of dates below zero matches a second walk of every client balance", same(expectNeg, r.negatives.map((n) => `${lawClientKey(n.client)}|${n.date}|${n.balance}`)), `second walk found ${expectNeg.length}, the list shows ${r.negatives.length}`);
  checks.that("ceiling-listed", "The list of dates above the firm funds ceiling matches a second walk", same(expectOver, r.overCeiling.map((o) => `${o.date}|${o.balance}`)) && r.overCeiling.every((o) => input.firmCeiling !== void 0 && o.over === o.balance - input.firmCeiling), `second walk found ${expectOver.length}, the list shows ${r.overCeiling.length}`);
  const unassigned = input.transactions.filter((t) => lawClientKey(t.client) === "").map((t) => t.rowNumber);
  checks.that("unassigned-listed", "The list of transactions with no client or matter is complete", same(unassigned.map(String), r.unassigned.map((t) => String(t.rowNumber))), `${unassigned.length} in the input, ${r.unassigned.length} listed`);
  checks.that("no-negative", "No client ledger ends a day below zero", expectNeg.length === 0, `${expectNeg.length} date(s) listed`, "warning");
  checks.that("all-assigned", "Every transaction has a client or matter", unassigned.length === 0, `${unassigned.length} transaction(s) have none`, "warning");
  if (input.firmCeiling !== void 0) {
    checks.that("firm-ledger-found", "The firm funds ledger named was found in the file", balance.has(firmKey), `no transactions or opening balance for "${input.firmLedger}"`, "warning");
    checks.that("under-ceiling", `The firm funds ledger stays at or under the ceiling typed (${formatUSD(input.firmCeiling)})`, expectOver.length === 0, `${expectOver.length} date(s) listed`, "warning");
  }
  return checks.all;
}
function trustLedgerRows(ledger) {
  return [
    ["Date", "Reference", "Description", "Amount", "Balance"],
    ["", "", "Opening balance", "", toDecimal(ledger.opening)],
    ...ledger.entries.map((e) => [e.date, e.reference, e.description, toDecimal(e.amount), toDecimal(e.balance)])
  ];
}
function trustScanTables(r) {
  return {
    summary: [
      ["Client or matter", "Opening balance", "Transactions", "Net change", "Closing balance", "Lowest end-of-day balance"],
      ...r.ledgers.map((l) => [lawClientLabel(l.client), toDecimal(l.opening), l.entries.length, toDecimal(l.closing - l.opening), toDecimal(l.closing), toDecimal(Math.min(...endOfDay(l).map((d) => d.balance)))]),
      ["Total", toDecimal(r.openingTotal), r.transactionCount, toDecimal(r.closingTotal - r.openingTotal), toDecimal(r.closingTotal), ""]
    ],
    negatives: [["Client or matter", "Date", "End-of-day balance"], ...r.negatives.map((n) => [n.client, n.date || "Opening balance", toDecimal(n.balance)])],
    unassigned: [["Row", "Date", "Reference", "Description", "Amount"], ...r.unassigned.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, toDecimal(t.amount)])],
    overCeiling: [["Date", "End-of-day balance", "Over the ceiling by"], ...r.overCeiling.map((o) => [o.date || "Opening balance", toDecimal(o.balance), toDecimal(o.over)])],
    days: [["Date", "Net movement", "Account balance"], ...r.days.map((d) => [d.date, toDecimal(d.movement), toDecimal(d.accountBalance)])],
    ledgers: [
      ["Client or matter", "Date", "Reference", "Description", "Amount", "Balance"],
      ...r.ledgers.flatMap((l) => trustLedgerRows(l).slice(1).map((row) => [lawClientLabel(l.client), ...row]))
    ]
  };
}

// packages/core/src/law/sheets.ts
var BANK = { crIsNegative: false };
function matchHeaders(header, order, synonyms) {
  const names = header.map(pmNormalizeHeader);
  const found = Object.fromEntries(order.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  for (const exact of [true, false]) {
    for (const role of order) {
      if (found[role] >= 0) continue;
      search: for (const syn of synonyms[role]) {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (taken.has(i) || name === "") continue;
          if (exact ? name === syn : ` ${name} `.includes(` ${syn} `)) {
            found[role] = i;
            taken.add(i);
            break search;
          }
        }
      }
    }
  }
  return found;
}
function guess(rows, order, synonyms, atHeaderRow) {
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], order, synonyms) };
  const firstFilled = Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
  let best = { headerRow: firstFilled, columns: matchHeaders(rows[firstFilled] ?? [], order, synonyms) };
  let bestScore = Object.values(best.columns).filter((c) => c >= 0).length;
  rows.slice(0, 25).forEach((row, i) => {
    const columns = matchHeaders(row, order, synonyms);
    const score = Object.values(columns).filter((c) => c >= 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: i, columns };
    }
  });
  return best;
}
function headerList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}
function need(col, label, rows, headerRow) {
  if (col === void 0 || !Number.isSafeInteger(col) || col < 0) {
    throw new Error(`No "${label}" column could be identified (${headerList(rows, headerRow)}). Choose it in the column mapping.`);
  }
  return col;
}
function assertDistinct(columns) {
  const used = Object.values(columns).filter((c) => c >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
}
var cellAt2 = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
var LAW_TXN_ROLES = ["date", "description", "client", "amount", "moneyIn", "moneyOut", "balance", "reference"];
var LAW_TXN_LABELS = {
  date: "Date",
  description: "Description or payee",
  client: "Client or matter",
  amount: "Amount (money in positive, money out negative)",
  moneyIn: "Money in (deposits)",
  moneyOut: "Money out (checks and withdrawals)",
  balance: "Running balance",
  reference: "Check number or reference"
};
var TXN_SYNONYMS = {
  date: ["date", "transaction date", "posting date", "posted date", "post date", "trans date"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "case", "file"],
  reference: ["check number", "check no", "check num", "check", "reference", "ref", "reference number", "number"],
  balance: ["running balance", "balance"],
  moneyIn: ["money in", "deposit", "deposits", "credit", "credits", "receipt", "receipts", "deposit amount"],
  moneyOut: ["money out", "withdrawal", "withdrawals", "debit", "debits", "disbursement", "disbursements", "payment", "payments", "check amount", "withdrawal amount"],
  amount: ["amount", "transaction amount", "net amount"],
  description: ["description", "transaction description", "memo", "payee", "details", "payor", "narrative", "name"]
};
var TXN_ORDER = ["date", "client", "balance", "moneyIn", "moneyOut", "amount", "reference", "description"];
function lawGuessTxnColumns(rows, atHeaderRow) {
  return guess(rows, TXN_ORDER, TXN_SYNONYMS, atHeaderRow);
}
function lawExtractTransactions(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const c = mapping.columns;
  const dateCol = need(c.date, LAW_TXN_LABELS.date, rows, mapping.headerRow);
  const split = c.moneyIn >= 0 || c.moneyOut >= 0;
  if (!split) need(c.amount, "Amount", rows, mapping.headerRow);
  if (split && c.amount >= 0) throw new Error("Choose either one amount column or the money-in and money-out columns, not both.");
  assertDistinct(c);
  const transactions = [];
  const problems = [];
  let ignoredRows = 0;
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = cellAt2(row, dateCol);
    const raws = split ? [cellAt2(row, c.moneyIn), cellAt2(row, c.moneyOut)] : [cellAt2(row, c.amount)];
    if (!rawDate && raws.every((r) => r === "")) {
      ignoredRows++;
      return;
    }
    const reasons = [];
    let date = "";
    if (!rawDate) reasons.push("no date");
    else {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    let amount = 0;
    if (raws.every((r) => r === "")) reasons.push("no amount");
    raws.forEach((raw, i) => {
      if (raw === "") return;
      try {
        const cents = pmCellToCents(raw, BANK);
        amount += split && i === 1 ? -Math.abs(cents) : cents;
      } catch {
        reasons.push(`the amount "${raw}" could not be read`);
      }
    });
    let balance;
    const rawBalance = cellAt2(row, c.balance);
    if (rawBalance) {
      try {
        balance = pmCellToCents(rawBalance, BANK);
      } catch {
        reasons.push(`the balance "${rawBalance}" could not be read`);
      }
    }
    if (reasons.length) {
      problems.push({ rowNumber, reason: reasons.join("; ") });
      return;
    }
    const txn = { rowNumber, date, description: cellAt2(row, c.description), client: cellAt2(row, c.client), amount, reference: cellAt2(row, c.reference) };
    if (balance !== void 0) txn.balance = balance;
    transactions.push(txn);
  });
  if (transactions.length === 0 && problems.length === 0) throw new Error("No transactions were found under the header row. Check the header row and the column mapping.");
  return { transactions, problems, ignoredRows };
}
var LAW_BALANCE_ROLES = ["client", "balance"];
var LAW_BALANCE_LABELS = { client: "Client or matter", balance: "Ledger balance" };
var BALANCE_SYNONYMS = {
  balance: ["balance", "ledger balance", "ending balance", "trust balance", "client balance", "amount"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "name", "case", "file"]
};
function lawGuessBalanceColumns(rows, atHeaderRow) {
  return guess(rows, ["balance", "client"], BALANCE_SYNONYMS, atHeaderRow);
}
var TOTAL_WORD = /^(grand |sub ?)?totals?( balance)?:?$/i;
function lawExtractClientBalances(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const clientCol = need(mapping.columns.client, LAW_BALANCE_LABELS.client, rows, mapping.headerRow);
  const balanceCol = need(mapping.columns.balance, LAW_BALANCE_LABELS.balance, rows, mapping.headerRow);
  assertDistinct(mapping.columns);
  const balances = [];
  const problems = [];
  const totalRows = [];
  const seen = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const client = cellAt2(row, clientCol).replace(/\s+/g, " ");
    const raw = cellAt2(row, balanceCol);
    if (TOTAL_WORD.test(client)) {
      totalRows.push(rowNumber);
      return;
    }
    if (!client) return void problems.push({ rowNumber, reason: "no client or matter name" });
    if (!raw) return void problems.push({ rowNumber, reason: "no balance" });
    let balance;
    try {
      balance = pmCellToCents(raw, BANK);
    } catch {
      return void problems.push({ rowNumber, reason: `the balance "${raw}" could not be read` });
    }
    const key = client.toLowerCase();
    if (seen.has(key)) return void problems.push({ rowNumber, reason: `"${client}" is already listed on an earlier row` });
    seen.add(key);
    balances.push({ client, balance });
  });
  if (balances.length === 0 && problems.length === 0) throw new Error("No client balances were found under the header row. Check the header row and the column mapping.");
  return { balances, problems, totalRows };
}
var LAW_ITEM_ROLES = ["date", "reference", "amount"];
var LAW_ITEM_LABELS = { date: "Date", reference: "Check number, payee, or note", amount: "Amount" };
var ITEM_SYNONYMS = {
  date: ["date", "check date", "deposit date", "transaction date"],
  amount: ["amount", "check amount", "deposit amount", "outstanding amount"],
  reference: ["check number", "check no", "check num", "check", "reference", "ref", "number", "payee", "description", "memo", "client", "name"]
};
function lawGuessItemColumns(rows, atHeaderRow) {
  return guess(rows, ["date", "amount", "reference"], ITEM_SYNONYMS, atHeaderRow);
}
function lawExtractOutstandingItems(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const amountCol = need(mapping.columns.amount, LAW_ITEM_LABELS.amount, rows, mapping.headerRow);
  assertDistinct(mapping.columns);
  const items = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const reference = cellAt2(row, mapping.columns.reference);
    const rawDate = cellAt2(row, mapping.columns.date);
    const raw = cellAt2(row, amountCol);
    if (row.some((x) => TOTAL_WORD.test(x.trim())) && !rawDate) {
      totalRows.push(rowNumber);
      return;
    }
    if (!raw) return void problems.push({ rowNumber, reason: "no amount" });
    let amount;
    let date = "";
    try {
      amount = Math.abs(pmCellToCents(raw));
    } catch {
      return void problems.push({ rowNumber, reason: `the amount "${raw}" could not be read` });
    }
    if (amount === 0) return void problems.push({ rowNumber, reason: "the amount is zero" });
    if (rawDate) {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        return void problems.push({ rowNumber, reason: `the date "${rawDate}" could not be read` });
      }
    }
    items.push({ date, reference, amount });
  });
  if (items.length === 0 && problems.length === 0) throw new Error("No items were found under the header row. Check the header row and the column mapping.");
  return { items, problems, totalRows };
}

// packages/core/src/law/threeWay.ts
function validate7(input) {
  assertCents(input.bankEndingBalance, "bank ending balance");
  assertCents(input.journalBalance, "trust journal balance");
  if (input.asOf !== void 0 && input.asOf !== "" && !isIsoDate(input.asOf)) throw new Error(`"${input.asOf}" is not a valid date.`);
  for (const [list, what] of [[input.outstandingChecks, "outstanding check"], [input.depositsInTransit, "deposit in transit"]]) {
    list.forEach((item, i) => {
      assertCents(item.amount, `${what} ${i + 1}`);
      if (item.amount <= 0) throw new Error(`Every ${what} needs an amount above zero (item ${i + 1} is ${formatUSD(item.amount)}).`);
      if (item.date !== "" && !isIsoDate(item.date)) throw new Error(`The date "${item.date}" on ${what} ${i + 1} is not valid.`);
    });
  }
  lawAssertBalances(input.clientLedgers, "client ledger balance");
  const c = input.continuity;
  if (c) {
    assertCents(c.priorBalance, "prior balance");
    assertCents(c.receipts, "receipts");
    assertCents(c.disbursements, "disbursements");
    if (c.receipts < 0 || c.disbursements < 0) throw new Error("Receipts and disbursements are entered as positive amounts.");
  }
}
function verifyThreeWay(input, r) {
  validate7(input);
  const checks = new CheckList();
  const outChecks = lawBigSum(input.outstandingChecks.map((i) => i.amount));
  const inTransit = lawBigSum(input.depositsInTransit.map((i) => i.amount));
  const adjusted = BigInt(input.bankEndingBalance) - outChecks + inTransit;
  const ledgers = lawBigSum(input.clientLedgers.map((l) => l.balance));
  const journal = BigInt(input.journalBalance);
  checks.cents("bank-journal", "Adjusted bank balance = trust journal balance", r.journalBalance, r.adjustedBankBalance);
  checks.cents("journal-ledgers", "Trust journal balance = sum of client ledger balances", r.clientLedgerTotal, r.journalBalance);
  checks.cents("bank-ledgers", "Adjusted bank balance = sum of client ledger balances", r.clientLedgerTotal, r.adjustedBankBalance);
  const recomputed = BigInt(r.adjustedBankBalance) === adjusted && BigInt(r.clientLedgerTotal) === ledgers && BigInt(r.journalBalance) === journal && BigInt(r.bankVsJournal) === adjusted - journal && BigInt(r.journalVsLedgers) === journal - ledgers && BigInt(r.bankVsLedgers) === adjusted - ledgers && r.agree === (adjusted === journal && journal === ledgers);
  checks.that("recompute", "The three figures and their differences match a second calculation", recomputed, `second pass: adjusted bank ${formatUSD(Number(adjusted))}, journal ${formatUSD(Number(journal))}, client ledgers ${formatUSD(Number(ledgers))}`);
  checks.that(
    "outstanding-readd",
    "Outstanding checks and deposits in transit re-add to the totals shown",
    BigInt(r.outstandingChecksTotal) === outChecks && BigInt(r.depositsInTransitTotal) === inTransit,
    `second pass: outstanding checks ${formatUSD(Number(outChecks))}, deposits in transit ${formatUSD(Number(inTransit))}`
  );
  const negative = input.clientLedgers.filter((l) => l.balance < 0);
  const listed = JSON.stringify(r.negativeLedgers.map((l) => [l.client, l.balance])) === JSON.stringify(negative.map((l) => [lawClientLabel(l.client), l.balance]));
  checks.that(
    "no-negative-ledger",
    "No client ledger balance is below zero",
    negative.length === 0 && listed,
    negative.length ? `${negative.length} ledger(s) below zero; first: ${lawClientLabel(negative[0].client)} at ${formatUSD(negative[0].balance)}` : "the list of ledgers below zero does not match the input"
  );
  if (input.continuity) {
    const c = input.continuity;
    const expected = BigInt(c.priorBalance) + BigInt(c.receipts) - BigInt(c.disbursements);
    checks.cents("continuity", "Prior period balance + receipts − disbursements = trust journal balance", Number(expected), r.journalBalance);
    checks.that("continuity-shown", "The roll-forward balance shown matches a second calculation", r.continuityBalance !== void 0 && BigInt(r.continuityBalance) === expected);
  }
  checks.that("ledgers-entered", "At least one client ledger balance was entered", input.clientLedgers.length > 0, "the sum of client ledgers is zero because none were entered", "warning");
  return checks.all;
}
function threeWayReconcile(input) {
  validate7(input);
  const outstandingChecksTotal = sum(input.outstandingChecks.map((i) => i.amount));
  const depositsInTransitTotal = sum(input.depositsInTransit.map((i) => i.amount));
  const adjustedBankBalance = assertCents(input.bankEndingBalance - outstandingChecksTotal + depositsInTransitTotal, "adjusted bank balance");
  const clientLedgerTotal = sum(input.clientLedgers.map((l) => l.balance));
  const journalBalance = input.journalBalance;
  const figures = {
    outstandingChecksTotal,
    depositsInTransitTotal,
    adjustedBankBalance,
    journalBalance,
    clientLedgerTotal,
    bankVsJournal: adjustedBankBalance - journalBalance,
    journalVsLedgers: journalBalance - clientLedgerTotal,
    bankVsLedgers: adjustedBankBalance - clientLedgerTotal,
    negativeLedgers: input.clientLedgers.filter((l) => l.balance < 0).map((l) => ({ client: lawClientLabel(l.client), balance: l.balance })),
    agree: adjustedBankBalance === journalBalance && journalBalance === clientLedgerTotal
  };
  if (input.continuity) figures.continuityBalance = assertCents(input.continuity.priorBalance + input.continuity.receipts - input.continuity.disbursements, "roll-forward balance");
  return { ...figures, checks: verifyThreeWay(input, figures) };
}
function threeWayTables(input, r) {
  const items = (list, total) => [
    ["Date", "Reference", "Amount"],
    ...list.map((i) => [i.date, i.reference, toDecimal(i.amount)]),
    ["", "Total", toDecimal(total)]
  ];
  const summary = [
    ["Item", "Amount"],
    ["Bank statement ending balance", toDecimal(input.bankEndingBalance)],
    ["Less outstanding checks", toDecimal(-r.outstandingChecksTotal)],
    ["Plus deposits in transit", toDecimal(r.depositsInTransitTotal)],
    ["1. Adjusted bank balance", toDecimal(r.adjustedBankBalance)],
    ["2. Trust journal balance", toDecimal(r.journalBalance)],
    ["3. Sum of client ledger balances", toDecimal(r.clientLedgerTotal)],
    ["Difference: adjusted bank − trust journal", toDecimal(r.bankVsJournal)],
    ["Difference: trust journal − client ledgers", toDecimal(r.journalVsLedgers)],
    ["Difference: adjusted bank − client ledgers", toDecimal(r.bankVsLedgers)]
  ];
  if (input.continuity && r.continuityBalance !== void 0) {
    summary.push(
      ["Prior period balance", toDecimal(input.continuity.priorBalance)],
      ["Plus receipts", toDecimal(input.continuity.receipts)],
      ["Less disbursements", toDecimal(-input.continuity.disbursements)],
      ["Roll-forward balance", toDecimal(r.continuityBalance)]
    );
  }
  return {
    summary,
    outstandingChecks: items(input.outstandingChecks, r.outstandingChecksTotal),
    depositsInTransit: items(input.depositsInTransit, r.depositsInTransitTotal),
    clientLedgers: [["Client or matter", "Balance"], ...input.clientLedgers.map((l) => [lawClientLabel(l.client), toDecimal(l.balance)]), ["Total", toDecimal(r.clientLedgerTotal)]]
  };
}

// packages/core/src/law/workbook.ts
var THREE_WAY_SHEETS = ["Reconciliation", "Outstanding checks", "Deposits in transit", "Client ledgers", "Instructions"];
var THREE_WAY_CHECK_HEADERS = ["Line", "Date", "Check number", "Payee", "Amount"];
var THREE_WAY_DEPOSIT_HEADERS = ["Line", "Date", "Description", "Amount"];
var THREE_WAY_LEDGER_HEADERS = ["Line", "Client or matter", "Balance"];
var THREE_WAY_SUMMARY_LINES = [
  ["account", "Firm or account"],
  ["asOf", "As of date"],
  ["bank", "Bank statement ending balance"],
  ["checksTotal", "Less outstanding checks (total of the Outstanding checks sheet)"],
  ["depositsTotal", "Plus deposits in transit (total of the Deposits in transit sheet)"],
  ["adjusted", "1. Adjusted bank balance"],
  ["journal", "2. Trust journal balance"],
  ["ledgerTotal", "3. Sum of client ledger balances (total of the Client ledgers sheet)"],
  ["bankVsJournal", "Difference: adjusted bank − trust journal"],
  ["journalVsLedgers", "Difference: trust journal − client ledgers"],
  ["bankVsLedgers", "Difference: adjusted bank − client ledgers"],
  ["prior", "Prior period reconciled balance (optional)"],
  ["receipts", "Receipts this period (optional)"],
  ["disbursements", "Disbursements this period (optional)"]
];
var WRITTEN_LABELS = {
  checksTotal: "outstanding checks total",
  depositsTotal: "deposits in transit total",
  adjusted: "adjusted bank balance",
  ledgerTotal: "sum of client ledger balances",
  bankVsJournal: "difference between adjusted bank and trust journal",
  journalVsLedgers: "difference between trust journal and client ledgers",
  bankVsLedgers: "difference between adjusted bank and client ledgers"
};
var WRITTEN_KEYS = Object.keys(WRITTEN_LABELS);
var MAX_ROWS = 500;
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ROWS) throw new Error(`${label} must be a whole number from 1 to ${MAX_ROWS}.`);
  return value;
}
function threeWayTemplateClients(names) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name === "") continue;
    const key = lawClientKey(name);
    if (seen.has(key)) throw new Error(`"${name}" is listed twice in the client names.`);
    seen.add(key);
    out.push(name);
  }
  if (out.length > MAX_ROWS) throw new Error(`The client list has ${out.length} names; the workbook holds up to ${MAX_ROWS}.`);
  return out;
}
function threeWayTemplateRowCounts(o) {
  const clients = threeWayTemplateClients(o.clients);
  return {
    clientRows: Math.max(count(o.clientRows, "The number of client ledger rows"), clients.length),
    checkRows: count(o.checkRows, "The number of outstanding check rows"),
    depositRows: count(o.depositRows, "The number of deposit rows")
  };
}
function threeWayTemplateSheets(o) {
  if (o.asOf !== "" && !isIsoDate(o.asOf)) throw new Error("The as-of date is not a valid date.");
  const clients = threeWayTemplateClients(o.clients);
  const rows = threeWayTemplateRowCounts(o);
  const filled = { account: o.account.trim().replace(/\s+/g, " "), asOf: o.asOf };
  return [
    { name: THREE_WAY_SHEETS[0], rows: [["Item", "Value"], ...THREE_WAY_SUMMARY_LINES.map(([key, label]) => [label, filled[key] ?? ""])], money: [], widths: [66, 24] },
    { name: THREE_WAY_SHEETS[1], rows: [[...THREE_WAY_CHECK_HEADERS], ...Array.from({ length: rows.checkRows }, (_, i) => [i + 1, "", "", "", ""])], money: [], widths: [8, 14, 16, 36, 16] },
    { name: THREE_WAY_SHEETS[2], rows: [[...THREE_WAY_DEPOSIT_HEADERS], ...Array.from({ length: rows.depositRows }, (_, i) => [i + 1, "", "", ""])], money: [], widths: [8, 14, 40, 16] },
    { name: THREE_WAY_SHEETS[3], rows: [[...THREE_WAY_LEDGER_HEADERS], ...Array.from({ length: rows.clientRows }, (_, i) => [i + 1, clients[i] ?? "", ""])], money: [], widths: [8, 40, 18] },
    {
      name: THREE_WAY_SHEETS[4],
      rows: [
        ["How this workbook is laid out"],
        ["Reconciliation: the firm or account, the date the figures are as of, the bank statement ending balance, and the trust journal balance. The lines for totals and differences are there to be written in by hand."],
        ["Outstanding checks: one row per check written in the trust journal that is not on the bank statement yet. Amounts are positive numbers."],
        ["Deposits in transit: one row per deposit recorded in the trust journal that is not on the bank statement yet."],
        ["Client ledgers: one row per client or matter with the balance of its ledger on the as-of date."],
        ["Adjusted bank balance = bank statement ending balance − outstanding checks + deposits in transit."],
        ["The three figures put side by side are the adjusted bank balance, the trust journal balance, and the sum of the client ledger balances."],
        ["The three optional lines compare the prior period balance + receipts − disbursements with this period’s trust journal balance. Leave them blank to skip that comparison."],
        ["Amounts are plain numbers. This workbook holds values only and contains no formulas, so nothing in it calculates."],
        [`The three-way reconciliation report ${o.reportUrl ? `at ${o.reportUrl}` : "on the same site"} opens this workbook, compares the three figures to the cent, and shows the checks it ran.`],
        ["A numbered row with nothing typed in it is skipped. Add more rows under the last one on any list sheet."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
function verifyThreeWayTemplate(o, read) {
  const checks = new CheckList();
  const clients = threeWayTemplateClients(o.clients);
  const want = threeWayTemplateRowCounts(o);
  const cell = (sheet, row, col) => sheet?.rows[row]?.[col] ?? "";
  const [summary, outstanding, deposits, ledgers, instructions] = [read[0], read[1], read[2], read[3], read[4]];
  checks.equal("sheets", "The workbook has the five sheets, in order", THREE_WAY_SHEETS.join(", "), read.map((s) => s.name).join(", "));
  checks.equal("summary-lines", "The Reconciliation sheet has every line, in order", THREE_WAY_SUMMARY_LINES.map(([, label]) => label).join(" | "), (summary?.rows ?? []).slice(1).map((r) => r[0] ?? "").join(" | "));
  checks.equal("account", "The firm or account name reads back as typed", o.account.trim().replace(/\s+/g, " "), cell(summary, 1, 1));
  checks.equal("as-of", "The as-of date reads back as typed", o.asOf, cell(summary, 2, 1));
  const amountsBlank = (summary?.rows ?? []).slice(3).every((r) => (r[1] ?? "") === "");
  checks.that("summary-blank", "Every amount on the Reconciliation sheet is left blank to fill in", amountsBlank);
  const list = (id, title, sheet, headers, rows) => {
    checks.equal(`${id}-header`, `${title}: the header row reads back as written`, headers.join(" | "), (sheet?.rows[0] ?? []).slice(0, headers.length).join(" | "));
    checks.equal(`${id}-rows`, `${title}: the number of rows reads back as asked for`, rows, Math.max(0, (sheet?.rows.length ?? 0) - 1));
    const numbered = (sheet?.rows ?? []).slice(1).every((r, i) => r[0] === String(i + 1));
    checks.that(`${id}-numbered`, `${title}: the rows are numbered from 1`, numbered && (sheet?.rows.length ?? 0) > 1);
  };
  list("checks", THREE_WAY_SHEETS[1], outstanding, THREE_WAY_CHECK_HEADERS, want.checkRows);
  list("deposits", THREE_WAY_SHEETS[2], deposits, THREE_WAY_DEPOSIT_HEADERS, want.depositRows);
  list("ledgers", THREE_WAY_SHEETS[3], ledgers, THREE_WAY_LEDGER_HEADERS, want.clientRows);
  const namesBack = (ledgers?.rows ?? []).slice(1).map((r) => r[1] ?? "");
  const namesOk = namesBack.length === want.clientRows && namesBack.every((name, i) => name === (clients[i] ?? ""));
  checks.that("client-names", "The client names read back as typed, in order", namesOk, `asked for ${clients.length} name(s), read back ${namesBack.filter(Boolean).length}`);
  checks.that("instructions", "The Instructions sheet is there", (instructions?.rows.length ?? 0) >= 6);
  let formulas = 0;
  for (const s of read) for (const row of s.rows) for (const c of row) if (/^=/.test(c)) formulas++;
  checks.that("values-only", "The workbook holds values only, no formulas", formulas === 0, `${formulas} cell(s) start with an equals sign`);
  return checks.all;
}
function stem(label) {
  return pmNormalizeHeader(label.replace(/\([^)]*\)/g, " ")).replace(/^\d+ /, "");
}
function findSheet(sheets, name) {
  const want = pmNormalizeHeader(name);
  const found = sheets.filter((s) => pmNormalizeHeader(s.name) === want);
  if (found.length === 0) throw new Error(`This workbook has no sheet named "${name}". It needs these four: ${THREE_WAY_SHEETS.slice(0, 4).join(", ")}.`);
  if (found.length > 1) throw new Error(`This workbook has more than one sheet named "${name}".`);
  return found[0];
}
function listRows(sheet, headerRow) {
  const lineCol = (sheet.rows[headerRow] ?? []).findIndex((c) => pmNormalizeHeader(c) === "line");
  return sheet.rows.map((row, i) => {
    const cells = row.map((c) => String(c ?? ""));
    if (i <= headerRow || lineCol < 0) return cells;
    return cells.some((c, j) => j !== lineCol && c.trim() !== "") ? cells : cells.map(() => "");
  });
}
var hasBody = (rows, headerRow) => rows.some((row, i) => i > headerRow && row.some((c) => c.trim() !== ""));
function inSheet(sheet, headers, run) {
  try {
    return run();
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/ Choose it in the column mapping\.$/, "") : "it could not be read.";
    throw new Error(`Sheet "${sheet.name}": ${message} Its header row needs these columns: ${headers.filter((h) => h !== "Line").join(", ")}.`);
  }
}
function readThreeWayWorkbook(sheets) {
  const summary = findSheet(sheets, THREE_WAY_SHEETS[0]);
  const outstanding = findSheet(sheets, THREE_WAY_SHEETS[1]);
  const deposits = findSheet(sheets, THREE_WAY_SHEETS[2]);
  const ledgers = findSheet(sheets, THREE_WAY_SHEETS[3]);
  const byStem = new Map(THREE_WAY_SUMMARY_LINES.map(([key, label2]) => [stem(label2), key]));
  const raw = /* @__PURE__ */ new Map();
  summary.rows.forEach((row, i) => {
    const key = byStem.get(stem(String(row[0] ?? "")));
    if (!key) return;
    if (raw.has(key)) throw new Error(`The ${THREE_WAY_SHEETS[0]} sheet has two rows labelled "${String(row[0]).trim()}" (the second is row ${i + 1}).`);
    raw.set(key, String(row[1] ?? "").trim());
  });
  const label = (key) => THREE_WAY_SUMMARY_LINES.find(([k]) => k === key)[1].replace(/\s*\([^)]*\)/g, "").replace(/^\d+\.\s*/, "");
  const balances = /* @__PURE__ */ new Set(["bank", "journal", "prior", "adjusted", "ledgerTotal"]);
  const amount = (key) => {
    const text = raw.get(key) ?? "";
    if (text === "") return void 0;
    try {
      return pmCellToCents(text, { crIsNegative: !balances.has(key) });
    } catch {
      throw new Error(`"${label(key)}" on the ${THREE_WAY_SHEETS[0]} sheet is not an amount: "${text}".`);
    }
  };
  const bank = amount("bank");
  if (bank === void 0) throw new Error(`Type the bank statement ending balance on the ${THREE_WAY_SHEETS[0]} sheet.`);
  const journal = amount("journal");
  if (journal === void 0) throw new Error(`Type the trust journal balance on the ${THREE_WAY_SHEETS[0]} sheet.`);
  let asOf = "";
  const rawDate = raw.get("asOf") ?? "";
  if (rawDate !== "") {
    try {
      asOf = pmCellToIsoDate(rawDate);
    } catch {
      throw new Error(`The as-of date on the ${THREE_WAY_SHEETS[0]} sheet could not be read: "${rawDate}".`);
    }
  }
  const written = {};
  for (const key of WRITTEN_KEYS) {
    const value = amount(key);
    if (value !== void 0) written[key] = value;
  }
  const problems = [];
  let totalRows = 0;
  const items = (sheet, headers) => inSheet(sheet, headers, () => {
    const rows = listRows(sheet, lawGuessItemColumns(sheet.rows).headerRow);
    const mapping = lawGuessItemColumns(rows);
    if (!hasBody(rows, mapping.headerRow)) return [];
    const got = lawExtractOutstandingItems(rows, mapping);
    for (const p of got.problems) problems.push({ sheet: sheet.name, rowNumber: p.rowNumber, reason: p.reason });
    totalRows += got.totalRows.length;
    return got.items;
  });
  const outstandingChecks = items(outstanding, THREE_WAY_CHECK_HEADERS);
  const depositsInTransit = items(deposits, THREE_WAY_DEPOSIT_HEADERS);
  const clientLedgers = inSheet(ledgers, THREE_WAY_LEDGER_HEADERS, () => {
    const rows = listRows(ledgers, lawGuessBalanceColumns(ledgers.rows).headerRow);
    const mapping = lawGuessBalanceColumns(rows);
    if (!hasBody(rows, mapping.headerRow)) return [];
    const got = lawExtractClientBalances(rows, mapping);
    for (const p of got.problems) problems.push({ sheet: ledgers.name, rowNumber: p.rowNumber, reason: p.reason });
    totalRows += got.totalRows.length;
    return got.balances;
  });
  const input = { asOf, bankEndingBalance: bank, outstandingChecks, depositsInTransit, journalBalance: journal, clientLedgers };
  const prior = [amount("prior"), amount("receipts"), amount("disbursements")];
  if (prior.some((p) => p !== void 0)) input.continuity = { priorBalance: prior[0] ?? 0, receipts: prior[1] ?? 0, disbursements: prior[2] ?? 0 };
  return { account: raw.get("account") ?? "", input, written, problems, totalRows };
}
function threeWayWorkbookChecks(read, r) {
  const checks = new CheckList();
  const first = read.problems[0];
  checks.that("workbook-rows-read", "Every filled row on the list sheets was read", read.problems.length === 0, first ? `${read.problems.length} row(s) could not be read and are left out; first: sheet "${first.sheet}" row ${first.rowNumber} (${first.reason})` : void 0);
  const calculated = {
    checksTotal: r.outstandingChecksTotal,
    depositsTotal: r.depositsInTransitTotal,
    adjusted: r.adjustedBankBalance,
    ledgerTotal: r.clientLedgerTotal,
    bankVsJournal: r.bankVsJournal,
    journalVsLedgers: r.journalVsLedgers,
    bankVsLedgers: r.bankVsLedgers
  };
  for (const key of WRITTEN_KEYS) {
    const value = read.written[key];
    if (value === void 0) continue;
    checks.cents(`written-${key}`, `The ${WRITTEN_LABELS[key]} written on the Reconciliation sheet = the calculated figure`, calculated[key], key === "checksTotal" ? Math.abs(value) : value);
  }
  return checks.all;
}

// packages/agents/src/registry/law-trust.ts
var TXN_COLUMNS = { roles: LAW_TXN_ROLES, labels: LAW_TXN_LABELS, required: ["date"], guess: (rows, at) => lawGuessTxnColumns(rows, at) };
var BALANCE_COLUMNS = { roles: LAW_BALANCE_ROLES, labels: LAW_BALANCE_LABELS, required: ["client", "balance"], guess: (rows, at) => lawGuessBalanceColumns(rows, at) };
var ITEM_COLUMNS = { roles: LAW_ITEM_ROLES, labels: LAW_ITEM_LABELS, required: ["amount"], guess: (rows, at) => lawGuessItemColumns(rows, at) };
var INVOICE_COLUMNS = { roles: LAW_INVOICE_ROLES, labels: LAW_INVOICE_LABELS, required: ["date", "client", "amount"], guess: (rows, at) => lawGuessInvoiceColumns(rows, at) };
var CARRIED_ROLES = ["client", "balance", "lastActivity"];
var CARRIED_LABELS = { client: "Client or matter", balance: "Balance carried in", lastActivity: "Last activity date" };
var CARRIED_SYNONYMS = {
  lastActivity: ["last activity date", "last activity", "date of last activity", "last active", "last date", "date"],
  balance: ["balance carried in", "carried in balance", "carried in", "opening balance", "balance", "trust balance", "ledger balance", "amount"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "name", "case", "file"]
};
var CARRIED_COLUMNS = {
  roles: CARRIED_ROLES,
  labels: CARRIED_LABELS,
  required: ["client", "balance", "lastActivity"],
  guess: (rows, at) => sheetGuessColumns(rows, ["lastActivity", "balance", "client"], CARRIED_SYNONYMS, at)
};
var LAW_TOTAL_CELL = /^(grand |sub ?)?totals?( balance)?:?$/i;
function mapLaw(file, c, override, label) {
  const given = txt(override);
  try {
    return mapColumns(file, c, given || void 0, label);
  } catch (err) {
    const first = file.rows.findIndex((r) => r.some((x) => x.trim() !== ""));
    if (given === "" && err instanceof AgentInputError && first >= 0 && first !== c.guess(file.rows).headerRow) {
      throw new AgentInputError(`${err.message} The file's first row is: ${file.rows[first].filter((x) => x.trim() !== "").join(", ")}.`);
    }
    throw err;
  }
}
var TXN_FILE_TEXT = "with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present";
var txt = (v) => typeof v === "string" ? v.trim() : "";
var centsOf = (v) => typeof v === "number" ? v : void 0;
var plural2 = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
var was = (n) => n === 1 ? "was" : "were";
var is = (n) => n === 1 ? "is" : "are";
function dayOf(now) {
  const two = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
function readError(err, what, columnsName) {
  const message = err instanceof Error ? err.message : "it could not be read.";
  return new AgentInputError(
    `The ${what}: ${message.replace(/\s*Choose it in the column mapping\.?/g, ` Name the column with "${columnsName}".`).replace(/Check the header row and the column mapping\.?/g, `Check the header row, or name the columns with "${columnsName}".`).replace(/\s*Choose either one amount column or the money-in and money-out columns, not both\.?/g, ` Name either one amount column or the money-in and money-out columns with "${columnsName}", not both.`)}`
  );
}
function listRowsCheck(id, label, file, problems) {
  if (problems.length === 0) return { id, label, passed: true, severity: "error" };
  const shown = problems.slice(0, 8).map((p) => `row ${p.rowNumber} (${p.reason})`);
  return { id, label, passed: false, severity: "error", detail: `${problems.length} row(s) of ${file} could not be read and are not used: ${shown.join("; ")}${problems.length > shown.length ? `; and ${problems.length - shown.length} more` : ""}` };
}
function readTransactions(file, override, label, columnsName) {
  const mapping = mapLaw(file, TXN_COLUMNS, override, label);
  try {
    return lawExtractTransactions(file.rows, mapping);
  } catch (err) {
    throw readError(err, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
function readBalances(args, name, override, label, columnsName) {
  const file = args.files[name]?.[0];
  if (!file) return { balances: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, BALANCE_COLUMNS, override, label);
  try {
    const got = lawExtractClientBalances(file.rows, mapping);
    return { balances: got.balances, problems: got.problems, totalRows: got.totalRows.length, file: file.name };
  } catch (err) {
    throw readError(err, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
function balancesInput(name, label, what) {
  return {
    name,
    kind: "file",
    label,
    description: `Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and ${what}. A row labelled Total is left out. Clients not listed start at zero.`,
    required: false
  };
}
function readEntries(file, override) {
  const read = readTransactions(file, override, "Entries list", "columns");
  const { entries, problems } = lawEntriesFromTxns(read.transactions);
  return { entries, problems: [...read.problems, ...problems].sort((a, b) => a.rowNumber - b.rowNumber), ignored: read.ignoredRows };
}
var ledgerCard = {
  name: "client_trust_ledger_card",
  page: "law-trust/client-trust-ledger",
  section: "law-trust",
  kind: "tool",
  title: "Client trust ledger card: one client, balance after every line",
  description: "Builds one client's or matter's trust ledger card from a list of receipts and disbursements (.csv or .xlsx): every line in date order with the balance after it, the receipts and disbursements totals, the closing balance and the lowest balance. Every balance is re-added from the opening balance on a second pass, the totals are added again in the opposite order, and every line after which the balance is below zero is listed; a card that goes below zero is not verified. Use it when someone asks for a client trust ledger, a client ledger card or one matter's running trust balance from a law firm's trust (IOLTA) records. Not for a whole account's journal across clients, and it makes no statement about what any rule requires.",
  question: "Can you make the trust ledger card for the Cedar closing matter from this export and check the balance never went negative?",
  inputs: [
    { name: "entries", kind: "file", label: "Entries list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. Same-date rows keep the file's order.`, required: true },
    { name: "client", kind: "text", label: "Client or matter", description: "Optional. The client or matter the card is for, as the file writes it. Needed when the file names more than one client or matter: only that one's rows go on the card. Also the name printed on the card.", required: false },
    { name: "opening", kind: "amount", label: "Opening balance", description: "Optional. The balance carried onto the card before its first line. Without it, zero.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the card's summary.", required: false },
    columnsInput("Entries list", TXN_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven carries a balance and compares totals; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ files, values }) {
    const file = oneFile(files, "entries");
    const read = readEntries(file, values.columns);
    const clients = /* @__PURE__ */ new Map();
    for (const e of read.entries) {
      const key = lawClientKey(e.client);
      const at = clients.get(key) ?? { label: lawClientLabel(e.client), count: 0 };
      at.count += 1;
      clients.set(key, at);
    }
    const listOf = () => [...clients.values()].map((c) => `${c.label} (${plural2(c.count, "row")})`).join(", ");
    const typed = txt(values.client);
    const typedKey = lawClientKey(typed);
    const named = [...clients.keys()].some((k) => k !== "");
    let picked = read.entries;
    let pickedKey = null;
    if (typed !== "" && named) {
      if (!clients.has(typedKey)) throw new AgentInputError(`No row of the entries list is for "${typed}". The file names: ${listOf()}. Give "client" as one of these.`);
      pickedKey = typedKey;
    } else if (clients.size > 1) {
      throw new AgentInputError(`The entries list names more than one client or matter: ${listOf()}. Give "client" to say whose rows go on the card.`);
    }
    const leftOut = [];
    if (pickedKey !== null) {
      picked = read.entries.filter((e) => lawClientKey(e.client) === pickedKey);
      for (const e of read.entries) if (lawClientKey(e.client) !== pickedKey) leftOut.push({ rowNumber: e.row, reason: "for another client or matter" });
    }
    const keys = new Set(picked.map((e) => lawClientKey(e.client)));
    const fromFile = keys.size === 1 && !keys.has("") ? lawClientLabel(picked[0].client) : "";
    const input = { client: typed !== "" ? typed : fromFile, opening: centsOf(values.opening) ?? 0, entries: picked };
    const r = buildTrustCard(input);
    const t = trustCardTables(input, r);
    const summary = [["Item", "Amount"], ["Client or matter", input.client.trim()], ["Firm or account", txt(values.account)], ...t.summary.slice(1)];
    const dips = r.belowZero.length;
    return {
      summary: `${input.client.trim() || "The card"}: opening balance ${formatUSD(input.opening)} + receipts ${formatUSD(r.receiptsTotal)} − disbursements ${formatUSD(r.disbursementsTotal)} = closing balance ${formatUSD(r.closing)}, over ${plural2(r.lines.length, "line")}. ` + (dips ? `The balance is below zero at ${plural2(dips, "point")} on the card; the lowest balance is ${formatUSD(r.lowest)}.` : `The balance never goes below zero; the lowest balance is ${formatUSD(r.lowest)}.`) + (leftOut.length ? ` ${plural2(leftOut.length, "row")} of other clients or matters ${is(leftOut.length)} not on the card.` : "") + (read.ignored ? ` ${plural2(read.ignored, "row")} with no date and no amount (titles, totals, notes) ${was(read.ignored)} left out.` : ""),
      tables: [
        { name: "Ledger card", rows: t.card },
        { name: "Summary", rows: summary },
        { name: "Where the balance is below zero", rows: t.belowZero }
      ],
      checks: [...r.checks, ...sheetRowChecks(read.problems, leftOut)]
    };
  },
  examples: [
    {
      label: "The page's worked example: the Cedar closing rows of a March 2026 trust export, opening balance $0.00",
      args: { entries: "fixture:law/trust-journal-march.csv", client: "Cedar closing" },
      verified: true,
      contains: ["receipts $10,000.00", "disbursements $3,500.00", "closing balance $6,500.00", "never goes below zero", "4350.75", "4000.00", "6500.00"]
    },
    {
      label: "The page's counter-example: the wire dated April 1 puts three lines below zero, so the card is not verified",
      args: {
        entries: 'Date,Check No,Payee or source,Receipts,Disbursements\n2026-04-01,,Wire in - closing funds,"7,500.00",\n2026-03-26,1043,Recording fees,,"3,149.25"\n2026-03-30,1045,Example Title Company,,350.75\n2026-03-31,,Deposit - closing funds,"2,500.00",\n',
        client: "Cedar closing"
      },
      verified: false,
      failedCheck: "never-below-zero"
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { entries: "Date,Payee,Receipts,Disbursements\n2026-03-17,Wire in,7500.00,\n2026-03-26,Recording fees,,3l49.25\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var cashJournal = {
  name: "trust_receipts_disbursements_journal",
  page: "law-trust/trust-receipts-and-disbursements-journal",
  section: "law-trust",
  kind: "tool",
  title: "Trust receipts and disbursements journal with client subtotals",
  description: "Builds the receipts and disbursements journal of a law firm's trust (IOLTA) account from a period's transactions (.csv or .xlsx): every entry in date order with the account balance after it, the receipts and disbursements totals, a subtotal per client or matter, and the check numbers used twice or missing from the run. Every balance re-adds from the opening balance, each client subtotal matches a second grouping, and the subtotals tie to the journal totals. Entries with no client, lines below zero and check-number gaps are listed as findings. Use it when someone asks for a trust journal, a cash receipts and disbursements journal, client subtotals for the month, or missing check numbers. Not for one client's card alone, and it makes no statement about what any rule requires.",
  question: "Here is our trust account activity for March. Can you build the receipts and disbursements journal with subtotals by client and flag any missing check numbers?",
  inputs: [
    { name: "entries", kind: "file", label: "Entries list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. Same-date rows keep the file's order.`, required: true },
    { name: "opening", kind: "amount", label: "Opening balance", description: "Optional. The journal balance before the first entry. Without it, zero.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the summary.", required: false },
    { name: "period", kind: "text", label: "Period", description: 'Optional. The period the journal covers, as words for the summary ("March 2026").', required: false },
    columnsInput("Entries list", TXN_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven adds, subtotals, and lists; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ files, values }) {
    const file = oneFile(files, "entries");
    const read = readEntries(file, values.columns);
    const input = { opening: centsOf(values.opening) ?? 0, entries: read.entries };
    const r = buildTrustCashJournal(input);
    const t = trustCashTables(input, r);
    const summary = [["Item", "Amount"], ["Firm or account", txt(values.account)], ["Period", txt(values.period)], ...t.summary.slice(1)];
    const named = r.clients.filter((c) => c.client !== "").length;
    const unnamed = r.clients.find((c) => c.client === "")?.entries ?? 0;
    const numbers = r.checkNumbersUsed === 0 ? "No disbursement carries a check number." : `${plural2(r.checkNumbersUsed, "disbursement")} ${r.checkNumbersUsed === 1 ? "carries" : "carry"} a check number; ${r.repeatedChecks.length ? `used more than once: ${r.repeatedChecks.map((c) => c.number).join(", ")}` : "none is used twice"}; ${r.missingChecks.length ? `not in the journal: ${r.missingChecks.map(trustCheckGapLabel).join(", ")}` : "none is missing between the lowest and the highest"}.`;
    return {
      summary: `Opening balance ${formatUSD(input.opening)} + receipts ${formatUSD(r.receiptsTotal)} − disbursements ${formatUSD(r.disbursementsTotal)} = closing balance ${formatUSD(r.closing)}, across ${plural2(r.lines.length, "entry", "entries")} for ${plural2(named, "client or matter", "clients or matters")}${unnamed ? `, ${unnamed} of them with no client or matter` : ""}. ${numbers}` + (r.belowZero.length ? ` The journal balance is below zero after ${plural2(r.belowZero.length, "line")}.` : "") + (read.ignored ? ` ${plural2(read.ignored, "row")} with no date and no amount (titles, totals, notes) ${was(read.ignored)} left out.` : ""),
      tables: [
        { name: "Journal", rows: t.journal },
        { name: "Subtotals by client or matter", rows: t.clients },
        { name: "Summary", rows: summary },
        { name: "Check numbers", rows: t.checkNumbers },
        { name: "Lines below zero", rows: t.belowZero }
      ],
      checks: [...r.checks, ...sheetRowChecks(read.problems, [])]
    };
  },
  examples: [
    {
      label: "The page's worked example: March 2026, ten entries for three clients, opening balance $41,300.00",
      args: { entries: "fixture:law/trust-journal-march.csv", opening: "41,300.00", period: "March 2026" },
      verified: true,
      contains: ["receipts $22,400.00", "disbursements $14,500.75", "closing balance $49,199.25", "not in the journal: 1044", "2500.00", "-1100.75", "6500.00", "7899.25"]
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { entries: "Date,Check No,Payee,Client/Matter,Receipts,Disbursements\n2026-03-03,,Deposit,Alder matter,5000.00,\n2026-03-05,1039,Filing fee,Alder matter,,43S.00\n", opening: "41,300.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var scanner = {
  name: "trust_negative_balance_scan",
  page: "law-trust/negative-balance-scanner",
  section: "law-trust",
  kind: "tool",
  title: "Trust account scan for client ledgers below zero, by date",
  description: "Scans a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row): each client's running balance is walked in date order and taken at the end of each date, and every date a client ledger ends below zero is listed, with every transaction that has no client or matter, and, when a firm funds ledger and a ceiling are given, every date that ledger ends above the ceiling. At every date the client ledgers are proved to add up to the account balance, and every list is matched by a second walk; the findings are warnings beside those checks. Use it when someone asks whether any client went negative, which transactions are unassigned, or how much firm money sat in trust. Not for a single client's card, and it has no ceiling of its own and makes no statement about what any rule allows.",
  question: "Can you scan this trust account export and tell me every date a client ledger went below zero?",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}.`, required: true },
    balancesInput("openingBalances", "Opening balances", "its balance before the first transaction in the transaction list"),
    { name: "firmLedger", kind: "text", label: "Firm funds ledger", description: `Optional. The name of the ledger that holds the firm's own funds, as written in the file. Used with "firmCeiling".`, required: false },
    { name: "firmCeiling", kind: "amount", label: "Ceiling for the firm funds ledger", description: `Optional. A ceiling of the person's own choosing for the firm funds ledger: each date that ledger ends above it is listed, with the amount above. Needs "firmLedger".`, required: false },
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Opening balances", BALANCE_COLUMNS, "openingColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven reports balances, dates, and differences; it makes no statement about what any rule, regulation, or agreement requires.",
  run(args) {
    const { files, values } = args;
    const file = oneFile(files, "transactions");
    const read = readTransactions(file, values.columns, "Trust transaction list", "columns");
    const openings = readBalances(args, "openingBalances", values.openingColumns, "Opening balances", "openingColumns");
    const ceiling = centsOf(values.firmCeiling);
    const firmLedger = txt(values.firmLedger);
    if (ceiling === void 0 && firmLedger !== "") throw new AgentInputError('A firm funds ledger was named without a ceiling. Give "firmCeiling" as well, or leave both out.');
    const r = scanTrustLedgers({ transactions: read.transactions, problems: read.problems, openingBalances: openings.balances, ...ceiling === void 0 ? {} : { firmLedger, firmCeiling: ceiling } });
    const t = trustScanTables(r);
    const tables = [
      { name: "Dates with a client ledger below zero", rows: t.negatives },
      { name: "Transactions with no client or matter", rows: t.unassigned },
      ...ceiling === void 0 ? [] : [{ name: "Dates the firm funds ledger is above the ceiling", rows: t.overCeiling }],
      { name: "Summary by client", rows: t.summary },
      { name: "Account balance by date", rows: t.days },
      { name: "Client ledgers", rows: t.ledgers }
    ];
    return {
      summary: `${plural2(r.transactionCount, "transaction")} across ${plural2(r.ledgers.filter((l) => l.client !== "").length, "client ledger")}, balances taken at the end of each date. ${plural2(r.negatives.length, "date")} with a client ledger below zero; ${plural2(r.unassigned.length, "transaction")} with no client or matter` + (ceiling === void 0 ? "" : `; ${plural2(r.overCeiling.length, "date")} the ${firmLedger} ledger ends above the ${formatUSD(ceiling)} ceiling`) + `. Closing total ${formatUSD(r.closingTotal)}.` + (read.ignoredRows ? ` ${plural2(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (openings.totalRows ? ` ${plural2(openings.totalRows, "total row")} of the opening balances list ${was(openings.totalRows)} left out.` : ""),
      tables,
      checks: [...r.checks, ...openings.file ? [listRowsCheck("openings-read", "Every row of the opening balances list was read", openings.file, openings.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: nine March 2026 transactions, a firm funds ledger named Firm funds and a $250.00 ceiling",
      args: { transactions: "fixture:law/trust-transactions.csv", firmLedger: "Firm funds", firmCeiling: "250.00" },
      verified: true,
      contains: ["1 date with a client ledger below zero", "1 transaction with no client or matter", "1 date the Firm funds ledger ends above the $250.00 ceiling", "Closing total $2,075.00", "| Cedar closing | 2026-03-09 | -1200.00 |", "-25.00", "| 2026-03-18 | 300.00 | 50.00 |"]
    },
    {
      label: "A row whose date cannot be read is not verified",
      args: { transactions: "Date,Payee,Client/Matter,Amount\n03/02/2026,Deposit,Alder matter,5000.00\n03/32/2026,Filing fee,Alder matter,-435.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readCarried(args) {
  const file = args.files.carriedIn?.[0];
  if (!file) return { carried: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, CARRIED_COLUMNS, args.values.carriedColumns, "Carried-in balances");
  const c = mapping.columns;
  const cell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
  const carried = [];
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  let totalRows = 0;
  file.rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const client = cell(row, c.client).replace(/\s+/g, " ");
    if (LAW_TOTAL_CELL.test(client)) {
      totalRows++;
      return;
    }
    const reasons = [];
    if (!client) reasons.push("no client or matter name");
    const rawBalance = cell(row, c.balance);
    let balance = 0;
    if (!rawBalance) reasons.push("no balance");
    else {
      try {
        balance = pmCellToCents(rawBalance, { crIsNegative: false });
      } catch {
        reasons.push(`the balance "${rawBalance}" could not be read`);
      }
    }
    const rawDate = cell(row, c.lastActivity);
    let lastActivity = "";
    if (!rawDate) reasons.push("no last activity date");
    else {
      try {
        lastActivity = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    const key = lawClientKey(client);
    if (client && seen.has(key)) reasons.push(`"${client}" is already listed on an earlier row`);
    if (reasons.length) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    seen.add(key);
    carried.push({ client, balance, lastActivity });
  });
  return { carried, problems, totalRows, file: file.name };
}
var dormant = {
  name: "dormant_trust_balance_report",
  page: "law-trust/dormant-trust-balance-report",
  section: "law-trust",
  kind: "tool",
  title: "Dormant trust balances: client balances with no activity, by age",
  description: "From a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row), an as-of date and a period in years or months given by the person, takes every client's balance on the as-of date and its last activity, and lists each balance above zero with no activity since the cutoff (the as-of date less the period), oldest first, with its age. Balances below zero are listed on their own. The cutoff is worked out a second way, every balance, last activity date and age is recomputed from the rows, and listed plus active plus below-zero balances are proved to equal the trust total. Use it when someone asks which client funds have sat untouched in trust, for how long, or for an aged list of stale trust balances. Not for deciding whether a balance is unclaimed or abandoned: it has no period of its own and makes no statement about what any rule requires.",
  question: "Which client balances in our trust account have had no activity in the last three years? Here is the full transaction history.",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. It should reach back to each client's last activity, or the earlier balance is carried in.`, required: true },
    { name: "period", kind: "number", label: "Period", description: 'The length of time with no activity, as a whole number of years or months (see "unit"), as the person gives it. The tool has no period of its own.', required: true },
    { name: "unit", kind: "choice", label: "Period counted in", description: 'Optional. "years" or "months". Without it, years.', required: false, choices: ["years", "months"] },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the balances are taken on, YYYY-MM-DD; rows after it are left out. Without it, the day of the run.", required: false },
    {
      name: "carriedIn",
      kind: "file",
      label: "Carried-in balances",
      description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client whose money was in trust before the first row of the transaction list: the name, the balance then, and the date of that client's last activity before the list starts. Clients not listed start at zero.",
      required: false
    },
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Carried-in balances", CARRIED_COLUMNS, "carriedColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven lists balances by amount and last activity against the period typed; it makes no statement about whether a balance is unclaimed or abandoned or what any rule requires.",
  run(args) {
    const { files, values, now } = args;
    const file = oneFile(files, "transactions");
    const rawPeriod = txt(values.period);
    const unit = values.unit === "months" ? "months" : "years";
    if (!/^\d+$/.test(rawPeriod)) throw new AgentInputError(`"period" must be a whole number of ${unit}: "${rawPeriod}".`);
    const asOf = txt(values.asOf) || dayOf(now);
    const carried = readCarried(args);
    const read = readTransactions(file, values.columns, "Trust transaction list", "columns");
    const r = buildDormantReport({ transactions: read.transactions, problems: read.problems, carriedIn: carried.carried, asOf, period: Number(rawPeriod), unit });
    const t = dormantReportTables(r);
    const period = lawDormantPeriodText(r.period, r.unit);
    const active = r.clients.filter((c) => c.group === "active").length;
    return {
      summary: `Balances as of ${r.asOf}; the cutoff is ${r.cutoff}, the as-of date less ${period}. ${plural2(r.listed.length, "balance")} above zero with no activity since the cutoff, together ${formatUSD(r.listedTotal)}; ${plural2(active, "active balance")}, together ${formatUSD(r.activeTotal)}; trust total ${formatUSD(r.trustTotal)}.` + (r.belowZero.length ? ` ${plural2(r.belowZero.length, "balance")} below zero, together ${formatUSD(r.belowZeroTotal)}, ${is(r.belowZero.length)} listed on ${r.belowZero.length === 1 ? "its" : "their"} own.` : "") + (r.afterAsOf ? ` ${plural2(r.afterAsOf, "row")} dated after the as-of date ${is(r.afterAsOf)} left out.` : "") + (read.ignoredRows ? ` ${plural2(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (carried.totalRows ? ` ${plural2(carried.totalRows, "total row")} of the carried-in list ${was(carried.totalRows)} left out.` : ""),
      tables: [
        { name: "Report", rows: t.settings },
        { name: "Balances with no activity since the cutoff", rows: t.listed },
        { name: "Client balances below zero", rows: t.belowZero },
        { name: "Rows with no client or matter", rows: t.unassigned },
        { name: "Totals", rows: t.totals },
        { name: "Every client or matter", rows: t.clients }
      ],
      checks: [...r.checks, ...carried.file ? [listRowsCheck("carried-in-read", "Every row of the carried-in balances list was read", carried.file, carried.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: twelve rows for six clients, as of 2026-09-30, a period of 3 years",
      args: { transactions: "fixture:law/dormant-balances.csv", asOf: "2026-09-30", period: "3", unit: "years" },
      verified: true,
      contains: ["the cutoff is 2023-09-30", "3 balances above zero with no activity since the cutoff, together $1,562.45", "together $650.00", "trust total $2,187.45", "| Juniper estate | 0.00 | 2 | 750.00 | 2019-06-14 | 7 years, 3 months, 16 days |", "5 years, 4 months, 10 days", "3 years, 10 months, 20 days", "-25.00"]
    },
    {
      label: "A row whose date cannot be read is not verified",
      args: { transactions: "Date,Payee,Client/Matter,Amount\n04/08/2019,Deposit,Juniper estate,12000.00\n13/45/2024,Bad date,Maple matter,10.00\n", asOf: "2026-09-30", period: "3" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var earnedFees = {
  name: "earned_fees_left_in_trust",
  page: "law-trust/earned-fees-left-in-trust",
  section: "law-trust",
  kind: "tool",
  title: "Earned fees left in trust: billed fees not transferred, by client and age",
  description: `Sets a law firm's invoices (fees billed) against the fee transfers out of its trust (IOLTA) account, client by client, from two .csv or .xlsx files: a trust transaction list and an invoice list. Fee transfers are the money-out rows whose description or check number holds a word given ("operating" unless told otherwise), and each one is listed. It gives the invoices billed and not transferred, oldest first, with their age in days; transfers above what was billed, on the as-of date and by each transfer's date; and each client's trust balance. Every client figure re-adds from both files, and the transfers tie to the trust balance. Use it when someone asks which billed fees are still sitting in trust, or whether more was taken from trust than was billed. Not for deciding whether a fee is earned or when money is moved: it makes no statement about what any rule requires.`,
  question: "Here are our trust transactions and our invoices. Which billed fees have not been transferred out of trust yet, and how old are they?",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}.`, required: true },
    { name: "invoices", kind: "file", label: "Invoice list", description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per invoice: invoice date, client or matter and fees billed are needed; an invoice number is used when present. A credit note is written below zero.", required: true },
    { name: "transferWords", kind: "text", label: "Words that mark a fee transfer", description: `Optional. Words, separated by commas, that a money-out row's description or check number holds when it is a fee transfer to the firm, ignoring case. Without it, "operating".`, required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the report is taken on, YYYY-MM-DD; rows and invoices after it are left out. Without it, the day of the run.", required: false },
    { name: "from", kind: "date", label: "Count from", description: "Optional. YYYY-MM-DD: invoices and fee transfers before it are not counted as billed or transferred; the trust rows still count in the balances.", required: false },
    balancesInput("carriedIn", "Carried-in balances", "its trust balance before the first row of the trust list"),
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Invoice list", INVOICE_COLUMNS, "invoiceColumns"),
    columnsInput("Carried-in balances", BALANCE_COLUMNS, "carriedColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven sets the invoices against the transfers, gives amounts, dates, and ages, and proves the totals; it does not say what any rule requires, when or whether money is moved, or whether an amount is earned.",
  run(args) {
    const { files, values, now } = args;
    const trust = oneFile(files, "transactions");
    const bills = oneFile(files, "invoices");
    const words = lawFeeWordsFromText(txt(values.transferWords) || "operating");
    const asOf = txt(values.asOf) || dayOf(now);
    const carried = readBalances(args, "carriedIn", values.carriedColumns, "Carried-in balances", "carriedColumns");
    const read = readTransactions(trust, values.columns, "Trust transaction list", "columns");
    const invMapping = mapLaw(bills, INVOICE_COLUMNS, values.invoiceColumns, "Invoice list");
    let inv;
    try {
      inv = lawExtractInvoices(bills.rows, invMapping);
    } catch (err) {
      throw readError(err, `invoice list (${bills.name})`, "invoiceColumns");
    }
    const r = buildEarnedFeesReport({ transactions: read.transactions, invoices: inv.invoices, transactionProblems: read.problems, invoiceProblems: inv.problems, carriedIn: carried.balances, asOf, from: txt(values.from), transferWords: words });
    const t = earnedFeesTables(r);
    const ignored = read.ignoredRows + inv.ignoredRows;
    return {
      summary: `As of ${r.asOf}${r.from ? `, counted from ${r.from}` : ""}, with ${r.words.map((w) => `"${w}"`).join(" or ")} ` +
        `marking a fee transfer: fees billed ${formatUSD(r.billedTotal)}, fee transfers ${formatUSD(r.transferTotal)} ` +
        `(${plural2(r.transfers.length, "row")}). Billed and not transferred ${formatUSD(r.notTransferredTotal)} ` +
        `on ${plural2(r.open.length, "invoice")}; transferred above billed ${formatUSD(r.aboveBilledTotal)}. ` +
        `Trust balance ${formatUSD(r.trustTotal)}.` + (r.ahead.length ? ` ${plural2(r.ahead.length, "transfer")} took a client's transfers above what was billed by their date.` : "") + (r.afterAsOf || r.invoicesAfter ? ` ${plural2(r.afterAsOf, "trust row")} and ${plural2(r.invoicesAfter, "invoice")} dated after the as-of date are left out.` : "") + (r.invoicesBefore ? ` ${plural2(r.invoicesBefore, "invoice")} before ${r.from} ${is(r.invoicesBefore)} left out.` : "") + (ignored ? ` ${plural2(ignored, "row")} with no date and no amount ${was(ignored)} left out (titles or notes).` : "") + (inv.totalRows.length ? ` ${plural2(inv.totalRows.length, "total line")} in the invoice list ${was(inv.totalRows.length)} left out.` : ""),
      tables: [
        { name: "Report", rows: t.settings },
        { name: "Billed and transferred, by client", rows: t.clients },
        { name: "Invoices billed and not transferred, oldest first", rows: t.open },
        { name: "Transfers above what was billed by their date", rows: t.ahead },
        { name: "Tied to the trust balance", rows: t.tieOut },
        { name: "Rows read as fee transfers", rows: t.transfers },
        { name: "Rows with no client or matter", rows: t.unassigned }
      ],
      checks: [...r.checks, ...carried.file ? [listRowsCheck("carried-in-read", "Every row of the carried-in balances list was read", carried.file, carried.problems)] : []]
    };
  },
  examples: [
    {
      label: `The page's worked example: eleven trust rows and six invoices for four clients, as of 2026-10-31, transfer word "operating"`,
      args: { transactions: "fixture:law/earned-fees-trust.csv", invoices: "fixture:law/earned-fees-invoices.csv", asOf: "2026-10-31", transferWords: "operating" },
      verified: true,
      contains: ["fees billed $7,905.50", "fee transfers $5,590.00 (4 rows)", "Billed and not transferred $2,555.50 on 2 invoices", "transferred above billed $240.00", "Trust balance $13,025.00", "| Dogwood matter | 2 | 0988 | 2026-04-30 | 1180.00 | 1180.00 | 184 |", "| 1375.50 | 60 |", "2885.00"]
    },
    {
      label: "An invoice row whose amount cannot be read is not verified",
      args: { transactions: "fixture:law/earned-fees-trust.csv", invoices: "Invoice Date,Invoice No,Client/Matter,Fees Billed\n04/30/2026,0988,Dogwood matter,1180.00\n06/30/2026,0996,Birch estate,24OO.00\n", asOf: "2026-10-31" },
      verified: false,
      failedCheck: "invoices-read"
    }
  ]
};
function assignments(text, rows) {
  const out = /* @__PURE__ */ new Map();
  if (text === "") return out;
  const known = new Set(rows.map((t) => t.rowNumber));
  for (const part of text.split(/[;\n]/)) {
    if (part.trim() === "") continue;
    const m = /^\s*(?:row\s*)?(\d+)\s*[=:]\s*(.*)$/i.exec(part);
    if (!m) throw new AgentInputError(`"clients" must be written as "<row number> = <client or matter>", separated by semicolons or new lines: "${part.trim()}".`);
    const row = Number(m[1]);
    if (!known.has(row)) throw new AgentInputError(`Row ${row} is not a transaction row of the statement. Its transaction rows are ${[...known].slice(0, 12).join(", ")}${known.size > 12 ? ", …" : ""}.`);
    if (out.has(row)) throw new AgentInputError(`Row ${row} is given twice in "clients".`);
    out.set(row, (m[2] ?? "").trim());
  }
  return out;
}
var rebuild = {
  name: "trust_ledgers_from_bank_statement",
  page: "law-trust/trust-ledger-from-bank-statement",
  section: "law-trust",
  kind: "tool",
  title: "Client trust ledgers rebuilt from a bank statement export",
  description: "Rebuilds a law firm's client trust ledgers and the trust journal from the trust (IOLTA) account's bank statement export (.csv or .xlsx), with each transaction assigned to a client or matter from a column in the file or by row number. The statement is verified first (opening balance plus transactions equals the closing balance, and every printed running balance matches), then every transaction is placed in exactly one client ledger, each ledger re-adds, client opening balances add up to the statement's opening balance, and the client ledgers add up to the bank closing balance to the cent. A transaction with no client fails the check. Use it when someone needs client ledgers reconstructed from bank records, or wants to see which clients' money makes up the bank balance. Not for a statement in PDF form, and it makes no statement about what any rule requires.",
  question: "Our trust ledgers are a mess. Can you rebuild each client ledger from this bank statement export and check they add up to the bank balance?",
  inputs: [
    { name: "statement", kind: "file", label: "Bank statement export", description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per bank transaction: a date, and either one signed amount column or separate deposit and withdrawal columns; a description, a running balance and a client or matter column are used when present.", required: true },
    { name: "openingBalance", kind: "amount", label: "Statement opening balance", description: "The opening balance printed on the bank statement.", required: true },
    { name: "closingBalance", kind: "amount", label: "Statement closing balance", description: "The closing balance printed on the bank statement.", required: true },
    { name: "order", kind: "choice", label: "Order of rows in the file", description: 'Optional. "oldest first" or "newest first", as the bank lists the transactions. Without it, oldest first.', required: false, choices: ["oldest first", "newest first"] },
    balancesInput("openingBalances", "Client opening balances", "its balance at the start of the statement period (they are compared with the statement's opening balance; leave out when the account opened at zero)"),
    { name: "clients", kind: "text", label: "Client or matter by row", description: `Optional. The client or matter for rows of the statement, as "<row number> = <client or matter>" separated by semicolons or new lines, using the row numbers the file shows (the header is row 1 in a file with no title rows). It fills in or replaces the file's client column for those rows; "<row number> =" with no name leaves a row unassigned.`, required: false },
    columnsInput("Bank statement export", TXN_COLUMNS),
    columnsInput("Client opening balances", BALANCE_COLUMNS, "openingColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven builds ledgers and compares totals; it makes no statement about what any rule, regulation, or agreement requires.",
  // The statement's rows and the client opening balances set against the opening and closing balances typed from the statement.
  comparisonChecks: ["bank-balance", "opening-ledgers", "ledgers-closing", "journal-closing"],
  run(args) {
    const { files, values } = args;
    const file = oneFile(files, "statement");
    const read = readTransactions(file, values.columns, "Bank statement export", "columns");
    const openings = readBalances(args, "openingBalances", values.openingColumns, "Client opening balances", "openingColumns");
    const typed = assignments(txt(values.clients), read.transactions);
    const ordered = values.order === "newest first" ? [...read.transactions].reverse() : read.transactions;
    const opening = centsOf(values.openingBalance);
    const closing = centsOf(values.closingBalance);
    if (opening === void 0 || closing === void 0) throw new AgentInputError("Give the opening and closing balance printed on the bank statement.");
    const transactions = ordered.map((t2) => ({ date: t2.date, description: t2.description, amount: t2.amount, ...t2.balance === void 0 ? {} : { balance: t2.balance } }));
    const input = {
      statement: { openingBalance: opening, closingBalance: closing, transactions },
      clients: ordered.map((t2) => typed.has(t2.rowNumber) ? typed.get(t2.rowNumber) : t2.client),
      openingBalances: openings.balances,
      problems: read.problems
    };
    const r = rebuildTrustLedgers(input);
    const t = trustRebuildTables(input, r);
    return {
      summary: `${plural2(r.journal.length, "bank transaction")} placed in ${plural2(r.ledgers.length, "client ledger")}${r.unassigned.length ? `; ${plural2(r.unassigned.length, "transaction")} with no client or matter` : ""}. Sum of client ledgers ${formatUSD(r.ledgerTotal)}; bank closing balance ${formatUSD(closing)}; trust journal closing balance ${formatUSD(r.journalClosing)}.` + (read.ignoredRows ? ` ${plural2(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (openings.totalRows ? ` ${plural2(openings.totalRows, "total row")} of the opening balances list ${was(openings.totalRows)} left out.` : ""),
      tables: [
        { name: "Summary by client", rows: t.summary },
        { name: "Client ledgers", rows: t.ledgers },
        { name: "Trust journal", rows: t.journal }
      ],
      checks: [...r.checks, ...openings.file ? [listRowsCheck("openings-read", "Every row of the client opening balances list was read", openings.file, openings.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: an April statement from $10,000.00 to $15,249.51, five transactions, opening balances for Alder matter and Birch estate",
      args: { statement: "fixture:law/trust-bank.csv", openingBalance: "10,000.00", closingBalance: "15,249.51", openingBalances: "Client or matter,Opening balance\nAlder matter,4000.00\nBirch estate,6000.00\n" },
      verified: true,
      contains: ["5 bank transactions placed in 3 client ledgers", "Sum of client ledgers $15,249.51", "trust journal closing balance $15,249.51", "| Alder matter | 4000.00 | 1 | -1250.50 | 2749.50 |", "| Birch estate | 6000.00 | 2 | 5000.00 | 11000.00 |", "| Cedar closing | 0.00 | 2 | 1500.01 | 1500.01 |"]
    },
    {
      label: "The page's counter-example: the April 3 check (row 3) left with no client is in no ledger, so the result is not verified",
      args: { statement: "fixture:law/trust-bank.csv", openingBalance: "10,000.00", closingBalance: "15,249.51", openingBalances: "Client or matter,Opening balance\nAlder matter,4000.00\nBirch estate,6000.00\n", clients: "3 =" },
      verified: false,
      failedCheck: "each-once"
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { statement: "Date,Description,Amount,Client\n04/01/2026,DEPOSIT,2500.00,Cedar closing\n04/03/2026,CHECK 2001,-1250.5O,Alder matter\n", openingBalance: "0.00", closingBalance: "2,500.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readItems(args, name, override, label, columnsName) {
  const file = args.files[name]?.[0];
  if (!file) return { items: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, ITEM_COLUMNS, override, label);
  try {
    const got = lawExtractOutstandingItems(file.rows, mapping);
    return { items: got.items, problems: got.problems, totalRows: got.totalRows.length, file: file.name };
  } catch (err) {
    throw readError(err, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
var THREE_WAY_FIGURES = ["asOf", "bankBalance", "journalBalance", "outstandingChecks", "depositsInTransit", "clientLedgers", "priorBalance", "receipts", "disbursements", "checksColumns", "depositsColumns", "ledgerColumns"];
var threeWay = {
  name: "three_way_trust_reconciliation",
  page: "law-trust/three-way-reconciliation",
  section: "law-trust",
  kind: "tool",
  title: "Three-way trust account reconciliation to the cent",
  description: "Puts three figures for one date side by side for a law firm's trust (IOLTA) account: the adjusted bank balance (bank statement ending balance less outstanding checks plus deposits in transit), the trust journal (checkbook) balance and the sum of the client ledger balances, and compares each pair to the cent with the difference shown. The figures and differences are worked out a second way, the lists re-add, a client ledger below zero fails a check, and optional prior-period figures (prior balance plus receipts less disbursements) are compared with the journal balance. It also opens a filled-in three-way reconciliation template workbook and checks each total written on it by hand. Use it when someone asks for a three-way reconciliation, or why the bank, the checkbook and the client ledgers do not agree. Not for building the client ledgers from transactions, and it makes no statement about what any rule requires.",
  question: "Can you do the three-way reconciliation of our trust account for March 31? The bank shows $48,250, the checkbook $49,199.25, and here are the client balances and outstanding checks.",
  inputs: [
    { name: "workbook", kind: "file", label: "Filled-in template workbook", description: 'Optional. A filled-in .xlsx made with the three-way reconciliation template (sheets Reconciliation, Outstanding checks, Deposits in transit, Client ledgers). It supplies every figure and list below, so none of them (nor their column names) is given with it; only "account" may be.', required: false },
    { name: "bankBalance", kind: "amount", label: "Bank statement ending balance", description: "The bank statement ending balance for the date. Needed unless a workbook is given.", required: false },
    { name: "journalBalance", kind: "amount", label: "Trust journal balance", description: "The trust journal (checkbook register) balance on the same date. Needed unless a workbook is given.", required: false },
    { name: "outstandingChecks", kind: "file", label: "Outstanding checks", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per check written in the trust journal that is not on the bank statement yet: an amount, with a date and a check number or payee when known. A row labelled Total is left out.", required: false },
    { name: "depositsInTransit", kind: "file", label: "Deposits in transit", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per deposit recorded in the trust journal that is not on the bank statement yet: an amount, with a date and a note when known.", required: false },
    { name: "clientLedgers", kind: "file", label: "Client ledger balances", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its ledger balance on the date. A row labelled Total is left out.", required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the three figures are as of, YYYY-MM-DD.", required: false },
    { name: "priorBalance", kind: "amount", label: "Prior period reconciled balance", description: "Optional. With receipts and disbursements: last period's reconciled balance, compared after the period's activity with this trust journal balance.", required: false },
    { name: "receipts", kind: "amount", label: "Receipts this period", description: "Optional. Money into the trust account this period, as a positive amount.", required: false },
    { name: "disbursements", kind: "amount", label: "Disbursements this period", description: "Optional. Money out of the trust account this period, as a positive amount.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the summary.", required: false },
    columnsInput("Outstanding checks", ITEM_COLUMNS, "checksColumns"),
    columnsInput("Deposits in transit", ITEM_COLUMNS, "depositsColumns"),
    columnsInput("Client ledger balances", BALANCE_COLUMNS, "ledgerColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven shows whether three figures are equal and by how much they differ; it does not check any rule and makes no statement about what any rule, regulation, or agreement requires.",
  // The three figures set against each other, the roll-forward against the journal balance typed, and each total
  // written by hand on a workbook against the calculation: the page shows the figures and differences beside them.
  comparisonChecks: ["bank-journal", "journal-ledgers", "bank-ledgers", "continuity", "written-checksTotal", "written-depositsTotal", "written-adjusted", "written-ledgerTotal", "written-bankVsJournal", "written-journalVsLedgers", "written-bankVsLedgers"],
  run(args) {
    const { files, values } = args;
    const book = files.workbook?.[0];
    let input;
    let account = txt(values.account);
    let fromBook = null;
    const listChecks = [];
    let totalRows = 0;
    if (book) {
      const also = THREE_WAY_FIGURES.filter((k) => values[k] !== void 0 || files[k] !== void 0);
      if (also.length) throw new AgentInputError(`A filled-in workbook supplies every figure and list itself. Give either the workbook or the figures, not both (also given: ${also.join(", ")}).`);
      try {
        fromBook = readThreeWayWorkbook(book.sheets);
      } catch (err) {
        throw new AgentInputError(`The workbook (${book.name}): ${err instanceof Error ? err.message : "it could not be read."}`);
      }
      input = fromBook.input;
      account = account || fromBook.account;
      totalRows = fromBook.totalRows;
    } else {
      const bank = centsOf(values.bankBalance);
      const journal = centsOf(values.journalBalance);
      if (bank === void 0 || journal === void 0) throw new AgentInputError('Give the bank statement ending balance ("bankBalance") and the trust journal balance ("journalBalance"), or a filled-in template workbook ("workbook").');
      const checks = readItems(args, "outstandingChecks", values.checksColumns, "Outstanding checks", "checksColumns");
      const deposits = readItems(args, "depositsInTransit", values.depositsColumns, "Deposits in transit", "depositsColumns");
      const ledgers = readBalances(args, "clientLedgers", values.ledgerColumns, "Client ledger balances", "ledgerColumns");
      if (checks.file) listChecks.push(listRowsCheck("checks-rows-read", "Every row of the outstanding checks list was read", checks.file, checks.problems));
      if (deposits.file) listChecks.push(listRowsCheck("deposits-rows-read", "Every row of the deposits in transit list was read", deposits.file, deposits.problems));
      if (ledgers.file) listChecks.push(listRowsCheck("ledgers-rows-read", "Every row of the client ledger balances list was read", ledgers.file, ledgers.problems));
      totalRows = checks.totalRows + deposits.totalRows + ledgers.totalRows;
      input = { asOf: txt(values.asOf), bankEndingBalance: bank, outstandingChecks: checks.items, depositsInTransit: deposits.items, journalBalance: journal, clientLedgers: ledgers.balances };
      const prior = [centsOf(values.priorBalance), centsOf(values.receipts), centsOf(values.disbursements)];
      if (prior.some((p) => p !== void 0)) input.continuity = { priorBalance: prior[0] ?? 0, receipts: prior[1] ?? 0, disbursements: prior[2] ?? 0 };
    }
    const r = threeWayReconcile(input);
    const t = threeWayTables(input, r);
    const differences = [
      ["adjusted bank − trust journal", r.bankVsJournal],
      ["trust journal − client ledgers", r.journalVsLedgers],
      ["adjusted bank − client ledgers", r.bankVsLedgers]
    ];
    const head = [account, input.asOf ? `as of ${input.asOf}` : ""].filter(Boolean).join(", ").replace(/^as of/, "As of");
    const written = fromBook ? Object.keys(fromBook.written).length : 0;
    return {
      summary: `${head ? `${head}: adjusted` : "Adjusted"} bank balance ${formatUSD(r.adjustedBankBalance)} (bank ${formatUSD(input.bankEndingBalance)} ` +
        `− ${plural2(input.outstandingChecks.length, "outstanding check")} ${formatUSD(r.outstandingChecksTotal)} ` +
        `+ ${plural2(input.depositsInTransit.length, "deposit")} in transit ${formatUSD(r.depositsInTransitTotal)}), ` +
        `trust journal balance ${formatUSD(r.journalBalance)}, sum of ${plural2(input.clientLedgers.length, "client ledger")} ` +
        `${formatUSD(r.clientLedgerTotal)}. ` + (r.agree ? `The three balances agree at ${formatUSD(r.adjustedBankBalance)}.` : `The three balances differ: ${differences.filter(([, d]) => d !== 0).map(([label, d]) => `${label} is ${formatUSD(d)}`).join("; ")}.`) + (input.continuity && r.continuityBalance !== void 0 ? ` Prior period balance ${formatUSD(input.continuity.priorBalance)} + receipts ${formatUSD(input.continuity.receipts)} ` +
        `− disbursements ${formatUSD(input.continuity.disbursements)} = ${formatUSD(r.continuityBalance)}.` : "") + (r.negativeLedgers.length ? ` ${plural2(r.negativeLedgers.length, "client ledger")} below zero.` : "") + (totalRows ? ` ${plural2(totalRows, "row")} labelled as a total ${was(totalRows)} left out.` : "") + (written ? ` ${plural2(written, "total or difference", "totals or differences")} written on the workbook's Reconciliation ` +
        `sheet ${was(written)} compared with the calculation.` : ""),
      tables: [
        { name: "Three-way reconciliation", rows: t.summary },
        { name: "Outstanding checks", rows: t.outstandingChecks },
        { name: "Deposits in transit", rows: t.depositsInTransit },
        { name: "Client ledger balances", rows: t.clientLedgers }
      ],
      checks: fromBook ? [...threeWayWorkbookChecks(fromBook, r), ...r.checks] : [...r.checks, ...listChecks]
    };
  },
  examples: [
    {
      label: "The page's worked example: March 31, 2026, two outstanding checks, one deposit in transit, four client ledgers, and the prior-period figures",
      args: {
        asOf: "2026-03-31",
        bankBalance: "48,250.00",
        outstandingChecks: "fixture:law/outstanding-checks.csv",
        depositsInTransit: 'Date,Description,Amount\n2026-03-31,Deposit - closing funds,"2,500.00"\n',
        journalBalance: "49,199.25",
        clientLedgers: "fixture:law/client-balances.csv",
        priorBalance: "41,300.00",
        receipts: "22,400.00",
        disbursements: "14,500.75"
      },
      verified: true,
      contains: ["adjusted bank balance $49,199.25", "2 outstanding checks $1,550.75", "1 deposit in transit $2,500.00", "sum of 4 client ledgers $49,199.25", "The three balances agree at $49,199.25", "= $49,199.25.", "| Difference: adjusted bank − trust journal | 0.00 |", "| Roll-forward balance | 49199.25 |"]
    },
    {
      label: "The page's counter-example: a trust journal of $49,199.24 differs by a cent, so the result is not verified",
      args: {
        asOf: "2026-03-31",
        bankBalance: "48,250.00",
        outstandingChecks: "fixture:law/outstanding-checks.csv",
        depositsInTransit: "Date,Amount\n2026-03-31,2500.00\n",
        journalBalance: "49,199.24",
        clientLedgers: "fixture:law/client-balances.csv"
      },
      verified: false,
      failedCheck: "bank-journal",
      contains: ["adjusted bank − trust journal is $0.01", "trust journal − client ledgers is -$0.01"]
    },
    {
      label: "A client ledger row whose balance cannot be read is not verified",
      args: { bankBalance: "100.00", journalBalance: "100.00", clientLedgers: "Client / Matter,Ledger Balance\nAlder matter,100.00\nBirch estate,1OO.00\n" },
      verified: false,
      failedCheck: "ledgers-rows-read"
    }
  ]
};
function rowCount(value, name, fallback) {
  const raw = txt(value);
  if (raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new AgentInputError(`"${name}" must be a whole number from 1 to 500: "${raw}".`);
  return Number(raw);
}
var template = {
  name: "three_way_reconciliation_template",
  page: "law-trust/three-way-reconciliation-template",
  section: "law-trust",
  kind: "template",
  title: "Three-way trust reconciliation workbook to fill in",
  description: "Builds a blank Excel workbook (.xlsx) laid out for a monthly three-way reconciliation of a law firm's trust (IOLTA) account: a Reconciliation sheet (firm or account, as-of date, bank statement ending balance, the lines for totals and differences, trust journal balance, optional prior-period lines), numbered Outstanding checks, Deposits in transit and Client ledgers sheets, and an Instructions sheet, with client or matter names filled in when given. The finished file is read back before it is handed over: the five sheet names, every Reconciliation line, each list's header and number of rows, and every name are compared with what was asked for, and no cell holds a formula. Use it when someone wants a three-way reconciliation template or spreadsheet to fill in by hand. Not for doing the reconciliation itself, and it makes no statement about what any rule requires.",
  question: "Can you give me a blank three-way reconciliation spreadsheet for our IOLTA account with our client names on it?",
  inputs: [
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name written on the Reconciliation sheet.", required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the reconciliation is for, YYYY-MM-DD, written on the Reconciliation sheet.", required: false },
    { name: "clients", kind: "text", label: "Client or matter names", description: "Optional. Client or matter names, one per line: each line gets its own numbered row on the Client ledgers sheet, in order.", required: false },
    { name: "clientRows", kind: "number", label: "Client ledger rows", description: "Optional. Rows on the Client ledgers sheet, a whole number from 1 to 500; every name given still gets a row. Without it, 20.", required: false },
    { name: "checkRows", kind: "number", label: "Outstanding check rows", description: "Optional. Rows on the Outstanding checks sheet, a whole number from 1 to 500. Without it, 15.", required: false },
    { name: "depositRows", kind: "number", label: "Deposit in transit rows", description: "Optional. Rows on the Deposits in transit sheet, a whole number from 1 to 500. Without it, 5.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds its own layout in generic terms, values only with no formulas; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ values }) {
    const options = {
      account: txt(values.account),
      asOf: txt(values.asOf),
      clients: txt(values.clients).split(/\r?\n/),
      clientRows: rowCount(values.clientRows, "clientRows", 20),
      checkRows: rowCount(values.checkRows, "checkRows", 15),
      depositRows: rowCount(values.depositRows, "depositRows", 5),
      reportUrl: `${SITE_URL}/law-trust/three-way-reconciliation/?src=template`
    };
    const sheets = threeWayTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = verifyThreeWayTemplate(options, readXlsx(bytes));
    const names = threeWayTemplateClients(options.clients);
    const rows = (i) => (sheets[i]?.rows.length ?? 1) - 1;
    const slug = options.account.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return {
      summary: `A workbook of ${plural2(sheets.length, "sheet")}${options.account ? ` for ${options.account.replace(/\s+/g, " ")}` : ""}${options.asOf ? ` as of ${options.asOf}` : ""}: ${plural2(rows(3), "client ledger row")}${names.length ? ` (${names.length} named: ${names.join(", ")})` : ""}, ${plural2(rows(1), "outstanding check row")} and ${plural2(rows(2), "deposit in transit row")}. Every amount is left blank to fill in; values only, no formulas.`,
      tables: [{ name: "What the workbook holds", rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), s.rows.length - 1])] }],
      checks,
      file: { suggestedName: `${["three-way-reconciliation-template", slug].filter(Boolean).join("-")}.xlsx`, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Law Office trust account as of 2026-03-31, four client names, 6 client ledger rows, 5 outstanding check rows, 3 deposit rows",
      args: { account: "Example Law Office trust account", asOf: "2026-03-31", clients: "Alder matter\nBirch estate\nCedar closing\nFirm funds", clientRows: "6", checkRows: "5", depositRows: "3" },
      verified: true,
      contains: ["| Reconciliation | Item, Value | 14 |", "| Outstanding checks | Line, Date, Check number, Payee, Amount | 5 |", "| Deposits in transit | Line, Date, Description, Amount | 3 |", "| Client ledgers | Line, Client or matter, Balance | 6 |", "| Instructions | How this workbook is laid out | 10 |", "4 named: Alder matter, Birch estate, Cedar closing, Firm funds"]
    },
    {
      label: "A name that starts with an equals sign reads back like a formula, so the workbook is not verified",
      args: { account: "=Example Law Office" },
      verified: false,
      failedCheck: "values-only"
    }
  ]
};
var LAW_TRUST = [threeWay, ledgerCard, cashJournal, scanner, rebuild, earnedFees, dormant, template];
var LAW_TRUST_NOT_FOR_AGENTS = [];

export {
  TXN_COLUMNS,
  BALANCE_COLUMNS,
  ITEM_COLUMNS,
  INVOICE_COLUMNS,
  CARRIED_COLUMNS,
  LAW_TRUST,
  LAW_TRUST_NOT_FOR_AGENTS
};
