// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  allocate,
  assertCents,
  divRound,
  formatUSD,
  sum
} from "./money.mjs";

// packages/core/src/property/expenseStop.ts
var MAX_AREA = 1e9;
function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function mulDivRound(a, num, den) {
  if (den === 0n) throw new Error("division by zero");
  const n = BigInt(a) * num;
  const negative = n < 0n !== den < 0n;
  const an = n < 0n ? -n : n;
  const ad = den < 0n ? -den : den;
  let q = an / ad;
  if (2n * (an % ad) >= ad) q += 1n;
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("An amount is too large to work with.");
  const result = Number(q);
  return negative && result !== 0 ? -result : result;
}
function factorOf(grossUpBp, area, occupied) {
  const target = BigInt(grossUpBp) * BigInt(area);
  const actual = BigInt(occupied) * 10000n;
  if (actual >= target) return { num: 1n, den: 1n, applies: false };
  if (actual === 0n) throw new Error("Occupied area is zero for a year, so there is no actual occupancy to gross up from. Enter the occupied square feet.");
  return { num: target, den: actual, applies: true };
}
function grossUpVariable(amounts, num, den) {
  const total = mulDivRound(sum(amounts), num, den);
  const exact = amounts.map((a) => BigInt(a) * num);
  const floors = exact.map((e) => e / den);
  let leftover = BigInt(total) - floors.reduce((a, b) => a + b, 0n);
  const order = exact.map((e, index) => ({ index, rem: e % den })).sort((a, b) => a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1);
  for (const { index } of order) {
    if (leftover <= 0n) break;
    floors[index] = floors[index] + 1n;
    leftover -= 1n;
  }
  return { total, lines: floors.map((f) => Number(f)) };
}
function adjustYear(amounts, variable, num, den) {
  const idx = variable.flatMap((v, i) => v ? [i] : []);
  const out = [...amounts];
  if (idx.length === 0) return out;
  const g = grossUpVariable(idx.map((i) => amounts[i]), num, den);
  idx.forEach((li, k) => {
    out[li] = g.lines[k];
  });
  return out;
}
function validate(input) {
  const area = input.totalLeasableSqFt;
  if (!Number.isSafeInteger(area) || area <= 0 || area > MAX_AREA) throw new Error("Total leasable area must be a positive whole number of square feet.");
  const b = input.base;
  if (b.kind === "stop-per-sqft") {
    assertCents(b.centsPerSqFt, "stop per square foot");
    if (b.centsPerSqFt < 0) throw new Error("The stop per square foot cannot be negative.");
  } else if (b.kind === "stop-amount") {
    assertCents(b.amount, "stop amount");
    if (b.amount < 0) throw new Error("The stop amount cannot be negative.");
  } else if (b.kind !== "base-year") {
    throw new Error("The base must be a base year or a stop.");
  }
  if (input.grossUp) {
    const g = input.grossUp;
    if (!Number.isSafeInteger(g.grossUpBp) || g.grossUpBp <= 0 || g.grossUpBp > 1e4) throw new Error("Gross-up occupancy must be a percentage above 0 and no more than 100.");
    for (const [v, which] of [[g.baseOccupiedSqFt, "base year"], [g.currentOccupiedSqFt, "comparison year"]]) {
      if (!Number.isSafeInteger(v) || v < 0 || v > MAX_AREA) throw new Error(`Occupied area for the ${which} must be a whole number of square feet, zero or more.`);
    }
  }
  if (input.lines.length === 0) throw new Error("Enter at least one expense line.");
  for (const l of input.lines) {
    assertCents(l.baseAmount, `base year amount of "${l.category}"`);
    assertCents(l.currentAmount, `comparison year amount of "${l.category}"`);
    if (l.baseAmount < 0 || l.currentAmount < 0) throw new Error(`Expense "${l.category}" is negative. Enter each amount as zero or more.`);
  }
  if (input.tenants.length === 0) throw new Error("Enter at least one tenant.");
  for (const t of input.tenants) {
    if (!Number.isSafeInteger(t.squareFeet) || t.squareFeet < 0 || t.squareFeet > MAX_AREA) throw new Error(`Tenant "${t.name}": square feet must be a whole number, zero or more.`);
    if (t.fixedShareBp !== void 0 && (!Number.isSafeInteger(t.fixedShareBp) || t.fixedShareBp < 0 || t.fixedShareBp > 1e4)) {
      throw new Error(`Tenant "${t.name}": a fixed share must be a percentage from 0 to 100.`);
    }
    assertCents(t.estimatesPaid, `estimates paid by "${t.name}"`);
  }
}
function weightOf(t, area) {
  return t.fixedShareBp !== void 0 ? BigInt(t.fixedShareBp) * BigInt(area) : BigInt(t.squareFeet) * 10000n;
}
function occupancyBp(occupied, area) {
  return Number((BigInt(occupied) * 20000n + BigInt(area)) / (2n * BigInt(area)));
}
function yearOf(actual, adjusted, f, occupied, area) {
  const g = gcd(f.num, f.den);
  return {
    occupancyBp: occupied === null ? null : occupancyBp(occupied, area),
    factor: { numerator: Number(f.num / g), denominator: Number(f.den / g) },
    applies: f.applies,
    actual: sum(actual),
    adjusted: sum(adjusted)
  };
}
function computeExpenseStop(input) {
  validate(input);
  const area = input.totalLeasableSqFt;
  const isBaseYear = input.base.kind === "base-year";
  const variable = input.lines.map((l) => l.variable);
  const baseActual = input.lines.map((l) => isBaseYear ? l.baseAmount : 0);
  const currentActual = input.lines.map((l) => l.currentAmount);
  const none = { num: 1n, den: 1n, applies: false };
  const g = input.grossUp;
  const fBase = g && isBaseYear ? factorOf(g.grossUpBp, area, g.baseOccupiedSqFt) : none;
  const fCurrent = g ? factorOf(g.grossUpBp, area, g.currentOccupiedSqFt) : none;
  const baseAdj = adjustYear(baseActual, variable, fBase.num, fBase.den);
  const currentAdj = adjustYear(currentActual, variable, fCurrent.num, fCurrent.den);
  const lines = input.lines.map((l, i) => ({
    ...l,
    baseAdjusted: baseAdj[i],
    currentAdjusted: currentAdj[i],
    change: isBaseYear ? currentAdj[i] - baseAdj[i] : 0
  }));
  const b = input.base;
  const baseAmount = b.kind === "base-year" ? sum(baseAdj) : b.kind === "stop-amount" ? b.amount : assertCents(b.centsPerSqFt * area, "stop for the building");
  const current = sum(currentAdj);
  const excess = Math.max(0, current - baseAmount);
  const weights = input.tenants.map((t) => weightOf(t, area));
  const whole = 10000n * BigInt(area);
  const tenantWeight = weights.reduce((a, w) => a + w, 0n);
  const unleasedWeight = tenantWeight >= whole ? 0n : whole - tenantWeight;
  const parts = allocate(excess, [...weights, unleasedWeight].map((w) => Number(w)));
  const tenants = input.tenants.map((t, i) => {
    const share = parts[i];
    return { ...t, shareBp: t.fixedShareBp ?? divRound(t.squareFeet * 1e4, area), share, trueUp: share - t.estimatesPaid };
  });
  const unleased = parts[parts.length - 1];
  let excessWithoutGrossUp = null;
  if (g) {
    const rawBase = b.kind === "base-year" ? sum(baseActual) : baseAmount;
    excessWithoutGrossUp = Math.max(0, sum(currentActual) - rawBase);
  }
  const result = {
    input,
    baseYear: isBaseYear ? yearOf(baseActual, baseAdj, fBase, g ? g.baseOccupiedSqFt : null, area) : null,
    currentYear: yearOf(currentActual, currentAdj, fCurrent, g ? g.currentOccupiedSqFt : null, area),
    lines,
    baseAmount,
    excess,
    belowBase: current <= baseAmount,
    tenants,
    unleased,
    landlord: current - sum(tenants.map((t) => t.share)),
    excessWithoutGrossUp
  };
  return { ...result, checks: verifyExpenseStop(result) };
}
function withinCent(amount, base, num, den) {
  const diff = BigInt(amount) * den - BigInt(base) * num;
  return (diff < 0n ? -diff : diff) < den;
}
function verifyExpenseStop(r) {
  const input = r.input;
  const checks = new CheckList();
  const area = input.totalLeasableSqFt;
  const isBaseYear = input.base.kind === "base-year";
  const g = input.grossUp;
  const factor = (occupied) => {
    if (!g || occupied === void 0) return { num: 1n, den: 1n, ok: true };
    const target = BigInt(g.grossUpBp) * BigInt(area);
    const actual = BigInt(occupied) * 10000n;
    if (actual >= target) return { num: 1n, den: 1n, ok: true };
    return { num: target, den: actual, ok: actual > 0n };
  };
  const fb = factor(isBaseYear ? g?.baseOccupiedSqFt : void 0);
  const fc = factor(g?.currentOccupiedSqFt);
  const lowest = (f) => {
    const d = gcd(f.num, f.den);
    return `${f.num / d}/${f.den / d}`;
  };
  checks.that(
    "lines-complete",
    "Every expense line entered is here, with its amounts and marks as entered",
    r.lines.length === input.lines.length && input.lines.every((l, i) => {
      const o = r.lines[i];
      return !!o && o.category === l.category && o.baseAmount === l.baseAmount && o.currentAmount === l.currentAmount && o.variable === l.variable;
    }),
    `${r.lines.length} lines for ${input.lines.length} entered, or a line changed`
  );
  const fixed = r.lines.filter((l) => !l.variable);
  const variable = r.lines.filter((l) => l.variable);
  const fixedOff = fixed.filter((l) => l.currentAdjusted !== l.currentAmount || isBaseYear && l.baseAdjusted !== l.baseAmount).map((l) => l.category);
  checks.that("fixed-not-grossed", "Fixed lines are not grossed up: they enter both years at their actual amounts", fixedOff.length === 0, `Changed: ${fixedOff.join(", ")}`);
  if (g) {
    checks.equal("factor-current", "Comparison year factor = gross-up occupancy ÷ actual occupancy (1 when actual is at or above it)", fc.ok ? lowest(fc) : "no actual occupancy", `${r.currentYear.factor.numerator}/${r.currentYear.factor.denominator}`);
    if (isBaseYear) {
      checks.equal("factor-base", "Base year factor = gross-up occupancy ÷ its actual occupancy (1 when actual is at or above it)", fb.ok ? lowest(fb) : "no actual occupancy", r.baseYear ? `${r.baseYear.factor.numerator}/${r.baseYear.factor.denominator}` : "missing");
    }
  }
  checks.cents(
    "current-variable",
    "Comparison year variable lines = actual × factor, rounded once to the cent",
    mulDivRound(sum(variable.map((l) => l.currentAmount)), fc.num, fc.den),
    sum(variable.map((l) => l.currentAdjusted))
  );
  const offCurrent = variable.filter((l) => !withinCent(l.currentAdjusted, l.currentAmount, fc.num, fc.den)).map((l) => l.category);
  checks.that("current-lines-factor", "Each comparison year variable line = its actual amount × factor, to the cent", offCurrent.length === 0, `Not within a cent: ${offCurrent.join(", ")}`);
  if (isBaseYear) {
    checks.cents(
      "base-variable",
      "Base year variable lines = actual × factor, rounded once to the cent",
      mulDivRound(sum(variable.map((l) => l.baseAmount)), fb.num, fb.den),
      sum(variable.map((l) => l.baseAdjusted))
    );
    const offBase = variable.filter((l) => !withinCent(l.baseAdjusted, l.baseAmount, fb.num, fb.den)).map((l) => l.category);
    checks.that("base-lines-factor", "Each base year variable line = its actual amount × factor, to the cent", offBase.length === 0, `Not within a cent: ${offBase.join(", ")}`);
  }
  const b = input.base;
  const base = b.kind === "base-year" ? sum(r.lines.map((l) => l.baseAdjusted)) : b.kind === "stop-amount" ? b.amount : Number(BigInt(b.centsPerSqFt) * BigInt(area));
  checks.cents("base-amount", b.kind === "base-year" ? "Base = the base year expenses after gross-up, added line by line" : b.kind === "stop-per-sqft" ? "Base = the stop per square foot × total leasable square feet" : "Base = the stop amount entered", base, r.baseAmount);
  const current = sum(r.lines.map((l) => l.currentAdjusted));
  const fromTotals = Math.max(0, current - base);
  checks.cents("excess-totals", "Excess = comparison year expenses − base, not below zero", fromTotals, r.excess);
  if (isBaseYear) {
    const badChange = r.lines.filter((l) => l.change !== l.currentAdjusted - l.baseAdjusted).map((l) => l.category);
    checks.that("line-changes", "Each line: comparison year − base year = change", badChange.length === 0, `Lines that do not add up: ${badChange.join(", ")}`);
    checks.cents("excess-lines", "Excess = the line-by-line changes added up, not below zero", Math.max(0, sum(r.lines.map((l) => l.change))), r.excess);
  }
  const whole = 10000n * BigInt(area);
  const weights = input.tenants.map((t) => weightOf(t, area));
  const tenantWeight = weights.reduce((a, w) => a + w, 0n);
  checks.cents("excess-allocated", "Tenant shares + unleased remainder = excess", r.excess, sum(r.tenants.map((t) => t.share)) + r.unleased);
  r.tenants.forEach((t, i) => {
    checks.that(`share-${i + 1}`, `${t.name}: share = excess × pro rata share, to the cent`, withinCent(t.share, r.excess, weights[i] ?? 0n, whole), `${t.name}'s share is not within a cent of the excess × its share of the building`);
  });
  const unleasedWeight = tenantWeight >= whole ? 0n : whole - tenantWeight;
  checks.that("unleased-share", "Unleased remainder = excess × unleased share, to the cent", withinCent(r.unleased, r.excess, unleasedWeight, whole), "The unleased remainder is not within a cent of the excess × the unleased share");
  r.tenants.forEach((t, i) => {
    checks.cents(`trueup-${i + 1}`, `${t.name}: share − estimates paid = true-up`, t.share - t.estimatesPaid, t.trueUp);
  });
  checks.that("tenants-complete", "Every tenant entered has a share", r.tenants.length === input.tenants.length, `${input.tenants.length} tenants entered, ${r.tenants.length} shares`);
  const tenantTotal = sum(r.tenants.map((t) => t.share));
  checks.cents("adds-back", "Tenant shares + landlord portion = comparison year expenses", current, tenantTotal + r.landlord);
  checks.cents("landlord", "Landlord portion = the base (or the expenses, if lower) + the unleased remainder", Math.min(current, base) + r.unleased, r.landlord);
  checks.that("shares-within-100", "Tenant shares do not exceed 100% of the building", tenantWeight <= whole, "The tenants' shares add up to more than the whole building");
  const leased = input.tenants.reduce((a, t) => a + t.squareFeet, 0);
  checks.that("area-within-total", "Leased area does not exceed total leasable area", leased <= area, `${leased} sq ft leased of ${area}`);
  if (g) {
    const over = [g.currentOccupiedSqFt, ...isBaseYear ? [g.baseOccupiedSqFt] : []].filter((x) => x > area).length;
    checks.that("occupancy-within-total", "Occupied area does not exceed total leasable area", over === 0, `${over} occupied-area figure(s) above ${area} sq ft`);
  }
  checks.that("above-base", "Comparison year expenses are above the base, so there is an excess to pass through", current > base, `Comparison year expenses (${formatUSD(current)}) are at or below the base (${formatUSD(base)}): nothing passes through`, "warning");
  if (isBaseYear) {
    const newLines = r.lines.filter((l) => l.baseAmount === 0 && l.currentAmount > 0).map((l) => l.category);
    checks.that("lines-in-both-years", "Every line with a comparison year amount also has a base year amount", newLines.length === 0, `No base year amount, so the whole amount is excess: ${newLines.join(", ")}`, "warning");
  }
  if (g) {
    checks.that("variable-marked", "At least one line is marked variable", variable.length > 0, "A gross-up occupancy was entered but no line is marked variable, so nothing is grossed up", "warning");
  }
  return checks.all;
}

export {
  computeExpenseStop,
  verifyExpenseStop
};
