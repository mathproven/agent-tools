# Nonprofits and churches: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Donor retention rate from a gift list (`donor_retention_rate`)

Works out a nonprofit's donor retention for a year from its gift list (.csv or .xlsx, one row per gift): of last year's donors, how many gave again this year, split into first-year and repeat donors, plus dollar retention, each as an exact fraction with its counts. Every donor is placed in exactly one group, and retained plus lapsed is checked to equal last year's donors. Use it when someone asks for retention, renewal or lapse rates from their own gift records. Not for benchmarking against other charities, and not for a list without gift dates.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_retention_rate --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and amount are needed; a donor id keeps two spellings of one name together. It should cover this year and last year, and earlier years tell first-year donors from repeat donors.
- `--year` (optional): Year. The year the rates are for, four digits from 1901 to 2100; last year is the year before it. Without it, the latest year with a gift in the list.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven counts donors by the dates of the gifts in the list and adds up what each gave; it does not compare a rate with any outside figure or say what to do about any donor.

## Year-end giving statements from a gift list (`year_end_giving_statements`)

Builds one year-end giving statement per donor from a nonprofit's or church's gift list (.csv or .xlsx, one row per gift): each donor's gifts with date, fund and amount, totals by fund, the total given, and the value of anything recorded as received in return. Gifts go together by donor id or envelope number when the list has one, otherwise by name. Every gift is checked to be on exactly one statement, its own donor's, each statement is added up again from that donor's rows, and the statements add back up to the gift list fund by fund and overall. Deposits per fund from the bank or the books can be given to tie each fund. Use it when someone needs annual contribution statements, year-end giving statements or church giving statements from their own donation records. Not for writing the statement's wording (the organization's own words go on it), and not for picking the year: give the gifts for the period the statements cover; gifts dated in more than one year are flagged.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs year_end_giving_statements --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. Email, mailing address and fund columns, and columns for what a donor received in return and its value, are read when the list has them. A workbook with a sheet named Gifts is read from that sheet.
- `--deposits` (optional): Deposits per fund. Optional. Deposits per fund for the same period, from the bank or the books, to tie the gift list to: "<fund> = <amount>", one per line or separated by semicolons, for example "General = 1,350.00; Building = 800.00". Fund names are compared with case, punctuation and spacing ignored. A fund that differs is listed with both amounts and the result is not verified.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven arranges and adds up the gifts in the list; it does not decide what a statement has to say, and the wording is the organization's own.

## Gift acknowledgment checklist: gift records with blank fields (`gift_acknowledgment_checklist`)

Lists the gifts at or above an amount the organization sets whose record has a blank in any column it names from its own gift list (.csv or .xlsx, one row per gift): a thank-you sent date, a mailing address, a letter date, or any column it added itself. Gifts at or above plus gifts below are checked to equal all gifts by count and by amount, complete plus incomplete to equal the gifts at or above, and blanks counted gift by gift to equal blanks counted column by column. Use it when someone wants to know which gifts have no thank-you or acknowledgment date recorded, or which gift records over an amount are missing an address or another detail. Not for deciding which gifts need an acknowledgment or what one has to say (the amount and the columns are the organization's own choice), and not for writing the letters.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs gift_acknowledgment_checklist --giftList '<path to a .csv or .xlsx file>' --amountFrom '<amount, such as 1,234.56>' --checklist '<text>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. Every other column of the file can be named in the checklist.
- `--amountFrom` (needed): Gift amount to check from. Gifts of this amount or more are checked, for example "250.00". It is the organization's own choice; nothing is filled in for it.
- `--checklist` (needed): Columns that must not be blank. The columns of the gift list that must be filled in for those gifts, by their header text in the file, separated by commas, for example "Thank-you Sent, Mailing Address"; a header with a comma in it is named in a JSON list, for example ["Letter sent, date", "Mailing Address"]. Any column can be named, including ones the organization added. A cell that is empty or holds only spaces counts as blank.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven compares the gift list with the amount and the checklist columns given; it does not say what an acknowledgment has to contain or which gifts need one.

## Donor de-duplication: find duplicate donor records, merge with proof (`donor_deduplication`)

Finds donor records in a gift list (.csv or .xlsx, one row per gift, with donor name, email and mailing address columns) that look like the same person: the same name, email and address once case, punctuation and spacing are ignored, or the same email, the same address or the same name with the rest different. Each group is listed with the reason it was proposed; only the groups named as confirmed are merged, into the record named first. After merging, the gift count and total are checked to be unchanged, every gift to belong to exactly one donor record, and each kept record to hold exactly its own gifts and those merged into it. Use it when someone wants to clean up duplicate donors, merge two spellings of one donor, or check a donor list for doubles before statements or a mailing. Not for deciding who is the same person (nothing is merged unless its group is named), and abbreviations such as Street and St are not matched.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_deduplication --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed, and email and mailing address columns let near matches be found. Each distinct donor id, name, email and address, exactly as written, becomes one donor record, numbered D1, D2 and so on.
- `--merge` (optional): Groups to merge. Optional. The proposed groups the person confirmed, by their record numbers, the record to keep first, groups separated by semicolons: "D1, D2; D3, D4". Each must be a whole proposed group. Without it nothing is merged and the proposed groups are listed.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven merges nothing until a group is confirmed; the record named first is kept and the others in the group are folded into it. It does not decide who is the same donor.

## Donor upgrades and downgrades: who gave more or less than last year (`donor_upgrades_downgrades`)

Compares each donor's giving in two years from a gift list (.csv or .xlsx, one row per gift): who gave more, the same or less than the year before and by how much, and who gave in only one of the two years, with donor counts and dollars per group and a table carrying last year's total to this year's. Calendar or fiscal years; a fiscal year is named for the calendar year it ends in. Every donor is placed in exactly one group, worked out a second way from the gift dates, and every donor's change is checked to add up to this year's gifts minus last year's. Use it when someone asks which donors increased or decreased their giving, for donor upgrades and downgrades, or for a year-over-year giving comparison from their own records. Not for saying which donors to contact, and not for a list without gift dates.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donor_upgrades_downgrades --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. It should cover both years compared.
- `--year` (optional): Year. The later of the two years, four digits from 1901 to 2100; it is compared with the year before it. For a fiscal year, the calendar year it ends in. Without it, the latest year with a gift in the list.
- `--startMonth` (optional): Month the year starts in. January for a calendar year (used when not given). For a fiscal year, its first month: with July, 2026 runs from July 2025 to June 2026.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven compares what the gifts in the list add up to in two years; it does not say what to do about any donor.

## Gift log workbook for tracking donations (Excel template) (`donation_gift_log_template`)

Builds a blank Excel gift log for tracking donations at a nonprofit or church: a Gifts sheet with columns for donor id (an envelope number works), donor name, email, mailing address, gift date, gift amount, fund, anything received in return and its value, and notes; a Funds sheet with numbered rows; a Log sheet with the organization name and the year; and an instructions sheet saying what each column holds. The finished workbook is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked, the Gifts header row is matched the way the giving tools read it, and no cell holds a formula. Use it when someone wants a donation tracking spreadsheet, a gift log or a donor giving record to fill in through the year. Not for adding anything up (it holds values only, no formulas), and not for statements or receipts.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs donation_gift_log_template
```

Inputs:
- `--organization` (optional): Organization name. Optional. The organization the log is kept for, up to 120 characters; it goes on the Log sheet and in the file name.
- `--year` (optional): Year. Optional. The calendar year the log covers, four digits from 2000 to 2099; it goes on the Log sheet and in the file name.
- `--fundCount` (optional): Number of funds. Optional. How many numbered rows the Funds sheet starts with, a whole number from 1 to 50; 3 when not given. Rows can be added later.

Mathproven builds a layout to fill in, with values only and no formulas; it does not add anything up or say what a gift record has to hold.

## Giving by fund and month from a gift list (`giving_by_fund_and_month`)

Totals a gift list (.csv or .xlsx, one row per gift) by fund and calendar month: one row per fund, one column per month from the first gift to the last (a month with no gifts shows zeros), with a total for every fund and every month. Every cell is added up again straight from the list by a separate routine, the fund totals and the month totals are both checked to equal the list, and every gift is checked to fall in exactly one cell. A gift with no fund goes in a row named (no fund); fund names are used exactly as written. Use it when someone needs giving by fund or designation per month, fund totals for a board or finance committee report, or monthly gift figures to set beside bank deposits. Not for deciding which fund a gift belongs to, and not for totals per donor.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs giving_by_fund_and_month --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. The fund column sets the rows; without one every gift goes in one row.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven arranges and adds up the gifts in the list by the fund and the gift date written on each row; it does not decide which fund a gift belongs to.

## LYBUNT and SYBUNT report: donors who gave last year, not this year (`lybunt_sybunt_report`)

Groups every donor in a gift list (.csv or .xlsx, one row per gift, covering more than one year) by the calendar years they gave in: gave last year but not this year (LYBUNT), gave only in earlier years (SYBUNT), gave in both years, came back after a year without a gift, or first gave this year, with what each gave this year, last year and earlier, and the date of their latest gift. Every donor is in exactly one group, worked out a second time from the gift dates, and the totals for this year, last year and earlier add back up to the list. Use it when someone asks which donors lapsed, who gave last year and has not given yet this year, or for a LYBUNT or SYBUNT list from their own gift records. Not for saying which donors to contact, and not for fiscal years.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs lybunt_sybunt_report --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. It should cover at least this year and last year.
- `--year` (optional): Year. The year the report is for, four digits from 1901 to 2100; last year is the year before it and anything before that is earlier. Without it, the latest year with a gift in the list.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven lists donors by the dates of the gifts in the list and adds up what each gave; it does not say what to do about any donor.

## Part-gift (quid pro quo) payments split by the value received (`quid_pro_quo_payment_split`)

Splits each payment in a gift list (.csv or .xlsx, one row per payment) that was partly a gift, such as a benefit dinner ticket or an item bought at a charity auction, into the value the donor received and the part above it, using the organization's own good-faith values from the list's value column or given per row. Each payment of more than $75.00 with a value received of more than zero is flagged (the threshold in 26 U.S.C. § 6115(a); exactly $75.00 is not more). Value plus part above is checked to equal each payment, every row to be split exactly once, and the totals by donor and overall to tie to the list. Use it when someone needs quid pro quo contribution figures, gala or auction payments split into the value received and the part above it, or the payments over $75 with goods or services received. Not for estimating a value (none is guessed), and not for deciding what a donor may deduct, what the organization sends, or whether an exception applies.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs quid_pro_quo_payment_split --giftList '<path to a .csv or .xlsx file>'
```

Inputs:
- `--giftList` (needed): Gift list. A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together. Columns for what the donor received in return and its value are read when the list has them.
- `--valuesReceived` (optional): Values received, by file row. Optional. The good-faith value of what the donor received, for payments whose value cell is blank (every payment when the list has no value column), written "<file row> = <amount>" and separated by commas, for example "5 = 30.00, 8 = 0". The row is the payment's row number in the file as a spreadsheet shows it. A value already in the list is used as it is, and a payment with no value given is split with nothing taken off.
- `--columns` (optional): Columns of the gift list. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Donor name = Donor name received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Donor name, Gift date, Gift amount. Used when present: Donor id or number, Email, Mailing address, Fund, Description of anything received in return, Value of anything received in return.

Mathproven splits each payment by the value received that is entered and adds up the parts; it does not say what a donor may deduct, what the organization sends, or whether an exception in the law applies.

## Charity audit, review and compilation thresholds by state (`charity_audit_thresholds_by_state`)

The dollar figures at which a state's charitable solicitation (or charitable trust) law names audited, reviewed or compiled financial statements for a registered charity's registration or annual report, each band with its wording ("at least", "more than", "less than"), what the figures are measured on (total revenue, contributions), and the conditions in words; a state whose source names no figure says what it asks for instead. Use it when someone asks at what revenue a nonprofit needs an audit or a CPA review for its state charity registration. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs charity_audit_thresholds_by_state --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives figures only, not legal or tax advice. Rules change; the linked official source has the full wording. Mathproven is not affiliated with any agency whose rules are cited here.

## Charity registration renewal due-date rules by state (`charity_registration_renewal_dates_by_state`)

How each state dates the renewal of a charitable solicitation registration (or the annual report that keeps it in force): a number of months or days after the fiscal year end, a day of the Nth month after it, the registration's anniversary, or a fixed calendar date, and any extension, automatic or on request; states with no charity registration say so. Use it when someone asks when a nonprofit's charity registration renewal or annual report is due in a state. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs charity_registration_renewal_dates_by_state --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.

Mathproven gives renewal rules only, not legal or tax advice. Rules change; the linked official source has the full wording. Mathproven is not affiliated with any agency whose rules are cited here.
