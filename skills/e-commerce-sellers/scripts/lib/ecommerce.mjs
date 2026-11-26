// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  parseCivilDate
} from "./calendarDays.mjs";
import {
  EC_CATEGORIES,
  EC_CATEGORY_LABELS,
  EC_DEFAULT_ACCOUNTS,
  EC_LEDGER_LABELS,
  EC_LEDGER_ROLES,
  EC_ORDER_LABELS,
  EC_ORDER_ROLES,
  EC_PRODUCT_SALES_LABELS,
  EC_PRODUCT_SALES_ROLES,
  ecCellToIsoDate,
  ecDescriptionAmount,
  ecFeeLabel,
  ecGuessCategory,
  ecGuessLedgerColumns,
  ecGuessOrderColumns,
  ecGuessProductSalesColumns,
  ecHeaderList,
  ecJournalLine,
  ecLineParts,
  ecMoneyCell,
  ecNormalizeType,
  ecProductSales,
  ecProductSalesTables,
  ecReadProductSalesRows,
  ecStateCode,
  ecStateName,
  isIsoDate,
  scaledFormat,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./productSales.mjs";
import {
  CheckList,
  assertCents,
  failures,
  formatUSD,
  parseAmount,
  passedAll,
  percentToBasisPoints,
  toDecimal,
  warnings
} from "./money.mjs";

// packages/core/src/ecommerce/ledgerRead.ts
function ecReadLedgerRows(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const col = mapping.columns;
  const needed = [
    [col.date, "Date"],
    [col.type, "Row type"],
    [col.amount, "Amount"]
  ];
  for (const [index, label] of needed) {
    if (index < 0) throw new Error(`No "${label}" column could be identified (${ecHeaderList(rows, mapping.headerRow)}). Choose it in the column mapping.`);
  }
  const used = EC_LEDGER_ROLES.map((role) => col[role]).filter((index) => index >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
  const negate = (cents) => cents === 0 ? 0 : -cents;
  const out = { lines: [], problems: [], ignoredRows: 0 };
  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell2) => cell2.trim() === "")) continue;
    const cell = (index) => index < 0 ? "" : (row[index] ?? "").trim();
    const dateText = cell(col.date);
    const typeText = cell(col.type);
    const amountText = cell(col.amount);
    const feesText = cell(col.fees);
    const netText = cell(col.net);
    if (dateText === "" && typeText === "" && amountText === "" && feesText === "" && netText === "") {
      out.ignoredRows += 1;
      continue;
    }
    const reasons = [];
    let date = "";
    if (dateText === "") reasons.push("no date");
    else {
      try {
        date = ecCellToIsoDate(dateText, mapping.dateOrder);
      } catch {
        reasons.push(`the date "${dateText}" could not be read`);
      }
    }
    if (typeText === "") reasons.push("no row type");
    const money = (text2, what) => {
      try {
        return ecMoneyCell(text2);
      } catch {
        reasons.push(`the ${what} "${text2}" could not be read`);
        return void 0;
      }
    };
    const amountCell = money(amountText, "amount");
    const feesCell = money(feesText, "fees amount");
    const netCell = money(netText, "net amount");
    if (reasons.length > 0) {
      out.problems.push({ rowNumber: i + 1, reason: reasons.join("; ") });
      continue;
    }
    const description = cell(col.description);
    const chosen = mapping.categories[ecNormalizeType(typeText)];
    const category = chosen === void 0 ? ecGuessCategory(typeText) : chosen;
    let amount2 = amountCell === void 0 ? 0 : amountCell;
    let fees = feesCell === void 0 ? 0 : feesCell;
    let net = netCell;
    if (mapping.feesAreSubtracted) fees = negate(fees);
    if (category === "payout") {
      const written = amountCell === void 0 && feesCell === void 0 && netCell === void 0 ? ecDescriptionAmount(description) : void 0;
      if (written !== void 0) amount2 = negate(written);
      else if (mapping.payoutsArePositive) {
        amount2 = negate(amount2);
        if (net !== void 0) net = negate(net);
      }
    }
    const line = { rowNumber: i + 1, date, typeText, description, category, feeType: ecFeeLabel(category, typeText, description), amount: amount2, fees };
    if (net !== void 0) line.net = net;
    out.lines.push(line);
  }
  return out;
}

// packages/core/src/ecommerce/monthlyBooks.ts
function ecMonthJournal(m) {
  const a = EC_DEFAULT_ACCOUNTS;
  return [
    ...ecJournalLine(a.payout, m.payouts, "debit"),
    ...ecJournalLine(a.balance, m.balanceChange, "debit"),
    ...m.feeTypes.flatMap((f) => ecJournalLine(`${a.fee}: ${f.feeType}`, f.amount, "debit")),
    ...ecJournalLine(a.refund, m.refunds, "debit"),
    ...ecJournalLine(a.sale, m.sales, "credit"),
    ...ecJournalLine(a.shipping, m.shipping, "credit"),
    ...ecJournalLine(a.tax, m.tax, "credit"),
    ...ecJournalLine(a.adjustment, m.adjustments, "credit")
  ];
}
function ecVerifyMonthlyBooks(input, result) {
  const checks = new CheckList();
  const B = BigInt;
  const problems = input.problems ?? [];
  checks.that("rows-read", "Every row with data in the file was read", problems.length === 0, `${problems.length} row(s) could not be read and are not in the result; first: row ${problems[0]?.rowNumber}: ${problems[0]?.reason}`);
  const withNet = input.lines.filter((l) => l.net !== void 0);
  if (withNet.length > 0) {
    const off = withNet.filter((l) => l.amount + l.fees !== l.net);
    checks.that("rows-net", "Every row ties: amount + fees = net", off.length === 0, off[0] ? `${off.length} row(s) do not tie; first: row ${off[0].rowNumber} is off by ${formatUSD(off[0].net - off[0].amount - off[0].fees)}` : void 0);
  }
  const activity = /* @__PURE__ */ new Map();
  const everything = /* @__PURE__ */ new Map();
  let fileTotal = 0n;
  for (const l of input.lines) {
    const month = l.date.slice(0, 7);
    const value = B(l.amount) + B(l.fees);
    fileTotal += value;
    everything.set(month, (everything.get(month) ?? 0n) + value);
    activity.set(month, (activity.get(month) ?? 0n) + (l.category === "payout" ? B(l.fees) : value));
  }
  const monthsMatch = result.months.length === everything.size && result.months.every((m) => everything.has(m.month)) && result.months.every((m, i) => i === 0 || m.month > result.months[i - 1].month);
  checks.that("months-listed", "Every month in the file has one row in the summary, in order", monthsMatch);
  for (const m of result.months) {
    const formula = m.sales + m.shipping + m.tax - m.fees - m.refunds + m.adjustments;
    checks.cents(`activity-${m.month}`, `${m.month}: sales + shipping + tax − fees − refunds ± adjustments = net activity`, Number(activity.get(m.month) ?? 0n), formula);
    checks.cents(`balance-${m.month}`, `${m.month}: net activity − payouts = change in balance`, Number(everything.get(m.month) ?? 0n), m.netActivity - m.payouts);
  }
  const shownOk = [...result.months, result.totals].every((m) => m.netActivity === m.sales + m.shipping + m.tax - m.fees - m.refunds + m.adjustments && m.balanceChange === m.netActivity - m.payouts);
  checks.that("figures-consistent", "Net activity and change in balance shown for each month match their parts", shownOk);
  checks.cents("types-total", "Type totals for all months re-add to the file total (second pass)", Number(fileTotal), Number(result.months.reduce((a, m) => a + B(m.balanceChange), 0n)));
  const keys = ["rows", "sales", "shipping", "tax", "fees", "refunds", "adjustments", "netActivity", "payouts", "balanceChange"];
  checks.that("totals-row", "The Total row is the months added up", keys.every((k) => B(result.totals[k]) === result.months.reduce((a, m) => a + B(m[k]), 0n)) && result.totals.rows === input.lines.length);
  const feeTypesOk = [...result.months, result.totals].every((m) => m.feeTypes.reduce((a, f) => a + B(f.amount), 0n) === B(m.fees));
  checks.that("fee-types", "Fees by type add up to total fees, for each month and in total", feeTypesOk);
  let debits = 0n;
  let credits = 0n;
  let unbalanced = "";
  for (const m of result.months) {
    const d = m.journal.reduce((a, j) => a + B(j.debit), 0n);
    const c = m.journal.reduce((a, j) => a + B(j.credit), 0n);
    if (d !== c && !unbalanced) unbalanced = m.month;
    debits += d;
    credits += c;
  }
  checks.that("journal-months", "Each month’s journal entry balances", unbalanced === "", `${unbalanced} does not balance`);
  checks.cents("journal-balanced", "Journal entries: debits = credits", Number(debits), Number(credits));
  if (input.openingBalance !== void 0 && input.closingBalance !== void 0) {
    checks.cents("balance", "Opening balance + every row = closing balance", input.closingBalance, Number(B(input.openingBalance) + fileTotal));
  }
  const emptyPayouts = input.lines.filter((l) => l.category === "payout" && l.amount === 0).length;
  checks.that("payout-amounts", "Every deposit or payout row has an amount", emptyPayouts === 0, `${emptyPayouts} payout row(s) have no amount, so payouts may be understated`, "warning");
  return checks.all;
}
function ecMonthlyBooks(input) {
  if (input.lines.length === 0) throw new Error("No rows were read. Check the header row and the column mapping.");
  for (const line of input.lines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date)) throw new Error(`Row ${line.rowNumber} has no valid date.`);
  }
  const negate = (cents) => cents === 0 ? 0 : -cents;
  const totalsOf = (month, lines) => {
    const byCategory = /* @__PURE__ */ new Map();
    const byFeeType = /* @__PURE__ */ new Map();
    for (const line of lines) {
      for (const part of ecLineParts(line)) {
        byCategory.set(part.category, (byCategory.get(part.category) ?? 0) + part.amount);
        if (part.category === "fee") {
          const feeType = part.feeType === void 0 ? "" : part.feeType;
          byFeeType.set(feeType, (byFeeType.get(feeType) ?? 0) + part.amount);
        }
      }
    }
    const of = (category) => byCategory.get(category) ?? 0;
    const sales = of("sale");
    const shipping = of("shipping");
    const tax = of("tax");
    const fees = negate(of("fee"));
    const refunds = negate(of("refund"));
    const adjustments = of("adjustment");
    const payouts = negate(of("payout"));
    const netActivity = sales + shipping + tax - fees - refunds + adjustments;
    return {
      month,
      rows: lines.length,
      sales,
      shipping,
      tax,
      fees,
      feeTypes: [...byFeeType.entries()].map(([feeType, amount2]) => ({ feeType, amount: negate(amount2) })).sort((a, b) => a.feeType < b.feeType ? -1 : a.feeType > b.feeType ? 1 : 0),
      refunds,
      adjustments,
      netActivity,
      payouts,
      balanceChange: netActivity - payouts
    };
  };
  const monthNames = [...new Set(input.lines.map((line) => line.date.slice(0, 7)))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const months = monthNames.map((month) => {
    const figures = totalsOf(month, input.lines.filter((line) => line.date.slice(0, 7) === month));
    return { ...figures, journal: ecMonthJournal(figures) };
  });
  const totals = totalsOf("Total", input.lines);
  return { months, totals, checks: ecVerifyMonthlyBooks(input, { months, totals }) };
}
function ecBooksTables(r) {
  const d = toDecimal;
  const row = (m) => [m.month, m.rows, d(m.sales), d(m.shipping), d(m.tax), d(m.fees), d(m.refunds), d(m.adjustments), d(m.netActivity), d(m.payouts), d(m.balanceChange)];
  const summary = [["Month", "Rows", "Sales", "Shipping", "Tax collected", "Fees", "Refunds", "Adjustments", "Net activity", "Payouts", "Change in balance"], ...r.months.map(row), row(r.totals)];
  const fees = [["Month", "Fee type", "Amount"], ...r.months.flatMap((m) => m.feeTypes.map((f) => [m.month, f.feeType, d(f.amount)])), ...r.totals.feeTypes.map((f) => ["Total", f.feeType, d(f.amount)])];
  const journal = [["Month", "Account", "Debit", "Credit"], ...r.months.flatMap((m) => m.journal.map((j) => [m.month, j.account, j.debit ? d(j.debit) : "", j.credit ? d(j.credit) : ""]))];
  return { summary, fees, journal };
}

// packages/core/src/ecommerce/payoutJournal.ts
function ecPayoutComponents(lines) {
  const order = ["sale", "shipping", "tax", "refund", "adjustment"];
  const byCategory = /* @__PURE__ */ new Map();
  const byFeeType = /* @__PURE__ */ new Map();
  let payout;
  for (const line of lines) {
    for (const part of ecLineParts(line)) {
      if (part.category === "payout") payout = (payout ?? 0) - part.amount;
      else if (part.category === "fee") byFeeType.set(part.feeType ?? "Fees", (byFeeType.get(part.feeType ?? "Fees") ?? 0) + part.amount);
      else byCategory.set(part.category, (byCategory.get(part.category) ?? 0) + part.amount);
    }
  }
  const components = [];
  for (const category of order.slice(0, 3)) if (byCategory.has(category)) components.push({ label: EC_CATEGORY_LABELS[category], account: EC_DEFAULT_ACCOUNTS[category], amount: byCategory.get(category) });
  for (const feeType of [...byFeeType.keys()].sort()) components.push({ label: feeType, account: EC_DEFAULT_ACCOUNTS.fee, amount: byFeeType.get(feeType) });
  for (const category of order.slice(3)) if (byCategory.has(category)) components.push({ label: EC_CATEGORY_LABELS[category], account: EC_DEFAULT_ACCOUNTS[category], amount: byCategory.get(category) });
  return { components, payoutAmount: payout };
}
function ecPayoutJournal(input) {
  const { components, payoutAmount, bankDeposit } = input;
  if (components.length === 0) throw new Error("Add at least one component of the payout.");
  assertCents(payoutAmount, "The payout amount");
  if (bankDeposit !== void 0) assertCents(bankDeposit, "The bank deposit");
  for (const c of components) assertCents(c.amount, `The amount for "${c.label}"`);
  const bankAccount = input.bankAccount.trim();
  if (bankAccount === "") throw new Error("Name the account the bank deposit is posted to.");
  const payoutDate = input.payoutDate === void 0 ? "" : input.payoutDate;
  if (payoutDate !== "" && !isIsoDate(payoutDate)) throw new Error(`"${payoutDate}" is not a valid payout date.`);
  for (const c of components) {
    if (c.amount !== 0 && c.account.trim() === "") throw new Error(`Name the account for "${c.label}".`);
  }
  const componentsTotal = components.reduce((total, c) => total + c.amount, 0);
  const lines = [{ label: "Payout", account: bankAccount, debit: payoutAmount > 0 ? payoutAmount : 0, credit: payoutAmount < 0 ? -payoutAmount : 0 }];
  for (const c of components) {
    if (c.amount === 0) continue;
    lines.push({ label: c.label, account: c.account.trim(), debit: c.amount < 0 ? -c.amount : 0, credit: c.amount > 0 ? c.amount : 0 });
  }
  const debits = lines.reduce((total, line) => total + line.debit, 0);
  const credits = lines.reduce((total, line) => total + line.credit, 0);
  const checks = new CheckList();
  checks.cents("components-sum", "Components add up to the payout", payoutAmount, componentsTotal);
  if (bankDeposit !== void 0) checks.cents("deposit-match", "Payout = bank deposit", bankDeposit, payoutAmount);
  else checks.that("deposit-entered", "A bank deposit amount was entered to match the payout against", false, "No bank deposit amount was entered, so the payout was not matched to the bank", "warning");
  checks.cents("journal-balanced", "Journal entry balances: debits = credits", debits, credits);
  let fromComponents = 0n;
  for (const c of components) fromComponents += BigInt(c.amount);
  let fromLines = 0n;
  for (const line of lines.slice(1)) fromLines += BigInt(line.credit) - BigInt(line.debit);
  checks.cents("second-pass", "Journal lines re-add to the components (second pass)", Number(fromComponents), Number(fromLines));
  return { payoutDate, payoutAmount, bankDeposit, componentsTotal, difference: payoutAmount - componentsTotal, lines, debits, credits, checks: checks.all };
}
function ecPayoutTable(r) {
  return [
    ["Component", "Account", "Debit", "Credit"],
    ...r.lines.map((l) => [l.label, l.account, l.debit ? toDecimal(l.debit) : "", l.credit ? toDecimal(l.credit) : ""]),
    ["Total", "", toDecimal(r.debits), toDecimal(r.credits)]
  ];
}

