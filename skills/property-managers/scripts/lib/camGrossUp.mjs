// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  allocate,
  applyRate,
  assertCents,
  divRound,
  formatUSD,
  sum
} from "./money.mjs";

// packages/core/src/property/cam.ts
function computeCam(input) {
  if (!Number.isSafeInteger(input.totalLeasableSqFt) || input.totalLeasableSqFt <= 0) {
    throw new Error("Total leasable area must be a positive whole number of square feet.");
  }
  for (const e of input.expenses) assertCents(e.amount, `expense "${e.category}"`);
  const pool = sum(input.expenses.filter((e) => e.recoverable).map((e) => e.amount));
  const excluded = sum(input.expenses.filter((e) => !e.recoverable).map((e) => e.amount));
  const total = input.totalLeasableSqFt;
  const WEIGHT_SCALE = 1e4 * total;
  const weights = input.tenants.map((t) => t.fixedShareBp !== void 0 ? t.fixedShareBp * total : t.squareFeet * 1e4);
  const tenantWeight = weights.reduce((a, b) => a + b, 0);
  const vacancyWeight = Math.max(0, WEIGHT_SCALE - tenantWeight);
  const parts = allocate(pool, [...weights, vacancyWeight]);
  const landlordShare = parts[parts.length - 1];
  const tenants = input.tenants.map((t, i) => {
    const share = parts[i];
    const adminFee = applyRate(share, input.adminFeeBp ?? 0);
    const totalDue = share + adminFee;
    return { ...t, shareBp: Math.round(weights[i] / total), share, adminFee, totalDue, balance: totalDue - t.estimatesPaid };
  });
  const result = { input, pool, excluded, landlordShare, tenants };
  return { ...result, checks: verifyCam(result) };
}
function withinCent(amount, base, num, den) {
  const diff = BigInt(amount) * den - BigInt(base) * num;
  return (diff < 0n ? -diff : diff) < den;
}
function verifyCam(r) {
  const input = r.input;
  const checks = new CheckList();
  const total = input.totalLeasableSqFt;
  const WEIGHT_SCALE = 1e4 * total;
  const weights = input.tenants.map((t) => t.fixedShareBp !== void 0 ? BigInt(t.fixedShareBp) * BigInt(total) : BigInt(t.squareFeet) * 10000n);
  const tenantWeight = weights.reduce((a, b) => a + b, 0n);
  const whole = tenantWeight > BigInt(WEIGHT_SCALE) ? tenantWeight : BigInt(WEIGHT_SCALE);
  checks.cents("pool", "Recoverable pool = the recoverable expenses, re-added", sum(input.expenses.filter((e) => e.recoverable).map((e) => e.amount)), r.pool);
  checks.cents("pool-allocated", "Tenant shares + landlord (vacancy) share = recoverable pool", r.pool, sum(r.tenants.map((t) => t.share)) + r.landlordShare);
  checks.that("tenants-complete", "Every tenant entered has a share", r.tenants.length === input.tenants.length, `${input.tenants.length} tenants entered, ${r.tenants.length} shares`);
  checks.that("shares-within-100", "Tenant shares do not exceed 100% of the building", tenantWeight <= BigInt(WEIGHT_SCALE), `Tenant shares total ${(Number(tenantWeight) / WEIGHT_SCALE * 100).toFixed(2)}%`);
  const leased = input.tenants.reduce((a, t) => a + t.squareFeet, 0);
  checks.that("area-within-total", "Leased area does not exceed total leasable area", leased <= input.totalLeasableSqFt, `${leased} sq ft leased of ${input.totalLeasableSqFt}`);
  checks.that("landlord-share", "Landlord (vacancy) share = pool × the vacant share of the building, to the cent", withinCent(r.landlordShare, r.pool, whole - tenantWeight, whole), "The landlord share is not within a cent of the pool × the vacant share");
  const bp = BigInt(input.adminFeeBp ?? 0);
  r.tenants.forEach((t, i) => {
    checks.that(`share-${t.name}`, `${t.name}: share = pool × its share of the building, to the cent`, withinCent(t.share, r.pool, weights[i] ?? 0n, whole), `${t.name}'s share is not within a cent of the pool × its share of the building`);
    const product = BigInt(t.share) * bp;
    const fee = ((product < 0n ? -product : product) * 2n + 10000n) / 20000n;
    checks.cents(`admin-fee-${t.name}`, `${t.name}: admin fee = share × ${input.adminFeeBp ?? 0} basis points, rounded half away from zero`, Number(product < 0n ? -fee : fee), t.adminFee);
    checks.cents(`due-${t.name}`, `${t.name}: share + admin fee = total due`, t.share + t.adminFee, t.totalDue);
    checks.cents(`balance-${t.name}`, `${t.name}: share + admin fee − estimates paid = balance`, t.share + t.adminFee - (input.tenants[i]?.estimatesPaid ?? t.estimatesPaid), t.balance);
  });
  checks.cents("expenses-total", "Recoverable + excluded = total expenses", sum(input.expenses.map((e) => e.amount)), r.pool + r.excluded);
  checks.that("period-valid", "Period end is after period start", input.periodEnd > input.periodStart, void 0, "warning");
  return checks.all;
}

