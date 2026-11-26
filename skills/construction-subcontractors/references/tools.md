# Construction subcontractors: the tools

Each tool runs with `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Subcontractor pay application from a schedule of values (`pay_application_builder`)

Builds a subcontractor pay application (progress billing) from a schedule of values (.csv or .xlsx, or CSV text, one row per line: scheduled value, previous work, work this period, materials stored) and the contract figures: completed and stored, percent complete and balance to finish per line, retainage on completed work and on stored materials, total earned less retainage, the current payment due after previous certificates, and the balance to finish including retainage. Every line is recomputed on a second, independent pass; the schedule must add up to the contract sum to date with change orders, no line may bill more than its scheduled value, and retainage released may not be more than retainage held. Use it when someone asks to make a pay app, work out the current payment due, or figure retainage on a progress billing. Not for checking a pay application someone else made, and not for deciding what to bill or certify.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_builder --scheduleOfValues '<path to a .csv or .xlsx file>' --originalContractSum '<amount, such as 1,234.56>'
```

Inputs:
- `--scheduleOfValues` (needed): Schedule of values. A .csv or .xlsx file (a path, or the CSV text) with one row per line: scheduled value is needed; item, description, previous work (billed on earlier applications), this period and materials stored are used when present (a blank cell is zero). A file with completed, percent, balance or retainage columns and no previous-work or this-period column is refused. A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.
- `--originalContractSum` (needed): Original contract sum. The original contract sum, like 100,000.00.
- `--netChangeOrders` (optional): Net change orders. Optional. Approved change orders to date, net (deductions negative); zero when not given.
- `--applicationNo` (optional): Application number. Optional. The application number, a whole number from 1; 1 when not given.
- `--periodTo` (optional): Period to. Optional. The last day of the period this application covers, YYYY-MM-DD.
- `--retainageOnWork` (optional): Retainage on work (%). Optional. The retainage rate on completed work, in percent, like 10 (the default).
- `--retainageOnStored` (optional): Retainage on stored materials (%). Optional. The retainage rate on stored materials, in percent, like 10 (the default).
- `--retainageReleasedToDate` (optional): Retainage released to date. Optional. Retainage released on this and all earlier applications; zero when not given.
- `--previousCertificates` (optional): Previous certificates for payment. Optional. The total certified for payment on earlier applications (earned less retainage); zero when not given.
- `--columns` (optional): Columns of the schedule of values. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Scheduled value = Scheduled value received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Scheduled value. Used when present: Item, Description, Previous work, This period, Materials stored.

Mathproven calculates the pay application from the schedule of values and the figures entered; it does not say what to bill, certify or sign.

## Pay application checker: math errors in a schedule of values (`pay_application_checker`)

Checks an existing pay application spreadsheet (.xlsx or .csv): finds the schedule of values header row, recomputes every line (completed and stored = previous work + this period + materials stored, balance to finish, retainage at the rates given) and every subtotal and totals row, and lists each cell that differs from the math with the amount it is off by. A row counts as a subtotal or total only when its label is exactly that word. Every row with amounts is accounted for: a row that cannot be read, or one with amounts below the last totals row, fails a check that names it, and percent cells that disagree are named in a warning. Use it when someone asks to check, audit, or find the math errors in a pay application, progress billing or schedule of values they were sent or made. Not for building a new pay application, not for judging the work or whether a billing is allowed under a contract, and not for PDF files.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_checker --payApplication '<path to a .csv or .xlsx file>'
```

Inputs:
- `--payApplication` (needed): Pay application spreadsheet. A .csv or .xlsx file (a path, or the CSV text) holding the schedule of values: a column for scheduled value and one for previous work or work this period are needed; item, description, materials stored, completed and stored, percent, balance to finish and retainage columns are compared when present.
- `--retainageOnWork` (optional): Retainage on work (%). Optional. The retainage rate on completed work, in percent, like 10 (the default).
- `--retainageOnStored` (optional): Retainage on stored materials (%). Optional. The retainage rate on stored materials, in percent, like 10 (the default).
- `--sheet` (optional): Sheet. Optional, for a workbook: the name of the sheet to check. Without it, the first sheet with a schedule of values header row.
- `--headerRow` (optional): Header row number. Optional. The number of the header row as the spreadsheet shows it (the first row is 1), when it is not found by itself.
- `--columns` (optional): Columns of the pay application. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Scheduled value = Scheduled value received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Scheduled value. Used when present: Item, Description, Previous work, This period, Materials stored, Total completed and stored, Percent complete, Balance to finish, Retainage.
- `--notScheduleLines` (optional): Rows that are not schedule lines. Optional. Spreadsheet row numbers, like "7, 9", of rows below the last totals row that are not schedule lines (a payment summary, a note with a figure). Each is recorded as a warning and its amounts are not checked.

Mathproven recomputes the schedule of values on the sheet and lists every difference from the math; it does not say whether a pay application should be approved, paid or signed.

## Blank pay application spreadsheet with a schedule of values (`pay_application_template_workbook`)

Makes a blank pay application workbook (.xlsx): a schedule of values sheet with the lines numbered and a totals row under a generic progress billing header (item, description of work, scheduled value, work from previous applications, work this period, materials stored, total completed and stored, percent complete, balance to finish, retainage), a summary sheet with the project, contractor, retainage rate and the summary lines, and an instructions sheet saying what each column means. The finished file is read back and checked for its three sheets, the header row, one numbered row per line plus the totals row, and the project, contractor and rate as given. The workbook holds values only, with no formulas. Use it when someone asks for a pay application or schedule of values spreadsheet template to fill in. Not for calculating or checking an application.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs pay_application_template_workbook
```

