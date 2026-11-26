// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
// packages/core/src/sheetInput.ts
function sheetIsTotalWord(cell) {
  return /^(?:grand|statement|report|page|sub)?[\s-]*totals?\b/i.test(cell.trim());
}
function sheetRowList(rows) {
  const MAX_REASONS = 8;
  const MAX_ROWS = 20;
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
    const first = numbers.slice(0, MAX_ROWS);
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
function sheetNormalizeHeader(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
function scaledParseNumber(raw, places, label = "number") {
  const v = scaledParse(raw, places, label);
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} "${raw}" is out of range.`);
  return Number(v);
}
function scaledFormat(value, places, trim = false) {
  const v = BigInt(value);
  const abs = (v < 0n ? -v : v).toString().padStart(places + 1, "0");
  let out = places === 0 ? abs : `${abs.slice(0, abs.length - places)}.${abs.slice(abs.length - places)}`;
  if (trim && places > 0) out = out.replace(/\.?0+$/, "");
  return (v < 0n ? "-" : "") + out;
}

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
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
function formatUSD(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
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

// packages/core/src/trucking/fuelTaxCheck.ts
function trkIsRounded(value, n, d, step) {
  if (d <= 0n || step <= 0n || value % step !== 0n) return false;
  const scaled = value * d;
  const gap = scaled > n ? scaled - n : n - scaled;
  if (2n * gap !== step * d) return 2n * gap < step * d;
  return (scaled < 0n ? -scaled : scaled) > (n < 0n ? -n : n);
}
function addTo(sums, key, amount) {
  sums.set(key, (sums.get(key) ?? 0n) + amount);
}
var sorted = (names) => [...new Set(names)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
function trkVerifyFuelTax(input, sheet) {
  const checks = new CheckList();
  const miles3 = (k) => scaledFormat(k, 3);
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const step = input.wholeGallons ? 1000n : 1n;
  const inputMiles = /* @__PURE__ */ new Map();
  const inputFuel = /* @__PURE__ */ new Map();
  let totalMiles = 0n;
  let totalFuel = 0n;
  for (const m of input.miles) {
    addTo(inputMiles, m.jurisdiction, B(m.milesK));
    totalMiles += B(m.milesK);
  }
  for (const f of input.fuel) {
    addTo(inputFuel, f.jurisdiction, B(f.gallonsK));
    totalFuel += B(f.gallonsK);
  }
  const rates = /* @__PURE__ */ new Map();
  const rateConflicts = /* @__PURE__ */ new Set();
  for (const r of input.rates) {
    const rate = B(r.rateTenThousandths);
    if (rates.has(r.jurisdiction) && rates.get(r.jurisdiction) !== rate) rateConflicts.add(r.jurisdiction);
    rates.set(r.jurisdiction, rate);
  }
  const rows = sheet.rows.map((r) => ({
    jurisdiction: r.jurisdiction,
    miles: B(r.milesK),
    purchased: B(r.purchasedGallonsK),
    taxable: B(r.taxableGallonsK),
    net: B(r.netGallonsK),
    rate: r.rateTenThousandths === null ? null : B(r.rateTenThousandths),
    tax: r.taxCents === null ? null : B(r.taxCents)
  }));
  const shown = {
    miles: B(sheet.totalMilesK),
    purchased: B(sheet.totalPurchasedGallonsK),
    mpg: B(sheet.mpgHundredths),
    taxable: B(sheet.totalTaxableGallonsK),
    net: B(sheet.totalNetGallonsK),
    tax: B(sheet.totalTaxCents)
  };
  const typedMiles = input.typedTotalMilesK === void 0 ? void 0 : B(input.typedTotalMilesK);
  const typedGallons = input.typedTotalGallonsK === void 0 ? void 0 : B(input.typedTotalGallonsK);
  const mpgMin = input.mpgMinHundredths === void 0 ? void 0 : B(input.mpgMinHundredths);
  const mpgMax = input.mpgMaxHundredths === void 0 ? void 0 : B(input.mpgMaxHundredths);
  checks.that("trk-ft-whole-numbers", "Every figure in the input and on the worksheet is a whole number in its unit", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const wanted = /* @__PURE__ */ new Set([...inputMiles.keys(), ...inputFuel.keys()]);
  const seen = /* @__PURE__ */ new Set();
  const wrongNames = [];
  for (const r of rows) {
    if (seen.has(r.jurisdiction) || !wanted.has(r.jurisdiction)) wrongNames.push(r.jurisdiction);
    seen.add(r.jurisdiction);
  }
  for (const name of wanted) if (!seen.has(name)) wrongNames.push(name);
  checks.that("trk-ft-jurisdictions", "Every jurisdiction with miles or fuel is on the worksheet exactly once", wrongNames.length === 0, sorted(wrongNames).join(", "));
  const rowMiles = rows.reduce((n, r) => n + r.miles, 0n);
  const badMiles = rows.filter((r) => r.miles !== (inputMiles.get(r.jurisdiction) ?? 0n)).map((r) => r.jurisdiction);
  const milesTotalsOk = totalMiles === rowMiles && totalMiles === shown.miles;
  checks.that(
    "trk-ft-miles",
    "Each jurisdiction’s miles are its own miles rows added up, and the jurisdictions add up to total miles",
    badMiles.length === 0 && milesTotalsOk,
    [sorted(badMiles).join(", "), milesTotalsOk ? "" : `input ${miles3(totalMiles)}, rows ${miles3(rowMiles)}, total ${miles3(shown.miles)}`].filter(Boolean).join("; ")
  );
  if (typedMiles !== void 0) checks.equal("trk-ft-miles-typed", "Total miles equal the total you typed", miles3(typedMiles), miles3(shown.miles));
  const badGallons = rows.filter((r) => !trkIsRounded(r.purchased, inputFuel.get(r.jurisdiction) ?? 0n, 1n, step)).map((r) => r.jurisdiction);
  const gallonsTotalOk = totalFuel === shown.purchased;
  checks.that(
    "trk-ft-gallons",
    input.wholeGallons ? "Each jurisdiction’s gallons purchased are its own fuel rows added up and rounded to a whole gallon, and total gallons purchased is every fuel row added up before rounding" : "Each jurisdiction’s gallons purchased are its own fuel rows added up, and total gallons purchased is every fuel row added up",
    badGallons.length === 0 && gallonsTotalOk,
    [sorted(badGallons).join(", "), gallonsTotalOk ? "" : `input ${miles3(totalFuel)}, total ${miles3(shown.purchased)}`].filter(Boolean).join("; ")
  );
  if (typedGallons !== void 0) checks.equal("trk-ft-gallons-typed", "Total gallons equal the total you typed", miles3(typedGallons), miles3(shown.purchased));
  const mpg = totalFuel > 0n && totalMiles >= 0n ? (200n * totalMiles + totalFuel) / (2n * totalFuel) : 0n;
  const mpgKnown = totalFuel > 0n && mpg > 0n && trkIsRounded(mpg, totalMiles * 100n, totalFuel, 1n);
  checks.add({
    id: "trk-ft-mpg",
    label: "Miles per gallon is total miles divided by total gallons, rounded to 2 decimals",
    passed: totalFuel > 0n && trkIsRounded(shown.mpg, totalMiles * 100n, totalFuel, 1n),
    severity: "error",
    expected: totalFuel > 0n ? scaledFormat(mpg, 2) : "not defined (no gallons)",
    actual: scaledFormat(shown.mpg, 2)
  });
  const rounding = (whole) => whole ? "whole gallons" : "3 decimals";
  checks.equal("trk-ft-rounding", "The worksheet rounds gallons the way you chose", rounding(input.wholeGallons), rounding(sheet.wholeGallons === true));
  const badTaxable = rows.filter((r) => !mpgKnown || !trkIsRounded(r.taxable, (inputMiles.get(r.jurisdiction) ?? 0n) * 100n, mpg, step)).map((r) => r.jurisdiction);
  checks.that(
    "trk-ft-taxable",
    input.wholeGallons ? "Each jurisdiction’s taxable gallons are its own miles divided by fleet miles per gallon, rounded to a whole gallon" : "Each jurisdiction’s taxable gallons are its own miles divided by fleet miles per gallon, rounded to 3 decimals",
    badTaxable.length === 0,
    sorted(badTaxable).join(", ")
  );
  const rowTaxable = rows.reduce((n, r) => n + r.taxable, 0n);
  const drift = rowTaxable * mpg - totalMiles * 100n;
  const allowedTwice = BigInt(rows.length) * step;
  const consumed = mpgKnown ? (200n * totalMiles + mpg) / (2n * mpg) : 0n;
  checks.that(
    "trk-ft-taxable-total",
    "Taxable gallons add up to the total shown, within the stated rounding of total miles divided by miles per gallon",
    mpgKnown && rowTaxable === shown.taxable && 2n * (drift < 0n ? -drift : drift) <= allowedTwice * mpg,
    `rows ${miles3(rowTaxable)}, total shown ${miles3(shown.taxable)}, total miles ÷ miles per gallon ${miles3(consumed)}, allowed difference ${scaledFormat(allowedTwice * 5n, 4)}`
  );
  const badNet = rows.filter((r) => r.net !== r.taxable - r.purchased).map((r) => r.jurisdiction);
  const netTotalOk = rows.reduce((n, r) => n + r.net, 0n) === shown.net;
  checks.that("trk-ft-net", "Net taxable gallons are taxable gallons minus gallons purchased, row by row and in total", badNet.length === 0 && netTotalOk, [...sorted(badNet), ...netTotalOk ? [] : ["total"]].join(", "));
  const badRates = rows.filter((r) => r.rate === null || rateConflicts.has(r.jurisdiction) || rates.get(r.jurisdiction) !== r.rate).map((r) => r.jurisdiction);
  checks.that("trk-ft-rates", "Every jurisdiction on the worksheet carries the rate from your rate table", badRates.length === 0, sorted(badRates).join(", "));
  const badTax = rows.filter((r) => {
    const rate = rates.get(r.jurisdiction);
    if (rate === void 0) return r.tax !== null;
    return r.tax === null || !trkIsRounded(r.tax, (r.taxable - r.purchased) * rate, 100000n, 1n);
  }).map((r) => r.jurisdiction);
  const taxTotalOk = rows.reduce((n, r) => n + (r.tax ?? 0n), 0n) === shown.tax;
  checks.that(
    "trk-ft-tax",
    "Each jurisdiction’s tax is its taxable gallons minus its gallons purchased, times its rate in your table, rounded to the cent, and the rows add up to total tax",
    badTax.length === 0 && taxTotalOk,
    [...sorted(badTax), ...taxTotalOk ? [] : ["total"]].join(", ")
  );
  if (mpgMin !== void 0 || mpgMax !== void 0) {
    const inside = (mpgMin === void 0 || shown.mpg >= mpgMin) && (mpgMax === void 0 || shown.mpg <= mpgMax);
    checks.that("trk-ft-mpg-band", "Miles per gallon is inside the band you set", inside, `${scaledFormat(shown.mpg, 2)} is outside the band`, "warning");
  }
  return checks.all;
}

// packages/core/src/trucking/fuelTax.ts
function trkRoundDiv(n, d) {
  if (d <= 0n) throw new Error("Division by zero or a negative number.");
  const abs = n < 0n ? -n : n;
  const q = abs / d + (2n * (abs % d) >= d ? 1n : 0n);
  return n < 0n ? -q : q;
}
function trkSafe(n, label) {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} is too large.`);
  return Number(n);
}
function trkFuelTaxWorksheet(input) {
  for (const entry of [...input.miles, ...input.fuel]) {
    if (entry.jurisdiction === "") throw new Error(`Row ${entry.rowNumber} has no jurisdiction.`);
  }
  for (const m of input.miles) {
    if (!Number.isSafeInteger(m.milesK) || m.milesK < 0) throw new Error(`Miles on row ${m.rowNumber} must be a whole number of thousandths, zero or more.`);
  }
  for (const f of input.fuel) {
    if (!Number.isSafeInteger(f.gallonsK)) throw new Error(`Gallons on row ${f.rowNumber} must be a whole number of thousandths.`);
  }
  const rateOf = /* @__PURE__ */ new Map();
  for (const r of input.rates) {
    if (!Number.isSafeInteger(r.rateTenThousandths) || r.rateTenThousandths < 0) {
      throw new Error(`The rate for ${r.jurisdiction} must be a whole number of ten-thousandths of a dollar, zero or more.`);
    }
    if (rateOf.has(r.jurisdiction)) throw new Error(`The rate table lists ${r.jurisdiction} more than once.`);
    rateOf.set(r.jurisdiction, BigInt(r.rateTenThousandths));
  }
  const milesBy = /* @__PURE__ */ new Map();
  let totalMiles = 0n;
  for (const m of input.miles) {
    totalMiles += BigInt(m.milesK);
    milesBy.set(m.jurisdiction, (milesBy.get(m.jurisdiction) ?? 0n) + BigInt(m.milesK));
  }
  const fuelBy = /* @__PURE__ */ new Map();
  let totalFuel = 0n;
  for (const f of input.fuel) {
    totalFuel += BigInt(f.gallonsK);
    fuelBy.set(f.jurisdiction, (fuelBy.get(f.jurisdiction) ?? 0n) + BigInt(f.gallonsK));
  }
  if (totalMiles === 0n) throw new Error("There are no miles to work with.");
  if (totalFuel <= 0n) throw new Error("Total fuel gallons must be more than zero to compute miles per gallon.");
  const mpg = trkRoundDiv(totalMiles * 100n, totalFuel);
  if (mpg === 0n) throw new Error("Miles per gallon rounds to zero.");
  const jurisdictions = [.../* @__PURE__ */ new Set([...milesBy.keys(), ...fuelBy.keys()])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  let totalTaxable = 0n;
  let totalNet = 0n;
  let totalTax = 0n;
  const rows = jurisdictions.map((jurisdiction) => {
    const miles = milesBy.get(jurisdiction) ?? 0n;
    const bought = fuelBy.get(jurisdiction) ?? 0n;
    const purchased = input.wholeGallons ? trkRoundDiv(bought, 1000n) * 1000n : bought;
    const taxable = input.wholeGallons ? trkRoundDiv(miles * 100n, mpg * 1000n) * 1000n : trkRoundDiv(miles * 100n, mpg);
    const net = taxable - purchased;
    const rate = rateOf.get(jurisdiction);
    const tax = rate === void 0 ? null : trkRoundDiv(net * rate, 100000n);
    totalTaxable += taxable;
    totalNet += net;
    if (tax !== null) totalTax += tax;
    return {
      jurisdiction,
      milesK: trkSafe(miles, `miles for ${jurisdiction}`),
      purchasedGallonsK: trkSafe(purchased, `gallons purchased for ${jurisdiction}`),
      taxableGallonsK: trkSafe(taxable, `taxable gallons for ${jurisdiction}`),
      netGallonsK: trkSafe(net, `net gallons for ${jurisdiction}`),
      rateTenThousandths: rate === void 0 ? null : trkSafe(rate, `rate for ${jurisdiction}`),
      taxCents: tax === null ? null : trkSafe(tax, `tax for ${jurisdiction}`)
    };
  });
  return {
    rows,
    wholeGallons: input.wholeGallons,
    totalMilesK: trkSafe(totalMiles, "total miles"),
    totalPurchasedGallonsK: trkSafe(totalFuel, "total gallons purchased"),
    mpgHundredths: trkSafe(mpg, "miles per gallon"),
    totalTaxableGallonsK: trkSafe(totalTaxable, "total taxable gallons"),
    totalNetGallonsK: trkSafe(totalNet, "total net gallons"),
    totalTaxCents: trkSafe(totalTax, "total tax")
  };
}
function trkQuarterlyFuelTax(input) {
  const sheet = trkFuelTaxWorksheet(input);
  return { ...sheet, checks: trkVerifyFuelTax(input, sheet) };
}
function trkFuelTaxTable(s) {
  const g = (k) => scaledFormat(k, 3, true);
  return [
    ["Jurisdiction", "Miles", "Gallons purchased", "Taxable gallons", "Net taxable gallons", "Rate per gallon", "Tax"],
    ...s.rows.map((r) => [r.jurisdiction, g(r.milesK), g(r.purchasedGallonsK), g(r.taxableGallonsK), g(r.netGallonsK), r.rateTenThousandths === null ? "" : scaledFormat(r.rateTenThousandths, 4), r.taxCents === null ? "" : toDecimal(r.taxCents)]),
    ["Total", g(s.totalMilesK), g(s.rows.reduce((n, r) => n + r.purchasedGallonsK, 0)), g(s.totalTaxableGallonsK), g(s.totalNetGallonsK), "", toDecimal(s.totalTaxCents)]
  ];
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

// packages/core/src/trucking/input.ts
function trkJurisdiction(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}
function trkJurisdictionFromLocation(location) {
  const m = /(?:,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?|\s([A-Za-z]{2})\s+\d{5}(?:-\d{4})?)\s*$/.exec(location.trim());
  return m ? (m[1] ?? m[2]).toUpperCase() : "";
}
var TRK_MILES_ROLES = ["jurisdiction", "miles"];
var TRK_MILES_LABELS = { jurisdiction: "Jurisdiction (state or province)", miles: "Miles" };
var MILES_SYNONYMS = {
  jurisdiction: ["jurisdiction", "state", "state province", "province", "state code", "juris"],
  miles: ["total miles", "miles", "distance", "distance miles", "mileage", "taxable miles"]
};
function trkGuessMilesColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, TRK_MILES_ROLES, MILES_SYNONYMS, atHeaderRow);
}
function trkExtractMiles(rows, mapping) {
  const c = mapping.columns;
  for (const role of TRK_MILES_ROLES) if (c[role] < 0) throw new Error(`Choose the column that holds: ${TRK_MILES_LABELS[role]}.`);
  const out = { rows: [], problems: [], skipped: [] };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const jurisdiction = trkJurisdiction(sheetCell(cells, c.jurisdiction));
    const milesText = sheetCell(cells, c.miles);
    if (sheetIsTotalWord(jurisdiction)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!milesText) {
      out.skipped.push({ rowNumber, reason: "no miles" });
      continue;
    }
    try {
      if (!jurisdiction) throw new Error("miles with no jurisdiction");
      const milesK = scaledParseNumber(milesText, 3, "miles");
      if (milesK < 0) throw new Error("miles are negative");
      out.rows.push({ rowNumber, jurisdiction, milesK });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}
var TRK_FUEL_ROLES = ["date", "jurisdiction", "location", "gallons", "amount", "unit", "card"];
var TRK_FUEL_LABELS = {
  date: "Date",
  jurisdiction: "Jurisdiction (state or province)",
  location: "Location or merchant address",
  gallons: "Gallons",
  amount: "Amount",
  unit: "Unit or truck",
  card: "Card or driver"
};
var FUEL_SYNONYMS = {
  date: ["transaction date", "date", "trans date", "purchase date", "posted date"],
  jurisdiction: ["jurisdiction", "state", "state province", "province", "merchant state", "st"],
  location: ["location", "merchant city", "city", "merchant", "site", "merchant name", "station", "address"],
  gallons: ["gallons", "quantity", "qty", "units", "fuel gallons", "volume", "gal"],
  amount: ["total amount", "amount", "total", "net amount", "total cost", "cost", "sale amount"],
  unit: ["unit", "unit number", "truck", "vehicle", "vehicle id", "unit id", "truck number"],
  card: ["card", "card number", "driver", "driver name", "card id", "driver id"]
};
function trkGuessFuelColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, TRK_FUEL_ROLES, FUEL_SYNONYMS, atHeaderRow);
}
function trkExtractFuelCard(rows, mapping) {
  const c = mapping.columns;
  if (c.gallons < 0) throw new Error(`Choose the column that holds: ${TRK_FUEL_LABELS.gallons}.`);
  const out = { rows: [], problems: [], skipped: [] };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const gallonsText = sheetCell(cells, c.gallons);
    const dateText = sheetCell(cells, c.date);
    if (!dateText && cells.some(sheetIsTotalWord)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!gallonsText) {
      out.skipped.push({ rowNumber, reason: "no gallons" });
      continue;
    }
    try {
      if (c.date >= 0 && !dateText) throw new Error("gallons with no date");
      const place = sheetCell(cells, c.location);
      const amountText = sheetCell(cells, c.amount);
      out.rows.push({
        rowNumber,
        date: dateText ? pmCellToIsoDate(dateText) : "",
        jurisdiction: trkJurisdiction(sheetCell(cells, c.jurisdiction)) || trkJurisdictionFromLocation(place),
        location: place,
        unit: sheetCell(cells, c.unit),
        card: sheetCell(cells, c.card),
        gallonsK: scaledParseNumber(gallonsText, 3, "gallons"),
        amount: amountText ? pmCellToCents(amountText) : 0
      });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}
function trkParseRateText(text) {
  const out = { rates: [], problems: [] };
  const lines = text.split(/\r?\n/);
  let first = true;
  lines.forEach((line, index) => {
    const parts = line.trim().split(/\s*[\t,]\s*|\s+/).filter((p) => p !== "");
    if (parts.length === 0) return;
    const isFirst = first;
    first = false;
    const rateText = parts[parts.length - 1].replace(/^\$/, "");
    const jurisdiction = trkJurisdiction(parts.length > 2 ? parts.slice(0, -1).join(" ") : parts[0]);
    try {
      if (parts.length < 2) throw new Error("needs a jurisdiction and a rate");
      const rateTenThousandths = scaledParseNumber(rateText, 4, "rate");
      if (rateTenThousandths < 0) throw new Error("rate is negative");
      out.rates.push({ jurisdiction, rateTenThousandths });
    } catch (err) {
      if (isFirst && !/\d/.test(rateText)) return;
      out.problems.push({ rowNumber: index + 1, reason: err instanceof Error ? err.message : "could not be read" });
    }
  });
  return out;
}

// packages/core/src/trucking/fuelRates.ts
var TRK_FUEL_KIND_LABELS = { diesel: "diesel (special fuel)", gasoline: "gasoline" };
var TRK_FUEL_TAX_JURISDICTIONS = [
  ...[
    ["AL", "Alabama"],
    ["AZ", "Arizona"],
    ["AR", "Arkansas"],
    ["CA", "California"],
    ["CO", "Colorado"],
    ["CT", "Connecticut"],
    ["DE", "Delaware"],
    ["FL", "Florida"],
    ["GA", "Georgia"],
    ["ID", "Idaho"],
    ["IL", "Illinois"],
    ["IN", "Indiana"],
    ["IA", "Iowa"],
    ["KS", "Kansas"],
    ["KY", "Kentucky"],
    ["LA", "Louisiana"],
    ["ME", "Maine"],
    ["MD", "Maryland"],
    ["MA", "Massachusetts"],
    ["MI", "Michigan"],
    ["MN", "Minnesota"],
    ["MS", "Mississippi"],
    ["MO", "Missouri"],
    ["MT", "Montana"],
    ["NE", "Nebraska"],
    ["NV", "Nevada"],
    ["NH", "New Hampshire"],
    ["NJ", "New Jersey"],
    ["NM", "New Mexico"],
    ["NY", "New York"],
    ["NC", "North Carolina"],
    ["ND", "North Dakota"],
    ["OH", "Ohio"],
    ["OK", "Oklahoma"],
    ["OR", "Oregon"],
    ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"],
    ["SC", "South Carolina"],
    ["SD", "South Dakota"],
    ["TN", "Tennessee"],
    ["TX", "Texas"],
    ["UT", "Utah"],
    ["VT", "Vermont"],
    ["VA", "Virginia"],
    ["WA", "Washington"],
    ["WV", "West Virginia"],
    ["WI", "Wisconsin"],
    ["WY", "Wyoming"]
  ].map(([code, name]) => ({ code, name, country: "US" })),
  ...[
    ["AB", "Alberta"],
    ["BC", "British Columbia"],
    ["MB", "Manitoba"],
    ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador"],
    ["NS", "Nova Scotia"],
    ["ON", "Ontario"],
    ["PE", "Prince Edward Island"],
    ["QC", "Quebec"],
    ["SK", "Saskatchewan"]
  ].map(([code, name]) => ({ code, name, country: "CA" }))
];
function trkFuelJurisdictionName(code) {
  return TRK_FUEL_TAX_JURISDICTIONS.find((j) => j.code === code)?.name;
}
function trkFuelRate(row, fuel) {
  return fuel === "diesel" ? row.dieselTenThousandths : row.gasolineTenThousandths;
}
function trkFuelSurchargeRate(row, fuel) {
  if (!row.surcharge) return null;
  return fuel === "diesel" ? row.surcharge.dieselTenThousandths : row.surcharge.gasolineTenThousandths;
}
function trkFindFuelRate(table, jurisdiction) {
  return table.rows.find((r) => r.jurisdiction === jurisdiction);
}
function trkIsIsoDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}
function trkQuarterBounds(quarter) {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return null;
  const q = Number(m[2]);
  const ends = ["03-31", "06-30", "09-30", "12-31"];
  const starts = ["01-01", "04-01", "07-01", "10-01"];
  return { firstDay: `${m[1]}-${starts[q - 1]}`, lastDay: `${m[1]}-${ends[q - 1]}` };
}
var listed = (items) => [...new Set(items)].sort().join(", ");
var isRate = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function sourceProblem(s, latest) {
  if (!s) return "no source";
  if (typeof s.citation !== "string" || s.citation.trim().length < 8) return "no citation";
  let url = null;
  try {
    url = typeof s.sourceUrl === "string" ? new URL(s.sourceUrl) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") return "no https source address";
  if (typeof s.checkedOn !== "string" || !trkIsIsoDay(s.checkedOn)) return "no checked date";
  if (s.checkedOn > latest) return `checked ${s.checkedOn}, after the table's date ${latest}`;
  return "";
}
function trkCheckFuelRateTable(table) {
  const checks = new CheckList();
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const bounds = trkQuarterBounds(table.quarter);
  const offQuarter = rows.filter((r) => r.quarter !== table.quarter).map((r) => r.jurisdiction);
  const boundsOk = bounds !== null && bounds.firstDay === table.firstDay && bounds.lastDay === table.lastDay;
  checks.that(
    "trk-fr-quarter",
    `Every row is for ${table.label} (${table.firstDay} to ${table.lastDay})`,
    boundsOk && offQuarter.length === 0,
    [boundsOk ? "" : `the quarter ${table.quarter} does not run ${table.firstDay} to ${table.lastDay}`, offQuarter.length ? `rows for another quarter: ${listed(offQuarter)}` : ""].filter(Boolean).join("; ")
  );
  const members = new Set(TRK_FUEL_TAX_JURISDICTIONS.map((j) => j.code));
  const seen = /* @__PURE__ */ new Map();
  for (const code of [...rows.map((r) => r.jurisdiction), ...gaps.map((g) => g.jurisdiction)]) seen.set(code, (seen.get(code) ?? 0) + 1);
  const strangers = [...seen.keys()].filter((code) => !members.has(code));
  const twice = [...seen.entries()].filter(([, n]) => n > 1).map(([code]) => code);
  const unaccounted = [...members].filter((code) => !seen.has(code));
  checks.that(
    "trk-fr-jurisdictions",
    "Every member jurisdiction is in the table once or listed once as not yet covered, and no jurisdiction appears twice",
    strangers.length === 0 && twice.length === 0 && unaccounted.length === 0,
    [strangers.length ? `not a member: ${listed(strangers)}` : "", twice.length ? `more than once: ${listed(twice)}` : "", unaccounted.length ? `missing from both lists: ${listed(unaccounted)}` : ""].filter(Boolean).join("; ")
  );
  const badRates = rows.filter((r) => {
    if (!isRate(r.dieselTenThousandths)) return true;
    if (r.gasolineTenThousandths !== null && !isRate(r.gasolineTenThousandths)) return true;
    if (r.surcharge) {
      const s = r.surcharge;
      if (s.dieselTenThousandths === null && s.gasolineTenThousandths === null) return true;
      if (s.dieselTenThousandths !== null && !isRate(s.dieselTenThousandths)) return true;
      if (s.gasolineTenThousandths !== null && !isRate(s.gasolineTenThousandths)) return true;
    }
    return false;
  }).map((r) => r.jurisdiction);
  checks.that("trk-fr-whole-rates", "Every rate is a whole number of ten-thousandths of a dollar per gallon, zero or more", badRates.length === 0, listed(badRates));
  const unsourced = [];
  for (const r of rows) {
    const own = sourceProblem(r, table.checkedOn);
    if (own) unsourced.push(`${r.jurisdiction} (${own})`);
    if (r.surcharge) {
      const sur = sourceProblem(r.surcharge, table.checkedOn);
      if (sur) unsourced.push(`${r.jurisdiction} surcharge (${sur})`);
    }
  }
  for (const g of gaps) if (typeof g.reason !== "string" || g.reason.trim().length < 10) unsourced.push(`${g.jurisdiction} (no reason given for leaving it out)`);
  const crossChecks = Array.isArray(table.crossChecks) ? table.crossChecks : [];
  for (const x of crossChecks) {
    const own = sourceProblem(x, table.checkedOn);
    if (own) unsourced.push(`cross-check table ${x.name} (${own})`);
  }
  if (!trkIsIsoDay(table.checkedOn)) unsourced.push(`the table (its date ${table.checkedOn} is not a real day)`);
  checks.that("trk-fr-sourced", "Every row names the table it was read from, links that source, and carries the date it was checked", unsourced.length === 0, unsourced.join("; "));
  const codes = rows.map((r) => r.jurisdiction);
  const inOrder = codes.every((code, i) => i === 0 || codes[i - 1] < code);
  checks.that("trk-fr-sorted", "Rows are in jurisdiction-code order", inOrder, "rows are out of order");
  if (crossChecks.length) {
    const differ = [];
    const shown = (v) => Number.isSafeInteger(v) ? scaledFormat(v, 4) : String(v);
    for (const r of rows) {
      const ownSurcharge = r.surcharge?.dieselTenThousandths ?? 0;
      for (const x of crossChecks) {
        const theirs = x.diesel?.[r.jurisdiction];
        if (theirs === void 0) differ.push(`${r.jurisdiction}: no rate in ${x.name}`);
        else if (theirs !== r.dieselTenThousandths) differ.push(`${r.jurisdiction}: ${shown(r.dieselTenThousandths)}, ${x.name} ${shown(theirs)}`);
        const theirSurcharge = x.dieselSurcharge?.[r.jurisdiction] ?? 0;
        if (theirSurcharge !== ownSurcharge) differ.push(`${r.jurisdiction} surcharge: ${shown(ownSurcharge)}, ${x.name} ${shown(theirSurcharge)}`);
      }
    }
    checks.that(
      "trk-fr-agree",
      `Every row's diesel rate and surcharge are the same in each of the ${crossChecks.length} other official tables for the quarter (${crossChecks.map((x) => x.name).join(", ")})`,
      differ.length === 0,
      differ.slice(0, 12).join("; ")
    );
  }
  const gapCodes = gaps.map((g) => g.jurisdiction);
  checks.that("trk-fr-coverage", "Every member jurisdiction has a row", gapCodes.length === 0, `${gapCodes.length} not yet covered: ${listed(gapCodes)}`, "warning");
  return checks.all;
}
function trkFuelRateFeed(table, fuel) {
  const rates = [];
  for (const row of table.rows) {
    const rate = trkFuelRate(row, fuel);
    if (rate !== null) rates.push({ jurisdiction: row.jurisdiction, rateTenThousandths: rate });
  }
  const text = rates.map((r) => `${r.jurisdiction} ${scaledFormat(r.rateTenThousandths, 4)}`).join("\n");
  const have = new Set(rates.map((r) => r.jurisdiction));
  const missing = TRK_FUEL_TAX_JURISDICTIONS.map((j) => j.code).filter((code) => !have.has(code)).sort();
  return { fuel, rates, text, missing, checks: trkVerifyFuelRateFeed(table, fuel, { rates, text }) };
}
function trkVerifyFuelRateFeed(table, fuel, feed) {
  const checks = new CheckList();
  const base = /* @__PURE__ */ new Map();
  const withSurcharge = /* @__PURE__ */ new Map();
  for (const row of table.rows) {
    const rate = fuel === "diesel" ? row.dieselTenThousandths : row.gasolineTenThousandths;
    if (rate === null || !Number.isSafeInteger(rate)) continue;
    base.set(row.jurisdiction, BigInt(rate));
    const extra = row.surcharge ? fuel === "diesel" ? row.surcharge.dieselTenThousandths : row.surcharge.gasolineTenThousandths : null;
    if (extra !== null && Number.isSafeInteger(extra) && extra > 0) withSurcharge.set(row.jurisdiction, BigInt(rate) + BigInt(extra));
  }
  const compare = (list) => {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const r of list) {
      const want = base.get(r.jurisdiction);
      if (seen.has(r.jurisdiction)) out.push(`${r.jurisdiction} twice`);
      seen.add(r.jurisdiction);
      if (want === void 0) {
        out.push(`${r.jurisdiction} is not in the table for ${fuel}`);
        continue;
      }
      if (!Number.isSafeInteger(r.rateTenThousandths) || BigInt(r.rateTenThousandths) !== want) {
        const sur = withSurcharge.get(r.jurisdiction);
        const got = Number.isSafeInteger(r.rateTenThousandths) ? scaledFormat(r.rateTenThousandths, 4) : String(r.rateTenThousandths);
        out.push(sur !== void 0 && Number.isSafeInteger(r.rateTenThousandths) && BigInt(r.rateTenThousandths) === sur ? `${r.jurisdiction} has its surcharge added (${got})` : `${r.jurisdiction} ${got}, table ${scaledFormat(want, 4)}`);
      }
    }
    for (const code of base.keys()) if (!seen.has(code)) out.push(`${code} left out`);
    return out;
  };
  const label = TRK_FUEL_KIND_LABELS[fuel];
  const given = compare(feed.rates);
  checks.that("trk-fr-feed", `The ${label} rates the worksheet receives are exactly this table's base rates, with no surcharge added`, given.length === 0, given.slice(0, 12).join("; "));
  const read = trkParseRateText(feed.text);
  const readBack = [...read.problems.map((p) => `line ${p.rowNumber}: ${p.reason}`), ...compare(read.rates)];
  checks.that("trk-fr-feed-text", "The rate box text, read back by the worksheet’s own reader, gives the same rates", readBack.length === 0, readBack.slice(0, 12).join("; "));
  return checks.all;
}
function trkCompareRatesToTable(rates, table, fuel) {
  const changed = [];
  for (const r of rates) {
    const row = trkFindFuelRate(table, r.jurisdiction);
    const want = row ? trkFuelRate(row, fuel) : null;
    if (want !== null && want !== r.rateTenThousandths) changed.push(`${r.jurisdiction} ${scaledFormat(r.rateTenThousandths, 4)} (table ${scaledFormat(want, 4)})`);
  }
  return {
    id: "trk-fr-box-matches",
    label: `Every rate in the rate box for a jurisdiction in the dated table for ${table.label} is that table's ${TRK_FUEL_KIND_LABELS[fuel]} rate`,
    passed: changed.length === 0,
    severity: "warning",
    ...changed.length ? { detail: `changed from the table: ${changed.join("; ")}` } : {}
  };
}
function trkFuelDatesInTableQuarter(rows, table) {
  const outside = rows.filter((r) => r.date !== "" && (r.date < table.firstDay || r.date > table.lastDay));
  const shown = outside.slice(0, 12).map((r) => `row ${r.rowNumber} (${r.date})`);
  return {
    id: "trk-fr-dates-in-quarter",
    label: `Every dated fuel purchase is in ${table.label} (${table.firstDay} to ${table.lastDay}), the quarter of the dated table the rates came from`,
    passed: outside.length === 0,
    severity: "error",
    ...outside.length ? { detail: `${outside.length} row(s) dated outside it: ${shown.join(", ")}${outside.length > shown.length ? ", …" : ""}` } : {}
  };
}
function trkFuelSurchargeCheck(jurisdictions, table, fuel) {
  const hits = [];
  for (const code of [...new Set(jurisdictions)].sort()) {
    const row = trkFindFuelRate(table, code);
    const extra = row ? trkFuelSurchargeRate(row, fuel) : null;
    if (row && extra !== null && extra > 0) hits.push(`${code} ${scaledFormat(extra, 4)} per gallon (${row.surcharge.citation})`);
  }
  return {
    id: "trk-fr-surcharge",
    label: `No jurisdiction here has a surcharge in the dated table for ${table.label}`,
    passed: hits.length === 0,
    severity: "warning",
    ...hits.length ? { detail: `not computed here, see the table: ${hits.join("; ")}` } : {}
  };
}
function trkFuelRateTax(table, input) {
  const name = trkFuelJurisdictionName(input.jurisdiction) ?? input.jurisdiction;
  const row = trkFindFuelRate(table, input.jurisdiction);
  if (!row) throw new Error(`${name} is not in the table for ${table.label} yet.`);
  const rate = trkFuelRate(row, input.fuel);
  if (rate === null) throw new Error(`The table for ${table.label} has no ${TRK_FUEL_KIND_LABELS[input.fuel]} rate for ${name}.`);
  for (const [value, what] of [
    [input.taxableGallonsK, "Taxable gallons"],
    [input.purchasedGallonsK, "Gallons purchased"]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a whole number of thousandths of a gallon, zero or more.`);
  }
  const net = BigInt(input.taxableGallonsK) - BigInt(input.purchasedGallonsK);
  const tax = trkRoundDiv(net * BigInt(rate), 100000n);
  const result = {
    ...input,
    row,
    netGallonsK: trkSafe(net, "net taxable gallons"),
    rateTenThousandths: rate,
    taxCents: trkSafe(tax, "tax")
  };
  return { ...result, checks: trkVerifyFuelRateTax(table, result) };
}
function trkVerifyFuelRateTax(table, r) {
  const checks = new CheckList();
  const fresh = table.rows.find((row) => row.jurisdiction === r.jurisdiction);
  const tableRate = fresh ? r.fuel === "diesel" ? fresh.dieselTenThousandths : fresh.gasolineTenThousandths : null;
  const whole = [r.taxableGallonsK, r.purchasedGallonsK, r.netGallonsK, r.rateTenThousandths, r.taxCents].every((v) => Number.isSafeInteger(v));
  checks.add({
    id: "trk-fr-calc-rate",
    label: `The rate used is the table's ${TRK_FUEL_KIND_LABELS[r.fuel]} rate for this jurisdiction`,
    passed: tableRate !== null && whole && r.rateTenThousandths === tableRate,
    severity: "error",
    expected: tableRate === null ? "no rate in the table" : scaledFormat(tableRate, 4),
    actual: Number.isSafeInteger(r.rateTenThousandths) ? scaledFormat(r.rateTenThousandths, 4) : String(r.rateTenThousandths)
  });
  const netOk = whole && BigInt(r.netGallonsK) + BigInt(r.purchasedGallonsK) === BigInt(r.taxableGallonsK);
  checks.that("trk-fr-calc-net", "Net taxable gallons plus gallons purchased equal taxable gallons", netOk, whole ? `${scaledFormat(r.netGallonsK, 3)} + ${scaledFormat(r.purchasedGallonsK, 3)} is not ${scaledFormat(r.taxableGallonsK, 3)}` : "a figure is not a whole number in its unit");
  const taxOk = whole && tableRate !== null && trkIsRounded(BigInt(r.taxCents), BigInt(r.netGallonsK) * BigInt(tableRate), 100000n, 1n);
  checks.that("trk-fr-calc-tax", "Tax is net taxable gallons times the table’s rate, rounded half away from zero to the cent", taxOk, whole ? `${scaledFormat(r.taxCents, 2)} is not ${scaledFormat(r.netGallonsK, 3)} gallons at the table's rate` : "a figure is not a whole number in its unit");
  if (fresh && trkFuelSurchargeRate(fresh, r.fuel) !== null) checks.add(trkFuelSurchargeCheck([r.jurisdiction], table, r.fuel));
  return checks.all;
}