// packages/core/src/property/camGrossUp.ts
var MAX_AREA = 1e9;
var MAX_READINGS = 366;
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
function rawFactor(input) {
  const target = BigInt(input.grossUpBp) * BigInt(input.occupiedSqFt.length) * BigInt(input.totalLeasableSqFt);
  const actual = input.occupiedSqFt.reduce((a, b) => a + BigInt(b), 0n) * 10000n;
  if (actual >= target) return { num: 1n, den: 1n, applies: false };
  if (actual === 0n) throw new Error("Occupied area is zero, so there is no actual occupancy to gross up from. Enter the occupied square feet.");
  const g = gcd(target, actual);
  return { num: target / g, den: actual / g, applies: true };
}
function capAmountOf(cap) {
  return cap.kind === "amount" ? cap.amount : cap.priorYear + applyRate(cap.priorYear, cap.increaseBp);
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
function validate(input) {
  const area = input.totalLeasableSqFt;
  if (!Number.isSafeInteger(area) || area <= 0 || area > MAX_AREA) {
    throw new Error("Total leasable area must be a positive whole number of square feet.");
  }
  if (!Array.isArray(input.occupiedSqFt) || input.occupiedSqFt.length === 0) {
    throw new Error("Enter the occupied square feet: one figure for a single date, or one for each month to average.");
  }
  if (input.occupiedSqFt.length > MAX_READINGS) throw new Error(`An average can use at most ${MAX_READINGS} occupied-area figures.`);
  for (const r of input.occupiedSqFt) {
    if (!Number.isSafeInteger(r) || r < 0 || r > MAX_AREA) throw new Error("Occupied area must be a whole number of square feet, zero or more.");
  }
  if (!Number.isSafeInteger(input.grossUpBp) || input.grossUpBp <= 0 || input.grossUpBp > 1e4) {
    throw new Error("Gross-up occupancy must be a percentage above 0 and no more than 100.");
  }
  for (const l of input.lines) {
    assertCents(l.amount, `expense "${l.category}"`);
    if (l.amount < 0) throw new Error(`Expense "${l.category}" is negative. Enter each expense line as zero or more.`);
  }
  if (input.cap) {
    const c = input.cap;
    if (c.kind === "amount") {
      assertCents(c.amount, "cap amount");
      if (c.amount < 0) throw new Error("The cap amount cannot be negative.");
    } else if (c.kind === "increase") {
      assertCents(c.priorYear, "prior-year controllable expenses");
      if (c.priorYear < 0) throw new Error("Prior-year controllable expenses cannot be negative.");
      if (!Number.isSafeInteger(c.increaseBp) || c.increaseBp < 0) throw new Error("The allowed increase must be a percentage, zero or more.");
    } else {
      throw new Error("The cap must be an amount or a prior year plus an increase.");
    }
  }
  for (const t of input.tenants) {
    if (!Number.isSafeInteger(t.squareFeet) || t.squareFeet < 0 || t.squareFeet > MAX_AREA) throw new Error(`Tenant "${t.name}": square feet must be a whole number, zero or more.`);
    if (t.fixedShareBp !== void 0 && (!Number.isSafeInteger(t.fixedShareBp) || t.fixedShareBp < 0 || t.fixedShareBp > 1e4)) {
      throw new Error(`Tenant "${t.name}": a fixed share must be a percentage from 0 to 100.`);
    }
    assertCents(t.estimatesPaid, `estimates paid by "${t.name}"`);
  }
}
function grossUpFactorText(factor, places = 4) {
  const scale = 10n ** BigInt(places);
  const n = BigInt(factor.numerator) * scale;
  const d = BigInt(factor.denominator);
  let q = n / d;
  if (2n * (n % d) >= d) q += 1n;
  const whole = q / scale;
  const frac = (q % scale).toString().padStart(places, "0");
  return places > 0 ? `${whole}.${frac}` : `${whole}`;
}
function computeCamGrossUp(input) {
  validate(input);
  const { num, den, applies } = rawFactor(input);
  const variableIdx = input.lines.flatMap((l, i) => l.variable ? [i] : []);
  const grossed = grossUpVariable(variableIdx.map((i) => input.lines[i].amount), num, den);
  const grossedUp = input.lines.map((l) => l.amount);
  variableIdx.forEach((li, k) => {
    grossedUp[li] = grossed.lines[k];
  });
  const controllableIdx = input.lines.flatMap((l, i) => l.controllable ? [i] : []);
  const controllable = sum(controllableIdx.map((i) => grossedUp[i]));
  const capAmount = input.cap ? capAmountOf(input.cap) : null;
  const capReduction = capAmount === null ? 0 : Math.max(0, controllable - capAmount);
  const reductions = input.lines.map(() => 0);
  if (capReduction > 0) {
    const parts = allocate(capReduction, controllableIdx.map((i) => grossedUp[i]));
    controllableIdx.forEach((li, k) => {
      reductions[li] = parts[k];
    });
  }
  const lines = input.lines.map((l, i) => ({
    ...l,
    grossedUp: grossedUp[i],
    capReduction: reductions[i],
    inPool: grossedUp[i] - reductions[i]
  }));
  const pool = sum(lines.map((l) => l.inPool));
  const split = computeCam({
    property: input.property,
    periodStart: input.periodStart ?? "",
    periodEnd: input.periodEnd ?? "",
    totalLeasableSqFt: input.totalLeasableSqFt,
    adminFeeBp: 0,
    expenses: [{ category: "Grossed-up pool", amount: pool, recoverable: true }],
    tenants: input.tenants
  });
  const tenants = input.tenants.map((t, i) => {
    const share = split.tenants[i].share;
    const shareBp = t.fixedShareBp ?? divRound(t.squareFeet * 1e4, input.totalLeasableSqFt);
    return { ...t, shareBp, share, trueUp: share - t.estimatesPaid };
  });
  const fixed = sum(input.lines.filter((l) => !l.variable).map((l) => l.amount));
  const variableActual = sum(variableIdx.map((i) => input.lines[i].amount));
  const readings = input.occupiedSqFt.length;
  const occupied = input.occupiedSqFt.reduce((a, b) => a + BigInt(b), 0n);
  const scaledArea = BigInt(readings) * BigInt(input.totalLeasableSqFt);
  const actualBp = Number((occupied * 20000n + scaledArea) / (2n * scaledArea));
  const result = {
    input,
    occupancy: { readings, actualBp, applies },
    factor: { numerator: Number(num), denominator: Number(den) },
    lines,
    totals: {
      fixed,
      variableActual,
      variableGrossedUp: grossed.total,
      increase: grossed.total - variableActual,
      actual: fixed + variableActual,
      controllable,
      capAmount,
      capReduction,
      wholePoolGrossedUp: mulDivRound(fixed + variableActual, num, den)
    },
    pool,
    unleased: split.landlordShare,
    tenants
  };
  return { ...result, checks: verifyCamGrossUp(result) };
}
function withinCent2(amount, base, num, den) {
  const diff = BigInt(amount) * den - BigInt(base) * num;
  return (diff < 0n ? -diff : diff) < den;
}
function verifyCamGrossUp(r) {
  const input = r.input;
  const checks = new CheckList();
  const area = input.totalLeasableSqFt;
  const target = BigInt(input.grossUpBp) * BigInt(input.occupiedSqFt.length) * BigInt(area);
  const occupiedScaled = input.occupiedSqFt.reduce((a, b) => a + BigInt(b), 0n) * 10000n;
  const applies = occupiedScaled < target;
  const factorOk = !applies || occupiedScaled > 0n;
  const num = applies && factorOk ? target : 1n;
  const den = applies && factorOk ? occupiedScaled : 1n;
  const lowest = gcd(num, den);
  const fixedLines = r.lines.filter((l) => !l.variable);
  const variableLines = r.lines.filter((l) => l.variable);
  const controllableLines = r.lines.filter((l) => l.controllable);
  const fixedActual = sum(fixedLines.map((l) => l.amount));
  const variableActual = sum(variableLines.map((l) => l.amount));
  const variableGrossed = sum(variableLines.map((l) => l.grossedUp));
  checks.cents("expenses-total", "Every line entered is here: fixed + variable lines = total expenses entered", sum(input.lines.map((l) => l.amount)), fixedActual + variableActual);
  const changed = input.lines.flatMap((l, i) => {
    const o = r.lines[i];
    return o && o.category === l.category && o.amount === l.amount && o.variable === l.variable && o.controllable === l.controllable ? [] : [l.category];
  });
  checks.that("lines-as-entered", "Each line keeps the amount and the variable and controllable marks entered", changed.length === 0 && r.lines.length === input.lines.length, `Lines changed or missing: ${changed.join(", ") || `${r.lines.length} lines for ${input.lines.length} entered`}`);
  checks.cents("fixed-not-grossed", "Fixed lines are not grossed up: they enter at their actual amounts", fixedActual, sum(fixedLines.map((l) => l.grossedUp)));
  checks.equal("factor", "Gross-up factor = gross-up occupancy ÷ actual occupancy (1 when actual is at or above it)", factorOk ? `${num / lowest}/${den / lowest}` : "no actual occupancy", `${r.factor.numerator}/${r.factor.denominator}`);
  checks.cents("variable-grossed", "Grossed-up variable lines = actual variable × factor, rounded once to the cent", mulDivRound(variableActual, num, den), variableGrossed);
  const offLines = variableLines.filter((l) => !withinCent2(l.grossedUp, l.amount, num, den)).map((l) => l.category);
  checks.that("lines-factor", "Each variable line = its actual amount × factor, to the cent", offLines.length === 0, `Not within a cent of actual × factor: ${offLines.join(", ")}`);
  let capAmount = null;
  if (input.cap) {
    const c = input.cap;
    capAmount = c.kind === "amount" ? c.amount : mulDivRound(c.priorYear, 10000n + BigInt(c.increaseBp), 10000n);
    if (c.kind === "increase") checks.cents("cap-amount", "Cap = prior-year controllable expenses + the allowed increase", capAmount, r.totals.capAmount ?? 0);
    const controllable = sum(controllableLines.map((l) => l.grossedUp));
    checks.cents("cap-applied", "Controllable lines in the pool = the lesser of their grossed-up total and the cap", Math.min(controllable, capAmount), sum(controllableLines.map((l) => l.inPool)));
  }
  const badLines = r.lines.filter((l) => l.inPool !== l.grossedUp - l.capReduction || l.capReduction < 0 || l.capReduction > l.grossedUp || l.capReduction !== 0 && (!l.controllable || !input.cap)).map((l) => l.category);
  checks.that("line-arithmetic", "Each line: grossed up − cap reduction = in pool, with reductions on controllable lines only", badLines.length === 0, `Lines that do not add up: ${badLines.join(", ")}`);
  const increase = mulDivRound(variableActual, num - den, den);
  const capReduction = capAmount === null ? 0 : Math.max(0, sum(controllableLines.map((l) => l.grossedUp)) - capAmount);
  checks.cents("pool-lines", "Grossed-up pool = the lines in the pool, added line by line", sum(r.lines.map((l) => l.inPool)), r.pool);
  checks.cents("pool-two-ways", "Grossed-up pool = fixed + actual variable + gross-up increase − cap reduction, from the totals", fixedActual + variableActual + increase - capReduction, r.pool);
  const t = r.totals;
  const readingsArea = BigInt(input.occupiedSqFt.length) * BigInt(area);
  const shownVsWorked = [
    ["fixed", t.fixed, fixedActual],
    ["variable actual", t.variableActual, variableActual],
    ["variable grossed up", t.variableGrossedUp, variableGrossed],
    ["gross-up increase", t.increase, variableGrossed - variableActual],
    ["actual expenses", t.actual, fixedActual + variableActual],
    ["controllable", t.controllable, sum(controllableLines.map((l) => l.grossedUp))],
    ["cap", t.capAmount, capAmount],
    ["cap reduction", t.capReduction, capReduction],
    ["factor on every line", t.wholePoolGrossedUp, mulDivRound(fixedActual + variableActual, num, den)],
    ["actual occupancy", r.occupancy.actualBp, Number((occupiedScaled * 2n + readingsArea) / (2n * readingsArea))],
    ["occupied-area figures", r.occupancy.readings, input.occupiedSqFt.length],
    ["whether a gross-up applies", Number(r.occupancy.applies), Number(applies)]
  ];
  const wrong = shownVsWorked.filter(([, shown, worked]) => shown !== worked).map(([name]) => name);
  checks.that("summary-totals", "The summary totals match the lines", wrong.length === 0, `Totals that do not match: ${wrong.join(", ")}`);
  const whole = 10000n * BigInt(area);
  const weights = input.tenants.map((t2) => t2.fixedShareBp !== void 0 ? BigInt(t2.fixedShareBp) * BigInt(area) : BigInt(t2.squareFeet) * 10000n);
  const tenantWeight = weights.reduce((a, b) => a + b, 0n);
  checks.cents("pool-allocated", "Tenant shares + unleased remainder = grossed-up pool", r.pool, sum(r.tenants.map((t2) => t2.share)) + r.unleased);
  r.tenants.forEach((t2, i) => {
    const w = weights[i] ?? 0n;
    checks.that(`share-${i + 1}`, `${t2.name}: share = pool × pro rata share, to the cent`, withinCent2(t2.share, r.pool, w, whole), `${t2.name}'s share is not within a cent of the pool × its share of the building`);
  });
  const unleasedWeight = tenantWeight >= whole ? 0n : whole - tenantWeight;
  checks.that("unleased-share", "Unleased remainder = pool × unleased share, to the cent", withinCent2(r.unleased, r.pool, unleasedWeight, whole), "The unleased remainder is not within a cent of the pool × the unleased share");
  r.tenants.forEach((t2, i) => {
    checks.cents(`trueup-${i + 1}`, `${t2.name}: share − estimates paid = true-up`, t2.share - t2.estimatesPaid, t2.trueUp);
  });
  checks.that("tenants-complete", "Every tenant entered has a share", r.tenants.length === input.tenants.length, `${input.tenants.length} tenants entered, ${r.tenants.length} shares`);
  checks.that("shares-within-100", "Tenant shares do not exceed 100% of the building", tenantWeight <= whole, "The tenants' shares add up to more than the whole building");
  const leased = input.tenants.reduce((a, t2) => a + t2.squareFeet, 0);
  checks.that("area-within-total", "Leased area does not exceed total leasable area", leased <= area, `${leased} sq ft leased of ${area}`);
  const over = input.occupiedSqFt.filter((x) => x > area).length;
  checks.that("occupancy-within-total", "Occupied area does not exceed total leasable area", over === 0, `${over} occupied-area figure(s) above ${area} sq ft`);
  checks.that("grossup-applies", "Actual occupancy is below the gross-up occupancy, so variable lines are grossed up", applies, "Actual occupancy is at or above the gross-up occupancy: no gross-up applies and variable lines enter at their actual amounts", "warning");
  checks.that("variable-marked", "At least one line is marked variable", variableLines.length > 0, "No line is marked variable, so nothing is grossed up", "warning");
  if (input.cap) checks.that("cap-has-lines", "The cap has controllable lines to apply to", controllableLines.length > 0, "A cap was entered but no line is marked controllable, so the cap changes nothing", "warning");
  const billed = sum(r.tenants.map((t2) => t2.share));
  checks.that("no-over-recovery", "Tenant shares total no more than the actual expenses before gross-up", billed <= fixedActual + variableActual, `Tenant shares total ${formatUSD(billed)} against ${formatUSD(fixedActual + variableActual)} of actual expenses`, "warning");
  if (input.periodStart && input.periodEnd) checks.that("period-valid", "Period end is after period start", input.periodEnd > input.periodStart, void 0, "warning");
  return checks.all;
}

export {
  computeCam,
  grossUpFactorText,
  computeCamGrossUp,
  verifyCamGrossUp
};
