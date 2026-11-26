// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  parseCivilDate
} from "./calendarDays.mjs";
import {
  CheckList,
  assertCents,
  formatUSD
} from "./money.mjs";

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

// packages/core/src/nonprofit/auditThresholds.ts
var NP_STATEMENT_LEVELS = {
  statement: { rank: 1, label: "Financial statement (no accountant’s report named)" },
  compilation: { rank: 2, label: "Compiled statements" },
  review: { rank: 3, label: "Reviewed statements" },
  audit: { rank: 4, label: "Audited statements" }
};
var CHECKED = "2026-10-20";
var FIRST_READ = "2026-10-19";
var dollars = (n) => n * 100;
var atLeast = (n) => ({ cents: dollars(n), inclusive: true });
var moreThan = (n) => ({ cents: dollars(n), inclusive: false });
var notMoreThan = (n) => ({ cents: dollars(n), inclusive: true });
var lessThan = (n) => ({ cents: dollars(n), inclusive: false });
var tier = (level, accepts, from, to) => to ? { level, accepts, from, to } : { level, accepts, from };
function row(code, citation, sourceUrl, measure, tiers, hasConditions, notes) {
  return { code, citation, sourceUrl, checkedOn: FIRST_READ, measure, tiers, hasConditions, notes };
}
var readOn = (day, r) => ({ ...r, checkedOn: day });
var CPA = "an independent CPA";
var ROWS = [
  row(
    "AR",
    "Ark. Code § 4-28-403(b), as amended by Act 338 of 2023",
    "https://arkleg.state.ar.us/Acts/FTPDocument?path=%2FACTS%2F2023R%2FPublic%2F&file=338.pdf&ddBienniumSession=2023%2F2023R",
    "Contributions in the preceding fiscal year",
    [tier("review", `Statement reviewed by ${CPA}`, moreThan(5e5), lessThan(1e6)), tier("audit", `Audited statement prepared by ${CPA}`, moreThan(1e6))],
    false,
    "Read in the act that amended the section (approved March 21, 2023). As the act words the two bands, a figure of exactly $1,000,000 is in neither of them. Later amendments, if any, were not read."
  ),
  row(
    "CA",
    "Form RRF-1 instructions (Rev. 01/2024), Part B, Question 8 (Gov. Code §§ 12586, 12587)",
    "https://oag.ca.gov/sites/all/files/agweb/pdfs/charities/charitable/rrf1_form.pdf",
    "Total revenue as reported on the Form 990, 990-EZ, or 990-PF",
    [tier("audit", `Audited statements under GAAP, audited by ${CPA}`, moreThan(2e6))],
    true,
    "Read in the Attorney General’s annual renewal form instructions. Government grants and service contracts for which the government requires an accounting of the funds may be deducted from total revenue first."
  ),
  row(
    "CT",
    "Conn. Gen. Stat. § 21a-190c(b)(2)",
    "https://www.cga.ct.gov/current/pub/chap_419d.htm",
    "Gross revenue in the year the report covers, not counting government grants or fees or revenue from funds held in trust for the charity",
    [tier("review", "Attestation that an audit or review report by a CPA has been completed", moreThan(5e5), notMoreThan(1e6)), tier("audit", "Attestation that an audit report by a CPA has been completed", moreThan(1e6))],
    true,
    "For financial statements first due after July 1, 2023 (the section keeps the earlier $500,000 audit rule for statements due on or before that day). The charity attests that the report was completed. The commissioner may waive the requirement for good cause on written request."
  ),
  row(
    "FL",
    "Fla. Stat. § 496.407(1)(b)",
    "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0496/Sections/0496.407.html",
    "Annual contributions",
    [tier("review", `Reviewed or audited by ${CPA}`, atLeast(5e5), lessThan(1e6)), tier("audit", `Audited by ${CPA}`, atLeast(1e6))],
    true,
    "Below $500,000 a compilation, review, or audit is optional. Subsection (2) lets a charity file its Form 990 or 990-EZ in place of the financial statement; at $500,000 or more that form must be prepared by a CPA or another professional who prepares such forms. The department may require an audit or review when it finds discrepancies."
  ),
  readOn(
    CHECKED,
    row(
      "GA",
      "Georgia Secretary of State, How-To Guide: Charities, “Financial Statements” (O.C.G.A. § 43-17-5; Ga. Comp. R. & Regs. 590-9-4-.06)",
      "https://sos.ga.gov/how-to-guide/how-guide-charities",
      "What the charity received or collected in the fiscal year, not counting interest, dividends, or other income from investing charitable funds (Rule 590-9-4-.06)",
      [
        tier("review", `Financial statements under GAAP reviewed by ${CPA}`, moreThan(5e5), notMoreThan(1e6)),
        tier("audit", `Certified financial statement under GAAP: audited by ${CPA}, with the auditor’s report`, moreThan(1e6))
      ],
      true,
      "Read in the Secretary of State’s how-to guide for charities (registration, renewal, and reinstatement); the rule read on the Secretary of State’s rules site says what “received or collected” leaves out. O.C.G.A. § 43-17-5(a)(4), read on October 20, 2026 in Georgia’s public access code (opened from the General Assembly’s link), sets the same two bands: a review by a CPA above $500,000 up to $1,000,000, and an audited statement under GAAP above $1,000,000. Below the review band the guide asks for financial statements that need not be certified or reviewed. A renewal covers each of the two preceding fiscal years, each year at its own band. A newly formed charity that has received no contributions files an officer’s signed statement in place of financial statements."
    )
  ),
  row(
    "IL",
    "225 ILCS 460/4(a) and (b)(3)",
    "https://www.ilga.gov/legislation/ilcs/fulltext.asp?DocName=022504600K4",
    "Contributions in the 12-month fiscal or calendar year",
    [tier("review", `Reviewed statements with a report signed by ${CPA}`, moreThan(3e5), notMoreThan(5e5)), tier("audit", `Opinion signed by ${CPA} on the financial statement`, moreThan(5e5))],
    true,
    "A charity whose fundraising is not done only by staff employees or unpaid persons files the report with the accountant’s opinion once contributions are more than $25,000. Smaller charities file simpler reports set out in the same section."
  ),
  row(
    "KS",
    "K.S.A. 17-1763(c)",
    "https://www.ksrevisor.gov/statutes/chapters/ch17/017_017_0063.html",
    "Contributions received in the most recently completed fiscal year",
    [tier("audit", `Audited statement under GAAP with the opinion of ${CPA}`, moreThan(5e5))],
    false,
    "Filed in addition to the federal tax return or the financial statement the section otherwise asks for."
  ),
  row(
    "MD",
    "Md. Code, Bus. Reg. § 6-402(b)(7)",
    "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gbr&section=6-402&enactments=false",
    "Gross income from charitable contributions in the most recently completed fiscal year",
    [tier("review", `Review by ${CPA}`, atLeast(3e5), lessThan(75e4)), tier("audit", `Audit by ${CPA}`, atLeast(75e4))],
    true,
    "Set for the registration statement; the annual report under § 6-408 carries the audit or review the Secretary of State requires. The Secretary may require an audit or review below $750,000, and may accept other documents in place of it from some charities that mainly collect donated goods."
  ),
  row(
    "MA",
    "Mass. Gen. Laws ch. 12, § 8F",
    "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleII/Chapter12/Section8F",
    "Gross support and revenue in the fiscal year the report covers, not counting gains or losses on the sale of capital assets",
    [tier("review", `Audited, or reviewed by ${CPA} in place of the audit`, moreThan(5e5), notMoreThan(1e6)), tier("audit", `Audited by ${CPA}`, moreThan(1e6))],
    true,
    "For public charities filing the annual report (not those that file a probate account instead). The director may exempt types or classes of organizations from the audit or review report by regulation."
  ),
  row(
    "MI",
    "MCL 400.273(2)(j) and (3)",
    "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-400-273",
    "Contributions in the preceding tax year as reported on the Form 990-series return, including special event receipts net of direct costs, not counting government grants",
    [tier("review", `Reviewed or audited by ${CPA}`, atLeast(325e3), lessThan(575e3)), tier("audit", `Audited by ${CPA}`, atLeast(575e3))],
    true,
    "The section sets $250,000 and $500,000 and raises both by $25,000 for statements submitted from 2015 through 2019 and by another $25,000 for each later 5-year period starting January 1, 2020. The row’s figures are that arithmetic for registration statements submitted from January 1, 2025 through December 31, 2029. The Attorney General may waive the requirement once for a charity."
  ),
  row(
    "MN",
    "Minn. Stat. § 309.53, subd. 3",
    "https://www.revisor.mn.gov/statutes/cite/309.53",
    "Total revenue for the 12 months the financial statement covers",
    [tier("audit", `Audited statement under GAAP, examined by ${CPA}`, moreThan(75e4))],
    false,
    "Donated food that a nonprofit food shelf gives away free is not counted toward the total revenue figure."
  ),
  row(
    "MS",
    "Miss. Code § 79-11-507(1)-(4), in the Secretary of State’s compilation effective July 1, 2024",
    "https://www.sos.ms.gov/sites/default/files/charities/MS%20Regulation%20of%20Charitable%20Solicitations7_2024.pdf",
    "Contributions received as monetary donations in the fiscal year",
    [tier("review", `Statement reviewed by ${CPA}`, atLeast(25e4), notMoreThan(75e4)), tier("audit", `Statement with an opinion signed by ${CPA}`, moreThan(75e4))],
    true,
    "The bands are for charities whose fundraising is done only by unpaid persons; a charity whose fundraising is not done only by unpaid persons files the statement with the accountant’s opinion at any amount. The Secretary of State may ask a charity with more than $25,000 and less than $750,000 for an audited statement."
  ),
  row(
    "NH",
    "RSA 7:28, III-a and III-b",
    "https://gc.nh.gov/rsa/html/I/7/7-28.htm",
    "Revenue, gains, and other support",
    [tier("statement", "Latest financial statement prepared under GAAP", atLeast(5e5), lessThan(2e6)), tier("audit", "Latest audited financial statement prepared under GAAP", atLeast(2e6))],
    true,
    "For charities that file a Form 990 with the Attorney General. The GAAP statement from $500,000 continues to apply above $2,000,000, where the audited one is named. The director of charitable trusts may grant an exemption for financial burden, good for 3 years."
  ),
  readOn(
    CHECKED,
    row(
      "NJ",
      "N.J.S.A. 45:17A-24(d)(2), as amended by P.L.2021, c.381",
      "https://pub.njleg.gov/bills/2020/AL21/381_.HTM",
      "Gross revenue in monetary donations in the most recently completed fiscal year, not counting in-kind contributions directly related to the charity’s stated purposes",
      [tier("audit", `Statement under GAAP (or another basis the Attorney General approves) audited by ${CPA}, with any management letters`, moreThan(1e6))],
      true,
      "Read in the chapter law that amended the section (approved January 18, 2022, effective at once); the compiled statute did not open for this check. The Attorney General may set a greater figure by regulation and may accept a substantially similar report prepared for another state agency. From more than $25,000 to less than $1,000,000 the annual financial report is certified by the president or another authorized officer, and the Attorney General may ask for the audited statement. Regulations and later amendments were not read."
    )
  ),
  row(
    "NM",
    "NMDOJ, Charitable Organization Auditor and Auditor’s Report Requirements (effective 1/1/2024), under NMSA 1978, ch. 57, art. 22",
    "https://nmdoj.gov/wp-content/uploads/NM-Charitable-Organization-Auditor-and-Auditor-Changes-2024.pdf",
    "Total annual expenses as reported to the IRS, for fiscal periods beginning on or after January 1, 2024",
    [tier("audit", "Independent auditor’s report covering the period", moreThan(75e4))],
    true,
    "Read in the Department of Justice’s guide to the 2023 change (SB 240). For fiscal periods that began before January 1, 2024 the guide uses total revenue of more than $500,000 instead."
  ),
  readOn(
    CHECKED,
    row(
      "NY",
      "N.Y. Exec. Law § 172-b(1), (2), and (2-a)",
      "https://www.nysenate.gov/legislation/laws/EXC/172-B",
      "Gross revenue and support in the fiscal year",
      [
        tier("review", `Annual financial report with a review report by ${CPA}`, atLeast(25e4), notMoreThan(1e6)),
        tier("audit", `Annual financial report with an audit report by ${CPA}`, moreThan(1e6))
      ],
      true,
      "After reading a review report the Attorney General may ask for an audit report, due within 120 days of the request. Subdivision 2-a asks for an unaudited report when gross revenue and support is not in excess of $250,000, so a figure of exactly $250,000 is named there and in the review band. A parent may file a combined report with its affiliates under subdivision 4."
    )
  ),
  row(
    "PA",
    "10 P.S. § 162.5(f) (Solicitation of Funds for Charitable Purposes Act, § 5(f))",
    "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?txtType=PDF&SessYr=1990&SessInd=0&ActNum=0202.",
    "Annual contributions",
    [
      tier("compilation", "Compilation, review, or audit by an independent CPA or public accountant", atLeast(1e5), lessThan(25e4)),
      tier("review", "Review or audit by an independent CPA or public accountant", atLeast(25e4), lessThan(75e4)),
      tier("audit", "Audit by an independent CPA or public accountant", atLeast(75e4))
    ],
    true,
    "Below $100,000 a compilation, review, or audit is optional. The department may require an audit or review from any registrant, and may accept the charity’s own statement in place of one when special facts are shown. Government audits of government grants are accepted as part of the statements."
  ),
  row(
    "RI",
    "R.I. Gen. Laws § 5-53.1-4(a)",
    "https://webserver.rilegislature.gov/Statutes/TITLE5/5-53.1/5-53.1-4.htm",
    "Annual gross income",
    [tier("audit", `Annual financial statement audited by ${CPA}`, moreThan(1e6))],
    true,
    "As amended effective July 1, 2025. At $1,000,000 or less, a Form 990 or statements compiled by an independent public or certified accountant count as meeting the section. The director may require audited statements below that when there is reasonable cause to believe the chapter was violated."
  ),
  row(
    "TN",
    "Tennessee Secretary of State, Charities FAQs, “How does an organization register as a charity?”",
    "https://sos.tn.gov/charities/faqs",
    "Revenues, not counting government grants and grants from private foundations",
    [tier("audit", "Audited financial statement", moreThan(1e6))],
    false,
    "Read in the Secretary of State’s answer on registering a charity, which lists the audited statement with the registration filings once an accounting year is complete. The statute itself was not read for this row."
  ),
  row(
    "WV",
    "W. Va. Code § 29-19-5(a)(6)",
    "https://code.wvlegislature.gov/29-19-5/",
    "Contributions raised per year, not counting grants from government agencies or private foundations",
    [tier("review", `Statement of financial review by ${CPA}`, moreThan(2e5), lessThan(5e5)), tier("audit", `Report of an audit by ${CPA}`, moreThan(5e5))],
    false,
    "Filed with the registration statement, in addition to the balance sheet and income statement the section asks for. As the section words the two bands, a figure of exactly $500,000 is in neither of them."
  ),
  row(
    "WI",
    "Wis. Stat. § 202.12(3)(b) and (bm)",
    "https://docs.legis.wisconsin.gov/statutes/statutes/202/ii/12",
    "Contributions in the most recently completed fiscal year",
    [tier("review", `Statement under GAAP reviewed by ${CPA}`, moreThan(5e5), notMoreThan(1e6)), tier("audit", `Audited statement under GAAP with the opinion of ${CPA}`, moreThan(1e6))],
    true,
    "The same figures apply to the registration under § 202.12(1)(b). Each figure is subject to adjustment by the department under § 202.12(8). A charity may apply for a waiver under § 202.12(3)(d) when its contributions were under $300,000 in each of the past 3 fiscal years and one contributor gave more than the amount set there in the year."
  )
];
var NOT_READ = "Not yet read from an official source for this table.";
var BLOCKED = "The official site did not open for this check (it refuses automated reading), so no figure was read.";
var BLOCKED_CODES = [];
var READ_NO_FIGURE = {
  // https://law.alaska.gov/department/civil/consumer/charityreg.html (the statute site, akleg.gov, refused the check on
  // October 19 and timed out in a browser on October 20, four tries over about 20 minutes, Cloudflare error 522)
  AK: `Read on ${CHECKED}: the Department of Law’s charity registration page (AS 45.68) says Form 990s and audited statements are not sent with registration and are given only when the department asks. It names no dollar figure for audited, reviewed, or compiled statements. The statute itself did not open for this check.`,
  // https://alison.legislature.state.al.us/code-of-alabama?section=13A-9-71
  AL: `Read on ${CHECKED}: Ala. Code § 13A-9-71(g) has a registered charity file a sworn annual report with a financial statement (gross income, expenses, and net income), a balance sheet, and a schedule of its activities, or a copy of its Form 990. The section names no audited, reviewed, or compiled statement or dollar figure for one.`,
  // https://www.azleg.gov/ars/44/06551.htm and https://www.azleg.gov/ars/44/06561.htm
  AZ: `Read on ${CHECKED}: A.R.S. title 44, chapter 19 (solicitation of funds for charitable purposes) has two sections, § 44-6551 (definitions) and § 44-6561 (unlawful acts or practices); neither sets a charity registration or financial filing. No dollar figure for audited, reviewed, or compiled statements is named.`,
  // https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-06.pdf (the legislature's 2024 printout of title 6)
  CO: `Read on ${CHECKED}: C.R.S. § 6-16-104(2)(f) and (5)(a) have a registered charity file a financial report each year on the Secretary of State’s form, or, at the Secretary of State’s discretion, a copy of its Form 990; article 16 names no audited, reviewed, or compiled statement or dollar figure for one. The Secretary of State’s rules were not read.`,
  // https://code.dccouncil.gov/us/dc/council/code/sections/44-1703 (and 44-1704, 44-1706)
  DC: `Read on ${CHECKED}: D.C. Code §§ 44-1703, 44-1704, and 44-1706 set a certificate of registration and a report of contributions and expenses, and name no audited, reviewed, or compiled statement or dollar figure for one. The District’s regulations were not read.`,
  // https://delcode.delaware.gov/title6/c025/sc10/index.html and https://revenue.delaware.gov/business-tax-forms/fundraisers-and-charitable-solicitations/
  DE: `Read on ${CHECKED}: 6 Del. C. §§ 2591 to 2597 (the charitable/fraternal solicitation subchapter) set disclosure rules and records for professional solicitors and no charity registration, and the Division of Revenue’s page says no state statute requires charitable solicitations to be registered. No dollar figure for audited, reviewed, or compiled statements is named.`,
  // https://data.capitol.hawaii.gov/hrscurrent/Vol10_Ch0436-0474/HRS0467B/HRS_0467B-0006_0005.htm
  HI: `Read on ${CHECKED}: HRS § 467B-6.5 sets the annual financial report and a fee scale by total revenue; an audit report by a CPA goes with the report only when a government body or a third party required the charity to obtain one. No dollar figure is set for audited, reviewed, or compiled statements.`,
  // https://www.legis.iowa.gov/docs/code/13C.pdf
  IA: `Read on ${CHECKED}: Iowa Code chapter 13C registers paid fund-raisers; a charity gives its financial information on request, and files it with the Attorney General only after failing to give it. No audited, reviewed, or compiled statement or dollar figure for one is named.`,
  // https://legislature.idaho.gov/statutesrules/idstat/title48/t48ch12/ and its sections SECT48-1201 to SECT48-1206
  ID: `Read on ${CHECKED}: the Idaho Charitable Solicitation Act (Idaho Code §§ 48-1201 to 48-1206: findings, definitions, unlawful acts, the Attorney General’s authority, private actions, and the limit on actions) sets no charity registration or financial filing. No dollar figure for audited, reviewed, or compiled statements is named.`,
  // https://iga.in.gov/ic/2025/Title_23.html (IC 23-7-8) and https://www.in.gov/attorneygeneral/consumer-protection-division/charities-and-donors/charitable-fundraising/
  IN: `Read on ${CHECKED}: IC 23-7-8 registers professional fundraiser consultants and professional solicitors, and the Attorney General’s charitable fundraisers page says charities that solicit through their own employees or volunteers do not register or report their campaigns to the state. No audited, reviewed, or compiled statement or dollar figure for one is named.`,
  // https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=35030 (and id=35031 for KRS 367.658)
  KY: `Read on ${CHECKED}: KRS 367.657 has a soliciting charity file a copy of its most recent Form 990 with the Attorney General, or a notice of intent when it has none. No audited, reviewed, or compiled statement or dollar figure for one is named; the audit on request in KRS 367.658 is for a paid solicitor’s campaign report.`,
  // https://www.ag.state.la.us/Charities and its checklist, /Files/Article/70/Documents/CharitableOrganizationRegistrationChecklist.pdf;
  // the statutes at https://legis.la.gov/legis/Law.aspx?d=104159 (R.S. 51:1901) through d=104172 (R.S. 51:1909.1)
  LA: `Read on ${CHECKED}: La. R.S. 51:1901 to 51:1909.1 register professional solicitors (§ 1901.1) and set rules for commercial co-venturers and solicitations, and none of those sections names a financial statement for a charity to file. The Attorney General’s charities page has charities that use a professional solicitor register each year, and its checklist names no financial statement and says no Form 990 is needed. No dollar figure for audited, reviewed, or compiled statements is named. The Attorney General’s rules were not read.`,
  // https://legislature.maine.gov/statutes/9/title9sec5004.html and title9sec5005-B.html
  ME: `Read on ${CHECKED}: 9 M.R.S. §§ 5004 and 5005-B (licensing and the annual fund-raising activity report) name no audited, reviewed, or compiled statement or dollar figure for one. The department’s rules were not read.`,
  // https://revisor.mo.gov/main/OneSection.aspx?section=407.456 and section=407.462
  MO: `Read on ${CHECKED}: RSMo §§ 407.456 and 407.462 (registration, and the annual report on the Attorney General’s form) name no audited, reviewed, or compiled statement or dollar figure for one. The Attorney General’s rules were not read.`,
  // https://mca.legmt.gov/bills/mca/title_0300/chapter_0140/parts_index.html and https://dojmt.gov/office-of-consumer-protection/donations-to-charities/
  MT: `Read on ${CHECKED}: the parts of Montana Code Annotated 2025, title 30, chapter 14 (unfair trade practices and consumer protection) include telemarketing registration and no charitable solicitation part, and the Department of Justice’s page on donations to charities names no charity registration or financial filing. No dollar figure for audited, reviewed, or compiled statements was found. The rest of the code was not searched.`,
  // https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_131F/GS_131F-6.html
  NC: `Read on ${CHECKED}: G.S. 131F-6 asks for a financial report on the Department’s form (a Form 990 may stand in for parts of it) and makes a report audited by a CPA optional. No dollar figure is set for audited, reviewed, or compiled statements.`,
  // https://ndlegis.gov/cencode/t50c22.pdf
  ND: `Read on ${CHECKED}: N.D.C.C. § 50-22-04 asks for a GAAP financial statement signed by an officer with the annual report, and says it need not be certified. No dollar figure is set for audited, reviewed, or compiled statements.`,
  // https://sos.nebraska.gov/licensing/information-charitable-solicitors (the Attorney General's
  // protectthegoodlife.nebraska.gov/charity-fundraising asked for a sign-in on October 20 and was not read)
  NE: `Read on ${CHECKED}: the Secretary of State’s page on charitable solicitors says the law under which that office registered charitable solicitors before 1996 was repealed and charities are no longer required to register with it. With no registration, no dollar figure for audited, reviewed, or compiled statements is set. The statutes were not read.`,
  // https://www.leg.state.nv.us/NRS/NRS-082A.html
  NV: `Read on ${CHECKED}: NRS 82A.100 asks for a financial report for the latest fiscal year, which the Secretary of State may accept as a copy of the Form 990, and names no audited, reviewed, or compiled statement or dollar figure for one.`,
  // https://codes.ohio.gov/ohio-revised-code/section-1716.04
  OH: `Read on ${CHECKED}: R.C. 1716.04 asks for an annual financial report on the Attorney General’s form, and the Attorney General must accept a copy of the federal filing. No audited, reviewed, or compiled statement or dollar figure for one is named.`,
  // https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=66919 (18 O.S. § 552.3) and CiteID=488923 (§ 552.23),
  // on the Oklahoma State Courts Network, the Oklahoma Supreme Court's site; https://www.sos.ok.gov/forms/FM0101.PDF
  OK: `Read on ${CHECKED}: 18 O.S. § 552.3 has a charity register each year on the Secretary of State’s forms and give its gross contributions and its program, management and general, and fundraising expense totals, and § 552.23 bars any state filing requirement beyond what the laws set. The Secretary of State’s packet (SOS Form 101-01/13) asks for the same totals. Neither names an audited, reviewed, or compiled statement; no dollar figure for one is set.`,
  // https://secure.sos.state.or.us/oard/view.action?ruleNumber=137-010-0020 and https://www.oregonlegislature.gov/bills_laws/ors/ors128.html
  OR: `Read on ${CHECKED}: OAR 137-010-0020 asks for the independent auditor’s report only if an audit was prepared, and the reporting sections of ORS chapter 128 read name no audited or reviewed statement. No dollar figure is set for audited, reviewed, or compiled statements.`,
  // https://www.scstatehouse.gov/code/t33c056.php
  SC: `Read on ${CHECKED}: S.C. Code chapter 33-56 asks for an annual financial report certified by the chief executive and chief financial officers, and names no audited, reviewed, or compiled statement or dollar figure for one.`,
  // https://sdlegislature.gov/api/Statutes/37-30.html?all=true
  SD: `Read on ${CHECKED}: SDCL chapter 37-30 registers paid solicitors and has them file campaign financial reports; no section has a charity file its own statement, and no audited, reviewed, or compiled statement or dollar figure for one is named.`,
  // https://www.texasattorneygeneral.gov/divisions/charitable-trusts/registration-and-filings
  TX: `Read on ${CHECKED}: the Attorney General’s registration and filings page says most charities are not required to register with the state; registration is for certain law enforcement, public safety, and veterans organizations and their solicitors, and private foundations send the Attorney General a copy of their Form 990-PF. It names no audited, reviewed, or compiled statement or dollar figure for one. The statutes for those registrations were not read.`,
  // https://le.utah.gov/xcode/Title13/Chapter22/13-22-S110.html?v=C13-22-S110_2026050620260506 (and the other sections of
  // chapter 22, part 1, as renumbered effective May 6, 2026); https://commerce.utah.gov/dcp/for-businesses/charities/
  UT: `Read on ${CHECKED}: Utah Code § 13-22-110 (effective May 6, 2026) has a charity that is a nonprofit corporation file its most recent Form 990-series return with the Division of Corporations and Commercial Code each year, and § 13-22-104 registers professional fundraisers and fundraising consultants only. Chapter 22, part 1 names no audited, reviewed, or compiled statement or dollar figure for one.`,
  // https://law.lis.virginia.gov/vacode/title57/chapter5/section57-49/
  VA: `Read on ${CHECKED}: Va. Code § 57-49 accepts a balance sheet and income statement with an independent public accountant’s opinion, a certified statement, or a copy of the Form 990, and sets no dollar figure for audited, reviewed, or compiled statements.`,
  // https://legislature.vermont.gov/statutes/chapter/09/063 and sections 02471 to 02479
  VT: `Read on ${CHECKED}: the charitable solicitations subchapter (9 V.S.A. §§ 2471 to 2479) has paid fundraisers file a notice of solicitation with a bond (§ 2473) and a campaign financial report (§ 2477); no section has a charity register or file its own financial statement. No dollar figure is set for audited, reviewed, or compiled statements.`,
  // https://app.leg.wa.gov/RCW/default.aspx?cite=19.09.075
  WA: `Read on ${CHECKED}: RCW 19.09.075 asks for a solicitation report and the name of whoever prepares, reviews, or audits the financial statement, and sets no dollar figure for audited, reviewed, or compiled statements.`,
  // https://sos.wyo.gov/faqs.aspx?root=BUS (Business Entities, "Do I need to register my out-of-state nonprofit corporation in Wyoming?")
  WY: `Read on ${CHECKED}: the Secretary of State’s business entities questions and answers say Wyoming has no state requirements for charities and fund raisers (a nonprofit corporation from another state may still have to qualify as a foreign corporation). With no charity registration, no dollar figure for audited, reviewed, or compiled statements is set. The statutes were not read.`
};
function gap(code) {
  const read = READ_NO_FIGURE[code];
  if (read !== void 0) return { code, kind: "no-figure", reason: read };
  if (BLOCKED_CODES.includes(code)) return { code, kind: "blocked", reason: BLOCKED };
  return { code, kind: "not-read", reason: NOT_READ };
}
var NP_AUDIT_THRESHOLDS = {
  id: "charity-audit-thresholds",
  label: "state charity financial statement thresholds",
  checkedOn: CHECKED,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: REF_US_STATES_DC.filter((m) => !ROWS.some((r) => r.code === m.code)).map((m) => gap(m.code))
};
function npDollars(c) {
  const text = formatUSD(c);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}
