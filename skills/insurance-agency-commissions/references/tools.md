# Insurance agency commissions: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Insurance commission on one policy, with the chargeback on a cancellation (`insurance_commission_calculator`)

Works out the commission on one insurance policy step by step: premium times the new business or renewal rate, and, when the policy was cancelled, the return premium pro rata by days (or as typed from a cancellation notice), the chargeback at the same rate and the commission kept; with a producer share, the producer and house parts to the cent. Every step is worked a second time with separate whole-number arithmetic, the day counts are recounted, and kept plus chargeback is checked to equal the commission. Use it when someone asks what the commission is on a premium, or how much commission comes back when a policy cancels mid-term. Not for a short-rate table or a minimum earned premium, and not for a whole statement of lines.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs insurance_commission_calculator --premium '<amount, such as 1,234.56>' --termKind '<new|renewal>'
```

Inputs:
- `--premium` (needed): Premium for the term. The premium for the policy term, in dollars, such as 4800.00.
- `--termKind` (needed): This term is. "new" for new business or "renewal" for a renewal: picks which rate is applied.
- `--newBusinessRate` (optional): New business rate (%). The new business commission rate as a percent with at most two decimals, such as 15 or 12.5. Needed when the term is new business; with a renewal it is shown for comparison.
- `--renewalRate` (optional): Renewal rate (%). The renewal commission rate as a percent, such as 10. Needed when the term is a renewal; with new business it is shown for comparison.
- `--producerShare` (optional): Producer share of the commission (%). Optional. The producer's percent of the commission, such as 40; the house keeps the rest.
- `--effectiveDate` (optional): Effective date. For a cancellation worked from dates: the day the term started, YYYY-MM-DD.
- `--expirationDate` (optional): Expiration date. For a cancellation worked from dates: the day the term ends, YYYY-MM-DD. Without it, one year after the effective date.
- `--cancellationDate` (optional): Cancellation date. For a cancellation worked from dates: the day the policy was cancelled, YYYY-MM-DD. Days in force run up to, not including, this day.
- `--returnPremium` (optional): Return premium. For a cancellation with the return premium already known (from a cancellation notice): the amount, instead of the dates.

Mathproven applies the rates and dates given and proves the arithmetic; it makes no statement about what any carrier contract, commission schedule or producer agreement requires.

## Commission statement to clean rows, tied to the statement total (`commission_statement_to_excel`)

Reads an insurance commission statement spreadsheet (.csv or .xlsx) in any layout and turns it into one clean row per statement line: policy number, insured, line, transaction type, effective date, producer, premium, rate and commission. The lines are added up and compared with the statement total and the payment received when they are given, and with the file's own total row when it has exactly one; premium times rate is compared with the commission on every row that shows both, and rows that differ are listed. Use it when someone wants a carrier's commission statement as a normalized table, or wants to know whether a statement's lines add up to what was paid. Not for PDF statements, and not for comparing a statement with a book of business.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_statement_to_excel --statement '<path to a .csv or .xlsx file>'
```

Inputs:
- `--statement` (needed): Commission statement. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per statement line. Only the commission amount column is needed; policy number, insured, line, transaction type, effective date, premium, commission rate and producer are read when present. Title rows above the header and a total row are handled. In a workbook, a sheet named "Commission log" is read when there is one.
- `--statementTotal` (optional): Statement total. Optional. The total printed on the statement, compared with the sum of the lines.
- `--paymentReceived` (optional): Payment received. Optional. The check or deposit amount received, compared with the sum of the lines.
- `--rateFormat` (optional): How rates are written. Optional. "percent" when 12.5 means 12.5%, "fraction" when 0.125 means 12.5%. A cell with a % sign is always a percent. Without it, read from the column: fraction when every filled rate is a plain number below 1.
- `--columns` (optional): Columns of the commission statement. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Commission amount = Commission amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Commission amount. Used when present: Policy number, Insured name, Product or line, Transaction type, Effective date, Premium, Commission rate, Producer or agent.

Mathproven adds up the lines in the file and compares them with the totals given; it makes no statement about what any carrier contract or commission schedule requires.

## Commission summary by carrier and line of business, tied to each statement (`commission_summary_by_carrier`)

