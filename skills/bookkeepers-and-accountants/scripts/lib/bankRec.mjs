// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AmountError,
  CheckList,
  assertCents,
  decimalToCents,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/statements/reconcile.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function verifyBankStatement(s) {
  const checks = new CheckList();
  assertCents(s.openingBalance, "opening balance");
  assertCents(s.closingBalance, "closing balance");
  const amounts = s.transactions.map((t) => assertCents(t.amount, `amount on ${t.date}`));
  const computedClose = s.openingBalance + sum(amounts);
  checks.cents("balance", "Opening balance + transactions = closing balance", s.closingBalance, computedClose);
  let running = s.openingBalance;
  let badRows = 0;
  let firstBad = "";
  let printed = 0;
  s.transactions.forEach((t, i) => {
    running += t.amount;
    if (t.balance !== void 0) {
      printed++;
      if (t.balance !== running) {
        badRows++;
        if (!firstBad) firstBad = `row ${i + 1} (${t.date}): printed ${formatUSD(t.balance)}, computed ${formatUSD(running)}`;
        running = t.balance;
      }
    }
  });
  if (printed > 0) {
    checks.that("running-balance", "Every printed running balance matches the math", badRows === 0, `${badRows} row(s) off; first: ${firstBad}`);
  }
  const badDates = s.transactions.filter((t) => !isIsoDate(t.date));
  checks.that("dates-valid", "Every transaction has a valid date", badDates.length === 0, `${badDates.length} invalid date(s), first: "${badDates[0]?.date}"`);
  if (s.periodStart && s.periodEnd) {
    const start = s.periodStart;
    const end = s.periodEnd;
    const outside = s.transactions.filter((t) => isIsoDate(t.date) && (t.date < start || t.date > end));
    checks.that("dates-in-period", "Every transaction falls inside the statement period", outside.length === 0, `${outside.length} transaction(s) outside ${start} to ${end}`, "warning");
  }
  if (s.summary) {
    const deposits = amounts.filter((a) => a > 0);
    const withdrawals = amounts.filter((a) => a < 0);
    if (s.summary.depositsTotal !== void 0) {
      checks.cents("deposits-total", "Deposits add up to the summary total", s.summary.depositsTotal, sum(deposits));
    }
    if (s.summary.depositsCount !== void 0) {
      checks.equal("deposits-count", "Deposit count matches the summary", s.summary.depositsCount, deposits.length);
    }
    if (s.summary.withdrawalsTotal !== void 0) {
      checks.cents("withdrawals-total", "Withdrawals add up to the summary total", Math.abs(s.summary.withdrawalsTotal), -sum(withdrawals));
    }
    if (s.summary.withdrawalsCount !== void 0) {
      checks.equal("withdrawals-count", "Withdrawal count matches the summary", s.summary.withdrawalsCount, withdrawals.length);
    }
  }
  return checks.all;
}
function verifyStatementSequence(statements) {
  const checks = new CheckList();
  for (let i = 1; i < statements.length; i++) {
    const prev = statements[i - 1];
    const cur = statements[i];
    checks.cents(`continuity-${i}`, `Statement ${i} closing = statement ${i + 1} opening`, prev.closingBalance, cur.openingBalance);
    if (prev.periodEnd && cur.periodStart) {
      checks.that(`period-order-${i}`, `Statement ${i + 1} starts after statement ${i} ends`, cur.periodStart > prev.periodEnd, `${prev.periodEnd} then ${cur.periodStart}`, "warning");
    }
  }
  return checks.all;
}
function verifyCardStatement(s) {
  const checks = new CheckList();
  const total = sum(s.transactions.map((t) => assertCents(t.amount)));
  checks.cents("balance", "Previous balance + activity = new balance", s.newBalance, s.previousBalance + total);
  const sm = s.summary;
  if (sm) {
    const formula = s.previousBalance - Math.abs(sm.payments ?? 0) - Math.abs(sm.credits ?? 0) + (sm.purchases ?? 0) + (sm.cashAdvances ?? 0) + (sm.balanceTransfers ?? 0) + (sm.fees ?? 0) + (sm.interest ?? 0);
    checks.cents("summary-formula", "Previous − payments − credits + purchases + advances + transfers + fees + interest = new balance", s.newBalance, formula);
    const byCategory = (cat) => sum(s.transactions.filter((t) => t.category === cat).map((t) => t.amount));
    const categorized = s.transactions.some((t) => t.category);
    if (categorized) {
      const pairs = [
        ["payments", "payment", "Payments", -1],
        ["credits", "credit", "Credits", -1],
        ["purchases", "purchase", "Purchases", 1],
        ["cashAdvances", "cash_advance", "Cash advances", 1],
        ["balanceTransfers", "balance_transfer", "Balance transfers", 1],
        ["fees", "fee", "Fees", 1],
        ["interest", "interest", "Interest", 1]
      ];
      for (const [key, cat, label, sign] of pairs) {
        const printed = sm[key];
        if (printed === void 0) continue;
        checks.cents(`category-${cat}`, `${label} add up to the summary`, Math.abs(printed), sign * byCategory(cat));
      }
    }
  }
  return checks.all;
}
function statementRows(s) {
  const rows = [["Date", "Description", "Amount", "Balance"]];
  let running = s.openingBalance;
  for (const t of s.transactions) {
    running += t.amount;
    rows.push([t.date, t.description, centsCell(t.amount), centsCell(running)]);
  }
  return rows;
}
function centsCell(c) {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// packages/core/src/bookkeeping/bankRec.ts
var FIGURE_KEYS = ["outstandingChecksTotal", "depositsInTransitTotal", "bankCorrectionsAdded", "bankCorrectionsSubtracted", "adjustedBankBalance", "bookAdjustmentsAdded", "bookAdjustmentsSubtracted", "adjustedBookBalance", "difference"];
var LIST_REVERSAL = "Amounts on this list are entered as positive numbers. A reversal is entered as a bank correction or a book adjustment, marked Add or Subtract.";
var ADJUSTMENT_REVERSAL = "The amount is entered as a positive number, and Add or Subtract says which way it goes. A reversal is the same amount with the other choice.";
function validateAmount(amount, what, n, reversal) {
  assertCents(amount, `${what.toLowerCase()} ${n}`);
  if (amount < 0) throw new Error(`${what} ${n} has a negative amount (${formatUSD(amount)}). ${reversal}`);
}
function validateDate(date, what, n) {
  if (date !== "" && !isIsoDate(date)) throw new Error(`The date "${date}" on ${what.toLowerCase()} ${n} is not valid.`);
}
function validate(input) {
  assertCents(input.statementBalance, "statement ending balance");
  assertCents(input.bookBalance, "book balance");
  if (input.statementDate !== void 0 && input.statementDate !== "" && !isIsoDate(input.statementDate)) throw new Error(`"${input.statementDate}" is not a valid date.`);
  input.outstandingChecks.forEach((c, i) => {
    validateAmount(c.amount, "Outstanding check", i + 1, LIST_REVERSAL);
    validateDate(c.date, "Outstanding check", i + 1);
  });
  input.depositsInTransit.forEach((d, i) => {
    validateAmount(d.amount, "Deposit in transit", i + 1, LIST_REVERSAL);
    validateDate(d.date, "Deposit in transit", i + 1);
  });
  for (const [list, what] of [[input.bankCorrections, "Bank correction"], [input.bookAdjustments, "Book adjustment"]]) {
    list.forEach((a, i) => {
      if (a.direction !== "add" && a.direction !== "subtract") throw new Error(`${what} ${i + 1} needs Add or Subtract.`);
      validateAmount(a.amount, what, i + 1, ADJUSTMENT_REVERSAL);
    });
  }
}
var directed = (list, direction) => list.filter((a) => a.direction === direction).map((a) => a.amount);
function readd(values) {
  let total = 0n;
  for (let i = values.length - 1; i >= 0; i--) total += BigInt(values[i]);
  return total;
}
var SAFE = BigInt(Number.MAX_SAFE_INTEGER);
function shown(value, label) {
  if (value > SAFE || value < -SAFE) throw new Error(`The ${label} is too large to work out exactly.`);
  return Number(value);
}
function secondPass(input) {
  let adjustedBank = BigInt(input.statementBalance);
  for (const d of input.depositsInTransit) adjustedBank += BigInt(d.amount);
  for (const c of input.outstandingChecks) adjustedBank -= BigInt(c.amount);
  for (const a of input.bankCorrections) adjustedBank += a.direction === "add" ? BigInt(a.amount) : -BigInt(a.amount);
  let adjustedBook = BigInt(input.bookBalance);
  for (const a of input.bookAdjustments) adjustedBook += a.direction === "add" ? BigInt(a.amount) : -BigInt(a.amount);
  return {
    checks: readd(input.outstandingChecks.map((c) => c.amount)),
    deposits: readd(input.depositsInTransit.map((d) => d.amount)),
    bankAdded: readd(directed(input.bankCorrections, "add")),
    bankSubtracted: readd(directed(input.bankCorrections, "subtract")),
    bookAdded: readd(directed(input.bookAdjustments, "add")),
    bookSubtracted: readd(directed(input.bookAdjustments, "subtract")),
    adjustedBank,
    adjustedBook
  };
}
var checkNumberKey = (number) => number.trim().replace(/\s+/g, " ").toLowerCase();
function bkVerifyBankRec(input, r) {
  validate(input);
  for (const key of FIGURE_KEYS) assertCents(r[key], key);
  const checks = new CheckList();
  const p = secondPass(input);
  const usd = (value, label) => formatUSD(shown(value, label));
  checks.cents("balances-agree", "Adjusted bank balance = adjusted book balance", r.adjustedBookBalance, r.adjustedBankBalance);
  checks.cents(
    "adjusted-bank",
    "Adjusted bank balance = statement ending balance + deposits in transit − outstanding checks + bank corrections added − bank corrections subtracted",
    shown(p.adjustedBank, "adjusted bank balance"),
    r.adjustedBankBalance
  );
  checks.cents("adjusted-book", "Adjusted book balance = book balance + book adjustments added − book adjustments subtracted", shown(p.adjustedBook, "adjusted book balance"), r.adjustedBookBalance);
  checks.that(
    "difference",
    "The difference shown = adjusted bank balance − adjusted book balance, by a second calculation",
    BigInt(r.difference) === p.adjustedBank - p.adjustedBook && r.reconciled === (p.adjustedBank === p.adjustedBook),
    `second pass: adjusted bank ${usd(p.adjustedBank, "adjusted bank balance")}, adjusted book ${usd(p.adjustedBook, "adjusted book balance")}, difference ${usd(p.adjustedBank - p.adjustedBook, "difference")}`
  );
  checks.cents("checks-total", "Outstanding checks re-add to the total shown", shown(p.checks, "outstanding checks total"), r.outstandingChecksTotal);
  checks.cents("deposits-total", "Deposits in transit re-add to the total shown", shown(p.deposits, "deposits in transit total"), r.depositsInTransitTotal);
  checks.that(
    "bank-corrections-total",
    "Bank corrections re-add to the two totals shown (added and subtracted)",
    BigInt(r.bankCorrectionsAdded) === p.bankAdded && BigInt(r.bankCorrectionsSubtracted) === p.bankSubtracted,
    `second pass: added ${usd(p.bankAdded, "bank corrections total")}, subtracted ${usd(p.bankSubtracted, "bank corrections total")}`
  );
  checks.that(
    "book-adjustments-total",
    "Book adjustments re-add to the two totals shown (added and subtracted)",
    BigInt(r.bookAdjustmentsAdded) === p.bookAdded && BigInt(r.bookAdjustmentsSubtracted) === p.bookSubtracted,
    `second pass: added ${usd(p.bookAdded, "book adjustments total")}, subtracted ${usd(p.bookSubtracted, "book adjustments total")}`
  );
  const seen = /* @__PURE__ */ new Map();
  for (const c of input.outstandingChecks) {
    const key = checkNumberKey(c.number);
    if (key === "") continue;
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { number: c.number.trim(), count: 1 });
  }
  const repeated = [...seen.values()].filter((e) => e.count > 1);
  checks.that(
    "check-numbers",
    "No check number is listed twice",
    repeated.length === 0,
    repeated.length ? `check number ${repeated[0].number} is listed ${repeated[0].count} times${repeated.length > 1 ? `; ${repeated.length} check numbers are repeated in all` : ""}` : void 0,
    "warning"
  );
  const zero = [];
  input.outstandingChecks.forEach((c, i) => void (c.amount === 0 && zero.push(`outstanding check ${i + 1}`)));
  input.depositsInTransit.forEach((d, i) => void (d.amount === 0 && zero.push(`deposit in transit ${i + 1}`)));
  input.bankCorrections.forEach((a, i) => void (a.amount === 0 && zero.push(`bank correction ${i + 1}`)));
  input.bookAdjustments.forEach((a, i) => void (a.amount === 0 && zero.push(`book adjustment ${i + 1}`)));
  checks.that("zero-amounts", "No list row has an amount of zero", zero.length === 0, zero.length ? `${zero.length} row(s) with an amount of zero; first: ${zero[0]}` : void 0, "warning");
  return checks.all;
}
function bkBankRec(input) {
  validate(input);
  const outstandingChecksTotal = sum(input.outstandingChecks.map((c) => c.amount));
  const depositsInTransitTotal = sum(input.depositsInTransit.map((d) => d.amount));
  const bankCorrectionsAdded = sum(directed(input.bankCorrections, "add"));
  const bankCorrectionsSubtracted = sum(directed(input.bankCorrections, "subtract"));
  const bookAdjustmentsAdded = sum(directed(input.bookAdjustments, "add"));
  const bookAdjustmentsSubtracted = sum(directed(input.bookAdjustments, "subtract"));
  const adjustedBankBalance = sum([input.statementBalance, depositsInTransitTotal, 0 - outstandingChecksTotal, bankCorrectionsAdded, 0 - bankCorrectionsSubtracted]);
  const adjustedBookBalance = sum([input.bookBalance, bookAdjustmentsAdded, 0 - bookAdjustmentsSubtracted]);
  const figures = {
    outstandingChecksTotal,
    depositsInTransitTotal,
    bankCorrectionsAdded,
    bankCorrectionsSubtracted,
    adjustedBankBalance,
    bookAdjustmentsAdded,
    bookAdjustmentsSubtracted,
    adjustedBookBalance,
    difference: sum([adjustedBankBalance, 0 - adjustedBookBalance]),
    reconciled: adjustedBankBalance === adjustedBookBalance
  };
  return { ...figures, checks: bkVerifyBankRec(input, figures) };
}
var BK_BANK_REC_LINE_KEYS = ["statementBalance", "depositsTotal", "checksTotal", "bankAdded", "bankSubtracted", "adjustedBank", "bookBalance", "bookAdded", "bookSubtracted", "adjustedBook", "difference"];
var BK_BANK_REC_LINE_LABELS = {
  statementBalance: "Statement ending balance",
  depositsTotal: "Plus deposits in transit",
  checksTotal: "Less outstanding checks",
  bankAdded: "Plus bank corrections added",
  bankSubtracted: "Less bank corrections subtracted",
  adjustedBank: "Adjusted bank balance",
  bookBalance: "Book balance",
  bookAdded: "Plus book adjustments added",
  bookSubtracted: "Less book adjustments subtracted",
  adjustedBook: "Adjusted book balance",
  difference: "Difference: adjusted bank − adjusted book"
};
function bkBankRecLines(input, r) {
  const amounts = {
    statementBalance: input.statementBalance,
    depositsTotal: r.depositsInTransitTotal,
    checksTotal: 0 - r.outstandingChecksTotal,
    bankAdded: r.bankCorrectionsAdded,
    bankSubtracted: 0 - r.bankCorrectionsSubtracted,
    adjustedBank: r.adjustedBankBalance,
    bookBalance: input.bookBalance,
    bookAdded: r.bookAdjustmentsAdded,
    bookSubtracted: 0 - r.bookAdjustmentsSubtracted,
    adjustedBook: r.adjustedBookBalance,
    difference: r.difference
  };
  return BK_BANK_REC_LINE_KEYS.map((key, i) => ({
    key,
    label: BK_BANK_REC_LINE_LABELS[key],
    amount: amounts[key],
    side: key === "difference" ? "difference" : i < BK_BANK_REC_LINE_KEYS.indexOf("bookBalance") ? "bank" : "book",
    total: key === "adjustedBank" || key === "adjustedBook"
  }));
}
function bkBankRecTables(input, r, account = "") {
  const direction = (a) => a.direction === "add" ? "Add" : "Subtract";
  return {
    reconciliation: [
      ["Item", "Value"],
      ["Account or business name", account.trim().replace(/\s+/g, " ")],
      ["Statement date", input.statementDate ?? ""],
      ...bkBankRecLines(input, r).map((l) => [l.label, toDecimal(l.amount)])
    ],
    outstandingChecks: [["Check number", "Date", "Payee", "Amount"], ...input.outstandingChecks.map((c) => [c.number, c.date, c.payee, toDecimal(c.amount)]), ["", "", "Total", toDecimal(r.outstandingChecksTotal)]],
    depositsInTransit: [["Date", "Description", "Amount"], ...input.depositsInTransit.map((d) => [d.date, d.description, toDecimal(d.amount)]), ["", "Total", toDecimal(r.depositsInTransitTotal)]],
    adjustments: [
      ["Side", "Add or subtract", "Description", "Amount"],
      ...input.bankCorrections.map((a) => ["Bank", direction(a), a.description, toDecimal(a.amount)]),
      ...input.bookAdjustments.map((a) => ["Book", direction(a), a.description, toDecimal(a.amount)])
    ]
  };
}