Inputs:
- `--projectName` (optional): Project name. Optional. The project name for the summary sheet, up to 120 characters.
- `--contractorName` (optional): Contractor name. Optional. The contractor name for the summary sheet, up to 120 characters.
- `--lineCount` (optional): Number of schedule lines. Optional. How many schedule of values lines to number, a whole number from 1 to 500; 20 when not given.
- `--retainagePercent` (optional): Retainage (%). Optional. The retainage percent for the summary sheet, like 10 (the default) or 7.5.

Mathproven builds the workbook with values only and no formulas, so it is a clean layout to fill in; it does not calculate or check anything typed into it.

## Schedule of values that adds up to the contract (`schedule_of_values_builder`)

Builds a schedule of values from a contract sum and a list of lines (.csv or .xlsx, or CSV text: description, entered as percent, fixed or spread, and the percent or amount). Fixed lines keep their amount; percent lines share what is left of the contract after the fixed lines, by their percents; lines marked spread (general conditions, overhead) are divided across the other lines by their amounts and do not appear on the schedule. Leftover cents go to the largest fractions, so the lines add up to the contract sum exactly; the percents must cover the whole contract, no line may be negative, and every column is re-added a second time with separate whole-number arithmetic. The schedule comes back in the pay application layout with nothing billed yet. Use it when someone asks to set up or split a contract into a schedule of values, or to spread general conditions across the lines. Not for billing progress, and not for deciding how a contract is divided.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs schedule_of_values_builder --contractSum '<amount, such as 1,234.56>' --lines '<path to a .csv or .xlsx file>'
```

Inputs:
- `--contractSum` (needed): Contract sum. The contract sum the schedule has to add up to, like 250,000.00.
- `--lines` (needed): Schedule lines. A .csv or .xlsx file (a path, or the CSV text) with one row per line of work: the percent or amount is needed; description and "entered as" (percent, fixed, or spread; blank is percent, or fixed when the value has a $ sign) are used when present. A percent is written 40 or 40%; a plain 0.4 or 1 is refused, since a spreadsheet's percent cell stores 40% as 0.4 and 100% as 1 (write 1% for one percent). A row whose first cell starts with a total word is the file's own total line only when its value is the contract sum or the sum of the lines above it; any other such row fails the row check.
- `--retainage` (optional): Retainage for the pay application file (%). Optional. The retainage percent written into the pay application file that "saveTo" ending .json saves (the file the pay application builder opens as application 1); 10 when not given.
- `--columns` (optional): Columns of the schedule lines. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Percent or amount = Percent or amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Percent or amount. Used when present: Description, Entered as.
- `--saveTo` (optional) also takes a path ending .json: that saves this tool's own .json file.

Mathproven divides the contract sum as the lines are entered; it does not say how a contract should be divided among lines.

## Progress billing statement by percent complete or milestones (`progress_billing_statement`)

Makes a progress billing statement for a job billed by overall percent complete or by milestones, with no line-by-line schedule of values: contract sum to date with change orders, billed to date, billing this period, retainage this period and to date, amount due this period, unpaid prior balance, total due now, and the balance of contract left to bill. Milestones come as a .csv or .xlsx file, or CSV text (milestone, amount, reached), and must add up to the contract sum to date. Billed to date may not exceed the contract sum to date or fall below what was billed before, and every figure is rebuilt a second time with separate whole-number arithmetic. Use it when someone asks to bill a job by percent complete or by milestone, or what is due on this period's progress invoice after retainage. Not for jobs billed line by line from a schedule of values, and not for deciding what may be billed under a contract.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs progress_billing_statement --originalContractSum '<amount, such as 1,234.56>'
```

