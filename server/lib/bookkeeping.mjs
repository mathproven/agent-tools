// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  DORMANCY_TABLE,
  dormancyPeriodEnd,
  findDormancyRow,
  verifyDormancyPeriodEnd
} from "./dormancyPeriods.mjs";
import {
  BK_BANK_REC_LINE_KEYS,
  BK_BANK_REC_LINE_LABELS,
  BK_DUP_MAX_DAYS,
  BK_REC_DIFF_BOOK_LABELS,
  BK_REC_DIFF_OLD_DAYS,
  bkBankRec,
  bkBankRecTables,
  bkDuplicateGroupsTable,
  bkDuplicateRowsTable,
  bkDuplicateTotalsTable,
  bkFindDuplicates,
  bkFindRecDifference,
  bkLeftOutRows,
  bkMergeStatements,
  bkRecDiffFileChecks,
  bkRecDiffGuessColumns,
  bkRecDiffTables
} from "./recDifference.mjs";
import {
  BK_ROLE_LABELS,
  BK_STATEMENT_ROLES,
  bkCellToIsoDate,
  bkFormatDate,
  bkGuessStatementColumns,
  bkHeaderList,
  bkMoneyCell
} from "./cells.mjs";
import {
  parseCsv,
  sumCsvColumn,
  toCsv
} from "./csv.mjs";
import {
  REF_US_STATES_DC,
  refMemberName
} from "./sourced.mjs";
import {
  verifyTemplateWorkbook
} from "./templates.mjs";
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
  scaledFormat,
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader,
  statementRows,
  verifyBankStatement,
  verifyCardStatement
} from "./reconcile.mjs";
import {
  CheckList,
  assertCents,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/bookkeeping/bankRecWorkbook.ts
var BK_BANK_REC_SHEETS = ["Reconciliation", "Outstanding checks", "Deposits in transit", "Adjustments", "Instructions"];
var BK_BANK_REC_CHECK_HEADERS = ["Line", "Check number", "Date", "Payee", "Amount"];
var BK_BANK_REC_DEPOSIT_HEADERS = ["Line", "Date", "Description", "Amount"];
var BK_BANK_REC_ADJUSTMENT_HEADERS = ["Line", "Side", "Add or subtract", "Description", "Amount"];
var LINE_NOTES = {
  depositsTotal: "total of the Deposits in transit sheet",
  checksTotal: "total of the Outstanding checks sheet",
  bankAdded: "Adjustments sheet: Bank rows marked Add",
  bankSubtracted: "Adjustments sheet: Bank rows marked Subtract",
  bookBalance: "the cash account in the ledger",
  bookAdded: "Adjustments sheet: Book rows marked Add",
  bookSubtracted: "Adjustments sheet: Book rows marked Subtract"
};
var BK_BANK_REC_SUMMARY_LINES = [
  ["account", "Account or business name"],
  ["statementDate", "Statement date"],
  ...BK_BANK_REC_LINE_KEYS.map((key) => [key, LINE_NOTES[key] ? `${BK_BANK_REC_LINE_LABELS[key]} (${LINE_NOTES[key]})` : BK_BANK_REC_LINE_LABELS[key]])
];
var WRITTEN_LABELS = {
  depositsTotal: "deposits in transit total",
  checksTotal: "outstanding checks total",
  bankAdded: "total of bank corrections added",
  bankSubtracted: "total of bank corrections subtracted",
  adjustedBank: "adjusted bank balance",
  bookAdded: "total of book adjustments added",
  bookSubtracted: "total of book adjustments subtracted",
  adjustedBook: "adjusted book balance",
  difference: "difference between the adjusted bank and adjusted book balances"
};
var WRITTEN_KEYS = BK_BANK_REC_LINE_KEYS.filter((key) => key !== "statementBalance" && key !== "bookBalance");
var LESS_KEYS = /* @__PURE__ */ new Set(["checksTotal", "bankSubtracted", "bookSubtracted"]);
var MAX_ROWS = 200;
var tidy = (text) => text.trim().replace(/\s+/g, " ");
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ROWS) throw new Error(`${label} must be a whole number from 1 to ${MAX_ROWS}.`);
  return value;
}
function bkBankRecTemplateRowCounts(o) {
  return {
    checkRows: count(o.checkRows, "The number of outstanding check rows"),
    depositRows: count(o.depositRows, "The number of deposit in transit rows"),
    bankCorrectionRows: count(o.bankCorrectionRows, "The number of bank correction rows"),
    bookAdjustmentRows: count(o.bookAdjustmentRows, "The number of book adjustment rows")
  };
}
function bkBankRecTemplateSheets(o) {
  if (o.statementDate !== "" && !isIsoDate(o.statementDate)) throw new Error("The statement date is not a valid date.");
  const rows = bkBankRecTemplateRowCounts(o);
  const filled = { account: tidy(o.account), statementDate: o.statementDate };
  return [
    { name: BK_BANK_REC_SHEETS[0], rows: [["Item", "Value"], ...BK_BANK_REC_SUMMARY_LINES.map(([key, label]) => [label, filled[key] ?? ""])], money: [], widths: [78, 24] },
    { name: BK_BANK_REC_SHEETS[1], rows: [[...BK_BANK_REC_CHECK_HEADERS], ...Array.from({ length: rows.checkRows }, (_, i) => [i + 1, "", "", "", ""])], money: [], widths: [8, 16, 14, 36, 16] },
    { name: BK_BANK_REC_SHEETS[2], rows: [[...BK_BANK_REC_DEPOSIT_HEADERS], ...Array.from({ length: rows.depositRows }, (_, i) => [i + 1, "", "", ""])], money: [], widths: [8, 14, 40, 16] },
    {
      name: BK_BANK_REC_SHEETS[3],
      rows: [
        [...BK_BANK_REC_ADJUSTMENT_HEADERS],
        ...Array.from({ length: rows.bankCorrectionRows }, (_, i) => [i + 1, "Bank", "", "", ""]),
        ...Array.from({ length: rows.bookAdjustmentRows }, (_, i) => [rows.bankCorrectionRows + i + 1, "Book", "", "", ""])
      ],
      money: [],
      widths: [8, 10, 18, 44, 16]
    },
    {
      name: BK_BANK_REC_SHEETS[4],
      rows: [
        ["How this workbook is laid out"],
        ["Reconciliation: the account or business name, the statement date, the statement ending balance, and the book balance. The lines for totals, the two adjusted balances, and the difference are there to be written in by hand."],
        ["Outstanding checks: one row per check recorded in the books that is not on the bank statement yet. Amounts are positive numbers."],
        ["Deposits in transit: one row per deposit recorded in the books that is not on the bank statement yet. Amounts are positive numbers."],
        ["Adjustments: one row per item that changes one of the two balances. Side says which one: Bank for a correction to the statement balance; Book for an item not yet in the books (interest, a bank fee, a returned item) or a correction to the books."],
        ["Add or subtract says which way a row on the Adjustments sheet moves its balance: type Add or Subtract. Amounts are positive numbers; a reversal is a row of its own with the other word."],
        ["Adjusted bank balance = statement ending balance + deposits in transit − outstanding checks + bank corrections added − bank corrections subtracted."],
        ["Adjusted book balance = book balance + book adjustments added − book adjustments subtracted."],
        ["Amounts are plain numbers. This workbook holds values only and contains no formulas, so nothing in it calculates."],
        [`The bank reconciliation tool ${o.toolUrl ? `at ${o.toolUrl}` : "on the same site"} opens this workbook, works out both adjusted balances and the difference to the cent, and shows the checks it ran.`],
        ["A numbered row with nothing typed in it is skipped. Add more rows under the last one on any list sheet."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
function sideRuns(sides) {
  const runs = [];
  for (const side of sides) {
    const last = runs[runs.length - 1];
    if (last && last.side === side) last.count++;
    else runs.push({ side, count: 1 });
  }
  return runs.map((r) => `${r.count} ${r.side === "" ? "blank" : r.side}`).join(", ");
}
function bkVerifyBankRecTemplate(o, bytes) {
  const want = bkBankRecTemplateRowCounts(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(bkBankRecTemplateSheets(o), bytes));
  const read = readXlsx(bytes);
  const [summary, outstanding, deposits, adjustments, instructions] = [read[0], read[1], read[2], read[3], read[4]];
  const cell = (sheet, row, col) => sheet?.rows[row]?.[col] ?? "";
  checks.equal("summary-lines", "The Reconciliation sheet has every line, in order", BK_BANK_REC_SUMMARY_LINES.map(([, label]) => label).join(" | "), (summary?.rows ?? []).slice(1).map((r) => r[0] ?? "").join(" | "));
  checks.equal("account", "The account or business name reads back as typed", tidy(o.account), cell(summary, 1, 1));
  checks.equal("statement-date", "The statement date reads back as typed", o.statementDate, cell(summary, 2, 1));
  const amountsBlank = (summary?.rows ?? []).slice(3).every((r) => (r[1] ?? "") === "");
  checks.that("summary-blank", "Every amount on the Reconciliation sheet is left blank to fill in", amountsBlank);
  const lists = [
    ["checks", outstanding, BK_BANK_REC_SHEETS[1]],
    ["deposits", deposits, BK_BANK_REC_SHEETS[2]],
    ["adjustments", adjustments, BK_BANK_REC_SHEETS[3]]
  ];
  for (const [id, sheet, title] of lists) {
    const body = (sheet?.rows ?? []).slice(1);
    checks.that(`${id}-numbered`, `${title}: the rows are numbered from 1`, body.length > 0 && body.every((r, i) => r[0] === String(i + 1)));
  }
  checks.equal(
    "adjustments-sides",
    "Adjustments: the rows arrive marked Bank, then Book, as many of each as asked for",
    `${want.bankCorrectionRows} Bank, ${want.bookAdjustmentRows} Book`,
    sideRuns((adjustments?.rows ?? []).slice(1).map((r) => r[1] ?? ""))
  );
  let typed = 0;
  for (const [id, sheet] of lists) {
    const skip = id === "adjustments" ? 2 : 1;
    for (const row of (sheet?.rows ?? []).slice(1)) typed += row.slice(skip).filter((c) => c !== "").length;
  }
  checks.that("lists-blank", "Every list row is blank apart from its number and, on the Adjustments sheet, its side", typed === 0, `${typed} cell(s) on the list sheets are already filled in`);
  checks.that("instructions", "The Instructions sheet is there", (instructions?.rows.length ?? 0) >= 6);
  let formulas = 0;
  for (const s of read) for (const row of s.rows) for (const c of row) if (/^=/.test(c)) formulas++;
  checks.that("read-back-values-only", "Read back from the file, no cell holds a formula", formulas === 0, `${formulas} cell(s) start with an equals sign`);
  return checks.all;
}
function stem(label) {
  return pmNormalizeHeader(label.replace(/\([^)]*\)/g, " "));
}
function findSheet(sheets, name) {
  const want = pmNormalizeHeader(name);
  const found = sheets.filter((s) => pmNormalizeHeader(s.name) === want);
  if (found.length === 0) throw new Error(`This workbook has no sheet named "${name}". It needs these four: ${BK_BANK_REC_SHEETS.slice(0, 4).join(", ")}.`);
  if (found.length > 1) throw new Error(`This workbook has more than one sheet named "${name}".`);
  return found[0];
}
var TOTAL_WORD = /^(grand |sub ?)?totals?:?$/i;
var CHECK_COLUMNS = {
  amount: ["amount", "check amount"],
  date: ["date", "check date"],
  number: ["check number", "check no", "check num", "check", "number", "reference", "ref"],
  payee: ["payee", "paid to", "pay to", "description", "memo", "name", "note"]
};
var DEPOSIT_COLUMNS = {
  amount: ["amount", "deposit amount"],
  date: ["date", "deposit date"],
  description: ["description", "memo", "note", "details", "reference", "source"]
};
var ADJUSTMENT_COLUMNS = {
  amount: ["amount"],
  side: ["side", "bank or book"],
  direction: ["add or subtract", "add subtract", "direction", "plus or minus"],
  description: ["description", "memo", "note", "details", "reason"]
};
var SIDES = /* @__PURE__ */ new Map([["bank", "bank"], ["book", "book"], ["books", "book"]]);
var DIRECTIONS = /* @__PURE__ */ new Map([["add", "add"], ["plus", "add"], ["+", "add"], ["subtract", "subtract"], ["less", "subtract"], ["minus", "subtract"], ["-", "subtract"], ["−", "subtract"]]);
function matchColumns(header, synonyms) {
  const roles = Object.keys(synonyms);
  const names = header.map((c) => pmNormalizeHeader(c));
  const found = Object.fromEntries(roles.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  for (const exact of [true, false]) {
    for (const role of roles) {
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
var matched = (columns) => Object.values(columns).filter((c) => c >= 0).length;
function readList(sheet, spec, outcome, item) {
  const rows = sheet.rows.map((row) => row.map((c) => String(c ?? "").trim()));
  let headerRow = Math.max(0, rows.findIndex((r) => r.some((c) => c !== "")));
  let columns = matchColumns(rows[headerRow] ?? [], spec.synonyms);
  rows.slice(0, 25).forEach((row, i) => {
    const candidate = matchColumns(row, spec.synonyms);
    if (matched(candidate) > matched(columns)) {
      columns = candidate;
      headerRow = i;
    }
  });
  const header = rows[headerRow] ?? [];
  const quiet = /* @__PURE__ */ new Set([header.findIndex((c) => pmNormalizeHeader(c) === "line"), spec.prefilled ? columns[spec.prefilled] : -1]);
  const body = rows.map((row, i) => ({ row, rowNumber: i + 1 })).filter(({ row }, i) => i > headerRow && row.some((c, j) => c !== "" && !quiet.has(j)));
  if (body.length === 0) return [];
  for (const role of spec.required) {
    if (columns[role] >= 0) continue;
    const names = header.filter(Boolean);
    const foundText = names.length ? `headers found: ${names.slice(0, 12).join(", ")}` : "the header row is empty";
    const wanted = role === "direction" ? "Add or subtract" : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
    throw new Error(`Sheet "${sheet.name}": no "${wanted}" column could be identified (${foundText}). Its header row needs these columns: ${spec.headers.filter((h) => h !== "Line").join(", ")}.`);
  }
  const dateCol = columns.date ?? -1;
  const items = [];
  for (const { row, rowNumber } of body) {
    const cell = (role) => columns[role] >= 0 ? row[columns[role]] ?? "" : "";
    const hasDate = dateCol >= 0 && (row[dateCol] ?? "") !== "";
    if (!hasDate && row.some((c) => TOTAL_WORD.test(c))) {
      outcome.totalRows++;
      continue;
    }
    const reasons = [];
    const made = item(cell, (reason) => void reasons.push(reason));
    if (reasons.length) outcome.problems.push({ sheet: sheet.name, rowNumber, reason: reasons.join("; ") });
    else items.push(made);
  }
  return items;
}
function amountCell(raw, fail) {
  if (raw === "") {
    fail("no amount");
    return 0;
  }
  try {
    return pmCellToCents(raw);
  } catch {
    fail(`the amount "${raw}" could not be read`);
    return 0;
  }
}
function dateCell(raw, fail) {
  if (raw === "") return "";
  try {
    return pmCellToIsoDate(raw);
  } catch {
    fail(`the date "${raw}" could not be read`);
    return "";
  }
}
function bkReadBankRecWorkbook(sheets) {
  const summary = findSheet(sheets, BK_BANK_REC_SHEETS[0]);
  const outstanding = findSheet(sheets, BK_BANK_REC_SHEETS[1]);
  const deposits = findSheet(sheets, BK_BANK_REC_SHEETS[2]);
  const adjustments = findSheet(sheets, BK_BANK_REC_SHEETS[3]);
  const byStem = new Map(BK_BANK_REC_SUMMARY_LINES.map(([key, label]) => [stem(label), key]));
  const raw = /* @__PURE__ */ new Map();
  summary.rows.forEach((row, i) => {
    const key = byStem.get(stem(String(row[0] ?? "")));
    if (!key) return;
    if (raw.has(key)) throw new Error(`The ${BK_BANK_REC_SHEETS[0]} sheet has two rows labelled "${String(row[0]).trim()}" (the second is row ${i + 1}).`);
    raw.set(key, String(row[1] ?? "").trim());
  });
  const amount = (key) => {
    const text = raw.get(key) ?? "";
    if (text === "") return void 0;
    try {
      return pmCellToCents(text);
    } catch {
      throw new Error(`"${BK_BANK_REC_LINE_LABELS[key]}" on the ${BK_BANK_REC_SHEETS[0]} sheet is not an amount: "${text}".`);
    }
  };
  const statementBalance = amount("statementBalance");
  if (statementBalance === void 0) throw new Error(`Type the statement ending balance on the ${BK_BANK_REC_SHEETS[0]} sheet.`);
  const bookBalance = amount("bookBalance");
  if (bookBalance === void 0) throw new Error(`Type the book balance on the ${BK_BANK_REC_SHEETS[0]} sheet.`);
  let statementDate = "";
  const rawDate = raw.get("statementDate") ?? "";
  if (rawDate !== "") {
    try {
      statementDate = pmCellToIsoDate(rawDate);
    } catch {
      throw new Error(`The statement date on the ${BK_BANK_REC_SHEETS[0]} sheet could not be read: "${rawDate}".`);
    }
  }
  const written = {};
  for (const key of WRITTEN_KEYS) {
    const value = amount(key);
    if (value !== void 0) written[key] = value;
  }
  const outcome = { problems: [], totalRows: 0 };
  const outstandingChecks = readList(outstanding, { synonyms: CHECK_COLUMNS, required: ["amount"], headers: BK_BANK_REC_CHECK_HEADERS }, outcome, (cell, fail) => {
    const value = amountCell(cell("amount"), fail);
    return { number: cell("number"), date: dateCell(cell("date"), fail), payee: cell("payee"), amount: value };
  });
  const depositsInTransit = readList(deposits, { synonyms: DEPOSIT_COLUMNS, required: ["amount"], headers: BK_BANK_REC_DEPOSIT_HEADERS }, outcome, (cell, fail) => {
    const value = amountCell(cell("amount"), fail);
    return { date: dateCell(cell("date"), fail), description: cell("description"), amount: value };
  });
  const sided = readList(
    adjustments,
    { synonyms: ADJUSTMENT_COLUMNS, required: ["amount", "side", "direction"], headers: BK_BANK_REC_ADJUSTMENT_HEADERS, prefilled: "side" },
    outcome,
    (cell, fail) => {
      const rawSide = cell("side");
      const side = SIDES.get(rawSide.toLowerCase());
      if (rawSide === "") fail("no side (Bank or Book)");
      else if (!side) fail(`the side "${rawSide}" is not Bank or Book`);
      const rawDirection = cell("direction");
      const direction = DIRECTIONS.get(rawDirection.toLowerCase());
      if (rawDirection === "") fail("no Add or Subtract");
      else if (!direction) fail(`"${rawDirection}" is not Add or Subtract`);
      const value = amountCell(cell("amount"), fail);
      return { side: side ?? "bank", adjustment: { description: cell("description"), direction: direction ?? "add", amount: value } };
    }
  );
  const input = {
    statementDate,
    statementBalance,
    bookBalance,
    outstandingChecks,
    depositsInTransit,
    bankCorrections: sided.filter((s) => s.side === "bank").map((s) => s.adjustment),
    bookAdjustments: sided.filter((s) => s.side === "book").map((s) => s.adjustment)
  };
  return { account: tidy(raw.get("account") ?? ""), input, written, problems: outcome.problems, totalRows: outcome.totalRows };
}
function bkBankRecWorkbookChecks(read, r) {
  const checks = new CheckList();
  const first = read.problems[0];
  checks.that("workbook-rows-read", "Every filled row on the list sheets was read", read.problems.length === 0, first ? `${read.problems.length} row(s) could not be read and are left out; first: sheet "${first.sheet}" row ${first.rowNumber} (${first.reason})` : void 0);
  const calculated = {
    depositsTotal: r.depositsInTransitTotal,
    checksTotal: r.outstandingChecksTotal,
    bankAdded: r.bankCorrectionsAdded,
    bankSubtracted: r.bankCorrectionsSubtracted,
    adjustedBank: r.adjustedBankBalance,
    bookAdded: r.bookAdjustmentsAdded,
    bookSubtracted: r.bookAdjustmentsSubtracted,
    adjustedBook: r.adjustedBookBalance,
    difference: r.difference
  };
  for (const key of WRITTEN_KEYS) {
    const value = read.written[key];
    if (value === void 0) continue;
    checks.cents(`written-${key}`, `The ${WRITTEN_LABELS[key]} written on the Reconciliation sheet = the calculated figure`, calculated[key], LESS_KEYS.has(key) ? Math.abs(value) : value);
  }
  return checks.all;
}

// packages/core/src/bookkeeping/duplicatesCheck.ts
function sameWords(description) {
  if (typeof description !== "string") return "";
  return description.split(/\s+/).filter((word) => word !== "").join(" ").toLowerCase();
}
function dayCount(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const year = BigInt(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const leap = year % 400n === 0n || year % 4n === 0n && year % 100n !== 0n;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const length = lengths[month - 1];
  if (year < 1n || length === void 0 || day < 1 || day > length) return null;
  let days = BigInt(day);
  for (let i = 0; i < month - 1; i++) days += BigInt(lengths[i] ?? 0);
  const past = year - 1n;
  return past * 365n + past / 4n - past / 100n + past / 400n + days;
}
function whole(n) {
  return typeof n === "number" && Number.isSafeInteger(n) ? BigInt(n) : null;
}
var usd = (cents) => `${cents < 0n ? "-" : ""}$${scaledFormat(cents < 0n ? -cents : cents, 2)}`;
function rowList(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const shown2 = sorted.slice(0, 20).join(", ");
  return sorted.length > 20 ? `${shown2} and ${sorted.length - 20} more` : shown2;
}
function addTo(lists, key, item) {
  const list = lists.get(key);
  if (list) list.push(item);
  else lists.set(key, [item]);
}
function bkVerifyDuplicates(input, report) {
  const checks = new CheckList();
  const typedDays = whole(input.nearDays);
  const days = typedDays !== null && typedDays > 0n ? typedDays : 0n;
  const facts = [];
  const byNumber = /* @__PURE__ */ new Map();
  const unreadable = [];
  for (const row of input.rows) {
    const fact = { rowNumber: row.rowNumber, date: row.date, day: dayCount(row.date), words: sameWords(row.description), cents: whole(row.amount) };
    const own = Number.isSafeInteger(row.rowNumber) && row.rowNumber >= 1 && !byNumber.has(row.rowNumber);
    if (own) byNumber.set(row.rowNumber, fact);
    if (!own || fact.day === null || fact.cents === null) unreadable.push(row.rowNumber);
    facts.push(fact);
  }
  checks.that("bk-dup-readable", "Every row has a real calendar date, an amount in whole cents, and a row number of its own", unreadable.length === 0, `not so for row(s) ${rowList(unreadable)}`);
  const kinds = [
    ["exact", report.exactGroups],
    ["near", report.nearGroups]
  ];
  const groupOf = /* @__PURE__ */ new Map();
  const twice = [];
  const strangers = [];
  const labels = /* @__PURE__ */ new Set();
  let labelClash = false;
  for (const [kind, list] of kinds) {
    for (const group of list) {
      if (group.label === "" || labels.has(group.label)) labelClash = true;
      labels.add(group.label);
      for (const n of group.rowNumbers) {
        if (!byNumber.has(n)) strangers.push(n);
        if (groupOf.has(n)) twice.push(n);
        else groupOf.set(n, { kind, group });
      }
    }
  }
  const groupAt = (f) => byNumber.get(f.rowNumber) === f ? groupOf.get(f.rowNumber)?.group : void 0;
  const timesShown = /* @__PURE__ */ new Map();
  for (const shown2 of report.rows) timesShown.set(shown2.rowNumber, (timesShown.get(shown2.rowNumber) ?? 0) + 1);
  const shownAt = /* @__PURE__ */ new Map();
  for (const shown2 of report.rows) shownAt.set(shown2.rowNumber, shown2);
  const missing = [];
  const repeated = [];
  const changed = [];
  const mislabelled = [];
  for (const row of input.rows) {
    const shown2 = shownAt.get(row.rowNumber);
    if (!shown2) {
      missing.push(row.rowNumber);
      continue;
    }
    if (timesShown.get(row.rowNumber) !== 1) repeated.push(row.rowNumber);
    if (shown2.date !== row.date || shown2.description !== row.description || shown2.amount !== row.amount) changed.push(row.rowNumber);
    const at = groupOf.get(row.rowNumber);
    if (shown2.list !== (at ? at.kind : "none") || shown2.group !== (at ? at.group.label : "")) mislabelled.push(row.rowNumber);
  }
  const added = report.rows.filter((shown2) => !byNumber.has(shown2.rowNumber)).map((shown2) => shown2.rowNumber);
  const sameOrder = report.rows.length === input.rows.length && input.rows.every((row, i) => report.rows[i]?.rowNumber === row.rowNumber);
  const everyRow = [
    missing.length ? `row(s) ${rowList(missing)} are missing from the result` : "",
    repeated.length ? `row(s) ${rowList(repeated)} are in the result more than once` : "",
    added.length ? `the result has row(s) ${rowList(added)}, which are not rows of the file` : "",
    changed.length ? `row(s) ${rowList(changed)} are not shown as they were read` : "",
    mislabelled.length ? `row(s) ${rowList(mislabelled)} carry a list or group other than the one they are in` : "",
    twice.length ? `row(s) ${rowList(twice)} are in more than one group` : "",
    strangers.length ? `the groups name row(s) ${rowList(strangers)}, which are not rows of the file` : "",
    labelClash ? "two groups have the same label, or a group has none" : "",
    missing.length + repeated.length + added.length === 0 && !sameOrder ? "the rows are not in the order of the file" : ""
  ].filter(Boolean);
  checks.that("bk-dup-every-row", "Every row of the file is in exactly one of the three lists, shown as it was read", everyRow.length === 0, everyRow.join("; "));
  checks.add({
    id: "bk-dup-days",
    label: "The number of days used for near repeats is the number you typed (blank is 0)",
    passed: typedDays !== null && typedDays >= 0n && report.nearDays === input.nearDays,
    severity: "error",
    expected: String(input.nearDays),
    actual: String(report.nearDays)
  });
  const members = (g) => {
    const out = [];
    for (const n of g.rowNumbers) {
      const f = byNumber.get(n);
      if (!f) return null;
      out.push(f);
    }
    return out;
  };
  const badExact = [];
  for (const g of report.exactGroups) {
    const rows = members(g);
    const first = rows?.[0];
    const sound = g.kind === "exact" && rows !== null && first !== void 0 && rows.length >= 2 && first.day !== null && first.cents !== null && rows.every((f, i) => f.date === first.date && f.cents === first.cents && f.words === first.words && (i === 0 || f.rowNumber > (rows[i - 1]?.rowNumber ?? f.rowNumber))) && whole(g.amount) === first.cents && g.firstDate === first.date && g.lastDate === first.date && sameWords(g.description) === first.words;
    if (!sound) badExact.push(g.label);
  }
  checks.that("bk-dup-exact-agree", "Every exact group has two or more rows with the same date, the same amount, and the same description", badExact.length === 0, `not so for ${badExact.join(", ")}`);
  const sameDate = /* @__PURE__ */ new Map();
  for (const f of facts) addTo(sameDate, JSON.stringify([f.date, String(f.cents), f.words]), f);
  const apart = [];
  for (const list of sameDate.values()) {
    const at = list[0] ? groupAt(list[0]) : void 0;
    if (list.length < 2) continue;
    if (!at || list.some((f) => groupAt(f) !== at)) for (const f of list) apart.push(f.rowNumber);
  }
  checks.that("bk-dup-exact-complete", "No two rows outside the same group have the same date, amount, and description", apart.length === 0, `row(s) ${rowList(apart)} agree on all three and are not in one group together`);
  if (days > 0n) {
    const badNear = [];
    for (const g of report.nearGroups) {
      const rows = members(g);
      const first = rows?.[0];
      const last = rows?.[rows.length - 1];
      let sound = g.kind === "near" && rows !== null && first !== void 0 && last !== void 0 && rows.length >= 2 && first.cents !== null && first.day !== null && last.day !== null && last.day > first.day;
      if (sound && rows && first && last) {
        let before;
        for (const f of rows) {
          if (f.day === null || f.cents !== first.cents || f.words !== first.words) sound = false;
          if (before && f.day !== null && before.day !== null) {
            const gap = f.day - before.day;
            if (gap < 0n || gap > days || gap === 0n && f.rowNumber <= before.rowNumber) sound = false;
          }
          before = f;
        }
        if (whole(g.amount) !== first.cents || g.firstDate !== first.date || g.lastDate !== last.date || sameWords(g.description) !== first.words) sound = false;
      }
      if (!sound) badNear.push(g.label);
    }
    checks.that(
      "bk-dup-near-agree",
      "Every near group has two or more rows with the same amount and description, on more than one date, each within the typed number of days of the row before it",
      badNear.length === 0,
      `not so for ${badNear.join(", ")}`
    );
    const dated = (f) => f.day !== null;
    const alike = /* @__PURE__ */ new Map();
    for (const f of facts) {
      if (dated(f)) addTo(alike, JSON.stringify([String(f.cents), f.words]), f);
    }
    const apartNear = [];
    for (const list of alike.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
      const dates = [];
      for (const f of list) {
        const current = dates[dates.length - 1];
        if (current && current[0] && current[0].day === f.day) current.push(f);
        else dates.push([f]);
      }
      for (let i = 1; i < dates.length; i++) {
        const earlier = dates[i - 1] ?? [];
        const later = dates[i] ?? [];
        const a = earlier[0];
        const b = later[0];
        if (!a || !b || b.day - a.day > days) continue;
        const both = [...earlier, ...later];
        const at = groupAt(a);
        if (!at || both.some((f) => groupAt(f) !== at)) for (const f of both) apartNear.push(f.rowNumber);
      }
    }
    checks.that(
      "bk-dup-near-complete",
      "No two rows outside the same group have the same amount and description on different dates within the typed number of days of each other",
      apartNear.length === 0,
      `row(s) ${rowList(apartNear)} are that close and are not in one group together`
    );
  } else {
    checks.that("bk-dup-near-off", "No number of days was typed, so no near group is listed", report.nearGroups.length === 0, `${report.nearGroups.length} near group(s) are listed`);
  }
  const badLater = [];
  const laterOf = (list) => {
    const total = { rows: 0n, cents: 0n };
    for (const g of list) {
      let first;
      let count2 = 0n;
      let sum3 = 0n;
      for (const n of g.rowNumbers) {
        const f = byNumber.get(n);
        if (!f) continue;
        count2 += 1n;
        sum3 += f.cents ?? 0n;
        const day = f.day ?? 0n;
        const firstDay = first?.day ?? 0n;
        if (!first || day < firstDay || day === firstDay && f.rowNumber < first.rowNumber) first = f;
      }
      const rows = count2 > 0n ? count2 - 1n : 0n;
      const cents = first ? sum3 - (first.cents ?? 0n) : 0n;
      if (whole(g.laterRows) !== rows || whole(g.laterAmount) !== cents) badLater.push(g.label);
      total.rows += rows;
      total.cents += cents;
    }
    return total;
  };
  const same = (shown2, tally) => whole(shown2.rows) === tally.rows && whole(shown2.amount) === tally.cents;
  const said = (shown2) => {
    const cents = whole(shown2.amount);
    return `${shown2.rows} row(s), ${cents === null ? String(shown2.amount) : usd(cents)}`;
  };
  const readded = (tally) => `${tally.rows} row(s), ${usd(tally.cents)}`;
  const exactLater = laterOf(report.exactGroups);
  const nearLater = laterOf(report.nearGroups);
  const t = report.totals;
  const laterDetail = [
    badLater.length ? `the figures on ${badLater.join(", ")} are not its rows re-added` : "",
    same(t.exactLater, exactLater) ? "" : `exact groups re-add to ${readded(exactLater)}, shown ${said(t.exactLater)}`,
    same(t.nearLater, nearLater) ? "" : `near groups re-add to ${readded(nearLater)}, shown ${said(t.nearLater)}`
  ].filter(Boolean);
  checks.that("bk-dup-later-totals", "The rows and dollars in the second and later rows of each group, re-added from the rows, equal the totals shown", laterDetail.length === 0, laterDetail.join("; "));
  const lists = { exact: { rows: 0n, cents: 0n }, near: { rows: 0n, cents: 0n }, none: { rows: 0n, cents: 0n }, file: { rows: 0n, cents: 0n } };
  for (const f of facts) {
    const at = byNumber.get(f.rowNumber) === f ? groupOf.get(f.rowNumber) : void 0;
    for (const tally of [lists[at ? at.kind : "none"], lists.file]) {
      tally.rows += 1n;
      tally.cents += f.cents ?? 0n;
    }
  }
  const shownRows = [t.exact.rows, t.near.rows, t.none.rows].map(whole);
  const shownCents = [t.exact.amount, t.near.amount, t.none.amount].map(whole);
  const sumOf = (values) => values.reduce((n, v) => n === null || v === null ? null : n + v, 0n);
  const listDetail = [
    same(t.exact, lists.exact) ? "" : `exact repeats re-add to ${readded(lists.exact)}, shown ${said(t.exact)}`,
    same(t.near, lists.near) ? "" : `near repeats re-add to ${readded(lists.near)}, shown ${said(t.near)}`,
    same(t.none, lists.none) ? "" : `rows with no repeat found re-add to ${readded(lists.none)}, shown ${said(t.none)}`,
    same(t.file, lists.file) ? "" : `the file re-adds to ${readded(lists.file)}, shown ${said(t.file)}`,
    sumOf(shownRows) === lists.file.rows && sumOf(shownCents) === lists.file.cents ? "" : `the three lists shown do not add up to the file's ${readded(lists.file)}`
  ].filter(Boolean);
  checks.that("bk-dup-list-totals", "The three lists, re-added from the rows, equal the totals shown and add up to the file: rows and dollars", listDetail.length === 0, listDetail.join("; "));
  const blank = facts.filter((f) => f.words === "").map((f) => f.rowNumber);
  checks.that("bk-dup-blank-descriptions", "Every row has a description", blank.length === 0, `${blank.length} row(s) have no description and are compared on date and amount only: row(s) ${rowList(blank)}`, "warning");
  return checks.all;
}

// packages/core/src/bookkeeping/escheatList.ts
var BK_ESCHEAT_ROLES = ["number", "payee", "state", "date", "kind", "amount"];
var BK_ESCHEAT_LABELS = {
  number: "Check number",
  payee: "Payee",
  state: "Payee state",
  date: "Issue date",
  kind: "Type (vendor or payroll)",
  amount: "Amount"
};
var BK_ESCHEAT_REQUIRED = ["state", "date", "amount"];
var SYNONYMS = {
  state: ["payee state", "state", "st", "payee home state", "home state", "state of payee", "last known state", "address state", "province state"],
  date: ["issue date", "check date", "date issued", "date written", "date"],
  kind: ["type", "check type", "kind", "payment type", "category"],
  amount: ["amount", "check amount", "amt", "value", "payment"],
  number: ["check number", "check no", "check", "number", "no", "num", "reference", "ref"],
  payee: ["payee", "pay to", "name", "vendor", "employee", "description", "memo"]
};
function bkEscheatGuessColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, BK_ESCHEAT_ROLES, SYNONYMS, atHeaderRow);
}
function bkEscheatKind(text) {
  const t = text.trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/^(payroll|wages?|salary|salaries|pay ?check|payroll check|wage check|pr|employee)( check)?$/.test(t)) return "payroll";
  if (/^(vendor|vendors|supplier|accounts payable|ap|a p|payable|vendor payment|vendor check|ap check)( check)?$/.test(t)) return "vendor";
  return null;
}
function bkReadOutstandingChecks(rows, mapping, options) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const col = mapping.columns;
  const headers = bkHeaderList(rows, mapping.headerRow);
  for (const role of BK_ESCHEAT_REQUIRED) {
    if (col[role] < 0) throw new Error(`No "${BK_ESCHEAT_LABELS[role]}" column could be identified (${headers}). Choose it in the column mapping.`);
  }
  if (col.kind < 0 && options.kindWhenBlank === null) throw new Error("The list has no type column. Choose it in the column mapping, or pick the type for every check in the list.");
  const used = BK_ESCHEAT_ROLES.map((role) => col[role]).filter((i) => i >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
  const out = { checks: [], problems: [], leftOut: [] };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const cell = (role) => sheetCell(cells, col[role]);
    const dateText = cell("date");
    const amountText = cell("amount");
    const words = [cell("number"), cell("payee"), cell("state"), (cells[0] ?? "").trim()];
    if (dateText === "" && words.some(sheetIsTotalWord)) {
      out.leftOut.push({ rowNumber, reason: "the file’s own total line" });
      if (out.fileTotal === void 0) {
        try {
          const v = bkMoneyCell(amountText);
          if (v !== void 0) out.fileTotal = options.signs === "negative" ? -v : v;
        } catch {
        }
      }
      continue;
    }
    if (dateText === "" && amountText === "") {
      out.leftOut.push({ rowNumber, reason: "no issue date and no amount" });
      continue;
    }
    const reasons = [];
    let date = "";
    if (dateText === "") reasons.push("no issue date");
    else {
      try {
        date = bkCellToIsoDate(dateText, options.dateOrder);
      } catch {
        reasons.push(`the issue date "${dateText}" could not be read`);
      }
    }
    let amount = 0;
    if (amountText === "") reasons.push("no amount");
    else {
      try {
        const v = bkMoneyCell(amountText);
        if (v === void 0) reasons.push("no amount");
        else {
          amount = options.signs === "negative" ? -v : v;
          if (amount === 0) reasons.push("an amount of zero");
          else if (amount < 0) reasons.push(options.signs === "negative" ? `the amount "${amountText}" is positive, and this list writes checks as negative amounts` : `the amount "${amountText}" is negative, and this list writes checks as positive amounts`);
        }
      } catch {
        reasons.push(`the amount "${amountText}" could not be read`);
      }
    }
    const kindText = cell("kind");
    let kind = kindText === "" ? options.kindWhenBlank : bkEscheatKind(kindText);
    if (kind === null) reasons.push(kindText === "" ? "no type (vendor or payroll)" : `the type "${kindText}" is neither vendor nor payroll`);
    if (reasons.length > 0) {
      out.problems.push({ rowNumber, reason: reasons.join("; ") });
      continue;
    }
    out.checks.push({ rowNumber, number: cell("number"), payee: cell("payee"), state: cell("state"), date, kind, amount: amount === 0 ? 0 : amount });
  }
  return out;
}
var squeeze = (s) => s.toUpperCase().replace(/[^A-Z]/g, "");
function bkEscheatState(text, table = DORMANCY_TABLE) {
  const raw = text.trim();
  if (raw === "") return { key: "-", code: "", status: "blank", name: "No payee state" };
  const s = squeeze(raw);
  const member = table.members.find((m) => m.code === s || squeeze(m.name) === s);
  if (!member) return { key: `?${raw.toUpperCase()}`, code: "", status: "not-in-table", name: raw };
  return { key: member.code, code: member.code, status: findDormancyRow(member.code, table) ? "dated" : "not-read", name: member.name };
}
var STATUS_ORDER = { dated: 0, "not-read": 1, "not-in-table": 2, blank: 3 };
function bkEscheatList(input, table = DORMANCY_TABLE) {
  const groups = /* @__PURE__ */ new Map();
  const lines = input.checks.map((c, index) => {
    const st = bkEscheatState(c.state, table);
    let years = null;
    let periodEnds = null;
    let daysFromAsOf = null;
    let ended = null;
    if (st.status === "dated") {
      const r = dormancyPeriodEnd({ state: st.code, kind: c.kind, checkDate: c.date, asOf: input.asOf }, table);
      years = r.years;
      periodEnds = r.periodEnds;
      daysFromAsOf = r.daysFromAsOf;
      ended = r.daysFromAsOf <= 0;
    }
    let g = groups.get(st.key);
    if (!g) {
      const row = st.status === "dated" ? findDormancyRow(st.code, table) : void 0;
      g = { ...st, lines: [], count: 0, total: 0, endedCount: 0, endedTotal: 0, aheadCount: 0, aheadTotal: 0, firstEnds: null, lastEnds: null, report: row?.report?.text ?? null, citation: row?.citation ?? "", checkedOn: row?.checkedOn ?? "" };
      groups.set(st.key, g);
    }
    g.lines.push(index);
    g.count += 1;
    g.total += c.amount;
    if (ended === true) {
      g.endedCount += 1;
      g.endedTotal += c.amount;
    } else if (ended === false) {
      g.aheadCount += 1;
      g.aheadTotal += c.amount;
    }
    if (periodEnds !== null) {
      if (g.firstEnds === null || periodEnds < g.firstEnds) g.firstEnds = periodEnds;
      if (g.lastEnds === null || periodEnds > g.lastEnds) g.lastEnds = periodEnds;
    }
    return { ...c, index, group: st.key, years, periodEnds, daysFromAsOf, ended };
  });
  const ordered = [...groups.values()].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const result = { asOf: input.asOf, lines, groups: ordered, count: lines.length, total };
  return { ...result, checks: bkVerifyEscheatList(input, result, table) };
}
var big = (values) => values.reduce((s, v) => s + BigInt(v), 0n);
var rowList2 = (rows) => rows.length > 12 ? `${rows.slice(0, 12).join(", ")} and ${rows.length - 12} more` : rows.join(", ");
function bkVerifyEscheatList(input, r, table = DORMANCY_TABLE) {
  const checks = new CheckList();
  const given = input.checks;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const groups = Array.isArray(r.groups) ? r.groups : [];
  const changed = given.map((c, i) => {
    const l = lines[i];
    const same = l !== void 0 && l.index === i && l.rowNumber === c.rowNumber && l.state === c.state && l.date === c.date && l.kind === c.kind && l.amount === c.amount && l.number === c.number && l.payee === c.payee;
    return same ? -1 : c.rowNumber;
  }).filter((n) => n >= 0);
  checks.that(
    "lines-as-given",
    "Every check in the list is shown once, with the state, date, type and amount it was given",
    changed.length === 0 && lines.length === given.length,
    `${lines.length} line(s) for ${given.length} check(s)${changed.length ? `; changed or missing: row(s) ${rowList2(changed)}` : ""}`
  );
  const totalBig = big(given.map((c) => c.amount));
  checks.equal("list-count", "Checks counted again from the list", given.length, r.count);
  checks.that("list-total-second-way", "The list total, added again in whole cents a second way", totalBig === BigInt(r.total), `added again: ${toDecimal(Number(totalBig))}; shown: ${toDecimal(r.total)}`);
  checks.that("amounts-positive", "Every check amount is a whole number of cents above zero", given.every((c) => Number.isSafeInteger(c.amount) && c.amount > 0), "a check amount is zero, negative or not whole cents");
  const seen = /* @__PURE__ */ new Map();
  for (const g of groups) for (const i of g.lines) seen.set(i, (seen.get(i) ?? 0) + 1);
  const misplaced = given.map((c, i) => {
    const key = bkEscheatState(c.state, table).key;
    const holder = groups.filter((g) => g.lines.includes(i));
    return seen.get(i) === 1 && holder[0]?.key === key && lines[i]?.group === key ? -1 : c.rowNumber;
  }).filter((n) => n >= 0);
  const strays = [...seen.keys()].filter((i) => i < 0 || i >= given.length || !Number.isInteger(i));
  const keys = groups.map((g) => g.key);
  checks.that(
    "one-group-each",
    "Every check is in exactly one group, the one its payee state names, states with no row included",
    misplaced.length === 0 && strays.length === 0 && new Set(keys).size === keys.length,
    [misplaced.length ? `in no group, two groups or the wrong one: row(s) ${rowList2(misplaced)}` : "", strays.length ? `a group lists a check that is not in the list` : "", new Set(keys).size !== keys.length ? "two groups share a state" : ""].filter(Boolean).join("; ")
  );
  checks.equal("groups-tie-count", "The group counts add up to the number of checks in the list", given.length, groups.reduce((s, g) => s + g.count, 0));
  const groupBig = big(groups.map((g) => g.total));
  checks.that("groups-tie-total", "The group totals add up to the list total, to the cent", groupBig === totalBig, `groups: ${toDecimal(Number(groupBig))}; list: ${toDecimal(Number(totalBig))}`);
  const badGroups = groups.filter((g) => {
    const own = g.lines.map((i) => given[i]).filter((c) => c !== void 0);
    const ended = g.lines.filter((i) => lines[i]?.ended === true);
    const ahead = g.lines.filter((i) => lines[i]?.ended === false);
    const sumOf = (idx) => big(idx.map((i) => given[i]?.amount ?? 0));
    return own.length !== g.count || big(own.map((c) => c.amount)) !== BigInt(g.total) || ended.length !== g.endedCount || ahead.length !== g.aheadCount || sumOf(ended) !== BigInt(g.endedTotal) || sumOf(ahead) !== BigInt(g.aheadTotal) || (g.status === "dated" ? g.endedCount + g.aheadCount !== g.count || BigInt(g.endedTotal) + BigInt(g.aheadTotal) !== BigInt(g.total) : g.endedCount + g.aheadCount !== 0);
  }).map((g) => g.name);
  checks.that("group-totals", "Each group’s count and total are its own checks, split into ended and still ahead with nothing over or missing", badGroups.length === 0, `does not add up: ${badGroups.join(", ")}`);
  const wrongDate = [];
  const undated = [];
  given.forEach((c, i) => {
    const l = lines[i];
    if (!l) return;
    const st = bkEscheatState(c.state, table);
    if (st.status !== "dated") {
      if (l.years !== null || l.periodEnds !== null || l.daysFromAsOf !== null || l.ended !== null) undated.push(c.rowNumber);
      return;
    }
    let ok = false;
    try {
      const calc = dormancyPeriodEnd({ state: st.code, kind: c.kind, checkDate: c.date, asOf: input.asOf }, table);
      ok = calc.years === l.years && calc.periodEnds === l.periodEnds && calc.daysFromAsOf === l.daysFromAsOf && l.ended === calc.daysFromAsOf <= 0;
      if (ok && l.periodEnds !== null && l.years !== null && l.daysFromAsOf !== null) {
        const again = verifyDormancyPeriodEnd({ row: calc.row, kind: c.kind, checkDate: c.date, asOf: input.asOf, years: l.years, periodEnds: l.periodEnds, daysFromAsOf: l.daysFromAsOf }, table);
        ok = again.every((k) => k.passed || k.severity !== "error");
      }
    } catch {
      ok = false;
    }
    if (!ok) wrongDate.push(c.rowNumber);
  });
  checks.that(
    "dates-as-calculator",
    "Each check’s end date is the one the dormancy table’s calculator gives for its state, type and issue date, counted again a second way",
    wrongDate.length === 0,
    `differs for row(s) ${rowList2(wrongDate)}`
  );
  checks.that("no-date-without-row", "A check whose state has no row in the table is given no date", undated.length === 0, `given a date with no row: row(s) ${rowList2(undated)}`);
  if (input.statedTotal !== void 0) checks.cents("ties-stated-total", "The list ties to the outstanding-check total typed from the reconciliation", input.statedTotal, Number(totalBig));
  else checks.that("ties-stated-total", "The list ties to the outstanding-check total on the reconciliation", false, "No outstanding-check total was typed, so the list is tied to its own rows only.", "warning");
  if (input.fileTotal !== void 0) checks.cents("ties-file-total", "The list ties to the total line in the file", input.fileTotal, Number(totalBig));
  const noRow = groups.filter((g) => g.status !== "dated");
  checks.that(
    "states-with-rows",
    "Every check’s payee state has a row in the dormancy table",
    noRow.length === 0,
    `Listed with no date, never guessed: ${noRow.map((g) => `${g.status === "not-read" ? `${g.name} (not read for the table yet)` : g.status === "blank" ? "no payee state written" : `"${g.name}" (not a state or DC in the table)`}: ${g.count} check(s), ${formatUSD(g.total)}`).join("; ")}.`,
    "warning"
  );
  const excepted = groups.filter((g) => g.status === "dated" && g.lines.some((i) => given[i]?.kind === "vendor")).map((g) => findDormancyRow(g.code, table)).filter((row) => row !== void 0 && row.vendorException !== "");
  checks.that(
    "vendor-exception",
    "No vendor check is in a state whose row notes an exception for checks between businesses",
    excepted.length === 0,
    `The row notes an exception for checks between businesses in ${excepted.map((row) => refMemberName(REF_US_STATES_DC, row.code)).join(", ")}; the date shown is only the row’s period added to the issue date. ${excepted.map((row) => `${row.code}: ${row.vendorException}`).join(" ")}`,
    "warning"
  );
  return checks.all;
}
var STATUS_WORDS = {
  dated: "In the table",
  "not-read": "Not read for the table yet",
  "not-in-table": "Not a state or DC in the table",
  blank: "No payee state written"
};
var groupName = (g) => g.code ? `${g.name} (${g.code})` : g.name;
function bkEscheatGroupsTable(r) {
  return [
    ["Payee state", "Table row", "Checks", "Total", "Period ended by the as-of date", "Amount ended", "Still ahead", "Amount ahead", "First end date", "Last end date", "Annual report in the row", "Source"],
    ...r.groups.map((g) => [
      groupName(g),
      STATUS_WORDS[g.status],
      g.count,
      toDecimal(g.total),
      g.status === "dated" ? g.endedCount : "",
      g.status === "dated" ? toDecimal(g.endedTotal) : "",
      g.status === "dated" ? g.aheadCount : "",
      g.status === "dated" ? toDecimal(g.aheadTotal) : "",
      g.firstEnds ?? "",
      g.lastEnds ?? "",
      g.status === "dated" ? g.report ?? "Not read yet" : "",
      g.citation ? `${g.citation} (read ${g.checkedOn})` : ""
    ]),
    ["All checks", "", r.count, toDecimal(r.total), "", "", "", "", "", "", "", ""]
  ];
}
function bkEscheatLinesTable(r) {
  const rows = [];
  for (const g of r.groups) {
    const own = g.lines.map((i) => r.lines[i]).filter((l) => l !== void 0);
    own.sort((a, b) => (a.periodEnds ?? "").localeCompare(b.periodEnds ?? "") || a.rowNumber - b.rowNumber);
    for (const l of own) {
      rows.push([
        l.rowNumber,
        l.number,
        l.payee,
        groupName(g),
        l.kind === "vendor" ? "Vendor" : "Payroll",
        l.date,
        toDecimal(l.amount),
        l.years === null ? "" : l.years,
        l.periodEnds ?? "No row in the table",
        l.daysFromAsOf === null ? "" : l.daysFromAsOf,
        l.ended === null ? "" : l.ended ? "Ended" : "Ahead"
      ]);
    }
  }
  return [["File row", "Check number", "Payee", "Payee state", "Type", "Issue date", "Amount", "Years in the row", "Period ends", "Days from the as-of date", "By the as-of date"], ...rows];
}

// packages/core/src/bookkeeping/importCsv.ts
function bkSplitImportCsv(statement, options = {}) {
  const maxRows = options.maxRows ?? 1e3;
  const dateFormat = options.dateFormat ?? "mdy";
  const columns = options.columns ?? "signed";
  if (statement.transactions.length === 0) {
    throw new Error("The statement has no transactions to write.");
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1e5) {
    throw new Error("Rows per file must be a whole number from 1 to 100,000.");
  }
  const files = [];
  const checks = new CheckList();
  let totalAmount = 0;
  for (let i = 0; i < statement.transactions.length; i += maxRows) {
    const chunk = statement.transactions.slice(i, i + maxRows);
    const rows = [];
    if (columns === "signed") {
      rows.push(["Date", "Description", "Amount"]);
      for (const t of chunk) {
        bkFormatDate(t.date, dateFormat);
        rows.push([bkFormatDate(t.date, dateFormat), t.description, toDecimal(t.amount)]);
      }
    } else {
      rows.push(["Date", "Description", "Debit", "Credit"]);
      for (const t of chunk) {
        bkFormatDate(t.date, dateFormat);
        if (t.amount > 0) {
          rows.push([bkFormatDate(t.date, dateFormat), t.description, "", toDecimal(t.amount)]);
        } else if (t.amount < 0) {
          rows.push([bkFormatDate(t.date, dateFormat), t.description, toDecimal(-t.amount), ""]);
        } else {
          rows.push([bkFormatDate(t.date, dateFormat), t.description, "", "0.00"]);
        }
      }
    }
    const csv = toCsv(rows);
    const count2 = chunk.length;
    let sum3;
    if (columns === "signed") {
      sum3 = sumCsvColumn(csv, "Amount");
    } else {
      const creditSum = sumCsvColumn(csv, "Credit");
      const debitSum = sumCsvColumn(csv, "Debit");
      sum3 = creditSum - debitSum;
    }
    files.push({
      index: files.length + 1,
      rows,
      csv,
      count: count2,
      sum: sum3
    });
    totalAmount += chunk.reduce((a, t) => a + t.amount, 0);
  }
  checks.equal("split-files", "The number of files is what the row limit calls for", Math.ceil(statement.transactions.length / maxRows), files.length);
  const rowsReadBack = files.map((f) => parseCsv(f.csv).length - 1);
  checks.that("split-max", `No file has more than ${maxRows} transaction rows`, rowsReadBack.every((n) => n <= maxRows));
  checks.equal("split-count", "Rows in the files add up to the transaction count", statement.transactions.length, rowsReadBack.reduce((a, n) => a + n, 0));
  checks.cents("split-sum", "Amounts in the files add up to the statement total", totalAmount, files.reduce((a, f) => a + f.sum, 0));
  return {
    maxRows,
    dateFormat,
    columns,
    files,
    checks: checks.all
  };
}

// packages/core/src/bookkeeping/ofxRead.ts
function bkReadOfx(text) {
  const at = text.search(/<OFX>/i);
  if (at < 0) throw new Error("This is not an OFX file: it has no <OFX> section.");
  const header = {};
  for (const line of text.slice(0, at).split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (line.trim() === "" || colon < 0) continue;
    header[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const unescape = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const readDate = (tag, value) => {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : "";
    if (!isIsoDate(iso)) throw new Error(`The file has a date that cannot be read in ${tag}: "${value}".`);
    return iso;
  };
  const readAmount = (tag, value) => {
    try {
      return parseAmount(value);
    } catch {
      throw new Error(`The file has an amount that cannot be read in ${tag}: "${value}".`);
    }
  };
  const file = { header, currency: "", bankId: "", accountId: "", accountType: "", start: "", end: "", transactions: [], ledgerBalance: 0, ledgerDate: "" };
  let hasLedgerBalance = false;
  let txn = null;
  let txnCount = 0;
  const open = [];
  let lastElement = "";
  const body = text.slice(at);
  const tags = /<(\/?)([^<>\s]+)>([^<]*)/g;
  for (let m = tags.exec(body); m !== null; m = tags.exec(body)) {
    const closing = m[1] === "/";
    const tag = m[2].toUpperCase();
    const raw = m[3].trim();
    const inside = open[open.length - 1] ?? "";
    if (closing) {
      if (tag === lastElement) {
        lastElement = "";
        continue;
      }
      lastElement = "";
      if (tag !== inside) throw new Error(`The file closes ${tag} where ${inside || "nothing"} is open.`);
      open.pop();
      if (tag === "STMTTRN" && txn !== null) {
        if (txn.date === null || txn.amount === null || txn.fitId === null) throw new Error(`Transaction ${txnCount} in the file has no date, amount, or id.`);
        file.transactions.push({ type: txn.type, date: txn.date, amount: txn.amount, fitId: txn.fitId, name: txn.name, memo: txn.memo });
        txn = null;
      }
      continue;
    }
    if (raw === "") {
      lastElement = "";
      open.push(tag);
      if (tag === "STMTTRN") {
        txnCount += 1;
        txn = { type: "", date: null, amount: null, fitId: null, name: "", memo: "" };
      }
      continue;
    }
    lastElement = tag;
    const value = unescape(raw);
    if (tag === "CURDEF" && file.currency === "") file.currency = value;
    else if (tag === "BANKID" && file.bankId === "") file.bankId = value;
    else if (tag === "ACCTID" && file.accountId === "") file.accountId = value;
    else if (tag === "ACCTTYPE" && file.accountType === "") file.accountType = value;
    else if (tag === "DTSTART" && open.includes("BANKTRANLIST")) file.start = readDate(tag, raw);
    else if (tag === "DTEND" && open.includes("BANKTRANLIST")) file.end = readDate(tag, raw);
    else if (inside === "STMTTRN" && txn !== null) {
      if (tag === "TRNTYPE") txn.type = value;
      else if (tag === "DTPOSTED") txn.date = readDate(tag, raw);
      else if (tag === "TRNAMT") txn.amount = readAmount(tag, raw);
      else if (tag === "FITID") txn.fitId = value;
      else if (tag === "NAME") txn.name = value;
      else if (tag === "MEMO") txn.memo = value;
    } else if (inside === "LEDGERBAL") {
      if (tag === "BALAMT") {
        file.ledgerBalance = readAmount(tag, raw);
        hasLedgerBalance = true;
      } else if (tag === "DTASOF") file.ledgerDate = readDate(tag, raw);
    }
  }
  const stillOpen = open[open.length - 1];
  if (stillOpen !== void 0) throw new Error(`The file ends while ${stillOpen} is still open.`);
  if (!hasLedgerBalance) throw new Error("The file has no ledger balance.");
  return file;
}

// packages/core/src/bookkeeping/ofxWrite.ts
var BK_OFX_ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "MONEYMRKT", "CREDITLINE"];
function bkOfxClean(text) {
  return text.replace(/\s+/g, " ").trim().replace(/[^\x20-\x7e]/g, "?");
}
function bkOfxEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function bkOfxDate(iso) {
  if (!isIsoDate(iso)) throw new Error(`"${iso}" is not a valid date, so it cannot be written to the file.`);
  return iso.replace(/-/g, "");
}
function bkFitIds(transactions) {
  const perDay = /* @__PURE__ */ new Map();
  return transactions.map((t) => {
    const day = bkOfxDate(t.date);
    const seq = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, seq);
    return `${day}.${String(seq).padStart(3, "0")}.${t.amount < 0 ? "N" : ""}${Math.abs(t.amount)}`;
  });
}
function bkStatementPeriod(s) {
  const dates = s.transactions.map((t) => t.date).filter(isIsoDate).sort();
  const start = s.periodStart ?? dates[0];
  const end = s.periodEnd ?? dates[dates.length - 1];
  if (!start || !end) throw new Error("The statement has no dates to work out its period from.");
  return { start, end };
}
function bkWriteOfx(statement, options = {}) {
  if (statement.transactions.length === 0) throw new Error("The statement has no transactions to write.");
  const bankId = options.bankId ?? "000000000";
  if (!/^[A-Za-z0-9]{1,9}$/.test(bankId)) throw new Error("The bank id must be 1 to 9 letters or digits.");
  const accountId = options.accountId ?? "0000";
  if (!/^[A-Za-z0-9-]{1,22}$/.test(accountId)) throw new Error("The account id must be 1 to 22 letters, digits, or hyphens.");
  const accountType = options.accountType ?? "CHECKING";
  if (!BK_OFX_ACCOUNT_TYPES.includes(accountType)) throw new Error(`"${accountType}" is not an account type this file format has.`);
  const currency = options.currency ?? "USD";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("The currency must be three capital letters, such as USD.");
  const intuBid = options.intuBid;
  if (intuBid !== void 0 && !/^\d{1,10}$/.test(intuBid)) throw new Error("The institution id must be 1 to 10 digits.");
  const period = bkStatementPeriod(statement);
  const serverDate = options.generatedOn ?? period.end;
  const fitIds = bkFitIds(statement.transactions);
  const lines = [];
  lines.push("OFXHEADER:100");
  lines.push("DATA:OFXSGML");
  lines.push("VERSION:102");
  lines.push("SECURITY:NONE");
  lines.push("ENCODING:USASCII");
  lines.push("CHARSET:1252");
  lines.push("COMPRESSION:NONE");
  lines.push("OLDFILEUID:NONE");
  lines.push("NEWFILEUID:NONE");
  lines.push("");
  lines.push("<OFX>");
  lines.push("<SIGNONMSGSRSV1>");
  lines.push("<SONRS>");
  lines.push("<STATUS>");
  lines.push("<CODE>0");
  lines.push("<SEVERITY>INFO");
  lines.push("</STATUS>");
  lines.push(`<DTSERVER>${bkOfxDate(serverDate)}120000`);
  lines.push("<LANGUAGE>ENG");
  if (intuBid !== void 0) {
    lines.push(`<INTU.BID>${intuBid}`);
  }
  lines.push("</SONRS>");
  lines.push("</SIGNONMSGSRSV1>");
  lines.push("<BANKMSGSRSV1>");
  lines.push("<STMTTRNRS>");
  lines.push("<TRNUID>1");
  lines.push("<STATUS>");
  lines.push("<CODE>0");
  lines.push("<SEVERITY>INFO");
  lines.push("</STATUS>");
  lines.push("<STMTRS>");
  lines.push(`<CURDEF>${currency}`);
  lines.push("<BANKACCTFROM>");
  lines.push(`<BANKID>${bankId}`);
  lines.push(`<ACCTID>${accountId}`);
  lines.push(`<ACCTTYPE>${accountType}`);
  lines.push("</BANKACCTFROM>");
  lines.push("<BANKTRANLIST>");
  lines.push(`<DTSTART>${bkOfxDate(period.start)}`);
  lines.push(`<DTEND>${bkOfxDate(period.end)}`);
  for (let i = 0; i < statement.transactions.length; i++) {
    const t = statement.transactions[i];
    const fitId = fitIds[i];
    const cleanDesc = bkOfxClean(t.description);
    const name = cleanDesc.substring(0, 32).trim() || "No description";
    const memo = cleanDesc.length > 32 ? cleanDesc.substring(0, 255).trim() : void 0;
    lines.push("<STMTTRN>");
    lines.push(`<TRNTYPE>${t.amount > 0 ? "CREDIT" : "DEBIT"}`);
    lines.push(`<DTPOSTED>${bkOfxDate(t.date)}`);
    lines.push(`<TRNAMT>${toDecimal(t.amount)}`);
    lines.push(`<FITID>${fitId}`);
    lines.push(`<NAME>${bkOfxEscape(name)}`);
    if (memo !== void 0) {
      lines.push(`<MEMO>${bkOfxEscape(memo)}`);
    }
    lines.push("</STMTTRN>");
  }
  lines.push("</BANKTRANLIST>");
  lines.push("<LEDGERBAL>");
  lines.push(`<BALAMT>${toDecimal(statement.closingBalance)}`);
  lines.push(`<DTASOF>${bkOfxDate(period.end)}`);
  lines.push("</LEDGERBAL>");
  lines.push("</STMTRS>");
  lines.push("</STMTTRNRS>");
  lines.push("</BANKMSGSRSV1>");
  lines.push("</OFX>");
  return lines.join("\r\n") + "\r\n";
}

// packages/core/src/bookkeeping/ofxExport.ts
function bkVerifyOfx(statement, ofxText) {
  const checks = new CheckList();
  let file;
  try {
    file = bkReadOfx(ofxText);
  } catch (err) {
    checks.that("ofx-readable", "The OFX file can be read back", false, err instanceof Error ? err.message : "The file could not be read back.");
    return checks.all;
  }
  checks.that("ofx-readable", "The OFX file can be read back", true);
  const txns = statement.transactions;
  checks.equal("ofx-count", "The OFX file has the same number of transactions as the statement", txns.length, file.transactions.length);
  let different = 0;
  let firstDifferent = "";
  txns.forEach((t, i) => {
    const got = file.transactions[i];
    const text = bkOfxClean(t.description);
    const name = text.slice(0, 32).trim() || "No description";
    const memo = text.length > 32 ? text.slice(0, 255).trim() : "";
    const same = got !== void 0 && got.date === t.date && got.amount === t.amount && got.name === name && got.memo === memo && got.type === (t.amount > 0 ? "CREDIT" : "DEBIT");
    if (!same) {
      different++;
      if (!firstDifferent) firstDifferent = `transaction ${i + 1} (${t.date})`;
    }
  });
  checks.that("ofx-transactions", "Every transaction in the OFX file has the statement’s date, amount, and description, in the same order", different === 0, `${different} differ; first: ${firstDifferent}`);
  checks.cents("ofx-total", "Transactions in the OFX file add up to the statement total", sum(txns.map((t) => t.amount)), Number(file.transactions.reduce((a, t) => a + BigInt(t.amount), 0n)));
  const ids = file.transactions.map((t) => t.fitId);
  checks.that("ofx-fitid-unique", "Every transaction id (FITID) in the OFX file is different", new Set(ids).size === ids.length && ids.every((id) => id !== ""), `${ids.length - new Set(ids).size} id(s) are repeated`);
  checks.cents("ofx-ledger-balance", "Ledger balance in the OFX file = closing balance", statement.closingBalance, file.ledgerBalance);
  return checks.all;
}
function bkExportStatement(statement, ofxOptions = {}, csvOptions = {}) {
  const ofx = bkWriteOfx(statement, ofxOptions);
  const csv = bkSplitImportCsv(statement, csvOptions);
  return { ofx, csv, checks: [...bkVerifyOfx(statement, ofx), ...csv.checks] };
}

// packages/core/src/bookkeeping/pettyCash.ts
var BK_PETTY_CASH_DENOMINATIONS = [
  { label: "$100 bills", kind: "bill", value: 1e4 },
  { label: "$50 bills", kind: "bill", value: 5e3 },
  { label: "$20 bills", kind: "bill", value: 2e3 },
  { label: "$10 bills", kind: "bill", value: 1e3 },
  { label: "$5 bills", kind: "bill", value: 500 },
  { label: "$2 bills", kind: "bill", value: 200 },
  { label: "$1 bills", kind: "bill", value: 100 },
  { label: "$1 coins", kind: "coin", value: 100 },
  { label: "Half dollars (50¢)", kind: "coin", value: 50 },
  { label: "Quarters (25¢)", kind: "coin", value: 25 },
  { label: "Dimes (10¢)", kind: "coin", value: 10 },
  { label: "Nickels (5¢)", kind: "coin", value: 5 },
  { label: "Pennies (1¢)", kind: "coin", value: 1 }
];
var clean = (s) => s.trim().replace(/\s+/g, " ");
var accountKey = (s) => clean(s).toLowerCase();
function validate(input) {
  assertCents(input.fund, "fund");
  if (input.fund <= 0) throw new Error(`The fund is ${formatUSD(input.fund)}. It is the amount the box is meant to hold, so it is more than zero.`);
  if (input.countDate !== void 0 && input.countDate !== "" && !isIsoDate(input.countDate)) throw new Error(`"${input.countDate}" is not a valid date.`);
  if (clean(input.cashAccount) === "") throw new Error("Type the name of the account the replenishment is paid from.");
  if (clean(input.overShortAccount) === "") throw new Error("Type the name of the account for an overage or a shortage.");
  if (input.denominations.length === 0) throw new Error("There are no bills or coins to count.");
  input.denominations.forEach((d, i) => {
    const name = clean(d.label) || `line ${i + 1}`;
    if (d.kind !== "bill" && d.kind !== "coin") throw new Error(`${name} is neither a bill nor a coin.`);
    assertCents(d.value, `value of ${name}`);
    if (d.value <= 0) throw new Error(`${name} has a value of ${formatUSD(d.value)}; a bill or coin is worth more than zero.`);
    if (!Number.isSafeInteger(d.count) || d.count < 0) throw new Error(`The count of ${name} is ${d.count}. A count is a whole number, zero or more.`);
  });
  input.receipts.forEach((r, i) => {
    assertCents(r.amount, `receipt ${i + 1}`);
    if (r.amount < 0) throw new Error(`Receipt ${i + 1} has a negative amount (${formatUSD(r.amount)}). Receipts are typed as positive numbers.`);
    if (clean(r.account) === "") throw new Error(`Receipt ${i + 1} needs an expense account.`);
    if (r.date !== "" && !isIsoDate(r.date)) throw new Error(`The date "${r.date}" on receipt ${i + 1} is not valid.`);
  });
}
var SAFE = BigInt(Number.MAX_SAFE_INTEGER);
function shown(value, label) {
  if (value > SAFE || value < -SAFE) throw new Error(`The ${label} is too large to work out exactly.`);
  return Number(value);
}
function lineAmount(d) {
  return shown(BigInt(d.count) * BigInt(d.value), `amount of ${clean(d.label)}`);
}
function byAccount(receipts) {
  const map = /* @__PURE__ */ new Map();
  for (const r of receipts) {
    const key = accountKey(r.account);
    const entry = map.get(key);
    if (entry) entry.amounts.push(r.amount);
    else map.set(key, { account: clean(r.account), amounts: [r.amount] });
  }
  return [...map.values()].map((e) => ({ account: e.account, receipts: e.amounts.length, total: sum(e.amounts) }));
}
function journalLines(input, accounts, overShort, replenishment) {
  const out = accounts.filter((a) => a.total !== 0).map((a) => ({ account: a.account, role: "expense", debit: a.total, credit: 0 }));
  if (overShort < 0) out.push({ account: clean(input.overShortAccount), role: "over-short", debit: -overShort, credit: 0 });
  if (overShort > 0) out.push({ account: clean(input.overShortAccount), role: "over-short", debit: 0, credit: overShort });
  if (replenishment > 0) out.push({ account: clean(input.cashAccount), role: "cash", debit: 0, credit: replenishment });
  if (replenishment < 0) out.push({ account: clean(input.cashAccount), role: "cash", debit: -replenishment, credit: 0 });
  return out;
}
var FIGURE_KEYS = ["billsTotal", "coinsTotal", "cashCounted", "receiptsTotal", "accountedFor", "overShort", "replenishment", "debitsTotal", "creditsTotal"];
function bkVerifyPettyCash(input, r) {
  validate(input);
  for (const key of FIGURE_KEYS) assertCents(r[key], key);
  const checks = new CheckList();
  const usd2 = (v, label) => formatUSD(shown(v, label));
  let bills = 0n;
  let coins = 0n;
  for (let i = input.denominations.length - 1; i >= 0; i--) {
    const d = input.denominations[i];
    const amount = BigInt(d.value) * BigInt(d.count);
    if (d.kind === "bill") bills += amount;
    else coins += amount;
  }
  const cash = bills + coins;
  const badLine = r.lines.findIndex((l, i) => {
    const d = input.denominations[i];
    return !d || l.count !== d.count || l.value !== d.value || BigInt(l.amount) !== BigInt(d.value) * BigInt(d.count);
  });
  const linesOk = r.lines.length === input.denominations.length && badLine === -1;
  checks.that(
    "denomination-lines",
    "Each denomination line = count × value of one bill or coin",
    linesOk,
    linesOk ? void 0 : badLine === -1 ? `${r.lines.length} line(s) shown for ${input.denominations.length} denomination(s)` : `${clean(input.denominations[badLine]?.label ?? `line ${badLine + 1}`)}: shown ${formatUSD(r.lines[badLine].amount)}`
  );
  const shownLines = r.lines.reduce((t, l) => t + BigInt(l.amount), 0n);
  checks.that(
    "cash-count",
    "Cash counted = the sum of the denomination lines, bills and coins added again apart",
    BigInt(r.cashCounted) === cash && BigInt(r.cashCounted) === shownLines && BigInt(r.billsTotal) === bills && BigInt(r.coinsTotal) === coins,
    `second pass: bills ${usd2(bills, "bills total")}, coins ${usd2(coins, "coins total")}, cash ${usd2(cash, "cash counted")}; shown ${formatUSD(r.cashCounted)}`
  );
  let receipts = 0n;
  for (let i = input.receipts.length - 1; i >= 0; i--) receipts += BigInt(input.receipts[i].amount);
  const perAccount = /* @__PURE__ */ new Map();
  for (const rc of input.receipts) perAccount.set(accountKey(rc.account), (perAccount.get(accountKey(rc.account)) ?? 0n) + BigInt(rc.amount));
  const accountSum = r.accounts.reduce((t, a) => t + BigInt(a.total), 0n);
  const accountsOk = r.accounts.length === perAccount.size && r.accounts.every((a) => perAccount.get(accountKey(a.account)) === BigInt(a.total));
  checks.cents("receipts-total", "Receipts re-add to the receipts total shown", shown(receipts, "receipts total"), r.receiptsTotal);
  checks.that(
    "receipts-by-account",
    "The totals by expense account add up to the receipts total, and each equals its own receipts re-added",
    accountsOk && accountSum === receipts && accountSum === BigInt(r.receiptsTotal),
    `the account totals add to ${usd2(accountSum, "account totals")}; the receipts add to ${usd2(receipts, "receipts total")}; the total shown is ${formatUSD(r.receiptsTotal)}`
  );
  const fund = BigInt(input.fund);
  const overShort = cash + receipts - fund;
  checks.that(
    "fund-proof",
    "Cash counted + receipts − over (or + short) = the fund",
    BigInt(r.cashCounted) + BigInt(r.receiptsTotal) - BigInt(r.overShort) === fund && BigInt(r.overShort) === overShort && BigInt(r.accountedFor) === cash + receipts,
    `second pass: ${usd2(cash, "cash")} + ${usd2(receipts, "receipts")} = ${usd2(cash + receipts, "accounted for")}, ${overShort >= 0n ? "over" : "short"} ${usd2(overShort >= 0n ? overShort : -overShort, "over or short")} against a fund of ${formatUSD(input.fund)}`
  );
  checks.that(
    "replenishment",
    "Replenishment = fund − cash counted = receipts − over (or + short)",
    BigInt(r.replenishment) === fund - cash && BigInt(r.replenishment) === receipts - overShort,
    `second pass: ${usd2(fund - cash, "replenishment")}`
  );
  const expected = journalLines(
    input,
    [...perAccount.entries()].map(([key, total]) => ({ account: r.accounts.find((a) => accountKey(a.account) === key)?.account ?? key, receipts: 0, total: shown(total, "account total") })),
    shown(overShort, "over or short"),
    shown(fund - cash, "replenishment")
  );
  const debits = r.journal.reduce((t, l) => t + BigInt(l.debit), 0n);
  const credits = r.journal.reduce((t, l) => t + BigInt(l.credit), 0n);
  const sameLines = expected.length === r.journal.length && expected.every((e) => r.journal.some((l) => l.role === e.role && accountKey(l.account) === accountKey(e.account) && l.debit === e.debit && l.credit === e.credit));
  checks.that(
    "journal-balances",
    "The journal entry balances: debits = credits",
    debits === credits && BigInt(r.debitsTotal) === debits && BigInt(r.creditsTotal) === credits,
    `debits ${usd2(debits, "debits")}, credits ${usd2(credits, "credits")}`
  );
  checks.that("journal-lines", "Each journal line equals its account total, the over or short, or the replenishment, worked out a second time", sameLines, sameLines ? void 0 : "a journal line does not match the second calculation");
  checks.that(
    "over-short",
    "Cash counted + receipts = the fund exactly (no over or short)",
    overShort === 0n,
    overShort === 0n ? void 0 : `${overShort > 0n ? "over" : "short"} by ${usd2(overShort > 0n ? overShort : -overShort, "over or short")}`,
    "warning"
  );
  checks.that("cash-within-fund", "The cash counted is not more than the fund", cash <= fund, `the cash counted is ${usd2(cash - fund, "excess")} more than the fund`, "warning");
  const zero = input.receipts.findIndex((rc) => rc.amount === 0);
  checks.that("zero-receipts", "No receipt has an amount of zero", zero === -1, zero === -1 ? void 0 : `receipt ${zero + 1} has an amount of zero`, "warning");
  const named = /* @__PURE__ */ new Set([accountKey(input.cashAccount), accountKey(input.overShortAccount)]);
  const clash = input.receipts.findIndex((rc) => named.has(accountKey(rc.account)));
  checks.that(
    "account-names",
    "No receipt uses the cash account or the over-and-short account, and those two are different",
    clash === -1 && named.size === 2,
    named.size < 2 ? "the cash account and the over-and-short account have the same name" : `receipt ${clash + 1} uses the account "${clean(input.receipts[clash]?.account ?? "")}"`,
    "warning"
  );
  return checks.all;
}
function bkPettyCash(input) {
  validate(input);
  const lines = input.denominations.map((d) => ({ label: clean(d.label), kind: d.kind, value: d.value, count: d.count, amount: lineAmount(d) }));
  const billsTotal = sum(lines.filter((l) => l.kind === "bill").map((l) => l.amount));
  const coinsTotal = sum(lines.filter((l) => l.kind === "coin").map((l) => l.amount));
  const cashCounted = sum([billsTotal, coinsTotal]);
  const accounts = byAccount(input.receipts);
  const receiptsTotal = sum(accounts.map((a) => a.total));
  const accountedFor = sum([cashCounted, receiptsTotal]);
  const overShort = sum([accountedFor, 0 - input.fund]);
  const replenishment = sum([input.fund, 0 - cashCounted]);
  const journal = journalLines(input, accounts, overShort, replenishment);
  const figures = {
    lines,
    billsTotal,
    coinsTotal,
    cashCounted,
    accounts,
    receiptsTotal,
    accountedFor,
    overShort,
    replenishment,
    journal,
    debitsTotal: sum(journal.map((l) => l.debit)),
    creditsTotal: sum(journal.map((l) => l.credit))
  };
  return { ...figures, checks: bkVerifyPettyCash(input, figures) };
}
function bkOverShortLabel(overShort) {
  return overShort > 0 ? "Over" : overShort < 0 ? "Short" : "Over or short";
}
function bkPettyCashLines(input, r) {
  return [
    { key: "fund", label: "Petty cash fund", amount: input.fund },
    { key: "cashCounted", label: "Cash counted", amount: r.cashCounted },
    { key: "receiptsTotal", label: "Receipts", amount: r.receiptsTotal },
    { key: "accountedFor", label: "Cash plus receipts", amount: r.accountedFor },
    { key: "overShort", label: bkOverShortLabel(r.overShort), amount: r.overShort },
    { key: "replenishment", label: "Replenishment: fund − cash counted", amount: r.replenishment }
  ];
}
function bkPettyCashTables(input, r, name = "") {
  const blankZero = (c) => c === 0 ? "" : toDecimal(c);
  return {
    summary: [["Item", "Value"], ["Fund or business name", clean(name)], ["Count date", input.countDate ?? ""], ...bkPettyCashLines(input, r).map((l) => [l.label, toDecimal(l.amount)])],
    count: [["Denomination", "Bill or coin", "Count", "Value", "Amount"], ...r.lines.map((l) => [l.label, l.kind === "bill" ? "Bill" : "Coin", String(l.count), toDecimal(l.value), toDecimal(l.amount)]), ["Bills", "", "", "", toDecimal(r.billsTotal)], ["Coins", "", "", "", toDecimal(r.coinsTotal)], ["Cash counted", "", "", "", toDecimal(r.cashCounted)]],
    receipts: [["Date", "Description", "Account", "Amount"], ...input.receipts.map((rc) => [rc.date, clean(rc.description), clean(rc.account), toDecimal(rc.amount)]), ["", "", "Total", toDecimal(r.receiptsTotal)]],
    accounts: [["Account", "Receipts", "Amount"], ...r.accounts.map((a) => [a.account, String(a.receipts), toDecimal(a.total)]), ["Total", String(input.receipts.length), toDecimal(r.receiptsTotal)]],
    journal: [["Account", "Debit", "Credit"], ...r.journal.map((l) => [l.account, blankZero(l.debit), blankZero(l.credit)]), ["Total", toDecimal(r.debitsTotal), toDecimal(r.creditsTotal)]]
  };
}

// packages/core/src/bookkeeping/statementBuild.ts
function bkBuildStatement(input) {
  if (input.transactions.length === 0) throw new Error("No transactions were read. Check the header row and the column mapping.");
  if (input.openingBalance !== void 0) assertCents(input.openingBalance, "The opening balance");
  if (input.closingBalance !== void 0) assertCents(input.closingBalance, "The closing balance");
  for (const t of input.transactions) assertCents(t.amount, `The amount on row ${t.rowNumber}`);
  const kind = input.kind === "card" ? "card" : "bank";
  const problems = input.problems === void 0 ? [] : input.problems;
  const given = input.transactions;
  const firstDate = given[0].date;
  const lastDate = given[given.length - 1].date;
  const newestFirst = isIsoDate(firstDate) && isIsoDate(lastDate) && firstDate > lastDate;
  const reversed = input.order === "reverse" || (input.order === void 0 || input.order === "auto") && newestFirst;
  const ordered = reversed ? [...given].reverse() : [...given];
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  let openingBalance;
  let openingSource;
  if (input.openingBalance !== void 0) {
    openingBalance = input.openingBalance;
    openingSource = "typed";
  } else {
    if (first.balance === void 0) throw new Error("Enter the opening balance. The file has no running balance on the first transaction to work it out from.");
    openingBalance = first.balance - first.amount;
    openingSource = "balance-column";
  }
  let closingBalance;
  let closingSource;
  if (input.closingBalance !== void 0) {
    closingBalance = input.closingBalance;
    closingSource = "typed";
  } else {
    if (last.balance === void 0) throw new Error("Enter the closing balance. The file has no running balance on the last transaction to take it from.");
    closingBalance = last.balance;
    closingSource = "balance-column";
  }
  const statement = {
    openingBalance,
    closingBalance,
    transactions: ordered.map((t) => t.balance === void 0 ? { date: t.date, description: t.description, amount: t.amount } : { date: t.date, description: t.description, amount: t.amount, balance: t.balance })
  };
  if (input.periodStart !== void 0) statement.periodStart = input.periodStart;
  if (input.periodEnd !== void 0) statement.periodEnd = input.periodEnd;
  if (kind === "bank" && input.summary !== void 0) statement.summary = input.summary;
  const amounts = statement.transactions.map((t) => t.amount);
  const moneyIn = sum(amounts.filter((a) => a > 0));
  const paidOut = sum(amounts.filter((a) => a < 0));
  const moneyOut = paidOut === 0 ? 0 : -paidOut;
  const totals = { count: amounts.length, moneyIn, moneyOut, net: moneyIn - moneyOut };
  const table = statementRows(statement);
  const checks = new CheckList();
  const firstProblem = problems[0];
  checks.that(
    "rows-read",
    "Every row with data in the file was read",
    problems.length === 0,
    firstProblem === void 0 ? void 0 : `${problems.length} row(s) could not be read and are not in the result; first: row ${firstProblem.rowNumber}: ${firstProblem.reason}`
  );
  if (kind === "bank") checks.addAll(verifyBankStatement(statement));
  else {
    const card = { previousBalance: openingBalance, newBalance: closingBalance, transactions: statement.transactions };
    const typed = input.cardSummary;
    if (typed === void 0) checks.addAll(verifyCardStatement(card));
    else {
      const summary = {};
      if (typed.paymentsAndCredits !== void 0) summary.payments = typed.paymentsAndCredits;
      if (typed.charges !== void 0) summary.purchases = typed.charges;
      checks.addAll(verifyCardStatement({ ...card, summary }));
    }
    checks.addAll(verifyBankStatement(statement).filter((c) => c.id !== "balance"));
  }
  let inBig = 0n;
  let outBig = 0n;
  for (const a of amounts) {
    if (a > 0) inBig += BigInt(a);
    else outBig += BigInt(-a);
  }
  checks.cents("second-pass", "Money in − money out = closing − opening balance, added a second way", closingBalance - openingBalance, Number(inBig - outBig));
  checks.cents("export-total", "The export table, read back, has the same total as the transactions", sum(amounts), sumCsvColumn(toCsv(table), "Amount"));
  checks.cents("export-closing", "The last balance in the export table = closing balance", closingBalance, parseAmount(String(table[table.length - 1][3])));
  let outOfOrder = 0;
  let before = "";
  for (const t of statement.transactions) {
    if (!isIsoDate(t.date)) continue;
    if (before !== "" && t.date < before) outOfOrder += 1;
    before = t.date;
  }
  checks.that("date-order", "Transactions are in date order", outOfOrder === 0, `${outOfOrder} transaction(s) are dated earlier than the one before`, "warning");
  const stated = input.balanceLines ?? [];
  if (stated.length > 0) {
    const wrong = stated.filter((b) => b.balance !== (b.side === "opening" ? openingBalance : closingBalance));
    const first2 = wrong[0];
    checks.that(
      "balance-lines",
      "The file's own beginning and ending balance lines agree with its transactions",
      wrong.length === 0,
      first2 === void 0 ? void 0 : `${wrong.length} balance line(s) disagree; first: row ${first2.rowNumber} says ${formatUSD(first2.balance)}, the transactions give ${formatUSD(first2.side === "opening" ? openingBalance : closingBalance)}`
    );
  }
  return { kind, statement, openingSource, closingSource, reversed, totals, table, checks: checks.all };
}

// packages/core/src/bookkeeping/statementRead.ts
var BALANCE_LINE = /^(beginning|opening|starting|ending|closing) balance\b/i;
function bkReadStatementRows(rows, mapping, kind = "bank") {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const col = mapping.columns;
  const headers = bkHeaderList(rows, mapping.headerRow);
  if (col.date < 0) throw new Error(`No "Date" column could be identified (${headers}). Choose it in the column mapping.`);
  const single = col.amount >= 0;
  const split = col.debit >= 0 || col.credit >= 0;
  if (!single && !split) throw new Error(`No amount column could be identified (${headers}). Choose one amount column, or the money out and money in columns, in the column mapping.`);
  if (single && split) throw new Error("Choose either one amount column or the money out and money in columns, not both.");
  const used = BK_STATEMENT_ROLES.map((role) => col[role]).filter((index) => index >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
  const out = { transactions: [], problems: [], ignoredRows: 0 };
  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell2) => cell2.trim() === "")) continue;
    const cell = (index) => index < 0 ? "" : (row[index] ?? "").trim();
    const reasons = [];
    const unread = [];
    const money = (text, what) => {
      try {
        return bkMoneyCell(text, kind);
      } catch {
        unread.push(`the ${what} "${text}" could not be read`);
        return void 0;
      }
    };
    const dateText = cell(col.date);
    const amountCell2 = money(cell(col.amount), "amount");
    const debitCell = money(cell(col.debit), "money out amount");
    const creditCell = money(cell(col.credit), "money in amount");
    const noAmount = amountCell2 === void 0 && debitCell === void 0 && creditCell === void 0 && unread.length === 0;
    if (dateText === "" && noAmount) {
      out.ignoredRows += 1;
      continue;
    }
    const balanceWords = noAmount && cell(col.balance) !== "" ? BALANCE_LINE.exec(cell(col.description)) : null;
    if (balanceWords) {
      let stated;
      try {
        stated = bkMoneyCell(cell(col.balance), kind);
      } catch {
        stated = void 0;
      }
      if (stated !== void 0) {
        out.ignoredRows += 1;
        const side = /^(ending|closing)/i.test(balanceWords[1] ?? "") ? "closing" : "opening";
        (out.balanceLines ??= []).push({ rowNumber: i + 1, side, balance: stated });
        continue;
      }
    }
    const balanceCell = money(cell(col.balance), "balance");
    let date = "";
    if (dateText === "") reasons.push("no date");
    else {
      try {
        date = bkCellToIsoDate(dateText, mapping.dateOrder);
      } catch {
        reasons.push(`the date "${dateText}" could not be read`);
      }
    }
    if (noAmount) reasons.push("no amount");
    reasons.push(...unread);
    const debit = debitCell === void 0 ? 0 : debitCell < 0 ? -debitCell : debitCell;
    const credit = creditCell === void 0 ? 0 : creditCell < 0 ? -creditCell : creditCell;
    if (debit !== 0 && credit !== 0) reasons.push("both a money out and a money in amount on one row");
    if (reasons.length > 0) {
      out.problems.push({ rowNumber: i + 1, reason: reasons.join("; ") });
      continue;
    }
    let amount;
    if (single) {
      const written = amountCell2 === void 0 ? 0 : amountCell2;
      const marked = /(CR|DR)$/i.test(cell(col.amount));
      amount = mapping.flipSigns && !marked && written !== 0 ? -written : written;
    } else amount = kind === "card" ? debit - credit : credit - debit;
    const txn = { rowNumber: i + 1, date, description: cell(col.description), amount };
    if (balanceCell !== void 0) txn.balance = balanceCell;
    out.transactions.push(txn);
  }
  return out;
}

// packages/agents/src/registry/bookkeeping.ts
var plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function headerText(file, headerRow) {
  return (file.rows[headerRow] ?? []).filter((h) => h.trim() !== "").join(", ") || "(none found)";
}
function fileBase(name, fallback) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return base || fallback;
}
function wholeNumber(raw, name, what, fallback) {
  if (raw === void 0) return fallback;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new AgentInputError(`"${name}" (${what}) must be a whole number, such as ${fallback}.`);
  return Number(text);
}
function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function assertDistinct(file, c, mapping, label, inputName) {
  const header = file.rows[mapping.headerRow] ?? [];
  for (let i = 0; i < c.roles.length; i++) {
    for (let j = i + 1; j < c.roles.length; j++) {
      const a = c.roles[i];
      const b = c.roles[j];
      const col = mapping.columns[a];
      if (col < 0 || col !== mapping.columns[b]) continue;
      throw new AgentInputError(
        `In the ${label.toLowerCase()} (${file.name}), "${(header[col] ?? "").trim() || `column ${col + 1}`}" is named for both ${c.labels[a]} and ${c.labels[b]}. Each column is used once: name another header for one of them in "${inputName}", or leave one out with "<column> = none".`
      );
    }
  }
}
var SAME_PART = Object.fromEntries(BK_STATEMENT_ROLES.map((r) => [r, r]));
var bankFile = (guess) => ({ columns: { roles: BK_STATEMENT_ROLES, labels: BK_ROLE_LABELS, required: ["date"], guess }, toStatement: SAME_PART });
var BANK_FILE = bankFile((rows, at) => bkGuessStatementColumns(rows, at));
var STATEMENT_ROWS_FILE = bankFile((rows, at) => bkRecDiffGuessColumns("statement", rows, at));
var LEDGER_ROLES = ["date", "description", "amount", "moneyOut", "moneyIn", "balance"];
var LEDGER_PART = { date: "date", description: "description", amount: "amount", moneyOut: "debit", moneyIn: "credit", balance: "balance" };
var BOOK_ROWS_FILE = {
  columns: {
    roles: LEDGER_ROLES,
    labels: Object.fromEntries(LEDGER_ROLES.map((r) => [r, BK_REC_DIFF_BOOK_LABELS[LEDGER_PART[r]]])),
    required: ["date"],
    guess: (rows, at) => {
      const g = bkRecDiffGuessColumns("book", rows, at);
      return { headerRow: g.headerRow, columns: Object.fromEntries(LEDGER_ROLES.map((r) => [r, g.columns[LEDGER_PART[r]]])) };
    }
  },
  toStatement: LEDGER_PART
};
var shortLabel = (label) => label.replace(/\s*\([^)]*\)/g, "").trim();
function rowColumnsInput(fileLabel, kind, name = "columns", ledger = false) {
  const base = columnsInput(fileLabel, kind.columns, name);
  return {
    ...base,
    description: `${base.description} Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none".${ledger ? ' In a ledger export of the cash account a column headed Debit is money in and one headed Credit is money out: "Money in = Debit, Money out = Credit".' : ""}`
  };
}
var dateOrderInput = (name = "dateOrder", what = "a date") => ({
  name,
  kind: "choice",
  label: "Date order",
  description: `Optional. How ${what} written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.`,
  required: false,
  choices: ["month first", "day first"]
});
var DATE_ORDER_INPUT = dateOrderInput();
var flipSignsInput = (name = "flipSigns", what = "the single amount column") => ({
  name,
  kind: "boolean",
  label: "Money out written as positive",
  description: `Optional. true when ${what} shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.`,
  required: false
});
var FLIP_SIGNS_INPUT = flipSignsInput();
var dateOrderOf = (value) => value === "day first" ? "dmy" : "mdy";
function rowFileMapping(file, kind, override, label, inputName, dateOrder, flipSigns) {
  const c = kind.columns;
  const m = mapColumns(file, c, override, label);
  assertDistinct(file, c, m, label, inputName);
  const columns = Object.fromEntries(BK_STATEMENT_ROLES.map((r) => [r, -1]));
  for (const r of c.roles) columns[kind.toStatement[r]] = m.columns[r];
  const name = (part) => shortLabel(c.labels[c.roles.find((r) => kind.toStatement[r] === part)]);
  const header = file.rows[m.headerRow] ?? [];
  const at = (part) => `"${(header[columns[part]] ?? "").trim()}"`;
  if (columns.amount >= 0 && (columns.debit >= 0 || columns.credit >= 0)) {
    throw new AgentInputError(
      `The ${label.toLowerCase()} (${file.name}) is read with both one signed amount column (${at("amount")}) and a money out or money in column (${[columns.debit >= 0 ? at("debit") : "", columns.credit >= 0 ? at("credit") : ""].filter(Boolean).join(", ")}). Use one or the other: add "${name("debit")} = none, ${name("credit")} = none" to "${inputName}" to read the signed column, or "${name("amount")} = none" to read the two columns.`
    );
  }
  if (columns.amount < 0 && columns.debit < 0 && columns.credit < 0) {
    throw new AgentInputError(
      `The ${label.toLowerCase()} (${file.name}) has no amount column that could be identified. Its headers are: ${headerText(file, m.headerRow)}. Name one signed amount column with "${inputName}", for example "${name("amount")} = <header>", or the two columns, "${name("debit")} = <header>, ${name("credit")} = <header>".`
    );
  }
  return { headerRow: m.headerRow, columns, dateOrder, flipSigns };
}
var STATEMENT_FILE_DESCRIPTION = "A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.";
var TOTAL_WORD2 = /^(grand |sub ?)?totals?:?$/i;
function listAmount(raw, fail) {
  try {
    return bkMoneyCell(raw) ?? 0;
  } catch {
    fail(`the amount "${raw}" could not be read`);
    return 0;
  }
}
function listDate(raw, order, fail) {
  if (raw === "") return "";
  try {
    return bkCellToIsoDate(raw, order);
  } catch {
    fail(`the date "${raw}" could not be read`);
    return "";
  }
}
function readList2(file, mapping, spec, make) {
  const out = { items: [], problems: [], leftOut: [], checks: [] };
  const header = file.rows[mapping.headerRow] ?? [];
  const quiet = /* @__PURE__ */ new Set([header.findIndex((h) => sheetNormalizeHeader(h) === "line"), spec.prefilled !== void 0 ? mapping.columns[spec.prefilled] : -1]);
  const say = (reason) => spec.prefix ? `${spec.what}: ${reason}` : reason;
  const totals = new CheckList();
  let lines = 0;
  for (const { rowNumber, cells } of sheetDataRows(file.rows, mapping.headerRow)) {
    if (cells.every((c, i) => c.trim() === "" || quiet.has(i))) continue;
    const cell = (role) => sheetCell(cells, mapping.columns[role]);
    if ((spec.date === void 0 || cell(spec.date) === "") && cells.some((c) => TOTAL_WORD2.test(c.trim()))) {
      let stated;
      try {
        stated = bkMoneyCell(cell(spec.amount));
      } catch {
        out.problems.push({ rowNumber, reason: say(`a total line whose amount "${cell(spec.amount)}" could not be read`) });
        continue;
      }
      out.leftOut.push({ rowNumber, reason: say("the file’s own total line") });
      if (stated !== void 0) {
        lines += 1;
        totals.cents(`${spec.id}-total-line${lines > 1 ? `-${lines}` : ""}`, `The ${spec.what} file’s own total line (row ${rowNumber}) = the rows above it`, sum(out.items.map((i) => i.amount)), stated);
      }
      continue;
    }
    const reasons = [];
    const item = make(cell, (reason) => void reasons.push(reason));
    if (reasons.length > 0) out.problems.push({ rowNumber, reason: say(reasons.join("; ")) });
    else out.items.push(item);
  }
  out.checks = totals.all;
  return out;
}
function listMapping(file, label, roles, synonyms, required, headers) {
  const m = sheetGuessColumns(file.rows, roles, synonyms);
  const missing = required.filter((r) => m.columns[r] < 0);
  if (missing.length > 0) throw new AgentInputError(`The ${label} (${file.name}) has no ${missing.join(" or ")} column. Its headers are: ${headerText(file, m.headerRow)}. Its header row needs these columns: ${headers}.`);
  return m;
}
var CHECK_SYNONYMS = {
  amount: ["amount", "check amount"],
  date: ["date", "check date"],
  number: ["check number", "check no", "check num", "check", "number", "reference", "ref"],
  payee: ["payee", "paid to", "pay to", "description", "memo", "name", "note"]
};
var DEPOSIT_SYNONYMS = {
  amount: ["amount", "deposit amount"],
  date: ["date", "deposit date"],
  description: ["description", "memo", "note", "details", "reference", "source"]
};
var ADJUSTMENT_SYNONYMS = {
  amount: ["amount"],
  side: ["side", "bank or book"],
  direction: ["add or subtract", "add subtract", "direction", "plus or minus"],
  description: ["description", "memo", "note", "details", "reason"]
};
var SIDES2 = /* @__PURE__ */ new Map([["bank", "bank"], ["book", "book"], ["books", "book"]]);
var DIRECTIONS2 = /* @__PURE__ */ new Map([["add", "add"], ["plus", "add"], ["+", "add"], ["subtract", "subtract"], ["less", "subtract"], ["minus", "subtract"], ["-", "subtract"], ["−", "subtract"]]);
var WORKBOOK_INPUT = {
  name: "workbook",
  kind: "file",
  label: "Filled-in bank reconciliation workbook",
  description: "Optional, in place of the balances and lists below: an .xlsx workbook made with the bank reconciliation template on mathproven.com (or downloaded from its bank reconciliation statement page) with its Reconciliation, Outstanding checks, Deposits in transit and Adjustments sheets filled in. Totals written by hand on its Reconciliation sheet are compared with the calculated ones.",
  required: false
};
function reconciliationInputs(withAccount) {
  return [
    WORKBOOK_INPUT,
    { name: "statementBalance", kind: "amount", label: "Statement ending balance", description: "The last balance on the bank statement. Needed unless the workbook is given.", required: false },
    { name: "bookBalance", kind: "amount", label: "Book balance", description: "The balance of the cash account in the ledger on the same date. Needed unless the workbook is given.", required: false },
    {
      name: "statementDate",
      kind: "date",
      label: "Statement date",
      description: withAccount ? "Optional. The date the two balances are as of." : `Optional. The date the two balances are as of; outstanding items dated more than ${BK_REC_DIFF_OLD_DAYS} days before it are listed.`,
      required: false
    },
    ...withAccount ? [{ name: "account", kind: "text", label: "Account or business name", description: "Optional. Printed at the top of the statement.", required: false }] : [],
    {
      name: "outstandingChecks",
      kind: "file",
      label: "Outstanding checks",
      description: "Optional. Checks recorded in the books that are not on the bank statement yet: a .csv or .xlsx file (a path, or the CSV text) with a header row and an Amount column; Check number, Date and Payee are read when present. Amounts are positive numbers; a blank amount is zero. A row reading Total with no date is the file’s own total line, checked against the rows above it.",
      required: false
    },
    {
      name: "depositsInTransit",
      kind: "file",
      label: "Deposits in transit",
      description: "Optional. Deposits recorded in the books that are not on the bank statement yet: a file or CSV text with a header row and an Amount column; Date and Description are read when present. Amounts are positive numbers.",
      required: false
    },
    {
      name: "adjustments",
      kind: "file",
      label: "Bank corrections and book adjustments",
      description: "Optional. One row per item that moves one of the two balances, with the columns Side, Add or subtract, Amount, and Description when wanted. Side is Bank for a correction to the bank side (a deposit the bank entered at the wrong amount), Book for an item the bank has and the books do not yet (interest with Add; a bank fee or a returned item with Subtract) or a correction to the books. Amounts are positive numbers; Add or Subtract says which way a row goes.",
      required: false
    }
  ];
}
var TYPED_REC = ["statementBalance", "bookBalance", "statementDate", "account"];
var LIST_FILES = ["outstandingChecks", "depositsInTransit", "adjustments"];
function readTypedLists(files, order) {
  const lists = { problems: [], leftOut: [], checks: [] };
  const take = (read) => {
    lists.problems.push(...read.problems);
    lists.leftOut.push(...read.leftOut);
    lists.checks.push(...read.checks);
    return read.items;
  };
  const checksFile = files.outstandingChecks?.[0];
  const outstandingChecks = checksFile ? take(
    readList2(checksFile, listMapping(checksFile, "outstanding checks", ["amount", "date", "number", "payee"], CHECK_SYNONYMS, ["amount"], "Check number, Date, Payee, Amount"), { what: "outstanding checks", id: "outstanding-checks", prefix: true, amount: "amount", date: "date" }, (cell, fail) => ({
      number: cell("number"),
      date: listDate(cell("date"), order, fail),
      payee: cell("payee"),
      amount: listAmount(cell("amount"), fail)
    }))
  ) : [];
  const depositsFile = files.depositsInTransit?.[0];
  const depositsInTransit = depositsFile ? take(
    readList2(depositsFile, listMapping(depositsFile, "deposits in transit", ["amount", "date", "description"], DEPOSIT_SYNONYMS, ["amount"], "Date, Description, Amount"), { what: "deposits in transit", id: "deposits-in-transit", prefix: true, amount: "amount", date: "date" }, (cell, fail) => ({
      date: listDate(cell("date"), order, fail),
      description: cell("description"),
      amount: listAmount(cell("amount"), fail)
    }))
  ) : [];
  const adjustmentsFile = files.adjustments?.[0];
  const sided = adjustmentsFile ? take(
    readList2(
      adjustmentsFile,
      listMapping(adjustmentsFile, "adjustments", ["amount", "side", "direction", "description"], ADJUSTMENT_SYNONYMS, ["amount", "side", "direction"], "Side, Add or subtract, Description, Amount"),
      { what: "adjustments", id: "adjustments", prefix: true, amount: "amount", prefilled: "side" },
      (cell, fail) => {
        const side = SIDES2.get(cell("side").toLowerCase());
        if (cell("side") === "") fail("no side (Bank or Book)");
        else if (!side) fail(`the side "${cell("side")}" is not Bank or Book`);
        const direction = DIRECTIONS2.get(cell("direction").toLowerCase());
        if (cell("direction") === "") fail("no Add or Subtract");
        else if (!direction) fail(`"${cell("direction")}" is not Add or Subtract`);
        const adjustment = { description: cell("description"), direction: direction ?? "add", amount: listAmount(cell("amount"), fail) };
        return { side: side ?? "bank", adjustment, amount: adjustment.amount };
      }
    )
  ) : [];
  return {
    outstandingChecks,
    depositsInTransit,
    bankCorrections: sided.filter((s) => s.side === "bank").map((s) => s.adjustment),
    bookAdjustments: sided.filter((s) => s.side === "book").map((s) => s.adjustment),
    ...lists
  };
}
function readReconciliation({ files, values }) {
  const workbook = files.workbook?.[0];
  if (workbook) {
    const extra = [...TYPED_REC.filter((n) => values[n] !== void 0), ...LIST_FILES.filter((n) => (files[n]?.length ?? 0) > 0)];
    if (extra.length > 0) throw new AgentInputError(`Give either the filled-in workbook or the typed balances and lists, not both: ${extra.map((n) => `"${n}"`).join(", ")} came with the workbook.`);
    const read = bkReadBankRecWorkbook(workbook.sheets);
    return { input: read.input, account: read.account, workbook: read, lists: { problems: [], leftOut: [], checks: [] } };
  }
  const statementBalance = values.statementBalance;
  const bookBalance = values.bookBalance;
  if (statementBalance === void 0 || bookBalance === void 0) {
    throw new AgentInputError('Give the statement ending balance and the book balance ("statementBalance" and "bookBalance"), with the lists that explain the gap, or the filled-in bank reconciliation workbook ("workbook").');
  }
  const { problems, leftOut, checks, ...lists } = readTypedLists(files, dateOrderOf(values.dateOrder));
  const account = (values.account ?? "").trim().replace(/\s+/g, " ");
  return { input: { statementDate: values.statementDate ?? "", statementBalance, bookBalance, ...lists }, account, workbook: null, lists: { problems, leftOut, checks } };
}
function recSourceChecks(src, figures) {
  if (src.workbook) {
    const out = bkBankRecWorkbookChecks(src.workbook, figures);
    const n = src.workbook.totalRows;
    if (n > 0) out.push({ id: "workbook-total-rows", label: "No row on the list sheets was left out as a total", passed: false, severity: "warning", detail: `${plural(n, "row labelled as a total was", "rows labelled as a total were")} left out of the lists` });
    return out;
  }
  return [...sheetRowChecks(src.lists.problems, src.lists.leftOut), ...src.lists.checks];
}
function listCounts(src) {
  const i = src.input;
  const totals = src.workbook ? src.workbook.totalRows : src.lists.leftOut.length;
  return `${plural(i.outstandingChecks.length, "outstanding check", "outstanding checks")}, ${plural(i.depositsInTransit.length, "deposit in transit", "deposits in transit")}, ${plural(i.bankCorrections.length, "bank correction", "bank corrections")} and ${plural(i.bookAdjustments.length, "book adjustment", "book adjustments")}${totals ? `; ${plural(totals, "row labelled as a total was", "rows labelled as a total were")} left out` : ""}`;
}
var WRITTEN_CHECKS = ["depositsTotal", "checksTotal", "bankAdded", "bankSubtracted", "adjustedBank", "bookAdded", "bookSubtracted", "adjustedBook", "difference"].map((k) => `written-${k}`);
var bankReconciliation = {
  name: "bank_reconciliation_statement",
  page: "bookkeeping/bank-reconciliation",
  section: "bookkeeping",
  kind: "tool",
  title: "Bank reconciliation statement: adjusted bank and book balances",
  description: "Works out a bank reconciliation for one date: the adjusted bank balance (statement ending balance plus deposits in transit, less outstanding checks, plus or minus bank corrections) and the adjusted book balance (book balance plus or minus book adjustments such as interest, bank fees and returned items), compared to the cent with the difference shown. Every list is added again last row first and both balances are rebuilt row by row; a check number listed twice and a zero amount are warnings. It takes the two balances with the lists as small tables, or a filled-in bank reconciliation workbook, whose hand-written totals are compared with the calculated ones. Use it when someone asks to reconcile a bank account, prepare a bank reconciliation statement, or check that the adjusted balances agree. Not for reading a PDF bank statement, and not a statement that the books are correct.",
  question: "Can you do our bank reconciliation for March 31? The statement shows $12,480.35 and our books show $12,201.15; here are the outstanding checks and deposits.",
  inputs: [...reconciliationInputs(true), dateOrderInput("dateOrder", "a date in the lists")],
  limits: "site",
  // The two adjusted balances agreeing compares the typed balances; so do the totals written by hand on a workbook.
  comparisonChecks: ["balances-agree", ...WRITTEN_CHECKS],
  notAdvice: "Mathproven adds, subtracts and compares the figures given: reconciled means the two adjusted balances agree to the cent, not that the books are correct, and it is not accounting advice.",
  run(args) {
    const read = readReconciliation(args);
    const r = bkBankRec(read.input);
    const t = bkBankRecTables(read.input, r, read.account);
    return {
      summary: `${r.reconciled ? `Reconciled: the adjusted bank balance and the adjusted book balance are both ${formatUSD(r.adjustedBankBalance)}.` : `Not reconciled: the adjusted bank balance is ${formatUSD(r.adjustedBankBalance)} and the adjusted book balance ${formatUSD(r.adjustedBookBalance)}; adjusted bank − adjusted book is ${formatUSD(r.difference)}.`} Statement ending balance ${formatUSD(read.input.statementBalance)}, plus deposits in transit ${formatUSD(r.depositsInTransitTotal)}, less outstanding checks ${formatUSD(r.outstandingChecksTotal)}, plus bank corrections added ${formatUSD(r.bankCorrectionsAdded)}, less bank corrections subtracted ${formatUSD(r.bankCorrectionsSubtracted)}; book balance ${formatUSD(read.input.bookBalance)}, plus book adjustments added ${formatUSD(r.bookAdjustmentsAdded)}, less book adjustments subtracted ${formatUSD(r.bookAdjustmentsSubtracted)}. Read ${listCounts(read)}.`,
      tables: [
        { name: "Reconciliation", rows: t.reconciliation },
        { name: "Outstanding checks", rows: t.outstandingChecks },
        { name: "Deposits in transit", rows: t.depositsInTransit },
        { name: "Adjustments", rows: t.adjustments }
      ],
      checks: [...recSourceChecks(read, r), ...r.checks]
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Supply Co., March 31, 2026, three outstanding checks, two deposits in transit, one bank correction, four book adjustments",
      args: {
        statementBalance: "12,480.35",
        bookBalance: "12,201.15",
        statementDate: "2026-03-31",
        account: "Example Supply Co.",
        outstandingChecks: "agents-fixture:bookkeeping/bank-rec-outstanding-checks.csv",
        depositsInTransit: "agents-fixture:bookkeeping/bank-rec-deposits-in-transit.csv",
        adjustments: "agents-fixture:bookkeeping/bank-rec-adjustments.csv"
      },
      verified: true,
      contains: ["both $12,171.90", "$1,890.50", "$2,207.95", "$9.00", "$30.75", "$60.00", "| Difference: adjusted bank − adjusted book | 0.00 |"]
    },
    {
      label: "The same reconciliation from the filled-in template workbook, with the adjusted balances written in by hand",
      args: { workbook: "agents-fixture:bookkeeping/bank-reconciliation-filled.xlsx" },
      verified: true,
      contains: ["both $12,171.90", "| Adjusted book balance | 12171.90 |"]
    },
    {
      label: "The page's what-if: the $15.00 service fee left off the book adjustments, so the statement does not reconcile",
      args: {
        statementBalance: "12480.35",
        bookBalance: "12201.15",
        outstandingChecks: "Check number,Amount\n2041,315.20\n2044,1800.00\n2046,92.75",
        depositsInTransit: "Amount\n640.50\n1250.00",
        adjustments: "Side,Add or subtract,Description,Amount\nBank,Add,Deposit entered by the bank as 245.00,9.00\nBook,Add,Interest earned,3.75\nBook,Add,Check 2038 entered as 152.00,27.00\nBook,Subtract,Returned customer check,45.00"
      },
      verified: false,
      failedCheck: "balances-agree"
    },
    {
      label: "An outstanding check whose amount cannot be read is not verified",
      args: { statementBalance: "1000.00", bookBalance: "900.00", outstandingChecks: "Check number,Amount\n101,100.00\n102,1OO.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var TEMPLATE_COUNTS = [
  ["checkRows", "Outstanding check rows", 15],
  ["depositRows", "Deposit in transit rows", 5],
  ["bankCorrectionRows", "Bank correction rows", 3],
  ["bookAdjustmentRows", "Book adjustment rows", 6]
];
var bankReconciliationTemplate = {
  name: "bank_reconciliation_template",
  page: "bookkeeping/bank-reconciliation-template",
  section: "bookkeeping",
  kind: "template",
  title: "Blank bank reconciliation workbook (Excel) to fill in",
  description: "Builds a blank Excel workbook laid out for a bank reconciliation: a Reconciliation sheet with every line of the bank side and the book side, sheets for outstanding checks, deposits in transit and adjustments (rows arrive marked Bank or Book), and an Instructions sheet, with as many rows as asked for (1 to 200 on each list). The finished file is read back and checked before it is saved: five sheet names, header rows and row counts, the lines in order, the name and date as typed, every amount blank, rows numbered, and no formulas. Values only; nothing in it calculates. Use it when someone wants a bank reconciliation template, form or worksheet to fill in by hand. Not for working out a reconciliation from figures, and not a workbook with formulas.",
  question: "Can you make me a blank bank reconciliation template in Excel for Example Supply Co., March 31?",
  inputs: [
    { name: "account", kind: "text", label: "Account or business name", description: "Optional. Written on the Reconciliation sheet; it goes only into the workbook.", required: false },
    { name: "statementDate", kind: "date", label: "Statement date", description: "Optional. Written on the Reconciliation sheet.", required: false },
    ...TEMPLATE_COUNTS.map(([name, label, fallback]) => ({ name, kind: "number", label, description: `Optional. How many rows, a whole number from 1 to 200. Default ${fallback}.`, required: false }))
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in: it holds values only and no formulas, so it does not calculate, and it says nothing about what any line should hold.",
  run({ values }) {
    const [checkRows, depositRows, bankCorrectionRows, bookAdjustmentRows] = TEMPLATE_COUNTS.map(([name, label, fallback]) => wholeNumber(values[name], name, label, fallback));
    const options = {
      account: values.account ?? "",
      statementDate: values.statementDate ?? "",
      checkRows,
      depositRows,
      bankCorrectionRows,
      bookAdjustmentRows,
      // The Instructions sheet names the page that opens the filled-in workbook, as the page writes it.
      toolUrl: `${SITE_URL}/bookkeeping/bank-reconciliation/?src=template`
    };
    const sheets = bkBankRecTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = bkVerifyBankRecTemplate(options, bytes);
    const slug = options.account.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const layout = [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), s.rows.length - 1])];
    return {
      summary: `A bank reconciliation workbook to fill in, ${plural(sheets.length, "sheet", "sheets")}: ${checkRows} outstanding check rows, ${depositRows} deposit in transit rows, and an Adjustments sheet of ${bankCorrectionRows} rows marked Bank and ${bookAdjustmentRows} marked Book${options.account.trim() ? `, for ${options.account.trim()}` : ""}${options.statementDate ? ` as of ${options.statementDate}` : ""}. Read back from the file before saving.`,
      tables: [{ name: "Sheets", rows: layout }],
      checks,
      file: { suggestedName: `${["bank-reconciliation-template", slug].filter(Boolean).join("-")}.xlsx`, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Supply Co., 2026-03-31, 10 check rows, 5 deposit rows, 3 bank correction rows, 5 book adjustment rows",
      args: { account: "Example Supply Co.", statementDate: "2026-03-31", checkRows: "10", depositRows: "5", bankCorrectionRows: "3", bookAdjustmentRows: "5" },
      verified: true,
      contains: ["| Reconciliation | Item, Value | 13 |", "| Outstanding checks | Line, Check number, Date, Payee, Amount | 10 |", "| Deposits in transit | Line, Date, Description, Amount | 5 |", "| Adjustments | Line, Side, Add or subtract, Description, Amount | 8 |", "| Instructions | How this workbook is laid out | 10 |", "23 checks run"]
    }
  ]
};
var duplicateTransactions = {
  name: "duplicate_transactions_finder",
  page: "bookkeeping/duplicate-transactions",
  section: "bookkeeping",
  kind: "tool",
  title: "Duplicate transactions in a bank, card or ledger export",
  description: `Lists the transactions in one bank or card export, or rows from a ledger, that repeat: exact repeats (same date, same amount with the same sign, same description once capitals and spacing are ignored) and, when a number of days is given, near repeats (same amount and description, each within that many days of the row before). Every row lands in exactly one list, the lists add up to the file's row count and dollar total, a separate routine rebuilds the groups and checks they are complete, and a row that cannot be read fails the result. Nothing is removed. Use it when someone asks to find duplicate charges, double-posted transactions or repeated entries in a statement or ledger export. Not for saying which repeats are mistakes (two identical payments on one day can both be real), and not for PDF statements.`,
  question: "Are there any duplicate transactions in this bank export? Look for repeats within 3 days too.",
  inputs: [
    { name: "transactions", kind: "file", label: "Transaction rows", description: STATEMENT_FILE_DESCRIPTION, required: true },
    { name: "nearDays", kind: "number", label: "Days for near repeats", description: `Optional. A whole number of days from 0 to ${BK_DUP_MAX_DAYS}: rows with the same amount and description this many calendar days apart or fewer are near repeats. Blank or 0 looks for exact repeats only.`, required: false },
    rowColumnsInput("Transaction rows", BANK_FILE),
    DATE_ORDER_INPUT,
    FLIP_SIGNS_INPUT
  ],
  limits: "site",
  notAdvice: "Mathproven compares rows and counts them; it does not say which rows are mistakes, and nothing is removed from the file.",
  run({ files, values }) {
    const file = oneFile(files, "transactions");
    const mapping = rowFileMapping(file, BANK_FILE, values.columns, "Transaction rows", "columns", dateOrderOf(values.dateOrder), values.flipSigns === true);
    const nearText = values.nearDays === void 0 ? "" : String(values.nearDays).trim();
    if (nearText !== "" && !/^\d{1,4}$/.test(nearText)) throw new AgentInputError(`"nearDays" must be a whole number of days from 0 to ${BK_DUP_MAX_DAYS}, or left out.`);
    const read = bkReadStatementRows(file.rows, mapping);
    const leftOut = bkLeftOutRows(file.rows, mapping.headerRow, read);
    const input = { rows: read.transactions, nearDays: nearText === "" ? 0 : Number(nearText) };
    const r = bkFindDuplicates(input);
    const t = r.totals;
    const near = r.nearDays > 0;
    return {
      summary: `${plural(t.file.rows, "row", "rows")} compared, ${formatUSD(t.file.amount)} in all. Exact repeats: ${plural(r.exactGroups.length, "group", "groups")}, ${plural(t.exact.rows, "row", "rows")}, ${formatUSD(t.exact.amount)}; their second and later rows are ${plural(t.exactLater.rows, "row", "rows")}, ${formatUSD(t.exactLater.amount)}. ` + (near ? `Near repeats within ${plural(r.nearDays, "day", "days")}: ${plural(r.nearGroups.length, "group", "groups")}, ${plural(t.near.rows, "row", "rows")}, ${formatUSD(t.near.amount)}; their second and later rows are ${plural(t.nearLater.rows, "row", "rows")}, ${formatUSD(t.nearLater.amount)}. ` : "No number of days was given, so near repeats were not looked for. ") + `No repeat found: ${plural(t.none.rows, "row", "rows")}, ${formatUSD(t.none.amount)}. Amounts keep their signs (money out is negative). Nothing was removed from the file.`,
      tables: [
        { name: "Totals", rows: bkDuplicateTotalsTable(r) },
        { name: "Groups", rows: bkDuplicateGroupsTable(r) },
        { name: "Every row", rows: bkDuplicateRowsTable(r) }
      ],
      // The builder's own checks, then the separate routine's, then the two lines that account for every row.
      checks: [...r.checks, ...bkVerifyDuplicates(input, r), ...sheetRowChecks(read.problems, leftOut)]
    };
  },
  examples: [
    {
      label: "The page's worked example: ten March transactions, days set to 3",
      args: { transactions: "fixture:bookkeeping/duplicates-example.csv", nearDays: "3" },
      verified: true,
      contains: ["1 row, -$18.40", "2 rows, -$90.00", "2 rows, -$36.80", "3 rows, -$135.00", "5 rows, $1,193.00", "10 rows compared, $1,021.20", "| Exact 1 | 2 | 2, 3 |", "| Near 1 | 3 | 5, 6, 7 |", "14 checks run"]
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { transactions: "Date,Description,Amount\n03/02/2026,CORNER CAFE,-18.40\n03/02/2026,CORNER CAFE,-18.4O\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var STATEMENT_BALANCE_INPUTS = [
  {
    name: "order",
    kind: "choice",
    label: "Row order in the file",
    description: 'Optional. "auto" (the default) works it out from the dates; "oldest first" keeps the rows as written; "newest first" reverses them.',
    required: false,
    choices: ["auto", "oldest first", "newest first"]
  },
  { name: "openingBalance", kind: "amount", label: "Opening balance", description: "Optional. The opening (card: previous) balance from the statement. Without it, it is worked out from the running balance on the first transaction.", required: false },
  { name: "closingBalance", kind: "amount", label: "Closing balance", description: "Optional. The closing (card: new) balance from the statement. Without it, the running balance on the last transaction.", required: false }
];
var ORDERS = { auto: "auto", "oldest first": "asWritten", "newest first": "reverse" };
var STATEMENT_COMPARISONS = ["balance", "second-pass", "export-closing", "deposits-total", "deposits-count", "withdrawals-total", "withdrawals-count", "summary-formula"];
function buildStatement(file, values, label, options) {
  const mapping = rowFileMapping(file, BANK_FILE, values.columns, label, "columns", dateOrderOf(values.dateOrder), values.flipSigns === true);
  const read = bkReadStatementRows(file.rows, mapping, options.kind);
  const result = bkBuildStatement({ ...options, transactions: read.transactions, problems: read.problems, ...read.balanceLines ? { balanceLines: read.balanceLines } : {} });
  return { result, ignoredRows: read.ignoredRows, balanceLines: read.balanceLines?.length ?? 0 };
}
function balanceOptions(values) {
  const out = { order: ORDERS[values.order ?? "auto"] };
  if (values.openingBalance !== void 0) out.openingBalance = values.openingBalance;
  if (values.closingBalance !== void 0) out.closingBalance = values.closingBalance;
  return out;
}
var statementToExcel = {
  name: "bank_statement_to_excel",
  page: "bookkeeping/statement-to-excel",
  section: "bookkeeping",
  kind: "tool",
  title: "Bank or card statement rows to a checked table",
  description: "Turns the rows of a bank or card export (.csv or .xlsx, or pasted rows with a header row) into one clean table in date order (Date, Description, Amount, Balance) and proves it against the statement: opening balance plus every transaction equals the closing balance (on a card, previous balance plus activity equals the new balance), every running balance in the file matches, dates are valid and inside the period when one is given, typed summary totals match by amount and count, money in minus money out is added a second way, and the table is read back. Balances are typed or taken from the running balance column. A row that cannot be read fails the result. Use it when someone wants a statement export cleaned up into Excel or CSV, or checked against the statement balances. Not for PDF statements or scans.",
  question: "Can you turn this bank CSV export into a clean Excel table and check it against the March statement balances?",
  inputs: [
    { name: "statementRows", kind: "file", label: "Statement rows", description: STATEMENT_FILE_DESCRIPTION, required: true },
    { name: "kind", kind: "choice", label: "Account", description: 'Optional. "bank" (the default): positive amounts are money in. "card": positive amounts are charges and increase what is owed.', required: false, choices: ["bank", "card"] },
    ...STATEMENT_BALANCE_INPUTS,
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. The first day of the statement period; a transaction dated outside the period is flagged.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. The last day of the statement period.", required: false },
    { name: "depositsTotal", kind: "amount", label: "Total deposits", description: "Optional, from the statement's summary box: total deposits (card: payments and credits). Checked against the rows.", required: false },
    { name: "depositsCount", kind: "number", label: "Number of deposits", description: "Optional, bank only: the number of deposits in the summary box.", required: false },
    { name: "withdrawalsTotal", kind: "amount", label: "Total withdrawals", description: "Optional: total withdrawals (card: purchases, fees and interest). Checked against the rows.", required: false },
    { name: "withdrawalsCount", kind: "number", label: "Number of withdrawals", description: "Optional, bank only: the number of withdrawals in the summary box.", required: false },
    rowColumnsInput("Statement rows", BANK_FILE),
    DATE_ORDER_INPUT,
    FLIP_SIGNS_INPUT
  ],
  limits: "site",
  // The typed balances and the typed summary box. A typed closing balance the rows do not reach fails three checks
  // at once, each comparing the rows with it ("balance", "second-pass", "export-closing"); with balances from the
  // running balance column those cannot fail without "running-balance" failing too, and then nothing is shown.
  comparisonChecks: STATEMENT_COMPARISONS,
  notAdvice: "Mathproven reads the rows given and checks their arithmetic against the balances; it does not read PDF statements and says nothing about how any transaction should be recorded.",
  run({ files, values }) {
    const file = oneFile(files, "statementRows");
    const kind = values.kind === "card" ? "card" : "bank";
    const options = { kind, ...balanceOptions(values) };
    if (values.periodStart !== void 0) options.periodStart = values.periodStart;
    if (values.periodEnd !== void 0) options.periodEnd = values.periodEnd;
    const sumIn = values.depositsTotal;
    const sumOut = values.withdrawalsTotal;
    const count2 = (name, what) => values[name] === void 0 ? void 0 : wholeNumber(values[name], name, what, 0);
    const inCount = count2("depositsCount", "Number of deposits");
    const outCount = count2("withdrawalsCount", "Number of withdrawals");
    if (kind === "card") {
      if (sumIn !== void 0 || sumOut !== void 0) options.cardSummary = { ...sumIn !== void 0 ? { paymentsAndCredits: sumIn } : {}, ...sumOut !== void 0 ? { charges: sumOut } : {} };
    } else if (sumIn !== void 0 || sumOut !== void 0 || inCount !== void 0 || outCount !== void 0) {
      options.summary = {
        ...sumIn !== void 0 ? { depositsTotal: sumIn } : {},
        ...inCount !== void 0 ? { depositsCount: inCount } : {},
        ...sumOut !== void 0 ? { withdrawalsTotal: sumOut } : {},
        ...outCount !== void 0 ? { withdrawalsCount: outCount } : {}
      };
    }
    const { result, ignoredRows, balanceLines } = buildStatement(file, values, "Statement rows", options);
    const s = result.statement;
    const from = (src) => src === "typed" ? "typed" : "from the running balance column";
    const card = kind === "card";
    const notes = [
      result.reversed ? "The file listed the newest transaction first; the rows were put in date order." : "",
      ignoredRows - balanceLines > 0 ? `${plural(ignoredRows - balanceLines, "row", "rows")} with no date and no amount (titles or notes) left out.` : "",
      balanceLines ? `${plural(balanceLines, "balance line (the file's own beginning or ending balance) was", "balance lines (the file's own beginning or ending balances) were")} checked against the transactions and not counted as transactions.` : ""
    ].filter(Boolean);
    return {
      summary: `${plural(result.totals.count, "transaction", "transactions")} from ${file.name}. ${card ? "Previous" : "Opening"} balance ${formatUSD(s.openingBalance)} (${from(result.openingSource)}); ${card ? "charges" : "money in"} ${formatUSD(result.totals.moneyIn)}; ${card ? "payments and credits" : "money out"} ${formatUSD(result.totals.moneyOut)}; net ${formatUSD(result.totals.net)}; ${card ? "new" : "closing"} balance ${formatUSD(s.closingBalance)} (${from(result.closingSource)}).` + (notes.length ? ` ${notes.join(" ")}` : ""),
      tables: [
        { name: "Transactions", rows: result.table },
        { name: "Balances", rows: [["Item", "Amount"], ["Opening balance", toDecimal(s.openingBalance)], ["Closing balance", toDecimal(s.closingBalance)]] }
      ],
      checks: result.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: the March export, opening $1,200.00, closing $3,953.33, 2 deposits of $3,750.00 and 4 withdrawals of $996.67",
      args: { statementRows: "fixture:bookkeeping/bank-march.csv", openingBalance: "1,200.00", closingBalance: "3,953.33", depositsTotal: "3,750.00", depositsCount: "2", withdrawalsTotal: "996.67", withdrawalsCount: "4" },
      verified: true,
      contains: ["money in $3,750.00", "money out $996.67", "net $2,753.33", "closing balance $3,953.33", "| 2026-03-31 | MONTHLY SERVICE FEE | -12.00 | 3953.33 |", "12 checks run"]
    },
    {
      label: "A closing balance that the rows do not reach is not verified",
      args: { statementRows: "fixture:bookkeeping/bank-march.csv", openingBalance: "1,200.00", closingBalance: "3,935.33" },
      verified: false,
      failedCheck: "balance"
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { statementRows: "Date,Description,Amount,Balance\n03/02/2026,PAYROLL DEPOSIT,2500.00,3700.00\n03/03/2026,HARDWARE STORE,-48.2.7,3651.73\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var ACCOUNT_TYPES = { checking: "CHECKING", savings: "SAVINGS", "money market": "MONEYMRKT", "line of credit": "CREDITLINE" };
var CSV_DATE_FORMATS = { "month first": "mdy", "day first": "dmy", iso: "iso" };
var CSV_COLUMNS = { signed: "signed", "debit and credit": "debitCredit" };
var statementToOfx = {
  name: "bank_statement_to_ofx",
  page: "bookkeeping/statement-to-ofx",
  section: "bookkeeping",
  kind: "tool",
  title: "Bank statement rows to an OFX file and row-limited import CSVs",
  description: "Writes the rows of a bank export (.csv or .xlsx, or pasted rows with a header row) as an OFX 1.x bank statement, with a unique transaction id (FITID) on every row, plus CSV files split so none holds more rows than a set limit. The statement is checked first (opening balance plus transactions equals closing balance, running balances match); the OFX text is then read back by a separate reader and compared transaction by transaction (date, amount, description, order, total, distinct ids, ledger balance), and the CSV parts are read back and re-added. The OFX text comes back as a table, one line of the file per row, beside each CSV part. Use it when someone needs an OFX, QFX or QBO import file, or import CSVs of a limited size, made from a bank export. Not for PDF statements, and not a promise that a given program accepts the file.",
  question: "Can you turn this bank CSV into an OFX file for import, and split it into CSV files of 500 rows?",
  inputs: [
    { name: "statementRows", kind: "file", label: "Statement rows", description: STATEMENT_FILE_DESCRIPTION, required: true },
    ...STATEMENT_BALANCE_INPUTS,
    { name: "accountType", kind: "choice", label: "Account type", description: "Optional. Written in the OFX file. Default checking.", required: false, choices: Object.keys(ACCOUNT_TYPES) },
    { name: "bankId", kind: "text", label: "Bank routing number", description: "Optional. 1 to 9 letters or digits, written in the OFX file. Default 000000000.", required: false },
    { name: "accountId", kind: "text", label: "Account id", description: "Optional. 1 to 22 letters, digits or hyphens; the last four digits are enough. Default 0000.", required: false },
    { name: "currency", kind: "text", label: "Currency", description: "Optional. Three capital letters. Default USD.", required: false },
    { name: "institutionId", kind: "text", label: "Institution id", description: "Optional. 1 to 10 digits some programs look for in the file; written only when given, and not supplied by Mathproven.", required: false },
    { name: "fileEnding", kind: "choice", label: "File name ending", description: 'Optional. ofx (the default), qfx or qbo: the ending of the OFX file’s name; the text is the same. A "saveTo" path ending the same way saves the OFX file itself.', required: false, choices: ["ofx", "qfx", "qbo"] },
    { name: "maxRows", kind: "number", label: "Most rows in one CSV file", description: "Optional. A whole number from 1 to 100,000: no CSV file holds more transaction rows than this. Default 1000.", required: false },
    { name: "csvDateFormat", kind: "choice", label: "CSV date format", description: 'Optional. "month first" (03/31/2026, the default), "day first" (31/03/2026) or "iso" (2026-03-31).', required: false, choices: Object.keys(CSV_DATE_FORMATS) },
    { name: "csvColumns", kind: "choice", label: "CSV amount columns", description: 'Optional. "signed" (Date, Description, Amount; the default) or "debit and credit" (Date, Description, Debit, Credit, both positive).', required: false, choices: Object.keys(CSV_COLUMNS) },
    rowColumnsInput("Statement rows", BANK_FILE),
    DATE_ORDER_INPUT,
    FLIP_SIGNS_INPUT
  ],
  limits: "site",
  comparisonChecks: ["balance", "second-pass", "export-closing"],
  // The OFX file itself is saved when "saveTo" ends with its ending; the text is the same for all three.
  fileExtensions: [".ofx", ".qfx", ".qbo"],
  notAdvice: "Mathproven writes the file from the rows given and reads it back; whether a particular program accepts it is up to that program, and Mathproven is not affiliated with any bank or accounting software maker.",
  run({ files, values }) {
    const file = oneFile(files, "statementRows");
    const { result } = buildStatement(file, values, "Statement rows", balanceOptions(values));
    const text = (name) => {
      const v = values[name];
      return v === void 0 || v === "" ? void 0 : v;
    };
    const intuBid = text("institutionId");
    const out = bkExportStatement(
      result.statement,
      { bankId: text("bankId"), accountId: text("accountId"), accountType: ACCOUNT_TYPES[values.accountType ?? "checking"], currency: text("currency"), ...intuBid ? { intuBid } : {} },
      { maxRows: wholeNumber(values.maxRows, "maxRows", "Most rows in one CSV file", 1e3), dateFormat: CSV_DATE_FORMATS[values.csvDateFormat ?? "month first"], columns: CSV_COLUMNS[values.csvColumns ?? "signed"] }
    );
    const s = result.statement;
    const base = `statement-${fileBase(file.name, "rows")}`;
    const parts = out.csv.files.length;
    const csvName = (index) => parts === 1 ? `${base}.csv` : `${base}-part-${index}-of-${parts}.csv`;
    const ofxName = `${base}.${values.fileEnding ?? "ofx"}`;
    const ids = bkFitIds(s.transactions);
    const partOf = [];
    for (const f of out.csv.files) for (let i = 0; i < f.count; i++) partOf.push(f.index);
    const ofxLines = out.ofx.split(/\r?\n/);
    if (ofxLines[ofxLines.length - 1] === "") ofxLines.pop();
    return {
      summary: `${plural(s.transactions.length, "transaction", "transactions")} from ${file.name}: opening balance ${formatUSD(s.openingBalance)}, total ${formatUSD(result.totals.net)}, closing balance ${formatUSD(s.closingBalance)} (the ledger balance in the OFX file). ${ofxName} holds ${plural(s.transactions.length, "transaction", "transactions")} with ${plural(new Set(ids).size, "different id", "different ids")}. The CSV splits into ${plural(parts, "file", "files")} of at most ${out.csv.maxRows} rows: ${out.csv.files.map((f) => `${plural(f.count, "row", "rows")} totaling ${formatUSD(f.sum)}`).join("; ")}. The OFX file's text is the "OFX file" table, one line per row; a "saveTo" path ending ${ofxName.slice(ofxName.lastIndexOf("."))} saves the file itself.`,
      tables: [
        { name: "Files", rows: [["File", "Transactions", "Total"], [ofxName, s.transactions.length, toDecimal(result.totals.net)], ...out.csv.files.map((f) => [csvName(f.index), f.count, toDecimal(f.sum)])] },
        { name: "Transactions", rows: [["Date", "Description", "Amount", "Transaction id (FITID)", "CSV file"], ...s.transactions.map((t, i) => [t.date, t.description, toDecimal(t.amount), ids[i] ?? "", partOf[i] ?? ""])] },
        { name: "OFX file", rows: [[ofxName], ...ofxLines.map((line) => [line])] },
        ...out.csv.files.map((f) => ({ name: parts === 1 ? "CSV file" : `CSV file ${f.index} of ${parts}`, rows: f.rows }))
      ],
      checks: [...result.checks, ...out.checks],
      file: { suggestedName: ofxName, bytes: new TextEncoder().encode(out.ofx) }
    };
  },
  examples: [
    {
      label: "The page's worked example: the March statement, opening $1,200.00, closing $3,953.33, row limit 4",
      args: { statementRows: "fixture:bookkeeping/bank-march.csv", openingBalance: "1200.00", closingBalance: "3953.33", maxRows: "4" },
      verified: true,
      contains: ["total $2,753.33", "closing balance $3,953.33", "6 different ids", "4 rows totaling $2,901.73", "2 rows totaling -$148.40", "20260302.001.250000", "20260303.001.N4827", "20260331.001.N1200", "| OFXHEADER:100 |"]
    },
    {
      label: "A row whose date cannot be read is not verified",
      args: { statementRows: "Date,Description,Amount\n03/02/2026,PAYROLL DEPOSIT,2500.00\n03/33/2026,HARDWARE STORE,-48.27\n", openingBalance: "1200.00", closingBalance: "3700.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function balanceList(raw, name, count2) {
  if (raw === void 0) return [];
  const items = String(raw).split(/[;\n]/).map((s) => s.trim());
  while (items.length > count2 && items[items.length - 1] === "") items.pop();
  if (items.length > count2) throw new AgentInputError(`"${name}" has ${items.length} balances for ${plural(count2, "statement", "statements")}. Give one per statement, in the order of the files, separated by semicolons.`);
  return items.map((s, i) => {
    if (s === "" || /^[-–—]$/.test(s)) return void 0;
    try {
      return parseAmount(s);
    } catch {
      throw new AgentInputError(`Balance ${i + 1} of "${name}" ("${s}") is not an amount in dollars and cents.`);
    }
  });
}
var statementMerge = {
  name: "bank_statement_merge",
  page: "bookkeeping/statement-batch-merge",
  section: "bookkeeping",
  kind: "tool",
  title: "Merge monthly bank statement exports into one ledger",
  description: "Merges two or more statement exports of one account (.csv or .xlsx, in any order) into one ledger in date order with a running balance and the statement each row came from. Each statement is read and balanced on its own; then each closing balance is checked against the next opening balance, overlapping periods are flagged, the first opening balance plus every transaction is checked against the last closing balance, and the merged count and total are re-added from the statements. A transaction with the same date, amount and description in two different statements is listed as a duplicate and kept. Balances come from each file's running balance column or are typed. Use it when someone wants several months of bank exports combined into one continuous ledger, or checked for a gap between months. Not for PDF statements, and not for combining different accounts.",
  question: "Can you merge my March, April and May bank exports into one ledger and check that the months connect?",
  inputs: [
    { name: "statements", kind: "files", label: "Statement files", description: `Two or more files of one account, in any order. Each: ${STATEMENT_FILE_DESCRIPTION}`, required: true },
    {
      name: "openingBalances",
      kind: "text",
      label: "Opening balances",
      description: `Optional. One per statement, in the order the files are given, separated by semicolons; leave a place blank (or write -) to take that opening balance from the file's running balance column. Example: "1,200.00; ; -".`,
      required: false
    },
    { name: "closingBalances", kind: "text", label: "Closing balances", description: "Optional. As the opening balances: one per statement in file order, separated by semicolons, blank or - for the running balance column.", required: false },
    { ...rowColumnsInput("Statement files", BANK_FILE), description: `${rowColumnsInput("Statement files", BANK_FILE).description} Applied to every file; each header named must be in every file.` },
    DATE_ORDER_INPUT,
    FLIP_SIGNS_INPUT
  ],
  limits: "site",
  // A merge needs two files, so a run with no key reads two, as the page does (Math.max(2, maxBatchFiles())).
  freeFilesPerRun: 2,
  notAdvice: "Mathproven joins and re-adds the rows given; duplicates are listed and kept, and nothing is removed or recorded for you.",
  run({ files, values }) {
    const list = files.statements ?? [];
    if (list.length < 2) throw new AgentInputError("Give at least two statement files to merge.");
    const openings = balanceList(values.openingBalances, "openingBalances", list.length);
    const closings = balanceList(values.closingBalances, "closingBalances", list.length);
    const used = /* @__PURE__ */ new Map();
    const names = list.map((f) => {
      const n = (used.get(f.name) ?? 0) + 1;
      used.set(f.name, n);
      return n === 1 ? f.name : `${f.name} (${n})`;
    });
    const built = list.map((file, i) => {
      const opening = openings[i];
      const closing = closings[i];
      try {
        return buildStatement(file, values, `Statement file ${names[i]}`, { ...opening !== void 0 ? { openingBalance: opening } : {}, ...closing !== void 0 ? { closingBalance: closing } : {} }).result;
      } catch (err) {
        throw new AgentInputError(`${names[i]}: ${err instanceof Error ? err.message : "this file could not be read."}`);
      }
    });
    const r = bkMergeStatements(built.map((b, i) => ({ name: names[i] ?? `Statement ${i + 1}`, statement: b.statement })));
    const own = built.flatMap((b, i) => b.checks.filter((c) => !c.passed && c.severity === "error").map((c) => ({ ...c, id: `part-${i + 1}-${c.id}`, label: `${names[i]}: ${c.label}` })));
    const total = sum(r.merged.transactions.map((t) => t.amount));
    return {
      summary: `${plural(r.parts.length, "statement", "statements")} from ${r.merged.periodStart ?? ""} to ${r.merged.periodEnd ?? ""}, in this order: ${r.parts.map((p) => `${p.name} (${formatUSD(p.openingBalance)} to ${formatUSD(p.closingBalance)}, ${plural(p.count, "transaction", "transactions")})`).join("; ")}. The merged ledger opens at ${formatUSD(r.merged.openingBalance)}, has ${plural(r.merged.transactions.length, "transaction", "transactions")} totaling ${formatUSD(total)}, and closes at ${formatUSD(r.merged.closingBalance)}. ${r.duplicates.length === 0 ? "No transaction appears in more than one statement." : `${plural(r.duplicates.length, "transaction appears", "transactions appear")} in more than one statement; they are listed and kept.`}`,
      tables: [
        { name: "Statements", rows: [["Statement", "From", "To", "Opening balance", "Transactions", "Total", "Closing balance"], ...r.parts.map((p) => [p.name, p.start, p.end, toDecimal(p.openingBalance), p.count, toDecimal(p.sum), toDecimal(p.closingBalance)])] },
        { name: "Duplicates", rows: [["Date", "Description", "Amount", "Appears in"], ...r.duplicates.map((d) => [d.date, d.description, toDecimal(d.amount), d.occurrences.map((o) => `${o.part} (transaction ${o.position})`).join("; ")])] },
        { name: "Ledger", rows: r.table }
      ],
      checks: [...own, ...r.checks]
    };
  },
  examples: [
    {
      label: "The page's worked example: March, April and May statements of one account, given out of order",
      args: { statements: ["fixture:bookkeeping/bank-may.csv", "fixture:bookkeeping/bank-march.csv", "fixture:bookkeeping/bank-april-layout-b.csv"] },
      verified: true,
      contains: ["opens at $1,200.00, has 14 transactions totaling $4,089.95, and closes at $5,289.95", "bank-march.csv ($1,200.00 to $3,953.33, 6 transactions)", "bank-april-layout-b.csv ($3,953.33 to $4,463.03, 5 transactions)", "bank-may.csv ($4,463.03 to $5,289.95, 3 transactions)", "9 checks run"]
    },
    {
      label: "March and May with April missing: the closing balance does not meet the next opening balance",
      args: { statements: ["fixture:bookkeeping/bank-march.csv", "fixture:bookkeeping/bank-may.csv"] },
      verified: false,
      failedCheck: "continuity-1"
    },
    {
      label: "A statement with a row that cannot be read makes the merge not verified",
      args: { statements: ["Date,Description,Amount,Balance\n03/02/2026,DEPOSIT,2500.00,3700.00\n03/05/2026,CHECK 1042,-8OO.00,2900.00\n", "fixture:bookkeeping/bank-may.csv"] },
      verified: false,
      failedCheck: "part-1-rows-read"
    }
  ]
};
var RECEIPT_ROLES = ["date", "description", "account", "amount"];
var RECEIPT_LABELS = { date: "Date", description: "Description", account: "Expense account", amount: "Amount" };
var RECEIPT_SYNONYMS = {
  account: ["expense account", "account", "gl account", "expense category", "category"],
  amount: ["amount", "receipt amount", "amt", "paid"],
  date: ["date", "receipt date", "paid on"],
  description: ["description", "memo", "details", "item", "note", "paid to", "payee", "vendor"]
};
var RECEIPT_COLUMNS = { roles: RECEIPT_ROLES, labels: RECEIPT_LABELS, required: ["account", "amount"], guess: (rows, at) => sheetGuessColumns(rows, RECEIPT_ROLES, RECEIPT_SYNONYMS, at) };
var DENOMINATION_NAMES = BK_PETTY_CASH_DENOMINATIONS.map((d) => {
  const label = sheetNormalizeHeader(d.label);
  const names = [label, sheetNormalizeHeader(d.label.replace(/\([^)]*\)/g, ""))];
  const dollars = /^\$(\d+) bills$/.exec(d.label)?.[1];
  const words = { "100": ["hundreds", "hundred dollar bills"], "50": ["fifties", "fifty dollar bills"], "20": ["twenties", "twenty dollar bills"], "10": ["tens", "ten dollar bills"], "5": ["fives", "five dollar bills"], "2": ["twos", "two dollar bills"], "1": ["ones", "one dollar bills"] };
  if (d.kind === "bill" && dollars) names.push(dollars, `${dollars} bill`, `${dollars} dollar bill`, `${dollars} dollar bills`, ...words[dollars] ?? []);
  const coins = {
    100: ["1 coin", "dollar coin", "dollar coins", "one dollar coins"],
    50: ["half dollar", "halves", "50c", "50 cents", "50 cent coins"],
    25: ["quarter", "25c", "25 cents", "25 cent coins"],
    10: ["dime", "10c", "10 cents", "10 cent coins"],
    5: ["nickel", "5c", "5 cents", "5 cent coins"],
    1: ["penny", "1c", "1 cent", "1 cent coins", "cents"]
  };
  if (d.kind === "coin") names.push(...coins[d.value] ?? []);
  return [...new Set(names.map(sheetNormalizeHeader))];
});
function cashCounts(raw) {
  const counts = BK_PETTY_CASH_DENOMINATIONS.map(() => 0);
  if (raw === void 0) return counts;
  const seen = /* @__PURE__ */ new Set();
  for (const part of String(raw).split(/[;\n]|,(?!\d{3}(?!\d))/)) {
    if (part.trim() === "") continue;
    const m = /^(.*?)[=:]\s*([\d,]+)\s*$/.exec(part.trim());
    if (!m) throw new AgentInputError(`"cashCount" is written as "<bill or coin> = <count>", separated by commas, for example "$20 bills = 7, quarters = 13": "${part.trim()}".`);
    const name = sheetNormalizeHeader(m[1] ?? "");
    const index = DENOMINATION_NAMES.findIndex((names) => names.includes(name));
    if (index < 0) throw new AgentInputError(`"${(m[1] ?? "").trim()}" in "cashCount" is not one of the bills or coins counted: ${BK_PETTY_CASH_DENOMINATIONS.map((d) => d.label).join(", ")}.`);
    if (seen.has(index)) throw new AgentInputError(`${BK_PETTY_CASH_DENOMINATIONS[index].label} is counted twice in "cashCount".`);
    seen.add(index);
    const digits = (m[2] ?? "").replace(/,/g, "");
    if (!/^\d{1,12}$/.test(digits)) throw new AgentInputError(`The count of ${BK_PETTY_CASH_DENOMINATIONS[index].label} in "cashCount" must be a whole number.`);
    counts[index] = Number(digits);
  }
  return counts;
}
function readReceipts(file, override, dateOrder) {
  if (!file) return { items: [], problems: [], leftOut: [], checks: [] };
  const mapping = mapColumns(file, RECEIPT_COLUMNS, override, "Receipts");
  assertDistinct(file, RECEIPT_COLUMNS, mapping, "Receipts", "columns");
  return readList2(file, mapping, { what: "receipts", id: "receipts", prefix: false, amount: "amount", date: "date" }, (cell, fail) => {
    const amount = listAmount(cell("amount"), fail);
    if (amount < 0) fail(`the amount "${cell("amount")}" is negative; receipts are positive amounts`);
    if (cell("account") === "") fail("no expense account");
    return { date: listDate(cell("date"), dateOrder, fail), description: cell("description"), account: cell("account"), amount };
  });
}
var pettyCash = {
  name: "petty_cash_reconciliation",
  page: "bookkeeping/petty-cash-reconciliation",
  section: "bookkeeping",
  kind: "tool",
  title: "Petty cash reconciliation: count, receipts, over or short",
  description: "Proves a petty cash box against its fund: the bills and coins counted by denomination are multiplied out, the receipts paid out since the last replenishment are totalled by expense account, and cash plus receipts is compared with the fund to the cent, giving the amount over or short, the replenishment that brings the cash back up to the fund, and the journal entry lines (expense accounts and a shortage debited, the cash account credited) with debits equal to credits. Every figure is worked out a second time. Warnings: an over or short of any size, more cash than the fund, a receipt of zero, a receipt on the cash or over-and-short account. Use it when someone asks to reconcile, count or replenish a petty cash fund, or to write the replenishment entry. Not for choosing which expense account a receipt belongs in.",
  question: "Our $300 petty cash box was counted today and there are four receipts. Is it over or short, and what is the replenishment entry?",
  inputs: [
    { name: "fund", kind: "amount", label: "Petty cash fund", description: "The fixed amount the box holds in cash and receipts together.", required: true },
    {
      name: "cashCount",
      kind: "text",
      label: "Cash count",
      description: `How many of each bill and coin are in the box, as "<bill or coin> = <count>" separated by commas, for example "$20 bills = 7, $1 bills = 22, quarters = 13, pennies = 7". The bills and coins: ${BK_PETTY_CASH_DENOMINATIONS.map((d) => d.label).join(", ")}. One not named is zero; a roll of coins is counted as the coins inside it.`,
      required: false
    },
    {
      name: "receipts",
      kind: "file",
      label: "Receipts",
      description: "Optional. The receipts or vouchers paid out of the box since the last replenishment: a .csv or .xlsx file (a path, or the CSV text) with a header row and the columns Expense account and Amount (a positive number); Date and Description are read when present.",
      required: false
    },
    { name: "countDate", kind: "date", label: "Count date", description: "Optional. The day the box was counted.", required: false },
    { name: "name", kind: "text", label: "Fund or business name", description: "Optional. Printed on the summary.", required: false },
    { name: "cashAccount", kind: "text", label: "Replenishment paid from (account)", description: 'Optional. The account the replenishment is paid from, as named in the chart of accounts. Default "Cash".', required: false },
    { name: "overShortAccount", kind: "text", label: "Over or short account", description: 'Optional. The account an overage or a shortage goes to. Default "Cash over and short".', required: false },
    columnsInput("Receipts", RECEIPT_COLUMNS),
    DATE_ORDER_INPUT
  ],
  limits: "site",
  notAdvice: "Mathproven multiplies, adds and compares the counts, receipts and account names given; it says nothing about which account an expense belongs in.",
  run({ files, values }) {
    const counts = cashCounts(values.cashCount);
    const read = readReceipts(files.receipts?.[0], values.columns, dateOrderOf(values.dateOrder));
    const input = {
      countDate: values.countDate ?? "",
      fund: values.fund,
      denominations: BK_PETTY_CASH_DENOMINATIONS.map((d, i) => ({ ...d, count: counts[i] ?? 0 })),
      receipts: read.items,
      cashAccount: values.cashAccount || "Cash",
      overShortAccount: values.overShortAccount || "Cash over and short"
    };
    const r = bkPettyCash(input);
    const t = bkPettyCashTables(input, r, values.name ?? "");
    const os = r.overShort;
    return {
      summary: `${os === 0 ? "Exact: cash plus receipts equals the fund." : `${bkOverShortLabel(os)} ${formatUSD(Math.abs(os))}: cash plus receipts is ${formatUSD(r.accountedFor)} against a fund of ${formatUSD(input.fund)}.`} Cash counted ${formatUSD(r.cashCounted)} (bills ${formatUSD(r.billsTotal)}, coins ${formatUSD(r.coinsTotal)}); receipts ${formatUSD(r.receiptsTotal)} on ${plural(input.receipts.length, "receipt", "receipts")} in ${plural(r.accounts.length, "account", "accounts")}. Replenishment (fund − cash counted) ${formatUSD(r.replenishment)}. The journal entry has ${plural(r.journal.length, "line", "lines")}, debits ${formatUSD(r.debitsTotal)} and credits ${formatUSD(r.creditsTotal)}.`,
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Journal entry", rows: t.journal },
        { name: "By account", rows: t.accounts },
        { name: "Cash count", rows: t.count },
        { name: "Receipts", rows: t.receipts }
      ],
      checks: [...r.checks, ...files.receipts?.[0] ? [...sheetRowChecks(read.problems, read.leftOut), ...read.checks] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: a $300.00 fund at Example Print Shop, counted April 30, 2026, with four receipts",
      args: {
        fund: "300.00",
        cashCount: "$20 bills = 7, $10 bills = 4, $5 bills = 3, $1 bills = 22, quarters = 13, dimes = 6, nickels = 4, pennies = 7",
        receipts: "agents-fixture:bookkeeping/petty-cash-receipts.csv",
        countDate: "2026-04-30",
        name: "Example Print Shop"
      },
      verified: true,
      contains: ["Short $0.85: cash plus receipts is $299.15 against a fund of $300.00", "Cash counted $221.12 (bills $217.00, coins $4.12)", "receipts $78.03", "Replenishment (fund − cash counted) $78.88", "| Office supplies | 53.63 |", "| Cash over and short | 0.85 |", "| Cash |  | 78.88 |", "| Total | 78.88 | 78.88 |"]
    },
    {
      label: "The page's what-if: one more $1 bill, so the box is over $0.15",
      args: { fund: "300.00", cashCount: "$20 = 7; $10 = 4; $5 = 3; ones = 23; quarters = 13; dimes = 6; nickels = 4; pennies = 7", receipts: "agents-fixture:bookkeeping/petty-cash-receipts.csv" },
      verified: true,
      contains: ["Over $0.15", "Cash counted $222.12", "Replenishment (fund − cash counted) $77.88", "| Cash over and short |  | 0.15 |"]
    },
    {
      label: "A receipt whose amount cannot be read is not verified",
      args: { fund: "100.00", cashCount: "$20 bills = 4", receipts: "Expense account,Amount\nPostage,12.00\nOffice supplies,8.OO\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readRowsFile(file, which, values) {
  if (!file) return null;
  const dateOrder = dateOrderOf(values[`${which}DateOrder`] ?? values.dateOrder);
  const flip = values[`${which}FlipSigns`] === true;
  const override = values[`${which}Columns`];
  const mapping = which === "book" ? rowFileMapping(file, BOOK_ROWS_FILE, override, "Book rows", "bookColumns", dateOrder, flip) : rowFileMapping(file, STATEMENT_ROWS_FILE, override, "Statement rows", "statementColumns", dateOrder, flip);
  const read = bkReadStatementRows(file.rows, mapping);
  return { rows: read.transactions.map((t) => ({ rowNumber: t.rowNumber, date: t.date, description: t.description, amount: t.amount })), problems: read.problems, leftOut: bkLeftOutRows(file.rows, mapping.headerRow, read) };
}
var reconciliationDifference = {
  name: "reconciliation_difference_finder",
  page: "bookkeeping/reconciliation-difference-finder",
  section: "bookkeeping",
  kind: "tool",
  title: "Find the rows that make a bank reconciliation not balance",
  description: `For a bank reconciliation that does not balance, works out the difference (adjusted bank minus adjusted book balance) and lists every row that, corrected one way, makes it $0.00: two neighbouring digits swapped, an entry equal to the difference, a doubled entry, or a sign or side reversed (half the difference). It searches the two balances, the four lists and, when given, the cash account's book rows and the bank statement rows for the period; a row matched on the other side is never named. Each candidate is applied and recomputed to $0.00, a second search made another way must find the same ones, and outstanding items more than ${BK_REC_DIFF_OLD_DAYS} days old are listed with a warning. Use it when someone says a bank reconciliation is off by an amount and asks where the difference comes from. Not for deciding which entry belongs in the books.`,
  question: "My bank reconciliation is off by $27.00. Here is the reconciliation with the ledger rows and the bank rows: which entry could cause it?",
  inputs: [
    ...reconciliationInputs(false),
    { name: "bookRows", kind: "file", label: "Book rows for the period", description: `Optional. The cash account's rows from the books (a ledger or check register export) for the period. ${STATEMENT_FILE_DESCRIPTION} In a ledger export a Debit column is money in and a Credit column money out.`, required: false },
    { name: "statementRows", kind: "file", label: "Bank statement rows for the period", description: `Optional. The bank's export for the same period. ${STATEMENT_FILE_DESCRIPTION}`, required: false },
    rowColumnsInput("Book rows", BOOK_ROWS_FILE, "bookColumns", true),
    rowColumnsInput("Statement rows", STATEMENT_ROWS_FILE, "statementColumns"),
    dateOrderInput("dateOrder", "a date in the lists (and in the two files, unless each is given its own)"),
    dateOrderInput("bookDateOrder", "a date in the book rows"),
    flipSignsInput("bookFlipSigns", "the single amount column of the book rows"),
    dateOrderInput("statementDateOrder", "a date in the statement rows"),
    flipSignsInput("statementFlipSigns", "the single amount column of the statement rows")
  ],
  limits: "site",
  // Totals written by hand on a filled-in workbook, compared with the calculation.
  comparisonChecks: WRITTEN_CHECKS,
  notAdvice: "Mathproven says what the numbers show: a candidate is a row that, corrected one way, makes the arithmetic balance, and it makes no statement about which entry belongs in the books.",
  run(args) {
    const { files, values } = args;
    const read = readReconciliation(args);
    const book = readRowsFile(files.bookRows?.[0], "book", values);
    const stmt = readRowsFile(files.statementRows?.[0], "statement", values);
    const input = { ...read.input, ...book ? { bookRows: book.rows } : {}, ...stmt ? { statementRows: stmt.rows } : {} };
    const r = bkFindRecDifference(input);
    const t = bkRecDiffTables(input, r);
    const d = formatUSD(r.difference);
    const facts = r.difference === 0 ? `The two adjusted balances are equal: the difference is ${d}, so there is nothing to find.` : `${r.ninth !== null ? `${d} is 9 × ${formatUSD(r.ninth)}: two swapped digits can make a difference like this.` : `${d} does not divide by 9, so no pair of swapped digits makes it.`} ${r.half !== null ? `Half the difference is ${formatUSD(r.half)}: a row of that size with its sign reversed would make it.` : `${d} is an odd number of cents, so no single row with its sign reversed makes it.`} ${r.candidates.length === 0 ? `No single row, corrected in one of the four ways, makes the difference $0.00; it may come from more than one row, or from a row not in the lists or files given.` : r.candidates.length === 1 ? "1 candidate, recomputed to a difference of $0.00." : `${r.candidates.length} candidates, each recomputed to a difference of $0.00; more than one can fit the arithmetic.`}`;
    const listRows = input.outstandingChecks.length + input.depositsInTransit.length + input.bankCorrections.length + input.bookAdjustments.length;
    const old = (input.statementDate ?? "") === "" ? `No statement date was given, so outstanding items more than ${BK_REC_DIFF_OLD_DAYS} days old were not looked for.` : r.old.length === 0 ? `No outstanding check or deposit in transit is dated more than ${BK_REC_DIFF_OLD_DAYS} days before the statement date.` : `${plural(r.old.length, "outstanding item is", "outstanding items are")} dated more than ${BK_REC_DIFF_OLD_DAYS} days before the statement date, listed as items to look at, not as candidates.`;
    return {
      summary: `Adjusted bank balance ${formatUSD(r.adjustedBankBalance)}, adjusted book balance ${formatUSD(r.adjustedBookBalance)}: adjusted bank − adjusted book is ${d}. ${facts} ${old} Searched: the two balances, ${plural(listRows, "list row", "list rows")}, ${book ? plural(book.rows.length, "book row", "book rows") : "no book rows"} and ${stmt ? plural(stmt.rows.length, "statement row", "statement rows") : "no statement rows"}.`,
      tables: [
        { name: "Reconciliation", rows: t.reconciliation },
        { name: "Candidates", rows: t.candidates },
        { name: `Outstanding for more than ${BK_REC_DIFF_OLD_DAYS} days`, rows: t.old }
      ],
      checks: [
        // How the reconciliation was given: the list rows read, and any totals written by hand on a workbook.
        ...recSourceChecks(read, bkBankRec(input)),
        ...r.checks,
        ...book ? bkRecDiffFileChecks("book", book.problems, book.leftOut) : [],
        ...stmt ? bkRecDiffFileChecks("statement", stmt.problems, stmt.leftOut) : []
      ]
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Supply Co., April 30, 2026, off by $27.00, with the eight book rows and seven statement rows",
      args: {
        statementBalance: "9,846.20",
        bookBalance: "10,360.05",
        statementDate: "2026-04-30",
        outstandingChecks: "agents-fixture:bookkeeping/rec-difference-outstanding-checks.csv",
        depositsInTransit: "Date,Description,Amount\n2026-04-30,Counter sales deposit,1180.00",
        adjustments: "Side,Add or subtract,Description,Amount\nBook,Add,Interest earned,2.15\nBook,Subtract,Monthly service fee,12.00",
        bookRows: "agents-fixture:bookkeeping/rec-difference-book-rows.csv",
        statementRows: "agents-fixture:bookkeeping/rec-difference-statement-rows.csv"
      },
      verified: true,
      contains: ["adjusted bank − adjusted book is $27.00", "$27.00 is 9 × $3.00", "Half the difference is $13.50", "1 candidate,", "| Two digits swapped | Book row 3 | 2026-04-06 | Check 3102 Example Office Supply | -152.00 | 5 and 2 | -125.00 | Statement row 3 | 0.00 |", "| 2026-01-15 |", "| 105 |"]
    },
    {
      label: "A book row whose amount cannot be read is not verified",
      args: {
        statementBalance: "9846.20",
        bookBalance: "10360.05",
        bookRows: "Date,Description,Debit,Credit\n04/02/2026,Counter sales deposit,2450.00,\n04/06/2026,Check 3102,,15.2.00\n"
      },
      verified: false,
      failedCheck: "book-rows-read"
    }
  ]
};
var ESCHEAT_COLUMNS = { roles: BK_ESCHEAT_ROLES, labels: BK_ESCHEAT_LABELS, required: BK_ESCHEAT_REQUIRED, guess: (rows, at) => bkEscheatGuessColumns(rows, at) };
var escheatList = {
  name: "uncashed_check_escheat_list",
  page: "bookkeeping/uncashed-check-escheat-list",
  section: "bookkeeping",
  kind: "tool",
  title: "Uncashed checks by state and dormancy end date",
  description: "Gives every check on an outstanding-check list (.csv or .xlsx with payee state, issue date, amount and a vendor or payroll type; check number and payee when present) the date its payee state's uncashed check dormancy period runs to, from the same sourced state table as the dormancy periods page, and groups the checks by state with counts and totals split into periods ended by the as-of date and still ahead. Each end date passes the table calculator's own second-way counts, the list total is added a second way and tied to the reconciliation's outstanding-check total when given and to the file's own total line, and a state with no row in the table gets no date, never a guess. A row that cannot be read fails the result. Use it when someone asks which uncashed or stale checks have passed their dormancy period, or wants outstanding checks sorted by state for unclaimed property work. Not for due diligence letters, and not for deciding what to report or remit.",
  question: "Which of these outstanding checks have passed their state dormancy period as of October 31, 2026?",
  inputs: [
    {
      name: "checkList",
      kind: "file",
      label: "Outstanding-check list",
      description: "A .csv or .xlsx file (a path, or the CSV text) with a header row, then one row per check: payee state (a two-letter code or a full name), issue date and amount are needed, and the type (Vendor or Payroll; AP, accounts payable, wages and PR are read too); check number and payee are read when present. A line reading Total with no issue date is read as the file's own total line.",
      required: true
    },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The day the end dates are counted from, such as the reconciliation's statement date. Without it, the day of the run.", required: false },
    { name: "statedTotal", kind: "amount", label: "Outstanding-check total on the reconciliation", description: "Optional. The list is tied to it; without it the list is tied to its own rows only, with a warning.", required: false },
    { name: "typeWhenBlank", kind: "choice", label: "Type of a check with none written", description: 'Optional. "vendor" or "payroll": the type of every check with no type written, or of the whole list when it has no type column. Without it, such a row is listed as a row that could not be read.', required: false, choices: ["vendor", "payroll"] },
    { name: "negativeAmounts", kind: "boolean", label: "Checks written as negative amounts", description: "Optional. true when the list writes each check as a negative number (money out of the account). Default false.", required: false },
    columnsInput("Outstanding-check list", ESCHEAT_COLUMNS),
    DATE_ORDER_INPUT
  ],
  limits: "site",
  // The list tied to the outstanding-check total the person typed from the reconciliation.
  comparisonChecks: ["ties-stated-total"],
  notAdvice: "Mathproven adds a state table row's years to each issue date and adds up the amounts; it does no due diligence and makes no statement about what to report, remit or send. Rules change; this is general information, not legal advice.",
  run({ files, values, now }) {
    const file = oneFile(files, "checkList");
    const mapping = mapColumns(file, ESCHEAT_COLUMNS, values.columns, "Outstanding-check list");
    assertDistinct(file, ESCHEAT_COLUMNS, mapping, "Outstanding-check list", "columns");
    const { headerRow, columns } = mapping;
    const kindWhenBlank = values.typeWhenBlank ?? null;
    if (columns.kind < 0 && kindWhenBlank === null) {
      throw new AgentInputError(`The outstanding-check list (${file.name}) has no type column. Its headers are: ${headerText(file, headerRow)}. Name it with "columns" ("Type = <header>"), or give "typeWhenBlank" (vendor or payroll) for every check in the list.`);
    }
    const read = bkReadOutstandingChecks(file.rows, { headerRow, columns }, { dateOrder: dateOrderOf(values.dateOrder), signs: values.negativeAmounts === true ? "negative" : "positive", kindWhenBlank });
    const asOf = values.asOf ?? localDay(now);
    const statedTotal = values.statedTotal;
    const r = bkEscheatList({ checks: read.checks, asOf, ...statedTotal !== void 0 ? { statedTotal } : {}, ...read.fileTotal !== void 0 ? { fileTotal: read.fileTotal } : {} });
    const dated = r.groups.filter((g) => g.status === "dated");
    const undated = r.groups.filter((g) => g.status !== "dated");
    const add = (list, pick) => list.reduce((s, g) => s + pick(g), 0);
    const checksWord = (n) => plural(n, "check", "checks");
    return {
      summary: `${checksWord(r.count)}, ${formatUSD(r.total)}, as of ${r.asOf}. ${plural(dated.length, "payee state has", "payee states have")} a row in the table: ${checksWord(add(dated, (g) => g.endedCount))}, ${formatUSD(add(dated, (g) => g.endedTotal))}, with periods ended by the as-of date, and ${checksWord(add(dated, (g) => g.aheadCount))}, ${formatUSD(add(dated, (g) => g.aheadTotal))}, still ahead. ${undated.length === 0 ? "Every payee state has a row." : `No row in the table, so no date given: ${checksWord(add(undated, (g) => g.count))}, ${formatUSD(add(undated, (g) => g.total))} (${undated.map((g) => g.name).join(", ")}).`} Each end date is the issue date plus the years in the uncashed check dormancy table's row for the payee state and type (rows read ${DORMANCY_TABLE.checkedOn} and before); a February 29 check ends on February 28 in a year without one. The law counts from when the property became payable and has its own conditions, which are not applied here.`,
      tables: [
        { name: "By payee state", rows: bkEscheatGroupsTable(r) },
        { name: "Every check", rows: bkEscheatLinesTable(r) }
      ],
      checks: [...r.checks, ...sheetRowChecks(read.problems, read.leftOut)]
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Supply Co.'s seven outstanding checks as of October 31, 2026, tied to the $5,892.50 total",
      args: { checkList: "fixture:bookkeeping/outstanding-checks-escheat.csv", asOf: "2026-10-31", statedTotal: "5,892.50" },
      verified: true,
      contains: ["7 checks, $5,892.50, as of 2026-10-31", "2676.75", "1696.75", "2790.25", "2028-06-30", "2029-02-28", "2 checks, $425.50"]
    },
    {
      label: "A check whose amount cannot be read is not verified",
      args: { checkList: "Check No,Issue Date,Payee State,Type,Amount\n3021,05/12/2023,AL,Vendor,412.60\n3022,06/30/2025,AL,Payroll,1284.1S\n", asOf: "2026-10-31" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var BOOKKEEPING = [
  bankReconciliation,
  bankReconciliationTemplate,
  reconciliationDifference,
  duplicateTransactions,
  statementToExcel,
  statementToOfx,
  statementMerge,
  pettyCash,
  escheatList
];
var BOOKKEEPING_NOT_FOR_AGENTS = [];

export {
  BOOKKEEPING,
  BOOKKEEPING_NOT_FOR_AGENTS
};
