---
name: bookkeepers-and-accountants
description: "Checked math for bookkeepers and accountants, run where the assistant runs, on the person's own records and figures: bank reconciliation statement: adjusted bank and book balances; blank bank reconciliation workbook (Excel) to fill in; find the rows that make a bank reconciliation not balance; duplicate transactions in a bank, card or ledger export; bank or card statement rows to a checked table; bank statement rows to an OFX file and row-limited import CSVs; merge monthly bank statement exports into one ledger; and 4 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Can you do our bank reconciliation for March 31? The statement shows $12,480.35 and our books show $12,201.15; here are the outstanding checks and deposits.\" or \"Can you make me a blank bank reconciliation template in Excel for Example Supply Co., March 31?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.3"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Bookkeepers and accountants: checked math from Mathproven

These tools run Mathproven's own calculations on the person's files and figures, where the assistant runs (this computer, or the assistant's own sandbox), the same way the pages on mathproven.com do. Nothing is sent to Mathproven. Each result is recomputed a second way. A verified result comes with a reconciliation certificate; a result whose check fails comes back as NOT VERIFIED, names the failed check, and gives no figures.

## How to run a tool

The script is `scripts/mathproven.mjs` in this skill's folder (written below as `${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs`; where that variable is not set, use this folder's path). It needs Node.js 18 or later and nothing else.

- `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs list` lists the tools here; `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs describe <tool>` prints one tool's inputs.
- Every input is given as `--<input> <value>`, or as `--<input>=<value>` (for a value that starts with `--`), or all at once as `--json '{"<input>": "<value>"}'`. A file input takes the path to a .csv or .xlsx file, or the CSV text itself.
- Amounts are written as text ("1,234.56"); dates as YYYY-MM-DD.
- `--saveTo <path ending .xlsx or .csv>` saves the full result and its certificate (never over an existing file). A template's blank workbook is saved under its own name in the current folder, or where `--saveTo` says.
- Exit code 0: verified. 2: NOT VERIFIED (a check failed). 1: nothing was calculated; the message says why.
- Without a key, a tool reads one file a run (two for merge monthly bank statement exports into one ledger), as the free plan on mathproven.com does. A key from a Mathproven account page, given as `--key <key>`, applies the account's plan; it is checked here and never sent anywhere.

## Tools

Each tool's inputs and what it checks are in [references/tools.md](references/tools.md); `describe <tool>` prints the same.

- `bank_reconciliation_statement`: Bank reconciliation statement: adjusted bank and book balances. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_reconciliation_statement`
- `bank_reconciliation_template`: Blank bank reconciliation workbook (Excel) to fill in. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_reconciliation_template`
- `reconciliation_difference_finder`: Find the rows that make a bank reconciliation not balance. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs reconciliation_difference_finder`
- `duplicate_transactions_finder`: Duplicate transactions in a bank, card or ledger export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs duplicate_transactions_finder --transactions '<path to a .csv or .xlsx file>'`
- `bank_statement_to_excel`: Bank or card statement rows to a checked table. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_to_excel --statementRows '<path to a .csv or .xlsx file>'`
- `bank_statement_to_ofx`: Bank statement rows to an OFX file and row-limited import CSVs. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_to_ofx --statementRows '<path to a .csv or .xlsx file>'`
- `bank_statement_merge`: Merge monthly bank statement exports into one ledger. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_merge --statements '<path to a .csv or .xlsx file>'`
- `petty_cash_reconciliation`: Petty cash reconciliation: count, receipts, over or short. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs petty_cash_reconciliation --fund '<amount, such as 1,234.56>'`
- `uncashed_check_escheat_list`: Uncashed checks by state and dormancy end date. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs uncashed_check_escheat_list --checkList '<path to a .csv or .xlsx file>'`
- `uncashed_check_dormancy_periods`: Uncashed check dormancy periods by state (vendor and payroll checks). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs uncashed_check_dormancy_periods --member '<text>'`
- `unclaimed_property_notice_windows`: Unclaimed property owner notice windows before the annual report, by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs unclaimed_property_notice_windows --member '<text>'`
