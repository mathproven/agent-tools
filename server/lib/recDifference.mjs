// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  BK_ROLE_LABELS,
  bkGuessStatementColumns
} from "./cells.mjs";
import {
  sheetDataRows
} from "./sheetInput.mjs";
import {
  isIsoDate,
  verifyStatementSequence
} from "./reconcile.mjs";
import {
  CheckList,
  assertCents,
  formatUSD,
  sum,
  toDecimal
} from "./money.mjs";

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

// packages/core/src/bookkeeping/merge.ts
function bkDateSpan(s) {
  const dates = s.transactions.map((t) => t.date).filter(isIsoDate).sort();
  return { first: dates[0] ?? "", last: dates[dates.length - 1] ?? "" };
}
function bkDuplicateKey(t) {
  return `${t.date}|${t.amount}|${t.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
}
function bkMergeStatements(parts) {
  if (parts.length < 2) {
    throw new Error("Open at least two statements to merge.");
  }
  const summaries = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const statement = part.statement;
    const name = part.name;
    let start = statement.periodStart;
    if (!start) {
      const span = bkDateSpan(statement);
      start = span.first;
    }
    if (!start) {
      throw new Error(`"${name}" has no period start date and no dated transactions, so it cannot be placed in order.`);
    }
    let end = statement.periodEnd;
    if (!end) {
      const span = bkDateSpan(statement);
      end = span.last;
    }
    if (!end) {
      end = start;
    }
    summaries.push({
      name,
      start,
      end,
      openingBalance: statement.openingBalance,
      closingBalance: statement.closingBalance,
      count: statement.transactions.length,
      sum: sum(statement.transactions.map((t) => t.amount))
    });
  }
  const order = summaries.map((summary, index) => ({ summary, index })).sort((a, b) => a.summary.start < b.summary.start ? -1 : a.summary.start > b.summary.start ? 1 : a.index - b.index);
  const sorted = order.map((o) => o.summary);
  const statementAt = (i) => parts[order[i].index].statement;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const merged = {
    openingBalance: first.openingBalance,
    closingBalance: last.closingBalance,
    periodStart: first.start,
    periodEnd: last.end,
    transactions: []
  };
  const sourceOf = [];
  for (let i = 0; i < sorted.length; i++) {
    const statement = statementAt(i);
    for (let j = 0; j < statement.transactions.length; j++) {
      const tx = statement.transactions[j];
      merged.transactions.push({
        date: tx.date,
        description: tx.description,
        amount: tx.amount
      });
      sourceOf.push(i);
    }
  }
  const duplicateGroups = /* @__PURE__ */ new Map();
  for (let i = 0; i < sorted.length; i++) {
    const part = sorted[i];
    const statement = statementAt(i);
    for (let j = 0; j < statement.transactions.length; j++) {
      const tx = statement.transactions[j];
      const key = bkDuplicateKey(tx);
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key).push({ part: part.name, partIndex: i, position: j + 1, transaction: { date: tx.date, description: tx.description, amount: tx.amount } });
    }
  }
  const duplicates = [];
  for (const group of duplicateGroups.values()) {
    const fromParts = new Set(group.map((g) => g.partIndex));
    if (fromParts.size > 1) {
      const first2 = group[0];
      duplicates.push({
        date: first2.transaction.date,
        description: first2.transaction.description,
        amount: first2.transaction.amount,
        occurrences: group.map((g) => ({ part: g.part, position: g.position }))
      });
    }
  }
  const table = [["Date", "Description", "Amount", "Balance", "Statement"]];
  let balance = merged.openingBalance;
  for (let i = 0; i < merged.transactions.length; i++) {
    const tx = merged.transactions[i];
    balance += tx.amount;
    table.push([
      tx.date,
      tx.description,
      toDecimal(tx.amount),
      toDecimal(balance),
      sorted[sourceOf[i]].name
    ]);
  }
  const checks = new CheckList();
  const unbalanced = [];
  for (let i = 0; i < sorted.length; i++) {
    const part = sorted[i];
    const statement = statementAt(i);
    const total = statement.openingBalance + sum(statement.transactions.map((t) => t.amount));
    if (total !== statement.closingBalance) {
      unbalanced.push({ name: part.name, opening: statement.openingBalance, sum: sum(statement.transactions.map((t) => t.amount)), closing: statement.closingBalance });
    }
  }
  checks.that(
    "parts-balance",
    "Every statement balances on its own: opening + transactions = closing",
    unbalanced.length === 0,
    unbalanced.length === 0 ? void 0 : `${unbalanced.length} statement(s) do not balance; first: ${unbalanced[0].name} is off by ${formatUSD(unbalanced[0].opening + unbalanced[0].sum - unbalanced[0].closing)}`
  );
  const sequenceChecks = verifyStatementSequence(
    sorted.map((part, i) => {
      const statement = statementAt(i);
      return { ...statement, periodStart: part.start, periodEnd: part.end };
    })
  );
  checks.addAll(sequenceChecks);
  const mergedSum = sum(merged.transactions.map((t) => t.amount));
  checks.cents(
    "merged-balance",
    "First opening balance + every transaction = last closing balance",
    merged.closingBalance,
    merged.openingBalance + mergedSum
  );
  const totalPartsCount = sorted.reduce((sum2, part) => sum2 + part.count, 0);
  checks.equal(
    "merged-count",
    "Merged transaction count = the statements’ counts added up",
    totalPartsCount,
    merged.transactions.length
  );
  const totalPartsSum = sorted.reduce((sum2, part) => sum2 + part.sum, 0);
  checks.cents(
    "merged-sum",
    "Merged total = the statements’ totals added up (second pass)",
    totalPartsSum,
    mergedSum
  );
  checks.that(
    "duplicates",
    "No transaction appears in more than one statement",
    duplicates.length === 0,
    duplicates.length === 0 ? void 0 : `${duplicates.length} transaction(s) appear in more than one statement; they are listed and were kept`,
    "warning"
  );
  return {
    parts: sorted,
    merged,
    duplicates,
    table,
    checks: checks.all
  };
}

// packages/core/src/bookkeeping/duplicates.ts
var BK_DUP_MAX_DAYS = 366;
var BK_DUP_LIST_NAMES = { exact: "Exact repeat", near: "Near repeat", none: "No repeat found" };
var MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function bkDayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const year = m ? Number(m[1]) : 0;
  const month = m ? Number(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 && leap ? 29 : MONTH_LENGTHS[month - 1] ?? 0;
  if (year < 1 || day < 1 || day > length) throw new Error(`"${iso}" is not a real calendar date written as YYYY-MM-DD.`);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function safeCents(n, label) {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} is too large.`);
  return Number(n);
}
function bkFindDuplicates(input) {
  const days = input.nearDays;
  if (!Number.isSafeInteger(days) || days < 0 || days > BK_DUP_MAX_DAYS) {
    throw new Error(`Type the number of days as a whole number from 0 to ${BK_DUP_MAX_DAYS}, or leave it blank.`);
  }
  if (input.rows.length === 0) throw new Error("No transactions were read. Check the header row and the column mapping.");
  const numbers = /* @__PURE__ */ new Set();
  const items = input.rows.map((row, index) => {
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1) throw new Error("Every row needs its file row number, a whole number from 1 up.");
    if (numbers.has(row.rowNumber)) throw new Error(`Row number ${row.rowNumber} is used by more than one row.`);
    numbers.add(row.rowNumber);
    if (!Number.isSafeInteger(row.amount)) throw new Error(`The amount on row ${row.rowNumber} must be a whole number of cents.`);
    let day;
    try {
      day = bkDayNumber(row.date);
    } catch {
      throw new Error(`The date on row ${row.rowNumber} ("${row.date}") is not a real calendar date written as YYYY-MM-DD.`);
    }
    return { row, index, day, alike: bkDuplicateKey({ date: "", description: row.description, amount: row.amount }) };
  });
  const alike = /* @__PURE__ */ new Map();
  for (const item of items) {
    const list = alike.get(item.alike);
    if (list) list.push(item);
    else alike.set(item.alike, [item]);
  }
  const runs = [];
  const keep = (run) => {
    if (run.length > 1) runs.push({ run, first: run.reduce((least, item) => item.index < least ? item.index : least, items.length) });
  };
  for (const list of alike.values()) {
    list.sort((a, b) => a.day - b.day || a.row.rowNumber - b.row.rowNumber);
    let run = [];
    for (const item of list) {
      const before = run[run.length - 1];
      if (before !== void 0 && item.day - before.day > days) {
        keep(run);
        run = [];
      }
      run.push(item);
    }
    keep(run);
  }
  runs.sort((a, b) => a.first - b.first);
  const exactGroups = [];
  const nearGroups = [];
  const groupAt = /* @__PURE__ */ new Map();
  for (const { run } of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    const kind = first.day === last.day ? "exact" : "near";
    const list = kind === "exact" ? exactGroups : nearGroups;
    let later2 = 0n;
    for (const item of run.slice(1)) later2 += BigInt(item.row.amount);
    const label = `${kind === "exact" ? "Exact" : "Near"} ${list.length + 1}`;
    const group = {
      kind,
      label,
      amount: first.row.amount,
      description: first.row.description,
      firstDate: first.row.date,
      lastDate: last.row.date,
      rowNumbers: run.map((item) => item.row.rowNumber),
      laterRows: run.length - 1,
      laterAmount: safeCents(later2, `total of the second and later rows of ${label}`)
    };
    list.push(group);
    for (const item of run) groupAt.set(item.index, group);
  }
  const tally = { exact: { rows: 0, amount: 0n }, near: { rows: 0, amount: 0n }, none: { rows: 0, amount: 0n } };
  const rows = items.map((item) => {
    const group = groupAt.get(item.index);
    const list = group ? group.kind : "none";
    tally[list].rows += 1;
    tally[list].amount += BigInt(item.row.amount);
    return { rowNumber: item.row.rowNumber, date: item.row.date, description: item.row.description, amount: item.row.amount, list, group: group ? group.label : "" };
  });
  const count = (list, label) => ({ rows: tally[list].rows, amount: safeCents(tally[list].amount, label) });
  const later = (groups2, label) => ({
    rows: groups2.reduce((n, g) => n + g.laterRows, 0),
    amount: safeCents(groups2.reduce((n, g) => n + BigInt(g.laterAmount), 0n), label)
  });
  const totals = {
    file: { rows: rows.length, amount: safeCents(tally.exact.amount + tally.near.amount + tally.none.amount, "file total") },
    exact: count("exact", "total of the exact repeats"),
    near: count("near", "total of the near repeats"),
    none: count("none", "total of the rows with no repeat found"),
    exactLater: later(exactGroups, "total of the second and later rows of the exact groups"),
    nearLater: later(nearGroups, "total of the second and later rows of the near groups")
  };
  const checks = new CheckList();
  const groups = [...exactGroups, ...nearGroups];
  const inGroups = /* @__PURE__ */ new Set();
  let placements = 0;
  for (const g of groups) {
    for (const n of g.rowNumbers) {
      inGroups.add(n);
      placements += 1;
    }
  }
  const loose = input.rows.filter((row) => !inGroups.has(row.rowNumber));
  const once = placements === inGroups.size;
  checks.that(
    "bk-dup-rows-once",
    "Every row read from the file is placed once: exact repeats + near repeats + no repeat found = rows read",
    once && placements + loose.length === input.rows.length,
    `${input.rows.length} row(s) read, ${placements + loose.length} placed${once ? "" : ", some in more than one group"}`
  );
  let straight = 0n;
  for (const row of input.rows) straight += BigInt(row.amount);
  let again = 0n;
  for (const g of groups) again += BigInt(g.amount) * BigInt(g.rowNumbers.length);
  for (const row of loose) again += BigInt(row.amount);
  checks.cents("bk-dup-readd", "The three lists add back up to the file total (second pass)", safeCents(straight, "file total"), safeCents(again, "file total"));
  return { nearDays: days, exactGroups, nearGroups, rows, totals, checks: checks.all };
}
function bkDuplicateGroupsTable(r) {
  return [
    ["Group", "Rows", "File rows", "First date", "Last date", "Description", "Amount of each row", "Second and later rows", "Amount in second and later rows"],
    ...[...r.exactGroups, ...r.nearGroups].map((g) => [g.label, g.rowNumbers.length, g.rowNumbers.join(", "), g.firstDate, g.lastDate, g.description, toDecimal(g.amount), g.laterRows, toDecimal(g.laterAmount)])
  ];
}
function bkDuplicateRowsTable(r) {
  const place = /* @__PURE__ */ new Map();
  for (const g of [...r.exactGroups, ...r.nearGroups]) {
    g.rowNumbers.forEach((n, i) => place.set(n, `${i + 1} of ${g.rowNumbers.length}`));
  }
  return [
    ["File row", "Date", "Description", "Amount", "List", "Group", "Place in group"],
    ...r.rows.map((row) => [row.rowNumber, row.date, row.description, toDecimal(row.amount), BK_DUP_LIST_NAMES[row.list], row.group, row.list === "none" ? "" : place.get(row.rowNumber) ?? ""])
  ];
}
function bkDuplicateTotalsTable(r) {
  const t = r.totals;
  const line = (name, c) => [name, c.rows, toDecimal(c.amount)];
  return [
    ["List", "Rows", "Amount"],
    line("Exact repeats", t.exact),
    line("Near repeats", t.near),
    line("No repeat found", t.none),
    line("Whole file", t.file),
    line("Second and later rows of exact groups", t.exactLater),
    line("Second and later rows of near groups", t.nearLater)
  ];
}
function bkLeftOutRows(rows, headerRow, extract) {
  const accounted = /* @__PURE__ */ new Set();
  for (const t of extract.transactions) accounted.add(t.rowNumber);
  for (const p of extract.problems) accounted.add(p.rowNumber);
  const balance = new Set((extract.balanceLines ?? []).map((b) => b.rowNumber));
  return sheetDataRows(rows, headerRow).filter((row) => !accounted.has(row.rowNumber)).map((row) => ({ rowNumber: row.rowNumber, reason: balance.has(row.rowNumber) ? "a balance line (the file's own beginning or ending balance), not a transaction" : "no date and no amount" }));
}

