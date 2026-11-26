# Law firm trust accounts: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Three-way trust account reconciliation to the cent (`three_way_trust_reconciliation`)

Puts three figures for one date side by side for a law firm's trust (IOLTA) account: the adjusted bank balance (bank statement ending balance less outstanding checks plus deposits in transit), the trust journal (checkbook) balance and the sum of the client ledger balances, and compares each pair to the cent with the difference shown. The figures and differences are worked out a second way, the lists re-add, a client ledger below zero fails a check, and optional prior-period figures (prior balance plus receipts less disbursements) are compared with the journal balance. It also opens a filled-in three-way reconciliation template workbook and checks each total written on it by hand. Use it when someone asks for a three-way reconciliation, or why the bank, the checkbook and the client ledgers do not agree. Not for building the client ledgers from transactions, and it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs three_way_trust_reconciliation
```

Inputs:
- `--workbook` (optional): Filled-in template workbook. Optional. A filled-in .xlsx made with the three-way reconciliation template (sheets Reconciliation, Outstanding checks, Deposits in transit, Client ledgers). It supplies every figure and list below, so none of them (nor their column names) is given with it; only "account" may be.
- `--bankBalance` (optional): Bank statement ending balance. The bank statement ending balance for the date. Needed unless a workbook is given.
- `--journalBalance` (optional): Trust journal balance. The trust journal (checkbook register) balance on the same date. Needed unless a workbook is given.
- `--outstandingChecks` (optional): Outstanding checks. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per check written in the trust journal that is not on the bank statement yet: an amount, with a date and a check number or payee when known. A row labelled Total is left out.
- `--depositsInTransit` (optional): Deposits in transit. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per deposit recorded in the trust journal that is not on the bank statement yet: an amount, with a date and a note when known.
- `--clientLedgers` (optional): Client ledger balances. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its ledger balance on the date. A row labelled Total is left out.
- `--asOf` (optional): As-of date. Optional. The date the three figures are as of, YYYY-MM-DD.
- `--priorBalance` (optional): Prior period reconciled balance. Optional. With receipts and disbursements: last period's reconciled balance, compared after the period's activity with this trust journal balance.
- `--receipts` (optional): Receipts this period. Optional. Money into the trust account this period, as a positive amount.
- `--disbursements` (optional): Disbursements this period. Optional. Money out of the trust account this period, as a positive amount.
- `--account` (optional): Firm or account name. Optional. The firm or trust account name for the summary.
- `--checksColumns` (optional): Columns of the outstanding checks. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount. Used when present: Date, Check number, payee, or note.
- `--depositsColumns` (optional): Columns of the deposits in transit. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount. Used when present: Date, Check number, payee, or note.
- `--ledgerColumns` (optional): Columns of the client ledger balances. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Client or matter = Client or matter received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Client or matter, Ledger balance.

Mathproven shows whether three figures are equal and by how much they differ; it does not check any rule and makes no statement about what any rule, regulation, or agreement requires.

## Client trust ledger card: one client, balance after every line (`client_trust_ledger_card`)

Builds one client's or matter's trust ledger card from a list of receipts and disbursements (.csv or .xlsx): every line in date order with the balance after it, the receipts and disbursements totals, the closing balance and the lowest balance. Every balance is re-added from the opening balance on a second pass, the totals are added again in the opposite order, and every line after which the balance is below zero is listed; a card that goes below zero is not verified. Use it when someone asks for a client trust ledger, a client ledger card or one matter's running trust balance from a law firm's trust (IOLTA) records. Not for a whole account's journal across clients, and it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs client_trust_ledger_card --entries '<path to a .csv or .xlsx file>'
```

Inputs:
- `--entries` (needed): Entries list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present. Same-date rows keep the file's order.
- `--client` (optional): Client or matter. Optional. The client or matter the card is for, as the file writes it. Needed when the file names more than one client or matter: only that one's rows go on the card. Also the name printed on the card.
- `--opening` (optional): Opening balance. Optional. The balance carried onto the card before its first line. Without it, zero.
- `--account` (optional): Firm or account name. Optional. The firm or trust account name for the card's summary.
- `--columns` (optional): Columns of the entries list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.

