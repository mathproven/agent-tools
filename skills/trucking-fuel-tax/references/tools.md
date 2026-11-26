# Trucking fuel tax: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Quarterly fuel tax worksheet from miles and fuel-card files (`fuel_tax_quarterly_worksheet`)

Works a quarter's fuel tax worksheet by state from a carrier's own records: miles by state or province (an ELD, logging or trip export) and fuel purchases (a fuel-card export or fuel log). Gives fleet miles per gallon, then for each jurisdiction its miles, gallons bought, taxable gallons, net taxable gallons and tax at the rates given, and total tax at those rates. Checked: each jurisdiction against its own miles and fuel rows (gallons moved between states fail even when the totals match), jurisdictions adding to total miles, a rate for every jurisdiction, and every row used or listed. Use it when an owner-operator or small fleet is getting a quarterly fuel tax return ready and wants state miles and fuel receipts worked into taxable gallons and tax at the rates they give. Not a return or an agency form; it computes no surcharges and does not say what is owed. The dated table that comes with it is third-quarter 2026 diesel only, so another quarter needs that quarter's rates given.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_tax_quarterly_worksheet --milesFile '<path to a .csv or .xlsx file>' --fuelFile '<path to a .csv or .xlsx file>'
```

Inputs:
- `--milesFile` (needed): Miles by jurisdiction. A .csv or .xlsx file (a path, or the CSV text) of the quarter's miles: a jurisdiction column (state or province, written the way the rate table writes it, such as TX) and a miles column, one row per trip, day or jurisdiction; rows of one jurisdiction are added together. The file's own total line is left out and listed. A workbook with a sheet named Miles is read from that sheet.
- `--fuelFile` (needed): Fuel purchases. A .csv or .xlsx file (a path, or the CSV text) of the same quarter's fuel purchases, such as a fuel-card export: a gallons column and a jurisdiction column, or a location ending in a two-letter code such as "Amarillo, TX"; a date column is used when present. A purchase with no jurisdiction counts as unreadable. A workbook with a sheet named Fuel is read from that sheet, so one filled-in log workbook can be given as both files.
- `--rates` (optional): Rate table. The rates being worked from: one jurisdiction per line with its rate per gallon in dollars, up to 4 decimals, such as "TX 0.2000" or "NM,0.2275", using the same codes as the files. A first line with no figure is a header. Needed unless "useDatedTable" is true.
- `--useDatedTable` (optional): Use the dated rate table. Optional. true: the rates are the dated table that comes with the page, the third quarter of 2026 (2026-07-01 to 2026-09-30), diesel (special fuel) base rates for 57 jurisdictions, no surcharges. With "rates" also given, those rates are used and any that differ from the table are listed in a warning. With the dated table, a fuel purchase dated outside its quarter fails a check; a purchase with no date is not judged by that check, and miles are never checked by date, so the flag does not prove the files are for that quarter.
- `--wholeGallons` (optional): Round to whole gallons. Optional. true (the default): gallons per jurisdiction are rounded to whole gallons; false: kept to 3 decimals.
- `--totalMiles` (optional): Total miles. Optional. Total miles from the person's own summary, up to 3 decimal places, compared with the miles file.
- `--totalGallons` (optional): Total gallons. Optional. Total gallons purchased from the person's own summary, up to 3 decimal places, compared with the fuel file.
- `--mpgLow` (optional): Lowest miles per gallon. Optional. With "mpgHigh", a band set by the person: fleet miles per gallon outside it is a warning. Up to 2 decimals.
- `--mpgHigh` (optional): Highest miles per gallon. Optional. The top of the band, up to 2 decimals.
- `--milesColumns` (optional): Columns of the miles file. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Jurisdiction (state or province) = Jurisdiction (state or province) received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Jurisdiction (state or province), Miles.
- `--fuelColumns` (optional): Columns of the fuel file. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Gallons = Gallons received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Gallons. Used when present: Date, Jurisdiction (state or province), Location or merchant address, Amount, Unit or truck, Card or driver.

Mathproven works your own miles and gallons at the rates given. It does not compute surcharges, and the worksheet is not a return and is not in any agency's form layout.

## Fuel-card statement to a fuel ledger by jurisdiction and unit (`fuel_card_ledger_by_jurisdiction`)

Reads a fuel-card transaction export (.csv or .xlsx, one row per purchase) and adds up gallons and dollars per jurisdiction (state or province) and per jurisdiction and unit, tied to the total gallons and dollars printed on the statement. When the jurisdiction column is blank, the two-letter code at the end of a location such as "Amarillo, TX" is used; rows that name no jurisdiction stay in the totals and are listed separately, never dropped. Checked: every row is in exactly one bucket or on that list, the buckets re-add to all rows in a second pass, the totals equal the statement's, and every row is used, listed as left out (the statement's own total line) or listed as unreadable. Use it when a trucker wants fuel purchases by state from a fuel card statement, or wants a statement's rows tied to its totals. Not for working out fuel tax or miles per gallon (it reads no miles), and it holds no tax rates.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_card_ledger_by_jurisdiction --statement '<path to a .csv or .xlsx file>'
```

