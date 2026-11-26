# Bookkeepers and accountants: the tools

Each tool runs with `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> ...` (see SKILL.md). Without a key, a tool reads one file a run (two for merge monthly bank statement exports into one ledger).

## Bank reconciliation statement: adjusted bank and book balances (`bank_reconciliation_statement`)

Works out a bank reconciliation for one date: the adjusted bank balance (statement ending balance plus deposits in transit, less outstanding checks, plus or minus bank corrections) and the adjusted book balance (book balance plus or minus book adjustments such as interest, bank fees and returned items), compared to the cent with the difference shown. Every list is added again last row first and both balances are rebuilt row by row; a check number listed twice and a zero amount are warnings. It takes the two balances with the lists as small tables, or a filled-in bank reconciliation workbook, whose hand-written totals are compared with the calculated ones. Use it when someone asks to reconcile a bank account, prepare a bank reconciliation statement, or check that the adjusted balances agree. Not for reading a PDF bank statement, and not a statement that the books are correct.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_reconciliation_statement
```

Inputs:
- `--workbook` (optional): Filled-in bank reconciliation workbook. Optional, in place of the balances and lists below: an .xlsx workbook made with the bank reconciliation template on mathproven.com (or downloaded from its bank reconciliation statement page) with its Reconciliation, Outstanding checks, Deposits in transit and Adjustments sheets filled in. Totals written by hand on its Reconciliation sheet are compared with the calculated ones.
- `--statementBalance` (optional): Statement ending balance. The last balance on the bank statement. Needed unless the workbook is given.
- `--bookBalance` (optional): Book balance. The balance of the cash account in the ledger on the same date. Needed unless the workbook is given.
- `--statementDate` (optional): Statement date. Optional. The date the two balances are as of.
- `--account` (optional): Account or business name. Optional. Printed at the top of the statement.
- `--outstandingChecks` (optional): Outstanding checks. Optional. Checks recorded in the books that are not on the bank statement yet: a .csv or .xlsx file (a path, or the CSV text) with a header row and an Amount column; Check number, Date and Payee are read when present. Amounts are positive numbers; a blank amount is zero. A row reading Total with no date is the file’s own total line, checked against the rows above it.
- `--depositsInTransit` (optional): Deposits in transit. Optional. Deposits recorded in the books that are not on the bank statement yet: a file or CSV text with a header row and an Amount column; Date and Description are read when present. Amounts are positive numbers.
- `--adjustments` (optional): Bank corrections and book adjustments. Optional. One row per item that moves one of the two balances, with the columns Side, Add or subtract, Amount, and Description when wanted. Side is Bank for a correction to the bank side (a deposit the bank entered at the wrong amount), Book for an item the bank has and the books do not yet (interest with Add; a bank fee or a returned item with Subtract) or a correction to the books. Amounts are positive numbers; Add or Subtract says which way a row goes.
- `--dateOrder` (optional): Date order. Optional. How a date in the lists written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.

Mathproven adds, subtracts and compares the figures given: reconciled means the two adjusted balances agree to the cent, not that the books are correct, and it is not accounting advice.

## Blank bank reconciliation workbook (Excel) to fill in (`bank_reconciliation_template`)

Builds a blank Excel workbook laid out for a bank reconciliation: a Reconciliation sheet with every line of the bank side and the book side, sheets for outstanding checks, deposits in transit and adjustments (rows arrive marked Bank or Book), and an Instructions sheet, with as many rows as asked for (1 to 200 on each list). The finished file is read back and checked before it is saved: five sheet names, header rows and row counts, the lines in order, the name and date as typed, every amount blank, rows numbered, and no formulas. Values only; nothing in it calculates. Use it when someone wants a bank reconciliation template, form or worksheet to fill in by hand. Not for working out a reconciliation from figures, and not a workbook with formulas.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_reconciliation_template
```

