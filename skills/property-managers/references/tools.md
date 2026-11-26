# Property managers: the tools

Each tool runs with `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## CAM reconciliation: common area costs split by tenant square footage (`cam_reconciliation_tenant_shares`)

Year-end CAM (common area maintenance) reconciliation for a commercial property: the recoverable expenses are split by each tenant's square feet of the total leasable area, or by a fixed share where a lease sets one, with vacant space kept on the landlord, an optional admin fee on each share, and each tenant's balance due or credit after the estimates paid. Shares plus the vacancy share are checked to equal the pool to the cent, shares never exceed the building, each fee and balance is worked out again, and recoverable plus excluded expenses equal total expenses. Use it when someone asks to split common area costs among tenants, work out CAM true-ups for the year, or check a CAM reconciliation. Not for grossing up variable expenses to an occupancy, not for base years or expense stops, and not for reading a lease.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_reconciliation_tenant_shares --expenses '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'
```

Inputs:
- `--totalLeasableSquareFeet` (optional): Total leasable square feet. The whole building’s leasable square feet, occupied or not, as a whole number. Vacant space is the difference between this and the tenants’ square feet. Needed unless a file given is a filled-in CAM reconciliation template whose Property sheet has it.
- `--expenses` (needed): Expense list. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per common area expense: Expense category, Amount, and Recoverable (Yes or No; blank is Yes; a No line stays out of the pool). A filled-in CAM reconciliation template can be given as it is: its Expenses sheet is read, and the total leasable square feet, admin fee percent and period filled in on its Property sheet are used (an argument that disagrees with the sheet is refused).
- `--tenants` (needed): Tenant list. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per tenant: Tenant, Square feet (whole square feet leased), Fixed share percent (only where a lease sets a fixed share instead of square feet, written as a number such as 25; blank otherwise) and Estimates paid during the year (blank is zero). A last row that adds the tenants up, named Total or left blank, is left out. A filled-in CAM reconciliation template can be given as it is: its Tenants sheet is read.
- `--adminFeePercent` (optional): Admin fee percent. Optional. The admin fee on each tenant’s share as a percent, such as 10 or 7.5. Without it (and without one on a template’s Property sheet), no fee.
- `--property` (optional): Property. Optional. The property’s name, for the result’s heading.
- `--periodStart` (optional): Period start. Optional. The first day of the period, YYYY-MM-DD.
- `--periodEnd` (optional): Period end. Optional. The last day of the period, YYYY-MM-DD.
- `--expenseColumns` (optional): Columns of the expense list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Expense category = Expense category received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Expense category, Amount. Used when present: Recoverable.
- `--tenantColumns` (optional): Columns of the tenant list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Tenant = Tenant received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Tenant, Square feet. Used when present: Fixed share percent, Estimates paid.

Mathproven splits the pool by the square feet and fixed shares given and keeps vacant space with the landlord; it does not read a lease or say which expenses are recoverable under it.

## CAM gross-up: variable expenses grossed up to an occupancy, then split by tenant share (`cam_gross_up_pool_split`)