Mathproven carries a balance and compares totals; it makes no statement about what any rule, regulation, or agreement requires.

## Trust receipts and disbursements journal with client subtotals (`trust_receipts_disbursements_journal`)

Builds the receipts and disbursements journal of a law firm's trust (IOLTA) account from a period's transactions (.csv or .xlsx): every entry in date order with the account balance after it, the receipts and disbursements totals, a subtotal per client or matter, and the check numbers used twice or missing from the run. Every balance re-adds from the opening balance, each client subtotal matches a second grouping, and the subtotals tie to the journal totals. Entries with no client, lines below zero and check-number gaps are listed as findings. Use it when someone asks for a trust journal, a cash receipts and disbursements journal, client subtotals for the month, or missing check numbers. Not for one client's card alone, and it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_receipts_disbursements_journal --entries '<path to a .csv or .xlsx file>'
```

Inputs:
- `--entries` (needed): Entries list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present. Same-date rows keep the file's order.
- `--opening` (optional): Opening balance. Optional. The journal balance before the first entry. Without it, zero.
- `--account` (optional): Firm or account name. Optional. The firm or trust account name for the summary.
- `--period` (optional): Period. Optional. The period the journal covers, as words for the summary ("March 2026").
- `--columns` (optional): Columns of the entries list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.

Mathproven adds, subtotals, and lists; it makes no statement about what any rule, regulation, or agreement requires.

## Trust account scan for client ledgers below zero, by date (`trust_negative_balance_scan`)

Scans a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row): each client's running balance is walked in date order and taken at the end of each date, and every date a client ledger ends below zero is listed, with every transaction that has no client or matter, and, when a firm funds ledger and a ceiling are given, every date that ledger ends above the ceiling. At every date the client ledgers are proved to add up to the account balance, and every list is matched by a second walk; the findings are warnings beside those checks. Use it when someone asks whether any client went negative, which transactions are unassigned, or how much firm money sat in trust. Not for a single client's card, and it has no ceiling of its own and makes no statement about what any rule allows.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_negative_balance_scan --transactions '<path to a .csv or .xlsx file>'
```

Inputs:
- `--transactions` (needed): Trust transaction list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present.
- `--openingBalances` (optional): Opening balances. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its balance before the first transaction in the transaction list. A row labelled Total is left out. Clients not listed start at zero.
- `--firmLedger` (optional): Firm funds ledger. Optional. The name of the ledger that holds the firm's own funds, as written in the file. Used with "firmCeiling".
- `--firmCeiling` (optional): Ceiling for the firm funds ledger. Optional. A ceiling of the person's own choosing for the firm funds ledger: each date that ledger ends above it is listed, with the amount above. Needs "firmLedger".
- `--columns` (optional): Columns of the trust transaction list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.
- `--openingColumns` (optional): Columns of the opening balances. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Client or matter = Client or matter received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Client or matter, Ledger balance.

Mathproven reports balances, dates, and differences; it makes no statement about what any rule, regulation, or agreement requires.

## Client trust ledgers rebuilt from a bank statement export (`trust_ledgers_from_bank_statement`)

