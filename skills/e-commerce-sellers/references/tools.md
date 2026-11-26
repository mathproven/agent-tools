# E-commerce sellers: the tools

Each tool runs with one command on one line, `node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs <tool> --<input> <value> ...` (see SKILL.md). Without a key, a tool reads one file a run.

## Monthly books from a marketplace payment or ledger export (`marketplace_payments_to_monthly_books`)

Summarizes a seller's payment account or ledger export from a marketplace such as Etsy or Shopify (.csv or .xlsx, one row per sale, fee, refund or payout) by month: sales, shipping, tax collected, fees, refunds, adjustments, net activity, payouts and the change in the balance the marketplace holds, with fees by fee type and a journal entry for each month. Checks that each month's parts re-add to its net activity, that the type totals re-add to every row, that each journal entry balances, that amount plus fees equals net on every row when the file has a net column, and, with both balances given, that opening balance plus every row equals the closing balance; a row that cannot be read is listed. Use it when someone wants monthly figures or journal entries from their shop's payment or ledger download. Not for matching one payout to a bank deposit, and not for a file with no row type column. Mathproven is not affiliated with Etsy, Shopify or any other marketplace.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs marketplace_payments_to_monthly_books --ledger '<path to a .csv or .xlsx file>'
```

Inputs:
- `--ledger` (needed): Payment or ledger export. A .csv or .xlsx file (a path, or the CSV text) with one row per sale, shipping charge, tax line, fee, refund, adjustment or payout: date, row type and amount are needed; a title or description, a fees column and a net column are used when present. In a workbook with a sheet named Ledger, that sheet is read.
- `--openingBalance` (optional): Opening balance. Optional. The balance held by the marketplace before the first row. With the closing balance too, opening balance plus every row is checked against it.
- `--closingBalance` (optional): Closing balance. Optional. The balance held by the marketplace after the last row. With the opening balance too, opening balance plus every row is checked against it.
- `--columns` (optional): Columns of the payment or ledger export. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date, Row type, Amount. Used when present: Title or description, Fees (and taxes) column, Net.
- `--rowTypes` (optional): What each row type counts as. Optional. Each row type in the file starts with a guess from its words, and a type with none of the words it knows is counted as an adjustment, so no row is left out; the result lists what each type was taken for. To change one, write "<row type> = <what it counts as>", separated by commas, for example "Marketing = fees, Credit = adjustments". What it counts as is one of: sales, shipping, tax, fees, refunds, adjustments, payouts.
- `--dateOrder` (optional): Dates like 03/04/2026. Optional. How a date written with numbers only, such as 03/04/2026, is read: "month first" (March 4, the default) or "day first" (3 April).
- `--feesArePositive` (optional): Fees written as positive numbers. Optional. true when the fees column writes fees as positive numbers to subtract; false when they are negative numbers, added as written. Without it, they are taken as positive numbers to subtract only when the column holds no negative number.
- `--payoutsArePositive` (optional): Payouts written as positive numbers. Optional. true when payout rows write the money sent to the bank as a positive number; false when it is a negative number, or only in the description ("$84.07 sent to your bank account"). Without it, positive only when no payout row holds a negative amount.

Mathproven totals the export's rows by month and type and shows how each month's figures balance; the account names are starting labels, and it does not say how anything belongs in anyone's books.

## Journal entry for one marketplace payout, matched to the bank deposit (`marketplace_payout_journal_entry`)

Builds one balanced journal entry for a single marketplace payout, from the rows that make up the payout (a .csv or .xlsx export from a marketplace such as Shopify or Etsy) or from components typed by hand: sales, shipping, tax collected, each fee type, refunds and adjustments, each posted to an account name. Checks that the components add up to the payout the marketplace reports, that the payout equals the bank deposit to the cent (a warning when no deposit is given), that debits equal credits, and that the journal lines re-add to the components a second way. Use it when someone needs to record a payout from their shop in their books, or to see why a payout differs from what reached the bank. Not for a month or a year of activity, and not for deciding which accounts to use. Mathproven is not affiliated with Shopify, Etsy or any other marketplace.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs marketplace_payout_journal_entry
```

