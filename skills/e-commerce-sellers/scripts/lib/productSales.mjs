// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AmountError,
  CheckList,
  decimalToCents,
  parseAmount,
  toDecimal
} from "./money.mjs";

// packages/core/src/sheetInput.ts
function sheetIsTotalWord(cell) {
  return /^(?:grand|statement|report|page|sub)?[\s-]*totals?\b/i.test(cell.trim());
}
function sheetRowList(rows) {
  const MAX_REASONS = 8;
  const MAX_ROWS = 20;
  const byReason = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = byReason.get(r.reason);
    if (list) list.push(r.rowNumber);
    else byReason.set(r.reason, [r.rowNumber]);
  }
  const parts = [];
  let shown = 0;
  for (const [reason, numbers] of byReason) {
    if (parts.length === MAX_REASONS) break;
    const first = numbers.slice(0, MAX_ROWS);
    parts.push(`${reason}: row(s) ${first.join(", ")}${numbers.length > first.length ? ` and ${numbers.length - first.length} more` : ""}`);
    shown += numbers.length;
  }
  if (shown < rows.length) parts.push(`and ${rows.length - shown} more row(s) for other reasons`);
  return parts.join("; ");
}
function sheetRowChecks(problems, leftOut) {
  return [
    {
      id: "rows-read",
      label: "Every row with data could be read",
      passed: problems.length === 0,
      severity: "error",
      ...problems.length ? { detail: `${problems.length} row(s) could not be read and are not in the result. ${sheetRowList(problems)}` } : {}
    },
    {
      id: "rows-left-out",
      label: "No row with data was left out of the result",
      passed: leftOut.length === 0,
      severity: "warning",
      ...leftOut.length ? { detail: `${leftOut.length} row(s) with data are not used. ${sheetRowList(leftOut)}` } : {}
    }
  ];
}
function sheetNormalizeHeader(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function sheetDataRows(rows, headerRow) {
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.some((c) => c.trim() !== "")) out.push({ rowNumber: i + 1, cells });
  }
  return out;
}
function sheetCell(cells, col) {
  return col >= 0 ? (cells[col] ?? "").trim() : "";
}
function scaledParse(raw, places, label = "number") {
  let s = raw.trim().replace(/−/g, "-");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const m = /^([+-])?((?:\d{1,3}(?:,\d{3})+|\d*))(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || !m[2] && !m[3]) throw new Error(`The ${label} "${raw}" is not a number.`);
  if (negative && m[1]) throw new Error(`The ${label} "${raw}" has conflicting signs.`);
  if (m[1] === "-") negative = !negative;
  const whole = (m[2] ?? "").replace(/,/g, "");
  const frac = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) throw new Error(`The ${label} "${raw}" is out of range.`);
  const digits = BigInt(whole + frac || "0");
  const scale = frac.length - exponent - places;
  let value;
  if (scale <= 0) {
    value = digits * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    const rem = digits % divisor;
    const roundsUp = 2n * rem >= divisor;
    const noise = (roundsUp ? divisor - rem : rem) * 1000000n < divisor;
    if (rem !== 0n && !noise) throw new Error(`The ${label} "${raw}" has more than ${places} decimal places.`);
    value = digits / divisor + (roundsUp ? 1n : 0n);
  }
  return negative ? -value : value;
}
function scaledParseNumber(raw, places, label = "number") {
  const v = scaledParse(raw, places, label);
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`The ${label} "${raw}" is out of range.`);
  return Number(v);
}
function scaledFormat(value, places, trim = false) {
  const v = BigInt(value);
  const abs = (v < 0n ? -v : v).toString().padStart(places + 1, "0");
  let out = places === 0 ? abs : `${abs.slice(0, abs.length - places)}.${abs.slice(abs.length - places)}`;
  if (trim && places > 0) out = out.replace(/\.?0+$/, "");
  return (v < 0n ? "-" : "") + out;
}

// packages/core/src/statements/reconcile.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// packages/core/src/construction/usStates.ts
var US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"]
];