Rebuilds a law firm's client trust ledgers and the trust journal from the trust (IOLTA) account's bank statement export (.csv or .xlsx), with each transaction assigned to a client or matter from a column in the file or by row number. The statement is verified first (opening balance plus transactions equals the closing balance, and every printed running balance matches), then every transaction is placed in exactly one client ledger, each ledger re-adds, client opening balances add up to the statement's opening balance, and the client ledgers add up to the bank closing balance to the cent. A transaction with no client fails the check. Use it when someone needs client ledgers reconstructed from bank records, or wants to see which clients' money makes up the bank balance. Not for a statement in PDF form, and it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_ledgers_from_bank_statement --statement '<path to a .csv or .xlsx file>' --openingBalance '<amount, such as 1,234.56>' --closingBalance '<amount, such as 1,234.56>'
```

Inputs:
- `--statement` (needed): Bank statement export. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per bank transaction: a date, and either one signed amount column or separate deposit and withdrawal columns; a description, a running balance and a client or matter column are used when present.
- `--openingBalance` (needed): Statement opening balance. The opening balance printed on the bank statement.
- `--closingBalance` (needed): Statement closing balance. The closing balance printed on the bank statement.
- `--order` (optional): Order of rows in the file. Optional. "oldest first" or "newest first", as the bank lists the transactions. Without it, oldest first.
- `--openingBalances` (optional): Client opening balances. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its balance at the start of the statement period (they are compared with the statement's opening balance; leave out when the account opened at zero). A row labelled Total is left out. Clients not listed start at zero.
- `--clients` (optional): Client or matter by row. Optional. The client or matter for rows of the statement, as "<row number> = <client or matter>" separated by semicolons or new lines, using the row numbers the file shows (the header is row 1 in a file with no title rows). It fills in or replaces the file's client column for those rows; "<row number> =" with no name leaves a row unassigned.
- `--columns` (optional): Columns of the bank statement export. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.
- `--openingColumns` (optional): Columns of the client opening balances. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Client or matter = Client or matter received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Client or matter, Ledger balance.

Mathproven builds ledgers and compares totals; it makes no statement about what any rule, regulation, or agreement requires.

## Earned fees left in trust: billed fees not transferred, by client and age (`earned_fees_left_in_trust`)

Sets a law firm's invoices (fees billed) against the fee transfers out of its trust (IOLTA) account, client by client, from two .csv or .xlsx files: a trust transaction list and an invoice list. Fee transfers are the money-out rows whose description or check number holds a word given ("operating" unless told otherwise), and each one is listed. It gives the invoices billed and not transferred, oldest first, with their age in days; transfers above what was billed, on the as-of date and by each transfer's date; and each client's trust balance. Every client figure re-adds from both files, and the transfers tie to the trust balance. Use it when someone asks which billed fees are still sitting in trust, or whether more was taken from trust than was billed. Not for deciding whether a fee is earned or when money is moved: it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs earned_fees_left_in_trust --transactions '<path to a .csv or .xlsx file>' --invoices '<path to a .csv or .xlsx file>'
```

Inputs:
- `--transactions` (needed): Trust transaction list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present.
- `--invoices` (needed): Invoice list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per invoice: invoice date, client or matter and fees billed are needed; an invoice number is used when present. A credit note is written below zero.
- `--transferWords` (optional): Words that mark a fee transfer. Optional. Words, separated by commas, that a money-out row's description or check number holds when it is a fee transfer to the firm, ignoring case. Without it, "operating".
- `--asOf` (optional): As-of date. Optional. The date the report is taken on, YYYY-MM-DD; rows and invoices after it are left out. Without it, the day of the run.
- `--from` (optional): Count from. Optional. YYYY-MM-DD: invoices and fee transfers before it are not counted as billed or transferred; the trust rows still count in the balances.
- `--carriedIn` (optional): Carried-in balances. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its trust balance before the first row of the trust list. A row labelled Total is left out. Clients not listed start at zero.
- `--columns` (optional): Columns of the trust transaction list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.
- `--invoiceColumns` (optional): Columns of the invoice list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Invoice date = Invoice date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Invoice date, Client or matter, Fees billed. Used when present: Invoice number.
- `--carriedColumns` (optional): Columns of the carried-in balances. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Client or matter = Client or matter received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Client or matter, Ledger balance.

Mathproven sets the invoices against the transfers, gives amounts, dates, and ages, and proves the totals; it does not say what any rule requires, when or whether money is moved, or whether an amount is earned.

## Dormant trust balances: client balances with no activity, by age (`dormant_trust_balance_report`)