// packages/core/src/ecommerce/productSalesCheck.ts
var SPACES = new RegExp("\\s+");
var SAFE = BigInt(Number.MAX_SAFE_INTEGER);
var text = (raw) => typeof raw === "string" ? raw.trim() : "";
function words(raw) {
  return text(raw).toLowerCase().split(SPACES).filter((word) => word !== "").join(" ");
}
function keyOf(sku, name) {
  const bySku = words(sku);
  if (bySku !== "") return `S ${bySku}`;
  const byName = words(name);
  return byName === "" ? "" : `N ${byName}`;
}
function labelOf(sku, name) {
  if (sku !== "" && name !== "") return `${sku} (${name})`;
  if (sku !== "") return sku;
  return name !== "" ? name : "a line with no SKU and no item name";
}
function usd(cents) {
  return cents >= -SAFE && cents <= SAFE ? formatUSD(Number(cents)) : scaledFormat(cents, 2);
}
function listed(items, most = 10, between = ", ") {
  const unique = [...new Set(items)];
  return unique.length > most ? `${unique.slice(0, most).join(between)} and ${unique.length - most} more` : unique.join(between);
}
var ascending = (numbers) => [...new Set(numbers)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
function isRounded(share, n, d) {
  const gap = share * d - n;
  const twice = (gap < 0n ? -gap : gap) * 2n;
  if (twice < d) return true;
  if (twice > d) return false;
  return n > 0n ? gap > 0n : gap < 0n;
}
function ecVerifyProductSales(input, report) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const from = input.from;
  const to = input.to;
  const ranged = from !== void 0 || to !== void 0;
  const used = [];
  const byNumber = /* @__PURE__ */ new Map();
  const outside = [];
  const twice = [];
  let undated = 0;
  for (const r of input.rows) {
    const date = text(r.date);
    const row = { rowNumber: r.rowNumber, key: keyOf(r.sku, r.name), sku: text(r.sku), name: text(r.name), order: text(r.orderId), units: B(r.quantity), amount: B(r.amount) };
    if (ranged && date === "") undated++;
    if (ranged && (date === "" || from !== void 0 && date < from || to !== void 0 && date > to)) {
      outside.push(row.rowNumber);
      continue;
    }
    if (byNumber.has(row.rowNumber)) twice.push(row.rowNumber);
    else byNumber.set(row.rowNumber, row);
    used.push(row);
  }
  const readLine = (line) => {
    const sku = typeof line.sku === "string" ? line.sku : "";
    const name = typeof line.name === "string" ? line.name : "";
    const rowNumbers = Array.isArray(line.rowNumbers) ? line.rowNumbers : [];
    const own = { orders: /* @__PURE__ */ new Set(), units: 0n, sales: 0n, reversals: 0n, net: 0n };
    for (const n of rowNumbers) {
      const row = byNumber.get(n);
      if (!row) continue;
      if (row.order !== "") own.orders.add(row.order);
      own.units += row.units;
      if (row.amount > 0n) own.sales += row.amount;
      if (row.amount < 0n) own.reversals += row.amount;
      own.net += row.amount;
    }
    return {
      sku,
      name,
      key: keyOf(sku, name),
      label: labelOf(sku, name),
      rowNumbers,
      rows: B(line.rows),
      orders: line.orders === null ? null : B(line.orders),
      units: B(line.units),
      sales: B(line.sales),
      reversals: B(line.reversals),
      net: B(line.net),
      share: line.shareBp === null ? null : B(line.shareBp),
      own
    };
  };
  const products = report.products.map(readLine);
  const unnamed = readLine(report.noProduct);
  unnamed.label = "the rows with no product named";
  const lines = [...products, unnamed];
  const shown = {
    rows: B(report.total.rows),
    orders: report.total.orders === null ? null : B(report.total.orders),
    units: B(report.total.units),
    sales: B(report.total.sales),
    reversals: B(report.total.reversals),
    net: B(report.total.net)
  };
  const typed = input.typedTotalNet === void 0 ? void 0 : B(input.typedTotalNet);
  const all = { orders: /* @__PURE__ */ new Set(), units: 0n, sales: 0n, reversals: 0n, net: 0n };
  let unnamedRows = 0;
  let unnamedNet = 0n;
  let noOrderId = 0;
  for (const row of used) {
    if (row.order !== "") all.orders.add(row.order);
    else noOrderId++;
    all.units += row.units;
    if (row.amount > 0n) all.sales += row.amount;
    if (row.amount < 0n) all.reversals += row.amount;
    all.net += row.amount;
    if (row.key === "") {
      unnamedRows++;
      unnamedNet += row.amount;
    }
  }
  checks.that("ec-ps-whole-numbers", "Every figure in the rows and in the result is a whole number", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const leftOut = Array.isArray(report.outsideRange) ? report.outsideRange : [];
  const sameLeftOut = ascending(leftOut).join(" ") === ascending(outside).join(" ") && leftOut.length === outside.length;
  if (ranged) {
    const rowList = (numbers) => numbers.length === 0 ? "none" : `row(s) ${listed(numbers.map(String), 20)}`;
    checks.that(
      "ec-ps-range",
      "Every row dated inside the date range is used, and every row outside it is listed as left out",
      undated === 0 && sameLeftOut,
      undated > 0 ? `${undated} row(s) have no order date and cannot be placed in the range` : `dated outside the range: ${rowList(ascending(outside))}; listed as left out: ${rowList(leftOut)}`
    );
  }
  const timesListed = /* @__PURE__ */ new Map();
  const misplaced = [...twice];
  if (!ranged) misplaced.push(...leftOut);
  lines.forEach((line, at) => {
    const isProduct = at < products.length;
    for (const n of line.rowNumbers) {
      timesListed.set(n, (timesListed.get(n) ?? 0) + 1);
      const row = byNumber.get(n);
      if (!row || row.key !== line.key || isProduct && line.key === "") misplaced.push(n);
    }
  });
  for (const [n, times] of timesListed) if (times > 1) misplaced.push(n);
  for (const row of used) if (!timesListed.has(row.rowNumber)) misplaced.push(row.rowNumber);
  checks.that(
    "ec-ps-rows-placed",
    "Every row is under exactly one product, or in the list of rows with no product named",
    misplaced.length === 0,
    `row(s) ${listed(ascending(misplaced).map(String), 20)} are missing, listed twice, or under a product their SKU or item name does not say`
  );
  const first = /* @__PURE__ */ new Map();
  for (const row of used) {
    if (row.key === "") continue;
    let spelling = first.get(row.key);
    if (!spelling) {
      spelling = { sku: words(row.sku) === "" ? "" : row.sku, name: "" };
      first.set(row.key, spelling);
    }
    if (spelling.name === "") spelling.name = row.name;
  }
  const seen = /* @__PURE__ */ new Set();
  const wrongLines = [];
  for (const line of products) {
    const spelling = first.get(line.key);
    if (line.key === "" || seen.has(line.key) || !spelling || spelling.sku !== line.sku || spelling.name !== line.name) wrongLines.push(line.label);
    seen.add(line.key);
  }
  for (const [key, spelling] of first) if (!seen.has(key)) wrongLines.push(labelOf(spelling.sku, spelling.name));
  checks.that("ec-ps-products-once", "Every product in the rows is in the table exactly once, under the SKU and item name first written for it", wrongLines.length === 0, `not so for: ${listed(wrongLines)}`);
  const wrongFigures = [];
  for (const line of lines) {
    const off = [];
    if (line.rows !== BigInt(line.rowNumbers.length)) off.push("rows");
    if (input.hasOrderIds ? line.orders === null || line.orders !== BigInt(line.own.orders.size) : line.orders !== null) off.push("orders");
    if (line.units !== line.own.units) off.push("units");
    if (line.sales !== line.own.sales) off.push("sales");
    if (line.reversals !== line.own.reversals) off.push("reversals");
    if (line.net !== line.own.net) off.push("net");
    if (off.length > 0) wrongFigures.push(`${line.label}: ${off.join(", ")}`);
  }
  checks.that("ec-ps-figures", "Each product’s rows, orders, units, sales, reversals and net are its own rows re-added", wrongFigures.length === 0, `not so for ${listed(wrongFigures, 10, "; ")}`);
  const added = { rows: 0n, units: 0n, sales: 0n, reversals: 0n, net: 0n };
  for (const line of lines) {
    added.rows += line.rows;
    added.units += line.units;
    added.sales += line.sales;
    added.reversals += line.reversals;
    added.net += line.net;
  }
  const second = { rows: BigInt(used.length), units: all.units, sales: all.sales, reversals: all.reversals, net: all.net };
  const wrongTotals = [];
  for (const figure of ["rows", "units", "sales", "reversals", "net"]) {
    if (second[figure] === added[figure] && second[figure] === shown[figure]) continue;
    const show = (v) => figure === "rows" || figure === "units" ? String(v) : usd(v);
    wrongTotals.push(`${figure}: the rows add up to ${show(second[figure])}, the lines to ${show(added[figure])}, the total shown is ${show(shown[figure])}`);
  }
  if (input.hasOrderIds ? shown.orders === null || shown.orders !== BigInt(all.orders.size) : shown.orders !== null) {
    wrongTotals.push(`orders: the rows hold ${input.hasOrderIds ? all.orders.size : "no"} order id(s), the total shown is ${shown.orders === null ? "blank" : String(shown.orders)}`);
  }
  checks.that(
    "ec-ps-totals",
    "Products plus the rows with no product named add up to the totals of all rows used: rows, units, sales, reversals and net (second pass)",
    wrongTotals.length === 0,
    wrongTotals.join("; ")
  );
  const wrongShares = lines.filter((line) => all.net > 0n ? line.share === null || !isRounded(line.share, line.own.net * 10000n, all.net) : line.share !== null).map((line) => line.label);
  checks.that(
    "ec-ps-shares",
    "Each share of net is the product’s net against total net in hundredths of a percent, rounded half away from zero, and is blank when total net is zero or less",
    wrongShares.length === 0,
    `not so for: ${listed(wrongShares)}`
  );
  const outOfOrder = [];
  for (let i = 1; i < products.length; i++) {
    const above = products[i - 1];
    const below2 = products[i];
    const aboveName = words(above.name);
    const belowName = words(below2.name);
    const inOrder = above.own.net > below2.own.net || above.own.net === below2.own.net && (aboveName < belowName || aboveName === belowName && words(above.sku) <= words(below2.sku));
    if (!inOrder) outOfOrder.push(`${below2.label} is listed after ${above.label}`);
  }
  checks.that("ec-ps-order", "The table runs from the largest net down, and products with equal net are in order of item name, then SKU", outOfOrder.length === 0, listed(outOfOrder, 5));
  if (typed !== void 0) {
    const agrees = typed === shown.net;
    checks.add({ id: "ec-ps-typed-total", label: "Total net sales equal the total you typed", passed: agrees, severity: "error", expected: usd(typed), actual: usd(shown.net), ...agrees ? {} : { detail: `off by ${usd(shown.net - typed)}` } });
  }
  checks.that(
    "ec-ps-no-product",
    "Every row names a product",
    unnamedRows === 0,
    `${unnamedRows} row(s) adding up to ${usd(unnamedNet)} have no SKU and no item name; they are listed as rows with no product named and stay in the totals`,
    "warning"
  );
  const below = products.filter((line) => line.own.net < 0n).map((line) => `${line.label} (${usd(line.own.net)})`);
  checks.that("ec-ps-negative-net", "No product has a net below zero", below.length === 0, `net below zero: ${listed(below)}`, "warning");
  if (input.hasOrderIds) {
    checks.that("ec-ps-order-ids", "Every row has an order id", noOrderId === 0, `${noOrderId} row(s) have no order id and are not counted in the orders column`, "warning");
  }
  return checks.all;
}

// packages/core/src/ecommerce/profitCalcCheck.ts
var TEN_THOUSAND = 10000n;
var magnitude = (n) => n < 0n ? -n : n;
function ecProfitIsRounded(value, n, d) {
  if (d <= 0n) return false;
  const scaled = value * d;
  const gap = magnitude(scaled - n);
  if (2n * gap !== d) return 2n * gap < d;
  return magnitude(scaled) > magnitude(n);
}
function nearestTenThousandth(n) {
  if (n < 0n) return -nearestTenThousandth(-n);
  const digits = n.toString();
  const below = digits.length > 4 ? BigInt(digits.slice(0, -4)) : 0n;
  return ecProfitIsRounded(below + 1n, n, TEN_THOUSAND) ? below + 1n : below;
}
function usd2(cents) {
  const text2 = scaledFormat(magnitude(cents), 2);
  let rest = text2.slice(0, -3);
  const groups = [];
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return `${cents < 0n ? "-" : ""}$${groups.join(",")}${text2.slice(-3)}`;
}
var percent = (bp) => `${scaledFormat(bp, 2)}%`;
function ecVerifyProfitCalc(input, result) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const optional = (n) => n === null || n === void 0 ? null : B(n);
  const typed = {
    price: B(input.price),
    shippingCharged: B(input.shippingCharged),
    itemCost: B(input.itemCost),
    shippingCost: B(input.shippingCost),
    otherCost: B(input.otherCost),
    advertising: input.advertising === void 0 ? 0n : B(input.advertising),
    units: input.units === void 0 ? null : B(input.units)
  };
  const typedLines = (Array.isArray(input.fees) ? input.fees : []).map((f) => ({ name: typeof f?.name === "string" ? f.name.trim() : "", rate: B(f?.rateBp), fixed: B(f?.fixed) }));
  const shown = {
    price: B(result.price),
    shippingCharged: B(result.shippingCharged),
    itemCost: B(result.itemCost),
    shippingCost: B(result.shippingCost),
    otherCost: B(result.otherCost),
    advertising: B(result.advertising),
    saleAmount: B(result.saleAmount),
    totalFees: B(result.totalFees),
    totalCosts: B(result.totalCosts),
    profit: B(result.profit),
    marginOnSale: optional(result.marginOnSaleBp),
    marginOnCosts: optional(result.marginOnCostsBp),
    breakEvenPrice: optional(result.breakEvenPrice),
    breakEvenProfit: optional(result.breakEvenProfit),
    units: optional(result.units)
  };
  const shownLines = (Array.isArray(result.fees) ? result.fees : []).map((f) => ({
    name: typeof f?.name === "string" ? f.name : "",
    rate: B(f?.rateBp),
    fixed: B(f?.fixed),
    percentFee: B(f?.percentFee),
    fee: B(f?.fee)
  }));
  const u = result.unitTotals;
  const shownTotals = u === null || u === void 0 ? null : { saleAmount: B(u.saleAmount), totalFees: B(u.totalFees), totalCosts: B(u.totalCosts), profit: B(u.profit) };
  const sale = typed.price + typed.shippingCharged;
  let ownFees = 0n;
  let fixedFees = 0n;
  let totalRate = 0n;
  for (const l of typedLines) {
    ownFees += nearestTenThousandth(sale * l.rate) + l.fixed;
    fixedFees += l.fixed;
    totalRate += l.rate;
  }
  const costsBeforeFees = typed.itemCost + typed.shippingCost + typed.otherCost + typed.advertising;
  const ownCosts = costsBeforeFees + ownFees;
  const ownProfit = sale - ownCosts;
  const cents = (id, label, expected, actual) => {
    const passed = expected === actual;
    checks.add({ id, label, passed, severity: "error", expected: usd2(expected), actual: usd2(actual), ...passed ? {} : { detail: `off by ${usd2(actual - expected)}` } });
  };
  checks.that("whole-numbers", "Every figure typed and every figure shown is a whole number in its unit: cents, hundredths of a percent, or units sold", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const echoed = [
    ["selling price", typed.price, shown.price],
    ["shipping charged", typed.shippingCharged, shown.shippingCharged],
    ["cost of the item", typed.itemCost, shown.itemCost],
    ["cost to ship it", typed.shippingCost, shown.shippingCost],
    ["other cost", typed.otherCost, shown.otherCost],
    ["advertising", typed.advertising, shown.advertising],
    ["units", typed.units, shown.units]
  ];
  const wrongEcho = echoed.filter(([, was, is]) => was !== is).map(([name]) => name);
  if (typed.units === null && shownTotals !== null) wrongEcho.push("totals for units that were not typed");
  checks.that("typed-figures", "The selling price, shipping charged, costs, advertising, and units shown are the figures typed", wrongEcho.length === 0, wrongEcho.join(", "));
  const wrongLines = [];
  if (shownLines.length !== typedLines.length) wrongLines.push(`${typedLines.length} typed, ${shownLines.length} shown`);
  else {
    typedLines.forEach((t, i) => {
      const s = shownLines[i];
      if (!s || s.name !== t.name || s.rate !== t.rate || s.fixed !== t.fixed) wrongLines.push(`line ${i + 1} (${t.name})`);
    });
  }
  checks.that("fee-lines", "Every fee line typed is in the result once, in the order typed, with its name, its rate, and its fixed amount", wrongLines.length === 0, wrongLines.join(", "));
  cents("sale-amount", "Sale amount equals the selling price plus the shipping charged", sale, shown.saleAmount);
  const wrongFees = shownLines.filter((s) => !ecProfitIsRounded(s.percentFee, sale * s.rate, TEN_THOUSAND) || s.fee !== s.percentFee + s.fixed).map((s) => s.name);
  checks.that("fee-amounts", "Each fee is its rate times the sale amount, rounded to the cent with exactly half a cent away from zero, plus its fixed amount", wrongFees.length === 0, wrongFees.join(", "));
  cents("fees-total", "Total fees equal every fee line worked out a second way and added up", ownFees, shown.totalFees);
  cents("costs-total", "Total costs equal the cost of the item, the cost to ship it, the other cost, and advertising, plus total fees", ownCosts, shown.totalCosts);
  cents("profit", "Profit per sale equals the sale amount minus total costs", ownProfit, shown.profit);
  const margin = (id, label, base, baseName, value) => {
    let passed;
    let detail;
    if (base === 0n) {
      passed = value === null;
      detail = `${baseName} is zero, so nothing belongs here`;
    } else if (value === null) {
      passed = false;
      detail = "nothing is shown";
    } else {
      passed = ecProfitIsRounded(value, ownProfit * TEN_THOUSAND, base);
      detail = `${percent(value)} is not ${usd2(ownProfit)} ÷ ${usd2(base)} to the nearest 0.01%`;
    }
    checks.that(id, label, passed, detail);
  };
  margin("margin-on-sale", "Profit as a percent of the sale amount is profit divided by the sale amount, to the nearest 0.01%, and is blank when the sale amount is zero", sale, "the sale amount", shown.marginOnSale);
  margin("margin-on-costs", "Profit as a percent of total costs is profit divided by total costs, to the nearest 0.01%, and is blank when total costs are zero", ownCosts, "total costs", shown.marginOnCosts);
  const fixedCosts = costsBeforeFees + fixedFees;
  const profitAt = (saleAmount) => {
    let fees = 0n;
    for (const l of typedLines) fees += nearestTenThousandth(saleAmount * l.rate);
    return saleAmount - fixedCosts - fees;
  };
  if (totalRate >= TEN_THOUSAND) {
    checks.that(
      "break-even",
      "No break-even price is shown, because the percentage fees add up to 100% or more of the sale amount",
      shown.breakEvenPrice === null && shown.breakEvenProfit === null,
      `the percentage fees add up to ${percent(totalRate)}, yet a break-even price is shown`
    );
  } else {
    let reason = "";
    const claimed = shown.breakEvenPrice;
    if (claimed === null) reason = "no break-even price is shown, although the percentage fees add up to less than 100%";
    else if (claimed < 0n) reason = "the break-even price shown is below zero";
    else {
      const least = typed.shippingCharged;
      const at = claimed + least;
      const there = profitAt(at);
      if (there < 0n) reason = `at ${usd2(claimed)} the profit per sale is ${usd2(there)}, which is below zero`;
      else {
        const lineCount = BigInt(typedLines.length);
        const surelyBelowZero = (y) => 2n * y * (TEN_THOUSAND - totalRate) + TEN_THOUSAND * lineCount < 20000n * fixedCosts;
        const strides = [];
        for (let s = 1n; s <= claimed; s *= 2n) strides.push(s);
        let from = least;
        for (let i = strides.length - 1; i >= 0; i--) {
          const y = from + (strides[i] ?? 0n);
          if (y <= at && surelyBelowZero(y - 1n)) from = y;
        }
        let x = from;
        while (x < at) {
          const p = profitAt(x);
          if (p >= 0n) {
            reason = `a lower selling price, ${usd2(x - least)}, already gives a profit of ${usd2(p)}`;
            break;
          }
          x += -p;
        }
        if (reason === "" && shown.breakEvenProfit !== there) reason = `the profit per sale at ${usd2(claimed)} is ${usd2(there)}, not ${shown.breakEvenProfit === null ? "blank" : usd2(shown.breakEvenProfit)}`;
      }
    }
    checks.that("break-even", "At the break-even price the profit per sale is zero or more, and at every lower selling price it is below zero", reason === "", reason);
  }
  if (typed.units !== null) {
    const units = typed.units;
    const wrongTotals = shownTotals === null ? ["no totals are shown"] : [
      ["sale amount", sale, shownTotals.saleAmount],
      ["total fees", ownFees, shownTotals.totalFees],
      ["total costs", ownCosts, shownTotals.totalCosts],
      ["profit", ownProfit, shownTotals.profit]
    ].filter(([, perSale, total]) => perSale * units !== total).map(([name]) => name);
    checks.that("unit-totals", "For the units typed, the sale amount, total fees, total costs, and profit are each the per-sale figure times the units", wrongTotals.length === 0, wrongTotals.join(", "));
  }
  checks.that("costs-covered", "Total costs are not more than the sale amount", ownProfit >= 0n, `costs are more than the sale brings in at these figures: ${usd2(ownCosts)} of costs against ${usd2(sale)}`, "warning");
  const empty = typedLines.filter((l) => l.rate === 0n && l.fixed === 0n).map((l) => l.name);
  checks.that("fee-lines-filled", "Every fee line has a rate or a fixed amount", empty.length === 0, `no rate and no fixed amount on: ${empty.join(", ")}`, "warning");
  return checks.all;
}

// packages/core/src/ecommerce/profitCalc.ts
var EC_PROFIT_MAX_AMOUNT = 1e9;
var EC_PROFIT_MAX_FEE_LINES = 30;
var EC_PROFIT_MAX_UNITS = 1e6;
var EC_PROFIT_NO_BREAK_EVEN = "No break-even price is shown, because the percentage fees add up to 100% or more of the selling price plus shipping charged.";
var TEN_THOUSAND2 = 10000n;
function roundDiv(n, d) {
  const abs = n < 0n ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return n < 0n ? -q : q;
}
function ceilDiv(n, d) {
  return (n + d - 1n) / d;
}
function safe(n, what) {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is too large for this calculator.`);
  return Number(n);
}
function amount(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be an amount in dollars and whole cents.`);
  if (value < 0) throw new Error(`${label} cannot be negative.`);
  if (value > EC_PROFIT_MAX_AMOUNT) throw new Error(`${label} is more than ${formatUSD(EC_PROFIT_MAX_AMOUNT)}, the most this calculator takes.`);
  return BigInt(value);
}
function readLines(fees) {
  if (fees.length > EC_PROFIT_MAX_FEE_LINES) throw new Error(`There are more than ${EC_PROFIT_MAX_FEE_LINES} fee lines, the most this calculator takes.`);
  return fees.map((f, i) => {
    const name = typeof f.name === "string" ? f.name.trim() : "";
    if (name === "") {
      const hasFigures = f.rateBp !== 0 || f.fixed !== 0;
      throw new Error(hasFigures ? `Fee line ${i + 1} has a rate or an amount but no name. Type a name for it.` : `Fee line ${i + 1} has no name.`);
    }
    if (typeof f.rateBp !== "number" || !Number.isSafeInteger(f.rateBp)) throw new Error(`The rate on "${name}" must be a percent with no more than two decimal places.`);
    if (f.rateBp < 0 || f.rateBp > 1e4) throw new Error(`The rate on "${name}" must be between 0% and 100%.`);
    return { name, rate: BigInt(f.rateBp), fixed: amount(f.fixed, `The fixed amount on "${name}"`) };
  });
}
function percentFeesAt(lines, sale) {
  let total = 0n;
  for (const l of lines) total += roundDiv(sale * l.rate, TEN_THOUSAND2);
  return total;
}
function lowestSaleAtZero(lines, fixedCosts, least) {
  const totalRate = lines.reduce((sum, l) => sum + l.rate, 0n);
  if (totalRate >= TEN_THOUSAND2) return null;
  const rounded = BigInt(lines.filter((l) => l.rate > 0n).length);
  const reach = TEN_THOUSAND2 * fixedCosts - 5000n * rounded;
  let sale = reach > 0n ? ceilDiv(reach, TEN_THOUSAND2 - totalRate) : 0n;
  if (sale < least) sale = least;
  for (; ; ) {
    const profit = sale - fixedCosts - percentFeesAt(lines, sale);
    if (profit >= 0n) return { sale, profit };
    sale += -profit;
  }
}
function ecProfitFigures(input) {
  if (input.price === null || input.price === void 0) throw new Error("Type the selling price.");
  const price = amount(input.price, "The selling price");
  const shippingCharged = amount(input.shippingCharged, "The shipping charged to the buyer");
  const itemCost = amount(input.itemCost, "The cost of the item");
  const shippingCost = amount(input.shippingCost, "The cost to ship it");
  const otherCost = amount(input.otherCost, "The other cost per sale");
  const advertising = input.advertising === void 0 ? 0n : amount(input.advertising, "The advertising cost per sale");
  const lines = readLines(input.fees);
  let units = null;
  if (input.units !== void 0) {
    if (typeof input.units !== "number" || !Number.isSafeInteger(input.units) || input.units < 1) throw new Error("Units sold must be a whole number, 1 or more.");
    if (input.units > EC_PROFIT_MAX_UNITS) throw new Error(`Units sold are more than ${EC_PROFIT_MAX_UNITS.toLocaleString("en-US")}, the most this calculator takes.`);
    units = BigInt(input.units);
  }
  const sale = price + shippingCharged;
  let totalFees = 0n;
  let fixedFees = 0n;
  const fees = lines.map((l) => {
    const percentFee = roundDiv(sale * l.rate, TEN_THOUSAND2);
    totalFees += percentFee + l.fixed;
    fixedFees += l.fixed;
    return { name: l.name, rateBp: Number(l.rate), fixed: Number(l.fixed), percentFee: safe(percentFee, `The fee "${l.name}"`), fee: safe(percentFee + l.fixed, `The fee "${l.name}"`) };
  });
  const ownCosts = itemCost + shippingCost + otherCost + advertising;
  const totalCosts = ownCosts + totalFees;
  const profit = sale - totalCosts;
  const found = lowestSaleAtZero(lines, ownCosts + fixedFees, shippingCharged);
  const total = (perSale, what) => safe(perSale * (units ?? 1n), `${what} for the units typed`);
  return {
    price: Number(price),
    shippingCharged: Number(shippingCharged),
    itemCost: Number(itemCost),
    shippingCost: Number(shippingCost),
    otherCost: Number(otherCost),
    advertising: Number(advertising),
    saleAmount: safe(sale, "The sale amount"),
    fees,
    totalFees: safe(totalFees, "Total fees"),
    totalCosts: safe(totalCosts, "Total costs"),
    profit: safe(profit, "The profit"),
    marginOnSaleBp: sale === 0n ? null : safe(roundDiv(profit * TEN_THOUSAND2, sale), "Profit as a percent of the sale amount"),
    marginOnCostsBp: totalCosts === 0n ? null : safe(roundDiv(profit * TEN_THOUSAND2, totalCosts), "Profit as a percent of total costs"),
    breakEvenPrice: found === null ? null : safe(found.sale - shippingCharged, "The break-even price"),
    breakEvenProfit: found === null ? null : safe(found.profit, "The profit at the break-even price"),
    units: units === null ? null : Number(units),
    unitTotals: units === null ? null : { saleAmount: total(sale, "The sale amount"), totalFees: total(totalFees, "Total fees"), totalCosts: total(totalCosts, "Total costs"), profit: total(profit, "The profit") }
  };
}
function ecProfitCalc(input) {
  const figures = ecProfitFigures(input);
  return { ...figures, checks: ecVerifyProfitCalc(input, figures) };
}
function ecProfitPercentText(bp) {
  return bp === null ? "" : `${scaledFormat(bp, 2)}%`;
}
function ecProfitUnitsHeader(units) {
  return units === 1 ? "For 1 unit" : `For ${units.toLocaleString("en-US")} units`;
}
function ecProfitCalcTables(r) {
  const d = toDecimal;
  const usd4 = formatUSD;
  const written = (f) => {
    if (f.rateBp === 0) return f.fixed === 0 ? "No rate and no fixed amount" : `${usd4(f.fixed)} per sale`;
    const percentPart = `${usd4(r.saleAmount)} × ${ecProfitPercentText(f.rateBp)} = ${usd4(f.percentFee)}`;
    return f.fixed === 0 ? percentPart : `${percentPart}, plus ${usd4(f.fixed)}`;
  };
  const u = r.unitTotals;
  const withUnits = r.units !== null && u !== null;
  const row = (label, perSale, forUnits = "") => withUnits ? [label, perSale, forUnits] : [label, perSale];
  const summary = [
    withUnits ? ["Figure", "Per sale", ecProfitUnitsHeader(r.units ?? 1)] : ["Figure", "Per sale"],
    row("Selling price", d(r.price)),
    row("Shipping charged to the buyer", d(r.shippingCharged)),
    row("Sale amount (selling price plus shipping charged)", d(r.saleAmount), u ? d(u.saleAmount) : ""),
    row("Cost of the item", d(r.itemCost)),
    row("Cost to ship it", d(r.shippingCost)),
    row("Other cost per sale", d(r.otherCost)),
    row("Advertising cost per sale", d(r.advertising)),
    row("Total fees", d(r.totalFees), u ? d(u.totalFees) : ""),
    row("Total costs", d(r.totalCosts), u ? d(u.totalCosts) : ""),
    row("Profit", d(r.profit), u ? d(u.profit) : ""),
    row("Profit as a percent of the sale amount (margin)", ecProfitPercentText(r.marginOnSaleBp)),
    row("Profit as a percent of total costs", ecProfitPercentText(r.marginOnCostsBp))
  ];
  if (r.breakEvenPrice !== null && r.breakEvenProfit !== null) {
    summary.push(row("Break-even price (lowest selling price with profit of zero or more)", d(r.breakEvenPrice)), row("Profit per sale at the break-even price", d(r.breakEvenProfit)));
  } else {
    summary.push(row("Break-even price", "Not shown: percentage fees are 100% or more"));
  }
  return {
    summary,
    fees: [
      ["Fee", "Rate", "Percentage part", "Fixed amount", "Fee per sale"],
      ...r.fees.map((f) => [f.name, ecProfitPercentText(f.rateBp), d(f.percentFee), d(f.fixed), d(f.fee)]),
      ["Total fees", "", "", "", d(r.totalFees)]
    ],
    feeSteps: [["Fee", "With your numbers", "Fee per sale"], ...r.fees.map((f) => [f.name, written(f), d(f.fee)]), ["Total fees", "", d(r.totalFees)]]
  };
}
function ecProfitCalcNotes(r) {
  const usd4 = formatUSD;
  return [
    "Every rate was typed in. This calculator holds no fee rates of any marketplace or payment company.",
    `Each percentage fee is its own rate times the selling price plus shipping charged (${usd4(r.saleAmount)}), rounded to the cent on its own line. Exactly half a cent rounds away from zero.`,
    "Each percent of profit is rounded to two decimals of a percent, with an exact half rounding away from zero. It is left blank when what it is a percent of is zero.",
    r.breakEvenPrice !== null && r.breakEvenProfit !== null ? `The break-even price is the lowest selling price, in whole cents, at which profit per sale is zero or more, with every other figure as typed. At ${usd4(r.breakEvenPrice)} the profit per sale is ${usd4(r.breakEvenProfit)}.` : EC_PROFIT_NO_BREAK_EVEN
  ];
}

