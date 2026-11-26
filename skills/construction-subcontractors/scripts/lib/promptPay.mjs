// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  assertCents
} from "./money.mjs";

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
  const day2 = Number(m[3]);
  if (year < 1900 || year > 2200) throw new Error(`The ${label} has a year outside 1900 to 2200.`);
  if (month < 1 || month > 12 || day2 < 1 || day2 > daysInMonth(year, month)) {
    throw new Error(`The ${label} "${iso}" is not a real calendar date.`);
  }
  return { year, month, day: day2 };
}
function formatCivilDate(d) {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
function civilDayNumber(d) {
  const y = d.month <= 2 ? d.year - 1 : d.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function civilFromDayNumber(n) {
  if (!Number.isSafeInteger(n)) throw new Error("Day number must be a whole number.");
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day2 = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day: day2 };
}
function calendarDaysBetween(fromIso, toIso) {
  return civilDayNumber(parseCivilDate(toIso, "end date")) - civilDayNumber(parseCivilDate(fromIso, "start date"));
}
function addCalendarDays(iso, days) {
  if (!Number.isSafeInteger(days)) throw new Error("The number of days must be a whole number.");
  return formatCivilDate(civilFromDayNumber(civilDayNumber(parseCivilDate(iso)) + days));
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var WEEKDAYS = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
function weekdayName(iso) {
  const n = civilDayNumber(parseCivilDate(iso));
  return WEEKDAYS[(n % 7 + 7) % 7];
}
function longDate(iso) {
  const d = parseCivilDate(iso);
  return `${weekdayName(iso)}, ${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

// packages/core/src/reference/sourced.ts
var STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
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
];
var REF_US_STATES = STATES.map(([code, name]) => ({ code, name }));
var REF_US_STATES_DC = [...REF_US_STATES, { code: "DC", name: "District of Columbia" }].sort((a, b) => a.name.localeCompare(b.name));
function refMemberName(members, code) {
  return members.find((m) => m.code === code)?.name ?? code;
}
function refIsDay(text) {
  if (typeof text !== "string") return false;
  try {
    parseCivilDate(text);
    return true;
  } catch {
    return false;
  }
}
function refIsOfficialUrl(url, officialHosts = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host.endsWith(".gov") || host.endsWith(".us") || officialHosts.some((h) => host === h || host.endsWith(`.${h}`));
}
function refSourceProblem(s, latest, officialHosts = []) {
  if (!s) return "no source";
  if (typeof s.citation !== "string" || s.citation.trim().length < 6) return "no citation";
  if (typeof s.sourceUrl !== "string" || !refIsOfficialUrl(s.sourceUrl, officialHosts)) return "no official https source address";
  if (!refIsDay(s.checkedOn)) return "no checked date";
  if (s.checkedOn > latest) return `checked ${s.checkedOn}, after the table's date ${latest}`;
  return "";
}
var listed = (items) => [...new Set(items)].sort().join(", ");
function refCheckTable(table, keyOf = (r) => r.code, moreSources = () => []) {
  const checks = new CheckList();
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const members = new Set(table.members.map((m) => m.code));
  const strangers = [...rows.map((r) => r.code), ...gaps.map((g) => g.code)].filter((code) => !members.has(code));
  const keys = /* @__PURE__ */ new Map();
  for (const r of rows) keys.set(keyOf(r), (keys.get(keyOf(r)) ?? 0) + 1);
  const twice = [...keys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const gapCount = /* @__PURE__ */ new Map();
  for (const g of gaps) gapCount.set(g.code, (gapCount.get(g.code) ?? 0) + 1);
  const gapTwice = [...gapCount.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const covered = new Set(rows.map((r) => r.code));
  const both = gaps.map((g) => g.code).filter((code) => covered.has(code));
  const unaccounted = [...members].filter((code) => !covered.has(code) && !gapCount.has(code));
  checks.that(
    "ref-members",
    "Every member is in the table or listed once as not yet covered, and no row appears twice",
    strangers.length + twice.length + gapTwice.length + both.length + unaccounted.length === 0,
    [
      strangers.length ? `not a member: ${listed(strangers)}` : "",
      twice.length ? `row more than once: ${listed(twice)}` : "",
      gapTwice.length ? `not-covered more than once: ${listed(gapTwice)}` : "",
      both.length ? `both covered and not covered: ${listed(both)}` : "",
      unaccounted.length ? `missing from both lists: ${listed(unaccounted)}` : ""
    ].filter(Boolean).join("; ")
  );
  const unsourced = [];
  const hosts = table.officialHosts ?? [];
  if (!refIsDay(table.checkedOn)) unsourced.push(`the table (its date ${table.checkedOn} is not a real day)`);
  for (const r of rows) {
    const own = refSourceProblem(r, table.checkedOn, hosts);
    if (own) unsourced.push(`${keyOf(r)} (${own})`);
    for (const more of moreSources(r)) {
      const extra = refSourceProblem(more, table.checkedOn, hosts);
      if (extra) unsourced.push(`${keyOf(r)} further source (${extra})`);
    }
  }
  for (const g of gaps) if (typeof g.reason !== "string" || g.reason.trim().length < 10) unsourced.push(`${g.code} (no reason given for leaving it out)`);
  checks.that("ref-sourced", "Every row names the official source it was read from, links it, and carries the date it was checked", unsourced.length === 0, unsourced.slice(0, 12).join("; "));
  checks.that("ref-coverage", "Every member has a row", gaps.length === 0, `${gaps.length} not yet covered: ${listed(gaps.map((g) => g.code))}`, "warning");
  return checks.all;
}
function refAddMonths(iso, months) {
  if (!Number.isSafeInteger(months)) throw new Error("The number of months must be a whole number.");
  const d = parseCivilDate(iso);
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return formatCivilDate({ year, month, day: Math.min(d.day, daysInMonth(year, month)) });
}

// packages/core/src/reference/findings.ts
function refNameList(codes, members) {
  const names = [...new Set(codes)].map((c) => refMemberName(members, c)).sort((a, b) => a.localeCompare(b));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
function refCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function refTally(items) {
  const by = /* @__PURE__ */ new Map();
  for (const it of items) by.set(it.value, [...by.get(it.value) ?? [], it.code]);
  return [...by].map(([value, codes]) => ({ value, codes })).sort((a, b) => b.codes.length - a.codes.length || (typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
}
function refExtremes(items) {
  if (items.length === 0) return null;
  for (const it of items) if (!Number.isSafeInteger(it.value)) throw new Error(`Not a whole number: ${it.value} (${it.code})`);
  const min = Math.min(...items.map((i) => i.value));
  const max = Math.max(...items.map((i) => i.value));
  return { min, minCodes: items.filter((i) => i.value === min).map((i) => i.code), max, maxCodes: items.filter((i) => i.value === max).map((i) => i.code) };
}

// packages/core/src/construction/promptPay.ts
var CHECKED = "2026-10-19";
var CHECKED_20 = "2026-10-20";
var src = (citation, sourceUrl) => ({ citation, sourceUrl, checkedOn: CHECKED });
var src20 = (citation, sourceUrl) => ({ citation, sourceUrl, checkedOn: CHECKED_20 });
var CA = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml";
var FL = "https://www.flsenate.gov/Laws/Statutes/2026/";
var KS = "https://www.ksrevisor.gov/statutes/chapters/ch16/";
var IL = "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=";
var MD = "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=";
var MA = "https://malegislature.gov/Laws/GeneralLaws";
var MCL = "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-";
var MN = "https://www.revisor.mn.gov/statutes/cite/";
var MCA = "https://mca.legmt.gov/bills/mca/title_0280/chapter_0020/part_0210/section_";
var NE = "https://nebraskalegislature.gov/laws/statutes.php?statute=";
var VA = "https://law.lis.virginia.gov/vacode/";
var CT = "https://www.cga.ct.gov/current/pub/chap_742b.htm";
var DE = "https://delcode.delaware.gov/title6/c035/index.html";
var DC = "https://code.dccouncil.gov/us/dc/council/code/sections/";
var KY = "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=";
var NY = "https://www.nysenate.gov/legislation/laws/GBS/";
var OK15 = "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os15.pdf";
var PA = "https://www.legis.state.pa.us/WU01/LI/LI/US/PDF/1994/0/0007..PDF";
var RI = "https://webserver.rilegislature.gov/Statutes/TITLE42/42-11.1/";
var PER_MONTH = (bp, partMonthIsWhole = false) => partMonthIsWhole ? { per: "month", bp, partMonthIsWhole: true } : { per: "month", bp };
var CA_CCP = src("Cal. Code Civ. Proc. § 685.010(a)", `${CA}?lawCode=CCP&sectionNum=685.010`);
var CA_PENALTY = "The section charges the 2% for every month payment is not made; the calculator spreads it by the day.";
var MN_MINIMUM = "The section also sets a minimum interest payment of $10 a month on an unpaid balance of $100 or more, which the calculator does not apply.";
var MT_PART21 = [src("Mont. Code Ann. § 28-2-2103", `${MCA}0030/0280-0020-0210-0030.html`), src("Mont. Code Ann. § 28-2-2104", `${MCA}0040/0280-0020-0210-0040.html`)];
var MT_SCOPE = [src("Mont. Code Ann. § 28-2-2101", `${MCA}0010/0280-0020-0210-0010.html`), src("Mont. Code Ann. § 28-2-2115", `${MCA}0150/0280-0020-0210-0150.html`)];
var NE_ACT = [src("Neb. Rev. Stat. § 45-1203", `${NE}45-1203`), src("Neb. Rev. Stat. § 45-1205", `${NE}45-1205`)];
var NE_NOTICE = "Interest is due only after the payer has been told of the section's interest provision, and accepting a payment releases claims for interest on it.";
var SC_NOTICE = "Interest is due only if the payer was told of § 29-6-50 when payment was requested.";
function row(code, job, citation, sourceUrl, deadlines, notes, alsoRead) {
  return { code, job, citation, sourceUrl, checkedOn: CHECKED, deadlines, notes, ...alsoRead ? { alsoRead } : {} };
}
function row20(code, job, citation, sourceUrl, deadlines, notes, alsoRead) {
  return { ...row(code, job, citation, sourceUrl, deadlines, notes, alsoRead), checkedOn: CHECKED_20 };
}
var CT_NOTICE = "Interest is owed only after the unpaid party sends a claim notice by registered or certified mail; it accrues from the day the notice is received, and the payer is liable for it 10 days after that. The calculator counts it from the due date.";
var DC_INTEREST = [src20("D.C. Code § 27A-103", `${DC}27A-103`)];
var DC_SUB = [src20("D.C. Code § 27A-104", `${DC}27A-104`), src20("D.C. Code § 27A-105", `${DC}27A-105`)];
var DE_RATE = "The legal rate in effect when the interest accrues, from the day after the payment date; interest unpaid at the end of each 30 days is added to the principal (set in another section; no interest is computed here)";
var NY_INTEREST = [src20("N.Y. Gen. Bus. Law § 756-b(1)", `${NY}756-B`)];
var ND_COMPOUND = "Interest unpaid at the end of each 45-day period is added to the principal (§ 13-01.1-03); the calculator does not compound it.";
var RI_RATE = [src20("R.I. Gen. Laws § 42-11.1-5", `${RI}42-11.1-5.htm`), src20("R.I. Gen. Laws § 42-11.1-6", `${RI}42-11.1-6.htm`)];
var AL = "https://alison.legislature.state.al.us/code-of-alabama?section=";
var AL_RATE = "1% per month (12% per year) on the unpaid balance";
var AK = "https://www.akleg.gov/basis/statutes.asp#";
var AK_LEGAL_RATE = src20("AS 45.45.010(a)", `${AK}45.45.010`);
var NJ = "https://lis.njleg.state.nj.us/nxt/gateway.dll/statutes/1/112/";
var NJ_DOC = "?f=templates$fn=document-frameset.htm$3.0";
var NJ_RATE = "The prime rate plus 1%, from the day after the required payment date (floats)";
var NM = "https://nmonesource.com/nmos/nmsa-unanno/en/item/18560/index.do";
var NM_RATE = "1.5% of the undisputed amount per month or fraction of a month, until payment is issued";
var SD = "https://sdlegislature.gov/Statutes/";
var SD_RATE = [src20("S.D. Codified Laws § 54-3-16(2)", `${SD}54-3-16`)];
var TX_GV = "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.2251.htm";
var TX_PR = "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.28.htm";
var UT = "https://le.utah.gov/xcode/Title15/Chapter6/15-6-S";
var LEXIS_PA = "https://www.lexisnexis.com/hottopics/";
var AR_CODE = `${LEXIS_PA}arcode/`;
var CO_CRS = `${LEXIS_PA}colorado/sendSearch.asp?source=4900&tocdisplay=on`;
var GA_CODE = `${LEXIS_PA}gacode`;
var MS_CODE = `${LEXIS_PA}mscode/`;
var TN_CODE = `${LEXIS_PA}tncode`;
var GA_RATE = "1% per month or a pro rata fraction of a month on the unpaid balance, from the day after the due date";
var GA_NOTICE = "Interest is due only if the payer was told of § 13-11-7 when payment was requested, and accepting a progress or final payment releases claims for interest on it. Periods and rates agreed in the contract control instead, except on a willful breach of the payment terms.";
var msFinal = (days) => `The section runs interest on a late final payment from the event itself, not from the end of the ${days} days; the calculator counts it from the end of the ${days} days. Progress payments are due when the contract says, and if they are not paid within ${days} calendar days of that date they bear 1% per month from the due date. Final payment waits for the surety's written consent.`;
var MS_SUB_RATE = "A penalty of 0.5% per day of the delinquency, from the end of the 15 days until paid, up to 15% of the outstanding balance in all (no interest is computed here, since the calculator applies no cap)";
var MS_SUB_CAVEAT = "The penalty applies when payment is withheld without reasonable cause. A contractor paid less than the full amount due pays its subcontractors and suppliers pro rata.";
var TN_PRIVATE_RATE = "1.5% per month from the date due until the date paid, when the written contract sets no rate for delinquent payments";
var PROMPT_PAY_ROWS = [
  row20("AL", "public", "Ala. Code § 39-2-12(b)", `${AL}39-2-12`, [
    { payment: "owner", days: 35, count: "calendar", from: "the awarding authority's acceptance that the estimate and the contract's terms for partial payments are met (partial payments, monthly unless the specifications provide otherwise)", rate: null, rateText: "The rate assessed for underpayment of taxes under § 40-1-44(a), on the undisputed unpaid balance (set in another section; no interest is computed here)", caveat: "When the money comes from a grant, award, or reimbursement that arrives after the contract and the bid and contract say so, the prompt payment rules apply only once the awarding authority receives it, and payment is then processed within 10 days (subsection (l))." }
  ], "Public works contracts of awarding authorities. The person the contract names reviews a payment request within 10 days (20 for the Department of Transportation). Final payment is due 35 days after completion, acceptance, and the certified voucher, release, and proof of advertisement (subsection (i)). An agreement made after the contract to lengthen the 35 days is not enforceable. Retainage is at most 5% and stops at 50% completion. The partial-payment interest does not apply to contracts the Alabama Building Commission administers; the section does not apply to disaster response and recovery contracts or to state agencies under Chapter 1 of Title 33. It sets no subcontractor day count."),
  row20("AL", "private", "Ala. Code § 8-29-3(a), (b), (d)", `${AL}8-29-3`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of the pay request or invoice, when the owner and contractor have not agreed on payment terms", rate: PER_MONTH(100), rateText: AL_RATE, caveat: "Every contract must state a payment date (§ 8-29-2); the agreed payment terms govern, and the 30 days apply only when none were agreed." },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of payment from the owner, when the contractor and subcontractor have not agreed on payment terms", rate: PER_MONTH(100), rateText: AL_RATE, caveat: "Subsection (b) lets agreed payment terms govern; subsection (e) sets the same 7th day for passing on the subcontractor's share of each owner payment." }
  ], "Contracts to improve real property in Alabama. Not covered: residential homebuilders, residential improvements of 16 or fewer units, contracts and subcontracts of $10,000 or less, and contracts with the state or local governments of Alabama (§ 8-29-7). Subcontractors pay sub-subcontractors within 7 days of being paid when no terms are agreed. Retainage is at most 10% and stops at 50% completion; retainage withheld from a subcontractor may not exceed the percentage withheld from the contractor.", [src20("Ala. Code § 8-29-2", `${AL}8-29-2`), src20("Ala. Code § 8-29-7", `${AL}8-29-7`)]),
  row20("AK", "public", "AS 36.90.200(a), (b); AS 36.90.210(a)", `${AK}36.90.200`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a payment request that complies with the contract, for satisfactory performance (the state or a political subdivision)", rate: null, rateText: "10.5% per year (the legal rate in AS 45.45.010(a)), from the 21st calendar day after the payment date; no interest is computed here, since it starts 20 days after the due date", caveat: "When a political subdivision pays with grant money, or the state with federal money, payment is due within 21 calendar days of the request or of the money's actual arrival, whichever is later.", sources: [AK_LEGAL_RATE] },
    { payment: "sub", days: 8, count: "business", from: "the prime contractor's receipt of the payment from which the subcontractor is to be paid, for satisfactory performance (working days leave out weekends and state holidays)", rate: { per: "year", bp: 1050 }, rateText: "10.5% per year (the legal rate in AS 45.45.010(a)), from the day after the required payment date", sources: [src20("AS 36.90.210(a)", `${AK}36.90.210`), AK_LEGAL_RATE] }
  ], "Public construction and public works contracts of the state and of political subdivisions that have a written contract with the state to fund the project (AS 36.90.265); not political subdivisions with a population under 800. The 8 working days are a clause every subcontract must carry, at every tier, and a waiver is void (AS 36.90.270). A payment withheld for unsatisfactory performance or a noncompliant request is explained in writing within 8 working days and paid within 21 days after the remedy. This interest does not apply to retainage, which earns interest at the same rate (AS 36.90.250).", [src20("AS 36.90.250 to 36.90.290", `${AK}36.90.250`)]),
  row("AZ", "public", "A.R.S. § 34-221(C)(2), (G), (J), (K)", "https://www.azleg.gov/ars/34/00221.htm", [
    { payment: "owner", days: 14, count: "calendar", from: "certification and approval of the estimate of the work (an estimate counts as approved 7 days after submission unless the owner issues a written finding on the items not approved)", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month on the unpaid balance" },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of each progress payment, unless agreed otherwise in writing", rate: PER_MONTH(100, true), rateText: "1% per month or a fraction of a month, from the 8th day" }
  ], "Public works contracts awarded under the section, with monthly progress payments on contracts of 90 days or more. A contract may not materially alter the right to prompt payment the section sets."),
  row20("AR", "public", "Ark. Code Ann. § 22-9-205", AR_CODE, [
    { payment: "owner", days: 90, count: "calendar", from: "presentation of the contractor's claim for payment after completion and approval of the project (agencies of the state and of counties, municipalities, school districts, and other local taxing units and improvement districts)", rate: { per: "year", bp: 1e3 }, rateText: "10% per year on the unpaid amount, for the time after the 90 days", caveat: "The section covers contracts that provide for payment on completion and acceptance of the project." }
  ], "Contracts for repairs, alterations, buildings, highways, roads, streets, sidewalks, drainage or sewer projects, and other construction covered by §§ 22-9-202 to 22-9-204; not contracts the State Highway Commission awards under §§ 27-67-206 and 27-67-207 (§ 22-9-201). On state construction projects, § 19-4-1410 allows 5 working days each to the design professional, the agency, and the Department of Finance and Administration to process a proper payment request, not counting transmittal time, with a penalty of 8% per year against the party that delays. On a public construction contract with a performance and payment bond, the contractor is paid 95% of earned progress payments when due, and the 5% retained is paid within 30 days after the contract is completed (§ 22-9-604). The sections read set no subcontractor day count.", [src20("Ark. Code Ann. § 19-4-1410", AR_CODE), src20("Ark. Code Ann. § 22-9-201", AR_CODE), src20("Ark. Code Ann. § 22-9-604", AR_CODE)]),
  row("CA", "public", "Cal. Pub. Contract Code § 10261.5(a)", `${CA}?lawCode=PCC&sectionNum=10261.5`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of an undisputed, properly submitted payment request (state agencies)", rate: { per: "year", bp: 1e3 }, rateText: "The legal rate in Code of Civil Procedure § 685.010(a): 10% per year", sources: [CA_CCP] },
    { payment: "local", days: 30, count: "calendar", from: "receipt of an undisputed, properly submitted payment request (local agencies)", rate: { per: "year", bp: 1e3 }, rateText: "The legal rate in Code of Civil Procedure § 685.010(a): 10% per year", sources: [src("Cal. Pub. Contract Code § 20104.50", `${CA}?lawCode=PCC&sectionNum=20104.50`), CA_CCP] },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of each progress payment", rate: PER_MONTH(200), rateText: "A penalty of 2% of the amount due per month for every month payment is not made", caveat: CA_PENALTY, sources: [src("Cal. Pub. Contract Code § 10262.5(a)", `${CA}?lawCode=PCC&sectionNum=10262.5`)] }
  ], "Progress payments on construction contracts. A payment request that is not proper must be returned within 7 days with the reasons; any days beyond that come off the 30 (§§ 10261.5(b), 20104.50(c), (d))."),
  row("CA", "private", "Cal. Civ. Code § 8800", `${CA}?lawCode=CIV&sectionNum=8800`, [
    { payment: "owner", days: 30, count: "calendar", from: "notice demanding payment under the contract (undisputed progress payments, unless agreed otherwise in writing)", rate: PER_MONTH(200), rateText: "A penalty of 2% per month on the amount wrongfully withheld, in place of interest" },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of each progress payment, unless agreed otherwise in writing", rate: PER_MONTH(200), rateText: "A penalty of 2% of the amount due per month for every month payment is not made", caveat: CA_PENALTY, sources: [src("Cal. Bus. & Prof. Code § 7108.5", `${CA}?lawCode=BPC&sectionNum=7108.5`)] }
  ], "Private works of improvement. The owner may withhold up to 150% of an amount in good faith dispute. Business and Professions Code § 7108.5 covers private works and public works not under Public Contract Code § 10262."),
  row20("CO", "public", "C.R.S. § 24-91-103(1), (2)", CO_CRS, [
    { payment: "owner", days: 60, count: "calendar", from: "satisfactory completion and final acceptance of the contract by the public entity (final settlement, made as § 38-26-107 provides)", rate: null, rateText: "No interest rate stated in this section for the public entity's payments", caveat: "Partial payments of at least 95% of the value of completed work are made at the end of each calendar month, or as soon after as practicable, while the contractor is performing satisfactorily; the section sets no day count for them. The 60 days are for final settlement." },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of a payment from the public entity that included the subcontractor's work, while the subcontractor is performing satisfactorily", rate: { per: "year", bp: 1500 }, rateText: "15% per year, or the contract's rate if higher, from the required payment date until payment", caveat: "The contractor is relieved of the 7 days and the interest until the subcontractor submits a list of its suppliers, sub-subcontractors, and laborers with its payment request. A higher rate in the contract replaces the 15%." }
  ], "Contracts over $150,000 for highways, public buildings, public works, and other public improvements, of public entities: the state and its counties, cities, towns, and districts (§ 24-91-102). Before final settlement on such a contract, the public entity publishes notice of it at least twice, and claims filed by unpaid suppliers and workers are withheld from the contractor for up to 90 days (§ 38-26-107). Subcontractors pay their own suppliers, sub-subcontractors, and laborers on the same terms. The article does not apply where federal or other funding carries retention or payment rules that conflict with it (§ 24-91-110).", [src20("C.R.S. § 24-91-102", CO_CRS), src20("C.R.S. § 24-91-110", CO_CRS), src20("C.R.S. § 38-26-107", CO_CRS)]),
  row20("CT", "private", "Conn. Gen. Stat. § 42-158j(a), (c)", CT, [
    { payment: "owner", days: 30, count: "calendar", from: "the written request for payment", rate: PER_MONTH(100), rateText: "1% per month on the amount due, from the day the unpaid party's claim notice is received", caveat: CT_NOTICE },
    { payment: "sub", days: 25, count: "calendar", from: "the contractor's receipt of payment from the owner for the subcontractor's or supplier's work", rate: PER_MONTH(100), rateText: "1% per month on the amount due, from the day the unpaid party's claim notice is received", caveat: CT_NOTICE }
  ], "Construction, renovation, and rehabilitation contracts in Connecticut. Not covered: public works and building contracts with the state, the United States, other states, or municipalities and other political subdivisions; projects funded or insured by the U.S. Department of Housing and Urban Development; owner contracts of $25,000 or less and their subcontracts; and residential buildings of four or fewer units (§ 42-158i). Subcontractors and suppliers pay their own subcontractors within 25 days of being paid. Payment withheld in bad faith after a notice adds 10% damages.", [src20("Conn. Gen. Stat. § 42-158i", CT)]),
  row20("DE", "private", "6 Del. C. § 3506(a), (b), (c)", DE, [
    { payment: "owner", days: 30, count: "calendar", from: "the end of the billing period (the agreed payment cycle, or the calendar month of the work)", rate: null, rateText: DE_RATE, caveat: "Where the contract has no terms for submitting invoices, § 3507(c) makes undisputed amounts due 30 days after the end of the billing period or 30 days after delivery of the invoice, whichever is later." },
    { payment: "sub", days: 30, count: "calendar", from: "payment to the contractor, out of the amounts paid to it (for satisfactory performance under the subcontract)", rate: null, rateText: DE_RATE, caveat: "Where the subcontract sets no payment terms, § 3507(d) makes undisputed amounts due within 15 days after receipt of each payment." }
  ], "Every construction contract an owner awards must carry these payment and interest clauses, and every subcontract the matching ones. An owner or contractor that withholds a percentage gives written reasons within 7 days of the payment date. The payment rules of § 3507 do not apply to public works under chapter 69 of Title 29, to six or fewer residential units under construction at once, to alteration or repair of a single residential unit, or to a person buying materials for work on their own property.", [src20("6 Del. C. § 3507", DE)]),
  row20("DC", "private", "D.C. Code §§ 27A-102, 27A-104", `${DC}27A-102`, [
    { payment: "owner", days: 7, count: "calendar", from: "the payment date or time the contract specifies (undisputed amounts)", rate: PER_MONTH(150, true), rateText: "1.5% per month or any part of a month on the undisputed amount not paid on time", caveat: "With no payment dates in the contract, the section's date is 15 days after the earliest of the occupancy permit being granted, the owner taking possession, or the owner receiving the payment request.", sources: DC_INTEREST },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's or subcontractor's receipt of each payment for the subcontractor's work or materials (undisputed amounts)", rate: PER_MONTH(150, true), rateText: "1.5% per month or any part of a month on the undisputed amount not paid on time", sources: DC_SUB }
  ], "Private construction contracts entered into on or after October 1, 2013 (§ 27A-106). The owner is the property owner or a tenant that contracts with the contractor, never a District agency (§ 27A-101). A contractor may not hold back a subcontractor's payment to offset other contract obligations (§ 27A-104(d)).", [src20("D.C. Code § 27A-101", `${DC}27A-101`), src20("D.C. Code § 27A-106", `${DC}27A-106`)]),
  row("FL", "public", "Fla. Stat. §§ 218.735, 255.073", `${FL}218.735`, [
    { payment: "local", days: 20, count: "business", from: "the day the payment request or invoice is stamped as received (25 business days when an agent must approve it first; local governmental entities)", rate: PER_MONTH(200), rateText: "2% per month, or the contract rate if greater" },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of payment from the public entity", rate: PER_MONTH(200), rateText: "2% per month", sources: [src("Fla. Stat. § 255.073(3), (4)", `${FL}255.073`)] }
  ], "The local figures are from § 218.735; state public entities follow § 215.422 except as §§ 255.072 to 255.078 provide, and § 255.073 gives the 10 days for paying subcontractors on those jobs. Section 218.735(6) sets the same 10 days on local jobs, and 7 days for a subcontractor paying its own subcontractors."),
  row20("GA", "both", "O.C.G.A. §§ 13-11-4, 13-11-7", GA_CODE, [
    { payment: "owner", days: 15, count: "calendar", from: "the owner's or its representative's receipt of a payment request for work completed or services provided, when the contractor has performed as the contract provides", rate: PER_MONTH(100), rateText: GA_RATE, caveat: GA_NOTICE },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of each periodic or final payment (funds actually in its bank account), when the subcontractor has performed and the subcontract's conditions for payment are met", rate: PER_MONTH(100), rateText: GA_RATE, caveat: GA_NOTICE }
  ], "Owners include private persons and entities and state, local, and municipal government bodies, except counties with a population under 10,000 and municipalities under 2,500 (§ 13-11-2). Not covered: residential improvements of 12 or fewer units (§ 13-11-10) and contracts made before January 1, 1995 (§ 13-11-11). Subcontractors pay their own subcontractors within the same 10 days, and a contractor may ask for reasonable assurances, such as a payment and performance bond. Payment may be withheld for the reasons § 13-11-5 lists, including unsatisfactory progress, defective or disputed work, and retainage up to the contract's percentage. Retainage received from the owner is passed through within 10 days (§ 13-11-6). The prevailing party in an action under the chapter recovers reasonable attorney fees (§ 13-11-8).", [src20("O.C.G.A. §§ 13-11-2, 13-11-5, 13-11-6", GA_CODE), src20("O.C.G.A. §§ 13-11-8, 13-11-10, 13-11-11", GA_CODE)]),
  row20("HI", "private", "Haw. Rev. Stat. § 444-25", "https://data.capitol.hawaii.gov/hrscurrent/Vol10_Ch0436-0474/HRS0444/HRS_0444-0025.htm", [
    { payment: "sub", days: 10, count: "calendar", from: "the subcontractor's invoice with the supporting documents the subcontract requires, or the contractor's receipt of payment from the owner for the subcontractor's work, whichever is later", rate: PER_MONTH(150), rateText: "1.5% per month on the unpaid amount, from the date payment is due", caveat: "No interest is owed where a bona fide dispute over the goods or services delays payment. When payment depends on money held in escrow or trust and the contractor's bid solicitation said so, interest starts only after the 10th day following the later of the invoice and the contractor's receipt of that money." }
  ], "Private work: the section does not apply to public contracts under chapter 103 or to any section affecting public contracts. It sets no owner-to-contractor day count."),
  row20("ID", "public", "Idaho Code § 67-2302(2), (6), (7)", "https://legislature.idaho.gov/statutesrules/idstat/Title67/T67CH23/SECT67-2302/", [
    { payment: "owner", days: 60, count: "calendar", from: "receipt of the billing (the invoice or the goods or services, whichever comes later; bills owed by the state and taxing districts)", rate: null, rateText: "The rate in Idaho Code § 63-3045, compounded monthly, once the bill is overdue (set in another section; no interest is computed here)", caveat: "A contract in place when the order was placed may allow a longer period, and a contract that sets out its own payment terms and late-payment penalties applies instead of the section's interest." }
  ], "Purchases, leases, rentals, and contracts for services, construction, repairs, and remodeling by the state and its taxing districts. Interest on amounts retained from construction payments starts 30 calendar days after the contractor completes the work, unless the contract provides otherwise. The section sets no subcontractor day count."),
  row("IL", "public", "50 ILCS 505/3, 505/4, 505/9", `${IL}725&ChapterID=11`, [
    { payment: "local", days: 30, count: "calendar", from: "approval of the bill (approval is due within 30 days after receipt of the bill or of the goods or services, whichever is later; local governments)", rate: PER_MONTH(100, true), rateText: "1% of the approved, unpaid amount for each month or fraction of a month after the 30 days", caveat: "When the bill is not approved or disapproved in time, the late-payment interest runs from 60 days after receipt of the bill or of the goods or services, whichever is later (Sec. 5). Longer periods agreed in the contract replace these (Sec. 6)." },
    { payment: "sub", days: 15, count: "calendar", from: "the contractor's receipt of payment under the public construction contract", rate: PER_MONTH(200), rateText: "2% per month from the end of the 15 days, when payment is withheld without reasonable cause" }
  ], "Counties, townships, municipalities, school districts, and park, fire protection, sanitary, and other local districts and units; the act does not apply to the State or its agencies (Sec. 2)."),
  row("IL", "private", "815 ILCS 603/10, 603/15", `${IL}2941&ChapterID=67`, [
    { payment: "owner", days: 15, count: "calendar", from: "approval of the payment application (it counts as approved 25 days after the owner receives it unless the owner states in writing what is withheld and why)", rate: { per: "year", bp: 1e3 }, rateText: "10% per year" },
    { payment: "sub", days: 15, count: "calendar", from: "the contractor's receipt of each periodic payment, final payment, or retainage from the owner, once the subcontractor's work is accepted", rate: { per: "year", bp: 1e3 }, rateText: "10% per year" }
  ], "Construction contracts for Illinois real property, except contracts that spend public funds and homes with 12 or fewer units in a building. An unpaid party may suspend work after 7 calendar days' written notice."),
  row20("IN", "public", "Ind. Code § 5-17-5-1", "https://iga.in.gov/laws/2026/ic/titles/5#5-17-5", [
    { payment: "owner", days: 35, count: "calendar", from: "receipt of the goods and services or of a properly completed claim, when the contract documents set no payment date (state agencies and political subdivisions)", rate: PER_MONTH(100), rateText: "A late payment penalty of 1% per month on the amount due", caveat: "A political subdivision whose board must approve the claim pays on time within 35 days after the board's first regular meeting held at least 10 days after it receives the claim. A penalty unpaid at the end of each 30 days is added to the principal (§ 5-17-5-3(b)); the calculator does not compound it." }
  ], "Written contracts of state agencies and political subdivisions for public works, personal services, goods and services, equipment, and travel. Not covered: interagency transactions, claims in a good faith dispute noticed before the payment date, small Department of Transportation progress payments, and work paid for only with federal funds (§ 5-17-5-2). A defective claim is raised with the vendor within 10 days. A contractor paid late pays its subcontractors interest of 1% per month on what they are owed once it is paid (§ 5-17-5-4); the chapter sets no subcontractor day count.", [src20("Ind. Code §§ 5-17-5-2 to 5-17-5-4", "https://iga.in.gov/laws/2026/ic/titles/5#5-17-5")]),
  row20("IA", "public", "Iowa Code § 573.12(2)", "https://www.legis.iowa.gov/docs/code/573.12.pdf", [
    { payment: "owner", days: 14, count: "calendar", from: "receipt of the request for a progress payment the project architect or engineer approves as payable (the contract may set a longer period, up to 30 days)", rate: null, rateText: "The rate in effect under § 12C.6 for a deposit of public funds for a comparable period, from the day after the period ends, as § 573.14 sets it (floats)", sources: [src20("Iowa Code § 573.14", "https://www.legis.iowa.gov/docs/code/573.14.pdf")] },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of payment for that subcontractor's work (progress or final payment for satisfactory work)", rate: null, rateText: "No late-payment rate stated for subcontractors; the contractor passes on a share of any interest it receives, in proportion to the subcontractor's work (§ 573.12(3)(a))" }
  ], "Contracts for the construction of public improvements by public corporations. Progress payments are made monthly on the architect's or engineer's estimates, with no more than 3% retained. Where the contractor could have been paid but was not through no fault of the subcontractor, payment is due within a reasonable time."),
  row("KS", "public", "Kan. Stat. Ann. § 16-1903(c), (e), (f), (g)", `${KS}016_019_0003.html`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a timely, properly completed, undisputed request for payment (45 days when extenuating circumstances exist)", rate: { per: "year", bp: 1800 }, rateText: "18% per year on the undisputed amount", caveat: "The section starts this interest on the day after the 7-business-day review period for the architect or engineer in subsection (d), not at the end of the 30 days; the calculator counts it from the end of the 30 days." },
    { payment: "sub", days: 7, count: "business", from: "the contractor's receipt of payment from the owner", rate: { per: "year", bp: 1800 }, rateText: "18% per year on the undisputed amount, from the 8th business day" }
  ], "Contracts for public construction. The architect, engineer, or owner's agent reviews and forwards undisputed requests within 7 business days. Retainage is released within 30 days after substantial completion (§ 16-1904).", [src("Kan. Stat. Ann. § 16-1904", `${KS}016_019_0004.html`)]),
  row("KS", "private", "Kan. Stat. Ann. § 16-1803(d), (e), (f), (g)", `${KS}016_018_0003.html`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a timely, properly completed, undisputed request for payment", rate: { per: "year", bp: 1800 }, rateText: "18% per year on the undisputed amount, from the 31st day" },
    { payment: "sub", days: 7, count: "business", from: "the contractor's receipt of payment from the owner", rate: { per: "year", bp: 1800 }, rateText: "18% per year on the undisputed amount, from the 8th business day" }
  ], "Contracts for private construction. Retainage is released within 30 days after substantial completion (§ 16-1804).", [src("Kan. Stat. Ann. § 16-1804", `${KS}016_018_0004.html`)]),
  row20("KY", "both", "Ky. Rev. Stat. § 371.405(5) to (10)", `${KY}56548`, [
    { payment: "owner", days: 30, count: "business", from: "receipt of a timely, properly completed, undisputed request for payment (45 business days for postsecondary institutions and boards of education; retainage excepted)", rate: { per: "year", bp: 1200 }, rateText: "12% per year on the unpaid amount, from the 31st business day after receipt of the request" },
    { payment: "sub", days: 15, count: "business", from: "the contractor's receipt of payment from the contracting entity, when the subcontractor has made a timely, properly completed, undisputed request", rate: { per: "year", bp: 1200 }, rateText: "12% per year on the unpaid amount, from the 16th business day after the contractor is paid" }
  ], "Public construction and public works, and private construction except residential construction (§ 371.425). Not covered: contracts of borrowers of Rural Utilities Service funds and contracts for utility facilities under KRS Chapter 278. A contractor not paid after 25 business days notifies the contracting entity by certified mail. Subcontractors pay their own subcontractors on the same terms.", [src20("Ky. Rev. Stat. § 371.400", `${KY}35257`), src20("Ky. Rev. Stat. § 371.425", `${KY}56111`)]),
  row20("LA", "private", "La. R.S. 9:2784(A), (B), (D)", "https://legis.la.gov/Legis/Law.aspx?d=107211", [
    { payment: "owner", days: 35, count: "calendar", from: "receipt of the contractor's written payment request (amounts not withheld as the law, the contract, or the section allows)", rate: PER_MONTH(150), rateText: "A penalty of 1.5% of the unpaid amount per month, from the day after the due date", caveat: "When the owner took out a loan before the request and asked for the money in time, the due date is the later of the 35 days and the 5th day after the owner receives the loan proceeds. A written contract for a single-family residence may set payment up to 61 days after the request." },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of payment from the owner", rate: PER_MONTH(150), rateText: "A penalty of 1.5% of the unpaid amount per month, from the day after the due date" }
  ], "As amended by Acts 2026, No. 822. A payer in a good faith dispute still pays the undisputed part on time. Subcontractors pay their own subcontractors within 7 days of being paid. The section does not replace the public contract rules in R.S. 38:2191 and does not cover oil, gas, and mineral agreements, well or mine services, or hydrocarbon pipelines. A waiver of the section is null."),
  row("ME", "both", "10 M.R.S. §§ 1113, 1114", "https://legislature.maine.gov/statutes/10/title10sec1113.html", [
    { payment: "owner", days: 20, count: "calendar", from: "the end of the billing period or delivery of the invoice, whichever is later", rate: null, rateText: "The rate in 14 M.R.S. § 1602-C, from the 21st day (set in another section; no interest is computed here)", caveat: "Except as otherwise agreed in the contract." },
    { payment: "sub", days: 7, count: "calendar", from: "receipt of each progress or final payment, or of the subcontractor's invoice, whichever is later", rate: null, rateText: "The rate in 14 M.R.S. § 1602-C, from the next day (set in another section; no interest is computed here)", sources: [src("10 M.R.S. § 1114", "https://legislature.maine.gov/statutes/10/title10sec1114.html")] }
  ], "Owners include the State, municipalities, and school districts (§ 1111). A court or arbitrator also adds a penalty of 1% per month on sums wrongfully withheld (§ 1118).", [src("10 M.R.S. § 1111", "https://legislature.maine.gov/statutes/10/title10sec1111.html"), src("10 M.R.S. § 1118", "https://legislature.maine.gov/statutes/10/title10sec1118.html")]),
  row("MD", "public", "Md. Code, State Fin. & Proc. §§ 15-103, 15-104", `${MD}gsf&section=15-103&enactments=false`, [
    { payment: "owner", days: 30, count: "calendar", from: "the later of the day payment becomes due and the day the unit receives a proper invoice (15 days on a small business reserve contract)", rate: { per: "year", bp: 900 }, rateText: "9% per year, owed on amounts unpaid more than 37 days after the invoice; it runs from the 31st day", graceDays: 7, caveat: "Section 15-105 lists cases with no interest, including when the contractor does not invoice for the interest within 30 days after the date on the State's check.", sources: [src("Md. Code, State Fin. & Proc. § 15-104", `${MD}gsf&section=15-104&enactments=false`), src("Md. Code, State Fin. & Proc. § 15-105", `${MD}gsf&section=15-105&enactments=false`)] },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of a progress or final payment from the State", rate: null, rateText: "No interest rate in this section; the unit may require a penalty of up to $100 a day after its review", sources: [src("Md. Code, State Fin. & Proc. § 15-226(c)", `${MD}gsf&section=15-226&enactments=false`)] }
  ], "State procurement contracts. Section 15-103 states the 30 days as the State's payment policy; § 15-104 sets the interest."),
  row("MD", "private", "Md. Code, Real Prop. § 9-302", `${MD}grp&section=9-302&enactments=false`, [
    { payment: "owner", days: 7, count: "calendar", from: "the payment date or time the contract specifies (undisputed amounts)", rate: null, rateText: "No interest rate stated in this section", caveat: "With no payment dates in the contract, the section's date is the earlier of 30 days after the occupancy permit is granted or 30 days after the owner takes possession." },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's or subcontractor's receipt of each payment for the subcontractor's work", rate: null, rateText: "No interest rate stated in this section" }
  ], "Does not apply to contracts with the State, counties, municipal corporations, boards of education, or public authorities, or to the contracts listed in § 9-305.", [src("Md. Code, Real Prop. § 9-305", `${MD}grp&section=9-305&enactments=false`)]),
  row("MA", "public", "Mass. Gen. Laws ch. 30, § 39K", `${MA}/PartI/TitleIII/Chapter30/Section39K`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a periodic estimate requesting payment (the commonwealth, including local housing authorities)", rate: null, rateText: "Daily interest at 3 percentage points above the Federal Reserve Bank of Boston rediscount rate (floats)" },
    { payment: "local", days: 15, count: "calendar", from: "receipt of a periodic estimate requesting payment (counties, cities, towns, districts, and other public bodies)", rate: null, rateText: "Daily interest at 3 percentage points above the Federal Reserve Bank of Boston rediscount rate (floats)" }
  ], "Public building contracts over $5,000 for the commonwealth and over $2,000 for other public bodies. An estimate received on a Saturday counts as received the next working day. Section 39G of the same chapter sets the same 15 and 30 days for other public works such as roads, bridges, sewers, and water mains.", [src("Mass. Gen. Laws ch. 30, § 39G", `${MA}/PartI/TitleIII/Chapter30/Section39G`)]),
  row("MA", "private", "Mass. Gen. Laws ch. 149, § 29E(c)", `${MA}/PartI/TitleXXI/Chapter149/Section29E`, [
    { payment: "owner", days: 45, count: "calendar", from: "approval of the application for a progress payment (approval is due within 15 days of submission, or the application counts as approved)", rate: null, rateText: "No rate stated in this section" }
  ], "The longest periods a contract may set, at every tier: 30 days to submit, 15 to approve or reject, 45 to pay after approval (a lower tier may take 7 more days to approve). Covers projects where the prime contract with the owner is $3,000,000 or more; projects of 1 to 4 dwelling units are not covered."),
  row("MI", "public", "Mich. Comp. Laws § 125.1562(3), (4)", `${MCL}125-1562`, [
    { payment: "owner", days: 30, count: "calendar", from: "the architect or engineer certifying to the agency that the work in the request is in place", rate: null, rateText: "Reasonable interest, added to the next request; no rate stated", caveat: "When federal or state money pays for it, the section's date is 15 days after the agency receives that money if that is later. The calculator counts only from the certification." }
  ], "Contracts of $30,000 or more with more than 3 payments, with the state and local public agencies. The state transportation department, school districts, community colleges, the state housing development authority, and municipal electric utilities are left out (§ 125.1561).", [src("Mich. Comp. Laws § 125.1561", `${MCL}125-1561`)]),
  row("MN", "public", "Minn. Stat. § 16A.124, subds. 3 and 5", `${MN}16A.124`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of the invoice (state agencies)", rate: PER_MONTH(150, true), rateText: "1.5% per month or any part of a month", caveat: MN_MINIMUM },
    { payment: "local", days: 35, count: "calendar", from: "receipt of the invoice, when no contract terms apply (municipalities whose boards meet at least monthly; 45 days for the others)", rate: PER_MONTH(150, true), rateText: "1.5% per month or part of a month", caveat: MN_MINIMUM, sources: [src("Minn. Stat. § 471.425, subds. 2 and 4", `${MN}471.425`)] },
    { payment: "sub", days: 10, count: "calendar", from: "the prime contractor's receipt of payment from the state for undisputed work", rate: PER_MONTH(150, true), rateText: "1.5% per month or any part of a month", caveat: MN_MINIMUM, sources: [src("Minn. Stat. § 16A.1245", `${MN}16A.1245`)] }
  ], "Municipal contracts carry the same 10-day subcontractor rule and rate (§ 471.425, subd. 4a). Section 16A.124, subd. 5(e) says no interest accrues under that section for claims a contractor makes under a construction contract."),
  row("MN", "private", "Minn. Stat. § 337.10, subd. 3", `${MN}337.10`, [
    { payment: "sub", days: 10, count: "calendar", from: "receipt of payment for the subcontractor's undisputed work", rate: PER_MONTH(150), rateText: "1.5% per month", caveat: MN_MINIMUM }
  ], "Building and construction contracts. A party not paid within the ten days may suspend work until the undisputed payment arrives. The subdivision sets no owner-to-contractor day count."),
  row20("MS", "public", "Miss. Code Ann. §§ 31-5-25(1), 31-5-27", MS_CODE, [
    { payment: "owner", days: 45, count: "calendar", from: "the first of: completion or substantial completion of the project, the owner's beneficial use or occupancy (except during a renovation the owner keeps using), or certification of completion by the architect or engineer or by the contracting authority (final payment)", rate: PER_MONTH(100), rateText: "1% per month from the date of that event, when payment in full is not made within the 45 calendar days", caveat: msFinal(45) },
    { payment: "sub", days: 15, count: "calendar", from: "the contractor's receipt of payment under the public construction contract (each subcontractor and supplier is paid in proportion to its completed work)", rate: null, rateText: MS_SUB_RATE, caveat: MS_SUB_CAVEAT }
  ], "Public construction contracts of state agencies, commissions, boards, and districts and of municipalities, counties, and other political subdivisions (§ 31-5-29). Contractors certify to the project engineer or architect each month what they paid subcontractors on the prior payment request.", [src20("Miss. Code Ann. § 31-5-29", MS_CODE)]),
  row20("MS", "private", "Miss. Code Ann. §§ 87-7-3, 87-7-5", MS_CODE, [
    { payment: "owner", days: 30, count: "calendar", from: "the first of: completion or substantial completion of the project, the owner's beneficial use or occupancy (except during a renovation the owner keeps using), or certification of completion by the architect or engineer (final payment)", rate: PER_MONTH(100), rateText: "1% per month from the date of that event, when payment in full is not made within the 30 calendar days", caveat: msFinal(30) },
    { payment: "sub", days: 15, count: "calendar", from: "the contractor's receipt of payment from the owner (each subcontractor and supplier is paid in proportion to its completed work)", rate: null, rateText: MS_SUB_RATE, caveat: MS_SUB_CAVEAT }
  ], "Construction contracts other than public construction contracts. The subcontractor rule in § 87-7-5 does not apply to contracts for building single-family dwellings."),
  row("MO", "public", "Mo. Rev. Stat. § 8.960.1(1), (5), (7)", "https://revisor.mo.gov/main/OneSection.aspx?section=8.960", [
    { payment: "owner", days: 30, count: "calendar", from: "the latest of delivery of the work or materials, delivery of the invoice where the owner designates, or delivery of the contractor's approval of the owner's estimate", rate: PER_MONTH(150), rateText: "1.5% per month from the end of the 30 days" },
    { payment: "sub", days: 15, count: "calendar", from: "the contractor's receipt of payment", rate: PER_MONTH(150), rateText: "1.5% per month from the end of the 15 days" }
  ], "Public works contracts of the state and its political subdivisions (this was § 34.057 before 2022). No late-payment interest is due on amounts withheld in good faith for reasonable cause."),
  row("MT", "public", "Mont. Code Ann. § 17-8-242(1), (2)", "https://mca.legmt.gov/bills/mca/title_0170/chapter_0080/part_0020/section_0420/0170-0080-0020-0420.html", [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a properly completed invoice or of the supplies or services, whichever is later (state agencies, when the contract sets no date)", rate: { per: "day", bp: 5 }, rateText: "0.05% simple interest each day" },
    { payment: "local", days: 7, count: "calendar", from: "approval of the payment request (a request counts as approved 21 days after receipt unless the owner disapproves items in writing)", rate: PER_MONTH(150), rateText: "1.5% per month or a pro rata fraction, from the day after the due date", graceDays: 30, sources: MT_PART21 },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of a periodic or final payment from the owner or a state agency", rate: PER_MONTH(150), rateText: "1.5% per month or a pro rata fraction, from the day after the due date", graceDays: 30, sources: MT_PART21 }
  ], "The local figures are from Part 21 of Title 28, chapter 2, which covers cities, towns, counties, school districts, and special districts as owners; its interest is owed only when a payment is more than 30 days late. A contract may set another billing cycle or a later approval or payment date with the notice described in § 28-2-2115.", MT_SCOPE),
  row("MT", "private", "Mont. Code Ann. §§ 28-2-2103, 28-2-2104", `${MCA}0030/0280-0020-0210-0030.html`, [
    { payment: "owner", days: 7, count: "calendar", from: "approval of the payment request (a request counts as approved 21 days after receipt unless the owner disapproves items in writing)", rate: PER_MONTH(150), rateText: "1.5% per month or a pro rata fraction, from the day after the due date", graceDays: 30 },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of a periodic or final payment", rate: PER_MONTH(150), rateText: "1.5% per month or a pro rata fraction, from the day after the due date", graceDays: 30 }
  ], "Interest is owed only when a payment is more than 30 days late; it then runs from the day after the due date. Accepting the final payment releases claims for interest on it. A contract may set another billing cycle or a later approval or payment date with the notice described in § 28-2-2115.", [MT_PART21[1], ...MT_SCOPE]),
  row("NE", "public", "Neb. Rev. Stat. §§ 45-1203, 45-1205", `${NE}45-1203`, [
    { payment: "owner", days: 45, count: "calendar", from: "receipt of the services or of the bill, whichever is later (state agencies, unless agreed otherwise in writing)", rate: null, rateText: "The rate in § 45-104.02, as adjusted from time to time (floats)", sources: [src("Neb. Rev. Stat. § 81-2403", `${NE}81-2403`), src("Neb. Rev. Stat. § 81-2404", `${NE}81-2404`), src("Neb. Rev. Stat. § 81-2402", `${NE}81-2402`)] },
    { payment: "local", days: 30, count: "calendar", from: "receipt of a payment request (political subdivisions)", rate: PER_MONTH(100), rateText: "1% per month or a pro rata fraction, from the day after the due date", caveat: NE_NOTICE },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of a periodic or final payment", rate: PER_MONTH(100), rateText: "1% per month or a pro rata fraction, from the day after the due date", caveat: NE_NOTICE }
  ], "The state figure is from the Prompt Payment Act, whose services include construction services (§ 81-2402); its interest starts on the 31st day. The local and subcontractor figures are from the Construction Prompt Pay Act, which covers political subdivisions and private owners but not the State, and does not cover work on contracts for the State (§ 45-1202).", [src("Neb. Rev. Stat. § 45-1202", `${NE}45-1202`), NE_ACT[1]]),
  row("NE", "private", "Neb. Rev. Stat. §§ 45-1203, 45-1205", `${NE}45-1203`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a payment request made under the contract", rate: PER_MONTH(100), rateText: "1% per month or a pro rata fraction, from the day after the due date", caveat: NE_NOTICE },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of a periodic or final payment", rate: PER_MONTH(100), rateText: "1% per month or a pro rata fraction, from the day after the due date", caveat: NE_NOTICE }
  ], "Construction Prompt Pay Act. Retainage is released within 45 days after substantial completion and passed to subcontractors within 10 days of receipt.", [NE_ACT[1]]),
  row("NV", "public", "NRS 338.515(1), 338.530, 338.550(1), 338.565", "https://www.leg.state.nv.us/NRS/NRS-338.html", [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of the progress bill (or a shorter period the contract sets)", rate: null, rateText: "From the 30th day, the 90-day certificate of deposit rate described in NRS 338.515(6) (floats)" },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of the money", rate: null, rateText: "The lowest daily prime rate at the three largest U.S. banks on the contract date, plus 2% (NRS 338.565)" }
  ], "Public works contracts. A public body that withholds part of a payment gives written notice within 20 days of the bill (NRS 338.525).", [src("NRS 338.525", "https://www.leg.state.nv.us/NRS/NRS-338.html")]),
  row("NV", "private", "NRS 624.609(1), 624.624(1), 624.630", "https://www.leg.state.nv.us/NRS/NRS-624.html", [
    { payment: "owner", days: 21, count: "calendar", from: "the prime contractor's request for payment, when there is no written payment schedule", rate: null, rateText: "The agreed rate or the prime rate at Nevada's largest bank plus 4%, whichever is higher (floats)" },
    { payment: "sub", days: 10, count: "calendar", from: "the higher-tiered contractor's receipt of payment for the work", rate: null, rateText: "The agreed rate or the prime rate at Nevada's largest bank plus 4%, whichever is higher (floats)", caveat: "The section's date is earlier when the subcontract's payment schedule falls earlier, or, with no schedule, when 30 days after the subcontractor's request falls earlier." }
  ], "With a written payment schedule, the owner pays on the scheduled date instead of within the 21 days."),
  row20("NJ", "both", "N.J.S.A. 2A:30A-2(a), (b), (c)", `${NJ}998${NJ_DOC}`, [
    { payment: "owner", days: 30, count: "calendar", from: "the billing date (for a periodic billing, the date the contract specifies) of an approved and certified billing; a billing counts as approved 20 days after the owner receives it unless the owner states in writing what is withheld and why", rate: null, rateText: NJ_RATE, caveat: "A public entity whose governing body votes on each payment may approve it at its next scheduled public meeting and pay in its next payment cycle, when the bid specifications and contract documents say so." },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of each periodic payment, final payment, or retainage, for work that has been accepted, unless agreed otherwise in writing", rate: null, rateText: NJ_RATE }
  ], "Contracts to improve real property in New Jersey; owners include public and governmental entities (§ 2A:30A-1). Billings cover periodic and final payments, approved change orders, and retainage. Subcontractors pay sub-subcontractors within the same 10 days. A party not paid may suspend work after 7 calendar days' written notice. The interest and suspension rules do not apply to some federally funded transportation projects. The prevailing party in a collection suit is awarded reasonable costs and attorney fees.", [src20("N.J.S.A. 2A:30A-1", `${NJ}997${NJ_DOC}`)]),
  row20("NM", "both", "NMSA 1978, § 57-28-5(A), (C)", NM, [
    { payment: "owner", days: 21, count: "calendar", from: "the owner's receipt of an undisputed request for payment", rate: null, rateText: `${NM_RATE}, beginning on the 22nd day after payment was due; no interest is computed here, since it starts 21 days after the due date`, caveat: "A local public body paying with grant money may take up to 45 days when the contract and every page of the plans carry the extended-payment notice the section describes." },
    { payment: "sub", days: 7, count: "calendar", from: "receipt of payment from the owner, contractor, or subcontractor", rate: PER_MONTH(150, true), rateText: `${NM_RATE}, owed when payment is more than 7 days past the due date, beginning on the eighth day`, graceDays: 7, interestFromGrace: true }
  ], "The Prompt Payment Act covers construction contracts of private owners, local public bodies, and state agencies other than the Department of Transportation (§ 57-28-2). Not covered: residential property of four or fewer dwelling units (§ 57-28-3). An owner that receives an improperly completed invoice says what is wrong within 7 days. The payment terms apply at every tier, and amounts owed for work performed may not be held back.", [src20("NMSA 1978, §§ 57-28-2, 57-28-3", NM)]),
  row20("NY", "private", "N.Y. Gen. Bus. Law § 756-a(2), (3)", `${NY}756-A`, [
    { payment: "owner", days: 30, count: "calendar", from: "approval of the interim or final invoice (the owner approves or disapproves within 12 business days after the invoice and the required documents are delivered)", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month on the unpaid balance, from the next day, or a higher rate consistent with the contract", caveat: "When payment depends on lender approval, it is due 7 days after the owner receives good funds.", sources: NY_INTEREST },
    { payment: "sub", days: 7, count: "calendar", from: "receipt of good funds for each interim or final payment, once the documents and waivers the contract requires are received", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month on the unpaid balance, from the next day, notwithstanding any contrary agreement, or a higher rate consistent with the contract", sources: NY_INTEREST }
  ], "Private construction projects whose total cost is $150,000 or more. Not covered: contracts awarded by the state or other public bodies, public works, one-, two-, and three-family homes, residential tract developments of 100 or fewer one- or two-family homes, residential projects of 4,500 square feet or less, and government-assisted residential projects of fewer than 75 units (§ 756). Except as the article provides, the contract's own terms govern. A contractor may suspend work after 10 calendar days' written notice (§ 756-b(2)).", [src20("N.Y. Gen. Bus. Law § 756", `${NY}756`)]),
  row("NC", "public", "N.C. Gen. Stat. § 143-134.1(a), (b)", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_143/GS_143-134.1.html", [
    { payment: "owner", days: 45, count: "calendar", from: "acceptance, certification of completion, or occupancy and use of the project, whichever comes first (final payment)", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month from the 46th day, unless a lower rate is agreed", caveat: "Periodic payments during construction are due when the contract says, with the same interest; the 45 days are for final payment." },
    { payment: "sub", days: 7, count: "calendar", from: "the prime contractor's receipt of each periodic or final payment", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month, from the 8th day" }
  ], "Public construction contracts of the State and its political subdivisions, except Department of Transportation contracts under § 136-28.1."),
  row("NC", "private", "N.C. Gen. Stat. §§ 22C-3, 22C-5", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_22C.html", [
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of each periodic or final payment", rate: PER_MONTH(100, true), rateText: "1% per month or a fraction of a month, from the 8th day" }
  ], "Does not cover residential contractors or residential projects of 12 or fewer units (§ 22C-6). The chapter sets no owner-to-contractor day count."),
  row20("ND", "public", "N.D. Cent. Code §§ 13-01.1-01, 13-01.1-02, 13-01.1-06", "https://www.ndlegis.gov/cencode/t13c01-1.pdf", [
    { payment: "owner", days: 45, count: "calendar", from: "receipt of the invoice, when the contract sets no payment date (state agencies, political subdivisions, and school districts)", rate: PER_MONTH(175), rateText: "1.75% per month, unless the contract sets a different rate", caveat: `When the contract sets no date and payment comes after the 45 days, the section runs interest from the day the invoice was received, not from the due date; the calculator counts it from the due date. ${ND_COMPOUND}` },
    { payment: "sub", days: 45, count: "calendar", from: "the business's receipt of payment from the agency, political subdivision, or school district", rate: PER_MONTH(175), rateText: "1.75% per month (the rate in § 13-01.1-02), unless the subcontract provides otherwise", caveat: ND_COMPOUND }
  ], "Property and services that state agencies, political subdivisions, and school districts buy under contract; the chapter covers all such purchases, not only construction. With a payment date in the contract, that date governs and interest starts the day after it. The chapter does not apply while a dispute over the amount due or over compliance with the contract is unsettled (§ 13-01.1-05)."),
  row("OH", "public", "Ohio Rev. Code § 153.14", "https://codes.ohio.gov/ohio-revised-code/section-153.14", [
    { payment: "owner", days: 30, count: "calendar", from: "filing of the approved estimate with the owner", rate: null, rateText: "The average prime rate at commercial banks in the nearest city of over 100,000 people (floats)" },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of payment from the owner", rate: { per: "year", bp: 1800 }, rateText: "18% per year, from the 11th day after the contractor is paid", sources: [src("Ohio Rev. Code § 4113.61(A)(1)", "https://codes.ohio.gov/ohio-revised-code/section-4113.61")] }
  ], "Section 153.14 covers state public improvements under chapter 153. Section 4113.61 covers construction generally, public and private, except one-, two-, and three-family homes, and its interest cannot be waived."),
  row("OH", "private", "Ohio Rev. Code § 4113.61(A)(1)", "https://codes.ohio.gov/ohio-revised-code/section-4113.61", [
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of payment from the owner", rate: { per: "year", bp: 1800 }, rateText: "18% per year, from the 11th day after the contractor is paid" }
  ], "Covers construction generally except one-, two-, and three-family homes. A subcontract with a longer period or a lower rate gives way to the section. The section sets no owner-to-contractor day count."),
  row20("OK", "private", "Okla. Stat. tit. 15, § 820(A)", OK15, [
    { payment: "owner", days: 28, count: "calendar", from: "receipt of the billing, when the bid plans and specifications do not state the owner's payment terms (monthly progress payments)", rate: null, rateText: "No interest rate stated in this section", caveat: "The 28 days apply only when the owner did not state the payment frequency and time in the bid plans and specifications; otherwise the stated time governs." },
    { payment: "sub", days: 10, count: "calendar", from: "the prime contractor's receipt of payment from the owner, unless the parties agree otherwise", rate: null, rateText: "No interest rate stated in this section" }
  ], "Private construction projects whose plans or specifications are issued for bid. Privately negotiated projects follow their own terms, and a contractor inviting subcontract bids on one states its payment terms. Not covered: contracts for one- to four-family dwellings (§ 821). A contractor or subcontractor not paid within 10 calendar days of the date payment was due may suspend work after 10 calendar days' written notice.", [src20("Okla. Stat. tit. 15, § 821", OK15)]),
  row("OR", "public", "ORS 279C.570(2), 279C.580(3), 279C.515(2)", "https://www.oregonlegislature.gov/bills_laws/ors/ors279C.html", [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of the contractor's invoice", rate: null, rateText: "Three times the Federal Reserve discount rate on 90-day commercial paper, never more than 30% (floats)", caveat: "Interest starts 15 days after the agency approves the payment when that comes before 30 days after the invoice; the calculator counts only from the invoice." },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of payment from the contracting agency (first-tier subcontractors)", rate: { per: "year", bp: 900 }, rateText: "9% per year, owed when payment comes more than 30 days after the contractor was paid; it then runs from the end of the 10 days", graceDays: 20 }
  ], "Public improvement contracts; no contracting agency is exempt. Interest is paid with the principal without the contractor having to ask for it."),
  row("OR", "private", "ORS 701.625(3), (11); 701.630(2), (6)", "https://www.oregonlegislature.gov/bills_laws/ors/ors701.html", [
    { payment: "owner", days: 14, count: "calendar", from: "receipt of the billing (progress payments)", rate: PER_MONTH(150, true), rateText: "1.5% per month or fraction of a month, or a higher agreed rate", caveat: "A contract may allow a longer period when its drawings and specifications carry the notice the section describes." },
    { payment: "sub", days: 7, count: "calendar", from: "the original contractor's receipt of payment for the work", rate: PER_MONTH(150, true), rateText: "1.5% per month or fraction of a month from the 8th day, or a higher agreed rate" }
  ], "Days are calendar days (ORS 701.620). Final payment is due 7 days after the owner approves the work. Not covered: buildings under the Low-Rise Residential Dwelling Code, public contracts, and certain income-restricted housing (ORS 701.645)."),
  row20("PA", "private", "Pa. Contractor and Subcontractor Payment Act, §§ 5(c), (d), 7(c), (d) (Act of Feb. 17, 1994, P.L. 73, No. 7)", PA, [
    { payment: "owner", days: 20, count: "calendar", from: "the end of the billing period or delivery of the invoice, whichever is later (interim and final invoices)", rate: PER_MONTH(100, true), rateText: "1% per month or fraction of a month on the balance due, owed when payment is more than 7 days past the due date, beginning on the eighth day", graceDays: 7, interestFromGrace: true, caveat: "Except as the parties agree otherwise." },
    { payment: "sub", days: 14, count: "calendar", from: "receipt of each progress or final payment, or of the subcontractor's invoice, whichever is later", rate: PER_MONTH(100, true), rateText: "The rate in section 5(d), 1% per month or fraction of a month on the balance due, from the next day" }
  ], "Construction contracts for Pennsylvania real property, except improvements of six or fewer residential units under construction at the same time and a person buying materials for work on their own property; most of the act cannot be waived by contract. Withholding for a deficiency item needs a written good faith reason within 14 calendar days. Retainage is due within 30 days after final acceptance. A court or arbitrator also adds a penalty of 1% per month on amounts wrongfully withheld (section 12). A contractor that does not disclose the owner's due date to a subcontractor pays as if the owner had paid on time."),
  row20("RI", "public", "R.I. Gen. Laws § 42-11.1-3", `${RI}42-11.1-3.htm`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a proper invoice, or the other dates the contract sets for periodic payments (state agencies)", rate: null, rateText: "The prime rate in The Wall Street Journal, from the day after the required payment date (floats)", caveat: "For interest, the required payment date is 30 working days after the agency receives the invoice (§ 42-11.1-5(b)), later than the 30 calendar days.", sources: RI_RATE },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of payment by the state", rate: null, rateText: "No interest rate stated in this section", caveat: "The contractor may set off a debt the subcontractor owes it or an amount the subcontract lets it withhold." }
  ], "State agencies in all three branches, the University of Rhode Island, some quasi-public bodies, and the lottery; contractors include those building or repairing buildings or highways for them. The 7-day subcontractor rule does not apply to Department of Transportation contracts unless the subcontractor gives a payment and performance bond for the subcontract amount.", [src20("R.I. Gen. Laws § 42-11.1-2", `${RI}42-11.1-2.htm`)]),
  row("SC", "both", "S.C. Code §§ 29-6-30, 29-6-50", "https://www.scstatehouse.gov/code/t29c006.php", [
    { payment: "owner", days: 21, count: "calendar", from: "receipt of the pay request (the undisputed amount)", rate: PER_MONTH(100), rateText: "1% a month or a pro rata fraction, from the due date", caveat: SC_NOTICE },
    { payment: "sub", days: 7, count: "calendar", from: "receipt of each periodic or final payment", rate: PER_MONTH(100), rateText: "1% a month or a pro rata fraction, from the due date", caveat: SC_NOTICE }
  ], "Owners include state and local government. On private projects only, the parties may agree to other periods and rates if the contract waives these sections by number in bold or underlined type. Not covered: residential homebuilders, residential projects of 16 or fewer units, and private owners whose improvements are not financed by someone else (§ 29-6-60)."),
  row20("SD", "public", "S.D. Codified Laws §§ 5-26-2, 5-26-3, 5-26-6", `${SD}5-26`, [
    { payment: "owner", days: 45, count: "calendar", from: "receipt and written acceptance of the property or services and receipt of the invoice, when the contract sets no payment date (state agencies, counties, municipalities, and school districts)", rate: { per: "year", bp: 1e3 }, rateText: "The Category B rate in § 54-3-16, 10% per year, or the rate the contract specifies", caveat: "A proper invoice not paid within the 45 days accrues interest from the 30th day after receipt of the property or service and of the invoice, not from the due date; the calculator counts it from the due date. An agency need not pay interest of less than $5 (§ 5-26-3.1).", sources: SD_RATE },
    { payment: "sub", days: 30, count: "calendar", from: "the business's receipt of payment from the agency, once the subcontractor or supplier has met the terms of its contract", rate: { per: "year", bp: 1e3 }, rateText: "The Category B rate in § 54-3-16, 10% per year, from the 31st day, unless the subcontract provides otherwise", sources: SD_RATE }
  ], "The South Dakota Prompt Payment Act covers property and services that state agencies, counties, municipalities, public school districts, and other bodies that contract for public improvements buy under contract, not only construction (§ 5-26-1). No interest accrues while a dispute over the amount due or over compliance delays payment; the agency gives written notice of the dispute within 30 days (§ 5-26-5). Not covered: transactions between government agencies (§ 5-26-8).", [src20("S.D. Codified Laws §§ 5-26-1, 5-26-5, 5-26-8", `${SD}5-26`)]),
  row20("TN", "public", "Tenn. Code Ann. §§ 12-4-703, 12-4-704, 12-4-707", TN_CODE, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of the invoice for the delivered property or services, when the contract sets no date or other provision for payment (state agencies)", rate: PER_MONTH(150), rateText: "1.5% per month, beginning the day after payment is due", caveat: "Interest unpaid at the end of each 60 days, or of a period the contract sets, is added to the principal (§ 12-4-704(b)); the calculator does not compound it." },
    { payment: "sub", days: 30, count: "calendar", from: "the business's receipt of payment from the agency, for property or services a subcontractor or supplier provided under its contract", rate: PER_MONTH(150), rateText: "1.5% per month from the 31st day, unless the agency's contract or the subcontract provides otherwise" }
  ], "The Prompt Pay Act of 1985 covers property and services that state agencies (entities of state government, § 12-4-702) buy under contract, not only construction; it does not name local governments. The part does not apply where a dispute over the amount due or over compliance with the contract is why interest was not paid on time (§ 12-4-706). An agency may not seek more appropriations to pay this interest (§ 12-4-705).", [src20("Tenn. Code Ann. §§ 12-4-702, 12-4-705, 12-4-706", TN_CODE)]),
  row20("TN", "private", "Tenn. Code Ann. §§ 66-34-202(a), 66-34-302(a), 66-34-601", TN_CODE, [
    { payment: "owner", days: 30, count: "calendar", from: "timely submission of the prime contractor's application for payment under the contract's schedule for payments (the full amount earned, less amounts withheld as § 66-34-203 allows), when the prime contractor has performed under its written contract", rate: PER_MONTH(150), rateText: TN_PRIVATE_RATE, caveat: "A rate for delinquent payments in the written contract replaces the 1.5%. Payment also follows the contract's schedule for payments." },
    { payment: "sub", days: 30, count: "calendar", from: "timely submission of the remote contractor's application for payment under the subcontract's schedule for payments, subject to any condition precedent for payment in the subcontract", rate: PER_MONTH(150), rateText: TN_PRIVATE_RATE, caveat: "A rate for delinquent payments in the written contract replaces the 1.5%. The count runs from the subcontractor's application, not from the prime contractor's receipt of payment." }
  ], "The Prompt Pay Act of 1991 (§ 66-34-101); its terms take their meanings from the mechanics' lien chapter (§ 66-34-102). Not covered: construction of or home improvement to residences of one to four single-family units (§ 66-34-702), and banks, other regulated financial institutions, and insurance companies unless they build their own structure or take over a defaulted project (§ 66-34-703). The prime contractor passes on to remote contractors their pro rata share of any interest it receives (§ 66-34-302(b)). Sections 66-11-104, 66-34-205, 66-34-304, 66-34-602, and 66-34-603 cannot be waived by contract and also apply to construction contracts with the state, counties, municipalities, and other subdivisions (§ 66-34-701).", [src20("Tenn. Code Ann. §§ 66-34-101, 66-34-102", TN_CODE), src20("Tenn. Code Ann. §§ 66-34-701 to 66-34-703", TN_CODE)]),
  row20("TX", "public", "Tex. Gov't Code §§ 2251.021, 2251.022, 2251.025", TX_GV, [
    { payment: "owner", days: 30, count: "calendar", from: "the latest of receipt of the goods, completion of the service, and receipt of the invoice (state agencies and political subdivisions); the payment is overdue on the 31st day", rate: null, rateText: "From the day the payment is overdue, 1% plus the prime rate published in The Wall Street Journal on the first weekday of July before the fiscal year, as set each September 1 (floats)", caveat: "A political subdivision whose governing body meets only once a month or less has 45 days (the payment is overdue on the 46th day)." },
    { payment: "sub", days: 10, count: "calendar", from: "the vendor's receipt of payment from the governmental entity", rate: null, rateText: "The rate in § 2251.025 (1% plus the prime rate), from the 11th day (floats)" }
  ], "Payments by state agencies and by counties, municipalities, school districts, and special-purpose districts for goods and services, which include public work contracts. The payment rules do not apply to a payment made late by a bona fide dispute, by federal terms that prevent timely payment, or by an invoice not mailed as the purchase order instructs (§ 2251.002); an entity notifies a vendor of a disputed amount within 21 days of the invoice (§ 2251.042). Subcontractors pay their own suppliers within 10 days (§ 2251.023). The chapter's rights cannot be waived (§ 2251.004).", [src20("Tex. Gov't Code §§ 2251.001, 2251.002, 2251.004, 2251.023, 2251.042", TX_GV)]),
  row20("TX", "private", "Tex. Prop. Code §§ 28.002, 28.004", TX_PR, [
    { payment: "owner", days: 35, count: "calendar", from: "the owner's receipt of the contractor's written payment request (amounts allowed under the contract for properly performed work or suitably stored or specially fabricated materials)", rate: PER_MONTH(150), rateText: "1.5% per month on the unpaid amount, from the day after the due date", caveat: "When the owner took out a loan, asked for the money in time, and the lender has not paid within the 35 days, the due date is the 5th day after the owner receives the loan proceeds (§ 28.008). A written contract for a single-family residence may set payment up to 60 days after the request (§ 28.006(b))." },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of the owner's payment", rate: PER_MONTH(150), rateText: "1.5% per month on the unpaid amount, from the day after the due date" }
  ], "Owners other than governmental entities (§ 28.001). Subcontractors pay their own subcontractors within 7 days of being paid. In a good faith dispute the payer may withhold up to 110% of the amount in dispute on a one- to four-family residence and up to 100% on other work (§ 28.003). Interest stops on delivery of the payment, or on mailing when delivery follows within three days. A waiver is void except the single-family residence term (§ 28.006). Not covered: oil, gas, and mineral agreements, well or mine services, and hydrocarbon pipelines (§ 28.010).", [src20("Tex. Prop. Code §§ 28.001, 28.003, 28.006, 28.008, 28.010", TX_PR)]),
  row20("UT", "public", "Utah Code §§ 15-6-2, 15-6-5", `${UT}2.html`, [
    { payment: "owner", days: 60, count: "calendar", from: "receipt of the invoice for the delivered property or services, when the contract sets no payment date (state agencies)", rate: null, rateText: "2% above the rate the Internal Revenue Service pays on refund claims, set quarterly, from the 61st day after the invoice; interest unpaid at the end of each 60 days is added to the principal (floats)", sources: [src20("Utah Code § 15-6-3", `${UT}3.html`)] },
    { payment: "sub", days: 30, count: "calendar", from: "the business's receipt of payment from the state agency (or a federal agency) for the subcontractor's or supplier's property or services", rate: { per: "year", bp: 1550 }, rateText: "15.5% per year, owed when payment comes more than 45 days after the business is paid; it then runs from the 31st day", graceDays: 15, caveat: "Unless the subcontract provides otherwise.", sources: [src20("Utah Code § 15-6-5", `${UT}5.html`)] }
  ], "The Prompt Payment Act covers property and services that state agencies buy under contract, not only construction, and not local governments. It does not apply while a dispute over the amount due or over compliance delays payment (§ 15-6-4), or to contracts that disburse federal funds, or state and federal funds together (§ 15-6-6).", [src20("Utah Code § 15-6-4", `${UT}4.html`), src20("Utah Code § 15-6-6", `${UT}6.html`)]),
  row("VT", "both", "9 V.S.A. §§ 4002, 4003", "https://legislature.vermont.gov/statutes/fullchapter/09/102", [
    { payment: "owner", days: 20, count: "calendar", from: "the end of the billing period or delivery of the invoice, whichever is later", rate: null, rateText: "The rate in 12 V.S.A. § 2903(b), from the 21st day (set in another section; no interest is computed here)", caveat: "Except as otherwise agreed in the contract." },
    { payment: "sub", days: 7, count: "calendar", from: "receipt of each progress or final payment, or of the subcontractor's invoice, whichever is later", rate: null, rateText: "The rate in 12 V.S.A. § 2903(b), from the day after the due date (set in another section; no interest is computed here)" }
  ], "Owners include the State, municipalities, and school districts. A court or arbitrator also adds a penalty of 1% per month on sums wrongfully withheld (§ 4007(b))."),
  row("VA", "public", "Va. Code §§ 2.2-4347, 2.2-4354", `${VA}title2.2/chapter43/section2.2-4347/`, [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a proper invoice or of the goods or services, whichever is later (state agencies, when the contract sets no date)", rate: null, rateText: "The prime rate as reported in The Wall Street Journal, on amounts unpaid 7 days after the payment date (§ 2.2-4355)", sources: [src("Va. Code § 2.2-4355", `${VA}title2.2/chapter43/section2.2-4355/`)] },
    { payment: "local", days: 45, count: "calendar", from: "receipt of the invoice or of the goods or services, whichever is later (local governments, when the contract sets no date)", rate: null, rateText: "Finance charges the supplier assesses, not more than 1% per month", sources: [src("Va. Code § 2.2-4352", `${VA}title2.2/chapter43/section2.2-4352/`)] },
    { payment: "sub", days: 7, count: "calendar", from: "the contractor's receipt of payment from the state agency or local government for the subcontractor's work", rate: PER_MONTH(100), rateText: "1% per month, unless the contract provides otherwise", caveat: "Within the 7 days the contractor either pays or gives written notice of withholding with the reason." }
  ], "Virginia Public Procurement Act, prompt payment article."),
  row("VA", "private", "Va. Code § 11-4.6(B)", `${VA}title11/chapter2/section11-4.6/`, [
    { payment: "owner", days: 60, count: "calendar", from: "receipt of an invoice following satisfactory completion of the invoiced work", rate: null, rateText: "Interest penalties consistent with § 2.2-4355 (the prime rate; floats)" },
    { payment: "sub", days: 7, count: "calendar", from: "the general contractor's receipt of payment from the owner for the subcontractor's work", rate: null, rateText: "Interest penalties consistent with § 2.2-4355 (the prime rate; floats)", caveat: "The section's date is 60 days after the subcontractor's invoice when that is earlier." }
  ], "Construction contracts with owners other than public bodies. An owner that withholds gives written notice within 45 days of the invoice; a contractor, within 50 days."),
  row("WA", "public", "RCW 39.76.011", "https://app.leg.wa.gov/RCW/default.aspx?cite=39.76.011", [
    { payment: "owner", days: 30, count: "calendar", from: "receipt of a properly completed invoice or of the goods or services, whichever is later", rate: PER_MONTH(100), rateText: "1% per month, at least $1 per month", caveat: "With grant or federal money, the 30 calendar days run from receipt of the payment request or of that money, whichever is later. The $1 monthly minimum is not applied by the calculator." },
    { payment: "sub", days: 10, count: "calendar", from: "the contractor's receipt of the payment", rate: null, rateText: "The highest rate allowed under RCW 19.52.025, for every month and part of a month (floats)", sources: [src("RCW 39.04.250", "https://app.leg.wa.gov/RCW/default.aspx?cite=39.04.250")] }
  ], "State agencies, counties, cities, towns, school districts, and other public bodies, except as RCW 39.76.020 provides. A public body withholding part of a public works payment gives written notice within 8 working days."),
  row20("WV", "public", "W. Va. Code § 12-10-3(b)", "https://code.wvlegislature.gov/12-10-3/", [
    { payment: "owner", days: 45, count: "calendar", from: "the state agency's receipt of a legitimate, uncontested invoice for commodities or services bought on or after July 1, 2025 (an invoice sent before delivery and acceptance counts as received on acceptance)", rate: null, rateText: "No interest rate stated in this article; the State Auditor publishes a monthly list of agencies that pay late" }
  ], "The Prompt Payment Act of 2025 covers state agencies' payments for commodities and services, and state grants; it does not name construction separately and does not cover local governments. The agency that first receives a claim processes it within 10 business days. Disputed or erroneous claims may be refused. The article sets no subcontractor day count.", [src20("W. Va. Code § 12-10-2", "https://code.wvlegislature.gov/12-10-2/")]),
  row("WI", "public", "Wis. Stat. § 66.0135(2), (3)", "https://docs.legis.wisconsin.gov/statutes/statutes/66/i/0135", [
    { payment: "local", days: 30, count: "calendar", from: "receipt of a properly completed invoice or receipt and acceptance of the property or service, whichever is later (local governmental units)", rate: null, rateText: "The rate in § 71.82(1)(a), compounded monthly, from the 31st day (set in another section; no interest is computed here)" },
    { payment: "sub", days: 7, count: "calendar", from: "the principal contractor's receipt of any payment from the agency", rate: null, rateText: "The rate in § 71.82(1)(a), compounded monthly, from the 8th day (set in another section; no interest is computed here)" }
  ], "Political subdivisions, special purpose districts, and their agencies. Subsection (4) lists exceptions, including federal money not yet received, contracts with their own late-payment terms in the original bid, and good faith disputes noticed in time. An agency that gets an improperly completed invoice says why within 10 working days."),
  row20("WY", "public", "Wyo. Stat. §§ 16-6-601, 16-6-602", "https://wyoleg.gov/statutes/compress/title16.pdf", [
    { payment: "owner", days: 45, count: "calendar", from: "receipt of a correct notice of the amount due (agencies of the state and of its political subdivisions)", rate: PER_MONTH(150), rateText: "1.5% per month on the unpaid balance, from the 45th day", caveat: "Except as provided by contract." }
  ], "Goods and services, including construction services, that agencies buy from nongovernmental entities. No interest is owed while a good faith dispute exists over the agency's obligation to pay. Partial payments on public works are made as the contract stipulates (§ 16-6-702). The article sets no subcontractor day count.", [src20("Wyo. Stat. § 16-6-702", "https://wyoleg.gov/statutes/compress/title16.pdf")])
];
var NOT_READ = "Not read from an official source for this table yet.";
var NH_REASON = "No prompt payment statute for construction has been identified in New Hampshire's official statutes for this table yet.";
var GAP_REASONS = { NH: NH_REASON };
var COVERED = new Set(PROMPT_PAY_ROWS.map((r) => r.code));
var PROMPT_PAY_TABLE = {
  id: "prompt-pay",
  label: "state prompt payment deadlines for construction",
  checkedOn: CHECKED_20,
  members: REF_US_STATES_DC,
  rows: PROMPT_PAY_ROWS,
  notCovered: REF_US_STATES_DC.filter((m) => !COVERED.has(m.code)).map((m) => ({ code: m.code, reason: GAP_REASONS[m.code] ?? NOT_READ })),
  officialHosts: [
    // NMOneSource.com: the New Mexico Compilation Commission's site for the New Mexico Statutes Annotated 1978, which
    // the commission publishes as the official legal research tool of the New Mexico courts and legislature.
    "nmonesource.com",
    // www.lexisnexis.com/hottopics/...: the addresses the legislatures of Arkansas, Colorado, Georgia, Mississippi, and
    // Tennessee link for their codes (arkleg.state.ar.us, leg.colorado.gov, legis.ga.gov, legislature.ms.gov, and
    // capitol.tn.gov). Each opens the state's free public access code on advance.lexis.com, which LexisNexis prepares and
    // maintains under contract with the state (in Colorado, with the General Assembly's Committee on Legal Services; in
    // Georgia, with the Code Revision Commission for the General Assembly). The sections were read there. A section's own
    // advance.lexis.com address works only inside the reading session, so the rows link the state's entry address.
    "www.lexisnexis.com"
  ]
};
var promptPayKey = (r) => `${r.code} ${r.job}`;
function promptPaySources(r) {
  return [...r.alsoRead ?? [], ...r.deadlines.flatMap((d) => d.sources ?? [])];
}
var PROMPT_PAY_JOB_LABELS = { public: "Public", private: "Private", both: "Public and private" };
var PROMPT_PAY_PAYMENT_LABELS = {
  owner: "Owner pays the contractor",
  local: "Local public owner pays the contractor",
  sub: "Contractor pays a subcontractor"
};
function promptPayPercent(bp) {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}%`;
}
function promptPayRateLabel(rate) {
  const base = `${promptPayPercent(rate.bp)} per ${rate.per}`;
  return rate.partMonthIsWhole ? `${base} (each part of a month counts as a month)` : base;
}
function promptPayYearlyBp(rate) {
  if (!rate) return null;
  return rate.per === "year" ? rate.bp : rate.per === "month" ? rate.bp * 12 : rate.bp * 365;
}
function findPromptPayRow(code, job, table = PROMPT_PAY_TABLE) {
  return table.rows.find((r) => r.code === code && r.job === job);
}
var DAY_MAX = 120;
var YEARLY_BP_MAX = 3600;
function checkPromptPayTable(table = PROMPT_PAY_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, promptPayKey, promptPaySources));
  const badDeadlines = [];
  const badRates = [];
  for (const r of table.rows) {
    const key = promptPayKey(r);
    const list = Array.isArray(r.deadlines) ? r.deadlines : [];
    if (list.length === 0) badDeadlines.push(`${key} (no deadline)`);
    const seen = /* @__PURE__ */ new Set();
    for (const d of list) {
      if (seen.has(d.payment)) badDeadlines.push(`${key} (${d.payment} twice)`);
      seen.add(d.payment);
      if (!Number.isSafeInteger(d.days) || d.days < 1 || d.days > DAY_MAX) badDeadlines.push(`${key} ${d.payment} (${d.days} days)`);
      if (d.count !== "calendar" && d.count !== "business") badDeadlines.push(`${key} ${d.payment} (day count "${String(d.count)}")`);
      if (typeof d.from !== "string" || d.from.trim().length < 8) badDeadlines.push(`${key} ${d.payment} (no start event)`);
      if (typeof d.rateText !== "string" || d.rateText.trim().length < 8) badDeadlines.push(`${key} ${d.payment} (no rate wording)`);
      if (d.rate) {
        const yearly = promptPayYearlyBp(d.rate);
        if (!Number.isSafeInteger(d.rate.bp) || d.rate.bp <= 0 || yearly === null || yearly > YEARLY_BP_MAX) badRates.push(`${key} ${d.payment} (${d.rate.bp} bp per ${d.rate.per})`);
        if (d.rate.per !== "year" && d.rate.per !== "month" && d.rate.per !== "day") badRates.push(`${key} ${d.payment} (per ${String(d.rate.per)})`);
        if (d.rate.partMonthIsWhole && d.rate.per !== "month") badRates.push(`${key} ${d.payment} (part-month rule on a rate per ${d.rate.per})`);
      }
      if (d.graceDays !== void 0 && (!Number.isSafeInteger(d.graceDays) || d.graceDays < 0)) badRates.push(`${key} ${d.payment} (grace ${d.graceDays})`);
      if (d.interestFromGrace && d.graceDays === void 0) badRates.push(`${key} ${d.payment} (interest from the grace days, but no grace days)`);
    }
  }
  checks.that("pp-deadlines", "Every row has its deadlines, each a whole number of days from 1 to 120, with what starts the count and how the rate is stated", badDeadlines.length === 0, badDeadlines.slice(0, 12).join("; "));
  checks.that("pp-rates", "Every fixed rate is a whole number of basis points above zero and no more than 36% a year", badRates.length === 0, badRates.slice(0, 12).join("; "));
  const jobs = /* @__PURE__ */ new Map();
  for (const r of table.rows) jobs.set(r.code, /* @__PURE__ */ new Set([...jobs.get(r.code) ?? [], r.job]));
  const mixed = [...jobs.entries()].filter(([, set]) => set.has("both") && set.size > 1).map(([code]) => code);
  checks.that("pp-job-types", "A state whose row covers public and private jobs together has no separate public or private row", mixed.length === 0, mixed.length ? `both kinds of row: ${mixed.sort().join(", ")}` : void 0);
  return checks.all;
}
var YEAR_DAYS = 365n;
function interestFraction(amount, rate, daysLate, months) {
  const a = BigInt(amount);
  const bp = BigInt(rate.bp);
  if (rate.per === "day") return { n: a * bp * BigInt(daysLate), d: 10000n };
  if (rate.per === "year") return { n: a * bp * BigInt(daysLate), d: 10000n * YEAR_DAYS };
  if (rate.partMonthIsWhole) return { n: a * bp * BigInt(months ?? 0), d: 10000n };
  return { n: a * bp * 12n * BigInt(daysLate), d: 10000n * YEAR_DAYS };
}
function roundHalfUp(n, d) {
  const q = n / d;
  return 2n * (n % d) >= d ? q + 1n : q;
}
function monthsStarted(dueIso, paidIso) {
  let k = 0;
  while (refAddMonths(dueIso, k) < paidIso) k += 1;
  return k;
}
function interestFrom(deadline, dueDate) {
  return deadline.interestFromGrace && deadline.graceDays ? addCalendarDays(dueDate, deadline.graceDays) : dueDate;
}
function day(iso, label) {
  if (typeof iso !== "string") throw new Error(`Enter the ${label} as a date.`);
  return formatCivilDate(parseCivilDate(iso.trim(), label));
}
function computePromptPay(input, table = PROMPT_PAY_TABLE) {
  const row2 = findPromptPayRow(input.code, input.job, table);
  const name = refMemberName(table.members, input.code);
  if (!row2) throw new Error(`${name} (${PROMPT_PAY_JOB_LABELS[input.job] ?? input.job} jobs) is not in the table yet.`);
  const deadline = row2.deadlines.find((d) => d.payment === input.payment);
  if (!deadline) throw new Error(`The ${name} row sets no day count for this payment (${PROMPT_PAY_PAYMENT_LABELS[input.payment] ?? input.payment}).`);
  const startDate = day(input.startDate, "start date");
  const hasAmount = input.amount !== void 0 && input.amount !== null;
  const hasPaid = typeof input.paidDate === "string" && input.paidDate.trim() !== "";
  let amount = null;
  if (hasAmount) {
    assertCents(input.amount, "unpaid amount");
    if (input.amount < 0) throw new Error("The unpaid amount cannot be negative.");
    amount = input.amount;
  }
  const paidDate = hasPaid ? day(input.paidDate, "payment date") : null;
  if (paidDate !== null && paidDate < startDate) throw new Error("The payment date is before the start date.");
  const dueDate = deadline.count === "calendar" ? addCalendarDays(startDate, deadline.days) : null;
  let daysLate = null;
  let monthsCharged = null;
  let interest = null;
  let interestNote;
  if (dueDate === null) {
    interestNote = "The section counts business days, which depend on the holidays it recognizes, so no due date or interest is worked out here.";
  } else if (paidDate === null) {
    interestNote = "Enter the unpaid amount and the payment date to count the days late and the interest.";
  } else {
    daysLate = Math.max(0, calendarDaysBetween(dueDate, paidDate));
    if (daysLate === 0) {
      interest = amount === null ? null : 0;
      interestNote = "Paid on or before the due date: no days late.";
    } else if (!deadline.rate) {
      interestNote = `${deadline.rateText}. The row stores no fixed rate, so no interest is worked out.`;
    } else if (amount === null) {
      interestNote = "Enter the unpaid amount to work out the interest.";
    } else if (deadline.graceDays !== void 0 && daysLate <= deadline.graceDays) {
      interest = 0;
      interestNote = `The section owes interest only when payment comes more than ${deadline.graceDays} days after the due date; this one is ${daysLate} days late.`;
    } else {
      const from = interestFrom(deadline, dueDate);
      const days = calendarDaysBetween(from, paidDate);
      const after = from === dueDate ? "the due date" : `day ${deadline.graceDays} after the due date (the section starts the interest on day ${(deadline.graceDays ?? 0) + 1})`;
      if (deadline.rate.partMonthIsWhole) monthsCharged = monthsStarted(from, paidDate);
      const { n, d } = interestFraction(amount, deadline.rate, days, monthsCharged);
      interest = Number(roundHalfUp(n, d));
      interestNote = deadline.rate.partMonthIsWhole ? `${promptPayRateLabel(deadline.rate)} for ${monthsCharged} ${monthsCharged === 1 ? "month" : "months"} started after ${after}.` : deadline.rate.per === "month" ? `${promptPayRateLabel(deadline.rate)}, charged by the day: twelve times the monthly rate over a 365-day year, for ${days} days.` : deadline.rate.per === "year" ? `${promptPayRateLabel(deadline.rate)} over a 365-day year, for ${days} days.` : `${promptPayRateLabel(deadline.rate)} simple interest, for ${days} days.`;
    }
  }
  const result = { row: row2, deadline, startDate, dueDate, amount, paidDate, daysLate, monthsCharged, interest, interestNote };
  return { ...result, checks: verifyPromptPay(result, table) };
}
function verifyPromptPay(r, table = PROMPT_PAY_TABLE) {
  const checks = new CheckList();
  const tableRow = findPromptPayRow(r.row.code, r.row.job, table);
  const tableDeadline = tableRow?.deadlines.find((d) => d.payment === r.deadline.payment);
  checks.that(
    "pp-row-from-table",
    "The days and rate used are the ones in the table row for this state, job type, and payment",
    tableDeadline !== void 0 && JSON.stringify(tableDeadline) === JSON.stringify(r.deadline) && tableRow?.citation === r.row.citation,
    "The deadline in the result differs from the table"
  );
  if (r.dueDate !== null) {
    checks.equal("pp-due-date", `Counting back from the due date gives the ${r.deadline.days} days from the start date`, r.deadline.days, calendarDaysBetween(r.startDate, r.dueDate));
    if (r.paidDate !== null && r.daysLate !== null) {
      const expectedPaid = r.daysLate > 0 ? addCalendarDays(r.dueDate, r.daysLate) : r.paidDate;
      checks.that(
        "pp-days-late",
        r.daysLate > 0 ? `The payment date is the due date plus ${r.daysLate} days late` : "The payment date is on or before the due date",
        r.daysLate > 0 ? expectedPaid === r.paidDate : r.paidDate <= r.dueDate,
        `Due ${r.dueDate}, paid ${r.paidDate}, days late ${r.daysLate}`
      );
    }
  }
  if (r.monthsCharged !== null && r.dueDate !== null && r.paidDate !== null) {
    const k = r.monthsCharged;
    const from = interestFrom(r.deadline, r.dueDate);
    const reaches = refAddMonths(from, k) >= r.paidDate;
    const fewest = k >= 1 && refAddMonths(from, k - 1) < r.paidDate;
    checks.that("pp-months-counted", `${k} ${k === 1 ? "month" : "months"} started after ${from === r.dueDate ? "the due date" : `${from}, the day before the section starts the interest`}: the last one reaches the payment date and one fewer does not`, reaches && fewest, `Due ${r.dueDate}, interest counted from ${from}, paid ${r.paidDate}, months ${k}`);
  }
  if (r.interest !== null && r.interest > 0 && r.deadline.rate && r.amount !== null && r.daysLate !== null) {
    const days = r.daysLate - (r.deadline.interestFromGrace ? r.deadline.graceDays ?? 0 : 0);
    const { n, d } = interestFraction(r.amount, r.deadline.rate, days, r.monthsCharged);
    const secondWay = Number((n + d / 2n) / d);
    checks.cents("pp-interest-second", "Interest worked out a second way (whole-number division with the half added first)", secondWay, r.interest);
    const gap = BigInt(r.interest) * d - n;
    checks.that("pp-interest-bounds", "Interest times the divisor is within half a divisor of amount × rate × time (rounded half up to the cent)", -d < 2n * gap && 2n * gap <= d, "The interest is not the exact figure rounded half up to the cent");
  }
  if (r.dueDate !== null) {
    const weekday = weekdayName(r.dueDate);
    checks.that("pp-weekend", "The due date falls on a weekday", weekday !== "Saturday" && weekday !== "Sunday", `${longDate(r.dueDate)} is a ${weekday}. The calendar count does not move it; some sections or general rules on counting time move a weekend date to the next business day`, "warning");
  } else {
    checks.that("pp-business-days", "The section counts calendar days", false, "The section counts business days, so no calendar due date is worked out", "warning");
  }
  if (r.deadline.caveat) checks.that("pp-caveat", "The section has no condition that the calculator leaves out", false, r.deadline.caveat, "warning");
  if (!r.deadline.rate) checks.that("pp-rate-fixed", "The section states a fixed interest rate", false, `${r.deadline.rateText}. No interest is worked out for this row`, "warning");
  return checks.all;
}
var PP_NAME_AT_MOST = 5;
var PP_DAY_FINDINGS = [
  { id: "owner-days", payment: "owner", what: "the owner paying the contractor", label: "The owner-to-contractor day counts, counted again deadline by deadline, agree" },
  { id: "local-days", payment: "local", what: "a local public owner paying the contractor", label: "The local public owner day counts, counted again deadline by deadline, agree" },
  { id: "sub-days", payment: "sub", what: "the contractor paying a subcontractor", label: "The subcontractor day counts, counted again deadline by deadline, agree" }
];
function ppDaysText(days, count) {
  return `${days} ${count === "business" ? "business " : ""}${days === 1 ? "day" : "days"}`;
}
function ppShortPercent(bp) {
  const whole = Math.floor(bp / 100);
  const part = bp % 100;
  if (part === 0) return `${whole}%`;
  return `${whole}.${part % 10 === 0 ? String(part / 10) : String(part).padStart(2, "0")}%`;
}
function ppRateShort(r) {
  return `${ppShortPercent(r.bp)} per ${r.per}`;
}
function ppOr(items) {
  return items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
function ppPlaces(codes, members) {
  return refNameList(codes, members).replace(/(^|, | and )District of Columbia/, "$1the District of Columbia");
}
function ppRowNames(rows, members) {
  const jobsOf = /* @__PURE__ */ new Map();
  for (const r of rows) jobsOf.set(r.code, /* @__PURE__ */ new Set([...jobsOf.get(r.code) ?? [], r.job]));
  const groups = { public: [], private: [], both: [] };
  for (const [code, jobs] of jobsOf) groups[jobs.has("both") || jobs.has("public") && jobs.has("private") ? "both" : jobs.has("public") ? "public" : "private"].push(code);
  const lead = { public: "public jobs in", private: "private jobs in", both: "public and private jobs in" };
  return ["public", "private", "both"].filter((g) => groups[g].length > 0).map((g) => `${lead[g]} ${ppPlaces(groups[g], members)}`).join("; ");
}
function ppWho(keys, table) {
  if (keys.length > PP_NAME_AT_MOST) return refCount(keys.length, "row", "rows");
  const wanted = new Set(keys);
  return ppRowNames(
    table.rows.filter((r) => wanted.has(promptPayKey(r))),
    table.members
  );
}
function ppYearEnd(end, table) {
  const yearly = `${ppShortPercent(end.yearlyBp)} per year`;
  const worded = ppOr(end.rates.map(ppRateShort));
  return `${yearly} (${worded === yearly ? "" : `${worded}: `}${ppWho(end.keys, table)})`;
}
var ppByDays = (a, b) => a.days - b.days || a.count.localeCompare(b.count);
var PP_PER_YEAR = { year: 1, month: 12, day: 365 };
var ppByRate = (a, b) => a.bp * PP_PER_YEAR[a.per] - b.bp * PP_PER_YEAR[b.per] || a.bp - b.bp || a.per.localeCompare(b.per);
function ppUniqueRates(list) {
  const by = new Map(list.map((r) => [`${r.per}:${r.bp}`, { bp: r.bp, per: r.per }]));
  return [...by.values()].sort(ppByRate);
}
function ppCoverageFirst(table) {
  const codes = new Set(table.rows.map((r) => r.code));
  const stateCodes = table.members.filter((m) => m.code !== "DC").map((m) => m.code);
  const states = stateCodes.filter((c) => codes.has(c)).length;
  const jobs = { public: 0, private: 0, both: 0 };
  for (const job of ["public", "private", "both"]) jobs[job] = table.rows.filter((r) => r.job === job).length;
  return { rows: table.rows.length, states, stateMembers: stateCodes.length, dc: codes.has("DC"), missingStates: stateCodes.length - states, jobs };
}
function ppDayFirst(table, payment) {
  const given = table.rows.flatMap((r) => {
    const d = r.deadlines.find((x) => x.payment === payment);
    return d ? [{ key: promptPayKey(r), d }] : [];
  });
  const sample = new Map(given.map(({ d }) => [`${d.days} ${d.count}`, d]));
  const tally = refTally(given.map(({ key, d }) => ({ code: key, value: `${d.days} ${d.count}` })));
  const most = tally[0]?.codes.length ?? 0;
  const top = tally.filter((t) => t.codes.length === most).map((t) => ({ days: sample.get(t.value).days, count: sample.get(t.value).count, keys: [...t.codes].sort() })).sort(ppByDays);
  const ends = refExtremes(given.filter(({ d }) => d.count === "calendar").map(({ key, d }) => ({ code: key, value: d.days })));
  return {
    rows: given.length,
    top,
    shortest: ends ? { days: ends.min, count: "calendar", keys: [...ends.minCodes].sort() } : null,
    longest: ends ? { days: ends.max, count: "calendar", keys: [...ends.maxCodes].sort() } : null
  };
}
function ppBusinessFirst(table) {
  return table.rows.filter((r) => r.deadlines.some((d) => d.count === "business")).map(promptPayKey).sort();
}
function ppRatesFirst(table) {
  const items = table.rows.flatMap((r) => {
    const own = /* @__PURE__ */ new Map();
    for (const d of r.deadlines) if (d.rate) own.set(`${d.rate.bp} per ${d.rate.per}`, d.rate);
    return [...own].map(([value, rate]) => ({ key: promptPayKey(r), value, rate }));
  });
  const rateOf = new Map(items.map((i) => [i.value, i.rate]));
  const tally = refTally(items.map((i) => ({ code: i.key, value: i.value })));
  const most = tally[0]?.codes.length ?? 0;
  const top = tally.filter((t) => t.codes.length === most).map((t) => ({ bp: rateOf.get(t.value).bp, per: rateOf.get(t.value).per, keys: [...t.codes].sort() })).sort(ppByRate);
  const yearly = items.map((i) => ({ code: i.key, value: promptPayYearlyBp(i.rate), rate: i.rate }));
  const ends = refExtremes(yearly.map(({ code, value }) => ({ code, value })));
  const at = (v) => {
    const here = yearly.filter((y) => y.value === v);
    return { yearlyBp: v, rates: ppUniqueRates(here.map((y) => y.rate)), keys: [...new Set(here.map((y) => y.code))].sort() };
  };
  return { rows: table.rows.filter((r) => r.deadlines.some((d) => d.rate)).length, top, lowest: ends ? at(ends.min) : null, highest: ends ? at(ends.max) : null };
}
function ppCoverageSecond(table) {
  const hasRow = (code) => table.rows.some((r) => r.code === code);
  let states = 0;
  let stateMembers = 0;
  for (const m of table.members) {
    if (m.code === "DC") continue;
    stateMembers += 1;
    if (hasRow(m.code)) states += 1;
  }
  const counted = {};
  for (const r of table.rows) counted[r.job] = (counted[r.job] ?? 0) + 1;
  return {
    // Each state and job type once: a row listed twice is counted once here.
    rows: new Set(table.rows.map(promptPayKey)).size,
    states,
    stateMembers,
    dc: table.members.some((m) => m.code === "DC") && hasRow("DC"),
    missingStates: table.notCovered.filter((g) => g.code !== "DC").length,
    jobs: { public: counted.public ?? 0, private: counted.private ?? 0, both: counted.both ?? 0 }
  };
}
function ppDaySecond(table, payment) {
  const groups = /* @__PURE__ */ new Map();
  const calendar = [];
  let rows = 0;
  for (const r of table.rows) {
    for (const d of r.deadlines) {
      if (d.payment !== payment) continue;
      rows += 1;
      const id = `${d.count}:${d.days}`;
      const g = groups.get(id) ?? { days: d.days, count: d.count, keys: [] };
      g.keys.push(promptPayKey(r));
      groups.set(id, g);
      if (d.count === "calendar") calendar.push({ days: d.days, key: promptPayKey(r) });
    }
  }
  let most = 0;
  for (const g of groups.values()) if (g.keys.length > most) most = g.keys.length;
  const top = [...groups.values()].filter((g) => g.keys.length === most).map((g) => ({ ...g, keys: [...g.keys].sort() })).sort(ppByDays);
  calendar.sort((a, b) => a.days - b.days);
  const at = (days) => days === void 0 ? null : { days, count: "calendar", keys: calendar.filter((c) => c.days === days).map((c) => c.key).sort() };
  return { rows, top, shortest: at(calendar[0]?.days), longest: at(calendar[calendar.length - 1]?.days) };
}
function ppBusinessSecond(table) {
  const keys = [];
  for (const r of table.rows) {
    let n = 0;
    for (const d of r.deadlines) if (d.count === "business") n += 1;
    if (n > 0) keys.push(promptPayKey(r));
  }
  return keys.sort();
}
function ppRatesSecond(table) {
  const groups = /* @__PURE__ */ new Map();
  const yearly = [];
  let rows = 0;
  for (const r of table.rows) {
    const key = promptPayKey(r);
    const seen = [];
    for (const d of r.deadlines) {
      if (!d.rate) continue;
      const id = `${d.rate.per}:${d.rate.bp}`;
      if (seen.includes(id)) continue;
      seen.push(id);
      const g = groups.get(id) ?? { bp: d.rate.bp, per: d.rate.per, keys: [] };
      g.keys.push(key);
      groups.set(id, g);
      yearly.push({ yearlyBp: d.rate.bp * PP_PER_YEAR[d.rate.per], bp: d.rate.bp, per: d.rate.per, key });
    }
    if (seen.length > 0) rows += 1;
  }
  let most = 0;
  for (const g of groups.values()) if (g.keys.length > most) most = g.keys.length;
  const top = [...groups.values()].filter((g) => g.keys.length === most).map((g) => ({ ...g, keys: [...g.keys].sort() })).sort(ppByRate);
  yearly.sort((a, b) => a.yearlyBp - b.yearlyBp);
  const at = (v) => {
    if (v === void 0) return null;
    const here = yearly.filter((y) => y.yearlyBp === v);
    return { yearlyBp: v, rates: ppUniqueRates(here), keys: [...new Set(here.map((y) => y.key))].sort() };
  };
  return { rows, top, lowest: at(yearly[0]?.yearlyBp), highest: at(yearly[yearly.length - 1]?.yearlyBp) };
}
function ppCoverageSentence(c) {
  const where = c.dc ? `the District of Columbia and ${c.states} of the ${c.stateMembers} states` : `${c.states} of the ${c.stateMembers} states`;
  const missing = c.missingStates === 0 ? c.dc ? "every state has a row" : "the District of Columbia has no row yet" : `${c.missingStates === 1 ? "one state has" : `the other ${c.missingStates} states have`} no row yet${c.dc ? "" : ", nor does the District of Columbia"}`;
  return `The table has ${refCount(c.rows, "row", "rows")}, covering ${where} (${missing}): ${refCount(c.jobs.public, "row", "rows")} for public jobs, ${c.jobs.private} for private jobs, and ${c.jobs.both} for public and private jobs in one section.`;
}
function ppDaySentence(f, what, table) {
  if (f.rows === 0) return `None of the ${refCount(table.rows.length, "row", "rows")} gives a day count for ${what}.`;
  const first = f.top[0];
  if (f.rows === 1) return `One row gives a day count for ${what}: ${ppDaysText(first.days, first.count)} (${ppWho(first.keys, table)}).`;
  const n = first.keys.length;
  const common = n === 1 ? "no two give the same figure" : f.top.length === 1 ? `${n} give ${ppDaysText(first.days, first.count)}${n <= PP_NAME_AT_MOST ? ` (${ppWho(first.keys, table)})` : ""}, the most common figure` : `${ppOr(f.top.map((g) => ppDaysText(g.days, g.count)))} are the most common figures, ${n} rows each`;
  const lo = f.shortest;
  const hi = f.longest;
  const range = !lo || !hi ? "" : lo.days === hi.days ? `; every calendar-day count is ${ppDaysText(lo.days, "calendar")}` : `; the shortest calendar-day count is ${ppDaysText(lo.days, "calendar")} (${ppWho(lo.keys, table)}) and the longest is ${ppDaysText(hi.days, "calendar")} (${ppWho(hi.keys, table)})`;
  return `Of the ${f.rows} rows that give a day count for ${what}, ${common}${range}.`;
}
function ppBusinessSentence(keys, table) {
  const total = refCount(table.rows.length, "row", "rows");
  if (keys.length === 0) return `All ${total} count their deadlines in calendar days.`;
  const names = keys.length <= PP_NAME_AT_MOST ? ` (${ppWho(keys, table)})` : "";
  return `Of the ${total}, ${keys.length} ${keys.length === 1 ? "counts" : "count"} at least one deadline in business days rather than calendar days${names}.`;
}
function ppRateSentence(f, table) {
  const total = refCount(table.rows.length, "row", "rows");
  if (f.rows === 0 || !f.lowest || !f.highest) return `None of the ${total} gives a fixed late-payment rate.`;
  const first = f.top[0];
  const often = f.top.length === 1 ? `most often ${ppRateShort(first)} (${ppWho(first.keys, table)})` : `most often ${ppOr(f.top.map(ppRateShort))} (${refCount(first.keys.length, "row", "rows")} each)`;
  const range = f.lowest.yearlyBp === f.highest.yearlyBp ? `; compared over a year, every one comes to ${ppShortPercent(f.lowest.yearlyBp)} per year` : `; compared over a year (a monthly rate times 12, a daily rate times 365), those rates run from ${ppYearEnd(f.lowest, table)} to ${ppYearEnd(f.highest, table)}`;
  return `Of the ${total}, ${f.rows} ${f.rows === 1 ? "gives" : "give"} a fixed late-payment rate for at least one payment, ${often}${range}.`;
}
function promptPayFindings(table = PROMPT_PAY_TABLE) {
  const checks = new CheckList();
  const findings = [];
  const agree = (id, label, one, other) => {
    const a = JSON.stringify(one);
    const b = JSON.stringify(other);
    checks.that(`prompt-pay-${id}`, label, a === b, `Counted one way: ${a.slice(0, 300)}. Counted the other way: ${b.slice(0, 300)}`);
  };
  const total = table.rows.length;
  const sums = [];
  const coverage = ppCoverageFirst(table);
  findings.push({ id: "coverage", text: ppCoverageSentence(coverage) });
  agree("coverage", "The rows, states, and job types, counted again with each state and job type once, agree", coverage, ppCoverageSecond(table));
  const jobSum = coverage.jobs.public + coverage.jobs.private + coverage.jobs.both;
  if (jobSum !== total) sums.push(`public, private, and both-kinds rows come to ${jobSum}, not ${total}`);
  const withRow = new Set(table.rows.map((r) => r.code)).size;
  if (withRow + table.notCovered.length !== table.members.length) sums.push(`${withRow} members with a row and ${table.notCovered.length} without come to ${withRow + table.notCovered.length}, not ${table.members.length}`);
  for (const spec of PP_DAY_FINDINGS) {
    const f = ppDayFirst(table, spec.payment);
    findings.push({ id: spec.id, text: ppDaySentence(f, spec.what, table) });
    agree(spec.id, spec.label, f, ppDaySecond(table, spec.payment));
    const has = table.rows.filter((r) => r.deadlines.some((d) => d.payment === spec.payment)).length;
    const hasNot = table.rows.filter((r) => r.deadlines.every((d) => d.payment !== spec.payment)).length;
    if (has + hasNot !== total) sums.push(`${spec.payment}: ${has} rows with a day count and ${hasNot} without come to ${has + hasNot}, not ${total}`);
    const firstOf = table.rows.flatMap((r) => r.deadlines.filter((d) => d.payment === spec.payment).slice(0, 1));
    const calendar = firstOf.filter((d) => d.count === "calendar").length;
    const business2 = firstOf.filter((d) => d.count === "business").length;
    if (calendar + business2 !== f.rows) sums.push(`${spec.payment}: ${calendar} calendar-day and ${business2} business-day counts come to ${calendar + business2}, not ${f.rows}`);
  }
  const business = ppBusinessFirst(table);
  findings.push({ id: "business-days", text: ppBusinessSentence(business, table) });
  agree("business-days", "The rows with a business-day count, counted again deadline by deadline, agree", business, ppBusinessSecond(table));
  const allCalendar = table.rows.filter((r) => r.deadlines.every((d) => d.count === "calendar")).length;
  if (business.length + allCalendar !== total) sums.push(`${business.length} rows with a business-day count and ${allCalendar} with calendar days only come to ${business.length + allCalendar}, not ${total}`);
  const rates = ppRatesFirst(table);
  findings.push({ id: "rates", text: ppRateSentence(rates, table) });
  agree("rates", "The fixed rates, counted again rate by rate with the yearly figure worked out separately, agree", rates, ppRatesSecond(table));
  const noRate = table.rows.filter((r) => r.deadlines.every((d) => !d.rate)).length;
  if (rates.rows + noRate !== total) sums.push(`${rates.rows} rows with a fixed rate and ${noRate} without come to ${rates.rows + noRate}, not ${total}`);
  checks.that("prompt-pay-groups", "The groups each finding splits the rows into add up to the rows it counts", sums.length === 0, sums.slice(0, 6).join("; "));
  return { findings, checks: checks.all };
}

export {
  daysInMonth,
  parseCivilDate,
  formatCivilDate,
  civilDayNumber,
  calendarDaysBetween,
  addCalendarDays,
  longDate,
  refMemberName,
  refIsDay,
  refCheckTable,
  refAddMonths,
  PROMPT_PAY_ROWS,
  PROMPT_PAY_TABLE,
  promptPayKey,
  promptPaySources,
  PROMPT_PAY_JOB_LABELS,
  PROMPT_PAY_PAYMENT_LABELS,
  promptPayPercent,
  promptPayRateLabel,
  promptPayYearlyBp,
  findPromptPayRow,
  checkPromptPayTable,
  computePromptPay,
  verifyPromptPay,
  promptPayFindings
};
