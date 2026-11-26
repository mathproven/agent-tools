// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  LAW_INVOICE_LABELS,
  LAW_INVOICE_ROLES,
  buildEarnedFeesReport,
  earnedFeesTables,
  lawExtractInvoices,
  lawFeeWordsFromText,
  lawGuessInvoiceColumns,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader,
  sheetGuessColumns,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./earnedFees.mjs";
import {
  buildDormantReport,
  dormantReportTables,
  lawDormantPeriodText
} from "./dormantBalances.mjs";
import {
  CheckList,
  assertCents,
  failures,
  formatUSD,
  isIsoDate,
  lawAssertBalances,
  lawAssertTransactions,
  lawBigSum,
  lawBuildLedgers,
  lawClientKey,
  lawClientLabel,
  lawSortByDate,
  parseAmount,
  parseCivilDate,
  passedAll,
  sum,
  toDecimal,
  verifyBankStatement,
  warnings
} from "./money.mjs";

// packages/core/src/law/entries.ts
function lawAssertEntries(entries) {
  const seen = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.row)) throw new Error("Every entry needs a whole row number.");
    if (seen.has(e.row)) throw new Error(`Row ${e.row} appears twice in the entries.`);
    seen.add(e.row);
    if (e.date.trim() === "") throw new Error(`Row ${e.row} needs a date.`);
    if (!isIsoDate(e.date)) throw new Error(`Row ${e.row}: "${e.date}" is not a valid date.`);
    assertCents(e.received, `amount received on row ${e.row}`);
    assertCents(e.disbursed, `amount disbursed on row ${e.row}`);
    if (e.received < 0 || e.disbursed < 0) throw new Error(`Row ${e.row}: amounts are entered as positive numbers, in the received or the disbursed column.`);
    if (e.received === 0 && e.disbursed === 0) throw new Error(`Row ${e.row} needs an amount received or an amount disbursed.`);
    if (e.received > 0 && e.disbursed > 0) throw new Error(`Row ${e.row} has both an amount received and an amount disbursed. Enter them as two rows.`);
  }
}
function lawEntriesFromTxns(transactions) {
  const entries = [];
  const problems = [];
  for (const t of transactions) {
    if (t.amount === 0) {
      problems.push({ rowNumber: t.rowNumber, reason: "the amount is zero" });
      continue;
    }
    entries.push({ row: t.rowNumber, date: t.date, reference: t.reference ?? "", description: t.description, client: t.client, received: t.amount > 0 ? t.amount : 0, disbursed: t.amount < 0 ? -t.amount : 0 });
  }
  return { entries, problems };
}
function lawEntriesInDateOrder(entries) {
  return entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? -1 : 1).map((x) => x.e);
}

// packages/core/src/law/ledgerCard.ts
function validate(input) {
  assertCents(input.opening, "opening balance");
  lawAssertEntries(input.entries);
}
function buildTrustCard(input) {
  validate(input);
  let running = input.opening;
  const lines = lawEntriesInDateOrder(input.entries).map((e, i) => {
    running = assertCents(running + e.received - e.disbursed, "ledger balance");
    return { ...e, line: i + 1, balance: running };
  });
  const belowZero = [];
  if (input.opening < 0) belowZero.push({ line: 0, date: "", balance: input.opening });
  for (const l of lines) if (l.balance < 0) belowZero.push({ line: l.line, date: l.date, balance: l.balance });
  const figures = {
    lines,
    receiptsTotal: sum(input.entries.map((e) => e.received)),
    disbursementsTotal: sum(input.entries.map((e) => e.disbursed)),
    closing: running,
    lowest: lines.reduce((low, l) => l.balance < low ? l.balance : low, input.opening),
    belowZero
  };
  return { ...figures, checks: verifyTrustCard(input, figures) };
}
function verifyTrustCard(input, r) {
  validate(input);
  const checks = new CheckList();
  const ordered = lawEntriesInDateOrder(input.entries);
  checks.equal("line-count", "Entries typed = lines on the card (count)", input.entries.length, r.lines.length);
  const placed = r.lines.length === ordered.length && r.lines.every((l, i) => {
    const e = ordered[i];
    return l.line === i + 1 && l.row === e.row && l.date === e.date && l.received === e.received && l.disbursed === e.disbursed;
  });
  checks.that("each-once", "Every entry is on the card once, with its own date and amount, in date order", placed);
  let balance = BigInt(input.opening);
  let lowest = balance;
  let readds = r.lines.length === ordered.length;
  const expectBelow = balance < 0n ? [`0||${balance}`] : [];
  ordered.forEach((e, i) => {
    balance += BigInt(e.received) - BigInt(e.disbursed);
    if (balance < lowest) lowest = balance;
    if (balance < 0n) expectBelow.push(`${i + 1}|${e.date}|${balance}`);
    const shown = r.lines[i];
    if (!shown || BigInt(shown.balance) !== balance) readds = false;
  });
  checks.that("running-readd", "Every balance on the card re-adds from the opening balance (second pass)", readds);
  const receipts = lawBigSum(input.entries.map((e) => e.received));
  const disbursements = lawBigSum(input.entries.map((e) => e.disbursed));
  checks.cents("receipts-total", "Amounts received add up to the receipts total", Number(receipts), r.receiptsTotal);
  checks.cents("disbursements-total", "Amounts disbursed add up to the disbursements total", Number(disbursements), r.disbursementsTotal);
  checks.cents("closing", "Opening balance + receipts − disbursements = closing balance", Number(BigInt(input.opening) + receipts - disbursements), r.closing);
  checks.that("closing-last", "The closing balance is the balance after the last line", BigInt(r.closing) === balance, `the last line carries ${formatUSD(Number(balance))}`);
  checks.cents("lowest", "The lowest balance shown matches the second pass", Number(lowest), r.lowest);
  const shownBelow = r.belowZero.map((d) => `${d.line}|${d.date}|${d.balance}`);
  checks.that("below-zero-listed", "The list of lines below zero matches a second walk of the card", expectBelow.length === shownBelow.length && expectBelow.every((x, i) => x === shownBelow[i]), `second walk found ${expectBelow.length}, the list shows ${shownBelow.length}`);
  const first = expectBelow[0]?.split("|");
  checks.that(
    "never-below-zero",
    "The balance never goes below zero",
    expectBelow.length === 0,
    first ? `${expectBelow.length} point(s) below zero; first: ${first[0] === "0" ? "the opening balance" : `line ${first[0]} on ${first[1]}`} at ${formatUSD(Number(first[2]))}` : void 0
  );
  checks.that("named", "The card names a client or matter", input.client.trim() !== "", "no client or matter name was typed", "warning");
  checks.that("has-entries", "At least one entry was typed", input.entries.length > 0, "the card has an opening balance and no lines", "warning");
  return checks.all;
}
function trustCardTables(input, r) {
  const amount = (cents) => cents === 0 ? "" : toDecimal(cents);
  return {
    card: [
      ["Line", "Date", "Reference", "Description", "Receipts", "Disbursements", "Balance"],
      ["", "", "", "Opening balance", "", "", toDecimal(input.opening)],
      ...r.lines.map((l) => [l.line, l.date, l.reference, l.description, amount(l.received), amount(l.disbursed), toDecimal(l.balance)]),
      ["", "", "", "Totals and closing balance", toDecimal(r.receiptsTotal), toDecimal(r.disbursementsTotal), toDecimal(r.closing)]
    ],
    summary: [
      ["Item", "Amount"],
      ["Opening balance", toDecimal(input.opening)],
      ["Plus receipts", toDecimal(r.receiptsTotal)],
      ["Less disbursements", toDecimal(-r.disbursementsTotal)],
      ["Closing balance", toDecimal(r.closing)],
      ["Lowest balance on the card", toDecimal(r.lowest)]
    ],
    belowZero: [["Line", "Date", "Balance"], ...r.belowZero.map((d) => [d.line === 0 ? "Opening balance" : d.line, d.date, toDecimal(d.balance)])]
  };
}

// packages/core/src/law/cashJournal.ts
function lawCheckNumber(reference) {
  const m = /^(?:(?:check|chk|ck|no)\.?\s*)*#?\s*(\d{1,6})$/i.exec(reference.trim());
  return m ? Number(m[1]) : null;
}
function validate2(input) {
  assertCents(input.opening, "opening balance");
  lawAssertEntries(input.entries);
}
function buildTrustCashJournal(input) {
  validate2(input);
  let running = input.opening;
  const lines = lawEntriesInDateOrder(input.entries).map((e, i) => {
    running = assertCents(running + e.received - e.disbursed, "journal balance");
    return { ...e, line: i + 1, balance: running };
  });
  const byClient = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const key = lawClientKey(l.client);
    let group = byClient.get(key);
    if (!group) {
      group = { client: key === "" ? "" : lawClientLabel(l.client), entries: 0, receipts: 0, disbursements: 0, net: 0 };
      byClient.set(key, group);
    }
    group.entries += 1;
    group.receipts = assertCents(group.receipts + l.received, "client receipts");
    group.disbursements = assertCents(group.disbursements + l.disbursed, "client disbursements");
    group.net = group.receipts - group.disbursements;
  }
  const carried = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const number = l.disbursed > 0 ? lawCheckNumber(l.reference) : null;
    if (number === null) continue;
    carried.set(number, [...carried.get(number) ?? [], l.line]);
  }
  const numbers = [...carried.keys()].sort((a, b) => a - b);
  const missingChecks = [];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] > 1) missingChecks.push({ from: numbers[i - 1] + 1, to: numbers[i] - 1 });
  }
  const figures = {
    lines,
    receiptsTotal: sum(input.entries.map((e) => e.received)),
    disbursementsTotal: sum(input.entries.map((e) => e.disbursed)),
    closing: running,
    clients: [...byClient.values()],
    checkNumbersUsed: [...carried.values()].reduce((n, at) => n + at.length, 0),
    repeatedChecks: numbers.filter((n) => carried.get(n).length > 1).map((n) => ({ number: n, lines: carried.get(n) })),
    missingChecks,
    belowZero: lines.filter((l) => l.balance < 0).map((l) => ({ line: l.line, date: l.date, balance: l.balance }))
  };
  return { ...figures, checks: verifyTrustCashJournal(input, figures) };
}
function verifyTrustCashJournal(input, r) {
  validate2(input);
  const checks = new CheckList();
  const ordered = lawEntriesInDateOrder(input.entries);
  checks.equal("line-count", "Entries in = journal lines out (count)", input.entries.length, r.lines.length);
  const placed = r.lines.length === ordered.length && r.lines.every((l, i) => {
    const e = ordered[i];
    return l.line === i + 1 && l.row === e.row && l.date === e.date && l.received === e.received && l.disbursed === e.disbursed && lawClientKey(l.client) === lawClientKey(e.client);
  });
  checks.that("each-once", "Every entry is in the journal once, with its own date, amount, and client, in date order", placed);
  let balance = BigInt(input.opening);
  let readds = r.lines.length === ordered.length;
  const expectBelow = [];
  ordered.forEach((e, i) => {
    balance += BigInt(e.received) - BigInt(e.disbursed);
    if (balance < 0n) expectBelow.push(`${i + 1}|${e.date}|${balance}`);
    const shown = r.lines[i];
    if (!shown || BigInt(shown.balance) !== balance) readds = false;
  });
  checks.that("running-readd", "Every journal balance re-adds from the opening balance (second pass)", readds);
  const receipts = lawBigSum(input.entries.map((e) => e.received));
  const disbursements = lawBigSum(input.entries.map((e) => e.disbursed));
  checks.cents("receipts-total", "Amounts received add up to the receipts total", Number(receipts), r.receiptsTotal);
  checks.cents("disbursements-total", "Amounts disbursed add up to the disbursements total", Number(disbursements), r.disbursementsTotal);
  checks.cents("closing", "Opening balance + receipts − disbursements = closing balance", Number(BigInt(input.opening) + receipts - disbursements), r.closing);
  checks.that("closing-last", "The closing balance is the balance after the last line", BigInt(r.closing) === balance, `the last line carries ${formatUSD(Number(balance))}`);
  const groups = /* @__PURE__ */ new Map();
  for (let i = input.entries.length - 1; i >= 0; i--) {
    const e = input.entries[i];
    const key = lawClientKey(e.client);
    const g = groups.get(key) ?? { entries: 0, receipts: 0n, disbursements: 0n };
    g.entries += 1;
    g.receipts += BigInt(e.received);
    g.disbursements += BigInt(e.disbursed);
    groups.set(key, g);
  }
  const shownKeys = r.clients.map((c) => lawClientKey(c.client));
  const groupsMatch = new Set(shownKeys).size === shownKeys.length && shownKeys.length === groups.size && r.clients.every((c) => {
    const g = groups.get(lawClientKey(c.client));
    return g !== void 0 && g.entries === c.entries && g.receipts === BigInt(c.receipts) && g.disbursements === BigInt(c.disbursements) && BigInt(c.net) === g.receipts - g.disbursements;
  });
  checks.that("clients-readd", "Every client subtotal matches a second grouping of the entries", groupsMatch);
  checks.cents("clients-receipts", "Client receipts subtotals add up to the journal receipts total", Number(receipts), Number(lawBigSum(r.clients.map((c) => c.receipts))));
  checks.cents("clients-disbursements", "Client disbursements subtotals add up to the journal disbursements total", Number(disbursements), Number(lawBigSum(r.clients.map((c) => c.disbursements))));
  checks.cents("clients-net", "Client net changes add up to closing balance − opening balance", Number(balance - BigInt(input.opening)), Number(lawBigSum(r.clients.map((c) => c.net))));
  const count2 = /* @__PURE__ */ new Map();
  ordered.forEach((e, i) => {
    const number = e.disbursed > 0 ? lawCheckNumber(e.reference) : null;
    if (number !== null) count2.set(number, [...count2.get(number) ?? [], i + 1]);
  });
  const used = [...count2.keys()];
  const low = used.reduce((m, n) => n < m ? n : m, Number.MAX_SAFE_INTEGER);
  const high = used.reduce((m, n) => n > m ? n : m, 0);
  const expectedMissing = used.length ? high - low + 1 - used.length : 0;
  const gapsOk = r.missingChecks.every((g) => Number.isSafeInteger(g.from) && Number.isSafeInteger(g.to) && g.from <= g.to && count2.has(g.from - 1) && count2.has(g.to + 1) && used.every((n) => n < g.from || n > g.to)) && r.missingChecks.reduce((n, g) => n + (g.to - g.from + 1), 0) === expectedMissing;
  const expectRepeats = used.filter((n) => count2.get(n).length > 1).sort((a, b) => a - b).map((n) => `${n}:${count2.get(n).join(",")}`);
  const repeatsOk = expectRepeats.length === r.repeatedChecks.length && r.repeatedChecks.every((c, i) => `${c.number}:${c.lines.join(",")}` === expectRepeats[i]);
  const usedCount = [...count2.values()].reduce((n, at) => n + at.length, 0);
  checks.that("checks-listed", "The check numbers used more than once and the numbers missing from the run match a second count", gapsOk && repeatsOk && r.checkNumbersUsed === usedCount, `second count: ${expectRepeats.length} repeated, ${expectedMissing} missing`);
  const shownBelow = r.belowZero.map((d) => `${d.line}|${d.date}|${d.balance}`);
  checks.that("below-zero-listed", "The list of lines below zero matches a second walk of the journal", expectBelow.length === shownBelow.length && expectBelow.every((x, i) => x === shownBelow[i]), `second walk found ${expectBelow.length}, the list shows ${shownBelow.length}`);
  checks.that("never-below-zero", "The journal balance never goes below zero", expectBelow.length === 0, `${expectBelow.length} line(s) listed`, "warning");
  const unassigned = input.entries.filter((e) => lawClientKey(e.client) === "").length;
  checks.that("all-assigned", "Every entry has a client or matter", unassigned === 0, `${unassigned} entr${unassigned === 1 ? "y has" : "ies have"} none`, "warning");
  checks.that("no-repeated-checks", "No check number is used more than once", expectRepeats.length === 0, `${expectRepeats.length} number(s) listed`, "warning");
  checks.that("no-missing-checks", "No check number is missing between the lowest and the highest used", expectedMissing === 0, `${expectedMissing} number(s) not in the journal`, "warning");
  checks.that("has-entries", "At least one entry was typed or imported", input.entries.length > 0, "the journal has an opening balance and no lines", "warning");
  return checks.all;
}
function trustCheckGapLabel(gap) {
  return gap.from === gap.to ? String(gap.from) : `${gap.from} to ${gap.to}`;
}
function trustCashTables(input, r) {
  const amount = (cents) => cents === 0 ? "" : toDecimal(cents);
  return {
    journal: [
      ["Line", "Date", "Reference", "Description", "Client or matter", "Receipts", "Disbursements", "Balance"],
      ["", "", "", "Opening balance", "", "", "", toDecimal(input.opening)],
      ...r.lines.map((l) => [l.line, l.date, l.reference, l.description, lawClientLabel(l.client), amount(l.received), amount(l.disbursed), toDecimal(l.balance)]),
      ["", "", "", "Totals and closing balance", "", toDecimal(r.receiptsTotal), toDecimal(r.disbursementsTotal), toDecimal(r.closing)]
    ],
    clients: [
      ["Client or matter", "Entries", "Receipts", "Disbursements", "Net change"],
      ...r.clients.map((c) => [lawClientLabel(c.client), c.entries, toDecimal(c.receipts), toDecimal(c.disbursements), toDecimal(c.net)]),
      ["Total", r.lines.length, toDecimal(sum(r.clients.map((c) => c.receipts))), toDecimal(sum(r.clients.map((c) => c.disbursements))), toDecimal(sum(r.clients.map((c) => c.net)))]
    ],
    summary: [
      ["Item", "Amount"],
      ["Opening balance", toDecimal(input.opening)],
      ["Plus receipts", toDecimal(r.receiptsTotal)],
      ["Less disbursements", toDecimal(-r.disbursementsTotal)],
      ["Closing balance", toDecimal(r.closing)]
    ],
    checkNumbers: [
      ["Finding", "Check number", "Journal lines"],
      ...r.repeatedChecks.map((c) => ["Used more than once", String(c.number), c.lines.join(", ")]),
      ...r.missingChecks.map((g) => ["Not in the journal", trustCheckGapLabel(g), ""])
    ],
    belowZero: [["Line", "Date", "Balance"], ...r.belowZero.map((d) => [d.line, d.date, toDecimal(d.balance)])]
  };
}

