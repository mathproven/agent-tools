// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  STR_BANK_LABELS,
  STR_BANK_ROLES,
  STR_COMPONENT_ROLES,
  STR_PAYOUT_ROLES,
  STR_ROLE_LABELS,
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader,
  reconcileStrPayouts,
  strExtractBankDeposits,
  strExtractPayoutLines,
  strGuessBankColumns,
  strGuessPayoutColumns,
  strReconcileTables
} from "./strPayout.mjs";
import {
  computeCam,
  computeCamGrossUp,
  grossUpFactorText
} from "./camGrossUp.mjs";
import {
  computeExpenseStop
} from "./expenseStop.mjs";
import {
  CheckList,
  applyRate,
  assertCents,
  formatUSD,
  parseAmount,
  percentToBasisPoints,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/construction/percent.ts
function assertBp(bp) {
  if (!Number.isSafeInteger(bp)) throw new Error("A percent must be a whole number of basis points");
}
function formatPercentBp(bp) {
  assertBp(bp);
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${bp < 0 ? "-" : ""}${whole}.${frac}%`;
}

// packages/core/src/property/ownerLedger.ts
function ownerFeePattern(text2) {
  const t = text2.trim();
  if (!t) return void 0;
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
var LEDGER_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "post date", "paid date", "entry date"],
  description: ["description", "memo", "details", "detail", "payee", "name", "notes", "note", "item"],
  amount: ["amount", "total", "net amount", "value"],
  type: ["type", "category", "kind", "account type", "transaction type", "class"]
};
function guessLedgerRow(header) {
  const names = header.map(pmNormalizeHeader);
  const taken = /* @__PURE__ */ new Set();
  const find = (role) => {
    for (const exact of [true, false]) {
      for (const syn of LEDGER_SYNONYMS[role]) {
        const i = names.findIndex((n, idx) => !taken.has(idx) && n !== "" && (exact ? n === syn : ` ${n} `.includes(` ${syn} `)));
        if (i >= 0) {
          taken.add(i);
          return i;
        }
      }
    }
    return -1;
  };
  const date = find("date");
  const amount = find("amount");
  const type = find("type");
  const description = find("description");
  return { date, description, amount, type };
}
function guessOwnerLedgerColumns(rows) {
  let best = { headerRow: Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== ""))), date: -1, description: -1, amount: -1, type: -1 };
  let bestScore = 1;
  rows.slice(0, 25).forEach((row, i) => {
    const g = guessLedgerRow(row);
    const score = [g.date, g.description, g.amount, g.type].filter((c) => c >= 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: i, ...g };
    }
  });
  return best;
}
var AMBIGUOUS_TYPE_WORDS = /\b(payments?|charges?|credits?|debits?|deposits?|checks?|cheques?|refunds?)\b/;
function ownerLedgerKind(typeText) {
  const t = pmNormalizeHeader(typeText);
  if (!t || AMBIGUOUS_TYPE_WORDS.test(t)) return void 0;
  if (/\b(distribution|distributions|draw|draws|owner payout|owner disbursement)\b/.test(t)) return "distribution";
  if (/\b(expense|expenses|bill|bills|repair|repairs|cost|costs)\b/.test(t)) return "expense";
  if (/\b(income|rent|revenue|receipt|receipts|collected)\b/.test(t)) return "income";
  return void 0;
}
var DISTRIBUTION_WORDS = /\b(owner (draw|distribution|payout|payment|disbursement)|distribution)\b/i;
function ownerLedgerSkipChecks(skipped, dismissed = []) {
  if (skipped.length === 0) return [{ id: "ledger-skipped", label: "Every row in the ledger file was imported", passed: true, severity: "error" }];
  const out = new Set(dismissed);
  return skipped.map((s) => {
    if (s.kind === "zero") return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file has an amount`, passed: false, severity: "warning", detail: "zero amount; not imported" };
    if (s.kind === "type-skip" || out.has(s.rowNumber)) return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file was left out by your choice`, passed: false, severity: "warning", detail: s.reason };
    return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file was imported`, passed: false, severity: "error", detail: `not imported: ${s.reason}` };
  });
}
function isUnusedLedgerRow(row, mapping) {
  const cell = (col) => col >= 0 ? (row[col] ?? "").trim() : "";
  if (row.every((c) => c.trim() === "")) return true;
  return !cell(mapping.date) && !cell(mapping.description) && /^0*(\.0*)?$/.test(cell(mapping.amount));
}
var rowList = (rows) => `${rows.length === 1 ? "row" : "rows"} ${rows.slice(0, 8).join(", ")}${rows.length > 8 ? ", …" : ""}`;
function extractOwnerLedger(rows, mapping, options = {}) {
  if (mapping.date < 0) throw new Error("Choose which column holds the date.");
  if (mapping.amount < 0) throw new Error("Choose which column holds the amount.");
  const cell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
  const typeMap = options.typeMap ?? {};
  const parsed = [];
  const skipped = [];
  const unknown = /* @__PURE__ */ new Map();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || isUnusedLedgerRow(row, mapping)) return;
    const rawDate = cell(row, mapping.date);
    const rawAmount = cell(row, mapping.amount);
    const rowNumber = index + 1;
    if (!rawDate) return void skipped.push({ rowNumber, kind: "date", reason: "no date" });
    if (!rawAmount) return void skipped.push({ rowNumber, kind: "amount", reason: "no amount" });
    let date;
    let amount;
    try {
      date = pmCellToIsoDate(rawDate, options.dateOrder ?? "mdy");
    } catch {
      return void skipped.push({ rowNumber, kind: "date", reason: `the date "${rawDate}" could not be read` });
    }
    try {
      amount = pmCellToCents(rawAmount, { crIsNegative: false });
    } catch {
      return void skipped.push({ rowNumber, kind: "amount", reason: `the amount "${rawAmount}" could not be read` });
    }
    if (amount === 0) return void skipped.push({ rowNumber, kind: "zero", reason: "zero amount" });
    const description = cell(row, mapping.description);
    if (mapping.type >= 0) {
      const typeText = cell(row, mapping.type);
      const key = pmNormalizeHeader(typeText);
      const chosen = Object.prototype.hasOwnProperty.call(typeMap, key) ? typeMap[key] : void 0;
      const kind = chosen ?? ownerLedgerKind(typeText);
      if (kind === "skip") return void skipped.push({ rowNumber, kind: "type-skip", reason: typeText ? `rows of type "${typeText}" are left out` : "rows with no type are left out" });
      if (!kind) {
        const seen = unknown.get(key);
        if (seen) seen.rows += 1;
        else unknown.set(key, { key, text: typeText, rows: 1 });
        return void skipped.push({ rowNumber, kind: "type", reason: typeText ? `the type "${typeText}" is not recognized as income, expense, or distribution` : "no type" });
      }
      parsed.push({ rowNumber, date, description, amount, kind, hasType: true });
    } else {
      const kind = amount > 0 ? "income" : DISTRIBUTION_WORDS.test(description) ? "distribution" : "expense";
      parsed.push({ rowNumber, date, description, amount, kind, hasType: false });
    }
  });
  const typedOut = parsed.filter((p) => p.hasType && p.kind !== "income");
  const negativeRows = typedOut.filter((p) => p.amount < 0).map((p) => p.rowNumber);
  const positiveRows = typedOut.filter((p) => p.amount > 0).map((p) => p.rowNumber);
  const fixed = options.outflowSign === "negative" || options.outflowSign === "positive" ? options.outflowSign : null;
  const outflowSign = fixed ?? (typedOut.length === 0 ? "none" : negativeRows.length && positiveRows.length ? "mixed" : negativeRows.length ? "negative" : "positive");
  const outflowSignFrom = fixed ? "option" : "file";
  const unknownTypes = [...unknown.values()];
  const dismissed = options.dismissedRows ?? [];
  const checks = new CheckList();
  checks.addAll(ownerLedgerSkipChecks(skipped, dismissed));
  if (outflowSign === "mixed") {
    checks.that(
      "ledger-signs",
      "Expense and distribution rows are all written with the same sign",
      false,
      `${rowList(negativeRows)} ${negativeRows.length === 1 ? "is" : "are"} negative and ${rowList(positiveRows)} ${positiveRows.length === 1 ? "is" : "are"} positive, so the file does not show which is the normal way and which is a refund or reversal. Nothing was imported. Choose how this file writes expenses.`
    );
    return { income: [], expenses: [], distributions: [], skipped, placed: [], outflowSign, outflowSignFrom, reversals: [], unknownTypes, checks: checks.all };
  }
  const income = [];
  const expenses = [];
  const distributions = [];
  const placed = [];
  const reversals = [];
  for (const p of parsed) {
    let amount = p.amount;
    if (p.kind !== "income" && (!p.hasType || outflowSign === "negative")) amount = -amount;
    const entry = { date: p.date, description: p.description, amount };
    if (p.kind === "income") income.push(entry);
    else if (p.kind === "expense") expenses.push(entry);
    else distributions.push(entry);
    const place = { rowNumber: p.rowNumber, kind: p.kind, amount };
    placed.push(place);
    if (p.kind !== "income" && p.hasType && amount < 0) reversals.push(place);
  }
  const extract = { income, expenses, distributions, skipped, placed, outflowSign, outflowSignFrom, reversals, unknownTypes, checks: [] };
  if (reversals.length) {
    checks.that(
      "ledger-reversals",
      `Every expense and distribution row is written as a ${outflowSign} number`,
      false,
      `${rowList(reversals.map((r) => r.rowNumber))} ${reversals.length === 1 ? "is" : "are"} written the other way and ${reversals.length === 1 ? "was" : "were"} imported as a reversal (a negative line that reduces its total)`,
      "warning"
    );
  }
  checks.addAll(verifyOwnerLedger(rows, mapping, extract));
  extract.checks = checks.all;
  return extract;
}
function verifyOwnerLedger(rows, mapping, x) {
  const checks = new CheckList();
  const seen = /* @__PURE__ */ new Map();
  for (const n of [...x.placed.map((p) => p.rowNumber), ...x.skipped.map((s) => s.rowNumber)]) seen.set(n, (seen.get(n) ?? 0) + 1);
  const bad = [];
  const dataRows = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || isUnusedLedgerRow(row, mapping)) return;
    dataRows.add(index + 1);
    const times = seen.get(index + 1) ?? 0;
    if (times !== 1) bad.push(`row ${index + 1} is accounted for ${times} time(s)`);
  });
  for (const n of seen.keys()) if (!dataRows.has(n)) bad.push(`row ${n} is not a data row of the file`);
  checks.that("ledger-rows", "Every data row of the ledger file is either imported once or listed as left out once", bad.length === 0, bad.slice(0, 5).join("; "));
  const wrong = [];
  const typed = mapping.type >= 0;
  for (const p of x.placed) {
    let raw;
    try {
      raw = pmCellToCents((rows[p.rowNumber - 1]?.[mapping.amount] ?? "").trim(), { crIsNegative: false });
    } catch {
      wrong.push(`row ${p.rowNumber}: the cell is not an amount`);
      continue;
    }
    const expected = p.kind === "income" ? raw : !typed || x.outflowSign === "negative" ? -raw : raw;
    if (BigInt(expected) !== BigInt(p.amount)) wrong.push(`row ${p.rowNumber}: the cell gives ${toDecimal(expected)}, the import holds ${toDecimal(p.amount)}`);
    else if (!typed && raw > 0 !== (p.kind === "income")) wrong.push(`row ${p.rowNumber}: placed against its sign`);
    else if (typed && p.kind !== "income" && x.outflowSignFrom === "file" && p.amount < 0) wrong.push(`row ${p.rowNumber}: stored as a reversal although no sign convention was chosen`);
  }
  checks.that("ledger-amounts", "Every imported amount agrees with its cell in the file, read a second time", wrong.length === 0, wrong.slice(0, 5).join("; "));
  const lists = [["income", x.income], ["expense", x.expenses], ["distribution", x.distributions]];
  const off = [];
  for (const [kind, list] of lists) {
    const want = x.placed.filter((p) => p.kind === kind).map((p) => p.amount);
    const have = list.map((e) => e.amount);
    const total = (values) => values.reduce((a, v) => a + BigInt(v), 0n);
    if (want.length !== have.length || total(want) !== total(have) || want.some((v, i) => v !== have[i])) off.push(`${kind}: ${want.length} row(s) placed totaling ${total(want)} cents, list holds ${have.length} totaling ${total(have)} cents`);
  }
  checks.that("ledger-lists", "The income, expense, and distribution lists hold exactly the imported rows", off.length === 0, off.join("; "));
  return checks.all;
}
function bpText(feeBp) {
  const whole = Math.floor(feeBp / 100);
  const frac = feeBp % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}
function ownerFeeRateText(managementFeeBp) {
  return bpText(managementFeeBp);
}
function ownerStatementTables(r) {
  const d2 = toDecimal;
  const i = r.input;
  const lines = (entries, total) => [
    ["Date", "Description", "Amount"],
    ...entries.map((e) => [e.date, e.description, d2(e.amount)]),
    ["", "Total", d2(total)]
  ];
  const summary = [
    ["Owner statement", "Amount"],
    ["Opening balance", d2(i.openingBalance)],
    ["Income collected", d2(r.totalIncome)],
    ["Expenses paid", d2(-r.totalExpenses)],
    [`Management fee (${bpText(i.managementFeeBp)} of ${d2(r.feeBase)})`, d2(-r.managementFee)],
    ["Paid to owner", d2(-r.totalDistributions)],
    ["Closing balance", d2(r.closingBalance)]
  ];
  if (i.reserve !== void 0) summary.push(["Reserve held (included in closing balance)", d2(i.reserve)]);
  return { summary, income: lines(i.income, r.totalIncome), expenses: lines(i.expenses, r.totalExpenses), distributions: lines(i.distributions, r.totalDistributions) };
}

// packages/core/src/property/ownerStatement.ts
function computeOwnerStatement(input) {
  const all = [...input.income, ...input.expenses, ...input.distributions];
  for (const e of all) assertCents(e.amount, `"${e.description}" on ${e.date}`);
  const totalIncome = sum(input.income.map((e) => e.amount));
  const totalExpenses = sum(input.expenses.map((e) => e.amount));
  const totalDistributions = sum(input.distributions.map((e) => e.amount));
  const pattern = input.feeOnIncomeMatching ? new RegExp(input.feeOnIncomeMatching.source, input.feeOnIncomeMatching.flags.replace(/[gy]/g, "")) : null;
  const feeLines = input.income.filter((e) => !pattern || pattern.test(e.description));
  const feeBase = sum(feeLines.map((e) => e.amount));
  const managementFee = applyRate(feeBase, input.managementFeeBp);
  const closingBalance = input.openingBalance + totalIncome - totalExpenses - managementFee - totalDistributions;
  const B = BigInt;
  const signed = [
    ...input.income.map((e) => ({ date: e.date, amt: B(e.amount) })),
    ...input.expenses.map((e) => ({ date: e.date, amt: -B(e.amount) })),
    ...input.distributions.map((e) => ({ date: e.date, amt: -B(e.amount) }))
  ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let walk = B(input.openingBalance);
  for (const line of signed) walk += line.amt;
  let base2 = 0n;
  for (const e of input.income) if (!pattern || new RegExp(pattern.source, pattern.flags).test(e.description)) base2 += B(e.amount);
  const product = base2 * B(input.managementFeeBp);
  const magnitude = product < 0n ? -product : product;
  const rounded = magnitude / 10000n + (magnitude % 10000n * 2n >= 10000n ? 1n : 0n);
  const fee2 = product < 0n ? -rounded : rounded;
  walk -= fee2;
  const checks = new CheckList();
  checks.that("roll-forward", "Opening + income − expenses − fee − distributions = closing (checked a second way)", B(closingBalance) === walk, `second pass gives ${formatUSD(Number(walk))}`);
  checks.that("fee", "Management fee = rate × fee-eligible income (checked a second way)", B(managementFee) === fee2, `second pass gives ${formatUSD(Number(fee2))}`);
  const negatives = all.filter((e) => e.amount < 0);
  checks.that("positive-entries", "All income, expense, and distribution lines are positive amounts", negatives.length === 0, `${negatives.length} negative line(s); enter refunds as their own lines`, "warning");
  const outside = all.filter((e) => e.date < input.periodStart || e.date > input.periodEnd);
  checks.that("dates-in-period", "Every line falls inside the statement period", outside.length === 0, `${outside.length} line(s) outside the period`, "warning");
  if (input.reserve !== void 0) {
    checks.that("reserve-kept", "Closing balance covers the reserve", closingBalance >= input.reserve, `Closing balance is below the ${formatUSD(input.reserve)} reserve`, "warning");
  }
  checks.that("no-overdraw", "Closing balance is not negative", closingBalance >= 0, "The owner was paid more than the property had available");
  return { input, totalIncome, totalExpenses, feeBase, managementFee, totalDistributions, closingBalance, checks: checks.all };
}

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
function formatCivilDate(d2) {
  return `${String(d2.year).padStart(4, "0")}-${String(d2.month).padStart(2, "0")}-${String(d2.day).padStart(2, "0")}`;
}
function civilDayNumber(d2) {
  const y = d2.month <= 2 ? d2.year - 1 : d2.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (d2.month + (d2.month > 2 ? -3 : 9)) + 2) / 5) + d2.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function calendarDaysBetween(fromIso, toIso) {
  return civilDayNumber(parseCivilDate(toIso, "end date")) - civilDayNumber(parseCivilDate(fromIso, "start date"));
}
function anniversary(iso, years) {
  if (!Number.isSafeInteger(years) || years < 0) throw new Error("Years must be a whole number, zero or more.");
  const d2 = parseCivilDate(iso);
  const year = d2.year + years;
  return formatCivilDate({ year, month: d2.month, day: Math.min(d2.day, daysInMonth(year, d2.month)) });
}

