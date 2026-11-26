// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
// packages/core/src/money.ts
var AmountError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AmountError";
  }
};
function assertCents(value, label = "amount") {
  if (!Number.isSafeInteger(value)) {
    throw new AmountError(`${label} must be a whole number of cents, got ${value}`);
  }
  return value;
}
var NUMBER_BODY = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/;
function parseAmount(raw, options = {}) {
  const crIsNegative = options.crIsNegative ?? true;
  let s = raw.trim();
  if (!s) throw new AmountError("empty amount");
  let negative = false;
  let signs = 0;
  s = s.replace(/^\$\s*(?=\()/, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = !negative;
    signs++;
    s = s.slice(1, -1).trim();
  }
  const suffix = /\s*(CR|DR)$/i.exec(s);
  if (suffix) {
    const tag = suffix[1].toUpperCase();
    if (tag === "CR" && crIsNegative) negative = !negative;
    if (tag === "DR" && !crIsNegative) negative = !negative;
    signs++;
    s = s.slice(0, suffix.index).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    signs++;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-") || s.startsWith("+")) {
    if (s.startsWith("-")) negative = !negative;
    signs++;
    s = s.slice(1).trim();
  }
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s.startsWith("-") || s.startsWith("+")) {
    if (s.startsWith("-")) negative = !negative;
    signs++;
    s = s.slice(1).trim();
  }
  if (signs > 1) throw new AmountError(`conflicting signs in amount "${raw}"`);
  if (!s || s === "." || !NUMBER_BODY.test(s)) {
    throw new AmountError(`not a valid amount: "${raw}"`);
  }
  const [whole = "", frac = ""] = s.replace(/,/g, "").split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  assertCents(cents, `amount "${raw}"`);
  return negative && cents !== 0 ? -cents : cents;
}
function decimalToCents(raw) {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  if (!m || !m[2] && !m[3]) throw new AmountError(`not a valid number: "${raw}"`);
  const negative = m[1] === "-";
  const frac = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) throw new AmountError(`number out of range: "${raw}"`);
  const digits = BigInt((m[2] ?? "") + frac || "0");
  const scale = frac.length - exponent - 2;
  let cents;
  let clean = true;
  if (scale <= 0) {
    cents = digits * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    const rem = digits % divisor;
    const roundsUp = 2n * rem >= divisor;
    cents = digits / divisor + (roundsUp ? 1n : 0n);
    clean = (roundsUp ? divisor - rem : rem) * 1000000n < divisor;
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new AmountError(`number out of range: "${raw}"`);
  const n = Number(cents);
  return { cents: negative && n !== 0 ? -n : n, clean };
}
function toDecimal(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs2 = Math.abs(cents);
  const whole = Math.floor(abs2 / 100);
  const frac = String(abs2 % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
function formatUSD(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs2 = Math.abs(cents);
  const whole = Math.floor(abs2 / 100).toLocaleString("en-US");
  const frac = String(abs2 % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}
function sum(values) {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total = assertCents(total + v, "running total");
  }
  return total;
}

// packages/core/src/sheetInput.ts
function sheetIsTotalWord(cell) {
  return /^(?:grand|statement|report|page|sub)?[\s-]*totals?\b/i.test(cell.trim());
}
function sheetRowList(rows) {
  const MAX_REASONS = 8;
  const MAX_ROWS2 = 20;
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
    const first = numbers.slice(0, MAX_ROWS2);
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
function scaledParse(raw, places, label = "number") {
  let s = raw.trim().replace(/−/g, "-");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const m = /^([+-])?((?:\d{1,3}(?:,\d{3})+|\d*))(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || !m[2] && !m[3]) throw new Error(`The ${label} "${raw}" is not a number.`);
  if (negative && m[1]) throw new Error(`The ${label} "${raw}" has conflicting signs.`);
  if (m[1] === "-") negative = !negative;
  const whole = (m[2] ?? "").replace(/,/g, "");
  const frac = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) throw new Error(`The ${label} "${raw}" is out of range.`);
  const digits = BigInt(whole + frac || "0");
  const scale = frac.length - exponent - places;
  let value;
  if (scale <= 0) {
    value = digits * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    const rem = digits % divisor;
    const roundsUp = 2n * rem >= divisor;
    const noise = (roundsUp ? divisor - rem : rem) * 1000000n < divisor;
    if (rem !== 0n && !noise) throw new Error(`The ${label} "${raw}" has more than ${places} decimal places.`);
    value = digits / divisor + (roundsUp ? 1n : 0n);
  }
  return negative ? -value : value;
}
function scaledFormat(value, places, trim = false) {
  const v = BigInt(value);
  const abs2 = (v < 0n ? -v : v).toString().padStart(places + 1, "0");
  let out = places === 0 ? abs2 : `${abs2.slice(0, abs2.length - places)}.${abs2.slice(abs2.length - places)}`;
  if (trim && places > 0) out = out.replace(/\.?0+$/, "");
  return (v < 0n ? "-" : "") + out;
}

// packages/core/src/verify.ts
var CheckList = class {
  items = [];
  /** Two cent amounts must match exactly. */
  cents(id, label, expected, actual, severity = "error") {
    const passed = expected === actual;
    this.items.push({
      id,
      label,
      passed,
      severity,
      expected: formatUSD(expected),
      actual: formatUSD(actual),
      ...passed ? {} : { detail: `off by ${formatUSD(actual - expected)}` }
    });
    return passed;
  }
  /** Two plain values must match exactly. */
  equal(id, label, expected, actual, severity = "error") {
    const passed = expected === actual;
    this.items.push({ id, label, passed, severity, expected: String(expected), actual: String(actual) });
    return passed;
  }
  /** A condition must hold. */
  that(id, label, condition, detail, severity = "error") {
    this.items.push({ id, label, passed: condition, severity, ...detail && !condition ? { detail } : {} });
    return condition;
  }
  add(check) {
    this.items.push(check);
  }
  addAll(checks) {
    for (const c of checks) this.items.push(c);
  }
  get all() {
    return [...this.items];
  }
  get passed() {
    return passedAll(this.items);
  }
};
function passedAll(checks) {
  return checks.every((c) => c.passed || c.severity === "warning");
}
function failures(checks) {
  return checks.filter((c) => !c.passed && c.severity === "error");
}
function warnings(checks) {
  return checks.filter((c) => !c.passed && c.severity === "warning");
}
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function certify(tool, toolVersion, checks, output, now = /* @__PURE__ */ new Date()) {
  const cert = {
    tool,
    toolVersion,
    generatedAt: now.toISOString(),
    passed: passedAll(checks),
    checksRun: checks.length,
    checksFailed: failures(checks).length,
    warnings: warnings(checks).length,
    checks: [...checks]
  };
  if (output !== void 0) cert.outputSha256 = await sha256Hex(output);
  return cert;
}
function certificateText(cert) {
  const lines = [
    `Reconciliation certificate: ${cert.tool} v${cert.toolVersion}`,
    `Generated: ${cert.generatedAt}`,
    `Result: ${cert.passed ? "PASSED" : "FAILED"} (${cert.checksRun} checks, ${cert.checksFailed} failed, ${cert.warnings} warnings)`
  ];
  for (const c of cert.checks) {
    const mark = c.passed ? "PASS" : c.severity === "warning" ? "WARN" : "FAIL";
    let line = `  [${mark}] ${c.label}`;
    if (c.expected !== void 0 || c.actual !== void 0) line += ` (expected ${c.expected}, got ${c.actual})`;
    if (c.detail) line += ` — ${c.detail}`;
    lines.push(line);
  }
  if (cert.outputSha256) lines.push(`Output SHA-256: ${cert.outputSha256}`);
  return lines.join("\n");
}

// packages/core/src/statements/reconcile.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
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

// packages/core/src/crypto/input.ts
var CX_QUANTITY_PLACES = 8;
var CX_TRADE_ROLES = ["date", "type", "asset", "quantity", "amount", "fee", "basis", "account"];
var CX_TRADE_LABELS = {
  date: "Date (and time)",
  type: "Type (buy or sell)",
  asset: "Asset",
  quantity: "Quantity",
  amount: "Total cost or proceeds",
  fee: "Fee",
  basis: "Cost basis listed for a sale",
  account: "Account or wallet"
};
var SYNONYMS = {
  date: ["timestamp", "date", "date time", "time", "date sold", "transaction date", "trade date", "datetime", "date utc", "timestamp utc"],
  type: ["transaction type", "type", "side", "action", "operation", "trade type"],
  asset: ["asset", "currency", "coin", "symbol", "ticker", "base asset", "base currency", "token"],
  quantity: ["quantity transacted", "quantity", "amount of asset", "units", "qty", "size", "volume", "quantity sold"],
  amount: ["proceeds", "total", "subtotal", "total usd", "usd amount", "gross proceeds", "value usd", "cost", "amount usd", "amount"],
  fee: ["fee", "fees", "fee usd", "fees usd", "commission", "fees and or spread"],
  basis: ["cost basis", "basis", "cost basis usd"],
  account: ["account", "wallet", "exchange", "portfolio", "source", "account name"]
};
function cxGuessTradeColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, CX_TRADE_ROLES, SYNONYMS, atHeaderRow);
}
function cxTimestamp(raw) {
  const s = raw.trim();
  const iso2 = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso2) return `${pmCellToIsoDate(iso2[1])}T${iso2[2]}:${iso2[3]}:${iso2[4] ?? "00"}`;
  const time = /\s(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*(?:UTC|Z)?$/.exec(s);
  if (!time) return `${pmCellToIsoDate(s)}T00:00:00`;
  let hour = Number(time[1]);
  const half = time[4]?.toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (hour > 23 || Number(time[2]) > 59 || Number(time[3] ?? "0") > 59) throw new Error(`not a recognizable time: "${raw}"`);
  return `${pmCellToIsoDate(s.slice(0, time.index))}T${String(hour).padStart(2, "0")}:${time[2]}:${time[3] ?? "00"}`;
}
function cxSide(text2) {
  const t = text2.toLowerCase();
  if (/\b(sell|sold|sale|dispos\w*)\b/.test(t)) return "sell";
  if (/\b(buy|bought|purchase\w*)\b/.test(t)) return "buy";
  return null;
}
function cxExtractTrades(rows, mapping, defaultSide) {
  const c = mapping.columns;
  for (const role of ["date", "asset", "amount"]) if (c[role] < 0) throw new Error(`Choose the column that holds: ${CX_TRADE_LABELS[role]}.`);
  if (c.type < 0 && !defaultSide) throw new Error(`Choose the column that holds: ${CX_TRADE_LABELS.type}.`);
  const out = { trades: [], problems: [], skipped: [], otherRows: 0 };
  const abs2 = (n) => n < 0 ? -n : n;
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const dateText = sheetCell(cells, c.date);
    const typeText = sheetCell(cells, c.type);
    if (!dateText && cells.some(sheetIsTotalWord)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!dateText && !sheetCell(cells, c.asset) && !sheetCell(cells, c.amount)) {
      out.skipped.push({ rowNumber, reason: "no date, asset, or amount" });
      continue;
    }
    const side = c.type >= 0 ? cxSide(typeText) : defaultSide;
    if (!side) {
      out.skipped.push({ rowNumber, reason: typeText ? `not a buy or a sale (${typeText.slice(0, 40)})` : "no type" });
      out.otherRows++;
      continue;
    }
    try {
      if (!dateText) throw new Error("no date");
      const asset = sheetCell(cells, c.asset).toUpperCase();
      if (!asset) throw new Error("no asset");
      const quantityText2 = sheetCell(cells, c.quantity);
      let quantity = quantityText2 ? scaledParse(quantityText2, CX_QUANTITY_PLACES, "quantity") : 0n;
      if (quantity < 0n) quantity = -quantity;
      const amountText = sheetCell(cells, c.amount);
      if (!amountText) throw new Error("no cost or proceeds");
      const feeText = sheetCell(cells, c.fee);
      const basisText = sheetCell(cells, c.basis);
      out.trades.push({
        rowNumber,
        timestamp: cxTimestamp(dateText),
        side,
        asset,
        quantity,
        amount: abs2(pmCellToCents(amountText)),
        fee: feeText ? abs2(pmCellToCents(feeText)) : 0,
        basis: basisText ? abs2(pmCellToCents(basisText)) : null,
        account: sheetCell(cells, c.account)
      });
    } catch (err2) {
      out.problems.push({ rowNumber, reason: err2 instanceof Error ? err2.message : "could not be read" });
    }
  }
  return out;
}

