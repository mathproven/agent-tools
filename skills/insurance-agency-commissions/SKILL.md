---
name: insurance-agency-commissions
description: "Checked math for insurance agency commissions, run where the assistant runs. Lookup tables, each answer with its citation and official source: surplus lines premium tax rates by state; surplus lines stamping fees by state and policy date. Tools for the person's own records and figures: insurance commission on one policy, with the chargeback on a cancellation; commission statement to clean rows, tied to the statement total; commission summary by carrier and line of business, tied to each statement; and 5 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"A $4,800 policy written January 15 at 15% new business commission cancelled May 15. What is the chargeback and what do I keep?\" or \"Can you turn this commission statement into clean rows and check that it adds up to the $1,064 we were paid?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.4"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Insurance agency commissions: checked math from Mathproven

These tools run Mathproven's own calculations on the person's files and figures, where the assistant runs (this computer, or the assistant's own sandbox), the same way the pages on mathproven.com do. Nothing is sent to Mathproven. Each result is recomputed a second way. A verified result comes with a reconciliation certificate; a result whose check fails comes back as NOT VERIFIED, names the failed check, and gives no figures.

## How to run a tool

The script is `scripts/mathproven.mjs` in this skill's folder (written below as `${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs`; where that variable is not set, use this folder's path). It needs Node.js 18 or later and nothing else. A tool runs with one command, on one line:

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> --<input> <value> ...
```

Keep the whole command on one line, with every value written in it: no shell variables, no line breaks, and no script around it. Put each value in single quotes, so a dollar sign or a backtick in it stays as written (in PowerShell a ' inside is written ''). A value of several lines (a rate table, say) joins single-quoted lines with a line break written apart from them: `('TX 0.2500' + "`n" + 'OK 0.1850')` in PowerShell, `$'TX 0.2500\nOK 0.1850'` in bash (where a ' or \ inside is written \' or \\). Never put a value in double quotes in PowerShell: it reads a dollar sign there as the start of a variable. Windows PowerShell 5.1 drops the double quotes inside an argument, so `--json` does not work there: give each input as `--<input> <value>`.

- `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs list` lists the tools here; `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs describe <tool>` prints one tool's inputs.
- Every input is given as `--<input> <value>`, or as `--<input>=<value>` (for a value that starts with `--`), or all at once as `--json '{"<input>": "<value>"}'`. A file input takes the path to a .csv or .xlsx file, or the CSV text itself.
- Amounts are written as text ("1,234.56"); dates as YYYY-MM-DD.
- `--saveTo <path ending .xlsx or .csv>` saves the full result and its certificate (never over an existing file). A template's blank workbook is saved under its own name in the current folder, or where `--saveTo` says.
- Exit code 0: verified. 2: NOT VERIFIED (a check failed). 1: nothing was calculated; the message says why.
- Without a key, a tool reads one file a run, as the free plan on mathproven.com does. A key from a Mathproven account page, given as `--key <key>`, applies the account's plan; it is checked here and never sent anywhere.

## Tools

Each tool's inputs and what it checks are in [references/tools.md](references/tools.md); `describe <tool>` prints the same.

- `insurance_commission_calculator`: Insurance commission on one policy, with the chargeback on a cancellation. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs insurance_commission_calculator --premium '<amount, such as 1,234.56>' --termKind '<new|renewal>'`
- `commission_statement_to_excel`: Commission statement to clean rows, tied to the statement total. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_statement_to_excel --statement '<path to a .csv or .xlsx file>'`
- `commission_summary_by_carrier`: Commission summary by carrier and line of business, tied to each statement. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_summary_by_carrier --commissionLines '<path to a .csv or .xlsx file>'`
- `commission_tracking_template`: Insurance commission tracking workbook for one month (Excel). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_tracking_template`
- `commission_expected_vs_paid_reconciliation`: Insurance commission reconciliation: expected from the book against paid on the statement. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_expected_vs_paid_reconciliation --bookOfBusiness '<path to a .csv or .xlsx file>' --statement '<path to a .csv or .xlsx file>'`
- `missing_insurance_commission_finder`: Missing insurance commissions: policies with no statement line, aged by days. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs missing_insurance_commission_finder --policyList '<path to a .csv or .xlsx file>' --statement '<path to a .csv or .xlsx file>'`
- `producer_commission_split_calculator`: Producer commission splits on paid lines, to the cent, with payout statements. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs producer_commission_split_calculator --paidLines '<path to a .csv or .xlsx file>' --splitRules '<text>'`
- `surplus_lines_tax_on_policy_list`: Surplus lines premium tax on a policy list, with totals by home state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_tax_on_policy_list --policyList '<path to a .csv or .xlsx file>'`
- `surplus_lines_tax_rates`: Surplus lines premium tax rates by state. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_tax_rates --member '<text>'`
- `surplus_lines_stamping_fees`: Surplus lines stamping fees by state and policy effective date. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_stamping_fees --member '<text>'`