Grosses up the variable lines of a CAM expense pool to the occupancy a lease names (factor = gross-up occupancy ÷ actual occupancy, kept as an exact ratio), leaves fixed lines at their actual amounts, applies an optional cap on controllable lines (an amount, or a prior year plus an allowed increase), and splits the pool by tenant square feet or fixed share with each true-up against the estimates paid. The pool is worked out two ways, each variable line is checked against actual × factor, the cap is figured a second way, and the shares plus the unleased remainder add up to the pool to the cent. Use it when someone asks to gross up operating or CAM expenses for vacancy, apply a cap on controllable expenses, or check a grossed-up reconciliation. Not for comparing a year with a base year or an expense stop, and not for deciding which lines a lease makes variable or controllable.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_gross_up_pool_split --totalLeasableSquareFeet '<number>' --occupiedSquareFeet '<text>' --grossUpOccupancyPercent '<number>' --lines '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'
```

Inputs:
- `--totalLeasableSquareFeet` (needed): Total leasable square feet. The whole building’s leasable square feet, occupied or not, as a whole number.
- `--occupiedSquareFeet` (needed): Occupied square feet. The occupied square feet: one figure for a single date (such as 40000), or one figure per month separated by semicolons for the average (such as "38000; 40000; 42000"), at most 12.
- `--grossUpOccupancyPercent` (needed): Gross-up occupancy percent. The occupancy the variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95.
- `--lines` (needed): Expense lines. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line: Expense line, Actual amount, Variable (Yes for lines that vary with occupancy and are grossed up; blank is No) and Controllable (Yes for lines a cap covers; blank is No). Amounts are zero or more.
- `--tenants` (needed): Tenant list. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per tenant: Tenant, Square feet (whole square feet leased), Fixed share percent (only where a lease sets a fixed share instead of square feet, written as a number such as 25; blank otherwise) and Estimates paid during the year (blank is zero). A last row that adds the tenants up, named Total or left blank, is left out.
- `--capAmount` (optional): Cap amount. Optional. A cap on the controllable lines after gross-up, as an amount. Give this or the prior year with an increase, not both.
- `--capPriorYear` (optional): Prior-year controllable expenses. Optional. For a cap figured as the prior year’s controllable expenses plus an allowed increase: the prior year’s amount. Needs capIncreasePercent.
- `--capIncreasePercent` (optional): Allowed increase percent. Optional. The allowed increase over the prior year for the cap, as a percent, such as 5. Needs capPriorYear.
- `--property` (optional): Property. Optional. The property’s name, for the result’s heading.
- `--periodStart` (optional): Period start. Optional. The first day of the period, YYYY-MM-DD.
- `--periodEnd` (optional): Period end. Optional. The last day of the period, YYYY-MM-DD.
- `--lineColumns` (optional): Columns of the expense lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Expense line = Expense line received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Expense line, Actual amount. Used when present: Variable, Controllable.
- `--tenantColumns` (optional): Columns of the tenant list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Tenant = Tenant received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Tenant, Square feet. Used when present: Fixed share percent, Estimates paid.

Mathproven calculates from the lines, marks, occupancy and cap given; it does not decide which lines are variable or controllable, what occupancy applies, or what a lease allows.

## Base year and expense stop: each tenant’s share of operating expenses above the base (`base_year_expense_stop_true_up`)

Compares a year's operating expenses with a base year or an expense stop (per square foot of the building, or a building amount), optionally grossing up the variable lines of both years to the same occupancy, each year by its own factor, and splits the excess by each tenant's pro rata share with its true-up against the estimates paid. The excess is worked out from the totals and line by line, each share is checked against the excess × its share, shares plus the unleased remainder add up to the excess, and shares plus the part not passed through add back to the year's expenses to the cent. Use it when someone asks what each tenant owes above a base year or an expense stop, or wants an operating expense escalation true-up checked. Not for splitting a whole CAM pool without a base, and not for deciding the base year, the stop or the shares a lease sets.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs base_year_expense_stop_true_up --totalLeasableSquareFeet '<number>' --lines '<path to a .csv or .xlsx file>' --tenants '<path to a .csv or .xlsx file>'
```

Inputs:
- `--totalLeasableSquareFeet` (needed): Total leasable square feet. The whole building’s leasable square feet as a whole number.
- `--lines` (needed): Expense lines. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per expense line passed through: Expense line, Base year amount (needed with a base year; not used with a stop), Comparison year amount, and Variable (Yes for lines that change with occupancy; blank is No). Amounts are zero or more.
- `--tenants` (needed): Tenant list. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per tenant: Tenant, Square feet (whole square feet leased), Fixed share percent (only where a lease sets a fixed share instead of square feet, written as a number such as 25; blank otherwise) and Estimates paid during the year (blank is zero). A last row that adds the tenants up, named Total or left blank, is left out. List only the tenants on this base.
- `--stopPerSquareFoot` (optional): Stop per square foot. Optional. An expense stop as an amount per square foot of the building, such as 5.50. Without a stop, the base is the base year’s expenses.
- `--stopAmount` (optional): Stop amount. Optional. An expense stop as one amount for the building. Give this or stopPerSquareFoot, not both.
- `--grossUpOccupancyPercent` (optional): Gross-up occupancy percent. Optional. The occupancy variable lines are grossed up to, as a percent above 0 and no more than 100, such as 95. With a stop, only the comparison year is grossed up. Without it, no gross-up.
- `--baseYearOccupiedSquareFeet` (optional): Occupied square feet, base year. With a gross-up and a base year: the occupied square feet in the base year, as a whole number.
- `--comparisonYearOccupiedSquareFeet` (optional): Occupied square feet, comparison year. With a gross-up: the occupied square feet in the comparison year, as a whole number.
- `--baseYearLabel` (optional): Base year label. Optional. The base year as the lease names it, such as 2024, for the result’s labels.
- `--comparisonYearLabel` (optional): Comparison year label. Optional. The comparison year, such as 2026, for the result’s labels.
- `--property` (optional): Property. Optional. The property’s name, for the result’s heading.
- `--lineColumns` (optional): Columns of the expense lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Expense line = Expense line received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Expense line, Comparison year amount. Used when present: Base year amount, Variable.
- `--tenantColumns` (optional): Columns of the tenant list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Tenant = Tenant received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Tenant, Square feet. Used when present: Fixed share percent, Estimates paid.

