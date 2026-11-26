// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  applyRate,
  assertCents,
  decimalToCents,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/construction/payapp.ts
function percentBp(part, whole) {
  if (whole === 0) return 0;
  return Math.round(part * 1e4 / whole);
}
function computePayApplication(input) {
  const lines = input.lines.map((l) => {
    assertCents(l.scheduledValue, `scheduled value on item ${l.itemNo}`);
    assertCents(l.previouslyCompleted, `previous work on item ${l.itemNo}`);
    assertCents(l.thisPeriod, `this period on item ${l.itemNo}`);
    assertCents(l.materialsStored, `stored materials on item ${l.itemNo}`);
    const work = l.previouslyCompleted + l.thisPeriod;
    const completedAndStored = work + l.materialsStored;
    const retainageOnWork2 = applyRate(work, l.retainageOnWorkBp ?? input.retainageOnWorkBp);
    const retainageOnStored2 = applyRate(l.materialsStored, input.retainageOnStoredBp);
    return {
      ...l,
      completedAndStored,
      percentCompleteBp: percentBp(completedAndStored, l.scheduledValue),
      balanceToFinish: l.scheduledValue - completedAndStored,
      retainageOnWork: retainageOnWork2,
      retainageOnStored: retainageOnStored2,
      retainage: retainageOnWork2 + retainageOnStored2
    };
  });
  const retainageOnWork = sum(lines.map((l) => l.retainageOnWork));
  const retainageOnStored = sum(lines.map((l) => l.retainageOnStored));
  const retainageReleasedToDate = input.retainageReleasedToDate ?? 0;
  const totalRetainage = retainageOnWork + retainageOnStored - retainageReleasedToDate;
  const totalCompletedAndStored = sum(lines.map((l) => l.completedAndStored));
  const contractSumToDate = input.originalContractSum + input.netChangeOrders;
  const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage;
  const summary = {
    originalContractSum: input.originalContractSum,
    netChangeOrders: input.netChangeOrders,
    contractSumToDate,
    totalCompletedAndStored,
    retainageOnWork,
    retainageOnStored,
    retainageReleasedToDate,
    totalRetainage,
    totalEarnedLessRetainage,
    previousCertificates: input.previousCertificates,
    currentPaymentDue: totalEarnedLessRetainage - input.previousCertificates,
    balanceToFinishIncludingRetainage: contractSumToDate - totalEarnedLessRetainage
  };
  const result = { input, lines, summary, checks: [] };
  result.checks = verifyPayApplication(result);
  return result;
}
function verifyPayApplication(r) {
  const checks = new CheckList();
  const B = (n) => BigInt(n);
  const rate = (cents, bp) => {
    const p = B(cents) * B(bp);
    const neg = p < 0n;
    const a = neg ? -p : p;
    let q = a / 10000n;
    if (a % 10000n * 2n >= 10000n) q += 1n;
    return neg ? -q : q;
  };
  let total = 0n;
  let retWork = 0n;
  let retStored = 0n;
  let scheduled = 0n;
  let lineErrors = 0;
  let firstLineError = "";
  const overBilled = [];
  r.input.lines.forEach((l, i) => {
    const out = r.lines[i];
    const work = B(l.previouslyCompleted) + B(l.thisPeriod);
    const cs = work + B(l.materialsStored);
    const rw = rate(Number(work), l.retainageOnWorkBp ?? r.input.retainageOnWorkBp);
    const rs = rate(l.materialsStored, r.input.retainageOnStoredBp);
    total += cs;
    retWork += rw;
    retStored += rs;
    scheduled += B(l.scheduledValue);
    const ok = out !== void 0 && B(out.completedAndStored) === cs && B(out.balanceToFinish) === B(l.scheduledValue) - cs && B(out.retainageOnWork) === rw && B(out.retainageOnStored) === rs;
    if (!ok) {
      lineErrors++;
      if (!firstLineError) firstLineError = `item ${l.itemNo}`;
    }
    const sv = B(l.scheduledValue);
    const within = sv >= 0n ? cs >= 0n && cs <= sv : cs <= 0n && cs >= sv;
    if (!within) overBilled.push(l.itemNo);
  });
  checks.that("lines-recompute", "Every line recomputes the same on a second, independent pass", lineErrors === 0, `${lineErrors} line(s) disagree, first: ${firstLineError}`);
  checks.that("no-overbilling", "No line bills more than its scheduled value", overBilled.length === 0, `Over 100% on item(s): ${overBilled.join(", ")}`);
  const s = r.summary;
  const released = B(r.input.retainageReleasedToDate ?? 0);
  const totalRet = retWork + retStored - released;
  const earned = total - totalRet;
  const contractToDate = B(r.input.originalContractSum) + B(r.input.netChangeOrders);
  checks.that("summary-completed", "Total completed and stored = sum of all lines", B(s.totalCompletedAndStored) === total);
  checks.that("summary-retainage", "Total retainage = line retainage − retainage released to date", B(s.totalRetainage) === totalRet);
  checks.that("summary-earned", "Total earned less retainage = completed and stored − retainage", B(s.totalEarnedLessRetainage) === earned);
  checks.that("summary-due", "Current payment due = earned less retainage − previous certificates", B(s.currentPaymentDue) === earned - B(r.input.previousCertificates));
  checks.that("summary-balance", "Balance to finish including retainage = contract sum to date − earned less retainage", B(s.balanceToFinishIncludingRetainage) === contractToDate - earned);
  checks.that(
    "schedule-matches-contract",
    "Schedule of values adds up to the contract sum to date",
    scheduled === contractToDate,
    `schedule totals ${formatUSD(Number(scheduled))}, contract sum to date is ${formatUSD(Number(contractToDate))}`
  );
  checks.that("release-within-held", "Retainage released to date is not more than retainage held", released >= 0n && released <= retWork + retStored);
  checks.that("due-not-negative", "Current payment due is not negative", s.currentPaymentDue >= 0, "A negative amount usually means the previous certificates figure is wrong", "warning");
  const negativeThisPeriod = r.input.lines.filter((l) => l.thisPeriod < 0).map((l) => l.itemNo);
  checks.that("no-negative-period", "No line has negative work this period", negativeThisPeriod.length === 0, `Negative on item(s): ${negativeThisPeriod.join(", ")}`, "warning");
  return checks.all;
}

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
function percentTextFromBp(bp) {
  assertBp(bp);
  if (bp < 0) throw new Error("A percent rate cannot be negative");
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

// packages/core/src/construction/payappcheck.ts
var PAY_APP_FIELDS = [
  { field: "itemNo", label: "Item", kind: "text" },
  { field: "description", label: "Description", kind: "text" },
  { field: "scheduledValue", label: "Scheduled value", kind: "amount" },
  { field: "previous", label: "Previous work", kind: "amount" },
  { field: "thisPeriod", label: "This period", kind: "amount" },
  { field: "stored", label: "Materials stored", kind: "amount" },
  { field: "completedAndStored", label: "Total completed and stored", kind: "amount" },
  { field: "percent", label: "Percent complete", kind: "percent" },
  { field: "balance", label: "Balance to finish", kind: "amount" },
  { field: "retainage", label: "Retainage", kind: "amount" }
];
var AMOUNT_FIELDS = ["scheduledValue", "previous", "thisPeriod", "stored", "completedAndStored", "balance", "retainage"];
var FIELD_LABEL = Object.fromEntries(PAY_APP_FIELDS.map((f) => [f.field, f.label]));
var PayAppFormatError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PayAppFormatError";
  }
};
function normalize(text) {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9%#]+/g, " ").trim();
}
var HEADER_PATTERNS = [
  ["retainage", /\bretain|\bretention/],
  ["balance", /\bbalance\b|\bto finish\b|\bremaining\b/],
  ["percent", /%|\bpercent|\bpct\b/],
  ["completedAndStored", /\bcompleted and stored\b|\btotal completed\b|\btotal to date\b|\bcompleted to date\b/],
  ["stored", /\bstored\b|\bmaterials?\b/],
  ["previous", /\bprevious|\bprior\b|\bprev\b/],
  ["thisPeriod", /\bthis (period|application|month|billing|estimate|invoice)\b|\bcurrent (period|application|month|billing)\b/],
  ["scheduledValue", /\bscheduled? (value|amount)s?\b|\bcontract (value|amount)\b|^value$|\bbudget\b/],
  ["description", /\bdescription\b|\bscope\b|^work$/],
  ["itemNo", /^item\b|^(no|#|line|number|line no|line number)$/]
];
function fieldForHeader(text) {
  const n = normalize(text);
  if (!n) return null;
  for (const [field, re] of HEADER_PATTERNS) if (re.test(n)) return field;
  return null;
}
function mapPayAppHeaders(headers) {
  const map = {};
  headers.forEach((text, col) => {
    const field = fieldForHeader(text);
    if (field && map[field] === void 0) map[field] = col;
  });
  return map;
}
var usable = (m) => m.scheduledValue !== void 0 && (m.previous !== void 0 || m.thisPeriod !== void 0);
var HEADER_SEARCH_ROWS = 60;
function payAppHeaderTexts(rows, headerRow, twoRows = false) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out = [];
  for (let c = 0; c < width; c++) {
    const lower = (rows[headerRow]?.[c] ?? "").trim();
    const upper = twoRows ? (rows[headerRow - 1]?.[c] ?? "").trim() : "";
    out.push([upper, lower].filter(Boolean).join(" "));
  }
  return out;
}
function detectPayAppColumns(rows) {
  if (rows.every((r) => r.every((c) => c.trim() === ""))) throw new PayAppFormatError("The sheet is empty.");
  let best = null;
  let bestScore = 0;
  let mostSeen = 0;
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    for (const twoRows of i > 0 ? [false, true] : [false]) {
      const headers = payAppHeaderTexts(rows, i, twoRows);
      const columns = mapPayAppHeaders(headers);
      const score = Object.keys(columns).length;
      mostSeen = Math.max(mostSeen, score);
      if (usable(columns) && score >= 3 && score > bestScore) {
        best = { headerRow: i, columns, headers };
        bestScore = score;
      }
    }
  }
  if (!best) {
    throw new PayAppFormatError(
      `No header row was found in the first ${limit} row(s). A header row needs a column for scheduled value and a column for previous work or work this period` + (mostSeen > 0 ? `; the closest row named ${mostSeen} of the expected column(s).` : "; no row named any of the expected columns.")
    );
  }
  return best;
}
var PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
var ACCOUNTING_DASH = /^\$?\s*[-–—]\s*$/;
function parseSheetAmount(raw) {
  const s = raw.trim();
  if (s === "") return { kind: "blank" };
  if (ACCOUNTING_DASH.test(s)) return { kind: "ok", cents: 0, clean: true };
  try {
    if (PLAIN_NUMBER.test(s)) {
      const { cents, clean } = decimalToCents(s);
      return { kind: "ok", cents, clean };
    }
    return { kind: "ok", cents: parseAmount(s), clean: true };
  } catch {
    return { kind: "bad" };
  }
}
var SUM_LABEL = /^(grand\s+totals?|sub\s*-?\s*totals?|totals?)\s*[:;.,\-–—]*$/i;
function payAppSumLabel(text) {
  const m = SUM_LABEL.exec(text.trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  return word.startsWith("grand") ? "grand" : word.startsWith("sub") ? "subtotal" : "total";
}
function extractPayAppRows(rows, headerRow, columns, excludedRows = []) {
  const out = { lines: [], totalsRow: null, sumRows: [], unparsed: [], leftOut: [], afterTotals: [], excluded: [], imprecise: [] };
  const marked = new Set(excludedRows);
  const cell = (row, field) => {
    const col = columns[field];
    return col === void 0 ? "" : (row[col] ?? "").trim();
  };
  let sectionStart = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === "")) continue;
    const sheetRow = r + 1;
    const itemNo = cell(row, "itemNo");
    const description = cell(row, "description");
    const firstText = row.find((c) => c.trim() !== "")?.trim() ?? "";
    const label = itemNo || description || firstText;
    const amounts = {};
    const bad = [];
    const rounded = [];
    for (const field of AMOUNT_FIELDS) {
      if (columns[field] === void 0) continue;
      const raw = cell(row, field);
      const parsed = parseSheetAmount(raw);
      if (parsed.kind === "bad") bad.push(`${FIELD_LABEL[field]}: "${raw}" is not an amount`);
      else if (parsed.kind === "ok") {
        amounts[field] = parsed.cents;
        if (!parsed.clean) rounded.push(`${FIELD_LABEL[field]}: ${raw} has more precision than a cent and was read as ${formatUSD(parsed.cents)}`);
      }
    }
    const wordsOnly = Object.keys(amounts).length === 0 && AMOUNT_FIELDS.every((f) => columns[f] === void 0 || !/\d/.test(cell(row, f)));
    if (Object.keys(amounts).length === 0 && (bad.length === 0 || wordsOnly)) {
      out.leftOut.push({ sheetRow, reason: "No amounts in the mapped columns (a heading or a note)" });
      continue;
    }
    if (marked.has(sheetRow)) {
      out.excluded.push({ sheetRow, reason: "Marked as not a schedule line; its amounts are not checked and are in no total" });
      continue;
    }
    if (bad.length) {
      out.unparsed.push({ sheetRow, reason: bad.join("; ") });
      continue;
    }
    for (const reason of rounded) out.imprecise.push({ sheetRow, reason });
    const kind = payAppSumLabel(label);
    if (kind) {
      const sumRow = { sheetRow, values: amounts, kind, label, sectionStart, lineCount: out.lines.length };
      out.sumRows.push(sumRow);
      if (kind !== "subtotal") out.totalsRow = { sheetRow, values: amounts };
      sectionStart = out.lines.length;
      continue;
    }
    const percent = cell(row, "percent");
    out.lines.push({
      sheetRow,
      itemNo,
      description,
      scheduledValue: amounts.scheduledValue ?? 0,
      previous: amounts.previous ?? 0,
      thisPeriod: amounts.thisPeriod ?? 0,
      stored: amounts.stored ?? 0,
      stated: {
        ...amounts.completedAndStored !== void 0 ? { completedAndStored: amounts.completedAndStored } : {},
        ...amounts.balance !== void 0 ? { balance: amounts.balance } : {},
        ...amounts.retainage !== void 0 ? { retainage: amounts.retainage } : {},
        ...percent ? { percent } : {}
      }
    });
  }
  if (out.sumRows.length) {
    for (const l of out.lines.slice(sectionStart)) out.afterTotals.push({ sheetRow: l.sheetRow, reason: "Has amounts but is below the last totals row, so no total on the sheet covers it" });
  }
  return out;
}
function percentCellMatches(raw, expectedBp) {
  const s = raw.trim();
  const hasSign = s.endsWith("%");
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(hasSign ? s.slice(0, -1).trim() : s);
  if (!m || !m[2] && !m[3]) return false;
  const frac = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) return false;
  const digits = BigInt((m[2] ?? "") + frac || "0") * (m[1] === "-" ? -1n : 1n);
  const shownDecimals = Math.max(0, frac.length - exponent);
  const scaled = (power) => {
    const e = exponent - frac.length + power;
    return e >= 0 ? digits * 10n ** BigInt(e) : digits / 10n ** BigInt(-e);
  };
  const expected = BigInt(expectedBp) * 10000n;
  const tolerance = (decimals) => decimals >= 2 ? 5000n : 5n * 10n ** BigInt(5 - decimals);
  const close = (value, decimals) => {
    const diff = value > expected ? value - expected : expected - value;
    return diff <= tolerance(decimals);
  };
  if (close(scaled(6), shownDecimals)) return true;
  return !hasSign && close(scaled(8), Math.max(0, shownDecimals - 2));
}
function assertRate(bp, label) {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 1e4) throw new Error(`${label} must be between 0% and 100%`);
}
var rowList = (notes) => {
  const shown = notes.slice(0, 12).map((n) => `row ${n.sheetRow} (${n.reason})`);
  return shown.join("; ") + (notes.length > shown.length ? `; and ${notes.length - shown.length} more` : "");
};
function verifyPayAppTotals(lines, totals) {
  const B = (n) => BigInt(n);
  const big = { sv: 0n, previous: 0n, thisPeriod: 0n, stored: 0n, retainage: 0n };
  let linesAgree = true;
  for (const l of lines) {
    big.sv += B(l.scheduledValue);
    big.previous += B(l.previous);
    big.thisPeriod += B(l.thisPeriod);
    big.stored += B(l.stored);
    big.retainage += B(l.retainage);
    if (B(l.completedAndStored) !== B(l.previous) + B(l.thisPeriod) + B(l.stored) || B(l.balanceToFinish) !== B(l.scheduledValue) - B(l.completedAndStored)) linesAgree = false;
  }
  const work = big.previous + big.thisPeriod;
  const passed = linesAgree && B(totals.scheduledValue) === big.sv && B(totals.previous) === big.previous && B(totals.thisPeriod) === big.thisPeriod && B(totals.stored) === big.stored && B(totals.completedAndStored) === work + big.stored && B(totals.balance) === big.sv - work - big.stored && B(totals.retainage) === big.retainage;
  return {
    id: "totals-readd",
    label: "Recomputed totals re-add on a second pass: completed and stored = previous + this period + stored, and balance = scheduled value − completed and stored",
    passed,
    severity: "error"
  };
}
function checkPayApplication(rows, options) {
  const { columns, headerRow } = options;
  assertRate(options.retainageOnWorkBp, "Retainage on work");
  assertRate(options.retainageOnStoredBp, "Retainage on stored materials");
  if (!Number.isSafeInteger(headerRow) || headerRow < 0 || headerRow >= rows.length) throw new Error("The header row is not a row of this sheet");
  if (columns.scheduledValue === void 0) throw new Error("Choose the column that holds the scheduled value");
  if (columns.previous === void 0 && columns.thisPeriod === void 0) throw new Error("Choose the column for previous work or for work this period");
  const used = Object.values(columns).filter((c) => c !== void 0);
  if (new Set(used).size !== used.length) throw new Error("Two fields are mapped to the same column");
  const x = extractPayAppRows(rows, headerRow, columns, options.excludedRows ?? []);
  if (x.lines.length === 0) {
    throw new PayAppFormatError(
      x.unparsed.length ? `No schedule line could be read below the header row. ${rowList(x.unparsed)}` : "No schedule lines with amounts were found below the header row."
    );
  }
  const application = computePayApplication({
    applicationNo: 1,
    periodTo: "",
    originalContractSum: sum(x.lines.map((l) => l.scheduledValue)),
    netChangeOrders: 0,
    retainageOnWorkBp: options.retainageOnWorkBp,
    retainageOnStoredBp: options.retainageOnStoredBp,
    previousCertificates: 0,
    lines: x.lines.map((l) => ({
      itemNo: l.itemNo || `row ${l.sheetRow}`,
      description: l.description,
      scheduledValue: l.scheduledValue,
      previouslyCompleted: l.previous,
      thisPeriod: l.thisPeriod,
      materialsStored: l.stored
    }))
  });
  const checks = new CheckList();
  const findings = [];
  const sameRates = options.retainageOnWorkBp === options.retainageOnStoredBp;
  const workRate = formatPercentBp(options.retainageOnWorkBp);
  const storedRate = formatPercentBp(options.retainageOnStoredBp);
  checks.that("rows-readable", "Every row with amounts could be read", x.unparsed.length === 0, `${x.unparsed.length} row(s) could not be read and are not in the totals: ${rowList(x.unparsed)}`);
  const keep = /* @__PURE__ */ new Set(["lines-recompute", "summary-completed", "summary-retainage", "no-overbilling", "no-negative-period"]);
  checks.addAll(application.checks.filter((c) => keep.has(c.id)));
  const lines = x.lines.map((l, i) => {
    const c = application.lines[i];
    const who = `Row ${l.sheetRow}${l.itemNo ? ` (item ${l.itemNo})` : ""}`;
    const compare = (id, name, formula, stated, expected, alsoAccepted) => {
      if (stated === void 0) return;
      const passed = stated === expected || alsoAccepted !== void 0 && stated === alsoAccepted;
      checks.that(`row-${l.sheetRow}-${id}`, `${who}: ${name} on the sheet (${formatUSD(stated)}) = ${formula} (${formatUSD(expected)})`, passed, `off by ${formatUSD(stated - expected)}`);
      if (!passed) findings.push({ sheetRow: l.sheetRow, item: l.itemNo, what: `${FIELD_LABEL[id]} differs from ${formula}`, onSheet: formatUSD(stated), recomputed: formatUSD(expected), difference: formatUSD(stated - expected) });
    };
    compare("completedAndStored", "completed and stored", "previous + this period + stored", l.stated.completedAndStored, c.completedAndStored);
    compare("balance", "balance to finish", "scheduled value − completed and stored", l.stated.balance, c.balanceToFinish);
    compare(
      "retainage",
      "retainage",
      sameRates ? `${workRate} of completed work and stored materials` : `${workRate} of completed work + ${storedRate} of stored materials`,
      l.stated.retainage,
      c.retainage,
      // With one rate for both, a sheet may round once on the line total instead of on each part.
      sameRates ? applyRate(c.completedAndStored, options.retainageOnWorkBp) : void 0
    );
    if (l.stated.percent !== void 0) {
      const expected = formatPercentBp(c.percentCompleteBp);
      const passed = percentCellMatches(l.stated.percent, c.percentCompleteBp);
      checks.that(`row-${l.sheetRow}-percent`, `${who}: percent complete on the sheet (${l.stated.percent}) agrees with completed and stored ÷ scheduled value (${expected})`, passed, void 0, "warning");
      if (!passed) findings.push({ sheetRow: l.sheetRow, item: l.itemNo, what: "Percent complete differs from completed and stored ÷ scheduled value", onSheet: l.stated.percent, recomputed: expected, difference: "" });
    }
    return { ...l, completedAndStored: c.completedAndStored, percentCompleteBp: c.percentCompleteBp, balanceToFinish: c.balanceToFinish, retainage: c.retainage };
  });
  const totals = {
    scheduledValue: sum(lines.map((l) => l.scheduledValue)),
    previous: sum(lines.map((l) => l.previous)),
    thisPeriod: sum(lines.map((l) => l.thisPeriod)),
    stored: sum(lines.map((l) => l.stored)),
    completedAndStored: sum(lines.map((l) => l.completedAndStored)),
    balance: sum(lines.map((l) => l.balanceToFinish)),
    retainage: sum(lines.map((l) => l.retainage))
  };
  checks.add(verifyPayAppTotals(lines, totals));
  const columnSum = (scope) => ({
    scheduledValue: sum(scope.map((l) => l.scheduledValue)),
    previous: sum(scope.map((l) => l.previous)),
    thisPeriod: sum(scope.map((l) => l.thisPeriod)),
    stored: sum(scope.map((l) => l.stored)),
    completedAndStored: sum(scope.map((l) => l.stated.completedAndStored ?? 0)),
    balance: sum(scope.map((l) => l.stated.balance ?? 0)),
    retainage: sum(scope.map((l) => l.stated.retainage ?? 0))
  });
  x.sumRows.forEach((t, index) => {
    const isLast = x.totalsRow?.sheetRow === t.sheetRow;
    const all = columnSum(x.lines.slice(0, t.lineCount));
    const section = columnSum(x.lines.slice(t.sectionStart, t.lineCount));
    const fields = AMOUNT_FIELDS.filter((f) => t.values[f] !== void 0);
    const agrees = (basis2) => fields.every((f) => t.values[f] === basis2[f]);
    const basis = t.kind === "subtotal" ? section : t.kind === "grand" || index === 0 ? all : agrees(all) ? all : agrees(section) ? section : all;
    const scopeText = basis === all ? "sum of that column's lines" : "sum of the lines since the row above it that holds totals";
    for (const field of fields) {
      const stated = t.values[field];
      const added = basis[field];
      const name = FIELD_LABEL[field].toLowerCase();
      const passed = stated === added;
      if (isLast) {
        checks.that(`totals-${field}`, `Totals row (row ${t.sheetRow}): ${name} on the sheet (${formatUSD(stated)}) = ${scopeText} (${formatUSD(added)})`, passed, `off by ${formatUSD(stated - added)}`);
        if (!passed) findings.push({ sheetRow: t.sheetRow, item: "Totals", what: `${FIELD_LABEL[field]} total differs from the sum of the column`, onSheet: formatUSD(stated), recomputed: formatUSD(added), difference: formatUSD(stated - added) });
      } else {
        const word = t.kind === "subtotal" ? "subtotal" : "total";
        checks.that(`sum-${t.sheetRow}-${field}`, `Row ${t.sheetRow} ("${t.label}"): ${name} on the sheet (${formatUSD(stated)}) = sum of the lines above it (${formatUSD(added)})`, passed, `off by ${formatUSD(stated - added)}`);
        if (!passed) findings.push({ sheetRow: t.sheetRow, item: t.label, what: `${FIELD_LABEL[field]} ${word} differs from the sum of the lines above it`, onSheet: formatUSD(stated), recomputed: formatUSD(added), difference: formatUSD(stated - added) });
      }
    }
  });
  for (const n of x.afterTotals) {
    checks.that(`row-${n.sheetRow}-after-totals`, `Row ${n.sheetRow} is covered by a totals row on the sheet`, false, "It has amounts but is below the last totals row. It was read as a schedule line and is in the recomputed totals; mark it as not a schedule line if it is something else");
    const line = x.lines.find((l) => l.sheetRow === n.sheetRow);
    findings.push({ sheetRow: n.sheetRow, item: line?.itemNo ?? "", what: "Row with amounts below the last totals row; no total on the sheet covers it", onSheet: line ? formatUSD(line.scheduledValue) : "", recomputed: "", difference: "" });
  }
  for (const n of x.excluded) {
    checks.that(`row-${n.sheetRow}-excluded`, `Row ${n.sheetRow} was checked as a schedule line`, false, "You marked it as not a schedule line; its amounts were not checked and are in no total", "warning");
  }
  checks.that("totals-row-found", "The sheet has a totals row to compare column sums with", x.totalsRow !== null, 'No row labelled exactly "Total", "Totals", or "Grand total" was found, so column sums are shown without a comparison', "warning");
  for (const [field, name] of [["previous", "previous work"], ["thisPeriod", "work this period"], ["stored", "materials stored"]]) {
    if (columns[field] === void 0) checks.that(`unmapped-${field}`, `A column is mapped for ${name}`, false, "None is mapped, so it is taken as zero on every line", "warning");
  }
  for (const [field, name] of [["completedAndStored", "completed and stored"], ["balance", "balance to finish"], ["retainage", "retainage"]]) {
    if (columns[field] === void 0) checks.that(`unmapped-${field}`, `A column is mapped for ${name}`, false, "None is mapped, so the sheet has nothing to compare for it", "warning");
  }
  checks.that("cent-precision", "Every amount on the sheet is in whole cents", x.imprecise.length === 0, rowList(x.imprecise), "warning");
  checks.that("rows-left-out", "Every row below the header has amounts in the mapped columns", x.leftOut.length === 0, `${x.leftOut.length} row(s) with no amounts were left out: ${rowList(x.leftOut)}`, "warning");
  return { options, lines, findings, totals, totalsRow: x.totalsRow, sumRows: x.sumRows, unparsed: x.unparsed, leftOut: x.leftOut, afterTotals: x.afterTotals, excluded: x.excluded, imprecise: x.imprecise, application, checks: checks.all };
}
function payAppUncheckedRows(r) {
  return r.unparsed.length + r.excluded.length;
}
function payAppNoFindingsText(r) {
  const unchecked = payAppUncheckedRows(r);
  return unchecked === 0 ? "No differences found" : `No differences in the lines that were checked, but ${unchecked} row(s) with amounts were not checked (see the rows not read)`;
}
function payAppCheckTables(r) {
  const d = (c) => c === void 0 ? "" : toDecimal(c);
  const findings = [
    ["Row", "Item", "Finding", "On the sheet", "Recomputed", "Difference"],
    ...r.findings.length ? r.findings.map((f) => [f.sheetRow, f.item, f.what, f.onSheet, f.recomputed, f.difference]) : [["", "", payAppNoFindingsText(r), "", "", ""]]
  ];
  const lines = [
    ["Row", "Item", "Description", "Scheduled value", "Previous work", "This period", "Materials stored", "Completed and stored (sheet)", "Completed and stored (recomputed)", "Balance to finish (sheet)", "Balance to finish (recomputed)", "Retainage (sheet)", "Retainage (recomputed)"],
    ...r.lines.map((l) => [l.sheetRow, l.itemNo, l.description, d(l.scheduledValue), d(l.previous), d(l.thisPeriod), d(l.stored), d(l.stated.completedAndStored), d(l.completedAndStored), d(l.stated.balance), d(l.balanceToFinish), d(l.stated.retainage), d(l.retainage)]),
    ["", "Totals (recomputed)", "", d(r.totals.scheduledValue), d(r.totals.previous), d(r.totals.thisPeriod), d(r.totals.stored), "", d(r.totals.completedAndStored), "", d(r.totals.balance), "", d(r.totals.retainage)]
  ];
  const notRead = [
    ["Row", "Status", "Reason"],
    ...r.unparsed.map((n) => [n.sheetRow, "Could not be read", n.reason]),
    ...r.excluded.map((n) => [n.sheetRow, "Left out", n.reason]),
    ...r.leftOut.map((n) => [n.sheetRow, "Left out", n.reason]),
    ...r.imprecise.map((n) => [n.sheetRow, "Rounded to the cent", n.reason])
  ];
  return { findings, lines, notRead };
}

export {
  formatPercentBp,
  percentTextFromBp,
  computePayApplication,
  PAY_APP_FIELDS,
  PayAppFormatError,
  mapPayAppHeaders,
  HEADER_SEARCH_ROWS,
  payAppHeaderTexts,
  detectPayAppColumns,
  parseSheetAmount,
  payAppSumLabel,
  extractPayAppRows,
  percentCellMatches,
  verifyPayAppTotals,
  checkPayApplication,
  payAppUncheckedRows,
  payAppNoFindingsText,
  payAppCheckTables
};
