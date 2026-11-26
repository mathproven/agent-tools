# Prove the math: the tools

Each tool runs with `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Check that a total equals the sum of its parts (`check_total_against_parts`)

Use it to check figures an assistant, a spreadsheet or another tool produced: a stated total and the amounts it should be made of, such as invoice lines, expense items, the pieces of a split payment or the lines of a budget. It adds the parts in integer cents, compares the sum with the stated total and says exactly how far off it is, then adds the parts a second way (whole-number arithmetic, last part to first) and checks that the two sums agree. The result lists every part with a running total, and the stated total, the sum and the difference. Negative parts (refunds, credits) are added as negatives; each part goes on its own line or in a JSON list. Not for totals made by multiplying (quantity times price, hours times a rate), percentages or rounding rules, and not for a whole table of rows and columns.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_total_against_parts --total '<amount, such as 1,234.56>' --parts '["<amount>","<amount>"]'
```

Inputs:
- `--total` (needed): Stated total. The total as it was given (by an assistant, a spreadsheet, an invoice or a report), for example "1,050.00" or "$1,050.00". A negative total is written -12.00 or (12.00).
- `--parts` (needed): Parts. The amounts the total should be made of: each on its own line, or a JSON list such as ["600.00", "350.00", "-25.00"]. A comma inside one amount is a thousands separator ("600,350,125" is one amount). Negative parts are written -25.00 or (25.00).
- `--label` (optional): What the total is. Optional. A few words naming the total, such as "invoice 1042" or "March expenses", used in the result.

Mathproven adds up the figures as they were given and compares them; it does not say which figure is right or what to do about a difference.

## Cross-foot a table: rows to row totals, columns to the totals row (`check_table_cross_foot`)

Use it to check figures an assistant, a spreadsheet or another tool produced: a table (.csv or .xlsx, or CSV text) with a row-total column (its header is, starts or ends with "Total"), a totals row (labelled just "Total", "Grand total" or "Subtotal"), or both, such as a budget by month or sales by region. Every column of amounts beside the row total is a part of it unless the parts are named. In integer cents it adds each row across to its row total, each column that the totals row gives a figure for down to it, and each subtotal against the rows above it; with a row-total column it also works out the grand total every way. When a row, column or sign could be read two ways it fails by name and asks: a row equal to the rows above it, a label with a total word, a row of figures with no label, Debit and Credit words beside unsigned amounts, figures above the header, a second header, an empty totals row, a figure that is not dollars and cents. Not for products or differences.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_table_cross_foot --table '<path to a .csv or .xlsx file>'
```

Inputs:
- `--table` (needed): Table. A .csv or .xlsx file (a path), or the CSV text itself: one header row, then rows of amounts, 100,000 rows at most. Row totals sit in a column whose header is, starts or ends with "Total". A total line is a row labelled just "Total", "Totals", "Grand total", "Subtotal" or "Sub-total" (the last is the totals row; earlier ones are subtotals). "n/a" and a lone dash read as nothing.
- `--totalColumn` (optional): Row-total column. Optional. The header (or column letter) of the column holding each row's total, when its header does not say "Total" or two headers do; "none" when the table has no row-total column.
- `--amountColumns` (optional): Amount columns. Optional. The headers (or column letters) of the columns each row total is made of, separated by commas. Without it, every column of amounts other than the row total is a part (a column of account numbers, years or quantities too, which then makes the rows fail). Columns of amounts not named are still added down when the totals row gives their figure.
- `--totalRows` (optional): Total and subtotal rows. Optional. The row numbers, as the spreadsheet shows them, of every total and subtotal row, such as "6, 12, 20" (the last is the totals row), or "none" when no row is a total. Give it when the check asks which rows are totals. A row labelled as a total must be among them.
- `--headerRow` (optional): Header row. Optional. The row number of the header row, when the check asks for it: rows above it are then left out, as asked (a title, a row of years over the quarters), unless one of them is a total line.
- `--signColumn` (optional): Sign column. Optional, when the check asks for it: a column of words such as Debit and Credit beside amounts written without a sign. Write "<column>: <word> = minus" (for example "Type: Debit = minus") to subtract those rows, or "<column> = none" to add the amounts as written.

Mathproven adds up the figures as they were given and compares them; it does not say which figure is right or what to do about a difference.

## Reconcile two lists: matched, unmatched and differing items (`check_two_lists_reconcile`)

Use it to check figures an assistant, a spreadsheet or another tool produced: two lists that should hold the same items, such as a bank statement and a ledger, or invoices and payments received (.csv or .xlsx files, or CSV text). By reference, rows with the same reference pair (two that differ in amount are a difference) and rows without one pair by amount and date; or it pairs by amount and date, or by amount alone. Every row is placed exactly once, the difference between the totals is shown to equal what is only in each list plus the amount differences, worked out a second way, and each total line a list holds (a first cell starting "Total", or a cell that is just "Total", "Subtotal" or "Grand total") is checked against its rows. These fail and ask: a "Sum" row, a balance or net line, Debit and Credit words beside unsigned amounts, dates that read two ways, figures above the header. Verified only when nothing is unmatched or differs. Not for duplicates within one list.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs check_two_lists_reconcile --listA '<path to a .csv or .xlsx file>' --listB '<path to a .csv or .xlsx file>'
```

Inputs:
- `--listA` (needed): First list. A .csv or .xlsx file (a path), or the CSV text itself: one header row, then one row per item (100,000 at most) with an amount column (or money out and money in columns, amounts without a sign). A reference (check number, invoice number, transaction id), a date and a description column are used when present. Rows starting "Total", and rows with a cell that is just "Total", are the list's own totals and are checked against its rows.
- `--listB` (needed): Second list. The list to compare with the first, in the same form; its columns and their order need not match the first list's.
- `--nameA` (optional): Name of the first list. Optional. What the first list is, such as "bank statement", used in the result. Without it, "list A".
- `--nameB` (optional): Name of the second list. Optional. What the second list is, such as "ledger", used in the result. Without it, "list B".
- `--matchBy` (optional): Match by. Optional. "reference": rows with the same reference pair, and rows with no reference pair by amount and date (or amount); two rows whose references differ never pair. "amount and date": the same amount on the same day. "amount": the same amount, nearest date first. Without it: reference when both lists have a reference column and share at least one reference, otherwise amount and date when both have dates, otherwise amount.
- `--reverseSignsB` (optional): Second list signs reversed. Optional. true when the second list writes amounts with the opposite sign from the first (money in negative where the first list has it positive): its amounts are read the other way round.
- `--signsA` (optional): Sign column of the first list. Optional, when the check asks for it: the first list has a column of words such as Debit and Credit beside amounts written without a sign. Write "<column>: <word> = minus" (for example "Type: Debit = minus") to read those rows as money out, or "<column> = none" to read the amounts as written.
- `--signsB` (optional): Sign column of the second list. Optional, the same for the second list, for example "Dr/Cr: Dr = minus".
- `--dateOrder` (optional): Date order. Optional, when the check asks for it: how dates written with slashes read in both lists, "month first" (03/04/2026 is March 4) or "day first" (3 April). Dates written 2026-03-04 are not affected.
- `--columnsA` (optional): Columns of the first list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount, or Money out and Money in. Used when present: Money out, Money in, Reference, Date, Description.
- `--columnsB` (optional): Columns of the second list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount, or Money out and Money in. Used when present: Money out, Money in, Reference, Date, Description.

Mathproven pairs the rows of the two lists and adds up what is left over; it does not say which list is right or what to do about a difference.