From a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row), an as-of date and a period in years or months given by the person, takes every client's balance on the as-of date and its last activity, and lists each balance above zero with no activity since the cutoff (the as-of date less the period), oldest first, with its age. Balances below zero are listed on their own. The cutoff is worked out a second way, every balance, last activity date and age is recomputed from the rows, and listed plus active plus below-zero balances are proved to equal the trust total. Use it when someone asks which client funds have sat untouched in trust, for how long, or for an aged list of stale trust balances. Not for deciding whether a balance is unclaimed or abandoned: it has no period of its own and makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs dormant_trust_balance_report --transactions '<path to a .csv or .xlsx file>' --period '<number>'
```

Inputs:
- `--transactions` (needed): Trust transaction list. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present. It should reach back to each client's last activity, or the earlier balance is carried in.
- `--period` (needed): Period. The length of time with no activity, as a whole number of years or months (see "unit"), as the person gives it. The tool has no period of its own.
- `--unit` (optional): Period counted in. Optional. "years" or "months". Without it, years.
- `--asOf` (optional): As-of date. Optional. The date the balances are taken on, YYYY-MM-DD; rows after it are left out. Without it, the day of the run.
- `--carriedIn` (optional): Carried-in balances. Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client whose money was in trust before the first row of the transaction list: the name, the balance then, and the date of that client's last activity before the list starts. Clients not listed start at zero.
- `--columns` (optional): Columns of the trust transaction list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date. Used when present: Description or payee, Client or matter, Amount (money in positive, money out negative), Money in (deposits), Money out (checks and withdrawals), Running balance, Check number or reference.
- `--carriedColumns` (optional): Columns of the carried-in balances. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Client or matter = Client or matter received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Client or matter, Balance carried in, Last activity date.

Mathproven lists balances by amount and last activity against the period typed; it makes no statement about whether a balance is unclaimed or abandoned or what any rule requires.

## Three-way trust reconciliation workbook to fill in (`three_way_reconciliation_template`)

Builds a blank Excel workbook (.xlsx) laid out for a monthly three-way reconciliation of a law firm's trust (IOLTA) account: a Reconciliation sheet (firm or account, as-of date, bank statement ending balance, the lines for totals and differences, trust journal balance, optional prior-period lines), numbered Outstanding checks, Deposits in transit and Client ledgers sheets, and an Instructions sheet, with client or matter names filled in when given. The finished file is read back before it is handed over: the five sheet names, every Reconciliation line, each list's header and number of rows, and every name are compared with what was asked for, and no cell holds a formula. Use it when someone wants a three-way reconciliation template or spreadsheet to fill in by hand. Not for doing the reconciliation itself, and it makes no statement about what any rule requires.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs three_way_reconciliation_template
```

Inputs:
- `--account` (optional): Firm or account name. Optional. The firm or trust account name written on the Reconciliation sheet.
- `--asOf` (optional): As-of date. Optional. The date the reconciliation is for, YYYY-MM-DD, written on the Reconciliation sheet.
- `--clients` (optional): Client or matter names. Optional. Client or matter names, one per line: each line gets its own numbered row on the Client ledgers sheet, in order.
- `--clientRows` (optional): Client ledger rows. Optional. Rows on the Client ledgers sheet, a whole number from 1 to 500; every name given still gets a row. Without it, 20.
- `--checkRows` (optional): Outstanding check rows. Optional. Rows on the Outstanding checks sheet, a whole number from 1 to 500. Without it, 15.
- `--depositRows` (optional): Deposit in transit rows. Optional. Rows on the Deposits in transit sheet, a whole number from 1 to 500. Without it, 5.

Mathproven builds its own layout in generic terms, values only with no formulas; it makes no statement about what any rule, regulation, or agreement requires.

## Lawyer trust account record retention periods by state (`trust_record_retention_by_state`)

How many years each jurisdiction's own court rule (its safekeeping-property rule or trust account record-keeping rule) says complete lawyer trust account (IOLTA) records are kept, and what day the period runs from (the end of the representation, the final distribution, the later or earlier of the two, the transaction itself, or the fiscal year end). Use it when someone asks how long a law firm keeps client trust account records in a state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trust_record_retention_by_state --member '<text>'
```

Inputs:
- `--member` (needed): Jurisdiction. The jurisdiction to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives periods as each cited rule states them. Nothing here says which records a rule covers in a particular case or what to keep or discard. Mathproven is not affiliated with any court or bar whose rules are cited here.