Rolls a month of insurance commission lines (.csv or .xlsx, one row per line with the carrier on it, such as a commission log) up by carrier and by line of business within each carrier. Each carrier's lines are compared with the total printed on its statement and the payment received when they are given, and every subtotal is rebuilt a second way from the lines; carrier totals and line-of-business totals must both add up to all the commission. Carrier names match ignoring case and extra spaces. When the workbook has a Carriers sheet with statement totals (the commission tracking template), those totals are read too. Use it when someone asks for commission by carrier or by line of business for a month, or whether each carrier paid what its lines add up to. Not for comparing lines with a book of business, and not for one policy.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_summary_by_carrier --commissionLines '<path to a .csv or .xlsx file>'
```

Inputs:
- `--commissionLines` (needed): Commission lines. A .csv or .xlsx file (a path, or the CSV text) with one row per commission line. The commission amount is needed; carrier, line of business, policy number and premium are read when present. In a workbook, a sheet named "Commission log" is read, and a sheet named "Carriers" with statement totals and payments is read as those totals.
- `--statementTotals` (optional): Statement total for each carrier. Optional. The total printed on each carrier's statement, as "<carrier> = <amount>" separated by semicolons or new lines, for example "Carrier A = 689.00; Carrier B = 625.00". A carrier given here replaces its total from a Carriers sheet.
- `--paymentsReceived` (optional): Payment received from each carrier. Optional. The check or deposit from each carrier, written the same way: "Carrier A = 689.00; Carrier B = 625.00".
- `--defaultCarrier` (optional): Carrier for rows that name none. Optional. For a file from one carrier with no carrier column, or rows with a blank carrier: the carrier's name.
- `--columns` (optional): Columns of the commission lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Commission amount = Commission amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Commission amount. Used when present: Carrier, Line of business, Policy number, Premium.

Mathproven shows the arithmetic difference between the lines in the file and the totals given; it makes no statement about what any carrier contract or commission schedule requires.

## Insurance commission tracking workbook for one month (Excel) (`commission_tracking_template`)

Builds a blank Excel workbook for tracking one month of an insurance agency's commissions: a Month sheet with the agency and statement month, a Carriers sheet with numbered rows for each carrier's statement total and payment, a Producers sheet with split percents, a Book of business sheet, a Commission log and an Instructions sheet. Values only, no formulas. The finished file is read back before it is handed over: sheet names, header rows and row counts are compared with what was asked for, and the Book of business and Commission log header rows are matched the way the commission tools match them. Use it when someone wants a commission tracking spreadsheet or template to fill in. Not for calculating anything: the workbook holds no formulas.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_tracking_template
```

Inputs:
- `--agency` (optional): Agency name. Optional. The agency name for the Month sheet and the file name, at most 120 characters.
- `--month` (optional): Statement month. Optional. The month the workbook covers, written YYYY-MM, such as 2026-02.
- `--carrierCount` (optional): Number of carriers. Optional. How many numbered rows the Carriers sheet starts with, a whole number from 1 to 200. Without it, 10.
- `--producerCount` (optional): Number of producers. Optional. How many numbered rows the Producers sheet starts with, a whole number from 1 to 200. Without it, 3.

Mathproven builds a layout to fill in, with values only; the workbook does not calculate, and nothing in it says what any carrier or producer is owed.

## Insurance commission reconciliation: expected from the book against paid on the statement (`commission_expected_vs_paid_reconciliation`)