Inputs:
- `--payoutRows` (optional): Payout rows. Optional when the components are typed. A .csv or .xlsx file (a path, or the CSV text) with the rows of one payout: date, row type and amount are needed; a description, a fees column and a net column are used when present. The rows become one component per kind (and per fee type), and the payout row itself gives the payout amount and date. In a workbook with a sheet named Ledger, that sheet is read.
- `--components` (optional): Components typed by hand. Optional, instead of the payout rows. One component per line as "<component> | <account> | <amount>", every component with an amount naming its account: positive for what adds to the payout, negative for what takes away from it, for example "Sales | Sales | 165.50". A JSON list of {"label", "account", "amount"} also works.
- `--accounts` (optional): Account for each component. Optional. The account name used in your own books for a component, as "<component> = <account>", separated by commas, for example "Sales = Product sales, Fees on Sale rows = Selling fees". Components from the rows start with plain starting account names (Sales, Shipping income, Sales tax collected, Marketplace fees, Refunds, Marketplace adjustments), which the result lists.
- `--payoutAmount` (optional): Payout amount. The payout amount the marketplace reports (money sent to the bank, positive). Without it, the payout rows in the file give it; needed when they do not.
- `--bankDeposit` (optional): Bank deposit. Optional. The deposit as the bank statement shows it. Without it the entry is still built, with a warning that the payout was not matched to the bank.
- `--bankAccount` (optional): Bank account name. Optional. The account the deposit is posted to, as your own books name it. Without it, "Bank account".
- `--payoutDate` (optional): Payout date. Optional. The payout date, YYYY-MM-DD. Without it, the date of the payout row when the file has exactly one.
- `--columns` (optional): Columns of the payout rows. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Date = Date received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Date, Row type, Amount. Used when present: Title or description, Fees (and taxes) column, Net.
- `--rowTypes` (optional): What each row type counts as. Optional. Each row type in the file starts with a guess from its words, and a type with none of the words it knows is counted as an adjustment, so no row is left out; the result lists what each type was taken for. To change one, write "<row type> = <what it counts as>", separated by commas, for example "Marketing = fees, Credit = adjustments". What it counts as is one of: sales, shipping, tax, fees, refunds, adjustments, payouts.
- `--dateOrder` (optional): Dates like 03/04/2026. Optional. How a date written with numbers only, such as 03/04/2026, is read: "month first" (March 4, the default) or "day first" (3 April).
- `--feesArePositive` (optional): Fees written as positive numbers. Optional. true when the fees column writes fees as positive numbers to subtract; false when they are negative numbers, added as written. Without it, they are taken as positive numbers to subtract only when the column holds no negative number.
- `--payoutsArePositive` (optional): Payouts written as positive numbers. Optional. true when payout rows write the money sent to the bank as a positive number; false when it is a negative number, or only in the description ("$84.07 sent to your bank account"). Without it, positive only when no payout row holds a negative amount.

Mathproven adds up the payout's components, posts each to the account named for it and checks the arithmetic; it does not say which account is right for sales tax, fees or refunds.

## Sales tax collected by ship-to state from an order export (`sales_tax_collected_by_state`)