Inputs:
- `--account` (optional): Account or business name. Optional. Written on the Reconciliation sheet; it goes only into the workbook.
- `--statementDate` (optional): Statement date. Optional. Written on the Reconciliation sheet.
- `--checkRows` (optional): Outstanding check rows. Optional. How many rows, a whole number from 1 to 200. Default 15.
- `--depositRows` (optional): Deposit in transit rows. Optional. How many rows, a whole number from 1 to 200. Default 5.
- `--bankCorrectionRows` (optional): Bank correction rows. Optional. How many rows, a whole number from 1 to 200. Default 3.
- `--bookAdjustmentRows` (optional): Book adjustment rows. Optional. How many rows, a whole number from 1 to 200. Default 6.

Mathproven builds a layout to fill in: it holds values only and no formulas, so it does not calculate, and it says nothing about what any line should hold.

## Find the rows that make a bank reconciliation not balance (`reconciliation_difference_finder`)

For a bank reconciliation that does not balance, works out the difference (adjusted bank minus adjusted book balance) and lists every row that, corrected one way, makes it $0.00: two neighbouring digits swapped, an entry equal to the difference, a doubled entry, or a sign or side reversed (half the difference). It searches the two balances, the four lists and, when given, the cash account's book rows and the bank statement rows for the period; a row matched on the other side is never named. Each candidate is applied and recomputed to $0.00, a second search made another way must find the same ones, and outstanding items more than 90 days old are listed with a warning. Use it when someone says a bank reconciliation is off by an amount and asks where the difference comes from. Not for deciding which entry belongs in the books.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs reconciliation_difference_finder
```

Inputs:
- `--workbook` (optional): Filled-in bank reconciliation workbook. Optional, in place of the balances and lists below: an .xlsx workbook made with the bank reconciliation template on mathproven.com (or downloaded from its bank reconciliation statement page) with its Reconciliation, Outstanding checks, Deposits in transit and Adjustments sheets filled in. Totals written by hand on its Reconciliation sheet are compared with the calculated ones.
- `--statementBalance` (optional): Statement ending balance. The last balance on the bank statement. Needed unless the workbook is given.
- `--bookBalance` (optional): Book balance. The balance of the cash account in the ledger on the same date. Needed unless the workbook is given.
- `--statementDate` (optional): Statement date. Optional. The date the two balances are as of; outstanding items dated more than 90 days before it are listed.
- `--outstandingChecks` (optional): Outstanding checks. Optional. Checks recorded in the books that are not on the bank statement yet: a .csv or .xlsx file (a path, or the CSV text) with a header row and an Amount column; Check number, Date and Payee are read when present. Amounts are positive numbers; a blank amount is zero. A row reading Total with no date is the file’s own total line, checked against the rows above it.
- `--depositsInTransit` (optional): Deposits in transit. Optional. Deposits recorded in the books that are not on the bank statement yet: a file or CSV text with a header row and an Amount column; Date and Description are read when present. Amounts are positive numbers.
- `--adjustments` (optional): Bank corrections and book adjustments. Optional. One row per item that moves one of the two balances, with the columns Side, Add or subtract, Amount, and Description when wanted. Side is Bank for a correction to the bank side (a deposit the bank entered at the wrong amount), Book for an item the bank has and the books do not yet (interest with Add; a bank fee or a returned item with Subtract) or a correction to the books. Amounts are positive numbers; Add or Subtract says which way a row goes.
- `--bookRows` (optional): Book rows for the period. Optional. The cash account's rows from the books (a ledger or check register export) for the period. A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan. In a ledger export a Debit column is money in and a Credit column money out.
- `--statementRows` (optional): Bank statement rows for the period. Optional. The bank's export for the same period. A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.
- `--bookColumns` (optional): Columns of the book rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column, money in positive), Money out (a credit to cash, or a payment column), Money in (a debit to cash, or a deposit column), Running balance (read, not compared). Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none". In a ledger export of the cash account a column headed Debit is money in and one headed Credit is money out: "Money in = Debit, Money out = Credit".
- `--statementColumns` (optional): Columns of the statement rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column), Money out (debit or withdrawal column), Money in (credit or deposit column), Running balance. Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none".
- `--dateOrder` (optional): Date order. Optional. How a date in the lists (and in the two files, unless each is given its own) written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--bookDateOrder` (optional): Date order. Optional. How a date in the book rows written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--bookFlipSigns` (optional): Money out written as positive. Optional. true when the single amount column of the book rows shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.
- `--statementDateOrder` (optional): Date order. Optional. How a date in the statement rows written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--statementFlipSigns` (optional): Money out written as positive. Optional. true when the single amount column of the statement rows shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.