// packages/core/src/property/securityDeposit.ts
var DEPOSIT_DAY_COUNT = "actual days / 365";
var YEAR_DAYS = 365n;
var BP = 10000n;
var MAX_DEPOSIT_RATE_BP = 1e4;
function roundDiv(numerator, denominator) {
  const q = numerator / denominator;
  return 2n * (numerator % denominator) >= denominator ? q + 1n : q;
}
function toCents(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} is too large to calculate.`);
  return assertCents(Number(value), label);
}
function simpleInterestCents(principal, rateBp, days) {
  return toCents(roundDiv(BigInt(principal) * BigInt(rateBp) * BigInt(days), YEAR_DAYS * BP), "interest");
}
function simpleInterestCentsSecondPath(principal, rateBp, days, yearDays = 365) {
  const year = BigInt(yearDays);
  const yearProduct = BigInt(principal) * BigInt(rateBp);
  const yearWholeCents = yearProduct / BP;
  const yearRemainder = yearProduct % BP;
  const d2 = BigInt(days);
  const spread = yearWholeCents * d2;
  const wholeCents = spread / year;
  const carried = spread % year * BP + yearRemainder * d2;
  return toCents(wholeCents + roundDiv(carried, year * BP), "interest");
}
function daysByCalendarWalk(fromIso, toIso) {
  const a = parseCivilDate(fromIso);
  const b = parseCivilDate(toIso);
  const dayOfYear = (y, m, d2) => {
    let n = d2;
    for (let month = 1; month < m; month++) n += daysInMonth(y, month);
    return n;
  };
  let total = dayOfYear(b.year, b.month, b.day) - dayOfYear(a.year, a.month, a.day);
  for (let y = a.year; y < b.year; y++) total += isLeapYear(y) ? 366 : 365;
  for (let y = b.year; y < a.year; y++) total -= isLeapYear(y) ? 366 : 365;
  return total;
}
function accrueSimple(principal, rateBp, from, to, days) {
  const interest = simpleInterestCents(principal, rateBp, days);
  const wholeBlocks = Math.floor(days / 365);
  return {
    interest,
    fullYears: wholeBlocks,
    remainingDays: days - wholeBlocks * 365,
    periods: days > 0 ? [{ label: `Simple interest, ${days} days`, from, to, days, base: principal, interest }] : []
  };
}
var OVERPAID = "An interest payment is larger than the deposit balance on its date. Check the payment amounts and dates.";
function accrueCompound(principal, rateBp, from, to, paid) {
  const rate = BigInt(rateBp);
  const dated = paid.filter((p) => p.date !== "" && p.date >= from && p.date < to).sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  let balance = BigInt(principal);
  let nextPayment = 0;
  let total = 0n;
  const periods = [];
  const span = (label, start2, end, yearDays) => {
    let cursor = start2;
    let earned = 0n;
    const parts = [];
    for (; ; ) {
      while (nextPayment < dated.length && dated[nextPayment].date <= cursor) {
        balance -= BigInt(dated[nextPayment].amount);
        nextPayment++;
        if (balance < 0n) throw new Error(OVERPAID);
      }
      const cut = nextPayment < dated.length && dated[nextPayment].date < end ? dated[nextPayment].date : end;
      const days = calendarDaysBetween(cursor, cut);
      const interest = roundDiv(balance * rate * BigInt(days), yearDays * BP);
      if (days > 0) parts.push({ label, from: cursor, to: cut, days, base: toCents(balance, "balance"), interest: toCents(interest, "interest") });
      earned += interest;
      cursor = cut;
      if (cursor >= end) break;
    }
    parts.forEach((part, i) => periods.push(parts.length > 1 ? { ...part, label: `${label}, part ${i + 1}` } : part));
    return earned;
  };
  let years = 0;
  let start = from;
  for (; ; ) {
    const next = anniversary(from, years + 1);
    if (next > to) break;
    const interest = span(`Year ${years + 1}`, start, next, BigInt(calendarDaysBetween(start, next)));
    balance += interest;
    total += interest;
    start = next;
    years++;
  }
  const remainingDays = calendarDaysBetween(start, to);
  total += span(`Final ${remainingDays} days`, start, to, YEAR_DAYS);
  return { interest: toCents(total, "interest"), fullYears: years, remainingDays, periods };
}
function compoundSecondPath(principal, rateBp, from, to, paid) {
  const a = parseCivilDate(from);
  const b = parseCivilDate(to);
  let years = b.year - a.year;
  const anniversaryDay = Math.min(a.day, daysInMonth(b.year, a.month));
  if (b.month < a.month || b.month === a.month && b.day < anniversaryDay) years--;
  if (years < 0) years = 0;
  const firstDay = civilDayNumber(a);
  const lastDay = civilDayNumber(b);
  const bounds = [firstDay];
  for (let i = 1; i <= years; i++) bounds.push(civilDayNumber({ year: a.year + i, month: a.month, day: Math.min(a.day, daysInMonth(a.year + i, a.month)) }));
  bounds.push(lastDay);
  const events = paid.filter((x) => x.date !== "").map((x) => ({ day: civilDayNumber(parseCivilDate(x.date)), amount: x.amount })).filter((e2) => e2.day >= firstDay && e2.day < lastDay).sort((x, y) => x.day - y.day);
  let balance = principal;
  let total = 0;
  let e = 0;
  for (let k = 0; k <= years; k++) {
    const spanStart = bounds[k];
    const spanEnd = bounds[k + 1];
    const yearDays = k < years ? spanEnd - spanStart : 365;
    let cursor = spanStart;
    let earned = 0;
    for (; ; ) {
      while (e < events.length && events[e].day <= cursor) {
        balance = assertCents(balance - events[e].amount, "balance");
        e++;
        if (balance < 0) throw new Error(OVERPAID);
      }
      const cut = e < events.length && events[e].day < spanEnd ? events[e].day : spanEnd;
      earned = assertCents(earned + simpleInterestCentsSecondPath(balance, rateBp, cut - cursor, yearDays), "interest");
      cursor = cut;
      if (cursor >= spanEnd) break;
    }
    total = assertCents(total + earned, "interest");
    if (k < years) balance = assertCents(balance + earned, "balance");
  }
  return { interest: total, fullYears: years };
}
function validateDepositInput(input) {
  assertCents(input.deposit, "deposit");
  if (input.deposit <= 0) throw new Error("Enter the deposit amount as a number above zero.");
  if (!Number.isSafeInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > MAX_DEPOSIT_RATE_BP) {
    throw new Error("The annual interest rate must be between 0% and 100%, with at most two decimal places.");
  }
  if (input.method !== "simple" && input.method !== "compound-annual") throw new Error("Choose simple interest or interest compounded annually.");
  parseCivilDate(input.receivedOn, "date received");
  parseCivilDate(input.moveOutOn, "move-out date");
  for (const p of input.interestPaid ?? []) {
    assertCents(p.amount, "interest already paid");
    if (p.date) parseCivilDate(p.date, "interest payment date");
  }
  for (const d2 of input.deductions) assertCents(d2.amount, `deduction "${d2.description}"`);
  if (input.statedInterest !== void 0) assertCents(input.statedInterest, "stated interest");
  if (input.statedBalance !== void 0) assertCents(input.statedBalance, "stated balance");
}
function computeSecurityDeposit(input) {
  validateDepositInput(input);
  const paid = input.interestPaid ?? [];
  const rawDays = calendarDaysBetween(input.receivedOn, input.moveOutOn);
  const ordered = rawDays > 0;
  const days = ordered ? rawDays : 0;
  const to = ordered ? input.moveOutOn : input.receivedOn;
  const accrual = input.method === "simple" ? accrueSimple(input.deposit, input.rateBp, input.receivedOn, to, days) : accrueCompound(input.deposit, input.rateBp, input.receivedOn, to, paid);
  const interestEarned = accrual.interest;
  const interestPaid = sum(paid.map((p) => p.amount));
  const deductionsTotal = sum(input.deductions.map((d2) => d2.amount));
  const balance = assertCents(input.deposit + interestEarned - interestPaid - deductionsTotal, "balance");
  const refund = balance > 0 ? balance : 0;
  const tenantOwes = balance < 0 ? -balance : 0;
  const result = { input, days, fullYears: accrual.fullYears, remainingDays: accrual.remainingDays, periods: accrual.periods, interestEarned, interestPaid, deductionsTotal, balance, refund, tenantOwes };
  return { ...result, checks: verifySecurityDeposit(result) };
}
function verifySecurityDeposit(r) {
  const input = r.input;
  validateDepositInput(input);
  const paid = input.interestPaid ?? [];
  const walked = daysByCalendarWalk(input.receivedOn, input.moveOutOn);
  const ordered = walked > 0;
  const days = ordered ? walked : 0;
  const to = ordered ? input.moveOutOn : input.receivedOn;
  const second = input.method === "simple" ? { interest: simpleInterestCentsSecondPath(input.deposit, input.rateBp, days), fullYears: null } : compoundSecondPath(input.deposit, input.rateBp, input.receivedOn, to, paid);
  const checks = new CheckList();
  checks.that("dates-order", "Move-out date is after the date the deposit was received", ordered, `Received ${input.receivedOn}, move-out ${input.moveOutOn}; no interest is figured until the dates are in order`);
  checks.equal("days-recounted", `Days held, counted two ways (${DEPOSIT_DAY_COUNT})`, r.days, days);
  checks.equal("periods-cover-days", "Interest periods cover every day held, with no gap or overlap", r.days, r.periods.reduce((a, p) => a + p.days, 0));
  const interestOk = checks.cents(
    "interest-recomputed",
    input.method === "simple" ? "Interest recomputed in a different order of operations matches" : "Compound interest recomputed by a second, independent pass matches",
    r.interestEarned,
    second.interest
  );
  if (!interestOk) {
    checks.that("interest-difference", "The two interest calculations agree", false, "The first figure (the single-division or year-by-year pass) is the one shown; a difference means the result cannot be relied on");
  }
  if (second.fullYears !== null) checks.equal("years-recounted", "Anniversaries counted two ways", r.fullYears, second.fullYears);
  checks.cents("periods-total", "Interest by period adds up to interest earned", r.interestEarned, sum(r.periods.map((p) => p.interest)));
  const negativeDeductions = input.deductions.filter((d2) => d2.amount < 0);
  checks.that("no-negative-deductions", "No deduction is negative", negativeDeductions.length === 0, `${negativeDeductions.length} deduction(s) below zero: ${negativeDeductions.map((d2) => d2.description || "unnamed").join(", ")}`);
  const negativePaid = paid.filter((p) => p.amount < 0);
  checks.that("no-negative-interest-paid", "No interest payment is negative", negativePaid.length === 0, `${negativePaid.length} interest payment(s) below zero`);
  let pass = BigInt(input.deposit) + BigInt(second.interest);
  let deductions = 0n;
  let paidOut = 0n;
  for (let i = input.deductions.length - 1; i >= 0; i--) deductions += BigInt(input.deductions[i].amount);
  for (let i = paid.length - 1; i >= 0; i--) paidOut += BigInt(paid[i].amount);
  pass -= deductions + paidOut;
  const balanceLabel = "Deposit + interest earned - interest already paid - deductions = balance (second pass)";
  if (BigInt(r.deductionsTotal) !== deductions || BigInt(r.interestPaid) !== paidOut) {
    checks.that("balance", balanceLabel, false, `The totals shown (interest already paid ${formatUSD(r.interestPaid)}, deductions ${formatUSD(r.deductionsTotal)}) do not match their lines`);
  } else {
    checks.cents("balance", balanceLabel, r.balance, toCents(pass, "balance"));
  }
  const split = r.refund >= 0 && r.tenantOwes >= 0 && (r.refund === 0 || r.tenantOwes === 0);
  if (split) checks.cents("refund-or-owed", "Amount to return minus balance the tenant owes equals the balance", r.balance, r.refund - r.tenantOwes);
  else checks.that("refund-or-owed", "Amount to return minus balance the tenant owes equals the balance", false, "Only one of the two can be above zero, and neither can be negative");
  if (input.statedInterest !== void 0) checks.cents("stated-interest", "Interest on the existing statement matches the calculated interest", r.interestEarned, input.statedInterest);
  if (input.statedBalance !== void 0) checks.cents("stated-balance", "Balance on the existing statement matches the calculated balance", r.balance, input.statedBalance);
  const compound = input.method === "compound-annual";
  const outside = paid.filter((p) => p.date && (p.date < input.receivedOn || p.date > input.moveOutOn));
  checks.that(
    "interest-paid-dates",
    "Interest payments are dated within the tenancy",
    outside.length === 0,
    `${outside.length} payment(s) dated outside ${input.receivedOn} to ${input.moveOutOn}${compound ? "; they were not taken out of the compounding balance" : ""}`,
    "warning"
  );
  if (compound) {
    const undated = paid.filter((p) => !p.date && p.amount !== 0);
    checks.that(
      "interest-paid-undated",
      "Every interest payment has a date, so it can be taken out of the compounding balance from that date",
      undated.length === 0,
      `${undated.length} payment(s) have no date and were not taken out of the compounding balance, so the interest shown is higher than it would be with the dates entered`,
      "warning"
    );
  }
  checks.that("interest-paid-within-earned", "Interest already paid does not exceed interest earned", r.interestPaid <= r.interestEarned, `Paid ${formatUSD(r.interestPaid)} against ${formatUSD(r.interestEarned)} earned`, "warning");
  checks.that("refund-not-negative", "Deductions do not exceed the deposit plus unpaid interest", r.balance >= 0, `The tenant owes ${formatUSD(r.tenantOwes)}`, "warning");
  return checks.all;
}

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d2, p, m) {
  var o = p / 8 | 0;
  return (d2[o] | d2[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d2, p) {
  var o = p / 8 | 0;
  return (d2[o] | d2[o + 1] << 8 | d2[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d2 = dm[bits16(dat, pos) & dms], dsym = d2 >> 4;
        if (!d2)
          err(3);
        pos += d2 & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d2, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d2[o] |= v;
  d2[o + 1] |= v >> 8;
};
var wbits16 = function(d2, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d2[o] |= v;
  d2[o + 1] |= v >> 8;
  d2[o + 2] |= v >> 16;
};
var hTree = function(d2, mb) {
  var t = [];
  for (var i = 0; i < d2.length; ++i) {
    if (d2[i])
      t.push({ s: i, f: d2[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1; i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (; i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d2) {
  return n.s == -1 ? Math.max(ln(n.l, l, d2 + 1), ln(n.r, l, d2 + 1)) : l[n.s] = d2;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0; i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0; i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i = 0; i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0; i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0; i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0; i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0; i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i2) {
      return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d2 = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d2 = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d2) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d2];
          var lin = revfl[l] & 31, din = revfd[d2] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0; i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d2) {
      var cr = c;
      for (var i = 0; i < d2.length; ++i)
        cr = crct[cr & 255 ^ d2[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d2, b) {
  return d2[b] | d2[b + 1] << 8;
};
var b4 = function(d2, b) {
  return (d2[b] | d2[b + 1] << 8 | d2[b + 2] << 16 | d2[b + 3] << 24) >>> 0;
};
var b8 = function(d2, b) {
  return b4(d2, b) + b4(d2, b + 4) * 4294967296;
};
var wbytes = function(d2, b, v) {
  for (; v; ++b)
    d2[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d2, p, t, o) {
  for (var k in d2) {
    var val = d2[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d2) {
  for (var r = "", i = 0; ; ) {
    var c = d2[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d2.length)
      return { s: r, r: slc(d2, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d2[i++] & 63) << 12 | (d2[i++] & 63) << 6 | d2[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d2[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d2[i++] & 63) << 6 | d2[i++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0; i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d2, b) {
  return b + 30 + b2(d2, b + 26) + b2(d2, b + 28);
};
var zh = function(d2, b, z) {
  var fnl = b2(d2, b + 28), efl = b2(d2, b + 30), fn = strFromU8(d2.subarray(b + 46, b + 46 + fnl), !(b2(d2, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d2, es, efl, z, b4(d2, b + 20), b4(d2, b + 24), b4(d2, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d2, b + 10), sc, su, fn, es + efl + b2(d2, b + 32), off];
};
var z64hs = function(d2, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d2, b + 2)) {
      if (b2(d2, b) == 1) {
        return [
          nsc ? b8(d2, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d2, b + 4) : su,
          noff ? b8(d2, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d2, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d2, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d2[b++] = 20, d2[b++] = f.os;
  d2[b] = 20, b += 2;
  d2[b++] = f.flag << 1 | (c < 0 && 8), d2[b++] = u && 8;
  d2[b++] = f.compression & 255, d2[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d2, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d2, b, f.crc);
    wbytes(d2, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d2, b + 8, f.size);
  }
  wbytes(d2, b + 12, fl2);
  wbytes(d2, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d2, b, col);
    wbytes(d2, b + 6, f.attrs);
    wbytes(d2, b + 10, ce), b += 14;
  }
  d2.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d2, b, +k);
      wbytes(d2, b + 2, l);
      d2.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d2.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d2, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d2);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d2 = compression ? deflateSync(file, p) : file, l = d2.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d2,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i = 0; i < files.length; ++i) {
    var f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// packages/core/src/xlsx.ts
var DECIMAL_2 = /^-?\d+\.\d{2}$/;
function xmlEscape(s) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
function sheetNames(sheets) {
  const used = /* @__PURE__ */ new Set();
  return sheets.map((s, i) => {
    let name = s.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function moneyColumns(sheet) {
  const cols = /* @__PURE__ */ new Set();
  const head = sheet.rows[0] ?? [];
  const body = sheet.rows.slice(1);
  if (sheet.money && sheet.money !== "auto") {
    head.forEach((h, i) => {
      if (typeof h === "string" && sheet.money.includes(h)) cols.add(i);
    });
    return cols;
  }
  for (let i = 0; i < head.length; i++) {
    let filled = 0;
    let ok = true;
    for (const row of body) {
      const c = row[i];
      if (c === null || c === void 0 || c === "") continue;
      filled++;
      if (typeof c !== "string" || !DECIMAL_2.test(c)) {
        ok = false;
        break;
      }
    }
    if (ok && filled > 0) cols.add(i);
  }
  return cols;
}
function sheetXml(sheet) {
  const money = moneyColumns(sheet);
  const colCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = [];
  for (let i = 0; i < colCount; i++) {
    const given = sheet.widths?.[i];
    if (given) {
      widths.push(given);
      continue;
    }
    let w = 8;
    for (const row of sheet.rows.slice(0, 200)) w = Math.max(w, String(row[i] ?? "").length + 2);
    widths.push(Math.min(w, 60));
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === void 0 || cell === "") return "";
      const ref = `${columnName(c)}${r + 1}`;
      const style = r === 0 ? 1 : 0;
      if (r > 0 && money.has(c) && typeof cell === "string" && DECIMAL_2.test(cell)) return `<c r="${ref}" s="2"><v>${cell}</v></c>`;
      if (typeof cell === "number" && Number.isSafeInteger(cell)) return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(cell))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + (cols ? `<cols>${cols}</cols>` : "") + `<sheetData>${rows}</sheetData></worksheet>`;
}
var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
function writeXlsx(sheets, fixedDate = new Date(Date.UTC(2020, 0, 1))) {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet");
  const names = sheetNames(sheets);
  const files = {};
  const put = (path, xml) => {
    files[path] = strToU8(xml);
  };
  put(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"
  );
  put(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
  );
  put(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  put("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipSync(files, { level: 6, mtime: fixedDate });
}
function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d2) => String.fromCodePoint(parseInt(d2, 10))).replace(/&amp;/g, "&");
}
function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? xmlUnescape(m[1] ?? m[2] ?? "") : void 0;
}
function textOf(xml) {
  const cleaned = xml.replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while (m = re.exec(cleaned)) out += xmlUnescape(m[1] ?? "");
  return out;
}
var MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
var MAX_ROWS = 1048576;
var DAYS_1904 = 1462;
var BUILT_IN_DATE_FORMATS = /* @__PURE__ */ new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\[(h+|m+|s+)\]/gi, "h").replace(/\[[^\]]*\]/g, "");
  return /[dy]/i.test(c) || /m/i.test(c) && !/[hs]/i.test(c);
}
function dateStyles(styles) {
  const out = /* @__PURE__ */ new Set();
  if (!styles) return out;
  const custom = /* @__PURE__ */ new Map();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  let index = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id);
    if (code !== void 0 ? isDateFormat(code) : BUILT_IN_DATE_FORMATS.has(id)) out.add(index);
    index++;
  }
  return out;
}
function readXlsx(bytes) {
  let files;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("too large");
        return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name);
      }
    });
  } catch (err2) {
    throw new Error(err2 instanceof Error && err2.message === "too large" ? "This workbook is too large to open here." : "This file is not a readable .xlsx workbook.");
  }
  const read = (path) => {
    const f = files[path];
    return f ? strFromU8(f) : void 0;
  };
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("This file is not a readable .xlsx workbook.");
  const workbookPr = /<workbookPr\s[^>]*>/.exec(workbook);
  const date1904 = workbookPr ? /^(1|true)$/.test(attr(workbookPr[0], "date1904") ?? "") : false;
  const dated = date1904 ? dateStyles(read("xl/styles.xml")) : /* @__PURE__ */ new Set();
  const shared = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) {
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m;
    while (m = re.exec(sst)) shared.push(textOf(m[1] ?? ""));
  }
  const targets = /* @__PURE__ */ new Map();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], "r:id");
    const xml = rid ? read(targets.get(rid) ?? "") : void 0;
    if (xml === void 0) continue;
    const rows = [];
    let width = 0;
    let nextRow = 0;
    const body = xml.replace(/<row(\s[^>]*)?\/>/g, "");
    for (const rm of body.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const rAttr = rm[1] ? attr(rm[1], "r") : void 0;
      const rowIndex = rAttr && /^\d{1,7}$/.test(rAttr) ? Number(rAttr) - 1 : nextRow;
      if (rowIndex < 0 || rowIndex >= MAX_ROWS) throw new Error("This workbook is too large to open here.");
      nextRow = rowIndex + 1;
      const row = [];
      let nextCol = 0;
      for (const cm of rm[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cm[1] ?? "";
        const ref = attr(tag, "r");
        const col = ref && /^[A-Z]{1,3}\d*$/.test(ref) ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        const type = attr(tag, "t");
        const inner = cm[2] ?? "";
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        let value = "";
        if (type === "s") value = v ? shared[Number(v[1])] ?? "" : "";
        else if (type === "inlineStr") value = textOf(inner);
        else if (type === "b") value = v ? v[1] === "1" ? "TRUE" : "FALSE" : "";
        else value = v ? xmlUnescape(v[1]) : "";
        const day = (type === void 0 || type === "n") && dated.size > 0 ? /^(\d{1,7})(\.\d+)?$/.exec(value) : null;
        if (day && dated.has(Number(attr(tag, "s") ?? 0))) value = `${Number(day[1]) + DAYS_1904}${day[2] ?? ""}`;
        while (row.length < col) row.push("");
        row[col] = value;
      }
      while (rows.length < rowIndex) rows.push([]);
      rows[rowIndex] = row;
      width = Math.max(width, row.length);
    }
    for (const row of rows) while (row.length < width) row.push("");
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new Error("This workbook has no readable sheets.");
  return sheets;
}

// packages/core/src/property/templates.ts
var MAX_ROWS2 = 500;
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ROWS2) throw new Error(`${label} must be a whole number from 1 to ${MAX_ROWS2}.`);
  return value;
}
function period(start, end) {
  if (start && !isIsoDate(start)) throw new Error("The period start is not a valid date.");
  if (end && !isIsoDate(end)) throw new Error("The period end is not a valid date.");
  if (start && end && end < start) throw new Error("The period end is before the period start.");
}
var CAM_TEMPLATE_EXPENSE_HEADERS = ["Line", "Expense category", "Amount", "Recoverable (Yes or No)"];
var CAM_TEMPLATE_TENANT_HEADERS = ["Line", "Tenant", "Square feet", "Fixed share percent (optional)", "Estimates paid"];
function camTemplateSheets(o) {
  const tenants = count(o.tenantCount, "The number of tenants");
  const expenses = count(o.expenseRows ?? 12, "The number of expense rows");
  period(o.periodStart, o.periodEnd);
  return [
    {
      name: "Property",
      rows: [
        ["Item", "Value"],
        ["Property", o.property.trim()],
        ["Period start", o.periodStart],
        ["Period end", o.periodEnd],
        ["Total leasable square feet", ""],
        ["Admin fee on tenant share (percent)", ""]
      ],
      money: [],
      widths: [38, 32]
    },
    {
      name: "Expenses",
      rows: [[...CAM_TEMPLATE_EXPENSE_HEADERS], ...Array.from({ length: expenses }, (_, i) => [i + 1, "", "0.00", "Yes"])],
      money: ["Amount"],
      widths: [8, 36, 16, 24]
    },
    {
      name: "Tenants",
      rows: [[...CAM_TEMPLATE_TENANT_HEADERS], ...Array.from({ length: tenants }, (_, i) => [i + 1, "", "", "", "0.00"])],
      money: ["Estimates paid"],
      widths: [8, 32, 14, 30, 16]
    },
    {
      name: "Instructions",
      rows: [
        ["How this workbook is laid out"],
        ["Property: the building, the period, the total leasable square feet (occupied or not), and the admin fee percent if the leases have one."],
        ["Expenses: one row per common area expense category for the period. Mark a row No under Recoverable to keep it out of the shared pool."],
        ["Tenants: one row per tenant with the leased square feet and the estimated payments received during the period."],
        ["Fixed share percent: fill this in only where a lease sets a fixed share; it is then used instead of square footage for that tenant."],
        ["Amounts are plain numbers. This workbook holds values only and contains no formulas, so nothing in it calculates."],
        ["The CAM reconciliation tool on the same site takes these same numbers, splits the pool to the penny, and shows the checks it ran."],
        ["Rows left blank are fine. Add more rows under the last one if the property has more tenants or expense categories."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
var OWNER_TEMPLATE_LEDGER_HEADERS = ["Date", "Description", "Amount", "Type"];
function ownerStatementTemplateSheets(o) {
  const rows = count(o.ledgerRows, "The number of ledger rows");
  period(o.periodStart, o.periodEnd);
  return [
    {
      name: "Statement",
      rows: [
        ["Item", "Value"],
        ["Owner", o.owner.trim()],
        ["Property", o.property.trim()],
        ["Period start", o.periodStart],
        ["Period end", o.periodEnd],
        ["Opening balance", ""],
        ["Management fee (percent of income)", ""],
        ["Reserve held (optional)", ""],
        ["Total income", ""],
        ["Total expenses", ""],
        ["Management fee", ""],
        ["Paid to owner", ""],
        ["Closing balance", ""]
      ],
      money: [],
      widths: [38, 32]
    },
    {
      name: "Ledger",
      rows: [[...OWNER_TEMPLATE_LEDGER_HEADERS], ...Array.from({ length: rows }, () => ["", "", "0.00", ""])],
      money: ["Amount"],
      widths: [14, 44, 16, 18]
    },
    {
      name: "Instructions",
      rows: [
        ["How this workbook is laid out"],
        ["Statement: the owner, the property, the period, the opening balance, the management fee percent, and the reserve if one is held."],
        ["Ledger: one row per transaction in the period, with the date, a description, the amount, and the type."],
        ["Type is one of: Income, Expense, Distribution. Distribution means money paid to the owner."],
        ["Amounts are plain positive numbers. Rows left at 0.00 are skipped when the ledger is opened in the tool."],
        ["This workbook holds values only and contains no formulas, so the totals on the Statement sheet do not fill themselves in."],
        ["The owner statement tool on the same site opens the Ledger sheet, works out the totals, the fee, and the closing balance, and shows the checks it ran."],
        ["Closing balance = opening balance + income − expenses − management fee − paid to owner. It carries into the next period as the opening balance."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
function verifyTemplateWorkbook(sheets, bytes) {
  const checks = new CheckList();
  const read = readXlsx(bytes);
  checks.equal("sheets", "The workbook has the expected sheets, in order", sheets.map((s) => s.name).join(", "), read.map((s) => s.name).join(", "));
  sheets.forEach((s, i) => {
    const got = read[i];
    const header = (s.rows[0] ?? []).map((c) => String(c ?? "")).join(" | ");
    checks.equal(`header-${i}`, `${s.name}: header row reads back as written`, header, (got?.rows[0] ?? []).slice(0, (s.rows[0] ?? []).length).join(" | "));
    checks.equal(`rows-${i}`, `${s.name}: row count reads back as written`, s.rows.length, got?.rows.length ?? 0);
  });
  let formulas = false;
  for (const s of sheets) for (const row of s.rows) for (const c of row) if (typeof c === "string" && /^=/.test(c)) formulas = true;
  checks.that("values-only", "The workbook holds values only, no formulas", !formulas);
  return checks.all;
}

// packages/core/src/sheetInput.ts
function sheetRowList(rows) {
  const MAX_REASONS = 8;
  const MAX_ROWS3 = 20;
  const byReason = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = byReason.get(r.reason);
    if (list) list.push(r.rowNumber);
    else byReason.set(r.reason, [r.rowNumber]);
  }
  const parts = [];
  let shown = 0;
  for (const [reason, numbers] of byReason) {
    if (parts.length === MAX_REASONS) break;
    const first = numbers.slice(0, MAX_ROWS3);
    parts.push(`${reason}: row(s) ${first.join(", ")}${numbers.length > first.length ? ` and ${numbers.length - first.length} more` : ""}`);
    shown += numbers.length;
  }
  if (shown < rows.length) parts.push(`and ${rows.length - shown} more row(s) for other reasons`);
  return parts.join("; ");
}
function sheetRowChecks(problems, leftOut) {
  return [
    {
      id: "rows-read",
      label: "Every row with data could be read",
      passed: problems.length === 0,
      severity: "error",
      ...problems.length ? { detail: `${problems.length} row(s) could not be read and are not in the result. ${sheetRowList(problems)}` } : {}
    },
    {
      id: "rows-left-out",
      label: "No row with data was left out of the result",
      passed: leftOut.length === 0,
      severity: "warning",
      ...leftOut.length ? { detail: `${leftOut.length} row(s) with data are not used. ${sheetRowList(leftOut)}` } : {}
    }
  ];
}
function sheetNormalizeHeader(text2) {
  return text2.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function matchRow(header, roles, synonyms) {
  const names = header.map(sheetNormalizeHeader);
  const used = /* @__PURE__ */ new Set();
  const columns = {};
  let hits = 0;
  for (const role of roles) columns[role] = -1;
  for (const exact of [true, false]) {
    for (const role of roles) {
      if (columns[role] >= 0) continue;
      for (const word of synonyms[role]) {
        const col = names.findIndex((n, i) => !used.has(i) && n !== "" && (exact ? n === word : ` ${n} `.includes(` ${word} `)));
        if (col >= 0) {
          columns[role] = col;
          used.add(col);
          hits++;
          break;
        }
      }
    }
  }
  return { columns, hits };
}
function sheetGuessColumns(rows, roles, synonyms, atHeaderRow) {
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: matchRow(rows[atHeaderRow] ?? [], roles, synonyms).columns };
  let best = { headerRow: 0, ...matchRow(rows[0] ?? [], roles, synonyms) };
  for (let i = 1; i < Math.min(rows.length, 20); i++) {
    const m = matchRow(rows[i] ?? [], roles, synonyms);
    if (m.hits > best.hits) best = { headerRow: i, ...m };
  }
  return { headerRow: best.headerRow, columns: best.columns };
}
function sheetDataRows(rows, headerRow) {
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.some((c) => c.trim() !== "")) out.push({ rowNumber: i + 1, cells });
  }
  return out;
}
function sheetCell(cells, col) {
  return col >= 0 ? (cells[col] ?? "").trim() : "";
}

// packages/agents/src/values.ts
var AgentInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentInputError";
  }
};
function asText(value, input) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new AgentInputError(`"${input.name}" (${input.label}) must be given as text.`);
}
function amountCents(raw, what) {
  try {
    return parseAmount(raw);
  } catch (err2) {
    const why = err2 instanceof Error ? err2.message : "not an amount";
    throw new AgentInputError(`${what} "${raw}" is not an amount in dollars and cents (${why}).`);
  }
}
function amountList(value, input) {
  if (Array.isArray(value)) return value.map((v) => asText(v, input));
  const text2 = asText(value, input);
  if (text2.startsWith("[")) {
    try {
      const parsed = JSON.parse(text2);
      if (Array.isArray(parsed)) return parsed.map((v) => asText(v, input));
    } catch {
    }
  }
  return text2.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
}
function checkValue(input, value) {
  const what = `"${input.name}" (${input.label})`;
  switch (input.kind) {
    case "text": {
      const t = asText(value, input);
      if (t.length > 2e4) throw new AgentInputError(`${what} is longer than 20,000 characters.`);
      return t;
    }
    case "amount":
      return amountCents(asText(value, input), what);
    case "amounts": {
      const items = amountList(value, input);
      if (items.length === 0) throw new AgentInputError(`${what} has no amounts in it.`);
      if (items.length > 1e5) throw new AgentInputError(`${what} has more than 100,000 amounts.`);
      return items.map((raw, i) => amountCents(raw, `Item ${i + 1} of ${what}`));
    }
    case "date": {
      const t = asText(value, input);
      try {
        parseCivilDate(t, input.label.toLowerCase());
      } catch (err2) {
        throw new AgentInputError(`${what} must be a real day written YYYY-MM-DD (${err2 instanceof Error ? err2.message : "not a date"}).`);
      }
      return t;
    }
    case "year": {
      const t = asText(value, input);
      if (!/^\d{4}$/.test(t)) throw new AgentInputError(`${what} must be a year written as four digits.`);
      const y = Number(t);
      if (y < 1900 || y > 2200) throw new AgentInputError(`${what} must be a year from 1900 to 2200.`);
      return y;
    }
    case "number": {
      const t = asText(value, input);
      if (!/^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/.test(t) || !/\d/.test(t)) throw new AgentInputError(`${what} must be a number, such as 1250 or 12.5.`);
      return t.replace(/,/g, "");
    }
    case "choice": {
      const t = asText(value, input);
      const choices = input.choices ?? [];
      const hit = choices.find((c) => c.toLowerCase() === t.toLowerCase());
      if (hit === void 0) throw new AgentInputError(`${what} must be one of: ${choices.join(", ")}.`);
      return hit;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const t = asText(value, input).toLowerCase();
      if (t === "true" || t === "yes") return true;
      if (t === "false" || t === "no") return false;
      throw new AgentInputError(`${what} must be true or false.`);
    }
    case "file":
    case "files":
      throw new AgentInputError(`${what} is a file and is read by the runner.`);
  }
}

// packages/agents/src/sheets.ts
function columnsInput(fileLabel, c, name = "columns") {
  const needed = c.required.map((r) => c.labels[r]);
  const optional = c.roles.filter((r) => !c.required.includes(r)).map((r) => c.labels[r]);
  return {
    name,
    kind: "text",
    label: `Columns of the ${fileLabel.toLowerCase()}`,
    description: `Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "${needed[0] ?? "Amount"} = ${needed[0] ?? "Amount"} received"; "<column> = none" leaves an optional column out. The answer lists the columns it read.${needed.length ? ` Needed: ${needed.join(", ")}.` : ""}${optional.length ? ` Used when present: ${optional.join(", ")}.` : ""}`,
    required: false
  };
}
var columnLog = null;
function beginColumnLog() {
  columnLog = [];
}
function takeColumnLog() {
  const out = columnLog ?? [];
  columnLog = null;
  return out;
}
function logColumns(fileLabel, file, c, mapping) {
  if (!columnLog) return;
  const header = file.rows[mapping.headerRow] ?? [];
  const used = c.roles.filter((r) => mapping.columns[r] >= 0).map((r) => `${c.labels[r]} = "${(header[mapping.columns[r]] ?? "").trim() || `column ${mapping.columns[r] + 1}`}"`);
  const unused = c.roles.filter((r) => mapping.columns[r] < 0).map((r) => c.labels[r]);
  columnLog.push(`${fileLabel} (${file.name}, header on row ${mapping.headerRow + 1}): ${used.join("; ") || "none"}${unused.length ? `. Not in the file: ${unused.join(", ")}` : ""}.`);
}
function labelKey(text2) {
  return sheetNormalizeHeader(text2.replace(/\([^)]*\)/g, " "));
}
function headerIndex(header, text2) {
  const want = sheetNormalizeHeader(text2);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want);
  if (exact >= 0) return exact;
  const letter = /^[A-Za-z]{1,2}$/.test(text2.trim()) ? text2.trim().toUpperCase() : "";
  if (letter) {
    let n = 0;
    for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n - 1 < header.length) return n - 1;
  }
  return -1;
}
var NONE = /* @__PURE__ */ new Set(["none", "not in this file", "not in the file", "no column", "-"]);
function parseOverride(override, c) {
  const out = [];
  for (const part of override.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"columns" must be written as "<column> = <header in the file>": "${part.trim()}".`);
    const roleText = labelKey(part.slice(0, eq));
    const headerText = part.slice(eq + 1).trim();
    const exact = c.roles.find((r) => labelKey(c.labels[r]) === roleText || sheetNormalizeHeader(r) === roleText || sheetNormalizeHeader(c.labels[r]) === roleText);
    const starts = roleText === "" ? [] : c.roles.filter((r) => `${labelKey(c.labels[r])} `.startsWith(`${roleText} `));
    const role = exact ?? (starts.length === 1 ? starts[0] : void 0);
    if (role === void 0) throw new AgentInputError(`"${part.slice(0, eq).trim()}" is not one of this file's columns. They are: ${c.roles.map((r) => c.labels[r]).join(", ")}.`);
    const none = headerText === "" || NONE.has(headerText.toLowerCase());
    if (none && c.required.includes(role)) throw new AgentInputError(`${c.labels[role]} is needed, so it cannot be left out; name its header.`);
    out.push({ role, header: none ? null : headerText, text: part.trim() });
  }
  return out;
}
function rowHolding(rows, headers) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) if (headers.every((h) => headerIndex(rows[i] ?? [], h) >= 0)) return i;
  return -1;
}
function mapColumns(file, c, override, fileLabel) {
  let mapping = c.guess(file.rows);
  const named = override && override.trim() !== "" ? parseOverride(override, c) : [];
  const headersNamed = named.filter((n) => n.header !== null && !/^[A-Za-z]{1,2}$/.test(n.header)).map((n) => n.header);
  if (headersNamed.length > 0 && !headersNamed.every((h) => headerIndex(file.rows[mapping.headerRow] ?? [], h) >= 0)) {
    const row = rowHolding(file.rows, headersNamed);
    if (row >= 0 && row !== mapping.headerRow) {
      const again = c.guess(file.rows, row);
      mapping = again.headerRow === row ? again : { headerRow: row, columns: Object.fromEntries(c.roles.map((r) => [r, -1])) };
    }
  }
  const header = file.rows[mapping.headerRow] ?? [];
  const columns = { ...mapping.columns };
  for (const n of named) {
    if (n.header === null) {
      columns[n.role] = -1;
      continue;
    }
    const col = headerIndex(header, n.header);
    if (col < 0) throw new AgentInputError(`The ${fileLabel.toLowerCase()} has no header "${n.header}". Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}.`);
    columns[n.role] = col;
  }
  const missing = c.required.filter((r) => columns[r] < 0);
  if (missing.length > 0) {
    throw new AgentInputError(
      `The ${fileLabel.toLowerCase()} (${file.name}) has no column for: ${missing.map((r) => c.labels[r]).join(", ")}. Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}. Name the column with "columns", for example "${c.labels[missing[0]]} = <header>".`
    );
  }
  const result = { ...mapping, headerRow: mapping.headerRow, columns };
  logColumns(fileLabel, file, c, result);
  return result;
}
function oneFile(files, name) {
  const f = files[name]?.[0];
  if (!f) throw new AgentInputError(`"${name}" is needed.`);
  return f;
}
function preferSheet(file, prefer) {
  const sheet = file.sheets.find((s) => prefer.test(s.name) && s.rows.some((r) => r.some((cell) => cell.trim() !== "")));
  return sheet ? { ...file, rows: sheet.rows } : file;
}

