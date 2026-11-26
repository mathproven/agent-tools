// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  STR_BANK_LABELS,
  STR_BANK_ROLES,
  STR_COMPONENT_ROLES,
  STR_PAYOUT_ROLES,
  STR_ROLE_LABELS,
  reconcileStrPayouts,
  strExtractBankDeposits,
  strExtractPayoutLines,
  strGuessBankColumns,
  strGuessPayoutColumns,
  strReconcileTables
} from "./strPayout.mjs";
import {
  formatPercentBp
} from "./percent.mjs";
import {
  camTemplateSheets,
  ownerStatementTemplateSheets,
  verifyTemplateWorkbook
} from "./templates.mjs";
import {
  writeXlsx
} from "./fflate.mjs";
import {
  AgentInputError,
  columnsInput,
  mapColumns,
  oneFile,
  preferSheet
} from "./sheets.mjs";
import {
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader
} from "./reconcile.mjs";
import {
  anniversary,
  calendarDaysBetween,
  civilDayNumber,
  daysInMonth,
  isLeapYear,
  parseCivilDate
} from "./calendarDays.mjs";
import {
  CheckList,
  allocate,
  applyRate,
  assertCents,
  divRound,
  formatUSD,
  percentToBasisPoints,
  sum,
  toDecimal
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
  const d2 = BigInt(factor.denominator);
  let q = n / d2;
  if (2n * (n % d2) >= d2) q += 1n;
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

// packages/core/src/property/expenseStop.ts
var MAX_AREA2 = 1e9;
function gcd2(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function mulDivRound2(a, num, den) {
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
function grossUpVariable2(amounts, num, den) {
  const total = mulDivRound2(sum(amounts), num, den);
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
  const g = grossUpVariable2(idx.map((i) => amounts[i]), num, den);
  idx.forEach((li, k) => {
    out[li] = g.lines[k];
  });
  return out;
}
function validate2(input) {
  const area = input.totalLeasableSqFt;
  if (!Number.isSafeInteger(area) || area <= 0 || area > MAX_AREA2) throw new Error("Total leasable area must be a positive whole number of square feet.");
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
      if (!Number.isSafeInteger(v) || v < 0 || v > MAX_AREA2) throw new Error(`Occupied area for the ${which} must be a whole number of square feet, zero or more.`);
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
    if (!Number.isSafeInteger(t.squareFeet) || t.squareFeet < 0 || t.squareFeet > MAX_AREA2) throw new Error(`Tenant "${t.name}": square feet must be a whole number, zero or more.`);
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
  const g = gcd2(f.num, f.den);
  return {
    occupancyBp: occupied === null ? null : occupancyBp(occupied, area),
    factor: { numerator: Number(f.num / g), denominator: Number(f.den / g) },
    applies: f.applies,
    actual: sum(actual),
    adjusted: sum(adjusted)
  };
}
function computeExpenseStop(input) {
  validate2(input);
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
function withinCent3(amount, base, num, den) {
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
    const d2 = gcd2(f.num, f.den);
    return `${f.num / d2}/${f.den / d2}`;
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
    mulDivRound2(sum(variable.map((l) => l.currentAmount)), fc.num, fc.den),
    sum(variable.map((l) => l.currentAdjusted))
  );
  const offCurrent = variable.filter((l) => !withinCent3(l.currentAdjusted, l.currentAmount, fc.num, fc.den)).map((l) => l.category);
  checks.that("current-lines-factor", "Each comparison year variable line = its actual amount × factor, to the cent", offCurrent.length === 0, `Not within a cent: ${offCurrent.join(", ")}`);
  if (isBaseYear) {
    checks.cents(
      "base-variable",
      "Base year variable lines = actual × factor, rounded once to the cent",
      mulDivRound2(sum(variable.map((l) => l.baseAmount)), fb.num, fb.den),
      sum(variable.map((l) => l.baseAdjusted))
    );
    const offBase = variable.filter((l) => !withinCent3(l.baseAdjusted, l.baseAmount, fb.num, fb.den)).map((l) => l.category);
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
    checks.that(`share-${i + 1}`, `${t.name}: share = excess × pro rata share, to the cent`, withinCent3(t.share, r.excess, weights[i] ?? 0n, whole), `${t.name}'s share is not within a cent of the excess × its share of the building`);
  });
  const unleasedWeight = tenantWeight >= whole ? 0n : whole - tenantWeight;
  checks.that("unleased-share", "Unleased remainder = excess × unleased share, to the cent", withinCent3(r.unleased, r.excess, unleasedWeight, whole), "The unleased remainder is not within a cent of the excess × the unleased share");
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

// packages/core/src/property/ownerLedger.ts
function ownerFeePattern(text2) {
  const t = text2.trim();
  if (!t) return void 0;
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
var LEDGER_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "post date", "paid date", "entry date"],
  description: ["description", "memo", "details", "detail", "payee", "name", "notes", "note", "item"],
  amount: ["amount", "total", "net amount", "value"],
  type: ["type", "category", "kind", "account type", "transaction type", "class"]
};
function guessLedgerRow(header) {
  const names = header.map(pmNormalizeHeader);
  const taken = /* @__PURE__ */ new Set();
  const find = (role) => {
    for (const exact of [true, false]) {
      for (const syn of LEDGER_SYNONYMS[role]) {
        const i = names.findIndex((n, idx) => !taken.has(idx) && n !== "" && (exact ? n === syn : ` ${n} `.includes(` ${syn} `)));
        if (i >= 0) {
          taken.add(i);
          return i;
        }
      }
    }
    return -1;
  };
  const date = find("date");
  const amount = find("amount");
  const type = find("type");
  const description = find("description");
  return { date, description, amount, type };
}
function guessOwnerLedgerColumns(rows) {
  let best = { headerRow: Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== ""))), date: -1, description: -1, amount: -1, type: -1 };
  let bestScore = 1;
  rows.slice(0, 25).forEach((row, i) => {
    const g = guessLedgerRow(row);
    const score = [g.date, g.description, g.amount, g.type].filter((c) => c >= 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: i, ...g };
    }
  });
  return best;
}
var AMBIGUOUS_TYPE_WORDS = /\b(payments?|charges?|credits?|debits?|deposits?|checks?|cheques?|refunds?)\b/;
function ownerLedgerKind(typeText) {
  const t = pmNormalizeHeader(typeText);
  if (!t || AMBIGUOUS_TYPE_WORDS.test(t)) return void 0;
  if (/\b(distribution|distributions|draw|draws|owner payout|owner disbursement)\b/.test(t)) return "distribution";
  if (/\b(expense|expenses|bill|bills|repair|repairs|cost|costs)\b/.test(t)) return "expense";
  if (/\b(income|rent|revenue|receipt|receipts|collected)\b/.test(t)) return "income";
  return void 0;
}
var DISTRIBUTION_WORDS = /\b(owner (draw|distribution|payout|payment|disbursement)|distribution)\b/i;
function ownerLedgerSkipChecks(skipped, dismissed = []) {
  if (skipped.length === 0) return [{ id: "ledger-skipped", label: "Every row in the ledger file was imported", passed: true, severity: "error" }];
  const out = new Set(dismissed);
  return skipped.map((s) => {
    if (s.kind === "zero") return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file has an amount`, passed: false, severity: "warning", detail: "zero amount; not imported" };
    if (s.kind === "type-skip" || out.has(s.rowNumber)) return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file was left out by your choice`, passed: false, severity: "warning", detail: s.reason };
    return { id: `ledger-row-${s.rowNumber}`, label: `Row ${s.rowNumber} of the ledger file was imported`, passed: false, severity: "error", detail: `not imported: ${s.reason}` };
  });
}
function isUnusedLedgerRow(row, mapping) {
  const cell = (col) => col >= 0 ? (row[col] ?? "").trim() : "";
  if (row.every((c) => c.trim() === "")) return true;
  return !cell(mapping.date) && !cell(mapping.description) && /^0*(\.0*)?$/.test(cell(mapping.amount));
}
var rowList = (rows) => `${rows.length === 1 ? "row" : "rows"} ${rows.slice(0, 8).join(", ")}${rows.length > 8 ? ", …" : ""}`;
function extractOwnerLedger(rows, mapping, options = {}) {
  if (mapping.date < 0) throw new Error("Choose which column holds the date.");
  if (mapping.amount < 0) throw new Error("Choose which column holds the amount.");
  const cell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
  const typeMap = options.typeMap ?? {};
  const parsed = [];
  const skipped = [];
  const unknown = /* @__PURE__ */ new Map();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || isUnusedLedgerRow(row, mapping)) return;
    const rawDate = cell(row, mapping.date);
    const rawAmount = cell(row, mapping.amount);
    const rowNumber = index + 1;
    if (!rawDate) return void skipped.push({ rowNumber, kind: "date", reason: "no date" });
    if (!rawAmount) return void skipped.push({ rowNumber, kind: "amount", reason: "no amount" });
    let date;
    let amount;
    try {
      date = pmCellToIsoDate(rawDate, options.dateOrder ?? "mdy");
    } catch {
      return void skipped.push({ rowNumber, kind: "date", reason: `the date "${rawDate}" could not be read` });
    }
    try {
      amount = pmCellToCents(rawAmount, { crIsNegative: false });
    } catch {
      return void skipped.push({ rowNumber, kind: "amount", reason: `the amount "${rawAmount}" could not be read` });
    }
    if (amount === 0) return void skipped.push({ rowNumber, kind: "zero", reason: "zero amount" });
    const description = cell(row, mapping.description);
    if (mapping.type >= 0) {
      const typeText = cell(row, mapping.type);
      const key = pmNormalizeHeader(typeText);
      const chosen = Object.prototype.hasOwnProperty.call(typeMap, key) ? typeMap[key] : void 0;
      const kind = chosen ?? ownerLedgerKind(typeText);
      if (kind === "skip") return void skipped.push({ rowNumber, kind: "type-skip", reason: typeText ? `rows of type "${typeText}" are left out` : "rows with no type are left out" });
      if (!kind) {
        const seen = unknown.get(key);
        if (seen) seen.rows += 1;
        else unknown.set(key, { key, text: typeText, rows: 1 });
        return void skipped.push({ rowNumber, kind: "type", reason: typeText ? `the type "${typeText}" is not recognized as income, expense, or distribution` : "no type" });
      }
      parsed.push({ rowNumber, date, description, amount, kind, hasType: true });
    } else {
      const kind = amount > 0 ? "income" : DISTRIBUTION_WORDS.test(description) ? "distribution" : "expense";
      parsed.push({ rowNumber, date, description, amount, kind, hasType: false });
    }
  });
  const typedOut = parsed.filter((p) => p.hasType && p.kind !== "income");
  const negativeRows = typedOut.filter((p) => p.amount < 0).map((p) => p.rowNumber);
  const positiveRows = typedOut.filter((p) => p.amount > 0).map((p) => p.rowNumber);
  const fixed = options.outflowSign === "negative" || options.outflowSign === "positive" ? options.outflowSign : null;
  const outflowSign = fixed ?? (typedOut.length === 0 ? "none" : negativeRows.length && positiveRows.length ? "mixed" : negativeRows.length ? "negative" : "positive");
  const outflowSignFrom = fixed ? "option" : "file";
  const unknownTypes = [...unknown.values()];
  const dismissed = options.dismissedRows ?? [];
  const checks = new CheckList();
  checks.addAll(ownerLedgerSkipChecks(skipped, dismissed));
  if (outflowSign === "mixed") {
    checks.that(
      "ledger-signs",
      "Expense and distribution rows are all written with the same sign",
      false,
      `${rowList(negativeRows)} ${negativeRows.length === 1 ? "is" : "are"} negative and ${rowList(positiveRows)} ${positiveRows.length === 1 ? "is" : "are"} positive, so the file does not show which is the normal way and which is a refund or reversal. Nothing was imported. Choose how this file writes expenses.`
    );
    return { income: [], expenses: [], distributions: [], skipped, placed: [], outflowSign, outflowSignFrom, reversals: [], unknownTypes, checks: checks.all };
  }
  const income = [];
  const expenses = [];
  const distributions = [];
  const placed = [];
  const reversals = [];
  for (const p of parsed) {
    let amount = p.amount;
    if (p.kind !== "income" && (!p.hasType || outflowSign === "negative")) amount = -amount;
    const entry = { date: p.date, description: p.description, amount };
    if (p.kind === "income") income.push(entry);
    else if (p.kind === "expense") expenses.push(entry);
    else distributions.push(entry);
    const place = { rowNumber: p.rowNumber, kind: p.kind, amount };
    placed.push(place);
    if (p.kind !== "income" && p.hasType && amount < 0) reversals.push(place);
  }
  const extract = { income, expenses, distributions, skipped, placed, outflowSign, outflowSignFrom, reversals, unknownTypes, checks: [] };
  if (reversals.length) {
    checks.that(
      "ledger-reversals",
      `Every expense and distribution row is written as a ${outflowSign} number`,
      false,
      `${rowList(reversals.map((r) => r.rowNumber))} ${reversals.length === 1 ? "is" : "are"} written the other way and ${reversals.length === 1 ? "was" : "were"} imported as a reversal (a negative line that reduces its total)`,
      "warning"
    );
  }
  checks.addAll(verifyOwnerLedger(rows, mapping, extract));
  extract.checks = checks.all;
  return extract;
}
function verifyOwnerLedger(rows, mapping, x) {
  const checks = new CheckList();
  const seen = /* @__PURE__ */ new Map();
  for (const n of [...x.placed.map((p) => p.rowNumber), ...x.skipped.map((s) => s.rowNumber)]) seen.set(n, (seen.get(n) ?? 0) + 1);
  const bad = [];
  const dataRows = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || isUnusedLedgerRow(row, mapping)) return;
    dataRows.add(index + 1);
    const times = seen.get(index + 1) ?? 0;
    if (times !== 1) bad.push(`row ${index + 1} is accounted for ${times} time(s)`);
  });
  for (const n of seen.keys()) if (!dataRows.has(n)) bad.push(`row ${n} is not a data row of the file`);
  checks.that("ledger-rows", "Every data row of the ledger file is either imported once or listed as left out once", bad.length === 0, bad.slice(0, 5).join("; "));
  const wrong = [];
  const typed = mapping.type >= 0;
  for (const p of x.placed) {
    let raw;
    try {
      raw = pmCellToCents((rows[p.rowNumber - 1]?.[mapping.amount] ?? "").trim(), { crIsNegative: false });
    } catch {
      wrong.push(`row ${p.rowNumber}: the cell is not an amount`);
      continue;
    }
    const expected = p.kind === "income" ? raw : !typed || x.outflowSign === "negative" ? -raw : raw;
    if (BigInt(expected) !== BigInt(p.amount)) wrong.push(`row ${p.rowNumber}: the cell gives ${toDecimal(expected)}, the import holds ${toDecimal(p.amount)}`);
    else if (!typed && raw > 0 !== (p.kind === "income")) wrong.push(`row ${p.rowNumber}: placed against its sign`);
    else if (typed && p.kind !== "income" && x.outflowSignFrom === "file" && p.amount < 0) wrong.push(`row ${p.rowNumber}: stored as a reversal although no sign convention was chosen`);
  }
  checks.that("ledger-amounts", "Every imported amount agrees with its cell in the file, read a second time", wrong.length === 0, wrong.slice(0, 5).join("; "));
  const lists = [["income", x.income], ["expense", x.expenses], ["distribution", x.distributions]];
  const off = [];
  for (const [kind, list] of lists) {
    const want = x.placed.filter((p) => p.kind === kind).map((p) => p.amount);
    const have = list.map((e) => e.amount);
    const total = (values) => values.reduce((a, v) => a + BigInt(v), 0n);
    if (want.length !== have.length || total(want) !== total(have) || want.some((v, i) => v !== have[i])) off.push(`${kind}: ${want.length} row(s) placed totaling ${total(want)} cents, list holds ${have.length} totaling ${total(have)} cents`);
  }
  checks.that("ledger-lists", "The income, expense, and distribution lists hold exactly the imported rows", off.length === 0, off.join("; "));
  return checks.all;
}
function bpText(feeBp) {
  const whole = Math.floor(feeBp / 100);
  const frac = feeBp % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}