// packages/core/src/property/sheetCells.ts
function pmCellToCents(raw, options = {}) {
  const s = raw.trim().replace(/−/g, "-").replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  try {
    return parseAmount(s, { crIsNegative: options.crIsNegative ?? true });
  } catch {
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    const { cents, clean } = decimalToCents(s);
    if (clean) return cents;
  }
  throw new AmountError(`not a valid amount: "${raw}"`);
}
var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var DAY_MS = 864e5;
function iso(year, month, day, raw) {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isIsoDate(value)) throw new Error(`not a real date: "${raw}"`);
  return value;
}
function pmCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]), raw);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    const year = m[3].length === 2 ? yy < 30 ? 2e3 + yy : 1900 + yy : yy;
    return order === "dmy" ? iso(year, Number(m[2]), Number(m[1]), raw) : iso(year, Number(m[1]), Number(m[2]), raw);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[2]), raw);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[1]), raw);
  }
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const serial = Number(m[1]);
    if (serial >= 2e4 && serial <= 8e4) return new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS).toISOString().slice(0, 10);
  }
  throw new Error(`not a recognizable date: "${raw}"`);
}
function pmNormalizeHeader(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export {
  isIsoDate,
  verifyBankStatement,
  verifyStatementSequence,
  verifyCardStatement,
  statementRows,
  bkBankRec,
  BK_BANK_REC_LINE_KEYS,
  BK_BANK_REC_LINE_LABELS,
  bkBankRecLines,
  bkBankRecTables,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader
};
