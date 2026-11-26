---
name: trucking-fuel-tax
description: "Checked math for trucking fuel tax, run where the assistant runs. Lookup tables, each answer with its citation and official source: diesel fuel tax rates by state and province, third quarter 2026. Tools for the person's own records and figures: quarterly fuel tax worksheet from miles and fuel-card files; fuel-card statement to a fuel ledger by jurisdiction and unit; miles per gallon by truck from a miles file and a fuel file; trucking cost per mile, fixed and variable; and 1 more. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Can you work my fuel tax by state for October to December from my ELD miles export and my fuel card statement? Here are the rates for the quarter.\" or \"Can you total the gallons and dollars by state and by truck from my fuel card statement and tie them to the statement totals?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.4"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Trucking fuel tax: checked math from Mathproven

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

- `fuel_tax_quarterly_worksheet`: Quarterly fuel tax worksheet from miles and fuel-card files. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_tax_quarterly_worksheet --milesFile '<path to a .csv or .xlsx file>' --fuelFile '<path to a .csv or .xlsx file>'`
- `fuel_card_ledger_by_jurisdiction`: Fuel-card statement to a fuel ledger by jurisdiction and unit. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_card_ledger_by_jurisdiction --statement '<path to a .csv or .xlsx file>'`
- `truck_miles_per_gallon_by_unit`: Miles per gallon by truck from a miles file and a fuel file. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs truck_miles_per_gallon_by_unit --milesFile '<path to a .csv or .xlsx file>' --fuelFile '<path to a .csv or .xlsx file>'`
- `trucking_cost_per_mile`: Trucking cost per mile, fixed and variable. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trucking_cost_per_mile --costs '<text>' --miles '<number>'`
- `mileage_and_fuel_log_template`: Mileage and fuel log workbook for a quarter (Excel). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs mileage_and_fuel_log_template`
- `fuel_tax_rates_third_quarter_2026`: Quarterly fuel tax rates, third quarter 2026: diesel by jurisdiction. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_tax_rates_third_quarter_2026 --member '<text>'`