Mathproven says what the numbers show: a candidate is a row that, corrected one way, makes the arithmetic balance, and it makes no statement about which entry belongs in the books.

## Duplicate transactions in a bank, card or ledger export (`duplicate_transactions_finder`)

Lists the transactions in one bank or card export, or rows from a ledger, that repeat: exact repeats (same date, same amount with the same sign, same description once capitals and spacing are ignored) and, when a number of days is given, near repeats (same amount and description, each within that many days of the row before). Every row lands in exactly one list, the lists add up to the file's row count and dollar total, a separate routine rebuilds the groups and checks they are complete, and a row that cannot be read fails the result. Nothing is removed. Use it when someone asks to find duplicate charges, double-posted transactions or repeated entries in a statement or ledger export. Not for saying which repeats are mistakes (two identical payments on one day can both be real), and not for PDF statements.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs duplicate_transactions_finder --transactions '<path to a .csv or .xlsx file>'
```

Inputs:
- `--transactions` (needed): Transaction rows. A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.
- `--nearDays` (optional): Days for near repeats. Optional. A whole number of days from 0 to 366: rows with the same amount and description this many calendar days apart or fewer are near repeats. Blank or 0 looks for exact repeats only.
- `--columns` (optional): Columns of the transaction rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column), Money out (debit or withdrawal column), Money in (credit or deposit column), Running balance. Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none".
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--flipSigns` (optional): Money out written as positive. Optional. true when the single amount column shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.

Mathproven compares rows and counts them; it does not say which rows are mistakes, and nothing is removed from the file.

## Bank or card statement rows to a checked table (`bank_statement_to_excel`)

Turns the rows of a bank or card export (.csv or .xlsx, or pasted rows with a header row) into one clean table in date order (Date, Description, Amount, Balance) and proves it against the statement: opening balance plus every transaction equals the closing balance (on a card, previous balance plus activity equals the new balance), every running balance in the file matches, dates are valid and inside the period when one is given, typed summary totals match by amount and count, money in minus money out is added a second way, and the table is read back. Balances are typed or taken from the running balance column. A row that cannot be read fails the result. Use it when someone wants a statement export cleaned up into Excel or CSV, or checked against the statement balances. Not for PDF statements or scans.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_to_excel --statementRows '<path to a .csv or .xlsx file>'
```

Inputs:
- `--statementRows` (needed): Statement rows. A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.
- `--kind` (optional): Account. Optional. "bank" (the default): positive amounts are money in. "card": positive amounts are charges and increase what is owed.
- `--order` (optional): Row order in the file. Optional. "auto" (the default) works it out from the dates; "oldest first" keeps the rows as written; "newest first" reverses them.
- `--openingBalance` (optional): Opening balance. Optional. The opening (card: previous) balance from the statement. Without it, it is worked out from the running balance on the first transaction.
- `--closingBalance` (optional): Closing balance. Optional. The closing (card: new) balance from the statement. Without it, the running balance on the last transaction.
- `--periodStart` (optional): Period start. Optional. The first day of the statement period; a transaction dated outside the period is flagged.
- `--periodEnd` (optional): Period end. Optional. The last day of the statement period.
- `--depositsTotal` (optional): Total deposits. Optional, from the statement's summary box: total deposits (card: payments and credits). Checked against the rows.
- `--depositsCount` (optional): Number of deposits. Optional, bank only: the number of deposits in the summary box.
- `--withdrawalsTotal` (optional): Total withdrawals. Optional: total withdrawals (card: purchases, fees and interest). Checked against the rows.
- `--withdrawalsCount` (optional): Number of withdrawals. Optional, bank only: the number of withdrawals in the summary box.
- `--columns` (optional): Columns of the statement rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column), Money out (debit or withdrawal column), Money in (credit or deposit column), Running balance. Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none".
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--flipSigns` (optional): Money out written as positive. Optional. true when the single amount column shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.