function npBandText(t) {
  const from = `${t.from.inclusive ? "at least" : "more than"} ${npDollars(t.from.cents)}`;
  if (!t.to) return from;
  return `${from} and ${t.to.inclusive ? "not more than" : "less than"} ${npDollars(t.to.cents)}`;
}
function npAuditThresholdRow(code, table = NP_AUDIT_THRESHOLDS) {
  return table.rows.find((r) => r.code === code);
}
function npTierProblems(given) {
  const out = [];
  const tiers = Array.isArray(given) ? given : [];
  if (tiers.length === 0) return ["no bands"];
  tiers.forEach((t, i) => {
    const n = i + 1;
    if (!NP_STATEMENT_LEVELS[t.level]) out.push(`band ${n} names an unknown kind of statement`);
    if (!Number.isSafeInteger(t.from?.cents) || t.from.cents <= 0) out.push(`band ${n} has no lower figure above zero`);
    if (t.to && (!Number.isSafeInteger(t.to.cents) || t.to.cents <= t.from.cents)) out.push(`band ${n}'s upper figure is not above its lower figure`);
    const next = tiers[i + 1];
    if (!next) return;
    if ((NP_STATEMENT_LEVELS[next.level]?.rank ?? 0) <= (NP_STATEMENT_LEVELS[t.level]?.rank ?? 0)) out.push(`band ${n + 1} does not name a fuller statement than band ${n}`);
    if (next.from.cents <= t.from.cents) out.push(`band ${n + 1} does not start above band ${n}`);
    if (!t.to) out.push(`band ${n} has no upper figure but band ${n + 1} follows it`);
    else if (t.to.cents > next.from.cents || t.to.cents === next.from.cents && t.to.inclusive && next.from.inclusive) out.push(`bands ${n} and ${n + 1} overlap`);
  });
  return out;
}
var LOWEST = dollars(1e4);
var HIGHEST = dollars(1e7);
function checkNpAuditThresholdTable(table = NP_AUDIT_THRESHOLDS) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badFigures = [];
  const badOrder = [];
  const badText = [];
  for (const r of rows) {
    const tiers = Array.isArray(r.tiers) ? r.tiers : [];
    const figures = tiers.flatMap((t) => [t.from?.cents, ...t.to ? [t.to.cents] : []]);
    const off = figures.filter((c) => !Number.isSafeInteger(c) || c % 100 !== 0 || c < LOWEST || c > HIGHEST);
    if (off.length) badFigures.push(`${r.code} (${off.map((c) => Number.isSafeInteger(c) ? npDollars(c) : String(c)).join(", ")})`);
    const order = npTierProblems(tiers);
    if (order.length) badOrder.push(`${r.code}: ${order.join("; ")}`);
    const text = [
      typeof r.measure === "string" && r.measure.trim().length >= 6 ? "" : "what it is measured on",
      typeof r.notes === "string" && r.notes.trim().length >= 20 ? "" : "notes",
      typeof r.hasConditions === "boolean" ? "" : "the conditions flag",
      tiers.every((t) => typeof t.accepts === "string" && t.accepts.trim().length >= 6) ? "" : "what each band names"
    ].filter(Boolean);
    if (text.length) badText.push(`${r.code} (no ${text.join(", ")})`);
  }
  checks.that("np-table-figures", "Every figure in the table is a whole-dollar amount between $10,000 and $10,000,000", badFigures.length === 0, `Out of range or not whole dollars: ${badFigures.join("; ")}`);
  checks.that("np-table-bands", "Every row has at least one band, its bands go up in order, and no figure falls in two bands", badOrder.length === 0, badOrder.slice(0, 8).join(" | "));
  checks.that("np-table-text", "Every row says what its figures are measured on, what each band names, and its conditions in a note", badText.length === 0, badText.join("; "));
  return checks.all;
}
function readFigure(figure) {
  assertCents(figure, "figure");
  if (figure < 0) throw new Error("Enter the figure as zero or more.");
  return figure;
}
function compareOne(figure, t) {
  const meetsFrom = t.from.inclusive ? figure >= t.from.cents : figure > t.from.cents;
  const meetsTo = !t.to || (t.to.inclusive ? figure <= t.to.cents : figure < t.to.cents);
  return { tier: t, fromDifference: figure - t.from.cents, meetsFrom, toDifference: t.to ? figure - t.to.cents : null, meetsTo, inBand: meetsFrom && meetsTo };
}
function compareNpAuditThresholds(figure, code, table = NP_AUDIT_THRESHOLDS) {
  readFigure(figure);
  const r = npAuditThresholdRow(code, table);
  if (!r) throw new Error(`${refMemberName(table.members, code)} is not in the table yet.`);
  return compareRow(figure, r, table);
}
function compareRow(figure, r, table) {
  const comparisons = r.tiers.map((t) => compareOne(figure, t));
  const band = comparisons.find((c) => c.inBand)?.tier ?? null;
  const below = comparisons.find((c) => !c.meetsFrom);
  const next = below ? { tier: below.tier, short: below.tier.from.cents - figure } : null;
  const result = { row: r, figure, comparisons, band, next };
  return { ...result, checks: verifyNpAuditThresholds(result, table) };
}
function insideBig(figure, bound, side) {
  const d = side === "from" ? BigInt(figure) - BigInt(bound.cents) : BigInt(bound.cents) - BigInt(figure);
  return d > 0n || d === 0n && bound.inclusive;
}
function verifyNpAuditThresholds(r, table = NP_AUDIT_THRESHOLDS) {
  const checks = new CheckList();
  const tableRow = npAuditThresholdRow(r.row.code, table);
  checks.that(
    "np-row-from-table",
    "The bands compared are the ones in the table row for this state",
    tableRow !== void 0 && tableRow.citation === r.row.citation && JSON.stringify(tableRow.tiers) === JSON.stringify(r.row.tiers) && r.comparisons.length === r.row.tiers.length && r.comparisons.every((c, i) => c.tier === r.row.tiers[i] || JSON.stringify(c.tier) === JSON.stringify(r.row.tiers[i])),
    "The bands or citation in the result differ from the table row"
  );
  const order = npTierProblems(r.row.tiers);
  checks.that("np-tiers-in-order", "The row's bands go up in order and no figure falls in two of them", order.length === 0, order.join("; "));
  const wrongCompare = [];
  const wrongDifference = [];
  r.comparisons.forEach((c, i) => {
    const n = i + 1;
    if (insideBig(r.figure, c.tier.from, "from") !== c.meetsFrom) wrongCompare.push(`band ${n} lower end`);
    const upper = c.tier.to ? insideBig(r.figure, c.tier.to, "to") : true;
    if (upper !== c.meetsTo) wrongCompare.push(`band ${n} upper end`);
    if ((c.meetsFrom && c.meetsTo) !== c.inBand) wrongCompare.push(`band ${n} in or out`);
    if (BigInt(c.tier.from.cents) + BigInt(c.fromDifference) !== BigInt(r.figure)) wrongDifference.push(`band ${n} lower figure`);
    if (c.tier.to ? c.toDifference === null || BigInt(c.tier.to.cents) + BigInt(c.toDifference) !== BigInt(r.figure) : c.toDifference !== null) wrongDifference.push(`band ${n} upper figure`);
  });
  checks.that("np-compare-recomputed", "Each at-or-above or below comparison, worked out again from whole-number differences", wrongCompare.length === 0, `Differs at: ${wrongCompare.join(", ")}`);
  checks.that("np-difference-recomputed", "Each difference added back to the row's figure gives the figure entered", wrongDifference.length === 0, `Does not add back at: ${wrongDifference.join(", ")}`);
  const reached = r.row.tiers.filter((t) => insideBig(r.figure, t.from, "from")).length;
  const top = reached > 0 ? r.row.tiers[reached - 1] : null;
  const counted = top && (!top.to || insideBig(r.figure, top.to, "to")) ? top : null;
  const inBands = r.comparisons.filter((c) => c.inBand).length;
  const sameBand = (a, b) => a === null || b === null ? a === b : JSON.stringify(a) === JSON.stringify(b);
  checks.that(
    "np-band-recomputed",
    "The band found by counting the lower figures reached is the same band, and the figure is in at most one band",
    inBands <= 1 && sameBand(counted, r.band),
    `Counting gives ${counted ? npBandText(counted) : "no band"}; the result gives ${r.band ? npBandText(r.band) : "no band"}`
  );
  const firstBelow = r.row.tiers.find((t) => !insideBig(r.figure, t.from, "from")) ?? null;
  const nextRight = firstBelow === null ? r.next === null : r.next !== null && sameBand(r.next.tier, firstBelow) && BigInt(r.next.short) === BigInt(firstBelow.from.cents) - BigInt(r.figure);
  checks.that("np-next-recomputed", "The distance to the next lower figure not reached, worked out again", nextRight, "The next band or the distance to it differs");
  checks.that(
    "np-row-has-conditions",
    "The source sets these bands with no further condition",
    !(tableRow?.hasConditions ?? r.row.hasConditions),
    "The source attaches conditions the bands alone do not show (see the note for this row)",
    "warning"
  );
  return checks.all;
}
function compareNpAuditThresholdsAll(figure, table = NP_AUDIT_THRESHOLDS) {
  readFigure(figure);
  const results = [...table.rows].sort((a, b) => refMemberName(table.members, a.code).localeCompare(refMemberName(table.members, b.code))).map((r) => compareRow(figure, r, table));
  const checks = [];
  const seen = /* @__PURE__ */ new Map();
  for (const res of results) {
    for (const c of res.checks) {
      const have = seen.get(c.id);
      if (!have) {
        const first = { id: c.id, label: c.label, passed: c.passed, severity: c.severity, ...c.passed ? {} : { detail: res.row.code } };
        seen.set(c.id, first);
        checks.push(first);
      } else if (!c.passed) {
        have.passed = false;
        have.detail = have.detail ? `${have.detail}, ${res.row.code}` : res.row.code;
      }
    }
  }
  for (const c of checks) if (!c.passed) c.detail = c.severity === "warning" ? `Rows with conditions: ${c.detail}` : `Fails for: ${c.detail}`;
  return { figure, results, checks };
}
var BAND_PHRASE = {
  statement: "a band for a financial statement with no accountant’s report named",
  compilation: "a compilation band",
  review: "a review band",
  audit: "an audit band"
};
var LEVEL_ORDER = Object.keys(NP_STATEMENT_LEVELS).sort((a, b) => NP_STATEMENT_LEVELS[a].rank - NP_STATEMENT_LEVELS[b].rank);
var tiersOf = (r) => Array.isArray(r.tiers) ? r.tiers : [];
var inCodeOrder = (codes) => [...codes].sort();
var GAP_KINDS = ["no-figure", "blocked", "not-read"];
function startsFirstWay(rows, level) {
  const starts = [];
  for (const r of rows) {
    const t = tiersOf(r).find((x) => x.level === level);
    if (t && Number.isSafeInteger(t.from?.cents)) starts.push({ code: r.code, cents: t.from.cents, inclusive: t.from.inclusive === true });
  }
  const at = (cents) => ({
    cents,
    moreThan: inCodeOrder(starts.filter((s) => s.cents === cents && !s.inclusive).map((s) => s.code)),
    atLeast: inCodeOrder(starts.filter((s) => s.cents === cents && s.inclusive).map((s) => s.code))
  });
  const figures = starts.map((s) => ({ code: s.code, value: s.cents }));
  const tally = refTally(figures);
  const topCount = tally[0]?.codes.length ?? 0;
  const ends = refExtremes(figures);
  return {
    count: starts.length,
    topCount,
    common: tally.filter((g) => g.codes.length === topCount).map((g) => at(g.value)),
    lowest: ends ? at(ends.min) : null,
    highest: ends ? at(ends.max) : null
  };
}
function startsSecondWay(rows, level) {
  const found = [];
  for (const r of rows) for (const t of tiersOf(r)) if (t.level === level) found.push({ code: r.code, cents: t.from?.cents, inclusive: t.from?.inclusive === true });
  found.sort((a, b) => a.cents < b.cents ? -1 : a.cents > b.cents ? 1 : 0);
  const runs = [];
  for (const s of found) {
    let run = runs[runs.length - 1];
    if (!run || run.cents !== s.cents) {
      run = { cents: s.cents, moreThan: [], atLeast: [] };
      runs.push(run);
    }
    (s.inclusive ? run.atLeast : run.moreThan).push(s.code);
  }
  const size = (g) => g.moreThan.length + g.atLeast.length;
  let topCount = 0;
  for (const g of runs) {
    g.moreThan.sort();
    g.atLeast.sort();
    topCount = Math.max(topCount, size(g));
  }
  return { count: found.length, topCount, common: runs.filter((g) => size(g) === topCount), lowest: runs[0] ?? null, highest: runs[runs.length - 1] ?? null };
}
function factsFirstWay(table, rows) {
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const ofKind = (k) => gaps.filter((g) => g.kind === k).length;
  return {
    coverage: { members: table.members.length, rows: rows.length, noFigure: ofKind("no-figure"), blocked: ofKind("blocked"), notRead: ofKind("not-read"), other: gaps.filter((g) => !GAP_KINDS.includes(g.kind)).length },
    audit: startsFirstWay(rows, "audit"),
    review: startsFirstWay(rows, "review"),
    bands: refTally(rows.map((r) => ({ code: r.code, value: tiersOf(r).map((t) => t.level).join("+") }))).map((g) => ({ levels: g.value, codes: inCodeOrder(g.codes) })),
    conditions: { with: inCodeOrder(rows.filter((r) => r.hasConditions === true).map((r) => r.code)), without: inCodeOrder(rows.filter((r) => r.hasConditions === false).map((r) => r.code)) }
  };
}
function factsSecondWay(table, rows) {
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const coverage = { members: 0, rows: 0, noFigure: 0, blocked: 0, notRead: 0, other: 0 };
  for (const m of table.members) {
    coverage.members += 1;
    if (rows.some((r) => r.code === m.code)) {
      coverage.rows += 1;
      continue;
    }
    switch (gaps.find((g) => g.code === m.code)?.kind) {
      case "no-figure":
        coverage.noFigure += 1;
        break;
      case "blocked":
        coverage.blocked += 1;
        break;
      case "not-read":
        coverage.notRead += 1;
        break;
      default:
        coverage.other += 1;
    }
  }
  const groups = {};
  const withConditions = [];
  const withoutConditions = [];
  for (const r of rows) {
    const levels = LEVEL_ORDER.filter((l) => tiersOf(r).some((t) => t.level === l)).join("+");
    (groups[levels] ??= []).push(r.code);
    (r.hasConditions ? withConditions : withoutConditions).push(r.code);
  }
  const bands = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b)).map((levels) => ({ levels, codes: inCodeOrder(groups[levels]) }));
  return { coverage, audit: startsSecondWay(rows, "audit"), review: startsSecondWay(rows, "review"), bands, conditions: { with: inCodeOrder(withConditions), without: inCodeOrder(withoutConditions) } };
}
function clauses(parts, sep) {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(`${sep} `)}${sep} and ${parts[parts.length - 1]}`;
}
function who(codes, members) {
  return codes.length <= 5 ? refNameList(codes, members) : refCount(codes.length, "state", "states");
}
function subject(codes, members, one, many) {
  if (codes.length <= 5) return `${refNameList(codes, members)} ${codes.length === 1 ? one : many}`;
  return `${codes.length} ${many}`;
}
function startParts(g, members) {
  const money = npDollars(g.cents);
  return [
    { word: "more than", codes: g.moreThan },
    { word: "at least", codes: g.atLeast }
  ].filter((p) => p.codes.length > 0).sort((a, b) => b.codes.length - a.codes.length).map((p) => `${p.word} ${money} in ${who(p.codes, members)}`).join("; ");
}
var startText = (g, members) => `${npDollars(g.cents)} (${startParts(g, members)})`;
function coverageText(c, members) {
  const states = members.filter((m) => m.code !== "DC").length;
  const whole = states === members.length ? `the ${states} states` : `the ${states} states and the District of Columbia`;
  const without = c.noFigure + c.blocked + c.notRead + c.other;
  if (without === 0) return `Of ${whole}, all ${c.rows} have a row.`;
  const kinds = [
    // Some of these were read on an agency page or a list of section titles, not the statute itself; each reason says which.
    [c.noFigure, `${c.noFigure === 1 ? "was" : "were"} looked up on an official source where no dollar figure for audited, reviewed or compiled statements was found (each reason below says what was read)`],
    [c.blocked, `could not be read because ${c.blocked === 1 ? "its official site" : "their official sites"} did not open for the check`],
    [c.notRead, `${c.notRead === 1 ? "has" : "have"} not been read yet`],
    [c.other, `${c.other === 1 ? "has" : "have"} no kind of reason recorded`]
  ];
  const present = kinds.filter(([n]) => n > 0);
  const rowsPart = `Of ${whole}, ${c.rows} ${c.rows === 1 ? "has" : "have"} a row`;
  const [only] = present;
  if (present.length === 1 && only) return `${rowsPart}; the other ${without === 1 ? "one" : without} ${only[1]}.`;
  return `${rowsPart}; of the other ${without}, ${clauses(present.map(([n, words]) => `${n} ${words}`), ",")}.`;
}
function auditCommonText(rowCount, a, members) {
  if (rowCount === 0) return "";
  if (a.count === 0) return `None of the ${rowCount} states with a row has an audit band.`;
  const lead = a.count === rowCount ? `All ${rowCount} states with a row have an audit band` : `${a.count} of the ${rowCount} states with a row ${a.count === 1 ? "has" : "have"} an audit band`;
  if (a.count === 1 && a.lowest) return `${lead}; it starts from ${startText(a.lowest, members)}.`;
  if (a.topCount === 1) return `${lead}; no two of them start it from the same figure.`;
  if (a.common.length === 1) {
    const g = a.common[0];
    return `${lead}; the most common figure it starts from is ${npDollars(g.cents)}, in ${a.topCount} of them (${startParts(g, members)}).`;
  }
  return `${lead}; the most common figures it starts from are ${a.common.map((g) => startText(g, members)).join(" and ")}, in ${a.topCount} of them each.`;
}
function rangeText(level, s, members) {
  const band = BAND_PHRASE[level];
  if (s.count === 0 || !s.lowest || !s.highest) return "";
  if (s.count === 1) return `1 state with a row has ${band}, starting from ${startText(s.lowest, members)}.`;
  if (s.lowest.cents === s.highest.cents) return `Of the ${s.count} states with ${band}, every one starts it from ${startText(s.lowest, members)}.`;
  return `Of the ${s.count} states with ${band}, the lowest figure it starts from is ${startText(s.lowest, members)} and the highest is ${startText(s.highest, members)}.`;
}
function bandsText(rowCount, bands, members) {
  const describe = (levels) => {
    const phrases = (levels ? levels.split("+") : []).map((k) => BAND_PHRASE[k] ?? "a band of an unknown kind");
    if (phrases.length === 0) return "no band";
    return phrases.length === 1 ? `${phrases[0]} only` : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  };
  if (bands.length === 0) return "";
  if (bands.length === 1) return `All ${rowCount} states with a row have ${describe(bands[0].levels)}.`;
  return `Of the ${rowCount} states with a row, ${clauses(
    bands.map((g) => `${subject(g.codes, members, "has", "have")} ${describe(g.levels)}`),
    ";"
  )}.`;
}
function conditionsText(rowCount, c, members) {
  const parts = [
    c.with.length ? `${subject(c.with, members, "has", "have")} conditions in the source that the bands alone do not show (each row’s note says which)` : "",
    c.without.length ? `${subject(c.without, members, "sets its", "set their")} bands with no further condition` : ""
  ].filter(Boolean);
  return parts.length ? `Of the ${rowCount} states with a row, ${parts.join("; ")}.` : "";
}
function npAuditThresholdsFindings(table = NP_AUDIT_THRESHOLDS) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const members = table.members;
  const one = factsFirstWay(table, rows);
  const two = factsSecondWay(table, rows);
  const id = (name) => `${table.id}-${name}`;
  const findings = [
    { id: id("coverage"), text: coverageText(one.coverage, members) },
    { id: id("audit-common"), text: auditCommonText(rows.length, one.audit, members) },
    { id: id("audit-range"), text: rangeText("audit", one.audit, members) },
    { id: id("bands"), text: bandsText(rows.length, one.bands, members) },
    { id: id("review-range"), text: rangeText("review", one.review, members) },
    { id: id("conditions"), text: conditionsText(rows.length, one.conditions, members) }
  ].filter((f) => f.text !== "");
  const checks = new CheckList();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const differ = (a, b) => `First way ${JSON.stringify(a)}; second way ${JSON.stringify(b)}`;
  const range = (s) => ({ count: s.count, lowest: s.lowest, highest: s.highest });
  const common = (s) => ({ count: s.count, topCount: s.topCount, common: s.common });
  const c = one.coverage;
  checks.that(id("coverage"), "The rows and the not-covered entries of each kind, counted again member by member", same(one.coverage, two.coverage), differ(one.coverage, two.coverage));
  const covered = c.rows + c.noFigure + c.blocked + c.notRead;
  checks.that(id("coverage-groups"), "The rows and the three kinds of not-covered entry add up to every member, once each", covered === c.members && c.other === 0, `${c.rows} rows, ${c.noFigure} read with no figure, ${c.blocked} blocked, ${c.notRead} not read and ${c.other} of no known kind, for ${c.members} members`);
  checks.that(id("audit-common"), "The most common figure the audit band starts from, counted again by sorting the figures into runs", same(common(one.audit), common(two.audit)), differ(common(one.audit), common(two.audit)));
  checks.that(id("audit-range"), "The lowest and highest figures the audit band starts from, found again by sorting", same(range(one.audit), range(two.audit)), differ(range(one.audit), range(two.audit)));
  checks.that(id("bands"), "Each row's kinds of band, grouped again by looking for each kind in rank order", same(one.bands, two.bands), differ(one.bands, two.bands));
  const inBands = one.bands.reduce((n, g) => n + g.codes.length, 0);
  checks.that(id("bands-groups"), "The groups of bands add up to the rows", inBands === rows.length, `${inBands} in the groups, ${rows.length} rows`);
  checks.that(id("review-range"), "The lowest and highest figures the review band starts from, found again by sorting", same(range(one.review), range(two.review)), differ(range(one.review), range(two.review)));
  checks.that(id("conditions"), "The rows with and without conditions, sorted again one row at a time", same(one.conditions, two.conditions), differ(one.conditions, two.conditions));
  const sorted = one.conditions.with.length + one.conditions.without.length;
  checks.that(id("conditions-groups"), "The rows with and without conditions add up to the rows", sorted === rows.length, `${one.conditions.with.length} with and ${one.conditions.without.length} without, ${rows.length} rows`);
  return { findings, checks: checks.all };
}

export {
  REF_US_STATES_DC,
  refIsDay,
  refSourceProblem,
  refCheckTable,
  NP_STATEMENT_LEVELS,
  NP_AUDIT_THRESHOLDS,
  npDollars,
  npBandText,
  npAuditThresholdRow,
  npTierProblems,
  checkNpAuditThresholdTable,
  compareNpAuditThresholds,
  verifyNpAuditThresholds,
  compareNpAuditThresholdsAll,
  npAuditThresholdsFindings
};