Totals an order export (.csv or .xlsx, from a store or marketplace such as Shopify) by ship-to state: orders, taxable amount and tax collected for each state, with the rows of one order added together so each order is counted once. Orders with no state, with text that is not a US state or territory, or with rows naming different states are listed separately, never dropped. Checks that every order is counted exactly once, that each order sits under exactly one state or in the separate list, and that the states plus the separate list equal the file's totals, by count and to the cent, added a second way; a row that cannot be read is listed. Use it when someone wants the sales tax collected in each state, or orders per state, from their store's order download. Not for tax rates, economic nexus thresholds, filing rules or what is owed anywhere: it reports only what the export says was collected. Mathproven is not affiliated with Shopify or any other marketplace.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs sales_tax_collected_by_state --orders '<path to a .csv or .xlsx file>'
```

Inputs:
- `--orders` (needed): Order export. A .csv or .xlsx file (a path, or the CSV text) with one row per order or per item: order id, ship-to state (two-letter code or full name) and tax collected are needed; a taxable amount column is used when present. Rows with the same order id are one order. In a workbook with a sheet named Orders, that sheet is read.
- `--columns` (optional): Columns of the order export. Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Order id or number = Order id or number received"; "<column> = none" leaves an optional column out. The answer lists the columns it read. Needed: Order id or number, Ship-to state, Tax collected. Used when present: Taxable amount.

Mathproven shows what the export says was collected; it holds no tax rates, thresholds or filing rules, and it does not say what is owed or due anywhere.

## Sales by product from an orders export (`sales_by_product_from_orders_export`)

Groups an orders export with one row per item sold (.csv or .xlsx, from a store or marketplace such as Shopify) by product, by SKU or else by item name: rows, orders, units, sales, reversals (negative item totals), net and each product's share of net. Rows that name no product get their own line, and the file's own total line is left out and counted. A date range and a total from the seller's own records can be given. Checks that every row is under exactly one product, that each product's figures re-add from its rows, that the products add up to the totals a second way, that each share multiplies back, and that a typed total matches; a row that cannot be read is listed. Use it when someone asks how much each product or SKU sold, in units or dollars, from their store's order download. Not for an export with one row per order and no item columns, and not for saying which products to keep or what to charge. Mathproven is not affiliated with Shopify or any other marketplace.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs sales_by_product_from_orders_export --orders '<path to a .csv or .xlsx file>'
```

Inputs:
- `--orders` (needed): Orders export. A .csv or .xlsx file (a path, or the CSV text) with one row per item sold: the item total and at least one of item name and SKU are needed; quantity, order id and order date are used when present (with no quantity every row is 1 unit). A unit price with a quantity stands in when there is no item total. In a workbook with a sheet named Orders, that sheet is read.
- `--from` (optional): First day. Optional. Only rows with an order date on or after this day (YYYY-MM-DD) are used; the rest are listed as left out. Every row then needs an order date that can be read.
- `--to` (optional): Last day. Optional. Only rows with an order date on or before this day (YYYY-MM-DD) are used; the rest are listed as left out. Every row then needs an order date that can be read.
- `--typedTotal` (optional): Total net sales from your own records. Optional. A total net sales figure from the seller's own records, compared with the total of the rows used.
- `--dateOrder` (optional): Dates like 03/04/2026. Optional, used only with a date range. How a date written with numbers only, such as 03/04/2026, is read: "month first" (March 4, the default) or "day first" (3 April).
- `--columns` (optional): Columns of the orders export. Optional. Only when a column is not found from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Item total = Line total". Needed: Item total (or Unit price with Quantity, when the file writes no total for each item), and at least one of Item name and SKU. Used when present: Quantity, Order id or number, Order date.

Mathproven groups the rows of the export, adds them up and checks the arithmetic; it does not say what any figure means for a business.

## Online seller bookkeeping workbook (Excel template) (`online_seller_bookkeeping_template`)