Mathproven reads the rows given and checks their arithmetic against the balances; it does not read PDF statements and says nothing about how any transaction should be recorded.

## Bank statement rows to an OFX file and row-limited import CSVs (`bank_statement_to_ofx`)

Writes the rows of a bank export (.csv or .xlsx, or pasted rows with a header row) as an OFX 1.x bank statement, with a unique transaction id (FITID) on every row, plus CSV files split so none holds more rows than a set limit. The statement is checked first (opening balance plus transactions equals closing balance, running balances match); the OFX text is then read back by a separate reader and compared transaction by transaction (date, amount, description, order, total, distinct ids, ledger balance), and the CSV parts are read back and re-added. The OFX text comes back as a table, one line of the file per row, beside each CSV part. Use it when someone needs an OFX, QFX or QBO import file, or import CSVs of a limited size, made from a bank export. Not for PDF statements, and not a promise that a given program accepts the file.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_to_ofx --statementRows '<path to a .csv or .xlsx file>'
```

Inputs:
- `--statementRows` (needed): Statement rows. A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.
- `--order` (optional): Row order in the file. Optional. "auto" (the default) works it out from the dates; "oldest first" keeps the rows as written; "newest first" reverses them.
- `--openingBalance` (optional): Opening balance. Optional. The opening (card: previous) balance from the statement. Without it, it is worked out from the running balance on the first transaction.
- `--closingBalance` (optional): Closing balance. Optional. The closing (card: new) balance from the statement. Without it, the running balance on the last transaction.
- `--accountType` (optional): Account type. Optional. Written in the OFX file. Default checking.
- `--bankId` (optional): Bank routing number. Optional. 1 to 9 letters or digits, written in the OFX file. Default 000000000.
- `--accountId` (optional): Account id. Optional. 1 to 22 letters, digits or hyphens; the last four digits are enough. Default 0000.
- `--currency` (optional): Currency. Optional. Three capital letters. Default USD.
- `--institutionId` (optional): Institution id. Optional. 1 to 10 digits some programs look for in the file; written only when given, and not supplied by Mathproven.
- `--fileEnding` (optional): File name ending. Optional. ofx (the default), qfx or qbo: the ending of the OFX file’s name; the text is the same. A "saveTo" path ending the same way saves the OFX file itself.
- `--maxRows` (optional): Most rows in one CSV file. Optional. A whole number from 1 to 100,000: no CSV file holds more transaction rows than this. Default 1000.
- `--csvDateFormat` (optional): CSV date format. Optional. "month first" (03/31/2026, the default), "day first" (31/03/2026) or "iso" (2026-03-31).
- `--csvColumns` (optional): CSV amount columns. Optional. "signed" (Date, Description, Amount; the default) or "debit and credit" (Date, Description, Debit, Credit, both positive).
- `--columns` (optional): Columns of the statement rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column), Money out (debit or withdrawal column), Money in (credit or deposit column), Running balance. Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none".
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--flipSigns` (optional): Money out written as positive. Optional. true when the single amount column shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.
- `--saveTo` (optional) also takes a path ending .ofx or .qfx or .qbo: that saves this tool's own .ofx or .qfx or .qbo file.

Mathproven writes the file from the rows given and reads it back; whether a particular program accepts it is up to that program, and Mathproven is not affiliated with any bank or accounting software maker.

## Merge monthly bank statement exports into one ledger (`bank_statement_merge`)

