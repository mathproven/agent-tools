// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  parseCivilDate
} from "./calendarDays.mjs";
import {
  CheckList,
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

// packages/core/src/ecommerce/nexusThresholds.ts
var NEXUS_BASIS_LABELS = {
  gross: "Gross",
  retail: "Retail",
  taxable: "Taxable",
  sales: "Sales (no qualifier)"
};
var NEXUS_MARKETPLACE_LABELS = {
  included: "Counted",
  excluded: "Left out",
  "not-stated": "Not stated in the source read"
};
var NEXUS_COMPARISON_WORDS = {
  exceeds: "more than",
  "at-least": "or more"
};
var CHECKED = "2026-10-19";
var CHECKED_2 = "2026-10-20";
function threshold(code, f, citation, sourceUrl, notes, alsoRead = [], checkedOn = CHECKED) {
  return {
    code,
    kind: "threshold",
    salesCents: f.dollars * 100,
    salesTest: f.test,
    transactions: f.transactions ?? null,
    transactionsTest: f.transactionsTest ?? null,
    joiner: f.joiner ?? null,
    basis: f.basis,
    measured: f.measured,
    period: f.period,
    marketplace: f.marketplace,
    transactionsDropped: f.transactionsDropped ?? null,
    citation,
    sourceUrl,
    checkedOn,
    notes,
    alsoRead
  };
}
function noStateTax(code, citation, sourceUrl, notes, checkedOn = CHECKED) {
  return {
    code,
    kind: "no-state-tax",
    salesCents: null,
    salesTest: null,
    transactions: null,
    transactionsTest: null,
    joiner: null,
    basis: null,
    measured: "No statewide sales tax",
    period: "None",
    marketplace: "not-stated",
    transactionsDropped: null,
    citation,
    sourceUrl,
    checkedOn,
    notes,
    alsoRead: []
  };
}
var also = (citation, sourceUrl, checkedOn = CHECKED) => ({ citation, sourceUrl, checkedOn });
var also2 = (citation, sourceUrl) => also(citation, sourceUrl, CHECKED_2);
var PREV_OR_CURRENT = "Previous or current calendar year";
var ROWS = [
  threshold(
    "AL",
    { dollars: 25e4, test: "exceeds", basis: "retail", measured: "Retail sales of tangible personal property sold into Alabama by an out-of-state seller", period: "Previous calendar year", marketplace: "excluded" },
    "Ala. Admin. Code r. 810-6-2-.90.03(1)",
    "https://revenue.alabama.gov/wp-content/uploads/2021/12/810-6-2-.90.03.pdf",
    "The rule copy read is on the Department of Revenue's site, with history through the amendment effective November 23, 2018; the Administrative Code site did not show the rule text when opened. The rule is not enforced for transactions before October 1, 2018. The department's FAQ read the same day counts only retail sales the seller makes directly, leaving out sales for resale under an Alabama resale certificate and sales through a participating marketplace that collects Alabama tax for its sellers.",
    [also2("Alabama Department of Revenue FAQ, Are all remote sellers required to register in Alabama?", "https://www.revenue.alabama.gov/faqs/are-all-remote-sellers-required-to-register-in-alabama/")],
    CHECKED_2
  ),
  noStateTax(
    "AK",
    "Alaska Department of Revenue, Tax Division, Sales and Use Tax page",
    "https://tax.alaska.gov/programs/programs/index.aspx?10002",
    "The page says the State of Alaska currently has no sales and use tax, and that some local jurisdictions impose local sales taxes. This table covers state-level figures only.",
    CHECKED_2
  ),
  threshold(
    "AZ",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross proceeds of sales or gross income from business with Arizona customers, other than sales a marketplace facilitator facilitated", period: PREV_OR_CURRENT, marketplace: "excluded" },
    "A.R.S. § 42-5044(A)(1)(c)",
    "https://www.azleg.gov/ars/42/05044.htm",
    "The $100,000 figure applies for calendar year 2021 and each year after (higher figures applied in 2019 and 2020). Sales of affiliated persons are added together. A seller first passing the figure part-way through a year starts with the first month that begins at least 30 days later."
  ),
  threshold(
    "AR",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "exceeds", joiner: "or", basis: "taxable", measured: "Aggregate sales of tangible personal property, taxable services, digital codes, or specified digital products subject to Arkansas sales or use tax, by total and by number of transactions", period: PREV_OR_CURRENT, marketplace: "excluded" },
    "Ark. Code Ann. § 26-52-111(a), (b), as added by Act 822 of 2019",
    "https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F2019R%2FPublic%2FACT822.pdf",
    `The section reads "exceeding" before both figures. A sale through a marketplace facilitator counts as the facilitator's sale, not the marketplace seller's. The Department of Finance and Administration page read the same day gives the same two figures for the current or previous year.`,
    [also("Arkansas DFA, Remote Sellers and Marketplace Facilitators page", "https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/remote-sellers/")]
  ),
  threshold(
    "CA",
    { dollars: 5e5, test: "exceeds", basis: "sales", measured: "Total combined sales of tangible personal property for delivery in California by the retailer and all persons related to it", period: "Preceding or current calendar year", marketplace: "not-stated" },
    "CDTFA, Use Tax Collection Requirements Based on Sales into California Due to the Wayfair Decision (Rev. & Tax. Code § 6203)",
    "https://cdtfa.ca.gov/industry/wayfair/",
    "The same $500,000 figure applies to district use tax under Rev. & Tax. Code § 7262. Sales of related persons are combined."
  ),
  threshold(
    "CO",
    { dollars: 1e5, test: "exceeds", basis: "retail", measured: "Retail sales of tangible personal property, commodities, and services made into Colorado, taxable or exempt (wholesale sales left out, per the rule)", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "Colorado Department of Revenue, Out-of-State Businesses page",
    "https://tax.colorado.gov/out-of-state-businesses",
    'The page has collection start when retail sales into Colorado exceed $100,000, and words the exemption as sales of less than $100,000 in both the current and previous calendar year; the row keeps "exceed", as does the rule (more than $100,000 in the preceding year, or current-year sales that exceed it). A retailer over the figure in the previous year is covered for the whole current year; one passing it in the current year starts on the first day of the month after the ninetieth day. The rule ties the figure to C.R.S. 39-26-102(3)(c), which was not read. The rule copy read is the version effective August 3, 2023; the Secretary of State lists later versions, which could not be opened from here.',
    [also2("1 CCR 201-4, Rule 39-26-102(3), paragraph (3), Economic Nexus (version effective August 3, 2023)", "https://www.coloradosos.gov/CCR/GenerateRulePdf.do?ruleVersionId=11041")],
    CHECKED_2
  ),
  threshold(
    "CT",
    { dollars: 1e5, test: "at-least", transactions: 200, transactionsTest: "at-least", joiner: "and", basis: "gross", measured: "Gross receipts, and the number of retail sales, from sales of tangible personal property or services from outside Connecticut to destinations in it", period: "Twelve months ended on the September 30 before the monthly or quarterly period", marketplace: "not-stated" },
    "Conn. Gen. Stat. § 12-407(a)(12)(G)",
    "https://www.cga.ct.gov/current/pub/chap_219.htm#sec_12-407",
    "Both figures are needed: gross receipts of at least $100,000 and 200 or more retail sales in the same twelve months."
  ),
  noStateTax(
    "DE",
    "Delaware Division of Revenue, Step 4: Learn About Gross Receipts Taxes",
    "https://revenue.delaware.gov/business-tax-forms/doing-business-in-delaware/step-4-gross-receipts-taxes/",
    "The page says Delaware does not impose a state or local sales tax. The page itself is about Delaware's gross receipts tax, which is a different tax and has no row here.",
    CHECKED_2
  ),
  threshold(
    "DC",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Gross receipts from all retail sales delivered into the District, and the number of separate retail sales delivered there", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "D.C. Code § 47-2001(w)",
    "https://code.dccouncil.gov/us/dc/council/code/sections/47-2001",
    'Part of the definition of "vendor", for a person or retailer with no physical presence in the District.'
  ),
  threshold(
    "FL",
    { dollars: 1e5, test: "exceeds", basis: "taxable", measured: "Sum of the sales prices of taxable remote sales: retail sales of tangible personal property ordered from outside Florida and delivered into Florida", period: "Previous calendar year", marketplace: "not-stated" },
    "Fla. Stat. § 212.0596(1)(b), (2)",
    "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0212/Sections/0212.0596.html",
    "A person making that volume of remote sales is a dealer under chapter 212. Only the previous calendar year is measured."
  ),
  threshold(
    "GA",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Gross revenue from retail sales of tangible personal property delivered electronically or physically into Georgia, and the number of separate retail sales", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "Georgia Department of Revenue, Policy Bulletin SUT-2019-02 (May 7, 2019), issue 5 (O.C.G.A. § 48-8-2)",
    "https://dor.georgia.gov/media/35301/download",
    "The figures apply from January 1, 2020; in 2018 and 2019 the dollar figure was $250,000. The bulletin states the department's position and is not itself law. The department's Out-of-State Sellers page read the same day points remote sellers to this bulletin.",
    [also2("Georgia Department of Revenue, Out-of-State Sellers page", "https://dor.georgia.gov/taxes/sales-use-tax/out-state-sellers")],
    CHECKED_2
  ),
  threshold(
    "HI",
    { dollars: 1e5, test: "at-least", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross income or gross proceeds from property delivered in Hawaii, services used or consumed there, or intangible property used there, and the number of separate transactions", period: "Current or immediately preceding calendar year", marketplace: "not-stated" },
    "HRS § 237-2.5",
    "https://data.capitol.hawaii.gov/hrscurrent/Vol04_Ch0201-0257/HRS0237/HRS_0237-0002_0005.htm",
    "Hawaii's tax is the general excise tax. The section treats a person meeting either figure as engaging in business in the State whether or not it has a physical presence there (L 2018, c 41, for taxable years beginning after December 31, 2017).",
    [],
    CHECKED_2
  ),
  threshold(
    "ID",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Cumulative gross receipts from sales delivered into Idaho", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "Idaho Code § 63-3611(3)(h)",
    "https://legislature.idaho.gov/statutesrules/idstat/Title63/T63CH36/SECT63-3611/",
    "For a retailer without a physical presence in Idaho, on and after June 1, 2019. Such a retailer does not collect local sales taxes under this paragraph."
  ),
  threshold(
    "IL",
    { dollars: 1e5, test: "at-least", basis: "gross", measured: "Cumulative gross receipts from sales of tangible personal property to purchasers in Illinois, made from outside Illinois", period: "Preceding 12 months, checked at the end of each calendar quarter", marketplace: "excluded", transactionsDropped: "2026-01-01" },
    '35 ILCS 105/2, "retailer maintaining a place of business in this State", paragraph (9.1)',
    "https://www.ilga.gov/Documents/legislation/ilcs/documents/003501050K2.htm",
    "From January 1, 2026 only the gross receipts figure applies; the 200-transaction test in paragraph (9) ran through December 31, 2025. Sales through a marketplace facilitator that has certified to the retailer are left out of the retailer's figures."
  ),
  threshold(
    "IN",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue from sales of tangible personal property, digital products, and services delivered into Indiana", period: PREV_OR_CURRENT, marketplace: "not-stated", transactionsDropped: "2024-01-01" },
    "Indiana Department of Revenue, Remote Sellers page (IC 6-2.5-2-1(d))",
    "https://www.in.gov/dor/i-am-a/business-corp/remote-sellers/",
    "The page says that from January 1, 2024 Indiana has only the $100,000 figure; before that, 200 or more separate transactions in the current or prior calendar year was a second test."
  ),
  threshold(
    "IA",
    { dollars: 1e5, test: "at-least", basis: "gross", measured: "Gross revenue from Iowa sales", period: "Immediately preceding or current calendar year", marketplace: "not-stated" },
    "Iowa Code § 423.14A(3)(a)",
    "https://www.legis.iowa.gov/docs/code/423.14A.pdf",
    "Such a retailer is treated as a retailer maintaining a place of business in Iowa from January 1, 2019. Marketplace facilitators have a $100,000 figure of their own in paragraph c."
  ),
  threshold(
    "KS",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Cumulative gross receipts from sales by the retailer to customers in Kansas", period: "Current or immediately preceding calendar year", marketplace: "not-stated" },
    "K.S.A. 79-3702(h)(1)(G)(i)(b)",
    "https://www.ksrevisor.gov/statutes/chapters/ch79/079_037_0002.html",
    "For a retailer with none of the other Kansas connections listed in the definition. A retailer passing the figure in the current year for the first time collects on its sales past $100,000 in that year."
  ),
  threshold(
    "KY",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross receipts from tangible personal property, digital property, or services delivered or provided to purchasers in Kentucky, including retail sales a marketplace provider facilitated for the remote retailer", period: PREV_OR_CURRENT, marketplace: "included" },
    "KRS 139.340(2)(g)",
    "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=58190",
    "The statute text read has the gross receipts figure only. A remote retailer passing it registers and collects no later than the first day of the month at most 60 days after. The Department of Revenue's sales tax page read the same day still describes a 2018 test that also counted 200 or more sales."
  ),
  threshold(
    "LA",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue for sales delivered into Louisiana of tangible personal property, digital products, or services", period: PREV_OR_CURRENT, marketplace: "not-stated", transactionsDropped: "2023-08-01" },
    "La. R.S. 47:301(4)(k)(i)",
    "https://legis.la.gov/Legis/Law.aspx?d=101815",
    `Part of the definition of "dealer", for a person without a physical presence in Louisiana. Act 15 of 2023 struck the 200-transaction test from the paragraph (then numbered (4)(m)); the legislature's page for that bill gives its effective date as August 1, 2023. The Remote Sellers Commission's FAQ read the same day still lists the 200-transaction test.`,
    [
      also2("Act 15 of 2023 (HB 171), enrolled text", "https://legis.la.gov/legis/ViewDocument.aspx?d=1328128"),
      also2("Louisiana Legislature, HB 171 (2023 Regular Session) bill page, effective date", "https://legis.la.gov/legis/BillInfo.aspx?s=23RS&b=HB171&sbi=y")
    ],
    CHECKED_2
  ),
  threshold(
    "ME",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross sales from delivery of tangible personal property or taxable services into Maine", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "36 M.R.S. § 1754-B(1-B)(B)",
    "https://legislature.maine.gov/statutes/36/title36sec1754-B.html",
    "Part of the list of persons, other than casual sellers, who register with the assessor. Marketplace facilitators have a $100,000 figure of their own in the same subsection."
  ),
  threshold(
    "MD",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross revenue from tangible personal property, digital codes, digital products, or taxable services delivered in Maryland, and the number of separate transactions", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "COMAR 03.06.01.33B(5)",
    "https://regs.maryland.gov/us/md/exec/comar/03.06.01.33",
    "Effective from October 1, 2018 under section C of the regulation."
  ),
  threshold(
    "MA",
    { dollars: 1e5, test: "exceeds", basis: "sales", measured: "A remote retailer's sales within Massachusetts, other than sales a marketplace facilitator reports and collects tax on for it", period: "Prior or current taxable year", marketplace: "excluded" },
    "M.G.L. c. 64H, § 34(a), (d)",
    "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64H/Section34",
    "A remote retailer over the figure is subject to registration, collection, and remittance as a vendor. The section measures the prior or current taxable year and has no transaction count. Under subsection (d), sales a marketplace facilitator reports and collects tax on for a remote marketplace seller are not counted as the seller's sales.",
    [],
    CHECKED_2
  ),
  threshold(
    "MI",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross receipts from sales to purchasers in Michigan, and the number of separate transactions into Michigan, including sales through a marketplace facilitator", period: "Previous calendar year", marketplace: "included" },
    "MCL 205.52c(1), (5)",
    "https://legislature.mi.gov/Laws/MCL?objectName=mcl-205-52c",
    "A seller meeting either condition is engaged in the business of making sales at retail in Michigan; the section applies to transactions on or after October 1, 2018. Under subsection (5) a marketplace seller counts its direct sales and its sales through a marketplace facilitator.",
    [],
    CHECKED_2
  ),
  threshold(
    "MN",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Retail sales from outside Minnesota to destinations in it, by total and by number", period: "Prior 12-month period", marketplace: "not-stated" },
    "Minn. Stat. § 297A.66, subd. 1(c)",
    "https://www.revisor.mn.gov/statutes/cite/297A.66",
    "The figures apply to a retailer or marketplace provider without a place of business in Minnesota that also solicits sales in a way listed in paragraph (b), which includes a website reachable from Minnesota."
  ),
  threshold(
    "MS",
    { dollars: 25e4, test: "exceeds", basis: "sales", measured: "Sales into Mississippi", period: "Prior twelve months", marketplace: "not-stated" },
    "Miss. Admin. Code 35.IV.3.09, Rule 100",
    "https://www.sos.ms.gov/adminsearch/ACCode/00000851c.pdf",
    "For sellers without physical presence who are purposefully or systematically exploiting the Mississippi market; the next rule lists examples such as advertising on Mississippi stations. The rule refers to Miss. Code Ann. § 27-67-4(2)(e)."
  ),
  threshold(
    "MO",
    { dollars: 1e5, test: "exceeds", basis: "taxable", measured: "Gross receipts from taxable sales of tangible personal property delivered into Missouri", period: "Previous or current calendar year, checked after each calendar quarter for the 12 months just ended", marketplace: "not-stated" },
    "RSMo § 144.605(2)(e)",
    "https://revisor.mo.gov/main/OneSection.aspx?section=144.605",
    "After each calendar quarter a vendor looks at the twelve months ending with that quarter; the section then sets when collection starts."
  ),
  noStateTax(
    "MT",
    "Montana Department of Revenue, Sales Tax Guidance for Montana Business and Residents",
    "https://revenue.mt.gov/taxes/general-sales-tax",
    "The page says Montana does not have a general sales tax.",
    CHECKED_2
  ),
  threshold(
    "NE",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Total retail sales of property in Nebraska, and the number of separate retail sales transactions", period: PREV_OR_CURRENT, marketplace: "not-stated" },
    "Neb. Rev. Stat. § 77-2701.13(2)",
    "https://nebraskalegislature.gov/laws/statutes.php?statute=77-2701.13",
    "For a retailer without a physical presence in Nebraska that sells through its own website or other digital medium or through a multivendor marketplace platform. The platform has figures of its own in subsection (3)."
  ),
  threshold(
    "NV",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Gross revenue from retail sales of tangible personal property delivered in Nevada, and the number of retail sales delivered there", period: "Immediately preceding or current calendar year", marketplace: "not-stated" },
    "NAC 372.856(1)(c)",
    "https://www.leg.state.nv.us/NAC/NAC-372.html",
    `For a retailer with no physical presence in Nevada and no nexus under the section's other paragraphs. The regulation's words are "greater than $100,000".`
  ),
  noStateTax(
    "NH",
    "RSA 78-E:1, VII (findings and purpose)",
    "https://gc.nh.gov/rsa/html/V/78-E/78-E-1.htm",
    "The statute's finding is that New Hampshire has never enacted a traditional broad-based sales and use tax law. The Department of Revenue Administration's site refused automated reading, so the statute on the legislature's site is the source here.",
    CHECKED_2
  ),
  threshold(
    "NJ",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross revenue from tangible personal property, specified digital products, or taxable services delivered into New Jersey, and the number of separate transactions", period: "Current or prior calendar year", marketplace: "included" },
    "New Jersey Division of Taxation, Remote Sellers page",
    "https://www.nj.gov/treasury/taxation/remotesellers.shtml",
    "For sales on and after November 1, 2018. The page says a remote seller over the threshold that sells only through marketplaces still registers and may ask for non-reporting status, since the marketplace collects on those sales."
  ),
  threshold(
    "NM",
    { dollars: 1e5, test: "at-least", basis: "taxable", measured: "Total taxable gross receipts from sales, leases, and licenses of property and from services sourced to New Mexico", period: "Previous calendar year", marketplace: "not-stated" },
    "New Mexico Taxation and Revenue Department, Determining Nexus page",
    "https://www.tax.newmexico.gov/businesses/determining-nexus/",
    "For a business without physical presence in New Mexico (gross receipts tax). Only the previous calendar year is measured."
  ),
  threshold(
    "NY",
    { dollars: 5e5, test: "exceeds", transactions: 100, transactionsTest: "exceeds", joiner: "and", basis: "gross", measured: "Cumulative gross receipts from sales of property delivered in New York, and the number of those sales", period: "Immediately preceding four quarterly periods ending on the last day of February, May, August, and November", marketplace: "not-stated" },
    "N.Y. Tax Law § 1101(b)(8)(iv)",
    "https://www.nysenate.gov/legislation/laws/TAX/1101",
    "Both figures are needed. Meeting them creates a presumption of regularly or systematically soliciting business in New York, which the clause lets the person rebut."
  ),
  threshold(
    "NC",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross sales from remote sales sourced to North Carolina, including sales as a marketplace seller", period: "Previous or current calendar year", marketplace: "included" },
    "N.C. Gen. Stat. § 105-164.8(b)(9)",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-164.8.html",
    "Marketplace facilitators have a $100,000 figure of their own in subdivision (10). The subdivision read has no transaction count."
  ),
  threshold(
    "ND",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross sales from tangible personal property and other taxable items delivered in North Dakota", period: "Previous or current calendar year", marketplace: "not-stated" },
    "N.D. Cent. Code § 57-39.2-02.2",
    "https://ndlegis.gov/cencode/t57c39-2.pdf",
    "A seller past the figure gets a permit and starts collecting in the following calendar year or 60 days after the figure is passed, whichever is earlier."
  ),
  threshold(
    "OH",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross receipts from tangible personal property for use in Ohio or services whose benefit is realized in Ohio, and the number of separate transactions", period: "Current or preceding calendar year", marketplace: "not-stated" },
    "Ohio Rev. Code § 5741.01(I)(2)(g), (h)",
    "https://codes.ohio.gov/ohio-revised-code/section-5741.01",
    "Substantial nexus is presumed when either figure is reached (division (I)(2))."
  ),
  threshold(
    "OK",
    { dollars: 1e5, test: "at-least", basis: "taxable", measured: "Aggregate sales of products within Oklahoma or delivered there that are subject to sales or use tax", period: "Preceding or current calendar year", marketplace: "excluded" },
    "68 O.S. § 1392(G)",
    "https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=481888",
    "Sales through a marketplace or a referrer's platform on which the facilitator or referrer collects and remits the tax are not counted toward the remote seller's figure."
  ),
  noStateTax(
    "OR",
    "Oregon Department of Revenue, Sales Tax in Oregon page",
    "https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx",
    "The page says Oregon does not have a general sales or use/transaction tax.",
    CHECKED_2
  ),
  threshold(
    "PA",
    { dollars: 1e5, test: "at-least", basis: "sales", measured: "Lease, sale, or delivery of tangible personal property into Pennsylvania, or performance of services for use there", period: "Preceding twelve-month calendar period", marketplace: "not-stated" },
    "Tax Reform Code of 1971 § 201(b)(3.5)(i), added by Act 13 of 2019",
    "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?txtType=PDF&SessYr=2019&SessInd=0&ActNum=0013",
    `Part of the definition of "maintaining a place of business in this Commonwealth"; the statute's words are "at least one hundred thousand dollars". Read in the act as enacted (in effect from July 1, 2019). Under section 237(b)(1.2), added by the same act, a vendor meeting it in a calendar year collects from April 1 of the next year through March 31 of the year after. A marketplace seller selling only through a certifying marketplace facilitator is left out of the license, return, and collection duties; the act does not say whether those sales count toward the seller's own figure.`,
    [],
    CHECKED_2
  ),
  threshold(
    "RI",
    { dollars: 1e5, test: "at-least", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross revenue from tangible personal property, prewritten software, specified digital products, or taxable services delivered into Rhode Island, and the number of separate transactions", period: "Immediately preceding calendar year", marketplace: "not-stated" },
    "R.I. Gen. Laws § 44-18.2-3",
    "https://webserver.rilegislature.gov/Statutes/TITLE44/44-18.2/44-18.2-3.htm",
    "The figures apply to remote sellers, marketplace sellers, marketplace facilitators, and referrers not already collecting. Only the immediately preceding calendar year is measured."
  ),
  threshold(
    "SC",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue from all sales of tangible personal property, products transferred electronically, and services delivered into South Carolina, taxable, exempt, and wholesale alike", period: PREV_OR_CURRENT, marketplace: "included" },
    "SC Revenue Ruling #18-14 (S.C. Code § 12-36-70)",
    "https://dor.sc.gov/sites/dor/files/policies/RR18-14.pdf",
    "Effective for sales on or after November 1, 2018. The ruling's example counts the seller's own goods sold through a marketplace toward the $100,000."
  ),
  threshold(
    "SD",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue from tangible personal property, products transferred electronically, or services delivered into South Dakota", period: "Previous or current calendar year", marketplace: "not-stated" },
    "SDCL 10-64-2",
    "https://sdlegislature.gov/api/Statutes/10-64-2.html",
    "For a seller without a physical presence in South Dakota. The section read has no transaction count."
  ),
  threshold(
    "TN",
    { dollars: 1e5, test: "exceeds", basis: "retail", measured: "Sales to consumers in Tennessee: all retail sales, exempt retail sales included, sales for resale left out", period: "Previous twelve-month period", marketplace: "not-stated" },
    "Tennessee Department of Revenue, Sales and Use Tax Notice #20-14 (July 2020), Public Chapter 759 (2020)",
    "https://www.tn.gov/content/dam/tn/revenue/documents/notices/sales/sales20-14.pdf",
    `From October 1, 2020, for a dealer without a physical presence that regularly or systematically solicits Tennessee consumers; before then the figure was $500,000 under Sales and Use Tax Rule 129. The notice says "exceeded $100,000"; the department's Out-of-State Dealers page read the same day says "$100,000 or more". The row keeps the notice's wording, so exactly $100,000 shows as not past it. A dealer first meeting the figure starts collecting on the first day of the third month after.`,
    [also2("Tennessee Department of Revenue, Marketplace Sellers, Marketplace Facilitators & Out-of-State Dealers page", "https://www.tn.gov/revenue/taxes/sales-and-use-tax/out-of-state-dealers-marketplace-facilitators.html")],
    CHECKED_2
  ),
  threshold(
    "TX",
    { dollars: 5e5, test: "at-least", basis: "gross", measured: "Total Texas revenue: gross revenue from taxable and nontaxable sales of tangible personal property and services into Texas, with separately stated fees, sales for resale, and sales to exempt entities", period: "Preceding twelve calendar months", marketplace: "not-stated" },
    "Texas Comptroller, Remote Sellers page (safe harbor)",
    "https://comptroller.texas.gov/taxes/sales/remote-sellers.php",
    "The page states the safe harbor as total Texas revenue of less than $500,000; its next sentence speaks of exceeding the $500,000 amount. The row keeps the safe-harbor wording, so exactly $500,000 shows as past it. The page says a seller selling only through a certifying marketplace provider does not hold a Texas permit."
  ),
  threshold(
    "UT",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue from tangible personal property, products transferred electronically, or services for use in Utah", period: "Previous or current calendar year", marketplace: "not-stated", transactionsDropped: "2025-07-01" },
    "Utah State Tax Commission, Out-of-State (Remote) Sellers page",
    "https://tax.utah.gov/business/sales-tax/other-sales-tax/out-of-state-remote-sellers/",
    "Before July 1, 2025, 200 or more separate transactions in the previous or current calendar year was a second test, per the page."
  ),
  threshold(
    "VT",
    { dollars: 1e5, test: "at-least", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "sales", measured: "Sales from outside Vermont to destinations in it, by total and by number of individual sales transactions", period: "The 12 months before the monthly period being determined", marketplace: "included" },
    "32 V.S.A. § 9701(9)(F), (K)",
    "https://legislature.vermont.gov/statutes/section/32/233/09701",
    "Paragraph (F) also needs regular, systematic, or seasonal solicitation of sales in Vermont (advertising, catalogs, mail, the internet, and the like). Under paragraph (K) a marketplace seller adds its direct sales and its sales through a marketplace."
  ),
  threshold(
    "VA",
    { dollars: 1e5, test: "exceeds", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "retail", measured: "Gross revenue from retail sales in Virginia, and the number of separate retail sales transactions", period: "Previous or current calendar year", marketplace: "not-stated" },
    "Va. Code § 58.1-612(C)(10), (11)",
    "https://law.lis.virginia.gov/vacode/title58.1/chapter6/section58.1-612/",
    'Sales of commonly controlled persons are added together. Each figure also allows "other minimum amount as may be required by federal law".'
  ),
  threshold(
    "WA",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Cumulative gross receipts from Washington: all of the business's gross income attributed to Washington, not only retail sales", period: "Current or immediately preceding calendar year", marketplace: "not-stated", transactionsDropped: "2019-03-14" },
    "RCW 82.04.067(1)(c)(i), applied to retail sales tax by RCW 82.08.052(2)",
    "https://app.leg.wa.gov/RCW/default.aspx?cite=82.04.067",
    "From January 1, 2020 a seller with substantial nexus under RCW 82.04.067 collects retail sales tax. From October 1, 2018 through December 31, 2019, RCW 82.08.052 also had a test of 200 or more separate transactions; a seller whose duty rested only on that test was relieved of it from March 14, 2019. A marketplace facilitator counts its marketplace sellers' sales toward its own figure (RCW 82.04.067(2)(b)).",
    [also2("RCW 82.08.052(1)(c), (2)", "https://app.leg.wa.gov/RCW/default.aspx?cite=82.08.052")],
    CHECKED_2
  ),
  threshold(
    "WV",
    { dollars: 1e5, test: "at-least", transactions: 200, transactionsTest: "at-least", joiner: "or", basis: "gross", measured: "Gross revenue from West Virginia sales made on the seller's own behalf, and the number of separate transactions", period: "Immediately preceding or current calendar year", marketplace: "not-stated" },
    "W. Va. Code § 11-15A-6b(e)",
    "https://code.wvlegislature.gov/11-15A-6B/",
    "The same figures apply to marketplace facilitators and referrers, counting the sales they make or facilitate for marketplace sellers."
  ),
  threshold(
    "WI",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Annual gross sales into Wisconsin", period: "Previous or current calendar year", marketplace: "not-stated" },
    "Wis. Stat. § 77.51(13gm)",
    "https://docs.legis.wisconsin.gov/statutes/statutes/77.pdf",
    "For an out-of-state retailer without the in-state activities listed in sub. (13g). Paragraphs (b) and (c) say when registration starts after the previous or the current calendar year passes the figure."
  ),
  threshold(
    "WY",
    { dollars: 1e5, test: "exceeds", basis: "gross", measured: "Gross revenue from tangible personal property, admissions, or services delivered into Wyoming", period: "Current or immediately preceding calendar year", marketplace: "not-stated" },
    "W.S. 39-15-501(a)(i)",
    "https://wyoleg.gov/statutes/compress/title39.pdf",
    "Paragraph (a)(ii) of the section is marked repealed (Laws 2024, ch. 67); the section read has no transaction count."
  )
];
var NOT_READ = "Not read from an official state source yet.";
var GAPS = {};
var ECONOMIC_NEXUS_THRESHOLDS = {
  id: "economic-nexus-thresholds",
  label: "remote seller sales tax thresholds by state",
  checkedOn: CHECKED_2,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: REF_US_STATES_DC.filter((m) => !ROWS.some((r) => r.code === m.code)).map((m) => ({ code: m.code, reason: GAPS[m.code] ?? NOT_READ })),
  // oscn.net is the Oklahoma State Courts Network, the Oklahoma judiciary's site, which publishes the Oklahoma Statutes.
  officialHosts: ["oscn.net"]
};
function findNexusRow(code, table = ECONOMIC_NEXUS_THRESHOLDS) {
  return table.rows.find((r) => r.code === code);
}
function nexusSalesText(row) {
  if (row.salesCents === null || row.salesTest === null) return "None";
  return row.salesTest === "exceeds" ? `More than ${formatUSD(row.salesCents)}` : `${formatUSD(row.salesCents)} or more`;
}
function nexusTransactionsText(row) {
  if (row.transactions === null || row.transactionsTest === null) return "None";
  return row.transactionsTest === "exceeds" ? `More than ${row.transactions}` : `${row.transactions} or more`;
}
function nexusJoinerText(row) {
  if (row.kind === "no-state-tax") return "No statewide sales tax";
  if (row.transactions === null) return "Sales test only";
  return row.joiner === "and" ? "Both tests" : "Either test";
}
var DOLLARS_MIN = 1e6;
var DOLLARS_MAX = 1e8;
function checkNexusTable(table = ECONOMIC_NEXUS_THRESHOLDS) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, (r) => r.code, (r) => r.alsoRead ?? []));
  const badFigures = [];
  const badWords = [];
  const isTest = (t) => t === "exceeds" || t === "at-least";
  for (const r of table.rows) {
    if (r.kind === "no-state-tax") {
      if (r.salesCents !== null || r.salesTest !== null || r.transactions !== null || r.transactionsTest !== null || r.joiner !== null || r.basis !== null) badFigures.push(`${r.code} (a no-statewide-tax row carries figures)`);
    } else if (r.kind === "threshold") {
      const s = r.salesCents;
      if (s === null || !Number.isSafeInteger(s) || s % 100 !== 0 || s < DOLLARS_MIN || s > DOLLARS_MAX) badFigures.push(`${r.code} (sales figure ${s} is not a whole-dollar amount from $10,000 to $1,000,000)`);
      if (!isTest(r.salesTest)) badFigures.push(`${r.code} (no wording for the sales test)`);
      if (r.transactions === null) {
        if (r.transactionsTest !== null || r.joiner !== null) badFigures.push(`${r.code} (wording for a transaction test it does not have)`);
      } else {
        if (!Number.isSafeInteger(r.transactions) || r.transactions < 1 || r.transactions > 1e4) badFigures.push(`${r.code} (transaction count ${r.transactions} is not a whole number from 1 to 10,000)`);
        if (!isTest(r.transactionsTest)) badFigures.push(`${r.code} (no wording for the transaction test)`);
        if (r.joiner !== "or" && r.joiner !== "and") badFigures.push(`${r.code} (no word joining the two tests)`);
        if (r.transactionsDropped !== null) badFigures.push(`${r.code} (a transaction count and a date the transaction test ended)`);
      }
      if (r.basis === null || !(r.basis in NEXUS_BASIS_LABELS)) badFigures.push(`${r.code} (no sales basis)`);
    } else {
      badFigures.push(`${r.code} (unknown kind)`);
    }
    for (const [field, text] of [["measured", r.measured], ["period", r.period], ["notes", r.notes]]) {
      if (typeof text !== "string" || text.trim().length < 4) badWords.push(`${r.code} (no ${field})`);
    }
    if (!(r.marketplace in NEXUS_MARKETPLACE_LABELS)) badWords.push(`${r.code} (marketplace value ${String(r.marketplace)})`);
    if (r.transactionsDropped !== null && !refIsDay(r.transactionsDropped)) badWords.push(`${r.code} (transaction test end date ${r.transactionsDropped} is not a real day)`);
  }
  checks.that("nexus-figures", 'Every threshold is a whole-dollar figure in a plausible range, each test keeps its wording, and two tests are joined by "or" or "and"', badFigures.length === 0, badFigures.slice(0, 12).join("; "));
  checks.that("nexus-words", "Every row says which sales are measured, over which period, and what its source says about marketplace sales", badWords.length === 0, badWords.slice(0, 12).join("; "));
  return checks.all;
}
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function nexusLongDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? ""} ${d}, ${y}`;
}
function nexusJoinItems(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function nexusCountWords(count, test) {
  return test === "exceeds" ? `more than ${count}` : `${count} or more`;
}
var NAME_AT_MOST = 5;
function nexusGroupLine(groups) {
  return groups.map(([label, codes]) => `${label}: ${codes.length}${codes.length > 0 && codes.length <= NAME_AT_MOST ? ` (${[...codes].sort().join(", ")})` : ""}`).join("; ");
}
function economicNexusThresholdsFindings(table = ECONOMIC_NEXUS_THRESHOLDS) {
  const { id, members, rows } = table;
  const findings = [];
  const checks = new CheckList();
  const names = (codes) => refNameList(codes, members);
  const named = (codes) => codes.length > 0 && codes.length <= NAME_AT_MOST;
  const who = (codes) => named(codes) ? `${codes.length} (${names(codes)})` : `${codes.length}`;
  const inWho = (codes) => named(codes) ? `in ${names(codes)}` : `in ${codes.length}`;
  const codesOf = (list) => list.map((r) => r.code);
  const allOf = (count) => count === 2 ? "both" : `all ${count}`;
  const badGroups = [];
  const addsUp = (what, parts, whole) => {
    let total = 0;
    for (const p of parts) total += p;
    if (total !== whole) badGroups.push(`${what}: ${parts.join(" + ")} = ${total}, not ${whole}`);
  };
  const own = [];
  for (const m of members) {
    for (const r of rows) {
      if (r.code === m.code) {
        own.push(r);
        break;
      }
    }
  }
  const ownThreshold = [];
  const ownNoTax = [];
  for (const r of own) {
    if (r.kind === "threshold") ownThreshold.push(r);
    else if (r.kind === "no-state-tax") ownNoTax.push(r.code);
  }
  const thresholdRows = rows.filter((r) => r.kind === "threshold");
  const noTaxCodes = codesOf(rows.filter((r) => r.kind === "no-state-tax"));
  const n = rows.length;
  const t = thresholdRows.length;
  addsUp("threshold rows and no-statewide-tax rows", [t, noTaxCodes.length], n);
  {
    const whole = n === members.length;
    const lead = whole ? `All ${n} (the 50 states and the District of Columbia) have a row` : `So far ${n} of the ${members.length} (the 50 states and the District of Columbia) have a row`;
    const k = noTaxCodes.length;
    const rest = k === 0 ? `${allOf(t)} set a sales threshold for remote sellers` : `${t} set a sales threshold for remote sellers, and for ${whole ? "the other " : ""}${who(noTaxCodes)} the state's own source says there is no statewide sales tax`;
    findings.push({ id: "kinds", text: `${lead}: ${rest}.` });
  }
  checks.equal(
    `${id}-kinds`,
    "The rows that set a threshold and those whose source says there is no statewide sales tax, counted a second way",
    `${own.length} rows; ${nexusGroupLine([["with a threshold", codesOf(ownThreshold)], ["no statewide sales tax", ownNoTax]])}`,
    `${n} rows; ${nexusGroupLine([["with a threshold", codesOf(thresholdRows)], ["no statewide sales tax", noTaxCodes]])}`
  );
  const sales = thresholdRows.filter((r) => Number.isSafeInteger(r.salesCents)).map((r) => ({ code: r.code, value: r.salesCents }));
  const tally = refTally(sales);
  const ext = refExtremes(sales);
  addsUp("threshold rows by sales figure", tally.map((g) => g.codes.length), t);
  const top = tally[0];
  const tied = tally.length > 1 && tally[1].codes.length === top?.codes.length;
  if (top && ext) {
    const tag = (v) => v === ext.min && v === ext.max ? "" : v === ext.min ? ", the lowest" : v === ext.max ? ", the highest" : "";
    const item = (g) => `${formatUSD(g.value)} ${named(g.codes) ? `in ${names(g.codes)}` : `in ${g.codes.length} of them`}${tag(g.value)}`;
    const lowToHigh = [...tally].sort((a, b) => a.value - b.value);
    let text;
    if (tally.length === 1) {
      text = `Of the ${t} that set a threshold, ${allOf(t)} put the sales figure at ${formatUSD(top.value)}.`;
    } else if (tied) {
      text = `Of the ${t} that set a threshold, no one sales figure is the most common: ${nexusJoinItems(lowToHigh.map(item))}.`;
    } else {
      const others = lowToHigh.filter((g) => g.value !== top.value);
      const rest = t - top.codes.length;
      const higher = others.every((g) => g.value > top.value);
      const lower = others.every((g) => g.value < top.value);
      const verb = rest === 1 ? "is" : "are";
      const how = higher ? `${verb} higher` : lower ? `${verb} lower` : `${verb}`;
      const topTag = top.value === ext.min ? " and the lowest" : top.value === ext.max ? " and the highest" : "";
      text = `Of the ${t} that set a threshold, ${who(top.codes)} put the sales figure at ${formatUSD(top.value)}, the most common figure${topTag}; the other ${rest} ${how}: ${nexusJoinItems(others.map(item))}.`;
    }
    findings.push({ id: "sales-figure", text });
  }
  {
    const ownBy = /* @__PURE__ */ new Map();
    let ownMin = null;
    let ownMax = null;
    for (const r of ownThreshold) {
      const v = r.salesCents;
      if (v === null || !Number.isSafeInteger(v)) continue;
      const list = ownBy.get(v);
      if (list) list.push(r.code);
      else ownBy.set(v, [r.code]);
      if (ownMin === null || v < ownMin) ownMin = v;
      if (ownMax === null || v > ownMax) ownMax = v;
    }
    const ownValues = [...ownBy.keys()].sort((a, b) => a - b);
    let ownTop = null;
    let ownTopCount = 0;
    let ownTied = false;
    for (const v of ownValues) {
      const c2 = ownBy.get(v).length;
      if (c2 > ownTopCount) {
        ownTop = v;
        ownTopCount = c2;
        ownTied = false;
      } else if (c2 === ownTopCount) {
        ownTied = true;
      }
    }
    const line = (groups, most, tie, lo, hi) => `${nexusGroupLine(groups.map(([v, codes]) => [formatUSD(v), codes]))}; most common ${most === null ? "none" : tie ? "none (tied)" : formatUSD(most)}; lowest ${lo === null ? "none" : formatUSD(lo)}; highest ${hi === null ? "none" : formatUSD(hi)}`;
    checks.equal(
      `${id}-sales-figure`,
      "The sales figures, the most common, the lowest, and the highest, worked out a second way",
      line(ownValues.map((v) => [v, ownBy.get(v)]), ownTop, ownTied, ownMin, ownMax),
      line([...tally].sort((a, b) => a.value - b.value).map((g) => [g.value, g.codes]), top?.value ?? null, tied, ext?.min ?? null, ext?.max ?? null)
    );
  }
  const moreThan = codesOf(thresholdRows.filter((r) => r.salesTest === "exceeds"));
  const orMore = codesOf(thresholdRows.filter((r) => r.salesTest === "at-least"));
  addsUp("sales tests by wording", [moreThan.length, orMore.length], t);
  if (t > 0) {
    const isAre = (codes) => codes.length === 1 ? "is" : "are";
    const text = orMore.length === 0 ? `Of the ${t} sales tests, ${allOf(t)} are worded as more than the figure.` : moreThan.length === 0 ? `Of the ${t} sales tests, ${allOf(t)} are worded as the figure or more.` : `Of the ${t} sales tests, ${who(moreThan)} ${isAre(moreThan)} worded as more than the figure and ${who(orMore)} as the figure or more.`;
    findings.push({ id: "sales-wording", text });
  }
  {
    const ownMore = [];
    const ownOrMore = [];
    for (const r of ownThreshold) {
      if (r.salesTest === "exceeds") ownMore.push(r.code);
      else if (r.salesTest === "at-least") ownOrMore.push(r.code);
    }
    checks.equal(
      `${id}-sales-wording`,
      'The sales tests worded "more than" and "or more", counted a second way',
      nexusGroupLine([["more than", ownMore], ["or more", ownOrMore]]),
      nexusGroupLine([["more than", moreThan], ["or more", orMore]])
    );
  }
  const withCount = thresholdRows.filter((r) => r.transactions !== null);
  const alone = thresholdRows.filter((r) => r.transactions === null);
  const c = withCount.length;
  addsUp("threshold rows with and without a transaction count", [c, alone.length], t);
  const orCodes = codesOf(withCount.filter((r) => r.joiner === "or"));
  const andCodes = codesOf(withCount.filter((r) => r.joiner === "and"));
  addsUp("transaction tests by joining word", [orCodes.length, andCodes.length], c);
  const countTally = refTally(withCount.filter((r) => r.transactionsTest !== null).map((r) => ({ code: r.code, value: nexusCountWords(r.transactions, r.transactionsTest) })));
  addsUp("transaction tests by figure and wording", countTally.map((g) => g.codes.length), c);
  if (t > 0) {
    let text;
    if (c === 0) {
      text = `None of the ${t} that set a threshold also sets a transaction count.`;
    } else {
      const join = andCodes.length === 0 ? `${allOf(c)} join the two tests with "or"` : orCodes.length === 0 ? `${allOf(c)} join the two tests with "and"` : `${who(orCodes)} of those ${c} join the two tests with "or", and ${who(andCodes)} with "and"`;
      text = `Besides the sales figure, ${c === t ? allOf(t) : `${c} of the ${t}`} set a transaction count: ${nexusJoinItems(countTally.map((g) => `${g.value} ${inWho(g.codes)}`))}; ${join}.`;
    }
    findings.push({ id: "transactions", text });
  }
  {
    let ownAlone = 0;
    const ownOr = [];
    const ownAnd = [];
    const ownWords = /* @__PURE__ */ new Map();
    let ownWith = 0;
    for (const r of ownThreshold) {
      if (r.transactions === null) {
        ownAlone += 1;
        continue;
      }
      ownWith += 1;
      if (r.joiner === "or") ownOr.push(r.code);
      else if (r.joiner === "and") ownAnd.push(r.code);
      if (r.transactionsTest === "exceeds" || r.transactionsTest === "at-least") {
        const w = r.transactionsTest === "exceeds" ? `more than ${r.transactions}` : `${r.transactions} or more`;
        const list = ownWords.get(w);
        if (list) list.push(r.code);
        else ownWords.set(w, [r.code]);
      }
    }
    const byWords = (groups) => [...groups].sort((a, b) => a[0].localeCompare(b[0]));
    checks.equal(
      `${id}-transactions`,
      "The transaction counts, their figures, and the word joining each to the sales test, counted a second way",
      `with a count: ${ownWith}; sales figure alone: ${ownAlone}; ${nexusGroupLine([['"or"', ownOr], ['"and"', ownAnd], ...byWords([...ownWords])])}`,
      `with a count: ${c}; sales figure alone: ${alone.length}; ${nexusGroupLine([['"or"', orCodes], ['"and"', andCodes], ...byWords(countTally.map((g) => [g.value, g.codes]))])}`
    );
  }
  const ended = alone.filter((r) => r.transactionsDropped !== null);
  const endedDays = ended.map((r) => r.transactionsDropped).sort();
  if (alone.length > 0) {
    const a = alone.length;
    let text;
    if (ended.length === 0) {
      text = `Of the ${a} that set the sales figure alone, none had a transaction test that the source read says no longer applies.`;
    } else if (ended.length === 1) {
      text = `Of the ${a} that set the sales figure alone, ${who(codesOf(ended))} had a transaction test that the source read says no longer applies from ${nexusLongDay(endedDays[0])}.`;
    } else {
      text = `Of the ${a} that set the sales figure alone, ${who(codesOf(ended))} had a transaction test that the source read says no longer applies, from dates between ${nexusLongDay(endedDays[0])} and ${nexusLongDay(endedDays[endedDays.length - 1])}.`;
    }
    findings.push({ id: "transactions-ended", text });
  }
  {
    let ownAlone = 0;
    const ownEnded = [];
    let first = null;
    let last = null;
    for (const r of ownThreshold) {
      if (r.transactions !== null) continue;
      ownAlone += 1;
      if (r.transactionsDropped === null) continue;
      ownEnded.push(r.code);
      const [y, m, d] = r.transactionsDropped.split("-").map(Number);
      const day = (y ?? 0) * 1e4 + (m ?? 0) * 100 + (d ?? 0);
      if (first === null || day < first) first = day;
      if (last === null || day > last) last = day;
    }
    const iso = (day) => day === null ? "none" : `${String(Math.floor(day / 1e4)).padStart(4, "0")}-${String(Math.floor(day / 100) % 100).padStart(2, "0")}-${String(day % 100).padStart(2, "0")}`;
    checks.equal(
      `${id}-transactions-ended`,
      "The rows whose source says a transaction test no longer applies, and the earliest and latest dates, counted a second way",
      `of ${ownAlone} with the sales figure alone, ${nexusGroupLine([["ended", ownEnded]])}; from ${iso(first)} to ${iso(last)}`,
      `of ${alone.length} with the sales figure alone, ${nexusGroupLine([["ended", codesOf(ended)]])}; from ${endedDays[0] ?? "none"} to ${endedDays[endedDays.length - 1] ?? "none"}`
    );
  }
  const counted = codesOf(thresholdRows.filter((r) => r.marketplace === "included"));
  const leftOut = codesOf(thresholdRows.filter((r) => r.marketplace === "excluded"));
  const notSaid = codesOf(thresholdRows.filter((r) => r.marketplace === "not-stated"));
  addsUp("threshold rows by what the source says about marketplace sales", [counted.length, leftOut.length, notSaid.length], t);
  if (t > 0) {
    const has = (codes) => codes.length === 1 ? "has" : "have";
    const what = "a seller's sales through a marketplace";
    const parts = [];
    if (counted.length > 0) parts.push(`${who(counted)} ${has(counted)} a source that counts ${what} toward the seller's own figure`);
    if (leftOut.length > 0) parts.push(`${who(leftOut)} ${has(leftOut)} a source that ${parts.length ? "leaves those sales out" : `leaves ${what} out of the seller's own figure`}`);
    if (notSaid.length > 0) parts.push(`for ${who(notSaid)} the source read does not say${parts.length ? "" : ` whether ${what} count toward the seller's own figure`}`);
    findings.push({ id: "marketplace", text: `Of the ${t} that set a threshold, ${nexusJoinItems(parts)}.` });
  }
  {
    const ownCounted = [];
    const ownLeftOut = [];
    const ownNotSaid = [];
    for (const r of ownThreshold) {
      if (r.marketplace === "included") ownCounted.push(r.code);
      else if (r.marketplace === "excluded") ownLeftOut.push(r.code);
      else if (r.marketplace === "not-stated") ownNotSaid.push(r.code);
    }
    checks.equal(
      `${id}-marketplace`,
      "What each source says about marketplace sales, counted a second way",
      nexusGroupLine([["counted", ownCounted], ["left out", ownLeftOut], ["not stated", ownNotSaid]]),
      nexusGroupLine([["counted", counted], ["left out", leftOut], ["not stated", notSaid]])
    );
  }
  checks.that(`${id}-groups`, "Every split of the rows in these findings adds up to the rows it splits", badGroups.length === 0, badGroups.join("; "));
  return { findings, checks: checks.all };
}
function parseNexusCount(raw, label = "number of transactions") {
  const s = raw.trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(s)) throw new Error(`The ${label} must be a whole number, like 150 or 1,200.`);
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isSafeInteger(n)) throw new Error(`The ${label} is too large.`);
  return n;
}
function outcome(test, threshold2, comparison, figure) {
  const difference = figure - threshold2;
  return { test, threshold: threshold2, comparison, figure, difference, passed: comparison === "exceeds" ? figure > threshold2 : figure >= threshold2 };
}
function computeNexusThresholds(entries, table = ECONOMIC_NEXUS_THRESHOLDS) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Enter at least one state.");
  if (entries.length > 60) throw new Error("Enter at most 60 states at once.");
  const results = entries.map((entry) => {
    const name = refMemberName(table.members, entry.code);
    const row = findNexusRow(entry.code, table);
    if (!row) throw new Error(`${name} is not in the table yet, so there is no threshold to compare with.`);
    if (row.kind !== "threshold" || row.salesCents === null || row.salesTest === null) throw new Error(`${name}: the state's own source says it has no statewide sales tax, so the table has no threshold to compare with.`);
    if (!Number.isSafeInteger(entry.salesCents) || entry.salesCents < 0) throw new Error(`Sales for ${name} must be zero or more, in dollars and cents.`);
    const tests = [outcome("sales", row.salesCents, row.salesTest, entry.salesCents)];
    if (row.transactions !== null && row.transactionsTest !== null) {
      if (entry.transactions === null) throw new Error(`Enter the number of transactions for ${name}; its row has a transaction test.`);
      if (!Number.isSafeInteger(entry.transactions) || entry.transactions < 0) throw new Error(`The number of transactions for ${name} must be a whole number, zero or more.`);
      tests.push(outcome("transactions", row.transactions, row.transactionsTest, entry.transactions));
    } else if (entry.transactions !== null && (!Number.isSafeInteger(entry.transactions) || entry.transactions < 0)) {
      throw new Error(`The number of transactions for ${name} must be a whole number, zero or more.`);
    }
    const reached = tests.length === 1 ? tests[0].passed : row.joiner === "and" ? tests.every((t) => t.passed) : tests.some((t) => t.passed);
    return { entry: { ...entry }, row, tests, reached };
  });
  const result = { results, reachedCount: results.filter((r) => r.reached).length };
  return { ...result, checks: verifyNexusThresholds(result, table) };
}
function verifyNexusThresholds(r, table = ECONOMIC_NEXUS_THRESHOLDS) {
  const checks = new CheckList();
  const notFromTable = [];
  const badDifference = [];
  const badTest = [];
  const badJoin = [];
  for (const e of r.results) {
    const code = e.entry.code;
    const t = findNexusRow(code, table);
    const same = t !== void 0 && e.row.code === code && t.salesCents === e.row.salesCents && t.salesTest === e.row.salesTest && t.transactions === e.row.transactions && t.transactionsTest === e.row.transactionsTest && t.joiner === e.row.joiner && t.citation === e.row.citation;
    const testsMatchRow = same && e.tests.length === (t.transactions === null ? 1 : 2) && e.tests[0]?.test === "sales" && e.tests[0].threshold === t.salesCents && e.tests[0].comparison === t.salesTest && e.tests[0].figure === e.entry.salesCents && (t.transactions === null || e.tests[1]?.test === "transactions" && e.tests[1].threshold === t.transactions && e.tests[1].comparison === t.transactionsTest && e.tests[1].figure === e.entry.transactions);
    if (!testsMatchRow) notFromTable.push(code);
    let passedCount = 0;
    for (const o of e.tests) {
      const diff = BigInt(o.figure) - BigInt(o.threshold);
      if (diff !== BigInt(o.difference) || o.threshold + o.difference !== o.figure) badDifference.push(`${code} ${o.test}`);
      const second = o.comparison === "exceeds" ? diff > 0n : diff >= 0n;
      if (second !== o.passed) badTest.push(`${code} ${o.test}`);
      if (second) passedCount += 1;
    }
    const needed = e.row.joiner === "and" ? e.tests.length : 1;
    if (passedCount >= needed !== e.reached) badJoin.push(code);
  }
  checks.that("nexus-row-from-table", "Each state's figures were compared with that state's row as the table has it", notFromTable.length === 0, notFromTable.length ? `differs from the table: ${notFromTable.join(", ")}` : void 0);
  checks.that("nexus-difference", "Each difference from the threshold, worked out a second way, adds back to the figure entered", badDifference.length === 0, badDifference.join("; "));
  checks.that("nexus-test-second-way", `Each test, decided a second way from the sign of the difference and the source's wording ("more than" or "or more"), agrees`, badTest.length === 0, badTest.join("; "));
  checks.that("nexus-joined", 'Each result, decided again by counting the tests passed against what "or" or "and" needs, agrees', badJoin.length === 0, badJoin.join(", "));
  const counted = r.results.reduce((n, e) => n + (e.reached ? 1 : 0), 0);
  checks.equal("nexus-count", "The number of states reaching their threshold, counted again", counted, r.reachedCount);
  const seen = /* @__PURE__ */ new Map();
  for (const e of r.results) seen.set(e.entry.code, (seen.get(e.entry.code) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  checks.that("nexus-one-per-state", "Each state is entered once", twice.length === 0, `entered more than once: ${twice.join(", ")}`, "warning");
  return checks.all;
}

export {
  refIsDay,
  NEXUS_BASIS_LABELS,
  NEXUS_MARKETPLACE_LABELS,
  NEXUS_COMPARISON_WORDS,
  ECONOMIC_NEXUS_THRESHOLDS,
  findNexusRow,
  nexusSalesText,
  nexusTransactionsText,
  nexusJoinerText,
  checkNexusTable,
  economicNexusThresholdsFindings,
  parseNexusCount,
  computeNexusThresholds,
  verifyNexusThresholds
};