// packages/core/src/law/rebuild.ts
function validate3(input) {
  const { statement, clients } = input;
  assertCents(statement.openingBalance, "opening balance");
  assertCents(statement.closingBalance, "closing balance");
  if (clients.length !== statement.transactions.length) throw new Error(`There are ${statement.transactions.length} bank transactions but ${clients.length} client assignments.`);
  lawAssertBalances(input.openingBalances ?? [], "opening balance");
}
var asTxns = (input) => input.statement.transactions.map((t, i) => ({ rowNumber: i + 1, date: t.date, description: t.description, client: input.clients[i] ?? "", amount: t.amount }));
function rebuildTrustLedgers(input) {
  validate3(input);
  const opening = input.openingBalances ?? [];
  const txns = asTxns(input);
  const ledgers = lawBuildLedgers(txns, opening).filter((l) => lawClientKey(l.client) !== "");
  let running = input.statement.openingBalance;
  const journal = txns.map((t) => {
    running = assertCents(running + t.amount, "journal balance");
    return { line: t.rowNumber, date: t.date, description: t.description, client: lawClientKey(t.client) === "" ? "" : lawClientLabel(t.client), amount: t.amount, balance: running };
  });
  const figures = {
    ledgers,
    journal,
    unassigned: journal.filter((j) => j.client === ""),
    openingLedgerTotal: sum(opening.map((b) => b.balance)),
    ledgerTotal: sum(ledgers.map((l) => l.closing)),
    journalClosing: running,
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyTrustRebuild(input, figures) };
}
function verifyTrustRebuild(input, r) {
  validate3(input);
  const checks = new CheckList();
  const { statement } = input;
  const opening = input.openingBalances ?? [];
  for (const c of verifyBankStatement(statement)) checks.add({ ...c, id: `bank-${c.id}`, label: `Bank statement: ${c.label}` });
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the ledgers; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const seen = /* @__PURE__ */ new Map();
  let wrong = 0;
  for (const ledger of r.ledgers) {
    for (const e of ledger.entries) {
      seen.set(e.rowNumber, (seen.get(e.rowNumber) ?? 0) + 1);
      const t = statement.transactions[e.rowNumber - 1];
      if (!t || t.amount !== e.amount || t.date !== e.date || lawClientKey(input.clients[e.rowNumber - 1] ?? "") !== lawClientKey(ledger.client) || lawClientKey(ledger.client) === "") wrong++;
    }
  }
  const missing = statement.transactions.filter((_, i) => !seen.has(i + 1)).length;
  const repeated = [...seen.values()].filter((n) => n > 1).length;
  checks.that("each-once", "Every bank transaction appears in exactly one client ledger", missing === 0 && repeated === 0 && wrong === 0, `${missing} not in any ledger, ${repeated} in more than one, ${wrong} altered or under the wrong client`);
  const unassigned = input.clients.filter((c) => lawClientKey(c) === "").length;
  checks.that("unassigned-listed", "The list of transactions with no client or matter is complete", r.unassigned.length === unassigned && r.unassigned.every((j) => lawClientKey(input.clients[j.line - 1] ?? "") === ""), `${unassigned} in the input, ${r.unassigned.length} listed`);
  const openingByKey = new Map(opening.map((b) => [lawClientKey(b.client), b.balance]));
  let ledgersOk = opening.every((b) => r.ledgers.some((l) => lawClientKey(l.client) === lawClientKey(b.client)));
  let total = 0n;
  for (const ledger of r.ledgers) {
    let bal2 = BigInt(openingByKey.get(lawClientKey(ledger.client)) ?? 0);
    if (BigInt(ledger.opening) !== bal2) ledgersOk = false;
    for (const e of ledger.entries) {
      bal2 += BigInt(e.amount);
      if (BigInt(e.balance) !== bal2) ledgersOk = false;
    }
    if (BigInt(ledger.closing) !== bal2) ledgersOk = false;
    total += bal2;
  }
  checks.that("ledgers-readd", "Every ledger re-adds: opening balance + its entries = each running balance and the closing balance (second pass)", ledgersOk);
  checks.cents("ledger-total", "The ledger total shown = the ledger closing balances added a second way", Number(total), r.ledgerTotal);
  const openingTotal = lawBigSum(opening.map((b) => b.balance));
  checks.cents("opening-ledgers", "Client opening balances add up to the bank opening balance", statement.openingBalance, Number(openingTotal));
  checks.that("opening-shown", "The opening ledger total shown matches the second pass", BigInt(r.openingLedgerTotal) === openingTotal);
  checks.cents("ledgers-closing", "Sum of client ledgers = bank closing balance", statement.closingBalance, Number(total));
  let bal = BigInt(statement.openingBalance);
  let journalOk = r.journal.length === statement.transactions.length;
  statement.transactions.forEach((t, i) => {
    bal += BigInt(t.amount);
    const j = r.journal[i];
    if (!j || j.line !== i + 1 || j.amount !== t.amount || j.date !== t.date || BigInt(j.balance) !== bal || lawClientKey(j.client) !== lawClientKey(input.clients[i] ?? "")) journalOk = false;
  });
  checks.that("journal-readd", "The trust journal lists every bank transaction once and its running balance re-adds", journalOk && BigInt(r.journalClosing) === bal);
  checks.cents("journal-closing", "Trust journal closing balance = bank closing balance", statement.closingBalance, Number(bal));
  const negative = r.ledgers.filter((l) => l.closing < 0);
  checks.that("no-negative", "No client ledger closes below zero", negative.length === 0, `${negative.length} ledger(s) close below zero; first: ${negative[0]?.client} at ${formatUSD(negative[0]?.closing ?? 0)}`, "warning");
  return checks.all;
}
function trustRebuildTables(input, r) {
  return {
    summary: [
      ["Client or matter", "Opening balance", "Transactions", "Net change", "Closing balance"],
      ...r.ledgers.map((l) => [l.client, toDecimal(l.opening), l.entries.length, toDecimal(l.closing - l.opening), toDecimal(l.closing)]),
      ["Sum of client ledgers", toDecimal(r.openingLedgerTotal), r.ledgers.reduce((n, l) => n + l.entries.length, 0), toDecimal(r.ledgerTotal - r.openingLedgerTotal), toDecimal(r.ledgerTotal)],
      ["Bank statement", toDecimal(input.statement.openingBalance), input.statement.transactions.length, toDecimal(input.statement.closingBalance - input.statement.openingBalance), toDecimal(input.statement.closingBalance)]
    ],
    journal: [
      ["Line", "Date", "Description", "Client or matter", "Amount", "Balance"],
      ["", "", "Opening balance", "", "", toDecimal(input.statement.openingBalance)],
      ...r.journal.map((j) => [j.line, j.date, j.description, j.client || "(no client or matter)", toDecimal(j.amount), toDecimal(j.balance)])
    ],
    ledgers: [
      ["Client or matter", "Date", "Description", "Amount", "Balance"],
      ...r.ledgers.flatMap((l) => [[l.client, "", "Opening balance", "", toDecimal(l.opening)], ...l.entries.map((e) => [l.client, e.date, e.description, toDecimal(e.amount), toDecimal(e.balance)])])
    ]
  };
}

// packages/core/src/law/scanner.ts
function validate4(input) {
  lawAssertTransactions(input.transactions);
  lawAssertBalances(input.openingBalances ?? [], "opening balance");
  if (input.firmCeiling !== void 0) {
    assertCents(input.firmCeiling, "firm funds ceiling");
    if (input.firmCeiling < 0) throw new Error("The firm funds ceiling cannot be below zero.");
    if (!input.firmLedger || lawClientKey(input.firmLedger) === "") throw new Error("Name the firm funds ledger the ceiling applies to.");
  }
}
function endOfDay(ledger) {
  const out = [{ date: "", balance: ledger.opening }];
  for (const e of ledger.entries) {
    const last = out[out.length - 1];
    if (last.date === e.date) last.balance = e.balance;
    else out.push({ date: e.date, balance: e.balance });
  }
  return out;
}
function scanTrustLedgers(input) {
  validate4(input);
  const opening = input.openingBalances ?? [];
  const ledgers = lawBuildLedgers(input.transactions, opening);
  const firmKey = input.firmLedger ? lawClientKey(input.firmLedger) : "";
  const negatives = [];
  const overCeiling = [];
  for (const ledger of ledgers) {
    const key = lawClientKey(ledger.client);
    if (key === "") continue;
    for (const d of endOfDay(ledger)) {
      if (d.balance < 0) negatives.push({ client: ledger.client, date: d.date, balance: d.balance });
      if (input.firmCeiling !== void 0 && key === firmKey && d.balance > input.firmCeiling) overCeiling.push({ date: d.date, balance: d.balance, over: d.balance - input.firmCeiling });
    }
  }
  negatives.sort((a, b) => a.date === b.date ? 0 : a.date < b.date ? -1 : 1);
  const openingTotal = sum(opening.map((b) => b.balance));
  const days = [];
  let running = openingTotal;
  for (const t of lawSortByDate(input.transactions)) {
    running = assertCents(running + t.amount, "account balance");
    const last = days[days.length - 1];
    if (last && last.date === t.date) {
      last.movement += t.amount;
      last.accountBalance = running;
    } else days.push({ date: t.date, movement: t.amount, accountBalance: running });
  }
  const figures = {
    ledgers,
    unassigned: lawSortByDate(input.transactions.filter((t) => lawClientKey(t.client) === "")),
    negatives,
    overCeiling,
    days,
    openingTotal,
    closingTotal: running,
    transactionCount: input.transactions.length,
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyTrustScan(input, figures) };
}
function verifyTrustScan(input, r) {
  validate4(input);
  const checks = new CheckList();
  const opening = input.openingBalances ?? [];
  const sorted = lawSortByDate(input.transactions);
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the scan; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const byRow = new Map(input.transactions.map((t) => [t.rowNumber, t]));
  const placed = [];
  let misplaced = 0;
  for (const ledger of r.ledgers) {
    for (const e of ledger.entries) {
      placed.push(e.rowNumber);
      const t = byRow.get(e.rowNumber);
      if (!t || t.amount !== e.amount || t.date !== e.date || lawClientKey(t.client) !== lawClientKey(ledger.client)) misplaced++;
    }
  }
  checks.equal("count", "Transactions in = ledger entries out (count)", input.transactions.length, placed.length);
  checks.that("each-once", "Every transaction is in exactly one ledger, under its own client or matter", new Set(placed).size === placed.length && placed.length === input.transactions.length && misplaced === 0, `${placed.length - new Set(placed).size} repeated, ${misplaced} misplaced or altered`);
  checks.that("count-shown", "The transaction count shown matches the input", r.transactionCount === input.transactions.length);
  let ledgerMathOk = true;
  for (const ledger of r.ledgers) {
    let bal = BigInt(ledger.opening);
    for (const e of ledger.entries) {
      bal += BigInt(e.amount);
      if (BigInt(e.balance) !== bal) ledgerMathOk = false;
    }
    if (BigInt(ledger.closing) !== bal) ledgerMathOk = false;
  }
  const openingByKey = new Map(opening.map((b) => [lawClientKey(b.client), b.balance]));
  const openingsOk = r.ledgers.every((l) => l.opening === (openingByKey.get(lawClientKey(l.client)) ?? 0)) && opening.every((b) => r.ledgers.some((l) => lawClientKey(l.client) === lawClientKey(b.client)));
  checks.that("ledgers-readd", "Every ledger re-adds: opening balance + its entries = each running balance and the closing balance", ledgerMathOk && openingsOk);
  const dates = [...new Set(sorted.map((t) => t.date))];
  const openingTotal = lawBigSum(opening.map((b) => b.balance));
  let account = openingTotal;
  let badDates = 0;
  let firstBad = "";
  let pointer = 0;
  const shown = new Map(r.days.map((d) => [d.date, d]));
  for (const date of dates) {
    let movement = 0n;
    while (pointer < sorted.length && sorted[pointer].date === date) movement += BigInt(sorted[pointer++].amount);
    account += movement;
    let ledgerTotal = 0n;
    for (const ledger of r.ledgers) {
      let bal = ledger.opening;
      for (const e of ledger.entries) {
        if (e.date > date) break;
        bal = e.balance;
      }
      ledgerTotal += BigInt(bal);
    }
    const day = shown.get(date);
    if (ledgerTotal !== account || !day || BigInt(day.accountBalance) !== account || BigInt(day.movement) !== movement) {
      badDates++;
      if (!firstBad) firstBad = `${date}: ledgers ${formatUSD(Number(ledgerTotal))}, account ${formatUSD(Number(account))}`;
    }
  }
  checks.that("daily-readd", "At every date, the client ledger balances add up to the account balance (second pass)", badDates === 0 && r.days.length === dates.length, `${badDates} date(s) off; first: ${firstBad}`);
  checks.cents("opening-total", "Opening balances add up to the opening total shown", Number(openingTotal), r.openingTotal);
  checks.cents("closing-total", "Opening total + all transactions = closing total = sum of ledger closing balances", Number(account), r.closingTotal);
  checks.cents("closing-ledgers", "Ledger closing balances add up to the closing total", Number(lawBigSum(r.ledgers.map((l) => l.closing))), r.closingTotal);
  const firmKey = input.firmLedger ? lawClientKey(input.firmLedger) : "";
  const balance = /* @__PURE__ */ new Map();
  const expectNeg = [];
  const expectOver = [];
  const note = (key, date) => {
    const bal = balance.get(key);
    if (bal < 0n) expectNeg.push(`${key}|${date}|${bal}`);
    if (input.firmCeiling !== void 0 && key === firmKey && bal > BigInt(input.firmCeiling)) expectOver.push(`${date}|${bal}`);
  };
  for (const b of opening) {
    balance.set(lawClientKey(b.client), BigInt(b.balance));
    note(lawClientKey(b.client), "");
  }
  for (let i = 0; i < sorted.length; ) {
    const date = sorted[i].date;
    const touched = /* @__PURE__ */ new Set();
    for (; i < sorted.length && sorted[i].date === date; i++) {
      const key = lawClientKey(sorted[i].client);
      if (!balance.has(key)) {
        balance.set(key, 0n);
      }
      balance.set(key, balance.get(key) + BigInt(sorted[i].amount));
      touched.add(key);
    }
    for (const key of touched) if (key !== "") note(key, date);
  }
  const same = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  checks.that("negatives-listed", "The list of dates below zero matches a second walk of every client balance", same(expectNeg, r.negatives.map((n) => `${lawClientKey(n.client)}|${n.date}|${n.balance}`)), `second walk found ${expectNeg.length}, the list shows ${r.negatives.length}`);
  checks.that("ceiling-listed", "The list of dates above the firm funds ceiling matches a second walk", same(expectOver, r.overCeiling.map((o) => `${o.date}|${o.balance}`)) && r.overCeiling.every((o) => input.firmCeiling !== void 0 && o.over === o.balance - input.firmCeiling), `second walk found ${expectOver.length}, the list shows ${r.overCeiling.length}`);
  const unassigned = input.transactions.filter((t) => lawClientKey(t.client) === "").map((t) => t.rowNumber);
  checks.that("unassigned-listed", "The list of transactions with no client or matter is complete", same(unassigned.map(String), r.unassigned.map((t) => String(t.rowNumber))), `${unassigned.length} in the input, ${r.unassigned.length} listed`);
  checks.that("no-negative", "No client ledger ends a day below zero", expectNeg.length === 0, `${expectNeg.length} date(s) listed`, "warning");
  checks.that("all-assigned", "Every transaction has a client or matter", unassigned.length === 0, `${unassigned.length} transaction(s) have none`, "warning");
  if (input.firmCeiling !== void 0) {
    checks.that("firm-ledger-found", "The firm funds ledger named was found in the file", balance.has(firmKey), `no transactions or opening balance for "${input.firmLedger}"`, "warning");
    checks.that("under-ceiling", `The firm funds ledger stays at or under the ceiling typed (${formatUSD(input.firmCeiling)})`, expectOver.length === 0, `${expectOver.length} date(s) listed`, "warning");
  }
  return checks.all;
}
function trustLedgerRows(ledger) {
  return [
    ["Date", "Reference", "Description", "Amount", "Balance"],
    ["", "", "Opening balance", "", toDecimal(ledger.opening)],
    ...ledger.entries.map((e) => [e.date, e.reference, e.description, toDecimal(e.amount), toDecimal(e.balance)])
  ];
}
function trustScanTables(r) {
  return {
    summary: [
      ["Client or matter", "Opening balance", "Transactions", "Net change", "Closing balance", "Lowest end-of-day balance"],
      ...r.ledgers.map((l) => [lawClientLabel(l.client), toDecimal(l.opening), l.entries.length, toDecimal(l.closing - l.opening), toDecimal(l.closing), toDecimal(Math.min(...endOfDay(l).map((d) => d.balance)))]),
      ["Total", toDecimal(r.openingTotal), r.transactionCount, toDecimal(r.closingTotal - r.openingTotal), toDecimal(r.closingTotal), ""]
    ],
    negatives: [["Client or matter", "Date", "End-of-day balance"], ...r.negatives.map((n) => [n.client, n.date || "Opening balance", toDecimal(n.balance)])],
    unassigned: [["Row", "Date", "Reference", "Description", "Amount"], ...r.unassigned.map((t) => [t.rowNumber, t.date, t.reference ?? "", t.description, toDecimal(t.amount)])],
    overCeiling: [["Date", "End-of-day balance", "Over the ceiling by"], ...r.overCeiling.map((o) => [o.date || "Opening balance", toDecimal(o.balance), toDecimal(o.over)])],
    days: [["Date", "Net movement", "Account balance"], ...r.days.map((d) => [d.date, toDecimal(d.movement), toDecimal(d.accountBalance)])],
    ledgers: [
      ["Client or matter", "Date", "Reference", "Description", "Amount", "Balance"],
      ...r.ledgers.flatMap((l) => trustLedgerRows(l).slice(1).map((row) => [lawClientLabel(l.client), ...row]))
    ]
  };
}