Merges two or more statement exports of one account (.csv or .xlsx, in any order) into one ledger in date order with a running balance and the statement each row came from. Each statement is read and balanced on its own; then each closing balance is checked against the next opening balance, overlapping periods are flagged, the first opening balance plus every transaction is checked against the last closing balance, and the merged count and total are re-added from the statements. A transaction with the same date, amount and description in two different statements is listed as a duplicate and kept. Balances come from each file's running balance column or are typed. Use it when someone wants several months of bank exports combined into one continuous ledger, or checked for a gap between months. Not for PDF statements, and not for combining different accounts.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs bank_statement_merge --statements '<path to a .csv or .xlsx file>'
```

Inputs:
- `--statements` (needed): Statement files. Two or more files of one account, in any order. Each: A .csv or .xlsx file (a path, or the CSV text itself) with a header row, then one row per transaction: a date, and either one signed amount column (money in positive) or money out and money in columns; a description and a running balance are read when present. Rows already in a file, not a PDF or a scan.
- `--openingBalances` (optional): Opening balances. Optional. One per statement, in the order the files are given, separated by semicolons; leave a place blank (or write -) to take that opening balance from the file's running balance column. Example: "1,200.00; ; -".
- `--closingBalances` (optional): Closing balances. Optional. As the opening balances: one per statement in file order, separated by semicolons, blank or - for the running balance column.
- `--columns` (optional): Columns of the statement files. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description, Amount (one signed column), Money out (debit or withdrawal column), Money in (credit or deposit column), Running balance. Use one signed Amount column or the Money out and Money in pair, not both; leave the other out with "= none". Applied to every file; each header named must be in every file.
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.
- `--flipSigns` (optional): Money out written as positive. Optional. true when the single amount column shows money out as positive numbers (common on card exports): its signs are turned round. A cell ending CR or DR keeps its own meaning. Default false.

Mathproven joins and re-adds the rows given; duplicates are listed and kept, and nothing is removed or recorded for you.

## Petty cash reconciliation: count, receipts, over or short (`petty_cash_reconciliation`)

Proves a petty cash box against its fund: the bills and coins counted by denomination are multiplied out, the receipts paid out since the last replenishment are totalled by expense account, and cash plus receipts is compared with the fund to the cent, giving the amount over or short, the replenishment that brings the cash back up to the fund, and the journal entry lines (expense accounts and a shortage debited, the cash account credited) with debits equal to credits. Every figure is worked out a second time. Warnings: an over or short of any size, more cash than the fund, a receipt of zero, a receipt on the cash or over-and-short account. Use it when someone asks to reconcile, count or replenish a petty cash fund, or to write the replenishment entry. Not for choosing which expense account a receipt belongs in.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs petty_cash_reconciliation --fund '<amount, such as 1,234.56>'
```

Inputs:
- `--fund` (needed): Petty cash fund. The fixed amount the box holds in cash and receipts together.
- `--cashCount` (optional): Cash count. How many of each bill and coin are in the box, as "<bill or coin> = <count>" separated by commas, for example "$20 bills = 7, $1 bills = 22, quarters = 13, pennies = 7". The bills and coins: $100 bills, $50 bills, $20 bills, $10 bills, $5 bills, $2 bills, $1 bills, $1 coins, Half dollars (50¢), Quarters (25¢), Dimes (10¢), Nickels (5¢), Pennies (1¢). One not named is zero; a roll of coins is counted as the coins inside it.
- `--receipts` (optional): Receipts. Optional. The receipts or vouchers paid out of the box since the last replenishment: a .csv or .xlsx file (a path, or the CSV text) with a header row and the columns Expense account and Amount (a positive number); Date and Description are read when present.
- `--countDate` (optional): Count date. Optional. The day the box was counted.
- `--name` (optional): Fund or business name. Optional. Printed on the summary.
- `--cashAccount` (optional): Replenishment paid from (account). Optional. The account the replenishment is paid from, as named in the chart of accounts. Default "Cash".
- `--overShortAccount` (optional): Over or short account. Optional. The account an overage or a shortage goes to. Default "Cash over and short".
- `--columns` (optional): Columns of the receipts. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Expense account = Expense account received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Expense account, Amount. Used when present: Date, Description.
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.