// packages/core/src/property/sheetCells.ts
function pmCellToCents(raw, options = {}) {
  const s = raw.trim().replace(/−/g, "-").replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  try {
    return parseAmount(s, { crIsNegative: options.crIsNegative ?? true });
  } catch {
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    const { cents, clean } = decimalToCents(s);
    if (clean) return cents;
  }
  throw new AmountError(`not a valid amount: "${raw}"`);
}
var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var DAY_MS = 864e5;
function iso(year, month, day, raw) {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isIsoDate(value)) throw new Error(`not a real date: "${raw}"`);
  return value;
}
function pmCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]), raw);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    const year = m[3].length === 2 ? yy < 30 ? 2e3 + yy : 1900 + yy : yy;
    return order === "dmy" ? iso(year, Number(m[2]), Number(m[1]), raw) : iso(year, Number(m[1]), Number(m[2]), raw);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[2]), raw);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[1]), raw);
  }
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const serial = Number(m[1]);
    if (serial >= 2e4 && serial <= 8e4) return new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS).toISOString().slice(0, 10);
  }
  throw new Error(`not a recognizable date: "${raw}"`);
}
function pmNormalizeHeader(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// packages/core/src/ecommerce/cells.ts
function ecCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(\s.*)?$/.exec(s);
  if (m) return pmCellToIsoDate(order === "dmy" ? `${m[2]}/${m[1]}/${m[3]}` : `${m[1]}/${m[2]}/${m[3]}`);
  return pmCellToIsoDate(s);
}
function ecMoneyCell(raw) {
  const s = (raw ?? "").trim();
  if (s === "" || /^[-–—]+$/.test(s)) return void 0;
  return pmCellToCents(s);
}
function ecDescriptionAmount(description) {
  const found = description.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) ?? [];
  if (found.length !== 1) return void 0;
  try {
    return parseAmount(found[0].replace(/\s/g, ""));
  } catch {
    return void 0;
  }
}
var EC_CATEGORIES = ["sale", "shipping", "tax", "fee", "refund", "adjustment", "payout"];
var EC_CATEGORY_LABELS = {
  sale: "Sales",
  shipping: "Shipping charged to buyers",
  tax: "Tax collected",
  fee: "Fees",
  refund: "Refunds",
  adjustment: "Adjustments",
  payout: "Deposits or payouts to the bank"
};
function ecNormalizeType(typeText) {
  return pmNormalizeHeader(typeText);
}
function ecGuessCategory(typeText) {
  const t = ` ${ecNormalizeType(typeText)} `;
  const has = (...words) => words.some((w) => t.includes(` ${w} `));
  if (has("refund", "refunds", "refunded", "return", "chargeback")) return "refund";
  if (has("deposit", "deposits", "payout", "payouts", "transfer", "disbursement", "withdrawal")) return "payout";
  if (has("fee", "fees", "marketing", "advertising", "ads", "listing", "commission", "subscription", "label", "labels", "postage")) return "fee";
  if (has("tax", "taxes", "vat", "gst")) return "tax";
  if (has("shipping", "delivery")) return "shipping";
  if (has("sale", "sales", "order", "orders", "payment", "charge")) return "sale";
  return "adjustment";
}
function ecFeeLabel(category, typeText, description) {
  const type = typeText.trim() || EC_CATEGORY_LABELS[category];
  if (category !== "fee") return `Fees on ${type} rows`;
  const head = description.split(":")[0].trim();
  return head || type;
}
function ecLineParts(line) {
  const parts = [];
  if (line.amount !== 0) parts.push(line.category === "fee" ? { category: "fee", feeType: line.feeType, amount: line.amount } : { category: line.category, amount: line.amount });
  if (line.fees !== 0) parts.push(line.category === "tax" ? { category: "tax", amount: line.fees } : { category: "fee", feeType: line.feeType, amount: line.fees });
  return parts;
}
function ecJournalLine(account, amount, normal) {
  if (amount === 0) return [];
  const onDebit = normal === "debit" === amount > 0;
  return [{ account, debit: onDebit ? Math.abs(amount) : 0, credit: onDebit ? 0 : Math.abs(amount) }];
}
var EC_DEFAULT_ACCOUNTS = {
  sale: "Sales",
  shipping: "Shipping income",
  tax: "Sales tax collected",
  fee: "Marketplace fees",
  refund: "Refunds",
  adjustment: "Marketplace adjustments",
  payout: "Bank account",
  balance: "Marketplace balance"
};
function matchHeaders(header, order, synonyms, moneyRoles) {
  const NOT_MONEY = /\b(date|id|code|reference|number|status|type|currency|name|state|province|region)\b/;
  const NOT_LABEL = /\b(amount|total|subtotal|tax|taxes|fee|fees|price)\b/;
  const names = header.map(pmNormalizeHeader);
  const found = Object.fromEntries(order.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  for (const exact of [true, false]) {
    for (const role of order) {
      if (found[role] >= 0) continue;
      search: for (const syn of synonyms[role]) {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (taken.has(i) || name === "") continue;
          const allowed = role === "date" || !(moneyRoles.has(role) ? NOT_MONEY : NOT_LABEL).test(name);
          if (exact ? name === syn : ` ${name} `.includes(` ${syn} `) && allowed) {
            found[role] = i;
            taken.add(i);
            break search;
          }
        }
      }
    }
  }
  return found;
}
function bestHeaderRow(rows, order, synonyms, moneyRoles, atHeaderRow) {
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], order, synonyms, moneyRoles) };
  const score = (columns) => Object.values(columns).filter((c) => c >= 0).length;
  const firstFilled = Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
  let best = { headerRow: firstFilled, columns: matchHeaders(rows[firstFilled] ?? [], order, synonyms, moneyRoles) };
  rows.slice(0, 25).forEach((row, i) => {
    const columns = matchHeaders(row, order, synonyms, moneyRoles);
    if (score(columns) > score(best.columns)) best = { headerRow: i, columns };
  });
  return best;
}
function ecHeaderList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}
var EC_LEDGER_ROLES = ["date", "type", "description", "amount", "fees", "net"];
var EC_LEDGER_LABELS = {
  date: "Date",
  type: "Row type",
  description: "Title or description",
  amount: "Amount",
  fees: "Fees (and taxes) column",
  net: "Net"
};
var LEDGER_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "created", "created at", "transaction creation date", "payout date"],
  type: ["type", "transaction type", "entry type", "activity type", "category"],
  fees: ["fees taxes", "fees and taxes", "fees", "fee", "total fees", "fee amount"],
  net: ["net", "net amount", "net total"],
  amount: ["amount", "gross", "gross amount", "transaction amount", "total"],
  description: ["title", "description", "details", "info", "item title", "memo", "name"]
};
var LEDGER_ORDER = ["date", "type", "fees", "net", "amount", "description"];
var LEDGER_MONEY = /* @__PURE__ */ new Set(["amount", "fees", "net"]);
function ecGuessLedgerColumns(rows, atHeaderRow) {
  const { headerRow, columns } = bestHeaderRow(rows, LEDGER_ORDER, LEDGER_SYNONYMS, LEDGER_MONEY, atHeaderRow);
  const categories = {};
  let feeNegative = 0;
  let feePositive = 0;
  let payoutNegative = 0;
  let payoutPositive = 0;
  const read = (row, col) => {
    try {
      return (col >= 0 ? ecMoneyCell(row[col]) : void 0) ?? 0;
    } catch {
      return 0;
    }
  };
  for (const row of rows.slice(headerRow + 1)) {
    const typeText = columns.type >= 0 ? (row[columns.type] ?? "").trim() : "";
    if (typeText) categories[ecNormalizeType(typeText)] ??= ecGuessCategory(typeText);
    const fee = read(row, columns.fees);
    if (fee < 0) feeNegative++;
    else if (fee > 0) feePositive++;
    if (typeText && ecGuessCategory(typeText) === "payout") {
      const amount = read(row, columns.amount);
      if (amount < 0) payoutNegative++;
      else if (amount > 0) payoutPositive++;
    }
  }
  return { headerRow, columns, dateOrder: "mdy", feesAreSubtracted: feePositive > 0 && feeNegative === 0, payoutsArePositive: payoutPositive > 0 && payoutNegative === 0, categories };
}
var EC_ORDER_ROLES = ["orderId", "state", "taxable", "tax"];
var EC_ORDER_LABELS = {
  orderId: "Order id or number",
  state: "Ship-to state",
  taxable: "Taxable amount",
  tax: "Tax collected"
};
var ORDER_SYNONYMS = {
  orderId: ["order id", "order number", "order name", "order", "sale id", "receipt id", "transaction id", "name", "id"],
  state: ["ship state", "ship to state", "shipping state", "shipping province", "ship to province", "shipping province code", "ship province", "delivery state", "shipping region", "state", "province", "region"],
  tax: ["tax collected", "sales tax collected", "sales tax", "total tax", "tax amount", "taxes", "tax"],
  taxable: ["taxable amount", "taxable sales", "taxable", "subtotal", "item total", "order value", "order total", "sales", "amount", "total"]
};
var ORDER_ORDER = ["orderId", "state", "tax", "taxable"];
var ORDER_MONEY = /* @__PURE__ */ new Set(["tax", "taxable"]);
function ecGuessOrderColumns(rows, atHeaderRow) {
  return bestHeaderRow(rows, ORDER_ORDER, ORDER_SYNONYMS, ORDER_MONEY, atHeaderRow);
}
var TERRITORIES = [["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"], ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"]];
var STATE_NAMES = new Map([...US_STATES, ...TERRITORIES].map(([code, name]) => [code, name]));
var STATE_BY_NAME = new Map([...US_STATES, ...TERRITORIES].map(([code, name]) => [pmNormalizeHeader(name), code]));
function ecStateCode(raw) {
  const s = raw.trim().replace(/^US[-\s]/i, "");
  const upper = s.toUpperCase();
  if (STATE_NAMES.has(upper)) return upper;
  return STATE_BY_NAME.get(pmNormalizeHeader(s)) ?? "";
}
function ecStateName(code) {
  return STATE_NAMES.get(code) ?? code;
}

// packages/core/src/ecommerce/productSales.ts
var EC_NO_PRODUCT_NAMED = "No product named";
var EC_PRODUCT_SALES_ROLES = ["amount", "name", "sku", "quantity", "orderId", "date"];
var EC_PRODUCT_SALES_LABELS = {
  amount: "Item total",
  name: "Item name",
  sku: "SKU",
  quantity: "Quantity",
  orderId: "Order id or number",
  date: "Order date"
};
var EC_PRODUCT_SALES_UNIT_PRICE_LABEL = "Unit price (used when there is no item total)";
var UNIT_PRICE_PHRASES = ["unit price", "line item price", "item price", "price each", "price per unit", "sale price", "price"];
var UNIT_PRICE_NEVER_BESIDE = /(?:compare|original|list|regular|cost|total|subtotal|tax|shipping|discount|fee|fees|refund|refunded)/;
var SYNONYMS = {
  amount: [
    "item total",
    "line total",
    "line item total",
    "item subtotal",
    "line subtotal",
    "line item subtotal",
    "item amount",
    "line amount",
    "line item amount",
    "extended price",
    "extended amount",
    "total price",
    "item sales",
    "product sales",
    "net sales",
    "gross sales",
    "sales amount",
    "sale amount",
    "amount",
    "subtotal",
    "total",
    "sales"
  ],
  name: ["item name", "item title", "product name", "product title", "line item name", "line item title", "listing title", "item description", "product description", "line item description", "item", "product", "title", "description"],
  sku: ["sku", "item sku", "product sku", "variant sku", "line item sku", "seller sku", "stock keeping unit", "item code", "product code", "part number"],
  quantity: ["quantity", "qty", "item quantity", "line item quantity", "quantity sold", "quantity purchased", "quantity ordered", "units sold", "units", "number of items"],
  orderId: ["order id", "order number", "order no", "order name", "order reference", "order ref", "sale id", "sale number", "receipt id", "receipt number", "transaction id", "order"],
  date: ["order date", "sale date", "date of sale", "purchase date", "date ordered", "date sold", "sold on", "ordered on", "transaction date", "date paid", "paid at", "created at", "date", "created"]
};
var NEVER_BESIDE = {
  amount: /\b(?:tax|taxes|taxable|vat|gst|shipping|postage|discount|discounts|coupon|fee|fees|refund|refunds|refunded|order|unit|each|quantity|qty|count|weight|rate|percent)\b/,
  name: /\b(?:total|subtotal|amount|price|cost|tax|fee|quantity|qty|count|id|number|code|sku|date|status|type|url|link|image|weight|category)\b/,
  sku: /\b(?:total|amount|price|quantity|qty|count|date|name|title)\b/,
  quantity: /\b(?:refunded|returned|shipped|fulfilled|available|stock|inventory|remaining|cancelled|canceled|price|amount|cost|total|tax|weight)\b/,
  orderId: /\b(?:date|total|subtotal|amount|status|type|note|notes|tax|shipping|discount|quantity|qty|count|value|currency|item|line)\b/,
  date: /\b(?:ship|shipped|shipping|delivery|delivered|refund|refunded|cancelled|canceled|updated|due|payout|deposit)\b/
};
var MATCH_ORDER = ["orderId", "date", "sku", "quantity", "amount", "name"];
var CURRENCY_WORDS = /\b(?:usd|cad|aud|eur|gbp)\b/g;
function headerWords(text) {
  return sheetNormalizeHeader(text).replace(/\blineitem\b/g, "line item").replace(CURRENCY_WORDS, " ").replace(/\s+/g, " ").trim();
}
function matchRow(header) {
  const names = header.map(headerWords);
  const columns = { amount: -1, name: -1, sku: -1, quantity: -1, orderId: -1, date: -1 };
  const taken = /* @__PURE__ */ new Set();
  let hits = 0;
  for (const exact of [true, false]) {
    for (const role of MATCH_ORDER) {
      if (columns[role] >= 0) continue;
      search: for (const phrase of SYNONYMS[role]) {
        if (!exact && !phrase.includes(" ")) continue;
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (taken.has(i) || name === "") continue;
          let found = name === phrase;
          if (!exact && !found) {
            const padded = ` ${name} `;
            const at = padded.indexOf(` ${phrase} `);
            found = at >= 0 && !NEVER_BESIDE[role].test(`${padded.slice(0, at)} ${padded.slice(at + phrase.length + 2)}`);
          }
          if (found) {
            columns[role] = i;
            taken.add(i);
            hits++;
            break search;
          }
        }
      }
    }
  }
  return { columns, hits };
}
function unitPriceColumn(header, columns) {
  const taken = new Set(Object.values(columns).filter((c) => c >= 0));
  const names = header.map(headerWords);
  for (const exact of [true, false]) {
    for (const phrase of UNIT_PRICE_PHRASES) {
      if (!exact && !phrase.includes(" ")) continue;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (taken.has(i) || name === "") continue;
        if (exact ? name === phrase : ` ${name} `.includes(` ${phrase} `) && !UNIT_PRICE_NEVER_BESIDE.test(name)) return i;
      }
    }
  }
  return -1;
}
function mappingAt(rows, headerRow, columns) {
  const mapping = { headerRow, columns, dateOrder: "mdy" };
  const price = unitPriceColumn(rows[headerRow] ?? [], columns);
  if (price < 0) return mapping;
  mapping.unitPrice = price;
  if (columns.amount >= 0 && columns.quantity >= 0 && writtenOncePerOrder(rows.slice(headerRow + 1), columns.amount, price, columns.quantity)) mapping.columns = { ...columns, amount: -1 };
  return mapping;
}
function writtenOncePerOrder(data, totalCol, priceCol, qtyCol) {
  let groups = 0;
  let group = null;
  const close = () => {
    if (group && group.followers > 0) {
      groups++;
      if (group.total !== group.items) return false;
    }
    return true;
  };
  try {
    for (const row of data) {
      if (row.every((c) => c.trim() === "")) continue;
      const p = ecMoneyCell(row[priceCol]);
      if (p === void 0) continue;
      const item = BigInt(p) * BigInt(scaledParseNumber((row[qtyCol] ?? "").trim(), 0, "quantity"));
      const t = ecMoneyCell(row[totalCol]);
      if (t !== void 0) {
        if (!close()) return false;
        group = { total: BigInt(t), items: item, followers: 0 };
      } else {
        if (!group) return false;
        group.items += item;
        group.followers++;
      }
    }
  } catch {
    return false;
  }
  return close() && groups > 0;
}
function ecGuessProductSalesColumns(rows, atHeaderRow) {
  if (atHeaderRow !== void 0) return mappingAt(rows, atHeaderRow, matchRow(rows[atHeaderRow] ?? []).columns);
  const firstFilled = Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
  let best = { headerRow: firstFilled, ...matchRow(rows[firstFilled] ?? []) };
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const m = matchRow(rows[i] ?? []);
    if (m.hits > best.hits) best = { headerRow: i, ...m };
  }
  return mappingAt(rows, best.headerRow, best.columns);
}
function isTotalLabel(cell) {
  return /^(?:grand|statement|report|page|sub)?[\s-]*totals?[\s:.]*$/i.test(cell);
}
function ecReadProductSalesRows(rows, mapping, options = {}) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const col = mapping.columns;
  const headers = ecHeaderList(rows, mapping.headerRow);
  const price = col.amount < 0 && mapping.unitPrice !== void 0 && mapping.unitPrice >= 0 ? mapping.unitPrice : -1;
  if (col.amount < 0 && price < 0) throw new Error(`No "Item total" column could be identified (${headers}). Choose it in the column mapping.`);
  if (price >= 0 && col.quantity < 0) throw new Error(`A unit price needs the "Quantity" column to give an item total (${headers}). Choose it in the column mapping, or choose the item total column.`);
  if (col.name < 0 && col.sku < 0) throw new Error(`No "Item name" or "SKU" column could be identified (${headers}). Choose at least one of them in the column mapping.`);
  if (options.datesNeeded && col.date < 0) throw new Error(`No "Order date" column could be identified (${headers}). Choose it in the column mapping, or clear the date range.`);
  const chosen = [...EC_PRODUCT_SALES_ROLES.map((role) => col[role]), price].filter((index) => index >= 0);
  if (new Set(chosen).size !== chosen.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
  const out = { rows: [], problems: [], skipped: [], hasQuantity: col.quantity >= 0, hasOrderIds: col.orderId >= 0, hasDates: col.date >= 0, fromUnitPrice: price >= 0 };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const sku = sheetCell(cells, col.sku);
    const name = sheetCell(cells, col.name);
    const orderId = sheetCell(cells, col.orderId);
    const amountText = sheetCell(cells, price >= 0 ? price : col.amount);
    const quantityText = sheetCell(cells, col.quantity);
    const dateText = sheetCell(cells, col.date);
    if (sku === "" && (sheetIsTotalWord(orderId) || isTotalLabel(name) || orderId === "" && (sheetIsTotalWord(name) || name === "" && cells.some(sheetIsTotalWord)))) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    const reasons = [];
    let amount;
    try {
      amount = ecMoneyCell(amountText);
      if (amount === void 0) {
        out.skipped.push({ rowNumber, reason: "no item total" });
        continue;
      }
    } catch {
      reasons.push(`the ${price >= 0 ? "unit price" : "item total"} "${amountText}" could not be read`);
    }
    let quantity = 1;
    if (col.quantity >= 0) {
      if (quantityText === "") reasons.push("no quantity");
      else {
        try {
          quantity = scaledParseNumber(quantityText, 0, "quantity");
        } catch {
          reasons.push(`the quantity "${quantityText}" is not a whole number`);
        }
      }
    }
    if (price >= 0 && amount !== void 0 && reasons.length === 0) {
      const total = BigInt(amount) * BigInt(quantity);
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) reasons.push(`the unit price "${amountText}" times the quantity is out of range`);
      else amount = Number(total) === 0 ? 0 : Number(total);
    }
    let date = "";
    if (dateText !== "") {
      try {
        date = ecCellToIsoDate(dateText, mapping.dateOrder);
      } catch {
        if (options.datesNeeded) reasons.push(`the order date "${dateText}" could not be read`);
      }
    } else if (options.datesNeeded) reasons.push("no order date, so it cannot be placed in the date range");
    if (reasons.length > 0 || amount === void 0) {
      out.problems.push({ rowNumber, reason: reasons.join("; ") });
      continue;
    }
    out.rows.push({ rowNumber, sku, name, quantity, orderId, date, amount });
  }
  return out;
}
function spelled(raw) {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}
function ecProductSalesKey(sku, name) {
  const bySku = spelled(sku);
  if (bySku !== "") return `sku ${bySku}`;
  const byName = spelled(name);
  return byName === "" ? "" : `name ${byName}`;
}
function plus(a, b, what) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new Error(`The ${what} is too large.`);
  return total;
}
function roundedShare(n, d) {
  const size = n < 0n ? -n : n;
  const quotient = (2n * size + d) / (2n * d);
  if (quotient > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("A share of net is too large.");
  return Number(n < 0n ? -quotient : quotient);
}
function repeatedRows(rows) {
  const seen = /* @__PURE__ */ new Set();
  const again = /* @__PURE__ */ new Set();
  for (const r of rows) {
    if (seen.has(r.rowNumber)) again.add(r.rowNumber);
    seen.add(r.rowNumber);
  }
  return [...again].sort((x, y) => x - y);
}
function ecProductSales(input) {
  if (input.rows.length === 0) throw new Error("No item rows were read. Check the header row and the column mapping.");
  for (const r of input.rows) {
    if (!Number.isSafeInteger(r.amount)) throw new Error(`The item total on row ${r.rowNumber} must be a whole number of cents.`);
    if (!Number.isSafeInteger(r.quantity)) throw new Error(`The quantity on row ${r.rowNumber} must be a whole number.`);
    if (r.date !== "" && !isIsoDate(r.date)) throw new Error(`The order date on row ${r.rowNumber} must be written YYYY-MM-DD.`);
  }
  const { from, to } = input;
  if (from !== void 0 && !isIsoDate(from)) throw new Error("The first date of the range must be written YYYY-MM-DD.");
  if (to !== void 0 && !isIsoDate(to)) throw new Error("The last date of the range must be written YYYY-MM-DD.");
  if (from !== void 0 && to !== void 0 && from > to) throw new Error("Set the first date of the range on or before the last date.");
  const ranged = from !== void 0 || to !== void 0;
  if (ranged) {
    const undated = input.rows.find((r) => r.date === "");
    if (undated) throw new Error(`Row ${undated.rowNumber} has no order date, so it cannot be placed in the date range.`);
  }
  const inside = (r) => (from === void 0 || r.date >= from) && (to === void 0 || r.date <= to);
  const used = ranged ? input.rows.filter(inside) : [...input.rows];
  const outsideRange = ranged ? input.rows.filter((r) => !inside(r)).map((r) => r.rowNumber) : [];
  if (used.length === 0) throw new Error("Set a date range that holds at least one row. No row is dated inside this one.");
  if (input.typedTotalNet !== void 0 && !Number.isSafeInteger(input.typedTotalNet)) throw new Error("The total net sales you typed must be a whole number of cents.");
  const groups = /* @__PURE__ */ new Map();
  const everyOrder = /* @__PURE__ */ new Set();
  const all = { units: 0, sales: 0, reversals: 0, net: 0 };
  for (const r of used) {
    const key = ecProductSalesKey(r.sku, r.name);
    let g = groups.get(key);
    if (!g) {
      g = { sku: spelled(r.sku) === "" ? "" : r.sku.trim(), name: "", rowNumbers: [], orderIds: /* @__PURE__ */ new Set(), units: 0, sales: 0, reversals: 0, net: 0 };
      groups.set(key, g);
    }
    if (g.name === "" && key !== "") g.name = r.name.trim();
    const label = key === "" ? "the rows with no product named" : `product ${g.sku || g.name}`;
    g.rowNumbers.push(r.rowNumber);
    const orderId = r.orderId.trim();
    if (orderId !== "") {
      g.orderIds.add(orderId);
      everyOrder.add(orderId);
    }
    g.units = plus(g.units, r.quantity, `number of units for ${label}`);
    if (r.amount > 0) g.sales = plus(g.sales, r.amount, `sales figure for ${label}`);
    if (r.amount < 0) g.reversals = plus(g.reversals, r.amount, `reversals figure for ${label}`);
    g.net = plus(g.net, r.amount, `net figure for ${label}`);
    all.units = plus(all.units, r.quantity, "total number of units");
    if (r.amount > 0) all.sales = plus(all.sales, r.amount, "total sales figure");
    if (r.amount < 0) all.reversals = plus(all.reversals, r.amount, "total reversals figure");
    all.net = plus(all.net, r.amount, "total net figure");
  }
  const lineOf = (g) => ({
    sku: g.sku,
    name: g.name,
    rowNumbers: g.rowNumbers,
    rows: g.rowNumbers.length,
    orders: input.hasOrderIds ? g.orderIds.size : null,
    units: g.units,
    sales: g.sales,
    reversals: g.reversals,
    net: g.net,
    shareBp: all.net > 0 ? roundedShare(BigInt(g.net) * 10000n, BigInt(all.net)) : null
  });
  const products = [...groups.entries()].filter(([key]) => key !== "").map(([, g]) => lineOf(g)).sort((a, b) => {
    if (a.net !== b.net) return a.net > b.net ? -1 : 1;
    const [nameA, nameB] = [spelled(a.name), spelled(b.name)];
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const [skuA, skuB] = [spelled(a.sku), spelled(b.sku)];
    return skuA < skuB ? -1 : skuA > skuB ? 1 : 0;
  });
  const noProduct = lineOf(groups.get("") ?? { sku: "", name: "", rowNumbers: [], orderIds: /* @__PURE__ */ new Set(), units: 0, sales: 0, reversals: 0, net: 0 });
  const total = { rows: used.length, orders: input.hasOrderIds ? everyOrder.size : null, ...all };
  const report = { products, noProduct, total, outsideRange };
  const checks = new CheckList();
  const again = repeatedRows(input.rows);
  const placed = products.reduce((n, p) => n + p.rows, 0) + noProduct.rows;
  checks.that(
    "ec-ps-rows-once",
    "Every row used is counted exactly once",
    again.length === 0 && placed === used.length && used.length + outsideRange.length === input.rows.length,
    again.length ? `row(s) ${again.join(", ")} appear more than once` : "the row counts do not add up"
  );
  const second = { units: 0n, sales: 0n, reversals: 0n, net: 0n };
  for (const r of used) {
    const amount = BigInt(r.amount);
    second.units += BigInt(r.quantity);
    if (amount > 0n) second.sales += amount;
    if (amount < 0n) second.reversals += amount;
    second.net += amount;
  }
  const lines = { units: 0n, sales: 0n, reversals: 0n, net: 0n };
  for (const line of [...products, noProduct]) {
    lines.units += BigInt(line.units);
    lines.sales += BigInt(line.sales);
    lines.reversals += BigInt(line.reversals);
    lines.net += BigInt(line.net);
  }
  const agree = (key) => second[key] === lines[key] && second[key] === BigInt(total[key]);
  checks.that(
    "ec-ps-readd",
    "A second pass straight over the rows equals the products added up: units, sales, reversals and net",
    agree("units") && agree("sales") && agree("reversals") && agree("net") && second.sales + second.reversals === second.net,
    `units ${second.units} vs ${lines.units}, sales ${scaledFormat(second.sales, 2)} vs ${scaledFormat(lines.sales, 2)}, reversals ${scaledFormat(second.reversals, 2)} vs ${scaledFormat(lines.reversals, 2)}, net ${scaledFormat(second.net, 2)} vs ${scaledFormat(lines.net, 2)}`
  );
  return { ...report, checks: checks.all };
}
function ecProductSalesTables(rows, r) {
  const d = toDecimal;
  const share = (bp) => bp === null ? "" : scaledFormat(bp, 2);
  const figures = (t) => [t.rows, t.orders ?? "", t.units, d(t.sales), d(t.reversals), d(t.net)];
  const products = [
    ["SKU", "Item", "Rows", "Orders", "Units", "Sales", "Reversals", "Net", "Share of net (%)"],
    ...r.products.map((p) => [p.sku, p.name, ...figures(p), share(p.shareBp)]),
    ...r.noProduct.rows > 0 ? [["", EC_NO_PRODUCT_NAMED, ...figures(r.noProduct), share(r.noProduct.shareBp)]] : [],
    ["", "Total", ...figures(r.total), ""]
  ];
  const unnamed = new Set(r.noProduct.rowNumbers);
  const noProduct = [["Row", "Order", "Order date", "Quantity", "Item total"], ...rows.filter((row) => unnamed.has(row.rowNumber)).map((row) => [row.rowNumber, row.orderId, row.date, row.quantity, d(row.amount)])];
  return { products, noProduct };
}

export {
  sheetRowChecks,
  sheetNormalizeHeader,
  scaledFormat,
  isIsoDate,
  ecCellToIsoDate,
  ecMoneyCell,
  ecDescriptionAmount,
  EC_CATEGORIES,
  EC_CATEGORY_LABELS,
  ecNormalizeType,
  ecGuessCategory,
  ecFeeLabel,
  ecLineParts,
  ecJournalLine,
  EC_DEFAULT_ACCOUNTS,
  ecHeaderList,
  EC_LEDGER_ROLES,
  EC_LEDGER_LABELS,
  ecGuessLedgerColumns,
  EC_ORDER_ROLES,
  EC_ORDER_LABELS,
  ecGuessOrderColumns,
  ecStateCode,
  ecStateName,
  EC_NO_PRODUCT_NAMED,
  EC_PRODUCT_SALES_ROLES,
  EC_PRODUCT_SALES_LABELS,
  EC_PRODUCT_SALES_UNIT_PRICE_LABEL,
  ecGuessProductSalesColumns,
  ecReadProductSalesRows,
  ecProductSalesKey,
  ecProductSales,
  ecProductSalesTables
};