Inputs:
- `--statement` (needed): Fuel-card statement. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per fuel purchase: gallons are needed; date, jurisdiction (state or province), location, amount, unit and card or driver are used when present. A workbook with a sheet named Fuel is read from that sheet.
- `--statementGallons` (optional): Statement total gallons. Optional. The total gallons printed on the statement, up to 3 decimal places, for the rows to be tied to.
- `--statementAmount` (optional): Statement total dollars. Optional. The total dollars printed on the statement, for the rows to be tied to.
- `--columns` (optional): Columns of the fuel-card statement. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Gallons = Gallons received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Gallons. Used when present: Date, Jurisdiction (state or province), Location or merchant address, Amount, Unit or truck, Card or driver.

Mathproven puts each row of the statement in one bucket, adds them up and ties them to the totals typed; it holds no tax rates, does not choose a jurisdiction for a row that names none, and does not say what is owed to anyone.

## Miles per gallon by truck from a miles file and a fuel file (`truck_miles_per_gallon_by_unit`)

Reads a miles file (trip rows or a summary with a unit and miles) and a fuel file (fuel-card or fuel log rows with a unit and gallons) and gives one row per truck: miles, gallons, fuel amount and miles per gallon to 2 decimals, plus the fleet figure, which is total miles over total gallons, not an average of the trucks. Checked by a separate routine with no division: each unit's figure against its own miles rows and fuel rows (so gallons moved from one truck to another fail even when the totals still add up), the units re-added to all rows, and the totals against any typed. Units with miles and no gallons, gallons and no miles, or outside a typed band are warnings; rows with no unit stay in the fleet total. Use it when someone asks for MPG per truck or fleet fuel economy from their own trip and fuel records. Not for judging whether a figure is good or bad, and it holds no band of its own.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs truck_miles_per_gallon_by_unit --milesFile '<path to a .csv or .xlsx file>' --fuelFile '<path to a .csv or .xlsx file>'
```

Inputs:
- `--milesFile` (needed): Miles file. A .csv or .xlsx file (a path, or the CSV text) with a header row and a unit (truck) column and a miles column, as trip rows or a summary; rows of one unit are added together. A workbook with a sheet named Miles is read from that sheet.
- `--fuelFile` (needed): Fuel file. A .csv or .xlsx file (a path, or the CSV text) with a header row and a unit (truck) column and a gallons column; an amount column and a date column are used when present. A workbook with a sheet named Fuel is read from that sheet, so one filled-in log workbook can be given as both files.
- `--totalMiles` (optional): Total miles. Optional. Total miles from the person's own summary, up to 3 decimal places, compared with the miles file.
- `--totalGallons` (optional): Total gallons. Optional. Total gallons from the person's own summary, up to 3 decimal places, compared with the fuel file.
- `--mpgLow` (optional): Lowest miles per gallon. Optional. With "mpgHigh", a band set by the person: units outside it are listed as a warning. Up to 2 decimals.
- `--mpgHigh` (optional): Highest miles per gallon. Optional. The top of the band, up to 2 decimals.
- `--milesColumns` (optional): Columns of the miles file. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Unit or truck = Unit or truck received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Unit or truck, Miles.
- `--fuelColumns` (optional): Columns of the fuel file. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Unit or truck = Unit or truck received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Unit or truck, Gallons. Used when present: Amount, Date.

Mathproven adds up and divides your own miles and gallons; it does not say what any figure ought to be.

## Trucking cost per mile, fixed and variable (`trucking_cost_per_mile`)

Works out what a truck or small fleet cost to run per mile for a period: each cost typed for the period, marked fixed or variable, is divided by the miles driven, with the fixed and variable subtotals and total cost per mile to a tenth of a cent. With revenue for the same period, also revenue per mile and what is left per mile after costs. Checked: every cost is on the result once, the subtotals add to total cost, and each per-mile figure is its own dollars divided by the miles (tested by multiplying back, with no division), so the rounded lines are shown to be within rounding of the total. Use it when an owner-operator asks for cost per mile, operating cost per mile, or what is left per mile from their own costs and miles. Not for rate quotes or comparing with industry averages: it holds no rates and no averages, and it does not say what a load is worth.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs trucking_cost_per_mile --costs '<text>' --miles '<number>'
```