Mathproven calculates from the figures given; it does not decide the base year, the stop, which lines pass through, which are variable, or any tenant’s share, which the lease sets.

## Owner statement for a managed rental from a ledger (`owner_statement_from_ledger`)

Builds a monthly owner statement for a managed rental from a ledger (.csv or .xlsx with date, description, amount and type columns): income, expenses, the management fee at the rate given (optionally only on income lines containing a word such as rent), what was paid to the owner, and the closing balance that carries into the next period. The closing balance and the fee are worked out a second way, every ledger row is either imported once or listed as left out, each imported amount is read from its cell a second time, and a row that cannot be read, or whose type does not say which way the money went, fails a check that names the row. Use it when someone asks for an owner statement or a monthly owner report from their own rental ledger, or wants the fee and closing balance checked. Not for tenant ledgers or rent rolls, and not for deciding what a management agreement allows.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs owner_statement_from_ledger --ledger '<path to a .csv or .xlsx file>' --periodStart '<YYYY-MM-DD>' --periodEnd '<YYYY-MM-DD>'
```

Inputs:
- `--ledger` (needed): Ledger. A .csv or .xlsx file (a path, or the CSV text itself) with one row per transaction: Date and Amount are needed; Description and Type (Income, Expense or Distribution, meaning money paid to the owner) are used when present. Without a type column, positive amounts are income and negative amounts expenses. A filled-in owner statement template can be given as it is: its Ledger sheet is read.
- `--periodStart` (needed): Period start. The first day of the statement period, YYYY-MM-DD.
- `--periodEnd` (needed): Period end. The last day of the statement period, YYYY-MM-DD.
- `--openingBalance` (optional): Opening balance. Optional. The balance carried in from last period. Without it, zero.
- `--managementFeePercent` (optional): Management fee percent. Optional. The management fee as a percent of income, such as 8. Without it, no fee.
- `--feeOnIncomeContaining` (optional): Fee only on income lines containing. Optional. A word such as "rent": the fee is figured only on income lines whose description contains it, ignoring case. Without it, on all income.
- `--reserve` (optional): Reserve held. Optional. A reserve the manager keeps; a warning shows when the closing balance is below it.
- `--owner` (optional): Owner. Optional. The owner’s name, for the statement.
- `--property` (optional): Property. Optional. The property, for the statement.
- `--expenseSign` (optional): How the ledger writes expenses. Optional. "from-file" (the default) reads it from the file and imports nothing when expense rows are written with both signs; "negative" or "positive" says how expenses are written, and rows written the other way become reversals (a vendor refund reduces expenses).
- `--typeMeanings` (optional): What unrecognized types mean. Optional. For a type the tool does not recognize or that does not say which way money went (Payment, Charge, Credit, Deposit): "<type in the file> = income | expense | paid to owner | leave out", separated by commas, such as "Rent payment = income, Owner draw = paid to owner". "blank" names rows with no type. Nothing is assumed without it.
- `--leaveOutRows` (optional): Rows to leave out. Optional. Row numbers of the ledger (as the spreadsheet shows them) that could not be imported and that the person has chosen to leave out, such as "7, 12". Each stays on the certificate as a warning.
- `--dateOrder` (optional): Dates written with numbers only. Optional. "month-first" (the default, 3/2/2026 is March 2) or "day-first".
- `--ledgerColumns` (optional): Columns of the ledger. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date, Amount. Used when present: Description, Type.

Mathproven adds up the ledger rows given and works out the fee at the rate entered; it does not read a management agreement or say what to pay the owner.

## Security deposit interest and itemized deposit statement (`security_deposit_interest_statement`)

Works out interest on a tenant's security deposit at the annual rate given (simple interest on actual days / 365, or compounded on each anniversary of the date received), subtracts interest already paid and itemized deductions, and gives the amount to return to the tenant or the balance the tenant owes, as an itemized statement with the interest by period. Interest is figured twice in different orders of operations, days held are counted two ways, the balance is rebuilt line by line, and figures from a statement prepared elsewhere can be compared with the calculated ones. Use it when someone asks how much interest a deposit earned, wants an itemized deposit statement at move-out, or wants a deposit statement checked. Not for finding which rate, method or deductions a state or lease allows: the rate is the person's to give.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs security_deposit_interest_statement --deposit '<amount, such as 1,234.56>' --receivedOn '<YYYY-MM-DD>' --moveOutOn '<YYYY-MM-DD>' --annualRatePercent '<number>'
```