Builds a blank Excel bookkeeping workbook for an online shop: a Ledger sheet (Date, Type, Description, Amount, Fees, Net) for the payment account's money rows, an Orders sheet with one row per item sold (order id, date, item, SKU, quantity, item total, ship-to state, taxable amount, tax collected), a Log sheet with the shop name and year, and an Instructions sheet saying what each column holds. Values only, no formulas. Before it is saved, the workbook is read back and checked: its sheet names, header rows and row counts, the shop name and year, and that both sheets are found and read the way the section's monthly books and sales tax by state tools read them. Use it when someone asks for a spreadsheet template to keep their shop's sales, fees, payouts and orders in. Not for adding anything up: the workbook holds no formulas, tax rates or thresholds. Mathproven is not affiliated with any marketplace.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs online_seller_bookkeeping_template
```

Inputs:
- `--shop` (optional): Shop name. Optional. The shop the workbook is kept for, written on its Log sheet and in the file name (120 characters or fewer).
- `--year` (optional): Year. Optional. The calendar year the workbook covers, four digits from 2000 to 2099, written on its Log sheet and in the file name.

Mathproven builds a layout to fill in, with values only and no formulas; it holds no tax rates, thresholds or filing dates, and it does not say what a seller has to record or keep.

## Profit, margin and break-even price on one item sold online (`online_seller_profit_calculator`)

Works out the profit on one item sold online at fee rates the person gives: each fee in dollars (a percent of the selling price plus shipping charged, a fixed amount per sale, or both), total fees, total costs, profit per sale, profit as a percent of the sale amount (margin) and of total costs, the break-even selling price, and totals for a number of units. It holds no fee rates of any marketplace or payment company. Checks each fee's rounding to the cent by multiplying back, re-adds every total a second way, and proves the break-even price by trying every lower price; costs above the sale amount are a warning. Use it when someone asks what they make on a sale after fees and costs, their margin on an item, or the lowest price that covers their costs. Not for looking up a marketplace's current fees, not for sales tax or income tax, and not for saying what price to charge. Mathproven is not affiliated with any marketplace or payment company.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs online_seller_profit_calculator --price '<amount, such as 1,234.56>'
```

Inputs:
- `--price` (needed): Selling price. The selling price of one item, in dollars.
- `--shippingCharged` (optional): Shipping charged to the buyer. Optional. Shipping charged to the buyer for the item. Blank counts as zero.
- `--itemCost` (optional): Cost of the item. Optional. What the item costs to buy or make. Blank counts as zero.
- `--shippingCost` (optional): Cost to ship it. Optional. What it costs the seller to ship the item. Blank counts as zero.
- `--otherCost` (optional): Other cost per sale. Optional. Any other cost per sale, such as packaging. Blank counts as zero.
- `--advertising` (optional): Advertising cost per sale. Optional. Advertising cost per sale, added to total costs.
- `--fees` (optional): Fee lines. Optional. One fee per line as "<name> | <percent> | <fixed amount per sale>", either figure left blank, at the rates the seller gives (none are built in), for example "Selling fee | 7.45 |" and "Listing fee | | 0.12". The percent is taken of the selling price plus shipping charged. A JSON list of {"name", "percent", "fixed"} also works. Up to 30 lines.
- `--units` (optional): Units sold. Optional. A number of units sold, a whole number of 1 or more: the sale amount, fees, costs and profit for that many sales are added.

Mathproven multiplies, adds, subtracts and checks at the rates given; it holds no fee rates and does not say what price to charge.

## Economic nexus thresholds for remote sellers, by state (`economic_nexus_thresholds`)

Each state's remote seller sales tax threshold (economic nexus) as its own statute, rule or revenue department page sets it: the sales figure and its wording ("more than" or "or more"), any transaction count and whether either test or both are needed, which sales are counted, the period measured, and what the source says about marketplace sales; states with no statewide sales tax say so. Use it when someone asks the sales or transaction threshold at which a remote or online seller meets a state's economic nexus test. Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.

```
node ${CLAUDE_SKILL_DIR}/scripts/mathproven.mjs economic_nexus_thresholds --member '<text>'
```

Inputs:
- `--member` (needed): State. The state to read, by its code: a state's two-letter postal code (OH, NY), or DC for the District of Columbia.
- `--date` (optional): Date. Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table. Where the source says the transaction test ended on a day, a date before that day is said to fall before it: the table does not hold the earlier test.

Mathproven gives figures only: it does not say whether anyone registers, collects, or files anywhere. Mathproven is not affiliated with any state agency whose rules are cited here.
