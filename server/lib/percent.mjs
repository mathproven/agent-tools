// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
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

export {
  formatPercentBp,
  percentTextFromBp
};
