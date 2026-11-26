// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  divRound,
  formatUSD,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/construction/fringeCredit.ts
var FRINGE_FULL_TIME_YEAR_HUNDREDTHS = 208e3;
var HOURS_TEXT = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/;
function parseFringeHours(text) {
  const s = String(text).trim();
  if (!s || s === "." || !HOURS_TEXT.test(s)) throw new Error(`"${s}" is not a number of hours (two decimal places at most, like 37.25)`);
  const [whole = "", frac = ""] = s.replace(/,/g, "").split(".");
  const hundredths = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(hundredths)) throw new Error(`"${s}" is too many hours to work with exactly`);
  return hundredths;
}
function assertHundredths(hundredths) {
  if (!Number.isSafeInteger(hundredths)) throw new Error("Hours must be whole hundredths of an hour");
  return hundredths;
}
function formatFringeHours(hundredths) {
  const abs = Math.abs(assertHundredths(hundredths));
  return `${hundredths < 0 ? "-" : ""}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
function fringeHoursDecimal(hundredths) {
  const abs = Math.abs(assertHundredths(hundredths));
  return `${hundredths < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
function fringeRowLabel(row, index) {
  const worker = String(row.worker ?? "").trim() || `Row ${index + 1}`;
  const classification = String(row.classification ?? "").trim();
  return classification ? `${worker} (${classification})` : worker;
}
function wholeCents(value, what) {
  if (!Number.isSafeInteger(value)) throw new Error(`${what} must be a whole number of cents.`);
  if (value < 0) throw new Error(`${what} cannot be negative.`);
  return value;
}
function wholeHundredths(value, what) {
  if (!Number.isSafeInteger(value)) throw new Error(`${what} must be in whole hundredths of an hour.`);
  if (value < 0) throw new Error(`${what} cannot be negative.`);
  return value;
}
function dollarsText(n, d, places) {
  const whole = n / d;
  let rem = n % d;
  let digits = "";
  while (digits.length < 2 || rem !== 0n && digits.length < places) {
    rem *= 10n;
    digits += String(rem / d);
    rem %= d;
  }
  return `$${Number(whole).toLocaleString("en-US")}.${digits}${rem === 0n ? "" : "…"}`;
}
function workingFor(x, credit, cash, excess, owed) {
  const usd = formatUSD;
  const hrs = formatFringeHours;
  const plan = BigInt(x.planCost);
  const divisor = BigInt(x.divisorHours);
  const creditWholeCents = plan * 100n % divisor === 0n;
  const parts = [`${usd(x.planCost)} ÷ ${hrs(x.divisorHours)} hours = ${dollarsText(plan, divisor, 4)} an hour${creditWholeCents ? "" : `, rounded down to ${usd(credit)}`}.`];
  if (credit < x.requiredFringe) parts.push(`${usd(x.requiredFringe)} − ${usd(credit)} = ${usd(cash)} cash fringe an hour.`);
  else if (credit === x.requiredFringe) parts.push(`The plan credit equals the ${usd(x.requiredFringe)} required fringe, so the cash fringe is ${usd(0)} an hour.`);
  else parts.push(`That is ${usd(excess)} more than the ${usd(x.requiredFringe)} required fringe, so the cash fringe is ${usd(0)} an hour; the ${usd(excess)} is shown as excess and not used.`);
  const product = BigInt(cash) * BigInt(x.jobHours);
  parts.push(`${usd(cash)} × ${hrs(x.jobHours)} hours = ${dollarsText(product, 10000n, 4)}${product % 100n === 0n ? "" : `, rounded to ${usd(owed)}`}.`);
  return parts.join(" ");
}
function computeRow(x, index) {
  const name = fringeRowLabel(x, index);
  const requiredFringe = wholeCents(x.requiredFringe, `${name}: the required fringe per hour`);
  const planCost = wholeCents(x.planCost, `${name}: the yearly plan cost`);
  const divisorHours = wholeHundredths(x.divisorHours, `${name}: the hours worked in the plan year`);
  const jobHours = wholeHundredths(x.jobHours, `${name}: the hours on this job`);
  if (divisorHours === 0) throw new Error(`${name}: enter the hours worked in the plan year on all work, the hours divisor. It has to be more than zero.`);
  if (jobHours > divisorHours) {
    throw new Error(
      `${name}: the hours on this job (${formatFringeHours(jobHours)}) are more than the hours divisor (${formatFringeHours(divisorHours)}). The divisor counts every hour worked in the period, these included, so it cannot be smaller.`
    );
  }
  const scaled = planCost * 100;
  if (!Number.isSafeInteger(scaled)) throw new Error(`${name}: the yearly plan cost is too large to work with exactly.`);
  const creditPerHour = (scaled - scaled % divisorHours) / divisorHours;
  const cashPerHour = creditPerHour < requiredFringe ? requiredFringe - creditPerHour : 0;
  const excessPerHour = creditPerHour > requiredFringe ? creditPerHour - requiredFringe : 0;
  const owedInHundredthsOfACent = cashPerHour * jobHours;
  if (!Number.isSafeInteger(owedInHundredthsOfACent)) throw new Error(`${name}: these amounts are too large to work with exactly.`);
  const cashOwed = divRound(owedInHundredthsOfACent, 100);
  const row = { worker: x.worker, classification: x.classification, requiredFringe, planCost, divisorHours, jobHours };
  return { ...row, creditPerHour, cashPerHour, excessPerHour, cashOwed, working: workingFor(row, creditPerHour, cashPerHour, excessPerHour, cashOwed) };
}
function computeFringeCredit(input) {
  if (!input || !Array.isArray(input.rows) || input.rows.length === 0) throw new Error("Add at least one worker row.");
  const rows = input.rows.map((x, i) => computeRow(x, i));
  let totalJobHours = 0;
  for (const r of rows) {
    totalJobHours += r.jobHours;
    if (!Number.isSafeInteger(totalJobHours)) throw new Error("The hours on this job add up to more than can be worked with exactly.");
  }
  const figures = { input, rows, totalJobHours, totalCashOwed: sum(rows.map((r) => r.cashOwed)) };
  return { ...figures, checks: verifyFringeCredit(figures) };
}
function verifyFringeCredit(f) {
  const checks = new CheckList();
  const usd = formatUSD;
  const hrs = formatFringeHours;
  const b = (n) => BigInt(n);
  const entries = f.input.rows;
  const label = (i) => fringeRowLabel(entries[i] ?? f.rows[i] ?? { worker: "", classification: "" }, i);
  const listed = (items) => items.join("; ");
  const sameEntries = (r, x) => r.worker === x.worker && r.classification === x.classification && r.requiredFringe === x.requiredFringe && r.planCost === x.planCost && r.divisorHours === x.divisorHours && r.jobHours === x.jobHours;
  const matched = f.rows.length === entries.length && f.rows.every((r, i) => sameEntries(r, entries[i]));
  checks.that("rows-match-input", "Every entered row has one result row, in the same order and with the same entries", matched, `${f.rows.length} result row(s) for ${entries.length} entered row(s), or a row's entries changed after the calculation`);
  const overCost = [];
  const badSplit = [];
  const overHours = [];
  const disagree = [];
  let owedTotal2 = 0n;
  let hoursTotal2 = 0n;
  entries.forEach((x, i) => {
    const plan = b(x.planCost);
    const divisor = b(x.divisorHours);
    const required = b(x.requiredFringe);
    const hours = b(x.jobHours);
    const credit2 = divisor > 0n ? plan * 100n / divisor : 0n;
    const cash2 = required > credit2 ? required - credit2 : 0n;
    const excess2 = credit2 > required ? credit2 - required : 0n;
    const owed2 = (2n * cash2 * hours + 100n) / 200n;
    owedTotal2 += owed2;
    hoursTotal2 += hours;
    if (hours > divisor) overHours.push(`${label(i)}: ${hrs(x.jobHours)} hours on this job, ${hrs(x.divisorHours)} in the divisor`);
    const r = f.rows[i];
    if (!r) return;
    const credit = b(r.creditPerHour);
    if (credit * divisor > plan * 100n) overCost.push(`${label(i)}: ${usd(r.creditPerHour)} × ${hrs(x.divisorHours)} hours is more than ${usd(x.planCost)}`);
    const split = credit < required ? required === credit + b(r.cashPerHour) && r.excessPerHour === 0 : r.cashPerHour === 0 && credit === required + b(r.excessPerHour);
    if (!split) badSplit.push(`${label(i)}: required ${usd(x.requiredFringe)}, plan credit ${usd(r.creditPerHour)}, cash fringe ${usd(r.cashPerHour)}, excess ${usd(r.excessPerHour)}`);
    const off = [
      credit !== credit2 ? `plan credit ${usd(r.creditPerHour)} shown, ${usd(Number(credit2))} worked again` : "",
      b(r.cashPerHour) !== cash2 ? `cash fringe ${usd(r.cashPerHour)} shown, ${usd(Number(cash2))} worked again` : "",
      b(r.excessPerHour) !== excess2 ? `excess ${usd(r.excessPerHour)} shown, ${usd(Number(excess2))} worked again` : "",
      b(r.cashOwed) !== owed2 ? `cash fringe owed ${usd(r.cashOwed)} shown, ${usd(Number(owed2))} worked again` : ""
    ].filter(Boolean);
    if (off.length) disagree.push(`${label(i)}: ${off.join(", ")}`);
  });
  checks.that("credit-within-plan-cost", "On every row, the plan credit per hour times the hours divisor is not more than the yearly plan cost", overCost.length === 0, listed(overCost));
  checks.that("fringe-split", "On every row, required fringe = plan credit + cash fringe per hour, or, where the credit is higher, plan credit = required fringe + excess", badSplit.length === 0, listed(badSplit));
  checks.that("hours-within-divisor", "On every row, the hours on this job are not more than the hours divisor, which includes them", overHours.length === 0, listed(overHours));
  let rowsOwed = 0n;
  let rowsHours = 0n;
  for (const r of f.rows) {
    rowsOwed += b(r.cashOwed);
    rowsHours += b(r.jobHours);
  }
  checks.equal("rows-add-to-total-cash", "The rows add up to the total cash fringe owed", usd(f.totalCashOwed), usd(Number(rowsOwed)));
  checks.equal("rows-add-to-total-hours", "The rows add up to the total hours on this job", hrs(f.totalJobHours), hrs(Number(rowsHours)));
  checks.that("rows-second-pass", "Every row's plan credit, cash fringe, excess and cash fringe owed, worked a second way, agree to the cent", disagree.length === 0, listed(disagree));
  checks.equal("total-cash-second-pass", "Total cash fringe owed, worked a second way from the entries", usd(Number(owedTotal2)), usd(f.totalCashOwed));
  checks.equal("total-hours-second-pass", "Total hours on this job, added a second way from the entries", hrs(Number(hoursTotal2)), hrs(f.totalJobHours));
  const excess = f.rows.map((r, i) => r.excessPerHour > 0 ? `${label(i)}: the plan credit of ${usd(r.creditPerHour)} an hour is ${usd(r.excessPerHour)} more than the ${usd(r.requiredFringe)} required; the ${usd(r.excessPerHour)} is shown as excess and not used` : "").filter(Boolean);
  checks.that("credit-not-above-required", "No plan credit is above its required fringe", excess.length === 0, listed(excess), "warning");
  const short = entries.map((x, i) => x.divisorHours < FRINGE_FULL_TIME_YEAR_HUNDREDTHS ? `${label(i)}: ${hrs(x.divisorHours)} hours` : "").filter(Boolean);
  checks.that(
    "divisor-full-year",
    "Every hours divisor is at least a full-time year of 2,080 hours (40 hours × 52 weeks)",
    short.length === 0,
    `${listed(short)}. Not wrong for a part year, a shorter period, or part-time work; worth a look.`,
    "warning"
  );
  const idle = entries.map((x, i) => x.jobHours === 0 ? label(i) : "").filter(Boolean);
  checks.that("hours-on-every-row", "Every row has hours on this job", idle.length === 0, `No hours on this job, so no cash fringe is owed on: ${listed(idle)}`, "warning");
  const byWorker = /* @__PURE__ */ new Map();
  for (const x of entries) {
    const key = String(x.worker ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!key) continue;
    const group = byWorker.get(key) ?? { name: String(x.worker).trim(), rows: [] };
    group.rows.push(x);
    byWorker.set(key, group);
  }
  const repeated = [...byWorker.values()].filter((g) => g.rows.length > 1);
  if (repeated.length > 0) {
    const differ = repeated.filter((g) => g.rows.some((x) => x.planCost !== g.rows[0].planCost || x.divisorHours !== g.rows[0].divisorHours)).map((g) => g.name);
    checks.that(
      "same-worker-same-plan",
      "A worker on more than one row has the same yearly plan cost and hours divisor on each",
      differ.length === 0,
      `${listed(differ)}: the plan cost or the hours divisor differs between rows, so the plan credit per hour differs too`,
      "warning"
    );
    const over = repeated.filter((g) => g.rows.reduce((a, x) => a + b(x.jobHours), 0n) > g.rows.reduce((m, x) => b(x.divisorHours) > m ? b(x.divisorHours) : m, 0n)).map((g) => g.name);
    checks.that(
      "worker-hours-within-divisor",
      "A worker on more than one row has no more hours on this job, rows together, than the hours divisor",
      over.length === 0,
      `${listed(over)}: the hours on this job, all rows together, are more than the hours divisor`,
      "warning"
    );
  }
  return checks.all;
}
var FRINGE_CREDIT_HEADERS = [
  "Worker",
  "Classification",
  "Required fringe per hour",
  "Yearly plan cost",
  "Hours worked in the plan year, all work",
  "Hours on this job",
  "Plan credit per hour",
  "Cash fringe per hour",
  "Credit above required, not used",
  "Cash fringe owed"
];
var FRINGE_CREDIT_NUMBER_COLUMNS = FRINGE_CREDIT_HEADERS.slice(2);
var READ_ON = "2026-10-14";
var ECFR_5_25 = "https://www.ecfr.gov/current/title-29/subtitle-A/part-5/subpart-B/section-5.25";
var FRINGE_CREDIT_SOURCES = [
  {
    citation: "29 CFR 5.25(c)(1)",
    covers: "The method: the plan contribution (for an unfunded plan, its reasonably anticipated cost) divided by the total hours worked in the period it covers, on covered and non-covered work alike, worked out for each worker when contributions differ.",
    sourceUrl: ECFR_5_25,
    checkedOn: READ_ON
  },
  {
    citation: "29 CFR 5.25(c)(2) and (c)(3)",
    covers: "The exceptions to annualizing, and how an exception is requested.",
    sourceUrl: ECFR_5_25,
    checkedOn: READ_ON
  },
  {
    citation: "Caltrans Labor Compliance Manual, section 13-4-2 and Figure 13-E",
    covers: "Fringe benefit annualization as the manual describes it: the total yearly cost over 2,080 hours (40 hours × 52 weeks), with a worked example for a laborer. Its exceptions are in section 13-4-2(a).",
    sourceUrl: "https://dot.ca.gov/programs/construction/labor-compliance/labor-compliance-manual/chapter-13#13-4-2",
    checkedOn: READ_ON
  },
  {
    citation: "US Department of Labor, Wage and Hour Division: Davis-Bacon compliance principles, fringe benefits",
    covers: "Worked examples of an hourly credit from a yearly or monthly plan cost, and the exceptions from annualization.",
    sourceUrl: "https://www.dol.gov/agencies/whd/government-contracts/prevailing-wage-resource-book/db-compliance-principles",
    checkedOn: READ_ON
  }
];
function fringeCreditTables(r) {
  const d = toDecimal;
  const hd = fringeHoursDecimal;
  return {
    rows: [
      [...FRINGE_CREDIT_HEADERS],
      ...r.rows.map((x) => [x.worker, x.classification, d(x.requiredFringe), d(x.planCost), hd(x.divisorHours), hd(x.jobHours), d(x.creditPerHour), d(x.cashPerHour), x.excessPerHour > 0 ? d(x.excessPerHour) : "", d(x.cashOwed)]),
      ["Total", "", "", "", "", hd(r.totalJobHours), "", "", "", d(r.totalCashOwed)]
    ],
    working: [["Worker and classification", "Working"], ...r.rows.map((x, i) => [fringeRowLabel(x, i), x.working])],
    sources: [["Source", "What it covers", "Address", "Read on"], ...FRINGE_CREDIT_SOURCES.map((s) => [s.citation, s.covers, s.sourceUrl, s.checkedOn])]
  };
}

export {
  FRINGE_FULL_TIME_YEAR_HUNDREDTHS,
  parseFringeHours,
  formatFringeHours,
  fringeHoursDecimal,
  fringeRowLabel,
  computeFringeCredit,
  verifyFringeCredit,
  FRINGE_CREDIT_HEADERS,
  FRINGE_CREDIT_NUMBER_COLUMNS,
  FRINGE_CREDIT_SOURCES,
  fringeCreditTables
};