Inputs:
- `--originalContractSum` (needed): Original contract sum. The original contract sum, like 86,000.00.
- `--changeOrders` (optional): Change orders. Optional. Each approved change order as an amount, deductions negative, like ["3,450.00", "-950.00"].
- `--percentComplete` (optional): Percent complete to date (%). For a job billed by percent complete: the overall percent complete to date, like 62.5. Give this or "milestones", not both.
- `--milestones` (optional): Milestones. For a job billed by milestones: a .csv or .xlsx file (a path, or the CSV text) with one row per milestone: the amount is needed; milestone (its name) and reached (yes or no; blank is no) are used when present. Give this or "percentComplete", not both. A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.
- `--previouslyBilled` (optional): Previously billed. Optional. The total billed on earlier statements, before retainage; zero when not given.
- `--previouslyPaid` (optional): Previously paid. Optional. The total paid so far; zero when not given.
- `--retainage` (optional): Retainage (%). Optional. The retainage percent, like 10 (the default).
- `--statementNo` (optional): Statement number. Optional, for the Statement details table.
- `--statementDate` (optional): Statement date. Optional, YYYY-MM-DD, for the Statement details table; the run's day when not given.
- `--workThrough` (optional): Work through. Optional. The last day of work the statement covers, YYYY-MM-DD.
- `--from` (optional): Your company (from). Optional, for the Statement details table.
- `--billedTo` (optional): Billed to. Optional, for the Statement details table.
- `--job` (optional): Job or project. Optional, for the Statement details table.
- `--columns` (optional): Columns of the milestones. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Amount = Amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Amount. Used when present: Milestone, Reached.

Mathproven works out the statement from the figures entered; it does not say what may be billed or what is owed under a contract.

## Retainage on one invoice, step by step (`retainage_calculator`)

Calculates retainage on one construction invoice step by step with the figures given: work billed to date (typed, or the contract amount times the percent complete), retainage at one rate, or at a first rate up to a threshold percent of the contract and a reduced rate on work billed after it, stored materials at their own rate (they do not count toward the threshold), retainage withheld, the gross amount billed, and net payable. Each step is worked a second time with separate whole-number arithmetic and both must agree to the cent; retainage withheld plus net payable must equal the gross amount billed. A warning is shown when work billed is more than the contract amount or the rate after the threshold is higher. Use it when someone asks how to calculate retainage or retention, what is withheld on an invoice, or what a reduced rate after 50% complete comes to. Not for tracking retainage across many billing periods, and not for saying which rate a contract or statute allows.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_calculator --contractAmount '<amount, such as 1,234.56>' --retainageRate '<number>'
```

Inputs:
- `--contractAmount` (needed): Contract amount. The contract amount, like 184,650.00.
- `--retainageRate` (needed): Retainage (%). The retainage percent on work billed, like 10.
- `--percentComplete` (optional): Percent complete (%). The percent complete, like 62.5; work billed is the contract amount times it. Give this or "billedToDate", not both.
- `--billedToDate` (optional): Amount billed to date. The work billed to date, in dollars and cents. Give this or "percentComplete", not both.
- `--thresholdPercent` (optional): Threshold (% of the contract). Optional, with "reducedRate": the percent of the contract after which the rate drops, like 50. Work billed up to it is held at the first rate.
- `--reducedRate` (optional): Retainage after the threshold (%). Optional, with "thresholdPercent": the percent held on work billed after the threshold, like 5.
- `--storedMaterials` (optional): Stored materials billed. Optional. Stored materials billed on this invoice; they are added to the gross amount billed and held at their own rate.
- `--storedRate` (optional): Retainage on stored materials (%). Optional, with "storedMaterials": the percent held on stored materials; 10 when not given, as on the page (not the retainage percent).

Mathproven works out retainage at the rates and threshold entered; it does not say which rate or threshold a contract or statute sets.

## Retainage tracker and retainage release invoice (`retainage_tracker_release_invoice`)

Tracks retainage across every billing period of a job from a list of periods (.csv or .xlsx, or CSV text, one row per period: date, work billed, retainage rate, retainage released): the retainage withheld each period, cumulative withheld and released, and the balance still held, plus a retainage release invoice for an amount given, with the balance before and after it. Each period is recomputed on a second, independent pass, the balance must roll forward every period, a release may never be more than what was held at the time, and the invoice may not be more than the balance held. Use it when someone asks how much retainage is still being held on a job, or wants to bill for the release of retainage. Not for one invoice worked step by step, and not for deciding when retainage is due or may be released.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_tracker_release_invoice --periods '<path to a .csv or .xlsx file>'
```

