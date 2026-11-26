// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  PROMPT_PAY_JOB_LABELS,
  PROMPT_PAY_PAYMENT_LABELS,
  PROMPT_PAY_TABLE,
  addCalendarDays,
  calendarDaysBetween,
  civilDayNumber,
  daysInMonth,
  findPromptPayRow,
  formatCivilDate,
  longDate,
  parseCivilDate,
  promptPayPercent,
  refAddMonths,
  refMemberName
} from "./promptPay.mjs";
import {
  CheckList,
  assertCents,
  formatUSD
} from "./money.mjs";

// packages/core/src/construction/lateInterest.ts
var LATE_INTEREST_METHOD_LABELS = {
  daily: "Daily: the rate spread over each day late",
  month: "Per month: full months, then the days left over by the day",
  "month-or-fraction": "Per month or fraction: each month started counts as a whole month"
};
var RATE_YEARLY_MAX_BP = 1e4;
var DAYS_MAX = 36600;
function lateInterestRateLabel(rate) {
  return `${promptPayPercent(rate.bp)} per ${rate.per}`;
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
function checkRate(rate) {
  if (!rate || rate.per !== "year" && rate.per !== "month" && rate.per !== "day") throw new Error("The rate must be per year, per month, or per day.");
  if (!Number.isSafeInteger(rate.bp) || rate.bp <= 0) throw new Error("Enter a rate above zero, with at most two decimals.");
  const yearly = rate.per === "year" ? rate.bp : rate.per === "month" ? rate.bp * 12 : rate.bp * 365;
  if (yearly > RATE_YEARLY_MAX_BP) throw new Error("That rate is more than 100% a year. Check the rate and what it is per.");
  return { per: rate.per, bp: rate.bp };
}
function dailyFraction(amount, rate, days, year) {
  const a = BigInt(amount);
  const bp = BigInt(rate.bp);
  const t = BigInt(days);
  if (rate.per === "day") return { n: a * bp * t, d: 10000n };
  if (rate.per === "month") return { n: a * bp * 12n * t, d: 10000n * BigInt(year) };
  return { n: a * bp * t, d: 10000n * BigInt(year) };
}
function monthlyFraction(amount, rate, months) {
  const a = BigInt(amount);
  const bp = BigInt(rate.bp);
  const m = BigInt(months);
  if (rate.per === "month") return { n: a * bp * m, d: 10000n };
  if (rate.per === "year") return { n: a * bp * m, d: 120000n };
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
function dailyWorking(amount, rate, days, year, result) {
  const p = promptPayPercent(rate.bp);
  const d = `${days} ${days === 1 ? "day" : "days"}`;
  if (rate.per === "day") return `${formatUSD(amount)} × ${p} × ${d} = ${formatUSD(result)}`;
  if (rate.per === "month") return `${formatUSD(amount)} × ${p} × 12 × ${d} ÷ ${year} = ${formatUSD(result)}`;
  return `${formatUSD(amount)} × ${p} × ${d} ÷ ${year} = ${formatUSD(result)}`;
}
function monthlyWorking(amount, rate, months, result) {
  const p = promptPayPercent(rate.bp);
  const m = `${months} ${months === 1 ? "month" : "months"}`;
  return rate.per === "year" ? `${formatUSD(amount)} × ${p} ÷ 12 × ${m} = ${formatUSD(result)}` : `${formatUSD(amount)} × ${p} × ${m} = ${formatUSD(result)}`;
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
  let rate;
  let rateSource;
  if (input.rate) {
    rate = checkRate(input.rate);
    rateSource = "typed";
  } else {
    if (!deadline) throw new Error("Type the rate, or pick a row of the table that has a fixed rate.");
    if (!deadline.rate) throw new Error(`The row stores no fixed rate (${deadline.rateText}). Type the rate.`);
    rate = { per: deadline.rate.per, bp: deadline.rate.bp };
    rateSource = "table";
  }
  if (rate.per === "day" && input.method !== "daily") throw new Error("A rate per day has no monthly rate. Pick the daily method for it.");
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
      part("days", "Interest for the days late", dailyFraction(amount, rate, daysLate, year), (c) => dailyWorking(amount, rate, daysLate, year, c));
    } else {
      fullMonths = fullMonthsBetween(dueDate, paidDate);
      monthsEnd = refAddMonths(dueDate, fullMonths);
      leftoverDays = calendarDaysBetween(monthsEnd, paidDate);
      if (input.method === "month") {
        monthsCharged = fullMonths;
        if (fullMonths > 0) part("months", "Interest for the full months", monthlyFraction(amount, rate, fullMonths), (c) => monthlyWorking(amount, rate, fullMonths, c));
        if (leftoverDays > 0) part("leftover", "Interest for the days left over", dailyFraction(amount, rate, leftoverDays, year), (c) => dailyWorking(amount, rate, leftoverDays, year, c));
      } else {
        monthsCharged = fullMonths + (leftoverDays > 0 ? 1 : 0);
        part("months", "Interest for the months started", monthlyFraction(amount, rate, monthsCharged), (c) => monthlyWorking(amount, rate, monthsCharged, c));
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
    rate,
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

export {
  LATE_INTEREST_METHOD_LABELS,
  lateInterestRateLabel,
  lateInterestRule,
  computeLateInterest,
  verifyLateInterest,
  lateInterestRows,
  lateInterestRowText,
  compareLateInterest
};