export {
  parseAmount,
  toDecimal,
  formatUSD,
  sum,
  CheckList,
  passedAll,
  failures,
  warnings,
  certify,
  certificateText,
  sheetIsTotalWord,
  sheetRowChecks,
  sheetNormalizeHeader,
  sheetGuessColumns,
  sheetDataRows,
  sheetCell,
  scaledParseNumber,
  scaledFormat,
  trkIsRounded,
  trkRoundDiv,
  trkSafe,
  trkQuarterlyFuelTax,
  trkFuelTaxTable,
  TRK_MILES_ROLES,
  TRK_MILES_LABELS,
  trkGuessMilesColumns,
  trkExtractMiles,
  TRK_FUEL_ROLES,
  TRK_FUEL_LABELS,
  trkGuessFuelColumns,
  trkExtractFuelCard,
  trkParseRateText,
  TRK_FUEL_KIND_LABELS,
  TRK_FUEL_TAX_JURISDICTIONS,
  trkFuelJurisdictionName,
  trkFuelRate,
  trkFuelSurchargeRate,
  trkFindFuelRate,
  trkIsIsoDay,
  trkQuarterBounds,
  trkCheckFuelRateTable,
  trkFuelRateFeed,
  trkVerifyFuelRateFeed,
  trkCompareRatesToTable,
  trkFuelDatesInTableQuarter,
  trkFuelSurchargeCheck,
  trkFuelRateTax,
  trkVerifyFuelRateTax
};