// packages/agents/src/registry/property-management.ts
var SECTION = "property-management";
var d = toDecimal;
var text = (v) => typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
var cents = (v) => typeof v === "number" ? v : void 0;
var dueOrCredit = (c) => c >= 0 ? `${formatUSD(c)} due` : `${formatUSD(-c)} credit`;
function squareFeetValue(v, what) {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new AgentInputError(`${what} must be a whole number of square feet, such as 20000: "${s}".`);
  return Number(s);
}
function percentValue(v, what, max100 = false) {
  const s = String(v ?? "").trim().replace(/%$/, "").trim();
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new AgentInputError(`${what} must be a percent of zero or more with at most two decimal places, such as 95 or 7.25: "${s}".`);
  }
  if (max100 && bp > 1e4) throw new AgentInputError(`${what} must be no more than 100.`);
  return bp;
}
function countValue(v, what, fallback) {
  if (v === void 0) return fallback;
  const s = String(v).trim();
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new AgentInputError(`${what} must be a whole number from 1 to 500: "${s}".`);
  return Number(s);
}
var NOTHING = /^(\$?\s*0*(\.0*)?|-)$/;
var isNothing = (...cells) => cells.every((c) => NOTHING.test(c.trim()));
function cellCents(raw, what) {
  if (raw === "") return 0;
  try {
    return pmCellToCents(raw);
  } catch {
    throw new Error(`the ${what} "${raw}" could not be read as an amount`);
  }
}
function cellNonNegative(raw, what) {
  const c = cellCents(raw, what);
  if (c < 0) throw new Error(`the ${what} "${raw}" is negative; enter each amount as zero or more`);
  return c;
}
function cellSquareFeet(raw) {
  const s = raw.replace(/,/g, "").trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error(`the square feet "${raw}" is not a whole number`);
  return Number(s);
}
function cellPercentBp(raw, what, max100) {
  const t = raw.trim();
  const signed = t.endsWith("%");
  const s = t.replace(/%$/, "").trim();
  if (s === "") return void 0;
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new Error(`the ${what} "${raw}" is not a percent with at most two decimal places`);
  }
  if (!signed && bp > 0 && bp < 100) {
    throw new Error(`the ${what} "${raw}" is below 1: a cell formatted as a percent stores 25% as 0.25, so write the percent as a number such as 25 (or "${s}%" with the sign if it really is under one percent)`);
  }
  if (max100 && bp > 1e4) throw new Error(`the ${what} "${raw}" is more than 100%`);
  return bp;
}
function cellPickerDate(raw, what) {
  const s = raw.trim();
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(s) && !/^\d{5}(?:\.\d+)?$/.test(s)) {
    throw new Error(`the ${what} "${raw}" is not written YYYY-MM-DD; write it year first, such as 2024-03-01, so the day and the month cannot be mixed up`);
  }
  try {
    return pmCellToIsoDate(s);
  } catch {
    throw new Error(`the ${what} "${raw}" is not a real day`);
  }
}
function cellYesNo(raw, blank, what, yes = [], no = []) {
  const t = pmNormalizeHeader(raw);
  if (t === "") return blank;
  if (["yes", "y", "true", "x", "1", ...yes].includes(t)) return true;
  if (["no", "n", "false", "0", ...no].includes(t)) return false;
  throw new Error(`the ${what} cell "${raw}" is not Yes or No`);
}
var centsFigure = (what) => (raw) => BigInt(cellCents(raw, what));
var squareFeetFigure = (raw) => BigInt(cellSquareFeet(raw));
var TOTAL_NAMES = /* @__PURE__ */ new Set(["total", "totals", "grand total", "subtotal", "sub total", "subtotals"]);
var rowRange = (rows) => rows.length === 0 ? "no rows" : rows.length === 1 ? `row ${rows[0]}` : `rows ${rows[0]} to ${rows[rows.length - 1]}`;
function readRows(file, c, override, label, nameRole, figures, read) {
  const mapping = mapColumns(file, c, text(override), label);
  const out = { label, records: [], problems: [], leftOut: [], checks: [] };
  const figureRoles = c.roles.filter((r) => figures[r] !== void 0 && mapping.columns[r] >= 0);
  const value = (role, raw) => {
    try {
      return figures[role](raw);
    } catch {
      return null;
    }
  };
  const seen = [];
  let sectionStart = 0;
  const totalOf = (cell, scope) => {
    if (scope.length < 2) return false;
    let nonZero = false;
    for (const role of figureRoles) {
      const raw = cell(role);
      if (raw === "") continue;
      const v = value(role, raw);
      if (v === null) return false;
      let total = 0n;
      for (const s of scope) total += s.values.get(role) ?? 0n;
      if (total !== v) return false;
      if (v !== 0n) nonZero = true;
    }
    return nonZero;
  };
  const totalLines = [];
  for (const { rowNumber, cells } of sheetDataRows(file.rows, mapping.headerRow)) {
    const cell = (role) => sheetCell(cells, mapping.columns[role]);
    const name = cell(nameRole);
    const onlyTotal = TOTAL_NAMES.has(pmNormalizeHeader(name));
    if (name === "" || onlyTotal) {
      const section = seen.slice(sectionStart);
      const scope = totalOf(cell, section) ? section : totalOf(cell, seen) ? seen : null;
      if (scope) {
        const rows = scope.map((s) => s.rowNumber);
        out.leftOut.push({ rowNumber, reason: `the file's own total line, equal to ${rowRange(rows)} added up` });
        totalLines.push({ rowNumber, scope: rows });
        sectionStart = seen.length;
        continue;
      }
      if (onlyTotal) {
        out.problems.push({ rowNumber, reason: `the row named "${name}" is not the rows above it added up, so it is neither read as data nor left out as the file's total line` });
        continue;
      }
    }
    try {
      const rec = read(cell, out.records.length);
      if (rec !== null) {
        out.records.push(rec);
        const values = /* @__PURE__ */ new Map();
        for (const role of figureRoles) values.set(role, value(role, cell(role)) ?? 0n);
        seen.push({ rowNumber, values });
      }
    } catch (err2) {
      out.problems.push({ rowNumber, reason: err2 instanceof Error ? err2.message : "could not be read" });
    }
  }
  const slugLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const t of totalLines) {
    const cellAt = (row, role) => sheetCell(file.rows[row - 1] ?? [], mapping.columns[role]);
    const off = figureRoles.filter((role) => {
      const raw = cellAt(t.rowNumber, role);
      if (raw === "") return false;
      let total = 0n;
      for (const r of t.scope) total += value(role, cellAt(r, role)) ?? 0n;
      return value(role, raw) !== total;
    });
    out.checks.push({
      id: `${slugLabel}-total-line-${t.rowNumber}`,
      label: `${label}: row ${t.rowNumber} is the file's own total line, equal to ${rowRange(t.scope)} added up, and is left out of the result`,
      passed: off.length === 0,
      severity: "error",
      ...off.length ? { detail: `${off.map((r) => c.labels[r]).join(", ")} on row ${t.rowNumber} is not ${rowRange(t.scope)} added up` } : {}
    });
  }
  return out;
}
function rowChecks(...reads) {
  const tag = (r, list) => list.map((p) => ({ rowNumber: p.rowNumber, reason: `${r.label.toLowerCase()}: ${p.reason}` }));
  return [...sheetRowChecks(reads.flatMap((r) => tag(r, r.problems)), reads.flatMap((r) => tag(r, r.leftOut))), ...reads.flatMap((r) => r.checks)];
}
function needRows(r) {
  if (r.records.length > 0) return;
  const what = r.label.toLowerCase();
  if (r.problems.length === 0) throw new AgentInputError(`The ${what} has no rows under its header row.`);
  throw new AgentInputError(`No row of the ${what} could be read: ${r.problems.slice(0, 5).map((p) => `row ${p.rowNumber}, ${p.reason}`).join("; ")}.`);
}
var TENANT_ROLES = ["name", "squareFeet", "fixedShare", "estimatesPaid"];
var TENANT_SYNONYMS = {
  name: ["tenant", "tenant name", "lessee", "occupant", "name"],
  squareFeet: ["square feet", "leased square feet", "rentable square feet", "sq ft", "sqft", "square footage", "rsf", "area"],
  fixedShare: ["fixed share percent optional", "fixed share percent", "fixed share", "pro rata share", "share percent"],
  estimatesPaid: ["estimates paid", "estimated payments", "estimates", "amount paid", "paid", "payments"]
};
var TENANT_COLUMNS = {
  roles: TENANT_ROLES,
  labels: { name: "Tenant", squareFeet: "Square feet", fixedShare: "Fixed share percent", estimatesPaid: "Estimates paid" },
  required: ["name", "squareFeet"],
  guess: (rows, at) => sheetGuessColumns(rows, TENANT_ROLES, TENANT_SYNONYMS, at)
};
var TENANT_FIGURES = { squareFeet: squareFeetFigure, estimatesPaid: centsFigure("estimates paid") };
var TENANT_FILE = "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per tenant: Tenant, Square feet (whole square feet leased), Fixed share percent (only where a lease sets a fixed share instead of square feet, written as a number such as 25; blank otherwise) and Estimates paid during the year (blank is zero). A last row that adds the tenants up, named Total or left blank, is left out.";
function tenantReader(max100) {
  return (cell, i) => {
    const name = cell("name");
    if (name === "" && isNothing(cell("squareFeet"), cell("fixedShare"), cell("estimatesPaid"))) return null;
    const fixed = cellPercentBp(cell("fixedShare"), "fixed share", max100);
    return { name: name || `Tenant ${i + 1}`, squareFeet: cellSquareFeet(cell("squareFeet")), estimatesPaid: cellCents(cell("estimatesPaid"), "estimates paid"), ...fixed !== void 0 ? { fixedShareBp: fixed } : {} };
  };
}
var VARIABLE_WORDS = { yes: ["variable"], no: ["fixed"] };
var CONTROLLABLE_WORDS = { yes: ["controllable"], no: ["uncontrollable", "not controllable", "non controllable"] };
var RECOVERABLE_WORDS = { yes: ["recoverable"], no: ["excluded", "not recoverable", "non recoverable"] };
var CAM_EXPENSE_ROLES = ["category", "amount", "recoverable"];
var CAM_EXPENSE_SYNONYMS = {
  category: ["expense category", "category", "expense", "expense line", "line item", "description", "item", "name"],
  amount: ["amount", "actual amount", "actual", "cost", "total"],
  recoverable: ["recoverable yes or no", "recoverable", "in pool", "included"]
};
var CAM_EXPENSE_COLUMNS = {
  roles: CAM_EXPENSE_ROLES,
  labels: { category: "Expense category", amount: "Amount", recoverable: "Recoverable" },
  required: ["category", "amount"],
  guess: (rows, at) => sheetGuessColumns(rows, CAM_EXPENSE_ROLES, CAM_EXPENSE_SYNONYMS, at)
};
var GROSS_UP_ROLES = ["category", "amount", "variable", "controllable"];
var GROSS_UP_SYNONYMS = {
  category: ["expense line", "expense category", "category", "expense", "line item", "description", "item", "name"],
  amount: ["actual amount", "amount", "actual", "cost", "total"],
  variable: ["variable", "varies with occupancy", "grossed up"],
  controllable: ["controllable", "capped", "cap"]
};
var GROSS_UP_COLUMNS = {
  roles: GROSS_UP_ROLES,
  labels: { category: "Expense line", amount: "Actual amount", variable: "Variable", controllable: "Controllable" },
  required: ["category", "amount"],
  guess: (rows, at) => sheetGuessColumns(rows, GROSS_UP_ROLES, GROSS_UP_SYNONYMS, at)
};
var STOP_LINE_ROLES = ["category", "baseAmount", "currentAmount", "variable"];
var STOP_LINE_SYNONYMS = {
  category: ["expense line", "expense category", "category", "expense", "line item", "description", "item", "name"],
  baseAmount: ["base year amount", "base year actual", "base year", "base amount", "base"],
  currentAmount: ["comparison year amount", "comparison year actual", "comparison year", "current year amount", "current year", "current amount", "comparison", "current", "amount"],
  variable: ["variable", "varies with occupancy", "grossed up"]
};
var STOP_LINE_COLUMNS = {
  roles: STOP_LINE_ROLES,
  labels: { category: "Expense line", baseAmount: "Base year amount", currentAmount: "Comparison year amount", variable: "Variable" },
  required: ["category", "currentAmount"],
  guess: (rows, at) => sheetGuessColumns(rows, STOP_LINE_ROLES, STOP_LINE_SYNONYMS, at)
};
function camPropertySheet(file) {
  const sheet = file.sheets.find((s) => pmNormalizeHeader(s.name) === "property");
  if (!sheet) return null;
  const items = /* @__PURE__ */ new Map();
  for (const row of sheet.rows) {
    const key = pmNormalizeHeader(row[0] ?? "");
    if (key !== "" && !items.has(key)) items.set(key, (row[1] ?? "").trim());
  }
  if (!items.has("total leasable square feet")) return null;
  const readItem = (key, parse) => {
    const raw = items.get(key) ?? "";
    if (raw === "") return void 0;
    try {
      return parse(raw);
    } catch (err2) {
      throw new AgentInputError(`On the Property sheet of ${file.name}, ${err2 instanceof Error ? err2.message : `"${raw}" could not be read`}.`);
    }
  };
  const out = { file: file.name };
  const property = items.get("property");
  if (property) out.property = property;
  const periodStart = readItem("period start", (r) => cellPickerDate(r, "period start"));
  if (periodStart) out.periodStart = periodStart;
  const periodEnd = readItem("period end", (r) => cellPickerDate(r, "period end"));
  if (periodEnd) out.periodEnd = periodEnd;
  const gla = readItem("total leasable square feet", (r) => cellSquareFeet(r));
  if (gla !== void 0) out.totalLeasableSqFt = gla;
  const fee = readItem("admin fee on tenant share percent", (r) => cellPercentBp(r, "admin fee percent", false));
  if (fee !== void 0) out.adminFeeBp = fee;
  return out;
}
function agreed(what, sources, show, same = (a, b) => a === b) {
  const given = sources.filter((s) => s.value !== void 0);
  const first = given[0];
  if (!first) return void 0;
  const other = given.find((s) => !same(s.value, first.value));
  if (other) throw new AgentInputError(`${what} is ${show(first.value)} in ${first.from} but ${show(other.value)} in ${other.from}. Give one figure: correct the sheet, or leave the argument out.`);
  return first;
}
var camReconciliation = {
  name: "cam_reconciliation_tenant_shares",
  page: `${SECTION}/cam-reconciliation`,
  section: SECTION,
  kind: "tool",
  title: "CAM reconciliation: common area costs split by tenant square footage",
  description: "Year-end CAM (common area maintenance) reconciliation for a commercial property: the recoverable expenses are split by each tenant's square feet of the total leasable area, or by a fixed share where a lease sets one, with vacant space kept on the landlord, an optional admin fee on each share, and each tenant's balance due or credit after the estimates paid. Shares plus the vacancy share are checked to equal the pool to the cent, shares never exceed the building, each fee and balance is worked out again, and recoverable plus excluded expenses equal total expenses. Use it when someone asks to split common area costs among tenants, work out CAM true-ups for the year, or check a CAM reconciliation. Not for grossing up variable expenses to an occupancy, not for base years or expense stops, and not for reading a lease.",
  question: "Can you split this year’s common area costs among my tenants by square footage, with a 10% admin fee?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet, occupied or not, as a whole number. Vacant space is the difference between this and the tenants’ square feet. Needed unless a file given is a filled-in CAM reconciliation template whose Property sheet has it.", required: false },
    { name: "expenses", kind: "file", label: "Expense list", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per common area expense: Expense category, Amount, and Recoverable (Yes or No; blank is Yes; a No line stays out of the pool). A filled-in CAM reconciliation template can be given as it is: its Expenses sheet is read, and the total leasable square feet, admin fee percent and period filled in on its Property sheet are used (an argument that disagrees with the sheet is refused).", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: `${TENANT_FILE} A filled-in CAM reconciliation template can be given as it is: its Tenants sheet is read.`, required: true },
    { name: "adminFeePercent", kind: "number", label: "Admin fee percent", description: "Optional. The admin fee on each tenant’s share as a percent, such as 10 or 7.5. Without it (and without one on a template’s Property sheet), no fee.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. The first day of the period, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. The last day of the period, YYYY-MM-DD.", required: false },
    columnsInput("Expense list", CAM_EXPENSE_COLUMNS, "expenseColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven splits the pool by the square feet and fixed shares given and keeps vacant space with the landlord; it does not read a lease or say which expenses are recoverable under it.",
  run({ files, values }) {
    const expenseFile = oneFile(files, "expenses");
    const tenantFile = oneFile(files, "tenants");
    const sheets = [camPropertySheet(expenseFile), camPropertySheet(tenantFile)].filter((s) => s !== null);
    const sources = (arg, pick) => [{ from: "the arguments", value: arg }, ...sheets.map((s) => ({ from: `the Property sheet of ${s.file}`, value: pick(s) }))];
    const glaArg = values.totalLeasableSquareFeet === void 0 ? void 0 : squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    const glaFound = agreed("Total leasable square feet", sources(glaArg, (s) => s.totalLeasableSqFt), (v) => `${v.toLocaleString("en-US")} sq ft`);
    if (!glaFound) throw new AgentInputError('Total leasable square feet is needed: give "totalLeasableSquareFeet", or fill it in on the CAM reconciliation template’s Property sheet.');
    const gla = glaFound.value;
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const feeArg = values.adminFeePercent === void 0 ? void 0 : percentValue(values.adminFeePercent, "The admin fee percent");
    const feeFound = agreed("The admin fee", sources(feeArg, (s) => s.adminFeeBp), formatPercentBp);
    const adminFeeBp = feeFound?.value ?? 0;
    const propertyFound = agreed("The property", sources(text(values.property), (s) => s.property), (v) => `"${v}"`, (a, b) => a.toLowerCase() === b.toLowerCase());
    const startFound = agreed("The period start", sources(text(values.periodStart), (s) => s.periodStart), (v) => v);
    const endFound = agreed("The period end", sources(text(values.periodEnd), (s) => s.periodEnd), (v) => v);
    const sheetNote = (name, f) => f && f.from !== "the arguments" ? [name] : [];
    const fromSheet = [...sheetNote("total leasable square feet", glaFound), ...sheetNote("admin fee", feeFound), ...sheetNote("period start", startFound), ...sheetNote("period end", endFound)];
    const ex = readRows(preferSheet(expenseFile, /expense/i), CAM_EXPENSE_COLUMNS, values.expenseColumns, "Expense list", "category", { amount: centsFigure("amount") }, (cell) => {
      const category = cell("category");
      if (category === "" && isNothing(cell("amount"))) return null;
      return { category: category || "Expense", amount: cellCents(cell("amount"), "amount"), recoverable: cellYesNo(cell("recoverable"), true, "Recoverable", RECOVERABLE_WORDS.yes, RECOVERABLE_WORDS.no) };
    });
    const tn = readRows(preferSheet(tenantFile, /tenant/i), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(false));
    needRows(ex);
    needRows(tn);
    const r = computeCam({
      property: propertyFound?.value ?? "",
      periodStart: startFound?.value ?? "",
      periodEnd: endFound?.value ?? "",
      totalLeasableSqFt: gla,
      adminFeeBp,
      expenses: ex.records,
      tenants: tn.records
    });
    const shares = sum(r.tenants.map((t) => t.share));
    const fees = sum(r.tenants.map((t) => t.adminFee));
    const net = sum(r.tenants.map((t) => t.balance));
    return {
      summary: `Recoverable pool ${formatUSD(r.pool)} (${formatUSD(r.excluded)} excluded) split over ${r.tenants.length} tenant(s) and the vacant space of ${gla.toLocaleString("en-US")} sq ft: tenant shares ${formatUSD(shares)}, landlord (vacant space) ${formatUSD(r.landlordShare)}, admin fees ${formatUSD(fees)} at ${formatPercentBp(adminFeeBp)}. Net due from tenants after estimates paid (credits subtracted): ${dueOrCredit(net)}.${fromSheet.length ? ` Taken from the template’s Property sheet: ${listText(fromSheet)}.` : ""}`,
      tables: [
        {
          name: "Summary",
          rows: [
            ["Item", "Amount"],
            ["Recoverable expense pool", d(r.pool)],
            ["Excluded (non-recoverable) expenses", d(r.excluded)],
            ["Tenant shares", d(shares)],
            ["Landlord share (vacant space)", d(r.landlordShare)],
            ["Admin fees", d(fees)],
            ["Net due from tenants (credits subtracted)", d(net)]
          ]
        },
        {
          name: "Tenants",
          rows: [
            ["Tenant", "Square feet", "Share percent", "CAM share", "Admin fee", "Total due", "Estimates paid", "Balance (positive = due, negative = credit)"],
            ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.adminFee), d(t.totalDue), d(t.estimatesPaid), d(t.balance)]),
            ["Landlord (vacant space)", "", "", d(r.landlordShare), "", "", "", ""]
          ]
        },
        { name: "Expenses", rows: [["Expense", "Amount", "Recoverable"], ...r.input.expenses.map((e) => [e.category, d(e.amount), e.recoverable ? "Yes" : "No"])] }
      ],
      checks: [...r.checks, ...rowChecks(ex, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a 20,000 sq ft strip center, $90,000.00 recoverable, a 10% admin fee, 2,000 sq ft vacant",
      args: { totalLeasableSquareFeet: "20000", adminFeePercent: "10", expenses: "agents-fixture:property-management/cam-expenses.csv", tenants: "agents-fixture:property-management/cam-tenants.csv", property: "Example Strip Center", periodStart: "2025-01-01", periodEnd: "2025-12-31" },
      verified: true,
      contains: ["$90,000.00", "$9,000.00", "| Corner Cafe | 5000 | 25.00% | 22500.00 | 2250.00 | 24750.00 | 24000.00 | 750.00 |", "| Family Dental | 8000 | 40.00% | 36000.00 | 3600.00 | 39600.00 | 40000.00 | -400.00 |", "| Pack and Ship | 5000 | 25.00% | 22500.00 | 2250.00 | 24750.00 | 24000.00 | 750.00 |", "| Landlord (vacant space) |  |  | 9000.00 |"]
    },
    {
      label: "A tenant row whose square feet cannot be read is not verified",
      args: { totalLeasableSquareFeet: "20000", expenses: "Expense category,Amount,Recoverable\nLandscaping,18400.00,Yes\n", tenants: "Tenant,Square feet,Estimates paid\nCorner Cafe,5000,24000.00\nFamily Dental,8OOO,40000.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function occupiedFigures(v) {
  const parts = String(v ?? "").split(/[;\n]+/).map((s) => s.trim()).filter((s) => s !== "");
  if (parts.length === 0) throw new AgentInputError('"occupiedSquareFeet" needs at least one figure.');
  if (parts.length > 12) throw new AgentInputError('"occupiedSquareFeet" takes one figure, or one for each month: at most 12.');
  return parts.map((p) => squareFeetValue(p.replace(/,/g, ""), "Each occupied square feet figure"));
}
var camGrossUp = {
  name: "cam_gross_up_pool_split",
  page: `${SECTION}/cam-gross-up-calculator`,
  section: SECTION,
  kind: "tool",
  title: "CAM gross-up: variable expenses grossed up to an occupancy, then split by tenant share",
  description: "Grosses up the variable lines of a CAM expense pool to the occupancy a lease names (factor = gross-up occupancy ÷ actual occupancy, kept as an exact ratio), leaves fixed lines at their actual amounts, applies an optional cap on controllable lines (an amount, or a prior year plus an allowed increase), and splits the pool by tenant square feet or fixed share with each true-up against the estimates paid. The pool is worked out two ways, each variable line is checked against actual × factor, the cap is figured a second way, and the shares plus the unleased remainder add up to the pool to the cent. Use it when someone asks to gross up operating or CAM expenses for vacancy, apply a cap on controllable expenses, or check a grossed-up reconciliation. Not for comparing a year with a base year or an expense stop, and not for deciding which lines a lease makes variable or controllable.",
  question: "Our building was 80% occupied last year. Can you gross up the variable CAM expenses to 95% and work out each tenant’s share?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet, occupied or not, as a whole number.", required: true },
    { name: "occupiedSquareFeet", kind: "text", label: "Occupied square feet", description: 'The occupied square feet: one figure for a single date (such as 40000), or one figure per month separated by semicolons for the average (such as "38000; 40000; 42000"), at most 12.', required: true },
    { name: "grossUpOccupancyPercent", kind: "number", label: "Gross-up occupancy percent", description: "The occupancy the variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95.", required: true },
    { name: "lines", kind: "file", label: "Expense lines", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line: Expense line, Actual amount, Variable (Yes for lines that vary with occupancy and are grossed up; blank is No) and Controllable (Yes for lines a cap covers; blank is No). Amounts are zero or more.", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: TENANT_FILE, required: true },
    { name: "capAmount", kind: "amount", label: "Cap amount", description: "Optional. A cap on the controllable lines after gross-up, as an amount. Give this or the prior year with an increase, not both.", required: false },
    { name: "capPriorYear", kind: "amount", label: "Prior-year controllable expenses", description: "Optional. For a cap figured as the prior year’s controllable expenses plus an allowed increase: the prior year’s amount. Needs capIncreasePercent.", required: false },
    { name: "capIncreasePercent", kind: "number", label: "Allowed increase percent", description: "Optional. The allowed increase over the prior year for the cap, as a percent, such as 5. Needs capPriorYear.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. The first day of the period, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. The last day of the period, YYYY-MM-DD.", required: false },
    columnsInput("Expense lines", GROSS_UP_COLUMNS, "lineColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven calculates from the lines, marks, occupancy and cap given; it does not decide which lines are variable or controllable, what occupancy applies, or what a lease allows.",
  run({ files, values }) {
    const gla = squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const grossUpBp = percentValue(values.grossUpOccupancyPercent, "The gross-up occupancy", true);
    if (grossUpBp === 0) throw new AgentInputError("The gross-up occupancy must be more than zero.");
    const occupiedSqFt = occupiedFigures(values.occupiedSquareFeet);
    let cap;
    const capAmount = cents(values.capAmount);
    const capPrior = cents(values.capPriorYear);
    if (capAmount !== void 0 && (capPrior !== void 0 || values.capIncreasePercent !== void 0)) throw new AgentInputError("Give the cap as an amount (capAmount) or as a prior year plus an increase (capPriorYear and capIncreasePercent), not both.");
    if (capAmount !== void 0) cap = { kind: "amount", amount: capAmount };
    else if (capPrior !== void 0 || values.capIncreasePercent !== void 0) {
      if (capPrior === void 0 || values.capIncreasePercent === void 0) throw new AgentInputError("A cap figured from the prior year needs both capPriorYear and capIncreasePercent.");
      cap = { kind: "increase", priorYear: capPrior, increaseBp: percentValue(values.capIncreasePercent, "The allowed increase") };
    }
    const ln2 = readRows(oneFile(files, "lines"), GROSS_UP_COLUMNS, values.lineColumns, "Expense lines", "category", { amount: centsFigure("actual amount") }, (cell, i) => {
      const category = cell("category");
      if (category === "" && isNothing(cell("amount"))) return null;
      return {
        category: category || `Line ${i + 1}`,
        amount: cellNonNegative(cell("amount"), "actual amount"),
        variable: cellYesNo(cell("variable"), false, "Variable", VARIABLE_WORDS.yes, VARIABLE_WORDS.no),
        controllable: cellYesNo(cell("controllable"), false, "Controllable", CONTROLLABLE_WORDS.yes, CONTROLLABLE_WORDS.no)
      };
    });
    const tn = readRows(oneFile(files, "tenants"), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(true));
    needRows(ln2);
    needRows(tn);
    const periodStart = text(values.periodStart);
    const periodEnd = text(values.periodEnd);
    const r = computeCamGrossUp({
      property: text(values.property) ?? "",
      ...periodStart ? { periodStart } : {},
      ...periodEnd ? { periodEnd } : {},
      totalLeasableSqFt: gla,
      occupiedSqFt,
      grossUpBp,
      ...cap ? { cap } : {},
      lines: ln2.records,
      tenants: tn.records
    });
    const tt = r.totals;
    const occupancy = `${formatPercentBp(r.occupancy.actualBp)} (${r.occupancy.readings === 1 ? "one date" : `average of ${r.occupancy.readings} monthly figures`})`;
    const factor = r.occupancy.applies ? `× ${grossUpFactorText(r.factor)} (${formatPercentBp(grossUpBp)} ÷ ${formatPercentBp(r.occupancy.actualBp)})` : "none: actual occupancy is at or above the gross-up occupancy";
    const shares = sum(r.tenants.map((t) => t.share));
    const net = sum(r.tenants.map((t) => t.trueUp));
    const capPart = tt.capAmount !== null ? ` − ${formatUSD(tt.capReduction)} cap reduction` : "";
    return {
      summary: `Actual occupancy ${occupancy}, gross-up factor ${factor}. The pool is ${formatUSD(tt.fixed)} fixed + ${formatUSD(tt.variableActual)} variable + ${formatUSD(tt.increase)} gross-up increase${capPart} = ${formatUSD(r.pool)}${tt.capAmount !== null ? ` (cap ${formatUSD(tt.capAmount)} on ${formatUSD(tt.controllable)} of controllable lines)` : ""}. ${r.tenants.length} tenant share(s) ${formatUSD(shares)} and the unleased remainder ${formatUSD(r.unleased)} add up to the pool; net true-up (credits subtracted) ${dueOrCredit(net)}.${r.occupancy.applies ? ` For comparison, the factor applied to every line, fixed lines included, would have given ${formatUSD(tt.wholePoolGrossedUp)} before any cap.` : ""}`,
      tables: [
        {
          name: "Summary",
          rows: [
            ["Item", "Value", "Amount"],
            ["Property", r.input.property, ""],
            ["Period", [r.input.periodStart, r.input.periodEnd].filter(Boolean).join(" to "), ""],
            ["Total leasable square feet", String(gla), ""],
            ["Actual occupancy", occupancy, ""],
            ["Gross-up occupancy", formatPercentBp(grossUpBp), ""],
            ["Gross-up factor", r.occupancy.applies ? `${r.factor.numerator}/${r.factor.denominator} = ${grossUpFactorText(r.factor, 6)}` : "None (1)", ""],
            ["Fixed lines (not grossed up)", "", d(tt.fixed)],
            ["Variable lines, actual", "", d(tt.variableActual)],
            ["Gross-up increase on variable lines", "", d(tt.increase)],
            ["Variable lines, grossed up", "", d(tt.variableGrossedUp)],
            ...tt.capAmount !== null ? [
              ["Controllable lines after gross-up", "", d(tt.controllable)],
              ["Cap", "", d(tt.capAmount)],
              ["Cap reduction (kept out of the pool)", "", d(tt.capReduction)]
            ] : [],
            ["Grossed-up pool", "", d(r.pool)],
            ["Unleased remainder", "", d(r.unleased)],
            ...r.occupancy.applies ? [["For comparison: the factor applied to every line, before any cap", "", d(tt.wholePoolGrossedUp)]] : []
          ]
        },
        {
          name: "Expense lines",
          rows: [
            ["Expense line", "Variable", "Controllable", "Actual", "Grossed up", "Cap reduction", "In pool"],
            ...r.lines.map((l) => [l.category, l.variable ? "Yes" : "No", l.controllable ? "Yes" : "No", d(l.amount), d(l.grossedUp), d(l.capReduction), d(l.inPool)]),
            ["Total", "", "", d(tt.actual), d(tt.fixed + tt.variableGrossedUp), d(tt.capReduction), d(r.pool)]
          ]
        },
        {
          name: "Tenants",
          rows: [
            ["Tenant", "Square feet", "Share percent", "Share of pool", "Estimates paid", "True-up (positive = due, negative = credit)"],
            ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.estimatesPaid), d(t.trueUp)]),
            ["Unleased remainder", "", "", d(r.unleased), "", ""]
          ]
        }
      ],
      checks: [...r.checks, ...rowChecks(ln2, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: 50,000 sq ft, 80% occupied, grossed up to 95%, controllable lines capped at the prior year's $48,000.00 plus 5%",
      args: {
        totalLeasableSquareFeet: "50000",
        occupiedSquareFeet: "40000",
        grossUpOccupancyPercent: "95",
        capPriorYear: "48000.00",
        capIncreasePercent: "5",
        lines: "agents-fixture:property-management/gross-up-lines.csv",
        tenants: "agents-fixture:property-management/gross-up-tenants.csv",
        property: "Example Commons",
        periodStart: "2025-01-01",
        periodEnd: "2025-12-31"
      },
      verified: true,
      contains: [
        "The pool is $86,500.00 fixed + $64,000.00 variable + $12,000.00 gross-up increase − $5,600.00 cap reduction = $156,900.00",
        "19/16 = 1.187500",
        "$50,400.00",
        "| Janitorial | Yes | Yes | 32000.00 | 38000.00 | 3800.00 | 34200.00 |",
        "| Coffee Shop | 10000 | 20.00% | 31380.00 | 30000.00 | 1380.00 |",
        "| Dental Office | 15000 | 30.00% | 47070.00 | 48000.00 | -930.00 |",
        "| Fitness Studio | 15000 | 30.00% | 47070.00 | 45600.00 | 1470.00 |",
        "$31,380.00",
        "$178,718.75"
      ]
    },
    {
      label: "An expense line whose amount cannot be read is not verified",
      args: { totalLeasableSquareFeet: "50000", occupiedSquareFeet: "40000", grossUpOccupancyPercent: "95", lines: 'Expense line,Actual amount,Variable\nInsurance,18000.00,No\nJanitorial,"32,OOO.00",Yes\n', tenants: "Tenant,Square feet,Estimates paid\nCoffee Shop,10000,30000.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var isBaseYearOf = (r) => r.input.base.kind === "base-year";
var baseName = (r) => r.input.baseLabel ? `Base year ${r.input.baseLabel}` : "Base year";
var currentName = (r) => r.input.currentLabel ? `Comparison year ${r.input.currentLabel}` : "Comparison year";
function stopBaseText(r) {
  const b = r.input.base;
  if (b.kind === "stop-per-sqft") return `Stop: ${formatUSD(b.centsPerSqFt)} per sq ft × ${r.input.totalLeasableSqFt.toLocaleString("en-US")} sq ft`;
  if (b.kind === "stop-amount") return "Stop amount";
  return `${baseName(r)} expenses${r.input.grossUp ? ", grossed up" : ""}`;
}
function stopTables(r) {
  const g = r.input.grossUp;
  const factor = (y) => y.applies ? `${y.factor.numerator}/${y.factor.denominator} = ${grossUpFactorText(y.factor, 6)}` : "None (1)";
  const by = r.baseYear;
  const summary = [
    ["Item", "Value", "Amount"],
    ["Property", r.input.property, ""],
    ["Total leasable square feet", String(r.input.totalLeasableSqFt), ""],
    ["Base", stopBaseText(r), d(r.baseAmount)],
    ...g ? [["Gross-up occupancy", formatPercentBp(g.grossUpBp), ""]] : [],
    ...g && by ? [[`${baseName(r)} gross-up factor`, factor(by), ""]] : [],
    ...g ? [[`${currentName(r)} gross-up factor`, factor(r.currentYear), ""]] : [],
    ...by ? [[`${baseName(r)} expenses, actual`, "", d(by.actual)]] : [],
    [`${currentName(r)} expenses, actual`, "", d(r.currentYear.actual)],
    ...g ? [[`${currentName(r)} expenses, grossed up`, "", d(r.currentYear.adjusted)]] : [],
    ["Excess over the base", "", d(r.excess)],
    ["Unleased remainder of the excess", "", d(r.unleased)],
    ["Not passed through to the tenants listed", "", d(r.landlord)],
    ...r.excessWithoutGrossUp !== null ? [["For comparison: the excess with no gross-up", "", d(r.excessWithoutGrossUp)]] : []
  ];
  const lineRows = [
    ["Expense line", "Variable", "Base year actual", "Base year grossed up", "Comparison year actual", "Comparison year grossed up", "Change"],
    ...r.lines.map((l) => [l.category, l.variable ? "Yes" : "No", by ? d(l.baseAmount) : "", by ? d(l.baseAdjusted) : "", d(l.currentAmount), d(l.currentAdjusted), by ? d(l.change) : ""]),
    ["Total", "", by ? d(by.actual) : "", by ? d(by.adjusted) : "", d(r.currentYear.actual), d(r.currentYear.adjusted), by ? d(r.currentYear.adjusted - by.adjusted) : ""]
  ];
  const tenantRows = [
    ["Tenant", "Square feet", "Share percent", "Share of excess", "Estimates paid", "True-up (positive = due, negative = credit)"],
    ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.estimatesPaid), d(t.trueUp)]),
    ["Unleased remainder", "", "", d(r.unleased), "", ""]
  ];
  return [
    { name: "Summary", rows: summary },
    { name: "Expense lines", rows: lineRows },
    { name: "Tenants", rows: tenantRows }
  ];
}
var expenseStop = {
  name: "base_year_expense_stop_true_up",
  page: `${SECTION}/base-year-expense-stop-calculator`,
  section: SECTION,
  kind: "tool",
  title: "Base year and expense stop: each tenant’s share of operating expenses above the base",
  description: "Compares a year's operating expenses with a base year or an expense stop (per square foot of the building, or a building amount), optionally grossing up the variable lines of both years to the same occupancy, each year by its own factor, and splits the excess by each tenant's pro rata share with its true-up against the estimates paid. The excess is worked out from the totals and line by line, each share is checked against the excess × its share, shares plus the unleased remainder add up to the excess, and shares plus the part not passed through add back to the year's expenses to the cent. Use it when someone asks what each tenant owes above a base year or an expense stop, or wants an operating expense escalation true-up checked. Not for splitting a whole CAM pool without a base, and not for deciding the base year, the stop or the shares a lease sets.",
  question: "How much of this year’s operating expenses above the 2024 base year does each tenant owe, with variable lines grossed up to 95%?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet as a whole number.", required: true },
    { name: "lines", kind: "file", label: "Expense lines", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line passed through: Expense line, Base year amount (needed with a base year; not used with a stop), Comparison year amount, and Variable (Yes for lines that change with occupancy; blank is No). Amounts are zero or more.", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: `${TENANT_FILE} List only the tenants on this base.`, required: true },
    { name: "stopPerSquareFoot", kind: "amount", label: "Stop per square foot", description: "Optional. An expense stop as an amount per square foot of the building, such as 5.50. Without a stop, the base is the base year’s expenses.", required: false },
    { name: "stopAmount", kind: "amount", label: "Stop amount", description: "Optional. An expense stop as one amount for the building. Give this or stopPerSquareFoot, not both.", required: false },
    { name: "grossUpOccupancyPercent", kind: "number", label: "Gross-up occupancy percent", description: "Optional. The occupancy variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95. With a stop, only the comparison year is grossed up. Without it, no gross-up.", required: false },
    { name: "baseYearOccupiedSquareFeet", kind: "number", label: "Occupied square feet, base year", description: "With a gross-up and a base year: the occupied square feet in the base year, as a whole number.", required: false },
    { name: "comparisonYearOccupiedSquareFeet", kind: "number", label: "Occupied square feet, comparison year", description: "With a gross-up: the occupied square feet in the comparison year, as a whole number.", required: false },
    { name: "baseYearLabel", kind: "text", label: "Base year label", description: "Optional. The base year as the lease names it, such as 2024, for the result’s labels.", required: false },
    { name: "comparisonYearLabel", kind: "text", label: "Comparison year label", description: "Optional. The comparison year, such as 2026, for the result’s labels.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    columnsInput("Expense lines", STOP_LINE_COLUMNS, "lineColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven calculates from the figures given; it does not decide the base year, the stop, which lines pass through, which are variable, or any tenant’s share, which the lease sets.",
  run({ files, values }) {
    const gla = squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const rate = cents(values.stopPerSquareFoot);
    const amount = cents(values.stopAmount);
    if (rate !== void 0 && amount !== void 0) throw new AgentInputError("Give the stop per square foot or the stop amount, not both.");
    const base = rate !== void 0 ? { kind: "stop-per-sqft", centsPerSqFt: rate } : amount !== void 0 ? { kind: "stop-amount", amount } : { kind: "base-year" };
    const isBaseYear = base.kind === "base-year";
    let grossUp;
    if (values.grossUpOccupancyPercent !== void 0) {
      const grossUpBp = percentValue(values.grossUpOccupancyPercent, "The gross-up occupancy", true);
      if (grossUpBp === 0) throw new AgentInputError("The gross-up occupancy must be more than zero, or left out for none.");
      if (values.comparisonYearOccupiedSquareFeet === void 0) throw new AgentInputError("A gross-up needs the comparison year’s occupied square feet (comparisonYearOccupiedSquareFeet).");
      if (isBaseYear && values.baseYearOccupiedSquareFeet === void 0) throw new AgentInputError("A gross-up with a base year needs the base year’s occupied square feet (baseYearOccupiedSquareFeet).");
      grossUp = {
        grossUpBp,
        baseOccupiedSqFt: isBaseYear ? squareFeetValue(values.baseYearOccupiedSquareFeet, "Occupied square feet in the base year") : 0,
        currentOccupiedSqFt: squareFeetValue(values.comparisonYearOccupiedSquareFeet, "Occupied square feet in the comparison year")
      };
    } else if (values.baseYearOccupiedSquareFeet !== void 0 || values.comparisonYearOccupiedSquareFeet !== void 0) {
      throw new AgentInputError("Occupied square feet were given without a gross-up occupancy (grossUpOccupancyPercent). Give the gross-up occupancy, or leave the occupied square feet out.");
    }
    const columns = { ...STOP_LINE_COLUMNS, required: isBaseYear ? ["category", "baseAmount", "currentAmount"] : ["category", "currentAmount"] };
    const lineFigures = isBaseYear ? { baseAmount: centsFigure("base year amount"), currentAmount: centsFigure("comparison year amount") } : { currentAmount: centsFigure("comparison year amount") };
    const ln2 = readRows(oneFile(files, "lines"), columns, values.lineColumns, "Expense lines", "category", lineFigures, (cell, i) => {
      const category = cell("category");
      const baseCell = isBaseYear ? cell("baseAmount") : "";
      if (category === "" && isNothing(baseCell, cell("currentAmount"))) return null;
      return {
        category: category || `Line ${i + 1}`,
        baseAmount: isBaseYear ? cellNonNegative(baseCell, "base year amount") : 0,
        currentAmount: cellNonNegative(cell("currentAmount"), "comparison year amount"),
        variable: cellYesNo(cell("variable"), false, "Variable", VARIABLE_WORDS.yes, VARIABLE_WORDS.no)
      };
    });
    const tn = readRows(oneFile(files, "tenants"), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(true));
    needRows(ln2);
    needRows(tn);
    const r = computeExpenseStop({
      property: text(values.property) ?? "",
      baseLabel: text(values.baseYearLabel) ?? "",
      currentLabel: text(values.comparisonYearLabel) ?? "",
      totalLeasableSqFt: gla,
      base,
      ...grossUp ? { grossUp } : {},
      lines: ln2.records,
      tenants: tn.records
    });
    const shares = sum(r.tenants.map((t) => t.share));
    const net = sum(r.tenants.map((t) => t.trueUp));
    const current = r.input.currentLabel ? `the ${r.input.currentLabel} expenses` : "the comparison year expenses";
    return {
      summary: `The base is ${formatUSD(r.baseAmount)} (${stopBaseText(r).toLowerCase()}) and ${current}${grossUp ? ", grossed up," : ""} are ${formatUSD(r.currentYear.adjusted)}, so the excess is ${formatUSD(r.excess)}${r.belowBase ? " (the expenses are at or below the base, so nothing passes through)" : ""}. ${r.tenants.length} tenant share(s) ${formatUSD(shares)} and the unleased remainder ${formatUSD(r.unleased)} add up to the excess; ${formatUSD(r.landlord)} is not passed through to the tenants listed (${r.belowBase ? "all of the expenses, which are at or below the base" : "the base plus that remainder"}). Net true-up (credits subtracted): ${dueOrCredit(net)}.${r.excessWithoutGrossUp !== null ? ` Without the gross-up the excess would have been ${formatUSD(r.excessWithoutGrossUp)}.` : ""}${grossUp && !isBaseYearOf(r) ? " With a stop, only the comparison year is grossed up." : ""}`,
      tables: stopTables(r),
      checks: [...r.checks, ...rowChecks(ln2, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a 100,000 sq ft office building, base year 2024 at 80% occupied, comparison year 2026 at 90%, grossed up to 95%",
      args: {
        totalLeasableSquareFeet: "100000",
        lines: "agents-fixture:property-management/expense-stop-lines.csv",
        tenants: "agents-fixture:property-management/expense-stop-tenants.csv",
        grossUpOccupancyPercent: "95",
        baseYearOccupiedSquareFeet: "80000",
        comparisonYearOccupiedSquareFeet: "90000",
        baseYearLabel: "2024",
        comparisonYearLabel: "2026",
        property: "Example Office Plaza"
      },
      verified: true,
      contains: [
        "The base is $566,000.00",
        "are $618,500.00, so the excess is $52,500.00",
        "| Janitorial | Yes | 128000.00 | 152000.00 | 162000.00 | 171000.00 | 19000.00 |",
        "| Harbor Law Group | 25000 | 25.00% | 13125.00 | 12000.00 | 1125.00 |",
        "| North Studio Architects | 15000 | 15.00% | 7875.00 | 9600.00 | -1725.00 |",
        "| Pine Insurance Agency | 40000 | 40.00% | 21000.00 | 19800.00 | 1200.00 |",
        "the unleased remainder $10,500.00",
        "$576,500.00 is not passed through",
        "Without the gross-up the excess would have been $79,500.00"
      ]
    },
    {
      label: "Tenants that lease more than the whole building are not verified",
      args: {
        totalLeasableSquareFeet: "100000",
        lines: "Expense line,Base year amount,Comparison year amount\nReal estate taxes,240000.00,262000.00\n",
        tenants: "Tenant,Square feet,Estimates paid\nHarbor Law Group,60000,12000.00\nPine Insurance Agency,50000,19800.00\n"
      },
      verified: false,
      failedCheck: "shares-within-100"
    }
  ]
};
var LEDGER_COLUMNS = {
  roles: ["date", "description", "amount", "type"],
  labels: { date: "Date", description: "Description", amount: "Amount", type: "Type" },
  required: ["date", "amount"],
  guess: (rows, at) => {
    const m = at === void 0 ? guessOwnerLedgerColumns(rows) : { ...guessOwnerLedgerColumns([rows[at] ?? []]), headerRow: at };
    return { headerRow: m.headerRow, columns: { date: m.date, description: m.description, amount: m.amount, type: m.type } };
  }
};
function typeMeanings(v) {
  const out = {};
  const t = text(v);
  if (!t) return out;
  for (const part of t.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.lastIndexOf("=");
    if (eq < 0) throw new AgentInputError(`"typeMeanings" must be written as "<type in the file> = income", separated by commas: "${part.trim()}".`);
    const left = pmNormalizeHeader(part.slice(0, eq));
    const key = left === "blank" || left === "no type" ? "" : left;
    const word = pmNormalizeHeader(part.slice(eq + 1));
    const kind = word === "income" ? "income" : word === "expense" || word === "expenses" ? "expense" : ["distribution", "distributions", "paid to owner", "owner distribution"].includes(word) ? "distribution" : ["leave out", "left out", "skip", "not part of this statement"].includes(word) ? "skip" : void 0;
    if (!kind) throw new AgentInputError(`In "typeMeanings", "${part.slice(eq + 1).trim()}" must be one of: income, expense, paid to owner, leave out.`);
    out[key] = kind;
  }
  return out;
}
function rowNumbers(v) {
  const t = text(v);
  if (!t) return [];
  return t.split(/[,;\s]+/).filter((s) => s !== "").map((s) => {
    if (!/^\d+$/.test(s)) throw new AgentInputError(`"leaveOutRows" lists row numbers as the spreadsheet shows them, such as "7, 12": "${s}".`);
    return Number(s);
  });
}
var ownerStatements = {
  name: "owner_statement_from_ledger",
  page: `${SECTION}/owner-statements`,
  section: SECTION,
  kind: "tool",
  title: "Owner statement for a managed rental from a ledger",
  description: "Builds a monthly owner statement for a managed rental from a ledger (.csv or .xlsx with date, description, amount and type columns): income, expenses, the management fee at the rate given (optionally only on income lines containing a word such as rent), what was paid to the owner, and the closing balance that carries into the next period. The closing balance and the fee are worked out a second way, every ledger row is either imported once or listed as left out, each imported amount is read from its cell a second time, and a row that cannot be read, or whose type does not say which way the money went, fails a check that names the row. Use it when someone asks for an owner statement or a monthly owner report from their own rental ledger, or wants the fee and closing balance checked. Not for tenant ledgers or rent rolls, and not for deciding what a management agreement allows.",
  question: "Can you make January’s owner statement from this rental ledger, with an 8% management fee on rent and a $300 reserve?",
  inputs: [
    { name: "ledger", kind: "file", label: "Ledger", description: "A .csv or .xlsx file (a path, or the CSV text itself) with one row per transaction: Date and Amount are needed; Description and Type (Income, Expense or Distribution, meaning money paid to the owner) are used when present. Without a type column, positive amounts are income and negative amounts expenses. A filled-in owner statement template can be given as it is: its Ledger sheet is read.", required: true },
    { name: "periodStart", kind: "date", label: "Period start", description: "The first day of the statement period, YYYY-MM-DD.", required: true },
    { name: "periodEnd", kind: "date", label: "Period end", description: "The last day of the statement period, YYYY-MM-DD.", required: true },
    { name: "openingBalance", kind: "amount", label: "Opening balance", description: "Optional. The balance carried in from last period. Without it, zero.", required: false },
    { name: "managementFeePercent", kind: "number", label: "Management fee percent", description: "Optional. The management fee as a percent of income, such as 8. Without it, no fee.", required: false },
    { name: "feeOnIncomeContaining", kind: "text", label: "Fee only on income lines containing", description: 'Optional. A word such as "rent": the fee is figured only on income lines whose description contains it, ignoring case. Without it, on all income.', required: false },
    { name: "reserve", kind: "amount", label: "Reserve held", description: "Optional. A reserve the manager keeps; a warning shows when the closing balance is below it.", required: false },
    { name: "owner", kind: "text", label: "Owner", description: "Optional. The owner’s name, for the statement.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property, for the statement.", required: false },
    { name: "expenseSign", kind: "choice", label: "How the ledger writes expenses", description: 'Optional. "from-file" (the default) reads it from the file and imports nothing when expense rows are written with both signs; "negative" or "positive" says how expenses are written, and rows written the other way become reversals (a vendor refund reduces expenses).', required: false, choices: ["from-file", "negative", "positive"] },
    { name: "typeMeanings", kind: "text", label: "What unrecognized types mean", description: 'Optional. For a type the tool does not recognize or that does not say which way money went (Payment, Charge, Credit, Deposit): "<type in the file> = income | expense | paid to owner | leave out", separated by commas, such as "Rent payment = income, Owner draw = paid to owner". "blank" names rows with no type. Nothing is assumed without it.', required: false },
    { name: "leaveOutRows", kind: "text", label: "Rows to leave out", description: 'Optional. Row numbers of the ledger (as the spreadsheet shows them) that could not be imported and that the person has chosen to leave out, such as "7, 12". Each stays on the certificate as a warning.', required: false },
    { name: "dateOrder", kind: "choice", label: "Dates written with numbers only", description: 'Optional. "month-first" (the default, 3/2/2026 is March 2) or "day-first".', required: false, choices: ["month-first", "day-first"] },
    columnsInput("Ledger", LEDGER_COLUMNS, "ledgerColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven adds up the ledger rows given and works out the fee at the rate entered; it does not read a management agreement or say what to pay the owner.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "ledger"), /ledger/i);
    const periodStart = values.periodStart;
    const periodEnd = values.periodEnd;
    if (periodEnd < periodStart) throw new AgentInputError("The period end is before the period start.");
    const m = mapColumns(file, LEDGER_COLUMNS, text(values.ledgerColumns), "Ledger");
    const mapping = { headerRow: m.headerRow, date: m.columns.date, description: m.columns.description, amount: m.columns.amount, type: m.columns.type };
    const sign = values.expenseSign === "negative" || values.expenseSign === "positive" ? values.expenseSign : "auto";
    const leaveOut = rowNumbers(values.leaveOutRows);
    const x = extractOwnerLedger(file.rows, mapping, { outflowSign: sign, dateOrder: values.dateOrder === "day-first" ? "dmy" : "mdy", typeMap: typeMeanings(values.typeMeanings), dismissedRows: leaveOut });
    const leftOut = new Set(x.skipped.map((s) => s.rowNumber));
    const notLeftOut = leaveOut.filter((n) => !leftOut.has(n));
    if (notLeftOut.length > 0) {
      const open = [...leftOut].sort((a, b) => a - b);
      throw new AgentInputError(
        `"leaveOutRows" names row ${notLeftOut.join(", ")}, which ${notLeftOut.length === 1 ? "is" : "are"} not a row the ledger import left out (${notLeftOut.length === 1 ? "it was" : "they were"} imported, or ${notLeftOut.length === 1 ? "holds" : "hold"} no data). Rows left out of this import: ${open.length ? open.join(", ") : "none"}.`
      );
    }
    const feeBp = values.managementFeePercent === void 0 ? 0 : percentValue(values.managementFeePercent, "The management fee percent");
    const pattern = ownerFeePattern(text(values.feeOnIncomeContaining) ?? "");
    const reserve = cents(values.reserve);
    const input = {
      owner: text(values.owner) ?? "",
      property: text(values.property) ?? "",
      periodStart,
      periodEnd,
      openingBalance: cents(values.openingBalance) ?? 0,
      income: x.income,
      expenses: x.expenses,
      managementFeeBp: feeBp,
      ...pattern ? { feeOnIncomeMatching: pattern } : {},
      distributions: x.distributions,
      ...reserve !== void 0 ? { reserve } : {}
    };
    const r = computeOwnerStatement(input);
    const t = ownerStatementTables(r);
    const u = formatUSD;
    return {
      summary: `Income ${u(r.totalIncome)}, expenses ${u(r.totalExpenses)}, management fee ${u(r.managementFee)} (${ownerFeeRateText(feeBp)} of ${u(r.feeBase)}), paid to owner ${u(r.totalDistributions)}. Closing balance: ${u(input.openingBalance)} + ${u(r.totalIncome)} − ${u(r.totalExpenses)} − ${u(r.managementFee)} − ${u(r.totalDistributions)} = ${u(r.closingBalance)}, the next period's opening balance. ${x.placed.length} ledger row(s) imported: ${x.income.length} income, ${x.expenses.length} expense, ${x.distributions.length} paid to owner${x.reversals.length ? `, ${x.reversals.length} of them reversals` : ""}.`,
      tables: [
        { name: "Statement", rows: t.summary },
        { name: "Details", rows: [["Item", "Value"], ["Owner", input.owner], ["Property", input.property], ["Period start", periodStart], ["Period end", periodEnd]] },
        { name: "Income", rows: t.income },
        { name: "Expenses", rows: t.expenses },
        { name: "Paid to owner", rows: t.distributions }
      ],
      checks: [...r.checks, ...x.checks]
    };
  },
  examples: [
    {
      label: "The page's worked example: Maple Ridge Holdings LLC, 48 Alder Court, January 2026, $500.00 opening, 8% on rent, $300.00 reserve",
      args: {
        ledger: "fixture:owner-ledger.csv",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        openingBalance: "500.00",
        managementFeePercent: "8",
        feeOnIncomeContaining: "rent",
        reserve: "300.00",
        owner: "Maple Ridge Holdings LLC",
        property: "48 Alder Court"
      },
      verified: true,
      contains: ["Income $2,800.00, expenses $445.50, management fee $220.00 (8% of $2,750.00)", "$500.00 + $2,800.00 − $445.50 − $220.00 − $2,000.00 = $634.50", "| Management fee (8% of 2750.00) | -220.00 |", "| Closing balance | 634.50 |"]
    },
    {
      label: "A ledger row whose amount cannot be read is not verified",
      args: { ledger: "Date,Description,Amount,Type\n1/3/2026,Rent - Unit 1,1450.00,Income\n1/12/2026,Plumbing repair,32S.50,Expense\n", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
      verified: false,
      failedCheck: "ledger-row-3"
    }
  ]
};
var DEDUCTION_ROLES = ["description", "amount"];
var DEDUCTION_COLUMNS = {
  roles: DEDUCTION_ROLES,
  labels: { description: "Description", amount: "Amount" },
  required: ["amount"],
  guess: (rows, at) => sheetGuessColumns(rows, DEDUCTION_ROLES, { description: ["description", "deduction", "item", "reason", "charge", "memo"], amount: ["amount", "cost", "charge amount", "total"] }, at)
};
var PAID_ROLES = ["date", "amount"];
var PAID_COLUMNS = {
  roles: PAID_ROLES,
  labels: { date: "Date", amount: "Amount" },
  required: ["amount"],
  guess: (rows, at) => sheetGuessColumns(rows, PAID_ROLES, { date: ["date", "date paid", "paid on", "payment date"], amount: ["amount", "interest paid", "amount paid", "interest"] }, at)
};
function depositMethodLabel(r) {
  const rate = formatPercentBp(r.input.rateBp);
  return r.input.method === "simple" ? `${rate} a year, simple interest, actual days / 365` : `${rate} a year, compounded annually on each anniversary of the date received; simple interest (actual days / 365) for the final part-year; interest already paid out leaves the compounding balance on its date`;
}
var securityDeposit = {
  name: "security_deposit_interest_statement",
  page: `${SECTION}/security-deposit`,
  section: SECTION,
  kind: "tool",
  title: "Security deposit interest and itemized deposit statement",
  description: "Works out interest on a tenant's security deposit at the annual rate given (simple interest on actual days / 365, or compounded on each anniversary of the date received), subtracts interest already paid and itemized deductions, and gives the amount to return to the tenant or the balance the tenant owes, as an itemized statement with the interest by period. Interest is figured twice in different orders of operations, days held are counted two ways, the balance is rebuilt line by line, and figures from a statement prepared elsewhere can be compared with the calculated ones. Use it when someone asks how much interest a deposit earned, wants an itemized deposit statement at move-out, or wants a deposit statement checked. Not for finding which rate, method or deductions a state or lease allows: the rate is the person's to give.",
  question: "How much interest has a $1,800 security deposit earned at 2% since March 2023, and what is left to return after these deductions?",
  inputs: [
    { name: "deposit", kind: "amount", label: "Deposit amount", description: "The security deposit received, such as 1800.00.", required: true },
    { name: "receivedOn", kind: "date", label: "Date received", description: "The day the deposit was received, YYYY-MM-DD (day zero of the count).", required: true },
    { name: "moveOutOn", kind: "date", label: "Move-out date", description: "The move-out day, YYYY-MM-DD (the last day counted).", required: true },
    { name: "annualRatePercent", kind: "number", label: "Annual interest rate percent", description: "The annual rate from the lease or a local rule, as a percent from 0 to 100 with at most two decimal places, such as 2 or 0.05. 0 is allowed. The tool does not supply a rate.", required: true },
    { name: "method", kind: "choice", label: "Interest method", description: 'Optional. "simple" (the default: deposit × rate × actual days / 365) or "compound-annual" (a year’s interest added on each anniversary, simple interest for the last part-year).', required: false, choices: ["simple", "compound-annual"] },
    { name: "deductions", kind: "file", label: "Deductions", description: "Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per deduction: Description and Amount. A last row that adds them up, named Total or left blank, is left out.", required: false },
    { name: "interestPaid", kind: "file", label: "Interest already paid", description: "Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per payment of interest already paid or credited to the tenant: Date, written YYYY-MM-DD (a date written with slashes, such as 1/3/2024, is refused so the day and month cannot be mixed up; with compounding, a dated payment leaves the balance on that date), and Amount.", required: false },
    { name: "statedInterest", kind: "amount", label: "Interest on an existing statement", description: "Optional. The interest shown on a statement prepared elsewhere, to compare with the calculated interest.", required: false },
    { name: "statedBalance", kind: "amount", label: "Amount returned on an existing statement", description: "Optional. The amount returned on a statement prepared elsewhere (negative if the tenant owes), to compare with the calculated balance.", required: false },
    { name: "tenant", kind: "text", label: "Tenant", description: "Optional. The tenant’s name, for the statement.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property, for the statement.", required: false },
    columnsInput("Deductions", DEDUCTION_COLUMNS, "deductionColumns"),
    columnsInput("Interest already paid", PAID_COLUMNS, "interestPaidColumns")
  ],
  limits: "site",
  comparisonChecks: ["stated-interest", "stated-balance"],
  notAdvice: "Mathproven figures interest only at the rate entered; it does not choose a rate or say which rate, method, or deductions apply to a tenancy.",
  run({ files, values }) {
    const deposit = values.deposit;
    if (deposit <= 0) throw new AgentInputError("The deposit amount must be more than zero.");
    const rateBp = percentValue(values.annualRatePercent, "The annual interest rate", true);
    const reads = [];
    let deductions = [];
    const deductionFile = files.deductions?.[0];
    if (deductionFile) {
      const rd = readRows(deductionFile, DEDUCTION_COLUMNS, values.deductionColumns, "Deductions", "description", { amount: centsFigure("amount") }, (cell, i2) => {
        const description = cell("description");
        const amount = cell("amount");
        if (description === "" && amount === "") return null;
        if (amount === "") throw new Error("no amount");
        return { description: description || `Deduction ${i2 + 1}`, amount: cellCents(amount, "amount") };
      });
      reads.push(rd);
      deductions = rd.records;
    }
    let interestPaid = [];
    const paidFile = files.interestPaid?.[0];
    if (paidFile) {
      const rp = readRows(paidFile, PAID_COLUMNS, values.interestPaidColumns, "Interest already paid", "date", { amount: centsFigure("amount") }, (cell) => {
        const date = cell("date");
        const amount = cell("amount");
        if (date === "" && amount === "") return null;
        if (amount === "") throw new Error("no amount");
        return { date: date === "" ? "" : cellPickerDate(date, "date"), amount: cellCents(amount, "amount") };
      });
      reads.push(rp);
      interestPaid = rp.records;
    }
    const statedInterest = cents(values.statedInterest);
    const statedBalance = cents(values.statedBalance);
    const r = computeSecurityDeposit({
      tenant: text(values.tenant) ?? "",
      property: text(values.property) ?? "",
      deposit,
      receivedOn: values.receivedOn,
      moveOutOn: values.moveOutOn,
      rateBp,
      method: values.method === "compound-annual" ? "compound-annual" : "simple",
      interestPaid,
      deductions,
      ...statedInterest !== void 0 ? { statedInterest } : {},
      ...statedBalance !== void 0 ? { statedBalance } : {}
    });
    const i = r.input;
    const owes = r.balance < 0;
    const u = formatUSD;
    return {
      summary: `Interest earned ${u(r.interestEarned)} over ${r.days} days held (${depositMethodLabel(r)}); interest already paid ${u(r.interestPaid)}; deductions ${u(r.deductionsTotal)}. ${u(i.deposit)} + ${u(r.interestEarned)} − ${u(r.interestPaid)} − ${u(r.deductionsTotal)} = ${owes ? `${u(r.balance)}: a balance of ${u(r.tenantOwes)} owed by the tenant` : `${u(r.refund)} to return to the tenant`}.`,
      tables: [
        {
          name: "Statement",
          rows: [
            ["Line", "Amount"],
            ["Deposit received", d(i.deposit)],
            ["Interest earned", d(r.interestEarned)],
            ...(i.interestPaid ?? []).map((p) => [`Interest already paid or credited${p.date ? ` (${p.date})` : ""}`, d(-p.amount)]),
            ...i.deductions.map((x) => [`Deduction: ${x.description}`, d(-x.amount)]),
            ["Total deductions", d(r.deductionsTotal)],
            [owes ? "Balance owed by tenant" : "Amount to return to tenant", d(owes ? r.tenantOwes : r.refund)]
          ]
        },
        { name: "Interest", rows: [["Interest period", "From", "To", "Days", "Balance earning interest", "Interest"], ...r.periods.map((p) => [p.label, p.from, p.to, p.days, d(p.base), d(p.interest)])] },
        {
          name: "Details",
          rows: [["Item", "Value"], ["Tenant", i.tenant], ["Property", i.property], ["Date received", i.receivedOn], ["Move-out date", i.moveOutOn], ["Days held", r.days], ["Interest", depositMethodLabel(r)]]
        }
      ],
      checks: [...r.checks, ...reads.length ? rowChecks(...reads) : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: $1,800.00 received 2023-03-01, move-out 2025-06-30, 2% simple, $36.00 already paid, three deductions",
      args: {
        deposit: "1800.00",
        receivedOn: "2023-03-01",
        moveOutOn: "2025-06-30",
        annualRatePercent: "2",
        method: "simple",
        interestPaid: "Date,Amount\n2024-03-01,36.00\n",
        deductions: "Description,Amount\nCarpet cleaning,185.00\nWall repair and paint,240.00\nUnpaid water bill,62.47\n"
      },
      verified: true,
      contains: ["Interest earned $84.03 over 852 days held", "deductions $487.47", "$1,800.00 + $84.03 − $36.00 − $487.47 = $1,360.56", "| Amount to return to tenant | 1360.56 |", "| Deduction: Wall repair and paint | -240.00 |"]
    },
    {
      label: "A statement prepared elsewhere that returns a different amount is not verified",
      args: { deposit: "1800.00", receivedOn: "2023-03-01", moveOutOn: "2025-06-30", annualRatePercent: "2", deductions: "Description,Amount\nCarpet cleaning,185.00\n", statedBalance: "1615.00" },
      verified: false,
      failedCheck: "stated-balance"
    }
  ]
};
var PAYOUT_COLUMNS = {
  roles: STR_PAYOUT_ROLES,
  labels: STR_ROLE_LABELS,
  required: ["payoutDate", "payoutAmount"],
  guess: (rows, at) => {
    const m = strGuessPayoutColumns(rows, at);
    return { headerRow: m.headerRow, columns: m.columns };
  }
};
var BANK_COLUMNS = {
  roles: STR_BANK_ROLES,
  labels: STR_BANK_LABELS,
  required: ["date", "amount"],
  guess: (rows, at) => {
    const m = strGuessBankColumns(rows, at);
    return { headerRow: m.headerRow, columns: m.columns };
  }
};
function amountSigns(guessed, v) {
  const out = { ...guessed };
  const t = text(v);
  if (!t) return out;
  for (const part of t.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"amountSigns" must be written as "<column> = add" or "<column> = subtract": "${part.trim()}".`);
    const name = pmNormalizeHeader(part.slice(0, eq));
    const role = STR_COMPONENT_ROLES.find((r) => pmNormalizeHeader(STR_ROLE_LABELS[r]) === name || pmNormalizeHeader(r) === name);
    if (!role) throw new AgentInputError(`"${part.slice(0, eq).trim()}" is not one of the amounts in a payout row. They are: ${STR_COMPONENT_ROLES.map((r) => STR_ROLE_LABELS[r]).join(", ")}.`);
    const word = pmNormalizeHeader(part.slice(eq + 1));
    if (["add", "added", "plus"].includes(word)) out[role] = "add";
    else if (["subtract", "subtracted", "minus"].includes(word)) out[role] = "subtract";
    else throw new AgentInputError(`In "amountSigns", "${part.slice(eq + 1).trim()}" must be add or subtract.`);
  }
  return out;
}
var bucketText = (b) => `${b.count} (${formatUSD(b.sum)})`;
var strPayouts = {
  name: "short_term_rental_payout_reconciler",
  page: `${SECTION}/str-payout-reconciler`,
  section: SECTION,
  kind: "tool",
  title: "Short-term rental payouts matched to bank deposits",
  description: "Ties out a payout or earnings report exported from a short-term rental platform (.csv or .xlsx) against a bank statement export: each report row is checked (gross earnings − fees ± cleaning fees, taxes and adjustments, as mapped, = payout), rows are grouped into payouts by payout id or payout date, and each payout is matched to exactly one bank deposit of the same amount within a date window (5 days unless given). A payout or deposit with more than one possible pairing is listed as ambiguous and never matched, no payout or deposit is used twice, and matched + ambiguous + unmatched is checked against all payouts and all deposits by count and by amount. Use it when someone asks whether their rental payouts reached the bank, or wants host payouts reconciled with bank deposits. Not affiliated with any rental platform; not for booking calendars, guest messages or tax returns.",
  question: "Do the payouts in my short-term rental earnings report match the deposits on my bank statement?",
  inputs: [
    { name: "payoutReport", kind: "file", label: "Payout report", description: "The payout or earnings report exported from the rental platform: a .csv or .xlsx file (a path, or the CSV text itself) with a header row. Payout date and payout amount are needed; reservation code, payout id, gross earnings, fees, cleaning fees, taxes and adjustments are used when present.", required: true },
    { name: "bankStatement", kind: "file", label: "Bank statement", description: "The bank statement export: a .csv or .xlsx file (a path, or the CSV text itself) with Date and Amount columns, and Description when present. Only money coming in is matched.", required: true },
    { name: "windowDays", kind: "number", label: "Days allowed between payout and deposit", description: "Optional. How many days a deposit may be before or after its payout date, a whole number from 0 to 60. Without it, 5.", required: false },
    { name: "groupBy", kind: "choice", label: "Group report rows into payouts by", description: 'Optional. "auto" (the default: payout id when every row has one, otherwise payout date), "payout-id" or "payout-date".', required: false, choices: ["auto", "payout-id", "payout-date"] },
    { name: "bankDescriptionContains", kind: "text", label: "Only bank deposits whose description contains", description: 'Optional. Text a deposit’s description must contain to be considered, ignoring case, such as "payout". Narrows ties between deposits of the same amount.', required: false },
    { name: "bankMoneyIn", kind: "choice", label: "Money in on the bank statement is shown as", description: 'Optional. "positive" (the default) or "negative" amounts.', required: false, choices: ["positive", "negative"] },
    { name: "undatedRows", kind: "choice", label: "Report rows with an amount but no payout date", description: 'Optional. "report" (the default: listed as rows that could not be read, so the result is not verified), "inherit" (given the payout date of the row above) or "leave-out" (totals or notes). Either of the last two is recorded as a warning that names the rows. A totals row whose amounts equal the column totals above it is left out by itself.', required: false, choices: ["report", "inherit", "leave-out"] },
    { name: "dateOrder", kind: "choice", label: "Dates written with numbers only", description: 'Optional. "month-first" (the default) or "day-first"; applies to both files.', required: false, choices: ["month-first", "day-first"] },
    { name: "amountSigns", kind: "text", label: "Added or subtracted", description: `Optional. How an amount column enters the payout, when the guess is wrong: "<column> = add" or "<column> = subtract", separated by commas. Columns: ${STR_COMPONENT_ROLES.map((r) => STR_ROLE_LABELS[r]).join(", ")}. By default fees and taxes written as positive numbers are subtracted, and everything else is added as written.`, required: false },
    columnsInput("Payout report", PAYOUT_COLUMNS, "reportColumns"),
    columnsInput("Bank statement", BANK_COLUMNS, "bankColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven only reads the two files given and pairs amounts that match exactly; it is not affiliated with any short-term rental platform and does not decide which pairing is right when more than one is possible.",
  run({ files, values }) {
    const report = oneFile(files, "payoutReport");
    const bank = oneFile(files, "bankStatement");
    const dateOrder = values.dateOrder === "day-first" ? "dmy" : "mdy";
    let windowDays;
    if (values.windowDays !== void 0) {
      const s = String(values.windowDays);
      if (!/^\d+$/.test(s)) throw new AgentInputError(`"windowDays" must be a whole number of days from 0 to 60: "${s}".`);
      windowDays = Number(s);
    }
    const rc = mapColumns(report, PAYOUT_COLUMNS, text(values.reportColumns), "Payout report");
    const effects = amountSigns(strGuessPayoutColumns(report.rows, rc.headerRow).effects, values.amountSigns);
    const bc = mapColumns(bank, BANK_COLUMNS, text(values.bankColumns), "Bank statement");
    const undated = values.undatedRows === "inherit" || values.undatedRows === "leave-out" ? values.undatedRows : "report";
    const lines = strExtractPayoutLines(report.rows, { headerRow: rc.headerRow, columns: rc.columns, effects, dateOrder }, { undatedRows: undated });
    const deposits = strExtractBankDeposits(bank.rows, { headerRow: bc.headerRow, columns: bc.columns, depositsAreNegative: values.bankMoneyIn === "negative", dateOrder }, text(values.bankDescriptionContains) ?? "");
    const groupBy = values.groupBy === "payout-id" ? "payoutId" : values.groupBy === "payout-date" ? "date" : "auto";
    const r = reconcileStrPayouts({
      lines: lines.lines,
      effects,
      deposits: deposits.deposits,
      ...windowDays !== void 0 ? { windowDays } : {},
      groupBy,
      lineProblems: lines.problems,
      bankProblems: deposits.problems,
      lineAssumptions: lines.assumptions
    });
    const t = strReconcileTables(r);
    const p = r.totals.payouts;
    const dp = r.totals.deposits;
    const ties = r.lines.filter((l) => l.ties).length;
    const notes = [
      lines.ignoredRows ? `${lines.ignoredRows} report row(s) with no date were left out: notes with no amount, or totals rows whose amounts equal the column totals of the rows above them.` : "",
      deposits.otherRows ? `${deposits.otherRows} bank row(s) were not money coming in and were left out.` : "",
      deposits.filteredOut ? `${deposits.filteredOut} bank deposit(s) were left out by the description filter.` : ""
    ].filter(Boolean);
    return {
      summary: [
        `${r.lines.length} report row(s) read; ${r.componentsMapped ? `${ties} of them tie` : "only the payout amount is mapped, so the rows were not tied"}. Grouped by ${r.groupedBy === "payoutId" ? "payout id" : "payout date"} there are ${p.all.count} payout(s) totaling ${formatUSD(p.all.sum)}, matched within ${r.windowDays} day(s).`,
        `Payouts: ${bucketText(p.matched)} matched + ${bucketText(p.ambiguous)} ambiguous + ${bucketText(p.unmatched)} unmatched = ${bucketText(p.all)}.`,
        `Deposits: ${bucketText(dp.matched)} matched + ${bucketText(dp.ambiguous)} ambiguous + ${bucketText(dp.unmatched)} unmatched = ${bucketText(dp.all)}.`,
        ...notes
      ].join(" "),
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Matched", rows: t.matched },
        { name: "Ambiguous", rows: t.ambiguous },
        { name: "Payouts without deposit", rows: t.unmatchedPayouts },
        { name: "Deposits without payout", rows: t.unmatchedDeposits },
        { name: "Report rows", rows: t.rows }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: four made-up reservations in three payouts against four bank deposits",
      args: { payoutReport: "fixture:str-payout-report.csv", bankStatement: "fixture:str-bank.csv" },
      verified: true,
      contains: [
        "4 report row(s) read; 4 of them tie",
        "there are 3 payout(s) totaling $2,048.90",
        "Payouts: 1 ($1,133.50) matched + 1 ($341.00) ambiguous + 1 ($574.40) unmatched = 3 ($2,048.90).",
        "Deposits: 1 ($1,133.50) matched + 2 ($682.00) ambiguous + 1 ($900.00) unmatched = 4 ($2,715.50).",
        "| 2026-03-02 | 2026-03-02 | TST-AA101 TST-AA102 | 1133.50 | 2026-03-04 |"
      ]
    },
    {
      label: "A report row whose payout does not equal its parts is not verified",
      args: {
        payoutReport: "Confirmation code,Payout date,Gross earnings,Host service fee,Cleaning fee,Payout amount\nTST-AA101,2026-03-02,600.00,18.00,80.00,672.00\n",
        bankStatement: "Date,Description,Amount\n03/04/2026,ACH DEPOSIT EXAMPLE STAYS PAYOUT,672.00\n"
      },
      verified: false,
      failedCheck: "rows-tie"
    }
  ]
};
function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
function listText(items) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function templateResult(sheets, fileBase, property, firstSheet, filled) {
  const bytes = writeXlsx(sheets);
  const checks = verifyTemplateWorkbook(sheets, bytes);
  const suggestedName = `${[fileBase, slug(property)].filter(Boolean).join("-")}.xlsx`;
  const shown = filled.filter((f) => f.trim() !== "");
  return {
    summary: `A workbook of ${sheets.length} sheets (${sheets.map((s) => s.name).join(", ")}), values only, read back and checked before it is handed over.${shown.length ? ` The ${firstSheet} sheet arrives with ${listText(shown)} already filled in.` : ""}`,
    tables: [{ name: "Workbook", rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), s.rows.length - 1])] }],
    checks,
    file: { suggestedName, bytes }
  };
}
function buildSheets(build) {
  try {
    return build();
  } catch (err2) {
    throw new AgentInputError(err2 instanceof Error ? err2.message : "The workbook could not be built from these answers.");
  }
}
var camTemplate = {
  name: "cam_reconciliation_template_workbook",
  page: `${SECTION}/cam-reconciliation-template`,
  section: SECTION,
  kind: "template",
  title: "CAM reconciliation template workbook (Excel) to fill in",
  description: "Builds a blank Excel workbook for a year-end CAM reconciliation, sized to the property: a Property sheet (name and period filled in), an Expenses sheet with numbered rows (expense category, amount, recoverable Yes or No), a Tenants sheet with one row per tenant (square feet, fixed share percent, estimates paid) and an Instructions sheet. The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants a CAM reconciliation spreadsheet or layout to fill in for a commercial property. Not a calculator: the workbook does not split anything.",
  question: "Can you make me a blank Excel workbook for a CAM reconciliation with 6 tenants and 10 expense rows?",
  inputs: [
    { name: "tenantCount", kind: "number", label: "Number of tenants", description: "Optional. How many tenant rows the Tenants sheet starts with, a whole number from 1 to 500. Without it, 5.", required: false },
    { name: "expenseRows", kind: "number", label: "Number of expense rows", description: "Optional. How many rows the Expenses sheet starts with, a whole number from 1 to 500. Without it, 12.", required: false },
    { name: "property", kind: "text", label: "Property name", description: "Optional. Filled in on the Property sheet and used in the file name.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. Filled in on the Property sheet, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. Filled in on the Property sheet, YYYY-MM-DD; not before the start.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.",
  run({ values }) {
    const property = text(values.property) ?? "";
    const periodStart = text(values.periodStart) ?? "";
    const periodEnd = text(values.periodEnd) ?? "";
    const tenantCount = countValue(values.tenantCount, "The number of tenants", 5);
    const expenseRows = countValue(values.expenseRows, "The number of expense rows", 12);
    const sheets = buildSheets(() => camTemplateSheets({ property, periodStart, periodEnd, tenantCount, expenseRows }));
    return templateResult(sheets, "cam-reconciliation-template", property, "Property", [property, periodStart, periodEnd]);
  },
  examples: [
    {
      label: "The page's worked example: Example Plaza, 6 tenants, 10 expense rows, 2025",
      args: { property: "Example Plaza", tenantCount: "6", expenseRows: "10", periodStart: "2025-01-01", periodEnd: "2025-12-31" },
      verified: true,
      contains: [
        "| Property | Item, Value | 5 |",
        "| Expenses | Line, Expense category, Amount, Recoverable (Yes or No) | 10 |",
        "| Tenants | Line, Tenant, Square feet, Fixed share percent (optional), Estimates paid | 6 |",
        "| Instructions | How this workbook is laid out | 7 |",
        "The Property sheet arrives with Example Plaza, 2025-01-01, and 2025-12-31 already filled in.",
        "cam-reconciliation-template-example-plaza.xlsx"
      ]
    }
  ]
};
var ownerTemplate = {
  name: "owner_statement_template_workbook",
  page: `${SECTION}/owner-statement-template`,
  section: SECTION,
  kind: "template",
  title: "Owner statement template workbook (Excel) with a ledger sheet",
  description: "Builds a blank Excel workbook for a monthly rental owner statement: a Statement sheet (owner, property and period filled in, the totals left to fill), a Ledger sheet with Date, Description, Amount and Type columns and as many rows as asked, and an Instructions sheet. Type is one of Income, Expense or Distribution (money paid to the owner). The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants an owner statement spreadsheet or a ledger layout to fill in for a managed rental. Not a calculator: the workbook does not add anything up.",
  question: "Can you give me a blank owner statement spreadsheet with a ledger sheet for January?",
  inputs: [
    { name: "ledgerRows", kind: "number", label: "Number of ledger rows", description: "Optional. How many rows the Ledger sheet starts with, a whole number from 1 to 500. Without it, 30.", required: false },
    { name: "owner", kind: "text", label: "Owner name", description: "Optional. Filled in on the Statement sheet.", required: false },
    { name: "property", kind: "text", label: "Property name", description: "Optional. Filled in on the Statement sheet and used in the file name.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. Filled in on the Statement sheet, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. Filled in on the Statement sheet, YYYY-MM-DD; not before the start.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.",
  run({ values }) {
    const owner = text(values.owner) ?? "";
    const property = text(values.property) ?? "";
    const periodStart = text(values.periodStart) ?? "";
    const periodEnd = text(values.periodEnd) ?? "";
    const ledgerRows = countValue(values.ledgerRows, "The number of ledger rows", 30);
    const sheets = buildSheets(() => ownerStatementTemplateSheets({ owner, property, periodStart, periodEnd, ledgerRows }));
    return templateResult(sheets, "owner-statement-template", property, "Statement", [owner, property, periodStart, periodEnd]);
  },
  examples: [
    {
      label: "The page's worked example: Example Owner LLC, 12 Example St, 25 ledger rows, January 2026",
      args: { owner: "Example Owner LLC", property: "12 Example St", ledgerRows: "25", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
      verified: true,
      contains: [
        "| Statement | Item, Value | 12 |",
        "| Ledger | Date, Description, Amount, Type | 25 |",
        "| Instructions | How this workbook is laid out | 7 |",
        "The Statement sheet arrives with Example Owner LLC, 12 Example St, 2026-01-01, and 2026-01-31 already filled in.",
        "owner-statement-template-12-example-st.xlsx"
      ]
    }
  ]
};
var PROPERTY_MANAGEMENT = [camReconciliation, camGrossUp, expenseStop, ownerStatements, securityDeposit, strPayouts, camTemplate, ownerTemplate];
var PROPERTY_MANAGEMENT_NOT_FOR_AGENTS = [];

export {
  writeXlsx,
  readXlsx,
  parseCivilDate,
  AgentInputError,
  checkValue,
  beginColumnLog,
  takeColumnLog,
  TENANT_COLUMNS,
  PROPERTY_MANAGEMENT,
  PROPERTY_MANAGEMENT_NOT_FOR_AGENTS
};