Inputs:
- `--costs` (needed): Costs for the period. One cost per line: its name, fixed or variable, and the amount for the period, separated by commas, semicolons, tabs or "|", for example "Truck payment, fixed, 2156.00" or "Fuel; variable; $5,538.00". Amounts are dollars and cents, zero or more (a credit is taken off the cost it belongs to). Which costs are fixed and which variable is the person's own call. A line with no amount is left out, and a first line not in this shape with no figure in it (such as "Cost, Fixed or variable, Amount") is read as a header; both are named in the answer. A line whose amount cannot be read is refused. Up to 60 lines.
- `--miles` (needed): Miles driven. Miles driven in the same period, more than zero, with up to 3 decimal places.
- `--revenue` (optional): Revenue for the period. Optional. Revenue for the same period, zero or more, for revenue per mile and what is left per mile after costs.
- `--period` (optional): Period. Optional. A name for the period, such as "March 2026", printed on the result.

Mathproven divides the costs typed by the miles typed. It holds no rates and no averages, and it does not say what a mile ought to cost, what a load is worth, or what belongs on a tax form.

## Mileage and fuel log workbook for a quarter (Excel) (`mileage_and_fuel_log_template`)

Builds a blank Excel workbook for logging one quarter of miles and fuel purchases: a Miles sheet (date, unit, jurisdiction, miles, trip or load, notes), a Fuel sheet (date, unit, jurisdiction, location, gallons, amount, card or driver, notes), a numbered Units list, a Log sheet with the carrier, year and quarter filled in, and an Instructions sheet. Values only, no formulas. Before it is handed over, the finished file is read back and checked: sheet names, header rows and row counts, the Miles sheet first, its header row matched and its rows read the way the quarterly fuel tax worksheet reads miles, and the Fuel sheet found by name and matched and read the way the fuel tools read fuel purchases, each reading as empty. Use it when an owner-operator or small fleet wants a log to keep miles by state and fuel receipts for the quarterly fuel tax. Not for adding anything up: it holds no rates and no due dates, and it does not say what a mileage or fuel record has to hold.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs mileage_and_fuel_log_template
```

Inputs:
- `--carrier` (optional): Carrier name. Optional. The carrier the log is kept for, up to 120 characters, written on the Log sheet.
- `--year` (optional): Year. Optional. The year the log covers, four digits from 2000 to 2099, written on the Log sheet.
- `--quarter` (optional): Quarter. Optional. The quarter of that year: 1 (January to March), 2 (April to June), 3 (July to September) or 4 (October to December).
- `--unitCount` (optional): Number of trucks or units. Optional. How many numbered rows the Units sheet starts with, a whole number from 1 to 50. Without it, 1.

Mathproven builds a layout of column names and blank rows; it holds no rates, no dates on which anything is due, and no rule about what a mileage or fuel record has to hold or how long it is kept.

## Quarterly fuel tax rates, third quarter 2026: diesel by jurisdiction (`fuel_tax_rates_third_quarter_2026`)

Diesel (special fuel) tax rates per US gallon for the quarterly fuel tax return, for July 1, 2026 to September 30, 2026, for the member jurisdictions (the 48 contiguous states and 10 Canadian provinces), each read from an official rate table for the quarter and checked against three more, with any surcharge kept apart from the base rate. Use it when someone asks a jurisdiction's diesel fuel tax rate for the third quarter of 2026, for a quarterly fuel tax (fuel use) return. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs fuel_tax_rates_third_quarter_2026 --member '<text>'
```

Inputs:
- `--member` (needed): Jurisdiction. The jurisdiction to read, by its code: a member jurisdiction's two-letter code: one of the 48 contiguous states (OH, NY) or a Canadian province (ON, QC).
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. A date picks the quarter: this table holds the third quarter of 2026, July 1, 2026 to September 30, 2026, only. A date outside that quarter gets no rate and is answered as not covered, saying which quarter the table holds.

Mathproven gives rates only: it does not say what is owed or what to file. Mathproven is not affiliated with any agency or organization whose table is cited here.