// packages/core/src/law/sheets.ts
var BANK = { crIsNegative: false };
function matchHeaders(header, order, synonyms) {
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
          if (exact ? name === syn : ` ${name} `.includes(` ${syn} `)) {
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
function guess(rows, order, synonyms, atHeaderRow) {
  if (atHeaderRow !== void 0) return { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], order, synonyms) };
  const firstFilled = Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
  let best = { headerRow: firstFilled, columns: matchHeaders(rows[firstFilled] ?? [], order, synonyms) };
  let bestScore = Object.values(best.columns).filter((c) => c >= 0).length;
  rows.slice(0, 25).forEach((row, i) => {
    const columns = matchHeaders(row, order, synonyms);
    const score = Object.values(columns).filter((c) => c >= 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: i, columns };
    }
  });
  return best;
}
function headerList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}
function need(col, label, rows, headerRow) {
  if (col === void 0 || !Number.isSafeInteger(col) || col < 0) {
    throw new Error(`No "${label}" column could be identified (${headerList(rows, headerRow)}). Choose it in the column mapping.`);
  }
  return col;
}
function assertDistinct(columns) {
  const used = Object.values(columns).filter((c) => c >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same column is chosen for two different parts. Each column can be used once.");
}
var cellAt = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
var LAW_TXN_ROLES = ["date", "description", "client", "amount", "moneyIn", "moneyOut", "balance", "reference"];
var LAW_TXN_LABELS = {
  date: "Date",
  description: "Description or payee",
  client: "Client or matter",
  amount: "Amount (money in positive, money out negative)",
  moneyIn: "Money in (deposits)",
  moneyOut: "Money out (checks and withdrawals)",
  balance: "Running balance",
  reference: "Check number or reference"
};
var TXN_SYNONYMS = {
  date: ["date", "transaction date", "posting date", "posted date", "post date", "trans date"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "case", "file"],
  reference: ["check number", "check no", "check num", "check", "reference", "ref", "reference number", "number"],
  balance: ["running balance", "balance"],
  moneyIn: ["money in", "deposit", "deposits", "credit", "credits", "receipt", "receipts", "deposit amount"],
  moneyOut: ["money out", "withdrawal", "withdrawals", "debit", "debits", "disbursement", "disbursements", "payment", "payments", "check amount", "withdrawal amount"],
  amount: ["amount", "transaction amount", "net amount"],
  description: ["description", "transaction description", "memo", "payee", "details", "payor", "narrative", "name"]
};
var TXN_ORDER = ["date", "client", "balance", "moneyIn", "moneyOut", "amount", "reference", "description"];
function lawGuessTxnColumns(rows, atHeaderRow) {
  return guess(rows, TXN_ORDER, TXN_SYNONYMS, atHeaderRow);
}
function lawExtractTransactions(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const c = mapping.columns;
  const dateCol = need(c.date, LAW_TXN_LABELS.date, rows, mapping.headerRow);
  const split = c.moneyIn >= 0 || c.moneyOut >= 0;
  if (!split) need(c.amount, "Amount", rows, mapping.headerRow);
  if (split && c.amount >= 0) throw new Error("Choose either one amount column or the money-in and money-out columns, not both.");
  assertDistinct(c);
  const transactions = [];
  const problems = [];
  let ignoredRows = 0;
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = cellAt(row, dateCol);
    const raws = split ? [cellAt(row, c.moneyIn), cellAt(row, c.moneyOut)] : [cellAt(row, c.amount)];
    if (!rawDate && raws.every((r) => r === "")) {
      ignoredRows++;
      return;
    }
    const reasons = [];
    let date = "";
    if (!rawDate) reasons.push("no date");
    else {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    let amount = 0;
    if (raws.every((r) => r === "")) reasons.push("no amount");
    raws.forEach((raw, i) => {
      if (raw === "") return;
      try {
        const cents = pmCellToCents(raw, BANK);
        amount += split && i === 1 ? -Math.abs(cents) : cents;
      } catch {
        reasons.push(`the amount "${raw}" could not be read`);
      }
    });
    let balance;
    const rawBalance = cellAt(row, c.balance);
    if (rawBalance) {
      try {
        balance = pmCellToCents(rawBalance, BANK);
      } catch {
        reasons.push(`the balance "${rawBalance}" could not be read`);
      }
    }
    if (reasons.length) {
      problems.push({ rowNumber, reason: reasons.join("; ") });
      return;
    }
    const txn = { rowNumber, date, description: cellAt(row, c.description), client: cellAt(row, c.client), amount, reference: cellAt(row, c.reference) };
    if (balance !== void 0) txn.balance = balance;
    transactions.push(txn);
  });
  if (transactions.length === 0 && problems.length === 0) throw new Error("No transactions were found under the header row. Check the header row and the column mapping.");
  return { transactions, problems, ignoredRows };
}
var LAW_BALANCE_ROLES = ["client", "balance"];
var LAW_BALANCE_LABELS = { client: "Client or matter", balance: "Ledger balance" };
var BALANCE_SYNONYMS = {
  balance: ["balance", "ledger balance", "ending balance", "trust balance", "client balance", "amount"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "name", "case", "file"]
};
function lawGuessBalanceColumns(rows, atHeaderRow) {
  return guess(rows, ["balance", "client"], BALANCE_SYNONYMS, atHeaderRow);
}
var TOTAL_WORD = /^(grand |sub ?)?totals?( balance)?:?$/i;
function lawExtractClientBalances(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const clientCol = need(mapping.columns.client, LAW_BALANCE_LABELS.client, rows, mapping.headerRow);
  const balanceCol = need(mapping.columns.balance, LAW_BALANCE_LABELS.balance, rows, mapping.headerRow);
  assertDistinct(mapping.columns);
  const balances = [];
  const problems = [];
  const totalRows = [];
  const seen = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const client = cellAt(row, clientCol).replace(/\s+/g, " ");
    const raw = cellAt(row, balanceCol);
    if (TOTAL_WORD.test(client)) {
      totalRows.push(rowNumber);
      return;
    }
    if (!client) return void problems.push({ rowNumber, reason: "no client or matter name" });
    if (!raw) return void problems.push({ rowNumber, reason: "no balance" });
    let balance;
    try {
      balance = pmCellToCents(raw, BANK);
    } catch {
      return void problems.push({ rowNumber, reason: `the balance "${raw}" could not be read` });
    }
    const key = client.toLowerCase();
    if (seen.has(key)) return void problems.push({ rowNumber, reason: `"${client}" is already listed on an earlier row` });
    seen.add(key);
    balances.push({ client, balance });
  });
  if (balances.length === 0 && problems.length === 0) throw new Error("No client balances were found under the header row. Check the header row and the column mapping.");
  return { balances, problems, totalRows };
}
var LAW_ITEM_ROLES = ["date", "reference", "amount"];
var LAW_ITEM_LABELS = { date: "Date", reference: "Check number, payee, or note", amount: "Amount" };
var ITEM_SYNONYMS = {
  date: ["date", "check date", "deposit date", "transaction date"],
  amount: ["amount", "check amount", "deposit amount", "outstanding amount"],
  reference: ["check number", "check no", "check num", "check", "reference", "ref", "number", "payee", "description", "memo", "client", "name"]
};
function lawGuessItemColumns(rows, atHeaderRow) {
  return guess(rows, ["date", "amount", "reference"], ITEM_SYNONYMS, atHeaderRow);
}
function lawExtractOutstandingItems(rows, mapping) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The file has no rows under its header row.");
  const amountCol = need(mapping.columns.amount, LAW_ITEM_LABELS.amount, rows, mapping.headerRow);
  assertDistinct(mapping.columns);
  const items = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const reference = cellAt(row, mapping.columns.reference);
    const rawDate = cellAt(row, mapping.columns.date);
    const raw = cellAt(row, amountCol);
    if (row.some((x) => TOTAL_WORD.test(x.trim())) && !rawDate) {
      totalRows.push(rowNumber);
      return;
    }
    if (!raw) return void problems.push({ rowNumber, reason: "no amount" });
    let amount;
    let date = "";
    try {
      amount = Math.abs(pmCellToCents(raw));
    } catch {
      return void problems.push({ rowNumber, reason: `the amount "${raw}" could not be read` });
    }
    if (amount === 0) return void problems.push({ rowNumber, reason: "the amount is zero" });
    if (rawDate) {
      try {
        date = pmCellToIsoDate(rawDate);
      } catch {
        return void problems.push({ rowNumber, reason: `the date "${rawDate}" could not be read` });
      }
    }
    items.push({ date, reference, amount });
  });
  if (items.length === 0 && problems.length === 0) throw new Error("No items were found under the header row. Check the header row and the column mapping.");
  return { items, problems, totalRows };
}