Compares an agency's book-of-business export (what each policy was expected to pay: an expected commission, or premium times an expected rate) with a commission statement (what was paid), matching only on exactly the same policy number, ignoring case and extra spaces. Each policy lands in one bucket: paid as expected, short-paid, over-paid, paid but not in book, or in book but not paid, with the difference. Both sides are proved to add up by count and amount in an independent pass, no row is used twice, and near matches (same number without punctuation, or same insured) are listed for review and never accepted. Use it when someone asks which policies a carrier underpaid, overpaid or did not pay this month. Not for policies due over several months by date (aging), and not for one policy's commission.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs commission_expected_vs_paid_reconciliation --bookOfBusiness '<path to a .csv or .xlsx file>' --statement '<path to a .csv or .xlsx file>'
```

Inputs:
- `--bookOfBusiness` (needed): Book of business. A .csv or .xlsx file (a path, or the CSV text) with one row per policy: policy number, and either an expected commission amount or a premium and an expected rate (the amount is used when both are there); insured name when present. In a workbook, a sheet named "Book of business" is read when there is one.
- `--statement` (needed): Commission statement. A .csv or .xlsx file (a path, or the CSV text) with one row per statement line: policy number and commission amount; insured name when present. In a workbook, a sheet named "Commission log" is read when there is one.
- `--bookRateFormat` (optional): How the book's expected rates are written. Optional. "percent" when 12.5 means 12.5%, "fraction" when 0.125 means 12.5%. A cell with a % sign is always a percent. Without it, read from the column: fraction when every filled rate is a plain number below 1.
- `--bookColumns` (optional): Columns of the book of business. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Policy number = Policy number received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Policy number. Used when present: Insured name, Premium, Expected commission rate, Expected commission amount.
- `--statementColumns` (optional): Columns of the commission statement. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Policy number = Policy number received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Policy number, Commission amount. Used when present: Insured name.

Mathproven shows the arithmetic difference between what the book expected and what the statement paid; it makes no statement about what any contract or commission schedule requires.

## Missing insurance commissions: policies with no statement line, aged by days (`missing_insurance_commission_finder`)

Compares an agency's policy list (policy number, carrier, effective or renewal date, and an expected commission or premium times an expected rate) with commission statement lines. A line counts for a policy when the policy number is exactly the same, the carrier is the same where both name one, and the line is dated in the policy's payable period. Every policy payable by the as-of date that no line matches is listed with its age in days (0-30, 31-60, 61-90, over 90) and its expected commission, totalled by carrier and by age. Every policy is proved matched, listed or payable later, every line matched or not, by count and amount; near matches are listed for review and never accepted. Use it when someone asks which policies have not been paid commission yet, or how old their unpaid commissions are. Not for short-paid amounts on matched policies, and not for one policy.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs missing_insurance_commission_finder --policyList '<path to a .csv or .xlsx file>' --statement '<path to a .csv or .xlsx file>'
```

Inputs:
- `--policyList` (needed): Policy list. A .csv or .xlsx file (a path, or the CSV text) with one row per policy: policy number, effective or renewal date, and either an expected commission amount or a premium and an expected rate; carrier and insured name when present. In a workbook, a sheet named "Book of business" is read when there is one.
- `--statement` (needed): Commission statement lines. A .csv or .xlsx file (a path, or the CSV text) with one row per statement line, from one carrier or several: policy number and commission amount; carrier, date and insured name when present. In a workbook, a sheet named "Commission log" is read when there is one.
- `--asOf` (optional): As of. Optional. The day ages are counted to, YYYY-MM-DD; a policy payable after it is not listed. Without it, today.
- `--defaultCarrier` (optional): Carrier for statement lines that name none. Optional. For a statement from one carrier with no carrier column, or lines with a blank carrier: the carrier's name.
- `--policyRateFormat` (optional): How the policy list's expected rates are written. Optional. "percent" when 12.5 means 12.5%, "fraction" when 0.125 means 12.5%. A cell with a % sign is always a percent. Without it, read from the column: fraction when every filled rate is a plain number below 1.
- `--policyColumns` (optional): Columns of the policy list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Policy number = Policy number received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Policy number, Effective or renewal date. Used when present: Insured name, Carrier, Premium, Expected commission rate, Expected commission amount.
- `--statementColumns` (optional): Columns of the commission statement lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Policy number = Policy number received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Policy number, Commission amount. Used when present: Insured name, Carrier, Effective date.

Mathproven shows only that no line in the statement file was found for a policy and its date; it makes no statement about what any carrier owes or what any agreement or commission schedule requires.

## Producer commission splits on paid lines, to the cent, with payout statements (`producer_commission_split_calculator`)

