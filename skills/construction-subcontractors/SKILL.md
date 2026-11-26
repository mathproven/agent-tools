---
name: construction-subcontractors
description: "Checked math for construction subcontractors, run where the assistant runs, on the person's own records and figures: subcontractor pay application from a schedule of values; pay application checker: math errors in a schedule of values; blank pay application spreadsheet with a schedule of values; schedule of values that adds up to the contract; progress billing statement by percent complete or milestones; retainage on one invoice, step by step; retainage tracker and retainage release invoice; lien waiver, conditional or unconditional, progress or final; and 5 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"What is the current payment due on pay application 2 for our $100,000 electrical subcontract with 10% retainage?\" or \"Can you check this pay application spreadsheet for math errors before we send it?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.2"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Construction subcontractors: checked math from Mathproven

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

- `pay_application_builder`: Subcontractor pay application from a schedule of values. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_builder --scheduleOfValues '<path to a .csv or .xlsx file>' --originalContractSum '<amount, such as 1,234.56>'`
- `pay_application_checker`: Pay application checker: math errors in a schedule of values. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_checker --payApplication '<path to a .csv or .xlsx file>'`
- `pay_application_template_workbook`: Blank pay application spreadsheet with a schedule of values. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_template_workbook`
- `schedule_of_values_builder`: Schedule of values that adds up to the contract. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs schedule_of_values_builder --contractSum '<amount, such as 1,234.56>' --lines '<path to a .csv or .xlsx file>'`
- `progress_billing_statement`: Progress billing statement by percent complete or milestones. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs progress_billing_statement --originalContractSum '<amount, such as 1,234.56>'`
- `retainage_calculator`: Retainage on one invoice, step by step. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_calculator --contractAmount '<amount, such as 1,234.56>' --retainageRate '<number>'`
- `retainage_tracker_release_invoice`: Retainage tracker and retainage release invoice. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_tracker_release_invoice --periods '<path to a .csv or .xlsx file>'`
- `lien_waiver_generator`: Lien waiver, conditional or unconditional, progress or final. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs lien_waiver_generator --state '<text>' --waiverType '<conditional-progress|unconditional-progress|conditional-final|unconditional-final>' --claimant '<text>' --customer '<text>' --owner '<text>' --projectName '<text>' --projectAddress '<text>' --throughDate '<YYYY-MM-DD>' --amount '<amount, such as 1,234.56>'`
- `late_payment_interest_calculator`: Late payment interest on a progress or retainage payment. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs late_payment_interest_calculator --lateAmount '<amount, such as 1,234.56>' --paidDate '<YYYY-MM-DD>'`
- `over_under_billing_wip_schedule`: Over/under billing (WIP schedule) for a list of jobs. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs over_under_billing_wip_schedule --jobs '<path to a .csv or .xlsx file>'`
- `prevailing_wage_fringe_credit`: Prevailing wage fringe credit (fringe benefit annualization). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs prevailing_wage_fringe_credit --workers '<path to a .csv or .xlsx file>'`
- `prompt_payment_deadlines`: State prompt payment deadlines for construction, with late-payment interest. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs prompt_payment_deadlines --member '<text>'`
- `retainage_limits`: State retainage limits on public and private construction jobs. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_limits --member '<text>'`