// packages/core/src/ecommerce/salesTax.ts
function ecReadOrderRows(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const col = mapping.columns;
  const needed = [
    [col.orderId, "Order id"],
    [col.state, "Ship-to state"],
    [col.tax, "Tax collected"]
  ];
  for (const [index, label] of needed) {
    if (index < 0) throw new Error(`No "${label}" column could be identified (${ecHeaderList(rows, mapping.headerRow)}). Choose it in the column mapping.`);
  }
  const used = EC_ORDER_ROLES.map((role) => col[role]).filter((index) => index >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
  const out = { rows: [], problems: [], ignoredRows: 0 };
  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell2) => cell2.trim() === "")) continue;
    const cell = (index) => index < 0 ? "" : (row[index] ?? "").trim();
    const orderId = cell(col.orderId);
    const taxableText = cell(col.taxable);
    const taxText = cell(col.tax);
    if (orderId === "" && taxableText === "" && taxText === "") {
      out.ignoredRows += 1;
      continue;
    }
    const reasons = [];
    let taxable = 0;
    let tax = 0;
    try {
      const read = ecMoneyCell(taxableText);
      if (read !== void 0) taxable = read;
    } catch {
      reasons.push(`the taxable amount "${taxableText}" could not be read`);
    }
    try {
      const read = ecMoneyCell(taxText);
      if (read !== void 0) tax = read;
    } catch {
      reasons.push(`the tax collected "${taxText}" could not be read`);
    }
    if (orderId === "") reasons.push("no order id");
    if (reasons.length > 0) {
      out.problems.push({ rowNumber: i + 1, reason: reasons.join("; ") });
      continue;
    }
    out.rows.push({ rowNumber: i + 1, orderId, stateRaw: cell(col.state), taxable, tax });
  }
  return out;
}
function ecVerifySalesTax(input, r) {
  const checks = new CheckList();
  const B = BigInt;
  const problems = input.problems ?? [];
  checks.that("rows-read", "Every row with data in the file was read", problems.length === 0, `${problems.length} row(s) could not be read and are not in the result; first: row ${problems[0]?.rowNumber}: ${problems[0]?.reason}`);
  const ids = new Set(input.rows.map((x) => x.orderId));
  const listed2 = r.orders.map((o) => o.orderId);
  const usedRows = r.orders.flatMap((o) => o.rowNumbers);
  const once = new Set(listed2).size === listed2.length && listed2.length === ids.size && listed2.every((id) => ids.has(id)) && usedRows.length === input.rows.length && new Set(usedRows).size === usedRows.length;
  checks.that("orders-once", "Every order is counted exactly once, and every row belongs to one order", once, `${ids.size} order id(s) in the file, ${listed2.length} in the summary`);
  const unknownIds = new Set(r.unknown.map((o) => o.orderId));
  const inState = (s) => r.orders.filter((o) => o.state === s.state);
  const placed = unknownIds.size === r.unknown.length && r.unknown.every((o) => o.state === "") && r.orders.every((o) => o.state === "" === unknownIds.has(o.orderId)) && r.orders.every((o) => o.state === "" || r.states.filter((s) => s.state === o.state).length === 1) && r.states.every((s) => s.orders > 0 && s.orders === inState(s).length && B(s.taxable) === inState(s).reduce((a, o) => a + B(o.taxable), 0n) && B(s.tax) === inState(s).reduce((a, o) => a + B(o.tax), 0n));
  checks.that("orders-placed", "Each order is under exactly one state, or in the separate list when its state is missing or unknown", placed);
  const rowTaxable = input.rows.reduce((a, x) => a + B(x.taxable), 0n);
  const rowTax = input.rows.reduce((a, x) => a + B(x.tax), 0n);
  const add = (list, key) => list.reduce((a, x) => a + B(x[key]), 0n);
  checks.equal("states-count", "State rows + separately listed orders = all orders (count)", ids.size, r.states.reduce((a, s) => a + s.orders, 0) + r.unknown.length);
  checks.cents("states-taxable", "State rows + separately listed orders = total taxable amount (second pass)", Number(rowTaxable), Number(add(r.states, "taxable") + add(r.unknown, "taxable")));
  checks.cents("states-tax", "State rows + separately listed orders = total tax collected (second pass)", Number(rowTax), Number(add(r.states, "tax") + add(r.unknown, "tax")));
  const bucketOk = (b, orders, taxable, tax) => b.orders === orders && B(b.taxable) === taxable && B(b.tax) === tax;
  const totalsOk = bucketOk(r.statesTotal, r.states.reduce((a, s) => a + s.orders, 0), add(r.states, "taxable"), add(r.states, "tax")) && bucketOk(r.unknownTotal, r.unknown.length, add(r.unknown, "taxable"), add(r.unknown, "tax")) && bucketOk(r.grandTotal, ids.size, rowTaxable, rowTax);
  checks.that("totals-shown", "The totals shown match the second pass", totalsOk);
  checks.that("state-known", "Every order has a recognizable ship-to state", r.unknown.length === 0, `${r.unknown.length} order(s) have a missing, unrecognized, or conflicting state and are listed separately`, "warning");
  checks.that("order-rows", "Each order id appears on one row", r.repeatedOrderIds.length === 0, `${r.repeatedOrderIds.length} order id(s) appear on more than one row; their rows were added together`, "warning");
  return checks.all;
}
function ecSalesTaxSummary(input) {
  if (input.rows.length === 0) throw new Error("No order rows were read. Check the header row and the column mapping.");
  const rowsOf = /* @__PURE__ */ new Map();
  for (const row of input.rows) {
    const mine = rowsOf.get(row.orderId);
    if (mine === void 0) rowsOf.set(row.orderId, [row]);
    else mine.push(row);
  }
  const orders = [...rowsOf.entries()].map(([orderId, mine]) => {
    const texts = [...new Set(mine.map((r) => r.stateRaw).filter((text2) => text2.trim() !== ""))];
    const codes2 = texts.map((text2) => ecStateCode(text2));
    const distinct = new Set(codes2);
    const reason = texts.length === 0 ? "missing" : codes2.includes("") ? "unrecognized" : distinct.size > 1 ? "conflicting" : void 0;
    const order = {
      orderId,
      rowNumbers: mine.map((r) => r.rowNumber),
      state: reason === void 0 ? codes2[0] : "",
      stateRaw: texts.join(" / "),
      taxable: mine.reduce((total, r) => total + r.taxable, 0),
      tax: mine.reduce((total, r) => total + r.tax, 0)
    };
    if (reason !== void 0) order.reason = reason;
    return order;
  });
  const unknown = orders.filter((o) => o.state === "");
  const known = orders.filter((o) => o.state !== "");
  const bucketOf = (list, count) => ({
    orders: count,
    taxable: list.reduce((total, o) => total + o.taxable, 0),
    tax: list.reduce((total, o) => total + o.tax, 0)
  });
  const codes = [...new Set(known.map((o) => o.state))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const states = codes.map((state) => {
    const mine = known.filter((o) => o.state === state);
    return { state, name: ecStateName(state), ...bucketOf(mine, mine.length) };
  });
  const statesTotal = bucketOf(known, known.length);
  const unknownTotal = bucketOf(unknown, unknown.length);
  const grandTotal = { orders: statesTotal.orders + unknownTotal.orders, taxable: statesTotal.taxable + unknownTotal.taxable, tax: statesTotal.tax + unknownTotal.tax };
  const repeatedOrderIds = orders.filter((o) => o.rowNumbers.length > 1).map((o) => o.orderId);
  const summary = { orders, states, unknown, statesTotal, unknownTotal, grandTotal, repeatedOrderIds };
  return { ...summary, checks: ecVerifySalesTax(input, summary) };
}
function ecSalesTaxTables(r) {
  const d = toDecimal;
  const why = { missing: "No state on the order", unrecognized: "Not a state or territory", conflicting: "Rows name different states" };
  const states = [
    ["State", "Name", "Orders", "Taxable amount", "Tax collected"],
    ...r.states.map((s) => [s.state, s.name, s.orders, d(s.taxable), d(s.tax)]),
    ["", "All states listed", r.statesTotal.orders, d(r.statesTotal.taxable), d(r.statesTotal.tax)],
    ["", "Missing or unknown state", r.unknownTotal.orders, d(r.unknownTotal.taxable), d(r.unknownTotal.tax)],
    ["", "Grand total", r.grandTotal.orders, d(r.grandTotal.taxable), d(r.grandTotal.tax)]
  ];
  const unknown = [["Order", "Rows", "State as written", "Reason", "Taxable amount", "Tax collected"], ...r.unknown.map((o) => [o.orderId, o.rowNumbers.join(" "), o.stateRaw, why[o.reason ?? "missing"], d(o.taxable), d(o.tax)])];
  return { states, unknown };
}

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0; i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1; i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (; i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0; i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0; i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i = 0; i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0; i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0; i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0; i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0; i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i2) {
      return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0; i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0; i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
};
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i = 0; i < files.length; ++i) {
    var f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// packages/core/src/xlsx.ts
var DECIMAL_2 = /^-?\d+\.\d{2}$/;
function xmlEscape(s) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
function sheetNames(sheets) {
  const used = /* @__PURE__ */ new Set();
  return sheets.map((s, i) => {
    let name = s.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function moneyColumns(sheet) {
  const cols = /* @__PURE__ */ new Set();
  const head = sheet.rows[0] ?? [];
  const body = sheet.rows.slice(1);
  if (sheet.money && sheet.money !== "auto") {
    head.forEach((h, i) => {
      if (typeof h === "string" && sheet.money.includes(h)) cols.add(i);
    });
    return cols;
  }
  for (let i = 0; i < head.length; i++) {
    let filled = 0;
    let ok = true;
    for (const row of body) {
      const c = row[i];
      if (c === null || c === void 0 || c === "") continue;
      filled++;
      if (typeof c !== "string" || !DECIMAL_2.test(c)) {
        ok = false;
        break;
      }
    }
    if (ok && filled > 0) cols.add(i);
  }
  return cols;
}
function sheetXml(sheet) {
  const money = moneyColumns(sheet);
  const colCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = [];
  for (let i = 0; i < colCount; i++) {
    const given = sheet.widths?.[i];
    if (given) {
      widths.push(given);
      continue;
    }
    let w = 8;
    for (const row of sheet.rows.slice(0, 200)) w = Math.max(w, String(row[i] ?? "").length + 2);
    widths.push(Math.min(w, 60));
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === void 0 || cell === "") return "";
      const ref = `${columnName(c)}${r + 1}`;
      const style = r === 0 ? 1 : 0;
      if (r > 0 && money.has(c) && typeof cell === "string" && DECIMAL_2.test(cell)) return `<c r="${ref}" s="2"><v>${cell}</v></c>`;
      if (typeof cell === "number" && Number.isSafeInteger(cell)) return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(cell))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + (cols ? `<cols>${cols}</cols>` : "") + `<sheetData>${rows}</sheetData></worksheet>`;
}
var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
function writeXlsx(sheets, fixedDate = new Date(Date.UTC(2020, 0, 1))) {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet");
  const names = sheetNames(sheets);
  const files = {};
  const put = (path, xml) => {
    files[path] = strToU8(xml);
  };
  put(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"
  );
  put(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
  );
  put(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  put("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipSync(files, { level: 6, mtime: fixedDate });
}
function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&amp;/g, "&");
}
function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? xmlUnescape(m[1] ?? m[2] ?? "") : void 0;
}
function textOf(xml) {
  const cleaned = xml.replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while (m = re.exec(cleaned)) out += xmlUnescape(m[1] ?? "");
  return out;
}
var MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
var MAX_ROWS = 1048576;
var DAYS_1904 = 1462;
var BUILT_IN_DATE_FORMATS = /* @__PURE__ */ new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\[(h+|m+|s+)\]/gi, "h").replace(/\[[^\]]*\]/g, "");
  return /[dy]/i.test(c) || /m/i.test(c) && !/[hs]/i.test(c);
}
function dateStyles(styles) {
  const out = /* @__PURE__ */ new Set();
  if (!styles) return out;
  const custom = /* @__PURE__ */ new Map();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  let index = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id);
    if (code !== void 0 ? isDateFormat(code) : BUILT_IN_DATE_FORMATS.has(id)) out.add(index);
    index++;
  }
  return out;
}
function readXlsx(bytes) {
  let files;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("too large");
        return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name);
      }
    });
  } catch (err2) {
    throw new Error(err2 instanceof Error && err2.message === "too large" ? "This workbook is too large to open here." : "This file is not a readable .xlsx workbook.");
  }
  const read = (path) => {
    const f = files[path];
    return f ? strFromU8(f) : void 0;
  };
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("This file is not a readable .xlsx workbook.");
  const workbookPr = /<workbookPr\s[^>]*>/.exec(workbook);
  const date1904 = workbookPr ? /^(1|true)$/.test(attr(workbookPr[0], "date1904") ?? "") : false;
  const dated = date1904 ? dateStyles(read("xl/styles.xml")) : /* @__PURE__ */ new Set();
  const shared = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) {
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m;
    while (m = re.exec(sst)) shared.push(textOf(m[1] ?? ""));
  }
  const targets = /* @__PURE__ */ new Map();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], "r:id");
    const xml = rid ? read(targets.get(rid) ?? "") : void 0;
    if (xml === void 0) continue;
    const rows = [];
    let width = 0;
    let nextRow = 0;
    const body = xml.replace(/<row(\s[^>]*)?\/>/g, "");
    for (const rm of body.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const rAttr = rm[1] ? attr(rm[1], "r") : void 0;
      const rowIndex = rAttr && /^\d{1,7}$/.test(rAttr) ? Number(rAttr) - 1 : nextRow;
      if (rowIndex < 0 || rowIndex >= MAX_ROWS) throw new Error("This workbook is too large to open here.");
      nextRow = rowIndex + 1;
      const row = [];
      let nextCol = 0;
      for (const cm of rm[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cm[1] ?? "";
        const ref = attr(tag, "r");
        const col = ref && /^[A-Z]{1,3}\d*$/.test(ref) ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        const type = attr(tag, "t");
        const inner = cm[2] ?? "";
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        let value = "";
        if (type === "s") value = v ? shared[Number(v[1])] ?? "" : "";
        else if (type === "inlineStr") value = textOf(inner);
        else if (type === "b") value = v ? v[1] === "1" ? "TRUE" : "FALSE" : "";
        else value = v ? xmlUnescape(v[1]) : "";
        const day = (type === void 0 || type === "n") && dated.size > 0 ? /^(\d{1,7})(\.\d+)?$/.exec(value) : null;
        if (day && dated.has(Number(attr(tag, "s") ?? 0))) value = `${Number(day[1]) + DAYS_1904}${day[2] ?? ""}`;
        while (row.length < col) row.push("");
        row[col] = value;
      }
      while (rows.length < rowIndex) rows.push([]);
      rows[rowIndex] = row;
      width = Math.max(width, row.length);
    }
    for (const row of rows) while (row.length < width) row.push("");
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new Error("This workbook has no readable sheets.");
  return sheets;
}

