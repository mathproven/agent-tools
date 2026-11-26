// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  TRK_FUEL_KIND_LABELS,
  TRK_FUEL_LABELS,
  TRK_FUEL_ROLES,
  TRK_MILES_LABELS,
  TRK_MILES_ROLES,
  failures,
  formatUSD,
  parseAmount,
  passedAll,
  scaledFormat,
  scaledParseNumber,
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetNormalizeHeader,
  sheetRowChecks,
  sum,
  toDecimal,
  trkCompareRatesToTable,
  trkExtractFuelCard,
  trkExtractMiles,
  trkFuelDatesInTableQuarter,
  trkFuelRateFeed,
  trkFuelSurchargeCheck,
  trkFuelTaxTable,
  trkGuessFuelColumns,
  trkGuessMilesColumns,
  trkIsRounded,
  trkParseRateText,
  trkQuarterlyFuelTax,
  trkRoundDiv,
  trkSafe,
  warnings
} from "./fuelRates.mjs";

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
    for (const row2 of body) {
      const c = row2[i];
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
    for (const row2 of sheet.rows.slice(0, 200)) w = Math.max(w, String(row2[i] ?? "").length + 2);
    widths.push(Math.min(w, 60));
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row2, r) => {
    const cells = row2.map((cell, c) => {
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
      const row2 = [];
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
        while (row2.length < col) row2.push("");
        row2[col] = value;
      }
      while (rows.length < rowIndex) rows.push([]);
      rows[rowIndex] = row2;
      width = Math.max(width, row2.length);
    }
    for (const row2 of rows) while (row2.length < width) row2.push("");
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
  for (const s of sheets) for (const row2 of s.rows) for (const c of row2) if (typeof c === "string" && /^=/.test(c)) formulas = true;
  checks.that("values-only", "The workbook holds values only, no formulas", !formulas);
  return checks.all;
}

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
    } catch (err2) {
      out.problems.push({ rowNumber, reason: err2 instanceof Error ? err2.message : "could not be read" });
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
var sorted = (names) => [...new Set(names)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
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
  checks.that("trk-um-units", "Every unit with a miles row or a fuel row is in the result exactly once", wrongNames.length === 0, sorted(wrongNames).join(", "));
  const badMiles = rows.filter((r) => r.miles !== inputFor(r.unit).miles).map((r) => r.unit);
  const rowMiles = rows.reduce((n, r) => n + r.miles, 0n);
  const milesTotalsOk = totalMiles === rowMiles && totalMiles === shown.miles;
  checks.that(
    "trk-um-miles",
    "Each unit’s miles are its own miles rows added up, and the units add up to total miles",
    badMiles.length === 0 && milesTotalsOk,
    [sorted(badMiles).join(", "), milesTotalsOk ? "" : `miles rows ${k3(totalMiles)}, units ${k3(rowMiles)}, total ${k3(shown.miles)}`].filter(Boolean).join("; ")
  );
  if (typedMiles !== void 0) checks.equal("trk-um-miles-typed", "Total miles equal the total you typed", k3(typedMiles), k3(shown.miles));
  const badGallons = rows.filter((r) => r.gallons !== inputFor(r.unit).gallons).map((r) => r.unit);
  const rowGallons = rows.reduce((n, r) => n + r.gallons, 0n);
  const gallonsTotalsOk = totalGallons === rowGallons && totalGallons === shown.gallons;
  checks.that(
    "trk-um-gallons",
    "Each unit’s gallons are its own fuel rows added up, and the units add up to total gallons",
    badGallons.length === 0 && gallonsTotalsOk,
    [sorted(badGallons).join(", "), gallonsTotalsOk ? "" : `fuel rows ${k3(totalGallons)}, units ${k3(rowGallons)}, total ${k3(shown.gallons)}`].filter(Boolean).join("; ")
  );
  if (typedGallons !== void 0) checks.equal("trk-um-gallons-typed", "Total gallons equal the total you typed", k3(typedGallons), k3(shown.gallons));
  const badAmount = rows.filter((r) => r.amount !== inputFor(r.unit).amount).map((r) => r.unit);
  const rowAmount = rows.reduce((n, r) => n + r.amount, 0n);
  const amountTotalsOk = totalAmount === rowAmount && totalAmount === shown.amount;
  checks.that(
    "trk-um-amount",
    "Each unit’s fuel amount is its own fuel rows added up, and the units add up to the total fuel amount",
    badAmount.length === 0 && amountTotalsOk,
    [sorted(badAmount).join(", "), amountTotalsOk ? "" : `fuel rows ${scaledFormat(totalAmount, 2)}, units ${scaledFormat(rowAmount, 2)}, total ${scaledFormat(shown.amount, 2)}`].filter(Boolean).join("; ")
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
    sorted(badMpg).join(", ")
  );
  const fleetOk = totalGallons > 0n ? shown.mpg !== null && trkIsRounded(shown.mpg, totalMiles * 100n, totalGallons, 1n) : shown.mpg === null;
  checks.that(
    "trk-um-fleet-mpg",
    "Fleet miles per gallon is total miles divided by total gallons, rounded to 2 decimals",
    fleetOk,
    `total miles ${k3(totalMiles)}, total gallons ${k3(totalGallons)}, shown ${mpg2(shown.mpg)}`
  );
  const noGallons = sorted([...said].filter(([, s]) => s.miles > 0n && s.gallons <= 0n).map(([name]) => name));
  checks.that("trk-um-no-gallons", "Every unit with miles has gallons", noGallons.length === 0, `miles and no gallons, so no miles per gallon: ${noGallons.join(", ")}`, "warning");
  const noMiles = sorted([...said].filter(([, s]) => s.gallons !== 0n && s.miles === 0n).map(([name]) => name));
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
  const text = asText(value, input);
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => asText(v, input));
    } catch {
    }
  }
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
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
function labelKey(text) {
  return sheetNormalizeHeader(text.replace(/\([^)]*\)/g, " "));
}
function headerIndex(header, text) {
  const want = sheetNormalizeHeader(text);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want);
  if (exact >= 0) return exact;
  const letter = /^[A-Za-z]{1,2}$/.test(text.trim()) ? text.trim().toUpperCase() : "";
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
    const row2 = rowHolding(file.rows, headersNamed);
    if (row2 >= 0 && row2 !== mapping.headerRow) {
      const again = c.guess(file.rows, row2);
      mapping = again.headerRow === row2 ? again : { headerRow: row2, columns: Object.fromEntries(c.roles.map((r) => [r, -1])) };
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
  writeXlsx,
  readXlsx,
  parseCivilDate,
  AgentInputError,
  checkValue,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  TRK_FUEL_RATES_2026Q3,
  FUEL_COLUMNS,
  MILES_COLUMNS,
  UNIT_MILES_COLUMNS,
  UNIT_FUEL_COLUMNS,
  TRUCKING,
  TRUCKING_NOT_FOR_AGENTS
};