// packages/core/src/bookkeeping/recDifference.ts
var BK_REC_DIFF_OLD_DAYS = 90;
var BK_REC_DIFF_MAX_ROWS = 2e4;
var BK_REC_DIFF_PLACES = ["statementBalance", "bookBalance", "outstandingCheck", "depositInTransit", "bankCorrection", "bookAdjustment", "bookRow", "statementRow"];
var BK_REC_DIFF_KINDS = ["transposition", "whole", "doubled", "reversed"];
var BK_REC_DIFF_KIND_NAMES = {
  transposition: "Two digits swapped",
  whole: "Entry equal to the difference",
  doubled: "Doubled entry",
  reversed: "Half the difference, sign reversed"
};
function validate2(input) {
  bkBankRec(input);
  const lists = [input.outstandingChecks, input.depositsInTransit, input.bankCorrections, input.bookAdjustments];
  if (lists.some((l) => l.length > BK_REC_DIFF_MAX_ROWS)) throw new Error(`A list holds more than ${BK_REC_DIFF_MAX_ROWS} rows; this page takes up to ${BK_REC_DIFF_MAX_ROWS} on each.`);
  for (const [rows, what] of [
    [input.bookRows, "book"],
    [input.statementRows, "statement"]
  ]) {
    if (rows === void 0) continue;
    if (rows.length > BK_REC_DIFF_MAX_ROWS) throw new Error(`The ${what} rows hold ${rows.length} rows; this page takes up to ${BK_REC_DIFF_MAX_ROWS}.`);
    const seen = /* @__PURE__ */ new Set();
    for (const r of rows) {
      if (!Number.isSafeInteger(r.rowNumber) || r.rowNumber < 1) throw new Error(`Every ${what} row needs its file row number, a whole number from 1 up.`);
      if (seen.has(r.rowNumber)) throw new Error(`Row number ${r.rowNumber} is used by more than one ${what} row.`);
      seen.add(r.rowNumber);
      assertCents(r.amount, `the amount on ${what} row ${r.rowNumber}`);
      if (r.date !== "" && !isIsoDate(r.date)) throw new Error(`The date on ${what} row ${r.rowNumber} ("${r.date}") is not a valid date.`);
    }
  }
}
function entriesOf(input) {
  const out = [
    { place: "statementBalance", index: 0, value: input.statementBalance, mult: 1 },
    { place: "bookBalance", index: 0, value: input.bookBalance, mult: -1 }
  ];
  input.outstandingChecks.forEach((c, index) => out.push({ place: "outstandingCheck", index, value: c.amount, mult: -1 }));
  input.depositsInTransit.forEach((d, index) => out.push({ place: "depositInTransit", index, value: d.amount, mult: 1 }));
  input.bankCorrections.forEach((a, index) => out.push({ place: "bankCorrection", index, value: a.amount, mult: a.direction === "add" ? 1 : -1 }));
  input.bookAdjustments.forEach((a, index) => out.push({ place: "bookAdjustment", index, value: a.amount, mult: a.direction === "add" ? -1 : 1 }));
  (input.bookRows ?? []).forEach((r, index) => out.push({ place: "bookRow", index, value: r.amount, mult: -1 }));
  (input.statementRows ?? []).forEach((r, index) => out.push({ place: "statementRow", index, value: r.amount, mult: 1 }));
  return out;
}
var isFileRow = (place) => place === "bookRow" || place === "statementRow";
var isBalance = (place) => place === "statementBalance" || place === "bookBalance";
function swapsByText(value) {
  const text = String(Math.abs(value)).padStart(3, "0");
  const out = [];
  for (let i = 0; i + 1 < text.length; i++) {
    const a = text[i];
    const b = text[i + 1];
    if (a === b) continue;
    const swapped = `${text.slice(0, i)}${b}${a}${text.slice(i + 2)}`;
    if (swapped.length > 3 && swapped.startsWith("0")) continue;
    const n = Number(swapped);
    if (!Number.isSafeInteger(n)) continue;
    out.push({ corrected: value < 0 ? -n : n, digits: `${a}${b}` });
  }
  return out;
}
var SAFE2 = BigInt(Number.MAX_SAFE_INTEGER);
var isInt = (n) => typeof n === "number" && Number.isSafeInteger(n);
function cents(value, label) {
  if (value > SAFE2 || value < -SAFE2) throw new Error(`The ${label} is too large to work out exactly.`);
  return Number(value);
}
function countBy(items, key) {
  const m = /* @__PURE__ */ new Map();
  for (const item of items) {
    const k = key(item);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
function search(input, difference) {
  if (difference === 0) return [];
  const D = BigInt(difference);
  const bookRows = input.bookRows ?? [];
  const statementRows = input.statementRows ?? [];
  const book = countBy(bookRows, (r) => r.amount);
  const stmt = countBy(statementRows, (r) => r.amount);
  const listed = countBy([...input.outstandingChecks.map((c) => -c.amount), ...input.depositsInTransit.map((d) => d.amount)], (v) => v === 0 ? null : v);
  const adjusted = countBy(input.bookAdjustments, (a) => a.amount === 0 ? null : a.direction === "add" ? a.amount : -a.amount);
  const bookExcess = (v) => (book.get(v) ?? 0) - (stmt.get(v) ?? 0) - (listed.get(v) ?? 0);
  const stmtExcess = (v) => (stmt.get(v) ?? 0) - (book.get(v) ?? 0) - (adjusted.get(v) ?? 0);
  const eligible = (e) => e.place === "bookRow" ? bookExcess(e.value) > 0 : e.place === "statementRow" ? stmtExcess(e.value) > 0 : true;
  const partnerFor = (target) => {
    if (stmtExcess(target) <= 0) return null;
    const index = statementRows.findIndex((r) => r.amount === target);
    return index >= 0 ? { place: "statementRow", index } : null;
  };
  const coveredByBookRow = (target) => (book.get(target) ?? 0) > 0 && bookExcess(target) > 0;
  const out = [];
  const groups = /* @__PURE__ */ new Map();
  for (const e of entriesOf(input)) {
    if (e.value === 0 || !eligible(e)) continue;
    const effect = e.mult * e.value;
    const E = BigInt(effect);
    for (const swap of swapsByText(e.value)) {
      if (D - E + BigInt(e.mult * swap.corrected) !== 0n) continue;
      if (e.place === "statementRow" && coveredByBookRow(swap.corrected)) continue;
      out.push({ kind: "transposition", place: e.place, rows: [e.index], amount: e.value, corrected: swap.corrected, digits: swap.digits, partner: e.place === "bookRow" ? partnerFor(swap.corrected) : null, effect, differenceAfter: 0 });
    }
    if (!isBalance(e.place) && D - 2n * E === 0n && !(e.place === "statementRow" && coveredByBookRow(-e.value))) {
      out.push({ kind: "reversed", place: e.place, rows: [e.index], amount: e.value, corrected: isFileRow(e.place) ? -e.value : null, digits: null, partner: e.place === "bookRow" ? partnerFor(-e.value) : null, effect, differenceAfter: 0 });
    }
    if (!isBalance(e.place) && D - E === 0n) {
      const key = `${e.place}|${e.mult}|${e.value}`;
      const group = groups.get(key);
      if (group) group.rows.push(e.index);
      else groups.set(key, { entry: e, rows: [e.index] });
    }
  }
  for (const { entry, rows } of groups.values()) {
    out.push({ kind: rows.length > 1 ? "doubled" : "whole", place: entry.place, rows, amount: entry.value, corrected: null, digits: null, partner: null, effect: entry.mult * entry.value, differenceAfter: 0 });
  }
  return out.sort(compareCandidates);
}
function compareCandidates(a, b) {
  return BK_REC_DIFF_KINDS.indexOf(a.kind) - BK_REC_DIFF_KINDS.indexOf(b.kind) || BK_REC_DIFF_PLACES.indexOf(a.place) - BK_REC_DIFF_PLACES.indexOf(b.place) || (a.rows[0] ?? 0) - (b.rows[0] ?? 0) || (a.corrected ?? 0) - (b.corrected ?? 0);
}
function oldItems(input) {
  const date = input.statementDate ?? "";
  if (date === "") return [];
  const end = bkDayNumber(date);
  const out = [];
  const look = (place, items) => items.forEach((item, index) => {
    if (item.date === "") return;
    const days = end - bkDayNumber(item.date);
    if (days > BK_REC_DIFF_OLD_DAYS) out.push({ place, index, date: item.date, amount: item.amount, days });
  });
  look("outstandingCheck", input.outstandingChecks);
  look("depositInTransit", input.depositsInTransit);
  return out;
}
function bkFindRecDifference(input) {
  validate2(input);
  const rec = bkBankRec(input);
  const D = BigInt(rec.difference);
  const report = {
    adjustedBankBalance: rec.adjustedBankBalance,
    adjustedBookBalance: rec.adjustedBookBalance,
    difference: rec.difference,
    ninth: D % 9n === 0n ? cents(D / 9n, "difference") : null,
    half: D % 2n === 0n ? cents(D / 2n, "difference") : null,
    candidates: search(input, rec.difference),
    old: oldItems(input),
    bookRowsGiven: input.bookRows !== void 0,
    statementRowsGiven: input.statementRows !== void 0
  };
  const warnings = rec.checks.filter((c) => c.severity === "warning");
  return { ...report, checks: [...bkVerifyRecDifference(input, report), ...warnings] };
}
function recOf(input) {
  return {
    statementBalance: BigInt(input.statementBalance),
    bookBalance: BigInt(input.bookBalance),
    checks: input.outstandingChecks.map((c) => BigInt(c.amount)),
    deposits: input.depositsInTransit.map((d) => BigInt(d.amount)),
    bank: input.bankCorrections.map((a) => ({ add: a.direction === "add", amount: BigInt(a.amount) })),
    book: input.bookAdjustments.map((a) => ({ add: a.direction === "add", amount: BigInt(a.amount) }))
  };
}
function walk(r) {
  let bank = r.statementBalance;
  for (let i = r.checks.length - 1; i >= 0; i--) bank -= r.checks[i];
  for (let i = r.deposits.length - 1; i >= 0; i--) bank += r.deposits[i];
  for (let i = r.bank.length - 1; i >= 0; i--) bank += r.bank[i].add ? r.bank[i].amount : -r.bank[i].amount;
  let book = r.bookBalance;
  for (let i = r.book.length - 1; i >= 0; i--) book += r.book[i].add ? r.book[i].amount : -r.book[i].amount;
  return { bank, book };
}
function swapsByPlace(value) {
  const negative = value < 0n;
  const size = negative ? -value : value;
  const d = [];
  for (let rest = size; rest > 0n; rest /= 10n) d.push(Number(rest % 10n));
  while (d.length < 3) d.push(0);
  const out = [];
  for (let k = d.length - 2; k >= 0; k--) {
    const low = d[k];
    const high = d[k + 1];
    if (low === high) continue;
    if (k + 1 === d.length - 1 && low === 0 && d.length > 3) continue;
    const c = size + 9n * 10n ** BigInt(k) * BigInt(low - high);
    if (c > SAFE2) continue;
    out.push({ corrected: negative ? -c : c, digits: `${high}${low}` });
  }
  return out;
}
function countSorted(sorted, v) {
  const bound = (strict) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (strict ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return bound(true) - bound(false);
}
var ascending = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function sides(input) {
  const signed = (rows) => (rows ?? []).map((r) => BigInt(r.amount));
  const bookValues = signed(input.bookRows).sort(ascending);
  const stmtValues = signed(input.statementRows).sort(ascending);
  const listedValues = [...input.outstandingChecks.map((c) => -BigInt(c.amount)), ...input.depositsInTransit.map((d) => BigInt(d.amount))].filter((v) => v !== 0n).sort(ascending);
  const adjustedValues = input.bookAdjustments.map((a) => a.direction === "add" ? BigInt(a.amount) : -BigInt(a.amount)).filter((v) => v !== 0n).sort(ascending);
  const byPlace = {
    statementBalance: [{ value: BigInt(input.statementBalance), mult: 1n }],
    bookBalance: [{ value: BigInt(input.bookBalance), mult: -1n }],
    outstandingCheck: input.outstandingChecks.map((c) => ({ value: BigInt(c.amount), mult: -1n })),
    depositInTransit: input.depositsInTransit.map((d) => ({ value: BigInt(d.amount), mult: 1n })),
    bankCorrection: input.bankCorrections.map((a) => ({ value: BigInt(a.amount), mult: a.direction === "add" ? 1n : -1n })),
    bookAdjustment: input.bookAdjustments.map((a) => ({ value: BigInt(a.amount), mult: a.direction === "add" ? -1n : 1n })),
    bookRow: signed(input.bookRows).map((value) => ({ value, mult: -1n })),
    statementRow: signed(input.statementRows).map((value) => ({ value, mult: 1n }))
  };
  return {
    rows: (place) => byPlace[place],
    unmatched: (place, v) => place === "bookRow" ? countSorted(bookValues, v) > countSorted(stmtValues, v) + countSorted(listedValues, v) : place === "statementRow" ? countSorted(stmtValues, v) > countSorted(bookValues, v) + countSorted(adjustedValues, v) : true
  };
}
var keyOf = (c) => `${c.kind}|${c.place}|${c.rows.join(",")}|${c.corrected ?? ""}|${c.partner ? `${c.partner.place}:${c.partner.index}` : ""}`;
function searchAgain(input, D, s) {
  if (D === 0n) return [];
  const keys = [];
  const stmtRows = s.rows("statementRow");
  const bookRows = s.rows("bookRow");
  const partner = (target) => {
    if (!s.unmatched("statementRow", target)) return null;
    for (let i = 0; i < stmtRows.length; i++) if (stmtRows[i].value === target) return { place: "statementRow", index: i };
    return null;
  };
  const covered = (target) => bookRows.some((r) => r.value === target) && s.unmatched("bookRow", target);
  for (const place of BK_REC_DIFF_PLACES) {
    const rows = s.rows(place);
    const grouped = [];
    rows.forEach((row, index) => {
      if (row.value === 0n || !s.unmatched(place, row.value)) return;
      const effect = row.mult * row.value;
      for (const swap of swapsByPlace(row.value)) {
        if (D - effect + row.mult * swap.corrected !== 0n) continue;
        if (place === "statementRow" && covered(swap.corrected)) continue;
        keys.push(keyOf({ kind: "transposition", place, rows: [index], corrected: Number(swap.corrected), partner: place === "bookRow" ? partner(swap.corrected) : null }));
      }
      if (isBalance(place)) return;
      if (2n * effect === D && !(place === "statementRow" && covered(-row.value))) {
        keys.push(keyOf({ kind: "reversed", place, rows: [index], corrected: isFileRow(place) ? Number(-row.value) : null, partner: place === "bookRow" ? partner(-row.value) : null }));
      }
      if (effect === D) {
        const g = grouped.find((x) => x.value === row.value && x.mult === row.mult);
        if (g) g.rows.push(index);
        else grouped.push({ value: row.value, mult: row.mult, rows: [index] });
      }
    });
    for (const g of grouped) keys.push(keyOf({ kind: g.rows.length > 1 ? "doubled" : "whole", place, rows: g.rows, corrected: null, partner: null }));
  }
  return keys.sort();
}
function corrected(input, c) {
  const r = recOf(input);
  const i = c.rows[0] ?? -1;
  const fixed = c.corrected === null ? null : BigInt(c.corrected);
  const list = (place) => place === "outstandingCheck" ? r.checks : place === "depositInTransit" ? r.deposits : place === "bankCorrection" ? r.bank : place === "bookAdjustment" ? r.book : null;
  const value = (place, index) => {
    const rows = place === "bookRow" ? input.bookRows : place === "statementRow" ? input.statementRows : void 0;
    const row = rows?.[index];
    return row ? BigInt(row.amount) : null;
  };
  switch (c.kind) {
    case "transposition": {
      if (fixed === null) return "no swapped amount";
      if (c.place === "statementBalance") r.statementBalance = fixed;
      else if (c.place === "bookBalance") r.bookBalance = fixed;
      else if (c.place === "outstandingCheck" || c.place === "depositInTransit") {
        const l = c.place === "outstandingCheck" ? r.checks : r.deposits;
        if (i < 0 || i >= l.length) return "no such row";
        l[i] = fixed;
      } else if (c.place === "bankCorrection" || c.place === "bookAdjustment") {
        const l = c.place === "bankCorrection" ? r.bank : r.book;
        if (i < 0 || i >= l.length) return "no such row";
        l[i] = { add: l[i].add, amount: fixed };
      } else {
        const v = value(c.place, i);
        if (v === null) return "no such row";
        r.bookBalance += c.place === "bookRow" ? fixed - v : v - fixed;
      }
      return r;
    }
    case "reversed": {
      if (c.place === "outstandingCheck" || c.place === "depositInTransit") {
        const [from, to] = c.place === "outstandingCheck" ? [r.checks, r.deposits] : [r.deposits, r.checks];
        if (i < 0 || i >= from.length) return "no such row";
        to.push(from.splice(i, 1)[0]);
      } else if (c.place === "bankCorrection" || c.place === "bookAdjustment") {
        const l = c.place === "bankCorrection" ? r.bank : r.book;
        if (i < 0 || i >= l.length) return "no such row";
        l[i] = { add: !l[i].add, amount: l[i].amount };
      } else if (isFileRow(c.place)) {
        const v = value(c.place, i);
        if (v === null) return "no such row";
        r.bookBalance += c.place === "bookRow" ? -2n * v : 2n * v;
      } else return "a balance is not reversed";
      return r;
    }
    case "whole":
    case "doubled": {
      const l = list(c.place);
      if (l) {
        if (i < 0 || i >= l.length) return "no such row";
        l.splice(i, 1);
      } else if (c.place === "bookRow") {
        const v = value(c.place, i);
        if (v === null) return "no such row";
        if (c.kind === "doubled") r.bookBalance -= v;
        else if (v < 0n) r.checks.push(-v);
        else r.deposits.push(v);
      } else if (c.place === "statementRow") {
        const v = value(c.place, i);
        if (v === null) return "no such row";
        r.book.push({ add: v > 0n, amount: v < 0n ? -v : v });
      } else return "a balance is not taken out";
      return r;
    }
  }
}
function notReal(input, s, c) {
  if (!BK_REC_DIFF_KINDS.includes(c.kind) || !BK_REC_DIFF_PLACES.includes(c.place)) return "an unknown kind or place";
  if (![c.amount, c.effect, c.differenceAfter, c.corrected ?? 0, c.partner?.index ?? 0].every(isInt) || !Array.isArray(c.rows)) return "a figure that is not a whole number of cents";
  const rows = s.rows(c.place);
  if (c.rows.length === 0 || c.rows.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= rows.length)) return "a row that was not given";
  if (new Set(c.rows).size !== c.rows.length) return "the same row twice";
  const first = rows[c.rows[0]];
  if (BigInt(c.amount) !== first.value) return `${formatUSD(c.amount)}, but the row holds ${formatUSD(cents(first.value, "amount"))}`;
  if (BigInt(c.effect) !== first.mult * first.value) return "an effect that is not the row's";
  if (isBalance(c.place) && c.kind !== "transposition") return "a balance, which only a swap of digits can correct";
  if (c.kind === "doubled" ? c.rows.length < 2 : c.rows.length !== 1) return "the wrong number of rows for its kind";
  if (c.rows.some((i) => rows[i].value !== first.value || rows[i].mult !== first.mult)) return "rows that do not all hold the same amount";
  if (c.kind === "transposition") {
    const swap = swapsByPlace(first.value).find((x) => c.corrected !== null && x.corrected === BigInt(c.corrected));
    if (!swap || swap.digits !== c.digits) return "a swapped amount that is not two neighbouring digits of the row swapped";
  } else if (c.digits !== null) return "digits on a candidate that is not a swap";
  if (c.kind === "reversed" && c.corrected !== (isFileRow(c.place) ? -c.amount : null)) return "a reversed amount that is not the row with the other sign";
  if ((c.kind === "whole" || c.kind === "doubled") && c.corrected !== null) return "a corrected amount on a candidate that takes the row out";
  if (c.partner) {
    if (c.place !== "bookRow" || c.partner.place !== "statementRow" || c.kind !== "transposition" && c.kind !== "reversed") return "a partner where none belongs";
    const p = s.rows("statementRow")[c.partner.index];
    if (!p || c.corrected === null || p.value !== BigInt(c.corrected)) return "a partner row that does not hold the corrected amount";
  }
  return null;
}
function bkVerifyRecDifference(input, r) {
  validate2(input);
  for (const key of ["adjustedBankBalance", "adjustedBookBalance", "difference"]) assertCents(r[key], key);
  const checks = new CheckList();
  const s = sides(input);
  const w = walk(recOf(input));
  const D = w.bank - w.book;
  const usd = (v) => formatUSD(cents(v, "figure"));
  checks.that(
    "difference-two-ways",
    "The difference used = adjusted bank balance − adjusted book balance, worked out a second time row by row",
    BigInt(r.adjustedBankBalance) === w.bank && BigInt(r.adjustedBookBalance) === w.book && BigInt(r.difference) === D && r.difference === r.adjustedBankBalance - r.adjustedBookBalance,
    `second pass: adjusted bank ${usd(w.bank)}, adjusted book ${usd(w.book)}, difference ${usd(D)}; shown: ${formatUSD(r.difference)}`
  );
  checks.that(
    "difference-facts",
    "Whether the difference divides by 9, and half of it, are stated exactly",
    (r.ninth === null ? D % 9n !== 0n : isInt(r.ninth) && BigInt(r.ninth) * 9n === D) && (r.half === null ? D % 2n !== 0n : isInt(r.half) && BigInt(r.half) * 2n === D),
    `the difference is ${usd(D)}`
  );
  const fake = r.candidates.map((c) => ({ c, why: notReal(input, s, c) })).filter((x) => x.why !== null);
  checks.that(
    "rows-real",
    "Every candidate points at a row that was given, with the amount it was given",
    fake.length === 0,
    fake[0] ? `${fake.length} candidate(s) do not; first: a ${BK_REC_DIFF_KIND_NAMES[fake[0].c.kind] ?? "candidate"} naming ${fake[0].why}` : void 0
  );
  const unbalanced = [];
  for (const c of r.candidates) {
    const fixed = notReal(input, s, c) === null ? corrected(input, c) : "it does not point at a real row";
    if (typeof fixed === "string") {
      unbalanced.push(`${bkRecDiffRowLabel(input, c.place, c.rows[0] ?? 0)}: ${fixed}`);
      continue;
    }
    const after = walk(fixed);
    if (after.bank - after.book !== 0n || c.differenceAfter !== 0) {
      unbalanced.push(`${bkRecDiffRowLabel(input, c.place, c.rows[0] ?? 0)}: recomputed difference ${usd(after.bank - after.book)}, shown ${formatUSD(c.differenceAfter)}`);
    }
  }
  checks.that(
    "fixes-recompute",
    "Every candidate, corrected, recomputes the whole reconciliation to a difference of $0.00",
    unbalanced.length === 0,
    unbalanced.length ? `${unbalanced.length} candidate(s) do not; first: ${unbalanced[0]}` : void 0
  );
  const unmatchedRow = (c, i) => {
    const row = s.rows(c.place)[i];
    return row !== void 0 && s.unmatched(c.place, row.value);
  };
  const matched = r.candidates.filter((c) => isFileRow(c.place) && !(Array.isArray(c.rows) && c.rows.every((i) => unmatchedRow(c, i))));
  const partnerMatched = r.candidates.filter((c) => c.partner !== null && (!isInt(c.corrected) || !s.unmatched("statementRow", BigInt(c.corrected))));
  checks.that(
    "unmatched",
    "Every candidate on the book rows or the statement rows, and every partner it names, has no partner of the same amount on the other side",
    matched.length === 0 && partnerMatched.length === 0,
    matched[0] || partnerMatched[0] ? `${matched.length + partnerMatched.length} candidate(s) name a row whose amount the other side holds as often` : void 0
  );
  const again = searchAgain(input, D, s);
  const shown2 = r.candidates.map(keyOf).sort();
  const missing = again.filter((k) => !shown2.includes(k));
  const extra = shown2.filter((k) => !again.includes(k));
  checks.that(
    "search-complete",
    "A second search, made a different way, finds the same candidates and no others",
    missing.length === 0 && extra.length === 0 && again.length === shown2.length,
    `second search: ${again.length} candidate(s); shown: ${shown2.length}${missing.length ? `; ${missing.length} not shown` : ""}${extra.length ? `; ${extra.length} the second search does not find` : ""}`
  );
  const date = input.statementDate ?? "";
  const dated = [...input.outstandingChecks, ...input.depositsInTransit].filter((x) => x.date !== "");
  if (date === "") {
    checks.that("old-outstanding", `No outstanding check or deposit in transit is dated more than ${BK_REC_DIFF_OLD_DAYS} days before the statement date`, dated.length === 0 && r.old.length === 0, `no statement date was given, so the ages of ${dated.length} dated item(s) were not worked out`, "warning");
  } else {
    const end = bkDayNumber(date);
    const old = [];
    for (const [place, items] of [
      ["outstandingCheck", input.outstandingChecks],
      ["depositInTransit", input.depositsInTransit]
    ]) {
      items.forEach((x, i) => {
        if (x.date !== "" && end - bkDayNumber(x.date) > BK_REC_DIFF_OLD_DAYS) old.push(`${place}:${i}:${end - bkDayNumber(x.date)}`);
      });
    }
    const listed = r.old.map((o) => `${o.place}:${o.index}:${o.days}`);
    const same = listed.length === old.length && old.every((k, i) => k === listed[i]) && r.old.every((o) => {
      const item = (o.place === "outstandingCheck" ? input.outstandingChecks : input.depositsInTransit)[o.index];
      return item !== void 0 && item.date === o.date && item.amount === o.amount;
    });
    const first = r.old[0];
    checks.that(
      "old-outstanding",
      `No outstanding check or deposit in transit is dated more than ${BK_REC_DIFF_OLD_DAYS} days before the statement date`,
      old.length === 0 && same,
      !same ? `the items listed as older than ${BK_REC_DIFF_OLD_DAYS} days are not the ones the dates give (${old.length} by the dates, ${listed.length} listed)` : first ? `${old.length} item(s) to look at; the first, ${bkRecDiffRowLabel(input, first.place, first.index)}, is dated ${first.date}, ${first.days} days before ${date}` : void 0,
      "warning"
    );
  }
  return checks.all;
}
function bkRecDiffRowLabel(input, place, index) {
  switch (place) {
    case "statementBalance":
      return "Statement ending balance";
    case "bookBalance":
      return "Book balance";
    case "outstandingCheck": {
      const number = input.outstandingChecks[index]?.number.trim() ?? "";
      return `Outstanding check ${index + 1}${number ? ` (No. ${number})` : ""}`;
    }
    case "depositInTransit":
      return `Deposit in transit ${index + 1}`;
    case "bankCorrection":
      return `Bank correction ${index + 1}`;
    case "bookAdjustment":
      return `Book adjustment ${index + 1}`;
    case "bookRow":
      return `Book row ${input.bookRows?.[index]?.rowNumber ?? index + 1}`;
    case "statementRow":
      return `Statement row ${input.statementRows?.[index]?.rowNumber ?? index + 1}`;
  }
}
function bkRecDiffRowDetail(input, place, index) {
  switch (place) {
    case "outstandingCheck": {
      const c = input.outstandingChecks[index];
      return { date: c?.date ?? "", description: c?.payee ?? "" };
    }
    case "depositInTransit": {
      const d = input.depositsInTransit[index];
      return { date: d?.date ?? "", description: d?.description ?? "" };
    }
    case "bankCorrection":
      return { date: "", description: input.bankCorrections[index]?.description ?? "" };
    case "bookAdjustment":
      return { date: "", description: input.bookAdjustments[index]?.description ?? "" };
    case "bookRow":
    case "statementRow": {
      const r = (place === "bookRow" ? input.bookRows : input.statementRows)?.[index];
      return { date: r?.date ?? "", description: r?.description ?? "" };
    }
    default:
      return { date: input.statementDate ?? "", description: "" };
  }
}
var join = (labels) => labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
function bkRecDiffSays(input, c) {
  const label = bkRecDiffRowLabel(input, c.place, c.rows[0] ?? 0);
  const amount = formatUSD(c.amount);
  const fixed = c.corrected === null ? "" : formatUSD(c.corrected);
  const zero = formatUSD(0);
  const partner = c.partner ? ` ${bkRecDiffRowLabel(input, c.partner.place, c.partner.index)} holds ${fixed}, with no partner on the book side.` : "";
  const direction = (place, i) => (place === "bankCorrection" ? input.bankCorrections[i] : input.bookAdjustments[i])?.direction === "add" ? "Add" : "Subtract";
  switch (c.kind) {
    case "transposition": {
      const pair = `its ${c.digits?.[0] ?? ""} and ${c.digits?.[1] ?? ""} swapped`;
      if (c.place === "statementRow") return `${label} holds ${amount}. The same item in the book rows as ${fixed}, ${pair}, would make exactly this difference.`;
      if (isBalance(c.place)) return `The ${label.toLowerCase()} reads ${amount}. With ${pair} it reads ${fixed}, and with that figure the difference is ${zero}.`;
      return `${label} reads ${amount}. With ${pair} it reads ${fixed}, and with that amount the difference is ${zero}.${partner}`;
    }
    case "reversed": {
      if (c.place === "bankCorrection" || c.place === "bookAdjustment") {
        const now = direction(c.place, c.rows[0] ?? 0);
        return `${label} (${amount}) is marked ${now}. Marked ${now === "Add" ? "Subtract" : "Add"}, it makes the difference ${zero}.`;
      }
      if (c.place === "outstandingCheck") return `${label} (${amount}) is on the outstanding checks list. On the deposits in transit list, it makes the difference ${zero}.`;
      if (c.place === "depositInTransit") return `${label} (${amount}) is on the deposits in transit list. On the outstanding checks list, it makes the difference ${zero}.`;
      if (c.place === "statementRow") return `${label} holds ${amount}. The same item in the book rows with the other sign, ${fixed}, would make exactly this difference.`;
      return `${label} holds ${amount}. With the other sign, ${fixed}, the difference is ${zero}.${partner}`;
    }
    case "whole":
      if (c.place === "bookRow") {
        const list = c.amount < 0 ? "an outstanding check" : "a deposit in transit";
        return `${label} (${amount}) has no row of the same amount ${input.statementRows ? "in the statement rows or " : ""}on the outstanding lists. Listed as ${list}, it makes the difference ${zero}.`;
      }
      if (c.place === "statementRow") return `${label} (${amount}) has no row of the same amount ${input.bookRows ? "in the book rows or " : ""}on the book adjustments list. On the book side, it makes the difference ${zero}.`;
      return `${label} (${amount}) moves the difference by exactly ${formatUSD(c.effect)}. Without it on the list, the difference is ${zero}.`;
    case "doubled": {
      const labels = join(c.rows.map((i) => bkRecDiffRowLabel(input, c.place, i)));
      const all = c.rows.length === 2 ? "both" : "all";
      if (c.place === "bookRow") return `${labels} ${all} hold ${amount}, more often than the bank side holds it. With one of them out of the book balance, the difference is ${zero}.`;
      if (c.place === "statementRow") return `${labels} ${all} hold ${amount}, more often than the book side holds it. With one more on the book side, the difference is ${zero}.`;
      return `${labels} ${all} read ${amount}. With one of them off the list, the difference is ${zero}.`;
    }
  }
}
function bkRecDiffTables(input, r) {
  const rec = bkBankRec(input);
  const listName = (place) => place === "outstandingCheck" ? "Outstanding checks" : "Deposits in transit";
  return {
    reconciliation: [
      ["Line", "Amount"],
      ...bkBankRecLines(input, rec).map((l) => [l.label, toDecimal(l.amount)]),
      ["Difference ÷ 9", r.ninth === null ? "not a whole number of cents" : toDecimal(r.ninth)],
      ["Half the difference", r.half === null ? "not a whole number of cents" : toDecimal(r.half)]
    ],
    candidates: [
      ["Kind", "Row", "Date", "Description", "Amount", "Digits swapped", "Corrected amount", "Other side", "Difference after", "What the numbers show"],
      ...r.candidates.map((c) => {
        const detail = bkRecDiffRowDetail(input, c.place, c.rows[0] ?? 0);
        return [
          BK_REC_DIFF_KIND_NAMES[c.kind],
          c.kind === "doubled" ? c.rows.map((i) => bkRecDiffRowLabel(input, c.place, i)).join("; ") : bkRecDiffRowLabel(input, c.place, c.rows[0] ?? 0),
          isBalance(c.place) ? "" : detail.date,
          detail.description,
          toDecimal(c.amount),
          c.digits ? `${c.digits[0]} and ${c.digits[1]}` : "",
          c.corrected === null ? "" : toDecimal(c.corrected),
          c.partner ? bkRecDiffRowLabel(input, c.partner.place, c.partner.index) : "",
          toDecimal(c.differenceAfter),
          bkRecDiffSays(input, c)
        ];
      })
    ],
    old: [
      ["List", "Row", "Date", "Description", "Amount", "Days before the statement date"],
      ...r.old.map((o) => [listName(o.place), bkRecDiffRowLabel(input, o.place, o.index), o.date, bkRecDiffRowDetail(input, o.place, o.index).description, toDecimal(o.amount), o.days])
    ]
  };
}
var BK_REC_DIFF_BOOK_LABELS = {
  date: "Date",
  description: "Description",
  amount: "Amount (one signed column, money in positive)",
  debit: "Money out (a credit to cash, or a payment column)",
  credit: "Money in (a debit to cash, or a deposit column)",
  balance: "Running balance (read, not compared)"
};
function bkRecDiffColumnLabels(which) {
  return which === "book" ? BK_REC_DIFF_BOOK_LABELS : BK_ROLE_LABELS;
}
function bkRecDiffGuessColumns(which, rows, headerRow) {
  const g = bkGuessStatementColumns(rows, headerRow);
  if (which === "statement") return g;
  const header = rows[g.headerRow] ?? [];
  const named = (col, word) => col >= 0 && word.test(header[col] ?? "");
  if (named(g.columns.debit, /\bdebits?\b/i) || named(g.columns.credit, /\bcredits?\b/i)) return { ...g, columns: { ...g.columns, debit: g.columns.credit, credit: g.columns.debit } };
  return g;
}
function bkRecDiffFileChecks(which, problems, leftOut) {
  const name = which === "book" ? "book rows" : "statement rows";
  const rows = (list) => list.slice(0, 10).map((p) => `row ${p.rowNumber} (${p.reason})`).join("; ") + (list.length > 10 ? `; and ${list.length - 10} more` : "");
  const checks = new CheckList();
  checks.that(`${which}-rows-read`, `Every row with data in the ${name} file could be read`, problems.length === 0, problems.length ? `${problems.length} row(s) could not be read and are not searched: ${rows(problems)}` : void 0);
  checks.that(`${which}-rows-left-out`, `No row with data in the ${name} file was left out`, leftOut.length === 0, leftOut.length ? `${leftOut.length} row(s) are not used: ${rows(leftOut)}` : void 0, "warning");
  return checks.all;
}

export {
  bkBankRec,
  BK_BANK_REC_LINE_KEYS,
  BK_BANK_REC_LINE_LABELS,
  bkBankRecTables,
  bkMergeStatements,
  BK_DUP_MAX_DAYS,
  bkFindDuplicates,
  bkDuplicateGroupsTable,
  bkDuplicateRowsTable,
  bkDuplicateTotalsTable,
  bkLeftOutRows,
  BK_REC_DIFF_OLD_DAYS,
  BK_REC_DIFF_MAX_ROWS,
  BK_REC_DIFF_PLACES,
  BK_REC_DIFF_KINDS,
  BK_REC_DIFF_KIND_NAMES,
  bkFindRecDifference,
  bkVerifyRecDifference,
  bkRecDiffRowLabel,
  bkRecDiffRowDetail,
  bkRecDiffSays,
  bkRecDiffTables,
  BK_REC_DIFF_BOOK_LABELS,
  bkRecDiffColumnLabels,
  bkRecDiffGuessColumns,
  bkRecDiffFileChecks
};
