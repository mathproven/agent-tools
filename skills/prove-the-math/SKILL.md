---
name: prove-the-math
description: "Checked math for prove the math, run where the assistant runs, on the person's own records and figures: check that a total equals the sum of its parts; cross-foot a table: rows to row totals, columns to the totals row; reconcile two lists: matched, unmatched and differing items. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"My assistant says these invoice lines come to $1,050.00. Do they really add up to that?\" or \"Can you check that every row and column of this budget spreadsheet adds up to its totals?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.3"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Prove the math: checked math from Mathproven

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

- `check_total_against_parts`: Check that a total equals the sum of its parts. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_total_against_parts --total '<amount, such as 1,234.56>' --parts '["<amount>","<amount>"]'`
- `check_table_cross_foot`: Cross-foot a table: rows to row totals, columns to the totals row. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_table_cross_foot --table '<path to a .csv or .xlsx file>'`
- `check_two_lists_reconcile`: Reconcile two lists: matched, unmatched and differing items. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_two_lists_reconcile --listA '<path to a .csv or .xlsx file>' --listB '<path to a .csv or .xlsx file>'`