Inputs:
- `--deposit` (needed): Deposit amount. The security deposit received, such as 1800.00.
- `--receivedOn` (needed): Date received. The day the deposit was received, YYYY-MM-DD (day zero of the count).
- `--moveOutOn` (needed): Move-out date. The move-out day, YYYY-MM-DD (the last day counted).
- `--annualRatePercent` (needed): Annual interest rate percent. The annual rate from the lease or a local rule, as a percent from 0 to 100 with at most two decimal places, such as 2 or 0.05. 0 is allowed. The tool does not supply a rate.
- `--method` (optional): Interest method. Optional. "simple" (the default: deposit × rate × actual days / 365) or "compound-annual" (a year’s interest added on each anniversary, simple interest for the last part-year).
- `--deductions` (optional): Deductions. Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per deduction: Description and Amount. A last row that adds them up, named Total or left blank, is left out.
- `--interestPaid` (optional): Interest already paid. Optional. A .csv or .xlsx file (a path, or the CSV text itself, first row the headers) with one row per payment of interest already paid or credited to the tenant: Date, written YYYY-MM-DD (a date written with slashes, such as 1/3/2024, is refused so the day and month cannot be mixed up; with compounding, a dated payment leaves the balance on that date), and Amount.
- `--statedInterest` (optional): Interest on an existing statement. Optional. The interest shown on a statement prepared elsewhere, to compare with the calculated interest.
- `--statedBalance` (optional): Amount returned on an existing statement. Optional. The amount returned on a statement prepared elsewhere (negative if the tenant owes), to compare with the calculated balance.
- `--tenant` (optional): Tenant. Optional. The tenant’s name, for the statement.
- `--property` (optional): Property. Optional. The property, for the statement.
- `--deductionColumns` (optional): Columns of the deductions. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount. Used when present: Description.
- `--interestPaidColumns` (optional): Columns of the interest already paid. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount. Used when present: Date.

Mathproven figures interest only at the rate entered; it does not choose a rate or say which rate, method, or deductions apply to a tenancy.

## Short-term rental payouts matched to bank deposits (`short_term_rental_payout_reconciler`)

Ties out a payout or earnings report exported from a short-term rental platform (.csv or .xlsx) against a bank statement export: each report row is checked (gross earnings − fees ± cleaning fees, taxes and adjustments, as mapped, = payout), rows are grouped into payouts by payout id or payout date, and each payout is matched to exactly one bank deposit of the same amount within a date window (5 days unless given). A payout or deposit with more than one possible pairing is listed as ambiguous and never matched, no payout or deposit is used twice, and matched + ambiguous + unmatched is checked against all payouts and all deposits by count and by amount. Use it when someone asks whether their rental payouts reached the bank, or wants host payouts reconciled with bank deposits. Not affiliated with any rental platform; not for booking calendars, guest messages or tax returns.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs short_term_rental_payout_reconciler --payoutReport '<path to a .csv or .xlsx file>' --bankStatement '<path to a .csv or .xlsx file>'
```

Inputs:
- `--payoutReport` (needed): Payout report. The payout or earnings report exported from the rental platform: a .csv or .xlsx file (a path, or the CSV text itself) with a header row. Payout date and payout amount are needed; reservation code, payout id, gross earnings, fees, cleaning fees, taxes and adjustments are used when present.
- `--bankStatement` (needed): Bank statement. The bank statement export: a .csv or .xlsx file (a path, or the CSV text itself) with Date and Amount columns, and Description when present. Only money coming in is matched.
- `--windowDays` (optional): Days allowed between payout and deposit. Optional. How many days a deposit may be before or after its payout date, a whole number from 0 to 60. Without it, 5.
- `--groupBy` (optional): Group report rows into payouts by. Optional. "auto" (the default: payout id when every row has one, otherwise payout date), "payout-id" or "payout-date".
- `--bankDescriptionContains` (optional): Only bank deposits whose description contains. Optional. Text a deposit’s description must contain to be considered, ignoring case, such as "payout". Narrows ties between deposits of the same amount.
- `--bankMoneyIn` (optional): Money in on the bank statement is shown as. Optional. "positive" (the default) or "negative" amounts.
- `--undatedRows` (optional): Report rows with an amount but no payout date. Optional. "report" (the default: listed as rows that could not be read, so the result is not verified), "inherit" (given the payout date of the row above) or "leave-out" (totals or notes). Either of the last two is recorded as a warning that names the rows. A totals row whose amounts equal the column totals above it is left out by itself.
- `--dateOrder` (optional): Dates written with numbers only. Optional. "month-first" (the default) or "day-first"; applies to both files.
- `--amountSigns` (optional): Added or subtracted. Optional. How an amount column enters the payout, when the guess is wrong: "<column> = add" or "<column> = subtract", separated by commas. Columns: Gross earnings, Host or service fees, Cleaning fees, Taxes withheld or remitted, Adjustments or resolutions. By default fees and taxes written as positive numbers are subtracted, and everything else is added as written.
- `--reportColumns` (optional): Columns of the payout report. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Payout date = Payout date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Payout date, Payout amount. Used when present: Reservation or confirmation code, Payout id or reference, Gross earnings, Host or service fees, Cleaning fees, Taxes withheld or remitted, Adjustments or resolutions.
- `--bankColumns` (optional): Columns of the bank statement. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date, Amount. Used when present: Description.

Mathproven only reads the two files given and pairs amounts that match exactly; it is not affiliated with any short-term rental platform and does not decide which pairing is right when more than one is possible.

## CAM reconciliation template workbook (Excel) to fill in (`cam_reconciliation_template_workbook`)

Builds a blank Excel workbook for a year-end CAM reconciliation, sized to the property: a Property sheet (name and period filled in), an Expenses sheet with numbered rows (expense category, amount, recoverable Yes or No), a Tenants sheet with one row per tenant (square feet, fixed share percent, estimates paid) and an Instructions sheet. The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants a CAM reconciliation spreadsheet or layout to fill in for a commercial property. Not a calculator: the workbook does not split anything.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs cam_reconciliation_template_workbook
```

