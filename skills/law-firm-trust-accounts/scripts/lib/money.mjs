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
function formatCivilDate(d) {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
function civilDayNumber(d) {
  const y = d.month <= 2 ? d.year - 1 : d.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function calendarDaysBetween(fromIso, toIso) {
  return civilDayNumber(parseCivilDate(toIso, "end date")) - civilDayNumber(parseCivilDate(fromIso, "start date"));
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

export {
  AmountError,
  assertCents,
  parseAmount,
  decimalToCents,
  toDecimal,
  formatUSD,
  sum,
  daysInMonth,
  parseCivilDate,
  formatCivilDate,
  calendarDaysBetween,
  CheckList,
  passedAll,
  failures,
  warnings,
  certify,
  certificateText,
  isIsoDate,
  verifyBankStatement,
  lawClientKey,
  lawClientLabel,
  lawAssertTransactions,
  lawAssertBalances,
  lawSortByDate,
  lawBuildLedgers,
  lawBigSum
};
