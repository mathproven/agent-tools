---
name: property-managers
description: "Checked math for property managers, run where the assistant runs, on the person's own records and figures: CAM reconciliation: common area costs split by tenant square footage; CAM gross-up: variable expenses grossed up to an occupancy, then split by tenant share; base year and expense stop: each tenant’s share of operating expenses above the base; owner statement for a managed rental from a ledger; security deposit interest and itemized deposit statement; short-term rental payouts matched to bank deposits; and 4 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Can you split this year’s common area costs among my tenants by square footage, with a 10% admin fee?\" or \"Our building was 80% occupied last year. Can you gross up the variable CAM expenses to 95% and work out each tenant’s share?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.2"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Property managers: checked math from Mathproven

These tools run Mathproven's own calculations on the person's files and figures, where the assistant runs (this computer, or the assistant's own sandbox), the same way the pages on mathproven.com do. Nothing is sent to Mathproven. Each result is recomputed a second way. A verified result comes with a reconciliation certificate; a result whose check fails comes back as NOT VERIFIED, names the failed check, and gives no figures.

## How to run a tool

The script is `scripts/mathproven.mjs` in this skill's folder (written below as `${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs`; where that variable is not set, use this folder's path). It needs Node.js 18 or later and nothing else.

- `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs list` lists the tools here; `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs describe <tool>` prints one tool's inputs.
- Every input is given as `--<input> <value>`, or as `--<input>=<value>` (for a value that starts with `--`), or all at once as `--json '{"<input>": "<value>"}'`. A file input takes the path to a .csv or .xlsx file, or the CSV text itself.
- Amounts are written as text ("1,234.56"); dates as YYYY-MM-DD.
- `--saveTo <path ending .xlsx or .csv>` saves the full result and its certificate (never over an existing file). A template's blank workbook is saved under its own name in the current folder, or where `--saveTo` says.
- Exit code 0: verified. 2: NOT VERIFIED (a check failed). 1: nothing was calculated; the message says why.
- Without a key, a tool reads one file a run, as the free plan on mathproven.com does. A key from a Mathproven account page, given as `--key <key>`, applies the account's plan; it is checked here and never sent anywhere.

## Tools

Each tool's inputs and what it checks are in [references/tools.md](references/tools.md); `describe <tool>` prints the same.

- `cam_reconciliation_tenant_shares`: CAM reconciliation: common area costs split by tenant square footage. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_reconciliation_tenant_shares --expenses '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'`
- `cam_gross_up_pool_split`: CAM gross-up: variable expenses grossed up to an occupancy, then split by tenant share. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_gross_up_pool_split --totalLeasableSquareFeet '<number>' --occupiedSquareFeet '<text>' --grossUpOccupancyPercent '<number>' --lines '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'`
- `base_year_expense_stop_true_up`: Base year and expense stop: each tenant’s share of operating expenses above the base. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs base_year_expense_stop_true_up --totalLeasableSquareFeet '<number>' --lines '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'`
- `owner_statement_from_ledger`: Owner statement for a managed rental from a ledger. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs owner_statement_from_ledger --ledger '<path to a .csv or .xlsx file>' --periodStart '<YYYY-MM-DD>' --periodEnd '<YYYY-MM-DD>'`
- `security_deposit_interest_statement`: Security deposit interest and itemized deposit statement. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs security_deposit_interest_statement --deposit '<amount, such as 1,234.56>' --receivedOn '<YYYY-MM-DD>' --moveOutOn '<YYYY-MM-DD>' --annualRatePercent '<number>'`
- `short_term_rental_payout_reconciler`: Short-term rental payouts matched to bank deposits. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs short_term_rental_payout_reconciler --payoutReport '<path to a .csv or .xlsx file>' --bankStatement '<path to a .csv or .xlsx file>'`
- `cam_reconciliation_template_workbook`: CAM reconciliation template workbook (Excel) to fill in. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_reconciliation_template_workbook`
- `owner_statement_template_workbook`: Owner statement template workbook (Excel) with a ledger sheet. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs owner_statement_template_workbook`
- `rent_late_fee_limits`: Residential rent late fee limits and grace periods by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs rent_late_fee_limits --member '<text>'`
- `security_deposit_rules`: Residential security deposit rules by state: maximum, return period, interest. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs security_deposit_rules --member '<text>'`
