---
name: law-firm-trust-accounts
description: "Checked math for law firm trust accounts, run where the assistant runs, on the person's own records and figures: three-way trust account reconciliation to the cent; client trust ledger card: one client, balance after every line; trust receipts and disbursements journal with client subtotals; trust account scan for client ledgers below zero, by date; client trust ledgers rebuilt from a bank statement export; and 4 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Can you do the three-way reconciliation of our trust account for March 31? The bank shows $48,250, the checkbook $49,199.25, and here are the client balances and outstanding checks.\" or \"Can you make the trust ledger card for the Cedar closing matter from this export and check the balance never went negative?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.1"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Law firm trust accounts: checked math from Mathproven

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

- `three_way_trust_reconciliation`: Three-way trust account reconciliation to the cent. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs three_way_trust_reconciliation`
- `client_trust_ledger_card`: Client trust ledger card: one client, balance after every line. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs client_trust_ledger_card --entries '<path to a .csv or .xlsx file>'`
- `trust_receipts_disbursements_journal`: Trust receipts and disbursements journal with client subtotals. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_receipts_disbursements_journal --entries '<path to a .csv or .xlsx file>'`
- `trust_negative_balance_scan`: Trust account scan for client ledgers below zero, by date. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_negative_balance_scan --transactions '<path to a .csv or .xlsx file>'`
- `trust_ledgers_from_bank_statement`: Client trust ledgers rebuilt from a bank statement export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_ledgers_from_bank_statement --statement '<path to a .csv or .xlsx file>' --openingBalance '<amount, such as 1,234.56>' --closingBalance '<amount, such as 1,234.56>'`
- `earned_fees_left_in_trust`: Earned fees left in trust: billed fees not transferred, by client and age. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs earned_fees_left_in_trust --transactions '<path to a .csv or .xlsx file>' --invoices '<path to a .csv or .xlsx file>'`
- `dormant_trust_balance_report`: Dormant trust balances: client balances with no activity, by age. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs dormant_trust_balance_report --transactions '<path to a .csv or .xlsx file>' --period '<number>'`
- `three_way_reconciliation_template`: Three-way trust reconciliation workbook to fill in. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs three_way_reconciliation_template`
- `trust_record_retention_by_state`: Lawyer trust account record retention periods by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_record_retention_by_state --member '<text>'`
