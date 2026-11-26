// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  REF_US_STATES_DC,
  refAddDays,
  refAddMonths,
  refAddYears,
  refCheckTable,
  refCount,
  refDaysBetween,
  refExtremes,
  refMemberName,
  refNameList,
  refParseDay,
  refTally
} from "./sourced.mjs";
import {
  daysInMonth,
  isLeapYear,
  parseCivilDate
} from "./calendarDays.mjs";
import {
  CheckList
} from "./money.mjs";

// packages/core/src/bookkeeping/dormancyPeriods.ts
var OCT19 = "2026-10-19";
var OCT20 = "2026-10-20";
var src = (citation, sourceUrl, checkedOn = OCT19) => ({ citation, sourceUrl, checkedOn });
var src20 = (citation, sourceUrl) => src(citation, sourceUrl, OCT20);
function row(code, r) {
  const out = {
    code,
    vendorYears: r.vendorYears,
    vendorRule: r.vendorRule,
    payrollYears: r.payrollYears,
    payrollRule: r.payrollRule,
    report: r.report,
    citation: r.citation,
    sourceUrl: r.sourceUrl,
    checkedOn: r.checkedOn ?? OCT19,
    vendorException: r.vendorException ?? "",
    notes: r.notes ?? ""
  };
  if (r.payrollSource) out.payrollSource = r.payrollSource;
  if (r.reportSource) out.reportSource = r.reportSource;
  return out;
}
var due = (month, day, text) => ({ month, day, text });
var NOV1_JULY = (cite) => due(11, 1, `Before November 1, covering the 12 months before July 1 (${cite}).`);
var NOV1_JUNE30 = (cite) => due(11, 1, `Before November 1, as of the June 30 before it (${cite}).`);
var RI = "https://webserver.rilegislature.gov/Statutes/TITLE33/33-21.1/";
var VA = "https://law.lis.virginia.gov/vacode/title55.1/chapter25/";
var MO = "https://revisor.mo.gov/main/OneSection.aspx?section=";
var KS = "https://www.ksrevisor.gov/statutes/chapters/ch58/";
var MT = "https://mca.legmt.gov/bills/mca/title_0700/chapter_0090/part_0080/";
var WV = "https://code.wvlegislature.gov/";
var ME = "https://legislature.maine.gov/statutes/33/";
var MN = "https://www.revisor.mn.gov/statutes/cite/";
var NE = "https://nebraskalegislature.gov/laws/statutes.php?statute=";
var DC = "https://code.dccouncil.gov/us/dc/council/code/sections/";
var MI = "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-";
var CA = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=";
var IL = "https://www.ilga.gov/Documents/legislation/ilcs/documents/076510260K";
var NJ = (doc) => `https://lis.njleg.state.nj.us/nxt/gateway.dll/statutes/1/44314/${doc}?f=templates$fn=document-frameset.htm$3.0`;
var MS_RULES = "https://www.sos.ms.gov/adminsearch/ACCode/00000576c.pdf";
var OH = "https://codes.ohio.gov/ohio-revised-code/section-";
var DORMANCY_ROWS = [
  row("AK", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Department of Revenue property code CK13, vendor checks: 3 years (1 year for government holders; MS08, accounts payable, is also 3 years).",
    payrollYears: 1,
    payrollRule: "Department of Revenue property code MS01, wages, payroll, salary: 1 year.",
    report: due(11, 1, "Before November 1, for property unclaimed as of the June 30 before it (the Department of Revenue’s reporting guidelines)."),
    citation: "Alaska Unclaimed Property Codes and Dormancy Periods (Department of Revenue, Unclaimed Property Program), property codes CK13, MS01",
    sourceUrl: "https://unclaimedproperty.alaska.gov/docs/AK%20Property%20Types%20and%20Dormancy%20Periods.pdf",
    reportSource: src20("Alaska Department of Revenue, Unclaimed Property Program, Reporting Guidelines", "https://unclaimedproperty.alaska.gov/app/reporting-guidelines"),
    notes: "Read in the Department of Revenue’s published table of property codes and dormancy periods for the Alaska Uniform Unclaimed Property Act (AS 34.45). The Legislature’s statute site answered with a server error when this row was read, so the statute itself was not read here."
  }),
  row("AL", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Ala. Code § 35-12-72(a)(19): all other property, 3 years after the owner’s right to demand it or the obligation to pay or distribute it arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "Ala. Code § 35-12-72(a)(14): wages or other compensation for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("§ 35-12-76(c)"),
    citation: "Ala. Code §§ 35-12-72(a)(14), (19), 35-12-76(c)",
    sourceUrl: "https://treasury.alabama.gov/alabama-treasury-law/unclaimed-property-law/",
    notes: "Read in the act’s text (§§ 35-12-70 to 35-12-96) as the State Treasurer publishes it."
  }),
  row("AR", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Auditor of State’s property code CK13, vendor checks: 3 years (MS08, accounts payable, is also 3 years).",
    payrollYears: 1,
    payrollRule: "Auditor of State’s property code MS01, wages, payroll, salary: 1 year.",
    report: due(11, 1, "Before November 1, for holders other than life insurers (the Auditor of State’s Reporting Booklet)."),
    citation: "Arkansas Unclaimed Property Reporting Booklet (Auditor of State, revised July 2026), property codes CK13, MS01",
    sourceUrl: "https://auditor.ar.gov/wp-content/uploads/UCP_Reporting_Booklet_Revised_JULY_2026.pdf",
    notes: "Read in the Auditor of State’s published table of property codes and abandonment periods for the Arkansas Unclaimed Property Act (A.C.A. § 18-28-201 et seq.). The Code’s online text is hosted by a commercial publisher and was not read here."
  }),
  row("AZ", {
    vendorYears: 3,
    vendorRule: "§ 44-302(A)(14): a check a business association is directly liable on, outstanding more than 3 years after it was payable (or issued, if payable on demand).",
    payrollYears: 1,
    payrollRule: "§ 44-302(A)(12): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("§ 44-307(D)"),
    citation: "A.R.S. § 44-302(A)(12), (14)",
    sourceUrl: "https://www.azleg.gov/ars/44/00302.htm",
    reportSource: src("A.R.S. § 44-307(D)", "https://www.azleg.gov/ars/44/00307.htm"),
    notes: "Paragraph (16) also sets 3 years for all other property. A holder may make a one-time election to report at the time it reports for income tax (§ 44-307(D))."
  }),
  row("CA", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Code Civ. Proc. § 1520(a): property not covered by another section of the law, held or owing in the ordinary course of the holder’s business, unclaimed more than 3 years after it became payable or distributable.",
    payrollYears: 1,
    payrollRule: "Code Civ. Proc. § 1513(a)(7): wages or salaries unclaimed more than 1 year after they become payable.",
    report: due(11, 1, "Before November 1, as of the June 30 or fiscal year-end before it (§ 1530(d))."),
    citation: "Cal. Code Civ. Proc. § 1520(a)",
    sourceUrl: `${CA}1520`,
    payrollSource: src20("Cal. Code Civ. Proc. § 1513(a)(7)", `${CA}1513`),
    reportSource: src20("Cal. Code Civ. Proc. § 1530(d)", `${CA}1530`),
    notes: "Read in the Unclaimed Property Law (Code Civ. Proc. §§ 1500 to 1582), § 1520 as amended effective January 1, 2026. The separate check paragraph, § 1513(a)(4), covers instruments a banking or financial organization is directly liable on (also 3 years). Life insurers report before May 1 (§ 1530(d))."
  }),
  row("CO", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "C.R.S. 38-13-201(1)(m): all other property not specified, 3 years after the owner first has a right to demand it or the obligation to pay or distribute it arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "C.R.S. 38-13-201(1)(k): wages, commissions, bonuses or reimbursements owed to an employee, or other pay for personal services, other than amounts held in a payroll card, 1 year after payable.",
    report: NOV1_JULY("C.R.S. 38-13-403(1)"),
    citation: "C.R.S. 38-13-201(1)(k), (m), 38-13-403(1)",
    sourceUrl: "https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-38.pdf",
    notes: "Read in Colorado Revised Statutes 2024, Title 38 (the Revised Uniform Unclaimed Property Act, article 13). A debt of a business association also has a 3-year period (§ 38-13-201(1)(d))."
  }),
  row("CT", {
    vendorYears: 3,
    vendorRule: "§ 3-64a: property not otherwise provided for, unclaimed more than 3 years after it became due, payable or distributable.",
    payrollYears: 1,
    payrollRule: "§ 3-60b: wages, salary or other pay for personal services, unclaimed more than 1 year after it becomes due.",
    report: due(3, 31, "Within 90 days after the end of the calendar year in which the property is presumed abandoned (§ 3-65a(b)); March 31 in a year without February 29."),
    citation: "Conn. Gen. Stat. §§ 3-60b, 3-64a, 3-65a(b)",
    sourceUrl: "https://www.cga.ct.gov/current/pub/chap_032.htm"
  }),
  row("DC", {
    vendorYears: 3,
    vendorRule: "D.C. Code § 41-152.01(13): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "D.C. Code § 41-152.01(11): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("§ 41-154.03(a)"),
    citation: "D.C. Code § 41-152.01(11), (13)",
    sourceUrl: `${DC}41-152.01`,
    reportSource: src("D.C. Code § 41-154.03(a)", `${DC}41-154.03`),
    notes: "The District’s Revised Uniform Unclaimed Property Act (Title 41, chapter 1A); the older chapter 1 is repealed."
  }),
  row("DE", {
    vendorYears: 5,
    vendorRule: "12 Del. C. § 1133(17): all other property not specified, 5 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 5,
    payrollRule: "12 Del. C. § 1133(11): wages, commissions, bonuses or reimbursements owed to an employee, 5 years after payable.",
    report: due(3, 1, "On or before March 1, covering the 12 months before January 1, for holders other than banking organizations and insurance companies (§ 1144(a))."),
    citation: "12 Del. C. §§ 1133(11), (17), 1144(a)",
    sourceUrl: "https://delcode.delaware.gov/title12/c011/sc02/index.html",
    notes: "Banking organizations report on or before November 10 and insurance companies on or before December 20 (§ 1144(b), (c)). The chapter’s definition of property leaves out uninvoiced payables and says it creates no business-to-business exemption."
  }),
  row("FL", {
    vendorYears: 5,
    vendorRule: "§ 717.102(1): the general dormancy period, 5 years from the date the property becomes payable.",
    payrollYears: 1,
    payrollRule: "§ 717.115: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(5, 1, "Before May 1, covering the calendar year before it (§ 717.117(11))."),
    citation: "Fla. Stat. §§ 717.102(1), 717.115, 717.117(11)",
    sourceUrl: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0717/0717.html",
    notes: "Read in the 2026 Florida Statutes. The chapter says property is not treated as abandoned for reporting until the holder has done the due diligence it requires (§ 717.117(1))."
  }),
  row("GA", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "Department of Revenue property code CK13, vendor checks: 5 years (MS08, accounts payable, and ZZZZ, property not identified elsewhere, are also 5 years).",
    payrollYears: 1,
    payrollRule: "Department of Revenue property code MS01, wages, payroll, salary: 1 year.",
    report: due(11, 1, "By November 1, for the reporting period ending the June 30 before it, for holders other than insurers (Annual Filing Report 2026)."),
    citation: "Georgia Unclaimed Property Annual Filing Report, Report Year 2026 (Department of Revenue), property codes CK13, MS01",
    sourceUrl: "https://dor.georgia.gov/document/document/holder-annual-filing-report-information/download",
    notes: "Read in the Department of Revenue’s published property codes and dormancy periods for the Disposition of Unclaimed Property Act (O.C.G.A. § 44-12-190 et seq.). The Code’s online text is hosted by a commercial publisher and was not read here."
  }),
  row("HI", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "HRS § 523A-3(a)(15): all other property, 5 years after the owner’s right to demand it or the obligation to pay or distribute it arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "HRS § 523A-3(a)(12): wages or other compensation for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("HRS § 523A-8(d)"),
    citation: "HRS § 523A-3(a)(12), (15)",
    sourceUrl: "https://data.capitol.hawaii.gov/hrscurrent/Vol12_Ch0501-0588/HRS0523A/HRS_0523A-0003.htm",
    reportSource: src20("HRS § 523A-8(d)", "https://data.capitol.hawaii.gov/hrscurrent/Vol12_Ch0501-0588/HRS0523A/HRS_0523A-0008.htm")
  }),
  row("IA", {
    vendorYears: 3,
    vendorRule: "§ 556.9(1)(a): intangible property not otherwise covered by the chapter, unclaimed more than 3 years after it became payable.",
    payrollYears: 1,
    payrollRule: "§ 556.9(1)(b): unpaid wages, including payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(11, 1, "Before November 1, for the fiscal year ending the June 30 before it (§ 556.11(4))."),
    citation: "Iowa Code §§ 556.9(1), 556.11(4)",
    sourceUrl: "https://www.legis.iowa.gov/docs/code/556.pdf",
    notes: "Read in Iowa Code 2026, chapter 556."
  }),
  row("ID", {
    vendorYears: 5,
    vendorRule: "Idaho Code § 14-5-201(1)(n): property not specified elsewhere, 5 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "Idaho Code § 14-5-201(1)(j): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("§ 14-5-403(1)"),
    citation: "Idaho Code §§ 14-5-201(1)(j), (n), 14-5-403(1)",
    sourceUrl: "https://legislature.idaho.gov/wp-content/uploads/statutesrules/idstat/Title14/T14CH5.pdf",
    notes: "Idaho’s Revised Unclaimed Property Act (Title 14, chapter 5)."
  }),
  row("IL", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "765 ILCS 1026/15-201(3): an instrument a financial organization or business association is directly liable on, other than a money order, 3 years after issuance.",
    payrollYears: 1,
    payrollRule: "765 ILCS 1026/15-201(13): wages, commissions, bonuses or reimbursements owed to an employee, or other pay for personal services, including amounts on a payroll card, 1 year after payable.",
    report: due(5, 1, "Before May 1, for the calendar year before it, for business associations other than financial organizations and insurers other than life insurers (15-403(b))."),
    citation: "765 ILCS 1026/15-201(3), (13)",
    sourceUrl: `${IL}15-201.htm`,
    reportSource: src20("765 ILCS 1026/15-403", `${IL}15-403.htm`),
    notes: "Illinois’s Revised Uniform Unclaimed Property Act. A debt of a business association (paragraph (5)) and property not specified elsewhere (paragraph (15)) also have 3-year periods. Financial organizations and insurance companies other than life insurers report before November 1, covering the 12 months before July 1 (15-403(a))."
  }),
  row("IN", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "IC 32-34-1.5-4(13): property not specified elsewhere, 3 years after the owner first has a right to demand it or the obligation to pay or distribute it arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "IC 32-34-1.5-4(11): wages, commissions, bonuses or reimbursements owed to an employee, or other pay for personal services, other than amounts on a payroll card, 1 year after payable.",
    report: NOV1_JULY("IC 32-34-1.5-20(a)"),
    citation: "IC 32-34-1.5-4(11), (13)",
    sourceUrl: "https://iga.in.gov/laws/2026/ic/titles/32#32-34-1.5-4",
    reportSource: src20("IC 32-34-1.5-20(a)", "https://iga.in.gov/laws/2026/ic/titles/32#32-34-1.5-20"),
    notes: "Read in the 2026 Indiana Code (the Revised Unclaimed Property Act, IC 32-34-1.5). A debt of a business association also has a 3-year period (section 4(4)). The chapter does not apply to a business-to-business credit memorandum or a credit balance resulting from one (section 1(b)); that section does not mention checks. Insurance companies report before May 1 (section 20(b))."
  }),
  row("KS", {
    vendorYears: 5,
    vendorRule: "K.S.A. 58-3935(a)(16): all other property, 5 years after the right to demand it or the obligation to pay arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "K.S.A. 58-3935(a)(11): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("K.S.A. 58-3950(d)"),
    citation: "K.S.A. 58-3935(a)(11), (16)",
    sourceUrl: `${KS}058_039_0035.html`,
    reportSource: src("K.S.A. 58-3950(d)", `${KS}058_039_0050.html`)
  }),
  row("KY", {
    vendorYears: 3,
    vendorRule: "KRS 393A.040(14): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "KRS 393A.040(12): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("KRS 393A.240(1)"),
    citation: "KRS 393A.040(12), (14)",
    sourceUrl: "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=56644",
    reportSource: src("KRS 393A.240(1)", "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48121"),
    notes: "Read in the text effective July 1, 2025."
  }),
  row("LA", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "La. R.S. 9:154(A)(20): all other property, 5 years after the obligation to pay or distribute it arises.",
    payrollYears: 1,
    payrollRule: "La. R.S. 9:154(A)(11): wages or other compensation for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("R.S. 9:159(D)"),
    citation: "La. R.S. 9:154(A)(11), (20)",
    sourceUrl: "https://legis.la.gov/Legis/Law.aspx?d=106699",
    reportSource: src20("La. R.S. 9:159(D)", "https://legis.la.gov/Legis/Law.aspx?d=106717")
  }),
  row("MA", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "M.G.L. c. 200A, § 5: intangible property not covered by another section of the chapter, including money, drafts and claims for money, unclaimed within 3 years after the date set for payment or delivery.",
    payrollYears: 3,
    payrollRule: "M.G.L. c. 200A, § 5: the chapter sets no separate period for wages (§ 1 counts unpaid wages as property), so the row uses § 5’s 3-year period for property not covered by another section.",
    report: due(11, 1, "No later than November 1, as of the June 30 or the end of the fiscal year before it (§ 7)."),
    citation: "M.G.L. c. 200A, § 5",
    sourceUrl: "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleII/Chapter200A/Section5",
    reportSource: src20("M.G.L. c. 200A, § 7", "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleII/Chapter200A/Section7"),
    vendorException: "§ 5 (second paragraph): the chapter does not apply to outstanding credit balances owed to a vendor or commercial customer from a vendor that arise in the normal course of business; the section does not say whether an uncashed check is such a balance.",
    notes: "Certified checks, drafts and similar written instruments covered by § 6B also have a 3-year period. Life insurers report before May 1 (§ 7)."
  }),
  row("MD", {
    vendorYears: 3,
    vendorRule: "Md. Code, Com. Law § 17-308(b): intangible property not otherwise covered, unclaimed more than 3 years after it became payable.",
    payrollYears: 3,
    payrollRule: "Md. Code, Com. Law § 17-308(a): unclaimed wages or outstanding payroll checks, unclaimed more than 3 years after they became payable.",
    report: due(10, 31, "No later than October 31, for the period July 1 through June 30 (§ 17-310(d))."),
    citation: "Md. Code, Com. Law § 17-308(a), (b)",
    sourceUrl: "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=17-308&enactments=false",
    reportSource: src("Md. Code, Com. Law § 17-310(d)", "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=17-310&enactments=false")
  }),
  row("ME", {
    vendorYears: 3,
    vendorRule: "33 M.R.S. § 2061(15): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "33 M.R.S. § 2061(11): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("33 M.R.S. § 2093(1)"),
    citation: "33 M.R.S. § 2061(11), (15)",
    sourceUrl: `${ME}title33sec2061.html`,
    reportSource: src("33 M.R.S. § 2093(1)", `${ME}title33sec2093.html`)
  }),
  row("MI", {
    vendorYears: 3,
    vendorRule: "MCL 567.223(1): property held in the ordinary course of business, unclaimed more than 3 years after it becomes payable.",
    payrollYears: 1,
    payrollRule: "MCL 567.236(1): unpaid wages over $50.00, including unpresented payroll checks over $50.00, unclaimed more than 1 year after becoming payable.",
    report: due(7, 1, "On or before July 1, for the 12 months ending the March 31 before it (MCL 567.238(4))."),
    citation: "MCL 567.223(1)",
    sourceUrl: `${MI}567-223`,
    payrollSource: src("MCL 567.236", `${MI}567-236`),
    reportSource: src("MCL 567.238(4)", `${MI}567-238`),
    notes: "Unpaid wages of $50.00 or less are not subject to the act (MCL 567.236(2)). The separate check section, MCL 567.226, covers checks a banking or financial organization is directly liable on."
  }),
  row("MN", {
    vendorYears: 3,
    vendorRule: "§ 345.39, subd. 1: intangible property not otherwise covered, unclaimed more than 3 years after payable; the subdivision lists unpaid accounts payable, vendor checks and miscellaneous outstanding checks.",
    payrollYears: 1,
    payrollRule: "§ 345.39, subd. 3: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("§ 345.41(d)"),
    citation: "Minn. Stat. § 345.39, subds. 1, 3",
    sourceUrl: `${MN}345.39`,
    reportSource: src("Minn. Stat. § 345.41(d)", `${MN}345.41`)
  }),
  row("MO", {
    vendorYears: 5,
    vendorRule: "§ 447.535.1: intangible property not otherwise covered; § 447.536 sets the period at 5 years.",
    payrollYears: 3,
    payrollRule: "§ 447.536: the period for payroll checks, reduced from 5 years to 3 years beginning January 1, 2015.",
    report: NOV1_JUNE30("§ 447.539.4"),
    citation: "Mo. Rev. Stat. § 447.535.1",
    sourceUrl: `${MO}447.535`,
    payrollSource: src("Mo. Rev. Stat. § 447.536", `${MO}447.536`),
    reportSource: src("Mo. Rev. Stat. § 447.539.4", `${MO}447.539`),
    vendorException: "§ 447.535.2: an outstanding check issued to a business in a commercial transaction is not presumed abandoned while the holder and that business have an ongoing business relationship, as the subsection defines it."
  }),
  row("MS", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "State Treasurer’s FAQs for Holders: 5 years for all checks (15 years for traveler’s checks and 7 years for money orders).",
    payrollYears: 5,
    payrollRule: "Treasurer’s rule on unpaid wages (Miss. Admin. Code Title 38, Part 4, Rule 2.3): presumed abandoned after more than 5 years in which the holder does not know where the person owed is and no claim or act of ownership has occurred.",
    report: due(
      11,
      1,
      "Before November 1, as of the June 30 before it, in a year a report is required; the Treasurer’s rule says reports are filed every third year as § 89-12-23 requires (Miss. Admin. Code Title 38, Part 4, Rule 3.1(D))."
    ),
    citation: "Mississippi State Treasurer, FAQs for Holders (unclaimed property reporting)",
    sourceUrl: "https://treasury.ms.gov/for-businesses/unclaimed-property-reporting/frequently-asked-questions-for-holders/",
    payrollSource: src20("Miss. Admin. Code Title 38, Part 4, Rule 2.3", MS_RULES),
    reportSource: src20("Miss. Admin. Code Title 38, Part 4, Rule 3.1(D)", MS_RULES),
    notes: "Read in the State Treasurer’s published holder guidance and its rules (on the Secretary of State’s Administrative Code site) for the Uniform Disposition of Unclaimed Property Act (Miss. Code Ann. § 89-12-1 et seq.). The Code’s online text is hosted by a commercial publisher and was not read here. The FAQ says items may be reported any time they meet the dormancy period, without waiting for the third year."
  }),
  row("MT", {
    vendorYears: 5,
    vendorRule: "§ 70-9-803(1)(q): all other property, 5 years after the right to demand it or the obligation to pay arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "§ 70-9-803(1)(k): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("§ 70-9-808(4)"),
    citation: "Mont. Code Ann. § 70-9-803(1)(k), (q)",
    sourceUrl: `${MT}section_0030/0700-0090-0080-0030.html`,
    reportSource: src("Mont. Code Ann. § 70-9-808(4)", `${MT}section_0080/0700-0090-0080-0080.html`),
    notes: "Read in the Montana Code Annotated 2025."
  }),
  row("NC", {
    vendorYears: 5,
    vendorRule: "§ 116B-53(c)(16): all other property, 5 years after the right to demand it or the obligation to pay arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "§ 116B-53(c)(13): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("§ 116B-60(d)"),
    citation: "N.C. Gen. Stat. §§ 116B-53(c)(13), (16), 116B-60(d)",
    sourceUrl: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_116B/Article_4.html",
    notes: "Money orders, cashier’s, teller’s and certified checks have their own 7-year period (§ 116B-53(c)(3))."
  }),
  row("ND", {
    vendorYears: 2,
    vendorRule: "§ 47-30.2-04(1): checks held, issued or owing in the ordinary course of the holder’s business, uncashed 2 years after becoming payable.",
    payrollYears: 1,
    payrollRule: "§ 47-30.2-04(13): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("§ 47-30.2-23(1)"),
    citation: "N.D.C.C. §§ 47-30.2-04(1), (13), 47-30.2-23(1)",
    sourceUrl: "https://ndlegis.gov/cencode/t47c30-2.pdf",
    notes: "Cashier’s and certified checks have their own 2-year period (§ 47-30.2-04(7))."
  }),
  row("NE", {
    vendorYears: 5,
    vendorRule: "Neb. Rev. Stat. § 69-1308(a): intangible property not otherwise covered by the act, unclaimed more than 5 years after it became payable.",
    payrollYears: 1,
    payrollRule: "Neb. Rev. Stat. § 69-1307.02: unpaid wages, including payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("§ 69-1310(d)"),
    citation: "Neb. Rev. Stat. § 69-1308(a)",
    sourceUrl: `${NE}69-1308`,
    payrollSource: src("Neb. Rev. Stat. § 69-1307.02", `${NE}69-1307.02`),
    reportSource: src("Neb. Rev. Stat. § 69-1310(d)", `${NE}69-1310`),
    notes: "Checks and other written instruments issued in Nebraska that a business association is directly liable on also have a 5-year period (§ 69-1302)."
  }),
  row("NH", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "RSA 471-C:2, I: intangible property held, issued or owing in the ordinary course of a holder’s business, unclaimed more than 5 years after it became payable or distributable.",
    payrollYears: 1,
    payrollRule: "RSA 471-C:17: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("RSA 471-C:19, IV"),
    citation: "RSA 471-C:2, I; 471-C:17; 471-C:19, IV",
    sourceUrl: "https://gc.nh.gov/rsa/html/XLVI/471-C/471-C-mrg.htm",
    notes: "The separate check section, RSA 471-C:5, covers checks a banking or financial organization is directly liable on (also 5 years)."
  }),
  row("NJ", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "N.J.S.A. 46:30B-7: property held, issued or owing in the ordinary course of a holder’s business, unclaimed more than 3 years after it became payable or distributable, except as the chapter provides otherwise.",
    payrollYears: 1,
    payrollRule: "N.J.S.A. 46:30B-44: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("N.J.S.A. 46:30B-49"),
    citation: "N.J.S.A. 46:30B-7",
    sourceUrl: NJ(44871),
    payrollSource: src20("N.J.S.A. 46:30B-44", NJ(44920)),
    reportSource: src20("N.J.S.A. 46:30B-49", NJ(44926)),
    notes: "Read in the Legislature’s unannotated New Jersey Statutes, updated through P.L.2026, c.50. Life insurers report before May 1 (46:30B-49)."
  }),
  row("NM", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "Taxation and Revenue Department property code CK13, vendors/expenditure checks: 5 years (MS08, accounts payable, is also 5 years).",
    payrollYears: 1,
    payrollRule: "Taxation and Revenue Department property code MS01, wage/payroll: 1 year.",
    report: due(11, 1, "On or before November 1, for the 12 months before July 1, for holders other than life insurers (RPD-41200)."),
    citation: "RPD-41200 Unclaimed Property Report Holder’s Filing Kit (Taxation and Revenue Department, 02/27/2024), property codes CK13, MS01",
    sourceUrl: "https://realfile.tax.newmexico.gov/rpd-41200.pdf",
    notes: "Read in the Department’s published retention periods for the Uniform Unclaimed Property Act (NMSA 1978, §§ 7-8A-1 to 7-8A-31). The statute is published on the state compilation commission’s site, which was not read here."
  }),
  row("NV", {
    vendorYears: 3,
    vendorRule: "NRS 120A.500(1)(q): all other property, 3 years after the right to demand it or the obligation to pay arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "NRS 120A.500(1)(m): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("NRS 120A.560(7)"),
    citation: "NRS 120A.500(1)(m), (q); 120A.560(7)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-120A.html"
  }),
  row("NY", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Comptroller’s property type table for all business entities: CK13, vendor checks, under Abandoned Property Law § 1315, 3 years (MS08, accounts payable, is also 3 years).",
    payrollYears: 3,
    payrollRule: "Comptroller’s property type table for all business entities: MS01, wages, payroll, salary, under Article V, 3 years.",
    report: due(3, 10, "By March 10, for property as of the December 31 cut-off before it, for all business entities (the Comptroller’s Calendar of Events, Article V and § 1315)."),
    citation: "N.Y. Office of the State Comptroller, Property Type Table (All Business Entities), codes CK13, MS01",
    sourceUrl: "https://www.osc.ny.gov/files/unclaimed-funds/reporters/pdf/property-type-tables.pdf",
    reportSource: src20("N.Y. Office of the State Comptroller, Calendar of Events for Reporting Abandoned Property", "https://www.osc.ny.gov/files/unclaimed-funds/reporters/pdf/calendar-of-events.pdf"),
    notes: "Read in the Comptroller’s published tables for the Abandoned Property Law; the official statute site turned automated reading away. Banks report by November 10 (Article III)."
  }),
  row("OH", {
    checkedOn: OCT20,
    vendorYears: 1,
    vendorRule: "R.C. 169.02(N): sums payable for services rendered and funds held for or owed to suppliers, unclaimed 1 year from the date payable; the Division of Unclaimed Funds’ code MS04, payments for goods and services, is also 1 year.",
    payrollYears: 1,
    payrollRule: "R.C. 169.02(N): wages over $50, and salaries and commissions, unclaimed 1 year from the date payable.",
    report: NOV1_JUNE30("R.C. 169.03(D)"),
    citation: "R.C. 169.02(N)",
    sourceUrl: `${OH}169.02`,
    reportSource: src20("R.C. 169.03(D)", `${OH}169.03`),
    vendorException: "R.C. 169.01(B)(2)(b): a payment or credit due to a business association from a business association, for sums payable to suppliers or for services rendered in the course of business, including checks, is not unclaimed funds.",
    notes: "The Division of Unclaimed Funds’ Unclaimed Funds Reporting Guide (2026 reporting year) lists MS04, payments for goods and services, at 1 year, and CK15, other miscellaneous outstanding checks, at 3 years; it lists cashier’s, certified and similar checks at 5 years (the written instruments of R.C. 169.02(F) are also 5 years) and a business’s expense reimbursement and refund checks at 3 years. Wages of $50 or less are not covered by division (N). Life insurers report before May 1 (R.C. 169.03(D))."
  }),
  row("OK", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "60 O.S. § 658(A): intangible property held, issued or owing in the ordinary course of a holder’s business, unclaimed more than 5 years after it became payable or distributable.",
    payrollYears: 1,
    payrollRule: "60 O.S. § 657.2: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(11, 1, "Before November 1, for property reportable as of the July 1 before it (§ 661(D))."),
    citation: "60 O.S. §§ 657.2, 658(A), 661(D)",
    sourceUrl: "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os60.pdf",
    notes: "Read in the Legislature’s compiled Title 60. The separate check section, § 651.2, covers checks a banking or financial organization is directly liable on (also 5 years). Section 657.4 sets 3 years for some intangible property whose owner’s address is unknown, except where another provision sets a different period."
  }),
  row("OR", {
    vendorYears: 3,
    vendorRule: "ORS 98.342(1): intangible property not otherwise covered, unclaimed more than 3 years after it became payable.",
    payrollYears: 1,
    payrollRule: "ORS 98.334(2): unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(11, 1, "After October 1 and no later than November 1, for accounts dormant as of June 30 (ORS 98.352(4))."),
    citation: "ORS 98.334(2), 98.342(1), 98.352(4)",
    sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors098.html"
  }),
  row("PA", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Fiscal Code § 1301.10(1): property not otherwise covered by the article, held or owing in the ordinary course of the holder’s business, unclaimed more than 3 years after it became payable or distributable.",
    payrollYears: 2,
    payrollRule: "Fiscal Code § 1301.10(2): wages or other compensation for personal services, unclaimed more than 2 years after they become payable or are distributed.",
    report: due(4, 15, "On or before April 15 of the year after the property became subject to the Commonwealth’s custody (§ 1301.11(d))."),
    citation: "Fiscal Code §§ 1301.10(1), (2), 1301.11(d) (Act of Apr. 9, 1929, P.L. 343, No. 176)",
    sourceUrl: "https://www.legis.state.pa.us/WU01/LI/LI/US/PDF/1929/0/0176..PDF",
    notes: "Read in the Legislature’s text of the Fiscal Code, Article XIII.1. Paragraph (1) covers property the holder has admitted in writing and that is adjudicated to be due."
  }),
  row("RI", {
    vendorYears: 3,
    vendorRule: "§ 33-21.1-2(a): intangible property held in the ordinary course of business, unclaimed more than 3 years after it became payable.",
    payrollYears: 1,
    payrollRule: "§ 33-21.1-15: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("§ 33-21.1-17(d)"),
    citation: "R.I. Gen. Laws § 33-21.1-2(a)",
    sourceUrl: `${RI}33-21.1-2.htm`,
    payrollSource: src("R.I. Gen. Laws § 33-21.1-15", `${RI}33-21.1-15.htm`),
    reportSource: src("R.I. Gen. Laws § 33-21.1-17(d)", `${RI}33-21.1-17.htm`)
  }),
  row("SC", {
    vendorYears: 5,
    vendorRule: "§ 27-18-30(A): intangible property held in the ordinary course of business, unclaimed more than 5 years after it became payable.",
    payrollYears: 1,
    payrollRule: "§ 27-18-160: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("§ 27-18-180(D)"),
    citation: "S.C. Code §§ 27-18-30(A), 27-18-160, 27-18-180(D)",
    sourceUrl: "https://www.scstatehouse.gov/code/t27c018.php"
  }),
  row("SD", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "SDCL 43-41B-2: intangible property held or owing in the ordinary course of a holder’s business, unclaimed more than 3 years after it became payable or distributable.",
    payrollYears: 1,
    payrollRule: "SDCL 43-41B-16: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: NOV1_JUNE30("SDCL 43-41B-18"),
    citation: "SDCL 43-41B-2",
    sourceUrl: "https://sdlegislature.gov/api/Statutes/43-41B-2.html",
    payrollSource: src20("SDCL 43-41B-16", "https://sdlegislature.gov/api/Statutes/43-41B-16.html"),
    reportSource: src20("SDCL 43-41B-18", "https://sdlegislature.gov/api/Statutes/43-41B-18.html")
  }),
  row("TN", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Treasury’s dormancy periods: vendor checks and business expense checks, 3 years (property code CK13; MS08, accounts payable, is also 3 years).",
    payrollYears: 1,
    payrollRule: "Treasury’s dormancy periods: wages and wage-related expense checks, 1 year (property code MS01).",
    report: due(11, 1, "By November 1, for property presumed abandoned as of the June 30 before it (the Treasury’s reporting instructions)."),
    citation: "Tennessee Treasury, Uniform Disposition of Unclaimed Property Act Reporting Instructions (updated June 2026), Dormancy Periods",
    sourceUrl: "https://treasury.tn.gov/Portals/0/Documents/Unclaimed%20Property/Reporting/TNReporting-CompleteReportingGuide.pdf",
    vendorException: "The Treasury’s instructions say property between businesses is not exempt but may be deferred until the business relationship ends, citing Tenn. Code Ann. § 66-29-105(c)(1).",
    notes: "Read in the Treasury’s published reporting instructions for Tenn. Code Ann. title 66, chapter 29. The Code’s online text is hosted by a commercial publisher and was not read here."
  }),
  row("TX", {
    checkedOn: OCT20,
    vendorYears: 3,
    vendorRule: "Tex. Prop. Code § 72.101(a): personal property is presumed abandoned if, for longer than 3 years, the owner’s location is unknown to the holder and no claim or act of ownership has occurred.",
    payrollYears: 1,
    payrollRule: "Tex. Prop. Code § 72.1015(b): unclaimed wages, on the same conditions, for longer than 1 year.",
    report: due(7, 1, "On or before July 1, for property held on the March 1 before it (§ 74.101(a))."),
    citation: "Tex. Prop. Code §§ 72.101(a), 72.1015(b)",
    sourceUrl: "https://tcss.legis.texas.gov/resources/PR/htm/PR.72.htm",
    reportSource: src20("Tex. Prop. Code § 74.101(a)", "https://tcss.legis.texas.gov/resources/PR/htm/PR.74.htm"),
    notes: "“Wages” has the meaning in Labor Code § 61.001 (§ 72.1015(a))."
  }),
  row("UT", {
    vendorYears: 3,
    vendorRule: "Utah Code § 67-4a-201(14): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "Utah Code § 67-4a-201(12): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: NOV1_JULY("§ 67-4a-403(1)"),
    citation: "Utah Code § 67-4a-201(12), (14)",
    sourceUrl: "https://le.utah.gov/xcode/Title67/Chapter4A/C67-4a-S201_2026050620260506.html",
    reportSource: src("Utah Code § 67-4a-403(1)", "https://le.utah.gov/xcode/Title67/Chapter4A/C67-4a-S403_2017050920170509.html"),
    notes: "Read in the version of § 67-4a-201 effective May 6, 2026."
  }),
  row("VA", {
    vendorYears: 5,
    vendorRule: "§ 55.1-2501: property held in the ordinary course of business, unclaimed more than 5 years after it became payable.",
    payrollYears: 1,
    payrollRule: "§ 55.1-2516: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(11, 1, "Before November 1, for the period ending June 30 of that year (§ 55.1-2524(D))."),
    citation: "Va. Code § 55.1-2501",
    sourceUrl: `${VA}section55.1-2501/`,
    payrollSource: src("Va. Code § 55.1-2516", `${VA}section55.1-2516/`),
    reportSource: src("Va. Code § 55.1-2524(D)", `${VA}section55.1-2524/`)
  }),
  row("VT", {
    vendorYears: 3,
    vendorRule: "27 V.S.A. § 1461(13): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "27 V.S.A. § 1461(11): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: due(5, 1, "Before May 1, covering the 12 months before January 1 (§ 1493(a))."),
    citation: "27 V.S.A. §§ 1461(11), (13), 1493(a)",
    sourceUrl: "https://legislature.vermont.gov/statutes/fullchapter/27/018"
  }),
  row("WA", {
    vendorYears: 3,
    vendorRule: "RCW 63.30.040(17): property not specified elsewhere, 3 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "RCW 63.30.040(11): wages, commissions or bonuses owed to an employee, or other pay for personal services, 1 year after payable.",
    report: due(10, 31, "On or before October 31, covering the 12 months before July 1 (RCW 63.30.240(1))."),
    citation: "RCW 63.30.040(11), (17); 63.30.240(1)",
    sourceUrl: "https://app.leg.wa.gov/RCW/default.aspx?cite=63.30&full=true"
  }),
  row("WI", {
    vendorYears: 5,
    vendorRule: "§ 177.0201(13): property not specified elsewhere, 5 years after the right to demand it or the obligation to pay arises, whichever is earlier.",
    payrollYears: 1,
    payrollRule: "§ 177.0201(11): wages, commissions, bonuses or reimbursements owed to an employee, 1 year after payable.",
    report: due(11, 1, "On or before November 1, covering the 12 months before July 1 (§ 177.0403(1))."),
    citation: "Wis. Stat. §§ 177.0201(11), (13), 177.0403(1)",
    sourceUrl: "https://docs.legis.wisconsin.gov/statutes/statutes/177.pdf",
    vendorException: "§ 177.015(2)(b): the chapter does not apply to a payment or credit a business association owes another business association in the ordinary course of business."
  }),
  row("WV", {
    vendorYears: 3,
    vendorRule: "§ 36-8-2(a)(18): all other property, 3 years after the right to demand it or the obligation to pay arises, whichever is first.",
    payrollYears: 1,
    payrollRule: "§ 36-8-2(a)(12): wages or other pay for personal services, 1 year after it becomes payable.",
    report: NOV1_JULY("§ 36-8-7(d)"),
    citation: "W. Va. Code § 36-8-2(a)(12), (18)",
    sourceUrl: `${WV}36-8-2/`,
    reportSource: src("W. Va. Code § 36-8-7(d)", `${WV}36-8-7/`)
  }),
  row("WY", {
    checkedOn: OCT20,
    vendorYears: 5,
    vendorRule: "W.S. 34-24-103(a): intangible property held, issued or owing in the ordinary course of a holder’s business, unclaimed more than 5 years after it became payable or distributable.",
    payrollYears: 1,
    payrollRule: "W.S. 34-24-115: unpaid wages, including unpresented payroll checks, unclaimed more than 1 year after becoming payable.",
    report: due(11, 1, "No later than November 1, for the reporting period ending the June 30 before it (W.S. 34-24-118(d))."),
    citation: "W.S. 34-24-103(a), 34-24-115, 34-24-118(d)",
    sourceUrl: "https://wyoleg.gov/statutes/compress/title34.pdf",
    notes: "Read in the Legislature’s compiled Title 34, chapter 24. The separate check section, W.S. 34-24-106, covers checks a banking or financial organization is directly liable on (also 5 years)."
  })
];
var NOT_READ = "Not read from an official source for this table yet.";
var WHY = {};
var DORMANCY_NOT_COVERED = REF_US_STATES_DC.filter((m) => !DORMANCY_ROWS.some((r) => r.code === m.code)).map((m) => ({ code: m.code, reason: WHY[m.code] ?? NOT_READ }));
var DORMANCY_TABLE = {
  id: "uncashed-check-dormancy-periods",
  label: "unclaimed property dormancy periods for uncashed vendor and payroll checks",
  checkedOn: OCT20,
  members: REF_US_STATES_DC,
  rows: DORMANCY_ROWS,
  notCovered: DORMANCY_NOT_COVERED
};
function dormancyMoreSources(r) {
  return [r.payrollSource, r.reportSource].filter((s) => s !== void 0);
}
function findDormancyRow(code, table = DORMANCY_TABLE) {
  return table.rows.find((r) => r.code === code);
}
function dormancyYears(r, kind) {
  return kind === "vendor" ? r.vendorYears : r.payrollYears;
}
function checkDormancyTable(table = DORMANCY_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, (r) => r.code, dormancyMoreSources));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const years = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 10;
  const badYears = rows.filter((r) => !years(r.vendorYears) || !years(r.payrollYears)).map((r) => r.code);
  checks.that("dormancy-years", "Every period is a whole number of years from 1 to 10", badYears.length === 0, `not a whole number of years from 1 to 10: ${badYears.join(", ")}`);
  const named = (s) => typeof s === "string" && s.trim().length >= 12;
  const unnamed = rows.filter((r) => !named(r.vendorRule) || !named(r.payrollRule)).map((r) => r.code);
  checks.that("dormancy-rules-named", "Every row says which paragraph each period comes from", unnamed.length === 0, `no paragraph named: ${unnamed.join(", ")}`);
  const badReport = rows.filter((r) => {
    if (r.report === null) return false;
    const m = r.report?.month;
    const d = r.report?.day;
    if (typeof m !== "number" || typeof d !== "number" || !Number.isSafeInteger(m) || !Number.isSafeInteger(d) || m < 1 || m > 12) return true;
    return d < 1 || d > daysInMonth(2027, m) || !named(r.report.text);
  }).map((r) => r.code);
  checks.that("dormancy-report-date", "Every report date is a real day of the year, with its wording", badReport.length === 0, `report date not a real day or has no wording: ${badReport.join(", ")}`);
  return checks.all;
}
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dayWords(month, day) {
  return `${MONTH_NAMES[month - 1] ?? `month ${month}`} ${day}`;
}
function dayKey(month, day) {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
var yearsWords = (n) => `${n} ${n === 1 ? "year" : "years"}`;
var codeList = (codes) => [...codes].sort().join(",") || "-";
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function whoHas(codes, members) {
  if (codes.length === 0) return "none";
  return codes.length <= 5 ? refNameList(codes, members) : `${codes.length} of them`;
}
function joinParts(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  const semi = parts.some((p) => p.includes(",") || p.includes(" and "));
  return `${parts.slice(0, -1).join(semi ? "; " : ", ")}${semi ? "; and " : " and "}${parts[parts.length - 1]}`;
}
function rowsCounted(states, dc) {
  return `${refCount(states, "state", "states")}${dc ? " and the District of Columbia" : ""}`;
}
function oneRowPerMember(table) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const out = [];
  for (const m of table.members) {
    const r = rows.find((x) => x.code === m.code);
    if (r) out.push(r);
  }
  return out;
}
function yearsSummary(most, groups) {
  return [`most common ${most}`, ...[...groups].sort((a, b) => a[0] - b[0]).map(([y, codes]) => `${y}: ${codeList(codes)}`)].join("; ");
}
function yearsByCounting(rows, value) {
  const groups = [];
  let most = 0;
  let mostCount = 0;
  for (let y = 1; y <= 10; y += 1) {
    const codes = rows.filter((r) => value(r) === y).map((r) => r.code);
    if (codes.length === 0) continue;
    groups.push([y, codes]);
    if (codes.length > mostCount) {
      most = y;
      mostCount = codes.length;
    }
  }
  return yearsSummary(most, groups);
}
function reportSummaryText(s) {
  return [
    `most common ${s.top || "-"}`,
    `before: ${codeList(s.before)}`,
    `no later than: ${codeList(s.noLater)}`,
    `otherwise: ${codeList(s.otherwise)}`,
    `others: ${s.others}`,
    `earliest ${s.earliest || "-"}: ${codeList(s.earliestCodes)}`,
    `latest ${s.latest || "-"}: ${codeList(s.latestCodes)}`,
    `none read: ${codeList(s.undated)}`
  ].join("; ");
}
function wordingBefore(text, words) {
  const lower = String(text).toLowerCase();
  const target = words.toLowerCase();
  let at = lower.indexOf(target);
  while (at >= 0 && "0123456789".includes(lower.charAt(at + target.length) || "x")) at = lower.indexOf(target, at + 1);
  if (at < 0) return "otherwise";
  const head = lower.slice(0, at).trimEnd();
  if (head.endsWith("on or before") || head.endsWith("no later than") || head === "by" || head.endsWith(" by")) return "no later than";
  if (head === "before" || head.endsWith(" before")) return "before";
  return "otherwise";
}
function dormancyFindings(table = DORMANCY_TABLE) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const members = table.members;
  const who = (codes) => whoHas(codes, members);
  const id = (finding) => `${table.id}-${finding}`;
  const second = oneRowPerMember(table);
  const findings = [];
  const checks = new CheckList();
  const say = (finding, text) => {
    if (rows.length > 0) findings.push({ id: finding, text });
  };
  const dcRows = rows.filter((r) => r.code === "DC").length;
  const lead = `Of the ${rowsCounted(rows.length - dcRows, dcRows > 0)} with a row`;
  checks.equal(
    id("rows"),
    "The rows the findings count, counted a second way (each member with a row, once)",
    rowsCounted(second.filter((r) => r.code !== "DC").length, second.some((r) => r.code === "DC")),
    rowsCounted(rows.length - dcRows, dcRows > 0)
  );
  const columns = [
    ["vendor-years", "vendor", (r) => r.vendorYears],
    ["payroll-years", "payroll", (r) => r.payrollYears]
  ];
  for (const [finding, kind, value] of columns) {
    const tally = refTally(rows.map((r) => ({ code: r.code, value: value(r) })));
    say(finding, `${lead}, the period for an uncashed ${kind} check is ${joinParts(tally.map((g) => `${yearsWords(g.value)} in ${who(g.codes)}`))}.`);
    checks.equal(
      id(finding),
      `The ${kind} check periods and the states at each, counted a second way (each whole year from 1 to 10 in turn)`,
      yearsByCounting(second, value),
      yearsSummary(tally[0]?.value ?? 0, tally.map((g) => [g.value, g.codes]))
    );
    checks.equal(id(`${finding}-groups`), `The ${kind} check groups add up to the rows, counted a second way`, second.length, tally.reduce((n, g) => n + g.codes.length, 0));
  }
  const shorter = rows.filter((r) => r.payrollYears < r.vendorYears).map((r) => r.code);
  const same = rows.filter((r) => r.payrollYears === r.vendorYears).map((r) => r.code);
  const longer = rows.filter((r) => r.payrollYears > r.vendorYears).map((r) => r.code);
  say(
    "payroll-vs-vendor",
    `${lead}, the period for a payroll check is ${joinParts([`shorter than the one for a vendor check in ${who(shorter)}`, `the same in ${who(same)}`, `longer in ${who(longer)}`])}.`
  );
  const bySign = { shorter: [], same: [], longer: [] };
  for (const r of second) {
    const s = Math.sign(r.vendorYears - r.payrollYears);
    if (s === 1) bySign.shorter.push(r.code);
    else if (s === 0) bySign.same.push(r.code);
    else if (s === -1) bySign.longer.push(r.code);
  }
  const compareText = (a, b, c) => `shorter: ${codeList(a)}; same: ${codeList(b)}; longer: ${codeList(c)}`;
  checks.equal(
    id("payroll-vs-vendor"),
    "Which rows give a payroll period shorter than, the same as, or longer than the vendor period, counted a second way (the sign of the difference)",
    compareText(bySign.shorter, bySign.same, bySign.longer),
    compareText(shorter, same, longer)
  );
  checks.equal(id("payroll-vs-vendor-groups"), "The shorter, same and longer groups add up to the rows, counted a second way", second.length, shorter.length + same.length + longer.length);
  const dated = rows.filter((r) => r.report);
  const undated = rows.filter((r) => !r.report).map((r) => r.code);
  const dayOf = (r) => r.report.month * 100 + r.report.day;
  const top = refTally(dated.map((r) => ({ code: r.code, value: dayOf(r) })))[0];
  const topRows = top ? dated.filter((r) => dayOf(r) === top.value) : [];
  const topWords = top ? dayWords(Math.floor(top.value / 100), top.value % 100) : "";
  const wordingRe = new RegExp(`\\b(on or before|no later than|by|before) ${escapeRegExp(topWords)}(?!\\d)`, "i");
  const worded = { before: [], "no later than": [], otherwise: [] };
  for (const r of topRows) {
    const m = wordingRe.exec(r.report.text);
    worded[!m ? "otherwise" : m[1].toLowerCase() === "before" ? "before" : "no later than"].push(r.code);
  }
  const others = top ? dated.filter((r) => dayOf(r) !== top.value) : [];
  const ends = refExtremes(others.map((r) => ({ code: r.code, value: dayOf(r) })).filter((v) => Number.isSafeInteger(v.value)));
  const endWords = (v) => dayWords(Math.floor(v / 100), v % 100);
  const endKey = (v) => dayKey(Math.floor(v / 100), v % 100);
  const due2 = [worded.before.length ? `before ${topWords} in ${who(worded.before)}` : "", worded["no later than"].length ? `no later than ${topWords} in ${who(worded["no later than"])}` : ""].filter(Boolean);
  let clause = due2.length ? `due ${joinParts(due2)}` : "";
  if (worded.otherwise.length) clause = `${clause ? `${clause}, and ` : ""}tied to ${topWords} in other words in ${who(worded.otherwise)}`;
  const reportParts = top ? [`${lead}, the annual report for business holders is ${clause}`] : [`${lead}, no annual report date was read`];
  if (others.length > 0 && ends) {
    const theOther = others.length === 1 ? "the other one" : `the other ${others.length}`;
    reportParts.push(
      ends.min === ends.max ? `in ${theOther} the date is ${endWords(ends.min)} (${who(ends.minCodes)})` : `in ${theOther} the date ranges from ${endWords(ends.min)} (${who(ends.minCodes)}) to ${endWords(ends.max)} (${who(ends.maxCodes)})`
    );
  }
  if (top && undated.length > 0) reportParts.push(`no report date was read for ${who(undated)}`);
  say("report-date", `${reportParts.join("; ")}.`);
  const firstReport = {
    top: top ? endKey(top.value) : "",
    before: worded.before,
    noLater: worded["no later than"],
    otherwise: worded.otherwise,
    others: others.length,
    earliest: ends ? endKey(ends.min) : "",
    earliestCodes: ends?.minCodes ?? [],
    latest: ends ? endKey(ends.max) : "",
    latestCodes: ends?.maxCodes ?? [],
    undated
  };
  const byDay = {};
  const undated2 = [];
  for (const r of second) {
    if (!r.report) undated2.push(r.code);
    else (byDay[dayKey(r.report.month, r.report.day)] ??= []).push(r);
  }
  const days = Object.keys(byDay).sort();
  let top2 = "";
  for (const k of days) if (top2 === "" || byDay[k].length > byDay[top2].length) top2 = k;
  const worded2 = { before: [], "no later than": [], otherwise: [] };
  if (top2) {
    const [m, d] = top2.split("-").map(Number);
    for (const r of byDay[top2]) worded2[wordingBefore(r.report.text, dayWords(m, d))].push(r.code);
  }
  const otherDays = days.filter((k) => k !== top2);
  const earliest2 = otherDays[0] ?? "";
  const latest2 = otherDays[otherDays.length - 1] ?? "";
  const secondReport = {
    top: top2,
    before: worded2.before,
    noLater: worded2["no later than"],
    otherwise: worded2.otherwise,
    others: otherDays.reduce((n, k) => n + byDay[k].length, 0),
    earliest: earliest2,
    earliestCodes: earliest2 ? byDay[earliest2].map((r) => r.code) : [],
    latest: latest2,
    latestCodes: latest2 ? byDay[latest2].map((r) => r.code) : [],
    undated: undated2
  };
  checks.equal(
    id("report-date"),
    "The most common report day, how each row there words it, and the earliest and latest of the rest, counted a second way (days written out, wording read by its position)",
    reportSummaryText(secondReport),
    reportSummaryText(firstReport)
  );
  checks.equal(
    id("report-date-groups"),
    "The report date groups (before, no later than, other wording, other days, none read) add up to the rows, counted a second way",
    second.length,
    worded.before.length + worded["no later than"].length + worded.otherwise.length + others.length + undated.length
  );
  const named = (r, words) => new RegExp(`${escapeRegExp(words)}(?!\\d)`, "i").test(r.report.text);
  const unnamed = [
    ...topRows.filter((r) => !named(r, topWords)),
    ...ends ? others.filter((r) => (dayOf(r) === ends.min || dayOf(r) === ends.max) && !named(r, endWords(dayOf(r)))) : []
  ].map((r) => r.code);
  checks.that(
    id("report-date-words"),
    "Each row counted at the most common report day, the earliest or the latest names that day in its own wording",
    unnamed.length === 0,
    `the row's wording does not name the day it is counted at: ${codeList(unnamed)}`
  );
  const noted = rows.filter((r) => typeof r.vendorException === "string" && r.vendorException.trim() !== "").map((r) => r.code);
  const notNoted = rows.filter((r) => !(typeof r.vendorException === "string" && r.vendorException.trim() !== "")).length;
  const rest = notNoted === 1 ? "the row for the other one notes none" : `the rows for the other ${notNoted} note none`;
  say(
    "between-businesses",
    noted.length === 0 ? `${lead}, no row notes a rule the law makes for property owed between businesses.` : `${lead}, the rows for ${who(noted)} note a rule the law makes for property owed between businesses (an exemption or a business-relationship rule)${notNoted > 0 ? `; ${rest}` : ""}.`
  );
  const noted2 = second.filter((r) => /\S/.test(String(r.vendorException ?? ""))).map((r) => r.code);
  const notedText = (codes, none) => `noted: ${codeList(codes)}; not noted: ${none}`;
  checks.equal(
    id("between-businesses"),
    "The rows that note a rule for checks between businesses, and the rest, counted a second way",
    notedText(noted2, second.length - noted2.length),
    notedText(noted, notNoted)
  );
  checks.equal(id("between-businesses-groups"), "The rows that note such a rule and the rows that do not add up to the rows, counted a second way", second.length, noted.length + notNoted);
  return { findings, checks: checks.all };
}
function dormancyPeriodEnd(input, table = DORMANCY_TABLE) {
  const code = typeof input.state === "string" ? input.state.trim().toUpperCase() : "";
  const r = findDormancyRow(code, table);
  if (!r) throw new Error(`${refMemberName(REF_US_STATES_DC, code) || "That state"} is not in the table yet.`);
  if (input.kind !== "vendor" && input.kind !== "payroll") throw new Error("The kind of check must be vendor or payroll.");
  const checkDate = refParseDay(input.checkDate, "check date");
  const asOf = refParseDay(input.asOf, "as-of date");
  const years = dormancyYears(r, input.kind);
  const periodEnds = refAddYears(checkDate, years);
  const daysFromAsOf = refDaysBetween(asOf, periodEnds);
  const result = { row: r, kind: input.kind, checkDate, asOf, years, periodEnds, daysFromAsOf };
  return { ...result, checks: verifyDormancyPeriodEnd(result, table) };
}
function ordinalDay(iso) {
  const d = parseCivilDate(iso);
  let n = 0;
  for (let y = 1900; y < d.year; y += 1) n += isLeapYear(y) ? 366 : 365;
  for (let m = 1; m < d.month; m += 1) n += daysInMonth(d.year, m);
  return n + d.day;
}
function yearsLater(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y + years;
  const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d;
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function verifyDormancyPeriodEnd(r, table = DORMANCY_TABLE) {
  const checks = new CheckList();
  const tableRow = findDormancyRow(r.row.code, table);
  const fromTable = tableRow !== void 0 && dormancyYears(tableRow, r.kind) === r.years && tableRow.citation === r.row.citation;
  checks.that("row-from-table", `The period used is the table row's figure for a ${r.kind} check in this state`, fromTable, "The years or citation in the result differ from the table row");
  checks.equal("end-second-way", "The end date, written out a second way (same month and day, the year moved on)", yearsLater(r.checkDate, r.years), r.periodEnds);
  const back = refAddMonths(r.periodEnds, -12 * r.years);
  const feb29 = r.checkDate.endsWith("-02-29") && r.periodEnds.endsWith("-02-28");
  const expectBack = feb29 ? `${r.checkDate.slice(0, 8)}28` : r.checkDate;
  checks.equal("end-counted-back", "Counting the years back from the end date lands on the check date", expectBack, back);
  checks.equal("days-second-way", "Days from the as-of date to the end date, counted a second way", ordinalDay(r.periodEnds) - ordinalDay(r.asOf), r.daysFromAsOf);
  checks.equal("days-counted-back", "Counting the days back from the end date lands on the as-of date", r.asOf, refAddDays(r.periodEnds, -r.daysFromAsOf));
  const exception = r.kind === "vendor" ? (tableRow ?? r.row).vendorException : "";
  checks.that(
    "vendor-exception",
    "The law sets no exception for checks between businesses that the date leaves out",
    !exception,
    `The row notes an exception for checks between businesses: ${exception} The date shown is only the row's period added to the check date.`,
    "warning"
  );
  return checks.all;
}

export {
  DORMANCY_ROWS,
  DORMANCY_NOT_COVERED,
  DORMANCY_TABLE,
  dormancyMoreSources,
  findDormancyRow,
  dormancyYears,
  checkDormancyTable,
  dormancyFindings,
  dormancyPeriodEnd,
  verifyDormancyPeriodEnd
};
