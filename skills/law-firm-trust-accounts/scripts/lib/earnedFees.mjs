// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AmountError,
  CheckList,
  assertCents,
  calendarDaysBetween,
  decimalToCents,
  formatUSD,
  isIsoDate,
  lawAssertBalances,
  lawAssertTransactions,
  lawBigSum,
  lawClientKey,
  lawClientLabel,
  lawSortByDate,
  parseAmount,
  parseCivilDate,
  sum,
  toDecimal
} from "./money.mjs";

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
function matchRow(header, roles, synonyms) {
  const names = header.map(sheetNormalizeHeader);
  const used = /* @__PURE__ */ new Set();
  const columns = {};
  let hits = 0;
  for (const role of roles) columns[role] = -1;
  for (const exact of [true, false]) {
    for (const role of roles) {
      if (columns[role] >= 0) continue;
      for (const word of synonyms[role]) {
        const col = names.findIndex((n, i) => !used.has(i) && n !== "" && (exact ? n === word : ` ${n} `.includes(` ${word} `)));
        if (col >= 0) {
          columns[role] = col;
          used.add(col);
          hits++;
          break;
        }
      }
    }
  }
  return { columns, hits };
}
function sheetGuessColumns(rows, roles, synonyms, atHeaderRow) {
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: matchRow(rows[atHeaderRow] ?? [], roles, synonyms).columns };
  let best = { headerRow: 0, ...matchRow(rows[0] ?? [], roles, synonyms) };
  for (let i = 1; i < Math.min(rows.length, 20); i++) {
    const m = matchRow(rows[i] ?? [], roles, synonyms);
    if (m.hits > best.hits) best = { headerRow: i, ...m };
  }
  return { headerRow: best.headerRow, columns: best.columns };
}