// packages/core/src/crypto/lotsCheck.ts
var text = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var magnitude = (n) => n < 0n ? -n : n;
var rowList = (rows) => [...new Set(rows)].sort((a, b) => a - b).join(", ");
function cxSecondLotPass(input) {
  const adjust = input.feeHandling === "adjust";
  const byAsset = /* @__PURE__ */ new Map();
  for (const t of input.trades) {
    let lists = byAsset.get(t.asset);
    if (!lists) {
      lists = { buys: [], sales: [] };
      byAsset.set(t.asset, lists);
    }
    (t.side === "buy" ? lists.buys : lists.sales).push(t);
  }
  const inTime = (a, b) => text(a.timestamp, b.timestamp) || a.rowNumber - b.rowNumber;
  const sells = [];
  const pieces = [];
  const holdings = [];
  for (const asset of [...byAsset.keys()].sort(text)) {
    const { buys, sales } = byAsset.get(asset);
    buys.sort(inTime);
    sales.sort(inTime);
    const quantities = [];
    const costs = [];
    const lotRows = [];
    let nextBuy = 0;
    for (const sale of sales) {
      while (nextBuy < buys.length && buys[nextBuy].timestamp <= sale.timestamp) {
        const buy = buys[nextBuy++];
        quantities.push(buy.quantity);
        costs.push(BigInt(buy.amount) + (adjust ? BigInt(buy.fee) : 0n));
        lotRows.push(buy.rowNumber);
      }
      let left = sale.quantity;
      let matched = 0n;
      let used = 0n;
      while (left > 0n) {
        let pick = -1;
        if (input.method === "fifo") {
          pick = quantities.findIndex((q) => q > 0n);
        } else {
          for (let i = quantities.length - 1; i >= 0; i--) {
            if (quantities[i] > 0n && (pick < 0 || costs[i] * quantities[pick] >= costs[pick] * quantities[i])) pick = i;
          }
        }
        if (pick < 0) break;
        const held = quantities[pick];
        const cost = costs[pick];
        const take = left < held ? left : held;
        const n = cost * (held - take);
        const stays = n / held + (2n * (n % held) > held ? 1n : 0n);
        quantities[pick] = held - take;
        costs[pick] = stays;
        left -= take;
        matched += take;
        used += cost - stays;
        pieces.push({ sellRowNumber: sale.rowNumber, buyRowNumber: lotRows[pick], quantity: take, costBasis: Number(cost - stays) });
      }
      sells.push({ sellRowNumber: sale.rowNumber, quantity: matched, costBasis: Number(used) });
    }
    for (; nextBuy < buys.length; nextBuy++) {
      quantities.push(buys[nextBuy].quantity);
      costs.push(BigInt(buys[nextBuy].amount) + (adjust ? BigInt(buys[nextBuy].fee) : 0n));
    }
    holdings.push({ asset, quantity: quantities.reduce((a, q) => a + q, 0n), costBasis: Number(costs.reduce((a, c) => a + c, 0n)) });
  }
  sells.sort((a, b) => a.sellRowNumber - b.sellRowNumber);
  pieces.sort((a, b) => a.sellRowNumber - b.sellRowNumber);
  return { sells, pieces, holdings };
}
function cxIsRounded(value, n, d) {
  if (d <= 0n) return false;
  const gap = magnitude(value * d - n);
  if (2n * gap !== d) return 2n * gap < d;
  return magnitude(value * d) > magnitude(n);
}
function cxIsRealTimestamp(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  const daysIn = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}
function cxVerifyGains(input, result, second) {
  const checks = new CheckList();
  const adjust = input.feeHandling === "adjust";
  const quantityText2 = (q) => scaledFormat(q, CX_QUANTITY_PLACES, true);
  let notWhole = 0;
  const cents = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const units = (q) => {
    if (typeof q === "bigint") return q;
    notWhole++;
    return 0n;
  };
  const buys = /* @__PURE__ */ new Map();
  const sales = /* @__PURE__ */ new Map();
  const seenRows = /* @__PURE__ */ new Set();
  const repeatedRows = [];
  const assets = /* @__PURE__ */ new Set();
  const accounts = /* @__PURE__ */ new Set();
  let saleProceeds = 0n;
  for (const t of input.trades) {
    if (seenRows.has(t.rowNumber)) repeatedRows.push(t.rowNumber);
    seenRows.add(t.rowNumber);
    assets.add(t.asset);
    accounts.add(t.account);
    const amount = cents(t.amount);
    const fee = adjust ? cents(t.fee) : 0n;
    if (t.side === "buy") {
      if (!buys.has(t.rowNumber)) buys.set(t.rowNumber, { asset: t.asset, timestamp: t.timestamp, quantity: units(t.quantity), cost: amount + fee });
    } else {
      saleProceeds += amount - fee;
      if (!sales.has(t.rowNumber)) sales.set(t.rowNumber, { asset: t.asset, timestamp: t.timestamp, quantity: units(t.quantity), proceeds: amount - fee });
    }
  }
  const rows = result.rows.map((r) => ({ ...r, q: units(r.quantity), p: cents(r.proceeds), c: cents(r.costBasis), g: cents(r.gain) }));
  const left = result.remaining.map((l) => ({ ...l, q: units(l.quantity), c: cents(l.costBasis) }));
  const short = result.shortfalls.map((s) => ({ ...s, q: units(s.quantity), p: cents(s.proceeds) }));
  const otherSells = second.sells.map((s) => ({ row: s.sellRowNumber, q: units(s.quantity), c: cents(s.costBasis) }));
  const otherPieces = second.pieces.map((p) => ({ sell: p.sellRowNumber, buy: p.buyRowNumber, q: units(p.quantity), c: cents(p.costBasis) }));
  const otherHoldings = second.holdings.map((h) => ({ asset: h.asset, q: units(h.quantity), c: cents(h.costBasis) }));
  checks.that("cx-gain-whole-numbers", "Every amount is a whole number of cents and every quantity a whole number of units", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const matchedBySale = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const m = matchedBySale.get(r.sellRowNumber) ?? { q: 0n, c: 0n };
    matchedBySale.set(r.sellRowNumber, { q: m.q + r.q, c: m.c + r.c });
  }
  const engineSales = [];
  const otherBySale = /* @__PURE__ */ new Map();
  for (const s of otherSells) {
    if (otherBySale.has(s.row) || !sales.has(s.row)) engineSales.push(s.row);
    otherBySale.set(s.row, { q: s.q, c: s.c });
  }
  for (const row of /* @__PURE__ */ new Set([...sales.keys(), ...matchedBySale.keys()])) {
    const mine = matchedBySale.get(row) ?? { q: 0n, c: 0n };
    const theirs = otherBySale.get(row) ?? { q: 0n, c: 0n };
    if (mine.q !== theirs.q || mine.c !== theirs.c) engineSales.push(row);
  }
  const pairs = /* @__PURE__ */ new Map();
  const pairOf = (sell, buy) => {
    const key = `${sell}:${buy}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { sell, q: 0n, c: 0n, other: { q: 0n, c: 0n } };
      pairs.set(key, pair);
    }
    return pair;
  };
  for (const r of rows) {
    const pair = pairOf(r.sellRowNumber, r.buyRowNumber);
    pair.q += r.q;
    pair.c += r.c;
  }
  for (const p of otherPieces) {
    const pair = pairOf(p.sell, p.buy);
    pair.other.q += p.q;
    pair.other.c += p.c;
  }
  for (const pair of pairs.values()) if (pair.q !== pair.other.q || pair.c !== pair.other.c) engineSales.push(pair.sell);
  const leftByAsset = /* @__PURE__ */ new Map();
  for (const l of left) {
    const m = leftByAsset.get(l.asset) ?? { q: 0n, c: 0n };
    leftByAsset.set(l.asset, { q: m.q + l.q, c: m.c + l.c });
  }
  const engineAssets = [];
  const otherAssets = /* @__PURE__ */ new Set();
  for (const h of otherHoldings) {
    const mine = leftByAsset.get(h.asset) ?? { q: 0n, c: 0n };
    if (otherAssets.has(h.asset) || mine.q !== h.q || mine.c !== h.c) engineAssets.push(h.asset);
    otherAssets.add(h.asset);
  }
  for (const asset of /* @__PURE__ */ new Set([...assets, ...leftByAsset.keys()])) if (!otherAssets.has(asset)) engineAssets.push(asset);
  checks.that(
    "cx-gain-engines",
    "A second lot engine, written a different way, agrees on the lots, quantity, and cost basis of every sale and on what is left of every asset",
    engineSales.length === 0 && engineAssets.length === 0,
    [engineSales.length ? `sale row(s) ${rowList(engineSales)}` : "", engineAssets.length ? `asset(s) ${[...new Set(engineAssets)].sort(text).join(", ")}` : ""].filter(Boolean).join("; ")
  );
  const strayRows = rows.filter((r) => {
    const sale = sales.get(r.sellRowNumber);
    const buy = buys.get(r.buyRowNumber);
    return !sale || !buy || sale.asset !== r.asset || buy.asset !== r.asset || r.acquired !== buy.timestamp || r.disposed !== sale.timestamp || r.q <= 0n;
  });
  const strayShort = short.filter((s) => {
    const sale = sales.get(s.sellRowNumber);
    return !sale || sale.asset !== s.asset || s.disposed !== sale.timestamp || s.q <= 0n;
  });
  const lotRows = /* @__PURE__ */ new Set();
  const strayLots = left.filter((l) => {
    const buy = buys.get(l.buyRowNumber);
    const repeated = lotRows.has(l.buyRowNumber);
    lotRows.add(l.buyRowNumber);
    return repeated || !buy || buy.asset !== l.asset || l.acquired !== buy.timestamp || l.q <= 0n;
  });
  checks.that(
    "cx-gain-rows-trades",
    "Every worksheet row, lot still held, and unmatched quantity belongs to a real buy or sale of its own asset and carries that trade’s date and time",
    strayRows.length === 0 && strayShort.length === 0 && strayLots.length === 0,
    [strayRows.length + strayShort.length ? `sale row(s) ${rowList([...strayRows, ...strayShort].map((r) => r.sellRowNumber))}` : "", strayLots.length ? `buy row(s) ${rowList(strayLots.map((l) => l.buyRowNumber))}` : ""].filter(Boolean).join("; ")
  );
  const badQuantity = [.../* @__PURE__ */ new Set([...assets, ...rows.map((r) => r.asset), ...left.map((l) => l.asset), ...short.map((s) => s.asset)])].filter((asset) => {
    const of = (list, pick) => [...list].filter((x) => x.asset === asset).reduce((a, x) => a + pick(x), 0n);
    const bought = of(buys.values(), (b) => b.quantity);
    const sold = of(sales.values(), (s) => s.quantity);
    const matched = of(rows, (r) => r.q);
    return bought - matched !== of(left, (l) => l.q) || sold !== matched + of(short, (s) => s.q);
  });
  checks.that("cx-gain-quantity", "Quantity is conserved for every asset: bought minus sold equals what is left", badQuantity.length === 0, badQuantity.sort(text).join(", "));
  const fromLot = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const m = fromLot.get(r.buyRowNumber) ?? { q: 0n, c: 0n };
    fromLot.set(r.buyRowNumber, { q: m.q + r.q, c: m.c + r.c });
  }
  const leftInLot = /* @__PURE__ */ new Map();
  for (const l of left) {
    const m = leftInLot.get(l.buyRowNumber) ?? { q: 0n, c: 0n };
    leftInLot.set(l.buyRowNumber, { q: m.q + l.q, c: m.c + l.c });
  }
  const badLots = [...buys].filter(([row, buy]) => {
    const used = fromLot.get(row) ?? { q: 0n, c: 0n };
    const kept = leftInLot.get(row) ?? { q: 0n, c: 0n };
    return used.q + kept.q !== buy.quantity || used.c + kept.c !== buy.cost;
  });
  checks.that("cx-gain-lots", "Every lot is conserved: what was sold from it plus what is left equals what was bought, in quantity and in cost", badLots.length === 0, `buy row(s) ${rowList(badLots.map(([row]) => row))}`);
  const badBasis = [.../* @__PURE__ */ new Set([...assets, ...rows.map((r) => r.asset), ...left.map((l) => l.asset)])].filter((asset) => {
    const cost = [...buys.values()].filter((b) => b.asset === asset).reduce((a, b) => a + b.cost, 0n);
    const used = rows.filter((r) => r.asset === asset).reduce((a, r) => a + r.c, 0n);
    const kept = left.filter((l) => l.asset === asset).reduce((a, l) => a + l.c, 0n);
    return cost !== used + kept;
  });
  checks.that("cx-gain-basis", "Cost basis used plus basis left equals total cost, for every asset", badBasis.length === 0, badBasis.sort(text).join(", "));
  const lotState = /* @__PURE__ */ new Map();
  const badCost = [];
  for (const r of rows) {
    const buy = buys.get(r.buyRowNumber);
    if (!buy) continue;
    const lot = lotState.get(r.buyRowNumber) ?? { q: buy.quantity, c: buy.cost };
    const fits = r.q > 0n && r.q <= lot.q;
    const right = fits && (r.q === lot.q ? r.c === lot.c : cxIsRounded(r.c, lot.c * r.q, lot.q));
    if (!right) badCost.push(r.sellRowNumber);
    lotState.set(r.buyRowNumber, { q: lot.q - r.q, c: lot.c - r.c });
  }
  checks.that("cx-gain-row-cost", "Each row’s cost basis is its lot’s cost times the quantity taken divided by the lot’s quantity, rounded to the cent, and a lot taken whole gives all its cost", badCost.length === 0, `sale row(s) ${rowList(badCost)}`);
  const shownProceeds = rows.reduce((a, r) => a + r.p, 0n) + short.reduce((a, s) => a + s.p, 0n);
  checks.cents("cx-gain-proceeds", "Proceeds on the worksheet plus proceeds of any unmatched quantity equal total sale proceeds", Number(saleProceeds), Number(shownProceeds));
  const running = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const sale = sales.get(r.sellRowNumber);
    if (!sale) continue;
    const so = running.get(r.sellRowNumber) ?? { q: 0n, p: 0n, bad: false };
    const q = so.q + r.q;
    const p = so.p + r.p;
    running.set(r.sellRowNumber, { q, p, bad: so.bad || q > sale.quantity || !cxIsRounded(p, sale.proceeds * q, sale.quantity) });
  }
  const shortBySale = /* @__PURE__ */ new Map();
  for (const s of short) {
    const m = shortBySale.get(s.sellRowNumber) ?? { q: 0n, p: 0n };
    shortBySale.set(s.sellRowNumber, { q: m.q + s.q, p: m.p + s.p });
  }
  const badProceeds = [...sales].filter(([row, sale]) => {
    const so = running.get(row) ?? { q: 0n, p: 0n, bad: false };
    const rest = shortBySale.get(row) ?? { q: 0n, p: 0n };
    return so.bad || so.q + rest.q !== sale.quantity || so.p + rest.p !== sale.proceeds;
  });
  checks.that("cx-gain-row-proceeds", "Each sale’s own proceeds are split over its rows by quantity, to the cent, and any unmatched quantity carries the rest", badProceeds.length === 0, `sale row(s) ${rowList(badProceeds.map(([row]) => row))}`);
  const badGain = rows.filter((r) => r.g !== r.p - r.c).map((r) => r.sellRowNumber);
  checks.that("cx-gain-sum", "Gain or loss is proceeds minus cost basis on every row", badGain.length === 0, `sale row(s) ${rowList(badGain)}`);
  const badDates = rows.filter((r) => !cxIsRealTimestamp(r.acquired) || !cxIsRealTimestamp(r.disposed) || r.acquired > r.disposed).map((r) => r.sellRowNumber);
  checks.that("cx-gain-dates", "Acquired and disposed are real calendar dates and times, and every lot was acquired on or before the time it was sold", badDates.length === 0, `sale row(s) ${rowList(badDates)}`);
  checks.that("cx-gain-holdings", "No sale is larger than the holdings before it", short.length === 0, short.map((s) => `row ${s.sellRowNumber}: ${quantityText2(s.q)} ${s.asset} more than was held`).join("; "));
  checks.that("cx-gain-rows-once", "Every trade row was read once", repeatedRows.length === 0, `row(s) ${rowList(repeatedRows)}`);
  const named = [...accounts].sort(text).map((a) => a || "(no account)");
  checks.that("cx-gain-accounts", "All trades come from one account or wallet", accounts.size <= 1, `trades come from ${accounts.size} accounts or wallets (${named.slice(0, 6).join(", ")}${named.length > 6 ? ", …" : ""}); lots are pooled per asset across all of them`, "warning");
  return checks.all;
}

// packages/core/src/crypto/lots.ts
function cxRoundDiv(n, d) {
  if (d <= 0n) throw new Error("Division by zero or a negative number.");
  const abs2 = n < 0n ? -n : n;
  const q = abs2 / d + (2n * (abs2 % d) >= d ? 1n : 0n);
  return n < 0n ? -q : q;
}
function cxBuyCost(trade, feeHandling) {
  return feeHandling === "adjust" ? trade.amount + trade.fee : trade.amount;
}
function cxSellProceeds(trade, feeHandling) {
  return feeHandling === "adjust" ? trade.amount - trade.fee : trade.amount;
}
function cxOrderTrades(trades) {
  for (const t of trades) {
    if (typeof t.quantity !== "bigint" || t.quantity <= 0n) throw new Error(`Row ${t.rowNumber}: the quantity must be more than zero.`);
    if (!Number.isSafeInteger(t.amount) || t.amount < 0) throw new Error(`Row ${t.rowNumber}: the cost or proceeds must be a whole number of cents, zero or more.`);
    if (!Number.isSafeInteger(t.fee) || t.fee < 0) throw new Error(`Row ${t.rowNumber}: the fee must be a whole number of cents, zero or more.`);
    if (t.asset === "") throw new Error(`Row ${t.rowNumber}: no asset.`);
  }
  const rank = (t) => t.side === "buy" ? 0 : 1;
  return [...trades].sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : rank(a) - rank(b) || a.rowNumber - b.rowNumber);
}
function cxMatchLots(input) {
  const rows = [];
  const shortfalls = [];
  const lots = [];
  for (const trade of cxOrderTrades(input.trades)) {
    if (trade.side === "buy") {
      lots.push({ buyRowNumber: trade.rowNumber, asset: trade.asset, acquired: trade.timestamp, quantity: trade.quantity, costBasis: cxBuyCost(trade, input.feeHandling) });
      continue;
    }
    const proceeds = BigInt(cxSellProceeds(trade, input.feeHandling));
    let left = trade.quantity;
    let matched = 0n;
    let given = 0n;
    while (left > 0n) {
      let lot = null;
      for (const candidate of lots) {
        if (candidate.asset !== trade.asset || candidate.quantity <= 0n) continue;
        if (lot === null) {
          lot = candidate;
          if (input.method === "fifo") break;
        } else if (BigInt(candidate.costBasis) * lot.quantity > BigInt(lot.costBasis) * candidate.quantity) {
          lot = candidate;
        }
      }
      if (lot === null) break;
      const take = left < lot.quantity ? left : lot.quantity;
      const cost = take === lot.quantity ? lot.costBasis : Number(cxRoundDiv(BigInt(lot.costBasis) * take, lot.quantity));
      lot.quantity -= take;
      lot.costBasis -= cost;
      matched += take;
      left -= take;
      const upTo = cxRoundDiv(proceeds * matched, trade.quantity);
      const piece = Number(upTo - given);
      given = upTo;
      rows.push({
        sellRowNumber: trade.rowNumber,
        buyRowNumber: lot.buyRowNumber,
        asset: trade.asset,
        acquired: lot.acquired,
        disposed: trade.timestamp,
        quantity: take,
        proceeds: piece,
        costBasis: cost,
        gain: piece - cost
      });
    }
    if (left > 0n) {
      shortfalls.push({ sellRowNumber: trade.rowNumber, asset: trade.asset, disposed: trade.timestamp, quantity: left, proceeds: Number(proceeds - given) });
    }
  }
  return { method: input.method, rows, remaining: lots.filter((lot) => lot.quantity > 0n), shortfalls };
}
function cxCapitalGainsWorksheet(input) {
  cxOrderTrades(input.trades);
  const result = cxMatchLots(input);
  const checks = cxVerifyGains(input, result, cxSecondLotPass(input));
  const totalProceeds = sum(result.rows.map((r) => r.proceeds));
  const totalCostBasis = sum(result.rows.map((r) => r.costBasis));
  return { ...result, totalProceeds, totalCostBasis, totalGain: totalProceeds - totalCostBasis, checks };
}
function cxGainsTables(r) {
  const q = (n) => scaledFormat(n, CX_QUANTITY_PLACES, true);
  const day = (timestamp) => timestamp.slice(0, 10);
  return {
    rows: [
      ["Asset", "Quantity", "Date acquired", "Date disposed", "Proceeds", "Cost basis", "Gain or loss", "Sale row", "Buy row"],
      ...r.rows.map((x) => [x.asset, q(x.quantity), day(x.acquired), day(x.disposed), toDecimal(x.proceeds), toDecimal(x.costBasis), toDecimal(x.gain), x.sellRowNumber, x.buyRowNumber]),
      ["Total", "", "", "", toDecimal(r.totalProceeds), toDecimal(r.totalCostBasis), toDecimal(r.totalGain), "", ""]
    ],
    remaining: [["Asset", "Quantity", "Date acquired", "Cost basis", "Buy row"], ...r.remaining.map((l) => [l.asset, q(l.quantity), day(l.acquired), toDecimal(l.costBasis), l.buyRowNumber])],
    shortfalls: [["Sale row", "Asset", "Date disposed", "Quantity with no lot", "Proceeds of that quantity"], ...r.shortfalls.map((s) => [s.sellRowNumber, s.asset, day(s.disposed), q(s.quantity), toDecimal(s.proceeds)])]
  };
}

// packages/core/src/crypto/averageCost.ts
var CX_PRICE_PLACES = 8;
var CENT_UNITS = 10n ** 14n;
function validate(input) {
  if (input.buys.length === 0) throw new Error("Add at least one buy.");
  for (const b of input.buys) {
    if (typeof b.quantity !== "bigint" || b.quantity <= 0n) throw new Error(`Line ${b.line}: the quantity must be more than zero.`);
    if (!Number.isSafeInteger(b.amount) || b.amount < 0) throw new Error(`Line ${b.line}: the cost must be a whole number of cents, zero or more.`);
    if (!Number.isSafeInteger(b.fee) || b.fee < 0) throw new Error(`Line ${b.line}: the fee must be a whole number of cents, zero or more.`);
  }
  if (input.price !== null && input.price !== void 0 && (typeof input.price !== "bigint" || input.price < 0n)) throw new Error("The price to compare with must be zero or more.");
}
var unitCost = (cost, quantity) => cxRoundDiv(BigInt(cost) * CENT_UNITS, quantity);
function cxAverageCost(input) {
  validate(input);
  const lines = input.buys.map((b) => {
    const cost = input.feeHandling === "adjust" ? b.amount + b.fee : b.amount;
    return { line: b.line, quantity: b.quantity, cost, unitCost: unitCost(cost, b.quantity) };
  });
  let totalQuantity = 0n;
  let totalAmount = 0;
  let totalFees = 0;
  let totalCost = 0;
  input.buys.forEach((b, i) => {
    totalQuantity += b.quantity;
    totalAmount += b.amount;
    totalFees += b.fee;
    totalCost += lines[i].cost;
  });
  if (!Number.isSafeInteger(totalAmount + totalFees)) throw new Error("The total cost is too large to work with.");
  const price = input.price ?? null;
  const value = price === null ? null : Number(cxRoundDiv(totalQuantity * price, CENT_UNITS));
  if (value !== null && !Number.isSafeInteger(value)) throw new Error("The value at that price is too large to work with.");
  const result = { feeHandling: input.feeHandling, lines, totalQuantity, totalAmount, totalFees, totalCost, average: unitCost(totalCost, totalQuantity), price, value, difference: value === null ? null : value - totalCost };
  return { ...result, checks: cxVerifyAverageCost(input, result) };
}
var abs = (n) => n < 0n ? -n : n;
function cxVerifyAverageCost(input, r) {
  const checks = new CheckList();
  const adjust = input.feeHandling === "adjust";
  const whole = 10n ** BigInt(CX_QUANTITY_PLACES);
  let units = 0n;
  let fraction = 0n;
  let amounts = 0n;
  let fees = 0n;
  for (const b of input.buys) {
    units += b.quantity / whole;
    fraction += b.quantity % whole;
    amounts += BigInt(b.amount);
    fees += BigInt(b.fee);
  }
  const quantity = units * whole + fraction;
  const cost = adjust ? amounts + fees : amounts;
  const same = r.lines.length === input.buys.length && input.buys.every((b, i) => {
    const l = r.lines[i];
    return l.line === b.line && l.quantity === b.quantity && BigInt(l.cost) === BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n);
  });
  checks.that("ac-lines", adjust ? "Every buy is in the result once, with its quantity, and its cost is the amount paid plus the fee" : "Every buy is in the result once, with its quantity, and its cost is the amount paid with the fee left out", same);
  checks.equal("ac-quantity", "Total quantity equals the quantities added a second way", scaledFormat(quantity, CX_QUANTITY_PLACES, true), scaledFormat(r.totalQuantity, CX_QUANTITY_PLACES, true));
  checks.cents("ac-amount", "Total paid before fees equals the amounts added a second way", Number(amounts), r.totalAmount);
  checks.cents("ac-fees", "Total fees equal the fees added a second way", Number(fees), r.totalFees);
  checks.cents("ac-cost", adjust ? "Total cost equals total paid before fees plus total fees" : "Total cost equals total paid before fees, with fees left out", Number(cost), r.totalCost);
  const back = (perUnit, q, c) => q > 0n && 2n * abs(perUnit * q - c * CENT_UNITS) <= q;
  const offLines = r.lines.filter((l) => !back(l.unitCost, l.quantity, BigInt(l.cost))).map((l) => l.line);
  checks.that("ac-line-unit", "Each buy's cost per unit, multiplied by its quantity, gives its cost back", offLines.length === 0, `Not so on line(s) ${offLines.join(", ")}`);
  checks.that("ac-average", "The average cost per unit, multiplied by the total quantity, gives the total cost back", back(r.average, quantity, cost), `${cxFormatPrice(r.average)} × ${scaledFormat(quantity, CX_QUANTITY_PLACES, true)} is not ${toDecimal(Number(cost))}`);
  const between = input.buys.length > 0 && input.buys.some((b) => (BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n)) * quantity <= cost * b.quantity) && input.buys.some((b) => (BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n)) * quantity >= cost * b.quantity);
  const low = r.lines.reduce((m, l) => l.unitCost < m ? l.unitCost : m, r.lines[0]?.unitCost ?? 0n);
  const high = r.lines.reduce((m, l) => l.unitCost > m ? l.unitCost : m, r.lines[0]?.unitCost ?? 0n);
  checks.that("ac-range", "The average cost per unit lies between the lowest and the highest cost per unit among the buys", between && r.average >= low && r.average <= high);
  const price = input.price ?? null;
  if (price !== null) {
    const ok = r.value !== null && r.price === price && 2n * abs(BigInt(r.value) * CENT_UNITS - quantity * price) <= CENT_UNITS;
    checks.that("ac-value", "The value at the price typed is the total quantity times that price, to the cent", ok);
    checks.cents("ac-difference", "The difference is the value at the price typed minus the total cost", (r.value ?? 0) - Number(cost), r.difference ?? Number.NaN);
  } else {
    checks.that("ac-no-price", "No price was typed, so no value is shown", r.value === null && r.difference === null && r.price === null);
  }
  return checks.all;
}
function cxFormatPrice(value) {
  const text2 = scaledFormat(abs(value), CX_PRICE_PLACES);
  const [whole, decimals] = text2.split(".");
  const trimmed = decimals.replace(/0+$/, "").padEnd(2, "0");
  return `${value < 0n ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${trimmed}`;
}
function cxAverageCostTables(r) {
  const q = (n) => scaledFormat(n, CX_QUANTITY_PLACES, true);
  const p = (n) => scaledFormat(n, CX_PRICE_PLACES);
  return {
    lines: [
      ["Line", "Quantity", "Cost", "Cost per unit"],
      ...r.lines.map((l) => [l.line, q(l.quantity), toDecimal(l.cost), p(l.unitCost)]),
      ["Total", q(r.totalQuantity), toDecimal(r.totalCost), p(r.average)]
    ],
    summary: [
      ["Item", "Value"],
      ["Fees", r.feeHandling === "adjust" ? "Added to cost" : "Left out"],
      ["Total quantity", q(r.totalQuantity)],
      ["Total paid before fees", toDecimal(r.totalAmount)],
      ["Total fees", toDecimal(r.totalFees)],
      ["Total cost", toDecimal(r.totalCost)],
      ["Average cost per unit", p(r.average)],
      ...r.price !== null && r.value !== null && r.difference !== null ? [["Price compared with", p(r.price)], ["Value at that price", toDecimal(r.value)], ["Value minus total cost", toDecimal(r.difference)]] : []
    ]
  };
}

// packages/core/src/crypto/holdingPeriod.ts
var CX_HELD_ROLES = ["asset", "quantity", "acquired", "disposed", "proceeds", "basis", "gain"];
var CX_HELD_LABELS = {
  asset: "Asset",
  quantity: "Quantity",
  acquired: "Date acquired",
  disposed: "Date disposed",
  proceeds: "Proceeds",
  basis: "Cost basis",
  gain: "Gain or loss listed in the file"
};
var SYNONYMS2 = {
  asset: ["asset", "currency", "coin", "symbol", "ticker", "token", "description", "asset name"],
  quantity: ["quantity", "qty", "units", "amount", "size", "quantity sold"],
  acquired: ["date acquired", "acquired", "acquisition date", "date bought", "buy date", "purchase date", "date purchased", "open date", "received date"],
  disposed: ["date disposed", "disposed", "date sold", "sale date", "sell date", "disposal date", "date of sale", "close date", "sold date"],
  proceeds: ["proceeds", "gross proceeds", "sale proceeds", "proceeds usd", "amount received"],
  basis: ["cost basis", "basis", "cost basis usd", "cost"],
  gain: ["gain or loss", "gain loss", "gains losses", "realized gain", "realized gain loss", "gain", "profit", "profit loss"]
};
function cxGuessHeldColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, CX_HELD_ROLES, SYNONYMS2, atHeaderRow);
}
function cxExtractHeldRows(rows, mapping) {
  const c = mapping.columns;
  for (const role of ["acquired", "disposed", "proceeds", "basis"]) if (c[role] < 0) throw new Error(`Choose the column that holds: ${CX_HELD_LABELS[role]}.`);
  const out = { rows: [], problems: [], skipped: [], fileTotal: null };
  const optional = (text2) => {
    if (!text2) return null;
    try {
      return pmCellToCents(text2);
    } catch {
      return null;
    }
  };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const acquiredText = sheetCell(cells, c.acquired);
    const disposedText = sheetCell(cells, c.disposed);
    const proceedsText = sheetCell(cells, c.proceeds);
    const basisText = sheetCell(cells, c.basis);
    const gainText = sheetCell(cells, c.gain);
    if (!acquiredText && !disposedText) {
      if (cells.some(sheetIsTotalWord)) {
        out.fileTotal ??= { rowNumber, proceeds: optional(proceedsText), costBasis: optional(basisText), gain: optional(gainText) };
        out.skipped.push({ rowNumber, reason: "total line" });
        continue;
      }
      if (!proceedsText && !basisText) {
        out.skipped.push({ rowNumber, reason: "no dates and no amounts" });
        continue;
      }
    }
    try {
      if (!acquiredText) throw new Error("no date acquired");
      if (!disposedText) throw new Error("no date disposed");
      if (!proceedsText) throw new Error("no proceeds");
      if (!basisText) throw new Error("no cost basis");
      out.rows.push({
        rowNumber,
        asset: sheetCell(cells, c.asset).toUpperCase(),
        quantity: sheetCell(cells, c.quantity),
        acquired: pmCellToIsoDate(acquiredText),
        disposed: pmCellToIsoDate(disposedText),
        proceeds: pmCellToCents(proceedsText),
        costBasis: pmCellToCents(basisText),
        listedGain: gainText ? pmCellToCents(gainText) : null
      });
    } catch (err2) {
      out.problems.push({ rowNumber, reason: err2 instanceof Error ? err2.message : "could not be read" });
    }
  }
  return out;
}
var CX_HELD_NAMES = {
  "year-or-less": "One year or less",
  "over-a-year": "More than one year"
};
function fields(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a date written as YYYY-MM-DD: "${date}".`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
var isLeap = (year) => year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
var monthLength = (year, month) => month === 2 ? isLeap(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
var write = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function cxOverAYearFrom(acquired) {
  let [y, m, d] = fields(acquired);
  if (d < monthLength(y, m)) d += 1;
  else if (m < 12) [m, d] = [m + 1, 1];
  else [y, m, d] = [y + 1, 1, 1];
  y += 1;
  if (m === 2 && d === 29 && !isLeap(y)) [m, d] = [3, 1];
  return write(y, m, d);
}
function cxDayNumber(date) {
  const [year, month, day] = fields(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function cxOverAYearByDays(acquired, disposed) {
  const [y, m, d] = fields(acquired);
  const anniversary = m === 2 && d === monthLength(y, 2) ? write(y + 1, 2, monthLength(y + 1, 2)) : write(y + 1, m, d);
  return cxDayNumber(disposed) - cxDayNumber(acquired) > cxDayNumber(anniversary) - cxDayNumber(acquired);
}
function listRows(rows) {
  return `row(s) ${rows.slice(0, 20).join(", ")}${rows.length > 20 ? ` and ${rows.length - 20} more` : ""}`;
}
function cxHoldingPeriodSplit(rows, fileTotal = null) {
  for (const r of rows) {
    if (!Number.isSafeInteger(r.proceeds) || !Number.isSafeInteger(r.costBasis)) throw new Error(`Row ${r.rowNumber}: proceeds and cost basis must be whole numbers of cents.`);
    if (r.listedGain !== null && !Number.isSafeInteger(r.listedGain)) throw new Error(`Row ${r.rowNumber}: the gain or loss must be a whole number of cents.`);
    fields(r.acquired);
    fields(r.disposed);
  }
  const lines = rows.map((r) => ({
    ...r,
    daysHeld: cxDayNumber(r.disposed) - cxDayNumber(r.acquired),
    held: r.disposed >= cxOverAYearFrom(r.acquired) ? "over-a-year" : "year-or-less",
    gain: r.proceeds - r.costBasis
  }));
  const group = (held) => {
    const mine = lines.filter((l) => l.held === held);
    return { held, count: mine.length, proceeds: sum(mine.map((l) => l.proceeds)), costBasis: sum(mine.map((l) => l.costBasis)), gain: sum(mine.map((l) => l.gain)) };
  };
  const groups = [group("year-or-less"), group("over-a-year")];
  const totalProceeds = groups[0].proceeds + groups[1].proceeds;
  const totalCostBasis = groups[0].costBasis + groups[1].costBasis;
  const totalGain = groups[0].gain + groups[1].gain;
  const result = { lines, groups, totalProceeds, totalCostBasis, totalGain };
  return { ...result, checks: cxVerifyHoldingPeriod(rows, fileTotal, result) };
}
function cxVerifyHoldingPeriod(rows, fileTotal, r) {
  const checks = new CheckList();
  const same = r.lines.length === rows.length && rows.every((row, i) => {
    const l = r.lines[i];
    return l.rowNumber === row.rowNumber && l.acquired === row.acquired && l.disposed === row.disposed && l.proceeds === row.proceeds && l.costBasis === row.costBasis;
  });
  checks.that("hp-rows", "The result has every row of the file once, with the dates and amounts read from it", same);
  const backwards = rows.filter((x) => x.disposed < x.acquired).map((x) => x.rowNumber);
  checks.that("hp-dates", "Every row was acquired on or before the date it was disposed", backwards.length === 0, `Disposed before acquired: ${listRows(backwards)}`);
  const disagree = r.lines.filter((l) => l.held === "over-a-year" !== cxOverAYearByDays(l.acquired, l.disposed)).map((l) => l.rowNumber);
  checks.that("hp-two-ways", "The one-year line worked out from calendar dates and from day counts puts every row in the same group", disagree.length === 0, `The two ways differ on ${listRows(disagree)}`);
  const badGain = r.lines.filter((l) => l.gain !== l.proceeds - l.costBasis).map((l) => l.rowNumber);
  checks.that("hp-row-gain", "Gain or loss is proceeds minus cost basis on every row", badGain.length === 0, `Not so on ${listRows(badGain)}`);
  checks.equal("hp-once", "Every row is in exactly one group: the two row counts add up to the number of rows", rows.length, r.groups[0].count + r.groups[1].count);
  let allProceeds = 0n;
  let allBasis = 0n;
  for (const g of r.groups) {
    const over = g.held === "over-a-year";
    let count = 0;
    let proceeds = 0n;
    let basis = 0n;
    for (const row of rows) {
      if (cxOverAYearByDays(row.acquired, row.disposed) !== over) continue;
      count++;
      proceeds += BigInt(row.proceeds);
      basis += BigInt(row.costBasis);
    }
    allProceeds += proceeds;
    allBasis += basis;
    const name = CX_HELD_NAMES[g.held];
    checks.equal(`hp-count-${g.held}`, `${name}: the row count equals the rows counted a second way`, count, g.count);
    checks.cents(`hp-proceeds-${g.held}`, `${name}: proceeds equal the rows added a second way`, Number(proceeds), g.proceeds);
    checks.cents(`hp-basis-${g.held}`, `${name}: cost basis equals the rows added a second way`, Number(basis), g.costBasis);
    checks.cents(`hp-gain-${g.held}`, `${name}: gain or loss equals proceeds minus cost basis`, Number(proceeds - basis), g.gain);
  }
  checks.cents("hp-total-proceeds", "Total proceeds equal the proceeds of the two groups", Number(allProceeds), r.totalProceeds);
  checks.cents("hp-total-basis", "Total cost basis equals the cost basis of the two groups", Number(allBasis), r.totalCostBasis);
  checks.cents("hp-total-gain", "Total gain or loss equals total proceeds minus total cost basis", Number(allProceeds - allBasis), r.totalGain);
  const listed = rows.filter((x) => x.listedGain !== null);
  if (listed.length > 0) {
    const off = listed.filter((x) => x.listedGain !== x.proceeds - x.costBasis).map((x) => x.rowNumber);
    checks.that("hp-listed-gain", `The gain or loss the file lists on ${listed.length} row(s) equals proceeds minus cost basis on each`, off.length === 0, `The file's figure differs on ${listRows(off)}`);
  }
  if (fileTotal) {
    if (fileTotal.proceeds !== null) checks.cents("hp-file-proceeds", `Proceeds on the file's own total line (row ${fileTotal.rowNumber}) equal the proceeds of the rows`, fileTotal.proceeds, r.totalProceeds);
    if (fileTotal.costBasis !== null) checks.cents("hp-file-basis", `Cost basis on the file's own total line (row ${fileTotal.rowNumber}) equals the cost basis of the rows`, fileTotal.costBasis, r.totalCostBasis);
    if (fileTotal.gain !== null) checks.cents("hp-file-gain", `Gain or loss on the file's own total line (row ${fileTotal.rowNumber}) equals the gain or loss of the rows`, fileTotal.gain, r.totalGain);
  }
  const near = rows.filter((x) => x.disposed >= x.acquired && Math.abs(cxDayNumber(x.disposed) - cxDayNumber(cxOverAYearFrom(x.acquired))) <= 1).map((x) => x.rowNumber);
  checks.that("hp-near-line", "No row was disposed within a day of its one-year line", near.length === 0, `Within a day of the line, where one day decides the group: ${listRows(near)}`, "warning");
  return checks.all;
}
function cxHoldingPeriodTables(r) {
  return {
    summary: [
      ["Held", "Rows", "Proceeds", "Cost basis", "Gain or loss"],
      ...r.groups.map((g) => [CX_HELD_NAMES[g.held], g.count, toDecimal(g.proceeds), toDecimal(g.costBasis), toDecimal(g.gain)]),
      ["Total", r.lines.length, toDecimal(r.totalProceeds), toDecimal(r.totalCostBasis), toDecimal(r.totalGain)]
    ],
    rows: [
      ["Asset", "Quantity", "Date acquired", "Date disposed", "Days held", "Line date", "Held", "Proceeds", "Cost basis", "Gain or loss", "File row"],
      ...r.lines.map((l) => [l.asset, l.quantity, l.acquired, l.disposed, l.daysHeld, cxOverAYearFrom(l.acquired), CX_HELD_NAMES[l.held], toDecimal(l.proceeds), toDecimal(l.costBasis), toDecimal(l.gain), l.rowNumber])
    ]
  };
}

// packages/core/src/crypto/tieOut.ts
function cxProceedsTieOut(input) {
  const { disposals, reported } = input;
  if (disposals.length === 0) throw new Error("There are no sales in the export.");
  if (reported.length === 0) throw new Error("Type the total proceeds from the broker statement.");
  const typed = /* @__PURE__ */ new Map();
  for (const entry of reported) {
    if (typed.has(entry.account)) throw new Error(`Account ${entry.account} has more than one typed total.`);
    typed.set(entry.account, entry);
  }
  const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const listedBasis = (d) => d.basis === null ? 0 : d.basis;
  const shown = (account) => account === "" ? "(no account)" : account;
  const accountNames = [.../* @__PURE__ */ new Set([...disposals.map((d) => d.account), ...reported.map((r) => r.account)])].sort(byText);
  const accounts = accountNames.map((account) => {
    const mine = disposals.filter((d) => d.account === account);
    const proceeds = sum(mine.map((d) => d.proceeds));
    const basis = sum(mine.map(listedBasis));
    const entry = typed.get(account);
    const reportedProceeds2 = entry === void 0 ? null : entry.proceeds;
    const reportedBasis = entry === void 0 || entry.basis === void 0 ? null : entry.basis;
    const reportedCount = entry === void 0 || entry.count === void 0 ? null : entry.count;
    return {
      account,
      count: mine.length,
      proceeds,
      basis,
      reportedProceeds: reportedProceeds2,
      difference: reportedProceeds2 === null ? null : proceeds - reportedProceeds2,
      reportedBasis,
      basisDifference: reportedBasis === null ? null : basis - reportedBasis,
      reportedCount
    };
  });
  const linesBy = (keyOf) => [...new Set(disposals.map(keyOf))].sort(byText).map((key) => {
    const mine = disposals.filter((d) => keyOf(d) === key);
    return { key, count: mine.length, proceeds: sum(mine.map((d) => d.proceeds)), basis: sum(mine.map(listedBasis)) };
  });
  const byAsset = linesBy((d) => d.asset);
  const byMonth = linesBy((d) => d.date.slice(0, 7));
  const count = disposals.length;
  const totalProceeds = sum(disposals.map((d) => d.proceeds));
  const totalBasis = sum(disposals.map(listedBasis));
  const reportedProceeds = sum(reported.map((r) => r.proceeds));
  const checks = new CheckList();
  checks.cents("cx-tie-proceeds", "Total proceeds in your export equal the total typed from the broker statement", reportedProceeds, totalProceeds);
  const untied = accounts.filter((a) => a.reportedProceeds === null || a.difference !== 0);
  checks.that(
    "cx-tie-accounts",
    "Every account's proceeds equal the amount typed for it",
    untied.length === 0,
    untied.map((a) => `${shown(a.account)}: export ${formatUSD(a.proceeds)}, statement ${a.reportedProceeds === null ? "not typed" : formatUSD(a.reportedProceeds)}`).join("; ")
  );
  const basisTyped = reported.some((r) => r.basis !== void 0);
  if (basisTyped) {
    const off = accounts.filter((a) => a.reportedBasis !== null && a.basisDifference !== 0);
    checks.that(
      "cx-tie-basis",
      "Cost basis in your export equals the amount typed, wherever one was typed",
      off.length === 0,
      off.map((a) => `${shown(a.account)}: export ${formatUSD(a.basis)}, statement ${formatUSD(a.reportedBasis === null ? 0 : a.reportedBasis)}`).join("; ")
    );
  }
  if (reported.some((r) => r.count !== void 0)) {
    const off = accounts.filter((a) => a.reportedCount !== null && a.reportedCount !== a.count);
    checks.that("cx-tie-count", "The number of sales equals the count typed, wherever one was typed", off.length === 0, off.map((a) => `${shown(a.account)}: export ${a.count}, statement ${a.reportedCount}`).join("; "));
  }
  let allProceeds = 0n;
  let allBasis = 0n;
  for (const d of disposals) {
    allProceeds += BigInt(d.proceeds);
    allBasis += BigInt(listedBasis(d));
  }
  const readds = (lines) => {
    let proceeds = 0n;
    let basis = 0n;
    let n = 0;
    for (const line of lines) {
      proceeds += BigInt(line.proceeds);
      basis += BigInt(line.basis);
      n += line.count;
    }
    return { ok: proceeds === allProceeds && basis === allBasis && n === disposals.length, proceeds };
  };
  const assets = readds(byAsset);
  checks.that(
    "cx-tie-by-asset",
    "Asset totals re-add to the export total and every sale is under exactly one asset",
    assets.ok,
    `assets add to ${formatUSD(Number(assets.proceeds))}, export total ${formatUSD(Number(allProceeds))}`
  );
  const months = readds(byMonth);
  checks.that(
    "cx-tie-by-month",
    "Month totals re-add to the export total and every sale is in exactly one month",
    months.ok,
    `months add to ${formatUSD(Number(months.proceeds))}, export total ${formatUSD(Number(allProceeds))}`
  );
  const seen = /* @__PURE__ */ new Set();
  const repeated = /* @__PURE__ */ new Set();
  for (const d of disposals) {
    if (seen.has(d.rowNumber)) repeated.add(d.rowNumber);
    seen.add(d.rowNumber);
  }
  checks.that("cx-tie-rows-once", "Every sale was counted once", repeated.size === 0, `row(s) ${[...repeated].sort((a, b) => a - b).join(", ")}`);
  if (basisTyped) {
    const unlisted = disposals.filter((d) => d.basis === null).length;
    checks.that("cx-tie-basis-listed", "Every sale in the export lists a cost basis", unlisted === 0, `${unlisted} sale(s) list no cost basis and count as zero`, "warning");
  }
  return { accounts, byAsset, byMonth, count, totalProceeds, totalBasis, reportedProceeds, difference: totalProceeds - reportedProceeds, checks: checks.all };
}
function cxDisposalsFrom(trades, lessFees) {
  return trades.filter((t) => t.side === "sell").map((t) => ({ rowNumber: t.rowNumber, date: t.timestamp.slice(0, 10), asset: t.asset, account: t.account, proceeds: lessFees ? t.amount - t.fee : t.amount, basis: t.basis }));
}
function cxTieOutTables(r) {
  const opt = (c) => c === null ? "" : toDecimal(c);
  const lines = (label, list) => [
    [label, "Sales", "Proceeds", "Cost basis listed"],
    ...list.map((l) => [l.key, l.count, toDecimal(l.proceeds), toDecimal(l.basis)]),
    ["Total", r.count, toDecimal(r.totalProceeds), toDecimal(r.totalBasis)]
  ];
  return {
    accounts: [
      ["Account", "Sales", "Proceeds in export", "Proceeds typed", "Difference", "Cost basis listed", "Cost basis typed", "Basis difference"],
      ...r.accounts.map((a) => [a.account || "(no account)", a.count, toDecimal(a.proceeds), opt(a.reportedProceeds), opt(a.difference), toDecimal(a.basis), opt(a.reportedBasis), opt(a.basisDifference)]),
      ["Total", r.count, toDecimal(r.totalProceeds), toDecimal(r.reportedProceeds), toDecimal(r.difference), toDecimal(r.totalBasis), "", ""]
    ],
    byAsset: lines("Asset", r.byAsset),
    byMonth: lines("Month", r.byMonth)
  };
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
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
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
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
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
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0; i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
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
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
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
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
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
                l = nl, d = dif;
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
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
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
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
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
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
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
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
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
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
};
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
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
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
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
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
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
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&amp;/g, "&");
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

// packages/core/src/crypto/tradeLogTemplate.ts
var CX_TEMPLATE_MAX_ACCOUNTS = 50;
var CX_TEMPLATE_SHEETS = ["Trades", "Accounts", "Log", "Instructions"];
var CX_TEMPLATE_TRADE_HEADERS = ["Date", "Type", "Asset", "Quantity", "Total USD", "Fee USD", "Cost basis USD", "Account", "Notes"];
var CX_TEMPLATE_ACCOUNT_HEADERS = ["Line", "Account or wallet", "Kind", "Notes"];
function cleanOwner(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The name is longer than 120 characters.");
  return s;
}
function cleanYear(value) {
  const s = value.trim();
  if (s !== "" && !/^20\d{2}$/.test(s)) throw new Error("The year must be four digits, from 2000 to 2099.");
  return s;
}
function cleanCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > CX_TEMPLATE_MAX_ACCOUNTS) throw new Error(`The number of accounts and wallets must be a whole number from 1 to ${CX_TEMPLATE_MAX_ACCOUNTS}.`);
  return value;
}
function cxTradeLogTemplateSheets(o) {
  const owner = cleanOwner(o.owner);
  const year = cleanYear(o.year);
  const accounts = cleanCount(o.accountCount);
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/crypto/${slug}/${site ? "?src=template" : ""}`;
  return [
    {
      name: CX_TEMPLATE_SHEETS[0],
      rows: [[...CX_TEMPLATE_TRADE_HEADERS]],
      money: ["Total USD", "Fee USD", "Cost basis USD"],
      widths: [20, 12, 10, 16, 16, 12, 18, 22, 40]
    },
    {
      name: CX_TEMPLATE_SHEETS[1],
      rows: [[...CX_TEMPLATE_ACCOUNT_HEADERS], ...Array.from({ length: accounts }, (_, i) => [i + 1, "", "", ""])],
      money: [],
      widths: [8, 34, 20, 40]
    },
    {
      name: CX_TEMPLATE_SHEETS[2],
      rows: [
        ["Item", "Value"],
        ["Kept for", owner],
        ["Year", year],
        ["Date last updated", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: CX_TEMPLATE_SHEETS[3],
      rows: [
        ["Where", "What goes there"],
        ["About this workbook", "A layout to fill in with buys and sales. It holds values only, with no formulas, so nothing in it calculates."],
        ["Trades", "One row per transaction, under the header row. Do not leave a row blank between two transactions and do not add a total row."],
        ["Date", "The date, with the time when there is one, written like 2026-03-15 or 2026-03-15 16:45:00. The time is kept as written."],
        ["Type", "Buy or Sell. A row with any other type (Send, Receive, Reward, Convert) can be kept here; the tools list it by row number and do not use it."],
        ["Asset", "The symbol, such as BTC."],
        ["Quantity", "How much was bought or sold, with up to 8 decimal places."],
        ["Total USD", "What the buy cost or what the sale brought in, in dollars, before the fee."],
        ["Fee USD", "The fee on the transaction, in dollars. Blank means no fee."],
        ["Cost basis USD", "Only for a sale, and only when a statement or export lists a cost basis for it. Blank otherwise. The tools never fill this in."],
        ["Account", "The account or wallet the row belongs to, as named on the Accounts sheet."],
        ["Accounts", `One row per exchange account or wallet; rows are numbered 1 to ${accounts}. Rows can be added under the last one.`],
        ["Log", "Whose trades these are, the year, and the date the workbook was last updated."],
        ["Capital gains worksheet", `${page("capital-gains-worksheet")} opens this workbook, reads the Trades sheet, and matches each sale to the lots it came from under the method picked there.`],
        ["Proceeds tie-out", `${page("proceeds-tie-out")} opens this workbook, adds up the sales on the Trades sheet, and compares the totals with the ones typed from a broker statement.`]
      ],
      money: [],
      widths: [26, 130]
    }
  ];
}
function cxVerifyTradeLogTemplate(o, bytes) {
  const sheets = cxTradeLogTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const log = rowsOf(CX_TEMPLATE_SHEETS[2]);
  const cell = (label) => log.find((r) => r[0] === label)?.[1] ?? "";
  checks.equal("owner", "The Log sheet carries the name as typed", cleanOwner(o.owner), cell("Kept for"));
  checks.equal("year", "The Log sheet carries the year as typed", cleanYear(o.year), cell("Year"));
  const accounts = rowsOf(CX_TEMPLATE_SHEETS[1]).slice(1);
  checks.that(
    "account-rows",
    `The Accounts sheet has ${o.accountCount} blank rows numbered 1 to ${o.accountCount}`,
    accounts.length === o.accountCount && accounts.every((r, i) => r[0] === String(i + 1) && r.slice(1).every((c) => c === ""))
  );
  const first = read.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  checks.equal("trades-first", "The Trades sheet is the first sheet in the file, the one the tools open", CX_TEMPLATE_SHEETS[0], first?.name ?? "");
  const trades = rowsOf(CX_TEMPLATE_SHEETS[0]);
  const mapping = cxGuessTradeColumns(trades);
  const found = mapping.headerRow === 0 && CX_TRADE_ROLES.every((role) => mapping.columns[role] >= 0);
  const distinct = new Set(CX_TRADE_ROLES.map((role) => mapping.columns[role])).size === CX_TRADE_ROLES.length;
  checks.that("trades-readable", "Every part the tie-out and the capital gains worksheet read is found in the Trades header row, each in a column of its own", found && distinct);
  let empty = false;
  if (found) {
    const x = cxExtractTrades(trades, mapping);
    empty = x.trades.length === 0 && x.problems.length === 0 && x.skipped.length === 0;
  }
  checks.that("trades-empty", "The Trades sheet reads as a trade list with nothing entered yet", empty);
  return checks.all;
}

// packages/agents/src/present.ts
function isVerified(checks) {
  return checks.some((c) => c.severity === "error") && passedAll(checks);
}
var TEXT_ROWS_PER_TABLE = 40;
var SITE_URL = "https://mathproven.com";
function cellText(c) {
  if (c === null || c === void 0) return "";
  return String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function markdownTable(t, limit = TEXT_ROWS_PER_TABLE) {
  const [header, ...body] = t.rows;
  if (!header) return `${t.name}: (empty)`;
  const width = header.length;
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cellText(r[i] ?? "")).join(" | ")} |`;
  const out = [`### ${t.name}`, "", line(header), `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of body.slice(0, limit)) out.push(line(r));
  if (body.length > limit) out.push("", `(${body.length - limit} more row(s) not shown here. Give "saveTo" a path ending .xlsx or .csv to get every row.)`);
  if (body.length === 0) out.push("", "(no rows)");
  return out.join("\n");
}
function checkLine(c) {
  let s = `- ${c.label}`;
  if (c.expected !== void 0 || c.actual !== void 0) s += ` (expected ${c.expected ?? ""}, found ${c.actual ?? ""})`;
  if (c.detail) s += `: ${c.detail}`;
  return s;
}
function pageUrl(entry, ref) {
  const path = entry.page === "" ? "" : `${entry.page.replace(/^\/+|\/+$/g, "")}/`;
  return `${SITE_URL}/${path}?ref=${encodeURIComponent(ref)}`;
}
function present(entry, result, ref, certificate, savedTo, columnsRead = []) {
  const checks = result.checks;
  const verified = isVerified(checks);
  const comparison = new Set(entry.comparisonChecks ?? []);
  const comparisonOnly = !verified && comparison.size > 0 && failures(checks).length > 0 && failures(checks).every((c) => comparison.has(c.id)) && checks.some((c) => c.severity === "error" && c.passed);
  const failed = failures(checks);
  const warned = warnings(checks);
  const link = pageUrl(entry, ref);
  const footer = `${entry.notAdvice} This ran where your assistant runs; nothing was sent to Mathproven. The same tool on the web: ${link}`;
  const tables = verified || comparisonOnly ? result.tables.map((t) => ({ name: t.name, rows: t.rows.slice(0, TEXT_ROWS_PER_TABLE + 1).map((r) => [...r]), moreRows: Math.max(0, t.rows.length - 1 - TEXT_ROWS_PER_TABLE) })) : [];
  const structured = {
    tool: entry.name,
    verified,
    summary: verified || comparisonOnly ? result.summary : "",
    checksRun: checks.length,
    failedChecks: failed.map((c) => ({ id: c.id, label: c.label, ...c.expected !== void 0 ? { expected: c.expected } : {}, ...c.actual !== void 0 ? { actual: c.actual } : {}, ...c.detail ? { detail: c.detail } : {} })),
    warnings: warned.map((c) => ({ id: c.id, label: c.label, ...c.detail ? { detail: c.detail } : {} })),
    tables,
    page: link,
    columnsRead: [...columnsRead]
  };
  const parts = [];
  if (verified) {
    parts.push(`Mathproven, ${entry.title}: VERIFIED. Every error-level check passed (${checks.length} checks run, ${warned.length} warning(s)).`);
    parts.push(result.summary);
    if (warned.length > 0) parts.push(["Warnings (they do not stop the result; read each):", ...warned.map(checkLine)].join("\n"));
    for (const t of result.tables) parts.push(markdownTable(t));
    if (savedTo) parts.push(`Saved: ${savedTo}`);
    parts.push(["Reconciliation certificate", "```", certificate, "```"].join("\n"));
  } else {
    if (comparisonOnly) {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. ${failed.length} of ${checks.length} checks failed: the input does not agree with the figure(s) given. A result whose checks fail is never presented as correct; the input's own figures follow the failed checks, to find the difference.`);
    } else if (failed.length > 0) {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. ${failed.length} of ${checks.length} checks failed, so no figures are given: a result whose checks fail is never presented as correct.`);
    } else {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. No error-level check was run on this result, so no figures are given: nothing unchecked is presented as correct.`);
    }
    parts.push(["Failed checks:", ...failed.map(checkLine)].join("\n"));
    if (warned.length > 0) parts.push(["Warnings:", ...warned.map(checkLine)].join("\n"));
    if (comparisonOnly) {
      parts.push("Every check of the arithmetic itself passed; only the comparison with the figures given failed. The figures below are what the input itself holds, to find the difference. They are NOT a verified result.");
      parts.push(result.summary);
      for (const t of result.tables) parts.push(markdownTable(t));
    } else {
      parts.push("Fix what the failed checks name in the input (a row that could not be read, a total that does not add up) and run it again.");
    }
  }
  if (columnsRead.length > 0) parts.push(['Columns read (name a column with "columns" if one is wrong):', ...columnsRead.map((l) => `- ${l}`)].join("\n"));
  parts.push(footer);
  return { verified, text: parts.join("\n\n"), structured };
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
function parseCivilDate(iso2, label = "date") {
  const m = ISO.exec(typeof iso2 === "string" ? iso2.trim() : "");
  if (!m) throw new Error(`The ${label} must be a date written as YYYY-MM-DD.`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200) throw new Error(`The ${label} has a year outside 1900 to 2200.`);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`The ${label} "${iso2}" is not a real calendar date.`);
  }
  return { year, month, day };
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

