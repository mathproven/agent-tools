// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  readXlsx
} from "./fflate.mjs";
import {
  isIsoDate
} from "./reconcile.mjs";
import {
  CheckList
} from "./money.mjs";

// packages/core/src/property/templates.ts
var MAX_ROWS = 500;
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ROWS) throw new Error(`${label} must be a whole number from 1 to ${MAX_ROWS}.`);
  return value;
}
function period(start, end) {
  if (start && !isIsoDate(start)) throw new Error("The period start is not a valid date.");
  if (end && !isIsoDate(end)) throw new Error("The period end is not a valid date.");
  if (start && end && end < start) throw new Error("The period end is before the period start.");
}
var CAM_TEMPLATE_EXPENSE_HEADERS = ["Line", "Expense category", "Amount", "Recoverable (Yes or No)"];
var CAM_TEMPLATE_TENANT_HEADERS = ["Line", "Tenant", "Square feet", "Fixed share percent (optional)", "Estimates paid"];
function camTemplateSheets(o) {
  const tenants = count(o.tenantCount, "The number of tenants");
  const expenses = count(o.expenseRows ?? 12, "The number of expense rows");
  period(o.periodStart, o.periodEnd);
  return [
    {
      name: "Property",
      rows: [
        ["Item", "Value"],
        ["Property", o.property.trim()],
        ["Period start", o.periodStart],
        ["Period end", o.periodEnd],
        ["Total leasable square feet", ""],
        ["Admin fee on tenant share (percent)", ""]
      ],
      money: [],
      widths: [38, 32]
    },
    {
      name: "Expenses",
      rows: [[...CAM_TEMPLATE_EXPENSE_HEADERS], ...Array.from({ length: expenses }, (_, i) => [i + 1, "", "0.00", "Yes"])],
      money: ["Amount"],
      widths: [8, 36, 16, 24]
    },
    {
      name: "Tenants",
      rows: [[...CAM_TEMPLATE_TENANT_HEADERS], ...Array.from({ length: tenants }, (_, i) => [i + 1, "", "", "", "0.00"])],
      money: ["Estimates paid"],
      widths: [8, 32, 14, 30, 16]
    },
    {
      name: "Instructions",
      rows: [
        ["How this workbook is laid out"],
        ["Property: the building, the period, the total leasable square feet (occupied or not), and the admin fee percent if the leases have one."],
        ["Expenses: one row per common area expense category for the period. Mark a row No under Recoverable to keep it out of the shared pool."],
        ["Tenants: one row per tenant with the leased square feet and the estimated payments received during the period."],
        ["Fixed share percent: fill this in only where a lease sets a fixed share; it is then used instead of square footage for that tenant."],
        ["Amounts are plain numbers. This workbook holds values only and contains no formulas, so nothing in it calculates."],
        ["The CAM reconciliation tool on the same site takes these same numbers, splits the pool to the penny, and shows the checks it ran."],
        ["Rows left blank are fine. Add more rows under the last one if the property has more tenants or expense categories."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
var OWNER_TEMPLATE_LEDGER_HEADERS = ["Date", "Description", "Amount", "Type"];
function ownerStatementTemplateSheets(o) {
  const rows = count(o.ledgerRows, "The number of ledger rows");
  period(o.periodStart, o.periodEnd);
  return [
    {
      name: "Statement",
      rows: [
        ["Item", "Value"],
        ["Owner", o.owner.trim()],
        ["Property", o.property.trim()],
        ["Period start", o.periodStart],
        ["Period end", o.periodEnd],
        ["Opening balance", ""],
        ["Management fee (percent of income)", ""],
        ["Reserve held (optional)", ""],
        ["Total income", ""],
        ["Total expenses", ""],
        ["Management fee", ""],
        ["Paid to owner", ""],
        ["Closing balance", ""]
      ],
      money: [],
      widths: [38, 32]
    },
    {
      name: "Ledger",
      rows: [[...OWNER_TEMPLATE_LEDGER_HEADERS], ...Array.from({ length: rows }, () => ["", "", "0.00", ""])],
      money: ["Amount"],
      widths: [14, 44, 16, 18]
    },
    {
      name: "Instructions",
      rows: [
        ["How this workbook is laid out"],
        ["Statement: the owner, the property, the period, the opening balance, the management fee percent, and the reserve if one is held."],
        ["Ledger: one row per transaction in the period, with the date, a description, the amount, and the type."],
        ["Type is one of: Income, Expense, Distribution. Distribution means money paid to the owner."],
        ["Amounts are plain positive numbers. Rows left at 0.00 are skipped when the ledger is opened in the tool."],
        ["This workbook holds values only and contains no formulas, so the totals on the Statement sheet do not fill themselves in."],
        ["The owner statement tool on the same site opens the Ledger sheet, works out the totals, the fee, and the closing balance, and shows the checks it ran."],
        ["Closing balance = opening balance + income − expenses − management fee − paid to owner. It carries into the next period as the opening balance."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
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
  for (const s of sheets) for (const row of s.rows) for (const c of row) if (typeof c === "string" && /^=/.test(c)) formulas = true;
  checks.that("values-only", "The workbook holds values only, no formulas", !formulas);
  return checks.all;
}

export {
  camTemplateSheets,
  ownerStatementTemplateSheets,
  verifyTemplateWorkbook
};