// packages/core/src/law/earnedFees.ts
var LAW_INVOICE_ROLES = ["date", "client", "invoice", "amount"];
var LAW_INVOICE_LABELS = {
  date: "Invoice date",
  client: "Client or matter",
  invoice: "Invoice number",
  amount: "Fees billed"
};
var INVOICE_SYNONYMS = {
  date: ["invoice date", "bill date", "billed date", "billing date", "date billed", "date"],
  client: ["client matter", "client", "matter", "client name", "matter name", "case", "file"],
  invoice: ["invoice number", "invoice no", "invoice num", "invoice", "bill number", "bill no", "number", "reference", "ref"],
  amount: ["fees billed", "fee amount", "fees", "amount billed", "billed amount", "billed", "invoice amount", "invoice total", "amount", "total"]
};
function lawGuessInvoiceColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, LAW_INVOICE_ROLES, INVOICE_SYNONYMS, atHeaderRow);
}
var cellAt = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
function lawExtractInvoices(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The invoice list has no rows under its header row.");
  const c = mapping.columns;
  for (const role of ["date", "client", "amount"]) {
    if (!Number.isSafeInteger(c[role]) || c[role] < 0) throw new Error(`No "${LAW_INVOICE_LABELS[role]}" column could be identified in the invoice list. Choose it in the column mapping.`);
  }
  const used = Object.values(c).filter((x) => x >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts of the invoice list. Each column can be used once.");
  const invoices = [];
  const problems = [];
  const totalRows = [];
  let ignoredRows = 0;
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = cellAt(row, c.date);
    const rawAmount = cellAt(row, c.amount);
    const client = cellAt(row, c.client).replace(/\s+/g, " ");
    if (!rawDate && row.some((x) => sheetIsTotalWord(x))) {
      totalRows.push(rowNumber);
      return;
    }
    if (!rawDate && !rawAmount) {
      ignoredRows++;
      return;
    }
    const reasons = [];
    let date = "";
    if (!rawDate) reasons.push("no invoice date");
    else {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    let amount = 0;
    if (!rawAmount) reasons.push("no amount billed");
    else {
      try {
        amount = pmCellToCents(rawAmount);
      } catch {
        reasons.push(`the amount "${rawAmount}" could not be read`);
      }
    }
    if (!client) reasons.push("no client or matter");
    if (reasons.length) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    invoices.push({ rowNumber, date, client, invoice: cellAt(row, c.invoice), amount });
  });
  if (invoices.length === 0 && problems.length === 0) throw new Error("No invoices were found under the header row. Check the header row and the column mapping.");
  return { invoices, problems, totalRows, ignoredRows };
}
function lawFeeWords(words) {
  const out = [];
  for (const w of words) {
    const word = w.trim().replace(/\s+/g, " ").toLowerCase();
    if (word && !out.includes(word)) out.push(word);
  }
  return out;
}
function lawFeeWordsFromText(text) {
  return lawFeeWords(text.split(/[,;]/));
}
var rowText = (t) => `${t.description} ${t.reference ?? ""}`.replace(/\s+/g, " ").toLowerCase();
function lawFeeHasWord(t, words) {
  const text = rowText(t);
  return words.some((w) => text.includes(w));
}
function validate(input) {
  lawAssertTransactions(input.transactions);
  parseCivilDate(input.asOf, "as-of date");
  const from = input.from ?? "";
  if (from !== "") {
    parseCivilDate(from, "from date");
    if (from > input.asOf) throw new Error(`The from date (${from}) is after the as-of date (${input.asOf}).`);
  }
  const words = lawFeeWords(input.transferWords);
  if (words.length === 0) throw new Error("Type at least one word that marks a fee transfer in the trust list, such as the word its description uses for the firm account.");
  lawAssertBalances(input.carriedIn ?? [], "carried-in balance");
  const seen = /* @__PURE__ */ new Set();
  for (const inv of input.invoices) {
    if (!Number.isSafeInteger(inv.rowNumber)) throw new Error("Every invoice needs a whole row number.");
    if (seen.has(inv.rowNumber)) throw new Error(`Row number ${inv.rowNumber} appears twice in the invoice list.`);
    seen.add(inv.rowNumber);
    if (!isIsoDate(inv.date)) throw new Error(`Invoice row ${inv.rowNumber}: "${inv.date}" is not a valid date.`);
    if (lawClientKey(inv.client) === "") throw new Error(`Invoice row ${inv.rowNumber} has no client or matter.`);
    assertCents(inv.amount, `amount on invoice row ${inv.rowNumber}`);
  }
  return words;
}
var inWindow = (date, from, asOf) => date <= asOf && (from === "" || date >= from);
function buildEarnedFeesReport(input) {
  const words = validate(input);
  const asOf = input.asOf;
  const from = input.from ?? "";
  const carried = input.carriedIn ?? [];
  const counted = lawSortByDate(input.transactions.filter((t) => t.date <= asOf));
  const invoices = lawSortByDate(input.invoices.filter((i) => inWindow(i.date, from, asOf)));
  const work = /* @__PURE__ */ new Map();
  const get = (name) => {
    const key = lawClientKey(name);
    let w = work.get(key);
    if (!w) {
      w = { client: lawClientLabel(name), carriedIn: 0, moneyIn: 0, otherOut: 0, transferredBefore: 0, balance: 0, invoices: [], transfers: [] };
      work.set(key, w);
    }
    return w;
  };
  for (const c of carried) {
    const w = get(c.client);
    w.carriedIn = c.balance;
    w.balance = c.balance;
  }
  const transfers = [];
  const markedMoneyIn = [];
  const unassigned = [];
  let moneyInTotal = 0;
  let otherOutTotal = 0;
  let transferredBeforeTotal = 0;
  let unassignedTotal = 0;
  let unassignedTransferTotal = 0;
  for (const t of counted) {
    const marked = lawFeeHasWord(t, words);
    const isTransfer = marked && t.amount < 0;
    if (marked && t.amount > 0) markedMoneyIn.push(t);
    const assigned = lawClientKey(t.client) !== "";
    const w = assigned ? get(t.client) : null;
    if (!assigned) {
      unassigned.push(t);
      unassignedTotal = assertCents(unassignedTotal + t.amount, "total of rows with no client");
    }
    if (t.amount >= 0) {
      moneyInTotal = assertCents(moneyInTotal + t.amount, "money in");
      if (w) w.moneyIn += t.amount;
    } else if (!isTransfer) {
      otherOutTotal = assertCents(otherOutTotal - t.amount, "money out");
      if (w) w.otherOut -= t.amount;
    } else if (from !== "" && t.date < from) {
      transferredBeforeTotal = assertCents(transferredBeforeTotal - t.amount, "fee transfers before the from date");
      if (w) w.transferredBefore -= t.amount;
    } else {
      transfers.push(t);
      if (w) w.transfers.push(t);
      else unassignedTransferTotal -= t.amount;
    }
    if (w) w.balance = assertCents(w.balance + t.amount, `trust balance for ${w.client}`);
  }
  for (const inv of invoices) get(inv.client).invoices.push(inv);
  const clients = [];
  const open = [];
  const ahead = [];
  for (const w of work.values()) {
    const billed = sum(w.invoices.map((i2) => i2.amount));
    const transferred = sum(w.transfers.map((t) => -t.amount));
    let pool = transferred + sum(w.invoices.filter((i2) => i2.amount < 0).map((i2) => -i2.amount));
    const mine = [];
    for (const inv of w.invoices) {
      if (inv.amount <= 0) continue;
      const covered = Math.min(pool, inv.amount);
      pool -= covered;
      if (inv.amount > covered) mine.push({ client: w.client, rowNumber: inv.rowNumber, invoice: inv.invoice, date: inv.date, billed: inv.amount, notTransferred: inv.amount - covered, ageDays: calendarDaysBetween(inv.date, asOf) });
    }
    open.push(...mine);
    let runTransferred = 0;
    let i = 0;
    let runBilled = 0;
    for (const t of w.transfers) {
      while (i < w.invoices.length && w.invoices[i].date <= t.date) runBilled += w.invoices[i++].amount;
      const before = runTransferred;
      runTransferred -= t.amount;
      const above = Math.min(-t.amount, runTransferred - Math.max(runBilled, before));
      if (runTransferred > runBilled && above > 0) {
        ahead.push({ client: w.client, rowNumber: t.rowNumber, date: t.date, reference: t.reference ?? "", description: t.description, amount: -t.amount, billedToDate: runBilled, transferredToDate: runTransferred, above });
      }
    }
    clients.push({
      client: w.client,
      carriedIn: w.carriedIn,
      moneyIn: w.moneyIn,
      otherOut: w.otherOut,
      transferredBefore: w.transferredBefore,
      balance: w.balance,
      invoiceCount: w.invoices.length,
      billed,
      transferCount: w.transfers.length,
      transferred,
      notTransferred: Math.max(billed - transferred, 0),
      aboveBilled: Math.max(transferred - billed, 0),
      oldestOpen: mine[0]?.date ?? "",
      oldestOpenDays: mine[0] ? mine[0].ageDays : null
    });
  }
  open.sort((a, b) => a.date === b.date ? a.rowNumber - b.rowNumber : a.date < b.date ? -1 : 1);
  ahead.sort((a, b) => a.date === b.date ? a.rowNumber - b.rowNumber : a.date < b.date ? -1 : 1);
  const figures = {
    asOf,
    from,
    words,
    clients,
    open,
    ahead,
    transfers,
    markedMoneyIn,
    unassigned,
    carriedTotal: sum(carried.map((c) => c.balance)),
    moneyInTotal,
    otherOutTotal,
    transferredBeforeTotal,
    transferTotal: sum(transfers.map((t) => -t.amount)),
    unassignedTransferTotal,
    unassignedTotal,
    trustTotal: sum([...carried.map((c) => c.balance), ...counted.map((t) => t.amount)]),
    billedTotal: sum(clients.map((c) => c.billed)),
    notTransferredTotal: sum(clients.map((c) => c.notTransferred)),
    aboveBilledTotal: sum(clients.map((c) => c.aboveBilled)),
    transactionCount: input.transactions.length,
    counted: counted.length,
    afterAsOf: input.transactions.length - counted.length,
    invoiceCount: input.invoices.length,
    invoicesCounted: invoices.length,
    invoicesBefore: input.invoices.filter((i) => from !== "" && i.date < from).length,
    invoicesAfter: input.invoices.filter((i) => i.date > asOf).length,
    transactionProblems: [...input.transactionProblems ?? []],
    invoiceProblems: [...input.invoiceProblems ?? []]
  };
  return { ...figures, checks: verifyEarnedFeesReport(input, figures) };
}
var DAY_MS2 = 864e5;
function utcDay(iso2) {
  const [y, m, d] = iso2.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS2);
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var firstOf = (list) => list.length ? `${list.length} off; first: ${list[0]}` : "";
function verifyEarnedFeesReport(input, r) {
  validate(input);
  const checks = new CheckList();
  const asOf = input.asOf;
  const from = input.from ?? "";
  const carried = input.carriedIn ?? [];
  const words = lawFeeWords(input.transferWords);
  const pattern = new RegExp(words.map(escapeRe).join("|"), "i");
  const marked = (t) => pattern.test(`${t.description} ${t.reference ?? ""}`.replace(/\s+/g, " "));
  checks.that("rows-read", "Every row of the trust list with data was read", r.transactionProblems.length === 0, `${r.transactionProblems.length} row(s) could not be read and are not in the report; first: row ${r.transactionProblems[0]?.rowNumber} (${r.transactionProblems[0]?.reason})`);
  checks.that("invoices-read", "Every row of the invoice list with data was read", r.invoiceProblems.length === 0, `${r.invoiceProblems.length} invoice row(s) could not be read and are not in the report; first: row ${r.invoiceProblems[0]?.rowNumber} (${r.invoiceProblems[0]?.reason})`);
  const inRange = input.transactions.filter((t) => !(t.date > asOf));
  checks.that(
    "rows-counted",
    "Trust rows in = rows on or before the as-of date + rows after it (count)",
    r.asOf === asOf && r.transactionCount === input.transactions.length && r.counted === inRange.length && r.afterAsOf === input.transactions.length - inRange.length,
    `${input.transactions.length} in, ${inRange.length} on or before ${asOf}; the report shows ${r.counted} and ${r.afterAsOf} after`
  );
  const invIn = input.invoices.filter((i) => !(i.date > asOf) && !(from !== "" && i.date < from));
  const invBefore = input.invoices.filter((i) => from !== "" && i.date < from).length;
  const invAfter = input.invoices.filter((i) => i.date > asOf).length;
  checks.that(
    "invoices-counted",
    from ? `Invoices in = before ${from} + counted + after ${asOf} (count)` : `Invoices in = counted + after ${asOf} (count)`,
    r.from === from && r.invoiceCount === input.invoices.length && r.invoicesCounted === invIn.length && r.invoicesBefore === invBefore && r.invoicesAfter === invAfter && invIn.length + invBefore + invAfter === input.invoices.length,
    `${input.invoices.length} in, ${invIn.length} counted; the report shows ${r.invoicesCounted}`
  );
  const second = /* @__PURE__ */ new Map();
  const at = (name) => {
    const key = lawClientKey(name);
    let s = second.get(key);
    if (!s) {
      s = { carried: 0n, balance: 0n, billed: 0n, transferred: 0n, invoices: [], transfers: [] };
      second.set(key, s);
    }
    return s;
  };
  for (const c of carried) {
    const s = at(c.client);
    s.carried = BigInt(c.balance);
    s.balance = BigInt(c.balance);
  }
  const transferRows = [];
  let moneyIn = 0n;
  let otherOut = 0n;
  let before = 0n;
  let unassignedTransfers = 0n;
  let unassigned = 0n;
  const unassignedRows = [];
  const markedIn = [];
  for (const t of inRange) {
    const key = lawClientKey(t.client);
    const amount = BigInt(t.amount);
    const fee = t.amount < 0 && marked(t);
    if (t.amount > 0 && marked(t)) markedIn.push(t.rowNumber);
    if (key === "") {
      unassigned += amount;
      unassignedRows.push(t.rowNumber);
    } else at(t.client).balance += amount;
    if (amount >= 0n) moneyIn += amount;
    else if (!fee) otherOut -= amount;
    else if (from !== "" && t.date < from) before -= amount;
    else {
      transferRows.push(t);
      if (key === "") unassignedTransfers -= amount;
      else {
        const s = at(t.client);
        s.transferred -= amount;
        s.transfers.push(t);
      }
    }
  }
  for (const inv of invIn) {
    const s = at(inv.client);
    s.billed += BigInt(inv.amount);
    s.invoices.push(inv);
  }
  const shownKeys = r.clients.map((c) => lawClientKey(c.client));
  const shown = new Map(r.clients.map((c) => [lawClientKey(c.client), c]));
  checks.that(
    "each-client-once",
    "Every client or matter in the two lists is in the report exactly once",
    shownKeys.length === second.size && new Set(shownKeys).size === shownKeys.length && shownKeys.every((k) => k !== "" && second.has(k)),
    `${second.size} in the lists, ${shownKeys.length} in the report`
  );
  const sameRows = (a, b) => a.length === b.length && [...a.map((x) => x.rowNumber)].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");
  checks.that("transfers-found", `The fee transfers are exactly the money-out rows that hold ${words.map((w) => `"${w}"`).join(" or ")}, dated ${from ? `from ${from} ` : ""}on or before ${asOf} (matched a second way)`, sameRows(r.transfers, transferRows.map((t) => t.rowNumber)) && r.words.join("\n") === words.join("\n"), `the second match finds ${transferRows.length}, the report shows ${r.transfers.length}`);
  const off = { billed: [], transferred: [], balance: [], split: [] };
  for (const [key, s] of second) {
    const c = shown.get(key);
    if (!c) continue;
    if (BigInt(c.billed) !== s.billed || c.invoiceCount !== s.invoices.length) off.billed.push(`${c.client}: ${formatUSD(Number(s.billed))} on the second pass, ${formatUSD(c.billed)} shown`);
    if (BigInt(c.transferred) !== s.transferred || c.transferCount !== s.transfers.length) off.transferred.push(`${c.client}: ${formatUSD(Number(s.transferred))} on the second pass, ${formatUSD(c.transferred)} shown`);
    if (BigInt(c.balance) !== s.balance || BigInt(c.carriedIn) !== s.carried) off.balance.push(`${c.client}: ${formatUSD(Number(s.balance))} on the second pass, ${formatUSD(c.balance)} shown`);
    const diff = s.billed - s.transferred;
    const notT2 = diff > 0n ? diff : 0n;
    const above2 = diff < 0n ? -diff : 0n;
    const shownSplit = BigInt(c.billed) - BigInt(c.transferred) === BigInt(c.notTransferred) - BigInt(c.aboveBilled);
    if (BigInt(c.notTransferred) !== notT2 || BigInt(c.aboveBilled) !== above2 || !shownSplit) off.split.push(`${c.client}: billed ${formatUSD(Number(s.billed))} less transferred ${formatUSD(Number(s.transferred))}`);
  }
  checks.that("client-billed", "Every client's fees billed re-add from its invoices (second pass)", off.billed.length === 0, firstOf(off.billed));
  checks.that("client-transferred", "Every client's fee transfers re-add from its trust rows (second pass)", off.transferred.length === 0, firstOf(off.transferred));
  checks.that("client-split", "For every client, billed less transferred = billed not transferred less transferred above billed, with at most one of the two above zero", off.split.length === 0, firstOf(off.split));
  checks.that("balances-readd", "Every client trust balance re-adds: carried-in balance + its rows on or before the as-of date (second pass)", off.balance.length === 0, firstOf(off.balance));
  const expectOpen = /* @__PURE__ */ new Map();
  for (const s of second.values()) {
    const diff = s.billed - s.transferred;
    let left = diff > 0n ? diff : 0n;
    const newestFirst = [...s.invoices].filter((i) => i.amount > 0).sort((a, b) => a.date === b.date ? b.rowNumber - a.rowNumber : a.date < b.date ? 1 : -1);
    for (const inv of newestFirst) {
      if (left <= 0n) break;
      const part = BigInt(inv.amount) < left ? BigInt(inv.amount) : left;
      expectOpen.set(inv.rowNumber, part);
      left -= part;
    }
  }
  const openOff = r.open.filter((o) => expectOpen.get(o.rowNumber) !== BigInt(o.notTransferred) || o.notTransferred > o.billed);
  checks.that(
    "open-invoices",
    "The amount billed and not transferred is on the newest invoices, each no more than its own amount (worked out newest first)",
    openOff.length === 0 && r.open.length === expectOpen.size && new Set(r.open.map((o) => o.rowNumber)).size === r.open.length,
    `the second way finds ${expectOpen.size} open invoice(s), the report shows ${r.open.length}${openOff[0] ? `; first off: row ${openOff[0].rowNumber}` : ""}`
  );
  const openByClient = /* @__PURE__ */ new Map();
  for (const o of r.open) openByClient.set(lawClientKey(o.client), (openByClient.get(lawClientKey(o.client)) ?? 0n) + BigInt(o.notTransferred));
  const openSumOff = r.clients.filter((c) => (openByClient.get(lawClientKey(c.client)) ?? 0n) !== BigInt(c.notTransferred));
  checks.that("open-sum", "Every client's open invoices add up to its billed not transferred", openSumOff.length === 0, `${openSumOff.length} off; first: ${openSumOff[0]?.client}`);
  const ageOff = r.open.filter((o) => o.ageDays !== utcDay(asOf) - utcDay(o.date));
  const oldestOff = r.clients.filter((c) => {
    const mine = r.open.filter((o) => lawClientKey(o.client) === lawClientKey(c.client));
    const oldest = mine.reduce((m, o) => m === "" || o.date < m ? o.date : m, "");
    return c.oldestOpen !== oldest || c.oldestOpenDays !== (oldest ? utcDay(asOf) - utcDay(oldest) : null);
  });
  checks.that("ages", `Every age is the days from the invoice date to ${asOf} (second way)`, ageOff.length === 0 && oldestOff.length === 0, `${ageOff.length + oldestOff.length} off; first: ${ageOff[0] ? `row ${ageOff[0].rowNumber}` : oldestOff[0]?.client}`);
  const expectAhead = /* @__PURE__ */ new Map();
  for (const s of second.values()) {
    const ordered = lawSortByDate(s.transfers);
    ordered.forEach((t, idx) => {
      const billedTo = s.invoices.filter((i) => i.date <= t.date).reduce((a, i) => a + BigInt(i.amount), 0n);
      const upTo = ordered.slice(0, idx + 1).reduce((a, x) => a - BigInt(x.amount), 0n);
      const prior = upTo + BigInt(t.amount);
      const floor = billedTo > prior ? billedTo : prior;
      const over = upTo - floor;
      if (upTo > billedTo && over > 0n) expectAhead.set(t.rowNumber, over < -BigInt(t.amount) ? over : -BigInt(t.amount));
    });
  }
  const aheadOff = r.ahead.filter((a) => expectAhead.get(a.rowNumber) !== BigInt(a.above));
  checks.that("ahead", "Every transfer that took a client's transfers above what was billed by its date is listed, with the part above (sums by date, a second way)", aheadOff.length === 0 && r.ahead.length === expectAhead.size, `the second way finds ${expectAhead.size}, the report shows ${r.ahead.length}`);
  checks.that("unassigned-listed", "The list of trust rows with no client or matter is complete", sameRows(r.unassigned, unassignedRows), `${unassignedRows.length} in the rows, ${r.unassigned.length} listed`);
  checks.that("marked-money-in", "Money-in rows holding a transfer word are listed and not counted as transfers", sameRows(r.markedMoneyIn, markedIn), `${markedIn.length} in the rows, ${r.markedMoneyIn.length} listed`);
  const allBilled = lawBigSum(invIn.map((i) => i.amount));
  const allTransfers = lawBigSum(transferRows.map((t) => -t.amount));
  const clientsBilled = lawBigSum(r.clients.map((c) => c.billed));
  const clientsTransferred = lawBigSum(r.clients.map((c) => c.transferred));
  const notT = lawBigSum(r.clients.map((c) => c.notTransferred));
  const above = lawBigSum(r.clients.map((c) => c.aboveBilled));
  checks.cents("billed-total", "Fees billed by client add up to the invoice list total (invoices counted, second pass)", Number(allBilled), Number(clientsBilled));
  checks.cents("billed-shown", "The billed total shown equals the invoice list total", Number(allBilled), r.billedTotal);
  checks.cents("transfer-total", "Fee transfers by client + fee transfers with no client = every fee transfer row (second pass)", Number(allTransfers), Number(clientsTransferred + BigInt(r.unassignedTransferTotal)));
  checks.cents("transfer-shown", "The fee transfer total shown equals every fee transfer row", Number(allTransfers), r.transferTotal);
  checks.cents("unassigned-transfers", "Fee transfers with no client or matter add up to their total", Number(unassignedTransfers), r.unassignedTransferTotal);
  checks.cents("not-transferred-total", "Billed not transferred adds up to its total", Number(notT), r.notTransferredTotal);
  checks.cents("above-total", "Transferred above billed adds up to its total", Number(above), r.aboveBilledTotal);
  checks.cents("net-total", "Billed − transferred (by client) = billed not transferred − transferred above billed", Number(allBilled - clientsTransferred), Number(notT - above));
  const trust = lawBigSum([...carried.map((c) => c.balance), ...inRange.map((t) => t.amount)]);
  const clientBalances = lawBigSum(r.clients.map((c) => c.balance));
  checks.cents("trust-total", "Carried-in balances + every trust row on or before the as-of date = trust balance (second pass)", Number(trust), r.trustTotal);
  checks.cents(
    "trust-movement",
    "Carried in + money in − other money out − fee transfers before the from date − fee transfers counted = trust balance",
    r.trustTotal,
    Number(BigInt(r.carriedTotal) + BigInt(r.moneyInTotal) - BigInt(r.otherOutTotal) - BigInt(r.transferredBeforeTotal) - BigInt(r.transferTotal))
  );
  checks.that(
    "movement-parts",
    "Money in, other money out, and fee transfers each re-add from the rows (second pass)",
    BigInt(r.moneyInTotal) === moneyIn && BigInt(r.otherOutTotal) === otherOut && BigInt(r.transferredBeforeTotal) === before && BigInt(r.carriedTotal) === lawBigSum(carried.map((c) => c.balance)),
    `money in ${formatUSD(Number(moneyIn))}, other out ${formatUSD(Number(otherOut))}, before the from date ${formatUSD(Number(before))} on the second pass`
  );
  checks.cents("balances-total", "Client trust balances + rows with no client or matter = trust balance", Number(trust), Number(clientBalances + BigInt(r.unassignedTotal)));
  checks.cents("unassigned-total", "Rows with no client or matter add up to their total", Number(unassigned), r.unassignedTotal);
  const aboveClients = r.clients.filter((c) => c.aboveBilled > 0);
  checks.that("none-above-billed", "No client's fee transfers are above its fees billed on the as-of date", aboveClients.length === 0, `${aboveClients.length} client(s), together ${formatUSD(Number(above))}; first: ${aboveClients[0]?.client}`, "warning");
  checks.that("none-ahead", "No fee transfer took a client's transfers above what was billed by its date", expectAhead.size === 0, `${expectAhead.size} transfer(s) listed`, "warning");
  const short = r.clients.filter((c) => c.notTransferred > 0 && c.balance < c.notTransferred);
  checks.that("balance-covers", "Every client's trust balance is at least its billed not transferred", short.length === 0, `${short.length} client(s) have less in trust than billed not transferred; first: ${short[0]?.client}`, "warning");
  checks.that("transfers-assigned", "Every fee transfer has a client or matter", unassignedTransfers === 0n && !transferRows.some((t) => lawClientKey(t.client) === ""), `${transferRows.filter((t) => lawClientKey(t.client) === "").length} fee transfer(s) have none and are in no client's figures`, "warning");
  checks.that("all-assigned", "Every trust row on or before the as-of date has a client or matter", unassignedRows.length === 0, `${unassignedRows.length} row(s) have none`, "warning");
  checks.that("no-marked-money-in", "No money-in row holds a transfer word", markedIn.length === 0, `${markedIn.length} money-in row(s) hold one and are not counted as transfers; first: row ${markedIn[0]}`, "warning");
  const trustKeys = /* @__PURE__ */ new Set([...carried.map((c) => lawClientKey(c.client)), ...inRange.map((t) => lawClientKey(t.client))]);
  const strangers = [...new Set(invIn.map((i) => lawClientKey(i.client)))].filter((k) => !trustKeys.has(k));
  checks.that("invoice-clients-in-trust", "Every client with an invoice has trust rows or a carried-in balance", strangers.length === 0, `${strangers.length} client(s) with invoices have none; first: ${shown.get(strangers[0] ?? "")?.client ?? strangers[0]}`, "warning");
  const numbers = /* @__PURE__ */ new Map();
  for (const inv of invIn) if (inv.invoice.trim() !== "") {
    const k = `${lawClientKey(inv.client)}
${inv.invoice.trim().toLowerCase()}`;
    numbers.set(k, (numbers.get(k) ?? 0) + 1);
  }
  const twice = [...numbers].filter(([, n]) => n > 1).map(([k]) => k.split("\n")[1]);
  checks.that("invoice-numbers-once", "No invoice number appears twice for the same client", twice.length === 0, `${twice.length} number(s) appear more than once; first: ${twice[0]}`, "warning");
  const later = input.transactions.filter((t) => t.date > asOf).length + invAfter;
  checks.that("none-after-as-of", "No trust row or invoice is dated after the as-of date", later === 0, `${later} row(s) are dated after ${asOf} and are left out`, "warning");
  checks.that("has-transfers", "At least one fee transfer was found in the trust list", transferRows.length > 0, "no money-out row holds a transfer word: check the words typed", "warning");
  return checks.all;
}
function earnedFeesTables(r) {
  return {
    settings: [
      ["Item", "Value"],
      ["As-of date", r.asOf],
      ["Invoices and fee transfers counted from", r.from || "the first row"],
      ["Words that mark a fee transfer", r.words.join(", ")],
      ["Trust rows on or before the as-of date", r.counted],
      ["Trust rows after the as-of date, left out", r.afterAsOf],
      ["Invoices counted", r.invoicesCounted],
      ["Invoices before the from date, left out", r.invoicesBefore],
      ["Invoices after the as-of date, left out", r.invoicesAfter]
    ],
    clients: [
      ["Client or matter", "Billed", "Transferred", "Billed not transferred", "Transferred above billed", "Oldest open invoice", "Days", "Trust balance"],
      ...r.clients.map((c) => [c.client, toDecimal(c.billed), toDecimal(c.transferred), toDecimal(c.notTransferred), toDecimal(c.aboveBilled), c.oldestOpen, c.oldestOpenDays ?? "", toDecimal(c.balance)]),
      ["Total", toDecimal(r.billedTotal), toDecimal(r.transferTotal - r.unassignedTransferTotal), toDecimal(r.notTransferredTotal), toDecimal(r.aboveBilledTotal), "", "", toDecimal(r.trustTotal - r.unassignedTotal)]
    ],
    open: [["Client or matter", "Row", "Invoice", "Invoice date", "Amount billed", "Not transferred", "Days"], ...r.open.map((o) => [o.client, o.rowNumber, o.invoice, o.date, toDecimal(o.billed), toDecimal(o.notTransferred), o.ageDays])],
    ahead: [
      ["Client or matter", "Row", "Date", "Reference", "Transfer", "Billed to that date", "Transferred to that date", "Above billed"],
      ...r.ahead.map((a) => [a.client, a.rowNumber, a.date, a.reference, toDecimal(a.amount), toDecimal(a.billedToDate), toDecimal(a.transferredToDate), toDecimal(a.above)])
    ],
    transfers: [["Row", "Date", "Reference", "Description", "Client or matter", "Transfer"], ...r.transfers.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, lawClientLabel(t.client), toDecimal(-t.amount)])],
    tieOut: [
      ["Line", "Amount"],
      ["Balances carried in", toDecimal(r.carriedTotal)],
      ["Money in", toDecimal(r.moneyInTotal)],
      ["Money out other than fee transfers", toDecimal(-r.otherOutTotal)],
      ...r.from ? [[`Fee transfers before ${r.from}`, toDecimal(-r.transferredBeforeTotal)]] : [],
      ["Fee transfers counted", toDecimal(-r.transferTotal)],
      ["Trust balance on the as-of date", toDecimal(r.trustTotal)],
      ["Client trust balances", toDecimal(r.trustTotal - r.unassignedTotal)],
      ["Rows with no client or matter", toDecimal(r.unassignedTotal)]
    ],
    unassigned: [["Row", "Date", "Reference", "Description", "Amount"], ...r.unassigned.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, toDecimal(t.amount)])]
  };
}

export {
  sheetRowChecks,
  sheetNormalizeHeader,
  sheetGuessColumns,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader,
  LAW_INVOICE_ROLES,
  LAW_INVOICE_LABELS,
  lawGuessInvoiceColumns,
  lawExtractInvoices,
  lawFeeWords,
  lawFeeWordsFromText,
  lawFeeHasWord,
  buildEarnedFeesReport,
  verifyEarnedFeesReport,
  earnedFeesTables
};
