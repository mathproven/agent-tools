// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
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
  sum
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
function pmDaysBetween(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error(`not a valid date: "${isIsoDate(from) ? to : from}"`);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
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
  pmCellToCents,
  pmCellToIsoDate,
  pmDaysBetween,
  pmNormalizeHeader
};