Mathproven multiplies, adds and compares the counts, receipts and account names given; it says nothing about which account an expense belongs in.

## Uncashed checks by state and dormancy end date (`uncashed_check_escheat_list`)

Gives every check on an outstanding-check list (.csv or .xlsx with payee state, issue date, amount and a vendor or payroll type; check number and payee when present) the date its payee state's uncashed check dormancy period runs to, from the same sourced state table as the dormancy periods page, and groups the checks by state with counts and totals split into periods ended by the as-of date and still ahead. Each end date passes the table calculator's own second-way counts, the list total is added a second way and tied to the reconciliation's outstanding-check total when given and to the file's own total line, and a state with no row in the table gets no date, never a guess. A row that cannot be read fails the result. Use it when someone asks which uncashed or stale checks have passed their dormancy period, or wants outstanding checks sorted by state for unclaimed property work. Not for due diligence letters, and not for deciding what to report or remit.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs uncashed_check_escheat_list --checkList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--checkList` (needed): Outstanding-check list. A .csv or .xlsx file (a path, or the CSV text) with a header row, then one row per check: payee state (a two-letter code or a full name), issue date and amount are needed, and the type (Vendor or Payroll; AP, accounts payable, wages and PR are read too); check number and payee are read when present. A line reading Total with no issue date is read as the file's own total line.
- `--asOf` (optional): As-of date. Optional. The day the end dates are counted from, such as the reconciliation's statement date. Without it, the day of the run.
- `--statedTotal` (optional): Outstanding-check total on the reconciliation. Optional. The list is tied to it; without it the list is tied to its own rows only, with a warning.
- `--typeWhenBlank` (optional): Type of a check with none written. Optional. "vendor" or "payroll": the type of every check with no type written, or of the whole list when it has no type column. Without it, such a row is listed as a row that could not be read.
- `--negativeAmounts` (optional): Checks written as negative amounts. Optional. true when the list writes each check as a negative number (money out of the account). Default false.
- `--columns` (optional): Columns of the outstanding-check list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Payee state = Payee state received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Payee state, Issue date, Amount. Used when present: Check number, Payee, Type (vendor or payroll).
- `--dateOrder` (optional): Date order. Optional. How a date written like 03/04/2026 is read: "month first" (March 4, the default) or "day first" (3 April). A date written 2026-03-04 reads the same either way.

Mathproven adds a state table row's years to each issue date and adds up the amounts; it does no due diligence and makes no statement about what to report, remit or send. Rules change; this is general information, not legal advice.

## Uncashed check dormancy periods by state (vendor and payroll checks) (`uncashed_check_dormancy_periods`)

Each state's unclaimed property dormancy period for an uncashed vendor (accounts payable) check and an uncashed payroll check: the years after which the law presumes it abandoned, which paragraph each figure comes from, the annual report date for business holders where the source states it, and any rule for checks between businesses. Use it when someone asks how long an outstanding or stale check can sit before it is reportable as unclaimed property in a state, or when the state's holder report is due. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs uncashed_check_dormancy_periods --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives periods and dates from the cited statutes only; each law has its own conditions, exceptions, and notice steps. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.

## Unclaimed property owner notice windows before the annual report, by state (`unclaimed_property_notice_windows`)

For each state's unclaimed property law (or the state office's own holder guide): the window before the annual report in which the owner notice (due diligence letter) is mailed, the amount at which a notice is asked for, the kind of mail, what applies to an uncashed check, and the report date from the dormancy table the window counts back from. Use it when someone asks when due diligence letters go out before a state's unclaimed property report, or the dollar amount that calls for one. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs unclaimed_property_notice_windows --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives windows, amounts and mail from the cited sources only; each law has its own conditions and exceptions. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes or guides are cited here.