// packages/core/src/law/threeWay.ts
function validate5(input) {
  assertCents(input.bankEndingBalance, "bank ending balance");
  assertCents(input.journalBalance, "trust journal balance");
  if (input.asOf !== void 0 && input.asOf !== "" && !isIsoDate(input.asOf)) throw new Error(`"${input.asOf}" is not a valid date.`);
  for (const [list, what] of [[input.outstandingChecks, "outstanding check"], [input.depositsInTransit, "deposit in transit"]]) {
    list.forEach((item, i) => {
      assertCents(item.amount, `${what} ${i + 1}`);
      if (item.amount <= 0) throw new Error(`Every ${what} needs an amount above zero (item ${i + 1} is ${formatUSD(item.amount)}).`);
      if (item.date !== "" && !isIsoDate(item.date)) throw new Error(`The date "${item.date}" on ${what} ${i + 1} is not valid.`);
    });
  }
  lawAssertBalances(input.clientLedgers, "client ledger balance");
  const c = input.continuity;
  if (c) {
    assertCents(c.priorBalance, "prior balance");
    assertCents(c.receipts, "receipts");
    assertCents(c.disbursements, "disbursements");
    if (c.receipts < 0 || c.disbursements < 0) throw new Error("Receipts and disbursements are entered as positive amounts.");
  }
}
function verifyThreeWay(input, r) {
  validate5(input);
  const checks = new CheckList();
  const outChecks = lawBigSum(input.outstandingChecks.map((i) => i.amount));
  const inTransit = lawBigSum(input.depositsInTransit.map((i) => i.amount));
  const adjusted = BigInt(input.bankEndingBalance) - outChecks + inTransit;
  const ledgers = lawBigSum(input.clientLedgers.map((l) => l.balance));
  const journal = BigInt(input.journalBalance);
  checks.cents("bank-journal", "Adjusted bank balance = trust journal balance", r.journalBalance, r.adjustedBankBalance);
  checks.cents("journal-ledgers", "Trust journal balance = sum of client ledger balances", r.clientLedgerTotal, r.journalBalance);
  checks.cents("bank-ledgers", "Adjusted bank balance = sum of client ledger balances", r.clientLedgerTotal, r.adjustedBankBalance);
  const recomputed = BigInt(r.adjustedBankBalance) === adjusted && BigInt(r.clientLedgerTotal) === ledgers && BigInt(r.journalBalance) === journal && BigInt(r.bankVsJournal) === adjusted - journal && BigInt(r.journalVsLedgers) === journal - ledgers && BigInt(r.bankVsLedgers) === adjusted - ledgers && r.agree === (adjusted === journal && journal === ledgers);
  checks.that("recompute", "The three figures and their differences match a second calculation", recomputed, `second pass: adjusted bank ${formatUSD(Number(adjusted))}, journal ${formatUSD(Number(journal))}, client ledgers ${formatUSD(Number(ledgers))}`);
  checks.that(
    "outstanding-readd",
    "Outstanding checks and deposits in transit re-add to the totals shown",
    BigInt(r.outstandingChecksTotal) === outChecks && BigInt(r.depositsInTransitTotal) === inTransit,
    `second pass: outstanding checks ${formatUSD(Number(outChecks))}, deposits in transit ${formatUSD(Number(inTransit))}`
  );
  const negative = input.clientLedgers.filter((l) => l.balance < 0);
  const listed = JSON.stringify(r.negativeLedgers.map((l) => [l.client, l.balance])) === JSON.stringify(negative.map((l) => [lawClientLabel(l.client), l.balance]));
  checks.that(
    "no-negative-ledger",
    "No client ledger balance is below zero",
    negative.length === 0 && listed,
    negative.length ? `${negative.length} ledger(s) below zero; first: ${lawClientLabel(negative[0].client)} at ${formatUSD(negative[0].balance)}` : "the list of ledgers below zero does not match the input"
  );
  if (input.continuity) {
    const c = input.continuity;
    const expected = BigInt(c.priorBalance) + BigInt(c.receipts) - BigInt(c.disbursements);
    checks.cents("continuity", "Prior period balance + receipts − disbursements = trust journal balance", Number(expected), r.journalBalance);
    checks.that("continuity-shown", "The roll-forward balance shown matches a second calculation", r.continuityBalance !== void 0 && BigInt(r.continuityBalance) === expected);
  }
  checks.that("ledgers-entered", "At least one client ledger balance was entered", input.clientLedgers.length > 0, "the sum of client ledgers is zero because none were entered", "warning");
  return checks.all;
}
function threeWayReconcile(input) {
  validate5(input);
  const outstandingChecksTotal = sum(input.outstandingChecks.map((i) => i.amount));
  const depositsInTransitTotal = sum(input.depositsInTransit.map((i) => i.amount));
  const adjustedBankBalance = assertCents(input.bankEndingBalance - outstandingChecksTotal + depositsInTransitTotal, "adjusted bank balance");
  const clientLedgerTotal = sum(input.clientLedgers.map((l) => l.balance));
  const journalBalance = input.journalBalance;
  const figures = {
    outstandingChecksTotal,
    depositsInTransitTotal,
    adjustedBankBalance,
    journalBalance,
    clientLedgerTotal,
    bankVsJournal: adjustedBankBalance - journalBalance,
    journalVsLedgers: journalBalance - clientLedgerTotal,
    bankVsLedgers: adjustedBankBalance - clientLedgerTotal,
    negativeLedgers: input.clientLedgers.filter((l) => l.balance < 0).map((l) => ({ client: lawClientLabel(l.client), balance: l.balance })),
    agree: adjustedBankBalance === journalBalance && journalBalance === clientLedgerTotal
  };
  if (input.continuity) figures.continuityBalance = assertCents(input.continuity.priorBalance + input.continuity.receipts - input.continuity.disbursements, "roll-forward balance");
  return { ...figures, checks: verifyThreeWay(input, figures) };
}
function threeWayTables(input, r) {
  const items = (list, total) => [
    ["Date", "Reference", "Amount"],
    ...list.map((i) => [i.date, i.reference, toDecimal(i.amount)]),
    ["", "Total", toDecimal(total)]
  ];
  const summary = [
    ["Item", "Amount"],
    ["Bank statement ending balance", toDecimal(input.bankEndingBalance)],
    ["Less outstanding checks", toDecimal(-r.outstandingChecksTotal)],
    ["Plus deposits in transit", toDecimal(r.depositsInTransitTotal)],
    ["1. Adjusted bank balance", toDecimal(r.adjustedBankBalance)],
    ["2. Trust journal balance", toDecimal(r.journalBalance)],
    ["3. Sum of client ledger balances", toDecimal(r.clientLedgerTotal)],
    ["Difference: adjusted bank − trust journal", toDecimal(r.bankVsJournal)],
    ["Difference: trust journal − client ledgers", toDecimal(r.journalVsLedgers)],
    ["Difference: adjusted bank − client ledgers", toDecimal(r.bankVsLedgers)]
  ];
  if (input.continuity && r.continuityBalance !== void 0) {
    summary.push(
      ["Prior period balance", toDecimal(input.continuity.priorBalance)],
      ["Plus receipts", toDecimal(input.continuity.receipts)],
      ["Less disbursements", toDecimal(-input.continuity.disbursements)],
      ["Roll-forward balance", toDecimal(r.continuityBalance)]
    );
  }
  return {
    summary,
    outstandingChecks: items(input.outstandingChecks, r.outstandingChecksTotal),
    depositsInTransit: items(input.depositsInTransit, r.depositsInTransitTotal),
    clientLedgers: [["Client or matter", "Balance"], ...input.clientLedgers.map((l) => [lawClientLabel(l.client), toDecimal(l.balance)]), ["Total", toDecimal(r.clientLedgerTotal)]]
  };
}

// packages/core/src/law/workbook.ts
var THREE_WAY_SHEETS = ["Reconciliation", "Outstanding checks", "Deposits in transit", "Client ledgers", "Instructions"];
var THREE_WAY_CHECK_HEADERS = ["Line", "Date", "Check number", "Payee", "Amount"];
var THREE_WAY_DEPOSIT_HEADERS = ["Line", "Date", "Description", "Amount"];
var THREE_WAY_LEDGER_HEADERS = ["Line", "Client or matter", "Balance"];
var THREE_WAY_SUMMARY_LINES = [
  ["account", "Firm or account"],
  ["asOf", "As of date"],
  ["bank", "Bank statement ending balance"],
  ["checksTotal", "Less outstanding checks (total of the Outstanding checks sheet)"],
  ["depositsTotal", "Plus deposits in transit (total of the Deposits in transit sheet)"],
  ["adjusted", "1. Adjusted bank balance"],
  ["journal", "2. Trust journal balance"],
  ["ledgerTotal", "3. Sum of client ledger balances (total of the Client ledgers sheet)"],
  ["bankVsJournal", "Difference: adjusted bank − trust journal"],
  ["journalVsLedgers", "Difference: trust journal − client ledgers"],
  ["bankVsLedgers", "Difference: adjusted bank − client ledgers"],
  ["prior", "Prior period reconciled balance (optional)"],
  ["receipts", "Receipts this period (optional)"],
  ["disbursements", "Disbursements this period (optional)"]
];
var WRITTEN_LABELS = {
  checksTotal: "outstanding checks total",
  depositsTotal: "deposits in transit total",
  adjusted: "adjusted bank balance",
  ledgerTotal: "sum of client ledger balances",
  bankVsJournal: "difference between adjusted bank and trust journal",
  journalVsLedgers: "difference between trust journal and client ledgers",
  bankVsLedgers: "difference between adjusted bank and client ledgers"
};
var WRITTEN_KEYS = Object.keys(WRITTEN_LABELS);
var MAX_ROWS = 500;
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ROWS) throw new Error(`${label} must be a whole number from 1 to ${MAX_ROWS}.`);
  return value;
}
function threeWayTemplateClients(names) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name === "") continue;
    const key = lawClientKey(name);
    if (seen.has(key)) throw new Error(`"${name}" is listed twice in the client names.`);
    seen.add(key);
    out.push(name);
  }
  if (out.length > MAX_ROWS) throw new Error(`The client list has ${out.length} names; the workbook holds up to ${MAX_ROWS}.`);
  return out;
}
function threeWayTemplateRowCounts(o) {
  const clients = threeWayTemplateClients(o.clients);
  return {
    clientRows: Math.max(count(o.clientRows, "The number of client ledger rows"), clients.length),
    checkRows: count(o.checkRows, "The number of outstanding check rows"),
    depositRows: count(o.depositRows, "The number of deposit rows")
  };
}
function threeWayTemplateSheets(o) {
  if (o.asOf !== "" && !isIsoDate(o.asOf)) throw new Error("The as-of date is not a valid date.");
  const clients = threeWayTemplateClients(o.clients);
  const rows = threeWayTemplateRowCounts(o);
  const filled = { account: o.account.trim().replace(/\s+/g, " "), asOf: o.asOf };
  return [
    { name: THREE_WAY_SHEETS[0], rows: [["Item", "Value"], ...THREE_WAY_SUMMARY_LINES.map(([key, label]) => [label, filled[key] ?? ""])], money: [], widths: [66, 24] },
    { name: THREE_WAY_SHEETS[1], rows: [[...THREE_WAY_CHECK_HEADERS], ...Array.from({ length: rows.checkRows }, (_, i) => [i + 1, "", "", "", ""])], money: [], widths: [8, 14, 16, 36, 16] },
    { name: THREE_WAY_SHEETS[2], rows: [[...THREE_WAY_DEPOSIT_HEADERS], ...Array.from({ length: rows.depositRows }, (_, i) => [i + 1, "", "", ""])], money: [], widths: [8, 14, 40, 16] },
    { name: THREE_WAY_SHEETS[3], rows: [[...THREE_WAY_LEDGER_HEADERS], ...Array.from({ length: rows.clientRows }, (_, i) => [i + 1, clients[i] ?? "", ""])], money: [], widths: [8, 40, 18] },
    {
      name: THREE_WAY_SHEETS[4],
      rows: [
        ["How this workbook is laid out"],
        ["Reconciliation: the firm or account, the date the figures are as of, the bank statement ending balance, and the trust journal balance. The lines for totals and differences are there to be written in by hand."],
        ["Outstanding checks: one row per check written in the trust journal that is not on the bank statement yet. Amounts are positive numbers."],
        ["Deposits in transit: one row per deposit recorded in the trust journal that is not on the bank statement yet."],
        ["Client ledgers: one row per client or matter with the balance of its ledger on the as-of date."],
        ["Adjusted bank balance = bank statement ending balance − outstanding checks + deposits in transit."],
        ["The three figures put side by side are the adjusted bank balance, the trust journal balance, and the sum of the client ledger balances."],
        ["The three optional lines compare the prior period balance + receipts − disbursements with this period’s trust journal balance. Leave them blank to skip that comparison."],
        ["Amounts are plain numbers. This workbook holds values only and contains no formulas, so nothing in it calculates."],
        [`The three-way reconciliation report ${o.reportUrl ? `at ${o.reportUrl}` : "on the same site"} opens this workbook, compares the three figures to the cent, and shows the checks it ran.`],
        ["A numbered row with nothing typed in it is skipped. Add more rows under the last one on any list sheet."]
      ],
      money: [],
      widths: [120]
    }
  ];
}
function verifyThreeWayTemplate(o, read) {
  const checks = new CheckList();
  const clients = threeWayTemplateClients(o.clients);
  const want = threeWayTemplateRowCounts(o);
  const cell = (sheet, row, col) => sheet?.rows[row]?.[col] ?? "";
  const [summary, outstanding, deposits, ledgers, instructions] = [read[0], read[1], read[2], read[3], read[4]];
  checks.equal("sheets", "The workbook has the five sheets, in order", THREE_WAY_SHEETS.join(", "), read.map((s) => s.name).join(", "));
  checks.equal("summary-lines", "The Reconciliation sheet has every line, in order", THREE_WAY_SUMMARY_LINES.map(([, label]) => label).join(" | "), (summary?.rows ?? []).slice(1).map((r) => r[0] ?? "").join(" | "));
  checks.equal("account", "The firm or account name reads back as typed", o.account.trim().replace(/\s+/g, " "), cell(summary, 1, 1));
  checks.equal("as-of", "The as-of date reads back as typed", o.asOf, cell(summary, 2, 1));
  const amountsBlank = (summary?.rows ?? []).slice(3).every((r) => (r[1] ?? "") === "");
  checks.that("summary-blank", "Every amount on the Reconciliation sheet is left blank to fill in", amountsBlank);
  const list = (id, title, sheet, headers, rows) => {
    checks.equal(`${id}-header`, `${title}: the header row reads back as written`, headers.join(" | "), (sheet?.rows[0] ?? []).slice(0, headers.length).join(" | "));
    checks.equal(`${id}-rows`, `${title}: the number of rows reads back as asked for`, rows, Math.max(0, (sheet?.rows.length ?? 0) - 1));
    const numbered = (sheet?.rows ?? []).slice(1).every((r, i) => r[0] === String(i + 1));
    checks.that(`${id}-numbered`, `${title}: the rows are numbered from 1`, numbered && (sheet?.rows.length ?? 0) > 1);
  };
  list("checks", THREE_WAY_SHEETS[1], outstanding, THREE_WAY_CHECK_HEADERS, want.checkRows);
  list("deposits", THREE_WAY_SHEETS[2], deposits, THREE_WAY_DEPOSIT_HEADERS, want.depositRows);
  list("ledgers", THREE_WAY_SHEETS[3], ledgers, THREE_WAY_LEDGER_HEADERS, want.clientRows);
  const namesBack = (ledgers?.rows ?? []).slice(1).map((r) => r[1] ?? "");
  const namesOk = namesBack.length === want.clientRows && namesBack.every((name, i) => name === (clients[i] ?? ""));
  checks.that("client-names", "The client names read back as typed, in order", namesOk, `asked for ${clients.length} name(s), read back ${namesBack.filter(Boolean).length}`);
  checks.that("instructions", "The Instructions sheet is there", (instructions?.rows.length ?? 0) >= 6);
  let formulas = 0;
  for (const s of read) for (const row of s.rows) for (const c of row) if (/^=/.test(c)) formulas++;
  checks.that("values-only", "The workbook holds values only, no formulas", formulas === 0, `${formulas} cell(s) start with an equals sign`);
  return checks.all;
}
function stem(label) {
  return pmNormalizeHeader(label.replace(/\([^)]*\)/g, " ")).replace(/^\d+ /, "");
}
function findSheet(sheets, name) {
  const want = pmNormalizeHeader(name);
  const found = sheets.filter((s) => pmNormalizeHeader(s.name) === want);
  if (found.length === 0) throw new Error(`This workbook has no sheet named "${name}". It needs these four: ${THREE_WAY_SHEETS.slice(0, 4).join(", ")}.`);
  if (found.length > 1) throw new Error(`This workbook has more than one sheet named "${name}".`);
  return found[0];
}
function listRows(sheet, headerRow) {
  const lineCol = (sheet.rows[headerRow] ?? []).findIndex((c) => pmNormalizeHeader(c) === "line");
  return sheet.rows.map((row, i) => {
    const cells = row.map((c) => String(c ?? ""));
    if (i <= headerRow || lineCol < 0) return cells;
    return cells.some((c, j) => j !== lineCol && c.trim() !== "") ? cells : cells.map(() => "");
  });
}
var hasBody = (rows, headerRow) => rows.some((row, i) => i > headerRow && row.some((c) => c.trim() !== ""));
function inSheet(sheet, headers, run) {
  try {
    return run();
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message.replace(/ Choose it in the column mapping\.$/, "") : "it could not be read.";
    throw new Error(`Sheet "${sheet.name}": ${message} Its header row needs these columns: ${headers.filter((h) => h !== "Line").join(", ")}.`);
  }
}
function readThreeWayWorkbook(sheets) {
  const summary = findSheet(sheets, THREE_WAY_SHEETS[0]);
  const outstanding = findSheet(sheets, THREE_WAY_SHEETS[1]);
  const deposits = findSheet(sheets, THREE_WAY_SHEETS[2]);
  const ledgers = findSheet(sheets, THREE_WAY_SHEETS[3]);
  const byStem = new Map(THREE_WAY_SUMMARY_LINES.map(([key, label2]) => [stem(label2), key]));
  const raw = /* @__PURE__ */ new Map();
  summary.rows.forEach((row, i) => {
    const key = byStem.get(stem(String(row[0] ?? "")));
    if (!key) return;
    if (raw.has(key)) throw new Error(`The ${THREE_WAY_SHEETS[0]} sheet has two rows labelled "${String(row[0]).trim()}" (the second is row ${i + 1}).`);
    raw.set(key, String(row[1] ?? "").trim());
  });
  const label = (key) => THREE_WAY_SUMMARY_LINES.find(([k]) => k === key)[1].replace(/\s*\([^)]*\)/g, "").replace(/^\d+\.\s*/, "");
  const balances = /* @__PURE__ */ new Set(["bank", "journal", "prior", "adjusted", "ledgerTotal"]);
  const amount = (key) => {
    const text = raw.get(key) ?? "";
    if (text === "") return void 0;
    try {
      return pmCellToCents(text, { crIsNegative: !balances.has(key) });
    } catch {
      throw new Error(`"${label(key)}" on the ${THREE_WAY_SHEETS[0]} sheet is not an amount: "${text}".`);
    }
  };
  const bank = amount("bank");
  if (bank === void 0) throw new Error(`Type the bank statement ending balance on the ${THREE_WAY_SHEETS[0]} sheet.`);
  const journal = amount("journal");
  if (journal === void 0) throw new Error(`Type the trust journal balance on the ${THREE_WAY_SHEETS[0]} sheet.`);
  let asOf = "";
  const rawDate = raw.get("asOf") ?? "";
  if (rawDate !== "") {
    try {
      asOf = pmCellToIsoDate(rawDate);
    } catch {
      throw new Error(`The as-of date on the ${THREE_WAY_SHEETS[0]} sheet could not be read: "${rawDate}".`);
    }
  }
  const written = {};
  for (const key of WRITTEN_KEYS) {
    const value = amount(key);
    if (value !== void 0) written[key] = value;
  }
  const problems = [];
  let totalRows = 0;
  const items = (sheet, headers) => inSheet(sheet, headers, () => {
    const rows = listRows(sheet, lawGuessItemColumns(sheet.rows).headerRow);
    const mapping = lawGuessItemColumns(rows);
    if (!hasBody(rows, mapping.headerRow)) return [];
    const got = lawExtractOutstandingItems(rows, mapping);
    for (const p of got.problems) problems.push({ sheet: sheet.name, rowNumber: p.rowNumber, reason: p.reason });
    totalRows += got.totalRows.length;
    return got.items;
  });
  const outstandingChecks = items(outstanding, THREE_WAY_CHECK_HEADERS);
  const depositsInTransit = items(deposits, THREE_WAY_DEPOSIT_HEADERS);
  const clientLedgers = inSheet(ledgers, THREE_WAY_LEDGER_HEADERS, () => {
    const rows = listRows(ledgers, lawGuessBalanceColumns(ledgers.rows).headerRow);
    const mapping = lawGuessBalanceColumns(rows);
    if (!hasBody(rows, mapping.headerRow)) return [];
    const got = lawExtractClientBalances(rows, mapping);
    for (const p of got.problems) problems.push({ sheet: ledgers.name, rowNumber: p.rowNumber, reason: p.reason });
    totalRows += got.totalRows.length;
    return got.balances;
  });
  const input = { asOf, bankEndingBalance: bank, outstandingChecks, depositsInTransit, journalBalance: journal, clientLedgers };
  const prior = [amount("prior"), amount("receipts"), amount("disbursements")];
  if (prior.some((p) => p !== void 0)) input.continuity = { priorBalance: prior[0] ?? 0, receipts: prior[1] ?? 0, disbursements: prior[2] ?? 0 };
  return { account: raw.get("account") ?? "", input, written, problems, totalRows };
}
function threeWayWorkbookChecks(read, r) {
  const checks = new CheckList();
  const first = read.problems[0];
  checks.that("workbook-rows-read", "Every filled row on the list sheets was read", read.problems.length === 0, first ? `${read.problems.length} row(s) could not be read and are left out; first: sheet "${first.sheet}" row ${first.rowNumber} (${first.reason})` : void 0);
  const calculated = {
    checksTotal: r.outstandingChecksTotal,
    depositsTotal: r.depositsInTransitTotal,
    adjusted: r.adjustedBankBalance,
    ledgerTotal: r.clientLedgerTotal,
    bankVsJournal: r.bankVsJournal,
    journalVsLedgers: r.journalVsLedgers,
    bankVsLedgers: r.bankVsLedgers
  };
  for (const key of WRITTEN_KEYS) {
    const value = read.written[key];
    if (value === void 0) continue;
    checks.cents(`written-${key}`, `The ${WRITTEN_LABELS[key]} written on the Reconciliation sheet = the calculated figure`, calculated[key], key === "checksTotal" ? Math.abs(value) : value);
  }
  return checks.all;
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
var MAX_ROWS2 = 1048576;
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
      if (rowIndex < 0 || rowIndex >= MAX_ROWS2) throw new Error("This workbook is too large to open here.");
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
  const text = asText(value, input);
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => asText(v, input));
    } catch {
    }
  }
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
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
function labelKey(text) {
  return sheetNormalizeHeader(text.replace(/\([^)]*\)/g, " "));
}
function headerIndex(header, text) {
  const want = sheetNormalizeHeader(text);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want);
  if (exact >= 0) return exact;
  const letter = /^[A-Za-z]{1,2}$/.test(text.trim()) ? text.trim().toUpperCase() : "";
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

