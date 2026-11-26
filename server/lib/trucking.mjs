// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  verifyTemplateWorkbook
} from "./templates.mjs";
import {
  SITE_URL
} from "./present.mjs";
import {
  readXlsx,
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
  scaledFormat,
  scaledParseNumber,
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  pmCellToCents,
  pmCellToIsoDate
} from "./reconcile.mjs";
import {
  CheckList,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/trucking/fuelTaxCheck.ts
function trkIsRounded(value, n, d, step) {
  if (d <= 0n || step <= 0n || value % step !== 0n) return false;
  const scaled2 = value * d;
  const gap = scaled2 > n ? scaled2 - n : n - scaled2;
  if (2n * gap !== step * d) return 2n * gap < step * d;
  return (scaled2 < 0n ? -scaled2 : scaled2) > (n < 0n ? -n : n);
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

// packages/core/src/trucking/costPerMileCheck.ts
var SCALE = 10000n;
var abs = (v) => v < 0n ? -v : v;
function grouped(digits) {
  let rest = digits;
  let out = "";
  while (rest.length > 3) {
    out = `,${rest.slice(-3)}${out}`;
    rest = rest.slice(0, -3);
  }
  return `${rest}${out}`;
}
function plain(value, places, trim = false) {
  const text = scaledFormat(value, places, trim);
  const dot = text.indexOf(".");
  return dot < 0 ? grouped(text) : `${grouped(text.slice(0, dot))}${text.slice(dot)}`;
}
var dollars = (cents) => `${cents < 0n ? "-" : ""}$${plain(abs(cents), 2)}`;
var perMileText = (k) => `${k < 0n ? "-" : ""}$${plain(abs(k), 3)}`;
var milesText = (k) => `${k < 0n ? "-" : ""}${plain(abs(k), 3, true)}`;
function trkVerifyCostPerMile(input, result) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const optional = (n) => n === null || n === void 0 ? null : B(n);
  const miles = B(input.milesK);
  const typed = input.lines.map((l) => ({ label: l.label, group: String(l.group), amount: B(l.amount) }));
  const revenue = optional(input.revenue);
  let fixed = 0n;
  let variable = 0n;
  for (const l of typed) {
    if (l.group === "fixed") fixed += l.amount;
    if (l.group === "variable") variable += l.amount;
  }
  let all = 0n;
  for (let i = typed.length - 1; i >= 0; i--) all += typed[i].amount;
  const lines = result.lines.map((l) => ({ label: l.label, group: String(l.group), amount: B(l.amount), perMile: B(l.perMileK) }));
  const shown = {
    miles: B(result.milesK),
    fixed: B(result.fixedCents),
    variable: B(result.variableCents),
    total: B(result.totalCents),
    fixedPerMile: B(result.fixedPerMileK),
    variablePerMile: B(result.variablePerMileK),
    totalPerMile: B(result.totalPerMileK),
    revenue: optional(result.revenue),
    revenuePerMile: optional(result.revenuePerMileK),
    net: optional(result.netCents),
    netPerMile: optional(result.netPerMileK)
  };
  const rounded = (figure, cents) => trkIsRounded(figure, cents * SCALE, miles, 1n);
  checks.that("trk-cpm-whole-numbers", "Every figure typed and every figure on the result is a whole number in its unit", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const sameMiles = shown.miles === miles;
  const samePeriod = result.period === input.period;
  checks.that(
    "trk-cpm-typed",
    "The period and the miles on the result are the ones typed",
    sameMiles && samePeriod,
    [sameMiles ? "" : `${milesText(miles)} miles typed, ${milesText(shown.miles)} on the result`, samePeriod ? "" : "the period on the result is not the one typed"].filter(Boolean).join("; ")
  );
  const key = (l) => JSON.stringify([l.label, l.group, l.amount.toString()]);
  const describe = (l) => `${l.label} (${l.group}, ${dollars(l.amount)})`;
  const waiting = /* @__PURE__ */ new Map();
  for (const l of typed) waiting.set(key(l), (waiting.get(key(l)) ?? 0) + 1);
  const notTyped = [];
  for (const l of lines) {
    const left = waiting.get(key(l)) ?? 0;
    if (left > 0) waiting.set(key(l), left - 1);
    else notTyped.push(describe(l));
  }
  const missing = [];
  for (const l of typed) {
    const left = waiting.get(key(l)) ?? 0;
    if (left > 0) {
      missing.push(describe(l));
      waiting.set(key(l), left - 1);
    }
  }
  checks.that(
    "trk-cpm-lines",
    "Every cost typed is on the result exactly once, with the amount typed and marked fixed or variable as typed",
    missing.length === 0 && notTyped.length === 0,
    [missing.length ? `typed but not on the result: ${missing.join("; ")}` : "", notTyped.length ? `on the result but not typed: ${notTyped.join("; ")}` : ""].filter(Boolean).join(". ")
  );
  const sumProblems = [
    shown.fixed === fixed ? "" : `the fixed lines typed add up to ${dollars(fixed)}, the result shows ${dollars(shown.fixed)}`,
    shown.variable === variable ? "" : `the variable lines typed add up to ${dollars(variable)}, the result shows ${dollars(shown.variable)}`,
    shown.total === all ? "" : `every line typed adds up to ${dollars(all)}, the result shows a total cost of ${dollars(shown.total)}`,
    fixed + variable === all ? "" : "a line typed is marked neither fixed nor variable",
    shown.fixed + shown.variable === shown.total ? "" : `the two subtotals shown add up to ${dollars(shown.fixed + shown.variable)}, the total cost shown is ${dollars(shown.total)}`
  ].filter(Boolean);
  checks.that(
    "trk-cpm-subtotals",
    "Fixed costs add up to the fixed subtotal, variable costs to the variable subtotal, and the two subtotals to total cost, with the dollars added a second time in a separate pass",
    sumProblems.length === 0,
    sumProblems.join("; ")
  );
  const badLines = lines.filter((l) => !rounded(l.perMile, l.amount)).map((l) => `${l.label} (${perMileText(l.perMile)} shown for ${dollars(l.amount)})`);
  checks.that("trk-cpm-line-per-mile", "The cost per mile of each line is its own amount divided by the miles typed, rounded to a tenth of a cent", badLines.length === 0, `over ${milesText(miles)} miles: ${badLines.join("; ")}`);
  const groups = [
    ["fixed", shown.fixedPerMile, fixed],
    ["variable", shown.variablePerMile, variable],
    ["total", shown.totalPerMile, all]
  ];
  const badGroups = groups.filter(([, figure, cents]) => !rounded(figure, cents)).map(([name, figure, cents]) => `${name} (${perMileText(figure)} shown for ${dollars(cents)})`);
  checks.that(
    "trk-cpm-group-per-mile",
    "Fixed, variable, and total cost per mile are each their own dollars divided by the miles typed, rounded to a tenth of a cent; none is made by adding up rounded lines",
    badGroups.length === 0,
    `over ${milesText(miles)} miles: ${badGroups.join("; ")}`
  );
  const lineSum = lines.reduce((n, l) => n + l.perMile, 0n);
  const count = BigInt(typed.length);
  const gap = lineSum * miles - all * SCALE;
  const allowed = `$${plain(count * 5n, 4)}`;
  checks.that(
    "trk-cpm-line-sum",
    `Each line is rounded on its own, so the lines added up (${perMileText(lineSum)} per mile) need not equal total cost divided by miles (${perMileText(shown.totalPerMile)} when rounded). They are within half of a tenth of a cent per line (${allowed} for ${typed.length} ${typed.length === 1 ? "line" : "lines"}) of it before rounding`,
    miles > 0n && 2n * abs(gap) <= count * miles,
    "the lines added up are further from total cost divided by miles than rounding can explain"
  );
  if (revenue === null) {
    checks.that("trk-cpm-no-revenue", "No revenue was typed, so no revenue per mile and nothing left after costs is shown", shown.revenue === null && shown.revenuePerMile === null && shown.net === null && shown.netPerMile === null);
  } else {
    const net = revenue - all;
    checks.add({
      id: "trk-cpm-net",
      label: "What is left after costs is the revenue typed minus total cost",
      passed: shown.revenue === revenue && shown.net === net,
      severity: "error",
      expected: dollars(net),
      actual: shown.net === null ? "not shown" : dollars(shown.net),
      ...shown.revenue === revenue ? {} : { detail: `revenue typed ${dollars(revenue)}, revenue on the result ${shown.revenue === null ? "not shown" : dollars(shown.revenue)}` }
    });
    const what = (figure, cents) => `${figure === null ? "nothing" : perMileText(figure)} shown for ${dollars(cents)} over ${milesText(miles)} miles`;
    checks.that("trk-cpm-revenue-per-mile", "Revenue per mile is the revenue typed divided by the miles typed, rounded to a tenth of a cent", shown.revenuePerMile !== null && rounded(shown.revenuePerMile, revenue), what(shown.revenuePerMile, revenue));
    checks.that(
      "trk-cpm-net-per-mile",
      "What is left per mile is revenue minus total cost, divided by the miles typed and rounded to a tenth of a cent; it is not one rounded figure taken from another",
      shown.netPerMile !== null && rounded(shown.netPerMile, net),
      what(shown.netPerMile, net)
    );
  }
  const zero = typed.filter((l) => l.amount === 0n).map((l) => l.label);
  checks.that("trk-cpm-zero-lines", "Every line has an amount above zero", zero.length === 0, `Zero amount: ${zero.join(", ")}`, "warning");
  if (revenue !== null) {
    checks.that("trk-cpm-costs-above-revenue", "Total cost is not more than revenue for the period", all <= revenue, `Costs are more than revenue for the period: total cost ${dollars(all)}, revenue ${dollars(revenue)}`, "warning");
  }
  return checks.all;
}

// packages/core/src/trucking/fuelTax.ts
function trkRoundDiv(n, d) {
  if (d <= 0n) throw new Error("Division by zero or a negative number.");
  const abs2 = n < 0n ? -n : n;
  const q = abs2 / d + (2n * (abs2 % d) >= d ? 1n : 0n);
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

// packages/core/src/trucking/costPerMile.ts
var PER_MILE_SCALE = 10000n;
function trkBuildCostPerMile(input) {
  if (input.lines.length === 0) throw new Error("Type at least one cost and its amount.");
  for (const l of input.lines) {
    if (typeof l.label !== "string" || l.label.trim() === "") throw new Error(Number.isSafeInteger(l.amount) ? `A cost of ${formatUSD(l.amount)} has no name.` : "A cost with an amount has no name.");
    if (!Number.isSafeInteger(l.amount)) throw new Error(`The amount for "${l.label}" must be dollars and whole cents.`);
    if (l.group !== "fixed" && l.group !== "variable") throw new Error(`"${l.label}" is not marked fixed or variable.`);
    if (l.amount < 0) throw new Error(`The amount for "${l.label}" is below zero. Amounts are zero or more: a credit is typed by taking it off the cost it belongs to.`);
  }
  if (!Number.isSafeInteger(input.milesK)) throw new Error("Miles must be a number with up to 3 decimal places.");
  if (input.milesK <= 0) throw new Error("Miles must be more than zero.");
  const revenue = input.revenue ?? null;
  if (revenue !== null && !Number.isSafeInteger(revenue)) throw new Error("Revenue must be dollars and whole cents.");
  if (revenue !== null && revenue < 0) throw new Error("Revenue must be zero or more.");
  const miles = BigInt(input.milesK);
  const perMile = (cents, what) => trkSafe(trkRoundDiv(cents * PER_MILE_SCALE, miles), what);
  let fixed = 0n;
  let variable = 0n;
  for (const l of input.lines) {
    if (l.group === "fixed") fixed += BigInt(l.amount);
    else variable += BigInt(l.amount);
  }
  const total = fixed + variable;
  const totalCents = trkSafe(total, "total cost");
  const net = revenue === null ? null : BigInt(revenue) - total;
  return {
    period: input.period,
    milesK: input.milesK,
    lines: input.lines.map((l) => ({ label: l.label, group: l.group, amount: l.amount, perMileK: perMile(BigInt(l.amount), `cost per mile for "${l.label}"`) })),
    fixedCents: trkSafe(fixed, "fixed subtotal"),
    variableCents: trkSafe(variable, "variable subtotal"),
    totalCents,
    fixedPerMileK: perMile(fixed, "fixed cost per mile"),
    variablePerMileK: perMile(variable, "variable cost per mile"),
    totalPerMileK: perMile(total, "total cost per mile"),
    revenue,
    revenuePerMileK: revenue === null ? null : perMile(BigInt(revenue), "revenue per mile"),
    netCents: net === null ? null : trkSafe(net, "amount left after costs"),
    netPerMileK: net === null ? null : perMile(net, "amount left per mile after costs")
  };
}
function trkCostPerMile(input) {
  const figures = trkBuildCostPerMile(input);
  return { ...figures, checks: trkVerifyCostPerMile(input, figures) };
}
var thousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function trkPerMileText(perMileK) {
  const [whole, decimals] = scaledFormat(perMileK < 0 ? -perMileK : perMileK, 3).split(".");
  return `${perMileK < 0 ? "-" : ""}$${thousands(whole)}.${decimals}`;
}
function milesText2(milesK) {
  const [whole, decimals] = scaledFormat(milesK, 3, true).split(".");
  return decimals === void 0 ? thousands(whole) : `${thousands(whole)}.${decimals}`;
}
function trkCostPerMileTable(r, style = "plain") {
  const amount = (cents) => style === "display" ? formatUSD(cents) : toDecimal(cents);
  const perMile = (k) => style === "display" ? trkPerMileText(k) : scaledFormat(k, 3);
  const lines = (group) => r.lines.filter((l) => l.group === group).map((l) => [l.label, group === "fixed" ? "Fixed" : "Variable", amount(l.amount), perMile(l.perMileK)]);
  const table = [
    ["Cost", "Fixed or variable", "Amount", "Per mile"],
    ...lines("fixed"),
    ["Fixed costs", "", amount(r.fixedCents), perMile(r.fixedPerMileK)],
    ...lines("variable"),
    ["Variable costs", "", amount(r.variableCents), perMile(r.variablePerMileK)],
    ["Total cost", "", amount(r.totalCents), perMile(r.totalPerMileK)]
  ];
  if (r.revenue !== null && r.revenuePerMileK !== null && r.netCents !== null && r.netPerMileK !== null) {
    table.push(["Revenue", "", amount(r.revenue), perMile(r.revenuePerMileK)], ["Left after costs", "", amount(r.netCents), perMile(r.netPerMileK)]);
  }
  return table;
}
function trkCostPerMileSummary(r, style = "plain") {
  const perMile = (k) => style === "display" ? trkPerMileText(k) : scaledFormat(k, 3);
  const summary = [["Item", "Value"]];
  if (r.period.trim() !== "") summary.push(["Period", r.period.trim()]);
  summary.push(
    ["Miles driven", style === "display" ? milesText2(r.milesK) : scaledFormat(r.milesK, 3, true)],
    ["Fixed cost per mile", perMile(r.fixedPerMileK)],
    ["Variable cost per mile", perMile(r.variablePerMileK)],
    ["Total cost per mile", perMile(r.totalPerMileK)]
  );
  if (r.revenuePerMileK !== null && r.netPerMileK !== null) summary.push(["Revenue per mile", perMile(r.revenuePerMileK)], ["Left per mile after costs", perMile(r.netPerMileK)]);
  return summary;
}

// packages/core/src/trucking/fuelLedger.ts
var TRK_NO_UNIT = "(no unit)";
function trkBuildFuelLedger(input) {
  const rows = input.rows;
  if (rows.length === 0) throw new Error("There are no fuel rows.");
  for (const r of rows) {
    if (!Number.isSafeInteger(r.gallonsK)) throw new Error(`Gallons on row ${r.rowNumber} must be a whole number of thousandths.`);
    if (!Number.isSafeInteger(r.amount)) throw new Error(`Amount on row ${r.rowNumber} must be a whole number of cents.`);
  }
  const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const bucketOf = /* @__PURE__ */ new Map();
  const unassigned = [];
  for (const r of rows) {
    if (r.jurisdiction === "") {
      unassigned.push(r);
      continue;
    }
    const unit = r.unit === "" ? TRK_NO_UNIT : r.unit;
    const key = JSON.stringify([r.jurisdiction, unit]);
    const bucket = bucketOf.get(key) ?? { jurisdiction: r.jurisdiction, unit, count: 0, gallonsK: 0, amount: 0 };
    bucket.count += 1;
    bucket.gallonsK += r.gallonsK;
    bucket.amount += r.amount;
    bucketOf.set(key, bucket);
  }
  const buckets = [...bucketOf.values()].sort((a, b) => byText(a.jurisdiction, b.jurisdiction) || byText(a.unit, b.unit));
  const jurisdictionOf = /* @__PURE__ */ new Map();
  for (const b of buckets) {
    const j = jurisdictionOf.get(b.jurisdiction) ?? { jurisdiction: b.jurisdiction, count: 0, gallonsK: 0, amount: 0 };
    j.count += b.count;
    j.gallonsK += b.gallonsK;
    j.amount += b.amount;
    jurisdictionOf.set(b.jurisdiction, j);
  }
  const jurisdictions = [...jurisdictionOf.values()].sort((a, b) => byText(a.jurisdiction, b.jurisdiction));
  const totalCount = rows.length;
  const totalGallonsK = rows.reduce((n, r) => n + r.gallonsK, 0);
  const totalAmount = sum(rows.map((r) => r.amount));
  const looseGallonsK = unassigned.reduce((n, r) => n + r.gallonsK, 0);
  const looseAmount = sum(unassigned.map((r) => r.amount));
  const checks = new CheckList();
  const seen = /* @__PURE__ */ new Set();
  const repeated = /* @__PURE__ */ new Set();
  for (const r of rows) {
    if (seen.has(r.rowNumber)) repeated.add(r.rowNumber);
    seen.add(r.rowNumber);
  }
  const placed = buckets.reduce((n, b) => n + b.count, 0) + unassigned.length;
  checks.that(
    "trk-fl-rows-once",
    "Every row is in exactly one jurisdiction bucket or on the no-jurisdiction list",
    repeated.size === 0 && placed === rows.length,
    repeated.size > 0 ? `row(s) ${[...repeated].sort((a, b) => a - b).join(", ")}` : "counts do not add up"
  );
  let rowGallons = 0n;
  let rowAmount = 0n;
  for (const r of rows) {
    rowGallons += BigInt(r.gallonsK);
    rowAmount += BigInt(r.amount);
  }
  let bucketGallons = BigInt(looseGallonsK);
  let bucketAmount = BigInt(looseAmount);
  for (const b of buckets) {
    bucketGallons += BigInt(b.gallonsK);
    bucketAmount += BigInt(b.amount);
  }
  const jurisdictionsAgree = jurisdictions.every((j) => {
    const mine = buckets.filter((b) => b.jurisdiction === j.jurisdiction);
    return j.count === mine.reduce((n, b) => n + b.count, 0) && BigInt(j.gallonsK) === mine.reduce((n, b) => n + BigInt(b.gallonsK), 0n) && BigInt(j.amount) === mine.reduce((n, b) => n + BigInt(b.amount), 0n);
  });
  checks.that(
    "trk-fl-readd",
    "Buckets plus rows with no jurisdiction re-add to all rows, in gallons and dollars",
    rowGallons === bucketGallons && rowAmount === bucketAmount && jurisdictionsAgree,
    `gallons ${scaledFormat(rowGallons, 3)} vs ${scaledFormat(bucketGallons, 3)}, dollars ${formatUSD(Number(rowAmount))} vs ${formatUSD(Number(bucketAmount))}`
  );
  if (input.typedGallonsK !== void 0) {
    checks.equal("trk-fl-statement-gallons", "Gallons add up to the statement total you typed", scaledFormat(input.typedGallonsK, 3), scaledFormat(totalGallonsK, 3));
  }
  if (input.typedAmount !== void 0) {
    checks.cents("trk-fl-statement-amount", "Dollars add up to the statement total you typed", input.typedAmount, totalAmount);
  }
  if (input.typedGallonsK === void 0 && input.typedAmount === void 0) {
    checks.that("trk-fl-statement-missing", "The rows are tied to a statement total you typed", false, "no statement total was typed", "warning");
  }
  checks.that(
    "trk-fl-unassigned",
    "Every row names a jurisdiction",
    unassigned.length === 0,
    `${unassigned.length} row(s), ${scaledFormat(looseGallonsK, 3)} gallons, ${formatUSD(looseAmount)} are not in any jurisdiction`,
    "warning"
  );
  return { buckets, jurisdictions, unassigned, totalCount, totalGallonsK, totalAmount, checks: checks.all };
}
function trkLedgerTables(r) {
  const g = (k) => scaledFormat(k, 3);
  const looseGallons = r.unassigned.reduce((n, u) => n + u.gallonsK, 0);
  const looseAmount = sum(r.unassigned.map((u) => u.amount));
  return {
    jurisdictions: [
      ["Jurisdiction", "Rows", "Gallons", "Amount"],
      ...r.jurisdictions.map((j) => [j.jurisdiction, j.count, g(j.gallonsK), toDecimal(j.amount)]),
      ...r.unassigned.length ? [["(no jurisdiction)", r.unassigned.length, g(looseGallons), toDecimal(looseAmount)]] : [],
      ["Total", r.totalCount, g(r.totalGallonsK), toDecimal(r.totalAmount)]
    ],
    buckets: [["Jurisdiction", "Unit", "Rows", "Gallons", "Amount"], ...r.buckets.map((b) => [b.jurisdiction, b.unit, b.count, g(b.gallonsK), toDecimal(b.amount)])],
    unassigned: [["File row", "Date", "Location", "Unit", "Card or driver", "Gallons", "Amount"], ...r.unassigned.map((u) => [u.rowNumber, u.date, u.location, u.unit, u.card, g(u.gallonsK), toDecimal(u.amount)])]
  };
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
    const milesText3 = sheetCell(cells, c.miles);
    if (sheetIsTotalWord(jurisdiction)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!milesText3) {
      out.skipped.push({ rowNumber, reason: "no miles" });
      continue;
    }
    try {
      if (!jurisdiction) throw new Error("miles with no jurisdiction");
      const milesK = scaledParseNumber(milesText3, 3, "miles");
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
function trkFuelRate(row2, fuel) {
  return fuel === "diesel" ? row2.dieselTenThousandths : row2.gasolineTenThousandths;
}
function trkFuelSurchargeRate(row2, fuel) {
  if (!row2.surcharge) return null;
  return fuel === "diesel" ? row2.surcharge.dieselTenThousandths : row2.surcharge.gasolineTenThousandths;
}
function trkFindFuelRate(table, jurisdiction) {
  return table.rows.find((r) => r.jurisdiction === jurisdiction);
}
function trkFuelRateFeed(table, fuel) {
  const rates = [];
  for (const row2 of table.rows) {
    const rate = trkFuelRate(row2, fuel);
    if (rate !== null) rates.push({ jurisdiction: row2.jurisdiction, rateTenThousandths: rate });
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
  for (const row2 of table.rows) {
    const rate = fuel === "diesel" ? row2.dieselTenThousandths : row2.gasolineTenThousandths;
    if (rate === null || !Number.isSafeInteger(rate)) continue;
    base.set(row2.jurisdiction, BigInt(rate));
    const extra = row2.surcharge ? fuel === "diesel" ? row2.surcharge.dieselTenThousandths : row2.surcharge.gasolineTenThousandths : null;
    if (extra !== null && Number.isSafeInteger(extra) && extra > 0) withSurcharge.set(row2.jurisdiction, BigInt(rate) + BigInt(extra));
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
    const row2 = trkFindFuelRate(table, r.jurisdiction);
    const want = row2 ? trkFuelRate(row2, fuel) : null;
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
    const row2 = trkFindFuelRate(table, code);
    const extra = row2 ? trkFuelSurchargeRate(row2, fuel) : null;
    if (row2 && extra !== null && extra > 0) hits.push(`${code} ${scaledFormat(extra, 4)} per gallon (${row2.surcharge.citation})`);
  }
  return {
    id: "trk-fr-surcharge",
    label: `No jurisdiction here has a surcharge in the dated table for ${table.label}`,
    passed: hits.length === 0,
    severity: "warning",
    ...hits.length ? { detail: `not computed here, see the table: ${hits.join("; ")}` } : {}
  };
}

// packages/core/src/trucking/fuelRates2026q3.ts
var QUARTER = "2026-Q3";
var OWN_CHECKED = "2026-10-14";
var CHECKED = "2026-10-19";
function row(jurisdiction, dieselTenThousandths, citation, sourceUrl, note = "") {
  return { jurisdiction, quarter: QUARTER, dieselTenThousandths, gasolineTenThousandths: null, surcharge: null, note, citation, sourceUrl, checkedOn: OWN_CHECKED, ownAgency: true };
}
var NY_TABLE = {
  citation: "New York State Department of Taxation and Finance, IFTA-105 (3rd Quarter 2026, July 1 - September 30)",
  sourceUrl: "https://www.tax.ny.gov/forms/html-instructions/2026/motor/ifta105-926.htm",
  checkedOn: CHECKED
};
function ny(jurisdiction, dieselTenThousandths, note = "", surchargeTenThousandths = null) {
  return {
    jurisdiction,
    quarter: QUARTER,
    dieselTenThousandths,
    gasolineTenThousandths: null,
    surcharge: surchargeTenThousandths === null ? null : { dieselTenThousandths: surchargeTenThousandths, gasolineTenThousandths: null, ...NY_TABLE, citation: `${NY_TABLE.citation}, the surcharge line` },
    note,
    ...NY_TABLE,
    ownAgency: false
  };
}
var ROWS_UNSORTED = [
  row(
    "CA",
    9790,
    "California Department of Tax and Fee Administration, Special Notice L-1031 (June 2026): Rates Effective July 1, 2026, Through June 30, 2027",
    "https://cdtfa.ca.gov/formspubs/L1031.pdf",
    "Diesel fuel tax 48.2 cents plus excise tax 49.7 cents per gallon."
  ),
  row("CO", 3350, "Colorado Department of Revenue, IFTA 3rd Quarter 2026 Tax Table", "https://tax.colorado.gov/ifta-3rd-quarter-fuel-tax-rates-2026", "The table’s special fuel column."),
  row(
    "IL",
    7380,
    "Illinois Department of Revenue, Informational Bulletin FY 2026-24-A: Revised Motor Fuel Use Tax Rates Effective July 1, 2026, through December 31, 2026",
    "https://tax.illinois.gov/research/publications/bulletins/fy-2026-24.html",
    "Part A 55.8 cents plus Part B 18.0 cents per gallon."
  ),
  row("IN", 6300, "Indiana Department of Revenue, Motor Carrier Services, Fuel Tax (IFTA/MCFT): Special Fuel tax rate from July 1, 2026 to June 30, 2027", "https://www.in.gov/dor/motor-carrier-services/fuel-tax/"),
  row("KS", 2600, "Kansas Department of Revenue, Form 85A: Third Quarter-2026 Kansas Schedule 1, IFTA Fuel Tax Computation, Diesel (tax period Jul 1, 2026 to Sep 30, 2026)", "https://www.ksrevenue.gov/pdf/die326.pdf"),
  row(
    "MI",
    5240,
    "Michigan Department of Treasury, Notice Concerning Inflation Adjusted Fuel Tax Rate and Applicable to IFTA Motor Carriers That Will Take Effect on January 1, 2026 (January 1 through December 31, 2026)",
    "https://www.michigan.gov/treasury/reference/taxpayer-notices/2025/11/25/notice-concerning-inflation-adjusted-fuel-tax-rate-and-applicable-to-ifta-motor-carriers",
    "The notice gives 52.4 cents per gallon on motor fuel for 2026; the department’s rate page lists diesel fuel at the same $.524."
  ),
  row(
    "NC",
    4100,
    "North Carolina Department of Revenue, GAS-1278: IFTA Fuel Tax Rates for 3rd Quarter 2026 Returns",
    "https://www.ncdor.gov/gas-1278-3rd-quarter-9-29-26/open"
  ),
  row(
    "NE",
    3180,
    "Nebraska Department of Motor Vehicles, IFTA Newsletter, 3rd Quarter 2026: IFTA Fuel Tax Reporting Rates, Third Quarter 2026",
    "https://dmv.nebraska.gov/sites/default/files/doc/mc/newsletters/IFTA%20newsletter%203rd%20quarter%202026%20ADA%20Accessible.pdf",
    "The same newsletter reports an executive order of September 24, 2026 exempting some agricultural and livestock hauling within Nebraska from diesel tax; see the source."
  ),
  row("NY", 3805, "New York State Department of Taxation and Finance, IFTA-105 (3rd Quarter 2026, July 1 - September 30)", "https://www.tax.ny.gov/forms/html-instructions/2026/motor/ifta105-926.htm"),
  row(
    "PA",
    7410,
    "Pennsylvania Department of Revenue, IFTA-400 MF AFP: Third Quarter 2026 Fuel Tax Rates (MCRT/IFTA)",
    "https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/maft/mcrt-ifta/documents/2026_ifta-400_quarter3.pdf",
    "The table’s diesel and kerosene column."
  ),
  row(
    "WI",
    3290,
    "Wisconsin Department of Transportation, MV2754 (9/2026), Word file: IFTA Tax Rates for 3rd Quarter 2026",
    "https://wisconsindot.gov/Documents/formdocs/mv2754-3q2026.docx",
    "Linked from the department’s IFTA page as “3rd quarter 2026, Instructions and tax rates”."
  ),
  // Read from New York's IFTA-105 for the quarter on October 19, 2026.
  ny("AL", 3100),
  ny("AZ", 2600),
  ny("AR", 2850),
  ny("CT", 4990),
  ny("DE", 2200),
  ny("FL", 4097),
  ny(
    "GA",
    3730,
    "Georgia suspended collection of its motor fuel excise tax, clear diesel included, from 12:01 a.m. on September 29, 2026 (Department of Revenue Informational Bulletin MFT-2026-03). For its earlier 2026 suspension, its IFTA filing guidance had Georgia miles in the suspension period reported as non-taxable. The rate here does not reflect the suspension; see the department’s notices."
  ),
  ny("ID", 3200),
  ny("IA", 3250),
  ny("KY", 2200, "Kentucky’s surcharge (surtax) line is in its own column; it is not part of the base rate.", 1050),
  ny("LA", 2e3),
  ny("ME", 3120),
  ny("MD", 4745),
  ny("MA", 2400),
  ny("MN", 3260),
  ny("MS", 2400),
  ny("MO", 2950),
  ny("MT", 2975),
  ny("NV", 2700),
  ny("NH", 2220),
  ny("NJ", 5610),
  ny("NM", 2100),
  ny("ND", 2300),
  ny("OH", 4700),
  ny("OK", 1900),
  ny("RI", 4e3),
  ny("SC", 2800),
  ny("SD", 2800),
  ny("TN", 2700),
  ny("TX", 2e3),
  ny("UT", 3790),
  ny("VT", 3100),
  ny("VA", 3360, "Virginia’s surcharge line is in its own column; it is not part of the base rate.", 1430),
  ny("WA", 5950),
  ny("WV", 3570),
  ny("WY", 2400),
  ...[
    ["AB", 3519, "Alberta", "0.1300"],
    ["BC", 4060, "British Columbia", "0.1500"],
    ["MB", 3383, "Manitoba", "0.1250"],
    ["NB", 4182, "New Brunswick", "0.1545"],
    ["NL", 2572, "Newfoundland and Labrador", "0.0950"],
    ["NS", 4168, "Nova Scotia", "0.1540"],
    ["ON", 2436, "Ontario", "0.0900"],
    ["PE", 3830, "Prince Edward Island", "0.1415"],
    ["QC", 5468, "Quebec", "0.2020"],
    ["SK", 4060, "Saskatchewan", "0.1500"]
  ].map(
    ([code, rate, name, litre]) => ny(code, rate, `${name} sets its rate per litre in Canadian dollars. New York’s table prints it as C$${litre} per litre and as this figure in US dollars per US gallon for the quarter, at the exchange rate the quarter’s tables print (US$1 = C$1.3984).`)
  )
];
var ROWS = [...ROWS_UNSORTED].sort((a, b) => a.jurisdiction < b.jurisdiction ? -1 : a.jurisdiction > b.jurisdiction ? 1 : 0);
var GAPS = [
  {
    jurisdiction: "OR",
    reason: "The quarter’s rate tables print no diesel rate for Oregon (New York’s shows N/A, Pennsylvania’s 0.0000, North Carolina’s a dash), and Oregon’s own table lists every other jurisdiction and not itself."
  }
];
var CROSS_CHECKS = [
  {
    name: "Pennsylvania’s IFTA-400",
    citation: "Pennsylvania Department of Revenue, IFTA-400 MF AFP (9/30/2026): Third Quarter 2026 Fuel Tax Rates (MCRT/IFTA), the diesel/kerosene column",
    sourceUrl: "https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/maft/mcrt-ifta/documents/2026_ifta-400_quarter3.pdf",
    checkedOn: CHECKED,
    diesel: {
      AL: 3100,
      AZ: 2600,
      AR: 2850,
      CA: 9790,
      CO: 3350,
      CT: 4990,
      DE: 2200,
      FL: 4097,
      GA: 3730,
      ID: 3200,
      IL: 7380,
      IN: 6300,
      IA: 3250,
      KS: 2600,
      KY: 2200,
      LA: 2e3,
      ME: 3120,
      MD: 4745,
      MA: 2400,
      MI: 5240,
      MN: 3260,
      MS: 2400,
      MO: 2950,
      MT: 2975,
      NE: 3180,
      NV: 2700,
      NH: 2220,
      NJ: 5610,
      NM: 2100,
      NY: 3805,
      NC: 4100,
      ND: 2300,
      OH: 4700,
      OK: 1900,
      PA: 7410,
      RI: 4e3,
      SC: 2800,
      SD: 2800,
      TN: 2700,
      TX: 2e3,
      UT: 3790,
      VT: 3100,
      VA: 3360,
      WA: 5950,
      WV: 3570,
      WI: 3290,
      WY: 2400,
      AB: 3519,
      BC: 4060,
      MB: 3383,
      NB: 4182,
      NL: 2572,
      NS: 4168,
      ON: 2436,
      PE: 3830,
      QC: 5468,
      SK: 4060
    },
    dieselSurcharge: { KY: 1050, VA: 1430 }
  },
  {
    name: "North Carolina’s GAS-1278",
    citation: "North Carolina Department of Revenue, GAS-1278 (Web, 9-26): IFTA Fuel Tax Rates for 3rd Quarter 2026 Returns, the diesel column",
    sourceUrl: "https://www.ncdor.gov/gas-1278-3rd-quarter-9-29-26/open",
    checkedOn: CHECKED,
    diesel: {
      AL: 3100,
      AZ: 2600,
      AR: 2850,
      CA: 9790,
      CO: 3350,
      CT: 4990,
      DE: 2200,
      FL: 4097,
      GA: 3730,
      ID: 3200,
      IL: 7380,
      IN: 6300,
      IA: 3250,
      KS: 2600,
      KY: 2200,
      LA: 2e3,
      ME: 3120,
      MD: 4745,
      MA: 2400,
      MI: 5240,
      MN: 3260,
      MS: 2400,
      MO: 2950,
      MT: 2975,
      NE: 3180,
      NV: 2700,
      NH: 2220,
      NJ: 5610,
      NM: 2100,
      NY: 3805,
      NC: 4100,
      ND: 2300,
      OH: 4700,
      OK: 1900,
      PA: 7410,
      RI: 4e3,
      SC: 2800,
      SD: 2800,
      TN: 2700,
      TX: 2e3,
      UT: 3790,
      VT: 3100,
      VA: 3360,
      WA: 5950,
      WV: 3570,
      WI: 3290,
      WY: 2400,
      AB: 3519,
      BC: 4060,
      MB: 3383,
      NB: 4182,
      NL: 2572,
      NS: 4168,
      ON: 2436,
      PE: 3830,
      QC: 5468,
      SK: 4060
    },
    dieselSurcharge: { KY: 1050, VA: 1430 }
  },
  {
    name: "Oregon’s 3rd Quarter 2026 table",
    citation: "Oregon Department of Transportation, 3rd Quarter 2026 FINAL Fuel Tax Rates (IFTA), the special diesel column",
    sourceUrl: "https://www.oregon.gov/odot/MCT/Fuel%20Tax%20Rates/3Q2026FuelRates.pdf",
    checkedOn: CHECKED,
    diesel: {
      AL: 3100,
      AZ: 2600,
      AR: 2850,
      CA: 9790,
      CO: 3350,
      CT: 4990,
      DE: 2200,
      FL: 4097,
      GA: 3730,
      ID: 3200,
      IL: 7380,
      IN: 6300,
      IA: 3250,
      KS: 2600,
      KY: 2200,
      LA: 2e3,
      ME: 3120,
      MD: 4745,
      MA: 2400,
      MI: 5240,
      MN: 3260,
      MS: 2400,
      MO: 2950,
      MT: 2975,
      NE: 3180,
      NV: 2700,
      NH: 2220,
      NJ: 5610,
      NM: 2100,
      NY: 3805,
      NC: 4100,
      ND: 2300,
      OH: 4700,
      OK: 1900,
      PA: 7410,
      RI: 4e3,
      SC: 2800,
      SD: 2800,
      TN: 2700,
      TX: 2e3,
      UT: 3790,
      VT: 3100,
      VA: 3360,
      WA: 5950,
      WV: 3570,
      WI: 3290,
      WY: 2400,
      AB: 3519,
      BC: 4060,
      MB: 3383,
      NB: 4182,
      NL: 2572,
      NS: 4168,
      ON: 2436,
      PE: 3830,
      QC: 5468,
      SK: 4060
    },
    dieselSurcharge: { KY: 1050, VA: 1430 }
  }
];
var TRK_FUEL_RATES_2026Q3 = {
  id: "2026q3",
  quarter: QUARTER,
  label: "the third quarter of 2026",
  firstDay: "2026-07-01",
  lastDay: "2026-09-30",
  checkedOn: CHECKED,
  rows: ROWS,
  notCovered: GAPS,
  crossChecks: CROSS_CHECKS
};

// packages/core/src/trucking/logTemplate.ts
var TRK_TEMPLATE_MAX_UNITS = 50;
var TRK_TEMPLATE_SHEETS = ["Miles", "Fuel", "Units", "Log", "Instructions"];
var TRK_TEMPLATE_MILES_HEADERS = ["Date", "Unit", "Jurisdiction", "Miles", "Trip or load", "Notes"];
var TRK_TEMPLATE_FUEL_HEADERS = ["Date", "Unit", "Jurisdiction", "Location", "Gallons", "Amount", "Card or driver", "Notes"];
var TRK_TEMPLATE_UNIT_HEADERS = ["Line", "Unit", "Notes"];
var TRK_TEMPLATE_MILES_COLUMNS = { jurisdiction: 2, miles: 3 };
var TRK_TEMPLATE_FUEL_COLUMNS = { date: 0, unit: 1, jurisdiction: 2, location: 3, gallons: 4, amount: 5, card: 6 };
function cleanCarrier(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The carrier name is longer than 120 characters.");
  return s;
}
function cleanYear(value) {
  const s = value.trim();
  if (s !== "" && !/^20\d{2}$/.test(s)) throw new Error("The year must be four digits, from 2000 to 2099.");
  return s;
}
function cleanQuarter(value) {
  const s = value.trim();
  if (s !== "" && !/^[1-4]$/.test(s)) throw new Error("The quarter must be 1, 2, 3, or 4.");
  return s;
}
function cleanCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > TRK_TEMPLATE_MAX_UNITS) throw new Error(`The number of units must be a whole number from 1 to ${TRK_TEMPLATE_MAX_UNITS}.`);
  return value;
}
function trkLogTemplateSheets(o) {
  const carrier = cleanCarrier(o.carrier);
  const year = cleanYear(o.year);
  const quarter = cleanQuarter(o.quarter);
  const units = cleanCount(o.unitCount);
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/trucking/${slug}/${site ? "?src=template" : ""}`;
  return [
    {
      name: TRK_TEMPLATE_SHEETS[0],
      rows: [[...TRK_TEMPLATE_MILES_HEADERS]],
      money: [],
      widths: [14, 10, 14, 12, 20, 40]
    },
    {
      name: TRK_TEMPLATE_SHEETS[1],
      rows: [[...TRK_TEMPLATE_FUEL_HEADERS]],
      money: ["Amount"],
      widths: [14, 10, 14, 28, 12, 14, 22, 40]
    },
    {
      name: TRK_TEMPLATE_SHEETS[2],
      rows: [[...TRK_TEMPLATE_UNIT_HEADERS], ...Array.from({ length: units }, (_, i) => [i + 1, "", ""])],
      money: [],
      widths: [8, 20, 40]
    },
    {
      name: TRK_TEMPLATE_SHEETS[3],
      rows: [
        ["Item", "Value"],
        ["Kept for", carrier],
        ["Year", year],
        ["Quarter", quarter],
        ["Date last updated", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: TRK_TEMPLATE_SHEETS[4],
      rows: [
        ["Sheet", "Column", "What it holds"],
        ["This workbook", "", "A layout to fill in with one quarter of miles and fuel purchases. It holds values only, with no formulas, so nothing in it adds up; the tools listed at the foot of this sheet do the adding."],
        ["Miles", "", "One row for the miles driven in one jurisdiction: by trip, by day, or for the whole quarter. Rows go under the header row, with no blank row between two entries and no total row. The tools add the rows of one jurisdiction together."],
        ["Miles", "Date", "The date of the miles, written like 2026-07-03. It can be left blank."],
        ["Miles", "Unit", "The truck or unit that drove the miles, as it is named on the Units sheet."],
        ["Miles", "Jurisdiction", "The state or province the miles were driven in, as a code such as TX. The tools compare the text itself, capitals aside, so TX and Texas count as two jurisdictions."],
        ["Miles", "Miles", "The miles as a plain number, with up to 3 decimal places."],
        ["Miles", "Trip or load", "The trip or load the miles belong to. It can be left blank."],
        ["Miles", "Notes", "Anything else about the row."],
        ["Fuel", "", "One row per fuel purchase, under the header row, with no blank row between two purchases and no total row."],
        ["Fuel", "Date", "The date of the purchase, written like 2026-07-03. The tools list a row that has gallons and no date as a row they could not read."],
        ["Fuel", "Unit", "The truck or unit that was fueled, as it is named on the Units sheet."],
        ["Fuel", "Jurisdiction", "The state or province the fuel was bought in, written the way it is on the Miles sheet. When it is blank, the tools take the two-letter code at the end of a Location written like Amarillo, TX."],
        ["Fuel", "Location", "The city or the station. It can be left blank."],
        ["Fuel", "Gallons", "The gallons bought as a plain number, with up to 3 decimal places. A reversal is a negative number."],
        ["Fuel", "Amount", "What the purchase cost, in dollars. It can be left blank."],
        ["Fuel", "Card or driver", "The card or the driver the purchase belongs to. It can be left blank."],
        ["Fuel", "Notes", "Anything else about the row."],
        ["Units", "", `One row per truck or unit; rows are numbered 1 to ${units}. Rows can be added under the last one.`],
        ["Log", "", "The carrier, the year and the quarter the workbook covers, and the date it was last updated."],
        [
          "Tools on the site",
          "Quarterly fuel tax worksheet",
          `${page("quarterly-fuel-tax-worksheet")} takes this one workbook in both of its boxes: it reads the Miles sheet in the first box and the Fuel sheet in the second, and works out miles per gallon, taxable gallons, and tax per jurisdiction at the rates typed there.`
        ],
        ["Tools on the site", "Fuel-card ledger", `${page("fuel-card-ledger")} opens this workbook, reads the Fuel sheet, and adds up gallons and dollars by jurisdiction and by unit.`],
        ["Tools on the site", "Miles per gallon by truck", `${page("miles-per-gallon-by-truck")} takes this one workbook in both of its boxes as well, reads the Miles sheet and the Fuel sheet, and works out miles per gallon for each unit.`]
      ],
      money: [],
      widths: [20, 30, 130]
    }
  ];
}
function trkVerifyLogTemplate(o, bytes) {
  const sheets = trkLogTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const log = rowsOf(TRK_TEMPLATE_SHEETS[3]);
  const cell = (label) => {
    const row2 = log.find((r) => r[0] === label);
    return row2 ? row2[1] ?? "" : "(no such row)";
  };
  checks.equal("carrier", "The Log sheet carries the carrier name as typed", cleanCarrier(o.carrier), cell("Kept for"));
  checks.equal("year", "The Log sheet carries the year as typed", cleanYear(o.year), cell("Year"));
  checks.equal("quarter", "The Log sheet carries the quarter as typed", cleanQuarter(o.quarter), cell("Quarter"));
  const units = rowsOf(TRK_TEMPLATE_SHEETS[2]).slice(1);
  checks.that(
    "unit-rows",
    `The Units sheet has ${o.unitCount} blank rows numbered 1 to ${o.unitCount}`,
    units.length === o.unitCount && units.every((r, i) => r[0] === String(i + 1) && r.slice(1).every((c) => c === ""))
  );
  const first = read.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  checks.equal("miles-first", "The Miles sheet is the first sheet in the file, the one opened when no sheet is asked for by name", TRK_TEMPLATE_SHEETS[0], first?.name ?? "");
  const miles = rowsOf(TRK_TEMPLATE_SHEETS[0]);
  const milesMapping = trkGuessMilesColumns(miles);
  const milesFound = milesMapping.headerRow === 0 && TRK_MILES_ROLES.every((role) => milesMapping.columns[role] === TRK_TEMPLATE_MILES_COLUMNS[role]);
  checks.that("miles-readable", "The jurisdiction and the miles are found in the Miles header row the way the fuel tax worksheet finds them, each in the column written for it", milesFound);
  let milesEmpty = false;
  if (milesFound) {
    const x = trkExtractMiles(miles, milesMapping);
    milesEmpty = x.rows.length === 0 && x.problems.length === 0 && x.skipped.length === 0;
  }
  checks.that("miles-empty", "The Miles sheet reads as a list of miles with nothing entered yet", milesEmpty);
  const fuel = rowsOf(TRK_TEMPLATE_SHEETS[1]);
  const fuelMapping = trkGuessFuelColumns(fuel);
  const fuelFound = fuelMapping.headerRow === 0 && TRK_FUEL_ROLES.every((role) => fuelMapping.columns[role] === TRK_TEMPLATE_FUEL_COLUMNS[role]);
  checks.that(
    "fuel-readable",
    "The date, unit, jurisdiction, location, gallons, amount, and card or driver are found in the header row of the sheet named Fuel the way the fuel tools find them, each in the column written for it",
    fuelFound
  );
  let fuelEmpty = false;
  if (fuelFound) {
    const x = trkExtractFuelCard(fuel, fuelMapping);
    fuelEmpty = x.rows.length === 0 && x.problems.length === 0 && x.skipped.length === 0;
  }
  checks.that("fuel-empty", "The Fuel sheet reads as a list of fuel purchases with nothing entered yet", fuelEmpty);
  return checks.all;
}

// packages/core/src/trucking/unitMpg.ts
function trkUnitName(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}
var TRK_UNIT_MILES_ROLES = ["unit", "miles"];
var TRK_UNIT_MILES_LABELS = { unit: "Unit or truck", miles: "Miles" };
var UNIT_MILES_SYNONYMS = {
  unit: ["unit number", "unit id", "unit", "truck number", "truck id", "truck", "tractor", "vehicle id", "vehicle", "power unit", "equipment"],
  miles: ["total miles", "miles", "distance miles", "distance", "mileage", "miles driven", "trip miles"]
};
function trkGuessUnitMilesColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, TRK_UNIT_MILES_ROLES, UNIT_MILES_SYNONYMS, atHeaderRow);
}
function trkExtractUnitMiles(rows, mapping) {
  const c = mapping.columns;
  for (const role of TRK_UNIT_MILES_ROLES) if (c[role] < 0) throw new Error(`Choose the column that holds: ${TRK_UNIT_MILES_LABELS[role]}.`);
  const out = { rows: [], problems: [], skipped: [] };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const unitText = sheetCell(cells, c.unit);
    const milesText3 = sheetCell(cells, c.miles);
    if (sheetIsTotalWord(unitText) || !unitText && cells.some(sheetIsTotalWord)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!milesText3) {
      out.skipped.push({ rowNumber, reason: "no miles" });
      continue;
    }
    try {
      const milesK = scaledParseNumber(milesText3, 3, "miles");
      if (milesK < 0) throw new Error("miles are negative");
      out.rows.push({ rowNumber, unit: trkUnitName(unitText), milesK });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}
function byUnitName(a, b) {
  const chunks = (s) => s.match(/\d+|\D+/g) ?? [];
  const left = chunks(a);
  const right = chunks(b);
  for (let i = 0; i < left.length && i < right.length; i++) {
    const x = left[i];
    const y = right[i];
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const nx = x.replace(/^0+(?=\d)/, "");
      const ny2 = y.replace(/^0+(?=\d)/, "");
      if (nx.length !== ny2.length) return nx.length < ny2.length ? -1 : 1;
      if (nx !== ny2) return nx < ny2 ? -1 : 1;
      continue;
    }
    return x < y ? -1 : 1;
  }
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function repeatedRows(entries) {
  const seen = /* @__PURE__ */ new Set();
  const again = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (seen.has(e.rowNumber)) again.add(e.rowNumber);
    seen.add(e.rowNumber);
  }
  return [...again].sort((x, y) => x - y);
}
function trkUnitMpg(input) {
  if (input.miles.length === 0) throw new Error("There are no miles rows to work with.");
  if (input.fuel.length === 0) throw new Error("There are no fuel rows to work with.");
  for (const m of input.miles) {
    if (!Number.isSafeInteger(m.milesK) || m.milesK < 0) throw new Error(`Miles on row ${m.rowNumber} of the miles file must be a whole number of thousandths, zero or more.`);
  }
  for (const f of input.fuel) {
    if (!Number.isSafeInteger(f.gallonsK)) throw new Error(`Gallons on row ${f.rowNumber} of the fuel file must be a whole number of thousandths.`);
    if (!Number.isSafeInteger(f.amount)) throw new Error(`The amount on row ${f.rowNumber} of the fuel file must be a whole number of cents.`);
  }
  if (input.typedTotalMilesK !== void 0 && (!Number.isSafeInteger(input.typedTotalMilesK) || input.typedTotalMilesK < 0)) {
    throw new Error("The total miles you typed must be a whole number of thousandths, zero or more.");
  }
  if (input.typedTotalGallonsK !== void 0 && !Number.isSafeInteger(input.typedTotalGallonsK)) throw new Error("The total gallons you typed must be a whole number of thousandths.");
  for (const [value, which] of [[input.mpgMinHundredths, "lowest"], [input.mpgMaxHundredths, "highest"]]) {
    if (value !== void 0 && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`The ${which} miles per gallon must be a whole number of hundredths, zero or more.`);
  }
  if (input.mpgMinHundredths !== void 0 && input.mpgMaxHundredths !== void 0 && input.mpgMinHundredths > input.mpgMaxHundredths) {
    throw new Error("Set the lowest miles per gallon at or below the highest.");
  }
  const groups = /* @__PURE__ */ new Map();
  const groupOf = (rawUnit) => {
    const name = trkUnitName(rawUnit) || TRK_NO_UNIT;
    let g = groups.get(name);
    if (!g) {
      g = { milesRows: 0, fuelRows: 0, miles: 0n, gallons: 0n, amount: 0n };
      groups.set(name, g);
    }
    return g;
  };
  for (const m of input.miles) {
    const g = groupOf(m.unit);
    g.milesRows += 1;
    g.miles += BigInt(m.milesK);
  }
  for (const f of input.fuel) {
    const g = groupOf(f.unit);
    g.fuelRows += 1;
    g.gallons += BigInt(f.gallonsK);
    g.amount += BigInt(f.amount);
  }
  const names = [...groups.keys()].filter((name) => name !== TRK_NO_UNIT).sort(byUnitName);
  if (groups.has(TRK_NO_UNIT)) names.push(TRK_NO_UNIT);
  let totalMiles = 0n;
  let totalGallons = 0n;
  let totalAmount = 0n;
  const rows = names.map((unit) => {
    const g = groups.get(unit);
    totalMiles += g.miles;
    totalGallons += g.gallons;
    totalAmount += g.amount;
    return {
      unit,
      milesRows: g.milesRows,
      fuelRows: g.fuelRows,
      milesK: trkSafe(g.miles, `miles for unit ${unit}`),
      gallonsK: trkSafe(g.gallons, `gallons for unit ${unit}`),
      amount: trkSafe(g.amount, `fuel amount for unit ${unit}`),
      mpgHundredths: g.gallons > 0n ? trkSafe(trkRoundDiv(g.miles * 100n, g.gallons), `miles per gallon for unit ${unit}`) : null
    };
  });
  const report = {
    rows,
    totalMilesK: trkSafe(totalMiles, "total miles"),
    totalGallonsK: trkSafe(totalGallons, "total gallons"),
    totalAmount: trkSafe(totalAmount, "total fuel amount"),
    fleetMpgHundredths: totalGallons > 0n ? trkSafe(trkRoundDiv(totalMiles * 100n, totalGallons), "fleet miles per gallon") : null
  };
  const checks = new CheckList();
  const milesAgain = repeatedRows(input.miles);
  const fuelAgain = repeatedRows(input.fuel);
  const placedMiles = rows.reduce((n, r) => n + r.milesRows, 0);
  const placedFuel = rows.reduce((n, r) => n + r.fuelRows, 0);
  const repeated = [milesAgain.length ? `miles file row(s) ${milesAgain.join(", ")}` : "", fuelAgain.length ? `fuel file row(s) ${fuelAgain.join(", ")}` : ""].filter(Boolean);
  checks.that(
    "trk-um-rows-once",
    "Every miles row and every fuel row is in exactly one unit",
    repeated.length === 0 && placedMiles === input.miles.length && placedFuel === input.fuel.length,
    repeated.length ? `${repeated.join("; ")} appear more than once` : "counts do not add up"
  );
  let rowMiles = 0n;
  let rowGallons = 0n;
  let rowAmount = 0n;
  for (const m of input.miles) rowMiles += BigInt(m.milesK);
  for (const f of input.fuel) {
    rowGallons += BigInt(f.gallonsK);
    rowAmount += BigInt(f.amount);
  }
  let unitMiles = 0n;
  let unitGallons = 0n;
  let unitAmount = 0n;
  for (const r of rows) {
    unitMiles += BigInt(r.milesK);
    unitGallons += BigInt(r.gallonsK);
    unitAmount += BigInt(r.amount);
  }
  checks.that(
    "trk-um-readd",
    "The units re-add to all rows, in miles, gallons, and dollars",
    rowMiles === unitMiles && rowGallons === unitGallons && rowAmount === unitAmount,
    `miles ${scaledFormat(rowMiles, 3)} vs ${scaledFormat(unitMiles, 3)}, gallons ${scaledFormat(rowGallons, 3)} vs ${scaledFormat(unitGallons, 3)}, dollars ${scaledFormat(rowAmount, 2)} vs ${scaledFormat(unitAmount, 2)}`
  );
  return { ...report, checks: checks.all };
}
function trkUnitMpgTable(r) {
  const mpg = (hundredths) => hundredths === null ? "" : scaledFormat(hundredths, 2);
  return [
    ["Unit", "Miles", "Gallons", "Fuel amount", "Miles per gallon"],
    ...r.rows.map((u) => [u.unit, scaledFormat(u.milesK, 3, true), scaledFormat(u.gallonsK, 3), toDecimal(u.amount), mpg(u.mpgHundredths)]),
    ["Fleet total", scaledFormat(r.totalMilesK, 3, true), scaledFormat(r.totalGallonsK, 3), toDecimal(r.totalAmount), mpg(r.fleetMpgHundredths)]
  ];
}

// packages/core/src/trucking/unitMpgCheck.ts
var SPACES = new RegExp("\\s+");
function unitOf(raw) {
  const words = (typeof raw === "string" ? raw : "").toUpperCase().split(SPACES).filter((word) => word !== "");
  return words.length === 0 ? TRK_NO_UNIT : words.join(" ");
}
var sorted2 = (names) => [...new Set(names)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
function trkVerifyUnitMpg(input, report) {
  const checks = new CheckList();
  const k3 = (v) => scaledFormat(v, 3);
  const mpg2 = (v) => v === null ? "blank" : scaledFormat(v, 2);
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const said = /* @__PURE__ */ new Map();
  const sumsOf = (name) => {
    let s = said.get(name);
    if (!s) {
      s = { miles: 0n, gallons: 0n, amount: 0n };
      said.set(name, s);
    }
    return s;
  };
  let totalMiles = 0n;
  let totalGallons = 0n;
  let totalAmount = 0n;
  let unnamedMilesRows = 0;
  let unnamedFuelRows = 0;
  for (const m of input.miles) {
    const name = unitOf(m.unit);
    const miles = B(m.milesK);
    if (name === TRK_NO_UNIT) unnamedMilesRows++;
    sumsOf(name).miles += miles;
    totalMiles += miles;
  }
  for (const f of input.fuel) {
    const name = unitOf(f.unit);
    const gallons = B(f.gallonsK);
    const amount = B(f.amount);
    if (name === TRK_NO_UNIT) unnamedFuelRows++;
    const s = sumsOf(name);
    s.gallons += gallons;
    s.amount += amount;
    totalGallons += gallons;
    totalAmount += amount;
  }
  const none = { miles: 0n, gallons: 0n, amount: 0n };
  const inputFor = (name) => said.get(name) ?? none;
  const rows = report.rows.map((r) => ({
    unit: typeof r.unit === "string" ? r.unit : "",
    miles: B(r.milesK),
    gallons: B(r.gallonsK),
    amount: B(r.amount),
    mpg: r.mpgHundredths === null ? null : B(r.mpgHundredths)
  }));
  const shown = {
    miles: B(report.totalMilesK),
    gallons: B(report.totalGallonsK),
    amount: B(report.totalAmount),
    mpg: report.fleetMpgHundredths === null ? null : B(report.fleetMpgHundredths)
  };
  const typedMiles = input.typedTotalMilesK === void 0 ? void 0 : B(input.typedTotalMilesK);
  const typedGallons = input.typedTotalGallonsK === void 0 ? void 0 : B(input.typedTotalGallonsK);
  const mpgMin = input.mpgMinHundredths === void 0 ? void 0 : B(input.mpgMinHundredths);
  const mpgMax = input.mpgMaxHundredths === void 0 ? void 0 : B(input.mpgMaxHundredths);
  checks.that("trk-um-whole-numbers", "Every figure in the input and in the result is a whole number in its unit", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const seen = /* @__PURE__ */ new Set();
  const wrongNames = [];
  for (const r of rows) {
    if (seen.has(r.unit) || !said.has(r.unit)) wrongNames.push(r.unit);
    seen.add(r.unit);
  }
  for (const name of said.keys()) if (!seen.has(name)) wrongNames.push(name);
  checks.that("trk-um-units", "Every unit with a miles row or a fuel row is in the result exactly once", wrongNames.length === 0, sorted2(wrongNames).join(", "));
  const badMiles = rows.filter((r) => r.miles !== inputFor(r.unit).miles).map((r) => r.unit);
  const rowMiles = rows.reduce((n, r) => n + r.miles, 0n);
  const milesTotalsOk = totalMiles === rowMiles && totalMiles === shown.miles;
  checks.that(
    "trk-um-miles",
    "Each unit’s miles are its own miles rows added up, and the units add up to total miles",
    badMiles.length === 0 && milesTotalsOk,
    [sorted2(badMiles).join(", "), milesTotalsOk ? "" : `miles rows ${k3(totalMiles)}, units ${k3(rowMiles)}, total ${k3(shown.miles)}`].filter(Boolean).join("; ")
  );
  if (typedMiles !== void 0) checks.equal("trk-um-miles-typed", "Total miles equal the total you typed", k3(typedMiles), k3(shown.miles));
  const badGallons = rows.filter((r) => r.gallons !== inputFor(r.unit).gallons).map((r) => r.unit);
  const rowGallons = rows.reduce((n, r) => n + r.gallons, 0n);
  const gallonsTotalsOk = totalGallons === rowGallons && totalGallons === shown.gallons;
  checks.that(
    "trk-um-gallons",
    "Each unit’s gallons are its own fuel rows added up, and the units add up to total gallons",
    badGallons.length === 0 && gallonsTotalsOk,
    [sorted2(badGallons).join(", "), gallonsTotalsOk ? "" : `fuel rows ${k3(totalGallons)}, units ${k3(rowGallons)}, total ${k3(shown.gallons)}`].filter(Boolean).join("; ")
  );
  if (typedGallons !== void 0) checks.equal("trk-um-gallons-typed", "Total gallons equal the total you typed", k3(typedGallons), k3(shown.gallons));
  const badAmount = rows.filter((r) => r.amount !== inputFor(r.unit).amount).map((r) => r.unit);
  const rowAmount = rows.reduce((n, r) => n + r.amount, 0n);
  const amountTotalsOk = totalAmount === rowAmount && totalAmount === shown.amount;
  checks.that(
    "trk-um-amount",
    "Each unit’s fuel amount is its own fuel rows added up, and the units add up to the total fuel amount",
    badAmount.length === 0 && amountTotalsOk,
    [sorted2(badAmount).join(", "), amountTotalsOk ? "" : `fuel rows ${scaledFormat(totalAmount, 2)}, units ${scaledFormat(rowAmount, 2)}, total ${scaledFormat(shown.amount, 2)}`].filter(Boolean).join("; ")
  );
  const badMpg = rows.filter((r) => {
    const own = inputFor(r.unit);
    if (own.gallons <= 0n) return r.mpg !== null;
    return r.mpg === null || !trkIsRounded(r.mpg, own.miles * 100n, own.gallons, 1n);
  }).map((r) => r.unit);
  checks.that(
    "trk-um-mpg",
    "Each unit’s miles per gallon is its own miles divided by its own gallons, rounded to 2 decimals, and is blank for a unit with no gallons",
    badMpg.length === 0,
    sorted2(badMpg).join(", ")
  );
  const fleetOk = totalGallons > 0n ? shown.mpg !== null && trkIsRounded(shown.mpg, totalMiles * 100n, totalGallons, 1n) : shown.mpg === null;
  checks.that(
    "trk-um-fleet-mpg",
    "Fleet miles per gallon is total miles divided by total gallons, rounded to 2 decimals",
    fleetOk,
    `total miles ${k3(totalMiles)}, total gallons ${k3(totalGallons)}, shown ${mpg2(shown.mpg)}`
  );
  const noGallons = sorted2([...said].filter(([, s]) => s.miles > 0n && s.gallons <= 0n).map(([name]) => name));
  checks.that("trk-um-no-gallons", "Every unit with miles has gallons", noGallons.length === 0, `miles and no gallons, so no miles per gallon: ${noGallons.join(", ")}`, "warning");
  const noMiles = sorted2([...said].filter(([, s]) => s.gallons !== 0n && s.miles === 0n).map(([name]) => name));
  checks.that("trk-um-no-miles", "Every unit with gallons has miles", noMiles.length === 0, `gallons and no miles: ${noMiles.join(", ")}`, "warning");
  if (mpgMin !== void 0 || mpgMax !== void 0) {
    const outside = rows.filter((r) => r.mpg !== null && (mpgMin !== void 0 && r.mpg < mpgMin || mpgMax !== void 0 && r.mpg > mpgMax));
    checks.that("trk-um-band", "Every unit’s miles per gallon is inside the band you set", outside.length === 0, `outside the band: ${outside.map((r) => `${r.unit} (${mpg2(r.mpg)})`).join(", ")}`, "warning");
  }
  checks.that(
    "trk-um-no-unit",
    "Every miles row and every fuel row names a unit",
    unnamedMilesRows === 0 && unnamedFuelRows === 0,
    `${unnamedMilesRows} miles row(s) and ${unnamedFuelRows} fuel row(s) name no unit and are added together as ${TRK_NO_UNIT}`,
    "warning"
  );
  return checks.all;
}

// packages/agents/src/registry/trucking.ts
var FUEL_COLUMNS = { roles: TRK_FUEL_ROLES, labels: TRK_FUEL_LABELS, required: ["gallons"], guess: (rows, at) => trkGuessFuelColumns(rows, at) };
var MILES_COLUMNS = { roles: TRK_MILES_ROLES, labels: TRK_MILES_LABELS, required: TRK_MILES_ROLES, guess: (rows, at) => trkGuessMilesColumns(rows, at) };
var UNIT_MILES_COLUMNS = { roles: TRK_UNIT_MILES_ROLES, labels: TRK_UNIT_MILES_LABELS, required: TRK_UNIT_MILES_ROLES, guess: (rows, at) => trkGuessUnitMilesColumns(rows, at) };
var UNIT_FUEL_COLUMNS = { roles: ["unit", "gallons", "amount", "date"], labels: TRK_FUEL_LABELS, required: ["unit", "gallons"], guess: (rows, at) => trkGuessFuelColumns(rows, at) };
var MILES_SHEET = /^miles$/i;
var FUEL_SHEET = /^fuel$/i;
function scaled(value, places, label) {
  if (value === void 0) return void 0;
  return scaledParseNumber(String(value), places, label);
}
function commas(plain2) {
  return plain2.replace(/^(-?)(\d+)/, (_m, sign, digits) => sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}
var qty = (k, places, trim = false) => commas(scaledFormat(k, places, trim));
function tagged(list, what) {
  return list.map((p) => ({ rowNumber: p.rowNumber, reason: `${what}: ${p.reason}` }));
}
var MAX_COST_LINES = 60;
var MAX_COST_NAME = 60;
var COST_LINE = /^(.+?)\s*[,;|\t]\s*(fixed|variable)\s*(?:[,;|\t]\s*(.*))?$/i;
function readCostLines(text) {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (raw.length > MAX_COST_LINES) throw new AgentInputError(`There are ${raw.length} cost lines; the calculator takes up to ${MAX_COST_LINES}.`);
  const lines = [];
  const leftOut = [];
  raw.forEach((line, i) => {
    const m = COST_LINE.exec(line);
    const amountText = (m?.[3] ?? "").trim();
    if (i === 0 && !m && !/\d/.test(line)) {
      leftOut.push(`the header line "${line}"`);
      return;
    }
    if (!m) throw new AgentInputError(`Cost line ${i + 1} ("${line}") is not written as "<cost>, fixed or variable, <amount>", for example "Insurance, fixed, 1187.00".`);
    const label = m[1].trim();
    const group = m[2].toLowerCase();
    if (label.length > MAX_COST_NAME) throw new AgentInputError(`The cost name on line ${i + 1} is longer than ${MAX_COST_NAME} characters.`);
    if (amountText === "") {
      leftOut.push(`"${label}" (no amount)`);
      return;
    }
    let amount;
    try {
      amount = parseAmount(amountText);
    } catch {
      throw new AgentInputError(`The amount for "${label}" ("${amountText}") is not dollars and cents.`);
    }
    if (amount < 0) throw new AgentInputError(`The amount for "${label}" is below zero. Amounts are zero or more: a credit is typed by taking it off the cost it belongs to.`);
    lines.push({ label, group, amount });
  });
  if (lines.length === 0) throw new AgentInputError('Give the amount of at least one cost, as "<cost>, fixed or variable, <amount>".');
  return { lines, leftOut };
}
var costPerMile = {
  name: "trucking_cost_per_mile",
  page: "trucking/cost-per-mile-calculator",
  section: "trucking",
  kind: "tool",
  title: "Trucking cost per mile, fixed and variable",
  description: "Works out what a truck or small fleet cost to run per mile for a period: each cost typed for the period, marked fixed or variable, is divided by the miles driven, with the fixed and variable subtotals and total cost per mile to a tenth of a cent. With revenue for the same period, also revenue per mile and what is left per mile after costs. Checked: every cost is on the result once, the subtotals add to total cost, and each per-mile figure is its own dollars divided by the miles (tested by multiplying back, with no division), so the rounded lines are shown to be within rounding of the total. Use it when an owner-operator asks for cost per mile, operating cost per mile, or what is left per mile from their own costs and miles. Not for rate quotes or comparing with industry averages: it holds no rates and no averages, and it does not say what a load is worth.",
  question: "My truck cost me $14,838.50 to run in March over 10,000 miles. What is my cost per mile, fixed and variable?",
  inputs: [
    {
      name: "costs",
      kind: "text",
      label: "Costs for the period",
      description: `One cost per line: its name, fixed or variable, and the amount for the period, separated by commas, semicolons, tabs or "|", for example "Truck payment, fixed, 2156.00" or "Fuel; variable; $5,538.00". Amounts are dollars and cents, zero or more (a credit is taken off the cost it belongs to). Which costs are fixed and which variable is the person's own call. A line with no amount is left out, and a first line not in this shape with no figure in it (such as "Cost, Fixed or variable, Amount") is read as a header; both are named in the answer. A line whose amount cannot be read is refused. Up to 60 lines.`,
      required: true
    },
    { name: "miles", kind: "number", label: "Miles driven", description: "Miles driven in the same period, more than zero, with up to 3 decimal places.", required: true },
    { name: "revenue", kind: "amount", label: "Revenue for the period", description: "Optional. Revenue for the same period, zero or more, for revenue per mile and what is left per mile after costs.", required: false },
    { name: "period", kind: "text", label: "Period", description: 'Optional. A name for the period, such as "March 2026", printed on the result.', required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven divides the costs typed by the miles typed. It holds no rates and no averages, and it does not say what a mile ought to cost, what a load is worth, or what belongs on a tax form.",
  run({ values }) {
    const { lines, leftOut } = readCostLines(String(values.costs ?? ""));
    const milesK = scaledParseNumber(String(values.miles), 3, "miles");
    if (milesK <= 0) throw new AgentInputError("Miles must be more than zero.");
    const revenue = values.revenue === void 0 ? null : values.revenue;
    if (revenue !== null && revenue < 0) throw new AgentInputError("Revenue must be zero or more.");
    const period = typeof values.period === "string" ? values.period.trim() : "";
    const r = trkCostPerMile({ period, lines, milesK, revenue });
    const parts = [
      `${period ? `${period}: ` : ""}${r.lines.length} cost(s) over ${qty(r.milesK, 3, true)} miles. Total cost ${formatUSD(r.totalCents)}, ${trkPerMileText(r.totalPerMileK)} a mile: fixed ${formatUSD(r.fixedCents)} (${trkPerMileText(r.fixedPerMileK)} a mile) and variable ${formatUSD(r.variableCents)} (${trkPerMileText(r.variablePerMileK)} a mile).`
    ];
    if (r.revenue !== null && r.revenuePerMileK !== null && r.netCents !== null && r.netPerMileK !== null) {
      parts.push(`Revenue ${formatUSD(r.revenue)} is ${trkPerMileText(r.revenuePerMileK)} a mile; left after costs ${formatUSD(r.netCents)}, ${trkPerMileText(r.netPerMileK)} a mile.`);
    }
    parts.push("Each figure is its own dollars divided by the miles, rounded to a tenth of a cent, half away from zero, so the rounded lines can add up to a few tenths of a cent more or less than the total.");
    if (leftOut.length > 0) parts.push(`Left out: ${leftOut.join(", ")}.`);
    return {
      summary: parts.join(" "),
      tables: [
        { name: "Cost per mile", rows: trkCostPerMileTable(r, "display") },
        { name: "Summary", rows: trkCostPerMileSummary(r, "display") }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: March 2026, eight costs, 10,000 miles, $19,254.00 of revenue",
      args: {
        costs: "Truck payment, fixed, 2156.00\nInsurance, fixed, 1187.00\nPermits and plates, fixed, 166.00\nFuel, variable, 5538.00\nMaintenance and repairs, variable, 746.00\nTires, variable, 317.00\nTolls, variable, 128.50\nDriver pay, variable, $4,600.00",
        miles: "10,000",
        revenue: "19,254.00",
        period: "March 2026"
      },
      verified: true,
      contains: [
        "| Truck payment | Fixed | $2,156.00 | $0.216 |",
        "| Insurance | Fixed | $1,187.00 | $0.119 |",
        "| Permits and plates | Fixed | $166.00 | $0.017 |",
        "| Fixed costs |  | $3,509.00 | $0.351 |",
        "| Fuel | Variable | $5,538.00 | $0.554 |",
        "| Maintenance and repairs | Variable | $746.00 | $0.075 |",
        "| Tires | Variable | $317.00 | $0.032 |",
        "| Tolls | Variable | $128.50 | $0.013 |",
        "| Driver pay | Variable | $4,600.00 | $0.460 |",
        "| Variable costs |  | $11,329.50 | $1.133 |",
        "| Total cost |  | $14,838.50 | $1.484 |",
        "| Revenue |  | $19,254.00 | $1.925 |",
        "| Left after costs |  | $4,415.50 | $0.442 |",
        "| Total cost per mile | $1.484 |"
      ]
    }
  ]
};
var fuelCardLedger = {
  name: "fuel_card_ledger_by_jurisdiction",
  page: "trucking/fuel-card-ledger",
  section: "trucking",
  kind: "tool",
  title: "Fuel-card statement to a fuel ledger by jurisdiction and unit",
  description: `Reads a fuel-card transaction export (.csv or .xlsx, one row per purchase) and adds up gallons and dollars per jurisdiction (state or province) and per jurisdiction and unit, tied to the total gallons and dollars printed on the statement. When the jurisdiction column is blank, the two-letter code at the end of a location such as "Amarillo, TX" is used; rows that name no jurisdiction stay in the totals and are listed separately, never dropped. Checked: every row is in exactly one bucket or on that list, the buckets re-add to all rows in a second pass, the totals equal the statement's, and every row is used, listed as left out (the statement's own total line) or listed as unreadable. Use it when a trucker wants fuel purchases by state from a fuel card statement, or wants a statement's rows tied to its totals. Not for working out fuel tax or miles per gallon (it reads no miles), and it holds no tax rates.`,
  question: "Can you total the gallons and dollars by state and by truck from my fuel card statement and tie them to the statement totals?",
  inputs: [
    {
      name: "statement",
      kind: "file",
      label: "Fuel-card statement",
      description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per fuel purchase: gallons are needed; date, jurisdiction (state or province), location, amount, unit and card or driver are used when present. A workbook with a sheet named Fuel is read from that sheet.",
      required: true
    },
    { name: "statementGallons", kind: "number", label: "Statement total gallons", description: "Optional. The total gallons printed on the statement, up to 3 decimal places, for the rows to be tied to.", required: false },
    { name: "statementAmount", kind: "amount", label: "Statement total dollars", description: "Optional. The total dollars printed on the statement, for the rows to be tied to.", required: false },
    columnsInput("Fuel-card statement", FUEL_COLUMNS)
  ],
  limits: "site",
  // The statement totals the person typed: when only these fail, the page still shows its ledger beside them.
  comparisonChecks: ["trk-fl-statement-gallons", "trk-fl-statement-amount"],
  notAdvice: "Mathproven puts each row of the statement in one bucket, adds them up and ties them to the totals typed; it holds no tax rates, does not choose a jurisdiction for a row that names none, and does not say what is owed to anyone.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "statement"), FUEL_SHEET);
    const x = trkExtractFuelCard(file.rows, mapColumns(file, FUEL_COLUMNS, values.columns, "Fuel-card statement"));
    const r = trkBuildFuelLedger({
      rows: x.rows,
      typedGallonsK: scaled(values.statementGallons, 3, "statement gallons"),
      typedAmount: values.statementAmount
    });
    const t = trkLedgerTables(r);
    const looseGallons = r.unassigned.reduce((n, u) => n + u.gallonsK, 0);
    const looseAmount = r.unassigned.reduce((n, u) => n + u.amount, 0);
    const loose = r.unassigned.length === 0 ? "Every row names a jurisdiction." : `${r.unassigned.length} row(s) name no jurisdiction (${qty(looseGallons, 3)} gallons, ${formatUSD(looseAmount)}): they are in the totals, in no jurisdiction, and listed separately.`;
    return {
      summary: `${r.totalCount} fuel row(s), ${qty(r.totalGallonsK, 3)} gallons and ${formatUSD(r.totalAmount)} in all. ${qty(r.totalGallonsK - looseGallons, 3)} gallons and ${formatUSD(r.totalAmount - looseAmount)} are in ${r.jurisdictions.length} jurisdiction(s), split into ${r.buckets.length} jurisdiction and unit bucket(s). ${loose}`,
      tables: [
        { name: "By jurisdiction", rows: t.jurisdictions },
        { name: "By jurisdiction and unit", rows: t.buckets },
        { name: "No jurisdiction", rows: t.unassigned }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: six statement rows, totals of 1,680.000 gallons and $5,853.46",
      args: { statement: "fixture:trucking/fuel-card-statement.csv", statementGallons: "1,680.000", statementAmount: "$5,853.46" },
      verified: true,
      contains: [
        "| NM | 1 | 299.500 | 1063.23 |",
        "| OK | 2 | 400.500 | 1385.73 |",
        "| TX | 2 | 900.000 | 3136.50 |",
        "| (no jurisdiction) | 1 | 80.000 | 268.00 |",
        "| Total | 6 | 1680.000 | 5853.46 |",
        "| NM | 14 | 1 | 299.500 | 1063.23 |",
        "| OK | 12 | 1 | 200.250 | 690.86 |",
        "| OK | 14 | 1 | 200.250 | 694.87 |",
        "| TX | 12 | 1 | 450.000 | 1575.00 |",
        "| TX | 14 | 1 | 450.000 | 1561.50 |",
        "| 8 | 2026-08-05 | Yard tank fill | 14 | 4428 | 80.000 | 268.00 |",
        "1,600.000 gallons and $5,585.46",
        "1,680.000 gallons and $5,853.46"
      ]
    },
    {
      label: "A statement whose rows do not add up to its printed dollar total is not verified",
      args: { statement: "fixture:trucking/fuel-card-statement.csv", statementGallons: "1,680.000", statementAmount: "$5,835.46" },
      verified: false,
      failedCheck: "trk-fl-statement-amount"
    },
    {
      label: "A row whose gallons cannot be read is not verified",
      args: { statement: "Date,State,Unit,Gallons,Amount\n2026-07-03,TX,12,450.000,1575.00\n2026-07-09,OK,12,2OO.250,690.86\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var TEMPLATE_ROWS = {
  Miles: () => "One for the miles driven in a jurisdiction, under the header row",
  Fuel: () => "One per fuel purchase, under the header row",
  Units: (o) => `${o.unitCount} numbered`,
  Log: () => "Carrier, year, and quarter filled in",
  Instructions: () => "What each sheet and column holds"
};
var fileSlug = (text) => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
var logTemplate = {
  name: "mileage_and_fuel_log_template",
  page: "trucking/mileage-and-fuel-log-template",
  section: "trucking",
  kind: "template",
  title: "Mileage and fuel log workbook for a quarter (Excel)",
  description: "Builds a blank Excel workbook for logging one quarter of miles and fuel purchases: a Miles sheet (date, unit, jurisdiction, miles, trip or load, notes), a Fuel sheet (date, unit, jurisdiction, location, gallons, amount, card or driver, notes), a numbered Units list, a Log sheet with the carrier, year and quarter filled in, and an Instructions sheet. Values only, no formulas. Before it is handed over, the finished file is read back and checked: sheet names, header rows and row counts, the Miles sheet first, its header row matched and its rows read the way the quarterly fuel tax worksheet reads miles, and the Fuel sheet found by name and matched and read the way the fuel tools read fuel purchases, each reading as empty. Use it when an owner-operator or small fleet wants a log to keep miles by state and fuel receipts for the quarterly fuel tax. Not for adding anything up: it holds no rates and no due dates, and it does not say what a mileage or fuel record has to hold.",
  question: "Can you make me a spreadsheet to log my miles by state and my fuel purchases for the fourth quarter?",
  inputs: [
    { name: "carrier", kind: "text", label: "Carrier name", description: "Optional. The carrier the log is kept for, up to 120 characters, written on the Log sheet.", required: false },
    { name: "year", kind: "year", label: "Year", description: "Optional. The year the log covers, four digits from 2000 to 2099, written on the Log sheet.", required: false },
    { name: "quarter", kind: "choice", label: "Quarter", description: "Optional. The quarter of that year: 1 (January to March), 2 (April to June), 3 (July to September) or 4 (October to December).", required: false, choices: ["1", "2", "3", "4"] },
    { name: "unitCount", kind: "number", label: "Number of trucks or units", description: `Optional. How many numbered rows the Units sheet starts with, a whole number from 1 to ${TRK_TEMPLATE_MAX_UNITS}. Without it, 1.`, required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout of column names and blank rows; it holds no rates, no dates on which anything is due, and no rule about what a mileage or fuel record has to hold or how long it is kept.",
  run({ values }) {
    const countText = values.unitCount === void 0 ? "1" : String(values.unitCount);
    if (!/^\d+$/.test(countText)) throw new AgentInputError(`The number of units must be a whole number from 1 to ${TRK_TEMPLATE_MAX_UNITS}.`);
    const options = {
      carrier: typeof values.carrier === "string" ? values.carrier : "",
      year: values.year === void 0 ? "" : String(values.year),
      quarter: typeof values.quarter === "string" ? values.quarter : "",
      unitCount: Number(countText),
      siteUrl: SITE_URL
    };
    const sheets = trkLogTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = trkVerifyLogTemplate(options, bytes);
    const quarter = options.quarter.trim();
    const suggestedName = `${["mileage-fuel-log", fileSlug(options.carrier), options.year.trim(), quarter ? `q${quarter}` : ""].filter(Boolean).join("-")}.xlsx`;
    const kept = [options.carrier.trim(), options.year.trim(), quarter ? `quarter ${quarter}` : ""].filter(Boolean).join(", ");
    return {
      summary: `A mileage and fuel log workbook${kept ? ` for ${kept}` : ""}, ${suggestedName}: ${sheets.length} sheets (${sheets.map((s) => s.name).join(", ")}), values only with no formulas, and ${options.unitCount} numbered row(s) on the Units sheet. The Miles and Fuel sheets have a header row and nothing under it.`,
      tables: [
        {
          name: "Sheets",
          rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), TEMPLATE_ROWS[s.name]?.(options) ?? String(s.rows.length - 1)])]
        }
      ],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Castellan Freight, 2 trucks, the third quarter of 2026",
      args: { carrier: "Castellan Freight", year: "2026", quarter: "3", unitCount: "2" },
      verified: true,
      contains: [
        "mileage-fuel-log-castellan-freight-2026-q3.xlsx",
        "| Miles | Date, Unit, Jurisdiction, Miles, Trip or load, Notes | One for the miles driven in a jurisdiction, under the header row |",
        "| Fuel | Date, Unit, Jurisdiction, Location, Gallons, Amount, Card or driver, Notes | One per fuel purchase, under the header row |",
        "| Units | Line, Unit, Notes | 2 numbered |",
        "| Log | Item, Value | Carrier, year, and quarter filled in |"
      ]
    }
  ]
};
var unitMpg = {
  name: "truck_miles_per_gallon_by_unit",
  page: "trucking/miles-per-gallon-by-truck",
  section: "trucking",
  kind: "tool",
  title: "Miles per gallon by truck from a miles file and a fuel file",
  description: "Reads a miles file (trip rows or a summary with a unit and miles) and a fuel file (fuel-card or fuel log rows with a unit and gallons) and gives one row per truck: miles, gallons, fuel amount and miles per gallon to 2 decimals, plus the fleet figure, which is total miles over total gallons, not an average of the trucks. Checked by a separate routine with no division: each unit's figure against its own miles rows and fuel rows (so gallons moved from one truck to another fail even when the totals still add up), the units re-added to all rows, and the totals against any typed. Units with miles and no gallons, gallons and no miles, or outside a typed band are warnings; rows with no unit stay in the fleet total. Use it when someone asks for MPG per truck or fleet fuel economy from their own trip and fuel records. Not for judging whether a figure is good or bad, and it holds no band of its own.",
  question: "What is the miles per gallon for each of my trucks this month? Here are my trip miles and my fuel card export.",
  inputs: [
    {
      name: "milesFile",
      kind: "file",
      label: "Miles file",
      description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and a unit (truck) column and a miles column, as trip rows or a summary; rows of one unit are added together. A workbook with a sheet named Miles is read from that sheet.",
      required: true
    },
    {
      name: "fuelFile",
      kind: "file",
      label: "Fuel file",
      description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and a unit (truck) column and a gallons column; an amount column and a date column are used when present. A workbook with a sheet named Fuel is read from that sheet, so one filled-in log workbook can be given as both files.",
      required: true
    },
    { name: "totalMiles", kind: "number", label: "Total miles", description: "Optional. Total miles from the person's own summary, up to 3 decimal places, compared with the miles file.", required: false },
    { name: "totalGallons", kind: "number", label: "Total gallons", description: "Optional. Total gallons from the person's own summary, up to 3 decimal places, compared with the fuel file.", required: false },
    { name: "mpgLow", kind: "number", label: "Lowest miles per gallon", description: 'Optional. With "mpgHigh", a band set by the person: units outside it are listed as a warning. Up to 2 decimals.', required: false },
    { name: "mpgHigh", kind: "number", label: "Highest miles per gallon", description: "Optional. The top of the band, up to 2 decimals.", required: false },
    columnsInput("Miles file", UNIT_MILES_COLUMNS, "milesColumns"),
    columnsInput("Fuel file", UNIT_FUEL_COLUMNS, "fuelColumns")
  ],
  limits: "site",
  // The totals the person typed from their own summary: when only these fail, the page still shows its table beside them.
  comparisonChecks: ["trk-um-miles-typed", "trk-um-gallons-typed"],
  notAdvice: "Mathproven adds up and divides your own miles and gallons; it does not say what any figure ought to be.",
  run({ files, values }) {
    const milesFile = preferSheet(oneFile(files, "milesFile"), MILES_SHEET);
    const fuelFile = preferSheet(oneFile(files, "fuelFile"), FUEL_SHEET);
    const m = trkExtractUnitMiles(milesFile.rows, mapColumns(milesFile, UNIT_MILES_COLUMNS, values.milesColumns, "Miles file"));
    const f = trkExtractFuelCard(fuelFile.rows, mapColumns(fuelFile, UNIT_FUEL_COLUMNS, values.fuelColumns, "Fuel file"));
    const problems = [...tagged(m.problems, "miles file"), ...tagged(f.problems, "fuel file")];
    const skipped = [...tagged(m.skipped, "miles file"), ...tagged(f.skipped, "fuel file")];
    const input = {
      miles: m.rows,
      fuel: f.rows,
      typedTotalMilesK: scaled(values.totalMiles, 3, "total miles"),
      typedTotalGallonsK: scaled(values.totalGallons, 3, "total gallons"),
      mpgMinHundredths: scaled(values.mpgLow, 2, "lowest miles per gallon"),
      mpgMaxHundredths: scaled(values.mpgHigh, 2, "highest miles per gallon")
    };
    const r = trkUnitMpg(input);
    const checks = [...r.checks, ...trkVerifyUnitMpg(input, r), ...sheetRowChecks(problems, skipped)];
    const named = r.rows.filter((u) => u.unit !== TRK_NO_UNIT).length;
    const fleet = r.fleetMpgHundredths === null ? "not shown, because total gallons are not more than zero" : scaledFormat(r.fleetMpgHundredths, 2);
    return {
      summary: `${named} unit(s)${named === r.rows.length ? "" : ", and one group of rows with no unit"}: ${qty(r.totalMilesK, 3, true)} miles, ${qty(r.totalGallonsK, 3)} gallons and ${formatUSD(r.totalAmount)} of fuel in all. Fleet miles per gallon (total miles divided by total gallons, rounded to 2 decimals, half away from zero): ${fleet}. ${m.rows.length} miles row(s) and ${f.rows.length} fuel row(s) were used. A unit with no gallons has a blank for miles per gallon.`,
      tables: [{ name: "By unit", rows: trkUnitMpgTable(r) }],
      checks
    };
  },
  examples: [
    {
      label: "The page's worked example: three trucks, seven trip rows and seven fuel rows, each file with its own total line",
      args: { milesFile: "fixture:trucking/unit-miles.csv", fuelFile: "fixture:trucking/unit-fuel.csv", totalMiles: "13,775.0", totalGallons: "2,100.000" },
      verified: true,
      contains: ["| 12 | 6200 | 900.000 | 3136.50 | 6.89 |", "| 14 | 5125 | 800.000 | 2796.00 | 6.41 |", "| 16 | 2450 | 400.000 | 1410.00 | 6.13 |", "| Fleet total | 13775 | 2100.000 | 7342.50 | 6.56 |", "13,775 miles, 2,100.000 gallons and $7,342.50"]
    },
    {
      label: "Total miles typed from a summary that the miles file does not reach are not verified",
      args: { milesFile: "fixture:trucking/unit-miles.csv", fuelFile: "fixture:trucking/unit-fuel.csv", totalMiles: "13,975.0" },
      verified: false,
      failedCheck: "trk-um-miles-typed"
    },
    {
      label: "A miles row whose miles cannot be read is not verified",
      args: { milesFile: "Unit,Miles\n12,2100.5\n14,248O.0\n", fuelFile: "fixture:trucking/unit-fuel.csv" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var DATED = TRK_FUEL_RATES_2026Q3;
var DATED_FUEL = "diesel";
var DATED_COUNT = trkFuelRateFeed(DATED, DATED_FUEL).rates.length;
var fuelTaxWorksheet = {
  name: "fuel_tax_quarterly_worksheet",
  page: "trucking/quarterly-fuel-tax-worksheet",
  section: "trucking",
  kind: "tool",
  title: "Quarterly fuel tax worksheet from miles and fuel-card files",
  description: "Works a quarter's fuel tax worksheet by state from a carrier's own records: miles by state or province " +
    "(an ELD, logging or trip export) and fuel purchases (a fuel-card export or fuel log). Gives fleet miles " +
    "per gallon, then for each jurisdiction its miles, gallons bought, taxable gallons, net taxable gallons " +
    "and tax at the rates given, and total tax at those rates. Checked: each jurisdiction against its own " +
    "miles and fuel rows (gallons moved between states fail even when the totals match), jurisdictions adding " +
    "to total miles, a rate for every jurisdiction, and every row used or listed. Use it when an owner-operator " +
    "or small fleet is getting a quarterly fuel tax return ready and wants state miles and fuel receipts " +
    "worked into taxable gallons and tax at the rates they give. Not a return or an agency form; it computes " +
    "no surcharges and does not say what is owed. The dated table that comes with it is third-quarter 2026 " +
    "diesel only, so another quarter needs that quarter's rates given.",
  question: "Can you work my fuel tax by state for October to December from my ELD miles export and my fuel card statement? Here are the rates for the quarter.",
  inputs: [
    {
      name: "milesFile",
      kind: "file",
      label: "Miles by jurisdiction",
      description: "A .csv or .xlsx file (a path, or the CSV text) of the quarter's miles: a jurisdiction column (state or province, written the way the rate table writes it, such as TX) and a miles column, one row per trip, day or jurisdiction; rows of one jurisdiction are added together. The file's own total line is left out and listed. A workbook with a sheet named Miles is read from that sheet.",
      required: true
    },
    {
      name: "fuelFile",
      kind: "file",
      label: "Fuel purchases",
      description: `A .csv or .xlsx file (a path, or the CSV text) of the same quarter's fuel purchases, such as a fuel-card export: a gallons column and a jurisdiction column, or a location ending in a two-letter code such as "Amarillo, TX"; a date column is used when present. A purchase with no jurisdiction counts as unreadable. A workbook with a sheet named Fuel is read from that sheet, so one filled-in log workbook can be given as both files.`,
      required: true
    },
    {
      name: "rates",
      kind: "text",
      label: "Rate table",
      description: `The rates being worked from: one jurisdiction per line with its rate per gallon in dollars, up to 4 decimals, such as "TX 0.2000" or "NM,0.2275", using the same codes as the files. A first line with no figure is a header. Needed unless "useDatedTable" is true.`,
      required: false
    },
    {
      name: "useDatedTable",
      kind: "boolean",
      label: "Use the dated rate table",
      description: `Optional. true: the rates are the dated table that comes with the page, ${DATED.label} (${DATED.firstDay} to ${DATED.lastDay}), ${TRK_FUEL_KIND_LABELS[DATED_FUEL]} base rates for ${DATED_COUNT} jurisdictions, no surcharges. With "rates" also given, those rates are used and any that differ from the table are listed in a warning. With the dated table, a fuel purchase dated outside its quarter fails a check; a purchase with no date is not judged by that check, and miles are never checked by date, so the flag does not prove the files are for that quarter.`,
      required: false
    },
    { name: "wholeGallons", kind: "boolean", label: "Round to whole gallons", description: "Optional. true (the default): gallons per jurisdiction are rounded to whole gallons; false: kept to 3 decimals.", required: false },
    { name: "totalMiles", kind: "number", label: "Total miles", description: "Optional. Total miles from the person's own summary, up to 3 decimal places, compared with the miles file.", required: false },
    { name: "totalGallons", kind: "number", label: "Total gallons", description: "Optional. Total gallons purchased from the person's own summary, up to 3 decimal places, compared with the fuel file.", required: false },
    { name: "mpgLow", kind: "number", label: "Lowest miles per gallon", description: 'Optional. With "mpgHigh", a band set by the person: fleet miles per gallon outside it is a warning. Up to 2 decimals.', required: false },
    { name: "mpgHigh", kind: "number", label: "Highest miles per gallon", description: "Optional. The top of the band, up to 2 decimals.", required: false },
    columnsInput("Miles file", MILES_COLUMNS, "milesColumns"),
    columnsInput("Fuel file", FUEL_COLUMNS, "fuelColumns")
  ],
  limits: "site",
  // The totals the person typed from their own summary: when only these fail, the page still shows its worksheet beside them.
  comparisonChecks: ["trk-ft-miles-typed", "trk-ft-gallons-typed"],
  notAdvice: "Mathproven works your own miles and gallons at the rates given. It does not compute surcharges, and the worksheet is not a return and is not in any agency's form layout.",
  run({ files, values }) {
    const milesFile = preferSheet(oneFile(files, "milesFile"), MILES_SHEET);
    const fuelFile = preferSheet(oneFile(files, "fuelFile"), FUEL_SHEET);
    const dated = values.useDatedTable === true;
    const given = typeof values.rates === "string" ? values.rates : "";
    const ratesText = given.trim() !== "" ? given : dated ? trkFuelRateFeed(DATED, DATED_FUEL).text : "";
    const m = trkExtractMiles(milesFile.rows, mapColumns(milesFile, MILES_COLUMNS, values.milesColumns, "Miles file"));
    const fuelMap = mapColumns(fuelFile, FUEL_COLUMNS, values.fuelColumns, "Fuel file");
    const f = trkExtractFuelCard(fuelFile.rows, fuelMap);
    const rates = trkParseRateText(ratesText);
    if (rates.rates.length === 0) throw new AgentInputError('Give the rate table in "rates", one jurisdiction and its rate per gallon on each line, or set "useDatedTable" to true.');
    const located = f.rows.filter((row2) => row2.jurisdiction !== "");
    if (f.rows.length > 0 && located.length === 0) {
      const header = fuelFile.rows[fuelMap.headerRow] ?? [];
      const read = (role) => fuelMap.columns[role] >= 0 ? `"${header[fuelMap.columns[role]] ?? ""}"` : "none found";
      throw new AgentInputError(
        `None of the ${f.rows.length} fuel purchase row(s) in the fuel file (${fuelFile.name}) names a jurisdiction, so no gallons can be placed in a state or province. Column read for ${TRK_FUEL_LABELS.jurisdiction}: ${read("jurisdiction")}; for ${TRK_FUEL_LABELS.location} (one ending in a two-letter code, such as "Amarillo, TX"): ${read("location")}. The file's headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}. Name the column with "fuelColumns", for example "${TRK_FUEL_LABELS.jurisdiction} = <header>".`
      );
    }
    const problems = [
      ...tagged(m.problems, "miles file"),
      ...tagged(f.problems, "fuel file"),
      ...f.rows.filter((row2) => row2.jurisdiction === "").map((row2) => ({ rowNumber: row2.rowNumber, reason: "fuel file: gallons with no jurisdiction" })),
      ...tagged(rates.problems, "rate table line")
    ];
    const skipped = [...tagged(m.skipped, "miles file"), ...tagged(f.skipped, "fuel file")];
    const wholeGallons = values.wholeGallons !== false;
    const r = trkQuarterlyFuelTax({
      miles: m.rows,
      fuel: located,
      rates: rates.rates,
      wholeGallons,
      typedTotalMilesK: scaled(values.totalMiles, 3, "total miles"),
      typedTotalGallonsK: scaled(values.totalGallons, 3, "total gallons"),
      mpgMinHundredths: scaled(values.mpgLow, 2, "lowest miles per gallon"),
      mpgMaxHundredths: scaled(values.mpgHigh, 2, "highest miles per gallon")
    });
    const notes = [`${rates.rates.length} rate(s) read${given.trim() !== "" ? " from the rate table given" : ""}.`];
    const datedChecks = [];
    if (dated) {
      datedChecks.push(trkCompareRatesToTable(rates.rates, DATED, DATED_FUEL), trkFuelSurchargeCheck(r.rows.map((row2) => row2.jurisdiction), DATED, DATED_FUEL));
      datedChecks.push(trkFuelDatesInTableQuarter(f.rows, DATED));
      notes.push(
        given.trim() !== "" ? `The rates given are compared with the ${TRK_FUEL_KIND_LABELS[DATED_FUEL]} base rates of the dated table for ${DATED.label}, checked ${DATED.checkedOn}. The worksheet does not compute surcharges.` : `The rates are the ${TRK_FUEL_KIND_LABELS[DATED_FUEL]} base rates of the dated table for ${DATED.label}, checked ${DATED.checkedOn}. The worksheet does not compute surcharges.`
      );
    }
    notes.push(wholeGallons ? "Gallons are rounded to whole gallons, half away from zero." : "Gallons are kept to 3 decimals.", "Miles per gallon is rounded to 2 decimals and tax to the cent, half away from zero.");
    return {
      summary: `${r.rows.length} jurisdiction(s): ${qty(r.totalMilesK, 3, true)} total miles and ${qty(r.totalPurchasedGallonsK, 3)} gallons purchased, so fleet miles per gallon is ${scaledFormat(r.mpgHundredths, 2)}. Net taxable gallons ${qty(r.totalNetGallonsK, 3, true)}; total tax at the rates given ${formatUSD(r.totalTaxCents)}. ${notes.join(" ")}`,
      tables: [{ name: "Worksheet", rows: trkFuelTaxTable(r) }],
      checks: [...r.checks, ...datedChecks, ...sheetRowChecks(problems, skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: 10,000.0 miles and 1,600.000 gallons, made-up rates for TX, OK and NM",
      args: { milesFile: "fixture:trucking/miles-by-jurisdiction.csv", fuelFile: "fixture:trucking/fuel-card.csv", rates: "Jurisdiction	Rate\nTX	0.2500\nOK	0.1850\nNM	0.2275", totalMiles: "10,000.0", totalGallons: "1,600.000" },
      verified: true,
      contains: [
        "| NM | 1650 | 300 | 264 | -36 | 0.2275 | -8.19 |",
        "| OK | 2150 | 401 | 344 | -57 | 0.1850 | -10.55 |",
        "| TX | 6200 | 900 | 992 | 92 | 0.2500 | 23.00 |",
        "| Total | 10000 | 1601 | 1600 | -1 |  | 4.26 |",
        "fleet miles per gallon is 6.25",
        "total tax at the rates given $4.26"
      ]
    },
    {
      label: "Total miles typed from a summary that the miles file does not reach are not verified",
      args: { milesFile: "fixture:trucking/miles-by-jurisdiction.csv", fuelFile: "fixture:trucking/fuel-card.csv", rates: "TX 0.2500\nOK 0.1850\nNM 0.2275", totalMiles: "10,200.0", totalGallons: "1,600.000" },
      verified: false,
      failedCheck: "trk-ft-miles-typed"
    },
    {
      label: "The same quarter at the dated third-quarter 2026 diesel table: every purchase is dated in that quarter",
      args: { milesFile: "fixture:trucking/miles-by-jurisdiction.csv", fuelFile: "fixture:trucking/fuel-card.csv", useDatedTable: true },
      verified: true,
      contains: ["| NM | 1650 | 300 | 264 | -36 | 0.2100 | -7.56 |", "| OK | 2150 | 401 | 344 | -57 | 0.1900 | -10.83 |", "| TX | 6200 | 900 | 992 | 92 | 0.2000 | 18.40 |", "fleet miles per gallon is 6.25", "base rates of the dated table for the third quarter of 2026"]
    },
    {
      label: "A jurisdiction with miles and fuel but no rate in the table given is not verified",
      args: { milesFile: "fixture:trucking/miles-by-jurisdiction.csv", fuelFile: "fixture:trucking/fuel-card.csv", rates: "TX 0.2500\nOK 0.1850" },
      verified: false,
      failedCheck: "trk-ft-rates"
    },
    {
      label: "Fourth-quarter purchases worked at the third-quarter dated table are not verified",
      args: {
        milesFile: "fixture:trucking/miles-by-jurisdiction.csv",
        fuelFile: "Date,State,Gallons\n2026-10-03,TX,450.000\n2026-10-09,OK,200.250\n2026-11-15,TX,450.000\n2026-11-21,OK,200.250\n2026-12-02,NM,299.500\n",
        useDatedTable: true
      },
      verified: false,
      failedCheck: "trk-fr-dates-in-quarter"
    },
    {
      label: "A fuel purchase that names no jurisdiction is not verified",
      args: {
        milesFile: "fixture:trucking/miles-by-jurisdiction.csv",
        fuelFile: 'Date,Location,Gallons\n2026-07-03,"Amarillo, TX",900.000\n2026-07-09,"Tulsa, OK",400.500\n2026-08-02,"Gallup, NM",299.500\n2026-08-05,Yard tank fill,80.000\n',
        rates: "TX 0.2500\nOK 0.1850\nNM 0.2275"
      },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var TRUCKING = [fuelTaxWorksheet, fuelCardLedger, unitMpg, costPerMile, logTemplate];
var TRUCKING_NOT_FOR_AGENTS = [];

export {
  FUEL_COLUMNS,
  MILES_COLUMNS,
  UNIT_MILES_COLUMNS,
  UNIT_FUEL_COLUMNS,
  TRUCKING,
  TRUCKING_NOT_FOR_AGENTS
};
