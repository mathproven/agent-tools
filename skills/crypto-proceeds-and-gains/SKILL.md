---
name: crypto-proceeds-and-gains
description: "Checked math for crypto proceeds and gains, run where the assistant runs, on the person's own records and figures: crypto capital gains worksheet, lot by lot, from an exchange export; crypto proceeds tie-out: an export against a broker statement; short-term and long-term split of a crypto gains worksheet; average cost per coin across several purchases; blank crypto trade log workbook (Excel); long-term capital gains rate thresholds (0%, 15%, 20%) by filing status. Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed. Nothing is sent to Mathproven. Use it when someone asks, for example: \"Can you work out my crypto capital gains from this exchange export, first in first out, with fees included?\" or \"The total proceeds on my exchange tax statement do not match my own trade export. Where is the difference?\""
license: "Proprietary. See LICENSE in this folder."
compatibility: "Needs Node.js 18 or later and nothing else. Runs offline: it reads only the files a command names and sends nothing to Mathproven."
metadata:
  author: "OpenSlot LLC"
  version: "0.1.3"
  homepage: "https://mathproven.com/agents/?ref=marketplace-claude-plugin"
---

# Crypto proceeds and gains: checked math from Mathproven

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

- `crypto_capital_gains_worksheet`: Crypto capital gains worksheet, lot by lot, from an exchange export. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_capital_gains_worksheet --tradeExport '<path to a .csv or .xlsx file>' --method '<first in first out|highest cost first>' --fees '<added|left out>'`
- `crypto_proceeds_tie_out`: Crypto proceeds tie-out: an export against a broker statement. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_proceeds_tie_out --tradeExport '<path to a .csv or .xlsx file>'`
- `crypto_holding_period_split`: Short-term and long-term split of a crypto gains worksheet. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_holding_period_split --gainsWorksheet '<path to a .csv or .xlsx file>'`
- `crypto_average_cost_per_coin`: Average cost per coin across several purchases. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_average_cost_per_coin --buys '<text>' --fees '<added|left out>'`
- `crypto_trade_log_template`: Blank crypto trade log workbook (Excel). `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_trade_log_template`
- `capital_gains_rate_thresholds`: Long-term capital gains rate thresholds (0%, 15%, 20%) by filing status. `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs capital_gains_rate_thresholds --member '<text>'`