// packages/agents/src/registry/law-trust.ts
var TXN_COLUMNS = { roles: LAW_TXN_ROLES, labels: LAW_TXN_LABELS, required: ["date"], guess: (rows, at) => lawGuessTxnColumns(rows, at) };
var BALANCE_COLUMNS = { roles: LAW_BALANCE_ROLES, labels: LAW_BALANCE_LABELS, required: ["client", "balance"], guess: (rows, at) => lawGuessBalanceColumns(rows, at) };
var ITEM_COLUMNS = { roles: LAW_ITEM_ROLES, labels: LAW_ITEM_LABELS, required: ["amount"], guess: (rows, at) => lawGuessItemColumns(rows, at) };
var INVOICE_COLUMNS = { roles: LAW_INVOICE_ROLES, labels: LAW_INVOICE_LABELS, required: ["date", "client", "amount"], guess: (rows, at) => lawGuessInvoiceColumns(rows, at) };
var CARRIED_ROLES = ["client", "balance", "lastActivity"];
var CARRIED_LABELS = { client: "Client or matter", balance: "Balance carried in", lastActivity: "Last activity date" };
var CARRIED_SYNONYMS = {
  lastActivity: ["last activity date", "last activity", "date of last activity", "last active", "last date", "date"],
  balance: ["balance carried in", "carried in balance", "carried in", "opening balance", "balance", "trust balance", "ledger balance", "amount"],
  client: ["client matter", "client", "matter", "client name", "matter name", "client ledger", "ledger", "name", "case", "file"]
};
var CARRIED_COLUMNS = {
  roles: CARRIED_ROLES,
  labels: CARRIED_LABELS,
  required: ["client", "balance", "lastActivity"],
  guess: (rows, at) => sheetGuessColumns(rows, ["lastActivity", "balance", "client"], CARRIED_SYNONYMS, at)
};
var LAW_TOTAL_CELL = /^(grand |sub ?)?totals?( balance)?:?$/i;
function mapLaw(file, c, override, label) {
  const given = txt(override);
  try {
    return mapColumns(file, c, given || void 0, label);
  } catch (err2) {
    const first = file.rows.findIndex((r) => r.some((x) => x.trim() !== ""));
    if (given === "" && err2 instanceof AgentInputError && first >= 0 && first !== c.guess(file.rows).headerRow) {
      throw new AgentInputError(`${err2.message} The file's first row is: ${file.rows[first].filter((x) => x.trim() !== "").join(", ")}.`);
    }
    throw err2;
  }
}
var TXN_FILE_TEXT = "with a header row and one row per transaction: a date, and either one signed amount column (money in positive, money out negative) or separate money-in and money-out columns; a client or matter, a check number or reference and a description are used when present";
var txt = (v) => typeof v === "string" ? v.trim() : "";
var centsOf = (v) => typeof v === "number" ? v : void 0;
var plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
var was = (n) => n === 1 ? "was" : "were";
var is = (n) => n === 1 ? "is" : "are";
function dayOf(now) {
  const two = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
function readError(err2, what, columnsName) {
  const message = err2 instanceof Error ? err2.message : "it could not be read.";
  return new AgentInputError(
    `The ${what}: ${message.replace(/\s*Choose it in the column mapping\.?/g, ` Name the column with "${columnsName}".`).replace(/Check the header row and the column mapping\.?/g, `Check the header row, or name the columns with "${columnsName}".`).replace(/\s*Choose either one amount column or the money-in and money-out columns, not both\.?/g, ` Name either one amount column or the money-in and money-out columns with "${columnsName}", not both.`)}`
  );
}
function listRowsCheck(id, label, file, problems) {
  if (problems.length === 0) return { id, label, passed: true, severity: "error" };
  const shown = problems.slice(0, 8).map((p) => `row ${p.rowNumber} (${p.reason})`);
  return { id, label, passed: false, severity: "error", detail: `${problems.length} row(s) of ${file} could not be read and are not used: ${shown.join("; ")}${problems.length > shown.length ? `; and ${problems.length - shown.length} more` : ""}` };
}
function readTransactions(file, override, label, columnsName) {
  const mapping = mapLaw(file, TXN_COLUMNS, override, label);
  try {
    return lawExtractTransactions(file.rows, mapping);
  } catch (err2) {
    throw readError(err2, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
function readBalances(args, name, override, label, columnsName) {
  const file = args.files[name]?.[0];
  if (!file) return { balances: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, BALANCE_COLUMNS, override, label);
  try {
    const got = lawExtractClientBalances(file.rows, mapping);
    return { balances: got.balances, problems: got.problems, totalRows: got.totalRows.length, file: file.name };
  } catch (err2) {
    throw readError(err2, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
function balancesInput(name, label, what) {
  return {
    name,
    kind: "file",
    label,
    description: `Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and ${what}. A row labelled Total is left out. Clients not listed start at zero.`,
    required: false
  };
}
function readEntries(file, override) {
  const read = readTransactions(file, override, "Entries list", "columns");
  const { entries, problems } = lawEntriesFromTxns(read.transactions);
  return { entries, problems: [...read.problems, ...problems].sort((a, b) => a.rowNumber - b.rowNumber), ignored: read.ignoredRows };
}
var ledgerCard = {
  name: "client_trust_ledger_card",
  page: "law-trust/client-trust-ledger",
  section: "law-trust",
  kind: "tool",
  title: "Client trust ledger card: one client, balance after every line",
  description: "Builds one client's or matter's trust ledger card from a list of receipts and disbursements (.csv or .xlsx): every line in date order with the balance after it, the receipts and disbursements totals, the closing balance and the lowest balance. Every balance is re-added from the opening balance on a second pass, the totals are added again in the opposite order, and every line after which the balance is below zero is listed; a card that goes below zero is not verified. Use it when someone asks for a client trust ledger, a client ledger card or one matter's running trust balance from a law firm's trust (IOLTA) records. Not for a whole account's journal across clients, and it makes no statement about what any rule requires.",
  question: "Can you make the trust ledger card for the Cedar closing matter from this export and check the balance never went negative?",
  inputs: [
    { name: "entries", kind: "file", label: "Entries list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. Same-date rows keep the file's order.`, required: true },
    { name: "client", kind: "text", label: "Client or matter", description: "Optional. The client or matter the card is for, as the file writes it. Needed when the file names more than one client or matter: only that one's rows go on the card. Also the name printed on the card.", required: false },
    { name: "opening", kind: "amount", label: "Opening balance", description: "Optional. The balance carried onto the card before its first line. Without it, zero.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the card's summary.", required: false },
    columnsInput("Entries list", TXN_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven carries a balance and compares totals; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ files, values }) {
    const file = oneFile(files, "entries");
    const read = readEntries(file, values.columns);
    const clients = /* @__PURE__ */ new Map();
    for (const e of read.entries) {
      const key = lawClientKey(e.client);
      const at = clients.get(key) ?? { label: lawClientLabel(e.client), count: 0 };
      at.count += 1;
      clients.set(key, at);
    }
    const listOf = () => [...clients.values()].map((c) => `${c.label} (${plural(c.count, "row")})`).join(", ");
    const typed = txt(values.client);
    const typedKey = lawClientKey(typed);
    const named = [...clients.keys()].some((k) => k !== "");
    let picked = read.entries;
    let pickedKey = null;
    if (typed !== "" && named) {
      if (!clients.has(typedKey)) throw new AgentInputError(`No row of the entries list is for "${typed}". The file names: ${listOf()}. Give "client" as one of these.`);
      pickedKey = typedKey;
    } else if (clients.size > 1) {
      throw new AgentInputError(`The entries list names more than one client or matter: ${listOf()}. Give "client" to say whose rows go on the card.`);
    }
    const leftOut = [];
    if (pickedKey !== null) {
      picked = read.entries.filter((e) => lawClientKey(e.client) === pickedKey);
      for (const e of read.entries) if (lawClientKey(e.client) !== pickedKey) leftOut.push({ rowNumber: e.row, reason: "for another client or matter" });
    }
    const keys = new Set(picked.map((e) => lawClientKey(e.client)));
    const fromFile = keys.size === 1 && !keys.has("") ? lawClientLabel(picked[0].client) : "";
    const input = { client: typed !== "" ? typed : fromFile, opening: centsOf(values.opening) ?? 0, entries: picked };
    const r = buildTrustCard(input);
    const t = trustCardTables(input, r);
    const summary = [["Item", "Amount"], ["Client or matter", input.client.trim()], ["Firm or account", txt(values.account)], ...t.summary.slice(1)];
    const dips = r.belowZero.length;
    return {
      summary: `${input.client.trim() || "The card"}: opening balance ${formatUSD(input.opening)} + receipts ${formatUSD(r.receiptsTotal)} − disbursements ${formatUSD(r.disbursementsTotal)} = closing balance ${formatUSD(r.closing)}, over ${plural(r.lines.length, "line")}. ` + (dips ? `The balance is below zero at ${plural(dips, "point")} on the card; the lowest balance is ${formatUSD(r.lowest)}.` : `The balance never goes below zero; the lowest balance is ${formatUSD(r.lowest)}.`) + (leftOut.length ? ` ${plural(leftOut.length, "row")} of other clients or matters ${is(leftOut.length)} not on the card.` : "") + (read.ignored ? ` ${plural(read.ignored, "row")} with no date and no amount (titles, totals, notes) ${was(read.ignored)} left out.` : ""),
      tables: [
        { name: "Ledger card", rows: t.card },
        { name: "Summary", rows: summary },
        { name: "Where the balance is below zero", rows: t.belowZero }
      ],
      checks: [...r.checks, ...sheetRowChecks(read.problems, leftOut)]
    };
  },
  examples: [
    {
      label: "The page's worked example: the Cedar closing rows of a March 2026 trust export, opening balance $0.00",
      args: { entries: "fixture:law/trust-journal-march.csv", client: "Cedar closing" },
      verified: true,
      contains: ["receipts $10,000.00", "disbursements $3,500.00", "closing balance $6,500.00", "never goes below zero", "4350.75", "4000.00", "6500.00"]
    },
    {
      label: "The page's counter-example: the wire dated April 1 puts three lines below zero, so the card is not verified",
      args: {
        entries: 'Date,Check No,Payee or source,Receipts,Disbursements\n2026-04-01,,Wire in - closing funds,"7,500.00",\n2026-03-26,1043,Recording fees,,"3,149.25"\n2026-03-30,1045,Example Title Company,,350.75\n2026-03-31,,Deposit - closing funds,"2,500.00",\n',
        client: "Cedar closing"
      },
      verified: false,
      failedCheck: "never-below-zero"
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { entries: "Date,Payee,Receipts,Disbursements\n2026-03-17,Wire in,7500.00,\n2026-03-26,Recording fees,,3l49.25\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var cashJournal = {
  name: "trust_receipts_disbursements_journal",
  page: "law-trust/trust-receipts-and-disbursements-journal",
  section: "law-trust",
  kind: "tool",
  title: "Trust receipts and disbursements journal with client subtotals",
  description: "Builds the receipts and disbursements journal of a law firm's trust (IOLTA) account from a period's transactions (.csv or .xlsx): every entry in date order with the account balance after it, the receipts and disbursements totals, a subtotal per client or matter, and the check numbers used twice or missing from the run. Every balance re-adds from the opening balance, each client subtotal matches a second grouping, and the subtotals tie to the journal totals. Entries with no client, lines below zero and check-number gaps are listed as findings. Use it when someone asks for a trust journal, a cash receipts and disbursements journal, client subtotals for the month, or missing check numbers. Not for one client's card alone, and it makes no statement about what any rule requires.",
  question: "Here is our trust account activity for March. Can you build the receipts and disbursements journal with subtotals by client and flag any missing check numbers?",
  inputs: [
    { name: "entries", kind: "file", label: "Entries list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. Same-date rows keep the file's order.`, required: true },
    { name: "opening", kind: "amount", label: "Opening balance", description: "Optional. The journal balance before the first entry. Without it, zero.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the summary.", required: false },
    { name: "period", kind: "text", label: "Period", description: 'Optional. The period the journal covers, as words for the summary ("March 2026").', required: false },
    columnsInput("Entries list", TXN_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven adds, subtotals, and lists; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ files, values }) {
    const file = oneFile(files, "entries");
    const read = readEntries(file, values.columns);
    const input = { opening: centsOf(values.opening) ?? 0, entries: read.entries };
    const r = buildTrustCashJournal(input);
    const t = trustCashTables(input, r);
    const summary = [["Item", "Amount"], ["Firm or account", txt(values.account)], ["Period", txt(values.period)], ...t.summary.slice(1)];
    const named = r.clients.filter((c) => c.client !== "").length;
    const unnamed = r.clients.find((c) => c.client === "")?.entries ?? 0;
    const numbers = r.checkNumbersUsed === 0 ? "No disbursement carries a check number." : `${plural(r.checkNumbersUsed, "disbursement")} ${r.checkNumbersUsed === 1 ? "carries" : "carry"} a check number; ${r.repeatedChecks.length ? `used more than once: ${r.repeatedChecks.map((c) => c.number).join(", ")}` : "none is used twice"}; ${r.missingChecks.length ? `not in the journal: ${r.missingChecks.map(trustCheckGapLabel).join(", ")}` : "none is missing between the lowest and the highest"}.`;
    return {
      summary: `Opening balance ${formatUSD(input.opening)} + receipts ${formatUSD(r.receiptsTotal)} − disbursements ${formatUSD(r.disbursementsTotal)} = closing balance ${formatUSD(r.closing)}, across ${plural(r.lines.length, "entry", "entries")} for ${plural(named, "client or matter", "clients or matters")}${unnamed ? `, ${unnamed} of them with no client or matter` : ""}. ${numbers}` + (r.belowZero.length ? ` The journal balance is below zero after ${plural(r.belowZero.length, "line")}.` : "") + (read.ignored ? ` ${plural(read.ignored, "row")} with no date and no amount (titles, totals, notes) ${was(read.ignored)} left out.` : ""),
      tables: [
        { name: "Journal", rows: t.journal },
        { name: "Subtotals by client or matter", rows: t.clients },
        { name: "Summary", rows: summary },
        { name: "Check numbers", rows: t.checkNumbers },
        { name: "Lines below zero", rows: t.belowZero }
      ],
      checks: [...r.checks, ...sheetRowChecks(read.problems, [])]
    };
  },
  examples: [
    {
      label: "The page's worked example: March 2026, ten entries for three clients, opening balance $41,300.00",
      args: { entries: "fixture:law/trust-journal-march.csv", opening: "41,300.00", period: "March 2026" },
      verified: true,
      contains: ["receipts $22,400.00", "disbursements $14,500.75", "closing balance $49,199.25", "not in the journal: 1044", "2500.00", "-1100.75", "6500.00", "7899.25"]
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { entries: "Date,Check No,Payee,Client/Matter,Receipts,Disbursements\n2026-03-03,,Deposit,Alder matter,5000.00,\n2026-03-05,1039,Filing fee,Alder matter,,43S.00\n", opening: "41,300.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var scanner = {
  name: "trust_negative_balance_scan",
  page: "law-trust/negative-balance-scanner",
  section: "law-trust",
  kind: "tool",
  title: "Trust account scan for client ledgers below zero, by date",
  description: "Scans a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row): each client's running balance is walked in date order and taken at the end of each date, and every date a client ledger ends below zero is listed, with every transaction that has no client or matter, and, when a firm funds ledger and a ceiling are given, every date that ledger ends above the ceiling. At every date the client ledgers are proved to add up to the account balance, and every list is matched by a second walk; the findings are warnings beside those checks. Use it when someone asks whether any client went negative, which transactions are unassigned, or how much firm money sat in trust. Not for a single client's card, and it has no ceiling of its own and makes no statement about what any rule allows.",
  question: "Can you scan this trust account export and tell me every date a client ledger went below zero?",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}.`, required: true },
    balancesInput("openingBalances", "Opening balances", "its balance before the first transaction in the transaction list"),
    { name: "firmLedger", kind: "text", label: "Firm funds ledger", description: `Optional. The name of the ledger that holds the firm's own funds, as written in the file. Used with "firmCeiling".`, required: false },
    { name: "firmCeiling", kind: "amount", label: "Ceiling for the firm funds ledger", description: `Optional. A ceiling of the person's own choosing for the firm funds ledger: each date that ledger ends above it is listed, with the amount above. Needs "firmLedger".`, required: false },
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Opening balances", BALANCE_COLUMNS, "openingColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven reports balances, dates, and differences; it makes no statement about what any rule, regulation, or agreement requires.",
  run(args) {
    const { files, values } = args;
    const file = oneFile(files, "transactions");
    const read = readTransactions(file, values.columns, "Trust transaction list", "columns");
    const openings = readBalances(args, "openingBalances", values.openingColumns, "Opening balances", "openingColumns");
    const ceiling = centsOf(values.firmCeiling);
    const firmLedger = txt(values.firmLedger);
    if (ceiling === void 0 && firmLedger !== "") throw new AgentInputError('A firm funds ledger was named without a ceiling. Give "firmCeiling" as well, or leave both out.');
    const r = scanTrustLedgers({ transactions: read.transactions, problems: read.problems, openingBalances: openings.balances, ...ceiling === void 0 ? {} : { firmLedger, firmCeiling: ceiling } });
    const t = trustScanTables(r);
    const tables = [
      { name: "Dates with a client ledger below zero", rows: t.negatives },
      { name: "Transactions with no client or matter", rows: t.unassigned },
      ...ceiling === void 0 ? [] : [{ name: "Dates the firm funds ledger is above the ceiling", rows: t.overCeiling }],
      { name: "Summary by client", rows: t.summary },
      { name: "Account balance by date", rows: t.days },
      { name: "Client ledgers", rows: t.ledgers }
    ];
    return {
      summary: `${plural(r.transactionCount, "transaction")} across ${plural(r.ledgers.filter((l) => l.client !== "").length, "client ledger")}, balances taken at the end of each date. ${plural(r.negatives.length, "date")} with a client ledger below zero; ${plural(r.unassigned.length, "transaction")} with no client or matter` + (ceiling === void 0 ? "" : `; ${plural(r.overCeiling.length, "date")} the ${firmLedger} ledger ends above the ${formatUSD(ceiling)} ceiling`) + `. Closing total ${formatUSD(r.closingTotal)}.` + (read.ignoredRows ? ` ${plural(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (openings.totalRows ? ` ${plural(openings.totalRows, "total row")} of the opening balances list ${was(openings.totalRows)} left out.` : ""),
      tables,
      checks: [...r.checks, ...openings.file ? [listRowsCheck("openings-read", "Every row of the opening balances list was read", openings.file, openings.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: nine March 2026 transactions, a firm funds ledger named Firm funds and a $250.00 ceiling",
      args: { transactions: "fixture:law/trust-transactions.csv", firmLedger: "Firm funds", firmCeiling: "250.00" },
      verified: true,
      contains: ["1 date with a client ledger below zero", "1 transaction with no client or matter", "1 date the Firm funds ledger ends above the $250.00 ceiling", "Closing total $2,075.00", "| Cedar closing | 2026-03-09 | -1200.00 |", "-25.00", "| 2026-03-18 | 300.00 | 50.00 |"]
    },
    {
      label: "A row whose date cannot be read is not verified",
      args: { transactions: "Date,Payee,Client/Matter,Amount\n03/02/2026,Deposit,Alder matter,5000.00\n03/32/2026,Filing fee,Alder matter,-435.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readCarried(args) {
  const file = args.files.carriedIn?.[0];
  if (!file) return { carried: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, CARRIED_COLUMNS, args.values.carriedColumns, "Carried-in balances");
  const c = mapping.columns;
  const cell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
  const carried = [];
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  let totalRows = 0;
  file.rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const client = cell(row, c.client).replace(/\s+/g, " ");
    if (LAW_TOTAL_CELL.test(client)) {
      totalRows++;
      return;
    }
    const reasons = [];
    if (!client) reasons.push("no client or matter name");
    const rawBalance = cell(row, c.balance);
    let balance = 0;
    if (!rawBalance) reasons.push("no balance");
    else {
      try {
        balance = pmCellToCents(rawBalance, { crIsNegative: false });
      } catch {
        reasons.push(`the balance "${rawBalance}" could not be read`);
      }
    }
    const rawDate = cell(row, c.lastActivity);
    let lastActivity = "";
    if (!rawDate) reasons.push("no last activity date");
    else {
      try {
        lastActivity = pmCellToIsoDate(rawDate);
      } catch {
        reasons.push(`the date "${rawDate}" could not be read`);
      }
    }
    const key = lawClientKey(client);
    if (client && seen.has(key)) reasons.push(`"${client}" is already listed on an earlier row`);
    if (reasons.length) return void problems.push({ rowNumber, reason: reasons.join("; ") });
    seen.add(key);
    carried.push({ client, balance, lastActivity });
  });
  return { carried, problems, totalRows, file: file.name };
}
var dormant = {
  name: "dormant_trust_balance_report",
  page: "law-trust/dormant-trust-balance-report",
  section: "law-trust",
  kind: "tool",
  title: "Dormant trust balances: client balances with no activity, by age",
  description: "From a law firm's trust (IOLTA) transaction list (.csv or .xlsx, a client or matter on each row), an as-of date and a period in years or months given by the person, takes every client's balance on the as-of date and its last activity, and lists each balance above zero with no activity since the cutoff (the as-of date less the period), oldest first, with its age. Balances below zero are listed on their own. The cutoff is worked out a second way, every balance, last activity date and age is recomputed from the rows, and listed plus active plus below-zero balances are proved to equal the trust total. Use it when someone asks which client funds have sat untouched in trust, for how long, or for an aged list of stale trust balances. Not for deciding whether a balance is unclaimed or abandoned: it has no period of its own and makes no statement about what any rule requires.",
  question: "Which client balances in our trust account have had no activity in the last three years? Here is the full transaction history.",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}. It should reach back to each client's last activity, or the earlier balance is carried in.`, required: true },
    { name: "period", kind: "number", label: "Period", description: 'The length of time with no activity, as a whole number of years or months (see "unit"), as the person gives it. The tool has no period of its own.', required: true },
    { name: "unit", kind: "choice", label: "Period counted in", description: 'Optional. "years" or "months". Without it, years.', required: false, choices: ["years", "months"] },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the balances are taken on, YYYY-MM-DD; rows after it are left out. Without it, the day of the run.", required: false },
    {
      name: "carriedIn",
      kind: "file",
      label: "Carried-in balances",
      description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client whose money was in trust before the first row of the transaction list: the name, the balance then, and the date of that client's last activity before the list starts. Clients not listed start at zero.",
      required: false
    },
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Carried-in balances", CARRIED_COLUMNS, "carriedColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven lists balances by amount and last activity against the period typed; it makes no statement about whether a balance is unclaimed or abandoned or what any rule requires.",
  run(args) {
    const { files, values, now } = args;
    const file = oneFile(files, "transactions");
    const rawPeriod = txt(values.period);
    const unit = values.unit === "months" ? "months" : "years";
    if (!/^\d+$/.test(rawPeriod)) throw new AgentInputError(`"period" must be a whole number of ${unit}: "${rawPeriod}".`);
    const asOf = txt(values.asOf) || dayOf(now);
    const carried = readCarried(args);
    const read = readTransactions(file, values.columns, "Trust transaction list", "columns");
    const r = buildDormantReport({ transactions: read.transactions, problems: read.problems, carriedIn: carried.carried, asOf, period: Number(rawPeriod), unit });
    const t = dormantReportTables(r);
    const period = lawDormantPeriodText(r.period, r.unit);
    const active = r.clients.filter((c) => c.group === "active").length;
    return {
      summary: `Balances as of ${r.asOf}; the cutoff is ${r.cutoff}, the as-of date less ${period}. ${plural(r.listed.length, "balance")} above zero with no activity since the cutoff, together ${formatUSD(r.listedTotal)}; ${plural(active, "active balance")}, together ${formatUSD(r.activeTotal)}; trust total ${formatUSD(r.trustTotal)}.` + (r.belowZero.length ? ` ${plural(r.belowZero.length, "balance")} below zero, together ${formatUSD(r.belowZeroTotal)}, ${is(r.belowZero.length)} listed on ${r.belowZero.length === 1 ? "its" : "their"} own.` : "") + (r.afterAsOf ? ` ${plural(r.afterAsOf, "row")} dated after the as-of date ${is(r.afterAsOf)} left out.` : "") + (read.ignoredRows ? ` ${plural(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (carried.totalRows ? ` ${plural(carried.totalRows, "total row")} of the carried-in list ${was(carried.totalRows)} left out.` : ""),
      tables: [
        { name: "Report", rows: t.settings },
        { name: "Balances with no activity since the cutoff", rows: t.listed },
        { name: "Client balances below zero", rows: t.belowZero },
        { name: "Rows with no client or matter", rows: t.unassigned },
        { name: "Totals", rows: t.totals },
        { name: "Every client or matter", rows: t.clients }
      ],
      checks: [...r.checks, ...carried.file ? [listRowsCheck("carried-in-read", "Every row of the carried-in balances list was read", carried.file, carried.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: twelve rows for six clients, as of 2026-09-30, a period of 3 years",
      args: { transactions: "fixture:law/dormant-balances.csv", asOf: "2026-09-30", period: "3", unit: "years" },
      verified: true,
      contains: ["the cutoff is 2023-09-30", "3 balances above zero with no activity since the cutoff, together $1,562.45", "together $650.00", "trust total $2,187.45", "| Juniper estate | 0.00 | 2 | 750.00 | 2019-06-14 | 7 years, 3 months, 16 days |", "5 years, 4 months, 10 days", "3 years, 10 months, 20 days", "-25.00"]
    },
    {
      label: "A row whose date cannot be read is not verified",
      args: { transactions: "Date,Payee,Client/Matter,Amount\n04/08/2019,Deposit,Juniper estate,12000.00\n13/45/2024,Bad date,Maple matter,10.00\n", asOf: "2026-09-30", period: "3" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var earnedFees = {
  name: "earned_fees_left_in_trust",
  page: "law-trust/earned-fees-left-in-trust",
  section: "law-trust",
  kind: "tool",
  title: "Earned fees left in trust: billed fees not transferred, by client and age",
  description: `Sets a law firm's invoices (fees billed) against the fee transfers out of its trust (IOLTA) account, client by client, from two .csv or .xlsx files: a trust transaction list and an invoice list. Fee transfers are the money-out rows whose description or check number holds a word given ("operating" unless told otherwise), and each one is listed. It gives the invoices billed and not transferred, oldest first, with their age in days; transfers above what was billed, on the as-of date and by each transfer's date; and each client's trust balance. Every client figure re-adds from both files, and the transfers tie to the trust balance. Use it when someone asks which billed fees are still sitting in trust, or whether more was taken from trust than was billed. Not for deciding whether a fee is earned or when money is moved: it makes no statement about what any rule requires.`,
  question: "Here are our trust transactions and our invoices. Which billed fees have not been transferred out of trust yet, and how old are they?",
  inputs: [
    { name: "transactions", kind: "file", label: "Trust transaction list", description: `A .csv or .xlsx file (a path, or the CSV text) ${TXN_FILE_TEXT}.`, required: true },
    { name: "invoices", kind: "file", label: "Invoice list", description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per invoice: invoice date, client or matter and fees billed are needed; an invoice number is used when present. A credit note is written below zero.", required: true },
    { name: "transferWords", kind: "text", label: "Words that mark a fee transfer", description: `Optional. Words, separated by commas, that a money-out row's description or check number holds when it is a fee transfer to the firm, ignoring case. Without it, "operating".`, required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the report is taken on, YYYY-MM-DD; rows and invoices after it are left out. Without it, the day of the run.", required: false },
    { name: "from", kind: "date", label: "Count from", description: "Optional. YYYY-MM-DD: invoices and fee transfers before it are not counted as billed or transferred; the trust rows still count in the balances.", required: false },
    balancesInput("carriedIn", "Carried-in balances", "its trust balance before the first row of the trust list"),
    columnsInput("Trust transaction list", TXN_COLUMNS),
    columnsInput("Invoice list", INVOICE_COLUMNS, "invoiceColumns"),
    columnsInput("Carried-in balances", BALANCE_COLUMNS, "carriedColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven sets the invoices against the transfers, gives amounts, dates, and ages, and proves the totals; it does not say what any rule requires, when or whether money is moved, or whether an amount is earned.",
  run(args) {
    const { files, values, now } = args;
    const trust = oneFile(files, "transactions");
    const bills = oneFile(files, "invoices");
    const words = lawFeeWordsFromText(txt(values.transferWords) || "operating");
    const asOf = txt(values.asOf) || dayOf(now);
    const carried = readBalances(args, "carriedIn", values.carriedColumns, "Carried-in balances", "carriedColumns");
    const read = readTransactions(trust, values.columns, "Trust transaction list", "columns");
    const invMapping = mapLaw(bills, INVOICE_COLUMNS, values.invoiceColumns, "Invoice list");
    let inv;
    try {
      inv = lawExtractInvoices(bills.rows, invMapping);
    } catch (err2) {
      throw readError(err2, `invoice list (${bills.name})`, "invoiceColumns");
    }
    const r = buildEarnedFeesReport({ transactions: read.transactions, invoices: inv.invoices, transactionProblems: read.problems, invoiceProblems: inv.problems, carriedIn: carried.balances, asOf, from: txt(values.from), transferWords: words });
    const t = earnedFeesTables(r);
    const ignored = read.ignoredRows + inv.ignoredRows;
    return {
      summary: `As of ${r.asOf}${r.from ? `, counted from ${r.from}` : ""}, with ${r.words.map((w) => `"${w}"`).join(" or ")} ` +
        `marking a fee transfer: fees billed ${formatUSD(r.billedTotal)}, fee transfers ${formatUSD(r.transferTotal)} ` +
        `(${plural(r.transfers.length, "row")}). Billed and not transferred ${formatUSD(r.notTransferredTotal)} ` +
        `on ${plural(r.open.length, "invoice")}; transferred above billed ${formatUSD(r.aboveBilledTotal)}. Trust ` +
        `balance ${formatUSD(r.trustTotal)}.` + (r.ahead.length ? ` ${plural(r.ahead.length, "transfer")} took a client's transfers above what was billed by their date.` : "") + (r.afterAsOf || r.invoicesAfter ? ` ${plural(r.afterAsOf, "trust row")} and ${plural(r.invoicesAfter, "invoice")} dated after the as-of date are left out.` : "") + (r.invoicesBefore ? ` ${plural(r.invoicesBefore, "invoice")} before ${r.from} ${is(r.invoicesBefore)} left out.` : "") + (ignored ? ` ${plural(ignored, "row")} with no date and no amount ${was(ignored)} left out (titles or notes).` : "") + (inv.totalRows.length ? ` ${plural(inv.totalRows.length, "total line")} in the invoice list ${was(inv.totalRows.length)} left out.` : ""),
      tables: [
        { name: "Report", rows: t.settings },
        { name: "Billed and transferred, by client", rows: t.clients },
        { name: "Invoices billed and not transferred, oldest first", rows: t.open },
        { name: "Transfers above what was billed by their date", rows: t.ahead },
        { name: "Tied to the trust balance", rows: t.tieOut },
        { name: "Rows read as fee transfers", rows: t.transfers },
        { name: "Rows with no client or matter", rows: t.unassigned }
      ],
      checks: [...r.checks, ...carried.file ? [listRowsCheck("carried-in-read", "Every row of the carried-in balances list was read", carried.file, carried.problems)] : []]
    };
  },
  examples: [
    {
      label: `The page's worked example: eleven trust rows and six invoices for four clients, as of 2026-10-31, transfer word "operating"`,
      args: { transactions: "fixture:law/earned-fees-trust.csv", invoices: "fixture:law/earned-fees-invoices.csv", asOf: "2026-10-31", transferWords: "operating" },
      verified: true,
      contains: ["fees billed $7,905.50", "fee transfers $5,590.00 (4 rows)", "Billed and not transferred $2,555.50 on 2 invoices", "transferred above billed $240.00", "Trust balance $13,025.00", "| Dogwood matter | 2 | 0988 | 2026-04-30 | 1180.00 | 1180.00 | 184 |", "| 1375.50 | 60 |", "2885.00"]
    },
    {
      label: "An invoice row whose amount cannot be read is not verified",
      args: { transactions: "fixture:law/earned-fees-trust.csv", invoices: "Invoice Date,Invoice No,Client/Matter,Fees Billed\n04/30/2026,0988,Dogwood matter,1180.00\n06/30/2026,0996,Birch estate,24OO.00\n", asOf: "2026-10-31" },
      verified: false,
      failedCheck: "invoices-read"
    }
  ]
};
function assignments(text, rows) {
  const out = /* @__PURE__ */ new Map();
  if (text === "") return out;
  const known = new Set(rows.map((t) => t.rowNumber));
  for (const part of text.split(/[;\n]/)) {
    if (part.trim() === "") continue;
    const m = /^\s*(?:row\s*)?(\d+)\s*[=:]\s*(.*)$/i.exec(part);
    if (!m) throw new AgentInputError(`"clients" must be written as "<row number> = <client or matter>", separated by semicolons or new lines: "${part.trim()}".`);
    const row = Number(m[1]);
    if (!known.has(row)) throw new AgentInputError(`Row ${row} is not a transaction row of the statement. Its transaction rows are ${[...known].slice(0, 12).join(", ")}${known.size > 12 ? ", …" : ""}.`);
    if (out.has(row)) throw new AgentInputError(`Row ${row} is given twice in "clients".`);
    out.set(row, (m[2] ?? "").trim());
  }
  return out;
}
var rebuild = {
  name: "trust_ledgers_from_bank_statement",
  page: "law-trust/trust-ledger-from-bank-statement",
  section: "law-trust",
  kind: "tool",
  title: "Client trust ledgers rebuilt from a bank statement export",
  description: "Rebuilds a law firm's client trust ledgers and the trust journal from the trust (IOLTA) account's bank statement export (.csv or .xlsx), with each transaction assigned to a client or matter from a column in the file or by row number. The statement is verified first (opening balance plus transactions equals the closing balance, and every printed running balance matches), then every transaction is placed in exactly one client ledger, each ledger re-adds, client opening balances add up to the statement's opening balance, and the client ledgers add up to the bank closing balance to the cent. A transaction with no client fails the check. Use it when someone needs client ledgers reconstructed from bank records, or wants to see which clients' money makes up the bank balance. Not for a statement in PDF form, and it makes no statement about what any rule requires.",
  question: "Our trust ledgers are a mess. Can you rebuild each client ledger from this bank statement export and check they add up to the bank balance?",
  inputs: [
    { name: "statement", kind: "file", label: "Bank statement export", description: "A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per bank transaction: a date, and either one signed amount column or separate deposit and withdrawal columns; a description, a running balance and a client or matter column are used when present.", required: true },
    { name: "openingBalance", kind: "amount", label: "Statement opening balance", description: "The opening balance printed on the bank statement.", required: true },
    { name: "closingBalance", kind: "amount", label: "Statement closing balance", description: "The closing balance printed on the bank statement.", required: true },
    { name: "order", kind: "choice", label: "Order of rows in the file", description: 'Optional. "oldest first" or "newest first", as the bank lists the transactions. Without it, oldest first.', required: false, choices: ["oldest first", "newest first"] },
    balancesInput("openingBalances", "Client opening balances", "its balance at the start of the statement period (they are compared with the statement's opening balance; leave out when the account opened at zero)"),
    { name: "clients", kind: "text", label: "Client or matter by row", description: `Optional. The client or matter for rows of the statement, as "<row number> = <client or matter>" separated by semicolons or new lines, using the row numbers the file shows (the header is row 1 in a file with no title rows). It fills in or replaces the file's client column for those rows; "<row number> =" with no name leaves a row unassigned.`, required: false },
    columnsInput("Bank statement export", TXN_COLUMNS),
    columnsInput("Client opening balances", BALANCE_COLUMNS, "openingColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven builds ledgers and compares totals; it makes no statement about what any rule, regulation, or agreement requires.",
  // The statement's rows and the client opening balances set against the opening and closing balances typed from the statement.
  comparisonChecks: ["bank-balance", "opening-ledgers", "ledgers-closing", "journal-closing"],
  run(args) {
    const { files, values } = args;
    const file = oneFile(files, "statement");
    const read = readTransactions(file, values.columns, "Bank statement export", "columns");
    const openings = readBalances(args, "openingBalances", values.openingColumns, "Client opening balances", "openingColumns");
    const typed = assignments(txt(values.clients), read.transactions);
    const ordered = values.order === "newest first" ? [...read.transactions].reverse() : read.transactions;
    const opening = centsOf(values.openingBalance);
    const closing = centsOf(values.closingBalance);
    if (opening === void 0 || closing === void 0) throw new AgentInputError("Give the opening and closing balance printed on the bank statement.");
    const transactions = ordered.map((t2) => ({ date: t2.date, description: t2.description, amount: t2.amount, ...t2.balance === void 0 ? {} : { balance: t2.balance } }));
    const input = {
      statement: { openingBalance: opening, closingBalance: closing, transactions },
      clients: ordered.map((t2) => typed.has(t2.rowNumber) ? typed.get(t2.rowNumber) : t2.client),
      openingBalances: openings.balances,
      problems: read.problems
    };
    const r = rebuildTrustLedgers(input);
    const t = trustRebuildTables(input, r);
    return {
      summary: `${plural(r.journal.length, "bank transaction")} placed in ${plural(r.ledgers.length, "client ledger")}${r.unassigned.length ? `; ${plural(r.unassigned.length, "transaction")} with no client or matter` : ""}. Sum of client ledgers ${formatUSD(r.ledgerTotal)}; bank closing balance ${formatUSD(closing)}; trust journal closing balance ${formatUSD(r.journalClosing)}.` + (read.ignoredRows ? ` ${plural(read.ignoredRows, "row")} with no date and no amount ${was(read.ignoredRows)} left out (titles, totals, or notes).` : "") + (openings.totalRows ? ` ${plural(openings.totalRows, "total row")} of the opening balances list ${was(openings.totalRows)} left out.` : ""),
      tables: [
        { name: "Summary by client", rows: t.summary },
        { name: "Client ledgers", rows: t.ledgers },
        { name: "Trust journal", rows: t.journal }
      ],
      checks: [...r.checks, ...openings.file ? [listRowsCheck("openings-read", "Every row of the client opening balances list was read", openings.file, openings.problems)] : []]
    };
  },
  examples: [
    {
      label: "The page's worked example: an April statement from $10,000.00 to $15,249.51, five transactions, opening balances for Alder matter and Birch estate",
      args: { statement: "fixture:law/trust-bank.csv", openingBalance: "10,000.00", closingBalance: "15,249.51", openingBalances: "Client or matter,Opening balance\nAlder matter,4000.00\nBirch estate,6000.00\n" },
      verified: true,
      contains: ["5 bank transactions placed in 3 client ledgers", "Sum of client ledgers $15,249.51", "trust journal closing balance $15,249.51", "| Alder matter | 4000.00 | 1 | -1250.50 | 2749.50 |", "| Birch estate | 6000.00 | 2 | 5000.00 | 11000.00 |", "| Cedar closing | 0.00 | 2 | 1500.01 | 1500.01 |"]
    },
    {
      label: "The page's counter-example: the April 3 check (row 3) left with no client is in no ledger, so the result is not verified",
      args: { statement: "fixture:law/trust-bank.csv", openingBalance: "10,000.00", closingBalance: "15,249.51", openingBalances: "Client or matter,Opening balance\nAlder matter,4000.00\nBirch estate,6000.00\n", clients: "3 =" },
      verified: false,
      failedCheck: "each-once"
    },
    {
      label: "A row whose amount cannot be read is not verified",
      args: { statement: "Date,Description,Amount,Client\n04/01/2026,DEPOSIT,2500.00,Cedar closing\n04/03/2026,CHECK 2001,-1250.5O,Alder matter\n", openingBalance: "0.00", closingBalance: "2,500.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readItems(args, name, override, label, columnsName) {
  const file = args.files[name]?.[0];
  if (!file) return { items: [], problems: [], totalRows: 0, file: "" };
  const mapping = mapLaw(file, ITEM_COLUMNS, override, label);
  try {
    const got = lawExtractOutstandingItems(file.rows, mapping);
    return { items: got.items, problems: got.problems, totalRows: got.totalRows.length, file: file.name };
  } catch (err2) {
    throw readError(err2, `${label.toLowerCase()} (${file.name})`, columnsName);
  }
}
var THREE_WAY_FIGURES = ["asOf", "bankBalance", "journalBalance", "outstandingChecks", "depositsInTransit", "clientLedgers", "priorBalance", "receipts", "disbursements", "checksColumns", "depositsColumns", "ledgerColumns"];
var threeWay = {
  name: "three_way_trust_reconciliation",
  page: "law-trust/three-way-reconciliation",
  section: "law-trust",
  kind: "tool",
  title: "Three-way trust account reconciliation to the cent",
  description: "Puts three figures for one date side by side for a law firm's trust (IOLTA) account: the adjusted bank balance (bank statement ending balance less outstanding checks plus deposits in transit), the trust journal (checkbook) balance and the sum of the client ledger balances, and compares each pair to the cent with the difference shown. The figures and differences are worked out a second way, the lists re-add, a client ledger below zero fails a check, and optional prior-period figures (prior balance plus receipts less disbursements) are compared with the journal balance. It also opens a filled-in three-way reconciliation template workbook and checks each total written on it by hand. Use it when someone asks for a three-way reconciliation, or why the bank, the checkbook and the client ledgers do not agree. Not for building the client ledgers from transactions, and it makes no statement about what any rule requires.",
  question: "Can you do the three-way reconciliation of our trust account for March 31? The bank shows $48,250, the checkbook $49,199.25, and here are the client balances and outstanding checks.",
  inputs: [
    { name: "workbook", kind: "file", label: "Filled-in template workbook", description: 'Optional. A filled-in .xlsx made with the three-way reconciliation template (sheets Reconciliation, Outstanding checks, Deposits in transit, Client ledgers). It supplies every figure and list below, so none of them (nor their column names) is given with it; only "account" may be.', required: false },
    { name: "bankBalance", kind: "amount", label: "Bank statement ending balance", description: "The bank statement ending balance for the date. Needed unless a workbook is given.", required: false },
    { name: "journalBalance", kind: "amount", label: "Trust journal balance", description: "The trust journal (checkbook register) balance on the same date. Needed unless a workbook is given.", required: false },
    { name: "outstandingChecks", kind: "file", label: "Outstanding checks", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per check written in the trust journal that is not on the bank statement yet: an amount, with a date and a check number or payee when known. A row labelled Total is left out.", required: false },
    { name: "depositsInTransit", kind: "file", label: "Deposits in transit", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per deposit recorded in the trust journal that is not on the bank statement yet: an amount, with a date and a note when known.", required: false },
    { name: "clientLedgers", kind: "file", label: "Client ledger balances", description: "Optional. A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per client or matter: the name and its ledger balance on the date. A row labelled Total is left out.", required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the three figures are as of, YYYY-MM-DD.", required: false },
    { name: "priorBalance", kind: "amount", label: "Prior period reconciled balance", description: "Optional. With receipts and disbursements: last period's reconciled balance, compared after the period's activity with this trust journal balance.", required: false },
    { name: "receipts", kind: "amount", label: "Receipts this period", description: "Optional. Money into the trust account this period, as a positive amount.", required: false },
    { name: "disbursements", kind: "amount", label: "Disbursements this period", description: "Optional. Money out of the trust account this period, as a positive amount.", required: false },
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name for the summary.", required: false },
    columnsInput("Outstanding checks", ITEM_COLUMNS, "checksColumns"),
    columnsInput("Deposits in transit", ITEM_COLUMNS, "depositsColumns"),
    columnsInput("Client ledger balances", BALANCE_COLUMNS, "ledgerColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven shows whether three figures are equal and by how much they differ; it does not check any rule and makes no statement about what any rule, regulation, or agreement requires.",
  // The three figures set against each other, the roll-forward against the journal balance typed, and each total
  // written by hand on a workbook against the calculation: the page shows the figures and differences beside them.
  comparisonChecks: ["bank-journal", "journal-ledgers", "bank-ledgers", "continuity", "written-checksTotal", "written-depositsTotal", "written-adjusted", "written-ledgerTotal", "written-bankVsJournal", "written-journalVsLedgers", "written-bankVsLedgers"],
  run(args) {
    const { files, values } = args;
    const book = files.workbook?.[0];
    let input;
    let account = txt(values.account);
    let fromBook = null;
    const listChecks = [];
    let totalRows = 0;
    if (book) {
      const also = THREE_WAY_FIGURES.filter((k) => values[k] !== void 0 || files[k] !== void 0);
      if (also.length) throw new AgentInputError(`A filled-in workbook supplies every figure and list itself. Give either the workbook or the figures, not both (also given: ${also.join(", ")}).`);
      try {
        fromBook = readThreeWayWorkbook(book.sheets);
      } catch (err2) {
        throw new AgentInputError(`The workbook (${book.name}): ${err2 instanceof Error ? err2.message : "it could not be read."}`);
      }
      input = fromBook.input;
      account = account || fromBook.account;
      totalRows = fromBook.totalRows;
    } else {
      const bank = centsOf(values.bankBalance);
      const journal = centsOf(values.journalBalance);
      if (bank === void 0 || journal === void 0) throw new AgentInputError('Give the bank statement ending balance ("bankBalance") and the trust journal balance ("journalBalance"), or a filled-in template workbook ("workbook").');
      const checks = readItems(args, "outstandingChecks", values.checksColumns, "Outstanding checks", "checksColumns");
      const deposits = readItems(args, "depositsInTransit", values.depositsColumns, "Deposits in transit", "depositsColumns");
      const ledgers = readBalances(args, "clientLedgers", values.ledgerColumns, "Client ledger balances", "ledgerColumns");
      if (checks.file) listChecks.push(listRowsCheck("checks-rows-read", "Every row of the outstanding checks list was read", checks.file, checks.problems));
      if (deposits.file) listChecks.push(listRowsCheck("deposits-rows-read", "Every row of the deposits in transit list was read", deposits.file, deposits.problems));
      if (ledgers.file) listChecks.push(listRowsCheck("ledgers-rows-read", "Every row of the client ledger balances list was read", ledgers.file, ledgers.problems));
      totalRows = checks.totalRows + deposits.totalRows + ledgers.totalRows;
      input = { asOf: txt(values.asOf), bankEndingBalance: bank, outstandingChecks: checks.items, depositsInTransit: deposits.items, journalBalance: journal, clientLedgers: ledgers.balances };
      const prior = [centsOf(values.priorBalance), centsOf(values.receipts), centsOf(values.disbursements)];
      if (prior.some((p) => p !== void 0)) input.continuity = { priorBalance: prior[0] ?? 0, receipts: prior[1] ?? 0, disbursements: prior[2] ?? 0 };
    }
    const r = threeWayReconcile(input);
    const t = threeWayTables(input, r);
    const differences = [
      ["adjusted bank − trust journal", r.bankVsJournal],
      ["trust journal − client ledgers", r.journalVsLedgers],
      ["adjusted bank − client ledgers", r.bankVsLedgers]
    ];
    const head = [account, input.asOf ? `as of ${input.asOf}` : ""].filter(Boolean).join(", ").replace(/^as of/, "As of");
    const written = fromBook ? Object.keys(fromBook.written).length : 0;
    return {
      summary: `${head ? `${head}: adjusted` : "Adjusted"} bank balance ${formatUSD(r.adjustedBankBalance)} (bank ${formatUSD(input.bankEndingBalance)} ` +
        `− ${plural(input.outstandingChecks.length, "outstanding check")} ${formatUSD(r.outstandingChecksTotal)} ` +
        `+ ${plural(input.depositsInTransit.length, "deposit")} in transit ${formatUSD(r.depositsInTransitTotal)}), ` +
        `trust journal balance ${formatUSD(r.journalBalance)}, sum of ${plural(input.clientLedgers.length, "client ledger")} ` +
        `${formatUSD(r.clientLedgerTotal)}. ` + (r.agree ? `The three balances agree at ${formatUSD(r.adjustedBankBalance)}.` : `The three balances differ: ${differences.filter(([, d]) => d !== 0).map(([label, d]) => `${label} is ${formatUSD(d)}`).join("; ")}.`) + (input.continuity && r.continuityBalance !== void 0 ? ` Prior period balance ${formatUSD(input.continuity.priorBalance)} + receipts ${formatUSD(input.continuity.receipts)} ` +
        `− disbursements ${formatUSD(input.continuity.disbursements)} = ${formatUSD(r.continuityBalance)}.` : "") + (r.negativeLedgers.length ? ` ${plural(r.negativeLedgers.length, "client ledger")} below zero.` : "") + (totalRows ? ` ${plural(totalRows, "row")} labelled as a total ${was(totalRows)} left out.` : "") + (written ? ` ${plural(written, "total or difference", "totals or differences")} written on the workbook's Reconciliation ` +
        `sheet ${was(written)} compared with the calculation.` : ""),
      tables: [
        { name: "Three-way reconciliation", rows: t.summary },
        { name: "Outstanding checks", rows: t.outstandingChecks },
        { name: "Deposits in transit", rows: t.depositsInTransit },
        { name: "Client ledger balances", rows: t.clientLedgers }
      ],
      checks: fromBook ? [...threeWayWorkbookChecks(fromBook, r), ...r.checks] : [...r.checks, ...listChecks]
    };
  },
  examples: [
    {
      label: "The page's worked example: March 31, 2026, two outstanding checks, one deposit in transit, four client ledgers, and the prior-period figures",
      args: {
        asOf: "2026-03-31",
        bankBalance: "48,250.00",
        outstandingChecks: "fixture:law/outstanding-checks.csv",
        depositsInTransit: 'Date,Description,Amount\n2026-03-31,Deposit - closing funds,"2,500.00"\n',
        journalBalance: "49,199.25",
        clientLedgers: "fixture:law/client-balances.csv",
        priorBalance: "41,300.00",
        receipts: "22,400.00",
        disbursements: "14,500.75"
      },
      verified: true,
      contains: ["adjusted bank balance $49,199.25", "2 outstanding checks $1,550.75", "1 deposit in transit $2,500.00", "sum of 4 client ledgers $49,199.25", "The three balances agree at $49,199.25", "= $49,199.25.", "| Difference: adjusted bank − trust journal | 0.00 |", "| Roll-forward balance | 49199.25 |"]
    },
    {
      label: "The page's counter-example: a trust journal of $49,199.24 differs by a cent, so the result is not verified",
      args: {
        asOf: "2026-03-31",
        bankBalance: "48,250.00",
        outstandingChecks: "fixture:law/outstanding-checks.csv",
        depositsInTransit: "Date,Amount\n2026-03-31,2500.00\n",
        journalBalance: "49,199.24",
        clientLedgers: "fixture:law/client-balances.csv"
      },
      verified: false,
      failedCheck: "bank-journal",
      contains: ["adjusted bank − trust journal is $0.01", "trust journal − client ledgers is -$0.01"]
    },
    {
      label: "A client ledger row whose balance cannot be read is not verified",
      args: { bankBalance: "100.00", journalBalance: "100.00", clientLedgers: "Client / Matter,Ledger Balance\nAlder matter,100.00\nBirch estate,1OO.00\n" },
      verified: false,
      failedCheck: "ledgers-rows-read"
    }
  ]
};
function rowCount(value, name, fallback) {
  const raw = txt(value);
  if (raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new AgentInputError(`"${name}" must be a whole number from 1 to 500: "${raw}".`);
  return Number(raw);
}
var template = {
  name: "three_way_reconciliation_template",
  page: "law-trust/three-way-reconciliation-template",
  section: "law-trust",
  kind: "template",
  title: "Three-way trust reconciliation workbook to fill in",
  description: "Builds a blank Excel workbook (.xlsx) laid out for a monthly three-way reconciliation of a law firm's trust (IOLTA) account: a Reconciliation sheet (firm or account, as-of date, bank statement ending balance, the lines for totals and differences, trust journal balance, optional prior-period lines), numbered Outstanding checks, Deposits in transit and Client ledgers sheets, and an Instructions sheet, with client or matter names filled in when given. The finished file is read back before it is handed over: the five sheet names, every Reconciliation line, each list's header and number of rows, and every name are compared with what was asked for, and no cell holds a formula. Use it when someone wants a three-way reconciliation template or spreadsheet to fill in by hand. Not for doing the reconciliation itself, and it makes no statement about what any rule requires.",
  question: "Can you give me a blank three-way reconciliation spreadsheet for our IOLTA account with our client names on it?",
  inputs: [
    { name: "account", kind: "text", label: "Firm or account name", description: "Optional. The firm or trust account name written on the Reconciliation sheet.", required: false },
    { name: "asOf", kind: "date", label: "As-of date", description: "Optional. The date the reconciliation is for, YYYY-MM-DD, written on the Reconciliation sheet.", required: false },
    { name: "clients", kind: "text", label: "Client or matter names", description: "Optional. Client or matter names, one per line: each line gets its own numbered row on the Client ledgers sheet, in order.", required: false },
    { name: "clientRows", kind: "number", label: "Client ledger rows", description: "Optional. Rows on the Client ledgers sheet, a whole number from 1 to 500; every name given still gets a row. Without it, 20.", required: false },
    { name: "checkRows", kind: "number", label: "Outstanding check rows", description: "Optional. Rows on the Outstanding checks sheet, a whole number from 1 to 500. Without it, 15.", required: false },
    { name: "depositRows", kind: "number", label: "Deposit in transit rows", description: "Optional. Rows on the Deposits in transit sheet, a whole number from 1 to 500. Without it, 5.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds its own layout in generic terms, values only with no formulas; it makes no statement about what any rule, regulation, or agreement requires.",
  run({ values }) {
    const options = {
      account: txt(values.account),
      asOf: txt(values.asOf),
      clients: txt(values.clients).split(/\r?\n/),
      clientRows: rowCount(values.clientRows, "clientRows", 20),
      checkRows: rowCount(values.checkRows, "checkRows", 15),
      depositRows: rowCount(values.depositRows, "depositRows", 5),
      reportUrl: `${SITE_URL}/law-trust/three-way-reconciliation/?src=template`
    };
    const sheets = threeWayTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = verifyThreeWayTemplate(options, readXlsx(bytes));
    const names = threeWayTemplateClients(options.clients);
    const rows = (i) => (sheets[i]?.rows.length ?? 1) - 1;
    const slug = options.account.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return {
      summary: `A workbook of ${plural(sheets.length, "sheet")}${options.account ? ` for ${options.account.replace(/\s+/g, " ")}` : ""}${options.asOf ? ` as of ${options.asOf}` : ""}: ${plural(rows(3), "client ledger row")}${names.length ? ` (${names.length} named: ${names.join(", ")})` : ""}, ${plural(rows(1), "outstanding check row")} and ${plural(rows(2), "deposit in transit row")}. Every amount is left blank to fill in; values only, no formulas.`,
      tables: [{ name: "What the workbook holds", rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), s.rows.length - 1])] }],
      checks,
      file: { suggestedName: `${["three-way-reconciliation-template", slug].filter(Boolean).join("-")}.xlsx`, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Law Office trust account as of 2026-03-31, four client names, 6 client ledger rows, 5 outstanding check rows, 3 deposit rows",
      args: { account: "Example Law Office trust account", asOf: "2026-03-31", clients: "Alder matter\nBirch estate\nCedar closing\nFirm funds", clientRows: "6", checkRows: "5", depositRows: "3" },
      verified: true,
      contains: ["| Reconciliation | Item, Value | 14 |", "| Outstanding checks | Line, Date, Check number, Payee, Amount | 5 |", "| Deposits in transit | Line, Date, Description, Amount | 3 |", "| Client ledgers | Line, Client or matter, Balance | 6 |", "| Instructions | How this workbook is laid out | 10 |", "4 named: Alder matter, Birch estate, Cedar closing, Firm funds"]
    },
    {
      label: "A name that starts with an equals sign reads back like a formula, so the workbook is not verified",
      args: { account: "=Example Law Office" },
      verified: false,
      failedCheck: "values-only"
    }
  ]
};
var LAW_TRUST = [threeWay, ledgerCard, cashJournal, scanner, rebuild, earnedFees, dormant, template];
var LAW_TRUST_NOT_FOR_AGENTS = [];

export {
  writeXlsx,
  readXlsx,
  AgentInputError,
  checkValue,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  TXN_COLUMNS,
  BALANCE_COLUMNS,
  ITEM_COLUMNS,
  INVOICE_COLUMNS,
  CARRIED_COLUMNS,
  LAW_TRUST,
  LAW_TRUST_NOT_FOR_AGENTS
};
