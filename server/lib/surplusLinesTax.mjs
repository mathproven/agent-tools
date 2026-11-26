// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  REF_US_STATES_DC,
  refCheckTable,
  refCount,
  refExtremes,
  refLowerMedian,
  refMemberName,
  refNameList,
  refTally
} from "./sourced.mjs";
import {
  CheckList,
  assertCents,
  formatUSD
} from "./money.mjs";

// packages/core/src/insurance/surplusLinesTax.ts
var SL_PPM_WHOLE = 1e6;
var CHECKED = "2026-10-19";
var CHECKED_2 = "2026-10-20";
function src(citation, sourceUrl, checkedOn = CHECKED) {
  return { citation, sourceUrl, checkedOn };
}
function row(code, taxPpm, rateHasConditions, citation, sourceUrl, notes, more = {}) {
  return { code, taxPpm, charge: more.charge ?? null, alsoRead: more.alsoRead ?? [], rateHasConditions, citation, sourceUrl, checkedOn: more.checkedOn ?? CHECKED, notes };
}
var FL = "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0626/Sections/";
var MT = "https://mca.legmt.gov/bills/mca/title_0330/chapter_0020/";
var OR = "https://www.oregonlegislature.gov/bills_laws/ors/ors735.html";
var AL = "https://aldoi.gov/pdf/legal/Bulletin%202025-06.pdf";
var AL_CITE = "Alabama Department of Insurance, Bulletin 2025-06";
var CO = "https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-10.pdf";
var MI = "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-";
var NJ = "https://lis.njleg.state.nj.us/nxt/gateway.dll/statutes/1/11293/";
var TN = "https://www.tn.gov/commerce/insurance/types-of-insurance-companies/surplus-lines/filing-procedures.html";
var TN_CITE = "Tennessee Department of Commerce and Insurance, Surplus Lines Filing Procedures";
var GA_CODE = "https://www.lexisnexis.com/hottopics/gacode";
var TN_CODE = "https://www.lexisnexis.com/hottopics/tncode";
var later = { checkedOn: CHECKED_2 };
var ROWS = [
  row(
    "AL",
    6e4,
    true,
    AL_CITE,
    AL,
    "The Department's bulletin of October 24, 2025 gives the surplus line tax as 6% under § 27-10-31(b). Policies and endorsements effective on or after January 1, 2026 are reported on the filing platform the Department adopted, and each transaction there also carries a transaction fee of 0.175% of total gross premium (the second charge in the row); endorsements on earlier policies stay on the older system. A per-policy broker fee is itemized and taxed too (the Department's FAQ). Ala. Code § 27-10-31(a) sets the same 6%, on direct premiums less return premiums, for Alabama home state insureds.",
    { ...later, charge: { name: "Filing platform transaction fee", ppm: 1750, ...src(AL_CITE, AL, CHECKED_2) }, alsoRead: [
      src("Alabama Department of Insurance, Surplus Line Broker FAQs", "https://aldoi.gov/SurplusLineWeb/PDF/SLBrokerFAQs.pdf", CHECKED_2),
      src("Ala. Code § 27-10-31(a)", "https://alison.legislature.state.al.us/code-of-alabama?section=27-10-31", CHECKED_2)
    ] }
  ),
  row(
    "AK",
    27e3,
    true,
    "Alaska Stat. § 21.34.180(a)",
    "https://www.akleg.gov/basis/statutes.asp?media=print&secStart=21.34.180&secEnd=21.34.180",
    "Tax on the net premium (gross premiums written less return premiums). When Alaska is the home state and the policy also covers risks outside Alaska, the part allocated to other states is computed at their rates and fees. Does not apply to state or local government risks or to aircraft mainly in interstate or foreign commerce."
  ),
  row(
    "AZ",
    3e4,
    false,
    "Ariz. Rev. Stat. § 20-416(C)",
    "https://www.azleg.gov/ars/20/00416.htm",
    "Arizona single-state risks, and multistate risks of insureds whose home state is Arizona (subsections A and B). Gross premiums include policy fees but not stamping fees; returned premiums are not taxed. A stamping fee charged by a contractor under § 20-167(E) is not set as a percent there, so it is not in the row.",
    { alsoRead: [src("Ariz. Rev. Stat. § 20-167(E), (G)", "https://www.azleg.gov/ars/20/00167.htm")] }
  ),
  row(
    "AR",
    4e4,
    false,
    "Arkansas Insurance Department, Surplus Lines Brokers Filing (Ark. Code Ann. § 23-65-301 et seq.)",
    "https://insurance.arkansas.gov/industry-regulation/accounting/surplus-lines-brokers-filing/",
    "The department's filing page gives the surplus lines broker's tax as 4% and points to Ark. Code Ann. § 23-65-301 et seq. The Code section that sets the rate was not opened."
  ),
  row(
    "CA",
    3e4,
    false,
    "Cal. Ins. Code § 1775.5(a)",
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=INS&sectionNum=1775.5",
    "Gross premiums charged less return premiums on business done under the surplus line broker's license in the preceding calendar year, paid by March 1. All nonadmitted insurance placed in one transaction for a California home state insured counts in full (subsection (b)), except that interstate motor transit operations leave out premium charged for operations in other states that tax it. Business under § 1760.5 and the risk finance portion of certain blended finite risk products are left out.",
    later
  ),
  row(
    "CO",
    3e4,
    true,
    "Colo. Rev. Stat. § 10-5-111.5(1)",
    CO,
    "Section 10-5-111 taxes net premiums, leaving out sums collected for federal and other state taxes and examination fees, at the rate in § 10-5-111.5, which presumes the whole tax at 3% is owed to Colorado; for multistate risks with states that share the tax under a compact or agreement, the rate and allocation follow that agreement. A third party running the electronic filing system may charge a nominal fee (§ 10-5-111(3)); no percent is set, so it is not in the row. Read in the legislature's 2024 printout of Title 10.",
    { ...later, alsoRead: [src("Colo. Rev. Stat. § 10-5-111(1)-(3)", CO, CHECKED_2)] }
  ),
  row(
    "CT",
    4e4,
    false,
    "Conn. Gen. Stat. § 38a-743(c)(1)",
    "https://www.cga.ct.gov/current/pub/chap_701d.htm#sec_38a-743",
    "Nonadmitted insurance procured, continued, or renewed on or after July 1, 2011 where Connecticut is the home state: gross premiums, even when the policy also covers risks outside the state."
  ),
  row(
    "DE",
    3e4,
    false,
    "18 Del. C. § 1925(b)",
    "https://delcode.delaware.gov/title18/c019/sc02/index.html",
    "Gross premiums less returned premiums, leaving out sums collected for federal and state taxes and examination fees, where Delaware is the home state. All premium on a policy with risks partly outside Delaware counts as Delaware premium (subsection (c))."
  ),
  row(
    "DC",
    2e4,
    false,
    "D.C. Code § 31-2502.40(a)",
    "https://code.dccouncil.gov/us/dc/council/code/sections/31-2502.40",
    "Gross premiums on all kinds of policies procured by the licensed surplus lines producer, paid twice a year (February 1 and August 1). Policies procured for the District of Columbia government are exempt (subsection (c))."
  ),
  row(
    "FL",
    49400,
    false,
    "Fla. Stat. § 626.932(1)",
    `${FL}0626.932.html`,
    "Premium receipts tax on gross premiums; premium includes policy, inspection, and similar fees but not the service fee (subsection (6)). Does not apply to vessels, cargo, or aircraft written under § 626.917 or to state and local government risks. A service fee of up to 0.3%, as set by the Florida Surplus Lines Service Office, applies under §§ 626.9325 and 626.921(3)(f); the statute sets only the limit, so the fee is not in the row.",
    { alsoRead: [src("Fla. Stat. § 626.9325(1)", `${FL}0626.9325.html`), src("Fla. Stat. § 626.921(3)(f)", `${FL}0626.921.html`)] }
  ),
  row(
    "GA",
    4e4,
    false,
    "Georgia Office of Commissioner of Insurance and Safety Fire, Non-Admitted Insurance Premium Tax FAQs (O.C.G.A. § 33-5-29)",
    "https://oci.georgia.gov/regulatory-filings/premium-tax/non-admitted-insurance/non-admitted-insurance-premium-tax-faqs",
    "The Office's FAQ gives 4% of total premiums written and received by the surplus line broker when Georgia is the home state, citing O.C.G.A. § 33-5-29. Insurance an insured procures directly and risk retention groups are also taxed at 4% under other sections. The FAQ says no fees may be added outside the policy premium. Sections 33-5-29(a) and 33-5-31(a), read on October 20, 2026 in Georgia's public access code (opened from the General Assembly's link), set the same 4%, on premiums less return premiums.",
    { ...later, alsoRead: [src("O.C.G.A. §§ 33-5-29(a), 33-5-31(a)", GA_CODE, CHECKED_2)] }
  ),
  row(
    "HI",
    46800,
    false,
    "Hawaii Insurance Division, Surplus Lines Tax (HRS § 431:8-315)",
    "https://cca.hawaii.gov/ins/surplus-lines-tax/",
    "The Insurance Division's page gives 4.68% as the single rate on all surplus lines insurance for which Hawaii is the home state, effective October 1, 2019, under HRS § 431:8-315. The statute page itself could not be opened in this session."
  ),
  row(
    "ID",
    15e3,
    false,
    "Idaho Code § 41-1229(1)",
    "https://legislature.idaho.gov/statutesrules/idstat/Title41/T41CH12/SECT41-1229/",
    "Tax on premiums, leaving out sums collected for federal and state taxes and examination fees. For property and casualty insurance other than workers' compensation with Idaho as the home state, the whole premium is taxed; other lines are taxed on the part allocable to Idaho (subsection (2))."
  ),
  row(
    "IL",
    35e3,
    true,
    "215 ILCS 5/445(3)(a)(ii)",
    "https://www.ilga.gov/legislation/ilcs/fulltext.asp?DocName=021500050K445",
    "Rate for policies with an effective date of July 1, 2003 or later (3% before that). A fire marshal tax under Section 12 of the Fire Investigation Act also applies to fire insurance (§ 445(3)(b)); its rate is not in this section and is not in the row. Recording fees of the Surplus Line Association of Illinois may also be charged to the insured."
  ),
  row(
    "IN",
    25e3,
    false,
    "Ind. Code § 27-1-15.8-4(a)",
    "https://iga.in.gov/laws/2026/ic/titles/27#27-1-15.8-4",
    "Collected from the insured, in addition to all other charges, fees, and taxes, on all gross premiums of policies the surplus lines producer procured for insureds whose home state is Indiana in the twelve months ending December 31, and remitted by February 1. The declarations page itemizes the taxes, fees, and premiums. Read in the 2026 Indiana Code on the General Assembly's site.",
    later
  ),
  row(
    "IA",
    9250,
    true,
    "Iowa Code § 432.1(3), (4)(h)",
    "https://www.legis.iowa.gov/docs/code/432.1.pdf",
    "Section 515I.3 collects the premium tax provided in § 432.1 on surplus lines insurance where Iowa is the home state. The applicable percent depends on the calendar year: 0.925% for 2026, and 0.9% for 2027 and later years (§ 432.1(4)(i)).",
    { alsoRead: [src("Iowa Code § 515I.3(2)(a)", "https://www.legis.iowa.gov/docs/code/515I.pdf")] }
  ),
  row(
    "KS",
    3e4,
    true,
    "Kan. Stat. Ann. § 40-246c(a)(2)",
    "https://www.ksrevisor.gov/statutes/chapters/ch40/040_002_0046c.html",
    "Paragraph (a)(2) sets 3% of total gross premiums less returned premiums on surplus lines insurance for insureds whose home state is Kansas, starting with the taxable year beginning January 1, 2024; paragraph (a)(1), still printed, sets 6%. The Insurance Department applies 3% to policies effective on or after January 1, 2024 and their endorsements and 6% to earlier policies and their endorsements, and its instructions revised December 2025 assess all 2025 policy types at 3%. Filing late doubles the rate (the instructions).",
    { ...later, alsoRead: [
      src("Kansas Insurance Department, news release of December 8, 2023 on the surplus lines tax reduction", "https://insurance.ks.gov/documents/department/news-releases/Surplus-lines-rate-12-23.pdf", CHECKED_2),
      src("Kansas Insurance Department, Instructions for Online Surplus Lines Statement (revised 12/2025)", "https://insurance.ks.gov/desktop/files/SLTax/SL-Instructions.pdf", CHECKED_2)
    ] }
  ),
  row(
    "KY",
    3e4,
    true,
    "Ky. Rev. Stat. § 304.10-180(1)",
    "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48240",
    "Premiums, assessments, fees, and other charges deemed premium, on surplus lines insurance for insureds whose home state is Kentucky, remitted quarterly; not charged on the premium surcharge, the local government premium tax, or other taxes. Each broker also pays the premium surcharge under KRS 136.392 ($1.80 per $100 of premium on risks in Kentucky; multistate nonadmitted risks are exempt from it under subsection (6)) and the local government premium tax under KRS 91A.080, whose rate depends on the city or county. Neither is in the row.",
    { ...later, alsoRead: [src("Ky. Rev. Stat. § 136.392(1)(a), (6)", "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=50265", CHECKED_2)] }
  ),
  row(
    "LA",
    48500,
    false,
    "La. R.S. 22:439(A)(1)",
    "https://legis.la.gov/Legis/Law.aspx?d=507056",
    "Gross premium, wherever the covered property, risk, or exposure is, on insurance placed through a Louisiana licensed surplus lines broker where Louisiana is the policyholder's home state; reported and paid quarterly. Insurance a policyholder places directly is taxed at the same rate (subsection B). Some public buyers are exempt (subsections C and D). A clearinghouse transaction fee may be set by agreement or rule (subsections E and F); the section sets no rate for it, so it is not in the row.",
    later
  ),
  row(
    "ME",
    3e4,
    false,
    "36 M.R.S. § 2531(2)",
    "https://legislature.maine.gov/statutes/36/title36sec2531.html",
    "Gross direct premiums on nonadmitted insurance where Maine is the home state, except as provided under a multistate agreement (§ 2532). Paid by the surplus lines producer for coverage placed under Title 24-A, chapter 19."
  ),
  row(
    "MD",
    3e4,
    false,
    "Md. Code, Ins. § 3-324(b)",
    "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gin&section=3-324&enactments=false",
    "Premium receipts tax on gross premiums less returned premiums. For policies effective on or after July 21, 2011 with Maryland as the home state, on the entire premium. Does not apply to risks of the State or its political subdivisions."
  ),
  row(
    "MA",
    4e4,
    false,
    "Mass. Gen. Laws ch. 175, § 168(d)(2)",
    "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXXII/Chapter175/Section168",
    "The section calls it a fee: gross premiums less gross return premiums, on risks in Massachusetts or any other state when the home state is Massachusetts, paid with the annual sworn statement."
  ),
  row(
    "MI",
    2e4,
    false,
    "Mich. Comp. Laws § 500.1905(3)(d)",
    `${MI}500-1905`,
    "A surplus lines licensee files a sworn statement each February 15 and August 15 of the charges for insurance procured or placed under the license, less amounts returned on canceled insurance, and pays the 2% tax on premiums written plus a 0.5% regulatory fee on premiums written (required by section 451, in place of the commissioner's costs and expenses; the second charge in the row). The section, last amended effective March 1, 2002, says nothing about the home state. Insurance an insured procures directly carries the same 2% and 0.5% under § 500.1951.",
    { ...later, charge: { name: "Regulatory fee", ppm: 5e3, ...src("Mich. Comp. Laws § 500.1905(3)(d)", `${MI}500-1905`, CHECKED_2) }, alsoRead: [src("Mich. Comp. Laws § 500.1951", `${MI}500-1951`, CHECKED_2)] }
  ),
  row(
    "MN",
    3e4,
    false,
    "Minn. Stat. § 297I.05, subd. 5(a)",
    "https://www.revisor.mn.gov/statutes/cite/297I.05",
    "Gross premiums less return premiums paid by an insured whose home state is Minnesota; the whole premium is taxable with no allocation to other states (subd. 5(c)). Insurance an insured procures directly from a nonadmitted insurer is taxed at 2% under subd. 5(b)."
  ),
  row(
    "MS",
    4e4,
    false,
    "Mississippi Insurance Department, Quarterly Reporting Form for All Premium Taxes",
    "https://www.mid.ms.gov/wp-content/uploads/2023/04/retentionpurchasinggroupreporting.pdf",
    "The Department's quarterly premium tax form for risk retention and risk purchasing groups lists a 4% tax for surplus lines on total premiums, with a 3% nonadmitted policy fee on the same line; the form does not say what that fee is figured on, so it is not in the row. The Department's company filing page says surplus lines premium taxes are collected by the Mississippi Surplus Lines Association. The Code section itself was not read.",
    { ...later, alsoRead: [src("Mississippi Insurance Department, Company Annual Filing, Licensing, and Registration Requirements", "https://www.mid.ms.gov/mississippi-insurance-department/companies/company-filing-and-registration/", CHECKED_2)] }
  ),
  row(
    "MO",
    5e4,
    false,
    "Mo. Rev. Stat. § 384.059.1",
    "https://revisor.mo.gov/main/OneSection.aspx?section=384.059",
    "Net premium: gross charges for surplus lines insurance, leaving out sums collected for federal, state, and local taxes, less returned premiums, on risks in Missouri. Paid before April 16 each year."
  ),
  row(
    "MT",
    27500,
    true,
    "Mont. Code Ann. § 33-2-705(2)(a)",
    `${MT}part_0070/section_0050/0330-0020-0070-0050.html`,
    "Section 33-2-311 computes the surplus lines tax the same way as § 33-2-705 does for authorized insurers, whose general rate is 2.75% (0.75% for legal professional liability insurance). A stamping fee of up to 1% may be set by the commissioner by rule under § 33-2-321; the rule was not read, so the fee is not in the row.",
    { alsoRead: [src("Mont. Code Ann. § 33-2-311(1)", `${MT}part_0030/section_0110/0330-0020-0030-0110.html`), src("Mont. Code Ann. § 33-2-321(1)", `${MT}part_0030/section_0210/0330-0020-0030-0210.html`)] }
  ),
  row(
    "NE",
    3e4,
    false,
    "Neb. Rev. Stat. § 44-5506(2)(b)",
    "https://nebraskalegislature.gov/laws/statutes.php?statute=44-5506",
    "Total gross premiums less return premiums where Nebraska is the home state, on insurance covering properties, risks, or exposures in the United States."
  ),
  row(
    "NV",
    35e3,
    true,
    "NRS 680B.027(1)",
    "https://www.leg.state.nv.us/NRS/NRS-680B.html",
    "NRS 685A.180 taxes surplus lines coverage where Nevada is the home state at the rate imposed on similar coverage written by authorized insurers; NRS 680B.027 sets that general rate at 3.5%, with exceptions it lists. Premium includes the fees named in 685A.180(3). A filing fee of the brokers' nonprofit organization (NRS 685A.075) is approved by the Commissioner and not set as a percent there.",
    { alsoRead: [src("NRS 685A.180(1)", "https://www.leg.state.nv.us/NRS/NRS-685A.html")] }
  ),
  row(
    "NH",
    3e4,
    false,
    "N.H. Rev. Stat. § 405:29, I",
    "https://www.gencourt.state.nh.us/rsa/html/XXXVII/405/405-mrg.htm",
    "Gross premiums charged less return premiums on insurance placed under the license, paid with the sworn statement due January 31."
  ),
  row(
    "NJ",
    5e4,
    false,
    "New Jersey Department of Banking and Insurance, Bulletin No. 09-21 (N.J.S.A. 17:22-6.59, 17:22-6.64)",
    "https://www.nj.gov/dobi/bulletins/blt09_21.pdf",
    "The bulletin of July 1, 2009 (still linked on the Department's surplus lines page) reports the rise from 3% to 5%. N.J.S.A. 17:22-6.59 sets 5% of gross premiums less return premiums, collected from the insured, on the total United States premium when New Jersey is the home state; on fire insurance 3% goes to the New Jersey State Firemen's Association and 2% to the State. State, county, and municipal risks are exempt. Insurance an insured procures directly is also taxed at 5% (17:22-6.64).",
    { ...later, alsoRead: [
      src("New Jersey Department of Banking and Insurance, Surplus Lines page", "https://www.nj.gov/dobi/division_insurance/sleo.htm", CHECKED_2),
      src("N.J.S.A. 17:22-6.59", `${NJ}13179?f=templates$fn=document-frameset.htm$3.0`, CHECKED_2),
      src("N.J.S.A. 17:22-6.64", `${NJ}13184?f=templates$fn=document-frameset.htm$3.0`, CHECKED_2)
    ] }
  ),
  row(
    "NM",
    30030,
    true,
    "NMSA 1978, § 7-40-3(A), (D)",
    "https://nmonesource.com/nmos/nmsa/en/item/4340/index.do",
    "Subsection D applies the premium tax of subsection A, 3.003%, to a surplus lines broker's gross premiums less return premiums where New Mexico is the insured's home state, on the whole premium even when only part of the risk is in New Mexico. Gross premiums include policy, risk purchasing group, and inspection fees, but not taxes, regulatory authority fees, or examination fees. The rate comes from the general premium tax section, which also sets other taxes. NMSA § 59A-14-12 is shown as repealed in the current compilation.",
    later
  ),
  row(
    "NY",
    36e3,
    false,
    "N.Y. Ins. Law § 2118(d)(1)",
    "https://www.nysenate.gov/legislation/laws/ISC/2118",
    "Gross premiums charged where New York is the home state. Part of what is paid (an amount equal to 3% of fire insurance premiums) is distributed under § 9105; that is a share of the 3.6%, not a further charge. The section states no stamping fee rate."
  ),
  row(
    "NC",
    5e4,
    false,
    "N.C. Gen. Stat. § 58-21-85(a)",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-21-85.html",
    "Premium receipts tax on gross premiums less return premiums where North Carolina is the home state. Does not apply to risks of State agencies or of local government risk pools (subsection (c))."
  ),
  row(
    "ND",
    17500,
    false,
    "N.D. Cent. Code § 26.1-44-03.1(1)",
    "https://ndlegis.gov/cencode/t26-1c44.pdf",
    "Gross premiums plus assessments and membership, subscriber, policy, and service fees, less return premiums, where North Dakota is the home state."
  ),
  row(
    "OH",
    5e4,
    false,
    "Ohio Rev. Code § 3905.36(B)",
    "https://codes.ohio.gov/ohio-revised-code/section-3905.36",
    "Gross premiums less return premiums for insurance placed under a surplus lines license, collected from the insured when the policy is delivered. Insurance procured directly from an unauthorized insurer is also taxed at 5% under division (A)."
  ),
  row(
    "OK",
    6e4,
    false,
    "36 Okla. Stat. § 1115(A), (B)",
    "https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=86409",
    "Total gross premiums less return premiums on broker-procured surplus lines insurance where Oklahoma is the home state, whether the risks are inside or outside Oklahoma. Independently procured insurance is also taxed at 6% (subsection (C))."
  ),
  row(
    "OR",
    2e4,
    false,
    "Or. Rev. Stat. § 735.470(1)(a)",
    OR,
    "Gross amount of premiums received on Oregon home state risks. The licensee also pays a tax of 0.3% of the premium or fees charged, for the Department of the State Fire Marshal (subsection (1)(b)); both are collected from the insured.",
    { charge: { name: "State Fire Marshal tax", ppm: 3e3, ...src("Or. Rev. Stat. § 735.470(1)(b)", OR) } }
  ),
  row(
    "PA",
    3e4,
    false,
    "Insurance Company Law of 1921, § 1621(a) (40 P.S. § 991.1621)",
    "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?txtType=PDF&SessYr=1921&SessInd=0&ActNum=0284.",
    "All premiums charged for insurance placed with an eligible surplus lines insurer or other nonadmitted insurer, on gross premiums less return premiums, added to the premium and collected from the insured or the writing producer. For policies placed after June 30, 2011, the whole premium is taxed where Pennsylvania is the home state. Insurance placed with a risk retention group that is an eligible surplus lines insurer is taxed at 2% instead (subsection (e)). The report and payment are due January 31 each year.",
    later
  ),
  row(
    "RI",
    4e4,
    false,
    "R.I. Gen. Laws § 27-3-38(e)",
    "https://webserver.rilegislature.gov/Statutes/TITLE27/27-3/27-3-38.htm",
    "Gross premiums charged the insured less premiums returned, on policies procured under the surplus line license during the preceding calendar year."
  ),
  row(
    "SC",
    6e4,
    false,
    "S.C. Code § 38-45-10(13); § 38-45-20(5)",
    "https://www.scstatehouse.gov/code/t38c045.php",
    "The broker's premium tax rate is a blended 6%: a 4% state broker's premium tax and a 2% municipal broker's premium tax. Return premiums and dividends paid or credited to policyholders are left out of premiums."
  ),
  row(
    "SD",
    25e3,
    true,
    "S.D. Codified Laws § 10-44-2(3)",
    "https://sdlegislature.gov/api/Statutes/10-44-2.html",
    "SDCL 58-32-44 taxes surplus line premiums, leaving out sums collected for federal and state taxes and examination fees, at the rate and in the manner of § 10-44-2, in place of all other taxes on that business; paid before April 1 (quarterly after a year over $5,000). Section 10-44-2(3) taxes insurers not licensed or authorized in South Dakota at 2.5% of premiums in general, with lower rates for small life policies, annuities, and life premiums over $100,000, and 1% for court appearance bonds.",
    { ...later, alsoRead: [src("S.D. Codified Laws § 58-32-44", "https://sdlegislature.gov/api/Statutes/58-32-44.html", CHECKED_2)] }
  ),
  row(
    "TN",
    5e4,
    false,
    TN_CITE,
    TN,
    "The Department's filing procedures page gives 5% of gross premium and a 0.175% SLAS Clearinghouse transaction fee (the second charge in the row), both invoiced each quarter through the Clearinghouse; policies effective before October 1, 2016 are reported to the Department directly. Tenn. Code Ann. § 56-14-113(b)(1), read on October 20, 2026 in the state's public access code, sets the same 5% on gross premiums less return premiums for a Tennessee home state. It sets no Clearinghouse fee.",
    { ...later, charge: { name: "Clearinghouse transaction fee", ppm: 1750, ...src(TN_CITE, TN, CHECKED_2) }, alsoRead: [src("Tenn. Code Ann. § 56-14-113(b)(1)", TN_CODE, CHECKED_2)] }
  ),
  row(
    "TX",
    48500,
    false,
    "Texas Comptroller of Public Accounts, Insurance Premium Tax (Surplus Lines/Purchasing Groups)",
    "https://comptroller.texas.gov/taxes/insurance/surplus-lines.php",
    "The Comptroller's page gives the rate as 4.85% of taxable premiums, reported by the Texas-licensed surplus lines agent when Texas is the insured's home state. The Insurance Code section itself was not opened (the statutes site did not show its text to an automated read)."
  ),
  row(
    "UT",
    42500,
    false,
    "Utah Code § 31A-3-301(1)(a)",
    "https://le.utah.gov/xcode/Title31A/Chapter3/C31A-3-S301_2025101420251206.html",
    "The section sets 4-1/4% of gross premiums, less 4-1/4% of return premiums; gross premium includes fees charged to the insured. Does not apply to ocean marine insurance, annuities, or premiums paid by institutions of higher education listed in § 53H-1-102. Version effective October 14, 2025."
  ),
  row(
    "VT",
    3e4,
    false,
    "8 V.S.A. § 5035(a)",
    "https://legislature.vermont.gov/statutes/section/08/138/05035",
    "Premium receipts tax on gross premiums less return premiums where Vermont is the home state, collected from the insured on delivery and remitted to the Commissioner of Taxes."
  ),
  row(
    "VA",
    22500,
    true,
    "Va. Code § 58.1-2501(A)(1)",
    "https://law.lis.virginia.gov/vacode/title58.1/chapter25/section58.1-2501/",
    "Section 38.2-4809 applies the license tax of Title 58.1, chapter 25, article 1 to surplus lines policies for insureds whose home state is Virginia, on direct gross premium income. Section 58.1-2501 sets 2.25% for the kinds of insurance defined in §§ 38.2-109 through 38.2-134 (and for life insurance); workers' compensation is taxed under § 65.2-1000 instead.",
    { alsoRead: [src("Va. Code § 38.2-4809(A)(1)", "https://law.lis.virginia.gov/vacode/title38.2/chapter48/section38.2-4809/")] }
  ),
  row(
    "WA",
    2e4,
    true,
    "RCW 48.14.020(1)(a)",
    "https://app.leg.wa.gov/RCW/default.aspx?cite=48.14.020",
    "RCW 48.15.120 taxes surplus line premiums at the rate applied to authorized foreign insurers, which RCW 48.14.020 sets at 2% of premiums (ocean marine and foreign trade insurance is taxed differently, under subsection (4)). Premiums leave out sums collected for federal and state taxes and examination fees.",
    { alsoRead: [src("RCW 48.15.120(1)", "https://app.leg.wa.gov/RCW/default.aspx?cite=48.15.120")] }
  ),
  row(
    "WV",
    45500,
    true,
    "W. Va. Code § 33-12C-7(a)",
    "https://code.wvlegislature.gov/33-12C-7/",
    "Gross premiums and gross fees less return premiums. When West Virginia is the home state and the policy also covers risks outside the state, the part allocated to other states is computed at the rates and fees that apply there (subsection (a))."
  ),
  row(
    "WI",
    3e4,
    false,
    "Wis. Stat. § 618.43(1)(a)",
    "https://docs.legis.wisconsin.gov/statutes/statutes/618/iii/43",
    "Gross premiums where Wisconsin is the home state, on the entire premium for policies issued or renewed on or after July 21, 2011 (par. (bc)). Insurance transacted in violation of law is taxed at 5% (par. (d)). The tax is in place of other taxes on the business and of fire department dues."
  ),
  row(
    "WY",
    3e4,
    true,
    "Wyo. Stat. § 26-11-118(c)",
    "https://wyoleg.gov/statutes/compress/title26.pdf",
    "Gross premiums less return premiums. Where the policy covers risks in and out of Wyoming, the part allocated to other states is computed at their rates and fees (subsection (c)). A clearinghouse service fee, approved by the commissioner as a percent of premium, may also be collected (subsection (j)); its rate is not in the section."
  )
];
var GAPS = [];
var SURPLUS_LINES_TAX_TABLE = {
  id: "surplus-lines-tax",
  label: "state surplus lines premium tax rates",
  checkedOn: CHECKED_2,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: GAPS,
  officialHosts: [
    // Oklahoma's statutes are published by the Oklahoma State Courts Network, the Oklahoma courts' official site.
    "oscn.net",
    // New Mexico's statutes are published at NMOneSource.com by the New Mexico Compilation Commission, the state's
    // official legal publisher.
    "nmonesource.com",
    // www.lexisnexis.com/hottopics/...: the addresses Georgia's and Tennessee's legislatures (legis.ga.gov,
    // capitol.tn.gov) link for their codes. Each opens the state's free public access code on advance.lexis.com, which
    // LexisNexis maintains under contract with the state; the sections were read there (October 20, 2026).
    "www.lexisnexis.com"
  ]
};
function slPercentText(ppm) {
  if (!Number.isSafeInteger(ppm) || ppm < 0) throw new Error("A rate must be a whole number of parts per million, zero or more.");
  const whole = Math.floor(ppm / 1e4);
  const frac = String(ppm % 1e4).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}