// packages/core/src/property/templates.ts
function verifyTemplateWorkbook(sheets, bytes) {
  const checks = new CheckList();
  const read = readXlsx(bytes);
  checks.equal("sheets", "The workbook has the expected sheets, in order", sheets.map((s) => s.name).join(", "), read.map((s) => s.name).join(", "));
  sheets.forEach((s, i) => {
    const got = read[i];
    const header = (s.rows[0] ?? []).map((c) => String(c ?? "")).join(" | ");
    checks.equal(`header-${i}`, `${s.name}: header row reads back as written`, header, (got?.rows[0] ?? []).slice(0, (s.rows[0] ?? []).length).join(" | "));
    checks.equal(`rows-${i}`, `${s.name}: row count reads back as written`, s.rows.length, got?.rows.length ?? 0);
  });
  let formulas = false;
  for (const s of sheets) for (const row of s.rows) for (const c of row) if (typeof c === "string" && /^=/.test(c)) formulas = true;
  checks.that("values-only", "The workbook holds values only, no formulas", !formulas);
  return checks.all;
}

// packages/core/src/ecommerce/sellerTemplate.ts
var EC_TEMPLATE_SHEETS = ["Ledger", "Orders", "Log", "Instructions"];
var EC_TEMPLATE_LEDGER_HEADERS = ["Date", "Type", "Description", "Amount", "Fees", "Net"];
var EC_TEMPLATE_ORDER_HEADERS = ["Order ID", "Order date", "Item", "SKU", "Quantity", "Item total", "Ship-to state", "Taxable amount", "Tax collected", "Notes"];
var EC_TEMPLATE_LEDGER_COLUMNS = { date: 0, type: 1, description: 2, amount: 3, fees: 4, net: 5 };
var EC_TEMPLATE_ORDER_COLUMNS = { orderId: 0, state: 6, taxable: 7, tax: 8 };
var EC_TEMPLATE_ORDERS_SHEET = /^orders$/i;
var EC_TEMPLATE_TYPES = [
  { word: "Sale", category: "sale", also: ["order", "payment", "charge"] },
  { word: "Shipping", category: "shipping", also: ["delivery"] },
  { word: "Tax", category: "tax", also: ["VAT", "GST"] },
  { word: "Fee", category: "fee", also: ["commission", "subscription", "listing", "advertising", "ads", "marketing", "label", "postage"] },
  { word: "Refund", category: "refund", also: ["return", "chargeback"] },
  { word: "Payout", category: "payout", also: ["deposit", "transfer", "disbursement", "withdrawal"] },
  { word: "Adjustment", category: "adjustment", also: [] }
];
var EC_TEMPLATE_TYPE_ORDER = ["refund", "payout", "fee", "tax", "shipping", "sale"];
function cleanShop(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The shop name is longer than 120 characters.");
  return s;
}
function cleanYear(value) {
  const s = value.trim();
  if (s !== "" && !/^20\d{2}$/.test(s)) throw new Error("The year must be four digits, from 2000 to 2099.");
  return s;
}
function orList(words2) {
  if (words2.length < 3) return words2.join(" or ");
  return `${words2.slice(0, -1).join(", ")}, or ${words2[words2.length - 1]}`;
}
function typeWord(category) {
  return EC_TEMPLATE_TYPES.find((t) => t.category === category)?.word ?? category;
}
function ecSellerTemplateSheets(o) {
  const shop = cleanShop(o.shop);
  const year = cleanYear(o.year);
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/ecommerce/${slug}/${site ? "?src=template" : ""}`;
  const [ledger, orders, log] = EC_TEMPLATE_SHEETS;
  const typeRows = EC_TEMPLATE_TYPES.map((t) => {
    const others = t.also.length > 0 ? `So is a type with the word ${orList(t.also)} in it.` : "So is every type with none of the words above in it, so no row is left out.";
    return [ledger, `Type: ${t.word}`, `Counted under ${EC_CATEGORY_LABELS[t.category]}. ${others}`];
  });
  return [
    {
      name: ledger,
      rows: [[...EC_TEMPLATE_LEDGER_HEADERS]],
      money: ["Amount", "Fees", "Net"],
      widths: [14, 16, 44, 14, 14, 14]
    },
    {
      name: orders,
      rows: [[...EC_TEMPLATE_ORDER_HEADERS]],
      money: ["Item total", "Taxable amount", "Tax collected"],
      widths: [14, 14, 32, 14, 10, 14, 14, 16, 14, 40]
    },
    {
      name: log,
      rows: [
        ["Item", "Value"],
        ["Kept for", shop],
        ["Year", year],
        ["Date last updated", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: EC_TEMPLATE_SHEETS[3],
      rows: [
        ["Sheet", "Column", "What it holds"],
        ["This workbook", "", "A layout to fill in with the money rows of an online shop and the items it sold. It holds values only, with no formulas, so nothing in it adds up; the tools listed at the foot of this sheet do the adding."],
        [ledger, "", "The money rows of the shop's payment account: one row per sale, fee, shipping charge, tax line, refund, adjustment, or payout. Rows go under the header row, with no blank row between two entries and no total row."],
        [ledger, "Date", "The date of the row, written like 2026-03-15. The monthly books page lists a row that has an amount and no date as a row it could not read."],
        [
          ledger,
          "Type",
          `What the row is, in a word: ${orList(EC_TEMPLATE_TYPES.map((t) => t.word))}. The monthly books page counts a row by the words in this cell, shows what it took each type for, and lets each one be changed there. The rows below say how it counts each word.`
        ],
        ...typeRows,
        [
          ledger,
          "Type: two kinds of word",
          `A type that holds words from two of the rows above is counted by the first of these that it holds: ${EC_TEMPLATE_TYPE_ORDER.map((c) => `a ${typeWord(c)} word`).join(", ")}. So Shipping label is counted under ${EC_CATEGORY_LABELS.fee} and Sales tax under ${EC_CATEGORY_LABELS.tax}.`
        ],
        [ledger, "Description", `What the row is for, such as the order number or the name of a fee. On a row counted under ${EC_CATEGORY_LABELS.fee}, the text before the first colon is the fee type the monthly books page lists the fee under: Transaction fee: Blue mug is listed under Transaction fee.`],
        [
          ledger,
          "Amount",
          "The amount of the row in dollars. Money that comes into the payment account is a positive number; money that goes out of it, such as a fee or a refund, is a negative number. A payout is written the same way on every Payout row, all negative or all positive: the monthly books page shows which way it took them, and that can be changed there."
        ],
        [
          ledger,
          "Fees",
          `A fee taken out of the same row, such as a processing fee held back from a sale, as a negative number. Blank when there is none. When this column holds positive numbers and no negative one, the monthly books page takes them as amounts to subtract; it shows that choice, and it can be changed there. On a row counted under ${EC_CATEGORY_LABELS.tax}, a number in this column is counted as tax.`
        ],
        [ledger, "Net", "What the row comes to with its fees: Amount plus Fees when fees are negative numbers. It can be left blank. Where it is filled in, the monthly books page checks that the amount and the fees add up to it on that row."],
        [orders, "", "One row per item sold, under the header row, with no blank row between two items and no total row. An order of three different items takes three rows with the same Order ID."],
        [orders, "Order ID", "The id or number of the order. The sales tax by state page adds rows with the same Order ID together and counts the order once. It lists a row that has a taxable amount or tax and no Order ID as a row it could not read."],
        [orders, "Order date", "The date of the order, written like 2026-03-15."],
        [orders, "Item", "The name of the item sold."],
        [orders, "SKU", "The code your own records use for the item. It can be left blank."],
        [orders, "Quantity", "How many of the item were sold on this row."],
        [orders, "Item total", "The amount charged for the items on this row, in dollars: the quantity times the price of one. Tax goes in the Tax collected column, not here."],
        [
          orders,
          "Ship-to state",
          "The state the order was shipped to, as a two-letter code such as TX or the full name; the sales tax by state page reads both. An order with no state on any of its rows, with text that is not a state or territory, or with rows that name different states is listed separately there and still counted."
        ],
        [orders, "Taxable amount", "The part of the Item total that tax was worked out on, in dollars, as your own records have it. It can be left blank; the sales tax by state page then counts it as zero."],
        [orders, "Tax collected", "The tax collected on this row, in dollars. Blank counts as zero. The sales tax by state page adds the tax on every row of an order, so an order's whole tax written again on each of its rows would be counted more than once."],
        [orders, "Notes", "Anything else about the row."],
        [log, "", "The shop, the year the workbook covers, and the date it was last updated."],
        ["Tools on the site", "Payment CSV to monthly books", `${page("payment-csv-to-monthly-books")} opens this workbook, reads the Ledger sheet, and totals each month by type, with fees by fee type and a journal entry for each month.`],
        ["Tools on the site", "Sales tax collected by state", `${page("sales-tax-by-state")} opens this workbook, reads the Orders sheet, and totals orders, taxable amount, and tax collected for each ship-to state. It holds no tax rates.`],
        ["Tools on the site", "Sales by product", `${page("sales-by-product")} opens this workbook, reads the Orders sheet, and adds up what was sold by product.`],
        [
          "Tools on the site",
          "Payout to journal entry",
          `${page("payout-journal-entry")} opens this workbook, reads the Ledger sheet, and fills in the parts of one journal entry from every row on it. It is made for the rows of one payout: where the sheet holds more than one, they all go into the one entry.`
        ]
      ],
      money: [],
      widths: [20, 30, 130]
    }
  ];
}
function withBlankRow(rows) {
  return [...rows.map((r) => [...r]), (rows[0] ?? []).map(() => "")];
}
function ecVerifySellerTemplate(o, bytes) {
  const sheets = ecSellerTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const log = rowsOf(EC_TEMPLATE_SHEETS[2]);
  const cell = (label) => {
    const row = log.find((r) => r[0] === label);
    return row ? row[1] ?? "" : "(no such row)";
  };
  checks.equal("shop", "The Log sheet carries the shop name as typed", cleanShop(o.shop), cell("Kept for"));
  checks.equal("year", "The Log sheet carries the year as typed", cleanYear(o.year), cell("Year"));
  const filled = read.filter((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  checks.equal("ledger-first", "The Ledger sheet is the first sheet in the file, the one opened when no sheet is asked for by name", EC_TEMPLATE_SHEETS[0], filled[0]?.name ?? "");
  const ledger = rowsOf(EC_TEMPLATE_SHEETS[0]);
  const ledgerMapping2 = ecGuessLedgerColumns(ledger);
  const ledgerFound = ledgerMapping2.headerRow === 0 && EC_LEDGER_ROLES.every((role) => ledgerMapping2.columns[role] === EC_TEMPLATE_LEDGER_COLUMNS[role]);
  checks.that("ledger-readable", "The date, row type, description, amount, fees, and net are found in the Ledger header row the way the monthly books page finds them, each in the column written for it", ledgerFound);
  let ledgerEmpty = false;
  if (ledgerFound) {
    const x = ecReadLedgerRows(withBlankRow(ledger), ledgerMapping2);
    ledgerEmpty = x.lines.length === 0 && x.problems.length === 0 && x.ignoredRows === 0;
  }
  checks.that("ledger-empty", "The Ledger sheet reads as a ledger with nothing entered yet", ledgerEmpty);
  const named = filled.find((s) => EC_TEMPLATE_ORDERS_SHEET.test(s.name));
  checks.equal("orders-named", "The Orders sheet is found under its own name, the way the pages that read order rows ask for it", EC_TEMPLATE_SHEETS[1], named?.name ?? "");
  const orders = named?.rows ?? [];
  const orderMapping = ecGuessOrderColumns(orders);
  const ordersFound = orderMapping.headerRow === 0 && EC_ORDER_ROLES.every((role) => orderMapping.columns[role] === EC_TEMPLATE_ORDER_COLUMNS[role]);
  checks.that("orders-readable", "The order id, ship-to state, taxable amount, and tax collected are found in the Orders header row the way the sales tax by state page finds them, each in the column written for it", ordersFound);
  let ordersEmpty = false;
  if (ordersFound) {
    const x = ecReadOrderRows(withBlankRow(orders), orderMapping);
    ordersEmpty = x.rows.length === 0 && x.problems.length === 0 && x.ignoredRows === 0;
  }
  checks.that("orders-empty", "The Orders sheet reads as a list of orders with nothing entered yet", ordersEmpty);
  const notes = rowsOf(EC_TEMPLATE_SHEETS[3]);
  const wordsCounted = EC_TEMPLATE_TYPES.every((t) => {
    const row = notes.find((r) => r[0] === EC_TEMPLATE_SHEETS[0] && r[1] === `Type: ${t.word}`);
    return row !== void 0 && (row[2] ?? "").startsWith(`Counted under ${EC_CATEGORY_LABELS[t.category]}. `) && [t.word, ...t.also].every((w) => ecGuessCategory(w) === t.category);
  });
  const orderHolds = EC_TEMPLATE_TYPE_ORDER.every(
    (first, i) => EC_TEMPLATE_TYPE_ORDER.slice(i + 1).every((second) => ecGuessCategory(`${typeWord(second)} ${typeWord(first)}`) === first && ecGuessCategory(`${typeWord(first)} ${typeWord(second)}`) === first)
  );
  checks.that("type-words", "Each word the Instructions sheet gives for the Type column is counted by the monthly books page the way the sheet says", wordsCounted && orderHolds);
  return checks.all;
}

// packages/agents/src/present.ts
function isVerified(checks) {
  return checks.some((c) => c.severity === "error") && passedAll(checks);
}
var TEXT_ROWS_PER_TABLE = 40;
var SITE_URL = "https://mathproven.com";
function cellText(c) {
  if (c === null || c === void 0) return "";
  return String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function markdownTable(t, limit = TEXT_ROWS_PER_TABLE) {
  const [header, ...body] = t.rows;
  if (!header) return `${t.name}: (empty)`;
  const width = header.length;
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cellText(r[i] ?? "")).join(" | ")} |`;
  const out = [`### ${t.name}`, "", line(header), `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of body.slice(0, limit)) out.push(line(r));
  if (body.length > limit) out.push("", `(${body.length - limit} more row(s) not shown here. Give "saveTo" a path ending .xlsx or .csv to get every row.)`);
  if (body.length === 0) out.push("", "(no rows)");
  return out.join("\n");
}
function checkLine(c) {
  let s = `- ${c.label}`;
  if (c.expected !== void 0 || c.actual !== void 0) s += ` (expected ${c.expected ?? ""}, found ${c.actual ?? ""})`;
  if (c.detail) s += `: ${c.detail}`;
  return s;
}
function pageUrl(entry, ref) {
  const path = entry.page === "" ? "" : `${entry.page.replace(/^\/+|\/+$/g, "")}/`;
  return `${SITE_URL}/${path}?ref=${encodeURIComponent(ref)}`;
}
function present(entry, result, ref, certificate, savedTo, columnsRead = []) {
  const checks = result.checks;
  const verified = isVerified(checks);
  const comparison = new Set(entry.comparisonChecks ?? []);
  const comparisonOnly = !verified && comparison.size > 0 && failures(checks).length > 0 && failures(checks).every((c) => comparison.has(c.id)) && checks.some((c) => c.severity === "error" && c.passed);
  const failed = failures(checks);
  const warned = warnings(checks);
  const link = pageUrl(entry, ref);
  const footer = `${entry.notAdvice} This ran where your assistant runs; nothing was sent to Mathproven. The same tool on the web: ${link}`;
  const tables = verified || comparisonOnly ? result.tables.map((t) => ({ name: t.name, rows: t.rows.slice(0, TEXT_ROWS_PER_TABLE + 1).map((r) => [...r]), moreRows: Math.max(0, t.rows.length - 1 - TEXT_ROWS_PER_TABLE) })) : [];
  const structured = {
    tool: entry.name,
    verified,
    summary: verified || comparisonOnly ? result.summary : "",
    checksRun: checks.length,
    failedChecks: failed.map((c) => ({ id: c.id, label: c.label, ...c.expected !== void 0 ? { expected: c.expected } : {}, ...c.actual !== void 0 ? { actual: c.actual } : {}, ...c.detail ? { detail: c.detail } : {} })),
    warnings: warned.map((c) => ({ id: c.id, label: c.label, ...c.detail ? { detail: c.detail } : {} })),
    tables,
    page: link,
    columnsRead: [...columnsRead]
  };
  const parts = [];
  if (verified) {
    parts.push(`Mathproven, ${entry.title}: VERIFIED. Every error-level check passed (${checks.length} checks run, ${warned.length} warning(s)).`);
    parts.push(result.summary);
    if (warned.length > 0) parts.push(["Warnings (they do not stop the result; read each):", ...warned.map(checkLine)].join("\n"));
    for (const t of result.tables) parts.push(markdownTable(t));
    if (savedTo) parts.push(`Saved: ${savedTo}`);
    parts.push(["Reconciliation certificate", "```", certificate, "```"].join("\n"));
  } else {
    if (comparisonOnly) {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. ${failed.length} of ${checks.length} checks failed: the input does not agree with the figure(s) given. A result whose checks fail is never presented as correct; the input's own figures follow the failed checks, to find the difference.`);
    } else if (failed.length > 0) {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. ${failed.length} of ${checks.length} checks failed, so no figures are given: a result whose checks fail is never presented as correct.`);
    } else {
      parts.push(`Mathproven, ${entry.title}: NOT VERIFIED. No error-level check was run on this result, so no figures are given: nothing unchecked is presented as correct.`);
    }
    parts.push(["Failed checks:", ...failed.map(checkLine)].join("\n"));
    if (warned.length > 0) parts.push(["Warnings:", ...warned.map(checkLine)].join("\n"));
    if (comparisonOnly) {
      parts.push("Every check of the arithmetic itself passed; only the comparison with the figures given failed. The figures below are what the input itself holds, to find the difference. They are NOT a verified result.");
      parts.push(result.summary);
      for (const t of result.tables) parts.push(markdownTable(t));
    } else {
      parts.push("Fix what the failed checks name in the input (a row that could not be read, a total that does not add up) and run it again.");
    }
  }
  if (columnsRead.length > 0) parts.push(['Columns read (name a column with "columns" if one is wrong):', ...columnsRead.map((l) => `- ${l}`)].join("\n"));
  parts.push(footer);
  return { verified, text: parts.join("\n\n"), structured };
}

// packages/agents/src/values.ts
var AgentInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentInputError";
  }
};
function asText(value, input) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new AgentInputError(`"${input.name}" (${input.label}) must be given as text.`);
}
function amountCents(raw, what) {
  try {
    return parseAmount(raw);
  } catch (err2) {
    const why = err2 instanceof Error ? err2.message : "not an amount";
    throw new AgentInputError(`${what} "${raw}" is not an amount in dollars and cents (${why}).`);
  }
}
function amountList(value, input) {
  if (Array.isArray(value)) return value.map((v) => asText(v, input));
  const text2 = asText(value, input);
  if (text2.startsWith("[")) {
    try {
      const parsed = JSON.parse(text2);
      if (Array.isArray(parsed)) return parsed.map((v) => asText(v, input));
    } catch {
    }
  }
  return text2.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
}
function checkValue(input, value) {
  const what = `"${input.name}" (${input.label})`;
  switch (input.kind) {
    case "text": {
      const t = asText(value, input);
      if (t.length > 2e4) throw new AgentInputError(`${what} is longer than 20,000 characters.`);
      return t;
    }
    case "amount":
      return amountCents(asText(value, input), what);
    case "amounts": {
      const items = amountList(value, input);
      if (items.length === 0) throw new AgentInputError(`${what} has no amounts in it.`);
      if (items.length > 1e5) throw new AgentInputError(`${what} has more than 100,000 amounts.`);
      return items.map((raw, i) => amountCents(raw, `Item ${i + 1} of ${what}`));
    }
    case "date": {
      const t = asText(value, input);
      try {
        parseCivilDate(t, input.label.toLowerCase());
      } catch (err2) {
        throw new AgentInputError(`${what} must be a real day written YYYY-MM-DD (${err2 instanceof Error ? err2.message : "not a date"}).`);
      }
      return t;
    }
    case "year": {
      const t = asText(value, input);
      if (!/^\d{4}$/.test(t)) throw new AgentInputError(`${what} must be a year written as four digits.`);
      const y = Number(t);
      if (y < 1900 || y > 2200) throw new AgentInputError(`${what} must be a year from 1900 to 2200.`);
      return y;
    }
    case "number": {
      const t = asText(value, input);
      if (!/^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/.test(t) || !/\d/.test(t)) throw new AgentInputError(`${what} must be a number, such as 1250 or 12.5.`);
      return t.replace(/,/g, "");
    }
    case "choice": {
      const t = asText(value, input);
      const choices = input.choices ?? [];
      const hit = choices.find((c) => c.toLowerCase() === t.toLowerCase());
      if (hit === void 0) throw new AgentInputError(`${what} must be one of: ${choices.join(", ")}.`);
      return hit;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const t = asText(value, input).toLowerCase();
      if (t === "true" || t === "yes") return true;
      if (t === "false" || t === "no") return false;
      throw new AgentInputError(`${what} must be true or false.`);
    }
    case "file":
    case "files":
      throw new AgentInputError(`${what} is a file and is read by the runner.`);
  }
}

// packages/agents/src/sheets.ts
function columnsInput(fileLabel, c, name = "columns") {
  const needed = c.required.map((r) => c.labels[r]);
  const optional = c.roles.filter((r) => !c.required.includes(r)).map((r) => c.labels[r]);
  return {
    name,
    kind: "text",
    label: `Columns of the ${fileLabel.toLowerCase()}`,
    description: `Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "${needed[0] ?? "Amount"} = ${needed[0] ?? "Amount"} received"; "<column> = none" leaves an optional column out. The answer lists the columns it read.${needed.length ? ` Needed: ${needed.join(", ")}.` : ""}${optional.length ? ` Used when present: ${optional.join(", ")}.` : ""}`,
    required: false
  };
}
var columnLog = null;
function beginColumnLog() {
  columnLog = [];
}
function takeColumnLog() {
  const out = columnLog ?? [];
  columnLog = null;
  return out;
}
function logColumns(fileLabel, file, c, mapping) {
  if (!columnLog) return;
  const header = file.rows[mapping.headerRow] ?? [];
  const used = c.roles.filter((r) => mapping.columns[r] >= 0).map((r) => `${c.labels[r]} = "${(header[mapping.columns[r]] ?? "").trim() || `column ${mapping.columns[r] + 1}`}"`);
  const unused = c.roles.filter((r) => mapping.columns[r] < 0).map((r) => c.labels[r]);
  columnLog.push(`${fileLabel} (${file.name}, header on row ${mapping.headerRow + 1}): ${used.join("; ") || "none"}${unused.length ? `. Not in the file: ${unused.join(", ")}` : ""}.`);
}
function labelKey(text2) {
  return sheetNormalizeHeader(text2.replace(/\([^)]*\)/g, " "));
}
function headerIndex(header, text2) {
  const want = sheetNormalizeHeader(text2);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want);
  if (exact >= 0) return exact;
  const letter = /^[A-Za-z]{1,2}$/.test(text2.trim()) ? text2.trim().toUpperCase() : "";
  if (letter) {
    let n = 0;
    for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n - 1 < header.length) return n - 1;
  }
  return -1;
}
var NONE = /* @__PURE__ */ new Set(["none", "not in this file", "not in the file", "no column", "-"]);
function parseOverride(override, c) {
  const out = [];
  for (const part of override.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"columns" must be written as "<column> = <header in the file>": "${part.trim()}".`);
    const roleText = labelKey(part.slice(0, eq));
    const headerText = part.slice(eq + 1).trim();
    const exact = c.roles.find((r) => labelKey(c.labels[r]) === roleText || sheetNormalizeHeader(r) === roleText || sheetNormalizeHeader(c.labels[r]) === roleText);
    const starts = roleText === "" ? [] : c.roles.filter((r) => `${labelKey(c.labels[r])} `.startsWith(`${roleText} `));
    const role = exact ?? (starts.length === 1 ? starts[0] : void 0);
    if (role === void 0) throw new AgentInputError(`"${part.slice(0, eq).trim()}" is not one of this file's columns. They are: ${c.roles.map((r) => c.labels[r]).join(", ")}.`);
    const none = headerText === "" || NONE.has(headerText.toLowerCase());
    if (none && c.required.includes(role)) throw new AgentInputError(`${c.labels[role]} is needed, so it cannot be left out; name its header.`);
    out.push({ role, header: none ? null : headerText, text: part.trim() });
  }
  return out;
}
function rowHolding(rows, headers) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) if (headers.every((h) => headerIndex(rows[i] ?? [], h) >= 0)) return i;
  return -1;
}
function mapColumns(file, c, override, fileLabel) {
  let mapping = c.guess(file.rows);
  const named = override && override.trim() !== "" ? parseOverride(override, c) : [];
  const headersNamed = named.filter((n) => n.header !== null && !/^[A-Za-z]{1,2}$/.test(n.header)).map((n) => n.header);
  if (headersNamed.length > 0 && !headersNamed.every((h) => headerIndex(file.rows[mapping.headerRow] ?? [], h) >= 0)) {
    const row = rowHolding(file.rows, headersNamed);
    if (row >= 0 && row !== mapping.headerRow) {
      const again = c.guess(file.rows, row);
      mapping = again.headerRow === row ? again : { headerRow: row, columns: Object.fromEntries(c.roles.map((r) => [r, -1])) };
    }
  }
  const header = file.rows[mapping.headerRow] ?? [];
  const columns = { ...mapping.columns };
  for (const n of named) {
    if (n.header === null) {
      columns[n.role] = -1;
      continue;
    }
    const col = headerIndex(header, n.header);
    if (col < 0) throw new AgentInputError(`The ${fileLabel.toLowerCase()} has no header "${n.header}". Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}.`);
    columns[n.role] = col;
  }
  const missing = c.required.filter((r) => columns[r] < 0);
  if (missing.length > 0) {
    throw new AgentInputError(
      `The ${fileLabel.toLowerCase()} (${file.name}) has no column for: ${missing.map((r) => c.labels[r]).join(", ")}. Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}. Name the column with "columns", for example "${c.labels[missing[0]]} = <header>".`
    );
  }
  const result = { ...mapping, headerRow: mapping.headerRow, columns };
  logColumns(fileLabel, file, c, result);
  return result;
}
function oneFile(files, name) {
  const f = files[name]?.[0];
  if (!f) throw new AgentInputError(`"${name}" is needed.`);
  return f;
}
function preferSheet(file, prefer) {
  const sheet = file.sheets.find((s) => prefer.test(s.name) && s.rows.some((r) => r.some((cell) => cell.trim() !== "")));
  return sheet ? { ...file, rows: sheet.rows } : file;
}

