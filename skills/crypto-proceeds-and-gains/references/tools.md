# Crypto proceeds and gains: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Crypto capital gains worksheet, lot by lot, from an exchange export (`crypto_capital_gains_worksheet`)

Builds a lot-by-lot gains worksheet from an exchange or wallet export of buys and sales (.csv or .xlsx): each sale is matched to the lots it came from under the method chosen (first in, first out, or highest cost first), giving asset, quantity, date acquired, date disposed, proceeds, cost basis and gain or loss per row, plus the lots still held. A second lot engine written a different way has to agree; quantity and cost are proved conserved per asset and per lot, each sale's proceeds are split by quantity to the cent, and a sale larger than the holdings before it is listed and never given a zero basis. Transfers, rewards and swaps are listed, not matched; lots are pooled per asset across accounts. Use it when someone needs gains and losses or cost basis per sale worked out from their own trade history, as at tax time. Not a tax form, it does not pick the method, and it does not say what to report.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_capital_gains_worksheet --tradeExport '<path to a .csv or .xlsx file>' --method '<first in first out|highest cost first>' --fees '<added|left out>'
```

Inputs:
- `--tradeExport` (needed): Trade export. A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date (and time), type (buy or sell), asset, quantity and total cost or proceeds are needed; fee and account are used when present. Rows of any other type (transfers, rewards, conversions or swaps) are listed and not used. In a workbook, a sheet named Trades is the one read.
- `--method` (needed): Lot method. "first in first out" takes the oldest lot first; "highest cost first" takes the lot with the highest cost per unit first. The person chooses; it is not picked for them.
- `--fees` (needed): Fees. "added": each purchase fee is added to its cost and each sale fee is subtracted from its proceeds. "left out": fees are not used. The person chooses; it is not picked for them.
- `--columns` (optional): Columns of the trade export. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date (and time) = Date (and time) received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date (and time), Type (buy or sell), Asset, Quantity, Total cost or proceeds. Used when present: Fee, Cost basis listed for a sale, Account or wallet.

Mathproven builds a worksheet of your own trades under the method you picked; it is not a tax form, is not in any agency's form layout, and does not say what to report.

## Crypto proceeds tie-out: an export against a broker statement (`crypto_proceeds_tie_out`)

Adds up the sales in a person's own exchange or wallet export (.csv or .xlsx) and sets them against the totals typed from a broker statement: total proceeds and each account's proceeds side by side with the difference, plus cost basis and the number of sales wherever those are typed, and the export broken down by asset and by month so a difference can be located. Asset and month totals are re-added to the export total in a separate pass, every sale is counted once, and buys, transfers, rewards and swaps are listed and not added up. When only the comparison with the typed figures fails, the export's own totals and breakdown are still given, marked not verified, so the difference can be located. Use it when the proceeds on a broker or exchange statement do not match someone's own records, or to confirm that they do. Not for working out gains or cost basis, and it does not say which figure is right or what belongs on a return.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_proceeds_tie_out --tradeExport '<path to a .csv or .xlsx file>'
```

Inputs:
- `--tradeExport` (needed): Trade or sales export. A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date, asset and proceeds are needed; type, quantity, fee, cost basis and account are used when present. With a type column only sales are added up; with none, every row is a sale. In a workbook, a sheet named Trades is the one read.
- `--statementProceeds` (optional): Total proceeds on the statement. The total proceeds printed on the broker statement, when the export has one account or no account column. For several accounts, give statementByAccount instead.
- `--statementBasis` (optional): Cost basis on the statement. Optional, with statementProceeds: the total cost basis printed on the statement.
- `--statementSales` (optional): Number of sales on the statement. Optional, with statementProceeds: the number of sales the statement lists, a whole number.
- `--statementByAccount` (optional): Statement totals by account. For an export with several accounts: one line per account as "account | total proceeds | cost basis | number of sales", the last two optional, with each account named as it is in the export, for example "Main | 4,889.75"; sales with a blank account are named "(no account)". Every account in the export needs a line for the result to tie out.
- `--proceedsLessFees` (optional): Take proceeds less fees. Optional. true takes each sale's proceeds as its amount minus its fee; without it, proceeds are taken as written in the export.
- `--columns` (optional): Columns of the trade or sales export. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date (and time) = Date (and time) received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date (and time), Asset, Total cost or proceeds. Used when present: Type (buy or sell), Quantity, Fee, Cost basis listed for a sale, Account or wallet.

Mathproven shows where the arithmetic differs; it does not say which figure is right or what belongs on a return.

## Short-term and long-term split of a crypto gains worksheet (`crypto_holding_period_split`)