function slRow(code, table = SURPLUS_LINES_TAX_TABLE) {
  return table.rows.find((r) => r.code === code);
}
function slRowSources(r) {
  return [r, ...Array.isArray(r.alsoRead) ? r.alsoRead : [], ...r.charge ? [r.charge] : []];
}
function slCheckTable(table = SURPLUS_LINES_TAX_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, (r) => r.code, (r) => [...Array.isArray(r.alsoRead) ? r.alsoRead : [], ...r.charge ? [r.charge] : []]));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badRates = [];
  for (const r of rows) {
    if (!Number.isSafeInteger(r.taxPpm) || r.taxPpm <= 0 || r.taxPpm > 1e5) badRates.push(`${r.code} tax ${r.taxPpm}`);
    if (r.charge !== null && (typeof r.charge !== "object" || !Number.isSafeInteger(r.charge.ppm) || r.charge.ppm <= 0 || r.charge.ppm > 1e4 || typeof r.charge.name !== "string" || r.charge.name.trim().length < 3)) {
      badRates.push(`${r.code} second charge`);
    }
  }
  checks.that("sl-rates", "Every rate is a whole number of parts per million in a plausible range (tax above 0% and at most 10%, a second charge at most 1%)", badRates.length === 0, badRates.join("; "));
  const noNotes = rows.filter((r) => typeof r.notes !== "string" || r.notes.trim().length < 20).map((r) => r.code);
  checks.that("sl-notes", "Every row says its conditions in a note", noNotes.length === 0, `no note: ${noNotes.join(", ")}`);
  return checks.all;
}
function slJoin(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function slStatesText(codes) {
  const dc = codes.includes("DC");
  return `${refCount(codes.length - (dc ? 1 : 0), "state", "states")}${dc ? " and the District of Columbia" : ""}`;
}
var slIsPpm = (ppm) => typeof ppm === "number" && Number.isSafeInteger(ppm) && ppm >= 0;
var slHas = (n) => n === 1 ? "has" : "have";
function surplusLinesTaxFindings(table = SURPLUS_LINES_TAX_TABLE) {
  const P = `${table.id}-findings`;
  const checks = new CheckList();
  const findings = [];
  const done = () => ({ findings, checks: checks.all });
  const members = Array.isArray(table.members) ? table.members : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const pct = slPercentText;
  const names = (codes2) => refNameList(codes2, members);
  const named = (codes2) => codes2.length <= 5 ? ` (${names(codes2)})` : "";
  const where = (codes2) => codes2.length <= 5 ? `(${names(codes2)})` : `(${codes2.length} of them)`;
  const sortedCodes = (codes2) => [...codes2].sort().join(", ");
  const notWhole = rows.filter((r) => !slIsPpm(r.taxPpm) || r.charge !== null && (typeof r.charge !== "object" || !slIsPpm(r.charge.ppm))).map((r) => r.code);
  checks.that(`${P}-whole`, "Every rate the findings count is a whole number of parts per million", notWhole.length === 0, `not a whole number: ${notWhole.join(", ")}`);
  if (notWhole.length > 0) return done();
  const n = rows.length;
  const codes = rows.map((r) => r.code);
  const all = `the ${slStatesText(members.map((m) => m.code))}`;
  const gapCodes = gaps.map((g) => g.code);
  findings.push({
    id: `${P}-coverage`,
    text: n === 0 ? `Of ${all}, none has a row yet.` : gaps.length === 0 ? `Of ${all}, all ${n} have a row.` : `Of ${all}, ${n} ${slHas(n)} a row${codes.includes("DC") ? ` (${slStatesText(codes)})` : ""} and ${gaps.length}${named(gapCodes)} ${gaps.length === 1 ? "is" : "are"} not yet covered; the figures below count only the ${n} with a row.`
  });
  const coveredByWalk = members.filter((m) => rows.some((r) => r.code === m.code)).length;
  const missingByWalk = members.filter((m) => !rows.some((r) => r.code === m.code)).length;
  checks.equal(`${P}-coverage`, `With a row and not yet covered, counted again one by one through ${all}`, `${coveredByWalk} with a row, ${missingByWalk} not yet covered`, `${n} with a row, ${gaps.length} not yet covered`);
  checks.equal(`${P}-coverage-groups`, `The rows and the ones not yet covered add up to ${all}`, members.length, n + gaps.length);
  if (n === 0) return done();
  const of = `Of the ${n} with a row`;
  const rates = rows.map((r) => ({ code: r.code, value: r.taxPpm }));
  const values = rates.map((x) => x.value);
  const ext = refExtremes(rates);
  const middle = refLowerMedian(values);
  findings.push({
    id: `${P}-range`,
    text: ext.min === ext.max ? `${of}, every tax rate is ${pct(ext.min)}.` : `${of}, tax rates run from ${pct(ext.min)} ${where(ext.minCodes)} to ${pct(ext.max)} ${where(ext.maxCodes)}; ranked low to high, ${n % 2 === 1 ? "the middle one" : "the lower of the two middle ones"} is ${pct(middle)}.`
  });
  let min2 = values[0];
  let max2 = values[0];
  for (const v of values) {
    if (v < min2) min2 = v;
    if (v > max2) max2 = v;
  }
  const at = (v) => sortedCodes(rows.filter((r) => r.taxPpm === v).map((r) => r.code));
  checks.equal(
    `${P}-range`,
    "The lowest and highest tax rates and the rows that have them, found again in one pass over the rates",
    `${pct(min2)} (${at(min2)}) to ${pct(max2)} (${at(max2)})`,
    `${pct(ext.min)} (${sortedCodes(ext.minCodes)}) to ${pct(ext.max)} (${sortedCodes(ext.maxCodes)})`
  );
  const half = Math.ceil(n / 2);
  const middle2 = Math.min(...values.filter((v) => values.filter((x) => x <= v).length >= half));
  checks.equal(`${P}-middle`, `The middle tax rate, found again as the lowest rate that at least ${half} of the ${n} rows are at or below`, pct(middle2), pct(middle));
  const tally = refTally(rates);
  const top = tally[0].codes.length;
  const modes = tally.filter((t) => t.codes.length === top);
  const sorted = [...values].sort((a, b) => a - b);
  let bestRun = 0;
  let bestValues = [];
  let bestStart = 0;
  let bestEnd = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j] === sorted[i]) j++;
    if (j - i > bestRun) {
      bestRun = j - i;
      bestValues = [sorted[i]];
      bestStart = i;
      bestEnd = j;
    } else if (j - i === bestRun) bestValues.push(sorted[i]);
    i = j;
  }
  if (modes.length === 1) {
    const m = modes[0];
    const below = values.filter((v) => v < m.value).length;
    const above = values.filter((v) => v > m.value).length;
    findings.push({
      id: `${P}-common`,
      text: `${of}, the most common tax rate is ${pct(m.value)}, in ${top} of them${named(m.codes)}; ${below === 0 ? "none has" : `${below} ${slHas(below)}`} a lower rate and ${above === 0 ? "none" : above} a higher one.`
    });
    checks.equal(
      `${P}-common`,
      "The most common tax rate, how many rows have it, and how many are below and above it, counted again in one run over the rates in order",
      bestValues.length === 1 ? `${pct(bestValues[0])} in ${bestRun}; ${bestStart} lower, ${n - bestEnd} higher` : `${bestValues.map(pct).join(" and ")} in ${bestRun} each`,
      `${pct(m.value)} in ${top}; ${below} lower, ${above} higher`
    );
    checks.equal(`${P}-common-groups`, `Rows below, at, and above the most common rate add up to the ${n} rows`, n, below + top + above);
  } else {
    findings.push({
      id: `${P}-common`,
      text: top === 1 ? `${of}, no two have the same tax rate.` : `${of}, the most common tax rates are ${slJoin(modes.map((t) => pct(t.value)))}, each in ${top} of them.`
    });
    checks.equal(
      `${P}-common`,
      "The most common tax rates and how many rows have each, counted again in one run over the rates in order",
      `${bestValues.map(pct).join(" and ")} in ${bestRun} each`,
      `${modes.map((t) => pct(t.value)).join(" and ")} in ${top} each`
    );
    checks.equal(`${P}-common-groups`, `The rows counted at each distinct tax rate add up to the ${n} rows`, n, tally.reduce((s, t) => s + t.codes.length, 0));
  }
  const withCharge = rows.filter((r) => r.charge !== null).sort((a, b) => refMemberName(members, a.code).localeCompare(refMemberName(members, b.code)));
  const k = withCharge.length;
  const chargePpm = withCharge.map((r) => r.charge.ppm);
  const otherNone = n - k > 0 ? `; the other ${n - k} ${slHas(n - k)} none in the row` : "";
  findings.push({
    id: `${P}-charge`,
    text: k === 0 ? `None of the ${n} with a row has a second charge set as a percent of premium.` : k <= 5 ? `${of}, ${k} also ${slHas(k)} a second charge set as a percent of premium (${slJoin(withCharge.map((r) => `${refMemberName(members, r.code)} ${pct(r.charge.ppm)}`))})${otherNone}.` : `${of}, ${k} also have a second charge set as a percent of premium, ${Math.min(...chargePpm) === Math.max(...chargePpm) ? `each ${pct(chargePpm[0])}` : `from ${pct(Math.min(...chargePpm))} to ${pct(Math.max(...chargePpm))}`}${otherNone}.`
  });
  const chargeWalk = members.flatMap((m) => rows.filter((r) => r.code === m.code && r.charge !== null).map((r) => `${r.code} ${pct(r.charge.ppm)}`));
  checks.equal(
    `${P}-charge`,
    "The rows with a second charge and its rate in each, listed again state by state",
    `${chargeWalk.length}: ${[...chargeWalk].sort().join(", ")}`,
    `${k}: ${withCharge.map((r) => `${r.code} ${pct(r.charge.ppm)}`).sort().join(", ")}`
  );
  checks.equal(`${P}-charge-groups`, `Rows with and without a second charge add up to the ${n} rows`, n, k + rows.filter((r) => r.charge === null).length);
  const cond = rows.filter((r) => r.rateHasConditions === true).map((r) => r.code);
  const c = cond.length;
  findings.push({
    id: `${P}-conditions`,
    text: c === 0 ? `For each of the ${n} with a row, the source sets one rate with no line-of-business, calendar-year, or multistate condition.` : `For ${c} of the ${n} with a row${named(cond)}, the source puts conditions on the rate, such as a line of business, a calendar year, or a multistate allocation (each row's note says which)${n - c > 0 ? `; for the other ${n - c} it sets one rate with no such condition` : ""}.`
  });
  const condWalk = members.flatMap((m) => rows.filter((r) => r.code === m.code && r.rateHasConditions === true).map((r) => r.code));
  checks.equal(
    `${P}-conditions`,
    "The rows whose source puts conditions on the rate, counted again state by state",
    `${condWalk.length}${condWalk.length <= 5 ? ` (${sortedCodes(condWalk)})` : ""}`,
    `${c}${c <= 5 ? ` (${sortedCodes(cond)})` : ""}`
  );
  checks.equal(`${P}-conditions-groups`, `Rows with and without conditions on the rate add up to the ${n} rows`, n, c + rows.filter((r) => r.rateHasConditions === false).length);
  return done();
}
function slApplyPpm(cents, ppm) {
  assertCents(cents, "premium");
  if (cents < 0) throw new Error("The premium cannot be less than zero.");
  if (!Number.isSafeInteger(ppm) || ppm < 0) throw new Error("A rate must be a whole number of parts per million, zero or more.");
  const whole = BigInt(SL_PPM_WHOLE);
  return Number((BigInt(cents) * BigInt(ppm) + whole / 2n) / whole);
}
function slWithinHalfCent(premium, ppm, amount) {
  if (!Number.isSafeInteger(premium) || !Number.isSafeInteger(ppm) || !Number.isSafeInteger(amount)) return false;
  const twiceExact = 2n * BigInt(premium) * BigInt(ppm);
  const twiceAmount = 2n * BigInt(amount) * BigInt(SL_PPM_WHOLE);
  const whole = BigInt(SL_PPM_WHOLE);
  return twiceExact >= twiceAmount - whole && twiceExact < twiceAmount + whole;
}
function computeSurplusLinesTax(premium, code, table = SURPLUS_LINES_TAX_TABLE) {
  assertCents(premium, "premium");
  if (premium <= 0) throw new Error("The premium must be more than zero.");
  const r = slRow(code, table);
  if (!r) throw new Error(`${refMemberName(table.members, code)} is not in the table yet, so no rate is applied.`);
  const tax = slApplyPpm(premium, r.taxPpm);
  const charge = r.charge ? slApplyPpm(premium, r.charge.ppm) : 0;
  const result = { row: r, premium, tax, charge, total: assertCents(tax + charge, "total") };
  return { ...result, checks: verifySurplusLinesTax(result, table) };
}
function verifySurplusLinesTax(r, table = SURPLUS_LINES_TAX_TABLE) {
  const checks = new CheckList();
  const premiumOk = Number.isSafeInteger(r.premium) && r.premium > 0;
  const tableRow = slRow(r.row.code, table);
  const chargePpm = r.row.charge?.ppm ?? 0;
  checks.that(
    "sl-tax-recomputed",
    `Tax: premium × ${slPercentText(Math.max(0, Math.trunc(r.row.taxPpm) || 0))}, checked a second way (the exact product, by cross-multiplication, is within half a cent of the tax, halves rounded up)`,
    premiumOk && slWithinHalfCent(r.premium, r.row.taxPpm, r.tax),
    `${safeUSD(r.tax)} is not premium × rate rounded half up to the cent`
  );
  checks.that(
    "sl-charge-recomputed",
    r.row.charge ? `${r.row.charge.name}: premium × ${slPercentText(Math.max(0, Math.trunc(chargePpm) || 0))}, checked the same way` : "No second charge in the row, so the second charge is $0.00",
    premiumOk && slWithinHalfCent(r.premium, chargePpm, r.charge),
    `${safeUSD(r.charge)} is not premium × the second charge's rate rounded half up to the cent`
  );
  const sumOk = Number.isSafeInteger(r.tax) && Number.isSafeInteger(r.charge) && Number.isSafeInteger(r.total);
  if (sumOk) checks.cents("sl-total", "Total equals the tax plus the second charge", r.tax + r.charge, r.total);
  else checks.that("sl-total", "Total equals the tax plus the second charge", false, "an amount is not a whole number of cents");
  const sameCharge = (a, b) => a === null && b === null || a !== null && b !== null && a.ppm === b.ppm && a.name === b.name && a.citation === b.citation;
  checks.that(
    "sl-row-from-table",
    "The rates used are the ones in the table row for this state",
    tableRow !== void 0 && tableRow.taxPpm === r.row.taxPpm && tableRow.citation === r.row.citation && tableRow.rateHasConditions === r.row.rateHasConditions && sameCharge(tableRow.charge, r.row.charge),
    "The rate, second charge, citation, or conditions flag in the result differs from the table"
  );
  checks.that(
    "sl-rate-conditions",
    "The source sets one rate for this business, with no line-of-business, calendar-year, or multistate condition",
    !(tableRow?.rateHasConditions ?? r.row.rateHasConditions),
    "The source puts conditions on the rate (see the row's note), so the figures are only premium × the row's general rate. What applies to a particular policy can differ",
    "warning"
  );
  return checks.all;
}
function safeUSD(c) {
  return Number.isSafeInteger(c) ? formatUSD(c) : String(c);
}

export {
  SL_PPM_WHOLE,
  SURPLUS_LINES_TAX_TABLE,
  slPercentText,
  slRow,
  slRowSources,
  slCheckTable,
  surplusLinesTaxFindings,
  slApplyPpm,
  slWithinHalfCent,
  computeSurplusLinesTax,
  verifySurplusLinesTax
};
