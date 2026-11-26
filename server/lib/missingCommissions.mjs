// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  sumCsvColumn,
  toCsv
} from "./csv.mjs";
import {
  scaledParse
} from "./sheetInput.mjs";
import {
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmDaysBetween,
  pmNormalizeHeader
} from "./reconcile.mjs";
import {
  CheckList,
  applyRate,
  assertCents,
  formatUSD,
  percentToBasisPoints,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/insurance/sheets.ts
function insNormalizeHeader(text) {
  return pmNormalizeHeader(text.replace(/%/g, " pct ").replace(/#/g, " number "));
}
function insRateToBasisPoints(raw, format) {
  const s = raw.trim();
  if (s.endsWith("%")) return percentToBasisPoints(s.slice(0, -1).trim());
  if (format === "percent") return percentToBasisPoints(s);
  if (!PLAIN_NUMBER.test(s)) throw new Error(`not a valid rate: "${raw}"`);
  const bp = scaledParse(s, 4, "rate");
  if (bp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`not a valid rate: "${raw}"`);
  return Number(bp);
}
var PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function isFraction(s) {
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || !m[1] && !m[2]) return false;
  const point = (m[1] ?? "").length + Number(m[3] ?? 0);
  return /^0*$/.test(`${m[1] ?? ""}${m[2] ?? ""}`.slice(0, Math.max(point, 0)));
}
function insBpText(bp) {
  if (!Number.isSafeInteger(bp) || bp < 0) throw new Error(`not a valid rate in basis points: ${bp}`);
  const pctWhole = Math.floor(bp / 100);
  return `${pctWhole}.${String(bp % 100).padStart(2, "0")}`;
}
function matchHeaders(header, order, synonyms, refuse) {
  const names = header.map(insNormalizeHeader);
  const found = Object.fromEntries(order.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  for (const exact of [true, false]) {
    for (const role of order) {
      if (found[role] >= 0) continue;
      search: for (const syn of synonyms[role]) {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (taken.has(i) || name === "") continue;
          if (exact ? name === syn : ` ${name} `.includes(` ${syn} `) && !refuse[role]?.test(name)) {
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
function insGuessColumns(rows, order, synonyms, refuse, rateRole, atHeaderRow) {
  let best;
  if (atHeaderRow !== void 0) best = { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], order, synonyms, refuse) };
  else {
    const firstFilled = Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
    best = { headerRow: firstFilled, columns: matchHeaders(rows[firstFilled] ?? [], order, synonyms, refuse) };
    let bestScore = Object.values(best.columns).filter((c) => c >= 0).length;
    rows.slice(0, 25).forEach((row, i) => {
      const columns = matchHeaders(row, order, synonyms, refuse);
      const score = Object.values(columns).filter((c) => c >= 0).length;
      if (score > bestScore) {
        bestScore = score;
        best = { headerRow: i, columns };
      }
    });
  }
  return { ...best, rateFormat: insGuessRateFormat(rows, best.headerRow, best.columns[rateRole]) };
}
function insGuessRateFormat(rows, headerRow, col) {
  if (col < 0) return "percent";
  let filled = 0;
  for (const row of rows.slice(headerRow + 1)) {
    const s = (row[col] ?? "").trim();
    if (!s || s.endsWith("%") || row.some(insIsTotalLabel)) continue;
    if (!isFraction(s)) return "percent";
    filled++;
  }
  return filled > 0 ? "fraction" : "percent";
}
function insHeaderList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}
function insNeedColumn(col, label, rows, headerRow) {
  if (col === void 0 || !Number.isSafeInteger(col) || col < 0) {
    throw new Error(`No "${label}" column could be identified (${insHeaderList(rows, headerRow)}). Choose it in the column mapping.`);
  }
  return col;
}
function insAssertDistinct(columns) {
  const used = Object.values(columns).filter((c) => c >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
}
var insCell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
function insOptionalCents(raw, what, reasons) {
  if (raw === "") return void 0;
  try {
    return pmCellToCents(raw);
  } catch {
    reasons.push(`the ${what} "${raw}" could not be read`);
    return void 0;
  }
}
function insOptionalRate(raw, format, what, reasons) {
  if (raw === "") return void 0;
  try {
    return insRateToBasisPoints(raw, format);
  } catch {
    reasons.push(`the ${what} "${raw}" could not be read as a percent with at most two decimals`);
    return void 0;
  }
}
function insOptionalDate(raw, what, reasons) {
  if (raw === "") return "";
  try {
    return pmCellToIsoDate(raw);
  } catch {
    reasons.push(`the ${what} "${raw}" could not be read`);
    return "";
  }
}
function insIsTotalLabel(cell) {
  return /^(grand |sub ?|statement |report |page )?totals?( commissions?| paid| due| premium| amount)?:?$/i.test(cell.trim());
}
function insPolicyKey(policy) {
  return policy.trim().replace(/\s+/g, " ").toUpperCase();
}
function insPolicyLooseKey(policy) {
  return policy.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
}
function insNameKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// packages/core/src/insurance/statement.ts
var INS_STATEMENT_ROLES = ["policy", "insured", "product", "transactionType", "effectiveDate", "premium", "rate", "commission", "producer"];
var INS_STATEMENT_LABELS = {
  policy: "Policy number",
  insured: "Insured name",
  product: "Product or line",
  transactionType: "Transaction type",
  effectiveDate: "Effective date",
  premium: "Premium",
  rate: "Commission rate",
  commission: "Commission amount",
  producer: "Producer or agent"
};
var INS_STATEMENT_SYNONYMS = {
  policy: ["policy number", "policy no", "policy num", "policy id", "policy", "contract number", "certificate number", "member id", "account number"],
  rate: ["commission rate", "commission rate pct", "commission pct", "commission percent", "comm rate", "comm pct", "rate pct", "rate", "pct", "percent"],
  premium: ["premium", "premium amount", "written premium", "paid premium", "premium paid", "commissionable premium", "billed premium"],
  commission: ["commission amount", "commission", "commission paid", "commission due", "commission earned", "comm amount", "comm", "net commission", "agent commission", "amount paid", "payment amount", "amount"],
  effectiveDate: ["effective date", "eff date", "policy effective date", "effective", "transaction date", "trans date", "date"],
  transactionType: ["transaction type", "trans type", "transaction code", "trans code", "transaction", "activity", "type"],
  producer: ["producer", "producer name", "producer code", "agent", "agent name", "agent code", "writing agent", "sub agent", "subagent"],
  insured: ["insured name", "insured", "named insured", "policyholder", "policy holder", "client name", "customer name", "member name", "client", "customer", "member", "name"],
  product: ["product", "line of business", "lob", "product type", "policy type", "coverage", "plan", "line"]
};
var ORDER = ["policy", "rate", "premium", "commission", "effectiveDate", "producer", "transactionType", "insured", "product"];
var INS_STATEMENT_REFUSE = {
  commission: /\b(rate|pct|percent|date|type|code)\b/,
  premium: /\b(rate|pct|percent|date|x)\b/,
  rate: /\b(premium x|date)\b/,
  policy: /\b(date|type|premium|holder)\b/
};
function insGuessStatementColumns(rows, atHeaderRow) {
  return insGuessColumns(rows, ORDER, INS_STATEMENT_SYNONYMS, INS_STATEMENT_REFUSE, "rate", atHeaderRow);
}
function insExtractStatementLines(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The statement has no rows under its header row.");
  const c = mapping.columns;
  const commissionCol = insNeedColumn(c.commission, INS_STATEMENT_LABELS.commission, rows, mapping.headerRow);
  insAssertDistinct(c);
  const lines = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const policy = insCell(row, c.policy);
    const rawCommission = insCell(row, commissionCol);
    const reasons = [];
    if (insIsTotalLabel(policy) || !policy && row.some(insIsTotalLabel)) {
      const total = { rowNumber };
      const amount = insOptionalCents(rawCommission, "total", []);
      if (amount !== void 0) total.commission = amount;
      totalRows.push(total);
      return;
    }
    const commission = insOptionalCents(rawCommission, "commission amount", reasons);
    if (rawCommission === "") reasons.push("no commission amount");
    const premium = insOptionalCents(insCell(row, c.premium), "premium", reasons);
    const rateBp = insOptionalRate(insCell(row, c.rate), mapping.rateFormat, "commission rate", reasons);
    const effectiveDate = insOptionalDate(insCell(row, c.effectiveDate), "effective date", reasons);
    if (reasons.length || commission === void 0) {
      problems.push({ rowNumber, reason: reasons.join("; ") });
      return;
    }
    const line = { rowNumber, policy, insured: insCell(row, c.insured), product: insCell(row, c.product), transactionType: insCell(row, c.transactionType), effectiveDate, producer: insCell(row, c.producer), commission };
    if (premium !== void 0) line.premium = premium;
    if (rateBp !== void 0) line.rateBp = rateBp;
    lines.push(line);
  });
  if (lines.length === 0 && problems.length === 0) throw new Error("No statement lines were found under the header row. Check the header row and the column mapping.");
  return { lines, problems, totalRows };
}
var COMMISSION_HEADERS = ["Row", "Policy number", "Insured name", "Product", "Transaction type", "Effective date", "Producer", "Premium", "Commission rate %", "Commission amount", "Premium x rate", "Difference"];
function commissionStatementRows(lines) {
  return [
    [...COMMISSION_HEADERS],
    ...lines.map((l) => [
      l.rowNumber,
      l.policy,
      l.insured,
      l.product,
      l.transactionType,
      l.effectiveDate,
      l.producer,
      l.premium === void 0 ? "" : toDecimal(l.premium),
      l.rateBp === void 0 ? "" : insBpText(l.rateBp),
      toDecimal(l.commission),
      l.computedCommission === void 0 ? "" : toDecimal(l.computedCommission),
      l.rateDifference === void 0 ? "" : toDecimal(l.rateDifference)
    ])
  ];
}
function validate(lines) {
  const seen = /* @__PURE__ */ new Set();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.rowNumber)) throw new Error("Every statement line needs a whole row number.");
    if (seen.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the statement lines.`);
    seen.add(l.rowNumber);
    assertCents(l.commission, `commission on row ${l.rowNumber}`);
    if (l.premium !== void 0) assertCents(l.premium, `premium on row ${l.rowNumber}`);
    if (l.rateBp !== void 0 && (!Number.isSafeInteger(l.rateBp) || l.rateBp < 0)) throw new Error(`Row ${l.rowNumber}: the commission rate must be whole basis points, zero or more.`);
  }
}
function normalizeCommissionStatement(input) {
  validate(input.lines);
  for (const [v, what] of [[input.statementTotal, "statement total"], [input.paymentAmount, "payment amount"], [input.fileTotal, "file total"]]) if (v !== void 0) assertCents(v, what);
  const lines = input.lines.map((l) => {
    if (l.premium === void 0 || l.rateBp === void 0) return { ...l };
    const computedCommission = applyRate(l.premium, l.rateBp);
    return { ...l, computedCommission, rateDifference: l.commission - computedCommission };
  });
  const figures = {
    lines,
    lineCount: lines.length,
    commissionTotal: sum(lines.map((l) => l.commission)),
    premiumTotal: sum(lines.map((l) => l.premium ?? 0)),
    rateRows: lines.filter((l) => l.computedCommission !== void 0).length,
    mismatches: lines.filter((l) => l.rateDifference !== void 0 && l.rateDifference !== 0),
    problems: [...input.problems ?? []]
  };
  if (input.statementTotal !== void 0) figures.statementTotal = input.statementTotal;
  if (input.paymentAmount !== void 0) figures.paymentAmount = input.paymentAmount;
  if (input.fileTotal !== void 0) figures.fileTotal = input.fileTotal;
  return { ...figures, checks: verifyCommissionStatement(input.lines, figures) };
}
function verifyCommissionStatement(source, r) {
  validate(source);
  const checks = new CheckList();
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the result; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  checks.equal("count", "Lines read = lines in the result (count)", source.length, r.lines.length);
  let total = 0n;
  let premium = 0n;
  for (let i = source.length - 1; i >= 0; i--) {
    total += BigInt(source[i].commission);
    premium += BigInt(source[i].premium ?? 0);
  }
  const byRow = new Map(r.lines.map((l) => [l.rowNumber, l]));
  const unchanged = source.every((s) => {
    const l = byRow.get(s.rowNumber);
    return l !== void 0 && l.commission === s.commission && l.premium === s.premium && l.rateBp === s.rateBp && l.policy === s.policy;
  });
  checks.that("lines-unchanged", "Every line in the result carries the amounts read from the file", unchanged && byRow.size === r.lines.length);
  checks.cents("recompute", "Commission total = the lines added a second way", Number(total), r.commissionTotal);
  checks.that("totals-shown", "The line count and premium total shown match the second pass", r.lineCount === source.length && BigInt(r.premiumTotal) === premium);
  const csv = toCsv(commissionStatementRows(r.lines));
  checks.cents("export-sum", "The Commission amount column of the export, read back, adds up to the commission total", Number(total), sumCsvColumn(csv, "Commission amount"));
  if (r.statementTotal !== void 0) checks.cents("lines-total", "Sum of lines = statement total entered", r.statementTotal, r.commissionTotal);
  if (r.paymentAmount !== void 0) checks.cents("lines-payment", "Sum of lines = payment received entered", r.paymentAmount, r.commissionTotal);
  if (r.statementTotal !== void 0 && r.paymentAmount !== void 0) checks.cents("total-payment", "Statement total entered = payment received entered", r.statementTotal, r.paymentAmount);
  if (r.fileTotal !== void 0) checks.cents("file-total", "Sum of lines = the file's own total row", r.fileTotal, r.commissionTotal);
  if (r.statementTotal === void 0 && r.paymentAmount === void 0 && r.fileTotal === void 0) {
    checks.that("total-entered", "A statement total or payment amount was entered to compare the lines against", false, "the sum of lines was not compared to anything", "warning");
  }
  let rateRows = 0;
  const off = [];
  let shownOk = true;
  for (const s of source) {
    const l = byRow.get(s.rowNumber);
    if (s.premium === void 0 || s.rateBp === void 0) {
      if (l && (l.computedCommission !== void 0 || l.rateDifference !== void 0)) shownOk = false;
      continue;
    }
    rateRows++;
    const computed = applyRate(s.premium, s.rateBp);
    if (!l || l.computedCommission !== computed || l.rateDifference !== s.commission - computed) shownOk = false;
    if (computed !== s.commission) off.push(`row ${s.rowNumber}: ${formatUSD(s.premium)} × ${insBpText(s.rateBp)}% = ${formatUSD(computed)}, statement shows ${formatUSD(s.commission)}`);
  }
  if (rateRows > 0) {
    checks.that("rate-math", "Premium × rate = commission on every row that shows both", off.length === 0, `${off.length} row(s) differ; first: ${off[0]}`);
    checks.that("rate-shown", "The premium × rate figures and the mismatch list match a second calculation", shownOk && r.rateRows === rateRows && r.mismatches.length === off.length);
  } else {
    checks.that("rate-columns", "Premium and rate are both mapped, so premium × rate can be compared to each commission", false, "no row shows both a premium and a rate; the rate check was not run", "warning");
  }
  return checks.all;
}

// packages/core/src/insurance/carrierSummary.ts
var INS_CARRIER_ROLES = ["carrier", "product", "policy", "premium", "commission"];
var INS_CARRIER_LABELS = {
  carrier: "Carrier",
  product: "Line of business",
  policy: "Policy number",
  premium: "Premium",
  commission: "Commission amount"
};
var CARRIER_WORDS = ["carrier", "carrier name", "insurance carrier", "insurance company", "insurer", "company", "company name", "writing company", "market", "payer", "payor"];
var SYNONYMS = {
  carrier: CARRIER_WORDS,
  product: INS_STATEMENT_SYNONYMS.product,
  policy: INS_STATEMENT_SYNONYMS.policy,
  premium: INS_STATEMENT_SYNONYMS.premium,
  commission: INS_STATEMENT_SYNONYMS.commission
};
var REFUSE = {
  ...INS_STATEMENT_REFUSE.commission ? { commission: INS_STATEMENT_REFUSE.commission } : {},
  ...INS_STATEMENT_REFUSE.premium ? { premium: INS_STATEMENT_REFUSE.premium } : {},
  ...INS_STATEMENT_REFUSE.policy ? { policy: INS_STATEMENT_REFUSE.policy } : {},
  carrier: /\b(date|total|amount|paid|payment)\b/
};
function insGuessCarrierColumns(rows, atHeaderRow) {
  const { headerRow, columns } = insGuessColumns(rows, ["policy", "premium", "commission", "carrier", "product"], SYNONYMS, REFUSE, "commission", atHeaderRow);
  return { headerRow, columns };
}
var INS_NO_CARRIER = "(no carrier named)";
var INS_NO_PRODUCT = "(no line of business)";
function insGroupKey(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
function insExtractCarrierLines(rows, mapping, defaultCarrier = "") {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The sheet has no rows under its header row.");
  const c = mapping.columns;
  const commissionCol = insNeedColumn(c.commission, INS_CARRIER_LABELS.commission, rows, mapping.headerRow);
  insAssertDistinct(c);
  const lines = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const policy = insCell(row, c.policy);
    const rawCommission = insCell(row, commissionCol);
    if (insIsTotalLabel(policy) || !policy && row.some(insIsTotalLabel)) {
      const total = { rowNumber };
      const amount = insOptionalCents(rawCommission, "total", []);
      if (amount !== void 0) total.commission = amount;
      totalRows.push(total);
      return;
    }
    const reasons = [];
    const commission = insOptionalCents(rawCommission, "commission amount", reasons);
    if (rawCommission === "") reasons.push("no commission amount");
    const premium = insOptionalCents(insCell(row, c.premium), "premium", reasons);
    if (reasons.length || commission === void 0) {
      problems.push({ rowNumber, reason: reasons.join("; ") });
      return;
    }
    const line = { rowNumber, carrier: insCell(row, c.carrier) || defaultCarrier.trim(), product: insCell(row, c.product), policy, commission };
    if (premium !== void 0) line.premium = premium;
    lines.push(line);
  });
  if (lines.length === 0 && problems.length === 0) throw new Error("No commission lines were found under the header row. Check the header row and the column mapping.");
  return { lines, problems, totalRows };
}
function insReadCarrierTotalsSheet(rows) {
  let headerRow = -1;
  let carrierCol = -1;
  let totalCol = -1;
  let paymentCol = -1;
  for (let i = 0; i < Math.min(rows.length, 25) && headerRow < 0; i++) {
    const names = (rows[i] ?? []).map(insNormalizeHeader);
    const carrier = names.findIndex((n) => CARRIER_WORDS.includes(n));
    const total = names.findIndex((n) => n === "statement total" || n === "statement amount" || n === "total on statement");
    const payment = names.findIndex((n) => n === "payment received" || n === "payment amount" || n === "deposit amount" || n === "amount received");
    if (carrier >= 0 && (total >= 0 || payment >= 0)) {
      headerRow = i;
      carrierCol = carrier;
      totalCol = total;
      paymentCol = payment;
    }
  }
  if (headerRow < 0) return null;
  const totals = [];
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    if (index <= headerRow) return;
    const carrier = insCell(row, carrierCol);
    const rawTotal = insCell(row, totalCol);
    const rawPayment = insCell(row, paymentCol);
    if (!carrier && !rawTotal && !rawPayment) return;
    const rowNumber = index + 1;
    const reasons = [];
    if (!carrier) reasons.push("an amount with no carrier name");
    if (carrier && seen.has(insGroupKey(carrier))) reasons.push(`the carrier "${carrier}" is listed on an earlier row too`);
    const statementTotal = insOptionalCents(rawTotal, "statement total", reasons);
    const paymentReceived = insOptionalCents(rawPayment, "payment received", reasons);
    if (reasons.length) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    seen.add(insGroupKey(carrier));
    if (statementTotal === void 0 && paymentReceived === void 0) return;
    totals.push({ carrier, ...statementTotal === void 0 ? {} : { statementTotal }, ...paymentReceived === void 0 ? {} : { paymentReceived } });
  });
  return { totals, problems };
}
function validate2(input) {
  const seen = /* @__PURE__ */ new Set();
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.rowNumber)) throw new Error("Every commission line needs a whole row number.");
    if (seen.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the commission lines.`);
    seen.add(l.rowNumber);
    assertCents(l.commission, `commission on row ${l.rowNumber}`);
    if (l.premium !== void 0) assertCents(l.premium, `premium on row ${l.rowNumber}`);
  }
  const entered = /* @__PURE__ */ new Map();
  for (const t of input.statementTotals ?? []) {
    const key = insGroupKey(t.carrier);
    if (entered.has(key)) throw new Error(`${t.carrier.trim() || "The blank carrier"} is listed twice in the statement totals.`);
    if (t.statementTotal !== void 0) assertCents(t.statementTotal, `statement total for ${t.carrier}`);
    if (t.paymentReceived !== void 0) assertCents(t.paymentReceived, `payment received for ${t.carrier}`);
    if (t.statementTotal !== void 0 || t.paymentReceived !== void 0) entered.set(key, t);
  }
  return entered;
}
var byName = (a, b) => a === "" ? 1 : b === "" ? -1 : a < b ? -1 : a > b ? 1 : 0;
function summarizeCommissionsByCarrier(input) {
  const entered = validate2(input);
  const carrierNames = /* @__PURE__ */ new Map();
  const productNames = /* @__PURE__ */ new Map();
  const cells = /* @__PURE__ */ new Map();
  for (const l of input.lines) {
    const carrierKey = insGroupKey(l.carrier);
    const productKey = insGroupKey(l.product);
    if (!carrierNames.has(carrierKey)) carrierNames.set(carrierKey, l.carrier.trim().replace(/\s+/g, " "));
    if (!productNames.has(productKey)) productNames.set(productKey, l.product.trim().replace(/\s+/g, " "));
    const id = `${carrierKey}\0${productKey}`;
    let cell = cells.get(id);
    if (!cell) {
      cell = { carrierKey, productKey, lines: 0, premium: 0, commission: 0 };
      cells.set(id, cell);
    }
    cell.lines++;
    cell.premium = assertCents(cell.premium + (l.premium ?? 0), "premium subtotal");
    cell.commission = assertCents(cell.commission + l.commission, "commission subtotal");
  }
  for (const [key, t] of entered) if (!carrierNames.has(key)) carrierNames.set(key, t.carrier.trim().replace(/\s+/g, " "));
  const carrierName = (key) => carrierNames.get(key) || INS_NO_CARRIER;
  const productName = (key) => productNames.get(key) || INS_NO_PRODUCT;
  const ordered = [...cells.values()].sort((a, b) => byName(a.carrierKey, b.carrierKey) || byName(a.productKey, b.productKey));
  const subtotals = ordered.map((c) => ({ carrier: carrierName(c.carrierKey), product: productName(c.productKey), lines: c.lines, premium: c.premium, commission: c.commission }));
  const carriers = [...carrierNames.keys()].sort(byName).map((key) => {
    const own = ordered.filter((c) => c.carrierKey === key);
    const total = { carrier: carrierName(key), lines: own.reduce((n, c) => n + c.lines, 0), premium: sum(own.map((c) => c.premium)), commission: sum(own.map((c) => c.commission)) };
    const t = entered.get(key);
    if (t?.statementTotal !== void 0) {
      total.statementTotal = t.statementTotal;
      total.statementDifference = total.commission - t.statementTotal;
    }
    if (t?.paymentReceived !== void 0) {
      total.paymentReceived = t.paymentReceived;
      total.paymentDifference = total.commission - t.paymentReceived;
    }
    return total;
  });
  const products = [...productNames.keys()].sort(byName).map((key) => {
    const own = ordered.filter((c) => c.productKey === key);
    return { product: productName(key), lines: own.reduce((n, c) => n + c.lines, 0), premium: sum(own.map((c) => c.premium)), commission: sum(own.map((c) => c.commission)) };
  });
  const figures = {
    subtotals,
    carriers,
    products,
    lineCount: input.lines.length,
    premiumTotal: sum(input.lines.map((l) => l.premium ?? 0)),
    commissionTotal: sum(input.lines.map((l) => l.commission)),
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyCarrierSummary(input, figures) };
}
var shownKey = (name, blank) => name === blank ? "" : insGroupKey(name);
function verifyCarrierSummary(input, r) {
  const entered = validate2(input);
  const checks = new CheckList();
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the result; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const second = /* @__PURE__ */ new Map();
  let total = 0n;
  let premium = 0n;
  for (let i = input.lines.length - 1; i >= 0; i--) {
    const l = input.lines[i];
    const id = `${insGroupKey(l.carrier)}\0${insGroupKey(l.product)}`;
    const cell = second.get(id) ?? { lines: 0, premium: 0n, commission: 0n };
    cell.lines++;
    cell.premium += BigInt(l.premium ?? 0);
    cell.commission += BigInt(l.commission);
    second.set(id, cell);
    total += BigInt(l.commission);
    premium += BigInt(l.premium ?? 0);
  }
  const shownIds = r.subtotals.map((s) => `${shownKey(s.carrier, INS_NO_CARRIER)}\0${shownKey(s.product, INS_NO_PRODUCT)}`);
  const subtotalsOk = new Set(shownIds).size === shownIds.length && shownIds.length === second.size && r.subtotals.every((s, i) => {
    const cell = second.get(shownIds[i]);
    return cell !== void 0 && cell.lines === s.lines && cell.premium === BigInt(s.premium) && cell.commission === BigInt(s.commission);
  });
  checks.equal("count", "Lines read = lines counted in the summary", input.lines.length, r.subtotals.reduce((n, s) => n + s.lines, 0));
  checks.that("subtotals-second", "Every carrier and line-of-business subtotal matches a second pass over the lines", subtotalsOk);
  const carrierKeys = r.carriers.map((c) => shownKey(c.carrier, INS_NO_CARRIER));
  const carriersOk = new Set(carrierKeys).size === carrierKeys.length && r.carriers.every((c, i) => {
    const own = r.subtotals.filter((s) => shownKey(s.carrier, INS_NO_CARRIER) === carrierKeys[i]);
    return c.lines === own.reduce((n, s) => n + s.lines, 0) && BigInt(c.premium) === own.reduce((n, s) => n + BigInt(s.premium), 0n) && BigInt(c.commission) === own.reduce((n, s) => n + BigInt(s.commission), 0n);
  }) && r.subtotals.every((s) => carrierKeys.includes(shownKey(s.carrier, INS_NO_CARRIER)));
  checks.that("carrier-rollup", "Each carrier total is the sum of its line-of-business subtotals", carriersOk);
  const productKeys = r.products.map((p) => shownKey(p.product, INS_NO_PRODUCT));
  const productsOk = new Set(productKeys).size === productKeys.length && r.products.every((p, i) => {
    const own = r.subtotals.filter((s) => shownKey(s.product, INS_NO_PRODUCT) === productKeys[i]);
    return p.lines === own.reduce((n, s) => n + s.lines, 0) && BigInt(p.premium) === own.reduce((n, s) => n + BigInt(s.premium), 0n) && BigInt(p.commission) === own.reduce((n, s) => n + BigInt(s.commission), 0n);
  }) && r.subtotals.every((s) => productKeys.includes(shownKey(s.product, INS_NO_PRODUCT)));
  checks.that("product-rollup", "Each line-of-business total is the sum of that line of business across the carriers", productsOk);
  checks.cents("carriers-grand", "Carrier totals add up to all commission on the lines (added a second way)", Number(total), Number(r.carriers.reduce((n, c) => n + BigInt(c.commission), 0n)));
  checks.cents("products-grand", "Line-of-business totals add up to the same amount", Number(total), Number(r.products.reduce((n, p) => n + BigInt(p.commission), 0n)));
  checks.that("totals-shown", "The line count, premium total, and commission total shown match the second pass", r.lineCount === input.lines.length && BigInt(r.premiumTotal) === premium && BigInt(r.commissionTotal) === total);
  const csv = toCsv(carrierSummaryTables(r).byCarrier);
  checks.cents("export-sum", "The Commission column of the export, read back, adds up to the commission total", Number(total), sumCsvColumn(csv, "Commission"));
  const lineSum = /* @__PURE__ */ new Map();
  for (const l of input.lines) lineSum.set(insGroupKey(l.carrier), (lineSum.get(insGroupKey(l.carrier)) ?? 0n) + BigInt(l.commission));
  const statementOff = [];
  const paymentOff = [];
  let statementCount = 0;
  let paymentCount = 0;
  let shownOk = true;
  for (const [key, t] of entered) {
    const lines = lineSum.get(key) ?? 0n;
    const shown = r.carriers[carrierKeys.indexOf(key)];
    const name = t.carrier.trim() || INS_NO_CARRIER;
    if (!shown) shownOk = false;
    if (t.statementTotal !== void 0) {
      statementCount++;
      if (lines !== BigInt(t.statementTotal)) statementOff.push(`${name}: lines ${formatUSD(Number(lines))}, statement total ${formatUSD(t.statementTotal)}`);
      if (shown && (shown.statementTotal !== t.statementTotal || shown.statementDifference === void 0 || BigInt(shown.statementDifference) !== lines - BigInt(t.statementTotal))) shownOk = false;
    }
    if (t.paymentReceived !== void 0) {
      paymentCount++;
      if (lines !== BigInt(t.paymentReceived)) paymentOff.push(`${name}: lines ${formatUSD(Number(lines))}, payment received ${formatUSD(t.paymentReceived)}`);
      if (shown && (shown.paymentReceived !== t.paymentReceived || shown.paymentDifference === void 0 || BigInt(shown.paymentDifference) !== lines - BigInt(t.paymentReceived))) shownOk = false;
    }
  }
  r.carriers.forEach((c, i) => {
    const t = entered.get(carrierKeys[i]);
    if ((c.statementTotal !== void 0 || c.statementDifference !== void 0) && t?.statementTotal === void 0) shownOk = false;
    if ((c.paymentReceived !== void 0 || c.paymentDifference !== void 0) && t?.paymentReceived === void 0) shownOk = false;
  });
  if (statementCount > 0) checks.that("statement-totals", "Each carrier’s lines add up to the statement total entered for it", statementOff.length === 0, `${statementOff.length} carrier(s) differ; first: ${statementOff[0]}`);
  if (paymentCount > 0) checks.that("payments", "Each carrier’s lines add up to the payment received entered for it", paymentOff.length === 0, `${paymentOff.length} carrier(s) differ; first: ${paymentOff[0]}`);
  checks.that("differences-shown", "The statement totals, payments, and differences shown match the amounts entered and a second subtraction", shownOk);
  const uncompared = [...lineSum.keys()].filter((key) => !entered.has(key));
  const firstUncompared = r.carriers.find((_, i) => carrierKeys[i] === uncompared[0])?.carrier ?? INS_NO_CARRIER;
  checks.that("totals-entered", "A statement total or payment was entered for every carrier with lines", uncompared.length === 0, `${uncompared.length} carrier(s) were not compared with anything; first: ${firstUncompared}`, "warning");
  const unnamed = input.lines.filter((l) => insGroupKey(l.carrier) === "").length;
  checks.that("carrier-named", "Every line names a carrier", unnamed === 0, `${unnamed} line(s) have no carrier and are grouped under ${INS_NO_CARRIER}`, "warning");
  return checks.all;
}
function carrierSummaryTables(r) {
  return {
    byCarrier: [["Carrier", "Lines", "Premium", "Commission"], ...r.carriers.map((c) => [c.carrier, c.lines, toDecimal(c.premium), toDecimal(c.commission)])],
    againstStatements: [
      ["Carrier", "Commission on the lines", "Statement total", "Difference"],
      ...r.carriers.flatMap((c) => c.statementTotal === void 0 ? [] : [[c.carrier, toDecimal(c.commission), toDecimal(c.statementTotal), toDecimal(c.statementDifference ?? c.commission - c.statementTotal)]])
    ],
    againstPayments: [
      ["Carrier", "Commission on the lines", "Payment received", "Difference"],
      ...r.carriers.flatMap((c) => c.paymentReceived === void 0 ? [] : [[c.carrier, toDecimal(c.commission), toDecimal(c.paymentReceived), toDecimal(c.paymentDifference ?? c.commission - c.paymentReceived)]])
    ],
    byCarrierAndProduct: [["Carrier", "Line of business", "Lines", "Premium", "Commission"], ...r.subtotals.map((s) => [s.carrier, s.product, s.lines, toDecimal(s.premium), toDecimal(s.commission)])],
    byProduct: [["Line of business", "Lines", "Premium", "Commission"], ...r.products.map((p) => [p.product, p.lines, toDecimal(p.premium), toDecimal(p.commission)])]
  };
}

// packages/core/src/insurance/reconcile.ts
var INS_BOOK_ROLES = ["policy", "insured", "premium", "expectedRate", "expectedCommission"];
var INS_BOOK_LABELS = {
  policy: "Policy number",
  insured: "Insured name",
  premium: "Premium",
  expectedRate: "Expected commission rate",
  expectedCommission: "Expected commission amount"
};
var BOOK_SYNONYMS = {
  policy: ["policy number", "policy no", "policy num", "policy id", "policy", "contract number", "certificate number", "member id", "account number"],
  expectedRate: ["expected rate", "expected commission rate", "expected rate pct", "commission rate", "commission rate pct", "commission pct", "commission percent", "comm rate", "comm pct", "rate pct", "rate", "pct", "percent"],
  expectedCommission: ["expected commission", "expected commission amount", "expected amount", "expected", "commission amount", "commission", "commission due", "comm amount", "comm", "agency commission"],
  premium: ["premium", "premium amount", "written premium", "annual premium", "annualized premium", "billed premium", "commissionable premium"],
  insured: ["insured name", "insured", "named insured", "policyholder", "policy holder", "client name", "customer name", "account name", "client", "customer", "name"]
};
var BOOK_REFUSE = {
  expectedCommission: /\b(rate|pct|percent|date|type)\b/,
  premium: /\b(rate|pct|percent|date)\b/,
  expectedRate: /\bdate\b/,
  policy: /\b(date|type|premium|holder)\b/
};
function insGuessBookColumns(rows, atHeaderRow) {
  return insGuessColumns(rows, ["policy", "expectedRate", "expectedCommission", "premium", "insured"], BOOK_SYNONYMS, BOOK_REFUSE, "expectedRate", atHeaderRow);
}
function insExtractBookLines(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The book export has no rows under its header row.");
  const c = mapping.columns;
  const policyCol = insNeedColumn(c.policy, INS_BOOK_LABELS.policy, rows, mapping.headerRow);
  if (c.expectedCommission < 0 && (c.premium < 0 || c.expectedRate < 0)) {
    throw new Error("The book export needs an expected commission column, or both a premium and an expected rate column. Choose them in the column mapping.");
  }
  insAssertDistinct(c);
  const lines = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const policy = insCell(row, policyCol);
    if (insIsTotalLabel(policy) || !policy && row.some(insIsTotalLabel)) return void totalRows.push(rowNumber);
    const reasons = [];
    if (!policy) reasons.push("no policy number");
    const premium = insOptionalCents(insCell(row, c.premium), "premium", reasons);
    const expectedRateBp = insOptionalRate(insCell(row, c.expectedRate), mapping.rateFormat, "expected rate", reasons);
    const given = insOptionalCents(insCell(row, c.expectedCommission), "expected commission", reasons);
    let expected = given;
    if (expected === void 0 && premium !== void 0 && expectedRateBp !== void 0) expected = applyRate(premium, expectedRateBp);
    if (expected === void 0 && reasons.length === 0) reasons.push("no expected commission, and no premium and rate to compute one from");
    if (reasons.length || expected === void 0) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    const line = { rowNumber, policy, insured: insCell(row, c.insured), expected };
    if (premium !== void 0) line.premium = premium;
    if (expectedRateBp !== void 0) line.expectedRateBp = expectedRateBp;
    lines.push(line);
  });
  if (lines.length === 0 && problems.length === 0) throw new Error("No book rows were found under the header row. Check the header row and the column mapping.");
  return { lines, problems, totalRows };
}
var COMMISSION_BUCKETS = ["asExpected", "short", "over", "unexpected", "missing"];
var COMMISSION_BUCKET_LABELS = {
  asExpected: "Paid as expected",
  short: "Short-paid",
  over: "Over-paid",
  unexpected: "Paid but not in book",
  missing: "In book but not paid"
};
function validate3(input) {
  for (const [list, what] of [[input.book, "book"], [input.statement, "statement"]]) {
    const seen = /* @__PURE__ */ new Set();
    for (const l of list) {
      if (!Number.isSafeInteger(l.rowNumber)) throw new Error(`Every ${what} row needs a whole row number.`);
      if (seen.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the ${what} rows.`);
      seen.add(l.rowNumber);
    }
  }
  for (const b of input.book) assertCents(b.expected, `expected commission on book row ${b.rowNumber}`);
  for (const s of input.statement) assertCents(s.commission, `commission on statement row ${s.rowNumber}`);
}
function bucketFor(hasBook, hasStatement, expected, paid) {
  if (!hasBook) return "unexpected";
  if (!hasStatement) return "missing";
  return paid === expected ? "asExpected" : paid < expected ? "short" : "over";
}
function bucketTotals(groups) {
  const totals = Object.fromEntries(COMMISSION_BUCKETS.map((b) => [b, { policies: 0, bookRows: 0, statementRows: 0, expected: 0, paid: 0 }]));
  for (const g of groups) {
    const t = totals[g.bucket];
    t.policies++;
    t.bookRows += g.bookRows.length;
    t.statementRows += g.statementRows.length;
    t.expected += g.expected;
    t.paid += g.paid;
  }
  return totals;
}
function reconcileCommissions(input) {
  validate3(input);
  const groups = /* @__PURE__ */ new Map();
  const groupFor = (policy, insured, rowKey) => {
    const key = insPolicyKey(policy) === "" ? rowKey : `P:${insPolicyKey(policy)}`;
    let g = groups.get(key);
    if (!g) {
      g = { policy: policy.trim(), insured: insured.trim(), bucket: "missing", bookRows: [], statementRows: [], expected: 0, paid: 0, difference: 0 };
      groups.set(key, g);
    }
    if (!g.insured) g.insured = insured.trim();
    return g;
  };
  for (const b of input.book) {
    const g = groupFor(b.policy, b.insured, `B:${b.rowNumber}`);
    g.bookRows.push(b.rowNumber);
    g.expected = assertCents(g.expected + b.expected, "expected total");
  }
  for (const s of input.statement) {
    const g = groupFor(s.policy, s.insured, `S:${s.rowNumber}`);
    g.statementRows.push(s.rowNumber);
    g.paid = assertCents(g.paid + s.commission, "paid total");
  }
  for (const g of groups.values()) {
    g.difference = g.paid - g.expected;
    g.bucket = bucketFor(g.bookRows.length > 0, g.statementRows.length > 0, g.expected, g.paid);
  }
  const all = [...groups.values()];
  const figures = {
    groups: all,
    possibleMatches: possibleMatches(all),
    totals: bucketTotals(all),
    bookCount: input.book.length,
    statementCount: input.statement.length,
    expectedTotal: sum(input.book.map((b) => b.expected)),
    paidTotal: sum(input.statement.map((s) => s.commission)),
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyCommissionReconcile(input, figures) };
}
function possibleMatches(groups) {
  const out = [];
  const missing = groups.filter((g) => g.bucket === "missing");
  for (const u of groups.filter((g) => g.bucket === "unexpected")) {
    for (const m of missing) {
      const sameNumber = insPolicyLooseKey(u.policy) !== "" && insPolicyLooseKey(u.policy) === insPolicyLooseKey(m.policy);
      const sameName = insNameKey(u.insured) !== "" && insNameKey(u.insured) === insNameKey(m.insured);
      if (!sameNumber && !sameName) continue;
      out.push({ statementPolicy: u.policy, statementInsured: u.insured, bookPolicy: m.policy, bookInsured: m.insured, reason: sameNumber ? "number" : "insured", paid: u.paid, expected: m.expected });
    }
  }
  return out;
}
function verifyCommissionReconcile(input, r) {
  validate3(input);
  const checks = new CheckList();
  checks.that("rows-read", "Every row with data in both files was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the result; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const book = new Map(input.book.map((b) => [b.rowNumber, b]));
  const statement = new Map(input.statement.map((s) => [s.rowNumber, s]));
  const usedBook = [];
  const usedStatement = [];
  let keysOk = true;
  let sumsOk = true;
  let bucketsOk = true;
  const parts = Object.fromEntries(COMMISSION_BUCKETS.map((b) => [b, { policies: 0, bookRows: 0, statementRows: 0, expected: 0n, paid: 0n }]));
  for (const g of r.groups) {
    let expected = 0n;
    let paid = 0n;
    const keys = /* @__PURE__ */ new Set();
    for (const n of g.bookRows) {
      usedBook.push(n);
      const b = book.get(n);
      if (!b) sumsOk = false;
      else {
        expected += BigInt(b.expected);
        keys.add(insPolicyKey(b.policy));
      }
    }
    for (const n of g.statementRows) {
      usedStatement.push(n);
      const s = statement.get(n);
      if (!s) sumsOk = false;
      else {
        paid += BigInt(s.commission);
        keys.add(insPolicyKey(s.policy));
      }
    }
    if (keys.size > 1 || keys.has("") && g.bookRows.length + g.statementRows.length > 1) keysOk = false;
    if (BigInt(g.expected) !== expected || BigInt(g.paid) !== paid || BigInt(g.difference) !== paid - expected) sumsOk = false;
    const want = g.bookRows.length === 0 ? "unexpected" : g.statementRows.length === 0 ? "missing" : paid === expected ? "asExpected" : paid < expected ? "short" : "over";
    if (g.bucket !== want || g.bookRows.length + g.statementRows.length === 0) bucketsOk = false;
    const p = parts[g.bucket] ?? parts.missing;
    p.policies++;
    p.bookRows += g.bookRows.length;
    p.statementRows += g.statementRows.length;
    p.expected += expected;
    p.paid += paid;
  }
  const groupKeys = r.groups.map((g) => insPolicyKey(g.policy)).filter((k) => k !== "");
  const notSplit = new Set(groupKeys).size === groupKeys.length;
  checks.that("no-reuse", "No book row and no statement line is used twice", new Set(usedBook).size === usedBook.length && new Set(usedStatement).size === usedStatement.length, `${usedBook.length - new Set(usedBook).size} book row(s) and ${usedStatement.length - new Set(usedStatement).size} statement line(s) repeated`);
  checks.that("exact-match", "Rows are grouped only where the policy numbers are exactly the same, and every exact match was made", keysOk && notSplit);
  checks.that("group-sums", "Each policy’s expected and paid amounts are the sums of its own rows (second pass)", sumsOk);
  checks.that("bucket-rule", "Each policy is in the bucket its amounts call for", bucketsOk);
  const inBook = ["asExpected", "short", "over", "missing"];
  const inStatement = ["asExpected", "short", "over", "unexpected"];
  const add = (keys, field) => keys.reduce((n, k) => n + parts[k][field], 0);
  const addBig = (keys, field) => keys.reduce((n, k) => n + parts[k][field], 0n);
  let expectedTotal = 0n;
  for (const b of input.book) expectedTotal += BigInt(b.expected);
  let paidTotal = 0n;
  for (const s of input.statement) paidTotal += BigInt(s.commission);
  checks.equal("book-count", "Paid as expected + short + over + not paid = all book rows (count)", input.book.length, add(inBook, "bookRows"));
  checks.cents("book-amount", "Paid as expected + short + over + not paid = all expected commission (amount)", Number(expectedTotal), Number(addBig(inBook, "expected")));
  checks.equal("statement-count", "Paid as expected + short + over + not in book = all statement lines (count)", input.statement.length, add(inStatement, "statementRows"));
  checks.cents("statement-amount", "Paid as expected + short + over + not in book = all commission paid (amount)", Number(paidTotal), Number(addBig(inStatement, "paid")));
  checks.that("sides", "Policies not in the book hold no book rows, and policies not paid hold no statement lines", parts.unexpected.bookRows === 0 && parts.missing.statementRows === 0);
  const shown = COMMISSION_BUCKETS.every((b) => {
    const t = r.totals[b];
    const p = parts[b];
    return t !== void 0 && t.policies === p.policies && t.bookRows === p.bookRows && t.statementRows === p.statementRows && BigInt(t.expected) === p.expected && BigInt(t.paid) === p.paid;
  });
  checks.that("totals-shown", "The bucket totals shown match the second pass", shown && r.bookCount === input.book.length && r.statementCount === input.statement.length && BigInt(r.expectedTotal) === expectedTotal && BigInt(r.paidTotal) === paidTotal);
  const matchedDiff = parts.asExpected.paid + parts.short.paid + parts.over.paid - (parts.asExpected.expected + parts.short.expected + parts.over.expected);
  const groupDiff = r.groups.filter((g) => g.bucket === "short" || g.bucket === "over").reduce((n, g) => n + BigInt(g.difference), 0n);
  checks.cents("difference", "Paid − expected on matched policies = the short-paid and over-paid differences added up", Number(matchedDiff), Number(groupDiff));
  const oneSided = (policy, bucket) => r.groups.some((g) => g.bucket === bucket && g.policy === policy);
  const untouched = r.possibleMatches.every((p) => oneSided(p.statementPolicy, "unexpected") && oneSided(p.bookPolicy, "missing") && insPolicyKey(p.statementPolicy) !== insPolicyKey(p.bookPolicy));
  checks.that("possible-not-accepted", "Possible matches were listed only, never accepted: each side is still counted as unmatched", untouched);
  const expectPossible = possibleMatches(r.groups).length;
  checks.that("possible-listed", "The list of possible matches is complete", expectPossible === r.possibleMatches.length, `${expectPossible} found on a second pass, ${r.possibleMatches.length} listed`);
  checks.that("possible-none", "No near matches are waiting for review", r.possibleMatches.length === 0, `${r.possibleMatches.length} possible match(es) listed for review`, "warning");
  return checks.all;
}
function commissionReconcileTables(r) {
  const head = ["Policy number", "Insured name", "Book rows", "Statement lines", "Expected", "Paid", "Difference"];
  const buckets = Object.fromEntries(
    COMMISSION_BUCKETS.map((b) => [b, [head, ...r.groups.filter((g) => g.bucket === b).map((g) => [g.policy || "(no policy number)", g.insured, g.bookRows.join(" "), g.statementRows.join(" "), toDecimal(g.expected), toDecimal(g.paid), toDecimal(g.difference)])]])
  );
  return {
    summary: [
      ["Bucket", "Policies", "Book rows", "Statement lines", "Expected", "Paid", "Difference"],
      ...COMMISSION_BUCKETS.map((b) => {
        const t = r.totals[b];
        return [COMMISSION_BUCKET_LABELS[b], t.policies, t.bookRows, t.statementRows, toDecimal(t.expected), toDecimal(t.paid), toDecimal(t.paid - t.expected)];
      }),
      ["All rows", r.groups.length, r.bookCount, r.statementCount, toDecimal(r.expectedTotal), toDecimal(r.paidTotal), toDecimal(r.paidTotal - r.expectedTotal)]
    ],
    buckets,
    possibleMatches: [
      ["Statement policy", "Statement insured", "Paid", "Book policy", "Book insured", "Expected", "Why it is listed"],
      ...r.possibleMatches.map((p) => [p.statementPolicy, p.statementInsured, toDecimal(p.paid), p.bookPolicy, p.bookInsured, toDecimal(p.expected), p.reason === "number" ? "Same number without punctuation or leading zeros" : "Same insured name, different number"])
    ]
  };
}

// packages/core/src/insurance/missingCommissions.ts
var MISSING_POLICY_ROLES = ["policy", "insured", "carrier", "payableDate", "premium", "expectedRate", "expectedCommission"];
var MISSING_POLICY_LABELS = {
  policy: INS_BOOK_LABELS.policy,
  insured: INS_BOOK_LABELS.insured,
  carrier: "Carrier",
  payableDate: "Effective or renewal date",
  premium: INS_BOOK_LABELS.premium,
  expectedRate: INS_BOOK_LABELS.expectedRate,
  expectedCommission: INS_BOOK_LABELS.expectedCommission
};
var MISSING_LINE_ROLES = ["policy", "insured", "carrier", "effectiveDate", "commission"];
var MISSING_LINE_LABELS = {
  policy: INS_STATEMENT_LABELS.policy,
  insured: INS_STATEMENT_LABELS.insured,
  carrier: "Carrier",
  effectiveDate: INS_STATEMENT_LABELS.effectiveDate,
  commission: INS_STATEMENT_LABELS.commission
};
var CARRIER_WORDS2 = ["carrier", "carrier name", "insurance carrier", "insurance company", "insurer", "company", "company name", "writing company", "market", "payer", "payor"];
var PAYABLE_WORDS = ["term effective date", "renewal effective date", "effective date", "eff date", "policy effective date", "renewal date", "term start date", "term start", "effective", "renewal"];
var EXTRA_SYNONYMS = { carrier: CARRIER_WORDS2, payableDate: PAYABLE_WORDS };
var EXTRA_REFUSE = {
  carrier: /\b(date|total|amount|paid|payment)\b/,
  payableDate: /\b(expiration|expiry|expires|cancel|cancellation|cancelled|premium|amount|rate|pct|commission|paid|payment|statement|transaction|birth)\b/
};
function guessExtra(rows, headerRow, order) {
  const synonyms = Object.fromEntries(order.map((r) => [r, EXTRA_SYNONYMS[r]]));
  const refuse = Object.fromEntries(order.map((r) => [r, EXTRA_REFUSE[r]]));
  return insGuessColumns([rows[headerRow] ?? []], order, synonyms, refuse, order[0], 0).columns;
}
function setAside(rows, headerRow, cols) {
  const copy = [...rows];
  copy[headerRow] = (rows[headerRow] ?? []).map((cell, i) => cols.includes(i) ? "" : cell);
  return copy;
}
function insGuessMissingPolicyColumns(rows, atHeaderRow) {
  const headerRow = insGuessBookColumns(rows, atHeaderRow).headerRow;
  const extra = guessExtra(rows, headerRow, ["carrier", "payableDate"]);
  const book = insGuessBookColumns(setAside(rows, headerRow, Object.values(extra)), headerRow);
  return { headerRow, columns: { ...book.columns, ...extra }, rateFormat: book.rateFormat };
}
function insGuessMissingLineColumns(rows, atHeaderRow) {
  const headerRow = insGuessStatementColumns(rows, atHeaderRow).headerRow;
  const { carrier } = guessExtra(rows, headerRow, ["carrier"]);
  const s = insGuessStatementColumns(setAside(rows, headerRow, [carrier]), headerRow);
  return { headerRow, columns: { policy: s.columns.policy, insured: s.columns.insured, carrier, effectiveDate: s.columns.effectiveDate, commission: s.columns.commission }, rateFormat: s.rateFormat };
}
var cleanName = (s) => s.trim().replace(/\s+/g, " ");
function insExtractMissingPolicies(rows, mapping) {
  const c = mapping.columns;
  const book = { headerRow: mapping.headerRow, rateFormat: mapping.rateFormat, columns: { policy: c.policy, insured: c.insured, premium: c.premium, expectedRate: c.expectedRate, expectedCommission: c.expectedCommission } };
  const read = insExtractBookLines(rows, book);
  const dateCol = insNeedColumn(c.payableDate, MISSING_POLICY_LABELS.payableDate, rows, mapping.headerRow);
  insAssertDistinct(c);
  const reasonsByRow = new Map(read.problems.map((p) => [p.rowNumber, [p.reason]]));
  const dateOf = (rowNumber, reasons) => {
    const raw = insCell(rows[rowNumber - 1] ?? [], dateCol);
    if (raw === "") {
      reasons.push("no effective or renewal date");
      return "";
    }
    return insOptionalDate(raw, "effective or renewal date", reasons);
  };
  for (const p of read.problems) dateOf(p.rowNumber, reasonsByRow.get(p.rowNumber));
  const named = /* @__PURE__ */ new Map();
  const out = [];
  for (const line of read.lines) {
    const reasons = [];
    const payableDate = dateOf(line.rowNumber, reasons);
    const carrier = insCell(rows[line.rowNumber - 1] ?? [], c.carrier);
    if (reasons.length === 0 && insGroupKey(carrier) !== "") {
      const term = `${insPolicyKey(line.policy)}\0${payableDate}`;
      const first = named.get(term);
      if (first && first.key !== insGroupKey(carrier)) reasons.push(`row ${first.row} gives the same policy number and date with the carrier "${first.name}"`);
      else if (!first) named.set(term, { key: insGroupKey(carrier), row: line.rowNumber, name: cleanName(carrier) });
    }
    if (reasons.length) {
      reasonsByRow.set(line.rowNumber, reasons);
      continue;
    }
    out.push({ ...line, carrier, payableDate });
  }
  const problems = [...reasonsByRow].map(([rowNumber, reasons]) => ({ rowNumber, reason: reasons.join("; ") })).sort((a, b) => a.rowNumber - b.rowNumber);
  return { rows: out, problems, totalRows: read.totalRows };
}
function insExtractMissingLines(rows, mapping, defaultCarrier = "") {
  const c = mapping.columns;
  const statement = {
    headerRow: mapping.headerRow,
    rateFormat: mapping.rateFormat,
    columns: { policy: c.policy, insured: c.insured, product: -1, transactionType: -1, effectiveDate: c.effectiveDate, premium: -1, rate: -1, commission: c.commission, producer: -1 }
  };
  const read = insExtractStatementLines(rows, statement);
  insNeedColumn(c.policy, MISSING_LINE_LABELS.policy, rows, mapping.headerRow);
  insAssertDistinct(c);
  const fallback = cleanName(defaultCarrier);
  return {
    lines: read.lines.map((l) => ({ rowNumber: l.rowNumber, policy: l.policy, insured: l.insured, carrier: insCell(rows[l.rowNumber - 1] ?? [], c.carrier) || fallback, effectiveDate: l.effectiveDate, commission: l.commission })),
    problems: read.problems,
    totalRows: read.totalRows
  };
}
var MISSING_STATUSES = ["matched", "listed", "notYet"];
var MISSING_STATUS_LABELS = {
  matched: "Matched to a statement line",
  listed: "No statement line found",
  notYet: "Payable after the as-of date"
};
var MISSING_AGE_BUCKETS = ["days0to30", "days31to60", "days61to90", "over90"];
var MISSING_AGE_LABELS = {
  days0to30: "0–30 days",
  days31to60: "31–60 days",
  days61to90: "61–90 days",
  over90: "Over 90 days"
};
function missingAgeBucket(days) {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error(`An age must be a whole number of days, zero or more; got ${days}.`);
  if (days <= 30) return "days0to30";
  if (days <= 60) return "days31to60";
  if (days <= 90) return "days61to90";
  return "over90";
}
var MISSING_LINE_REASONS = ["noPolicy", "notListed", "beforePayable", "undated", "carrier"];
var MISSING_LINE_REASON_TEXT = {
  noPolicy: "No policy number on the line",
  notListed: "Policy number not in the policy list",
  beforePayable: "Dated before the policy became payable",
  undated: "No date, and the policy is listed for more than one date",
  carrier: "Carrier differs from the policy list"
};
var termId = (p) => insPolicyKey(p.policy) === "" ? `R:${p.rowNumber}` : `P:${insPolicyKey(p.policy)}\0${p.payableDate}`;
function validate4(input) {
  if (typeof input.asOf !== "string" || !isIsoDate(input.asOf)) throw new Error(`The as-of date "${String(input.asOf)}" is not a valid date.`);
  for (const [list, what] of [[input.policies, "policy"], [input.lines, "statement"]]) {
    const seen = /* @__PURE__ */ new Set();
    for (const l of list) {
      if (!Number.isSafeInteger(l.rowNumber)) throw new Error(`Every ${what} row needs a whole row number.`);
      if (seen.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the ${what} rows.`);
      seen.add(l.rowNumber);
    }
  }
  const named = /* @__PURE__ */ new Map();
  for (const p of input.policies) {
    assertCents(p.expected, `expected commission on policy row ${p.rowNumber}`);
    if (!isIsoDate(p.payableDate)) throw new Error(`Policy row ${p.rowNumber}: "${p.payableDate}" is not a valid effective or renewal date.`);
    const key = insGroupKey(p.carrier);
    if (key === "") continue;
    const first = named.get(termId(p));
    if (first && first.key !== key) throw new Error(`Policy rows ${first.row} and ${p.rowNumber} give the same policy number and date with two different carriers.`);
    if (!first) named.set(termId(p), { key, row: p.rowNumber });
  }
  for (const l of input.lines) {
    assertCents(l.commission, `commission on statement row ${l.rowNumber}`);
    if (l.effectiveDate !== "" && !isIsoDate(l.effectiveDate)) throw new Error(`Statement row ${l.rowNumber}: "${l.effectiveDate}" is not a valid date.`);
  }
}
var byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function place(l, byNumber) {
  const key = insPolicyKey(l.policy);
  if (key === "") return "noPolicy";
  const dated = byNumber.get(key);
  if (!dated) return "notListed";
  let term;
  if (l.effectiveDate === "") {
    if (dated.length !== 1) return "undated";
    term = dated[0];
  } else {
    for (const t of dated) if (t.payableDate <= l.effectiveDate) term = t;
    if (!term) return "beforePayable";
  }
  if (!term) return "notListed";
  const lineCarrier = insGroupKey(l.carrier);
  const listCarrier = insGroupKey(term.carrier);
  if (lineCarrier !== "" && listCarrier !== "" && lineCarrier !== listCarrier) return "carrier";
  return term;
}
function emptyAges(make) {
  return Object.fromEntries(MISSING_AGE_BUCKETS.map((b) => [b, make()]));
}
function statusTotals(terms) {
  const totals = Object.fromEntries(MISSING_STATUSES.map((s) => [s, { policies: 0, policyRows: 0, statementRows: 0, expected: 0, paid: 0 }]));
  for (const t of terms) {
    const x = totals[t.status];
    x.policies++;
    x.policyRows += t.policyRows.length;
    x.statementRows += t.statementRows.length;
    x.expected = assertCents(x.expected + t.expected, "expected total");
    x.paid = assertCents(x.paid + t.paid, "matched commission total");
  }
  return totals;
}
var carrierOrder = (a, b) => a === "" ? b === "" ? 0 : 1 : b === "" ? -1 : byText(a, b);
function carrierTotals(terms) {
  const groups = /* @__PURE__ */ new Map();
  for (const t of terms) {
    if (t.status !== "listed" || !t.age) continue;
    const key = insGroupKey(t.carrier);
    let g = groups.get(key);
    if (!g) {
      g = { carrier: key === "" ? INS_NO_CARRIER : cleanName(t.carrier), policies: 0, byAge: emptyAges(() => 0), expected: 0 };
      groups.set(key, g);
    }
    g.policies++;
    g.byAge[t.age] = assertCents(g.byAge[t.age] + t.expected, "carrier age total");
    g.expected = assertCents(g.expected + t.expected, "carrier total");
  }
  return [...groups].sort(([a], [b]) => carrierOrder(a, b)).map(([, g]) => g);
}
function ageTotals(terms) {
  const totals = emptyAges(() => ({ policies: 0, expected: 0 }));
  for (const t of terms) {
    if (t.status !== "listed" || !t.age) continue;
    totals[t.age].policies++;
    totals[t.age].expected = assertCents(totals[t.age].expected + t.expected, "age total");
  }
  return totals;
}
function possibleMatches2(terms, unmatched) {
  const listed = terms.filter((t) => t.status === "listed");
  const out = [];
  for (const l of unmatched) {
    for (const t of listed) {
      const samePolicy = insPolicyKey(l.policy) !== "" && insPolicyKey(l.policy) === insPolicyKey(t.policy);
      const sameNumber = insPolicyLooseKey(l.policy) !== "" && insPolicyLooseKey(l.policy) === insPolicyLooseKey(t.policy);
      const sameName = insNameKey(l.insured) !== "" && insNameKey(l.insured) === insNameKey(t.insured);
      if (!samePolicy && !sameNumber && !sameName) continue;
      out.push({ statementRow: l.rowNumber, statementPolicy: l.policy, statementInsured: l.insured, commission: l.commission, policy: t.policy, insured: t.insured, payableDate: t.payableDate, expected: t.expected, reason: samePolicy ? "policy" : sameNumber ? "number" : "insured" });
    }
  }
  return out;
}
function findMissingCommissions(input) {
  validate4(input);
  const terms = /* @__PURE__ */ new Map();
  for (const p of input.policies) {
    const id = termId(p);
    let t = terms.get(id);
    if (!t) {
      t = { policy: p.policy.trim(), insured: p.insured.trim(), carrier: "", payableDate: p.payableDate, policyRows: [], statementRows: [], expected: 0, paid: 0, status: "listed", ageDays: 0 };
      terms.set(id, t);
    }
    if (!t.insured) t.insured = p.insured.trim();
    if (!t.carrier) t.carrier = cleanName(p.carrier);
    t.policyRows.push(p.rowNumber);
    t.expected = assertCents(t.expected + p.expected, "expected total");
  }
  const byNumber = /* @__PURE__ */ new Map();
  for (const t of terms.values()) {
    const key = insPolicyKey(t.policy);
    if (key === "") continue;
    const dated = byNumber.get(key) ?? [];
    dated.push(t);
    byNumber.set(key, dated);
  }
  for (const dated of byNumber.values()) dated.sort((a, b) => byText(a.payableDate, b.payableDate));
  const unmatchedLines = [];
  for (const l of input.lines) {
    const where = place(l, byNumber);
    if (typeof where === "string") unmatchedLines.push({ ...l, reason: where });
    else {
      where.statementRows.push(l.rowNumber);
      where.paid = assertCents(where.paid + l.commission, "matched commission");
    }
  }
  for (const t of terms.values()) {
    t.ageDays = pmDaysBetween(t.payableDate, input.asOf);
    t.status = t.statementRows.length > 0 ? "matched" : t.payableDate > input.asOf ? "notYet" : "listed";
    if (t.status === "listed") t.age = missingAgeBucket(t.ageDays);
  }
  const all = [...terms.values()];
  const figures = {
    asOf: input.asOf,
    terms: all,
    unmatchedLines,
    possibleMatches: possibleMatches2(all, unmatchedLines),
    totals: statusTotals(all),
    carriers: carrierTotals(all),
    byAge: ageTotals(all),
    policyRowCount: input.policies.length,
    lineCount: input.lines.length,
    expectedTotal: sum(input.policies.map((p) => p.expected)),
    listedExpected: sum(all.filter((t) => t.status === "listed").map((t) => t.expected)),
    commissionTotal: sum(input.lines.map((l) => l.commission)),
    unmatchedCommission: sum(unmatchedLines.map((l) => l.commission)),
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyMissingCommissions(input, figures) };
}
function dayNumber(iso) {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const year = Number(iso.slice(0, 4)) - (month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
var shownCarrierKey = (name) => name === INS_NO_CARRIER ? "" : insGroupKey(name);
function verifyMissingCommissions(input, r) {
  validate4(input);
  const checks = new CheckList();
  checks.that("rows-read", "Every row with data in both files was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the result; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  checks.equal("as-of", "The result is figured as of the date entered", input.asOf, r.asOf);
  const policyByRow = new Map(input.policies.map((p) => [p.rowNumber, p]));
  const lineByRow = new Map(input.lines.map((l) => [l.rowNumber, l]));
  const dates = /* @__PURE__ */ new Map();
  const carrierOf = /* @__PURE__ */ new Map();
  for (const p of input.policies) {
    const key = insPolicyKey(p.policy);
    if (key !== "") dates.set(key, (dates.get(key) ?? /* @__PURE__ */ new Set()).add(p.payableDate));
    if (!carrierOf.get(termId(p))) carrierOf.set(termId(p), insGroupKey(p.carrier));
  }
  const want = /* @__PURE__ */ new Map();
  for (const l of input.lines) {
    const key = insPolicyKey(l.policy);
    const listed = dates.get(key);
    let where;
    if (key === "") where = "noPolicy";
    else if (!listed) where = "notListed";
    else {
      const candidates = l.effectiveDate === "" ? listed.size === 1 ? [...listed] : [] : [...listed].filter((d) => d <= l.effectiveDate);
      if (candidates.length === 0) where = l.effectiveDate === "" ? "undated" : "beforePayable";
      else {
        const date = candidates.reduce((a, b) => b > a ? b : a);
        const id = `P:${key}\0${date}`;
        const lineCarrier = insGroupKey(l.carrier);
        const listCarrier = carrierOf.get(id) ?? "";
        where = lineCarrier !== "" && listCarrier !== "" && lineCarrier !== listCarrier ? "carrier" : id;
      }
    }
    want.set(l.rowNumber, where);
  }
  const usedPolicy = [];
  const usedLine = [];
  const got = /* @__PURE__ */ new Map();
  const shownIds = [];
  let termsOk = true;
  let sumsOk = true;
  let statusOk = true;
  const asOfDay = dayNumber(input.asOf);
  const parts = Object.fromEntries(MISSING_STATUSES.map((s) => [s, { policies: 0, policyRows: 0, statementRows: 0, expected: 0n, paid: 0n }]));
  const listedSecond = [];
  for (const t of r.terms) {
    const ids = /* @__PURE__ */ new Set();
    let expected = 0n;
    let paid = 0n;
    for (const n of t.policyRows) {
      usedPolicy.push(n);
      const p = policyByRow.get(n);
      if (!p) termsOk = false;
      else {
        ids.add(termId(p));
        expected += BigInt(p.expected);
        if (p.payableDate !== t.payableDate || insPolicyKey(p.policy) !== insPolicyKey(t.policy)) termsOk = false;
      }
    }
    const id = ids.size === 1 ? [...ids][0] : "";
    if (id === "" || insGroupKey(t.carrier) !== (carrierOf.get(id) ?? "")) termsOk = false;
    shownIds.push(id);
    for (const n of t.statementRows) {
      usedLine.push(n);
      const l = lineByRow.get(n);
      if (!l) sumsOk = false;
      else paid += BigInt(l.commission);
      got.set(n, id);
    }
    if (BigInt(t.expected) !== expected || BigInt(t.paid) !== paid) sumsOk = false;
    const days = asOfDay - dayNumber(t.payableDate);
    const status = t.statementRows.length > 0 ? "matched" : days < 0 ? "notYet" : "listed";
    const age = status !== "listed" ? void 0 : days > 90 ? "over90" : days > 60 ? "days61to90" : days > 30 ? "days31to60" : "days0to30";
    if (t.status !== status || t.ageDays !== days || t.age !== age) statusOk = false;
    if (status === "listed" && age) listedSecond.push({ carrier: carrierOf.get(id) ?? insGroupKey(t.carrier), age, expected });
    const part = parts[t.status] ?? parts.listed;
    part.policies++;
    part.policyRows += t.policyRows.length;
    part.statementRows += t.statementRows.length;
    part.expected += expected;
    part.paid += paid;
  }
  let unmatchedSum = 0n;
  for (const u of r.unmatchedLines) {
    usedLine.push(u.rowNumber);
    got.set(u.rowNumber, u.reason);
    const l = lineByRow.get(u.rowNumber);
    if (!l || l.commission !== u.commission || l.policy !== u.policy) sumsOk = false;
    else unmatchedSum += BigInt(l.commission);
  }
  checks.that("no-reuse", "No statement line is matched to two policies, and no policy row or statement line is counted twice", new Set(usedLine).size === usedLine.length && new Set(usedPolicy).size === usedPolicy.length, `${usedLine.length - new Set(usedLine).size} statement line(s) and ${usedPolicy.length - new Set(usedPolicy).size} policy row(s) repeated`);
  const notSplit = new Set(shownIds).size === shownIds.length;
  checks.that("policy-grouping", "Policy rows are added together only where the policy number and date are the same, and no policy is split in two", termsOk && notSplit);
  const misplaced = input.lines.filter((l) => got.get(l.rowNumber) !== want.get(l.rowNumber));
  checks.that("line-placement", "Each statement line is matched to the policy its number, carrier, and date call for, or left unmatched for the reason they give (second pass), so no match was missed", misplaced.length === 0 && got.size === input.lines.length, misplaced.length ? `${misplaced.length} line(s) are not where a second pass puts them; first: statement row ${misplaced[0].rowNumber}` : "a line in the result is not in the statement");
  checks.that("policy-sums", "Each policy’s expected commission and matched commission are the sums of its own rows (second pass)", sumsOk);
  checks.that("status-rule", "A policy is listed only when no statement line matched it and it became payable by the as-of date, and each age is recounted in days a second way", statusOk);
  let expectedAll = 0n;
  for (let i = input.policies.length - 1; i >= 0; i--) expectedAll += BigInt(input.policies[i].expected);
  let commissionAll = 0n;
  for (let i = input.lines.length - 1; i >= 0; i--) commissionAll += BigInt(input.lines[i].commission);
  checks.equal("policy-count", "Matched + listed + payable later = all policy rows (count)", input.policies.length, parts.matched.policyRows + parts.listed.policyRows + parts.notYet.policyRows);
  checks.cents("policy-amount", "Matched + listed + payable later = all expected commission (amount)", Number(expectedAll), Number(parts.matched.expected + parts.listed.expected + parts.notYet.expected));
  checks.equal("line-count", "Lines matched + lines not matched = all statement lines (count)", input.lines.length, parts.matched.statementRows + parts.listed.statementRows + parts.notYet.statementRows + r.unmatchedLines.length);
  checks.cents("line-amount", "Commission on matched lines + on lines not matched = all commission on the statement (amount)", Number(commissionAll), Number(parts.matched.paid + parts.listed.paid + parts.notYet.paid + unmatchedSum));
  const second = /* @__PURE__ */ new Map();
  const ageSecond = emptyAges(() => ({ policies: 0, expected: 0n }));
  let listedAll = 0n;
  for (const x of listedSecond) {
    const g = second.get(x.carrier) ?? { policies: 0, byAge: emptyAges(() => 0n), expected: 0n };
    g.policies++;
    g.byAge[x.age] += x.expected;
    g.expected += x.expected;
    second.set(x.carrier, g);
    ageSecond[x.age].policies++;
    ageSecond[x.age].expected += x.expected;
    listedAll += x.expected;
  }
  const carrierKeys = r.carriers.map((c) => shownCarrierKey(c.carrier));
  const carriersOk = new Set(carrierKeys).size === carrierKeys.length && carrierKeys.length === second.size && r.carriers.every((c, i) => {
    const g = second.get(carrierKeys[i]);
    const across = MISSING_AGE_BUCKETS.reduce((n, b) => n + BigInt(c.byAge[b] ?? 0), 0n);
    return g !== void 0 && g.policies === c.policies && BigInt(c.expected) === g.expected && across === g.expected && MISSING_AGE_BUCKETS.every((b) => BigInt(c.byAge[b] ?? 0) === g.byAge[b]);
  });
  checks.that("carrier-rollup", "Each carrier’s age columns add up to its total, and each carrier total matches a second grouping of the listed policies", carriersOk);
  checks.cents("carrier-grand", "Carrier totals add up to the expected commission on the listed policies (added from their rows a second way)", Number(listedAll), Number(r.carriers.reduce((n, c) => n + BigInt(c.expected), 0n)));
  checks.cents("age-grand", "The age columns add up to the same amount", Number(listedAll), Number(MISSING_AGE_BUCKETS.reduce((n, b) => n + BigInt(r.byAge[b]?.expected ?? 0), 0n)));
  const statusShown = MISSING_STATUSES.every((s) => {
    const t = r.totals[s];
    const p = parts[s];
    return t !== void 0 && t.policies === p.policies && t.policyRows === p.policyRows && t.statementRows === p.statementRows && BigInt(t.expected) === p.expected && BigInt(t.paid) === p.paid;
  });
  const agesShown = MISSING_AGE_BUCKETS.every((b) => r.byAge[b] !== void 0 && r.byAge[b].policies === ageSecond[b].policies && BigInt(r.byAge[b].expected) === ageSecond[b].expected);
  checks.that(
    "totals-shown",
    "The counts and totals shown match the second pass",
    statusShown && agesShown && r.policyRowCount === input.policies.length && r.lineCount === input.lines.length && BigInt(r.expectedTotal) === expectedAll && BigInt(r.listedExpected) === listedAll && BigInt(r.commissionTotal) === commissionAll && BigInt(r.unmatchedCommission) === unmatchedSum
  );
  const csv = toCsv(missingCommissionTables(r).listed);
  checks.cents("export-sum", "The Expected commission column of the listed policies in the export, read back, adds up to the listed total", Number(listedAll), sumCsvColumn(csv, "Expected commission"));
  const unmatchedRows = new Set(r.unmatchedLines.map((u) => u.rowNumber));
  const untouched = r.possibleMatches.every((p) => unmatchedRows.has(p.statementRow) && r.terms.some((t) => t.status === "listed" && t.policy === p.policy && t.payableDate === p.payableDate));
  checks.that("possible-not-accepted", "Possible matches were listed only, never accepted: each line is still unmatched and each policy still listed", untouched);
  const expectPossible = possibleMatches2(r.terms, r.unmatchedLines).length;
  checks.that("possible-listed", "The list of possible matches is complete", expectPossible === r.possibleMatches.length, `${expectPossible} found on a second pass, ${r.possibleMatches.length} listed`);
  checks.that("possible-none", "No near matches are waiting for review", r.possibleMatches.length === 0, `${r.possibleMatches.length} possible match(es) listed for review`, "warning");
  const unnamed = r.terms.filter((t) => t.status === "listed" && insGroupKey(t.carrier) === "").length;
  checks.that("carrier-named", "Every listed policy names a carrier", unnamed === 0, `${unnamed} listed polic${unnamed === 1 ? "y has" : "ies have"} no carrier and ${unnamed === 1 ? "is" : "are"} grouped under ${INS_NO_CARRIER}`, "warning");
  if (input.lines.length > 0) {
    const undated = input.lines.filter((l) => l.effectiveDate === "").length;
    checks.that("line-dates", "Every statement line carries a date, so each is matched to its payable period", undated === 0, `${undated} line(s) have no date and were matched on policy number and carrier alone`, "warning");
  }
  return checks.all;
}
var POSSIBLE_TEXT = {
  policy: "Same policy number",
  number: "Same number without punctuation or leading zeros",
  insured: "Same insured name, different number"
};
function missingCommissionTables(r) {
  const of = (s) => r.terms.filter((t) => t.status === s);
  const ageHeads = MISSING_AGE_BUCKETS.map((b) => MISSING_AGE_LABELS[b]);
  const listed = of("listed").sort((a, b) => b.ageDays - a.ageDays || byText(a.policy, b.policy));
  const matchedLines = r.totals.matched.statementRows;
  return {
    summary: [
      ["Status", "Policies", "Policy rows", "Statement lines", "Expected commission", "Commission on the lines"],
      ...MISSING_STATUSES.map((s) => {
        const t = r.totals[s];
        return [MISSING_STATUS_LABELS[s], t.policies, t.policyRows, t.statementRows, toDecimal(t.expected), toDecimal(t.paid)];
      }),
      ["All policies", r.terms.length, r.policyRowCount, matchedLines, toDecimal(r.expectedTotal), toDecimal(r.totals.matched.paid)],
      ["Statement lines not matched to a policy", "", "", r.unmatchedLines.length, "", toDecimal(r.unmatchedCommission)],
      ["All statement lines", "", "", r.lineCount, "", toDecimal(r.commissionTotal)]
    ],
    byCarrier: [
      ["Carrier", "Policies listed", ...ageHeads, "Expected commission"],
      ...r.carriers.map((c) => [c.carrier, c.policies, ...MISSING_AGE_BUCKETS.map((b) => toDecimal(c.byAge[b])), toDecimal(c.expected)]),
      ["All carriers", r.totals.listed.policies, ...MISSING_AGE_BUCKETS.map((b) => toDecimal(r.byAge[b].expected)), toDecimal(r.listedExpected)]
    ],
    listed: [
      ["Policy number", "Insured name", "Carrier", "Payable date", "Days since payable", "Age", "Policy rows", "Expected commission"],
      ...listed.map((t) => [t.policy || "(no policy number)", t.insured, t.carrier, t.payableDate, t.ageDays, t.age ? MISSING_AGE_LABELS[t.age] : "", t.policyRows.join(" "), toDecimal(t.expected)])
    ],
    matched: [
      ["Policy number", "Insured name", "Carrier", "Payable date", "Policy rows", "Statement lines", "Expected commission", "Commission on the lines"],
      ...of("matched").map((t) => [t.policy, t.insured, t.carrier, t.payableDate, t.policyRows.join(" "), t.statementRows.join(" "), toDecimal(t.expected), toDecimal(t.paid)])
    ],
    notYet: [
      ["Policy number", "Insured name", "Carrier", "Payable date", "Days until payable", "Policy rows", "Expected commission"],
      ...of("notYet").map((t) => [t.policy, t.insured, t.carrier, t.payableDate, -t.ageDays, t.policyRows.join(" "), toDecimal(t.expected)])
    ],
    unmatchedLines: [
      ["Statement row", "Policy number", "Insured name", "Carrier", "Date", "Commission", "Why it is not matched"],
      ...r.unmatchedLines.map((u) => [u.rowNumber, u.policy, u.insured, u.carrier, u.effectiveDate, toDecimal(u.commission), MISSING_LINE_REASON_TEXT[u.reason]])
    ],
    possibleMatches: [
      ["Statement row", "Statement policy", "Statement insured", "Commission", "Listed policy", "Listed insured", "Payable date", "Expected commission", "Why it is listed"],
      ...r.possibleMatches.map((p) => [p.statementRow, p.statementPolicy, p.statementInsured, toDecimal(p.commission), p.policy, p.insured, p.payableDate, toDecimal(p.expected), POSSIBLE_TEXT[p.reason]])
    ]
  };
}

export {
  insBpText,
  insGuessColumns,
  insGuessRateFormat,
  insNeedColumn,
  insAssertDistinct,
  insCell,
  insOptionalCents,
  insIsTotalLabel,
  INS_STATEMENT_ROLES,
  INS_STATEMENT_LABELS,
  INS_STATEMENT_SYNONYMS,
  INS_STATEMENT_REFUSE,
  insGuessStatementColumns,
  insExtractStatementLines,
  commissionStatementRows,
  normalizeCommissionStatement,
  INS_CARRIER_ROLES,
  INS_CARRIER_LABELS,
  insGuessCarrierColumns,
  insGroupKey,
  insExtractCarrierLines,
  insReadCarrierTotalsSheet,
  summarizeCommissionsByCarrier,
  carrierSummaryTables,
  INS_BOOK_ROLES,
  INS_BOOK_LABELS,
  insGuessBookColumns,
  insExtractBookLines,
  COMMISSION_BUCKETS,
  COMMISSION_BUCKET_LABELS,
  reconcileCommissions,
  commissionReconcileTables,
  MISSING_POLICY_ROLES,
  MISSING_POLICY_LABELS,
  MISSING_LINE_ROLES,
  MISSING_LINE_LABELS,
  insGuessMissingPolicyColumns,
  insGuessMissingLineColumns,
  insExtractMissingPolicies,
  insExtractMissingLines,
  MISSING_STATUSES,
  MISSING_STATUS_LABELS,
  MISSING_AGE_BUCKETS,
  MISSING_AGE_LABELS,
  missingAgeBucket,
  MISSING_LINE_REASONS,
  MISSING_LINE_REASON_TEXT,
  findMissingCommissions,
  verifyMissingCommissions,
  missingCommissionTables
};