Splits a lot-by-lot gains worksheet (.csv or .xlsx, one row per lot sold with date acquired, date disposed, proceeds and cost basis) into rows held one year or less and rows held more than one year, often called short-term and long-term, with the row count, proceeds, cost basis and gain or loss of each group, and every row with its days held and the date its one-year line falls on. The one-year line is worked out two ways that have to agree on every row (the count starts the day after the date acquired), group totals are added a second way, a gain column or total line in the file is checked against the rows, and rows disposed within a day of the line are flagged. Use it when someone asks how much of their crypto gain is short-term and how much long-term, from a worksheet they already have. Not for building the worksheet from raw trades or for tax rates, and it does not say which rule applies or what to report.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_holding_period_split --gainsWorksheet '<path to a .csv or .xlsx file>'
```

Inputs:
- `--gainsWorksheet` (needed): Gains worksheet. A .csv or .xlsx file (a path, or the CSV text) with one row per lot sold: date acquired, date disposed, proceeds and cost basis are needed; asset, quantity and a gain or loss column are used when present. A total line is checked against the rows. A blank cost basis is unreadable, never zero.
- `--columns` (optional): Columns of the gains worksheet. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date acquired = Date acquired received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date acquired, Date disposed, Proceeds, Cost basis. Used when present: Asset, Quantity, Gain or loss listed in the file.

Mathproven applies the rule stated on the page (the count starts the day after the date acquired, and a row is held more than one year when the date disposed is on or after that day one year later), using dates only; it counts and adds, it is not a tax form, and it does not say what to report.

## Average cost per coin across several purchases (`crypto_average_cost_per_coin`)

Works out the average cost per unit of one coin or token across several purchases: total quantity, total paid before fees, total fees, total cost, and total cost divided by total quantity to eight decimal places, with each purchase's own cost per unit beside it. Fees are added to cost or left out, as chosen. Every total is added a second way, every divided figure is multiplied back to give its cost, and the average is checked to lie between the lowest and the highest cost per unit. With a price per unit given, it also shows what the total quantity is worth at that price and the difference from the total cost. Use it when someone asks for their average cost per coin, or their cost per unit across several buys of the same asset. Not for sales or lot matching, not for several different coins in one run, and it does not say what cost basis to report.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_average_cost_per_coin --buys '<text>' --fees '<added|left out>'
```

Inputs:
- `--buys` (needed): Purchases. The purchases of one asset, one per line as "quantity; amount paid; fee" (semicolons between the three), for example "0.5; 15,000.00; 15.00". Quantity takes up to 8 decimal places; amount paid is the total for the purchase in dollars before the fee; a blank fee is zero. A JSON list also works, each purchase as [quantity, amount paid, fee] or as {"quantity", "amountPaid", "fee"} (no other keys). Up to 200 purchases.
- `--fees` (needed): Fees. "added": each purchase costs its amount paid plus its fee. "left out": each costs its amount paid alone (the total of the fees is still shown). The person chooses; it is not picked for them.
- `--price` (optional): Price per unit to compare with. Optional. A price per unit in dollars, up to 8 decimal places, written without the $ sign (such as 40000 or 0.00001234): the value of the total quantity at that price and its difference from the total cost are shown.
- `--asset` (optional): Asset. Optional. The asset symbol, such as BTC, for the heading of the result.

Mathproven divides total cost by total quantity; it does not match sales to lots, it is not a tax form, and it does not say what to report.

## Blank crypto trade log workbook (Excel) (`crypto_trade_log_template`)

Builds a blank Excel trade log (.xlsx) for a year of crypto buys and sales: a Trades sheet with date, type, asset, quantity, total USD, fee USD, cost basis USD, account and notes columns, an Accounts sheet with the number of numbered rows asked for, a Log sheet with the name and year, and an Instructions sheet saying what each column holds. The finished file is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked for, the Trades header is matched the way the gains worksheet and the proceeds tie-out read it, and no cell holds a formula. Use it when someone wants a spreadsheet to keep track of their crypto trades through the year or for tax season. Not a calculator: it holds values only and works nothing out.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs crypto_trade_log_template
```

Inputs:
- `--name` (optional): Name. Optional. Whose trades the log holds, printed on the Log sheet and used in the file name; up to 120 characters.
- `--year` (optional): Year. Optional. The year the log covers, four digits from 2000 to 2099, printed on the Log sheet and used in the file name.
- `--accountCount` (optional): Number of accounts and wallets. Optional. How many numbered rows the Accounts sheet starts with, a whole number from 1 to 50; 2 when not given, as on the page.

Mathproven builds a layout to fill in; it holds values only, with no formulas, so it does not calculate, and it does not say what to report.

## Long-term capital gains rate thresholds (0%, 15%, 20%) by filing status (`capital_gains_rate_thresholds`)

The federal taxable income lines where the 0%, 15% and 20% rates on long-term capital gains (crypto held more than one year included) begin, by filing status, for tax years 2025, 2026 and 2027, each read from the IRS revenue procedure, with the net investment income tax threshold for the status. Use it when someone asks the long-term capital gains brackets or the 0% gains limit for a tax year and filing status. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs capital_gains_rate_thresholds --member '<text>'
```

Inputs:
- `--member` (needed): Tax year and filing status. The tax year and filing status to read, by its code: a filing status: S (single), MFJ (married filing jointly or surviving spouse), MFS (married filing separately) or HOH (head of household), with the tax year taken from the date; or a tax year and status together, such as 2026-MFJ (tax years 2025, 2026 and 2027).
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. A date picks the tax year (its calendar year) when the member is a filing status alone. The table holds tax years 2025, 2026 and 2027; any other year is not covered.

Mathproven gives thresholds only; it does not say what to report or file. Mathproven is not affiliated with the IRS or any agency whose documents are cited here.
