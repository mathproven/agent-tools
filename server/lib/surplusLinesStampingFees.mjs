// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  SL_PPM_WHOLE,
  SURPLUS_LINES_TAX_TABLE,
  computeSurplusLinesTax,
  slApplyPpm,
  slPercentText,
  slRow,
  slWithinHalfCent
} from "./surplusLinesTax.mjs";
import {
  REF_US_STATES_DC,
  refCheckTable,
  refIsDay,
  refMemberName
} from "./sourced.mjs";
import {
  CheckList,
  assertCents,
  formatUSD
} from "./money.mjs";

// packages/core/src/insurance/surplusLinesStampingFees.ts
var READ = "2026-11-12";
var READ_2 = "2026-11-20";
var READ_3 = "2026-11-21";
var READ_4 = "2026-11-22";
function src(citation, sourceUrl, checkedOn = READ) {
  return { citation, sourceUrl, checkedOn };
}
function row(code, citation, sourceUrl, s) {
  return {
    code,
    citation,
    sourceUrl,
    checkedOn: s.on ?? READ,
    name: s.name,
    ppm: s.ppm ?? 0,
    flatCents: s.flatCents ?? 0,
    flatMinCents: s.flatMinCents ?? 0,
    flatConditions: s.flatConditions ?? "",
    none: s.none ?? false,
    from: s.from,
    to: s.to ?? null,
    setBy: s.setBy,
    rounding: s.rounding ?? "cent",
    inTaxTable: s.inTaxTable ?? false,
    alsoRead: s.alsoRead ?? [],
    notes: s.notes
  };
}
var AL = "https://aldoi.gov/pdf/legal/Bulletin%202025-06.pdf";
var CA = "https://www.slacal.com/resources/broker-taxes-fees";
var CA_CITE = "Surplus Line Association of California, Broker Taxes and Fees (stamping fee schedule)";
var FL = "https://www.fslso.com/filing/tax-fee-assessment-table";
var FL_CITE = "Florida Surplus Lines Service Office, Tax / Fee / Assessment Table";
var IL = "https://www.slai.org/docs/surplus-line-filing-taxes/remitting-stamping-fees-fee-calculation/";
var IL_CITE = "Surplus Line Association of Illinois, Remitting Stamping Fees: Fee Calculation";
var NY = "https://www.elany.org/docs/default-source/bulletins/stamping-fee-change-09222026.pdf";
var NY_CITE = "Excess Line Association of New York, Bulletin No. 2026-20 (September 20, 2026)";
var TX = "https://www.tdi.texas.gov/orders/documents/20238310.pdf";
var TX_CITE = "Texas Commissioner of Insurance, Official Order No. 2023-8310 (October 31, 2023)";
var TX_SLTX = src("Surplus Lines Stamping Office of Texas, Stamping Fees & Taxes", "https://www.sltx.org/brokers/billing-information/stamping-fees-taxes/");
var WA = "https://surpluslines.org/brokerages/filing-information/taxes-and-fees/";
var WA_CITE = "Surplus Line Association of Washington, Taxes & Fees";
var NC = "https://www.ncsla.com/policy-filing/procedures/taxes-fees/";
var NC_CITE = "North Carolina Surplus Lines Association, Surplus Lines Taxes & Fees";
var NC_DOI = src("North Carolina Department of Insurance, Surplus Lines", "https://www.ncdoi.gov/insurance-industry/form-and-rate-filings/property-and-casualty-pc/surplus-lines", READ_3);
var NC_SET = "The North Carolina Surplus Lines Association, which runs the stamping office under N.C. Gen. Stat. § 58-21-40 (the Department of Insurance names it); the page does not say who sets the rate";
var ROWS = [
  row("AK", "Alaska Stat. § 21.34.190(a)", "https://www.akleg.gov/basis/statutes.asp?media=print&secStart=21.34.190&secEnd=21.34.190", {
    name: "Filing fee",
    ppm: 1e4,
    from: null,
    on: READ_3,
    setBy: "Alaska Stat. § 21.34.190(a), the statute itself; the broker pays it to the Division of Insurance with the quarterly statement",
    alsoRead: [src("Alaska Division of Insurance, Reporting Instructions for Surplus Lines Brokers (revised January 16, 2018)", "https://www.commerce.alaska.gov/web/portals/11/pub/SurplusLines/instructions-sl-brokers%202018.pdf", READ_3)],
    notes: `The statute sets the fee for filing the broker's statement at 1% of gross premium charged less return premiums, paid when the statement is filed, with a late payment fee on top. The Division's instructions list "Tax: 2.7% Filing Fee: 1%", filed quarterly through the NAIC's filing system, and say that on a subscription policy with admitted insurers the filing fee is on all premium while the tax leaves the admitted share out. Neither gives a day the fee began.`
  }),
  row("AL", "Alabama Department of Insurance, Bulletin 2025-06 (October 24, 2025)", AL, {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2026-01-01",
    inTaxTable: true,
    setBy: "The Alabama Department of Insurance, which adopted the SLIP+ for States platform by this bulletin",
    notes: "Policies, and endorsements on policies, effective on or after January 1, 2026 are reported on SLIP+ for States, and each transaction there carries 0.175% of total gross premium as the SLIP+ transaction fee. Endorsements on earlier policies stay on the legacy platform; no fee for them is in the row. This is the fee the tax rates table already carries as Alabama's second charge, so it is not added twice."
  }),
  row("AR", "Arkansas Insurance Department, Bulletin No. 9-2026 (August 5, 2026)", "https://portal.insurance.arkansas.gov/LegalPubsPublic/Documents/Bulletins/Bulletin_9-2026.pdf", {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2027-01-01",
    on: READ_2,
    setBy: "The Arkansas Insurance Department, which adopts the SLIP+ for States platform by this bulletin",
    notes: 'Announced: policies and endorsements effective on or after January 1, 2027 are reported through SLIP+ for States, and each transaction there carries 0.175% as the transaction fee "on remitted funds", beside the 4% tax, paid by ACH debit on a quarterly invoice. Policies and endorsements effective earlier stay on the OPTins platform; no fee for them is in the row.'
  }),
  row("AZ", "Surplus Line Association of Arizona, News & FAQ", "https://www.sla-az.org/news.html", {
    name: "Stamping fee",
    ppm: 2e3,
    from: null,
    on: READ_2,
    setBy: "The Surplus Line Association of Arizona as the Director's contractor; Ariz. Rev. Stat. § 20-167(E) lets the Director allow the contractor to charge it and (G) defines it as a reasonable filing fee, setting no rate",
    alsoRead: [
      src("Surplus Line Association of Arizona, Getting Started (Basics)", "https://www.sla-az.org/html/gettingStarted.html", READ_2),
      src("Ariz. Rev. Stat. § 20-167", "https://www.azleg.gov/ars/20/00167.htm", READ_2)
    ],
    notes: "The Association's FAQ gives 0.2%, payable to the Association and not to the Department of Insurance, invoiced by email when a transaction is filed. Its Getting Started page says the fee is charged on both the premium and the policy fee amounts. Neither page gives the day the rate began."
  }),
  row("CA", CA_CITE, CA, {
    name: "Stamping fee",
    ppm: 2500,
    from: "2020-01-01",
    to: "2022-12-31",
    setBy: "The Stamping Committee of the Surplus Line Association of California, approved by its Board of Directors",
    notes: "The Association's schedule lists 0.25% for January 1, 2020 to December 31, 2022."
  }),
  row("CA", CA_CITE, CA, {
    name: "Stamping fee",
    ppm: 1800,
    from: "2023-01-01",
    setBy: "The Stamping Committee of the Surplus Line Association of California, approved by its Board of Directors",
    notes: "The Association's schedule lists 0.18% from January 1, 2023, with no later entry on the day read. The page describes the fee as a percent of premium and lists no flat charge."
  }),
  row("CO", "SLIP+ for States (Florida Surplus Lines Service Office), Colorado page and FAQs", "https://slipplus.com/states/colorado/", {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2025-01-01",
    on: READ_4,
    setBy: "The Florida Surplus Lines Service Office, which runs SLIP+ for States under its contract with the Colorado Division of Insurance (the Division's Bulletin B-2.10); the pages do not say who sets the rate",
    alsoRead: [
      src("Colorado Division of Insurance, Revised Bulletin No. B-2.10, Non-Admitted Insurance Premium Tax Reporting (reissued March 5, 2026)", "https://doi.colorado.gov/sites/doi/files/documents/Revised%20Bulletin%20B-2.10%20Surplus%20Lines%20Premium%20Tax%20Reporting%20Final_0.pdf", READ_4),
      src("Colorado Division of Insurance, Surplus Lines Information for Agents / Agencies / Producers / Brokers", "https://doi.colorado.gov/surplus-lines-information-for-agents/agencies/producers/brokers", READ_4)
    ],
    notes: "The Division's bulletin says it collects the surplus lines tax through the Florida Surplus Lines Service Office's SLIP+ for States platform for all policies, and endorsements on policies, effective on or after January 1, 2025; the bulletin names no fee, and Colo. Rev. Stat. § 10-5-111(3) (read for the tax rates table) lets the third party running the filing system charge a nominal fee without setting a figure. The platform's FAQs give its transaction fee as 0.175% of gross premium (premium plus taxable policy fees) on every transaction reported there, invoiced quarterly beside the 3% tax, refunded pro rata on return premium and cancellations, and not charged to approved tax-exempt insureds. No fee for earlier policies is in the row."
  }),
  row("FL", FL_CITE, FL, {
    name: "Service office (FSLSO) service fee",
    ppm: 600,
    from: "2020-04-01",
    to: "2026-06-30",
    setBy: "The Florida Surplus Lines Service Office (the table does not say; Fla. Stat. § 626.9325, read for the tax table on October 19, 2026, lets the office set a fee of up to 0.3%)",
    notes: "By policy effective date: 0.06% for April 1, 2020 to June 30, 2026. The same table lists flat EMPA surcharges ($2.00 or $4.00 by coverage code) and Citizens and FHCF assessments now at 0%; those depend on the kind of coverage and are not in the row."
  }),
  row("FL", FL_CITE, FL, {
    name: "Service office (FSLSO) service fee",
    ppm: 300,
    from: "2026-07-01",
    setBy: "The Florida Surplus Lines Service Office (the table does not say; Fla. Stat. § 626.9325, read for the tax table on October 19, 2026, lets the office set a fee of up to 0.3%)",
    notes: "By policy effective date: 0.03% on or after July 1, 2026. The flat EMPA surcharges ($2.00 or $4.00 by coverage code) on the same table depend on the kind of coverage and are not in the row."
  }),
  row("ID", "Surplus Line Association of Idaho, Broker Portal FAQs", "https://slaidaho.atlassian.net/wiki/spaces/ISBPKB/pages/190316545/Broker+Portal+FAQs", {
    name: "Stamping fee",
    ppm: 5e3,
    from: null,
    rounding: "dollar",
    setBy: "The Surplus Line Association of Idaho as the delegated contractor, approved by the Department of Insurance (IDAPA 18.06.06.014.01)",
    alsoRead: [src("IDAPA 18.06.06.014 (Payment of Stamping Fees)", "https://files.dfm.idaho.gov/dfm-admin-website/rules/current/18/180606.pdf")],
    notes: "The Association's FAQ gives 0.5% of taxable premium (broker, policy, inspection, audit and like fees count as taxable premium), rounded to the nearest dollar, and says an endorsement's fee follows the effective date of the original policy; it gives no day the rate began. The rule charges the fee on all premiums and policy fees written on Idaho business, at a rate the delegated contractor sets and the Department approves, and says it is not refunded except as the contractor approves."
  }),
  row("IL", IL_CITE, IL, {
    name: "Stamping fee",
    ppm: 750,
    from: "2019-01-01",
    to: "2022-12-31",
    rounding: "dollar",
    setBy: "The Surplus Line Association of Illinois (the page does not say who sets it)",
    notes: "The Association's chart lists 0.075% for January 1, 2019 to December 31, 2022. Assessed on premium only, rounded to the nearest whole dollar; returns are handled the same way as additional premium."
  }),
  row("IL", IL_CITE, IL, {
    name: "Stamping fee",
    ppm: 400,
    from: "2023-01-01",
    rounding: "dollar",
    setBy: "The Surplus Line Association of Illinois (the page does not say who sets it)",
    notes: "The Association's page gives 0.04% for policies effective January 1, 2023 or later. Assessed on premium only, rounded to the nearest whole dollar; returns are handled the same way as additional premium."
  }),
  row("LA", "Louisiana Department of Insurance, Bulletin 2026-03 (March 3, 2026)", "https://ldi.la.gov/docs/default-source/documents/legaldocs/bulletins/bul2026-03-cur-adoptionofslipforrep.pdf", {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2026-07-01",
    setBy: "The Commissioner of Insurance, by agreement with the Florida Surplus Lines Service Office under Act 79 of 2025, announced in this bulletin",
    notes: "Policies and endorsements effective on or after July 1, 2026 are reported through SLIP+ for States, each transaction with a fee of 0.175% of total gross premium. Endorsements on earlier policies stay on the Department's existing system; no fee for them is in the row."
  }),
  row("MN", "Surplus Lines Association of Minnesota, Instructions for 2026 Semiannual Stamping Fee Report", "https://www.mnsla.com/news/MN%20Stamping%20Fee%20Report%202026.pdf", {
    name: "Stamping fee",
    ppm: 400,
    from: "2016-10-01",
    on: READ_2,
    setBy: "The Association's board of directors (Minn. Stat. § 60A.2085, subd. 7, read for this table on November 12, 2026, says the board sets it and states no rate)",
    notes: "The Association's 2026 instructions give .0004 of the policy premium for all transactions effective on or after October 1, 2016, reported and paid each half year (by August 15 and February 15). A late payment carries a penalty of $250 or 1% of the fees, whichever is greater; the calculator does not add it. No rate for earlier policies was read."
  }),
  row("MS", "Mississippi Surplus Lines Association, Producer Procedures Manual, Section VI: Assessments", "https://www.msla.org/vi-assessments.html", {
    name: "Stamping fee",
    ppm: 2500,
    from: null,
    on: READ_2,
    setBy: "The Mississippi Surplus Lines Association (the page does not say who sets it)",
    alsoRead: [src("Mississippi Surplus Lines Association, Producer Procedures Manual, Section III: Overview of Producer Reporting and Payment Procedures", "https://www.msla.org/iii-overview-of-producer-reporting-payment-procedures.html", READ_2)],
    notes: "The Association's manual gives .25% of the gross policy premium plus any policy fee charged, in addition to the 4% premium tax, due each half year (January 30 and July 30). The same page lists a 3% MWUA fee on gross premium and policy fees; that is a separate assessment and is not in the row or added by the calculator. Neither page gives the day the rate began."
  }),
  row("MT", "Montana Commissioner of Securities and Insurance, Surplus Lines", "https://csimt.gov/insurance/surplus-lines", {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2026-01-01",
    setBy: "The Commissioner's office (the page names no rule for the fee; Mont. Code Ann. § 33-2-321, read for the tax table, caps a stamping fee at 1%)",
    alsoRead: [src("Montana Commissioner of Securities and Insurance, Montana CSI Adopts SLIP+ for Surplus Lines (September 4, 2025)", "https://csimt.gov/wp-content/uploads/2025/09/SLIP-Announcment-to-Producers-1.pdf")],
    notes: "The page says that starting in 2026, when Montana is the home state, filings and payments go through SLIP+, and a transaction fee of 0.175% calculated on the total premium is charged, due quarterly. The office's announcement of September 4, 2025 gives the day: SLIP+ is adopted effective January 1, 2026, for all Montana policies, and endorsements on policies, effective on or after that day; endorsements on earlier policies stay on the old system, and no fee for them is in the row. The 2.5% fire tax on the same page is a tax on the fire part of the premium and is not in the row."
  }),
  row("NC", NC_CITE, NC, {
    name: "Stamping fee",
    ppm: 4e3,
    from: "2017-01-01",
    to: "2022-12-31",
    on: READ_3,
    setBy: NC_SET,
    alsoRead: [NC_DOI],
    notes: "0.4% for new and renewal policies effective January 1, 2017 to December 31, 2022 (the Department's page still gives 0.4%; the Association's page gives both rates by date). The fee is on all premium, insurer-imposed fees, and every endorsement entered in SLIP; fees the broker keeps are not included. An endorsement, audit, installment, cancellation or return takes the rate of the policy's inception date. Business effective before 2017 was filed with the Department."
  }),
  row("NC", NC_CITE, NC, {
    name: "Stamping fee",
    ppm: 3e3,
    from: "2023-01-01",
    on: READ_3,
    setBy: NC_SET,
    alsoRead: [NC_DOI],
    notes: "0.3% for new and renewal policies effective on or after January 1, 2023, on all premium, insurer-imposed fees, and every endorsement entered in SLIP; fees the broker keeps are not included. An endorsement, audit, installment, cancellation or return takes the rate of the policy's inception date. No later rate was listed on the day read."
  }),
  row("NV", "Nev. Admin. Code § 685A.370", "https://www.leg.state.nv.us/division/legal/lawlibrary/NAC/NAC-685A.html", {
    name: "Fee for review of coverage",
    ppm: 4e3,
    from: null,
    setBy: "The Commissioner of Insurance, by regulation (NAC 685A.370; history: added 1996, last amended by R161-06, effective January 1, 2007)",
    notes: "Each member broker pays the nonprofit organization of surplus lines brokers (NRS 685A.075) 0.4% of the amount subject to tax under NRS 685A.180, per policy, within 30 days of its invoice. The section does not say on which day the 0.4% figure began; it was last amended effective January 1, 2007."
  }),
  row("NY", NY_CITE, NY, {
    name: "ELANY stamping fee",
    ppm: 1500,
    from: "2023-01-01",
    to: "2026-12-31",
    setBy: "The ELANY Board of Directors",
    notes: "The bulletin lists 0.15% for policies incepting January 1, 2023 through December 31, 2026, and says the fee on an endorsement is the percentage charged on the original policy."
  }),
  row("NY", NY_CITE, NY, {
    name: "ELANY stamping fee",
    ppm: 1700,
    from: "2027-01-01",
    setBy: "The ELANY Board of Directors (approved the increase; bulletin of September 20, 2026)",
    notes: "Announced: 0.17% for all excess line policies that incept on or after January 1, 2027, and for endorsements on them. The bulletin says the excess line tax stays 3.6%."
  }),
  row("OK", "Oklahoma Insurance Department, Bulletin No. 12-2023 (October 4, 2023)", "https://www.oid.ok.gov/bulletin-no-12-2023/", {
    name: "SLIP+ transaction fee",
    ppm: 1750,
    from: "2024-01-01",
    on: READ_2,
    setBy: "The Insurance Commissioner, who adopted the SLIP platform for surplus lines reporting and payment by this bulletin",
    alsoRead: [src("Oklahoma Insurance Department, Surplus Lines Broker FAQs (February 2, 2026)", "https://www.oid.ok.gov/wp-content/uploads/2026/02/260202_Surplus-Lines-Broker-FAQs.pdf", READ_2)],
    notes: "Policies, and endorsements on policies, effective on or after January 1, 2024 are reported through SLIP and charged the 6% tax and a 0.175% transaction fee (the bulletin calls it the SLAS transaction fee; the FAQs of February 2026 call it the SLIP+ transaction fee). The FAQs say flood coverage is exempt from the tax but still pays the fee, and approved exempt insureds pay neither. Earlier policies and their endorsements stay on OPTins; no fee for them is in the row."
  }),
  row("OR", "Surplus Line Association of Oregon, Tax Calculator (Important Information)", "https://slip.oregonsla.org/PublicPages/Resources/TaxCalculator.aspx", {
    name: "Surplus Lines Service Charge (per policy)",
    flatCents: 1e3,
    flatMinCents: 1e4,
    from: null,
    on: READ_2,
    flatConditions: "the $10.00 is charged on a new or renewal policy, an anniversary billing, or a master certificate, and not on an endorsement",
    setBy: "The Surplus Line Association of Oregon (the page does not say who sets it)",
    notes: "The Association's calculator page gives a flat $10 Surplus Lines Service Charge on a new or renewal policy, an anniversary billing, or a master certificate; none on an endorsement, and none when the pure premium (less fees, charges and taxes) is under $100; no return of it on an endorsement other than a flat cancellation. It says the 2% premium tax and 0.3% State Fire Marshal tax are figured without the service charge. It gives no day the charge began. The State Fire Marshal tax is in the tax rates table as Oregon's second charge."
  }),
  row("PA", "Pennsylvania Surplus Lines Association, Stamping Fee FAQ", "https://www.pasla.org/stampingfee_faq.htm", {
    name: "Stamping fee (per filing)",
    flatCents: 2e3,
    from: "2017-01-01",
    flatConditions: "the $20.00 is for a filing received within 45 days of the effective date; $45.00 applies after that",
    setBy: "The PSLA Board of Directors, yearly, approved by the Pennsylvania Insurance Department (PSLA, Stamping Fee Overview)",
    alsoRead: [src("Pennsylvania Surplus Lines Association, Stamping Fee Overview", "https://www.pasla.org/stampingfee_overview.htm")],
    notes: "A flat $20.00 per filing for placements effective on or after January 1, 2017 whose filing is received within 45 days of the effective date; $45.00 per filing when received after 45 days (not applied by the calculator). Not a percent of premium."
  }),
  row("SD", "South Dakota Division of Insurance, South Dakota Tax Rates for Each Line of Coverage for the Surplus Lines Clearinghouse", "https://dlr.sd.gov/insurance/surplus_lines/documents/single_state_surplus_lines_policies.pdf", {
    name: "Stamping fee or assessments",
    none: true,
    from: null,
    on: READ_2,
    setBy: "The Division of Insurance, whose surplus lines page links this rate sheet for filings made through SLIP+",
    notes: `The Division's rate sheet lists "Stamping Fee or Assessments: None" beside the 2.5% surplus lines tax. The 0.175%, 0.075% and 0.1% figures on the same sheet are fire taxes on part of the premium for some lines of coverage, not fees, and are not in this row. The sheet gives no date.`
  }),
  row("TN", "Tennessee Department of Commerce & Insurance, Surplus Lines Filing Procedures", "https://www.tn.gov/commerce/insurance/types-of-insurance-companies/surplus-lines/filing-procedures.html", {
    name: "Clearinghouse transaction fee",
    ppm: 1750,
    from: null,
    on: READ_4,
    inTaxTable: true,
    setBy: "The Department's filing procedures page, for policies filed through the SLAS Clearinghouse's filing portal; it does not say who sets the rate",
    notes: "The Department's page gives the tax as 5% of gross premium and the SLAS Clearinghouse transaction fee as 0.175% of gross premium, each invoiced at the end of the quarter and paid in the portal. Policies effective before October 1, 2016 are reported to the Department by email instead; the page gives no day the fee began. This is the fee the tax rates table already carries as Tennessee's second charge, so it is not added twice."
  }),
  row("TX", TX_CITE, TX, {
    name: "Stamping fee",
    ppm: 750,
    from: "2021-01-01",
    to: "2023-12-31",
    setBy: "The Texas Department of Insurance, under Tex. Ins. Code § 981.154(b)(5) (at most 0.75% of gross premium), on the stamping office board's recommendation",
    alsoRead: [TX_SLTX],
    notes: "0.075% of gross premium for policies with inception January 1, 2021 to December 31, 2023 (the stamping office's schedule; the order decreased it from this rate)."
  }),
  row("TX", TX_CITE, TX, {
    name: "Stamping fee",
    ppm: 400,
    from: "2024-01-01",
    setBy: "The Texas Department of Insurance, under Tex. Ins. Code § 981.154(b)(5) (at most 0.75% of gross premium), on the stamping office board's recommendation",
    alsoRead: [TX_SLTX],
    notes: "The order decreased the fee to 0.04% of the gross premium of surplus lines contracts beginning January 1, 2024; the stamping office's schedule shows 0.04% for policy inception on or after that day, with no later entry on the day read."
  }),
  row("UT", "Utah Insurance Department, Excess & Surplus Lines Insurance (Utah Admin. Code R590-157)", "https://insurance.utah.gov/licensees/insurers/excess-surplus-lines/", {
    name: "Stamping fee",
    ppm: 1800,
    from: null,
    setBy: "Utah Admin. Code R590-157 (the Department names the rule); the Surplus Line Association of Utah collects it as the stamping office for the Commissioner",
    notes: "The Department's page gives the stamping fee as .0018 of gross premiums (which include all policy fees) less return premiums from cancellations or premium reductions. It gives no day the rate began."
  }),
  row("WA", WA_CITE, WA, {
    name: "Stamping fee",
    ppm: 1e3,
    from: "2011-07-01",
    to: "2024-12-31",
    setBy: "The Surplus Line Association of Washington (the page does not say who sets it)",
    notes: "The page lists .0010 for policies with inception July 1, 2011 and later and .0030 from January 1, 2025; the row ends the 0.10% on December 31, 2024, the day before the next rate. The fee is on the sum of all premiums and fees, and endorsements use the rate in force at the original inception date."
  }),
  row("WA", WA_CITE, WA, {
    name: "Stamping fee",
    ppm: 3e3,
    from: "2025-01-01",
    setBy: "The Surplus Line Association of Washington (the page does not say who sets it)",
    notes: "The page lists .0030 for policies with inception January 1, 2025 and later, on the sum of all premiums and fees; endorsements, renewals, and other transactions use the rate in force at the original inception date."
  }),
  row("WV", "West Virginia Offices of the Insurance Commissioner, West Virginia Surplus Lines Export List (September 16, 2025), Frequently Asked Questions", "https://www.wvinsurance.gov/Portals/0/pdf/company/Surplus_Lines_Export_List_9.16.25.pdf", {
    name: "Stamping fee",
    none: true,
    from: null,
    on: READ_3,
    setBy: "The Offices of the Insurance Commissioner, whose surplus lines export list answers the question",
    notes: `The Commissioner's export list answers "Is there a stamping fee?" with no, West Virginia has no stamping office. Its 4.55% on gross premiums and fees is the tax rates table's figure (88% surplus lines tax and 12% surcharge, both part of that 4.55%), not a fee. The list gives no date for the answer.`
  }),
  row("WY", "Wyoming Department of Insurance, Surplus Lines", "https://doi.wyo.gov/companies/surplus-lines", {
    name: "Clearinghouse transaction fee",
    ppm: 1750,
    from: null,
    setBy: "Approved by the commissioner as a percent of premium (Wyo. Stat. § 26-11-118(j), read for the tax table on October 19, 2026)",
    notes: "The Department's page gives 0.175% of gross premiums less return premiums for all policy transactions. It gives no day the rate began."
  })
];
var notRead = "No official statute, rule, agency page, or stamping office page stating a stamping or filing fee, or that there is none, was found for this state by November 22, 2026.";
var GAPS = REF_US_STATES_DC.filter((m) => !ROWS.some((r) => r.code === m.code)).map((m) => {
  const special = {
    KS: "The Department's Excess & Surplus Lines page (read again November 22, 2026) says SLIP+ charges a transaction fee of 0.175% on all gross premiums but gives no day it began. The platform's own sources disagree on that day: its press release of February 3, 2026 leaves out only policies effective before January 1, 2026, while its Kansas FAQs charge the fee only on policies effective on or after May 1, 2026. A row would apply the fee to policies it may not cover, so none is shown until the Department gives the day. Not read.",
    MI: "Michigan's 0.5% regulatory fee is in the tax rates table as its second charge (Mich. Comp. Laws § 500.1905(3)(d)); no stamping office fee page was read. Not read."
  };
  return { code: m.code, reason: special[m.code] ?? notRead };
});
var STAMPING_FEE_TABLE = {
  id: "surplus-lines-stamping-fees",
  label: "state surplus lines stamping, filing, service, and transaction fees",
  checkedOn: READ_4,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: GAPS,
  officialHosts: [
    // Each of these is the stamping office (or surplus lines service office) its state's law or insurance department
    // names, and the fee was read on its own site, as the job's specification allows. None is a vendor.
    "slacal.com",
    // Surplus Line Association of California
    "fslso.com",
    // Florida Surplus Lines Service Office (Fla. Stat. § 626.921)
    "slai.org",
    // Surplus Line Association of Illinois
    "elany.org",
    // Excess Line Association of New York (N.Y. Ins. Law § 2130)
    "pasla.org",
    // Pennsylvania Surplus Lines Association
    "sltx.org",
    // Surplus Lines Stamping Office of Texas (Tex. Ins. Code ch. 981, subch. D)
    "surpluslines.org",
    // Surplus Line Association of Washington
    // The Surplus Line Association of Idaho's broker knowledge base, hosted on Atlassian under the Association's own
    // space; IDAPA 18.06.06.014 names the Association's role.
    "slaidaho.atlassian.net",
    "sla-az.org",
    // Surplus Line Association of Arizona, the Director's contractor under Ariz. Rev. Stat. § 20-167(E)
    "mnsla.com",
    // Surplus Lines Association of Minnesota (Minn. Stat. § 60A.2085)
    "msla.org",
    // Mississippi Surplus Lines Association, which the Mississippi Insurance Department names as its collector
    "oregonsla.org",
    // Surplus Line Association of Oregon, named by the Division of Financial Regulation (its SLIP is slip.oregonsla.org)
    // SLIP+ for States, the Florida Surplus Lines Service Office's platform; Colorado's Bulletin B-2.10 names the Office
    // as the Division's contractor and the Division's surplus lines page links the platform.
    "slipplus.com",
    "ncsla.com"
    // North Carolina Surplus Lines Association, the stamping office under N.C. Gen. Stat. § 58-21-40, named by the Department
  ]
};
var keyOf = (r) => `${r.code} ${r.from ?? "any date"}`;
function sfFeeText(r) {
  const parts = [r.ppm > 0 ? slPercentText(r.ppm) : "", r.flatCents > 0 ? `${formatUSD(r.flatCents)} per filing` : ""].filter(Boolean);
  return parts.join(" + ") || "none";
}
function sfWindowText(r) {
  if (r.from && r.to) return `${r.from} to ${r.to}`;
  if (r.from) return `${r.from} on`;
  if (r.to) return `to ${r.to}`;
  return "no start day given";
}
function sfRowsFor(code, table = STAMPING_FEE_TABLE) {
  return table.rows.filter((r) => r.code === code).sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
}
function sfCovers(r, day) {
  return (r.from === null || day >= r.from) && (r.to === null || day <= r.to);
}
function sfRowOn(code, day, table = STAMPING_FEE_TABLE) {
  if (!refIsDay(day)) throw new Error(`"${day}" is not a date. Use the form 2026-11-12.`);
  return sfRowsFor(code, table).find((r) => sfCovers(r, day));
}
function sfRowSources(r) {
  return [r, ...Array.isArray(r.alsoRead) ? r.alsoRead : []];
}
function sfCheckTable(table = STAMPING_FEE_TABLE, taxTable = SURPLUS_LINES_TAX_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, keyOf, (r) => Array.isArray(r.alsoRead) ? r.alsoRead : []));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const isWhole = (n, max) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
  const badRates = rows.filter((r) => !isWhole(r.ppm, 1e4) || !isWhole(r.flatCents, 1e5) || !isWhole(r.flatMinCents ?? 0, 1e7) || (r.flatMinCents ?? 0) > 0 && r.flatCents === 0 || (r.none === true ? r.ppm + r.flatCents !== 0 : r.ppm + r.flatCents <= 0)).map(keyOf);
  checks.that("sf-rates", "Every fee is a whole number of parts per million (at most 1%) or a whole number of cents (at most $1,000), above zero except where the source says there is none, and any minimum premium is whole cents on a flat charge", badRates.length === 0, badRates.join("; "));
  const badWindows = [];
  for (const r of rows) {
    if (r.from !== null && !refIsDay(r.from) || r.to !== null && !refIsDay(r.to) || r.from && r.to && r.from > r.to) badWindows.push(keyOf(r));
  }
  for (const code of new Set(rows.map((r) => r.code))) {
    const own = rows.filter((r) => r.code === code);
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        const a = own[i];
        const b = own[j];
        const aFrom = a.from ?? "0000-01-01";
        const bFrom = b.from ?? "0000-01-01";
        const aTo = a.to ?? "9999-12-31";
        const bTo = b.to ?? "9999-12-31";
        if (aFrom <= bTo && bFrom <= aTo) badWindows.push(`${code} windows overlap`);
      }
    }
  }
  checks.that("sf-windows", "Every row covers a real window of policy effective dates, and no two rows for a state overlap", badWindows.length === 0, badWindows.join("; "));
  const noNotes = rows.filter((r) => typeof r.notes !== "string" || r.notes.trim().length < 20 || typeof r.setBy !== "string" || r.setBy.trim().length < 10 || typeof r.name !== "string" || r.name.trim().length < 3).map(keyOf);
  checks.that("sf-notes", "Every row names the fee, says who sets it, and says what it is figured on", noNotes.length === 0, `missing: ${noNotes.join(", ")}`);
  const disagree = [];
  for (const r of rows) {
    const charge = slRow(r.code, taxTable)?.charge ?? null;
    if (r.inTaxTable) {
      if (!charge || charge.ppm !== r.ppm || r.flatCents !== 0) disagree.push(`${r.code}: marked as the tax table's second charge but ${charge ? `the tax table has ${slPercentText(charge.ppm)}` : "the tax table has none"}`);
    } else if (charge && charge.ppm === r.ppm) {
      disagree.push(`${r.code}: the same fee as the tax table's second charge but not marked, so it would be added twice`);
    }
  }
  checks.that("sf-agrees", "Where a fee here is the tax rates table's second charge, the two agree to the digit, and no fee is counted twice", disagree.length === 0, disagree.join("; "));
  return checks.all;
}
function signedPpm(premium, ppm) {
  return premium < 0 ? 0 - slApplyPpm(-premium, ppm) : slApplyPpm(premium, ppm);
}
function sfDollarRounded(premium, ppm) {
  assertCents(premium, "premium");
  const p = BigInt(premium < 0 ? -premium : premium);
  const unit = BigInt(SL_PPM_WHOLE) * 100n;
  const dollars = (p * BigInt(ppm) + unit / 2n) / unit;
  const cents = Number(dollars * 100n);
  return premium < 0 ? 0 - cents : cents;
}
function computeStampingFee(premium, code, effectiveDate, table = STAMPING_FEE_TABLE, taxTable = SURPLUS_LINES_TAX_TABLE) {
  assertCents(premium, "premium");
  if (premium === 0) throw new Error("The premium is zero, so there is nothing to work.");
  const taxRow = slRow(code, taxTable);
  if (!taxRow) throw new Error(`${refMemberName(REF_US_STATES_DC, code)} has no row in the tax rates table, so no tax is applied.`);
  const feeRow = sfRowOn(code, effectiveDate, table) ?? null;
  const sign = premium < 0 ? -1 : 1;
  const one = computeSurplusLinesTax(premium < 0 ? -premium : premium, code, taxTable);
  const tax = one.tax * sign;
  const taxTableCharge = one.charge * sign;
  if (!feeRow) {
    const unread = { code, effectiveDate, premium, taxRow, feeRow, tax, taxTableCharge, percentFee: null, flatFee: null, addedFee: null, dollarFee: null, total: null };
    return { ...unread, checks: [...verifyStampingFee(unread, table, taxTable), ...one.checks.filter((c) => c.id === "sl-rate-conditions")] };
  }
  const percentFee = signedPpm(premium, feeRow.ppm);
  const flatFee = premium > 0 && premium >= (feeRow.flatMinCents ?? 0) ? feeRow.flatCents : 0;
  const addedFee = !feeRow.inTaxTable ? assertCents(percentFee + flatFee, "fee") : 0;
  const dollarFee = feeRow.rounding === "dollar" && feeRow.ppm > 0 ? sfDollarRounded(premium, feeRow.ppm) : null;
  const result = { code, effectiveDate, premium, taxRow, feeRow, tax, taxTableCharge, percentFee, flatFee, addedFee, dollarFee, total: assertCents(tax + taxTableCharge + addedFee, "total") };
  return { ...result, checks: [...verifyStampingFee(result, table, taxTable), ...one.checks.filter((c) => c.id === "sl-rate-conditions")] };
}
function verifyStampingFee(r, table = STAMPING_FEE_TABLE, taxTable = SURPLUS_LINES_TAX_TABLE) {
  const checks = new CheckList();
  const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
  const okPremium = isInt(r.premium) && r.premium !== 0;
  const abs = (v) => v < 0 ? -v : v;
  let expected;
  try {
    expected = sfRowOn(r.code, r.effectiveDate, table);
  } catch {
    expected = void 0;
  }
  const name = refMemberName(REF_US_STATES_DC, r.code);
  if (expected === void 0) {
    checks.that("sf-fee-read", `${name}'s stamping fee has not been read for a policy effective ${r.effectiveDate}, so no fee and no total are shown`, r.feeRow === null, "the result shows a fee the table does not have");
  } else {
    checks.that("sf-fee-read", `${name}'s fee is in the table for a policy effective ${r.effectiveDate}`, r.feeRow !== null, "the result shows no fee although the table has one");
  }
  const sameRow = (a, b) => a === null && b === void 0 || a !== null && b !== void 0 && a.code === b.code && a.ppm === b.ppm && a.flatCents === b.flatCents && a.from === b.from && a.to === b.to && a.inTaxTable === b.inTaxTable && a.citation === b.citation && a.rounding === b.rounding && a.none === b.none && a.flatMinCents === b.flatMinCents;
  checks.that("sf-row-from-table", "The fee used is the table's row in force on the policy effective date", sameRow(r.feeRow, expected) && (r.feeRow === null || sfCovers(r.feeRow, r.effectiveDate)), "the fee row in the result is not the table's row for that date");
  const taxCheck = () => {
    let taxOk = false;
    try {
      const one = computeSurplusLinesTax(abs(r.premium), r.code, taxTable);
      const sign = r.premium < 0 ? -1 : 1;
      taxOk = one.tax * sign === r.tax && one.charge * sign === r.taxTableCharge && r.taxRow.taxPpm === one.row.taxPpm;
    } catch {
      taxOk = false;
    }
    checks.that("sf-tax-from-table", "The tax and second charge are what the tax rates page's calculator gives for this premium and state", taxOk, "the tax or second charge differs from the tax rates table");
  };
  if (r.feeRow === null) {
    taxCheck();
    const blank = [r.percentFee, r.flatFee, r.addedFee, r.dollarFee, r.total].every((v) => v === null);
    checks.that("sf-no-total", "No fee and no total are given for a state whose fee was not read", blank, "the result gives a fee or a total for a state whose fee was not read");
    return checks.all;
  }
  const ppm = r.feeRow.ppm;
  const feeOk = okPremium && isInt(r.percentFee) && isInt(ppm) && (r.percentFee === 0 ? ppm === 0 || slWithinHalfCent(abs(r.premium), ppm, 0) : r.percentFee < 0 === r.premium < 0 && slWithinHalfCent(abs(r.premium), ppm, abs(r.percentFee)));
  checks.that("sf-fee-recomputed", `Percent fee: premium × ${slPercentText(isInt(ppm) && ppm >= 0 ? ppm : 0)}, half a cent rounded up on the premium without its sign (a return keeps its minus sign), checked by cross-multiplying whole numbers`, feeOk, `${isInt(r.percentFee) ? formatUSD(r.percentFee) : String(r.percentFee)} is not premium × rate by the rounding rule`);
  const flatMin = isInt(r.feeRow.flatMinCents) ? r.feeRow.flatMinCents : 0;
  const flatExpected = okPremium && r.premium > 0 && r.premium >= flatMin ? r.feeRow.flatCents : 0;
  const flatLabel = r.feeRow.flatCents ? `Flat charge: ${formatUSD(r.feeRow.flatCents)} per filing${flatMin > 0 ? `, only on a premium of ${formatUSD(flatMin)} or more` : ""}, none on a return premium` : "No flat charge in the row";
  checks.that("sf-flat", flatLabel, r.flatFee === flatExpected, `${String(r.flatFee)} is not the row's flat charge`);
  taxCheck();
  const taxCharge = slRow(r.code, taxTable)?.charge ?? null;
  const twiceOk = r.feeRow.inTaxTable ? taxCharge !== null && taxCharge.ppm === r.feeRow.ppm && r.addedFee === 0 && r.taxTableCharge === r.percentFee : r.percentFee !== null && r.flatFee !== null && r.addedFee === r.percentFee + r.flatFee;
  checks.that("sf-not-twice", "A fee that is the tax rates table's second charge agrees with it to the digit and is not added again; any other fee is added once", twiceOk, "the fee is counted twice, left out, or disagrees with the tax rates table");
  const ints = [r.tax, r.taxTableCharge, r.addedFee, r.total].every(isInt);
  checks.that("sf-total", "Total equals the tax, the second charge, and the added fee, added again in whole-number arithmetic", ints && BigInt(r.tax) + BigInt(r.taxTableCharge) + BigInt(r.addedFee) === BigInt(r.total), ints ? `total ${formatUSD(r.total)}` : "an amount is not a whole number of cents");
  if (r.feeRow?.rounding === "dollar" && r.feeRow.ppm > 0) {
    const d = r.dollarFee;
    const ok = isInt(d) && d % 100 === 0 && okPremium && (() => {
      const twiceExact = 2n * BigInt(abs(r.premium)) * BigInt(r.feeRow.ppm);
      const twiceAmount = 2n * BigInt(abs(d)) * BigInt(SL_PPM_WHOLE);
      const halfDollar = 100n * BigInt(SL_PPM_WHOLE);
      return twiceExact >= twiceAmount - halfDollar && twiceExact < twiceAmount + halfDollar && (d === 0 || d < 0 === r.premium < 0);
    })();
    checks.that("sf-dollar", "The source rounds to the whole dollar: that figure is within half a dollar of the exact fee (halves rounded up)", ok, `${String(d)} is not the fee to the nearest dollar`);
  }
  if (r.feeRow && r.feeRow.none) {
    checks.that("sf-none", "The source says this state has no stamping fee or assessment, so the total is the tax alone", r.addedFee === 0 && r.percentFee === 0 && r.flatFee === 0, "a fee is added for a state whose source says there is none");
  }
  if (r.feeRow && r.feeRow.flatCents > 0 && isInt(r.flatFee) && r.flatFee > 0 && typeof r.feeRow.flatConditions === "string" && r.feeRow.flatConditions.length > 0) {
    checks.that("sf-flat-conditions", "The flat charge applies to this filing", false, `The source says ${r.feeRow.flatConditions}; the calculator cannot tell which kind of filing this is, so check the flat charge against it`, "warning");
  }
  if (r.feeRow && r.feeRow.from === null && !r.feeRow.none) {
    checks.that("sf-no-start-day", "The source gives the day the fee began", false, "The source gives the rate but not the day it began; the row is shown for any effective date, so an earlier policy's rate may differ", "warning");
  }
  if (r.feeRow && r.feeRow.flatCents > 0 && r.premium < 0) {
    checks.that("sf-flat-on-return", "A flat charge applies to this filing", false, "The source does not say whether its flat charge applies to a return premium; none is applied here", "warning");
  }
  return checks.all;
}
function sfListOffer(code, day, table = STAMPING_FEE_TABLE) {
  const r = sfRowOn(code, day, table);
  return r && r.ppm > 0 && r.flatCents === 0 && r.rounding === "cent" && !r.inTaxTable ? r : void 0;
}

export {
  STAMPING_FEE_TABLE,
  sfFeeText,
  sfWindowText,
  sfRowsFor,
  sfCovers,
  sfRowOn,
  sfRowSources,
  sfCheckTable,
  sfDollarRounded,
  computeStampingFee,
  verifyStampingFee,
  sfListOffer
};