Inputs:
- `--periods` (needed): Billing periods. A .csv or .xlsx file (a path, or the CSV text) with one row per billing period: the work billed that period is needed; the period date (like 2026-01-31), the retainage rate in percent and the retainage released that period are used when present. Each row holds the period's own figures: a column headed as a running total ("Billed to date", "Cumulative") is refused unless "columns" names it. A rate is written 10 or 10%; a plain 0.1 or 1 is refused, since a spreadsheet's percent cell stores 10% as 0.1 and 100% as 1 (write 1% for one percent). A blank rate cell is 0%, as on the page, and is named in a warning. A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.
- `--defaultRate` (optional): Retainage rate when the file has no rate column (%). Optional. The retainage percent for every period when the file has no rate column (as the page fills in new rows); 10 when not given. It is not used for a blank rate cell.
- `--invoiceAmount` (optional): Amount of the release invoice. Optional. The retainage release to invoice; it may not be more than the balance held. Without it no invoice is made.
- `--invoiceNumber` (optional): Invoice number. Optional, for the release invoice.
- `--invoiceDate` (optional): Invoice date. Optional, YYYY-MM-DD, for the release invoice; the run's day when not given.
- `--from` (optional): Your company (invoice from). Optional, for the release invoice.
- `--billedTo` (optional): Billed to. Optional, for the release invoice.
- `--job` (optional): Job or project. Optional, for the release invoice.
- `--columns` (optional): Columns of the billing periods. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Work billed = Work billed received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Work billed. Used when present: Period, Retainage released, Retainage rate.

Mathproven tracks retainage at the rates and releases entered; it does not say when retainage is due or what a contract or statute requires.

## Lien waiver, conditional or unconditional, progress or final (`lien_waiver_generator`)

Fills in a construction lien waiver: conditional or unconditional, on a progress payment or on final payment, with the claimant, customer, owner, project, through date and amount. For a state with its own statutory waiver form that the tool holds, the document is that form's stored text with only the blanks filled, checked against the stored text and its SHA-256; a state commonly listed as having its own form that the tool does not hold gets no document. Every other state gets generic plain-language wording. The amount is checked to the cent against the current payment due from the pay application and read back from the finished document, and no amount may be negative. Use it when someone asks for a lien waiver or lien release to go with a payment, or wants the waiver amount checked against the pay application. Not for deciding which waiver type fits a situation or whether a waiver is enforceable, and not legal advice.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs lien_waiver_generator --state '<text>' --waiverType '<conditional-progress|unconditional-progress|conditional-final|unconditional-final>' --claimant '<text>' --customer '<text>' --owner '<text>' --projectName '<text>' --projectAddress '<text>' --throughDate '<YYYY-MM-DD>' --amount '<amount, such as 1,234.56>'
```

Inputs:
- `--state` (needed): State. Two-letter code of the state where the project is, like CO.
- `--waiverType` (needed): Waiver type. conditional-progress, unconditional-progress, conditional-final, or unconditional-final.
- `--claimant` (needed): Claimant. Who signs the waiver (the party being paid).
- `--customer` (needed): Customer. Who hired the claimant.
- `--owner` (needed): Owner. The property owner.
- `--projectName` (needed): Project name. The name of the project.
- `--projectAddress` (needed): Project address. The project address.
- `--throughDate` (needed): Through date. The day the work covered runs through, YYYY-MM-DD.
- `--amount` (needed): Amount on the waiver. The amount on the waiver, in dollars and cents, like 33,300.00.
- `--paymentDue` (optional): Current payment due from the pay application. Optional. The current payment due on the pay application this waiver goes with; the waiver amount is checked against it. Without it the certificate shows a warning instead.
- `--makerOfCheck` (optional): Maker of the check. Optional, for the conditional types: who writes the check.
- `--payee` (optional): Check payable to. Optional, for statutory forms with a "payable to" blank.
- `--reference` (optional): Job, invoice, or pay application number. Optional, for forms with that blank.
- `--disputedAmount` (optional): Disputed claims amount. Optional, for statutory final forms with that blank.
- `--paymentPeriod` (optional): Payment period. Optional, for statutory forms with a payment period blank.
- `--exceptions` (optional): Exceptions. Optional, for the generic wording: anything the waiver does not cover. Without it the waiver says "None."
- `--saveTo` (optional) also takes a path ending .txt: that saves this tool's own .txt file.

Mathproven fills in a document and checks the amount. It does not say which waiver type fits a situation or whether a waiver is enforceable, and waiver rules vary by state.

## Late payment interest on a progress or retainage payment (`late_payment_interest_calculator`)

Works out the interest on one late progress payment or retainage payment: the days late from the due date to the payment date, and the interest in cents by the daily, per month, or per month or fraction method on a 360 or 365 day year, with each step written out and the same dates under every method. The due date and rate can come from a state's row of the prompt payment deadlines table (its calendar days from the day the count starts, and its fixed rate) or be typed; a typed rate is labeled as typed. The days late are counted two ways and must agree, and each part of the interest is worked a second way to the cent. Use it when someone asks how much interest is owed on a late construction payment or how many days late a payment is. Not for deciding whether a statute or contract applies, not for grace days (named in a warning), and not for rows that count business days unless the due date is typed.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs late_payment_interest_calculator --lateAmount '<amount, such as 1,234.56>' --paidDate '<YYYY-MM-DD>'
```