Splits each paid insurance commission line (.csv or .xlsx) among producers and a house share by the percentages in a rule for the line's producer or agent code, with a catch-all rule for lines no other rule names. Cents that do not divide evenly go to the shares with the largest remainders, so the parts of every line add up to the line exactly. Checks: each line's parts equal its commission, the percentages add up to 100% on every line, every part is recalculated from its rule, producer plus house totals equal all commission, and every line has a rule. Gives totals by payee and a payout statement per producer. Use it when someone asks how much each producer is owed from a commission statement under their split percentages. Not for deciding what the splits should be, and not for one policy.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs producer_commission_split_calculator --paidLines '<path to a .csv or .xlsx file>' --splitRules '<text>'
```

Inputs:
- `--paidLines` (needed): Paid commission lines. A .csv or .xlsx file (a path, or the CSV text) with one row per paid line: the commission amount, and the producer or agent code that picks each line's rule; policy number and insured when present. In a workbook, a sheet named "Commission log" is read when there is one.
- `--splitRules` (needed): Split rules. One rule per producer code, separated by semicolons or new lines: "<code>: House <percent>, <producer name> <percent>" with up to three producers, the shares adding up to 100. The code "*" is the rule for every line no other rule names. For example "KIM: House 40, Kim Ortiz 60; LEE: House 50, Lee Park 30, Sam Diaz 20; *: House 100".
- `--columns` (optional): Columns of the paid commission lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Commission amount = Commission amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Commission amount. Used when present: Policy number, Insured name, Producer or agent.

Mathproven applies the percentages given and proves the arithmetic; it makes no statement about what any producer agreement or contract requires.

## Surplus lines premium tax on a policy list, with totals by home state (`surplus_lines_tax_on_policy_list`)

Works out the surplus lines premium tax and any second charge on every policy in a period's list (.csv or .xlsx: home state and premium on each row, a return as a negative premium), from the site's sourced state surplus lines tax rates table, and totals them by the insured's home state in whole cents. Each figure is premium times rate, half a cent rounded up on the premium without its sign, checked a second way and against the single-premium calculator for the same state; state totals must add up to the list total and to the list's own total row. A further fee such as a stamping fee can be typed as a percent, or taken from the site's stamping fee table, and a state the table has no row for needs its rate typed; anything typed is labeled as typed. Use it when someone asks for surplus lines tax on a list of policies or a period's bordereau. Not for deciding which home state applies or what to file.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_tax_on_policy_list --policyList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--policyList` (needed): Policy list. A .csv or .xlsx file (a path, or the CSV text) with one row per policy or endorsement: the premium (a return as a negative amount or in brackets) and the insured's home state as a two-letter code or a name; policy number and insured when present. A total row is left out and compared with the policies.
- `--defaultState` (optional): Home state for rows that name none. Optional. For a list from one state with no state column, or rows with a blank state: the state, such as OR or Oregon.
- `--taxRates` (optional): Tax rate typed for a state the table lacks. Optional. Only for a home state on the list that the rates table has no row for, as "<state> = <percent>" separated by semicolons; a state the table has a row for takes its rate from the table and cannot be typed. Today the table has a row for every state and DC, so no state takes a typed tax rate and one given is refused.
- `--feeRates` (optional): Further fee typed for a state. Optional. A further fee the table does not carry, such as a stamping fee, as a percent of premium for any home state on the list: "<state> = <percent>", for example "TX = 0.15; NY = 0.15". Labeled as typed everywhere it appears.
- `--stampingFeeStates` (optional): States that take the stamping fee table's fee. Optional. Home states on the list whose further fee is the site's stamping fee table's percent fee (where that table has one figured to the cent) for policies effective on the fee date, separated by commas: "TX, NY", or "all" for every state on the list it has one for. A state takes a typed fee or the table's, never both.
- `--feeDate` (optional): Policy effective date for the stamping fee table. Optional, and only with stampingFeeStates: the policy effective date the stamping fee table's fees are taken for, YYYY-MM-DD. Without it, today.
- `--columns` (optional): Columns of the policy list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Premium = Premium received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Premium. Used when present: Policy number, Insured, Home state.

Mathproven shows the arithmetic on the rates table's rows and on any rate typed; it does not say what to charge, collect or file, what is taxable, or which home state applies. Mathproven is not affiliated with any state agency whose rules are cited in the table.

## Surplus lines premium tax rates by state (`surplus_lines_tax_rates`)

The surplus lines premium tax rate each state's statute (or state agency page) sets when that state is the insured's home state, with a second charge where the same official source sets one as a percent of premium (a filing platform fee, a regulatory fee, a fire marshal tax), and a flag where the rate has conditions (line of business, calendar year, multistate allocation) with the conditions in words. Use it when someone asks the surplus lines or excess lines tax rate in a home state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_tax_rates --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives rates only: what each cited source sets. It does not say what to charge, collect, or file. Mathproven is not affiliated with any state agency whose rules are cited here.

## Surplus lines stamping fees by state and policy effective date (`surplus_lines_stamping_fees`)

The surplus lines stamping, filing, service or transaction fee each state's stamping office, service office or state platform charges on surplus lines premium, as a percent of premium and any flat charge per filing, for the window of policy effective dates it applies to, with who sets it and what it is figured on. Use it when someone asks the stamping fee on a surplus lines (excess and surplus) policy in a home state for a policy effective date. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs surplus_lines_stamping_fees --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The date is the policy effective date: it picks the row whose window of effective dates covers it (a fee announced for a later day is its own row and is never used for an earlier date). A date outside every window the table holds for a state is not covered.

Mathproven gives fees only: what each cited page sets. It does not say who pays a fee or what to charge, collect, or file. Mathproven is not affiliated with any stamping office, service office, or state agency whose page is cited here.
