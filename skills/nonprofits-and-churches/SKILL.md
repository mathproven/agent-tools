---
name: nonprofits-and-churches
description: "Checked math for nonprofits and churches, run where the assistant runs, on the person's own records and figures: donor retention rate from a gift list; year-end giving statements from a gift list; gift acknowledgment checklist: gift records with blank fields; donor de-duplication: find duplicate donor records, merge with proof; donor upgrades and downgrades: who gave more or less than last year; gift log workbook for tracking donations (Excel template); giving by fund and month from a gift list; LYBUNT and SYBUNT report: donors who gave last year, not this year; and 3 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"What was our donor retention rate this year? Here is our gift list from our donor database.\" or \"Can you make our year-end giving statements for each donor from this gift list, with totals by fund?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.1"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Nonprofits and churches: checked math from Mathproven

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

- `donor_retention_rate`: Donor retention rate from a gift list. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_retention_rate --giftList '<path to a .csv or .xlsx file>'`
- `year_end_giving_statements`: Year-end giving statements from a gift list. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs year_end_giving_statements --giftList '<path to a .csv or .xlsx file>'`
- `gift_acknowledgment_checklist`: Gift acknowledgment checklist: gift records with blank fields. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs gift_acknowledgment_checklist --giftList '<path to a .csv or .xlsx file>' --amountFrom '<amount, such as 1,234.56>' --checklist '<text>'`
- `donor_deduplication`: Donor de-duplication: find duplicate donor records, merge with proof. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_deduplication --giftList '<path to a .csv or .xlsx file>'`
- `donor_upgrades_downgrades`: Donor upgrades and downgrades: who gave more or less than last year. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_upgrades_downgrades --giftList '<path to a .csv or .xlsx file>'`
- `donation_gift_log_template`: Gift log workbook for tracking donations (Excel template). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donation_gift_log_template`
- `giving_by_fund_and_month`: Giving by fund and month from a gift list. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs giving_by_fund_and_month --giftList '<path to a .csv or .xlsx file>'`
- `lybunt_sybunt_report`: LYBUNT and SYBUNT report: donors who gave last year, not this year. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs lybunt_sybunt_report --giftList '<path to a .csv or .xlsx file>'`
- `quid_pro_quo_payment_split`: Part-gift (quid pro quo) payments split by the value received. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs quid_pro_quo_payment_split --giftList '<path to a .csv or .xlsx file>'`
- `charity_audit_thresholds_by_state`: Charity audit, review and compilation thresholds by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs charity_audit_thresholds_by_state --member '<text>'`
- `charity_registration_renewal_dates_by_state`: Charity registration renewal due-date rules by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs charity_registration_renewal_dates_by_state --member '<text>'`