Inputs:
- `--tenantCount` (optional): Number of tenants. Optional. How many tenant rows the Tenants sheet starts with, a whole number from 1 to 500. Without it, 5.
- `--expenseRows` (optional): Number of expense rows. Optional. How many rows the Expenses sheet starts with, a whole number from 1 to 500. Without it, 12.
- `--property` (optional): Property name. Optional. Filled in on the Property sheet and used in the file name.
- `--periodStart` (optional): Period start. Optional. Filled in on the Property sheet, YYYY-MM-DD.
- `--periodEnd` (optional): Period end. Optional. Filled in on the Property sheet, YYYY-MM-DD; not before the start.

Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.

## Owner statement template workbook (Excel) with a ledger sheet (`owner_statement_template_workbook`)

Builds a blank Excel workbook for a monthly rental owner statement: a Statement sheet (owner, property and period filled in, the totals left to fill), a Ledger sheet with Date, Description, Amount and Type columns and as many rows as asked, and an Instructions sheet. Type is one of Income, Expense or Distribution (money paid to the owner). The workbook holds values only, with no formulas, and it is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked. Use it when someone wants an owner statement spreadsheet or a ledger layout to fill in for a managed rental. Not a calculator: the workbook does not add anything up.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs owner_statement_template_workbook
```

Inputs:
- `--ledgerRows` (optional): Number of ledger rows. Optional. How many rows the Ledger sheet starts with, a whole number from 1 to 500. Without it, 30.
- `--owner` (optional): Owner name. Optional. Filled in on the Statement sheet.
- `--property` (optional): Property name. Optional. Filled in on the Statement sheet and used in the file name.
- `--periodStart` (optional): Period start. Optional. Filled in on the Statement sheet, YYYY-MM-DD.
- `--periodEnd` (optional): Period end. Optional. Filled in on the Statement sheet, YYYY-MM-DD; not before the start.

Mathproven builds a blank layout that holds values only; the workbook does not calculate anything or say what belongs in it.

## Residential rent late fee limits and grace periods by state (`rent_late_fee_limits`)

The most a state statute lets a landlord charge as a late fee on residential rent (a percent of the rent or of the unpaid rent, a flat amount, or the greater or lesser of two, by rent band where the statute has them) and how many days after the due date the statute makes the landlord wait before charging one, with the conditions in words. Use it when someone asks the legal cap on a rent late fee or the grace period for rent in a state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs rent_late_fee_limits --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives figures and waiting periods from the cited statutes only; leases, cities, and counties can set lower limits or longer waits. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.

## Residential security deposit rules by state: maximum, return period, interest (`security_deposit_rules`)

Each state's residential security deposit statute: the maximum deposit it states (in months of rent, with its other tiers in words), the days it gives for returning the deposit or an itemized list after move-out and what starts each count, and whether it requires interest to be paid to the tenant. Use it when someone asks how much a landlord may take as a security deposit, or how many days a landlord has to return one, in a state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs security_deposit_rules --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives each statute's figures, not a statement of what anyone is required to do. Statutes differ on how days are counted and on what starts the count; the row and its source say which event the statute names.