Inputs:
- `--lateAmount` (needed): Late amount. The progress payment or retainage that was paid late, in dollars and cents, like 36,420.00.
- `--paidDate` (needed): Payment date. The day the payment was (or will be) made, YYYY-MM-DD.
- `--dueDate` (optional): Due date. Optional. The due date itself, YYYY-MM-DD. Give it, or give "state" and "startDate" to count the due date from that state's row of the prompt payment deadlines table. When it is given, "startDate" is not used.
- `--state` (optional): State. Optional. Two-letter code of a state in the prompt payment deadlines table, like MO. Its row gives the due date from "startDate" (rows that count calendar days) and its fixed rate when no "rate" is given.
- `--jobType` (optional): Job type of the row. Optional, with "state": public, private, or both (a state with one row for both). Needed only when the state has more than one row.
- `--payment` (optional): Payment in the row. Optional, with "state": owner (the owner pays the contractor), local (a local public owner pays the contractor), or sub (the contractor pays a subcontractor). Needed only when the row sets more than one.
- `--startDate` (optional): Day the row's count starts. Optional, with "state": the day the row's count starts, YYYY-MM-DD (for a subcontractor, usually the day the contractor was paid). The row's calendar days are added to it.
- `--rate` (optional): Rate. Optional. A typed rate in percent, at most two decimals, like 1.5; it is labeled as typed. Without it, the fixed rate in the state's row is used.
- `--ratePer` (optional): Rate per. Optional, with "rate": what the typed rate is per, month (the default), year, or day.
- `--method` (optional): Method. Optional. daily: the rate spread over each day late. month (the default): each full month, then the days left over by the day. month-or-fraction: each month started counts as a whole month.
- `--yearDays` (optional): Days in the year. Optional. The year the daily figures are divided by: 365 (the default) or 360.

Mathproven does date and interest arithmetic on the figures entered. Nothing here says whether a section applies to a particular contract, what is owed, or what to claim. Mathproven is not affiliated with any legislature or agency whose statutes are cited in the table.

## Over/under billing (WIP schedule) for a list of jobs (`over_under_billing_wip_schedule`)