function ownerFeeRateText(managementFeeBp) {
  return bpText(managementFeeBp);
}
function ownerStatementTables(r) {
  const d2 = toDecimal;
  const i = r.input;
  const lines = (entries, total) => [
    ["Date", "Description", "Amount"],
    ...entries.map((e) => [e.date, e.description, d2(e.amount)]),
    ["", "Total", d2(total)]
  ];
  const summary = [
    ["Owner statement", "Amount"],
    ["Opening balance", d2(i.openingBalance)],
    ["Income collected", d2(r.totalIncome)],
    ["Expenses paid", d2(-r.totalExpenses)],
    [`Management fee (${bpText(i.managementFeeBp)} of ${d2(r.feeBase)})`, d2(-r.managementFee)],
    ["Paid to owner", d2(-r.totalDistributions)],
    ["Closing balance", d2(r.closingBalance)]
  ];
  if (i.reserve !== void 0) summary.push(["Reserve held (included in closing balance)", d2(i.reserve)]);
  return { summary, income: lines(i.income, r.totalIncome), expenses: lines(i.expenses, r.totalExpenses), distributions: lines(i.distributions, r.totalDistributions) };
}

// packages/core/src/property/ownerStatement.ts
function computeOwnerStatement(input) {
  const all = [...input.income, ...input.expenses, ...input.distributions];
  for (const e of all) assertCents(e.amount, `"${e.description}" on ${e.date}`);
  const totalIncome = sum(input.income.map((e) => e.amount));
  const totalExpenses = sum(input.expenses.map((e) => e.amount));
  const totalDistributions = sum(input.distributions.map((e) => e.amount));
  const pattern = input.feeOnIncomeMatching ? new RegExp(input.feeOnIncomeMatching.source, input.feeOnIncomeMatching.flags.replace(/[gy]/g, "")) : null;
  const feeLines = input.income.filter((e) => !pattern || pattern.test(e.description));
  const feeBase = sum(feeLines.map((e) => e.amount));
  const managementFee = applyRate(feeBase, input.managementFeeBp);
  const closingBalance = input.openingBalance + totalIncome - totalExpenses - managementFee - totalDistributions;
  const B = BigInt;
  const signed = [
    ...input.income.map((e) => ({ date: e.date, amt: B(e.amount) })),
    ...input.expenses.map((e) => ({ date: e.date, amt: -B(e.amount) })),
    ...input.distributions.map((e) => ({ date: e.date, amt: -B(e.amount) }))
  ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let walk = B(input.openingBalance);
  for (const line of signed) walk += line.amt;
  let base2 = 0n;
  for (const e of input.income) if (!pattern || new RegExp(pattern.source, pattern.flags).test(e.description)) base2 += B(e.amount);
  const product = base2 * B(input.managementFeeBp);
  const magnitude = product < 0n ? -product : product;
  const rounded = magnitude / 10000n + (magnitude % 10000n * 2n >= 10000n ? 1n : 0n);
  const fee2 = product < 0n ? -rounded : rounded;
  walk -= fee2;
  const checks = new CheckList();
  checks.that("roll-forward", "Opening + income − expenses − fee − distributions = closing (checked a second way)", B(closingBalance) === walk, `second pass gives ${formatUSD(Number(walk))}`);
  checks.that("fee", "Management fee = rate × fee-eligible income (checked a second way)", B(managementFee) === fee2, `second pass gives ${formatUSD(Number(fee2))}`);
  const negatives = all.filter((e) => e.amount < 0);
  checks.that("positive-entries", "All income, expense, and distribution lines are positive amounts", negatives.length === 0, `${negatives.length} negative line(s); enter refunds as their own lines`, "warning");
  const outside = all.filter((e) => e.date < input.periodStart || e.date > input.periodEnd);
  checks.that("dates-in-period", "Every line falls inside the statement period", outside.length === 0, `${outside.length} line(s) outside the period`, "warning");
  if (input.reserve !== void 0) {
    checks.that("reserve-kept", "Closing balance covers the reserve", closingBalance >= input.reserve, `Closing balance is below the ${formatUSD(input.reserve)} reserve`, "warning");
  }
  checks.that("no-overdraw", "Closing balance is not negative", closingBalance >= 0, "The owner was paid more than the property had available");
  return { input, totalIncome, totalExpenses, feeBase, managementFee, totalDistributions, closingBalance, checks: checks.all };
}

// packages/core/src/property/securityDeposit.ts
var DEPOSIT_DAY_COUNT = "actual days / 365";
var YEAR_DAYS = 365n;
var BP = 10000n;
var MAX_DEPOSIT_RATE_BP = 1e4;
function roundDiv(numerator, denominator) {
  const q = numerator / denominator;
  return 2n * (numerator % denominator) >= denominator ? q + 1n : q;
}
function toCents(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} is too large to calculate.`);
  return assertCents(Number(value), label);
}
function simpleInterestCents(principal, rateBp, days) {
  return toCents(roundDiv(BigInt(principal) * BigInt(rateBp) * BigInt(days), YEAR_DAYS * BP), "interest");
}
function simpleInterestCentsSecondPath(principal, rateBp, days, yearDays = 365) {
  const year = BigInt(yearDays);
  const yearProduct = BigInt(principal) * BigInt(rateBp);
  const yearWholeCents = yearProduct / BP;
  const yearRemainder = yearProduct % BP;
  const d2 = BigInt(days);
  const spread = yearWholeCents * d2;
  const wholeCents = spread / year;
  const carried = spread % year * BP + yearRemainder * d2;
  return toCents(wholeCents + roundDiv(carried, year * BP), "interest");
}
function daysByCalendarWalk(fromIso, toIso) {
  const a = parseCivilDate(fromIso);
  const b = parseCivilDate(toIso);
  const dayOfYear = (y, m, d2) => {
    let n = d2;
    for (let month = 1; month < m; month++) n += daysInMonth(y, month);
    return n;
  };
  let total = dayOfYear(b.year, b.month, b.day) - dayOfYear(a.year, a.month, a.day);
  for (let y = a.year; y < b.year; y++) total += isLeapYear(y) ? 366 : 365;
  for (let y = b.year; y < a.year; y++) total -= isLeapYear(y) ? 366 : 365;
  return total;
}
function accrueSimple(principal, rateBp, from, to, days) {
  const interest = simpleInterestCents(principal, rateBp, days);
  const wholeBlocks = Math.floor(days / 365);
  return {
    interest,
    fullYears: wholeBlocks,
    remainingDays: days - wholeBlocks * 365,
    periods: days > 0 ? [{ label: `Simple interest, ${days} days`, from, to, days, base: principal, interest }] : []
  };
}
var OVERPAID = "An interest payment is larger than the deposit balance on its date. Check the payment amounts and dates.";
function accrueCompound(principal, rateBp, from, to, paid) {
  const rate = BigInt(rateBp);
  const dated = paid.filter((p) => p.date !== "" && p.date >= from && p.date < to).sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  let balance = BigInt(principal);
  let nextPayment = 0;
  let total = 0n;
  const periods = [];
  const span = (label, start2, end, yearDays) => {
    let cursor = start2;
    let earned = 0n;
    const parts = [];
    for (; ; ) {
      while (nextPayment < dated.length && dated[nextPayment].date <= cursor) {
        balance -= BigInt(dated[nextPayment].amount);
        nextPayment++;
        if (balance < 0n) throw new Error(OVERPAID);
      }
      const cut = nextPayment < dated.length && dated[nextPayment].date < end ? dated[nextPayment].date : end;
      const days = calendarDaysBetween(cursor, cut);
      const interest = roundDiv(balance * rate * BigInt(days), yearDays * BP);
      if (days > 0) parts.push({ label, from: cursor, to: cut, days, base: toCents(balance, "balance"), interest: toCents(interest, "interest") });
      earned += interest;
      cursor = cut;
      if (cursor >= end) break;
    }
    parts.forEach((part, i) => periods.push(parts.length > 1 ? { ...part, label: `${label}, part ${i + 1}` } : part));
    return earned;
  };
  let years = 0;
  let start = from;
  for (; ; ) {
    const next = anniversary(from, years + 1);
    if (next > to) break;
    const interest = span(`Year ${years + 1}`, start, next, BigInt(calendarDaysBetween(start, next)));
    balance += interest;
    total += interest;
    start = next;
    years++;
  }
  const remainingDays = calendarDaysBetween(start, to);
  total += span(`Final ${remainingDays} days`, start, to, YEAR_DAYS);
  return { interest: toCents(total, "interest"), fullYears: years, remainingDays, periods };
}
function compoundSecondPath(principal, rateBp, from, to, paid) {
  const a = parseCivilDate(from);
  const b = parseCivilDate(to);
  let years = b.year - a.year;
  const anniversaryDay = Math.min(a.day, daysInMonth(b.year, a.month));
  if (b.month < a.month || b.month === a.month && b.day < anniversaryDay) years--;
  if (years < 0) years = 0;
  const firstDay = civilDayNumber(a);
  const lastDay = civilDayNumber(b);
  const bounds = [firstDay];
  for (let i = 1; i <= years; i++) bounds.push(civilDayNumber({ year: a.year + i, month: a.month, day: Math.min(a.day, daysInMonth(a.year + i, a.month)) }));
  bounds.push(lastDay);
  const events = paid.filter((x) => x.date !== "").map((x) => ({ day: civilDayNumber(parseCivilDate(x.date)), amount: x.amount })).filter((e2) => e2.day >= firstDay && e2.day < lastDay).sort((x, y) => x.day - y.day);
  let balance = principal;
  let total = 0;
  let e = 0;
  for (let k = 0; k <= years; k++) {
    const spanStart = bounds[k];
    const spanEnd = bounds[k + 1];
    const yearDays = k < years ? spanEnd - spanStart : 365;
    let cursor = spanStart;
    let earned = 0;
    for (; ; ) {
      while (e < events.length && events[e].day <= cursor) {
        balance = assertCents(balance - events[e].amount, "balance");
        e++;
        if (balance < 0) throw new Error(OVERPAID);
      }
      const cut = e < events.length && events[e].day < spanEnd ? events[e].day : spanEnd;
      earned = assertCents(earned + simpleInterestCentsSecondPath(balance, rateBp, cut - cursor, yearDays), "interest");
      cursor = cut;
      if (cursor >= spanEnd) break;
    }
    total = assertCents(total + earned, "interest");
    if (k < years) balance = assertCents(balance + earned, "balance");
  }
  return { interest: total, fullYears: years };
}
function validateDepositInput(input) {
  assertCents(input.deposit, "deposit");
  if (input.deposit <= 0) throw new Error("Enter the deposit amount as a number above zero.");
  if (!Number.isSafeInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > MAX_DEPOSIT_RATE_BP) {
    throw new Error("The annual interest rate must be between 0% and 100%, with at most two decimal places.");
  }
  if (input.method !== "simple" && input.method !== "compound-annual") throw new Error("Choose simple interest or interest compounded annually.");
  parseCivilDate(input.receivedOn, "date received");
  parseCivilDate(input.moveOutOn, "move-out date");
  for (const p of input.interestPaid ?? []) {
    assertCents(p.amount, "interest already paid");
    if (p.date) parseCivilDate(p.date, "interest payment date");
  }
  for (const d2 of input.deductions) assertCents(d2.amount, `deduction "${d2.description}"`);
  if (input.statedInterest !== void 0) assertCents(input.statedInterest, "stated interest");
  if (input.statedBalance !== void 0) assertCents(input.statedBalance, "stated balance");
}
function computeSecurityDeposit(input) {
  validateDepositInput(input);
  const paid = input.interestPaid ?? [];
  const rawDays = calendarDaysBetween(input.receivedOn, input.moveOutOn);
  const ordered = rawDays > 0;
  const days = ordered ? rawDays : 0;
  const to = ordered ? input.moveOutOn : input.receivedOn;
  const accrual = input.method === "simple" ? accrueSimple(input.deposit, input.rateBp, input.receivedOn, to, days) : accrueCompound(input.deposit, input.rateBp, input.receivedOn, to, paid);
  const interestEarned = accrual.interest;
  const interestPaid = sum(paid.map((p) => p.amount));
  const deductionsTotal = sum(input.deductions.map((d2) => d2.amount));
  const balance = assertCents(input.deposit + interestEarned - interestPaid - deductionsTotal, "balance");
  const refund = balance > 0 ? balance : 0;
  const tenantOwes = balance < 0 ? -balance : 0;
  const result = { input, days, fullYears: accrual.fullYears, remainingDays: accrual.remainingDays, periods: accrual.periods, interestEarned, interestPaid, deductionsTotal, balance, refund, tenantOwes };
  return { ...result, checks: verifySecurityDeposit(result) };
}
function verifySecurityDeposit(r) {
  const input = r.input;
  validateDepositInput(input);
  const paid = input.interestPaid ?? [];
  const walked = daysByCalendarWalk(input.receivedOn, input.moveOutOn);
  const ordered = walked > 0;
  const days = ordered ? walked : 0;
  const to = ordered ? input.moveOutOn : input.receivedOn;
  const second = input.method === "simple" ? { interest: simpleInterestCentsSecondPath(input.deposit, input.rateBp, days), fullYears: null } : compoundSecondPath(input.deposit, input.rateBp, input.receivedOn, to, paid);
  const checks = new CheckList();
  checks.that("dates-order", "Move-out date is after the date the deposit was received", ordered, `Received ${input.receivedOn}, move-out ${input.moveOutOn}; no interest is figured until the dates are in order`);
  checks.equal("days-recounted", `Days held, counted two ways (${DEPOSIT_DAY_COUNT})`, r.days, days);
  checks.equal("periods-cover-days", "Interest periods cover every day held, with no gap or overlap", r.days, r.periods.reduce((a, p) => a + p.days, 0));
  const interestOk = checks.cents(
    "interest-recomputed",
    input.method === "simple" ? "Interest recomputed in a different order of operations matches" : "Compound interest recomputed by a second, independent pass matches",
    r.interestEarned,
    second.interest
  );
  if (!interestOk) {
    checks.that("interest-difference", "The two interest calculations agree", false, "The first figure (the single-division or year-by-year pass) is the one shown; a difference means the result cannot be relied on");
  }
  if (second.fullYears !== null) checks.equal("years-recounted", "Anniversaries counted two ways", r.fullYears, second.fullYears);
  checks.cents("periods-total", "Interest by period adds up to interest earned", r.interestEarned, sum(r.periods.map((p) => p.interest)));
  const negativeDeductions = input.deductions.filter((d2) => d2.amount < 0);
  checks.that("no-negative-deductions", "No deduction is negative", negativeDeductions.length === 0, `${negativeDeductions.length} deduction(s) below zero: ${negativeDeductions.map((d2) => d2.description || "unnamed").join(", ")}`);
  const negativePaid = paid.filter((p) => p.amount < 0);
  checks.that("no-negative-interest-paid", "No interest payment is negative", negativePaid.length === 0, `${negativePaid.length} interest payment(s) below zero`);
  let pass = BigInt(input.deposit) + BigInt(second.interest);
  let deductions = 0n;
  let paidOut = 0n;
  for (let i = input.deductions.length - 1; i >= 0; i--) deductions += BigInt(input.deductions[i].amount);
  for (let i = paid.length - 1; i >= 0; i--) paidOut += BigInt(paid[i].amount);
  pass -= deductions + paidOut;
  const balanceLabel = "Deposit + interest earned - interest already paid - deductions = balance (second pass)";
  if (BigInt(r.deductionsTotal) !== deductions || BigInt(r.interestPaid) !== paidOut) {
    checks.that("balance", balanceLabel, false, `The totals shown (interest already paid ${formatUSD(r.interestPaid)}, deductions ${formatUSD(r.deductionsTotal)}) do not match their lines`);
  } else {
    checks.cents("balance", balanceLabel, r.balance, toCents(pass, "balance"));
  }
  const split = r.refund >= 0 && r.tenantOwes >= 0 && (r.refund === 0 || r.tenantOwes === 0);
  if (split) checks.cents("refund-or-owed", "Amount to return minus balance the tenant owes equals the balance", r.balance, r.refund - r.tenantOwes);
  else checks.that("refund-or-owed", "Amount to return minus balance the tenant owes equals the balance", false, "Only one of the two can be above zero, and neither can be negative");
  if (input.statedInterest !== void 0) checks.cents("stated-interest", "Interest on the existing statement matches the calculated interest", r.interestEarned, input.statedInterest);
  if (input.statedBalance !== void 0) checks.cents("stated-balance", "Balance on the existing statement matches the calculated balance", r.balance, input.statedBalance);
  const compound = input.method === "compound-annual";
  const outside = paid.filter((p) => p.date && (p.date < input.receivedOn || p.date > input.moveOutOn));
  checks.that(
    "interest-paid-dates",
    "Interest payments are dated within the tenancy",
    outside.length === 0,
    `${outside.length} payment(s) dated outside ${input.receivedOn} to ${input.moveOutOn}${compound ? "; they were not taken out of the compounding balance" : ""}`,
    "warning"
  );
  if (compound) {
    const undated = paid.filter((p) => !p.date && p.amount !== 0);
    checks.that(
      "interest-paid-undated",
      "Every interest payment has a date, so it can be taken out of the compounding balance from that date",
      undated.length === 0,
      `${undated.length} payment(s) have no date and were not taken out of the compounding balance, so the interest shown is higher than it would be with the dates entered`,
      "warning"
    );
  }
  checks.that("interest-paid-within-earned", "Interest already paid does not exceed interest earned", r.interestPaid <= r.interestEarned, `Paid ${formatUSD(r.interestPaid)} against ${formatUSD(r.interestEarned)} earned`, "warning");
  checks.that("refund-not-negative", "Deductions do not exceed the deposit plus unpaid interest", r.balance >= 0, `The tenant owes ${formatUSD(r.tenantOwes)}`, "warning");
  return checks.all;
}

// packages/agents/src/registry/property-management.ts
var SECTION = "property-management";
var d = toDecimal;
var text = (v) => typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
var cents = (v) => typeof v === "number" ? v : void 0;
var dueOrCredit = (c) => c >= 0 ? `${formatUSD(c)} due` : `${formatUSD(-c)} credit`;
function squareFeetValue(v, what) {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new AgentInputError(`${what} must be a whole number of square feet, such as 20000: "${s}".`);
  return Number(s);
}
function percentValue(v, what, max100 = false) {
  const s = String(v ?? "").trim().replace(/%$/, "").trim();
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new AgentInputError(`${what} must be a percent of zero or more with at most two decimal places, such as 95 or 7.25: "${s}".`);
  }
  if (max100 && bp > 1e4) throw new AgentInputError(`${what} must be no more than 100.`);
  return bp;
}
function countValue(v, what, fallback) {
  if (v === void 0) return fallback;
  const s = String(v).trim();
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new AgentInputError(`${what} must be a whole number from 1 to 500: "${s}".`);
  return Number(s);
}
var NOTHING = /^(\$?\s*0*(\.0*)?|-)$/;
var isNothing = (...cells) => cells.every((c) => NOTHING.test(c.trim()));
function cellCents(raw, what) {
  if (raw === "") return 0;
  try {
    return pmCellToCents(raw);
  } catch {
    throw new Error(`the ${what} "${raw}" could not be read as an amount`);
  }
}
function cellNonNegative(raw, what) {
  const c = cellCents(raw, what);
  if (c < 0) throw new Error(`the ${what} "${raw}" is negative; enter each amount as zero or more`);
  return c;
}
function cellSquareFeet(raw) {
  const s = raw.replace(/,/g, "").trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error(`the square feet "${raw}" is not a whole number`);
  return Number(s);
}
function cellPercentBp(raw, what, max100) {
  const t = raw.trim();
  const signed = t.endsWith("%");
  const s = t.replace(/%$/, "").trim();
  if (s === "") return void 0;
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new Error(`the ${what} "${raw}" is not a percent with at most two decimal places`);
  }
  if (!signed && bp > 0 && bp < 100) {
    throw new Error(`the ${what} "${raw}" is below 1: a cell formatted as a percent stores 25% as 0.25, so write the percent as a number such as 25 (or "${s}%" with the sign if it really is under one percent)`);
  }
  if (max100 && bp > 1e4) throw new Error(`the ${what} "${raw}" is more than 100%`);
  return bp;
}
function cellPickerDate(raw, what) {
  const s = raw.trim();
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(s) && !/^\d{5}(?:\.\d+)?$/.test(s)) {
    throw new Error(`the ${what} "${raw}" is not written YYYY-MM-DD; write it year first, such as 2024-03-01, so the day and the month cannot be mixed up`);
  }
  try {
    return pmCellToIsoDate(s);
  } catch {
    throw new Error(`the ${what} "${raw}" is not a real day`);
  }
}
function cellYesNo(raw, blank, what, yes = [], no = []) {
  const t = pmNormalizeHeader(raw);
  if (t === "") return blank;
  if (["yes", "y", "true", "x", "1", ...yes].includes(t)) return true;
  if (["no", "n", "false", "0", ...no].includes(t)) return false;
  throw new Error(`the ${what} cell "${raw}" is not Yes or No`);
}
var centsFigure = (what) => (raw) => BigInt(cellCents(raw, what));
var squareFeetFigure = (raw) => BigInt(cellSquareFeet(raw));
var TOTAL_NAMES = /* @__PURE__ */ new Set(["total", "totals", "grand total", "subtotal", "sub total", "subtotals"]);
var rowRange = (rows) => rows.length === 0 ? "no rows" : rows.length === 1 ? `row ${rows[0]}` : `rows ${rows[0]} to ${rows[rows.length - 1]}`;
function readRows(file, c, override, label, nameRole, figures, read) {
  const mapping = mapColumns(file, c, text(override), label);
  const out = { label, records: [], problems: [], leftOut: [], checks: [] };
  const figureRoles = c.roles.filter((r) => figures[r] !== void 0 && mapping.columns[r] >= 0);
  const value = (role, raw) => {
    try {
      return figures[role](raw);
    } catch {
      return null;
    }
  };
  const seen = [];
  let sectionStart = 0;
  const totalOf = (cell, scope) => {
    if (scope.length < 2) return false;
    let nonZero = false;
    for (const role of figureRoles) {
      const raw = cell(role);
      if (raw === "") continue;
      const v = value(role, raw);
      if (v === null) return false;
      let total = 0n;
      for (const s of scope) total += s.values.get(role) ?? 0n;
      if (total !== v) return false;
      if (v !== 0n) nonZero = true;
    }
    return nonZero;
  };
  const totalLines = [];
  for (const { rowNumber, cells } of sheetDataRows(file.rows, mapping.headerRow)) {
    const cell = (role) => sheetCell(cells, mapping.columns[role]);
    const name = cell(nameRole);
    const onlyTotal = TOTAL_NAMES.has(pmNormalizeHeader(name));
    if (name === "" || onlyTotal) {
      const section = seen.slice(sectionStart);
      const scope = totalOf(cell, section) ? section : totalOf(cell, seen) ? seen : null;
      if (scope) {
        const rows = scope.map((s) => s.rowNumber);
        out.leftOut.push({ rowNumber, reason: `the file's own total line, equal to ${rowRange(rows)} added up` });
        totalLines.push({ rowNumber, scope: rows });
        sectionStart = seen.length;
        continue;
      }
      if (onlyTotal) {
        out.problems.push({ rowNumber, reason: `the row named "${name}" is not the rows above it added up, so it is neither read as data nor left out as the file's total line` });
        continue;
      }
    }
    try {
      const rec = read(cell, out.records.length);
      if (rec !== null) {
        out.records.push(rec);
        const values = /* @__PURE__ */ new Map();
        for (const role of figureRoles) values.set(role, value(role, cell(role)) ?? 0n);
        seen.push({ rowNumber, values });
      }
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  const slugLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const t of totalLines) {
    const cellAt = (row, role) => sheetCell(file.rows[row - 1] ?? [], mapping.columns[role]);
    const off = figureRoles.filter((role) => {
      const raw = cellAt(t.rowNumber, role);
      if (raw === "") return false;
      let total = 0n;
      for (const r of t.scope) total += value(role, cellAt(r, role)) ?? 0n;
      return value(role, raw) !== total;
    });
    out.checks.push({
      id: `${slugLabel}-total-line-${t.rowNumber}`,
      label: `${label}: row ${t.rowNumber} is the file's own total line, equal to ${rowRange(t.scope)} added up, and is left out of the result`,
      passed: off.length === 0,
      severity: "error",
      ...off.length ? { detail: `${off.map((r) => c.labels[r]).join(", ")} on row ${t.rowNumber} is not ${rowRange(t.scope)} added up` } : {}
    });
  }
  return out;
}
function rowChecks(...reads) {
  const tag = (r, list) => list.map((p) => ({ rowNumber: p.rowNumber, reason: `${r.label.toLowerCase()}: ${p.reason}` }));
  return [...sheetRowChecks(reads.flatMap((r) => tag(r, r.problems)), reads.flatMap((r) => tag(r, r.leftOut))), ...reads.flatMap((r) => r.checks)];
}
function needRows(r) {
  if (r.records.length > 0) return;
  const what = r.label.toLowerCase();
  if (r.problems.length === 0) throw new AgentInputError(`The ${what} has no rows under its header row.`);
  throw new AgentInputError(`No row of the ${what} could be read: ${r.problems.slice(0, 5).map((p) => `row ${p.rowNumber}, ${p.reason}`).join("; ")}.`);
}
var TENANT_ROLES = ["name", "squareFeet", "fixedShare", "estimatesPaid"];
var TENANT_SYNONYMS = {
  name: ["tenant", "tenant name", "lessee", "occupant", "name"],
  squareFeet: ["square feet", "leased square feet", "rentable square feet", "sq ft", "sqft", "square footage", "rsf", "area"],
  fixedShare: ["fixed share percent optional", "fixed share percent", "fixed share", "pro rata share", "share percent"],
  estimatesPaid: ["estimates paid", "estimated payments", "estimates", "amount paid", "paid", "payments"]
};
var TENANT_COLUMNS = {
  roles: TENANT_ROLES,
  labels: { name: "Tenant", squareFeet: "Square feet", fixedShare: "Fixed share percent", estimatesPaid: "Estimates paid" },
  required: ["name", "squareFeet"],
  guess: (rows, at) => sheetGuessColumns(rows, TENANT_ROLES, TENANT_SYNONYMS, at)
};
var TENANT_FIGURES = { squareFeet: squareFeetFigure, estimatesPaid: centsFigure("estimates paid") };
var TENANT_FILE = "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per tenant: Tenant, Square feet (whole square feet leased), Fixed share percent (only where a lease sets a fixed share instead of square feet, written as a number such as 25; blank otherwise) and Estimates paid during the year (blank is zero). A last row that adds the tenants up, named Total or left blank, is left out.";
function tenantReader(max100) {
  return (cell, i) => {
    const name = cell("name");
    if (name === "" && isNothing(cell("squareFeet"), cell("fixedShare"), cell("estimatesPaid"))) return null;
    const fixed = cellPercentBp(cell("fixedShare"), "fixed share", max100);
    return { name: name || `Tenant ${i + 1}`, squareFeet: cellSquareFeet(cell("squareFeet")), estimatesPaid: cellCents(cell("estimatesPaid"), "estimates paid"), ...fixed !== void 0 ? { fixedShareBp: fixed } : {} };
  };
}
var VARIABLE_WORDS = { yes: ["variable"], no: ["fixed"] };
var CONTROLLABLE_WORDS = { yes: ["controllable"], no: ["uncontrollable", "not controllable", "non controllable"] };
var RECOVERABLE_WORDS = { yes: ["recoverable"], no: ["excluded", "not recoverable", "non recoverable"] };
var CAM_EXPENSE_ROLES = ["category", "amount", "recoverable"];
var CAM_EXPENSE_SYNONYMS = {
  category: ["expense category", "category", "expense", "expense line", "line item", "description", "item", "name"],
  amount: ["amount", "actual amount", "actual", "cost", "total"],
  recoverable: ["recoverable yes or no", "recoverable", "in pool", "included"]
};
var CAM_EXPENSE_COLUMNS = {
  roles: CAM_EXPENSE_ROLES,
  labels: { category: "Expense category", amount: "Amount", recoverable: "Recoverable" },
  required: ["category", "amount"],
  guess: (rows, at) => sheetGuessColumns(rows, CAM_EXPENSE_ROLES, CAM_EXPENSE_SYNONYMS, at)
};
var GROSS_UP_ROLES = ["category", "amount", "variable", "controllable"];
var GROSS_UP_SYNONYMS = {
  category: ["expense line", "expense category", "category", "expense", "line item", "description", "item", "name"],
  amount: ["actual amount", "amount", "actual", "cost", "total"],
  variable: ["variable", "varies with occupancy", "grossed up"],
  controllable: ["controllable", "capped", "cap"]
};
var GROSS_UP_COLUMNS = {
  roles: GROSS_UP_ROLES,
  labels: { category: "Expense line", amount: "Actual amount", variable: "Variable", controllable: "Controllable" },
  required: ["category", "amount"],
  guess: (rows, at) => sheetGuessColumns(rows, GROSS_UP_ROLES, GROSS_UP_SYNONYMS, at)
};
var STOP_LINE_ROLES = ["category", "baseAmount", "currentAmount", "variable"];
var STOP_LINE_SYNONYMS = {
  category: ["expense line", "expense category", "category", "expense", "line item", "description", "item", "name"],
  baseAmount: ["base year amount", "base year actual", "base year", "base amount", "base"],
  currentAmount: ["comparison year amount", "comparison year actual", "comparison year", "current year amount", "current year", "current amount", "comparison", "current", "amount"],
  variable: ["variable", "varies with occupancy", "grossed up"]
};
var STOP_LINE_COLUMNS = {
  roles: STOP_LINE_ROLES,
  labels: { category: "Expense line", baseAmount: "Base year amount", currentAmount: "Comparison year amount", variable: "Variable" },
  required: ["category", "currentAmount"],
  guess: (rows, at) => sheetGuessColumns(rows, STOP_LINE_ROLES, STOP_LINE_SYNONYMS, at)
};
function camPropertySheet(file) {
  const sheet = file.sheets.find((s) => pmNormalizeHeader(s.name) === "property");
  if (!sheet) return null;
  const items = /* @__PURE__ */ new Map();
  for (const row of sheet.rows) {
    const key = pmNormalizeHeader(row[0] ?? "");
    if (key !== "" && !items.has(key)) items.set(key, (row[1] ?? "").trim());
  }
  if (!items.has("total leasable square feet")) return null;
  const readItem = (key, parse) => {
    const raw = items.get(key) ?? "";
    if (raw === "") return void 0;
    try {
      return parse(raw);
    } catch (err) {
      throw new AgentInputError(`On the Property sheet of ${file.name}, ${err instanceof Error ? err.message : `"${raw}" could not be read`}.`);
    }
  };
  const out = { file: file.name };
  const property = items.get("property");
  if (property) out.property = property;
  const periodStart = readItem("period start", (r) => cellPickerDate(r, "period start"));
  if (periodStart) out.periodStart = periodStart;
  const periodEnd = readItem("period end", (r) => cellPickerDate(r, "period end"));
  if (periodEnd) out.periodEnd = periodEnd;
  const gla = readItem("total leasable square feet", (r) => cellSquareFeet(r));
  if (gla !== void 0) out.totalLeasableSqFt = gla;
  const fee = readItem("admin fee on tenant share percent", (r) => cellPercentBp(r, "admin fee percent", false));
  if (fee !== void 0) out.adminFeeBp = fee;
  return out;
}
function agreed(what, sources, show, same = (a, b) => a === b) {
  const given = sources.filter((s) => s.value !== void 0);
  const first = given[0];
  if (!first) return void 0;
  const other = given.find((s) => !same(s.value, first.value));
  if (other) throw new AgentInputError(`${what} is ${show(first.value)} in ${first.from} but ${show(other.value)} in ${other.from}. Give one figure: correct the sheet, or leave the argument out.`);
  return first;
}
var camReconciliation = {
  name: "cam_reconciliation_tenant_shares",
  page: `${SECTION}/cam-reconciliation`,
  section: SECTION,
  kind: "tool",
  title: "CAM reconciliation: common area costs split by tenant square footage",
  description: "Year-end CAM (common area maintenance) reconciliation for a commercial property: the recoverable expenses are split by each tenant's square feet of the total leasable area, or by a fixed share where a lease sets one, with vacant space kept on the landlord, an optional admin fee on each share, and each tenant's balance due or credit after the estimates paid. Shares plus the vacancy share are checked to equal the pool to the cent, shares never exceed the building, each fee and balance is worked out again, and recoverable plus excluded expenses equal total expenses. Use it when someone asks to split common area costs among tenants, work out CAM true-ups for the year, or check a CAM reconciliation. Not for grossing up variable expenses to an occupancy, not for base years or expense stops, and not for reading a lease.",
  question: "Can you split this year’s common area costs among my tenants by square footage, with a 10% admin fee?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet, occupied or not, as a whole number. Vacant space is the difference between this and the tenants’ square feet. Needed unless a file given is a filled-in CAM reconciliation template whose Property sheet has it.", required: false },
    { name: "expenses", kind: "file", label: "Expense list", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per common area expense: Expense category, Amount, and Recoverable (Yes or No; blank is Yes; a No line stays out of the pool). A filled-in CAM reconciliation template can be given as it is: its Expenses sheet is read, and the total leasable square feet, admin fee percent and period filled in on its Property sheet are used (an argument that disagrees with the sheet is refused).", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: `${TENANT_FILE} A filled-in CAM reconciliation template can be given as it is: its Tenants sheet is read.`, required: true },
    { name: "adminFeePercent", kind: "number", label: "Admin fee percent", description: "Optional. The admin fee on each tenant’s share as a percent, such as 10 or 7.5. Without it (and without one on a template’s Property sheet), no fee.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. The first day of the period, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. The last day of the period, YYYY-MM-DD.", required: false },
    columnsInput("Expense list", CAM_EXPENSE_COLUMNS, "expenseColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven splits the pool by the square feet and fixed shares given and keeps vacant space with the landlord; it does not read a lease or say which expenses are recoverable under it.",
  run({ files, values }) {
    const expenseFile = oneFile(files, "expenses");
    const tenantFile = oneFile(files, "tenants");
    const sheets = [camPropertySheet(expenseFile), camPropertySheet(tenantFile)].filter((s) => s !== null);
    const sources = (arg, pick) => [{ from: "the arguments", value: arg }, ...sheets.map((s) => ({ from: `the Property sheet of ${s.file}`, value: pick(s) }))];
    const glaArg = values.totalLeasableSquareFeet === void 0 ? void 0 : squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    const glaFound = agreed("Total leasable square feet", sources(glaArg, (s) => s.totalLeasableSqFt), (v) => `${v.toLocaleString("en-US")} sq ft`);
    if (!glaFound) throw new AgentInputError('Total leasable square feet is needed: give "totalLeasableSquareFeet", or fill it in on the CAM reconciliation template’s Property sheet.');
    const gla = glaFound.value;
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const feeArg = values.adminFeePercent === void 0 ? void 0 : percentValue(values.adminFeePercent, "The admin fee percent");
    const feeFound = agreed("The admin fee", sources(feeArg, (s) => s.adminFeeBp), formatPercentBp);
    const adminFeeBp = feeFound?.value ?? 0;
    const propertyFound = agreed("The property", sources(text(values.property), (s) => s.property), (v) => `"${v}"`, (a, b) => a.toLowerCase() === b.toLowerCase());
    const startFound = agreed("The period start", sources(text(values.periodStart), (s) => s.periodStart), (v) => v);
    const endFound = agreed("The period end", sources(text(values.periodEnd), (s) => s.periodEnd), (v) => v);
    const sheetNote = (name, f) => f && f.from !== "the arguments" ? [name] : [];
    const fromSheet = [...sheetNote("total leasable square feet", glaFound), ...sheetNote("admin fee", feeFound), ...sheetNote("period start", startFound), ...sheetNote("period end", endFound)];
    const ex = readRows(preferSheet(expenseFile, /expense/i), CAM_EXPENSE_COLUMNS, values.expenseColumns, "Expense list", "category", { amount: centsFigure("amount") }, (cell) => {
      const category = cell("category");
      if (category === "" && isNothing(cell("amount"))) return null;
      return { category: category || "Expense", amount: cellCents(cell("amount"), "amount"), recoverable: cellYesNo(cell("recoverable"), true, "Recoverable", RECOVERABLE_WORDS.yes, RECOVERABLE_WORDS.no) };
    });
    const tn = readRows(preferSheet(tenantFile, /tenant/i), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(false));
    needRows(ex);
    needRows(tn);
    const r = computeCam({
      property: propertyFound?.value ?? "",
      periodStart: startFound?.value ?? "",
      periodEnd: endFound?.value ?? "",
      totalLeasableSqFt: gla,
      adminFeeBp,
      expenses: ex.records,
      tenants: tn.records
    });
    const shares = sum(r.tenants.map((t) => t.share));
    const fees = sum(r.tenants.map((t) => t.adminFee));
    const net = sum(r.tenants.map((t) => t.balance));
    return {
      summary: `Recoverable pool ${formatUSD(r.pool)} (${formatUSD(r.excluded)} excluded) split over ${r.tenants.length} tenant(s) and the vacant space of ${gla.toLocaleString("en-US")} sq ft: tenant shares ${formatUSD(shares)}, landlord (vacant space) ${formatUSD(r.landlordShare)}, admin fees ${formatUSD(fees)} at ${formatPercentBp(adminFeeBp)}. Net due from tenants after estimates paid (credits subtracted): ${dueOrCredit(net)}.${fromSheet.length ? ` Taken from the template’s Property sheet: ${listText(fromSheet)}.` : ""}`,
      tables: [
        {
          name: "Summary",
          rows: [
            ["Item", "Amount"],
            ["Recoverable expense pool", d(r.pool)],
            ["Excluded (non-recoverable) expenses", d(r.excluded)],
            ["Tenant shares", d(shares)],
            ["Landlord share (vacant space)", d(r.landlordShare)],
            ["Admin fees", d(fees)],
            ["Net due from tenants (credits subtracted)", d(net)]
          ]
        },
        {
          name: "Tenants",
          rows: [
            ["Tenant", "Square feet", "Share percent", "CAM share", "Admin fee", "Total due", "Estimates paid", "Balance (positive = due, negative = credit)"],
            ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.adminFee), d(t.totalDue), d(t.estimatesPaid), d(t.balance)]),
            ["Landlord (vacant space)", "", "", d(r.landlordShare), "", "", "", ""]
          ]
        },
        { name: "Expenses", rows: [["Expense", "Amount", "Recoverable"], ...r.input.expenses.map((e) => [e.category, d(e.amount), e.recoverable ? "Yes" : "No"])] }
      ],
      checks: [...r.checks, ...rowChecks(ex, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a 20,000 sq ft strip center, $90,000.00 recoverable, a 10% admin fee, 2,000 sq ft vacant",
      args: { totalLeasableSquareFeet: "20000", adminFeePercent: "10", expenses: "agents-fixture:property-management/cam-expenses.csv", tenants: "agents-fixture:property-management/cam-tenants.csv", property: "Example Strip Center", periodStart: "2025-01-01", periodEnd: "2025-12-31" },
      verified: true,
      contains: ["$90,000.00", "$9,000.00", "| Corner Cafe | 5000 | 25.00% | 22500.00 | 2250.00 | 24750.00 | 24000.00 | 750.00 |", "| Family Dental | 8000 | 40.00% | 36000.00 | 3600.00 | 39600.00 | 40000.00 | -400.00 |", "| Pack and Ship | 5000 | 25.00% | 22500.00 | 2250.00 | 24750.00 | 24000.00 | 750.00 |", "| Landlord (vacant space) |  |  | 9000.00 |"]
    },
    {
      label: "A tenant row whose square feet cannot be read is not verified",
      args: { totalLeasableSquareFeet: "20000", expenses: "Expense category,Amount,Recoverable\nLandscaping,18400.00,Yes\n", tenants: "Tenant,Square feet,Estimates paid\nCorner Cafe,5000,24000.00\nFamily Dental,8OOO,40000.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function occupiedFigures(v) {
  const parts = String(v ?? "").split(/[;\n]+/).map((s) => s.trim()).filter((s) => s !== "");
  if (parts.length === 0) throw new AgentInputError('"occupiedSquareFeet" needs at least one figure.');
  if (parts.length > 12) throw new AgentInputError('"occupiedSquareFeet" takes one figure, or one for each month: at most 12.');
  return parts.map((p) => squareFeetValue(p.replace(/,/g, ""), "Each occupied square feet figure"));
}
var camGrossUp = {
  name: "cam_gross_up_pool_split",
  page: `${SECTION}/cam-gross-up-calculator`,
  section: SECTION,
  kind: "tool",
  title: "CAM gross-up: variable expenses grossed up to an occupancy, then split by tenant share",
  description: "Grosses up the variable lines of a CAM expense pool to the occupancy a lease names (factor = gross-up occupancy ÷ actual occupancy, kept as an exact ratio), leaves fixed lines at their actual amounts, applies an optional cap on controllable lines (an amount, or a prior year plus an allowed increase), and splits the pool by tenant square feet or fixed share with each true-up against the estimates paid. The pool is worked out two ways, each variable line is checked against actual × factor, the cap is figured a second way, and the shares plus the unleased remainder add up to the pool to the cent. Use it when someone asks to gross up operating or CAM expenses for vacancy, apply a cap on controllable expenses, or check a grossed-up reconciliation. Not for comparing a year with a base year or an expense stop, and not for deciding which lines a lease makes variable or controllable.",
  question: "Our building was 80% occupied last year. Can you gross up the variable CAM expenses to 95% and work out each tenant’s share?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet, occupied or not, as a whole number.", required: true },
    { name: "occupiedSquareFeet", kind: "text", label: "Occupied square feet", description: 'The occupied square feet: one figure for a single date (such as 40000), or one figure per month separated by semicolons for the average (such as "38000; 40000; 42000"), at most 12.', required: true },
    { name: "grossUpOccupancyPercent", kind: "number", label: "Gross-up occupancy percent", description: "The occupancy the variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95.", required: true },
    { name: "lines", kind: "file", label: "Expense lines", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line: Expense line, Actual amount, Variable (Yes for lines that vary with occupancy and are grossed up; blank is No) and Controllable (Yes for lines a cap covers; blank is No). Amounts are zero or more.", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: TENANT_FILE, required: true },
    { name: "capAmount", kind: "amount", label: "Cap amount", description: "Optional. A cap on the controllable lines after gross-up, as an amount. Give this or the prior year with an increase, not both.", required: false },
    { name: "capPriorYear", kind: "amount", label: "Prior-year controllable expenses", description: "Optional. For a cap figured as the prior year’s controllable expenses plus an allowed increase: the prior year’s amount. Needs capIncreasePercent.", required: false },
    { name: "capIncreasePercent", kind: "number", label: "Allowed increase percent", description: "Optional. The allowed increase over the prior year for the cap, as a percent, such as 5. Needs capPriorYear.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. The first day of the period, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. The last day of the period, YYYY-MM-DD.", required: false },
    columnsInput("Expense lines", GROSS_UP_COLUMNS, "lineColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven calculates from the lines, marks, occupancy and cap given; it does not decide which lines are variable or controllable, what occupancy applies, or what a lease allows.",
  run({ files, values }) {
    const gla = squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const grossUpBp = percentValue(values.grossUpOccupancyPercent, "The gross-up occupancy", true);
    if (grossUpBp === 0) throw new AgentInputError("The gross-up occupancy must be more than zero.");
    const occupiedSqFt = occupiedFigures(values.occupiedSquareFeet);
    let cap;
    const capAmount = cents(values.capAmount);
    const capPrior = cents(values.capPriorYear);
    if (capAmount !== void 0 && (capPrior !== void 0 || values.capIncreasePercent !== void 0)) throw new AgentInputError("Give the cap as an amount (capAmount) or as a prior year plus an increase (capPriorYear and capIncreasePercent), not both.");
    if (capAmount !== void 0) cap = { kind: "amount", amount: capAmount };
    else if (capPrior !== void 0 || values.capIncreasePercent !== void 0) {
      if (capPrior === void 0 || values.capIncreasePercent === void 0) throw new AgentInputError("A cap figured from the prior year needs both capPriorYear and capIncreasePercent.");
      cap = { kind: "increase", priorYear: capPrior, increaseBp: percentValue(values.capIncreasePercent, "The allowed increase") };
    }
    const ln = readRows(oneFile(files, "lines"), GROSS_UP_COLUMNS, values.lineColumns, "Expense lines", "category", { amount: centsFigure("actual amount") }, (cell, i) => {
      const category = cell("category");
      if (category === "" && isNothing(cell("amount"))) return null;
      return {
        category: category || `Line ${i + 1}`,
        amount: cellNonNegative(cell("amount"), "actual amount"),
        variable: cellYesNo(cell("variable"), false, "Variable", VARIABLE_WORDS.yes, VARIABLE_WORDS.no),
        controllable: cellYesNo(cell("controllable"), false, "Controllable", CONTROLLABLE_WORDS.yes, CONTROLLABLE_WORDS.no)
      };
    });
    const tn = readRows(oneFile(files, "tenants"), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(true));
    needRows(ln);
    needRows(tn);
    const periodStart = text(values.periodStart);
    const periodEnd = text(values.periodEnd);
    const r = computeCamGrossUp({
      property: text(values.property) ?? "",
      ...periodStart ? { periodStart } : {},
      ...periodEnd ? { periodEnd } : {},
      totalLeasableSqFt: gla,
      occupiedSqFt,
      grossUpBp,
      ...cap ? { cap } : {},
      lines: ln.records,
      tenants: tn.records
    });
    const tt = r.totals;
    const occupancy = `${formatPercentBp(r.occupancy.actualBp)} (${r.occupancy.readings === 1 ? "one date" : `average of ${r.occupancy.readings} monthly figures`})`;
    const factor = r.occupancy.applies ? `× ${grossUpFactorText(r.factor)} (${formatPercentBp(grossUpBp)} ÷ ${formatPercentBp(r.occupancy.actualBp)})` : "none: actual occupancy is at or above the gross-up occupancy";
    const shares = sum(r.tenants.map((t) => t.share));
    const net = sum(r.tenants.map((t) => t.trueUp));
    const capPart = tt.capAmount !== null ? ` − ${formatUSD(tt.capReduction)} cap reduction` : "";
    return {
      summary: `Actual occupancy ${occupancy}, gross-up factor ${factor}. The pool is ${formatUSD(tt.fixed)} fixed + ${formatUSD(tt.variableActual)} variable + ${formatUSD(tt.increase)} gross-up increase${capPart} = ${formatUSD(r.pool)}${tt.capAmount !== null ? ` (cap ${formatUSD(tt.capAmount)} on ${formatUSD(tt.controllable)} of controllable lines)` : ""}. ${r.tenants.length} tenant share(s) ${formatUSD(shares)} and the unleased remainder ${formatUSD(r.unleased)} add up to the pool; net true-up (credits subtracted) ${dueOrCredit(net)}.${r.occupancy.applies ? ` For comparison, the factor applied to every line, fixed lines included, would have given ${formatUSD(tt.wholePoolGrossedUp)} before any cap.` : ""}`,
      tables: [
        {
          name: "Summary",
          rows: [
            ["Item", "Value", "Amount"],
            ["Property", r.input.property, ""],
            ["Period", [r.input.periodStart, r.input.periodEnd].filter(Boolean).join(" to "), ""],
            ["Total leasable square feet", String(gla), ""],
            ["Actual occupancy", occupancy, ""],
            ["Gross-up occupancy", formatPercentBp(grossUpBp), ""],
            ["Gross-up factor", r.occupancy.applies ? `${r.factor.numerator}/${r.factor.denominator} = ${grossUpFactorText(r.factor, 6)}` : "None (1)", ""],
            ["Fixed lines (not grossed up)", "", d(tt.fixed)],
            ["Variable lines, actual", "", d(tt.variableActual)],
            ["Gross-up increase on variable lines", "", d(tt.increase)],
            ["Variable lines, grossed up", "", d(tt.variableGrossedUp)],
            ...tt.capAmount !== null ? [
              ["Controllable lines after gross-up", "", d(tt.controllable)],
              ["Cap", "", d(tt.capAmount)],
              ["Cap reduction (kept out of the pool)", "", d(tt.capReduction)]
            ] : [],
            ["Grossed-up pool", "", d(r.pool)],
            ["Unleased remainder", "", d(r.unleased)],
            ...r.occupancy.applies ? [["For comparison: the factor applied to every line, before any cap", "", d(tt.wholePoolGrossedUp)]] : []
          ]
        },
        {
          name: "Expense lines",
          rows: [
            ["Expense line", "Variable", "Controllable", "Actual", "Grossed up", "Cap reduction", "In pool"],
            ...r.lines.map((l) => [l.category, l.variable ? "Yes" : "No", l.controllable ? "Yes" : "No", d(l.amount), d(l.grossedUp), d(l.capReduction), d(l.inPool)]),
            ["Total", "", "", d(tt.actual), d(tt.fixed + tt.variableGrossedUp), d(tt.capReduction), d(r.pool)]
          ]
        },
        {
          name: "Tenants",
          rows: [
            ["Tenant", "Square feet", "Share percent", "Share of pool", "Estimates paid", "True-up (positive = due, negative = credit)"],
            ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.estimatesPaid), d(t.trueUp)]),
            ["Unleased remainder", "", "", d(r.unleased), "", ""]
          ]
        }
      ],
      checks: [...r.checks, ...rowChecks(ln, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: 50,000 sq ft, 80% occupied, grossed up to 95%, controllable lines capped at the prior year's $48,000.00 plus 5%",
      args: {
        totalLeasableSquareFeet: "50000",
        occupiedSquareFeet: "40000",
        grossUpOccupancyPercent: "95",
        capPriorYear: "48000.00",
        capIncreasePercent: "5",
        lines: "agents-fixture:property-management/gross-up-lines.csv",
        tenants: "agents-fixture:property-management/gross-up-tenants.csv",
        property: "Example Commons",
        periodStart: "2025-01-01",
        periodEnd: "2025-12-31"
      },
      verified: true,
      contains: [
        "The pool is $86,500.00 fixed + $64,000.00 variable + $12,000.00 gross-up increase − $5,600.00 cap reduction = $156,900.00",
        "19/16 = 1.187500",
        "$50,400.00",
        "| Janitorial | Yes | Yes | 32000.00 | 38000.00 | 3800.00 | 34200.00 |",
        "| Coffee Shop | 10000 | 20.00% | 31380.00 | 30000.00 | 1380.00 |",
        "| Dental Office | 15000 | 30.00% | 47070.00 | 48000.00 | -930.00 |",
        "| Fitness Studio | 15000 | 30.00% | 47070.00 | 45600.00 | 1470.00 |",
        "$31,380.00",
        "$178,718.75"
      ]
    },
    {
      label: "An expense line whose amount cannot be read is not verified",
      args: { totalLeasableSquareFeet: "50000", occupiedSquareFeet: "40000", grossUpOccupancyPercent: "95", lines: 'Expense line,Actual amount,Variable\nInsurance,18000.00,No\nJanitorial,"32,OOO.00",Yes\n', tenants: "Tenant,Square feet,Estimates paid\nCoffee Shop,10000,30000.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var isBaseYearOf = (r) => r.input.base.kind === "base-year";
var baseName = (r) => r.input.baseLabel ? `Base year ${r.input.baseLabel}` : "Base year";
var currentName = (r) => r.input.currentLabel ? `Comparison year ${r.input.currentLabel}` : "Comparison year";
function stopBaseText(r) {
  const b = r.input.base;
  if (b.kind === "stop-per-sqft") return `Stop: ${formatUSD(b.centsPerSqFt)} per sq ft × ${r.input.totalLeasableSqFt.toLocaleString("en-US")} sq ft`;
  if (b.kind === "stop-amount") return "Stop amount";
  return `${baseName(r)} expenses${r.input.grossUp ? ", grossed up" : ""}`;
}
function stopTables(r) {
  const g = r.input.grossUp;
  const factor = (y) => y.applies ? `${y.factor.numerator}/${y.factor.denominator} = ${grossUpFactorText(y.factor, 6)}` : "None (1)";
  const by = r.baseYear;
  const summary = [
    ["Item", "Value", "Amount"],
    ["Property", r.input.property, ""],
    ["Total leasable square feet", String(r.input.totalLeasableSqFt), ""],
    ["Base", stopBaseText(r), d(r.baseAmount)],
    ...g ? [["Gross-up occupancy", formatPercentBp(g.grossUpBp), ""]] : [],
    ...g && by ? [[`${baseName(r)} gross-up factor`, factor(by), ""]] : [],
    ...g ? [[`${currentName(r)} gross-up factor`, factor(r.currentYear), ""]] : [],
    ...by ? [[`${baseName(r)} expenses, actual`, "", d(by.actual)]] : [],
    [`${currentName(r)} expenses, actual`, "", d(r.currentYear.actual)],
    ...g ? [[`${currentName(r)} expenses, grossed up`, "", d(r.currentYear.adjusted)]] : [],
    ["Excess over the base", "", d(r.excess)],
    ["Unleased remainder of the excess", "", d(r.unleased)],
    ["Not passed through to the tenants listed", "", d(r.landlord)],
    ...r.excessWithoutGrossUp !== null ? [["For comparison: the excess with no gross-up", "", d(r.excessWithoutGrossUp)]] : []
  ];
  const lineRows = [
    ["Expense line", "Variable", "Base year actual", "Base year grossed up", "Comparison year actual", "Comparison year grossed up", "Change"],
    ...r.lines.map((l) => [l.category, l.variable ? "Yes" : "No", by ? d(l.baseAmount) : "", by ? d(l.baseAdjusted) : "", d(l.currentAmount), d(l.currentAdjusted), by ? d(l.change) : ""]),
    ["Total", "", by ? d(by.actual) : "", by ? d(by.adjusted) : "", d(r.currentYear.actual), d(r.currentYear.adjusted), by ? d(r.currentYear.adjusted - by.adjusted) : ""]
  ];
  const tenantRows = [
    ["Tenant", "Square feet", "Share percent", "Share of excess", "Estimates paid", "True-up (positive = due, negative = credit)"],
    ...r.tenants.map((t) => [t.name, t.squareFeet, formatPercentBp(t.shareBp), d(t.share), d(t.estimatesPaid), d(t.trueUp)]),
    ["Unleased remainder", "", "", d(r.unleased), "", ""]
  ];
  return [
    { name: "Summary", rows: summary },
    { name: "Expense lines", rows: lineRows },
    { name: "Tenants", rows: tenantRows }
  ];
}
var expenseStop = {
  name: "base_year_expense_stop_true_up",
  page: `${SECTION}/base-year-expense-stop-calculator`,
  section: SECTION,
  kind: "tool",
  title: "Base year and expense stop: each tenant’s share of operating expenses above the base",
  description: "Compares a year's operating expenses with a base year or an expense stop (per square foot of the building, or a building amount), optionally grossing up the variable lines of both years to the same occupancy, each year by its own factor, and splits the excess by each tenant's pro rata share with its true-up against the estimates paid. The excess is worked out from the totals and line by line, each share is checked against the excess × its share, shares plus the unleased remainder add up to the excess, and shares plus the part not passed through add back to the year's expenses to the cent. Use it when someone asks what each tenant owes above a base year or an expense stop, or wants an operating expense escalation true-up checked. Not for splitting a whole CAM pool without a base, and not for deciding the base year, the stop or the shares a lease sets.",
  question: "How much of this year’s operating expenses above the 2024 base year does each tenant owe, with variable lines grossed up to 95%?",
  inputs: [
    { name: "totalLeasableSquareFeet", kind: "number", label: "Total leasable square feet", description: "The whole building’s leasable square feet as a whole number.", required: true },
    { name: "lines", kind: "file", label: "Expense lines", description: "A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line passed through: Expense line, Base year amount (needed with a base year; not used with a stop), Comparison year amount, and Variable (Yes for lines that change with occupancy; blank is No). Amounts are zero or more.", required: true },
    { name: "tenants", kind: "file", label: "Tenant list", description: `${TENANT_FILE} List only the tenants on this base.`, required: true },
    { name: "stopPerSquareFoot", kind: "amount", label: "Stop per square foot", description: "Optional. An expense stop as an amount per square foot of the building, such as 5.50. Without a stop, the base is the base year’s expenses.", required: false },
    { name: "stopAmount", kind: "amount", label: "Stop amount", description: "Optional. An expense stop as one amount for the building. Give this or stopPerSquareFoot, not both.", required: false },
    { name: "grossUpOccupancyPercent", kind: "number", label: "Gross-up occupancy percent", description: "Optional. The occupancy variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95. With a stop, only the comparison year is grossed up. Without it, no gross-up.", required: false },
    { name: "baseYearOccupiedSquareFeet", kind: "number", label: "Occupied square feet, base year", description: "With a gross-up and a base year: the occupied square feet in the base year, as a whole number.", required: false },
    { name: "comparisonYearOccupiedSquareFeet", kind: "number", label: "Occupied square feet, comparison year", description: "With a gross-up: the occupied square feet in the comparison year, as a whole number.", required: false },
    { name: "baseYearLabel", kind: "text", label: "Base year label", description: "Optional. The base year as the lease names it, such as 2024, for the result’s labels.", required: false },
    { name: "comparisonYearLabel", kind: "text", label: "Comparison year label", description: "Optional. The comparison year, such as 2026, for the result’s labels.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property’s name, for the result’s heading.", required: false },
    columnsInput("Expense lines", STOP_LINE_COLUMNS, "lineColumns"),
    columnsInput("Tenant list", TENANT_COLUMNS, "tenantColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven calculates from the figures given; it does not decide the base year, the stop, which lines pass through, which are variable, or any tenant’s share, which the lease sets.",
  run({ files, values }) {
    const gla = squareFeetValue(values.totalLeasableSquareFeet, "Total leasable square feet");
    if (gla === 0) throw new AgentInputError("Total leasable square feet must be more than zero.");
    const rate = cents(values.stopPerSquareFoot);
    const amount = cents(values.stopAmount);
    if (rate !== void 0 && amount !== void 0) throw new AgentInputError("Give the stop per square foot or the stop amount, not both.");
    const base = rate !== void 0 ? { kind: "stop-per-sqft", centsPerSqFt: rate } : amount !== void 0 ? { kind: "stop-amount", amount } : { kind: "base-year" };
    const isBaseYear = base.kind === "base-year";
    let grossUp;
    if (values.grossUpOccupancyPercent !== void 0) {
      const grossUpBp = percentValue(values.grossUpOccupancyPercent, "The gross-up occupancy", true);
      if (grossUpBp === 0) throw new AgentInputError("The gross-up occupancy must be more than zero, or left out for none.");
      if (values.comparisonYearOccupiedSquareFeet === void 0) throw new AgentInputError("A gross-up needs the comparison year’s occupied square feet (comparisonYearOccupiedSquareFeet).");
      if (isBaseYear && values.baseYearOccupiedSquareFeet === void 0) throw new AgentInputError("A gross-up with a base year needs the base year’s occupied square feet (baseYearOccupiedSquareFeet).");
      grossUp = {
        grossUpBp,
        baseOccupiedSqFt: isBaseYear ? squareFeetValue(values.baseYearOccupiedSquareFeet, "Occupied square feet in the base year") : 0,
        currentOccupiedSqFt: squareFeetValue(values.comparisonYearOccupiedSquareFeet, "Occupied square feet in the comparison year")
      };
    } else if (values.baseYearOccupiedSquareFeet !== void 0 || values.comparisonYearOccupiedSquareFeet !== void 0) {
      throw new AgentInputError("Occupied square feet were given without a gross-up occupancy (grossUpOccupancyPercent). Give the gross-up occupancy, or leave the occupied square feet out.");
    }
    const columns = { ...STOP_LINE_COLUMNS, required: isBaseYear ? ["category", "baseAmount", "currentAmount"] : ["category", "currentAmount"] };
    const lineFigures = isBaseYear ? { baseAmount: centsFigure("base year amount"), currentAmount: centsFigure("comparison year amount") } : { currentAmount: centsFigure("comparison year amount") };
    const ln = readRows(oneFile(files, "lines"), columns, values.lineColumns, "Expense lines", "category", lineFigures, (cell, i) => {
      const category = cell("category");
      const baseCell = isBaseYear ? cell("baseAmount") : "";
      if (category === "" && isNothing(baseCell, cell("currentAmount"))) return null;
      return {
        category: category || `Line ${i + 1}`,
        baseAmount: isBaseYear ? cellNonNegative(baseCell, "base year amount") : 0,
        currentAmount: cellNonNegative(cell("currentAmount"), "comparison year amount"),
        variable: cellYesNo(cell("variable"), false, "Variable", VARIABLE_WORDS.yes, VARIABLE_WORDS.no)
      };
    });
    const tn = readRows(oneFile(files, "tenants"), TENANT_COLUMNS, values.tenantColumns, "Tenant list", "name", TENANT_FIGURES, tenantReader(true));
    needRows(ln);
    needRows(tn);
    const r = computeExpenseStop({
      property: text(values.property) ?? "",
      baseLabel: text(values.baseYearLabel) ?? "",
      currentLabel: text(values.comparisonYearLabel) ?? "",
      totalLeasableSqFt: gla,
      base,
      ...grossUp ? { grossUp } : {},
      lines: ln.records,
      tenants: tn.records
    });
    const shares = sum(r.tenants.map((t) => t.share));
    const net = sum(r.tenants.map((t) => t.trueUp));
    const current = r.input.currentLabel ? `the ${r.input.currentLabel} expenses` : "the comparison year expenses";
    return {
      summary: `The base is ${formatUSD(r.baseAmount)} (${stopBaseText(r).toLowerCase()}) and ${current}${grossUp ? ", grossed up," : ""} are ${formatUSD(r.currentYear.adjusted)}, so the excess is ${formatUSD(r.excess)}${r.belowBase ? " (the expenses are at or below the base, so nothing passes through)" : ""}. ${r.tenants.length} tenant share(s) ${formatUSD(shares)} and the unleased remainder ${formatUSD(r.unleased)} add up to the excess; ${formatUSD(r.landlord)} is not passed through to the tenants listed (${r.belowBase ? "all of the expenses, which are at or below the base" : "the base plus that remainder"}). Net true-up (credits subtracted): ${dueOrCredit(net)}.${r.excessWithoutGrossUp !== null ? ` Without the gross-up the excess would have been ${formatUSD(r.excessWithoutGrossUp)}.` : ""}${grossUp && !isBaseYearOf(r) ? " With a stop, only the comparison year is grossed up." : ""}`,
      tables: stopTables(r),
      checks: [...r.checks, ...rowChecks(ln, tn)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a 100,000 sq ft office building, base year 2024 at 80% occupied, comparison year 2026 at 90%, grossed up to 95%",
      args: {
        totalLeasableSquareFeet: "100000",
        lines: "agents-fixture:property-management/expense-stop-lines.csv",
        tenants: "agents-fixture:property-management/expense-stop-tenants.csv",
        grossUpOccupancyPercent: "95",
        baseYearOccupiedSquareFeet: "80000",
        comparisonYearOccupiedSquareFeet: "90000",
        baseYearLabel: "2024",
        comparisonYearLabel: "2026",
        property: "Example Office Plaza"
      },
      verified: true,
      contains: [
        "The base is $566,000.00",
        "are $618,500.00, so the excess is $52,500.00",
        "| Janitorial | Yes | 128000.00 | 152000.00 | 162000.00 | 171000.00 | 19000.00 |",
        "| Harbor Law Group | 25000 | 25.00% | 13125.00 | 12000.00 | 1125.00 |",
        "| North Studio Architects | 15000 | 15.00% | 7875.00 | 9600.00 | -1725.00 |",
        "| Pine Insurance Agency | 40000 | 40.00% | 21000.00 | 19800.00 | 1200.00 |",
        "the unleased remainder $10,500.00",
        "$576,500.00 is not passed through",
        "Without the gross-up the excess would have been $79,500.00"
      ]
    },
    {
      label: "Tenants that lease more than the whole building are not verified",
      args: {
        totalLeasableSquareFeet: "100000",
        lines: "Expense line,Base year amount,Comparison year amount\nReal estate taxes,240000.00,262000.00\n",
        tenants: "Tenant,Square feet,Estimates paid\nHarbor Law Group,60000,12000.00\nPine Insurance Agency,50000,19800.00\n"
      },
      verified: false,
      failedCheck: "shares-within-100"
    }
  ]
};
var LEDGER_COLUMNS = {
  roles: ["date", "description", "amount", "type"],
  labels: { date: "Date", description: "Description", amount: "Amount", type: "Type" },
  required: ["date", "amount"],
  guess: (rows, at) => {
    const m = at === void 0 ? guessOwnerLedgerColumns(rows) : { ...guessOwnerLedgerColumns([rows[at] ?? []]), headerRow: at };
    return { headerRow: m.headerRow, columns: { date: m.date, description: m.description, amount: m.amount, type: m.type } };
  }
};
function typeMeanings(v) {
  const out = {};
  const t = text(v);
  if (!t) return out;
  for (const part of t.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.lastIndexOf("=");
    if (eq < 0) throw new AgentInputError(`"typeMeanings" must be written as "<type in the file> = income", separated by commas: "${part.trim()}".`);
    const left = pmNormalizeHeader(part.slice(0, eq));
    const key = left === "blank" || left === "no type" ? "" : left;
    const word = pmNormalizeHeader(part.slice(eq + 1));
    const kind = word === "income" ? "income" : word === "expense" || word === "expenses" ? "expense" : ["distribution", "distributions", "paid to owner", "owner distribution"].includes(word) ? "distribution" : ["leave out", "left out", "skip", "not part of this statement"].includes(word) ? "skip" : void 0;
    if (!kind) throw new AgentInputError(`In "typeMeanings", "${part.slice(eq + 1).trim()}" must be one of: income, expense, paid to owner, leave out.`);
    out[key] = kind;
  }
  return out;
}
function rowNumbers(v) {
  const t = text(v);
  if (!t) return [];
  return t.split(/[,;\s]+/).filter((s) => s !== "").map((s) => {
    if (!/^\d+$/.test(s)) throw new AgentInputError(`"leaveOutRows" lists row numbers as the spreadsheet shows them, such as "7, 12": "${s}".`);
    return Number(s);
  });
}
var ownerStatements = {
  name: "owner_statement_from_ledger",
  page: `${SECTION}/owner-statements`,
  section: SECTION,
  kind: "tool",
  title: "Owner statement for a managed rental from a ledger",
  description: "Builds a monthly owner statement for a managed rental from a ledger (.csv or .xlsx with date, description, amount and type columns): income, expenses, the management fee at the rate given (optionally only on income lines containing a word such as rent), what was paid to the owner, and the closing balance that carries into the next period. The closing balance and the fee are worked out a second way, every ledger row is either imported once or listed as left out, each imported amount is read from its cell a second time, and a row that cannot be read, or whose type does not say which way the money went, fails a check that names the row. Use it when someone asks for an owner statement or a monthly owner report from their own rental ledger, or wants the fee and closing balance checked. Not for tenant ledgers or rent rolls, and not for deciding what a management agreement allows.",
  question: "Can you make January’s owner statement from this rental ledger, with an 8% management fee on rent and a $300 reserve?",
  inputs: [
    { name: "ledger", kind: "file", label: "Ledger", description: "A .csv or .xlsx file (a path, or the CSV text itself) with one row per transaction: Date and Amount are needed; Description and Type (Income, Expense or Distribution, meaning money paid to the owner) are used when present. Without a type column, positive amounts are income and negative amounts expenses. A filled-in owner statement template can be given as it is: its Ledger sheet is read.", required: true },
    { name: "periodStart", kind: "date", label: "Period start", description: "The first day of the statement period, YYYY-MM-DD.", required: true },
    { name: "periodEnd", kind: "date", label: "Period end", description: "The last day of the statement period, YYYY-MM-DD.", required: true },
    { name: "openingBalance", kind: "amount", label: "Opening balance", description: "Optional. The balance carried in from last period. Without it, zero.", required: false },
    { name: "managementFeePercent", kind: "number", label: "Management fee percent", description: "Optional. The management fee as a percent of income, such as 8. Without it, no fee.", required: false },
    { name: "feeOnIncomeContaining", kind: "text", label: "Fee only on income lines containing", description: 'Optional. A word such as "rent": the fee is figured only on income lines whose description contains it, ignoring case. Without it, on all income.', required: false },
    { name: "reserve", kind: "amount", label: "Reserve held", description: "Optional. A reserve the manager keeps; a warning shows when the closing balance is below it.", required: false },
    { name: "owner", kind: "text", label: "Owner", description: "Optional. The owner’s name, for the statement.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property, for the statement.", required: false },
    { name: "expenseSign", kind: "choice", label: "How the ledger writes expenses", description: 'Optional. "from-file" (the default) reads it from the file and imports nothing when expense rows are written with both signs; "negative" or "positive" says how expenses are written, and rows written the other way become reversals (a vendor refund reduces expenses).', required: false, choices: ["from-file", "negative", "positive"] },
    { name: "typeMeanings", kind: "text", label: "What unrecognized types mean", description: 'Optional. For a type the tool does not recognize or that does not say which way money went (Payment, Charge, Credit, Deposit): "<type in the file> = income | expense | paid to owner | leave out", separated by commas, such as "Rent payment = income, Owner draw = paid to owner". "blank" names rows with no type. Nothing is assumed without it.', required: false },
    { name: "leaveOutRows", kind: "text", label: "Rows to leave out", description: 'Optional. Row numbers of the ledger (as the spreadsheet shows them) that could not be imported and that the person has chosen to leave out, such as "7, 12". Each stays on the certificate as a warning.', required: false },
    { name: "dateOrder", kind: "choice", label: "Dates written with numbers only", description: 'Optional. "month-first" (the default, 3/2/2026 is March 2) or "day-first".', required: false, choices: ["month-first", "day-first"] },
    columnsInput("Ledger", LEDGER_COLUMNS, "ledgerColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven adds up the ledger rows given and works out the fee at the rate entered; it does not read a management agreement or say what to pay the owner.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "ledger"), /ledger/i);
    const periodStart = values.periodStart;
    const periodEnd = values.periodEnd;
    if (periodEnd < periodStart) throw new AgentInputError("The period end is before the period start.");
    const m = mapColumns(file, LEDGER_COLUMNS, text(values.ledgerColumns), "Ledger");
    const mapping = { headerRow: m.headerRow, date: m.columns.date, description: m.columns.description, amount: m.columns.amount, type: m.columns.type };
    const sign = values.expenseSign === "negative" || values.expenseSign === "positive" ? values.expenseSign : "auto";
    const leaveOut = rowNumbers(values.leaveOutRows);
    const x = extractOwnerLedger(file.rows, mapping, { outflowSign: sign, dateOrder: values.dateOrder === "day-first" ? "dmy" : "mdy", typeMap: typeMeanings(values.typeMeanings), dismissedRows: leaveOut });
    const leftOut = new Set(x.skipped.map((s) => s.rowNumber));
    const notLeftOut = leaveOut.filter((n) => !leftOut.has(n));
    if (notLeftOut.length > 0) {
      const open = [...leftOut].sort((a, b) => a - b);
      throw new AgentInputError(
        `"leaveOutRows" names row ${notLeftOut.join(", ")}, which ${notLeftOut.length === 1 ? "is" : "are"} not a row the ledger import left out (${notLeftOut.length === 1 ? "it was" : "they were"} imported, or ${notLeftOut.length === 1 ? "holds" : "hold"} no data). Rows left out of this import: ${open.length ? open.join(", ") : "none"}.`
      );
    }
    const feeBp = values.managementFeePercent === void 0 ? 0 : percentValue(values.managementFeePercent, "The management fee percent");
    const pattern = ownerFeePattern(text(values.feeOnIncomeContaining) ?? "");
    const reserve = cents(values.reserve);
    const input = {
      owner: text(values.owner) ?? "",
      property: text(values.property) ?? "",
      periodStart,
      periodEnd,
      openingBalance: cents(values.openingBalance) ?? 0,
      income: x.income,
      expenses: x.expenses,
      managementFeeBp: feeBp,
      ...pattern ? { feeOnIncomeMatching: pattern } : {},
      distributions: x.distributions,
      ...reserve !== void 0 ? { reserve } : {}
    };
    const r = computeOwnerStatement(input);
    const t = ownerStatementTables(r);
    const u = formatUSD;
    return {
      summary: `Income ${u(r.totalIncome)}, expenses ${u(r.totalExpenses)}, management fee ${u(r.managementFee)} (${ownerFeeRateText(feeBp)} of ${u(r.feeBase)}), paid to owner ${u(r.totalDistributions)}. Closing balance: ${u(input.openingBalance)} + ${u(r.totalIncome)} − ${u(r.totalExpenses)} − ${u(r.managementFee)} − ${u(r.totalDistributions)} = ${u(r.closingBalance)}, the next period's opening balance. ${x.placed.length} ledger row(s) imported: ${x.income.length} income, ${x.expenses.length} expense, ${x.distributions.length} paid to owner${x.reversals.length ? `, ${x.reversals.length} of them reversals` : ""}.`,
      tables: [
        { name: "Statement", rows: t.summary },
        { name: "Details", rows: [["Item", "Value"], ["Owner", input.owner], ["Property", input.property], ["Period start", periodStart], ["Period end", periodEnd]] },
        { name: "Income", rows: t.income },
        { name: "Expenses", rows: t.expenses },
        { name: "Paid to owner", rows: t.distributions }
      ],
      checks: [...r.checks, ...x.checks]
    };
  },
  examples: [
    {
      label: "The page's worked example: Maple Ridge Holdings LLC, 48 Alder Court, January 2026, $500.00 opening, 8% on rent, $300.00 reserve",
      args: {
        ledger: "fixture:owner-ledger.csv",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        openingBalance: "500.00",
        managementFeePercent: "8",
        feeOnIncomeContaining: "rent",
        reserve: "300.00",
        owner: "Maple Ridge Holdings LLC",
        property: "48 Alder Court"
      },
      verified: true,
      contains: ["Income $2,800.00, expenses $445.50, management fee $220.00 (8% of $2,750.00)", "$500.00 + $2,800.00 − $445.50 − $220.00 − $2,000.00 = $634.50", "| Management fee (8% of 2750.00) | -220.00 |", "| Closing balance | 634.50 |"]
    },
    {
      label: "A ledger row whose amount cannot be read is not verified",
      args: { ledger: "Date,Description,Amount,Type\n1/3/2026,Rent - Unit 1,1450.00,Income\n1/12/2026,Plumbing repair,32S.50,Expense\n", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
      verified: false,
      failedCheck: "ledger-row-3"
    }
  ]
};
var DEDUCTION_ROLES = ["description", "amount"];
var DEDUCTION_COLUMNS = {
  roles: DEDUCTION_ROLES,
  labels: { description: "Description", amount: "Amount" },
  required: ["amount"],
  guess: (rows, at) => sheetGuessColumns(rows, DEDUCTION_ROLES, { description: ["description", "deduction", "item", "reason", "charge", "memo"], amount: ["amount", "cost", "charge amount", "total"] }, at)
};
var PAID_ROLES = ["date", "amount"];
var PAID_COLUMNS = {
  roles: PAID_ROLES,
  labels: { date: "Date", amount: "Amount" },
  required: ["amount"],
  guess: (rows, at) => sheetGuessColumns(rows, PAID_ROLES, { date: ["date", "date paid", "paid on", "payment date"], amount: ["amount", "interest paid", "amount paid", "interest"] }, at)
};
function depositMethodLabel(r) {
  const rate = formatPercentBp(r.input.rateBp);
  return r.input.method === "simple" ? `${rate} a year, simple interest, actual days / 365` : `${rate} a year, compounded annually on each anniversary of the date received; simple interest (actual days / 365) for the final part-year; interest already paid out leaves the compounding balance on its date`;
}
var securityDeposit = {
  name: "security_deposit_interest_statement",
  page: `${SECTION}/security-deposit`,
  section: SECTION,
  kind: "tool",
  title: "Security deposit interest and itemized deposit statement",
  description: "Works out interest on a tenant's security deposit at the annual rate given (simple interest on actual days / 365, or compounded on each anniversary of the date received), subtracts interest already paid and itemized deductions, and gives the amount to return to the tenant or the balance the tenant owes, as an itemized statement with the interest by period. Interest is figured twice in different orders of operations, days held are counted two ways, the balance is rebuilt line by line, and figures from a statement prepared elsewhere can be compared with the calculated ones. Use it when someone asks how much interest a deposit earned, wants an itemized deposit statement at move-out, or wants a deposit statement checked. Not for finding which rate, method or deductions a state or lease allows: the rate is the person's to give.",
  question: "How much interest has a $1,800 security deposit earned at 2% since March 2023, and what is left to return after these deductions?",
  inputs: [
    { name: "deposit", kind: "amount", label: "Deposit amount", description: "The security deposit received, such as 1800.00.", required: true },
    { name: "receivedOn", kind: "date", label: "Date received", description: "The day the deposit was received, YYYY-MM-DD (day zero of the count).", required: true },
    { name: "moveOutOn", kind: "date", label: "Move-out date", description: "The move-out day, YYYY-MM-DD (the last day counted).", required: true },
    { name: "annualRatePercent", kind: "number", label: "Annual interest rate percent", description: "The annual rate from the lease or a local rule, as a percent from 0 to 100 with at most two decimal places, such as 2 or 0.05. 0 is allowed. The tool does not supply a rate.", required: true },
    { name: "method", kind: "choice", label: "Interest method", description: 'Optional. "simple" (the default: deposit × rate × actual days / 365) or "compound-annual" (a year’s interest added on each anniversary, simple interest for the last part-year).', required: false, choices: ["simple", "compound-annual"] },
    { name: "deductions", kind: "file", label: "Deductions", description: "Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per deduction: Description and Amount. A last row that adds them up, named Total or left blank, is left out.", required: false },
    { name: "interestPaid", kind: "file", label: "Interest already paid", description: "Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per payment of interest already paid or credited to the tenant: Date, written YYYY-MM-DD (a date written with slashes, such as 1/3/2024, is refused so the day and month cannot be mixed up; with compounding, a dated payment leaves the balance on that date), and Amount.", required: false },
    { name: "statedInterest", kind: "amount", label: "Interest on an existing statement", description: "Optional. The interest shown on a statement prepared elsewhere, to compare with the calculated interest.", required: false },
    { name: "statedBalance", kind: "amount", label: "Amount returned on an existing statement", description: "Optional. The amount returned on a statement prepared elsewhere (negative if the tenant owes), to compare with the calculated balance.", required: false },
    { name: "tenant", kind: "text", label: "Tenant", description: "Optional. The tenant’s name, for the statement.", required: false },
    { name: "property", kind: "text", label: "Property", description: "Optional. The property, for the statement.", required: false },
    columnsInput("Deductions", DEDUCTION_COLUMNS, "deductionColumns"),
    columnsInput("Interest already paid", PAID_COLUMNS, "interestPaidColumns")
  ],
  limits: "site",
  comparisonChecks: ["stated-interest", "stated-balance"],
  notAdvice: "Mathproven figures interest only at the rate entered; it does not choose a rate or say which rate, method, or deductions apply to a tenancy.",
  run({ files, values }) {
    const deposit = values.deposit;
    if (deposit <= 0) throw new AgentInputError("The deposit amount must be more than zero.");
    const rateBp = percentValue(values.annualRatePercent, "The annual interest rate", true);
    const reads = [];
    let deductions = [];
    const deductionFile = files.deductions?.[0];
    if (deductionFile) {
      const rd = readRows(deductionFile, DEDUCTION_COLUMNS, values.deductionColumns, "Deductions", "description", { amount: centsFigure("amount") }, (cell, i2) => {
        const description = cell("description");
        const amount = cell("amount");
        if (description === "" && amount === "") return null;
        if (amount === "") throw new Error("no amount");
        return { description: description || `Deduction ${i2 + 1}`, amount: cellCents(amount, "amount") };
      });
      reads.push(rd);
      deductions = rd.records;
    }
    let interestPaid = [];
    const paidFile = files.interestPaid?.[0];
    if (paidFile) {
      const rp = readRows(paidFile, PAID_COLUMNS, values.interestPaidColumns, "Interest already paid", "date", { amount: centsFigure("amount") }, (cell) => {
        const date = cell("date");
        const amount = cell("amount");
        if (date === "" && amount === "") return null;
        if (amount === "") throw new Error("no amount");
        return { date: date === "" ? "" : cellPickerDate(date, "date"), amount: cellCents(amount, "amount") };
      });
      reads.push(rp);
      interestPaid = rp.records;
    }
    const statedInterest = cents(values.statedInterest);
    const statedBalance = cents(values.statedBalance);
    const r = computeSecurityDeposit({
      tenant: text(values.tenant) ?? "",
      property: text(values.property) ?? "",
      deposit,
      receivedOn: values.receivedOn,
      moveOutOn: values.moveOutOn,
      rateBp,
      method: values.method === "compound-annual" ? "compound-annual" : "simple",
      interestPaid,
      deductions,
      ...statedInterest !== void 0 ? { statedInterest } : {},
      ...statedBalance !== void 0 ? { statedBalance } : {}
    });
    const i = r.input;
    const owes = r.balance < 0;
    const u = formatUSD;
    return {
      summary: `Interest earned ${u(r.interestEarned)} over ${r.days} days held (${depositMethodLabel(r)}); interest already paid ${u(r.interestPaid)}; deductions ${u(r.deductionsTotal)}. ${u(i.deposit)} + ${u(r.interestEarned)} − ${u(r.interestPaid)} − ${u(r.deductionsTotal)} = ${owes ? `${u(r.balance)}: a balance of ${u(r.tenantOwes)} owed by the tenant` : `${u(r.refund)} to return to the tenant`}.`,
      tables: [
        {
          name: "Statement",
          rows: [
            ["Line", "Amount"],
            ["Deposit received", d(i.deposit)],
            ["Interest earned", d(r.interestEarned)],
            ...(i.interestPaid ?? []).map((p) => [`Interest already paid or credited${p.date ? ` (${p.date})` : ""}`, d(-p.amount)]),
            ...i.deductions.map((x) => [`Deduction: ${x.description}`, d(-x.amount)]),
            ["Total deductions", d(r.deductionsTotal)],
            [owes ? "Balance owed by tenant" : "Amount to return to tenant", d(owes ? r.tenantOwes : r.refund)]
          ]
        },
        { name: "Interest", rows: [["Interest period", "From", "To", "Days", "Balance earning interest", "Interest"], ...r.periods.map((p) => [p.label, p.from, p.to, p.days, d(p.base), d(p.interest)])] },
        {
          name: "Details",
          rows: [["Item", "Value"], ["Tenant", i.tenant], ["Property", i.property], ["Date received", i.receivedOn], ["Move-out date", i.moveOutOn], ["Days held", r.days], ["Interest", depositMethodLabel(r)]]
        }
      ],
      checks: [...r.checks, ...reads.length ? rowChecks(...reads) : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: $1,800.00 received 2023-03-01, move-out 2025-06-30, 2% simple, $36.00 already paid, three deductions",
      args: {
        deposit: "1800.00",
        receivedOn: "2023-03-01",
        moveOutOn: "2025-06-30",
        annualRatePercent: "2",
        method: "simple",
        interestPaid: "Date,Amount\n2024-03-01,36.00\n",
        deductions: "Description,Amount\nCarpet cleaning,185.00\nWall repair and paint,240.00\nUnpaid water bill,62.47\n"
      },
      verified: true,
      contains: ["Interest earned $84.03 over 852 days held", "deductions $487.47", "$1,800.00 + $84.03 − $36.00 − $487.47 = $1,360.56", "| Amount to return to tenant | 1360.56 |", "| Deduction: Wall repair and paint | -240.00 |"]
    },
    {
      label: "A statement prepared elsewhere that returns a different amount is not verified",
      args: { deposit: "1800.00", receivedOn: "2023-03-01", moveOutOn: "2025-06-30", annualRatePercent: "2", deductions: "Description,Amount\nCarpet cleaning,185.00\n", statedBalance: "1615.00" },
      verified: false,
      failedCheck: "stated-balance"
    }
  ]
};
var PAYOUT_COLUMNS = {
  roles: STR_PAYOUT_ROLES,
  labels: STR_ROLE_LABELS,
  required: ["payoutDate", "payoutAmount"],
  guess: (rows, at) => {
    const m = strGuessPayoutColumns(rows, at);
    return { headerRow: m.headerRow, columns: m.columns };
  }
};
var BANK_COLUMNS = {
  roles: STR_BANK_ROLES,
  labels: STR_BANK_LABELS,
  required: ["date", "amount"],
  guess: (rows, at) => {
    const m = strGuessBankColumns(rows, at);
    return { headerRow: m.headerRow, columns: m.columns };
  }
};
function amountSigns(guessed, v) {
  const out = { ...guessed };
  const t = text(v);
  if (!t) return out;
  for (const part of t.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"amountSigns" must be written as "<column> = add" or "<column> = subtract": "${part.trim()}".`);
    const name = pmNormalizeHeader(part.slice(0, eq));
    const role = STR_COMPONENT_ROLES.find((r) => pmNormalizeHeader(STR_ROLE_LABELS[r]) === name || pmNormalizeHeader(r) === name);
    if (!role) throw new AgentInputError(`"${part.slice(0, eq).trim()}" is not one of the amounts in a payout row. They are: ${STR_COMPONENT_ROLES.map((r) => STR_ROLE_LABELS[r]).join(", ")}.`);
    const word = pmNormalizeHeader(part.slice(eq + 1));
    if (["add", "added", "plus"].includes(word)) out[role] = "add";
    else if (["subtract", "subtracted", "minus"].includes(word)) out[role] = "subtract";
    else throw new AgentInputError(`In "amountSigns", "${part.slice(eq + 1).trim()}" must be add or subtract.`);
  }
  return out;
}
var bucketText = (b) => `${b.count} (${formatUSD(b.sum)})`;
var strPayouts = {
  name: "short_term_rental_payout_reconciler",
  page: `${SECTION}/str-payout-reconciler`,
  section: SECTION,
  kind: "tool",
  title: "Short-term rental payouts matched to bank deposits",
  description: "Ties out a payout or earnings report exported from a short-term rental platform (.csv or .xlsx) against a bank statement export: each report row is checked (gross earnings − fees ± cleaning fees, taxes and adjustments, as mapped, = payout), rows are grouped into payouts by payout id or payout date, and each payout is matched to exactly one bank deposit of the same amount within a date window (5 days unless given). A payout or deposit with more than one possible pairing is listed as ambiguous and never matched, no payout or deposit is used twice, and matched + ambiguous + unmatched is checked against all payouts and all deposits by count and by amount. Use it when someone asks whether their rental payouts reached the bank, or wants host payouts reconciled with bank deposits. Not affiliated with any rental platform; not for booking calendars, guest messages or tax returns.",
  question: "Do the payouts in my short-term rental earnings report match the deposits on my bank statement?",
  inputs: [
    { name: "payoutReport", kind: "file", label: "Payout report", description: "The payout or earnings report exported from the rental platform: a .csv or .xlsx file (a path, or the CSV text itself) with a header row. Payout date and payout amount are needed; reservation code, payout id, gross earnings, fees, cleaning fees, taxes and adjustments are used when present.", required: true },
    { name: "bankStatement", kind: "file", label: "Bank statement", description: "The bank statement export: a .csv or .xlsx file (a path, or the CSV text itself) with Date and Amount columns, and Description when present. Only money coming in is matched.", required: true },
    { name: "windowDays", kind: "number", label: "Days allowed between payout and deposit", description: "Optional. How many days a deposit may be before or after its payout date, a whole number from 0 to 60. Without it, 5.", required: false },
    { name: "groupBy", kind: "choice", label: "Group report rows into payouts by", description: 'Optional. "auto" (the default: payout id when every row has one, otherwise payout date), "payout-id" or "payout-date".', required: false, choices: ["auto", "payout-id", "payout-date"] },
    { name: "bankDescriptionContains", kind: "text", label: "Only bank deposits whose description contains", description: 'Optional. Text a deposit’s description must contain to be considered, ignoring case, such as "payout". Narrows ties between deposits of the same amount.', required: false },
    { name: "bankMoneyIn", kind: "choice", label: "Money in on the bank statement is shown as", description: 'Optional. "positive" (the default) or "negative" amounts.', required: false, choices: ["positive", "negative"] },
    { name: "undatedRows", kind: "choice", label: "Report rows with an amount but no payout date", description: 'Optional. "report" (the default: listed as rows that could not be read, so the result is not verified), "inherit" (given the payout date of the row above) or "leave-out" (totals or notes). Either of the last two is recorded as a warning that names the rows. A totals row whose amounts equal the column totals above it is left out by itself.', required: false, choices: ["report", "inherit", "leave-out"] },
    { name: "dateOrder", kind: "choice", label: "Dates written with numbers only", description: 'Optional. "month-first" (the default) or "day-first"; applies to both files.', required: false, choices: ["month-first", "day-first"] },
    { name: "amountSigns", kind: "text", label: "Added or subtracted", description: `Optional. How an amount column enters the payout, when the guess is wrong: "<column> = add" or "<column> = subtract", separated by commas. Columns: ${STR_COMPONENT_ROLES.map((r) => STR_ROLE_LABELS[r]).join(", ")}. By default fees and taxes written as positive numbers are subtracted, and everything else is added as written.`, required: false },
    columnsInput("Payout report", PAYOUT_COLUMNS, "reportColumns"),
    columnsInput("Bank statement", BANK_COLUMNS, "bankColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven only reads the two files given and pairs amounts that match exactly; it is not affiliated with any short-term rental platform and does not decide which pairing is right when more than one is possible.",
  run({ files, values }) {
    const report = oneFile(files, "payoutReport");
    const bank = oneFile(files, "bankStatement");
    const dateOrder = values.dateOrder === "day-first" ? "dmy" : "mdy";
    let windowDays;
    if (values.windowDays !== void 0) {
      const s = String(values.windowDays);
      if (!/^\d+$/.test(s)) throw new AgentInputError(`"windowDays" must be a whole number of days from 0 to 60: "${s}".`);
      windowDays = Number(s);
    }
    const rc = mapColumns(report, PAYOUT_COLUMNS, text(values.reportColumns), "Payout report");
    const effects = amountSigns(strGuessPayoutColumns(report.rows, rc.headerRow).effects, values.amountSigns);
    const bc = mapColumns(bank, BANK_COLUMNS, text(values.bankColumns), "Bank statement");
    const undated = values.undatedRows === "inherit" || values.undatedRows === "leave-out" ? values.undatedRows : "report";
    const lines = strExtractPayoutLines(report.rows, { headerRow: rc.headerRow, columns: rc.columns, effects, dateOrder }, { undatedRows: undated });
    const deposits = strExtractBankDeposits(bank.rows, { headerRow: bc.headerRow, columns: bc.columns, depositsAreNegative: values.bankMoneyIn === "negative", dateOrder }, text(values.bankDescriptionContains) ?? "");
    const groupBy = values.groupBy === "payout-id" ? "payoutId" : values.groupBy === "payout-date" ? "date" : "auto";
    const r = reconcileStrPayouts({
      lines: lines.lines,
      effects,
      deposits: deposits.deposits,
      ...windowDays !== void 0 ? { windowDays } : {},
      groupBy,
      lineProblems: lines.problems,
      bankProblems: deposits.problems,
      lineAssumptions: lines.assumptions
    });
    const t = strReconcileTables(r);
    const p = r.totals.payouts;
    const dp = r.totals.deposits;
    const ties = r.lines.filter((l) => l.ties).length;
    const notes = [
      lines.ignoredRows ? `${lines.ignoredRows} report row(s) with no date were left out: notes with no amount, or totals rows whose amounts equal the column totals of the rows above them.` : "",
      deposits.otherRows ? `${deposits.otherRows} bank row(s) were not money coming in and were left out.` : "",
      deposits.filteredOut ? `${deposits.filteredOut} bank deposit(s) were left out by the description filter.` : ""
    ].filter(Boolean);
    return {
      summary: [
        `${r.lines.length} report row(s) read; ${r.componentsMapped ? `${ties} of them tie` : "only the payout amount is mapped, so the rows were not tied"}. Grouped by ${r.groupedBy === "payoutId" ? "payout id" : "payout date"} there are ${p.all.count} payout(s) totaling ${formatUSD(p.all.sum)}, matched within ${r.windowDays} day(s).`,
        `Payouts: ${bucketText(p.matched)} matched + ${bucketText(p.ambiguous)} ambiguous + ${bucketText(p.unmatched)} unmatched = ${bucketText(p.all)}.`,
        `Deposits: ${bucketText(dp.matched)} matched + ${bucketText(dp.ambiguous)} ambiguous + ${bucketText(dp.unmatched)} unmatched = ${bucketText(dp.all)}.`,
        ...notes
      ].join(" "),
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Matched", rows: t.matched },
        { name: "Ambiguous", rows: t.ambiguous },
        { name: "Payouts without deposit", rows: t.unmatchedPayouts },
        { name: "Deposits without payout", rows: t.unmatchedDeposits },
        { name: "Report rows", rows: t.rows }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: four made-up reservations in three payouts against four bank deposits",
      args: { payoutReport: "fixture:str-payout-report.csv", bankStatement: "fixture:str-bank.csv" },
      verified: true,
      contains: [
        "4 report row(s) read; 4 of them tie",
        "there are 3 payout(s) totaling $2,048.90",
        "Payouts: 1 ($1,133.50) matched + 1 ($341.00) ambiguous + 1 ($574.40) unmatched = 3 ($2,048.90).",
        "Deposits: 1 ($1,133.50) matched + 2 ($682.00) ambiguous + 1 ($900.00) unmatched = 4 ($2,715.50).",
        "| 2026-03-02 | 2026-03-02 | TST-AA101 TST-AA102 | 1133.50 | 2026-03-04 |"
      ]
    },
    {
      label: "A report row whose payout does not equal its parts is not verified",
      args: {
        payoutReport: "Confirmation code,Payout date,Gross earnings,Host service fee,Cleaning fee,Payout amount\nTST-AA101,2026-03-02,600.00,18.00,80.00,672.00\n",
        bankStatement: "Date,Description,Amount\n03/04/2026,ACH DEPOSIT EXAMPLE STAYS PAYOUT,672.00\n"
      },
      verified: false,
      failedCheck: "rows-tie"
    }
  ]
};
function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
function listText(items) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function templateResult(sheets, fileBase, property, firstSheet, filled) {
  const bytes = writeXlsx(sheets);
  const checks = verifyTemplateWorkbook(sheets, bytes);
  const suggestedName = `${[fileBase, slug(property)].filter(Boolean).join("-")}.xlsx`;
  const shown = filled.filter((f) => f.trim() !== "");
  return {
    summary: `A workbook of ${sheets.length} sheets (${sheets.map((s) => s.name).join(", ")}), values only, read back and checked before it is handed over.${shown.length ? ` The ${firstSheet} sheet arrives with ${listText(shown)} already filled in.` : ""}`,
    tables: [{ name: "Workbook", rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), s.rows.length - 1])] }],
    checks,
    file: { suggestedName, bytes }
  };
}
function buildSheets(build) {
  try {
    return build();
  } catch (err) {
    throw new AgentInputError(err instanceof Error ? err.message : "The workbook could not be built from these answers.");
  }
}
var camTemplate = {
  name: "cam_reconciliation_template_workbook",
  page: `${SECTION}/cam-reconciliation-template`,
  section: SECTION,
  kind: "template",
  title: "CAM reconciliation template workbook (Excel) to fill in",
  description: "Builds a blank Excel workbook for a year-end CAM reconciliation, sized to the property: a Property sheet (name and period filled in), an Expenses sheet with numbered rows (expense category, amount, recoverable Yes or No), a Tenants sheet with one row per tenant (square feet, fixed share percent, estimates paid) and an Instructions sheet. The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants a CAM reconciliation spreadsheet or layout to fill in for a commercial property. Not a calculator: the workbook does not split anything.",
  question: "Can you make me a blank Excel workbook for a CAM reconciliation with 6 tenants and 10 expense rows?",
  inputs: [
    { name: "tenantCount", kind: "number", label: "Number of tenants", description: "Optional. How many tenant rows the Tenants sheet starts with, a whole number from 1 to 500. Without it, 5.", required: false },
    { name: "expenseRows", kind: "number", label: "Number of expense rows", description: "Optional. How many rows the Expenses sheet starts with, a whole number from 1 to 500. Without it, 12.", required: false },
    { name: "property", kind: "text", label: "Property name", description: "Optional. Filled in on the Property sheet and used in the file name.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. Filled in on the Property sheet, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. Filled in on the Property sheet, YYYY-MM-DD; not before the start.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.",
  run({ values }) {
    const property = text(values.property) ?? "";
    const periodStart = text(values.periodStart) ?? "";
    const periodEnd = text(values.periodEnd) ?? "";
    const tenantCount = countValue(values.tenantCount, "The number of tenants", 5);
    const expenseRows = countValue(values.expenseRows, "The number of expense rows", 12);
    const sheets = buildSheets(() => camTemplateSheets({ property, periodStart, periodEnd, tenantCount, expenseRows }));
    return templateResult(sheets, "cam-reconciliation-template", property, "Property", [property, periodStart, periodEnd]);
  },
  examples: [
    {
      label: "The page's worked example: Example Plaza, 6 tenants, 10 expense rows, 2025",
      args: { property: "Example Plaza", tenantCount: "6", expenseRows: "10", periodStart: "2025-01-01", periodEnd: "2025-12-31" },
      verified: true,
      contains: [
        "| Property | Item, Value | 5 |",
        "| Expenses | Line, Expense category, Amount, Recoverable (Yes or No) | 10 |",
        "| Tenants | Line, Tenant, Square feet, Fixed share percent (optional), Estimates paid | 6 |",
        "| Instructions | How this workbook is laid out | 7 |",
        "The Property sheet arrives with Example Plaza, 2025-01-01, and 2025-12-31 already filled in.",
        "cam-reconciliation-template-example-plaza.xlsx"
      ]
    }
  ]
};
var ownerTemplate = {
  name: "owner_statement_template_workbook",
  page: `${SECTION}/owner-statement-template`,
  section: SECTION,
  kind: "template",
  title: "Owner statement template workbook (Excel) with a ledger sheet",
  description: "Builds a blank Excel workbook for a monthly rental owner statement: a Statement sheet (owner, property and period filled in, the totals left to fill), a Ledger sheet with Date, Description, Amount and Type columns and as many rows as asked, and an Instructions sheet. Type is one of Income, Expense or Distribution (money paid to the owner). The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants an owner statement spreadsheet or a ledger layout to fill in for a managed rental. Not a calculator: the workbook does not add anything up.",
  question: "Can you give me a blank owner statement spreadsheet with a ledger sheet for January?",
  inputs: [
    { name: "ledgerRows", kind: "number", label: "Number of ledger rows", description: "Optional. How many rows the Ledger sheet starts with, a whole number from 1 to 500. Without it, 30.", required: false },
    { name: "owner", kind: "text", label: "Owner name", description: "Optional. Filled in on the Statement sheet.", required: false },
    { name: "property", kind: "text", label: "Property name", description: "Optional. Filled in on the Statement sheet and used in the file name.", required: false },
    { name: "periodStart", kind: "date", label: "Period start", description: "Optional. Filled in on the Statement sheet, YYYY-MM-DD.", required: false },
    { name: "periodEnd", kind: "date", label: "Period end", description: "Optional. Filled in on the Statement sheet, YYYY-MM-DD; not before the start.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.",
  run({ values }) {
    const owner = text(values.owner) ?? "";
    const property = text(values.property) ?? "";
    const periodStart = text(values.periodStart) ?? "";
    const periodEnd = text(values.periodEnd) ?? "";
    const ledgerRows = countValue(values.ledgerRows, "The number of ledger rows", 30);
    const sheets = buildSheets(() => ownerStatementTemplateSheets({ owner, property, periodStart, periodEnd, ledgerRows }));
    return templateResult(sheets, "owner-statement-template", property, "Statement", [owner, property, periodStart, periodEnd]);
  },
  examples: [
    {
      label: "The page's worked example: Example Owner LLC, 12 Example St, 25 ledger rows, January 2026",
      args: { owner: "Example Owner LLC", property: "12 Example St", ledgerRows: "25", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
      verified: true,
      contains: [
        "| Statement | Item, Value | 12 |",
        "| Ledger | Date, Description, Amount, Type | 25 |",
        "| Instructions | How this workbook is laid out | 7 |",
        "The Statement sheet arrives with Example Owner LLC, 12 Example St, 2026-01-01, and 2026-01-31 already filled in.",
        "owner-statement-template-12-example-st.xlsx"
      ]
    }
  ]
};
var PROPERTY_MANAGEMENT = [camReconciliation, camGrossUp, expenseStop, ownerStatements, securityDeposit, strPayouts, camTemplate, ownerTemplate];
var PROPERTY_MANAGEMENT_NOT_FOR_AGENTS = [];

export {
  TENANT_COLUMNS,
  PROPERTY_MANAGEMENT,
  PROPERTY_MANAGEMENT_NOT_FOR_AGENTS
};