// packages/agents/src/registry/crypto.ts
var FEE_CHOICES = ["added", "left out"];
var feeHandlingOf = (choice) => choice === "added" ? "adjust" : "ignore";
var METHOD_CHOICES = ["first in first out", "highest cost first"];
var METHOD_NAMES = { fifo: "First in, first out", hcfo: "Highest cost first" };
var GAINS_TRADE_COLUMNS = { roles: CX_TRADE_ROLES, labels: CX_TRADE_LABELS, required: ["date", "type", "asset", "quantity", "amount"], guess: (rows, at) => cxGuessTradeColumns(rows, at) };
var TIE_OUT_TRADE_COLUMNS = { roles: CX_TRADE_ROLES, labels: CX_TRADE_LABELS, required: ["date", "asset", "amount"], guess: (rows, at) => cxGuessTradeColumns(rows, at) };
var HELD_COLUMNS = { roles: CX_HELD_ROLES, labels: CX_HELD_LABELS, required: ["acquired", "disposed", "proceeds", "basis"], guess: (rows, at) => cxGuessHeldColumns(rows, at) };
var quantityText = (q) => scaledFormat(q, CX_QUANTITY_PLACES, true);
var TRADES_SHEET = /^trades$/i;
function fieldText(v) {
  if (v === null || v === void 0) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new AgentInputError('Each field of a purchase in "buys" must be a number or text.');
}
var BUY_KEYS = ["quantity", "amountPaid", "fee"];
function readBuyLines(raw) {
  const text2 = raw.trim();
  let items;
  if (text2.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text2);
    } catch {
      throw new AgentInputError('"buys" starts with "[" but is not a JSON list. Give one purchase per line as "quantity; amount paid; fee", or a JSON list of [quantity, amount paid, fee].');
    }
    if (!Array.isArray(parsed)) throw new AgentInputError('"buys" must be a list of purchases.');
    items = parsed.map((b, i) => {
      if (Array.isArray(b)) return b.map(fieldText);
      if (b !== null && typeof b === "object") {
        const o = b;
        const unknown = Object.keys(o).filter((k) => !BUY_KEYS.includes(k));
        if (unknown.length > 0) throw new AgentInputError(`Purchase ${i + 1} of "buys" has ${unknown.map((k) => `"${k}"`).join(", ")}; a purchase written as an object takes only "quantity", "amountPaid" and "fee".`);
        return [fieldText(o.quantity), fieldText(o.amountPaid), fieldText(o.fee)];
      }
      throw new AgentInputError(`Purchase ${i + 1} of "buys" must be [quantity, amount paid, fee] or {"quantity", "amountPaid", "fee"}.`);
    });
  } else {
    items = text2.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map((l) => {
      if (!/[;|\t]/.test(l)) throw new AgentInputError(`Each line of "buys" is "quantity; amount paid; fee", the three separated by semicolons: "${l.slice(0, 80)}".`);
      return l.split(/[;|\t]/).map((s) => s.trim());
    });
  }
  const buys = [];
  items.forEach((fields2, i) => {
    const line = i + 1;
    while (fields2.length > 3 && fields2[fields2.length - 1] === "") fields2.pop();
    if (fields2.every((f2) => f2 === "")) return;
    if (fields2.length > 3) throw new AgentInputError(`Purchase ${line} of "buys" has more than three parts; give quantity, amount paid and fee.`);
    const [q = "", a = "", f = ""] = fields2;
    let quantity;
    try {
      quantity = scaledParse(q.replace(/^\$/, ""), CX_QUANTITY_PLACES, "quantity");
    } catch {
      throw new AgentInputError(`Purchase ${line}: the quantity "${q}" is not a number with up to 8 decimal places.`);
    }
    if (quantity <= 0n) throw new AgentInputError(`Purchase ${line}: the quantity must be more than zero.`);
    if (a === "") throw new AgentInputError(`Purchase ${line}: the amount paid is missing.`);
    const cents = (text3, what) => {
      if (text3 === "") return 0;
      let c;
      try {
        c = parseAmount(text3);
      } catch {
        throw new AgentInputError(`Purchase ${line}: the ${what} "${text3}" is not an amount in dollars and cents.`);
      }
      if (c < 0) throw new AgentInputError(`Purchase ${line}: the ${what} must be zero or more.`);
      return c;
    };
    buys.push({ line, quantity, amount: cents(a, "amount paid"), fee: cents(f, "fee") });
  });
  if (buys.length === 0) throw new AgentInputError('Type at least one purchase in "buys": its quantity and the amount paid.');
  if (buys.length > 200) throw new AgentInputError('"buys" has more than 200 purchases; the page takes up to 200 lines.');
  return buys;
}
function averageSummary(r, asset) {
  const of = asset ? ` of ${asset}` : "";
  const total = quantityText(r.totalQuantity);
  const parts = [
    `${r.lines.length} purchase(s)${of}, fees ${r.feeHandling === "adjust" ? "added to cost" : "left out"}: total quantity ${total}, total paid before fees ${formatUSD(r.totalAmount)}, total fees ${formatUSD(r.totalFees)}, total cost ${formatUSD(r.totalCost)}.`,
    `Average cost per unit: ${formatUSD(r.totalCost)} divided by ${total} is ${cxFormatPrice(r.average)}.`
  ];
  if (r.price !== null && r.value !== null && r.difference !== null) {
    const diff = r.difference === 0 ? "the same as the total cost" : `which is ${formatUSD(Math.abs(r.difference))} ${r.difference > 0 ? "more" : "less"} than the total cost`;
    parts.push(`At ${cxFormatPrice(r.price)} per unit, ${total} is worth ${formatUSD(r.value)}, ${diff}.`);
  }
  return parts.join(" ");
}
var averageCost = {
  name: "crypto_average_cost_per_coin",
  page: "crypto/average-cost-calculator",
  section: "crypto",
  kind: "tool",
  title: "Average cost per coin across several purchases",
  description: "Works out the average cost per unit of one coin or token across several purchases: total quantity, total paid before fees, total fees, total cost, and total cost divided by total quantity to eight decimal places, with each purchase's own cost per unit beside it. Fees are added to cost or left out, as chosen. Every total is added a second way, every divided figure is multiplied back to give its cost, and the average is checked to lie between the lowest and the highest cost per unit. With a price per unit given, it also shows what the total quantity is worth at that price and the difference from the total cost. Use it when someone asks for their average cost per coin, or their cost per unit across several buys of the same asset. Not for sales or lot matching, not for several different coins in one run, and it does not say what cost basis to report.",
  question: "I bought Bitcoin three times this year. What is my average cost per coin with the fees included?",
  inputs: [
    {
      name: "buys",
      kind: "text",
      label: "Purchases",
      description: 'The purchases of one asset, one per line as "quantity; amount paid; fee" (semicolons between the three), for example "0.5; 15,000.00; 15.00". Quantity takes up to 8 decimal places; amount paid is the total for the purchase in dollars before the fee; a blank fee is zero. A JSON list also works, each purchase as [quantity, amount paid, fee] or as {"quantity", "amountPaid", "fee"} (no other keys). Up to 200 purchases.',
      required: true
    },
    { name: "fees", kind: "choice", label: "Fees", choices: FEE_CHOICES, description: '"added": each purchase costs its amount paid plus its fee. "left out": each costs its amount paid alone (the total of the fees is still shown). The person chooses; it is not picked for them.', required: true },
    { name: "price", kind: "number", label: "Price per unit to compare with", description: "Optional. A price per unit in dollars, up to 8 decimal places, written without the $ sign (such as 40000 or 0.00001234): the value of the total quantity at that price and its difference from the total cost are shown.", required: false },
    { name: "asset", kind: "text", label: "Asset", description: "Optional. The asset symbol, such as BTC, for the heading of the result.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven divides total cost by total quantity; it does not match sales to lots, it is not a tax form, and it does not say what to report.",
  run({ values }) {
    const buys = readBuyLines(String(values.buys ?? ""));
    let price = null;
    if (values.price !== void 0) {
      const text2 = String(values.price);
      if (text2.endsWith("%")) throw new AgentInputError('"price" is a price per unit in dollars, not a percent.');
      try {
        price = scaledParse(text2, CX_PRICE_PLACES, "price");
      } catch {
        throw new AgentInputError(`"price" "${text2}" is not a price with up to 8 decimal places.`);
      }
      if (price < 0n) throw new AgentInputError('"price" must be zero or more.');
    }
    const asset = String(values.asset ?? "").trim().toUpperCase().slice(0, 20);
    const r = cxAverageCost({ buys, feeHandling: feeHandlingOf(values.fees), price });
    const t = cxAverageCostTables(r);
    const summary = asset ? [t.summary[0], ["Asset", asset], ...t.summary.slice(1)] : t.summary;
    return {
      summary: averageSummary(r, asset),
      tables: [
        { name: "Average cost", rows: summary },
        { name: "Buys", rows: t.lines }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: three purchases of one coin, fees added to cost, compared with $40,000.00 per unit",
      args: { buys: "0.5; 15,000.00; 15.00\n0.25; 10,000.00; 10.00\n0.1; 4,500.00; 4.50", fees: "added", price: "40000.00", asset: "BTC" },
      verified: true,
      contains: [
        "total quantity 0.85",
        "$29,500.00",
        "$29.50",
        "$29,529.50",
        "$34,740.58823529",
        "$34,000.00",
        "$4,470.50",
        "| 1 | 0.5 | 15015.00 | 30030.00000000 |",
        "| 2 | 0.25 | 10010.00 | 40040.00000000 |",
        "| 3 | 0.1 | 4504.50 | 45045.00000000 |"
      ]
    },
    {
      label: "The page's worked example with fees left out",
      args: { buys: '[["0.5", "15000.00", "15.00"], ["0.25", "10000.00", "10.00"], ["0.1", "4500.00", "4.50"]]', fees: "left out" },
      verified: true,
      contains: ["total cost $29,500.00", "$34,705.88235294"]
    }
  ]
};
var capitalGains = {
  name: "crypto_capital_gains_worksheet",
  page: "crypto/capital-gains-worksheet",
  section: "crypto",
  kind: "tool",
  title: "Crypto capital gains worksheet, lot by lot, from an exchange export",
  description: "Builds a lot-by-lot gains worksheet from an exchange or wallet export of buys and sales (.csv or .xlsx): each sale is matched to the lots it came from under the method chosen (first in, first out, or highest cost first), giving asset, quantity, date acquired, date disposed, proceeds, cost basis and gain or loss per row, plus the lots still held. A second lot engine written a different way has to agree; quantity and cost are proved conserved per asset and per lot, each sale's proceeds are split by quantity to the cent, and a sale larger than the holdings before it is listed and never given a zero basis. Transfers, rewards and swaps are listed, not matched; lots are pooled per asset across accounts. Use it when someone needs gains and losses or cost basis per sale worked out from their own trade history, as at tax time. Not a tax form, it does not pick the method, and it does not say what to report.",
  question: "Can you work out my crypto capital gains from this exchange export, first in first out, with fees included?",
  inputs: [
    {
      name: "tradeExport",
      kind: "file",
      label: "Trade export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date (and time), type (buy or sell), asset, quantity and total cost or proceeds are needed; fee and account are used when present. Rows of any other type (transfers, rewards, conversions or swaps) are listed and not used. In a workbook, a sheet named Trades is the one read.",
      required: true
    },
    { name: "method", kind: "choice", label: "Lot method", choices: METHOD_CHOICES, description: '"first in first out" takes the oldest lot first; "highest cost first" takes the lot with the highest cost per unit first. The person chooses; it is not picked for them.', required: true },
    { name: "fees", kind: "choice", label: "Fees", choices: FEE_CHOICES, description: '"added": each purchase fee is added to its cost and each sale fee is subtracted from its proceeds. "left out": fees are not used. The person chooses; it is not picked for them.', required: true },
    columnsInput("Trade export", GAINS_TRADE_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven builds a worksheet of your own trades under the method you picked; it is not a tax form, is not in any agency's form layout, and does not say what to report.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "tradeExport"), TRADES_SHEET);
    const mapping = mapColumns(file, GAINS_TRADE_COLUMNS, values.columns, "Trade export");
    const method = values.method === "highest cost first" ? "hcfo" : "fifo";
    const feeHandling = feeHandlingOf(values.fees);
    const x = cxExtractTrades(file.rows, mapping);
    const problems = [...x.problems, ...x.trades.filter((t2) => t2.quantity === 0n).map((t2) => ({ rowNumber: t2.rowNumber, reason: "no quantity" }))];
    const trades = x.trades.filter((t2) => t2.quantity > 0n);
    const r = cxCapitalGainsWorksheet({ trades, method, feeHandling });
    const t = cxGainsTables(r);
    const held = /* @__PURE__ */ new Map();
    for (const lot of r.remaining) {
      const m = held.get(lot.asset) ?? { q: 0n, c: 0 };
      held.set(lot.asset, { q: m.q + lot.quantity, c: m.c + lot.costBasis });
    }
    const sales = trades.filter((tr) => tr.side === "sell").length;
    const stillHeld = held.size === 0 ? "Nothing is left in any lot." : `Still held: ${[...held].map(([asset, h]) => `${quantityText(h.q)} ${asset} carrying ${formatUSD(h.c)} of cost basis`).join("; ")}.`;
    const summary = [
      `${METHOD_NAMES[method]}, fees ${feeHandling === "adjust" ? "added to cost and subtracted from proceeds" : "left out"}: ${sales} sale(s) matched into ${r.rows.length} worksheet row(s). Proceeds ${formatUSD(r.totalProceeds)}, cost basis ${formatUSD(r.totalCostBasis)}, gain or loss ${formatUSD(r.totalGain)}.`,
      stillHeld,
      x.otherRows ? `${x.otherRows} row(s) that are neither a buy nor a sale (transfers, rewards, conversions or swaps of one coin into another) are not used; they are listed on the certificate.` : "",
      "Lots are pooled per asset across every account or wallet in the file."
    ].filter(Boolean);
    return {
      summary: summary.join(" "),
      tables: [
        { name: "Worksheet", rows: t.rows },
        { name: "Sales with no lot", rows: t.shortfalls },
        { name: "Lots still held", rows: t.remaining }
      ],
      checks: [...r.checks, ...sheetRowChecks(problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: two purchases and two sales of BTC, first in first out, fees added",
      args: { tradeExport: "fixture:crypto/exchange-trades.csv", method: "first in first out", fees: "added" },
      verified: true,
      contains: ["Proceeds $50,949.00", "cost basis $38,038.00", "gain or loss $12,911.00", "0.3 BTC carrying $12,012.00", "14985.00", "9009.00", "5976.00", "27972.00", "21021.00", "6951.00", "7992.00", "8008.00", "-16.00"]
    },
    {
      label: "The same export, highest cost first",
      args: { tradeExport: "fixture:crypto/exchange-trades.csv", method: "highest cost first", fees: "added" },
      verified: true,
      contains: ["cost basis $41,041.00", "gain or loss $9,908.00"]
    },
    {
      label: "A sale larger than the holdings before it is not verified",
      args: { tradeExport: "Timestamp,Transaction Type,Asset,Quantity Transacted,Subtotal,Fees\n2026-01-05 10:15:00,Buy,BTC,1,30000.00,30.00\n2026-03-15 16:45:00,Sell,BTC,1.5,45000.00,45.00\n", method: "first in first out", fees: "added" },
      verified: false,
      failedCheck: "cx-gain-holdings"
    },
    {
      label: "A trade row whose total cannot be read is not verified",
      args: { tradeExport: "Timestamp,Transaction Type,Asset,Quantity Transacted,Subtotal,Fees\n2026-01-05 10:15:00,Buy,BTC,1,30000.00,30.00\n2026-03-15 16:45:00,Sell,BTC,0.5,2OOOO.00,15.00\n", method: "first in first out", fees: "added" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var holdingPeriod = {
  name: "crypto_holding_period_split",
  page: "crypto/holding-period-split",
  section: "crypto",
  kind: "tool",
  title: "Short-term and long-term split of a crypto gains worksheet",
  description: "Splits a lot-by-lot gains worksheet (.csv or .xlsx, one row per lot sold with date acquired, date disposed, proceeds and cost basis) into rows held one year or less and rows held more than one year, often called short-term and long-term, with the row count, proceeds, cost basis and gain or loss of each group, and every row with its days held and the date its one-year line falls on. The one-year line is worked out two ways that have to agree on every row (the count starts the day after the date acquired), group totals are added a second way, a gain column or total line in the file is checked against the rows, and rows disposed within a day of the line are flagged. Use it when someone asks how much of their crypto gain is short-term and how much long-term, from a worksheet they already have. Not for building the worksheet from raw trades or for tax rates, and it does not say which rule applies or what to report.",
  question: "How much of my crypto gain this year is short-term and how much is long-term? Here is my gains worksheet.",
  inputs: [
    {
      name: "gainsWorksheet",
      kind: "file",
      label: "Gains worksheet",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per lot sold: date acquired, date disposed, proceeds and cost basis are needed; asset, quantity and a gain or loss column are used when present. A total line is checked against the rows. A blank cost basis is unreadable, never zero.",
      required: true
    },
    columnsInput("Gains worksheet", HELD_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven applies the rule stated on the page (the count starts the day after the date acquired, and a row is held more than one year when the date disposed is on or after that day one year later), using dates only; it counts and adds, it is not a tax form, and it does not say what to report.",
  run({ files, values }) {
    const file = oneFile(files, "gainsWorksheet");
    const x = cxExtractHeldRows(file.rows, mapColumns(file, HELD_COLUMNS, values.columns, "Gains worksheet"));
    if (x.rows.length === 0 && x.problems.length === 0) throw new Error("No row with a date acquired and a date disposed was found under the header row.");
    const r = cxHoldingPeriodSplit(x.rows, x.fileTotal);
    const t = cxHoldingPeriodTables(r);
    const group = r.groups.map((g) => `${CX_HELD_NAMES[g.held]}: ${g.count} row(s), proceeds ${formatUSD(g.proceeds)}, cost basis ${formatUSD(g.costBasis)}, gain or loss ${formatUSD(g.gain)}.`);
    return {
      summary: [...group, `Together: ${r.lines.length} row(s), proceeds ${formatUSD(r.totalProceeds)}, cost basis ${formatUSD(r.totalCostBasis)}, gain or loss ${formatUSD(r.totalGain)}.`, "Rule applied: the count starts the day after the date acquired, and a row is held more than one year when the date disposed is on or after that day one year later."].join(" "),
      tables: [
        { name: "By holding period", rows: t.summary },
        { name: "Rows", rows: t.rows }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: four lots of BTC and ETH, one disposed on the first day past its one-year line",
      args: { gainsWorksheet: "fixture:crypto/lot-worksheet.csv" },
      verified: true,
      contains: [
        "One year or less: 2 row(s), proceeds $19,985.00, cost basis $13,209.00, gain or loss $6,776.00",
        "More than one year: 2 row(s), proceeds $35,964.00, cost basis $29,029.00, gain or loss $6,935.00",
        "proceeds $55,949.00, cost basis $42,238.00, gain or loss $13,711.00",
        "| 319 | 2026-01-06 | One year or less |",
        "| 366 | 2026-01-06 | More than one year |",
        "| 434 | 2026-02-11 | More than one year |",
        "| 204 | 2025-03-11 | One year or less |",
        "Within a day of the line, where one day decides the group: row(s) 3"
      ]
    },
    {
      label: "A total line that does not equal the rows is not verified",
      args: { gainsWorksheet: "Asset,Date acquired,Date disposed,Proceeds,Cost basis\nBTC,2025-01-05,2025-11-20,14985.00,9009.00\nBTC,2025-02-10,2026-04-20,7992.00,8008.00\nTotal,,,23977.00,17017.00\n" },
      verified: false,
      failedCheck: "hp-file-proceeds"
    },
    {
      label: "A row with a blank cost basis is not verified",
      args: { gainsWorksheet: "Asset,Date acquired,Date disposed,Proceeds,Cost basis\nBTC,2025-01-05,2025-11-20,14985.00,9009.00\nBTC,2025-02-10,2026-04-20,7992.00,\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readAccountTotals(raw) {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map((l) => {
    const parts = l.split("|").map((s) => s.trim());
    if (parts.length < 2 || parts.length > 4) throw new AgentInputError(`Each line of "statementByAccount" is "account | total proceeds | cost basis | number of sales", the last two optional: "${l.slice(0, 80)}".`);
    return { account: parts[0], proceeds: parts[1], basis: parts[2] ?? "", count: parts[3] ?? "" };
  });
}
var NO_ACCOUNT = "(no account)";
var shownAccount = (account) => account === "" ? NO_ACCOUNT : account;
function typedTotal(account, proceeds, basis, count) {
  const where = account === "" ? "the sales with no account" : `account ${account}`;
  const cents = (text2, what) => {
    try {
      return parseAmount(text2);
    } catch {
      throw new AgentInputError(`The ${what} typed for ${where}, "${text2}", is not an amount in dollars and cents.`);
    }
  };
  if (proceeds === "") throw new AgentInputError(`Type the total proceeds printed on the statement for ${where}.`);
  if (count !== "" && !/^\d+$/.test(count)) throw new AgentInputError("The number of sales must be a whole number.");
  return { account, proceeds: cents(proceeds, "total proceeds"), ...basis === "" ? {} : { basis: cents(basis, "cost basis") }, ...count === "" ? {} : { count: Number(count) } };
}
var proceedsTieOut = {
  name: "crypto_proceeds_tie_out",
  page: "crypto/proceeds-tie-out",
  section: "crypto",
  kind: "tool",
  title: "Crypto proceeds tie-out: an export against a broker statement",
  description: "Adds up the sales in a person's own exchange or wallet export (.csv or .xlsx) and sets them against the totals typed from a broker statement: total proceeds and each account's proceeds side by side with the difference, plus cost basis and the number of sales wherever those are typed, and the export broken down by asset and by month so a difference can be located. Asset and month totals are re-added to the export total in a separate pass, every sale is counted once, and buys, transfers, rewards and swaps are listed and not added up. When only the comparison with the typed figures fails, the export's own totals and breakdown are still given, marked not verified, so the difference can be located. Use it when the proceeds on a broker or exchange statement do not match someone's own records, or to confirm that they do. Not for working out gains or cost basis, and it does not say which figure is right or what belongs on a return.",
  question: "The total proceeds on my exchange tax statement do not match my own trade export. Where is the difference?",
  inputs: [
    {
      name: "tradeExport",
      kind: "file",
      label: "Trade or sales export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date, asset and proceeds are needed; type, quantity, fee, cost basis and account are used when present. With a type column only sales are added up; with none, every row is a sale. In a workbook, a sheet named Trades is the one read.",
      required: true
    },
    { name: "statementProceeds", kind: "amount", label: "Total proceeds on the statement", description: "The total proceeds printed on the broker statement, when the export has one account or no account column. For several accounts, give statementByAccount instead.", required: false },
    { name: "statementBasis", kind: "amount", label: "Cost basis on the statement", description: "Optional, with statementProceeds: the total cost basis printed on the statement.", required: false },
    { name: "statementSales", kind: "number", label: "Number of sales on the statement", description: "Optional, with statementProceeds: the number of sales the statement lists, a whole number.", required: false },
    {
      name: "statementByAccount",
      kind: "text",
      label: "Statement totals by account",
      description: 'For an export with several accounts: one line per account as "account | total proceeds | cost basis | number of sales", the last two optional, with each account named as it is in the export, for example "Main | 4,889.75"; sales with a blank account are named "(no account)". Every account in the export needs a line for the result to tie out.',
      required: false
    },
    { name: "proceedsLessFees", kind: "boolean", label: "Take proceeds less fees", description: "Optional. true takes each sale's proceeds as its amount minus its fee; without it, proceeds are taken as written in the export.", required: false },
    columnsInput("Trade or sales export", TIE_OUT_TRADE_COLUMNS)
  ],
  limits: "site",
  // The comparisons with what the person typed from the statement; every other check is of the export's own arithmetic.
  comparisonChecks: ["cx-tie-proceeds", "cx-tie-accounts", "cx-tie-basis", "cx-tie-count"],
  notAdvice: "Mathproven shows where the arithmetic differs; it does not say which figure is right or what belongs on a return.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "tradeExport"), TRADES_SHEET);
    const mapping = mapColumns(file, TIE_OUT_TRADE_COLUMNS, values.columns, "Trade or sales export");
    const x = cxExtractTrades(file.rows, mapping, mapping.columns.type < 0 ? "sell" : void 0);
    const disposals = cxDisposalsFrom(x.trades, values.proceedsLessFees === true);
    const buys = x.trades.filter((t2) => t2.side === "buy");
    const skipped = [...x.skipped, ...buys.map((t2) => ({ rowNumber: t2.rowNumber, reason: "a buy (only sales are added up)" }))].sort((a, b) => a.rowNumber - b.rowNumber);
    const otherRows = x.otherRows + buys.length;
    if (disposals.length === 0) {
      const unread = x.problems.length ? ` ${x.problems.length} row(s) could not be read: ${x.problems.slice(0, 10).map((p) => `row ${p.rowNumber} (${p.reason})`).join(", ")}.` : "";
      throw new AgentInputError(`There are no sales in the export to add up.${unread}`);
    }
    const accounts = [...new Set(disposals.map((d) => d.account))].sort();
    const accountList = accounts.map(shownAccount).join(", ");
    const single = values.statementProceeds !== void 0;
    const byAccount = values.statementByAccount !== void 0;
    if (single && byAccount) throw new AgentInputError("Give either statementProceeds (one account) or statementByAccount (one line per account), not both.");
    if (!single && (values.statementBasis !== void 0 || values.statementSales !== void 0)) throw new AgentInputError("statementBasis and statementSales go with statementProceeds; for several accounts, put them on each line of statementByAccount.");
    const reported = [];
    if (single) {
      if (accounts.length > 1) throw new AgentInputError(`The export's sales are in ${accounts.length} accounts (${accountList}). Give the statement's totals for each with statementByAccount, one line per account, for example "${shownAccount(accounts[0])} | 1,234.56".`);
      const cents = values.statementProceeds;
      const basis = values.statementBasis;
      const count = values.statementSales;
      if (count !== void 0 && !/^\d+$/.test(count)) throw new AgentInputError("The number of sales must be a whole number.");
      reported.push({ account: accounts[0], proceeds: cents, ...basis === void 0 ? {} : { basis }, ...count === void 0 ? {} : { count: Number(count) } });
    } else if (byAccount) {
      const seen = /* @__PURE__ */ new Set();
      for (const line of readAccountTotals(String(values.statementByAccount))) {
        const typed = line.account.toLowerCase() === NO_ACCOUNT ? "" : line.account;
        const account = accounts.find((a) => a === typed) ?? accounts.find((a) => a.toLowerCase() === typed.toLowerCase());
        if (account === void 0) throw new AgentInputError(`The export has no sales in an account named "${line.account}". The accounts its sales are in: ${accountList}.`);
        if (seen.has(account)) throw new AgentInputError(`Account ${shownAccount(account)} has more than one line in statementByAccount.`);
        seen.add(account);
        reported.push(typedTotal(account, line.proceeds, line.basis, line.count));
      }
      if (reported.length === 0) throw new AgentInputError("statementByAccount has no lines in it.");
    } else {
      throw new AgentInputError(`Type the total proceeds from the broker statement: statementProceeds for one account, or statementByAccount with one line per account (the accounts the export's sales are in: ${accountList}).`);
    }
    const r = cxProceedsTieOut({ disposals, reported });
    const t = cxTieOutTables(r);
    const list = (lines) => lines.map((l) => `${l.key} ${formatUSD(l.proceeds)}`).join(", ");
    const summary = [
      `${r.count} sale(s) in the export add up to ${formatUSD(r.totalProceeds)} against ${formatUSD(r.reportedProceeds)} typed from the statement, a difference of ${formatUSD(r.difference)}.`,
      `By asset: ${list(r.byAsset)}. By month: ${list(r.byMonth)}.`,
      otherRows ? `${otherRows} row(s) that are not sales (buys, transfers, rewards, conversions or swaps) are not added up; they are listed on the certificate.` : "",
      values.proceedsLessFees === true ? "Each sale's proceeds are its amount minus its fee." : "Proceeds are taken as written in the export."
    ].filter(Boolean);
    return {
      summary: summary.join(" "),
      tables: [
        { name: "Accounts", rows: t.accounts },
        { name: "By asset", rows: t.byAsset },
        { name: "By month", rows: t.byMonth }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: five sales in one account against $4,889.75 on the statement, not verified, with the breakdown that puts the $310.25 at the SOL sale in February",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementProceeds: "4,889.75" },
      verified: false,
      failedCheck: "cx-tie-proceeds",
      contains: [
        "expected $4,889.75, found $5,200.00): off by $310.25",
        "They are NOT a verified result",
        "add up to $5,200.00 against $4,889.75 typed from the statement, a difference of $310.25",
        "By asset: BTC $3,350.00, ETH $1,539.75, SOL $310.25",
        "By month: 2026-01 $1,890.50, 2026-02 $2,410.25, 2026-03 $899.25",
        "| Main | 5 | 5200.00 | 4889.75 | 310.25 |",
        "| SOL | 1 | 310.25 | 295.00 |",
        "| 2026-02 | 2 | 2410.25 | 2095.00 |"
      ]
    },
    {
      label: "The same export against a statement that prints $5,200.00: the breakdown by asset and by month",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementProceeds: "5,200.00" },
      verified: true,
      contains: ["add up to $5,200.00", "BTC $3,350.00", "ETH $1,539.75", "SOL $310.25", "2026-01 $1,890.50", "2026-02 $2,410.25", "2026-03 $899.25"]
    },
    {
      label: "Statement totals typed per account, with cost basis and the number of sales",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementByAccount: "Main | 5,200.00 | 4,705.00 | 5" },
      verified: true,
      contains: ["add up to $5,200.00", "| Main | 5 | 5200.00 | 5200.00 | 0.00 | 4705.00 | 4705.00 | 0.00 |"]
    },
    {
      label: "A sale whose proceeds cannot be read is not verified, and no figures are given even though the statement total matches the rest",
      args: { tradeExport: "Date Sold,Asset,Proceeds,Account\n2026-01-14,BTC,1250.00,Main\n2026-02-19,SOL,31O.25,Main\n", statementProceeds: "1,250.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var fileSlug = (text2) => text2.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
var TEMPLATE_ROWS = {
  Trades: () => "One per transaction, under the header row",
  Accounts: (o) => `${o.accountCount} numbered`,
  Log: () => "Name and year filled in",
  Instructions: () => "What each column holds"
};
var tradeLogTemplate = {
  name: "crypto_trade_log_template",
  page: "crypto/trade-log-template",
  section: "crypto",
  kind: "template",
  title: "Blank crypto trade log workbook (Excel)",
  description: "Builds a blank Excel trade log (.xlsx) for a year of crypto buys and sales: a Trades sheet with date, type, asset, quantity, total USD, fee USD, cost basis USD, account and notes columns, an Accounts sheet with the number of numbered rows asked for, a Log sheet with the name and year, and an Instructions sheet saying what each column holds. The finished file is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked for, the Trades header is matched the way the gains worksheet and the proceeds tie-out read it, and no cell holds a formula. Use it when someone wants a spreadsheet to keep track of their crypto trades through the year or for tax season. Not a calculator: it holds values only and works nothing out.",
  question: "Can you make me a spreadsheet to log my crypto trades for 2026? I use three exchanges and wallets.",
  inputs: [
    { name: "name", kind: "text", label: "Name", description: "Optional. Whose trades the log holds, printed on the Log sheet and used in the file name; up to 120 characters.", required: false },
    { name: "year", kind: "year", label: "Year", description: "Optional. The year the log covers, four digits from 2000 to 2099, printed on the Log sheet and used in the file name.", required: false },
    { name: "accountCount", kind: "number", label: "Number of accounts and wallets", description: "Optional. How many numbered rows the Accounts sheet starts with, a whole number from 1 to 50; 2 when not given, as on the page.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in; it holds values only, with no formulas, so it does not calculate, and it does not say what to report.",
  run({ values }) {
    const countText = values.accountCount === void 0 ? "2" : String(values.accountCount);
    if (!/^\d+$/.test(countText)) throw new AgentInputError("The number of accounts and wallets must be a whole number from 1 to 50.");
    const options = { owner: String(values.name ?? ""), year: values.year === void 0 ? "" : String(values.year), accountCount: Number(countText), siteUrl: SITE_URL };
    const sheets = cxTradeLogTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = cxVerifyTradeLogTemplate(options, bytes);
    const suggestedName = `${["crypto-trade-log", fileSlug(options.owner), options.year.trim()].filter(Boolean).join("-")}.xlsx`;
    const rows = sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), TEMPLATE_ROWS[s.name]?.(options) ?? String(s.rows.length - 1)]);
    const owner = options.owner.trim();
    return {
      summary: `A blank trade log workbook, ${suggestedName}, with ${sheets.length} sheets: ${sheets.map((s) => s.name).join(", ")}. The Log sheet carries ${owner ? owner : "no name"} and ${options.year ? options.year : "no year"}; the Accounts sheet has rows numbered 1 to ${options.accountCount}, all blank; the Trades sheet has its header row and nothing under it.`,
      tables: [{ name: "Sheets", rows: [["Sheet", "Columns", "Rows to fill in"], ...rows] }],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Sam Example, 2026, three accounts and wallets",
      args: { name: "Sam Example", year: "2026", accountCount: "3" },
      verified: true,
      contains: ["crypto-trade-log-sam-example-2026.xlsx", "Date, Type, Asset, Quantity, Total USD, Fee USD, Cost basis USD, Account, Notes", "Line, Account or wallet, Kind, Notes", "3 numbered", "Item, Value", "Where, What goes there"]
    }
  ]
};
var CRYPTO = [capitalGains, proceedsTieOut, holdingPeriod, averageCost, tradeLogTemplate];
var CRYPTO_NOT_FOR_AGENTS = [];

export {
  assertCents,
  formatUSD,
  writeXlsx,
  readXlsx,
  parseCivilDate,
  AgentInputError,
  checkValue,
  CheckList,
  passedAll,
  failures,
  certify,
  certificateText,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  GAINS_TRADE_COLUMNS,
  TIE_OUT_TRADE_COLUMNS,
  HELD_COLUMNS,
  readBuyLines,
  readAccountTotals,
  CRYPTO,
  CRYPTO_NOT_FOR_AGENTS
};
