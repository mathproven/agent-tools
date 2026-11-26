---
name: e-commerce-sellers
description: "Checked math for E-commerce sellers, run where the assistant runs, on the person's own records and figures: monthly books from a marketplace payment or ledger export; journal entry for one marketplace payout, matched to the bank deposit; sales tax collected by ship-to state from an order export; sales by product from an orders export; online seller bookkeeping workbook (Excel template); profit, margin and break-even price on one item sold online; economic nexus thresholds for remote sellers, by state. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Here is my shop's payment account export for March and April. Can you total it by month and give me a journal entry for each month?\" or \"Can you turn this payout's rows into a journal entry and check it against the deposit in my bank?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.3"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# E-commerce sellers: checked math from Mathproven

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

- `marketplace_payments_to_monthly_books`: Monthly books from a marketplace payment or ledger export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs marketplace_payments_to_monthly_books --ledger '<path to a .csv or .xlsx file>'`
- `marketplace_payout_journal_entry`: Journal entry for one marketplace payout, matched to the bank deposit. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs marketplace_payout_journal_entry`
- `sales_tax_collected_by_state`: Sales tax collected by ship-to state from an order export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs sales_tax_collected_by_state --orders '<path to a .csv or .xlsx file>'`
- `sales_by_product_from_orders_export`: Sales by product from an orders export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs sales_by_product_from_orders_export --orders '<path to a .csv or .xlsx file>'`
- `online_seller_bookkeeping_template`: Online seller bookkeeping workbook (Excel template). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs online_seller_bookkeeping_template`
- `online_seller_profit_calculator`: Profit, margin and break-even price on one item sold online. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs online_seller_profit_calculator --price '<amount, such as 1,234.56>'`
- `economic_nexus_thresholds`: Economic nexus thresholds for remote sellers, by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs economic_nexus_thresholds --member '<text>'`
