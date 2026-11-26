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

export {
  AmountError,
  assertCents,
  parseAmount,
  decimalToCents,
  toDecimal,
  formatUSD,
  sum,
  CheckList,
  passedAll,
  failures,
  warnings,
  certify,
  certificateText
};