// packages/agents/src/registry/ecommerce.ts
var usd3 = formatUSD;
var LEDGER_SHEET = /^ledger$/i;
var LEDGER_COLUMNS = { roles: EC_LEDGER_ROLES, labels: EC_LEDGER_LABELS, required: ["date", "type", "amount"], guess: (rows, at) => ecGuessLedgerColumns(rows, at) };
var CATEGORY_WORDS = {
  sale: ["sale", "sales"],
  shipping: ["shipping"],
  tax: ["tax", "taxes"],
  fee: ["fee", "fees"],
  refund: ["refund", "refunds"],
  adjustment: ["adjustment", "adjustments"],
  payout: ["payout", "payouts", "deposit", "deposits"]
};
var CATEGORY_CHOICES = "sales, shipping, tax, fees, refunds, adjustments, payouts";
function categoryOf(text2) {
  const t = sheetNormalizeHeader(text2);
  return EC_CATEGORIES.find((c) => CATEGORY_WORDS[c].includes(t) || sheetNormalizeHeader(EC_CATEGORY_LABELS[c]) === t);
}
function rowTypesIn(rows, mapping) {
  const seen = /* @__PURE__ */ new Map();
  if (mapping.columns.type < 0) return seen;
  for (const row of rows.slice(mapping.headerRow + 1)) {
    const text2 = (row[mapping.columns.type] ?? "").trim();
    if (text2 && !seen.has(ecNormalizeType(text2))) seen.set(ecNormalizeType(text2), text2);
  }
  return seen;
}
function ledgerInputs(fileLabel) {
  return [
    columnsInput(fileLabel, LEDGER_COLUMNS),
    {
      name: "rowTypes",
      kind: "text",
      label: "What each row type counts as",
      description: `Optional. Each row type in the file starts with a guess from its words, and a type with none of the words it knows is counted as an adjustment, so no row is left out; the result lists what each type was taken for. To change one, write "<row type> = <what it counts as>", separated by commas, for example "Marketing = fees, Credit = adjustments". What it counts as is one of: ${CATEGORY_CHOICES}.`,
      required: false
    },
    { name: "dateOrder", kind: "choice", label: "Dates like 03/04/2026", choices: ["month first", "day first"], description: 'Optional. How a date written with numbers only, such as 03/04/2026, is read: "month first" (March 4, the default) or "day first" (3 April).', required: false },
    {
      name: "feesArePositive",
      kind: "boolean",
      label: "Fees written as positive numbers",
      description: "Optional. true when the fees column writes fees as positive numbers to subtract; false when they are negative numbers, added as written. Without it, they are taken as positive numbers to subtract only when the column holds no negative number.",
      required: false
    },
    {
      name: "payoutsArePositive",
      kind: "boolean",
      label: "Payouts written as positive numbers",
      description: 'Optional. true when payout rows write the money sent to the bank as a positive number; false when it is a negative number, or only in the description ("$84.07 sent to your bank account"). Without it, positive only when no payout row holds a negative amount.',
      required: false
    }
  ];
}
function ledgerMapping(file, values, fileLabel) {
  const mapped = mapColumns(file, LEDGER_COLUMNS, values.columns, fileLabel);
  const guess = ecGuessLedgerColumns(file.rows, mapped.headerRow);
  const mapping = { ...guess, headerRow: mapped.headerRow, columns: mapped.columns, categories: { ...guess.categories } };
  if (values.dateOrder !== void 0) mapping.dateOrder = values.dateOrder === "day first" ? "dmy" : "mdy";
  if (typeof values.feesArePositive === "boolean") mapping.feesAreSubtracted = values.feesArePositive;
  if (typeof values.payoutsArePositive === "boolean") mapping.payoutsArePositive = values.payoutsArePositive;
  const typed = values.rowTypes;
  if (typed !== void 0 && typed.trim() !== "") {
    const found = rowTypesIn(file.rows, mapping);
    for (const part of typed.split(/[,;\n]/)) {
      if (part.trim() === "") continue;
      const eq = part.lastIndexOf("=");
      if (eq < 0) throw new AgentInputError(`"rowTypes" must be written as "<row type> = <what it counts as>": "${part.trim()}".`);
      const typeText = part.slice(0, eq).trim();
      const category = categoryOf(part.slice(eq + 1));
      if (category === void 0) throw new AgentInputError(`"${part.slice(eq + 1).trim()}" is not something a row type can count as. It is one of: ${CATEGORY_CHOICES}.`);
      const key = ecNormalizeType(typeText);
      if (!found.has(key)) throw new AgentInputError(`The ${fileLabel.toLowerCase()} has no row type "${typeText}". Its row types are: ${[...found.values()].join(", ") || "(none found)"}.`);
      mapping.categories[key] = category;
    }
  }
  return mapping;
}
function ledgerChoices(rows, mapping) {
  const types = [...rowTypesIn(rows, mapping).entries()].slice(0, 60).map(([key, text2]) => `"${text2}" as ${EC_CATEGORY_LABELS[mapping.categories[key] ?? ecGuessCategory(text2)].toLowerCase()}`);
  const fees = mapping.columns.fees < 0 ? "No fees column was found." : mapping.feesAreSubtracted ? "The fees column was read as positive numbers to subtract." : "The fees column was read as written (fees are negative numbers).";
  const payouts = mapping.payoutsArePositive ? "Payout rows were read with the money sent to the bank as a positive number." : "Payout rows were read with the money sent to the bank as a negative number, or from the amount in the description.";
  return `Row types counted: ${types.join(", ") || "none"}. ${fees} ${payouts}`;
}
var monthlyBooks = {
  name: "marketplace_payments_to_monthly_books",
  page: "ecommerce/payment-csv-to-monthly-books",
  section: "ecommerce",
  kind: "tool",
  title: "Monthly books from a marketplace payment or ledger export",
  description: "Summarizes a seller's payment account or ledger export from a marketplace such as Etsy or Shopify (.csv or .xlsx, one row per sale, fee, refund or payout) by month: sales, shipping, tax collected, fees, refunds, adjustments, net activity, payouts and the change in the balance the marketplace holds, with fees by fee type and a journal entry for each month. Checks that each month's parts re-add to its net activity, that the type totals re-add to every row, that each journal entry balances, that amount plus fees equals net on every row when the file has a net column, and, with both balances given, that opening balance plus every row equals the closing balance; a row that cannot be read is listed. Use it when someone wants monthly figures or journal entries from their shop's payment or ledger download. Not for matching one payout to a bank deposit, and not for a file with no row type column. Mathproven is not affiliated with Etsy, Shopify or any other marketplace.",
  question: "Here is my shop's payment account export for March and April. Can you total it by month and give me a journal entry for each month?",
  inputs: [
    {
      name: "ledger",
      kind: "file",
      label: "Payment or ledger export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per sale, shipping charge, tax line, fee, refund, adjustment or payout: date, row type and amount are needed; a title or description, a fees column and a net column are used when present. In a workbook with a sheet named Ledger, that sheet is read.",
      required: true
    },
    { name: "openingBalance", kind: "amount", label: "Opening balance", description: "Optional. The balance held by the marketplace before the first row. With the closing balance too, opening balance plus every row is checked against it.", required: false },
    { name: "closingBalance", kind: "amount", label: "Closing balance", description: "Optional. The balance held by the marketplace after the last row. With the opening balance too, opening balance plus every row is checked against it.", required: false },
    ...ledgerInputs("Payment or ledger export")
  ],
  limits: "site",
  // The typed closing balance against opening balance plus every row: the page still shows the months beside it.
  comparisonChecks: ["balance"],
  notAdvice: "Mathproven totals the export's rows by month and type and shows how each month's figures balance; the account names are starting labels, and it does not say how anything belongs in anyone's books.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "ledger"), LEDGER_SHEET);
    const mapping = ledgerMapping(file, values, "Payment or ledger export");
    const read = ecReadLedgerRows(file.rows, mapping);
    const opening = values.openingBalance;
    const closing = values.closingBalance;
    const books = ecMonthlyBooks({ lines: read.lines, problems: read.problems, ...opening !== void 0 ? { openingBalance: opening } : {}, ...closing !== void 0 ? { closingBalance: closing } : {} });
    const t = ecBooksTables(books);
    const months = books.months.map((m) => {
      const debits = m.journal.reduce((a, j) => a + j.debit, 0);
      const credits = m.journal.reduce((a, j) => a + j.credit, 0);
      return `${m.month}: sales ${usd3(m.sales)}, shipping ${usd3(m.shipping)}, tax collected ${usd3(m.tax)}, fees ${usd3(m.fees)}, refunds ${usd3(m.refunds)}, adjustments ${usd3(m.adjustments)}, net activity ${usd3(m.netActivity)}; payouts ${usd3(m.payouts)}; change in balance ${usd3(m.balanceChange)}; journal entry debits ${usd3(debits)} and credits ${usd3(credits)}.`;
    });
    const ignored = read.ignoredRows ? ` ${read.ignoredRows} row(s) with no date, no type and no amounts were left out (titles or notes).` : "";
    return {
      summary: `${read.lines.length} row(s) read across ${books.months.length} month(s). ${months.join(" ")} All months: net activity ${usd3(books.totals.netActivity)}, payouts ${usd3(books.totals.payouts)}, change in balance ${usd3(books.totals.balanceChange)}. ${ledgerChoices(file.rows, mapping)}${ignored}`,
      tables: [
        { name: "By month", rows: t.summary },
        { name: "Fees by type", rows: t.fees },
        { name: "Journal", rows: t.journal }
      ],
      checks: books.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: 14 rows for March and April 2026, fees as negative numbers, deposits in the title",
      args: { ledger: "fixture:ecommerce/seller-ledger.csv" },
      verified: true,
      contains: [
        "2026-03: sales $100.00, shipping $5.00, tax collected $3.20, fees $11.78, refunds $10.00, adjustments $0.65, net activity $87.07; payouts $84.07; change in balance $3.00; journal entry debits $108.85 and credits $108.85.",
        "2026-04: sales $25.00, shipping $0.00, tax collected $0.00, fees $2.63, refunds $0.00, adjustments $0.00, net activity $22.37; payouts $25.37; change in balance -$3.00; journal entry debits $28.00 and credits $28.00.",
        "All months: net activity $109.44, payouts $109.44, change in balance $0.00.",
        "| 2026-03 | Fees on Sale rows | 3.00 |",
        "| 2026-03 | Listing ads | 4.10 |",
        "| 2026-03 | Processing fee | 1.75 |",
        "| 2026-03 | Transaction fee | 2.93 |",
        "| 2026-04 | Processing fee | 1.00 |",
        "| 2026-04 | Transaction fee | 1.63 |"
      ]
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { ledger: "Date,Type,Title,Amount,Fees,Net\n2026-03-02,Sale,Order 1,40.00,,40.00\n2026-03-03,Sale,Order 2,4O.00,,40.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function typedComponents(text2) {
  const items = [];
  const t = text2.trim();
  if (t.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      throw new AgentInputError('"components" starts with "[" but is not a JSON list.');
    }
    if (!Array.isArray(parsed)) throw new AgentInputError('"components" must be a JSON list of {"label", "account", "amount"}.');
    parsed.forEach((x, i) => {
      if (typeof x !== "object" || x === null) throw new AgentInputError(`Component ${i + 1} of "components" must be {"label", "account", "amount"}.`);
      const o = x;
      const text3 = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
      items.push({ label: text3(o.label), account: text3(o.account), amount: text3(o.amount) });
    });
  } else {
    for (const line of t.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const parts = line.split(/[|\t;]/).map((p) => p.trim());
      if (parts.length === 3) items.push({ label: parts[0], account: parts[1], amount: parts[2] });
      else throw new AgentInputError(`Each line of "components" is "<component> | <account> | <amount>": "${line.trim()}".`);
    }
  }
  if (items.length === 0) throw new AgentInputError('"components" has no components in it.');
  return items.map((x, i) => {
    const label = x.label.trim() || "Component";
    let amount2;
    try {
      amount2 = parseAmount(x.amount);
    } catch {
      throw new AgentInputError(`The amount for "${x.label.trim() || `component ${i + 1}`}" is not a valid amount.`);
    }
    return { label, account: x.account, amount: amount2 };
  });
}
function withAccounts(components, text2) {
  const out = components.map((c) => ({ ...c }));
  if (text2 === void 0 || text2.trim() === "") return out;
  for (const part of text2.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"accounts" must be written as "<component> = <account>": "${part.trim()}".`);
    const want = sheetNormalizeHeader(part.slice(0, eq));
    const account = part.slice(eq + 1).trim();
    if (account === "") throw new AgentInputError(`"accounts" names no account for "${part.slice(0, eq).trim()}".`);
    const hits = out.filter((c) => sheetNormalizeHeader(c.label) === want);
    if (hits.length === 0) throw new AgentInputError(`The payout has no component "${part.slice(0, eq).trim()}". Its components are: ${out.map((c) => c.label).join(", ")}.`);
    for (const c of hits) c.account = account;
  }
  return out;
}
var payoutJournal = {
  name: "marketplace_payout_journal_entry",
  page: "ecommerce/payout-journal-entry",
  section: "ecommerce",
  kind: "tool",
  title: "Journal entry for one marketplace payout, matched to the bank deposit",
  description: "Builds one balanced journal entry for a single marketplace payout, from the rows that make up the payout (a .csv or .xlsx export from a marketplace such as Shopify or Etsy) or from components typed by hand: sales, shipping, tax collected, each fee type, refunds and adjustments, each posted to an account name. Checks that the components add up to the payout the marketplace reports, that the payout equals the bank deposit to the cent (a warning when no deposit is given), that debits equal credits, and that the journal lines re-add to the components a second way. Use it when someone needs to record a payout from their shop in their books, or to see why a payout differs from what reached the bank. Not for a month or a year of activity, and not for deciding which accounts to use. Mathproven is not affiliated with Shopify, Etsy or any other marketplace.",
  question: "Can you turn this payout's rows into a journal entry and check it against the deposit in my bank?",
  inputs: [
    {
      name: "payoutRows",
      kind: "file",
      label: "Payout rows",
      description: "Optional when the components are typed. A .csv or .xlsx file (a path, or the CSV text) with the rows of one payout: date, row type and amount are needed; a description, a fees column and a net column are used when present. The rows become one component per kind (and per fee type), and the payout row itself gives the payout amount and date. In a workbook with a sheet named Ledger, that sheet is read.",
      required: false
    },
    {
      name: "components",
      kind: "text",
      label: "Components typed by hand",
      description: 'Optional, instead of the payout rows. One component per line as "<component> | <account> | <amount>", every component with an amount naming its account: positive for what adds to the payout, negative for what takes away from it, for example "Sales | Sales | 165.50". A JSON list of {"label", "account", "amount"} also works.',
      required: false
    },
    {
      name: "accounts",
      kind: "text",
      label: "Account for each component",
      description: 'Optional. The account name used in your own books for a component, as "<component> = <account>", separated by commas, for example "Sales = Product sales, Fees on Sale rows = Selling fees". Components from the rows start with plain starting account names (Sales, Shipping income, Sales tax collected, Marketplace fees, Refunds, Marketplace adjustments), which the result lists.',
      required: false
    },
    { name: "payoutAmount", kind: "amount", label: "Payout amount", description: "The payout amount the marketplace reports (money sent to the bank, positive). Without it, the payout rows in the file give it; needed when they do not.", required: false },
    { name: "bankDeposit", kind: "amount", label: "Bank deposit", description: "Optional. The deposit as the bank statement shows it. Without it the entry is still built, with a warning that the payout was not matched to the bank.", required: false },
    { name: "bankAccount", kind: "text", label: "Bank account name", description: 'Optional. The account the deposit is posted to, as your own books name it. Without it, "Bank account".', required: false },
    { name: "payoutDate", kind: "date", label: "Payout date", description: "Optional. The payout date, YYYY-MM-DD. Without it, the date of the payout row when the file has exactly one.", required: false },
    ...ledgerInputs("Payout rows")
  ],
  limits: "site",
  // The typed bank deposit against the payout: the page still shows the entry beside it.
  comparisonChecks: ["deposit-match"],
  notAdvice: "Mathproven adds up the payout's components, posts each to the account named for it and checks the arithmetic; it does not say which account is right for sales tax, fees or refunds.",
  run({ files, values }) {
    const opened = files.payoutRows?.[0];
    const typed = values.components;
    if (opened && typed !== void 0) throw new AgentInputError('Give the rows of the payout ("payoutRows") or its components typed by hand ("components"), not both.');
    if (!opened && typed === void 0) throw new AgentInputError('Give the rows that make up the payout ("payoutRows"), or its components typed one per line ("components").');
    let components;
    let filePayout;
    let fileDate;
    let from = "";
    if (opened) {
      const file = preferSheet(opened, LEDGER_SHEET);
      const mapping = ledgerMapping(file, values, "Payout rows");
      const read = ecReadLedgerRows(file.rows, mapping);
      if (read.problems.length > 0) {
        const first = read.problems[0];
        throw new Error(`${read.problems.length} row(s) could not be read, so the components were not filled in. First: row ${first.rowNumber}: ${first.reason}.`);
      }
      const found = ecPayoutComponents(read.lines);
      if (found.components.length === 0) throw new Error('No rows other than payout rows were found. Check what each row type counts as ("rowTypes").');
      components = found.components;
      filePayout = found.payoutAmount;
      const dates = read.lines.filter((l) => l.category === "payout").map((l) => l.date);
      if (dates.length === 1) fileDate = dates[0];
      const ignored = read.ignoredRows ? ` ${read.ignoredRows} row(s) with no date, no type and no amounts were left out.` : "";
      from = ` Components from ${read.lines.length} row(s) of ${file.name}${filePayout !== void 0 ? `, whose payout row(s) total ${usd3(filePayout)}` : ", which has no payout row"}. ${ledgerChoices(file.rows, mapping)}${ignored}`;
    } else {
      components = typedComponents(typed);
    }
    components = withAccounts(components, values.accounts);
    const typedPayout = values.payoutAmount;
    const payoutAmount = typedPayout ?? filePayout;
    if (payoutAmount === void 0) throw new AgentInputError('Enter the payout amount the marketplace reports ("payoutAmount").');
    const bankDeposit = values.bankDeposit;
    const r = ecPayoutJournal({
      components,
      payoutAmount,
      ...bankDeposit !== void 0 ? { bankDeposit } : {},
      bankAccount: values.bankAccount || "Bank account",
      payoutDate: values.payoutDate ?? fileDate ?? ""
    });
    const parts = components.map((c) => `${c.label} (${c.account}) ${usd3(c.amount)}`).join(", ");
    return {
      summary: `Payout of ${usd3(r.payoutAmount)}${r.payoutDate ? ` on ${r.payoutDate}` : ""}${typedPayout !== void 0 && filePayout !== void 0 ? " (as typed)" : ""}. ${components.length} component(s): ${parts}; they add up to ${usd3(r.componentsTotal)}, and the payout not explained by the components is ${usd3(r.difference)}. Bank deposit: ${r.bankDeposit === void 0 ? "not given, so the payout was not matched to the bank" : usd3(r.bankDeposit)}. Journal entry: debits ${usd3(r.debits)}, credits ${usd3(r.credits)}.${from}`,
      tables: [{ name: "Journal entry", rows: ecPayoutTable(r) }],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: a $136.00 payout of June 5, 2026 from six rows, matched to a $136.00 deposit",
      args: { payoutRows: "fixture:ecommerce/payout-rows.csv", bankDeposit: "136.00", bankAccount: "Checking" },
      verified: true,
      contains: ["$136.00", "2026-06-05", "| Payout | Checking | 136.00 |", "165.50", "6.00", "3.61", "| Fees on Refund rows | Marketplace fees |  | 1.95 |", "| Fees on Sale rows | Marketplace fees | 11.06 |  |", "| Refunds | Refunds | 30.00 |  |", "| Total |  | 177.06 | 177.06 |"]
    },
    {
      label: "A bank deposit that differs from the payout is not verified",
      args: { payoutRows: "fixture:ecommerce/payout-rows.csv", bankDeposit: "130.00", bankAccount: "Checking" },
      verified: false,
      failedCheck: "deposit-match"
    }
  ]
};
var ORDER_COLUMNS = { roles: EC_ORDER_ROLES, labels: EC_ORDER_LABELS, required: ["orderId", "state", "tax"], guess: (rows, at) => ecGuessOrderColumns(rows, at) };
var salesTaxByState = {
  name: "sales_tax_collected_by_state",
  page: "ecommerce/sales-tax-by-state",
  section: "ecommerce",
  kind: "tool",
  title: "Sales tax collected by ship-to state from an order export",
  description: "Totals an order export (.csv or .xlsx, from a store or marketplace such as Shopify) by ship-to state: orders, taxable amount and tax collected for each state, with the rows of one order added together so each order is counted once. Orders with no state, with text that is not a US state or territory, or with rows naming different states are listed separately, never dropped. Checks that every order is counted exactly once, that each order sits under exactly one state or in the separate list, and that the states plus the separate list equal the file's totals, by count and to the cent, added a second way; a row that cannot be read is listed. Use it when someone wants the sales tax collected in each state, or orders per state, from their store's order download. Not for tax rates, economic nexus thresholds, filing rules or what is owed anywhere: it reports only what the export says was collected. Mathproven is not affiliated with Shopify or any other marketplace.",
  question: "How much sales tax did my shop collect in each state? Here is my order export.",
  inputs: [
    {
      name: "orders",
      kind: "file",
      label: "Order export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per order or per item: order id, ship-to state (two-letter code or full name) and tax collected are needed; a taxable amount column is used when present. Rows with the same order id are one order. In a workbook with a sheet named Orders, that sheet is read.",
      required: true
    },
    columnsInput("Order export", ORDER_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven shows what the export says was collected; it holds no tax rates, thresholds or filing rules, and it does not say what is owed or due anywhere.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "orders"), EC_TEMPLATE_ORDERS_SHEET);
    const mapping = mapColumns(file, ORDER_COLUMNS, values.columns, "Order export");
    const read = ecReadOrderRows(file.rows, mapping);
    const s = ecSalesTaxSummary({ rows: read.rows, problems: read.problems });
    const t = ecSalesTaxTables(s);
    const states = s.states.map((x) => `${x.name}: ${x.orders} order(s), ${usd3(x.taxable)} taxable, ${usd3(x.tax)} tax collected`).join("; ");
    const notes = [
      mapping.columns.taxable < 0 ? "No taxable amount column was found, so taxable amounts show as zero." : "",
      read.ignoredRows ? `${read.ignoredRows} row(s) with no order id and no amounts were left out (titles or notes).` : "",
      s.repeatedOrderIds.length ? `${s.repeatedOrderIds.length} order id(s) appear on more than one row; their rows were added together and each order is counted once.` : ""
    ].filter(Boolean);
    return {
      summary: `${s.orders.length} order(s) on ${read.rows.length} row(s). ${states || "No order has a recognizable state"}. The ${s.states.length} state(s) total ${s.statesTotal.orders} order(s), ${usd3(s.statesTotal.taxable)} taxable and ${usd3(s.statesTotal.tax)} tax collected. Listed separately (missing or unknown state): ${s.unknown.length} order(s)${s.unknown.length ? ` (${s.unknown.map((o) => o.orderId).join(", ")})` : ""}, ${usd3(s.unknownTotal.taxable)} taxable, ${usd3(s.unknownTotal.tax)} tax collected. Grand total: ${s.grandTotal.orders} order(s), ${usd3(s.grandTotal.taxable)} taxable, ${usd3(s.grandTotal.tax)} tax collected.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      tables: [
        { name: "By state", rows: t.states },
        { name: "Missing or unknown state", rows: t.unknown }
      ],
      checks: s.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: eight rows, seven orders, one with no state and one shipped to ON",
      args: { orders: "fixture:ecommerce/orders.csv" },
      verified: true,
      contains: ["California: 2 order(s), $80.00 taxable, $6.61 tax collected", "New York: 1 order(s), $25.00 taxable, $2.22", "Texas: 2 order(s), $35.00 taxable, $2.89", "$140.00", "$11.72", "A-1004, A-1005", "$55.00", "Grand total: 7 order(s), $195.00 taxable, $11.72 tax collected"]
    },
    {
      label: "A row whose tax cannot be read is not verified",
      args: { orders: "Order ID,Ship State,Subtotal,Tax Collected\nA-1,CA,10.00,0.83\nA-2,TX,20.00,1.6S\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var PRODUCT_ROLES = [...EC_PRODUCT_SALES_ROLES, "unitPrice"];
var PRODUCT_COLUMNS = {
  roles: PRODUCT_ROLES,
  labels: { ...EC_PRODUCT_SALES_LABELS, unitPrice: "Unit price" },
  required: [],
  guess: (rows, at) => {
    const m = ecGuessProductSalesColumns(rows, at);
    return { headerRow: m.headerRow, columns: { ...m.columns, unitPrice: m.unitPrice ?? -1 } };
  }
};
var salesByProduct = {
  name: "sales_by_product_from_orders_export",
  page: "ecommerce/sales-by-product",
  section: "ecommerce",
  kind: "tool",
  title: "Sales by product from an orders export",
  description: "Groups an orders export with one row per item sold (.csv or .xlsx, from a store or marketplace such " +
    "as Shopify) by product, by SKU or else by item name: rows, orders, units, sales, reversals (negative " +
    "item totals), net and each product's share of net. Rows that name no product get their own line, and " +
    "the file's own total line is left out and counted. A date range and a total from the seller's own records " +
    "can be given. Checks that every row is under exactly one product, that each product's figures re-add " +
    "from its rows, that the products add up to the totals a second way, that each share multiplies back, " +
    "and that a typed total matches; a row that cannot be read is listed. Use it when someone asks how much " +
    "each product or SKU sold, in units or dollars, from their store's order download. Not for an export " +
    "with one row per order and no item columns, and not for saying which products to keep or what to charge. " +
    "Mathproven is not affiliated with Shopify or any other marketplace.",
  question: "Which products sold the most last month, in units and dollars? Here is my orders export.",
  inputs: [
    {
      name: "orders",
      kind: "file",
      label: "Orders export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per item sold: the item total and at least one of item name and SKU are needed; quantity, order id and order date are used when present (with no quantity every row is 1 unit). A unit price with a quantity stands in when there is no item total. In a workbook with a sheet named Orders, that sheet is read.",
      required: true
    },
    { name: "from", kind: "date", label: "First day", description: "Optional. Only rows with an order date on or after this day (YYYY-MM-DD) are used; the rest are listed as left out. Every row then needs an order date that can be read.", required: false },
    { name: "to", kind: "date", label: "Last day", description: "Optional. Only rows with an order date on or before this day (YYYY-MM-DD) are used; the rest are listed as left out. Every row then needs an order date that can be read.", required: false },
    { name: "typedTotal", kind: "amount", label: "Total net sales from your own records", description: "Optional. A total net sales figure from the seller's own records, compared with the total of the rows used.", required: false },
    { name: "dateOrder", kind: "choice", label: "Dates like 03/04/2026", choices: ["month first", "day first"], description: 'Optional, used only with a date range. How a date written with numbers only, such as 03/04/2026, is read: "month first" (March 4, the default) or "day first" (3 April).', required: false },
    {
      ...columnsInput("Orders export", PRODUCT_COLUMNS),
      description: 'Optional. Only when a column is not found from the header words: name it as "<column> = <header in the file>", separated by commas, for example "Item total = Line total". Needed: Item total (or Unit price with Quantity, when the file writes no total for each item), and at least one of Item name and SKU. Used when present: Quantity, Order id or number, Order date.'
    }
  ],
  limits: "site",
  // The total typed from the seller's own records against total net sales: the page still shows the products beside it.
  comparisonChecks: ["ec-ps-typed-total"],
  notAdvice: "Mathproven groups the rows of the export, adds them up and checks the arithmetic; it does not say what any figure means for a business.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "orders"), EC_TEMPLATE_ORDERS_SHEET);
    const mapped = mapColumns(file, PRODUCT_COLUMNS, values.columns, "Orders export");
    const { unitPrice, ...columns } = mapped.columns;
    const mapping = { headerRow: mapped.headerRow, columns, dateOrder: values.dateOrder === "day first" ? "dmy" : "mdy", ...unitPrice >= 0 ? { unitPrice } : {} };
    const from = values.from;
    const to = values.to;
    const typed = values.typedTotal;
    const ranged = from !== void 0 || to !== void 0;
    const read = ecReadProductSalesRows(file.rows, mapping, { datesNeeded: ranged });
    const input = { rows: read.rows, hasOrderIds: read.hasOrderIds, ...from !== void 0 ? { from } : {}, ...to !== void 0 ? { to } : {}, ...typed !== void 0 ? { typedTotalNet: typed } : {} };
    const result = ecProductSales(input);
    const skipped = [...read.skipped, ...result.outsideRange.map((rowNumber) => ({ rowNumber, reason: "dated outside the date range" }))].sort((a, b) => a.rowNumber - b.rowNumber);
    const checks = [...result.checks, ...ecVerifyProductSales(input, result), ...sheetRowChecks(read.problems, skipped)];
    const tables = ecProductSalesTables(read.rows, result);
    const t = result.total;
    const notes = [
      read.hasQuantity ? "" : "No quantity column was found, so every row counts as 1 unit.",
      read.fromUnitPrice ? "No item total column was found, so each item total is its unit price times its quantity, before anything taken off a whole order." : "",
      read.hasOrderIds ? "An order with items from two products is counted under each of them and once in the total, so the orders column does not add up to the total." : "No order id column was found, so orders are not counted and the orders column is blank.",
      ranged ? `Only rows dated ${from !== void 0 ? `from ${from}` : "up"} ${to !== void 0 ? `to ${to}` : "onward"} are used; ${result.outsideRange.length} row(s) dated outside the range were left out.` : "",
      t.net > 0 ? "Each share is rounded to a hundredth of a percent on its own, half away from zero, so the shares can add up to a little more or less than 100.00." : "Total net is zero or less, so no share of net is shown."
    ].filter(Boolean);
    return {
      summary: `${result.products.length} product(s) from ${t.rows} row(s) used: ${t.orders === null ? "orders not counted" : `${t.orders} order(s)`}, ${t.units} unit(s), sales ${usd3(t.sales)}, reversals ${usd3(t.reversals)}, net sales ${usd3(t.net)}. ${result.noProduct.rows} row(s) name no product (net ${usd3(result.noProduct.net)}). ${skipped.length} row(s) left out on purpose (the file's own total line, rows with nothing in the item total column, rows outside the date range). ${notes.join(" ")}`,
      tables: [
        { name: "By product", rows: tables.products },
        { name: "No product named", rows: tables.noProduct }
      ],
      checks
    };
  },
  examples: [
    {
      label: "The page's worked example: nine item rows and the file's own total line, September 2026",
      args: { orders: "fixture:ecommerce/product-sales-items.csv" },
      verified: true,
      contains: ["| BM-01 | Blue mug | 4 | 3 | 6 | 168.00 | -24.00 | 144.00 | 51.15 |", "| RB-02 | Red bowl | 2 | 2 | 3 | 97.50 | 0.00 | 97.50 | 34.64 |", "|  | Tea towel | 2 | 2 | 4 | 36.00 | 0.00 | 36.00 | 12.79 |", "|  | No product named | 1 | 1 | 1 | 4.00 | 0.00 | 4.00 | 1.42 |", "|  | Total | 9 | 7 | 14 | 305.50 | -24.00 | 281.50 |  |", "net sales $281.50"]
    },
    {
      label: "A row whose quantity is not a whole number is not verified",
      args: { orders: "Order,Item,SKU,Qty,Line total\nA-1,Blue mug,BM-01,2,48.00\nA-2,Red bowl,RB-02,two,32.50\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var TEMPLATE_ROWS = {
  Ledger: "One per money row of the payment account, under the header row",
  Orders: "One per item sold, under the header row",
  Log: "Shop name and year filled in",
  Instructions: "What each sheet and column holds"
};
var sellerTemplate = {
  name: "online_seller_bookkeeping_template",
  page: "ecommerce/seller-bookkeeping-template",
  section: "ecommerce",
  kind: "template",
  title: "Online seller bookkeeping workbook (Excel template)",
  description: "Builds a blank Excel bookkeeping workbook for an online shop: a Ledger sheet (Date, Type, Description, Amount, Fees, Net) for the payment account's money rows, an Orders sheet with one row per item sold (order id, date, item, SKU, quantity, item total, ship-to state, taxable amount, tax collected), a Log sheet with the shop name and year, and an Instructions sheet saying what each column holds. Values only, no formulas. Before it is saved, the workbook is read back and checked: its sheet names, header rows and row counts, the shop name and year, and that both sheets are found and read the way the section's monthly books and sales tax by state tools read them. Use it when someone asks for a spreadsheet template to keep their shop's sales, fees, payouts and orders in. Not for adding anything up: the workbook holds no formulas, tax rates or thresholds. Mathproven is not affiliated with any marketplace.",
  question: "Can you make me a bookkeeping spreadsheet for my online shop?",
  inputs: [
    { name: "shop", kind: "text", label: "Shop name", description: "Optional. The shop the workbook is kept for, written on its Log sheet and in the file name (120 characters or fewer).", required: false },
    { name: "year", kind: "year", label: "Year", description: "Optional. The calendar year the workbook covers, four digits from 2000 to 2099, written on its Log sheet and in the file name.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in, with values only and no formulas; it holds no tax rates, thresholds or filing dates, and it does not say what a seller has to record or keep.",
  run({ values }) {
    const options = { shop: values.shop ?? "", year: values.year === void 0 ? "" : String(values.year), siteUrl: SITE_URL };
    const sheets = ecSellerTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = ecVerifySellerTemplate(options, bytes);
    const slug = options.shop.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const suggestedName = `${["seller-books", slug, options.year.trim()].filter(Boolean).join("-")}.xlsx`;
    const rows = sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), TEMPLATE_ROWS[s.name] ?? String(s.rows.length - 1)]);
    const logged = (label) => String(sheets.find((s) => s.name === "Log")?.rows.find((r) => r[0] === label)?.[1] ?? "");
    const shop = logged("Kept for");
    const year = logged("Year");
    return {
      summary: `A seller bookkeeping workbook, ${suggestedName}, with ${sheets.length} sheets: ${sheets.map((s) => s.name).join(", ")}. The Log sheet carries ${shop ? shop : "no shop name"} and ${year ? year : "no year"}. The Ledger and Orders sheets each have a header row and nothing under it.`,
      tables: [{ name: "Sheets", rows: [["Sheet", "Columns", "Rows to fill in"], ...rows] }],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Larkspur Paper Goods, 2026",
      args: { shop: "Larkspur Paper Goods", year: "2026" },
      verified: true,
      contains: ["seller-books-larkspur-paper-goods-2026.xlsx", "| Ledger | Date, Type, Description, Amount, Fees, Net |", "| Orders | Order ID, Order date, Item, SKU, Quantity, Item total, Ship-to state, Taxable amount, Tax collected, Notes |", "| Log | Item, Value |", "| Instructions | Sheet, Column, What it holds |", "Larkspur Paper Goods and 2026"]
    }
  ]
};
function feeLines(text2) {
  if (text2 === void 0 || text2.trim() === "") return [];
  const items = [];
  const t = text2.trim();
  const asText2 = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  if (t.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      throw new AgentInputError('"fees" starts with "[" but is not a JSON list.');
    }
    if (!Array.isArray(parsed)) throw new AgentInputError('"fees" must be a JSON list of {"name", "percent", "fixed"}.');
    parsed.forEach((x, i) => {
      if (typeof x !== "object" || x === null) throw new AgentInputError(`Fee line ${i + 1} of "fees" must be {"name", "percent", "fixed"}.`);
      const o = x;
      items.push({ name: asText2(o.name), percent: asText2(o.percent), fixed: asText2(o.fixed) });
    });
  } else {
    for (const line of t.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const parts = line.split(/[|\t;]/).map((p) => p.trim());
      if (parts.length > 3) throw new AgentInputError(`Each line of "fees" is "<name> | <percent> | <fixed amount>", with either figure left blank: "${line.trim()}".`);
      items.push({ name: parts[0] ?? "", percent: parts[1] ?? "", fixed: parts[2] ?? "" });
    }
  }
  const out = [];
  for (const x of items) {
    const name = x.name.trim();
    const percent2 = x.percent.trim().replace(/%$/, "").trim();
    const fixed = x.fixed.trim();
    if (name === "" && percent2 === "" && fixed === "") continue;
    const what = name || "a fee line";
    let rateBp = 0;
    if (percent2 !== "") {
      try {
        rateBp = percentToBasisPoints(percent2);
      } catch {
        throw new AgentInputError(`The percent for "${what}" must be a number from 0 to 100 with up to two decimal places: "${x.percent.trim()}".`);
      }
      if (rateBp > 1e4) throw new AgentInputError(`The percent for "${what}" must be from 0 to 100: "${x.percent.trim()}".`);
    }
    let fixedCents = 0;
    if (fixed !== "") {
      try {
        fixedCents = parseAmount(fixed);
      } catch {
        throw new AgentInputError(`The fixed amount for "${what}" is not an amount in dollars and cents: "${fixed}".`);
      }
    }
    out.push({ name, rateBp, fixed: fixedCents });
  }
  return out;
}
var profitCalc = {
  name: "online_seller_profit_calculator",
  page: "ecommerce/seller-profit-calculator",
  section: "ecommerce",
  kind: "tool",
  title: "Profit, margin and break-even price on one item sold online",
  description: "Works out the profit on one item sold online at fee rates the person gives: each fee in dollars (a percent of the selling price plus shipping charged, a fixed amount per sale, or both), total fees, total costs, profit per sale, profit as a percent of the sale amount (margin) and of total costs, the break-even selling price, and totals for a number of units. It holds no fee rates of any marketplace or payment company. Checks each fee's rounding to the cent by multiplying back, re-adds every total a second way, and proves the break-even price by trying every lower price; costs above the sale amount are a warning. Use it when someone asks what they make on a sale after fees and costs, their margin on an item, or the lowest price that covers their costs. Not for looking up a marketplace's current fees, not for sales tax or income tax, and not for saying what price to charge. Mathproven is not affiliated with any marketplace or payment company.",
  question: "If I sell a candle for $28 plus $6.50 shipping, what is my profit after fees and costs, and what is my break-even price?",
  inputs: [
    { name: "price", kind: "amount", label: "Selling price", description: "The selling price of one item, in dollars.", required: true },
    { name: "shippingCharged", kind: "amount", label: "Shipping charged to the buyer", description: "Optional. Shipping charged to the buyer for the item. Blank counts as zero.", required: false },
    { name: "itemCost", kind: "amount", label: "Cost of the item", description: "Optional. What the item costs to buy or make. Blank counts as zero.", required: false },
    { name: "shippingCost", kind: "amount", label: "Cost to ship it", description: "Optional. What it costs the seller to ship the item. Blank counts as zero.", required: false },
    { name: "otherCost", kind: "amount", label: "Other cost per sale", description: "Optional. Any other cost per sale, such as packaging. Blank counts as zero.", required: false },
    { name: "advertising", kind: "amount", label: "Advertising cost per sale", description: "Optional. Advertising cost per sale, added to total costs.", required: false },
    {
      name: "fees",
      kind: "text",
      label: "Fee lines",
      description: 'Optional. One fee per line as "<name> | <percent> | <fixed amount per sale>", either figure left blank, at the rates the seller gives (none are built in), for example "Selling fee | 7.45 |" and "Listing fee | | 0.12". The percent is taken of the selling price plus shipping charged. A JSON list of {"name", "percent", "fixed"} also works. Up to 30 lines.',
      required: false
    },
    { name: "units", kind: "number", label: "Units sold", description: "Optional. A number of units sold, a whole number of 1 or more: the sale amount, fees, costs and profit for that many sales are added.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven multiplies, adds, subtracts and checks at the rates given; it holds no fee rates and does not say what price to charge.",
  run({ values }) {
    const amount2 = (name) => values[name] ?? 0;
    let units;
    const unitsText = values.units;
    if (unitsText !== void 0) {
      if (!/^\d{1,9}$/.test(unitsText) || Number(unitsText) < 1) throw new AgentInputError('"units" (Units sold) must be a whole number, 1 or more.');
      units = Number(unitsText);
    }
    const advertising = values.advertising;
    const input = {
      price: values.price,
      shippingCharged: amount2("shippingCharged"),
      itemCost: amount2("itemCost"),
      shippingCost: amount2("shippingCost"),
      otherCost: amount2("otherCost"),
      fees: feeLines(values.fees),
      ...advertising !== void 0 ? { advertising } : {},
      ...units !== void 0 ? { units } : {}
    };
    const r = ecProfitCalc(input);
    const t = ecProfitCalcTables(r);
    const u = r.unitTotals;
    const forUnits = r.units !== null && u !== null ? ` ${ecProfitUnitsHeader(r.units)}: sale amount ${usd3(u.saleAmount)}, total fees ${usd3(u.totalFees)}, total costs ${usd3(u.totalCosts)}, profit ${usd3(u.profit)}.` : "";
    const fees = r.fees.map((f) => `${f.name} ${usd3(f.fee)}`).join(", ");
    return {
      summary: `Sale amount ${usd3(r.saleAmount)} (selling price ${usd3(r.price)} plus shipping charged ${usd3(r.shippingCharged)}). Fees: ${fees || "none"}; total fees ${usd3(r.totalFees)}. Total costs ${usd3(r.totalCosts)}. Profit per sale ${usd3(r.profit)}, ${ecProfitPercentText(r.marginOnSaleBp) || "blank (the sale amount is zero)"} of the sale amount (margin) and ${ecProfitPercentText(r.marginOnCostsBp) || "blank (total costs are zero)"} of total costs. Break-even price: ${r.breakEvenPrice === null ? "not shown" : usd3(r.breakEvenPrice)}.${forUnits} ${ecProfitCalcNotes(r).join(" ")}`,
      tables: [
        { name: "Profit", rows: t.summary },
        { name: "Fees", rows: t.fees }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: a $28.00 candle with $6.50 shipping, three made-up fee lines, 40 units",
      args: {
        price: "28.00",
        shippingCharged: "6.50",
        itemCost: "9.40",
        shippingCost: "7.85",
        otherCost: "1.10",
        advertising: "1.25",
        fees: "Selling fee | 7.45 |\nPayment processing fee | 1.85 | 0.17\nListing fee | | 0.12",
        units: "40"
      },
      verified: true,
      contains: ["Sale amount $34.50", "Selling fee $2.57", "Payment processing fee $0.81", "Listing fee $0.12", "total fees $3.50", "Total costs $23.10", "Profit per sale $11.40", "33.04%", "49.35%", "Break-even price: $15.43", "sale amount $1,380.00, total fees $140.00, total costs $924.00, profit $456.00", "At $15.43 the profit per sale is $0.00"]
    }
  ]
};
var ECOMMERCE = [monthlyBooks, payoutJournal, salesTaxByState, salesByProduct, sellerTemplate, profitCalc];
var ECOMMERCE_NOT_FOR_AGENTS = [];

export {
  writeXlsx,
  readXlsx,
  AgentInputError,
  checkValue,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  ECOMMERCE,
  ECOMMERCE_NOT_FOR_AGENTS
};