Builds a work in progress (WIP) schedule by the cost-to-cost method from a list of jobs (.csv or .xlsx, or CSV text, one row per job: contract amount with approved change orders, estimated total cost, cost to date, billed to date): percent complete, earned revenue, and over-billing or under-billing for each job, with portfolio totals and the net. Each division is proved a second way by multiplying back, every total re-adds from the jobs, and total over-billing minus under-billing must equal total billed minus earned revenue. Jobs over their estimated cost or billed past their contract are named in a warning. Use it when someone asks for over/under billings, a WIP schedule, earned revenue, or billings in excess of costs for their jobs. Not for other revenue methods (units of output, milestones), not for estimating the cost to complete, and not for deciding how the figures are reported.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs over_under_billing_wip_schedule --jobs '<path to a .csv or .xlsx file>'
```

Inputs:
- `--jobs` (needed): Job list. A .csv or .xlsx file (a path, or the CSV text) with one row per job: contract amount (with approved change orders), estimated total cost, cost to date and billed to date are needed; a job name column is used when present. A column for the estimated cost to complete is never taken for the estimated total cost. A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.
- `--company` (optional): Company. Optional. The company name, for the About table.
- `--asOf` (optional): Schedule as of. Optional. The day the schedule is as of, YYYY-MM-DD, for the About table.
- `--columns` (optional): Columns of the job list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Contract amount = Contract amount received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Contract amount, Estimated total cost, Cost to date, Billed to date. Used when present: Job.

Mathproven works out percent complete, earned revenue and over- or under-billing from the figures entered by the cost-to-cost method; it does not estimate costs or say how the figures are reported.

## Prevailing wage fringe credit (fringe benefit annualization) (`prevailing_wage_fringe_credit`)

Works out fringe benefit annualization for prevailing wage jobs from a list of workers (.csv or .xlsx, or CSV text, one row per worker and classification: required fringe per hour, the employer's yearly plan cost, the hours the plan cost is spread over, and hours on this job): the plan credit per hour rounded down to the cent, the cash fringe per hour still owed, any credit above the required fringe (shown, not used), and the cash fringe owed for the hours on the job, with totals. The hours on the job may not be more than the divisor, the credit plus the cash fringe must equal the required fringe, and every row and both totals are worked a second time with separate whole-number arithmetic. Use it when someone asks how much fringe credit a health or pension plan gives per hour on a prevailing wage job, or how much cash fringe is still owed for a payroll week. Not for choosing the hours divisor, deciding which plans or costs count, or looking up a wage determination's rates.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs prevailing_wage_fringe_credit --workers '<path to a .csv or .xlsx file>'
```

Inputs:
- `--workers` (needed): Worker rows. A .csv or .xlsx file (a path, or the CSV text) with one row per worker and classification: required fringe per hour (from the wage determination), yearly plan cost (the employer's cost for the plan year), hours worked in the plan year on all work (the divisor) and hours on this job are needed; worker and classification columns are used when present. Hours take at most two decimals, like 37.25. A row whose first cell starts with a total word ("Total", "Total for all jobs") is taken as the file's own total line only when its figures equal the sum of the rows above it; it is then left out, and that sum is checked. Any other such row fails the row check.
- `--job` (optional): Job or project. Optional. The job or project, for the About table.
- `--periodEnd` (optional): Payroll period ending. Optional. The last day of the payroll period, YYYY-MM-DD, for the About table.
- `--columns` (optional): Columns of the worker rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Required fringe per hour = Required fringe per hour received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Required fringe per hour, Yearly plan cost, Hours worked in the plan year, all work, Hours on this job. Used when present: Worker, Classification.

Mathproven divides each yearly plan cost by the hours entered and does not choose them; it does not say which plans, costs or hours count for a job or what a wage determination requires.

## State prompt payment deadlines for construction, with late-payment interest (`prompt_payment_deadlines`)

Each state's prompt payment statute for construction, public and private jobs: the days an owner has to pay the prime contractor, the days a contractor has to pay a subcontractor after being paid, what starts each count, and the late-payment interest rate the section states (a fixed rate, or the section's floating rate in words). Use it when someone asks how long an owner or general contractor has to pay on a construction job in a state, or what interest a late construction payment carries. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs prompt_payment_deadlines --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives days and rates as each cited section states them. Nothing here says whether a section applies to a particular contract or what to do about a late payment. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.

## State retainage limits on public and private construction jobs (`retainage_limits`)

The general retainage rate a state statute sets for what may be held back from a progress payment on public and on private construction jobs, where a statute sets a number, with a flag where the section attaches conditions to that rate (a step-down part-way through, a contract-size threshold, a bond condition) and the conditions in words. Use it when someone asks the maximum retainage or retention percentage on a construction contract in a state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs retainage_limits --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives the general rate from the cited statutes on the checked date in each row; rules change. General information, not advice.
