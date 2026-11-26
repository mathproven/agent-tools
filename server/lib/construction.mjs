// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  PAY_APP_FIELDS,
  checkPayApplication,
  computePayApplication,
  detectPayAppColumns,
  mapPayAppHeaders,
  parseSheetAmount,
  payAppCheckTables,
  payAppHeaderTexts,
  payAppNoFindingsText
} from "./payappcheck.mjs";
import {
  PROMPT_PAY_JOB_LABELS,
  PROMPT_PAY_PAYMENT_LABELS,
  PROMPT_PAY_TABLE,
  findPromptPayRow,
  promptPayPercent
} from "./promptPay.mjs";
import {
  STATUTORY_FORM_MISSING,
  WAIVER_TYPES,
  WAIVER_TYPE_LABELS,
  generateLienWaiver,
  lienWaiverPlainText
} from "./lienWaiver.mjs";
import {
  formatPercentBp,
  percentTextFromBp
} from "./percent.mjs";
import {
  refAddMonths,
  refMemberName
} from "./sourced.mjs";
import {
  stateName
} from "./usStates.mjs";
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
  oneFile
} from "./sheets.mjs";
import {
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  pmCellToIsoDate
} from "./reconcile.mjs";
import {
  addCalendarDays,
  calendarDaysBetween,
  civilDayNumber,
  daysInMonth,
  formatCivilDate,
  longDate,
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

// packages/core/src/construction/lateInterest.ts
var LATE_INTEREST_METHOD_LABELS = {
  daily: "Daily: the rate spread over each day late",
  month: "Per month: full months, then the days left over by the day",
  "month-or-fraction": "Per month or fraction: each month started counts as a whole month"
};
var RATE_YEARLY_MAX_BP = 1e4;
var DAYS_MAX = 36600;
function lateInterestRateLabel(rate2) {
  return `${promptPayPercent(rate2.bp)} per ${rate2.per}`;
}
function lateInterestRule(method, yearDays) {
  const round = "Each part is worked out exactly and rounded once to the cent, half a cent up; the interest is the sum of the rounded parts.";
  if (method === "daily") {
    return `Daily: the late amount times the daily rate times the days late. A yearly rate is divided by ${yearDays}; a monthly rate is multiplied by 12 and divided by ${yearDays}; a daily rate is used as it is. ${round}`;
  }
  if (method === "month") {
    return `Per month: each full month after the due date (to the same day of the month, or the month's last day when it is shorter) is charged the monthly rate, and the days left over are charged by the day, at twelve times the monthly rate divided by ${yearDays}. A yearly rate's monthly rate is a twelfth of it. ${round}`;
  }
  return `Per month or fraction: each month started after the due date counts as a whole month at the monthly rate, so one day into a month is charged the whole month. A yearly rate's monthly rate is a twelfth of it. The ${yearDays}-day year does not change this figure. ${round}`;
}
function isoDay(iso, label) {
  if (typeof iso !== "string" || iso.trim() === "") throw new Error(`Enter the ${label}.`);
  return formatCivilDate(parseCivilDate(iso.trim(), label));
}
function checkRate(rate2) {
  if (!rate2 || rate2.per !== "year" && rate2.per !== "month" && rate2.per !== "day") throw new Error("The rate must be per year, per month, or per day.");
  if (!Number.isSafeInteger(rate2.bp) || rate2.bp <= 0) throw new Error("Enter a rate above zero, with at most two decimals.");
  const yearly = rate2.per === "year" ? rate2.bp : rate2.per === "month" ? rate2.bp * 12 : rate2.bp * 365;
  if (yearly > RATE_YEARLY_MAX_BP) throw new Error("That rate is more than 100% a year. Check the rate and what it is per.");
  return { per: rate2.per, bp: rate2.bp };
}
function dailyFraction(amount, rate2, days, year) {
  const a = BigInt(amount);
  const bp = BigInt(rate2.bp);
  const t = BigInt(days);
  if (rate2.per === "day") return { n: a * bp * t, d: 10000n };
  if (rate2.per === "month") return { n: a * bp * 12n * t, d: 10000n * BigInt(year) };
  return { n: a * bp * t, d: 10000n * BigInt(year) };
}
function monthlyFraction(amount, rate2, months) {
  const a = BigInt(amount);
  const bp = BigInt(rate2.bp);
  const m = BigInt(months);
  if (rate2.per === "month") return { n: a * bp * m, d: 10000n };
  if (rate2.per === "year") return { n: a * bp * m, d: 120000n };
  throw new Error("A rate per day has no monthly rate. Pick the daily method for it.");
}
function roundHalfUp(n, d) {
  const q = n / d;
  return 2n * (n % d) >= d ? q + 1n : q;
}
function fullMonthsBetween(due, paid) {
  let k = 0;
  while (refAddMonths(due, k + 1) <= paid) k += 1;
  return k;
}
function dailyWorking(amount, rate2, days, year, result) {
  const p = promptPayPercent(rate2.bp);
  const d = `${days} ${days === 1 ? "day" : "days"}`;
  if (rate2.per === "day") return `${formatUSD(amount)} × ${p} × ${d} = ${formatUSD(result)}`;
  if (rate2.per === "month") return `${formatUSD(amount)} × ${p} × 12 × ${d} ÷ ${year} = ${formatUSD(result)}`;
  return `${formatUSD(amount)} × ${p} × ${d} ÷ ${year} = ${formatUSD(result)}`;
}
function monthlyWorking(amount, rate2, months, result) {
  const p = promptPayPercent(rate2.bp);
  const m = `${months} ${months === 1 ? "month" : "months"}`;
  return rate2.per === "year" ? `${formatUSD(amount)} × ${p} ÷ 12 × ${m} = ${formatUSD(result)}` : `${formatUSD(amount)} × ${p} × ${m} = ${formatUSD(result)}`;
}
function rowName(row, payment, table) {
  return `${refMemberName(table.members, row.code)}, ${PROMPT_PAY_JOB_LABELS[row.job].toLowerCase()} jobs: ${PROMPT_PAY_PAYMENT_LABELS[payment].toLowerCase()}`;
}
function computeLateInterest(input, table = PROMPT_PAY_TABLE) {
  const amount = assertCents(input.amount, "late amount");
  if (amount <= 0) throw new Error("Enter a late amount above zero.");
  if (input.method !== "daily" && input.method !== "month" && input.method !== "month-or-fraction") throw new Error("Pick a method.");
  if (input.yearDays !== 360 && input.yearDays !== 365) throw new Error("Pick a 360-day or a 365-day year.");
  const year = input.yearDays;
  let row = null;
  let deadline = null;
  if (input.row) {
    const found = findPromptPayRow(input.row.code, input.row.job, table);
    const name = refMemberName(table.members, input.row.code);
    if (!found) throw new Error(`${name} (${PROMPT_PAY_JOB_LABELS[input.row.job] ?? input.row.job} jobs) is not in the prompt payment table yet. Type the due date and the rate.`);
    const d = found.deadlines.find((x) => x.payment === input.row.payment);
    if (!d) throw new Error(`The ${name} row sets no day count for this payment.`);
    row = found;
    deadline = d;
  }
  const typedDue = typeof input.dueDate === "string" && input.dueDate.trim() !== "";
  let dueDate;
  let startDate = null;
  if (typedDue) {
    dueDate = isoDay(input.dueDate, "due date");
  } else {
    if (!deadline) throw new Error("Enter the due date, or pick a row of the table and the day its count starts.");
    if (deadline.count !== "calendar") throw new Error("This row counts business days, which depend on the holidays the section recognizes. Type the due date itself.");
    startDate = isoDay(input.startDate, "day the count starts");
    dueDate = addCalendarDays(startDate, deadline.days);
  }
  const paidDate = isoDay(input.paidDate, "payment date");
  let rate2;
  let rateSource;
  if (input.rate) {
    rate2 = checkRate(input.rate);
    rateSource = "typed";
  } else {
    if (!deadline) throw new Error("Type the rate, or pick a row of the table that has a fixed rate.");
    if (!deadline.rate) throw new Error(`The row stores no fixed rate (${deadline.rateText}). Type the rate.`);
    rate2 = { per: deadline.rate.per, bp: deadline.rate.bp };
    rateSource = "table";
  }
  if (rate2.per === "day" && input.method !== "daily") throw new Error("A rate per day has no monthly rate. Pick the daily method for it.");
  const daysLate = Math.max(0, calendarDaysBetween(dueDate, paidDate));
  if (daysLate > DAYS_MAX) throw new Error("The payment date is more than a hundred years after the due date.");
  const parts = [];
  let fullMonths = 0;
  let monthsEnd = dueDate;
  let leftoverDays = 0;
  let monthsCharged = 0;
  const part = (id, label, f, working) => {
    const c = Number(roundHalfUp(f.n, f.d));
    parts.push({ id, label, working: working(c), numerator: f.n, denominator: f.d, amount: c });
  };
  if (daysLate > 0) {
    if (input.method === "daily") {
      part("days", "Interest for the days late", dailyFraction(amount, rate2, daysLate, year), (c) => dailyWorking(amount, rate2, daysLate, year, c));
    } else {
      fullMonths = fullMonthsBetween(dueDate, paidDate);
      monthsEnd = refAddMonths(dueDate, fullMonths);
      leftoverDays = calendarDaysBetween(monthsEnd, paidDate);
      if (input.method === "month") {
        monthsCharged = fullMonths;
        if (fullMonths > 0) part("months", "Interest for the full months", monthlyFraction(amount, rate2, fullMonths), (c) => monthlyWorking(amount, rate2, fullMonths, c));
        if (leftoverDays > 0) part("leftover", "Interest for the days left over", dailyFraction(amount, rate2, leftoverDays, year), (c) => dailyWorking(amount, rate2, leftoverDays, year, c));
      } else {
        monthsCharged = fullMonths + (leftoverDays > 0 ? 1 : 0);
        part("months", "Interest for the months started", monthlyFraction(amount, rate2, monthsCharged), (c) => monthlyWorking(amount, rate2, monthsCharged, c));
      }
    }
  }
  const interest = assertCents(parts.reduce((s, p) => s + p.amount, 0), "interest");
  const steps = [];
  if (startDate !== null && deadline) {
    steps.push({ id: "due", label: "Due date", working: `${longDate(startDate)} + ${deadline.days} calendar days (the row's days)`, result: longDate(dueDate) });
  } else {
    steps.push({ id: "due", label: "Due date", working: "as entered", result: longDate(dueDate) });
  }
  steps.push({
    id: "days",
    label: "Days late",
    working: daysLate > 0 ? `from ${longDate(dueDate)} to ${longDate(paidDate)}` : `paid ${longDate(paidDate)}, on or before the due date`,
    result: `${daysLate} ${daysLate === 1 ? "day" : "days"}`
  });
  if (daysLate > 0 && input.method !== "daily") {
    steps.push({ id: "full-months", label: "Full months after the due date", working: fullMonths > 0 ? `${longDate(dueDate)} to ${longDate(monthsEnd)}` : "none: the payment came less than a month after the due date", result: `${fullMonths}` });
    steps.push({ id: "leftover", label: "Days left over after the full months", working: leftoverDays > 0 ? `${longDate(monthsEnd)} to ${longDate(paidDate)}` : "none", result: `${leftoverDays}` });
    if (input.method === "month-or-fraction") {
      steps.push({ id: "months-started", label: "Months charged (each month started counts)", working: leftoverDays > 0 ? `${fullMonths} + 1 for the part month` : `${fullMonths}, no part month`, result: `${monthsCharged}` });
    }
  }
  for (const p of parts) steps.push({ id: `part-${p.id}`, label: p.label, working: p.working, result: formatUSD(p.amount) });
  steps.push({
    id: "interest",
    label: "Interest",
    working: parts.length > 1 ? `${parts.map((p) => formatUSD(p.amount)).join(" + ")} = ${formatUSD(interest)}` : daysLate === 0 ? "no days late" : "the one part above",
    result: formatUSD(interest)
  });
  const figures = {
    input,
    row,
    deadline,
    rate: rate2,
    rateSource,
    dueDate,
    dueFrom: startDate !== null ? "table" : "typed",
    paidDate,
    daysLate,
    fullMonths,
    monthsEnd,
    leftoverDays,
    monthsCharged,
    parts,
    interest,
    steps,
    rule: lateInterestRule(input.method, year)
  };
  return { ...figures, checks: verifyLateInterest(figures, table) };
}
function daysByMonthWalk(fromIso, toIso) {
  if (toIso <= fromIso) return 0;
  const a = parseCivilDate(fromIso);
  const b = parseCivilDate(toIso);
  if (a.year === b.year && a.month === b.month) return b.day - a.day;
  let days = daysInMonth(a.year, a.month) - a.day;
  let y = a.year;
  let m = a.month + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  while (y < b.year || y === b.year && m < b.month) {
    days += daysInMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return days + b.day;
}
function roundSecondWay(n, d) {
  return (2n * n + d) / (2n * d);
}
function verifyLateInterest(r, table = PROMPT_PAY_TABLE) {
  const checks = new CheckList();
  const { input } = r;
  const amount = input.amount;
  if (input.row) {
    const tRow = findPromptPayRow(input.row.code, input.row.job, table);
    const tDeadline = tRow?.deadlines.find((d) => d.payment === input.row.payment);
    const sameDeadline = tDeadline !== void 0 && r.deadline !== null && JSON.stringify(tDeadline) === JSON.stringify(r.deadline);
    const sameRate = r.rateSource !== "table" || tDeadline?.rate != null && tDeadline.rate.bp === r.rate.bp && tDeadline.rate.per === r.rate.per;
    checks.that("li-row-from-table", "The days and the rate used from the table are the ones in its row for this state, job type, and payment", sameDeadline && sameRate, "The row in the result differs from the table");
  }
  checks.that("li-rate-source", "A rate typed is labeled as typed; a rate from the table is the row's own", r.rateSource === (input.rate ? "typed" : "table") && (!input.rate || input.rate.bp === r.rate.bp && input.rate.per === r.rate.per));
  const typedDue = typeof input.dueDate === "string" && input.dueDate.trim() !== "";
  if (!typedDue && r.deadline && typeof input.startDate === "string") {
    checks.equal("li-due-date", `The due date is ${r.deadline.days} calendar days after the day the count starts`, r.deadline.days, calendarDaysBetween(input.startDate.trim(), r.dueDate));
  } else {
    checks.equal("li-due-date", "The due date is the one entered", formatCivilDate(parseCivilDate(String(input.dueDate).trim())), r.dueDate);
  }
  checks.equal("li-paid-date", "The payment date is the one entered", formatCivilDate(parseCivilDate(input.paidDate.trim())), r.paidDate);
  const due = parseCivilDate(r.dueDate);
  const paid = parseCivilDate(r.paidDate);
  const first = Math.max(0, civilDayNumber(paid) - civilDayNumber(due));
  const second = daysByMonthWalk(r.dueDate, r.paidDate);
  checks.equal("li-days-first", "Days late, counted by day numbers", first, r.daysLate);
  checks.equal("li-days-second", "Days late, counted a second way by walking the months", second, r.daysLate);
  if (r.daysLate > 0) checks.equal("li-days-land", "The due date plus the days late is the payment date", r.paidDate, addCalendarDays(r.dueDate, r.daysLate));
  const monthly = input.method !== "daily" && r.daysLate > 0;
  if (monthly) {
    const reach = refAddMonths(r.dueDate, r.fullMonths);
    const next = refAddMonths(r.dueDate, r.fullMonths + 1);
    checks.that("li-months", `${r.fullMonths} full months reach the payment date and one more would pass it`, reach === r.monthsEnd && reach <= r.paidDate && next > r.paidDate, `Full months end ${reach}; one more ends ${next}; paid ${r.paidDate}`);
    checks.equal("li-months-add-up", "Days in the full months plus the days left over equal the days late", r.daysLate, daysByMonthWalk(r.dueDate, r.monthsEnd) + r.leftoverDays);
    const charged = input.method === "month" ? r.fullMonths : r.fullMonths + (r.leftoverDays > 0 ? 1 : 0);
    checks.equal("li-months-charged", input.method === "month" ? "Months charged are the full months" : "Months charged are the full months plus one for a part month", charged, r.monthsCharged);
  }
  const a = BigInt(amount);
  const bp = BigInt(r.rate.bp);
  const yr = BigInt(input.yearDays);
  const byDay = (days) => {
    const t = BigInt(days);
    if (r.rate.per === "day") return [a * t * bp, 10000n];
    if (r.rate.per === "month") return [12n * a * t * bp, yr * 10000n];
    return [a * t * bp, yr * 10000n];
  };
  const byMonth = (months) => [a * BigInt(months) * bp, r.rate.per === "year" ? 12n * 10000n : 10000n];
  const expected = [];
  if (r.daysLate > 0) {
    if (input.method === "daily") expected.push({ id: "days", f: byDay(second) });
    else if (input.method === "month") {
      if (r.fullMonths > 0) expected.push({ id: "months", f: byMonth(r.fullMonths) });
      if (r.leftoverDays > 0) expected.push({ id: "leftover", f: byDay(r.leftoverDays) });
    } else expected.push({ id: "months", f: byMonth(r.monthsCharged) });
  }
  const got = r.parts.map((p) => `${p.id} ${p.amount}`).join(", ");
  const want = expected.map((e) => `${e.id} ${roundSecondWay(e.f[0], e.f[1])}`).join(", ");
  checks.equal("li-parts-second", "Each part of the interest, worked a second way with half the divisor added before dividing", want, got);
  const outOfBounds = r.parts.filter((p) => {
    const diff = BigInt(p.amount) * p.denominator - p.numerator;
    return 2n * (diff < 0n ? -diff : diff) > p.denominator || expected.find((e) => e.id === p.id) === void 0;
  });
  const exactMatch = r.parts.every((p) => {
    const e = expected.find((x) => x.id === p.id);
    return e !== void 0 && e.f[0] * p.denominator === p.numerator * e.f[1];
  });
  checks.that("li-parts-bounds", "Each part is the exact figure rounded to the nearest cent (cross-multiplied)", outOfBounds.length === 0 && exactMatch && r.parts.length === expected.length, outOfBounds.map((p) => p.id).join(", ") || "a part's exact figure differs");
  checks.cents("li-interest-sum", "The interest is the sum of its parts", r.parts.reduce((s, p) => s + p.amount, 0), r.interest);
  if (r.daysLate === 0) checks.cents("li-on-time", "Paid on or before the due date: no interest", 0, r.interest);
  if (r.deadline && r.deadline.graceDays !== void 0) {
    checks.that("li-grace", "The row has no grace days this calculator leaves out", false, `The row's section owes interest only when payment is more than ${r.deadline.graceDays} days late${r.deadline.interestFromGrace ? ", and starts it after those days" : ""}. This calculator counts from the due date; the prompt payment deadlines page applies the grace days.`, "warning");
  }
  if (r.deadline && r.deadline.caveat) checks.that("li-caveat", "The row has no condition this calculator leaves out", false, r.deadline.caveat, "warning");
  if (r.deadline?.rate?.partMonthIsWhole && r.rateSource === "table" && input.method !== "month-or-fraction") {
    checks.that("li-row-method", "The method matches how the row states its rate", false, "The row says each part of a month counts as a month; the method picked works it another way.", "warning");
  }
  if (input.method === "month-or-fraction" || r.rate.per === "day") {
    checks.that("li-year-unused", "The year picked changes this figure", false, input.method === "month-or-fraction" ? "Per month or fraction counts months, not days: 360 and 365 give the same figure." : "A rate per day is used as it is: 360 and 365 give the same figure.", "warning");
  }
  return checks.all;
}
function lateInterestRows(r) {
  return [["Step", "Working", "Result"], ...r.steps.map((s, i) => [`${i + 1}. ${s.label}`, s.working, s.result])];
}
function lateInterestRowText(r, table = PROMPT_PAY_TABLE) {
  if (!r.row || !r.deadline || !r.input.row) return null;
  return `${rowName(r.row, r.input.row.payment, table)} (${r.row.citation}, checked ${r.row.checkedOn})`;
}
function compareLateInterest(input, table = PROMPT_PAY_TABLE) {
  const out = [];
  const combos = [["daily", 365], ["daily", 360], ["month", 365], ["month", 360], ["month-or-fraction", 365]];
  for (const [method, yearDays] of combos) {
    try {
      const r = computeLateInterest({ ...input, method, yearDays }, table);
      if (r.checks.every((c) => c.passed || c.severity === "warning")) out.push({ method, yearDays, interest: r.interest });
    } catch {
    }
  }
  return out;
}

// packages/core/src/construction/overunder.ts
function mulDivRound(a, b, d) {
  const product = a * b;
  if (Number.isSafeInteger(product)) return divRound(product, d);
  const n = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  const q = (2n * n + den) / (2n * den);
  return assertCents(Number(q), "earned revenue");
}
function computeOverUnder(jobsInput) {
  if (jobsInput.length === 0) throw new Error("Add at least one job");
  const jobs = jobsInput.map((j, i) => {
    const name = j.name.trim() || `Job ${i + 1}`;
    assertCents(j.contractAmount, `contract amount on ${name}`);
    assertCents(j.estimatedTotalCost, `estimated total cost on ${name}`);
    assertCents(j.costToDate, `cost to date on ${name}`);
    assertCents(j.billedToDate, `billed to date on ${name}`);
    if (j.estimatedTotalCost <= 0) throw new Error(`${name}: estimated total cost must be more than zero`);
    if (j.contractAmount < 0) throw new Error(`${name}: contract amount cannot be negative`);
    if (j.costToDate < 0) throw new Error(`${name}: cost to date cannot be negative`);
    if (j.billedToDate < 0) throw new Error(`${name}: billed to date cannot be negative`);
    const percentCompleteBp = mulDivRound(j.costToDate, 1e4, j.estimatedTotalCost);
    const earnedRevenue = mulDivRound(j.contractAmount, j.costToDate, j.estimatedTotalCost);
    const overUnder = j.billedToDate - earnedRevenue;
    return { ...j, name, percentCompleteBp, earnedRevenue, overUnder, overBilling: overUnder > 0 ? overUnder : 0, underBilling: overUnder < 0 ? -overUnder : 0 };
  });
  const overBilling = sum(jobs.map((j) => j.overBilling));
  const underBilling = sum(jobs.map((j) => j.underBilling));
  const estimatedTotalCost = sum(jobs.map((j) => j.estimatedTotalCost));
  const costToDate = sum(jobs.map((j) => j.costToDate));
  const totals = {
    contractAmount: sum(jobs.map((j) => j.contractAmount)),
    estimatedTotalCost,
    costToDate,
    billedToDate: sum(jobs.map((j) => j.billedToDate)),
    earnedRevenue: sum(jobs.map((j) => j.earnedRevenue)),
    overBilling,
    underBilling,
    netOverUnder: overBilling - underBilling,
    percentCompleteBp: mulDivRound(costToDate, 1e4, estimatedTotalCost)
  };
  const result = { jobs, totals, checks: [] };
  result.checks = verifyOverUnder(result);
  return result;
}
function isRoundedQuotient(rounded, a, b, d) {
  const diff = BigInt(a) * BigInt(b) - BigInt(rounded) * BigInt(d);
  const den = BigInt(d);
  return 2n * diff >= -den && 2n * diff < den;
}
function verifyOverUnder(r) {
  const checks = new CheckList();
  const B = (n) => BigInt(n);
  const usd = (n) => formatUSD(Number(n));
  const wrongPercent = [];
  const wrongEarned = [];
  const wrongOverUnder = [];
  const costOver = [];
  const billedOver = [];
  const t = { contract: 0n, est: 0n, cost: 0n, billed: 0n, earned: 0n, over: 0n, under: 0n };
  for (const j of r.jobs) {
    if (!isRoundedQuotient(j.percentCompleteBp, j.costToDate, 1e4, j.estimatedTotalCost)) wrongPercent.push(j.name);
    if (!isRoundedQuotient(j.earnedRevenue, j.contractAmount, j.costToDate, j.estimatedTotalCost)) wrongEarned.push(j.name);
    const diff = B(j.billedToDate) - B(j.earnedRevenue);
    const over = diff > 0n ? diff : 0n;
    const under = diff < 0n ? -diff : 0n;
    if (B(j.overUnder) !== diff || B(j.overBilling) !== over || B(j.underBilling) !== under) wrongOverUnder.push(j.name);
    if (j.costToDate > j.estimatedTotalCost) costOver.push(`${j.name} (${formatPercentBp(j.percentCompleteBp)} complete)`);
    if (j.billedToDate > j.contractAmount) billedOver.push(j.name);
    t.contract += B(j.contractAmount);
    t.est += B(j.estimatedTotalCost);
    t.cost += B(j.costToDate);
    t.billed += B(j.billedToDate);
    t.earned += B(j.earnedRevenue);
    t.over += over;
    t.under += under;
  }
  checks.that("percent-recompute", "Percent complete = cost to date ÷ estimated total cost on every job, proved a second way", wrongPercent.length === 0, `Disagrees on: ${wrongPercent.join(", ")}`);
  checks.that("earned-recompute", "Earned revenue = contract amount × cost to date ÷ estimated total cost on every job, proved a second way", wrongEarned.length === 0, `Disagrees on: ${wrongEarned.join(", ")}`);
  checks.that("over-under-recompute", "Over-billing or under-billing = billed to date − earned revenue on every job", wrongOverUnder.length === 0, `Disagrees on: ${wrongOverUnder.join(", ")}`);
  const s = r.totals;
  const total = (id, label, shown, added) => checks.that(id, label, B(shown) === added, `jobs add to ${usd(added)}, total shows ${formatUSD(shown)}`);
  total("total-contract", "Total contract amount = sum of all jobs", s.contractAmount, t.contract);
  total("total-estimated-cost", "Total estimated cost = sum of all jobs", s.estimatedTotalCost, t.est);
  total("total-cost", "Total cost to date = sum of all jobs", s.costToDate, t.cost);
  total("total-billed", "Total billed to date = sum of all jobs", s.billedToDate, t.billed);
  total("total-earned", "Total earned revenue = sum of all jobs", s.earnedRevenue, t.earned);
  total("total-over", "Total over-billing = sum of all jobs", s.overBilling, t.over);
  total("total-under", "Total under-billing = sum of all jobs", s.underBilling, t.under);
  checks.that(
    "net-ties-out",
    "Total over-billing − total under-billing = total billed − total earned revenue",
    B(s.netOverUnder) === t.over - t.under && t.over - t.under === t.billed - t.earned,
    `over − under is ${usd(t.over - t.under)}, billed − earned is ${usd(t.billed - t.earned)}, net shows ${formatUSD(s.netOverUnder)}`
  );
  checks.that(
    "portfolio-percent",
    "Portfolio percent complete = total cost to date ÷ total estimated cost, proved a second way",
    t.est > 0n && isRoundedQuotient(s.percentCompleteBp, Number(t.cost), 1e4, Number(t.est))
  );
  checks.that("cost-within-estimate", "No job has cost to date above its estimated total cost", costOver.length === 0, `Above estimate: ${costOver.join(", ")}`, "warning");
  checks.that("billed-within-contract", "No job has billed to date above its contract amount", billedOver.length === 0, `Above contract: ${billedOver.join(", ")}`, "warning");
  return checks.all;
}
function overUnderTables(r) {
  const d = toDecimal;
  const s = r.totals;
  const jobs = [
    ["Job", "Contract amount", "Estimated total cost", "Cost to date", "Percent complete", "Earned revenue", "Billed to date", "Over-billing", "Under-billing"],
    ...r.jobs.map((j) => [j.name, d(j.contractAmount), d(j.estimatedTotalCost), d(j.costToDate), formatPercentBp(j.percentCompleteBp), d(j.earnedRevenue), d(j.billedToDate), d(j.overBilling), d(j.underBilling)])
  ];
  const totals = [
    ["Portfolio total", "Amount"],
    ["Contract amount", d(s.contractAmount)],
    ["Estimated total cost", d(s.estimatedTotalCost)],
    ["Cost to date", d(s.costToDate)],
    ["Earned revenue", d(s.earnedRevenue)],
    ["Billed to date", d(s.billedToDate)],
    ["Over-billing", d(s.overBilling)],
    ["Under-billing", d(s.underBilling)],
    ["Net over-billing (negative is under-billing)", d(s.netOverUnder)]
  ];
  return { jobs, totals };
}

// packages/core/src/construction/payapptemplate.ts
var TEMPLATE_MAX_LINES = 500;
var TEMPLATE_SHEET_NAMES = ["Schedule of values", "Summary", "Instructions"];
var TEMPLATE_TOTALS_LABEL = "Totals";
var TEMPLATE_SCHEDULE_HEADERS = [
  "Item",
  "Description of work",
  "Scheduled value",
  "Work from previous applications",
  "Work this period",
  "Materials stored",
  "Total completed and stored",
  "Percent complete",
  "Balance to finish",
  "Retainage"
];
var SUMMARY_LINES = [
  "Original contract sum",
  "Net change orders",
  "Contract sum to date",
  "Total completed and stored to date",
  "Retainage on completed work",
  "Retainage on stored materials",
  "Retainage released to date",
  "Total retainage",
  "Total earned less retainage",
  "Previous certificates for payment",
  "Current payment due",
  "Balance to finish, including retainage"
];
function cleanName(value, label) {
  const s = value.replace(/[\u0000-\u001f\ufffe\uffff]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error(`${label} is longer than 120 characters`);
  return s;
}
function templateRetainageBp(retainagePercent) {
  let bp;
  try {
    bp = percentToBasisPoints(String(retainagePercent).trim() || "0");
  } catch {
    throw new Error("Retainage percent must be a number like 10 or 7.5, with at most two decimals");
  }
  if (bp > 1e4) throw new Error("Retainage percent cannot be more than 100");
  return bp;
}
function buildPayAppTemplate(input) {
  const project = cleanName(input.projectName, "Project name");
  const contractor = cleanName(input.contractorName, "Contractor name");
  if (!Number.isSafeInteger(input.lineCount) || input.lineCount < 1 || input.lineCount > TEMPLATE_MAX_LINES) {
    throw new Error(`Number of schedule lines must be a whole number from 1 to ${TEMPLATE_MAX_LINES}`);
  }
  const bp = templateRetainageBp(input.retainagePercent);
  const rate2 = `${percentTextFromBp(bp)}%`;
  const blank = TEMPLATE_SCHEDULE_HEADERS.slice(1).map(() => "");
  const schedule = [[...TEMPLATE_SCHEDULE_HEADERS]];
  for (let i = 1; i <= input.lineCount; i++) schedule.push([i, ...blank]);
  schedule.push([TEMPLATE_TOTALS_LABEL, ...blank]);
  const summary = [
    ["Pay application summary", "Value"],
    ["Project", project],
    ["Contractor", contractor],
    ["Application number", ""],
    ["Period to", ""],
    ["Retainage rate on completed work", rate2],
    ["Retainage rate on stored materials", rate2],
    ...SUMMARY_LINES.map((label) => [label, ""])
  ];
  const builder = input.builderUrl?.trim() || "/construction/pay-application/";
  const instructions = [
    ["Where", "What goes there"],
    ["About this workbook", "A blank pay application layout in generic progress billing terms. It holds values only, with no formulas, so nothing in it calculates."],
    ["Calculating and checking", `The pay application builder at ${builder} calculates every line and total from the same columns and checks them a second way.`],
    ["Schedule of values: Item", `Lines are numbered 1 to ${input.lineCount}. Change order lines can be added below them, above the ${TEMPLATE_TOTALS_LABEL} row.`],
    ["Schedule of values: Description of work", "A short name for the line."],
    ["Schedule of values: Scheduled value", "The value of the line. All lines together add up to the contract sum to date."],
    ["Schedule of values: Work from previous applications", "Work completed on earlier applications, not including stored materials."],
    ["Schedule of values: Work this period", "Work completed in the period this application covers."],
    ["Schedule of values: Materials stored", "Materials presently stored and not yet counted in completed work."],
    ["Schedule of values: Total completed and stored", "Work from previous applications + work this period + materials stored."],
    ["Schedule of values: Percent complete", "Total completed and stored ÷ scheduled value."],
    ["Schedule of values: Balance to finish", "Scheduled value − total completed and stored."],
    ["Schedule of values: Retainage", `Completed work × the work retainage rate + stored materials × the stored materials rate, each rounded to the cent. This workbook was made with ${rate2} for both.`],
    [`Schedule of values: ${TEMPLATE_TOTALS_LABEL} row`, "The sum of each amount column."],
    ["Summary: Contract sum to date", "Original contract sum + net change orders."],
    ["Summary: Total retainage", "Retainage on completed work + retainage on stored materials − retainage released to date."],
    ["Summary: Total earned less retainage", "Total completed and stored to date − total retainage."],
    ["Summary: Current payment due", "Total earned less retainage − previous certificates for payment."],
    ["Summary: Balance to finish, including retainage", "Contract sum to date − total earned less retainage."]
  ];
  return [
    { name: TEMPLATE_SHEET_NAMES[0], rows: schedule, money: TEMPLATE_SCHEDULE_HEADERS.filter((h) => h !== "Item" && h !== "Description of work" && h !== "Percent complete"), widths: [8, 36, 18, 30, 18, 18, 26, 18, 18, 14] },
    { name: TEMPLATE_SHEET_NAMES[1], rows: summary, money: [], widths: [40, 36] },
    { name: TEMPLATE_SHEET_NAMES[2], rows: instructions, money: [], widths: [48, 110] }
  ];
}
function verifyPayAppTemplate(input, read) {
  const checks = new CheckList();
  const bp = templateRetainageBp(input.retainagePercent);
  checks.equal("sheet-names", "The workbook has the schedule of values, summary, and instructions sheets", TEMPLATE_SHEET_NAMES.join(", "), read.map((s) => s.name).join(", "));
  const schedule = read[0]?.rows ?? [];
  const summary = read[1]?.rows ?? [];
  checks.equal("header-row", "The schedule of values header row has every column", TEMPLATE_SCHEDULE_HEADERS.join(" | "), (schedule[0] ?? []).join(" | "));
  checks.equal("row-count", "The schedule has one row per line, plus the header and the totals row", input.lineCount + 2, schedule.length);
  const numbers = schedule.slice(1, -1).map((r) => r[0] ?? "");
  checks.that("line-numbers", `Lines are numbered 1 to ${input.lineCount} with no gaps`, numbers.length === input.lineCount && numbers.every((n, i) => n === String(i + 1)));
  checks.equal("totals-row", "The last schedule row is the totals row", TEMPLATE_TOTALS_LABEL, schedule[schedule.length - 1]?.[0] ?? "");
  const cell = (label) => summary.find((r) => r[0] === label)?.[1] ?? "";
  checks.equal("summary-project", "The summary sheet carries the project name as typed", cleanName(input.projectName, "Project name"), cell("Project"));
  checks.equal("summary-contractor", "The summary sheet carries the contractor name as typed", cleanName(input.contractorName, "Contractor name"), cell("Contractor"));
  checks.equal("summary-rate", "The summary sheet carries the retainage rate as typed", `${percentTextFromBp(bp)}%`, cell("Retainage rate on completed work"));
  return checks.all;
}

// packages/core/src/construction/progressBilling.ts
var PROGRESS_MAX_ROWS = 200;
var STATEMENT_ROWS = [
  ["originalContractSum", "Original contract sum"],
  ["changeOrders", "Approved change orders"],
  ["contractSumToDate", "Contract sum to date"],
  ["billedToDate", "Billed to date"],
  ["previouslyBilled", "Less previously billed"],
  ["billedThisPeriod", "Billing this period"],
  ["retainageThisPeriod", "Less retainage this period"],
  ["dueThisPeriod", "Amount due this period"],
  ["unpaidPriorBalance", "Unpaid prior balance"],
  ["totalDueNow", "Total due now"],
  ["retainageToDate", "Retainage held to date"],
  ["balanceOfContract", "Balance of contract left to bill"]
];
function computeProgressBilling(input) {
  const original = assertCents(input.originalContractSum, "Original contract sum");
  if (original <= 0) throw new Error("Enter an original contract sum greater than zero");
  if (!Number.isSafeInteger(input.retainageBp) || input.retainageBp < 0 || input.retainageBp > 1e4) throw new Error("Retainage percent must be between 0% and 100%");
  if (input.changeOrders.length > PROGRESS_MAX_ROWS) throw new Error(`At most ${PROGRESS_MAX_ROWS} change orders`);
  const previouslyBilled = assertCents(input.previouslyBilled, "Previously billed");
  const previouslyPaid = assertCents(input.previouslyPaid, "Previously paid");
  if (previouslyBilled < 0) throw new Error("Previously billed cannot be negative");
  if (previouslyPaid < 0) throw new Error("Previously paid cannot be negative");
  const changeOrders = sum(input.changeOrders.map((c) => c.amount));
  const contractToDate = assertCents(original + changeOrders, "Contract sum to date");
  if (contractToDate <= 0) throw new Error("The change orders bring the contract sum to zero or below");
  let billedToDate;
  let milestoneTotal = null;
  if (input.basis.kind === "percent") {
    const bp = input.basis.percentCompleteBp;
    if (!Number.isSafeInteger(bp) || bp < 0 || bp > 1e4) throw new Error("Percent complete must be between 0% and 100%");
    billedToDate = applyRate(contractToDate, bp);
  } else {
    const ms = input.basis.milestones;
    if (ms.length === 0) throw new Error("Add at least one milestone");
    if (ms.length > PROGRESS_MAX_ROWS) throw new Error(`At most ${PROGRESS_MAX_ROWS} milestones`);
    milestoneTotal = sum(ms.map((m) => m.amount));
    billedToDate = sum(ms.filter((m) => m.reached).map((m) => m.amount));
  }
  const rate2 = input.retainageBp;
  const billedThisPeriod = billedToDate - previouslyBilled;
  const retainageToDate = applyRate(billedToDate, rate2);
  const retainagePrevious = applyRate(previouslyBilled, rate2);
  const retainageThisPeriod = retainageToDate - retainagePrevious;
  const dueThisPeriod = billedThisPeriod - retainageThisPeriod;
  const unpaidPriorBalance = previouslyBilled - retainagePrevious - previouslyPaid;
  const statement = {
    originalContractSum: original,
    changeOrders,
    contractSumToDate: contractToDate,
    percentBilledBp: Number((2n * BigInt(billedToDate) * 10000n + BigInt(contractToDate)) / (2n * BigInt(contractToDate))),
    billedToDate,
    previouslyBilled,
    billedThisPeriod,
    retainageToDate,
    retainagePrevious,
    retainageThisPeriod,
    dueThisPeriod,
    previouslyPaid,
    unpaidPriorBalance,
    totalDueNow: assertCents(dueThisPeriod + unpaidPriorBalance, "Total due now"),
    balanceOfContract: contractToDate - billedToDate
  };
  const usd = formatUSD;
  const checks = new CheckList();
  if (input.basis.kind === "milestones") {
    checks.cents("milestones-sum", "Milestones add up to the contract sum to date", contractToDate, milestoneTotal);
    const neg = input.basis.milestones.filter((m) => m.amount < 0).length;
    checks.that("milestones-positive", "No milestone amount is negative", neg === 0, `${neg} milestone(s) have a negative amount`);
  }
  checks.that("billed-within-contract", "Billed to date is not more than the contract sum to date", billedToDate <= contractToDate, `${usd(billedToDate)} billed against ${usd(contractToDate)}`);
  checks.that("previous-within-billed", "Previously billed is not more than billed to date", billedThisPeriod >= 0, `Previously billed ${usd(previouslyBilled)} is more than billed to date ${usd(billedToDate)}`);
  checks.addAll(verifyProgressBilling(input, statement));
  checks.that(
    "prior-not-overpaid",
    "Previously paid is not more than previous billings less their retainage",
    unpaidPriorBalance >= 0,
    `Previously paid ${usd(previouslyPaid)} is more than ${usd(previouslyBilled - retainagePrevious)} (previous billings less retainage at ${formatPercentBp(rate2)}); the statement shows the difference as a credit`,
    "warning"
  );
  return { input, statement, checks: checks.all };
}
function verifyProgressBilling(input, s) {
  const checks = new CheckList();
  const B = (n) => BigInt(n);
  const roundRate = (amount, bp) => {
    const p = amount * B(bp);
    const a = p < 0n ? -p : p;
    const q = (2n * a + 10000n) / 20000n;
    return p < 0n ? -q : q;
  };
  let co = 0n;
  for (const c of input.changeOrders) co += B(c.amount);
  const contract = B(input.originalContractSum) + co;
  let billed = 0n;
  if (input.basis.kind === "percent") billed = roundRate(contract, input.basis.percentCompleteBp);
  else for (const m of input.basis.milestones) if (m.reached) billed += B(m.amount);
  const prev = B(input.previouslyBilled);
  const retTo = roundRate(billed, input.retainageBp);
  const retPrev = roundRate(prev, input.retainageBp);
  const due = billed - retTo - (prev - retPrev);
  const unpaid = prev - retPrev - B(input.previouslyPaid);
  const same = (id, label, expected, actual) => checks.equal(id, `Second pass: ${label}`, expected.toString(), B(actual).toString());
  same("second-original", "original contract sum as entered", B(input.originalContractSum), s.originalContractSum);
  same("second-change-orders", "change orders as entered, added up", co, s.changeOrders);
  same("second-contract", "original contract sum plus change orders equals the contract sum to date", contract, s.contractSumToDate);
  same("second-billed", "billed to date", billed, s.billedToDate);
  same("second-previously-billed", "previously billed as entered", prev, s.previouslyBilled);
  same("second-period", "billing this period", billed - prev, s.billedThisPeriod);
  same("second-retainage-to-date", "retainage to date", retTo, s.retainageToDate);
  same("second-retainage-previous", "retainage on previous billings", retPrev, s.retainagePrevious);
  same("second-retainage", "retainage this period", retTo - retPrev, s.retainageThisPeriod);
  same("second-due", "amount due this period", due, s.dueThisPeriod);
  same("second-previously-paid", "previously paid as entered", B(input.previouslyPaid), s.previouslyPaid);
  same("second-unpaid-prior", "unpaid prior balance", unpaid, s.unpaidPriorBalance);
  same("second-total-due", "total due now", due + unpaid, s.totalDueNow);
  same("second-balance", "balance of contract", contract - billed, s.balanceOfContract);
  return checks.all;
}
function progressBillingTables(r) {
  const d = toDecimal;
  const s = r.statement;
  const negate = /* @__PURE__ */ new Set(["previouslyBilled", "retainageThisPeriod"]);
  return {
    statement: [["Progress billing statement", "Amount"], ...STATEMENT_ROWS.map(([k, label]) => [label, d(negate.has(k) ? -s[k] : s[k])])],
    changeOrders: [["Change order", "Amount"], ...r.input.changeOrders.map((c) => [c.description, d(c.amount)]), ["Total change orders", d(s.changeOrders)]],
    milestones: r.input.basis.kind === "milestones" ? [["Milestone", "Amount", "Reached"], ...r.input.basis.milestones.map((m) => [m.description, d(m.amount), m.reached ? "Yes" : "No"]), ["Billed to date", d(s.billedToDate), ""]] : []
  };
}

// packages/core/src/construction/retainage.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function computeRetainage(input) {
  if (input.periods.length === 0) throw new Error("Add at least one billing period");
  const invoiceAmount = input.invoiceAmount ?? 0;
  assertCents(invoiceAmount, "invoice amount");
  if (invoiceAmount < 0) throw new Error("The release invoice amount cannot be negative");
  let cumulativeWithheld = 0;
  let cumulativeReleased = 0;
  const periods = input.periods.map((p, i) => {
    const label = `period ${i + 1}`;
    assertCents(p.billed, `work billed in ${label}`);
    assertCents(p.released, `retainage released in ${label}`);
    if (p.periodDate !== "" && !ISO_DATE.test(p.periodDate)) throw new Error(`The date of ${label} must look like 2026-01-31`);
    if (!Number.isSafeInteger(p.rateBp) || p.rateBp < 0 || p.rateBp > 1e4) throw new Error(`The retainage rate of ${label} must be between 0% and 100%`);
    if (p.released < 0) throw new Error(`Retainage released in ${label} cannot be negative`);
    const withheld = applyRate(p.billed, p.rateBp);
    cumulativeWithheld = assertCents(cumulativeWithheld + withheld, "cumulative retainage withheld");
    cumulativeReleased = assertCents(cumulativeReleased + p.released, "cumulative retainage released");
    return { ...p, withheld, cumulativeWithheld, cumulativeReleased, balanceHeld: cumulativeWithheld - cumulativeReleased };
  });
  const totals = {
    billed: sum(periods.map((p) => p.billed)),
    withheld: sum(periods.map((p) => p.withheld)),
    released: sum(periods.map((p) => p.released)),
    balanceHeld: periods[periods.length - 1].balanceHeld
  };
  const invoice = invoiceAmount > 0 ? { amount: invoiceAmount, balanceBefore: totals.balanceHeld, balanceAfter: totals.balanceHeld - invoiceAmount } : null;
  const result = { input, periods, totals, invoice, checks: [] };
  result.checks = verifyRetainage(result);
  return result;
}
function verifyRetainage(r) {
  const checks = new CheckList();
  const B = (n) => BigInt(n);
  const rate2 = (cents, bp) => {
    const p = B(cents) * B(bp);
    const neg = p < 0n;
    const a = neg ? -p : p;
    let q = a / 10000n;
    if (a % 10000n * 2n >= 10000n) q += 1n;
    return neg ? -q : q;
  };
  const usd = (n) => formatUSD(Number(n));
  let billed = 0n;
  let withheld = 0n;
  let released = 0n;
  let balance = 0n;
  const wrongWithheld = [];
  const wrongRoll = [];
  const overReleased = [];
  const outOfOrder = [];
  const negativeBilled = [];
  r.input.periods.forEach((p, i) => {
    const out = r.periods[i];
    const name = p.periodDate || `period ${i + 1}`;
    const w = rate2(p.billed, p.rateBp);
    const prior = balance;
    billed += B(p.billed);
    withheld += w;
    released += B(p.released);
    balance = prior + w - B(p.released);
    if (!out || B(out.withheld) !== w) {
      wrongWithheld.push(`${name}: ${formatPercentBp(p.rateBp)} of ${formatUSD(p.billed)} is ${usd(w)}${out ? `, shown ${formatUSD(out.withheld)}` : ""}`);
    }
    const shownPrior = i === 0 ? 0n : B(r.periods[i - 1]?.balanceHeld ?? 0);
    if (!out || shownPrior + B(out.withheld) - B(out.released) !== B(out.balanceHeld) || B(out.cumulativeWithheld) !== withheld || B(out.cumulativeReleased) !== released) {
      wrongRoll.push(name);
    }
    if (B(p.released) > prior + w) {
      if (w < 0n && prior + w < 0n && B(p.released) <= 0n) {
        overReleased.push(`${name}: the credit of ${formatUSD(p.billed)} takes back ${usd(-w)} of retainage, but only ${usd(prior)} was held before it, so the balance held would be ${usd(prior + w)}`);
      } else if (w < 0n && prior + w < 0n) {
        overReleased.push(`${name}: the credit of ${formatUSD(p.billed)} takes back ${usd(-w)} of retainage and ${formatUSD(p.released)} was released, but only ${usd(prior)} was held before the period`);
      } else {
        overReleased.push(`${name}: released ${formatUSD(p.released)} with ${usd(prior + w)} held`);
      }
    }
    if (i > 0 && p.periodDate && r.input.periods[i - 1].periodDate && p.periodDate <= r.input.periods[i - 1].periodDate) outOfOrder.push(name);
    if (p.billed < 0) negativeBilled.push(name);
  });
  checks.that("periods-recompute", "Each period's retainage withheld = rate × work billed, on a second, independent pass", wrongWithheld.length === 0 && r.periods.length === r.input.periods.length, wrongWithheld.join("; "));
  checks.that("roll-forward", "Balance rolls forward every period: prior balance + withheld − released = balance held", wrongRoll.length === 0, `Does not roll forward at: ${wrongRoll.join(", ")}`);
  checks.that("release-within-held", "Retainage released never exceeds retainage held at any point", overReleased.length === 0, overReleased.join("; "));
  const t = r.totals;
  checks.that("total-billed", "Total work billed = sum of all periods", B(t.billed) === billed, `periods add to ${usd(billed)}, total shows ${formatUSD(t.billed)}`);
  checks.that("total-withheld", "Total retainage withheld = sum of all periods", B(t.withheld) === withheld, `periods add to ${usd(withheld)}, total shows ${formatUSD(t.withheld)}`);
  checks.that("total-released", "Total retainage released = sum of all periods", B(t.released) === released, `periods add to ${usd(released)}, total shows ${formatUSD(t.released)}`);
  checks.that("total-balance", "Balance held = total withheld − total released", B(t.balanceHeld) === withheld - released && B(t.balanceHeld) === balance, `withheld − released is ${usd(withheld - released)}, balance shows ${formatUSD(t.balanceHeld)}`);
  const invoiceAmount = B(r.input.invoiceAmount ?? 0);
  if (invoiceAmount > 0n) {
    checks.that(
      "invoice-within-balance",
      "Release invoice amount is not more than the balance held",
      invoiceAmount <= balance,
      `invoice is ${usd(invoiceAmount)}, balance held is ${usd(balance)}`
    );
    checks.that(
      "invoice-balance-after",
      "Balance held after the invoice = balance held − invoice amount",
      r.invoice !== null && B(r.invoice.amount) === invoiceAmount && B(r.invoice.balanceBefore) === balance && B(r.invoice.balanceAfter) === balance - invoiceAmount
    );
  } else {
    checks.that("invoice-absent", "No release invoice is shown without an invoice amount", r.invoice === null);
  }
  checks.that("dates-in-order", "Period dates are in order", outOfOrder.length === 0, `Out of order at: ${outOfOrder.join(", ")}`, "warning");
  checks.that("no-negative-billing", "No period has negative work billed", negativeBilled.length === 0, `Negative at: ${negativeBilled.join(", ")}`, "warning");
  return checks.all;
}
function retainageTables(r) {
  const d = toDecimal;
  const periods = [
    ["Period", "Work billed", "Retainage rate", "Retainage withheld", "Retainage released", "Cumulative withheld", "Cumulative released", "Balance held"],
    ...r.periods.map((p) => [p.periodDate, d(p.billed), formatPercentBp(p.rateBp), d(p.withheld), d(p.released), d(p.cumulativeWithheld), d(p.cumulativeReleased), d(p.balanceHeld)])
  ];
  const summary = [
    ["Summary", "Amount"],
    ["Total work billed", d(r.totals.billed)],
    ["Total retainage withheld", d(r.totals.withheld)],
    ["Total retainage released", d(r.totals.released)],
    ["Balance held", d(r.totals.balanceHeld)],
    ...r.invoice ? [["Release invoice amount", d(r.invoice.amount)], ["Balance held after this invoice", d(r.invoice.balanceAfter)]] : []
  ];
  return { periods, summary };
}

// packages/core/src/construction/retainageCalc.ts
function rate(bp, label) {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 1e4) throw new Error(`${label} must be between 0% and 100%`);
  return bp;
}
function bigRate(amount, bp) {
  return (2n * BigInt(amount) * BigInt(bp) + 10000n) / 20000n;
}
function computeRetainageCalc(input) {
  const contract = assertCents(input.contractAmount, "Contract amount");
  if (contract <= 0) throw new Error("Enter a contract amount greater than zero");
  const fullBp = rate(input.retainageBp, "Retainage percent");
  const byPercent = input.percentCompleteBp !== void 0;
  if (byPercent === (input.billedToDate !== void 0)) throw new Error("Enter either the percent complete or the amount billed to date, not both");
  if (input.reduced) {
    rate(input.reduced.thresholdBp, "The threshold percent");
    rate(input.reduced.rateBp, "The reduced retainage percent");
  }
  if (input.storedMaterials) {
    if (assertCents(input.storedMaterials.amount, "Stored materials") < 0) throw new Error("Stored materials cannot be negative");
    rate(input.storedMaterials.rateBp, "Retainage percent on stored materials");
  }
  const usd = formatUSD;
  const pct = formatPercentBp;
  const steps = [];
  const step = (id, label, working, amount) => {
    steps.push({ id, label, working, amount });
    return amount;
  };
  let work;
  if (byPercent) {
    const bp = rate(input.percentCompleteBp, "Percent complete");
    work = step("work", "Work billed to date", `${usd(contract)} × ${pct(bp)} = ${usd(applyRate(contract, bp))}`, applyRate(contract, bp));
  } else {
    work = assertCents(input.billedToDate, "Amount billed to date");
    if (work < 0) throw new Error("The amount billed to date cannot be negative");
    step("work", "Work billed to date", `${usd(work)} as entered`, work);
  }
  let thresholdAmount = null;
  let atFull = work;
  let atReduced = 0;
  let retFull;
  let retReduced = 0;
  if (input.reduced) {
    const { thresholdBp, rateBp } = input.reduced;
    thresholdAmount = step("threshold", "Threshold amount", `${usd(contract)} × ${pct(thresholdBp)} = ${usd(applyRate(contract, thresholdBp))}`, applyRate(contract, thresholdBp));
    atFull = step("at-full", "Work billed up to the threshold", `the lesser of ${usd(work)} and ${usd(thresholdAmount)} = ${usd(Math.min(work, thresholdAmount))}`, Math.min(work, thresholdAmount));
    atReduced = step("at-reduced", "Work billed after the threshold", `${usd(work)} − ${usd(atFull)} = ${usd(work - atFull)}`, work - atFull);
    retFull = step("ret-full", `Retainage at ${pct(fullBp)} on work up to the threshold`, `${usd(atFull)} × ${pct(fullBp)} = ${usd(applyRate(atFull, fullBp))}`, applyRate(atFull, fullBp));
    retReduced = step("ret-reduced", `Retainage at ${pct(rateBp)} on work after the threshold`, `${usd(atReduced)} × ${pct(rateBp)} = ${usd(applyRate(atReduced, rateBp))}`, applyRate(atReduced, rateBp));
  } else {
    retFull = step("ret-full", `Retainage at ${pct(fullBp)} on work billed`, `${usd(work)} × ${pct(fullBp)} = ${usd(applyRate(work, fullBp))}`, applyRate(work, fullBp));
  }
  const stored = input.storedMaterials?.amount ?? 0;
  let retStored = 0;
  if (input.storedMaterials) {
    const bp = input.storedMaterials.rateBp;
    retStored = step("ret-stored", `Retainage at ${pct(bp)} on stored materials`, `${usd(stored)} × ${pct(bp)} = ${usd(applyRate(stored, bp))}`, applyRate(stored, bp));
  }
  const parts = [retFull, ...input.reduced ? [retReduced] : [], ...input.storedMaterials ? [retStored] : []];
  const withheld = step("withheld", "Retainage withheld", parts.length > 1 ? `${parts.map(usd).join(" + ")} = ${usd(retFull + retReduced + retStored)}` : usd(retFull), assertCents(retFull + retReduced + retStored));
  const gross = step("gross", "Gross amount billed", input.storedMaterials ? `${usd(work)} + ${usd(stored)} = ${usd(work + stored)}` : usd(work), assertCents(work + stored));
  const net = step("net", "Net payable after retainage", `${usd(gross)} − ${usd(withheld)} = ${usd(gross - withheld)}`, gross - withheld);
  const figures = {
    input,
    steps,
    workBilled: work,
    thresholdAmount,
    atFullRate: atFull,
    atReducedRate: atReduced,
    retainageAtFullRate: retFull,
    retainageAtReducedRate: retReduced,
    storedMaterials: stored,
    retainageOnStored: retStored,
    grossBilled: gross,
    retainageWithheld: withheld,
    netPayable: net
  };
  return { ...figures, checks: verifyRetainageCalc(figures) };
}
function verifyRetainageCalc(r) {
  const { input } = r;
  const usd = formatUSD;
  const pct = formatPercentBp;
  const checks = new CheckList();
  const b = (n) => BigInt(n);
  const contract = input.contractAmount;
  const work2 = input.percentCompleteBp !== void 0 ? bigRate(contract, input.percentCompleteBp) : b(input.billedToDate ?? 0);
  checks.equal("work-second", "Work billed to date, worked a second way", work2.toString(), b(r.workBilled).toString());
  let full2 = work2;
  let reduced2 = 0n;
  if (input.reduced) {
    const t2 = bigRate(contract, input.reduced.thresholdBp);
    checks.equal("threshold-second", "Threshold amount, worked a second way", t2.toString(), b(r.thresholdAmount ?? -1).toString());
    reduced2 = work2 > t2 ? work2 - t2 : 0n;
    full2 = work2 - reduced2;
    checks.equal("split-second", "Work up to and after the threshold, worked a second way", `${full2} + ${reduced2}`, `${r.atFullRate} + ${r.atReducedRate}`);
    checks.cents("split-adds-back", "Work up to the threshold plus work after it equals work billed", r.workBilled, r.atFullRate + r.atReducedRate);
  }
  const stored = input.storedMaterials?.amount ?? 0;
  const retFull2 = bigRate(Number(full2), input.retainageBp);
  const retReduced2 = input.reduced ? bigRate(Number(reduced2), input.reduced.rateBp) : 0n;
  const retStored2 = input.storedMaterials ? bigRate(stored, input.storedMaterials.rateBp) : 0n;
  checks.equal("ret-full-second", "Retainage at the full rate, worked a second way", retFull2.toString(), b(r.retainageAtFullRate).toString());
  if (input.reduced) checks.equal("ret-reduced-second", "Retainage at the reduced rate, worked a second way", retReduced2.toString(), b(r.retainageAtReducedRate).toString());
  if (input.storedMaterials) checks.equal("ret-stored-second", "Retainage on stored materials, worked a second way", retStored2.toString(), b(r.retainageOnStored).toString());
  checks.equal("withheld-second", "Retainage withheld, re-added a second way", (retFull2 + retReduced2 + retStored2).toString(), b(r.retainageWithheld).toString());
  checks.equal("gross-second", "Gross amount billed, re-added a second way", (work2 + b(stored)).toString(), b(r.grossBilled).toString());
  checks.cents("withheld-plus-net", "Retainage withheld plus net payable equals the gross amount billed", r.grossBilled, r.retainageWithheld + r.netPayable);
  checks.that("withheld-within", "Retainage withheld is not more than the gross amount billed", r.retainageWithheld <= r.grossBilled && r.retainageWithheld >= 0);
  checks.that("billed-within-contract", "Work billed to date is not more than the contract amount", r.workBilled <= contract, `${usd(r.workBilled)} billed against a ${usd(contract)} contract. Approved changes may explain this; the contract amount entered does not include them.`, "warning");
  if (input.reduced) checks.that("reduced-is-lower", "The reduced rate is lower than the full rate", input.reduced.rateBp <= input.retainageBp, `The rate after the threshold (${pct(input.reduced.rateBp)}) is higher than the rate before it (${pct(input.retainageBp)})`, "warning");
  return checks.all;
}
function retainageCalcRows(r) {
  return [["Step", "Working", "Amount"], ...r.steps.map((s, i) => [`${i + 1}. ${s.label}`, s.working, toDecimal(s.amount)])];
}

// packages/core/src/construction/scheduleOfValues.ts
var SOV_MAX_LINES = 500;
var SOV_EXPORT_HEADERS = ["Item", "Description", "Scheduled value", "Previous work", "This period", "Stored materials", "Completed and stored", "Percent complete", "Balance to finish", "Retainage"];
function assertPercent(bp, label) {
  if (bp === void 0 || !Number.isSafeInteger(bp) || bp < 0 || bp > 1e4) throw new Error(`${label}: the percent must be between 0 and 100`);
  return bp;
}
function buildScheduleOfValues(input) {
  const contract = assertCents(input.contractSum, "Contract sum");
  if (contract <= 0) throw new Error("Enter a contract sum greater than zero");
  if (input.entries.length === 0) throw new Error("Add at least one line");
  if (input.entries.length > SOV_MAX_LINES) throw new Error(`A schedule can have at most ${SOV_MAX_LINES} lines`);
  const entries = input.entries.map((e, i) => {
    const label = e.description.trim() || `Line ${i + 1}`;
    if (e.kind === "fixed") {
      if (e.amount === void 0) throw new Error(`${label}: enter the fixed amount`);
      return { ...e, amount: assertCents(e.amount, label), percentBp: void 0 };
    }
    if (e.kind !== "percent" && e.kind !== "spread") throw new Error(`${label}: unknown line type`);
    return { ...e, amount: void 0, percentBp: assertPercent(e.percentBp, label) };
  });
  const work = entries.filter((e) => e.kind !== "spread");
  if (work.length === 0) throw new Error("Add at least one line that is not spread across the others");
  const fixedTotal = sum(entries.filter((e) => e.kind === "fixed").map((e) => e.amount));
  const remainder = assertCents(contract - fixedTotal, "Contract sum less fixed amounts");
  const sharing = entries.filter((e) => e.kind !== "fixed");
  const percentTotalBp = sharing.reduce((a, e) => a + e.percentBp, 0);
  const shares = /* @__PURE__ */ new Map();
  if (sharing.length > 0) {
    if (percentTotalBp === 0) {
      if (remainder !== 0) throw new Error("The percent lines are all 0%, so nothing can be divided among them");
      for (const e of sharing) shares.set(e, 0);
    } else {
      const parts = allocate(remainder, sharing.map((e) => e.percentBp));
      sharing.forEach((e, i) => shares.set(e, parts[i]));
    }
  }
  const spreadLines = entries.filter((e) => e.kind === "spread").map((e) => ({ description: e.description.trim(), percentBp: e.percentBp, amount: shares.get(e) }));
  const spreadTotal = sum(spreadLines.map((s) => s.amount));
  const bases = work.map((e) => e.kind === "fixed" ? e.amount : shares.get(e));
  let spreadShares = bases.map(() => 0);
  if (spreadTotal !== 0) {
    const weights = bases.map((b) => Math.max(0, b));
    if (weights.every((w) => w === 0)) throw new Error("Overhead cannot be spread because the other lines have no value");
    spreadShares = allocate(spreadTotal, weights);
  }
  const lines = work.map((e, i) => ({
    itemNo: String(i + 1),
    description: e.description.trim(),
    kind: e.kind,
    ...e.kind === "percent" ? { percentBp: e.percentBp } : {},
    baseAmount: bases[i],
    spreadShare: spreadShares[i],
    scheduledValue: assertCents(bases[i] + spreadShares[i], "Scheduled value")
  }));
  const scheduled = sum(lines.map((l) => l.scheduledValue));
  const result = {
    input,
    lines,
    spreadLines,
    totals: { contractSum: contract, fixed: fixedTotal, remainder, percentBp: percentTotalBp, spread: spreadTotal, scheduled }
  };
  const checks = new CheckList();
  checks.cents("lines-sum", "Schedule of values lines add up to the contract sum", contract, scheduled);
  if (sharing.length === 0) {
    checks.cents("coverage", "Fixed amounts cover the whole contract sum", contract, fixedTotal);
  } else {
    const diff = BigInt(percentTotalBp) * BigInt(contract) - BigInt(remainder) * 10000n;
    const within = 2n * (diff < 0n ? -diff : diff) <= BigInt(contract);
    const fixedCount = entries.length - sharing.length;
    checks.that(
      "coverage",
      fixedCount === 0 ? "Percents total 100%" : "Fixed amounts plus percent lines cover the whole contract sum",
      within,
      fixedCount === 0 ? `The percents total ${formatPercentBp(percentTotalBp)}, not 100.00%` : `Fixed amounts are ${formatUSD(fixedTotal)}, which leaves ${formatUSD(remainder)} of the ${formatUSD(contract)} contract; the percent lines total ${formatPercentBp(percentTotalBp)} of the contract, which does not match what is left to the nearest 0.01%`
    );
  }
  const negative = lines.filter((l) => l.scheduledValue < 0 || l.baseAmount < 0);
  checks.that("no-negative", "No line is negative", negative.length === 0 && spreadLines.every((s) => s.amount >= 0), negative.length ? `Negative: ${negative.map((l) => `line ${l.itemNo}`).join(", ")}` : "A spread line is negative because the fixed amounts are more than the contract sum");
  checks.cents("spread-sum", "Spread shares add up to the amount being spread", spreadTotal, sum(lines.map((l) => l.spreadShare)));
  checks.addAll(verifyScheduleOfValues(result));
  const zero = lines.filter((l) => l.scheduledValue === 0);
  checks.that("no-zero", "Every line has a value", zero.length === 0, `Zero value: ${zero.map((l) => `line ${l.itemNo}`).join(", ")}`, "warning");
  const unnamed = lines.filter((l) => l.description === "");
  checks.that("described", "Every line has a description", unnamed.length === 0, `No description: ${unnamed.map((l) => `line ${l.itemNo}`).join(", ")}`, "warning");
  return { ...result, checks: checks.all };
}
function verifyScheduleOfValues(r) {
  const checks = new CheckList();
  const big = (n) => BigInt(n);
  let base = 0n;
  let spread = 0n;
  let scheduled = 0n;
  let rowsOk = true;
  for (const l of r.lines) {
    base += big(l.baseAmount);
    spread += big(l.spreadShare);
    scheduled += big(l.scheduledValue);
    if (big(l.baseAmount) + big(l.spreadShare) !== big(l.scheduledValue)) rowsOk = false;
  }
  const spreadPool = r.spreadLines.reduce((a, s) => a + big(s.amount), 0n);
  const contract = big(r.input.contractSum);
  checks.that("second-pass-rows", "Second pass: each scheduled value equals its own amount plus its spread share", rowsOk);
  checks.equal("second-pass-total", "Second pass: lines re-added with separate arithmetic equal the contract sum", contract.toString(), scheduled.toString());
  checks.equal("second-pass-spread", "Second pass: amounts before spreading plus the amount spread equal the contract sum", contract.toString(), (base + spreadPool).toString());
  checks.that("second-pass-spread-shares", "Second pass: spread shares re-add to the amount spread", spread === spreadPool);
  const fixed = r.lines.filter((l) => l.kind === "fixed").reduce((a, l) => a + big(l.baseAmount), 0n);
  const remainder = contract - fixed;
  const sharing = [...r.lines.filter((l) => l.kind === "percent").map((l) => ({ bp: l.percentBp ?? 0, amount: l.baseAmount })), ...r.spreadLines.map((s) => ({ bp: s.percentBp, amount: s.amount }))];
  const bpTotal = sharing.reduce((a, s) => a + big(s.bp), 0n);
  let sharesOk = true;
  if (bpTotal > 0n && remainder >= 0n) {
    for (const s of sharing) {
      const floor = remainder * big(s.bp) / bpTotal;
      if (big(s.amount) < floor || big(s.amount) > floor + 1n) sharesOk = false;
    }
  }
  checks.that("second-pass-shares", "Second pass: each percent line is within one cent of its exact share", sharesOk);
  return checks.all;
}
function sovExportRows(r) {
  const d = toDecimal;
  return [
    [...SOV_EXPORT_HEADERS],
    ...r.lines.map((l) => [l.itemNo, l.description, d(l.scheduledValue), d(0), d(0), d(0), d(0), "0.00", d(l.scheduledValue), d(0)]),
    ["Totals", "", d(r.totals.scheduled), d(0), d(0), d(0), d(0), "0.00", d(r.totals.scheduled), d(0)]
  ];
}
function sovWorkingRows(r) {
  const d = toDecimal;
  return [
    ["Item", "Description", "Entered as", "Amount before spread", "Spread share", "Scheduled value"],
    ...r.lines.map((l) => [l.itemNo, l.description, l.kind === "fixed" ? "Fixed amount" : `${percentTextFromBp(l.percentBp ?? 0)}% of contract`, d(l.baseAmount), d(l.spreadShare), d(l.scheduledValue)]),
    ...r.spreadLines.map((s) => ["", `${s.description || "Spread line"} (spread across the lines above)`, `${percentTextFromBp(s.percentBp)}% of contract`, d(s.amount), d(-s.amount), d(0)]),
    ["Totals", "", "", d(r.totals.scheduled), d(0), d(r.totals.scheduled)]
  ];
}
function sovToPayAppFile(r, retainageBp = 1e3) {
  if (!Number.isSafeInteger(retainageBp) || retainageBp < 0 || retainageBp > 1e4) throw new Error("Retainage must be between 0% and 100%");
  const rate2 = percentTextFromBp(retainageBp);
  return {
    appNo: "1",
    periodTo: "",
    original: toDecimal(r.totals.scheduled),
    changeOrders: "0.00",
    retWork: rate2,
    retStored: rate2,
    released: "0.00",
    previousCerts: "0.00",
    lines: r.lines.map((l) => ({ itemNo: l.itemNo, description: l.description, scheduledValue: toDecimal(l.scheduledValue), previouslyCompleted: "0.00", thisPeriod: "0.00", materialsStored: "0.00" }))
  };
}

// packages/agents/src/registry/construction.ts
var RowProblem = class extends Error {
};
function readRows(file, c, override, label, o) {
  const map = mapColumns(file, c, typeof override === "string" ? override : void 0, label);
  o.vet?.(map.columns, file.rows[map.headerRow] ?? []);
  const used = c.roles.filter((r) => map.columns[r] >= 0);
  const out = { items: [], problems: [], leftOut: [], totals: [], columns: map.columns };
  const fixFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let lastTotal = 0;
  for (const { rowNumber, cells } of sheetDataRows(file.rows, map.headerRow)) {
    const cell = (r) => sheetCell(cells, map.columns[r]);
    const first = cells.find((x) => x.trim() !== "")?.trim() ?? "";
    if (sheetIsTotalWord(first)) {
      const t = o.total(cell, out.items, out.items.slice(lastTotal));
      if (t.ok) {
        out.leftOut.push({ rowNumber, reason: t.figures ? "The file's own total line: its figures equal the sum of the rows above it" : "A total line with no figures in the columns read" });
        if (t.figures) out.totals.push(rowNumber);
        lastTotal = out.items.length;
      } else {
        out.problems.push({ rowNumber, reason: `"${first}" starts with a total word, but ${t.reason}, so it is read neither as the file's total nor as a ${o.noun} (give it another name if it is a ${o.noun})` });
      }
      continue;
    }
    if (used.every((r) => cell(r) === "")) {
      out.leftOut.push({ rowNumber, reason: "Nothing in the columns this tool reads (a heading or a note)" });
      continue;
    }
    try {
      out.items.push(o.read(cell, { index: out.items.length, rowNumber, has: (r) => map.columns[r] >= 0 }));
    } catch (err) {
      if (err instanceof RowProblem) out.problems.push({ rowNumber, reason: fixFirst(err.message) });
      else throw err;
    }
  }
  return out;
}
function rowAccounting(x) {
  const checks = sheetRowChecks(x.problems, x.leftOut);
  if (x.totals.length > 0) {
    const many = x.totals.length > 1;
    checks.push({ id: "file-total-lines", label: `The file's own total line${many ? "s" : ""} (row ${x.totals.join(", ")}) equal${many ? "" : "s"} the sum of the rows above ${many ? "them" : "it"}`, passed: true, severity: "error" });
  }
  return checks;
}
function nothingRead(x, what) {
  if (x.problems.length === 0) throw new AgentInputError(`The ${what} has no rows with data under its header row.`);
  return { summary: "", tables: [], checks: rowAccounting(x) };
}
var moneySum = (role, label, of) => ({ role, label, of, read: (raw) => centsCell(raw, `the ${label}`), show: formatUSD });
function sumsTo(fields) {
  return (cell, above, sinceLast) => {
    let figures = false;
    for (const f of fields) {
      const raw = cell(f.role);
      if (raw === "") continue;
      figures = true;
      let n;
      try {
        n = f.read(raw);
      } catch {
        return { ok: false, reason: `its ${f.label} "${raw}" cannot be read` };
      }
      const all = above.reduce((s, t) => s + f.of(t), 0);
      const part = sinceLast.reduce((s, t) => s + f.of(t), 0);
      if (n !== all && n !== part) return { ok: false, reason: `its ${f.label} (${f.show(n)}) is not the sum of the rows above it (${f.show(all)})` };
    }
    return { ok: true, figures };
  };
}
function guessWithout(roles, synonyms, notInput) {
  return (rows, at) => sheetGuessColumns(rows.map((r, i) => i < 60 ? r.map((cell) => notInput.test(sheetNormalizeHeader(cell)) ? "" : cell) : r), roles, synonyms, at);
}
function namedHeaders(override) {
  return str(override).split(/[,;\n]/).map((p) => p.includes("=") ? sheetNormalizeHeader(p.slice(p.indexOf("=") + 1)) : "").filter((h) => h !== "");
}
function centsCell(raw, what) {
  const p = parseSheetAmount(raw);
  if (p.kind === "blank") return 0;
  if (p.kind === "bad") throw new RowProblem(`${what} "${raw}" is not an amount`);
  if (!p.clean) throw new RowProblem(`${what} "${raw}" has more precision than a cent`);
  return p.cents;
}
function hoursCell(raw, what) {
  if (raw.trim() === "") return 0;
  try {
    return parseFringeHours(raw);
  } catch {
    throw new RowProblem(`${what} "${raw}" is not a number of hours with at most two decimals`);
  }
}
function fractionLike(text, bp) {
  return !text.trim().endsWith("%") && bp > 0 && bp <= 100;
}
var FRACTION = "reads like a fraction (a spreadsheet stores 10% as 0.1 and 100% as 1); write the percent, like 10 or 10%";
function percentCell(raw, what, blank) {
  const s = raw.trim();
  if (s === "") return blank;
  const signed = s.endsWith("%");
  let bp;
  try {
    bp = percentToBasisPoints(signed ? s.slice(0, -1).trim() : s);
  } catch {
    throw new RowProblem(`${what} "${raw}" is not a percent with at most two decimals, like 10 or 7.5`);
  }
  if (bp > 1e4) throw new RowProblem(`${what} "${raw}" is more than 100%`);
  if (fractionLike(s, bp)) throw new RowProblem(`${what} "${raw}" ${FRACTION}`);
  return bp;
}
var str = (v) => typeof v === "string" ? v : "";
var centsOr = (v, fallback = 0) => typeof v === "number" ? v : fallback;
function dayOf(now) {
  const d = new Date(now.getTime());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function percentValue(v, label, fallback) {
  const raw = typeof v === "string" ? v : fallback;
  if (raw === void 0) throw new AgentInputError(`${label} is needed.`);
  const s = raw.trim().replace(/%$/, "").trim();
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new AgentInputError(`${label} must be a percent from 0 to 100 with at most two decimals, like 10 or 7.5 (given "${raw}").`);
  }
  if (bp > 1e4) throw new AgentInputError(`${label} cannot be more than 100% (given "${raw}").`);
  return bp;
}
var PAY_APP_LABELS = Object.fromEntries(PAY_APP_FIELDS.map((f) => [f.field, f.label]));
var LI_JOBS = ["public", "private", "both"];
var LI_PAYMENTS = ["owner", "local", "sub"];
var LI_METHODS = ["daily", "month", "month-or-fraction"];
function promptPayRow(code, job, payment) {
  const rows = PROMPT_PAY_TABLE.rows.filter((r) => r.code === code);
  if (rows.length === 0) {
    const codes = [...new Set(PROMPT_PAY_TABLE.rows.map((r) => r.code))].sort().join(", ");
    throw new AgentInputError(`"${code}" has no row in the prompt payment deadlines table. Give "dueDate" and "rate" instead, or a state the table has: ${codes}.`);
  }
  const name = refMemberName(PROMPT_PAY_TABLE.members, code);
  const jobs = rows.map((r) => r.job).join(", ");
  const row = job ? rows.find((r) => r.job === job) : rows.length === 1 ? rows[0] : void 0;
  if (!row) throw new AgentInputError(job ? `The table has no ${job} row for ${name}; its rows are for: ${jobs}.` : `${name} has ${rows.length} rows in the table (${jobs}). Name one with "jobType".`);
  const sets = row.deadlines.map((d2) => `${d2.payment} (${PROMPT_PAY_PAYMENT_LABELS[d2.payment].toLowerCase()})`).join(", ");
  const d = payment ? row.deadlines.find((x) => x.payment === payment) : row.deadlines.length === 1 ? row.deadlines[0] : void 0;
  if (!d) throw new AgentInputError(payment ? `The ${name} ${row.job} row sets no day count for ${PROMPT_PAY_PAYMENT_LABELS[payment].toLowerCase()}. It sets: ${sets}.` : `The ${name} ${row.job} row sets more than one payment: ${sets}. Name one with "payment".`);
  return { code, job: row.job, payment: d.payment };
}
var latePaymentInterest = {
  name: "late_payment_interest_calculator",
  page: "construction/late-payment-interest",
  section: "construction",
  kind: "tool",
  title: "Late payment interest on a progress or retainage payment",
  description: "Works out the interest on one late progress payment or retainage payment: the days late from the due date to the payment date, and the interest in cents by the daily, per month, or per month or fraction method on a 360 or 365 day year, with each step written out and the same dates under every method. The due date and rate can come from a state's row of the prompt payment deadlines table (its calendar days from the day the count starts, and its fixed rate) or be typed; a typed rate is labeled as typed. The days late are counted two ways and must agree, and each part of the interest is worked a second way to the cent. Use it when someone asks how much interest is owed on a late construction payment or how many days late a payment is. Not for deciding whether a statute or contract applies, not for grace days (named in a warning), and not for rows that count business days unless the due date is typed.",
  question: "How much interest is owed on a $36,420 subcontractor payment on a Missouri public job, when we were paid on February 4, 2026 and paid the sub on May 6, 2026?",
  inputs: [
    { name: "lateAmount", kind: "amount", label: "Late amount", description: "The progress payment or retainage that was paid late, in dollars and cents, like 36,420.00.", required: true },
    { name: "paidDate", kind: "date", label: "Payment date", description: "The day the payment was (or will be) made, YYYY-MM-DD.", required: true },
    { name: "dueDate", kind: "date", label: "Due date", description: `Optional. The due date itself, YYYY-MM-DD. Give it, or give "state" and "startDate" to count the due date from that state's row of the prompt payment deadlines table. When it is given, "startDate" is not used.`, required: false },
    { name: "state", kind: "text", label: "State", description: 'Optional. Two-letter code of a state in the prompt payment deadlines table, like MO. Its row gives the due date from "startDate" (rows that count calendar days) and its fixed rate when no "rate" is given.', required: false },
    { name: "jobType", kind: "choice", label: "Job type of the row", choices: LI_JOBS, description: 'Optional, with "state": public, private, or both (a state with one row for both). Needed only when the state has more than one row.', required: false },
    { name: "payment", kind: "choice", label: "Payment in the row", choices: LI_PAYMENTS, description: 'Optional, with "state": owner (the owner pays the contractor), local (a local public owner pays the contractor), or sub (the contractor pays a subcontractor). Needed only when the row sets more than one.', required: false },
    { name: "startDate", kind: "date", label: "Day the row's count starts", description: `Optional, with "state": the day the row's count starts, YYYY-MM-DD (for a subcontractor, usually the day the contractor was paid). The row's calendar days are added to it.`, required: false },
    { name: "rate", kind: "number", label: "Rate", description: "Optional. A typed rate in percent, at most two decimals, like 1.5; it is labeled as typed. Without it, the fixed rate in the state's row is used.", required: false },
    { name: "ratePer", kind: "choice", label: "Rate per", choices: ["month", "year", "day"], description: 'Optional, with "rate": what the typed rate is per, month (the default), year, or day.', required: false },
    { name: "method", kind: "choice", label: "Method", choices: LI_METHODS, description: "Optional. daily: the rate spread over each day late. month (the default): each full month, then the days left over by the day. month-or-fraction: each month started counts as a whole month.", required: false },
    { name: "yearDays", kind: "choice", label: "Days in the year", choices: ["365", "360"], description: "Optional. The year the daily figures are divided by: 365 (the default) or 360.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven does date and interest arithmetic on the figures entered. Nothing here says whether a section applies to a particular contract, what is owed, or what to claim. Mathproven is not affiliated with any legislature or agency whose statutes are cited in the table.",
  run({ values }) {
    const code = str(values.state).toUpperCase();
    if (!code && (values.jobType !== void 0 || values.payment !== void 0)) throw new AgentInputError('"jobType" and "payment" name a row of the prompt payment deadlines table, so they go with "state".');
    const row = code ? promptPayRow(code, values.jobType, values.payment) : void 0;
    let rate2;
    if (values.rate !== void 0) {
      const raw = String(values.rate).replace(/%$/, "").trim();
      let bp;
      try {
        bp = percentToBasisPoints(raw);
      } catch {
        throw new AgentInputError(`"rate" must be a percent with at most two decimals, like 1.5 (given "${String(values.rate)}").`);
      }
      rate2 = { per: values.ratePer ?? "month", bp };
    } else if (values.ratePer !== void 0) {
      throw new AgentInputError(`"ratePer" says what a typed "rate" is per; give the rate too, or leave both out to use the row's fixed rate.`);
    }
    const method = values.method ?? "month";
    const yearDays = Number(values.yearDays ?? "365");
    const input = {
      amount: values.lateAmount,
      paidDate: values.paidDate,
      ...values.dueDate !== void 0 ? { dueDate: values.dueDate } : values.startDate !== void 0 ? { startDate: values.startDate } : {},
      ...row ? { row } : {},
      ...rate2 ? { rate: rate2 } : {},
      method,
      yearDays
    };
    const r = computeLateInterest(input);
    const rowText = lateInterestRowText(r);
    const rateText = `${lateInterestRateLabel(r.rate)} ${r.rateSource === "table" ? "(from the row)" : "(typed)"}`;
    const monthly = method !== "daily" && r.daysLate > 0 ? `, which is ${r.fullMonths} full month(s) and ${r.leftoverDays} day(s) left over` : "";
    const methodText = LATE_INTEREST_METHOD_LABELS[method];
    const steps = {
      name: "Steps",
      rows: [...lateInterestRows(r), ["Rate", rateText, ""], ...rowText ? [["Row", rowText, ""]] : [], ["Rule", r.rule, ""]]
    };
    const compare = {
      name: "Every method",
      rows: [["Method", "Year", "Interest"], ...compareLateInterest(input).map((c) => [LATE_INTEREST_METHOD_LABELS[c.method], c.method === "month-or-fraction" ? "either" : `${c.yearDays} days`, formatUSD(c.interest)])]
    };
    return {
      summary: `Interest of ${formatUSD(r.interest)} on ${formatUSD(r.input.amount)}: due ${longDate(r.dueDate)} (${r.dueFrom === "table" ? "counted from the row's days" : "typed"}), paid ${longDate(r.paidDate)}, ${r.daysLate} day(s) late${monthly}. Rate ${rateText}, ${yearDays}-day year; method: ${methodText.charAt(0).toLowerCase()}${methodText.slice(1)}.${rowText ? ` Row: ${rowText}.` : ""}`,
      tables: [steps, compare],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: $36,420.00 on the Missouri public row (sub), count starting February 4, 2026, paid May 6, 2026, per month on a 365-day year",
      args: { lateAmount: "36,420.00", state: "MO", jobType: "public", payment: "sub", startDate: "2026-02-04", paidDate: "2026-05-06", method: "month", yearDays: "365" },
      verified: true,
      contains: ["$1,397.93", "76 day(s) late", "2 full month(s) and 17 day(s)", "$1,092.60", "$305.33", "$1,365.00", "$1,383.96", "$1,402.17", "$1,638.90", "Thursday, February 19, 2026"]
    },
    {
      label: "A typed due date and rate: $10,000.00 at 12% a year, 90 days late, by the day on a 365-day year",
      args: { lateAmount: "10,000.00", dueDate: "2026-01-01", paidDate: "2026-04-01", rate: "12", ratePer: "year", method: "daily", yearDays: "365" },
      verified: true,
      contains: ["$295.89", "90 day(s) late", "(typed)", "$300.00"]
    }
  ]
};
function waiverVerificationLine(checks, day) {
  const failed = checks.filter((c) => !c.passed && c.severity === "error").length;
  const warned = checks.filter((c) => !c.passed && c.severity === "warning").length;
  const head = failed === 0 ? `Verified: all ${checks.length - warned} checks passed` : `NOT VERIFIED: ${failed} check(s) failed. Do not rely on this document.`;
  return `${head}${warned ? ` (${warned} warning(s))` : ""} Prepared on ${day}. This tool fills in a document and checks the amount; it is not legal advice.`;
}
var lienWaiver = {
  name: "lien_waiver_generator",
  page: "construction/lien-waivers",
  section: "construction",
  kind: "tool",
  title: "Lien waiver, conditional or unconditional, progress or final",
  description: "Fills in a construction lien waiver: conditional or unconditional, on a progress payment or on final payment, with the claimant, customer, owner, project, through date and amount. For a state with its own statutory waiver form that the tool holds, the document is that form's stored text with only the blanks filled, checked against the stored text and its SHA-256; a state commonly listed as having its own form that the tool does not hold gets no document. Every other state gets generic plain-language wording. The amount is checked to the cent against the current payment due from the pay application and read back from the finished document, and no amount may be negative. Use it when someone asks for a lien waiver or lien release to go with a payment, or wants the waiver amount checked against the pay application. Not for deciding which waiver type fits a situation or whether a waiver is enforceable, and not legal advice.",
  question: "Can you make a conditional lien waiver for our $33,300 progress payment on the Maple Court Apartments job in Colorado?",
  inputs: [
    { name: "state", kind: "text", label: "State", description: "Two-letter code of the state where the project is, like CO.", required: true },
    { name: "waiverType", kind: "choice", label: "Waiver type", choices: WAIVER_TYPES, description: "conditional-progress, unconditional-progress, conditional-final, or unconditional-final.", required: true },
    { name: "claimant", kind: "text", label: "Claimant", description: "Who signs the waiver (the party being paid).", required: true },
    { name: "customer", kind: "text", label: "Customer", description: "Who hired the claimant.", required: true },
    { name: "owner", kind: "text", label: "Owner", description: "The property owner.", required: true },
    { name: "projectName", kind: "text", label: "Project name", description: "The name of the project.", required: true },
    { name: "projectAddress", kind: "text", label: "Project address", description: "The project address.", required: true },
    { name: "throughDate", kind: "date", label: "Through date", description: "The day the work covered runs through, YYYY-MM-DD.", required: true },
    { name: "amount", kind: "amount", label: "Amount on the waiver", description: "The amount on the waiver, in dollars and cents, like 33,300.00.", required: true },
    { name: "paymentDue", kind: "amount", label: "Current payment due from the pay application", description: "Optional. The current payment due on the pay application this waiver goes with; the waiver amount is checked against it. Without it the certificate shows a warning instead.", required: false },
    { name: "makerOfCheck", kind: "text", label: "Maker of the check", description: "Optional, for the conditional types: who writes the check.", required: false },
    { name: "payee", kind: "text", label: "Check payable to", description: 'Optional, for statutory forms with a "payable to" blank.', required: false },
    { name: "reference", kind: "text", label: "Job, invoice, or pay application number", description: "Optional, for forms with that blank.", required: false },
    { name: "disputedAmount", kind: "amount", label: "Disputed claims amount", description: "Optional, for statutory final forms with that blank.", required: false },
    { name: "paymentPeriod", kind: "text", label: "Payment period", description: "Optional, for statutory forms with a payment period blank.", required: false },
    { name: "exceptions", kind: "text", label: "Exceptions", description: 'Optional, for the generic wording: anything the waiver does not cover. Without it the waiver says "None."', required: false }
  ],
  limits: "site",
  fileExtensions: [".txt"],
  notAdvice: "Mathproven fills in a document and checks the amount. It does not say which waiver type fits a situation or whether a waiver is enforceable, and waiver rules vary by state.",
  run({ values, now }) {
    const input = {
      state: str(values.state),
      waiverType: str(values.waiverType),
      claimant: str(values.claimant),
      customer: str(values.customer),
      owner: str(values.owner),
      projectName: str(values.projectName),
      projectAddress: str(values.projectAddress),
      throughDate: str(values.throughDate),
      amount: values.amount,
      paymentDue: typeof values.paymentDue === "number" ? values.paymentDue : null,
      disputedAmount: typeof values.disputedAmount === "number" ? values.disputedAmount : null,
      exceptions: str(values.exceptions),
      makerOfCheck: str(values.makerOfCheck),
      payee: str(values.payee),
      reference: str(values.reference),
      paymentPeriod: str(values.paymentPeriod)
    };
    const r = generateLienWaiver(input);
    const state = r.input.state;
    const place = stateName(state) ?? state;
    const typeLabel = WAIVER_TYPE_LABELS[input.waiverType];
    const wording = r.source ? `the stored text of ${r.source.citation}, word for word from ${r.source.sourceUrl} (checked ${r.source.checkedOn}), with only the blanks filled in` : "generic plain-language wording, not any state's statutory form";
    const due = r.input.paymentDue;
    const form = [
      ["Field", "Value"],
      ["State", `${place} (${state})`],
      ["Waiver type", typeLabel],
      ["Form wording", r.source ? `${r.source.citation}, from ${r.source.sourceUrl}, checked ${r.source.checkedOn}` : "Generic plain-language wording; it is not any state's statutory form"],
      ...r.source ? [["SHA-256 of the stored text", r.source.sha256]] : [],
      ["Amount on the waiver", formatUSD(r.input.amount)],
      ["Current payment due from the pay application", due === null || due === void 0 ? "not given" : formatUSD(due)],
      ...r.openBlanks.length ? [["Blanks left open", r.openBlanks.join(", ")]] : []
    ];
    const lines = r.text ? lienWaiverPlainText(r).replace(/\n+$/, "").split("\n") : [];
    const summary = r.form === "unavailable" ? `${place}: ${STATUTORY_FORM_MISSING}.` : `${typeLabel} for ${input.projectName.trim()} in ${place}, in ${wording}. Amount ${formatUSD(r.input.amount)}${due === null || due === void 0 ? " (no payment due was given to compare it with)" : `, compared with the current payment due of ${formatUSD(due)}`}. The document is in the Waiver table, one line per row; the signature lines are left for signing. Give "saveTo" a path ending .txt to save it as text, as the page downloads it.`;
    const file = r.text ? { suggestedName: `lien-waiver-${state.toLowerCase()}-${input.waiverType}.txt`, bytes: new TextEncoder().encode(`${lienWaiverPlainText(r)}
${waiverVerificationLine(r.checks, dayOf(now))}
`) } : void 0;
    return {
      ...file ? { file } : {},
      summary,
      tables: [
        { name: "Waiver", rows: [["Waiver text"], ...lines.map((l) => [l])] },
        { name: "Form", rows: form }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: Colorado, conditional waiver on progress payment, $33,300.00 against a payment due of $33,300.00",
      args: {
        state: "CO",
        waiverType: "conditional-progress",
        claimant: "Brightline Electric LLC",
        customer: "Harbor Ridge Builders Inc.",
        owner: "Maple Court Holdings LLC",
        projectName: "Maple Court Apartments",
        projectAddress: "410 Maple Court, Denver, CO 80202",
        throughDate: "2026-03-31",
        amount: "33,300.00",
        paymentDue: "33,300.00"
      },
      verified: true,
      contains: ["CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT", "Payment amount: $33,300.00", "Through date: March 31, 2026", "Brightline Electric LLC", "generic plain-language wording"]
    },
    {
      label: "The same waiver typed as $33,030.00 does not match the payment due and is not verified",
      args: {
        state: "CO",
        waiverType: "conditional-progress",
        claimant: "Brightline Electric LLC",
        customer: "Harbor Ridge Builders Inc.",
        owner: "Maple Court Holdings LLC",
        projectName: "Maple Court Apartments",
        projectAddress: "410 Maple Court, Denver, CO 80202",
        throughDate: "2026-03-31",
        amount: "33,030.00",
        paymentDue: "33,300.00"
      },
      verified: false,
      failedCheck: "amount-matches-payment-due",
      contains: ["expected $33,300.00, found $33,030.00", "off by -$270.00"]
    }
  ]
};
var WIP_ROLES = ["name", "contract", "estimated", "cost", "billed"];
var WIP_SYNONYMS = {
  name: ["job", "job name", "project", "project name", "name", "job number", "job no", "description"],
  contract: ["contract amount", "contract", "contract value", "contract sum", "revised contract amount", "revised contract", "contract price"],
  estimated: [
    "estimated total cost",
    "estimated total costs",
    "total estimated cost",
    "total estimated costs",
    "estimated cost at completion",
    "estimated costs at completion",
    "estimate at completion",
    "total cost estimate",
    "estimated cost",
    "estimated costs",
    "total budget",
    "budget"
  ],
  cost: ["cost to date", "costs to date", "job cost to date", "actual cost to date", "actual costs to date", "actual cost", "actual costs", "costs incurred", "cost incurred"],
  billed: ["billed to date", "billings to date", "billed", "billings", "invoiced to date", "amount billed"]
};
var WIP_NOT_INPUT = /\b(to complete|remaining|ctc|in excess|over ?billings?|under ?billings?|earned|percent|gross profit|profit)\b/;
var WIP_COLUMNS = {
  roles: WIP_ROLES,
  labels: { name: "Job", contract: "Contract amount", estimated: "Estimated total cost", cost: "Cost to date", billed: "Billed to date" },
  required: ["contract", "estimated", "cost", "billed"],
  guess: guessWithout(WIP_ROLES, WIP_SYNONYMS, WIP_NOT_INPUT)
};
var TOTAL_LINE_RULE = `A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.`;
var overUnderBilling = {
  name: "over_under_billing_wip_schedule",
  page: "construction/over-under-billing",
  section: "construction",
  kind: "tool",
  title: "Over/under billing (WIP schedule) for a list of jobs",
  description: "Builds a work in progress (WIP) schedule by the cost-to-cost method from a list of jobs (.csv or .xlsx, or CSV text, one row per job: contract amount with approved change orders, estimated total cost, cost to date, billed to date): percent complete, earned revenue, and over-billing or under-billing for each job, with portfolio totals and the net. Each division is proved a second way by multiplying back, every total re-adds from the jobs, and total over-billing minus under-billing must equal total billed minus earned revenue. Jobs over their estimated cost or billed past their contract are named in a warning. Use it when someone asks for over/under billings, a WIP schedule, earned revenue, or billings in excess of costs for their jobs. Not for other revenue methods (units of output, milestones), not for estimating the cost to complete, and not for deciding how the figures are reported.",
  question: "Here is our job list with contract, estimated cost, cost to date and billed to date: which jobs are over-billed or under-billed, and what is the net?",
  inputs: [
    { name: "jobs", kind: "file", label: "Job list", description: `A .csv or .xlsx file (a path, or the CSV text) with one row per job: contract amount (with approved change orders), estimated total cost, cost to date and billed to date are needed; a job name column is used when present. A column for the estimated cost to complete is never taken for the estimated total cost. ${TOTAL_LINE_RULE}`, required: true },
    { name: "company", kind: "text", label: "Company", description: "Optional. The company name, for the About table.", required: false },
    { name: "asOf", kind: "date", label: "Schedule as of", description: "Optional. The day the schedule is as of, YYYY-MM-DD, for the About table.", required: false },
    columnsInput("Job list", WIP_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven works out percent complete, earned revenue and over- or under-billing from the figures entered by the cost-to-cost method; it does not estimate costs or say how the figures are reported.",
  run({ files, values }) {
    const file = oneFile(files, "jobs");
    const x = readRows(file, WIP_COLUMNS, values.columns, "Job list", {
      noun: "job",
      total: sumsTo([
        moneySum("contract", "contract amount", (j) => j.contractAmount),
        moneySum("estimated", "estimated total cost", (j) => j.estimatedTotalCost),
        moneySum("cost", "cost to date", (j) => j.costToDate),
        moneySum("billed", "billed to date", (j) => j.billedToDate)
      ]),
      read: (cell) => {
        const name = cell("name");
        const of = name ? ` of ${name}` : "";
        return {
          name,
          contractAmount: centsCell(cell("contract"), `the contract amount${of}`),
          estimatedTotalCost: centsCell(cell("estimated"), `the estimated total cost${of}`),
          costToDate: centsCell(cell("cost"), `the cost to date${of}`),
          billedToDate: centsCell(cell("billed"), `the billed to date${of}`)
        };
      }
    });
    if (x.items.length === 0) return nothingRead(x, "job list");
    const r = computeOverUnder(x.items);
    const t = overUnderTables(r);
    const s = r.totals;
    const about = [["Over/under billing schedule", "Value"], ["Company", str(values.company)], ["As of", str(values.asOf)]];
    return {
      summary: `${r.jobs.length} job(s): ${formatUSD(s.billedToDate)} billed against ${formatUSD(s.earnedRevenue)} of earned revenue. Over-billing totals ${formatUSD(s.overBilling)} and under-billing totals ${formatUSD(s.underBilling)}, a net ${s.netOverUnder < 0 ? "under-billing" : "over-billing"} of ${formatUSD(Math.abs(s.netOverUnder))}. The jobs are ${formatPercentBp(s.percentCompleteBp)} complete by cost (${formatUSD(s.costToDate)} of ${formatUSD(s.estimatedTotalCost)}).`,
      tables: [
        { name: "Jobs", rows: t.jobs },
        { name: "Totals", rows: t.totals },
        ...str(values.company) || str(values.asOf) ? [{ name: "About", rows: about }] : []
      ],
      checks: [...r.checks, ...rowAccounting(x)]
    };
  },
  examples: [
    {
      label: "The page's worked example: three jobs at month end, one billed ahead of the work and two behind it",
      args: { jobs: "agents-fixture:construction/wip-jobs.csv" },
      verified: true,
      contains: ["$252,500.00 billed against $251,833.33", "$10,000.00", "$9,333.33", "net over-billing of $666.67", "48.03%", "$207,000.00 of $431,000.00", "66.67%", "31833.33"]
    },
    {
      label: "A job whose cost to date cannot be read is not verified",
      args: { jobs: "Job,Contract amount,Estimated total cost,Cost to date,Billed to date\nMaple Street clinic,250000.00,200000.00,80000.00,110000.00\nHarbor warehouse,180000.00,150000.00,1OO000.00,112500.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var PAC_ROLES = PAY_APP_FIELDS.map((f) => f.field);
var fullColumns = (m) => Object.fromEntries(PAC_ROLES.map((r) => [r, m[r] ?? -1]));
var PAC_COLUMN_HELP = { roles: PAC_ROLES, labels: PAY_APP_LABELS, required: ["scheduledValue"], guess: () => ({ headerRow: 0, columns: fullColumns({}) }) };
function rowNumbers(v) {
  const text = str(v);
  if (text === "") return [];
  return text.split(/[\s,;]+/).filter((p) => p !== "").map((p) => {
    if (!/^\d+$/.test(p)) throw new AgentInputError(`"notScheduleLines" must be spreadsheet row numbers, like "7, 9" (given "${text}").`);
    return Number(p);
  });
}
var payAppChecker = {
  name: "pay_application_checker",
  page: "construction/pay-app-checker",
  section: "construction",
  kind: "tool",
  title: "Pay application checker: math errors in a schedule of values",
  description: "Checks an existing pay application spreadsheet (.xlsx or .csv): finds the schedule of values header row, recomputes every line (completed and stored = previous work + this period + materials stored, balance to finish, retainage at the rates given) and every subtotal and totals row, and lists each cell that differs from the math with the amount it is off by. A row counts as a subtotal or total only when its label is exactly that word. Every row with amounts is accounted for: a row that cannot be read, or one with amounts below the last totals row, fails a check that names it, and percent cells that disagree are named in a warning. Use it when someone asks to check, audit, or find the math errors in a pay application, progress billing or schedule of values they were sent or made. Not for building a new pay application, not for judging the work or whether a billing is allowed under a contract, and not for PDF files.",
  question: "Can you check this pay application spreadsheet for math errors before we send it?",
  inputs: [
    { name: "payApplication", kind: "file", label: "Pay application spreadsheet", description: "A .csv or .xlsx file (a path, or the CSV text) holding the schedule of values: a column for scheduled value and one for previous work or work this period are needed; item, description, materials stored, completed and stored, percent, balance to finish and retainage columns are compared when present.", required: true },
    { name: "retainageOnWork", kind: "number", label: "Retainage on work (%)", description: "Optional. The retainage rate on completed work, in percent, like 10 (the default).", required: false },
    { name: "retainageOnStored", kind: "number", label: "Retainage on stored materials (%)", description: "Optional. The retainage rate on stored materials, in percent, like 10 (the default).", required: false },
    { name: "sheet", kind: "text", label: "Sheet", description: "Optional, for a workbook: the name of the sheet to check. Without it, the first sheet with a schedule of values header row.", required: false },
    { name: "headerRow", kind: "number", label: "Header row number", description: "Optional. The number of the header row as the spreadsheet shows it (the first row is 1), when it is not found by itself.", required: false },
    columnsInput("Pay application", PAC_COLUMN_HELP),
    { name: "notScheduleLines", kind: "text", label: "Rows that are not schedule lines", description: 'Optional. Spreadsheet row numbers, like "7, 9", of rows below the last totals row that are not schedule lines (a payment summary, a note with a figure). Each is recorded as a warning and its amounts are not checked.', required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven recomputes the schedule of values on the sheet and lists every difference from the math; it does not say whether a pay application should be approved, paid or signed.",
  run({ files, values }) {
    const file = oneFile(files, "payApplication");
    const wanted = str(values.sheet);
    let sheet = file.sheets.find((s) => s.rows === file.rows) ?? file.sheets[0];
    if (wanted) {
      sheet = file.sheets.find((s) => s.name.trim().toLowerCase() === wanted.trim().toLowerCase());
      if (!sheet) throw new AgentInputError(`The workbook has no sheet "${wanted}". Its sheets are: ${file.sheets.map((s) => s.name).join(", ")}.`);
    } else {
      const usable = file.sheets.find((s) => {
        try {
          detectPayAppColumns(s.rows);
          return true;
        } catch {
          return false;
        }
      });
      if (usable) sheet = usable;
    }
    if (!sheet) throw new AgentInputError(`${file.name} has no sheets.`);
    const rows = sheet.rows;
    let headerIndex;
    if (values.headerRow !== void 0) {
      const n = /^\d+$/.test(String(values.headerRow)) ? Number(values.headerRow) : 0;
      if (n < 1 || n > rows.length) throw new AgentInputError(`"headerRow" must be the number of a row of the sheet, from 1 to ${rows.length}.`);
      headerIndex = n - 1;
    }
    const override = str(values.columns);
    const roles = {
      ...PAC_COLUMN_HELP,
      guess: (sheetRows, at) => {
        const given = at ?? headerIndex;
        if (given !== void 0) return { headerRow: given, columns: fullColumns(mapPayAppHeaders(payAppHeaderTexts(sheetRows, given))) };
        try {
          const d = detectPayAppColumns(sheetRows);
          return { headerRow: d.headerRow, columns: fullColumns(d.columns) };
        } catch (err) {
          if (override) return { headerRow: 0, columns: fullColumns({}) };
          throw new AgentInputError(`${err instanceof Error ? err.message : "No header row was found."} Give "headerRow" (its number as the spreadsheet shows it) and, if needed, "columns".`);
        }
      }
    };
    const m = mapColumns({ ...file, rows }, roles, override, "Pay application");
    const columns = {};
    for (const f of PAC_ROLES) if (m.columns[f] >= 0) columns[f] = m.columns[f];
    const r = checkPayApplication(rows, {
      headerRow: m.headerRow,
      columns,
      retainageOnWorkBp: percentValue(values.retainageOnWork, "Retainage on work", "10"),
      retainageOnStoredBp: percentValue(values.retainageOnStored, "Retainage on stored materials", "10"),
      excludedRows: rowNumbers(values.notScheduleLines)
    });
    const t = payAppCheckTables(r);
    const tot = r.totals;
    const found = r.findings.length ? `${r.findings.length} difference(s) from the math found` : payAppNoFindingsText(r);
    return {
      summary: `${r.lines.length} schedule line(s) read on ${file.sheets.length > 1 ? `sheet "${sheet.name}"` : file.name}: ${found}. Recomputed totals: scheduled value ${formatUSD(tot.scheduledValue)}, previous work ${formatUSD(tot.previous)}, this period ${formatUSD(tot.thisPeriod)}, materials stored ${formatUSD(tot.stored)}, completed and stored ${formatUSD(tot.completedAndStored)}, balance to finish ${formatUSD(tot.balance)}, retainage ${formatUSD(tot.retainage)}.`,
      tables: [
        { name: "Findings", rows: t.findings },
        { name: "Lines", rows: t.lines },
        ...t.notRead.length > 1 ? [{ name: "Rows not read", rows: t.notRead }] : []
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example with its four errors corrected: every cell agrees with the math at 10% retainage",
      args: { payApplication: "fixture:construction/pay-app-checker-corrected.csv", retainageOnWork: "10", retainageOnStored: "10" },
      verified: true,
      contains: ["4 schedule line(s) read", "No differences found", "completed and stored $63,250.00", "balance to finish $32,250.00", "retainage $6,325.00"]
    },
    {
      label: "The page's worked example as it arrived: three cells and one total are off, so it is not verified and the failed checks name them",
      args: { payApplication: "fixture:construction/pay-app-checker-example.csv", retainageOnWork: "10", retainageOnStored: "10" },
      verified: false,
      failedCheck: "row-4-completedAndStored",
      contains: ["Row 4 (item 3)", "($13,520.00)", "($13,250.00)", "off by $270.00", "($12,980.00)", "Row 5 (item 4)", "($100.00)", "($200.00)", "($63,520.00)"]
    }
  ]
};
var payAppTemplate = {
  name: "pay_application_template_workbook",
  page: "construction/pay-application-template",
  section: "construction",
  kind: "template",
  title: "Blank pay application spreadsheet with a schedule of values",
  description: "Makes a blank pay application workbook (.xlsx): a schedule of values sheet with the lines numbered and a totals row under a generic progress billing header (item, description of work, scheduled value, work from previous applications, work this period, materials stored, total completed and stored, percent complete, balance to finish, retainage), a summary sheet with the project, contractor, retainage rate and the summary lines, and an instructions sheet saying what each column means. The finished file is read back and checked for its three sheets, the header row, one numbered row per line plus the totals row, and the project, contractor and rate as given. The workbook holds values only, with no formulas. Use it when someone asks for a pay application or schedule of values spreadsheet template to fill in. Not for calculating or checking an application.",
  question: "Can you make me a blank pay application spreadsheet with 20 schedule of values lines and 10% retainage for the Cedar Court Apartments job?",
  inputs: [
    { name: "projectName", kind: "text", label: "Project name", description: "Optional. The project name for the summary sheet, up to 120 characters.", required: false },
    { name: "contractorName", kind: "text", label: "Contractor name", description: "Optional. The contractor name for the summary sheet, up to 120 characters.", required: false },
    { name: "lineCount", kind: "number", label: "Number of schedule lines", description: "Optional. How many schedule of values lines to number, a whole number from 1 to 500; 20 when not given.", required: false },
    { name: "retainagePercent", kind: "number", label: "Retainage (%)", description: "Optional. The retainage percent for the summary sheet, like 10 (the default) or 7.5.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven builds the workbook with values only and no formulas, so it is a clean layout to fill in; it does not calculate or check anything typed into it.",
  run({ values, now }) {
    const count = str(values.lineCount) || "20";
    const input = {
      projectName: str(values.projectName),
      contractorName: str(values.contractorName),
      lineCount: /^\d+$/.test(count) ? Number(count) : Number.NaN,
      retainagePercent: (str(values.retainagePercent) || "10").replace(/%$/, "").trim(),
      builderUrl: `${SITE_URL}/construction/pay-application/?src=template`
    };
    const bytes = writeXlsx(buildPayAppTemplate(input), now);
    const read = readXlsx(bytes);
    const checks = verifyPayAppTemplate(input, read);
    const [schedule, summarySheet, instructions] = [read[0], read[1], read[2]];
    const rate2 = summarySheet?.rows.find((r) => r[0] === "Retainage rate on completed work")?.[1] ?? "";
    return {
      summary: `A blank pay application workbook, pay-application-template.xlsx, with three sheets: "${schedule?.name ?? ""}" with ${input.lineCount} numbered line(s) and a totals row, "${summarySheet?.name ?? ""}" with the project, contractor, retainage rate (${rate2}) and the summary lines, and "${instructions?.name ?? ""}" with what each column means. It holds values only, with no formulas.`,
      tables: [
        { name: "Sheets", rows: [["Sheet", "Rows", "Columns"], ...read.map((s) => [s.name, String(s.rows.length), (s.rows[0] ?? []).join(", ")])] },
        { name: "Summary sheet", rows: summarySheet?.rows ?? [] }
      ],
      checks,
      file: { suggestedName: "pay-application-template.xlsx", bytes }
    };
  },
  examples: [
    {
      label: "The page's example: Cedar Court Apartments, Northfield Electric LLC, 10% retainage, 20 lines",
      args: { projectName: "Cedar Court Apartments", contractorName: "Northfield Electric LLC", lineCount: "20", retainagePercent: "10" },
      verified: true,
      contains: ["20 numbered line(s)", "Schedule of values", "Description of work", "Work from previous applications", "Cedar Court Apartments", "Northfield Electric LLC", "(10%)"]
    }
  ]
};
var SOV_ROLES = ["itemNo", "description", "scheduledValue", "previous", "thisPeriod", "stored"];
function guessSovColumns(rows, atHeaderRow) {
  const columns = (found) => Object.fromEntries(SOV_ROLES.map((r) => [r, found[r] ?? -1]));
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: columns(mapPayAppHeaders(payAppHeaderTexts(rows, atHeaderRow))) };
  try {
    const d = detectPayAppColumns(rows);
    return { headerRow: d.headerRow, columns: columns(d.columns) };
  } catch {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const m = mapPayAppHeaders(payAppHeaderTexts(rows, i));
      if (m.scheduledValue !== void 0) return { headerRow: i, columns: columns(m) };
    }
  }
  return { headerRow: 0, columns: columns({}) };
}
var SOV_COLUMNS = {
  roles: SOV_ROLES,
  labels: { itemNo: PAY_APP_LABELS.itemNo, description: PAY_APP_LABELS.description, scheduledValue: PAY_APP_LABELS.scheduledValue, previous: PAY_APP_LABELS.previous, thisPeriod: PAY_APP_LABELS.thisPeriod, stored: PAY_APP_LABELS.stored },
  required: ["scheduledValue"],
  guess: guessSovColumns
};
var PAYAPP_SUMMARY = [
  ["originalContractSum", "Original contract sum"],
  ["netChangeOrders", "Net change orders"],
  ["contractSumToDate", "Contract sum to date"],
  ["totalCompletedAndStored", "Total completed and stored to date"],
  ["retainageOnWork", "Retainage on completed work"],
  ["retainageOnStored", "Retainage on stored materials"],
  ["retainageReleasedToDate", "Retainage released to date"],
  ["totalRetainage", "Total retainage"],
  ["totalEarnedLessRetainage", "Total earned less retainage"],
  ["previousCertificates", "Previous certificates for payment"],
  ["currentPaymentDue", "Current payment due"],
  ["balanceToFinishIncludingRetainage", "Balance to finish, including retainage"]
];
var payApplication = {
  name: "pay_application_builder",
  page: "construction/pay-application",
  section: "construction",
  kind: "tool",
  title: "Subcontractor pay application from a schedule of values",
  description: "Builds a subcontractor pay application (progress billing) from a schedule of values (.csv or .xlsx, or CSV text, one row per line: scheduled value, previous work, work this period, materials stored) and the contract figures: completed and stored, percent complete and balance to finish per line, retainage on completed work and on stored materials, total earned less retainage, the current payment due after previous certificates, and the balance to finish including retainage. Every line is recomputed on a second, independent pass; the schedule must add up to the contract sum to date with change orders, no line may bill more than its scheduled value, and retainage released may not be more than retainage held. Use it when someone asks to make a pay app, work out the current payment due, or figure retainage on a progress billing. Not for checking a pay application someone else made, and not for deciding what to bill or certify.",
  question: "What is the current payment due on pay application 2 for our $100,000 electrical subcontract with 10% retainage?",
  inputs: [
    { name: "scheduleOfValues", kind: "file", label: "Schedule of values", description: `A .csv or .xlsx file (a path, or the CSV text) with one row per line: scheduled value is needed; item, description, previous work (billed on earlier applications), this period and materials stored are used when present (a blank cell is zero). A file with completed, percent, balance or retainage columns and no previous-work or this-period column is refused. ${TOTAL_LINE_RULE}`, required: true },
    { name: "originalContractSum", kind: "amount", label: "Original contract sum", description: "The original contract sum, like 100,000.00.", required: true },
    { name: "netChangeOrders", kind: "amount", label: "Net change orders", description: "Optional. Approved change orders to date, net (deductions negative); zero when not given.", required: false },
    { name: "applicationNo", kind: "number", label: "Application number", description: "Optional. The application number, a whole number from 1; 1 when not given.", required: false },
    { name: "periodTo", kind: "date", label: "Period to", description: "Optional. The last day of the period this application covers, YYYY-MM-DD.", required: false },
    { name: "retainageOnWork", kind: "number", label: "Retainage on work (%)", description: "Optional. The retainage rate on completed work, in percent, like 10 (the default).", required: false },
    { name: "retainageOnStored", kind: "number", label: "Retainage on stored materials (%)", description: "Optional. The retainage rate on stored materials, in percent, like 10 (the default).", required: false },
    { name: "retainageReleasedToDate", kind: "amount", label: "Retainage released to date", description: "Optional. Retainage released on this and all earlier applications; zero when not given.", required: false },
    { name: "previousCertificates", kind: "amount", label: "Previous certificates for payment", description: "Optional. The total certified for payment on earlier applications (earned less retainage); zero when not given.", required: false },
    columnsInput("Schedule of values", SOV_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven calculates the pay application from the schedule of values and the figures entered; it does not say what to bill, certify or sign.",
  run({ files, values }) {
    const file = oneFile(files, "scheduleOfValues");
    const x = readRows(file, SOV_COLUMNS, values.columns, "Schedule of values", {
      noun: "schedule line",
      total: sumsTo([
        moneySum("scheduledValue", "scheduled value", (l) => l.scheduledValue),
        moneySum("previous", "previous work", (l) => l.previouslyCompleted),
        moneySum("thisPeriod", "work this period", (l) => l.thisPeriod),
        moneySum("stored", "materials stored", (l) => l.materialsStored)
      ]),
      // A schedule that shows progress only as completed, percent or balance columns would be billed as nothing done.
      vet: (columns, header) => {
        if (columns.previous >= 0 || columns.thisPeriod >= 0) return;
        const other = mapPayAppHeaders(header);
        const col = other.completedAndStored ?? other.percent ?? other.balance ?? other.retainage;
        if (col === void 0) return;
        throw new AgentInputError(
          `The schedule of values has a "${(header[col] ?? "").trim()}" column but no column for previous work or for work this period. This tool works each line out from previous work, work this period and materials stored, and does not take completed, percent, balance or retainage columns, so it would bill nothing done. Give those columns, or name them with "columns", for example "This period = <header>".`
        );
      },
      read: (cell, at) => {
        const itemNo = cell("itemNo") || String(at.index + 1);
        const on = ` on item ${itemNo}`;
        return {
          itemNo,
          description: cell("description"),
          scheduledValue: centsCell(cell("scheduledValue"), `the scheduled value${on}`),
          previouslyCompleted: centsCell(cell("previous"), `the previous work${on}`),
          thisPeriod: centsCell(cell("thisPeriod"), `the work this period${on}`),
          materialsStored: centsCell(cell("stored"), `the materials stored${on}`)
        };
      }
    });
    if (x.items.length === 0) return nothingRead(x, "schedule of values");
    const appNoText = values.applicationNo === void 0 ? "1" : String(values.applicationNo);
    if (!/^[1-9]\d*$/.test(appNoText) || !Number.isSafeInteger(Number(appNoText))) throw new AgentInputError(`"applicationNo" must be a whole number from 1 (given "${appNoText}").`);
    const r = computePayApplication({
      applicationNo: Number(appNoText),
      periodTo: str(values.periodTo),
      originalContractSum: values.originalContractSum,
      netChangeOrders: centsOr(values.netChangeOrders),
      retainageOnWorkBp: percentValue(values.retainageOnWork, "Retainage on work", "10"),
      retainageOnStoredBp: percentValue(values.retainageOnStored, "Retainage on stored materials", "10"),
      retainageReleasedToDate: centsOr(values.retainageReleasedToDate),
      previousCertificates: centsOr(values.previousCertificates),
      lines: x.items
    });
    const d = (c) => formatUSD(c);
    const s = r.summary;
    const lines = [
      ["Item", "Description", "Scheduled value", "Previous work", "This period", "Stored materials", "Completed and stored", "Percent complete", "Balance to finish", "Retainage"],
      ...r.lines.map((l) => [l.itemNo, l.description, d(l.scheduledValue), d(l.previouslyCompleted), d(l.thisPeriod), d(l.materialsStored), d(l.completedAndStored), formatPercentBp(l.percentCompleteBp), d(l.balanceToFinish), d(l.retainage)])
    ];
    const summary = [["Summary", "Amount"], ...PAYAPP_SUMMARY.map(([k, label]) => [label, d(s[k])])];
    return {
      summary: `Application ${r.input.applicationNo}${r.input.periodTo ? ` for the period to ${r.input.periodTo}` : ""}, ${r.lines.length} line(s): completed and stored ${d(s.totalCompletedAndStored)}, total retainage ${d(s.totalRetainage)}, total earned less retainage ${d(s.totalEarnedLessRetainage)}, less previous certificates ${d(s.previousCertificates)}: current payment due ${d(s.currentPaymentDue)}. Balance to finish, including retainage: ${d(s.balanceToFinishIncludingRetainage)} of the ${d(s.contractSumToDate)} contract sum to date.`,
      tables: [
        { name: "Schedule of values", rows: lines },
        { name: "Summary", rows: summary }
      ],
      checks: [...r.checks, ...rowAccounting(x)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a $100,000.00 electrical subcontract at 10% retainage, application 2, $36,000.00 certified before",
      args: { scheduleOfValues: "agents-fixture:construction/pay-application-lines.csv", originalContractSum: "100,000.00", applicationNo: "2", retainageOnWork: "10", retainageOnStored: "10", previousCertificates: "36,000.00" },
      verified: true,
      contains: ["completed and stored $77,000.00", "total retainage $7,700.00", "total earned less retainage $69,300.00", "current payment due $33,300.00", "$30,700.00", "$1,700.00", "56.67%"]
    },
    {
      label: "A schedule that does not add up to the contract sum ($100,000.00 of lines against a $90,000.00 contract) is not verified",
      args: { scheduleOfValues: "agents-fixture:construction/pay-application-lines.csv", originalContractSum: "90,000.00", applicationNo: "2", previousCertificates: "36,000.00" },
      verified: false,
      failedCheck: "schedule-matches-contract"
    },
    {
      label: "A line whose work this period cannot be read is not verified",
      args: { scheduleOfValues: "Item,Description,Scheduled value,Previous work,This period,Materials stored\n1,Rough-in,60000.00,40000.00,2O000.00,0.00\n2,Fixtures,40000.00,0.00,15000.00,2000.00\n", originalContractSum: "100,000.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var FRINGE_ROLES = ["worker", "classification", "required", "planCost", "divisor", "hours"];
var FRINGE_SYNONYMS = {
  worker: ["worker", "worker name", "employee", "employee name", "name"],
  classification: ["classification", "job classification", "craft", "trade", "class"],
  required: ["required fringe per hour", "required fringe", "fringe per hour", "fringe rate", "fringe benefit rate", "required fringe rate", "fringe"],
  planCost: ["yearly plan cost", "annual plan cost", "plan cost", "yearly cost", "annual cost", "annual benefit cost", "plan cost per year"],
  divisor: ["hours worked in the plan year all work", "hours worked in the plan year", "hours in the plan year", "hours divisor", "divisor", "annual hours", "plan year hours", "total hours worked", "hours worked in the year"],
  hours: ["hours on this job", "hours on the job", "job hours", "hours this job", "project hours", "hours"]
};
var FRINGE_COLUMNS = {
  roles: FRINGE_ROLES,
  labels: { worker: "Worker", classification: "Classification", required: "Required fringe per hour", planCost: "Yearly plan cost", divisor: "Hours worked in the plan year, all work", hours: "Hours on this job" },
  required: ["required", "planCost", "divisor", "hours"],
  guess: (rows, at) => sheetGuessColumns(rows, FRINGE_ROLES, FRINGE_SYNONYMS, at)
};
var fringeCredit = {
  name: "prevailing_wage_fringe_credit",
  page: "construction/prevailing-wage-fringe-credit",
  section: "construction",
  kind: "tool",
  title: "Prevailing wage fringe credit (fringe benefit annualization)",
  description: "Works out fringe benefit annualization for prevailing wage jobs from a list of workers (.csv or .xlsx, " +
    "or CSV text, one row per worker and classification: required fringe per hour, the employer's yearly " +
    "plan cost, the hours the plan cost is spread over, and hours on this job): the plan credit per hour " +
    "rounded down to the cent, the cash fringe per hour still owed, any credit above the required fringe " +
    "(shown, not used), and the cash fringe owed for the hours on the job, with totals. The hours on the " +
    "job may not be more than the divisor, the credit plus the cash fringe must equal the required fringe, " +
    "and every row and both totals are worked a second time with separate whole-number arithmetic. Use it " +
    "when someone asks how much fringe credit a health or pension plan gives per hour on a prevailing wage " +
    "job, or how much cash fringe is still owed for a payroll week. Not for choosing the hours divisor, deciding " +
    "which plans or costs count, or looking up a wage determination's rates.",
  question: "How much cash fringe do we still owe this payroll week after the health and pension plan credit on our prevailing wage job?",
  inputs: [
    { name: "workers", kind: "file", label: "Worker rows", description: `A .csv or .xlsx file (a path, or the CSV text) with one row per worker and classification: required fringe per hour (from the wage determination), yearly plan cost (the employer's cost for the plan year), hours worked in the plan year on all work (the divisor) and hours on this job are needed; worker and classification columns are used when present. Hours take at most two decimals, like 37.25. ${TOTAL_LINE_RULE}`, required: true },
    { name: "job", kind: "text", label: "Job or project", description: "Optional. The job or project, for the About table.", required: false },
    { name: "periodEnd", kind: "date", label: "Payroll period ending", description: "Optional. The last day of the payroll period, YYYY-MM-DD, for the About table.", required: false },
    columnsInput("Worker rows", FRINGE_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven divides each yearly plan cost by the hours entered and does not choose them; it does not say which plans, costs or hours count for a job or what a wage determination requires.",
  run({ files, values, now }) {
    const file = oneFile(files, "workers");
    const x = readRows(file, FRINGE_COLUMNS, values.columns, "Worker rows", {
      noun: "worker row",
      // The columns a total line adds up: the hours on this job and the plan costs. Rates and divisors are not summed.
      total: sumsTo([
        { role: "hours", label: "hours on this job", of: (w) => w.jobHours, read: (raw) => hoursCell(raw, "the hours on this job"), show: formatFringeHours },
        moneySum("planCost", "yearly plan cost", (w) => w.planCost)
      ]),
      read: (cell) => {
        const who = [cell("worker"), cell("classification")].filter(Boolean).join(", ");
        const of = who ? ` for ${who}` : "";
        return {
          worker: cell("worker"),
          classification: cell("classification"),
          requiredFringe: centsCell(cell("required"), `the required fringe per hour${of}`),
          planCost: centsCell(cell("planCost"), `the yearly plan cost${of}`),
          divisorHours: hoursCell(cell("divisor"), `the hours in the plan year${of}`),
          jobHours: hoursCell(cell("hours"), `the hours on this job${of}`)
        };
      }
    });
    if (x.items.length === 0) return nothingRead(x, "list of worker rows");
    const r = computeFringeCredit({ rows: x.items });
    const t = fringeCreditTables(r);
    const over = r.rows.filter((row) => row.excessPerHour > 0).length;
    const about = [["About", "Value"], ["Job or project", str(values.job)], ["Payroll period ending", str(values.periodEnd)], ["Prepared", dayOf(now)]];
    return {
      summary: `${r.rows.length} row(s) (worker and classification): ${formatFringeHours(r.totalJobHours)} hours on this job and ${formatUSD(r.totalCashOwed)} of cash fringe owed for them. ${over} row(s) have a plan credit above the required fringe (the excess is shown and not used).`,
      tables: [
        { name: "Fringe credit", rows: t.rows },
        { name: "Working", rows: t.working },
        { name: "Sources", rows: t.sources },
        ...str(values.job) || str(values.periodEnd) ? [{ name: "About", rows: about }] : []
      ],
      checks: [...r.checks, ...rowAccounting(x)]
    };
  },
  examples: [
    {
      label: "The page's worked example: four rows for three workers in a payroll week on a public job",
      args: { workers: "agents-fixture:construction/fringe-credit-rows.csv" },
      verified: true,
      contains: ["116.50 hours on this job", "$1,428.73 of cash fringe owed", "1 row(s) have a plan credit above the required fringe", "4.67", "20.69", "796.57", "150.96", "6.87", "481.20", "8.66", "0.91"]
    },
    {
      label: "Hours on the job written with three decimals cannot be read, so the result is not verified",
      args: { workers: "Worker,Classification,Required fringe per hour,Yearly plan cost,Hours worked in the plan year,Hours on this job\nSam Okafor,Cement mason,18.90,14300.00,2080.00,40.00\nLee Park,Truck driver,7.75,19500.00,2250.00,32.125\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var MILESTONE_ROLES = ["milestone", "amount", "reached"];
var MILESTONE_SYNONYMS = {
  milestone: ["milestone", "milestone description", "description", "name", "stage", "phase"],
  amount: ["amount", "milestone amount", "value", "scheduled value", "billing amount"],
  reached: ["reached", "done", "complete", "completed", "status", "met", "achieved"]
};
var MILESTONE_COLUMNS = {
  roles: MILESTONE_ROLES,
  labels: { milestone: "Milestone", amount: "Amount", reached: "Reached" },
  required: ["amount"],
  guess: (rows, at) => sheetGuessColumns(rows, MILESTONE_ROLES, MILESTONE_SYNONYMS, at)
};
function reachedCell(raw, what) {
  const s = raw.trim().toLowerCase();
  if (/^(yes|y|true|x|1|reached|done|complete|completed|met|achieved|✓|✔)$/.test(s)) return true;
  if (/^(|no|n|false|0|not reached|not yet reached|not yet|pending|open)$/.test(s)) return false;
  throw new RowProblem(`${what} "${raw}" is not yes or no`);
}
var progressBilling = {
  name: "progress_billing_statement",
  page: "construction/progress-billing",
  section: "construction",
  kind: "tool",
  title: "Progress billing statement by percent complete or milestones",
  description: "Makes a progress billing statement for a job billed by overall percent complete or by milestones, with no line-by-line schedule of values: contract sum to date with change orders, billed to date, billing this period, retainage this period and to date, amount due this period, unpaid prior balance, total due now, and the balance of contract left to bill. Milestones come as a .csv or .xlsx file, or CSV text (milestone, amount, reached), and must add up to the contract sum to date. Billed to date may not exceed the contract sum to date or fall below what was billed before, and every figure is rebuilt a second time with separate whole-number arithmetic. Use it when someone asks to bill a job by percent complete or by milestone, or what is due on this period's progress invoice after retainage. Not for jobs billed line by line from a schedule of values, and not for deciding what may be billed under a contract.",
  question: "We are 62.5% complete on an $86,000 contract with two change orders: what do we bill this period after 10% retainage?",
  inputs: [
    { name: "originalContractSum", kind: "amount", label: "Original contract sum", description: "The original contract sum, like 86,000.00.", required: true },
    { name: "changeOrders", kind: "amounts", label: "Change orders", description: 'Optional. Each approved change order as an amount, deductions negative, like ["3,450.00", "-950.00"].', required: false },
    { name: "percentComplete", kind: "number", label: "Percent complete to date (%)", description: 'For a job billed by percent complete: the overall percent complete to date, like 62.5. Give this or "milestones", not both.', required: false },
    { name: "milestones", kind: "file", label: "Milestones", description: `For a job billed by milestones: a .csv or .xlsx file (a path, or the CSV text) with one row per milestone: the amount is needed; milestone (its name) and reached (yes or no; blank is no) are used when present. Give this or "percentComplete", not both. ${TOTAL_LINE_RULE}`, required: false },
    { name: "previouslyBilled", kind: "amount", label: "Previously billed", description: "Optional. The total billed on earlier statements, before retainage; zero when not given.", required: false },
    { name: "previouslyPaid", kind: "amount", label: "Previously paid", description: "Optional. The total paid so far; zero when not given.", required: false },
    { name: "retainage", kind: "number", label: "Retainage (%)", description: "Optional. The retainage percent, like 10 (the default).", required: false },
    { name: "statementNo", kind: "text", label: "Statement number", description: "Optional, for the Statement details table.", required: false },
    { name: "statementDate", kind: "date", label: "Statement date", description: "Optional, YYYY-MM-DD, for the Statement details table; the run's day when not given.", required: false },
    { name: "workThrough", kind: "date", label: "Work through", description: "Optional. The last day of work the statement covers, YYYY-MM-DD.", required: false },
    { name: "from", kind: "text", label: "Your company (from)", description: "Optional, for the Statement details table.", required: false },
    { name: "billedTo", kind: "text", label: "Billed to", description: "Optional, for the Statement details table.", required: false },
    { name: "job", kind: "text", label: "Job or project", description: "Optional, for the Statement details table.", required: false },
    columnsInput("Milestones", MILESTONE_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven works out the statement from the figures entered; it does not say what may be billed or what is owed under a contract.",
  run({ files, values, now }) {
    const milestoneFile = files.milestones?.[0];
    const percentGiven = values.percentComplete !== void 0;
    if (milestoneFile && percentGiven) throw new AgentInputError('Give "percentComplete" for a job billed by percent complete, or "milestones" for a job billed by milestones, not both.');
    if (!milestoneFile && !percentGiven) throw new AgentInputError('Give "percentComplete" (a job billed by overall percent complete) or "milestones" (a job billed by milestones).');
    let milestoneRows;
    if (milestoneFile) {
      milestoneRows = readRows(milestoneFile, MILESTONE_COLUMNS, values.columns, "Milestones", {
        noun: "milestone",
        total: sumsTo([moneySum("amount", "amount", (m) => m.amount)]),
        read: (cell, at) => {
          const description = cell("milestone");
          const of = ` of ${description || `milestone ${at.index + 1}`}`;
          return { description, amount: centsCell(cell("amount"), `the amount${of}`), reached: reachedCell(cell("reached"), `reached${of}`) };
        }
      });
      if (milestoneRows.items.length === 0) return nothingRead(milestoneRows, "milestone list");
    }
    const changeOrders = Array.isArray(values.changeOrders) ? values.changeOrders : [];
    const input = {
      originalContractSum: values.originalContractSum,
      changeOrders: changeOrders.map((amount, i) => ({ description: `Change order ${i + 1}`, amount })),
      basis: milestoneRows ? { kind: "milestones", milestones: milestoneRows.items } : { kind: "percent", percentCompleteBp: percentValue(values.percentComplete, "Percent complete") },
      previouslyBilled: centsOr(values.previouslyBilled),
      previouslyPaid: centsOr(values.previouslyPaid),
      retainageBp: percentValue(values.retainage, "Retainage", "10")
    };
    const r = computeProgressBilling(input);
    const t = progressBillingTables(r);
    const s = r.statement;
    const details = [
      ["Statement number", str(values.statementNo)],
      ["Statement date", str(values.statementDate) || dayOf(now)],
      ["Work through", str(values.workThrough)],
      ["From", str(values.from)],
      ["Billed to", str(values.billedTo)],
      ["Job or project", str(values.job)]
    ];
    const anyDetail = ["statementNo", "statementDate", "workThrough", "from", "billedTo", "job"].some((k) => str(values[k]) !== "");
    const basis = r.input.basis.kind === "percent" ? `${formatPercentBp(r.input.basis.percentCompleteBp)} of the contract sum to date` : `milestones reached, ${formatPercentBp(s.percentBilledBp)} of the contract sum to date`;
    return {
      summary: `Contract sum to date ${formatUSD(s.contractSumToDate)} (${formatUSD(s.originalContractSum)} original, ${formatUSD(s.changeOrders)} of change orders). Billed to date ${formatUSD(s.billedToDate)} (${basis}); billing this period ${formatUSD(s.billedThisPeriod)}, less retainage this period ${formatUSD(s.retainageThisPeriod)} at ${formatPercentBp(r.input.retainageBp)}: amount due this period ${formatUSD(s.dueThisPeriod)}. ${s.unpaidPriorBalance < 0 ? "Credit from prior payments" : "Unpaid prior balance"} ${formatUSD(s.unpaidPriorBalance)}; total due now ${formatUSD(s.totalDueNow)}. Retainage held to date ${formatUSD(s.retainageToDate)}; balance of contract left to bill ${formatUSD(s.balanceOfContract)}.`,
      tables: [
        { name: "Statement", rows: t.statement },
        { name: "Change orders", rows: t.changeOrders },
        ...t.milestones.length ? [{ name: "Milestones", rows: t.milestones }] : [],
        ...anyDetail ? [{ name: "Statement details", rows: [["Statement details", "Value"], ...details] }] : []
      ],
      checks: [...r.checks, ...milestoneRows ? rowAccounting(milestoneRows) : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: $86,000.00 original contract, change orders of +$3,450.00 and -$950.00, 62.5% complete, $35,400.00 billed and $28,000.00 paid before, 10% retainage",
      args: { originalContractSum: "86,000.00", changeOrders: ["3,450.00", "-950.00"], percentComplete: "62.5", previouslyBilled: "35,400.00", previouslyPaid: "28,000.00", retainage: "10" },
      verified: true,
      contains: ["Contract sum to date $88,500.00", "Billed to date $55,312.50", "billing this period $19,912.50", "retainage this period $1,991.25", "amount due this period $17,921.25", "Unpaid prior balance $3,860.00", "total due now $21,781.25", "Retainage held to date $5,531.25", "left to bill $33,187.50"]
    },
    {
      label: "Milestones that add up to $40,000.00 on a $50,000.00 contract are not verified",
      args: { originalContractSum: "50,000.00", milestones: "Milestone,Amount,Reached\nFoundation,20000.00,yes\nFraming,20000.00,no\n", retainage: "10" },
      verified: false,
      failedCheck: "milestones-sum"
    }
  ]
};
function retainageRuleText(r) {
  const i = r.input;
  const parts = [];
  if (i.reduced) {
    parts.push(
      `Rule applied: work billed up to ${formatPercentBp(i.reduced.thresholdBp)} of the contract amount (${formatUSD(r.thresholdAmount ?? 0)}) is held at ${formatPercentBp(i.retainageBp)}. Only work billed after that point is held at ${formatPercentBp(i.reduced.rateBp)}; retainage already held on the earlier work is not recalculated.`
    );
  } else {
    parts.push(`Rule applied: all work billed to date is held at ${formatPercentBp(i.retainageBp)}.`);
  }
  if (i.storedMaterials) parts.push(`Stored materials are held at their own rate (${formatPercentBp(i.storedMaterials.rateBp)}) and do not count toward the threshold.`);
  parts.push("Each multiplication is rounded once to the cent, with half a cent rounding away from zero.");
  return parts.join(" ");
}
var retainageCalculator = {
  name: "retainage_calculator",
  page: "construction/retainage-calculator",
  section: "construction",
  kind: "tool",
  title: "Retainage on one invoice, step by step",
  description: "Calculates retainage on one construction invoice step by step with the figures given: work billed to " +
    "date (typed, or the contract amount times the percent complete), retainage at one rate, or at a first " +
    "rate up to a threshold percent of the contract and a reduced rate on work billed after it, stored materials " +
    "at their own rate (they do not count toward the threshold), retainage withheld, the gross amount billed, " +
    "and net payable. Each step is worked a second time with separate whole-number arithmetic and both must " +
    "agree to the cent; retainage withheld plus net payable must equal the gross amount billed. A warning " +
    "is shown when work billed is more than the contract amount or the rate after the threshold is higher. " +
    "Use it when someone asks how to calculate retainage or retention, what is withheld on an invoice, or " +
    "what a reduced rate after 50% complete comes to. Not for tracking retainage across many billing periods, " +
    "and not for saying which rate a contract or statute allows.",
  question: "How much retainage is withheld on this invoice if it is 10% and drops to 5% after the job is half done?",
  inputs: [
    { name: "contractAmount", kind: "amount", label: "Contract amount", description: "The contract amount, like 184,650.00.", required: true },
    { name: "retainageRate", kind: "number", label: "Retainage (%)", description: "The retainage percent on work billed, like 10.", required: true },
    { name: "percentComplete", kind: "number", label: "Percent complete (%)", description: 'The percent complete, like 62.5; work billed is the contract amount times it. Give this or "billedToDate", not both.', required: false },
    { name: "billedToDate", kind: "amount", label: "Amount billed to date", description: 'The work billed to date, in dollars and cents. Give this or "percentComplete", not both.', required: false },
    { name: "thresholdPercent", kind: "number", label: "Threshold (% of the contract)", description: 'Optional, with "reducedRate": the percent of the contract after which the rate drops, like 50. Work billed up to it is held at the first rate.', required: false },
    { name: "reducedRate", kind: "number", label: "Retainage after the threshold (%)", description: 'Optional, with "thresholdPercent": the percent held on work billed after the threshold, like 5.', required: false },
    { name: "storedMaterials", kind: "amount", label: "Stored materials billed", description: "Optional. Stored materials billed on this invoice; they are added to the gross amount billed and held at their own rate.", required: false },
    { name: "storedRate", kind: "number", label: "Retainage on stored materials (%)", description: 'Optional, with "storedMaterials": the percent held on stored materials; 10 when not given, as on the page (not the retainage percent).', required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven works out retainage at the rates and threshold entered; it does not say which rate or threshold a contract or statute sets.",
  run({ values }) {
    const retainageBp = percentValue(values.retainageRate, "Retainage");
    const hasThreshold = values.thresholdPercent !== void 0;
    if (hasThreshold !== (values.reducedRate !== void 0)) throw new AgentInputError('A reduced rate needs both "thresholdPercent" (the percent of the contract where the rate drops) and "reducedRate".');
    if (values.storedRate !== void 0 && values.storedMaterials === void 0) throw new AgentInputError('"storedRate" is the rate on stored materials; give "storedMaterials" too.');
    const input = {
      contractAmount: values.contractAmount,
      ...values.percentComplete !== void 0 ? { percentCompleteBp: percentValue(values.percentComplete, "Percent complete") } : {},
      ...values.billedToDate !== void 0 ? { billedToDate: values.billedToDate } : {},
      retainageBp,
      ...hasThreshold ? { reduced: { thresholdBp: percentValue(values.thresholdPercent, "The threshold"), rateBp: percentValue(values.reducedRate, "The reduced rate") } } : {},
      ...values.storedMaterials !== void 0 ? { storedMaterials: { amount: values.storedMaterials, rateBp: percentValue(values.storedRate, "The rate on stored materials", "10") } } : {}
    };
    const r = computeRetainageCalc(input);
    const rule = retainageRuleText(r);
    return {
      summary: `Gross amount billed ${formatUSD(r.grossBilled)}; retainage withheld ${formatUSD(r.retainageWithheld)}; net payable after retainage ${formatUSD(r.netPayable)}. ${rule}`,
      tables: [{ name: "Retainage", rows: [...retainageCalcRows(r), ["Rule", rule, ""]] }],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: $184,650.00 at 62.5% complete, 10% dropping to 5% after 50%, and $6,400.00 of stored materials at 10%",
      args: { contractAmount: "184,650.00", percentComplete: "62.5", retainageRate: "10", thresholdPercent: "50", reducedRate: "5", storedMaterials: "6,400.00", storedRate: "10" },
      verified: true,
      contains: ["retainage withheld $11,026.56", "net payable after retainage $110,779.69", "Gross amount billed $121,806.25", "$184,650.00 × 62.50%", "$23,081.25 × 5.00%", "1154.06", "9232.50"]
    }
  ]
};
var PERIOD_ROLES = ["date", "billed", "released", "rate"];
var PERIOD_SYNONYMS = {
  date: ["period", "period date", "date", "period ending", "period end", "billing period", "period to", "month"],
  billed: ["work billed", "work billed this period", "billed this period", "amount billed", "billed", "billing", "invoice amount"],
  released: ["retainage released", "released", "retention released", "release", "amount released"],
  rate: ["retainage rate", "rate", "retainage percent", "retention rate", "retainage"]
};
var PERIOD_COLUMNS = {
  roles: PERIOD_ROLES,
  labels: { date: "Period", billed: "Work billed", released: "Retainage released", rate: "Retainage rate" },
  required: ["billed"],
  guess: (rows, at) => sheetGuessColumns(rows, PERIOD_ROLES, PERIOD_SYNONYMS, at)
};
var CUMULATIVE = /\b(to date|cumulative|ytd|jtd|year to date|job to date|running total|total billed|total released)\b/;
var retainageTracker = {
  name: "retainage_tracker_release_invoice",
  page: "construction/retainage-tracker",
  section: "construction",
  kind: "tool",
  title: "Retainage tracker and retainage release invoice",
  description: "Tracks retainage across every billing period of a job from a list of periods (.csv or .xlsx, or CSV text, one row per period: date, work billed, retainage rate, retainage released): the retainage withheld each period, cumulative withheld and released, and the balance still held, plus a retainage release invoice for an amount given, with the balance before and after it. Each period is recomputed on a second, independent pass, the balance must roll forward every period, a release may never be more than what was held at the time, and the invoice may not be more than the balance held. Use it when someone asks how much retainage is still being held on a job, or wants to bill for the release of retainage. Not for one invoice worked step by step, and not for deciding when retainage is due or may be released.",
  question: "How much retainage is still being held on this job, and what would a $5,000 release invoice leave?",
  inputs: [
    {
      name: "periods",
      kind: "file",
      label: "Billing periods",
      description: `A .csv or .xlsx file (a path, or the CSV text) with one row per billing period: the work billed that period is needed; the period date (like 2026-01-31), the retainage rate in percent and the retainage released that period are used when present. Each row holds the period's own figures: a column headed as a running total ("Billed to date", "Cumulative") is refused unless "columns" names it. A rate is written 10 or 10%; a plain 0.1 or 1 is refused, since a spreadsheet's percent cell stores 10% as 0.1 and 100% as 1 (write 1% for one percent). A blank rate cell is 0%, as on the page, and is named in a warning. ${TOTAL_LINE_RULE}`,
      required: true
    },
    { name: "defaultRate", kind: "number", label: "Retainage rate when the file has no rate column (%)", description: "Optional. The retainage percent for every period when the file has no rate column (as the page fills in new rows); 10 when not given. It is not used for a blank rate cell.", required: false },
    { name: "invoiceAmount", kind: "amount", label: "Amount of the release invoice", description: "Optional. The retainage release to invoice; it may not be more than the balance held. Without it no invoice is made.", required: false },
    { name: "invoiceNumber", kind: "text", label: "Invoice number", description: "Optional, for the release invoice.", required: false },
    { name: "invoiceDate", kind: "date", label: "Invoice date", description: "Optional, YYYY-MM-DD, for the release invoice; the run's day when not given.", required: false },
    { name: "from", kind: "text", label: "Your company (invoice from)", description: "Optional, for the release invoice.", required: false },
    { name: "billedTo", kind: "text", label: "Billed to", description: "Optional, for the release invoice.", required: false },
    { name: "job", kind: "text", label: "Job or project", description: "Optional, for the release invoice.", required: false },
    columnsInput("Billing periods", PERIOD_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven tracks retainage at the rates and releases entered; it does not say when retainage is due or what a contract or statute requires.",
  run({ files, values, now }) {
    const file = oneFile(files, "periods");
    const defaultBp = percentValue(values.defaultRate, "The default retainage rate", "10");
    const named = namedHeaders(values.columns);
    const blankRates = [];
    const x = readRows(file, PERIOD_COLUMNS, values.columns, "Billing periods", {
      noun: "period",
      total: sumsTo([moneySum("billed", "work billed", (p) => p.billed), moneySum("released", "retainage released", (p) => p.released)]),
      // A running total taken for each period's own billing would count every period again.
      vet: (columns, header) => {
        for (const role of ["billed", "released"]) {
          const h = (header[columns[role]] ?? "").trim();
          if (columns[role] < 0 || !CUMULATIVE.test(sheetNormalizeHeader(h)) || named.includes(sheetNormalizeHeader(h))) continue;
          const what = role === "billed" ? "work billed" : "retainage released";
          throw new AgentInputError(
            `The column "${h}" reads as a running total to date, and this tool needs the ${what} in each period on its own row (it adds the periods up itself). Give each period's own figure, or, if that column does hold each period's own figure, name it: "columns": "${PERIOD_COLUMNS.labels[role]} = ${h}".`
          );
        }
      },
      read: (cell, at) => {
        const rawDate = cell("date");
        let periodDate = "";
        if (rawDate !== "") {
          try {
            periodDate = pmCellToIsoDate(rawDate);
          } catch {
            throw new RowProblem(`the period date "${rawDate}" is not a date like 2026-01-31`);
          }
        }
        const of = ` of ${periodDate || `period ${at.index + 1}`}`;
        const rateBp = at.has("rate") ? percentCell(cell("rate"), `the retainage rate${of}`, 0) : defaultBp;
        const period = { periodDate, billed: centsCell(cell("billed"), `the work billed${of}`), rateBp, released: centsCell(cell("released"), `the retainage released${of}`) };
        if (at.has("rate") && cell("rate") === "") blankRates.push(at.rowNumber);
        return period;
      }
    });
    if (x.items.length === 0) return nothingRead(x, "list of billing periods");
    const rateChecks = x.columns.rate < 0 ? [{ id: "default-rate", label: "The file has a retainage rate column", passed: false, severity: "warning", detail: `None was found, so every period is held at ${formatPercentBp(defaultBp)} ("defaultRate")` }] : [{ id: "blank-rate", label: "No period's retainage rate cell is blank", passed: blankRates.length === 0, severity: "warning", ...blankRates.length ? { detail: `Blank on row(s) ${blankRates.join(", ")}: read as 0%, as the page reads a blank rate` } : {} }];
    const r = computeRetainage({ periods: x.items, invoiceAmount: centsOr(values.invoiceAmount) });
    const t = retainageTables(r);
    const invoice = r.invoice ? [
      ["Retainage release invoice", "Value"],
      ["Invoice number", str(values.invoiceNumber)],
      ["Invoice date", str(values.invoiceDate) || dayOf(now)],
      ["From", str(values.from)],
      ["Billed to", str(values.billedTo)],
      ["Job or project", str(values.job)],
      ["Retainage withheld to date", formatUSD(r.totals.withheld)],
      ["Retainage released to date", formatUSD(r.totals.released)],
      ["Balance held before this invoice", formatUSD(r.invoice.balanceBefore)],
      ["Amount of this invoice", formatUSD(r.invoice.amount)],
      ["Balance held after this invoice", formatUSD(r.invoice.balanceAfter)]
    ] : null;
    return {
      summary: `${r.periods.length} period(s): work billed totals ${formatUSD(r.totals.billed)}, retainage withheld totals ${formatUSD(r.totals.withheld)}, ${formatUSD(r.totals.released)} has been released, and ${formatUSD(r.totals.balanceHeld)} is still held.${r.invoice ? ` A release invoice for ${formatUSD(r.invoice.amount)} leaves ${formatUSD(r.invoice.balanceAfter)} held.` : ""}`,
      tables: [
        { name: "Periods", rows: t.periods },
        { name: "Summary", rows: t.summary },
        ...invoice ? [{ name: "Release invoice", rows: invoice }] : []
      ],
      checks: [...r.checks, ...rateChecks, ...rowAccounting(x)]
    };
  },
  examples: [
    {
      label: "The page's worked example: three periods of a framing subcontract, 10% then 5% in March with $2,000.00 released, and a $5,000.00 release invoice",
      args: { periods: "agents-fixture:construction/retainage-periods.csv", invoiceAmount: "5,000.00" },
      verified: true,
      contains: ["work billed totals $100,000.00", "retainage withheld totals $8,762.53", "$2,000.00 has been released", "$6,762.53 is still held", "A release invoice for $5,000.00 leaves $1,762.53 held", "1237.48", "7525.05"]
    },
    {
      label: "A release invoice for more than the balance held is not verified",
      args: { periods: "agents-fixture:construction/retainage-periods.csv", invoiceAmount: "7,000.00" },
      verified: false,
      failedCheck: "invoice-within-balance"
    },
    {
      label: "A rate cell that reads like a fraction (0.1) cannot be read, so the result is not verified",
      args: { periods: "Period,Work billed,Retainage rate,Retainage released\n2026-01-31,40000.00,10,0.00\n2026-02-28,35250.50,0.1,0.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var SOV_ENTRY_ROLES = ["description", "kind", "value"];
var SOV_ENTRY_SYNONYMS = {
  description: ["description", "description of work", "line", "line of work", "item", "work", "scope"],
  kind: ["entered as", "kind", "type", "basis", "how entered", "line type"],
  value: ["percent or amount", "value", "amount", "percent", "share"]
};
var SOV_ENTRY_COLUMNS = {
  roles: SOV_ENTRY_ROLES,
  labels: { description: "Description", kind: "Entered as", value: "Percent or amount" },
  required: ["value"],
  guess: (rows, at) => sheetGuessColumns(rows, SOV_ENTRY_ROLES, SOV_ENTRY_SYNONYMS, at)
};
function sovEntry(description, kindText, valueText, i) {
  const k = kindText.trim().toLowerCase();
  const v = valueText.trim();
  const of = ` of ${description || `line ${i + 1}`}`;
  const kind = /spread/.test(k) ? "spread" : /percent|%|pct/.test(k) ? "percent" : /fixed|amount|\$/.test(k) ? "fixed" : k === "" ? v.includes("$") ? "fixed" : "percent" : null;
  if (kind === null) throw new RowProblem(`the line type${of} "${kindText}" is not percent, fixed or spread`);
  if (kind === "fixed") return { description, kind, amount: centsCell(v, `the fixed amount${of}`) };
  const s = v.replace(/%$/, "").trim();
  let percentBp = 0;
  if (s !== "") {
    try {
      percentBp = percentToBasisPoints(s);
    } catch {
      throw new RowProblem(`the percent${of} "${v}" is not a percent with at most two decimals`);
    }
  }
  if (percentBp > 1e4) throw new RowProblem(`the percent${of} "${v}" is more than 100% (a fixed amount needs "fixed" in the Entered as column)`);
  if (fractionLike(v, percentBp)) throw new RowProblem(`the percent${of} "${v}" ${FRACTION}`);
  return { description, kind, percentBp };
}
function sovTotalRule(contract) {
  return (cell, above) => {
    const raw = cell("value").trim();
    if (raw === "") return { ok: true, figures: false };
    const sharing = above.filter((e) => e.kind !== "fixed");
    const percents = sharing.reduce((s, e) => s + (e.percentBp ?? 0), 0);
    const fixed = above.filter((e) => e.kind === "fixed").reduce((s, e) => s + (e.amount ?? 0), 0);
    const amount = parseSheetAmount(raw);
    let bp = null;
    try {
      bp = percentToBasisPoints(raw.replace(/%$/, "").trim());
    } catch {
      bp = null;
    }
    const asPercent = !raw.includes("$") && bp !== null && sharing.length > 0 && bp === percents;
    const asAmount = !raw.includes("%") && amount.kind === "ok" && (amount.cents === contract || sharing.length === 0 && amount.cents === fixed);
    return asPercent || asAmount ? { ok: true, figures: true } : { ok: false, reason: `its value "${raw}" is neither the contract sum (${formatUSD(contract)}) nor the sum of the lines above it` };
  };
}
var scheduleOfValues = {
  name: "schedule_of_values_builder",
  page: "construction/schedule-of-values",
  section: "construction",
  kind: "tool",
  title: "Schedule of values that adds up to the contract",
  description: "Builds a schedule of values from a contract sum and a list of lines (.csv or .xlsx, or CSV text: description, entered as percent, fixed or spread, and the percent or amount). Fixed lines keep their amount; percent lines share what is left of the contract after the fixed lines, by their percents; lines marked spread (general conditions, overhead) are divided across the other lines by their amounts and do not appear on the schedule. Leftover cents go to the largest fractions, so the lines add up to the contract sum exactly; the percents must cover the whole contract, no line may be negative, and every column is re-added a second time with separate whole-number arithmetic. The schedule comes back in the pay application layout with nothing billed yet. Use it when someone asks to set up or split a contract into a schedule of values, or to spread general conditions across the lines. Not for billing progress, and not for deciding how a contract is divided.",
  question: "Can you split our $250,000 framing subcontract into a schedule of values, with general conditions spread across the other lines?",
  inputs: [
    { name: "contractSum", kind: "amount", label: "Contract sum", description: "The contract sum the schedule has to add up to, like 250,000.00.", required: true },
    {
      name: "lines",
      kind: "file",
      label: "Schedule lines",
      description: `A .csv or .xlsx file (a path, or the CSV text) with one row per line of work: the percent or amount is needed; description and "entered as" (percent, fixed, or spread; blank is percent, or fixed when the value has a $ sign) are used when present. A percent is written 40 or 40%; a plain 0.4 or 1 is refused, since a spreadsheet's percent cell stores 40% as 0.4 and 100% as 1 (write 1% for one percent). A row whose first cell starts with a total word is the file's own total line only when its value is the contract sum or the sum of the lines above it; any other such row fails the row check.`,
      required: true
    },
    { name: "retainage", kind: "number", label: "Retainage for the pay application file (%)", description: 'Optional. The retainage percent written into the pay application file that "saveTo" ending .json saves (the file the pay application builder opens as application 1); 10 when not given.', required: false },
    columnsInput("Schedule lines", SOV_ENTRY_COLUMNS)
  ],
  limits: "site",
  fileExtensions: [".json"],
  notAdvice: "Mathproven divides the contract sum as the lines are entered; it does not say how a contract should be divided among lines.",
  run({ files, values }) {
    const file = oneFile(files, "lines");
    const contract = values.contractSum;
    const retainageBp = percentValue(values.retainage, "The retainage for the pay application file", "10");
    const x = readRows(file, SOV_ENTRY_COLUMNS, values.columns, "Schedule lines", { noun: "line", total: sovTotalRule(contract), read: (cell, at) => sovEntry(cell("description"), cell("kind"), cell("value"), at.index) });
    if (x.items.length === 0) return nothingRead(x, "list of schedule lines");
    const r = buildScheduleOfValues({ contractSum: contract, entries: x.items });
    const t = r.totals;
    const shown = r.lines.slice(0, 12).map((l) => `${l.description || `line ${l.itemNo}`} ${formatUSD(l.scheduledValue)}`);
    const more = r.lines.length > shown.length ? `, and ${r.lines.length - shown.length} more` : "";
    const payAppFile = { suggestedName: "pay-application-1.json", bytes: new TextEncoder().encode(JSON.stringify(sovToPayAppFile(r, retainageBp), null, 2)) };
    return {
      file: payAppFile,
      summary: `${r.lines.length} line(s) on the schedule add up to ${formatUSD(t.scheduled)} against a contract sum of ${formatUSD(t.contractSum)}: ${shown.join("; ")}${more}. Fixed amounts ${formatUSD(t.fixed)}, left for the percent lines ${formatUSD(t.remainder)}, spread across the other lines ${formatUSD(t.spread)}. Give "saveTo" a path ending .json to save the file the pay application builder opens as application 1 (retainage ${formatPercentBp(retainageBp)}).`,
      tables: [
        { name: "Schedule of values", rows: sovExportRows(r) },
        { name: "How it was built", rows: sovWorkingRows(r) }
      ],
      checks: [...r.checks, ...rowAccounting(x)]
    };
  },
  examples: [
    {
      label: "The page's worked example: a $250,000.00 framing subcontract, a fixed $12,500.00 mobilization, three percent lines and general conditions at 10% spread",
      args: { contractSum: "250,000.00", lines: "agents-fixture:construction/sov-lines.csv" },
      verified: true,
      contains: ["4 line(s) on the schedule add up to $250,000.00", "Mobilization $13,888.89", "Rough framing $111,111.11", "Roof framing $69,444.44", "Exterior sheathing $55,555.56", "Fixed amounts $12,500.00", "left for the percent lines $237,500.00", "spread across the other lines $25,000.00"]
    },
    {
      label: "Percent lines that total 90% of the contract are not verified",
      args: { contractSum: "100,000.00", lines: "Description,Entered as,Percent or amount\nSite work,percent,50\nBuilding,percent,40\n" },
      verified: false,
      failedCheck: "coverage"
    },
    {
      label: "A line whose percent cannot be read is not verified",
      args: { contractSum: "100,000.00", lines: "Description,Entered as,Percent or amount\nSite work,percent,50\nBuilding,percent,fifty\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var CONSTRUCTION = [
  payApplication,
  payAppChecker,
  payAppTemplate,
  scheduleOfValues,
  progressBilling,
  retainageCalculator,
  retainageTracker,
  lienWaiver,
  latePaymentInterest,
  overUnderBilling,
  fringeCredit
];
var CONSTRUCTION_NOT_FOR_AGENTS = [];

export {
  CONSTRUCTION,
  CONSTRUCTION_NOT_FOR_AGENTS
};
