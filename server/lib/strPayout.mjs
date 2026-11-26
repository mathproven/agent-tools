// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmDaysBetween,
  pmNormalizeHeader
} from "./reconcile.mjs";
import {
  CheckList,
  assertCents,
  formatUSD,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/property/strPayout.ts
var STR_COMPONENT_ROLES = ["gross", "hostFee", "cleaningFee", "taxes", "adjustments"];
var STR_PAYOUT_ROLES = ["code", "payoutId", "payoutDate", "gross", "hostFee", "cleaningFee", "taxes", "adjustments", "payoutAmount"];
var STR_BANK_ROLES = ["date", "description", "amount"];
var STR_ROLE_LABELS = {
  code: "Reservation or confirmation code",
  payoutId: "Payout id or reference",
  payoutDate: "Payout date",
  gross: "Gross earnings",
  hostFee: "Host or service fees",
  cleaningFee: "Cleaning fees",
  taxes: "Taxes withheld or remitted",
  adjustments: "Adjustments or resolutions",
  payoutAmount: "Payout amount"
};
var STR_BANK_LABELS = { date: "Date", description: "Description", amount: "Amount" };
var STR_DEFAULT_EFFECTS = { gross: "add", hostFee: "subtract", cleaningFee: "add", taxes: "subtract", adjustments: "add" };
var STR_DEFAULT_WINDOW_DAYS = 5;
var PAYOUT_SYNONYMS = {
  payoutDate: ["payout date", "paid out date", "payment date", "disbursement date", "date paid", "paid date", "deposit date", "date"],
  payoutId: ["payout id", "payout reference", "payout number", "transfer id", "disbursement id", "payment id", "reference code", "reference"],
  code: ["confirmation code", "reservation code", "reservation id", "booking id", "reservation number", "booking number", "confirmation", "reservation", "booking", "code"],
  cleaningFee: ["cleaning fee", "cleaning fees", "cleaning"],
  taxes: ["occupancy taxes", "occupancy tax", "taxes withheld", "tax withheld", "taxes remitted", "taxes", "tax"],
  adjustments: ["adjustments", "adjustment", "resolutions", "resolution"],
  hostFee: ["host fee", "host service fee", "service fee", "service fees", "platform fee", "commission", "booking fee", "fees", "fee"],
  gross: ["gross earnings", "gross amount", "gross booking amount", "gross rent", "gross", "booking amount", "rental amount", "accommodation fare"],
  payoutAmount: ["payout amount", "net payout", "paid out", "amount paid", "payout", "net amount", "total payout", "disbursement amount", "net", "amount", "total"]
};
var PAYOUT_ORDER = ["payoutDate", "payoutId", "code", "cleaningFee", "taxes", "adjustments", "hostFee", "gross", "payoutAmount"];
var BANK_SYNONYMS = {
  date: ["date", "posting date", "posted date", "post date", "transaction date", "effective date"],
  description: ["description", "transaction description", "memo", "details", "narrative", "payee", "name"],
  amount: ["amount", "transaction amount", "deposit amount", "credit", "credits", "deposits", "deposit"]
};
var BANK_ORDER = ["date", "description", "amount"];
var NOT_MONEY = /\b(date|id|code|reference|number|method|status|type|currency|name|guest|listing)\b/;
var NOT_LABEL = /\b(date|amount|fee|fees|tax|taxes)\b/;
var MONEY_ROLES = /* @__PURE__ */ new Set([...STR_COMPONENT_ROLES, "payoutAmount", "amount"]);
var DATE_ROLES = /* @__PURE__ */ new Set(["payoutDate", "date"]);
function matchHeaders(header, order, synonyms) {
  const names = header.map(pmNormalizeHeader);
  const found = Object.fromEntries(order.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  const allowed = (role, name) => {
    if (DATE_ROLES.has(role)) return true;
    return MONEY_ROLES.has(role) ? !NOT_MONEY.test(name) : !NOT_LABEL.test(name);
  };
  for (const exact of [true, false]) {
    for (const role of order) {
      if (found[role] >= 0) continue;
      search: for (const syn of synonyms[role]) {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (taken.has(i) || name === "") continue;
          const hit = exact ? name === syn : ` ${name} `.includes(` ${syn} `) && allowed(role, name);
          if (hit) {
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
function bestHeaderRow(rows, order, synonyms) {
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
function columnSigns(rows, headerRow, col) {
  let negative = 0;
  let positive = 0;
  if (col < 0) return { negative, positive };
  for (const row of rows.slice(headerRow + 1)) {
    const raw = (row[col] ?? "").trim();
    if (!raw) continue;
    try {
      const c = pmCellToCents(raw);
      if (c < 0) negative++;
      else if (c > 0) positive++;
    } catch {
    }
  }
  return { negative, positive };
}
function strGuessPayoutColumns(rows, atHeaderRow) {
  const { headerRow, columns } = atHeaderRow === void 0 ? bestHeaderRow(rows, PAYOUT_ORDER, PAYOUT_SYNONYMS) : { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], PAYOUT_ORDER, PAYOUT_SYNONYMS) };
  const effects = { ...STR_DEFAULT_EFFECTS };
  for (const role of ["hostFee", "taxes"]) {
    const signs = columnSigns(rows, headerRow, columns[role]);
    if (signs.negative > 0 && signs.positive === 0) effects[role] = "add";
  }
  return { headerRow, columns, effects };
}
function strGuessBankColumns(rows, atHeaderRow) {
  const { headerRow, columns } = atHeaderRow === void 0 ? bestHeaderRow(rows, BANK_ORDER, BANK_SYNONYMS) : { headerRow: atHeaderRow, columns: matchHeaders(rows[atHeaderRow] ?? [], BANK_ORDER, BANK_SYNONYMS) };
  return { headerRow, columns, depositsAreNegative: false };
}
function headerList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}
function requireColumn(col, label, rows, headerRow) {
  if (col === void 0 || !Number.isSafeInteger(col) || col < 0) {
    throw new Error(`No "${label}" column could be identified (${headerList(rows, headerRow)}). Choose it in the column mapping.`);
  }
  return col;
}
function strExtractPayoutLines(rows, mapping, options = {}) {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The payout report has no rows under its header row.");
  const dateCol = requireColumn(mapping.columns.payoutDate, STR_ROLE_LABELS.payoutDate, rows, mapping.headerRow);
  const amountCol = requireColumn(mapping.columns.payoutAmount, STR_ROLE_LABELS.payoutAmount, rows, mapping.headerRow);
  const used = STR_PAYOUT_ROLES.map((r) => mapping.columns[r]).filter((c) => c >= 0);
  if (new Set(used).size !== used.length) throw new Error("The same report column is chosen for two different parts. Each column can be used once.");
  const cell = (row, col) => col >= 0 ? (row[col] ?? "").trim() : "";
  const lines = [];
  const problems = [];
  const assumptions = [];
  let ignoredRows = 0;
  const undatedRows = options.undatedRows ?? "report";
  const amountRoles = [...STR_COMPONENT_ROLES, "payoutAmount"];
  let sectionStart = 0;
  const readableAmounts = (row) => {
    const found = /* @__PURE__ */ new Map();
    for (const role of amountRoles) {
      const raw = cell(row, role === "payoutAmount" ? amountCol : mapping.columns[role]);
      if (!raw) continue;
      try {
        found.set(role, pmCellToCents(raw));
      } catch {
      }
    }
    return found;
  };
  const isTotalOf = (amounts, scope) => {
    if (scope.length < 2) return false;
    for (const [role, value] of amounts) {
      let total = 0n;
      for (const l of scope) total += BigInt(role === "payoutAmount" ? l.payoutAmount : l.components[role] ?? 0);
      if (total !== BigInt(value)) return false;
    }
    return true;
  };
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((c) => c.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = cell(row, dateCol);
    const code = cell(row, mapping.columns.code);
    let payoutId = cell(row, mapping.columns.payoutId);
    const reasons = [];
    let payoutDate = "";
    if (!rawDate) {
      const amounts = readableAmounts(row);
      const unlabelled = !code && !payoutId;
      if (amounts.size === 0 && unlabelled) {
        ignoredRows++;
        return;
      }
      if (unlabelled && amounts.size > 0 && (isTotalOf(amounts, lines.slice(sectionStart)) || isTotalOf(amounts, lines))) {
        ignoredRows++;
        sectionStart = lines.length;
        return;
      }
      if (undatedRows === "leave-out" && unlabelled) {
        assumptions.push({ rowNumber, reason: "has an amount but no payout date; left out as a total or note, as chosen" });
        return;
      }
      const above = lines[lines.length - 1];
      if (undatedRows === "inherit" && above) {
        payoutDate = above.payoutDate;
        if (!payoutId) payoutId = above.payoutId;
        assumptions.push({ rowNumber, reason: `has no payout date; given ${above.payoutDate} from row ${above.rowNumber} above it, as chosen` });
      } else {
        reasons.push(amounts.size > 0 ? "has an amount but no payout date" : "no payout date");
      }
    } else {
      try {
        payoutDate = pmCellToIsoDate(rawDate, mapping.dateOrder ?? "mdy");
      } catch {
        reasons.push(`the payout date "${rawDate}" could not be read`);
      }
    }
    let payoutAmount = 0;
    const rawAmount = cell(row, amountCol);
    if (!rawAmount) reasons.push("no payout amount");
    else {
      try {
        payoutAmount = pmCellToCents(rawAmount);
      } catch {
        reasons.push(`the payout amount "${rawAmount}" could not be read`);
      }
    }
    const components = {};
    for (const role of STR_COMPONENT_ROLES) {
      const raw = cell(row, mapping.columns[role]);
      if (!raw) continue;
      try {
        components[role] = pmCellToCents(raw);
      } catch {
        reasons.push(`${STR_ROLE_LABELS[role].toLowerCase()} "${raw}" could not be read`);
      }
    }
    if (reasons.length) problems.push({ rowNumber, reason: reasons.join("; ") });
    else lines.push({ rowNumber, code, payoutId, payoutDate, components, payoutAmount });
  });
  if (lines.length === 0 && problems.length === 0) throw new Error("No payout rows were found under the header row. Check the header row and the column mapping.");
  return { lines, problems, ignoredRows, assumptions };
}
function strExtractBankDeposits(rows, mapping, onlyContaining = "") {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The bank file has no rows under its header row.");
  const dateCol = requireColumn(mapping.columns.date, "Bank date", rows, mapping.headerRow);
  const amountCol = requireColumn(mapping.columns.amount, "Bank amount", rows, mapping.headerRow);
  const descCol = mapping.columns.description;
  if (dateCol === amountCol || descCol === dateCol || descCol === amountCol) throw new Error("The same bank column is chosen for two different parts. Each column can be used once.");
  const filter = onlyContaining.trim().toLowerCase();
  const deposits = [];
  const problems = [];
  let otherRows = 0;
  let filteredOut = 0;
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((c) => c.trim() === "")) return;
    const rowNumber = index + 1;
    const rawDate = (row[dateCol] ?? "").trim();
    const rawAmount = (row[amountCol] ?? "").trim();
    if (!rawDate && !rawAmount) return;
    if (!rawAmount) {
      otherRows++;
      return;
    }
    let date;
    let amount;
    try {
      date = pmCellToIsoDate(rawDate, mapping.dateOrder ?? "mdy");
    } catch {
      problems.push({ rowNumber, reason: rawDate ? `the date "${rawDate}" could not be read` : "no date" });
      return;
    }
    try {
      amount = pmCellToCents(rawAmount, { crIsNegative: false });
    } catch {
      problems.push({ rowNumber, reason: `the amount "${rawAmount}" could not be read` });
      return;
    }
    if (mapping.depositsAreNegative) amount = -amount;
    if (amount <= 0) {
      otherRows++;
      return;
    }
    const description = descCol >= 0 ? (row[descCol] ?? "").trim() : "";
    if (filter && !description.toLowerCase().includes(filter)) {
      filteredOut++;
      return;
    }
    deposits.push({ id: `D${deposits.length + 1}`, rowNumber, date, description, amount });
  });
  return { deposits, problems, otherRows, filteredOut };
}
function bucket(amounts) {
  return { count: amounts.length, sum: sum(amounts) };
}
function reconcileStrPayouts(input) {
  const windowDays = input.windowDays ?? STR_DEFAULT_WINDOW_DAYS;
  if (!Number.isSafeInteger(windowDays) || windowDays < 0 || windowDays > 60) throw new Error("The date window must be a whole number of days from 0 to 60.");
  const rowSeen = /* @__PURE__ */ new Set();
  for (const l of input.lines) {
    assertCents(l.payoutAmount, `payout amount on row ${l.rowNumber}`);
    for (const role of STR_COMPONENT_ROLES) if (l.components[role] !== void 0) assertCents(l.components[role], `${role} on row ${l.rowNumber}`);
    if (!isIsoDate(l.payoutDate)) throw new Error(`Row ${l.rowNumber} has no valid payout date.`);
    if (rowSeen.has(l.rowNumber)) throw new Error(`Row ${l.rowNumber} appears twice in the report rows.`);
    rowSeen.add(l.rowNumber);
  }
  const depositSeen = /* @__PURE__ */ new Set();
  for (const d of input.deposits) {
    assertCents(d.amount, `bank amount on row ${d.rowNumber}`);
    if (d.amount <= 0) throw new Error(`Bank row ${d.rowNumber} is not a deposit.`);
    if (!isIsoDate(d.date)) throw new Error(`Bank row ${d.rowNumber} has no valid date.`);
    if (depositSeen.has(d.id)) throw new Error(`Deposit ${d.id} appears twice in the bank rows.`);
    depositSeen.add(d.id);
  }
  const componentsMapped = input.lines.some((l) => STR_COMPONENT_ROLES.some((r) => l.components[r] !== void 0));
  const lines = input.lines.map((l) => {
    let computedPayout = 0;
    for (const role of STR_COMPONENT_ROLES) {
      const amount = l.components[role] ?? 0;
      computedPayout += input.effects[role] === "subtract" ? -amount : amount;
    }
    assertCents(computedPayout, `computed payout on row ${l.rowNumber}`);
    if (!componentsMapped) return { ...l, components: { ...l.components }, computedPayout: l.payoutAmount, difference: 0, ties: true };
    return { ...l, components: { ...l.components }, computedPayout, difference: l.payoutAmount - computedPayout, ties: computedPayout === l.payoutAmount };
  });
  const everyRowHasId = lines.length > 0 && lines.every((l) => l.payoutId !== "");
  const groupedBy = input.groupBy === "payoutId" || (input.groupBy ?? "auto") === "auto" && everyRowHasId ? "payoutId" : "date";
  if (groupedBy === "payoutId" && !everyRowHasId) throw new Error("Grouping by payout id needs a payout id on every row. Group by payout date instead, or fix the payout id column.");
  const groups = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const key = groupedBy === "payoutId" ? l.payoutId : l.payoutDate;
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }
  const payouts = [...groups.entries()].map(([key, g]) => ({
    key,
    date: g.reduce((latest, l) => l.payoutDate > latest ? l.payoutDate : latest, g[0].payoutDate),
    amount: sum(g.map((l) => l.payoutAmount)),
    lineRows: g.map((l) => l.rowNumber),
    codes: [...new Set(g.map((l) => l.code).filter(Boolean))]
  })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((p, i) => ({ id: `P${i + 1}`, ...p }));
  const deposits = input.deposits.map((d) => ({ ...d }));
  const payoutLinks = new Map(payouts.map((p) => [p.id, []]));
  const depositLinks = new Map(deposits.map((d) => [d.id, []]));
  const depositsByAmount = /* @__PURE__ */ new Map();
  for (const d of deposits) {
    const list = depositsByAmount.get(d.amount);
    if (list) list.push(d);
    else depositsByAmount.set(d.amount, [d]);
  }
  for (const p of payouts) {
    if (p.amount <= 0) continue;
    for (const d of depositsByAmount.get(p.amount) ?? []) {
      if (Math.abs(pmDaysBetween(p.date, d.date)) <= windowDays) {
        payoutLinks.get(p.id).push(d.id);
        depositLinks.get(d.id).push(p.id);
      }
    }
  }
  const payoutById = new Map(payouts.map((p) => [p.id, p]));
  const depositById = new Map(deposits.map((d) => [d.id, d]));
  const matches = [];
  const ambiguous = [];
  const unmatchedPayoutIds = [];
  const visitedPayouts = /* @__PURE__ */ new Set();
  const visitedDeposits = /* @__PURE__ */ new Set();
  for (const start of payouts) {
    if (visitedPayouts.has(start.id)) continue;
    const groupPayouts = [];
    const groupDeposits = [];
    const queue = [{ side: "p", id: start.id }];
    visitedPayouts.add(start.id);
    while (queue.length) {
      const node = queue.shift();
      if (node.side === "p") {
        groupPayouts.push(node.id);
        for (const dId of payoutLinks.get(node.id)) {
          if (!visitedDeposits.has(dId)) {
            visitedDeposits.add(dId);
            queue.push({ side: "d", id: dId });
          }
        }
      } else {
        groupDeposits.push(node.id);
        for (const pId of depositLinks.get(node.id)) {
          if (!visitedPayouts.has(pId)) {
            visitedPayouts.add(pId);
            queue.push({ side: "p", id: pId });
          }
        }
      }
    }
    if (groupDeposits.length === 0) unmatchedPayoutIds.push(start.id);
    else if (groupPayouts.length === 1 && groupDeposits.length === 1) {
      const d = depositById.get(groupDeposits[0]);
      matches.push({ payoutId: start.id, depositId: d.id, amount: start.amount, daysApart: pmDaysBetween(start.date, d.date) });
    } else {
      ambiguous.push({ amount: start.amount, payoutIds: groupPayouts.sort(byIdNumber), depositIds: groupDeposits.sort(byIdNumber) });
    }
  }
  const unmatchedDepositIds = deposits.filter((d) => !visitedDeposits.has(d.id)).map((d) => d.id);
  const amountsOf = (ids, byId) => ids.map((id) => byId.get(id).amount);
  const totals = {
    payouts: {
      all: bucket(payouts.map((p) => p.amount)),
      matched: bucket(amountsOf(matches.map((m) => m.payoutId), payoutById)),
      ambiguous: bucket(amountsOf(ambiguous.flatMap((a) => a.payoutIds), payoutById)),
      unmatched: bucket(amountsOf(unmatchedPayoutIds, payoutById))
    },
    deposits: {
      all: bucket(deposits.map((d) => d.amount)),
      matched: bucket(amountsOf(matches.map((m) => m.depositId), depositById)),
      ambiguous: bucket(amountsOf(ambiguous.flatMap((a) => a.depositIds), depositById)),
      unmatched: bucket(amountsOf(unmatchedDepositIds, depositById))
    }
  };
  const result = {
    windowDays,
    groupedBy,
    effects: { ...input.effects },
    componentsMapped,
    lines,
    payouts,
    deposits,
    matches,
    ambiguous,
    unmatchedPayoutIds,
    unmatchedDepositIds,
    totals,
    lineProblems: [...input.lineProblems ?? []],
    bankProblems: [...input.bankProblems ?? []],
    lineAssumptions: [...input.lineAssumptions ?? []]
  };
  return { ...result, checks: verifyStrReconciliation(result) };
}
function byIdNumber(a, b) {
  return Number(a.slice(1)) - Number(b.slice(1));
}
function dayNumber(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 864e5);
}
function verifyStrReconciliation(r) {
  const checks = new CheckList();
  const B = BigInt;
  const unread = r.lineProblems.length + r.bankProblems.length;
  const firstProblem = r.lineProblems[0] ? `report row ${r.lineProblems[0].rowNumber}: ${r.lineProblems[0].reason}` : r.bankProblems[0] ? `bank row ${r.bankProblems[0].rowNumber}: ${r.bankProblems[0].reason}` : "";
  checks.that("rows-read", "Every row with data in both files was read", unread === 0, `${unread} row(s) could not be read and are not in the result; first: ${firstProblem}`);
  const assumed = r.lineAssumptions ?? [];
  if (assumed.length) {
    checks.that(
      "rows-assumed",
      "Every report row carries its own payout date",
      false,
      `${assumed.slice(0, 8).map((a) => `row ${a.rowNumber} ${a.reason}`).join("; ")}${assumed.length > 8 ? `; and ${assumed.length - 8} more` : ""}`,
      "warning"
    );
  }
  const anyComponent = r.lines.some((l) => STR_COMPONENT_ROLES.some((role) => l.components[role] !== void 0));
  let notTying = 0;
  let firstOff = "";
  let rowsConsistent = anyComponent === r.componentsMapped;
  for (const l of r.lines) {
    let net = 0n;
    for (const role of STR_COMPONENT_ROLES) {
      const amount = B(l.components[role] ?? 0);
      net += r.effects[role] === "subtract" ? -amount : amount;
    }
    const ties = !anyComponent || net === B(l.payoutAmount);
    if (!ties) {
      notTying++;
      if (!firstOff) firstOff = `row ${l.rowNumber} is off by ${formatUSD(Number(B(l.payoutAmount) - net))}`;
    }
    if (ties !== l.ties) rowsConsistent = false;
    if (anyComponent && (B(l.computedPayout) !== net || B(l.difference) !== B(l.payoutAmount) - net)) rowsConsistent = false;
  }
  if (anyComponent) {
    checks.that("rows-tie", "Every report row ties: gross − fees ± other mapped amounts = payout", notTying === 0, `${notTying} row(s) do not tie; first: ${firstOff}`);
  } else {
    checks.that("components-mapped", "Gross, fee, or adjustment columns are mapped, so each row can be tied to its payout", false, "Only the payout amount is mapped; rows were not checked", "warning");
  }
  checks.that("rows-consistent", "The row results shown match a second calculation of each row", rowsConsistent);
  const lineByRow = new Map(r.lines.map((l) => [l.rowNumber, l]));
  const rowUse = /* @__PURE__ */ new Map();
  let groupsOk = true;
  for (const p of r.payouts) {
    let total = 0n;
    for (const row of p.lineRows) {
      rowUse.set(row, (rowUse.get(row) ?? 0) + 1);
      const l = lineByRow.get(row);
      if (!l) groupsOk = false;
      else total += B(l.payoutAmount);
    }
    if (total !== B(p.amount)) groupsOk = false;
  }
  if (r.lines.some((l) => rowUse.get(l.rowNumber) !== 1) || rowUse.size !== r.lines.length) groupsOk = false;
  checks.that("rows-grouped", "Every report row is in exactly one payout, and each payout is the sum of its rows", groupsOk);
  const lineTotal = r.lines.reduce((a, l) => a + B(l.payoutAmount), 0n);
  const payoutTotal = r.payouts.reduce((a, p) => a + B(p.amount), 0n);
  checks.cents("rows-total", "Report rows add up to the payouts", Number(lineTotal), Number(payoutTotal));
  const candidates = (p, d) => p.amount > 0 && p.amount === d.amount && Math.abs(dayNumber(d.date) - dayNumber(p.date)) <= r.windowDays;
  const depositsFor = new Map(r.payouts.map((p) => [p.id, r.deposits.filter((d) => candidates(p, d)).length]));
  const payoutsFor = new Map(r.deposits.map((d) => [d.id, r.payouts.filter((p) => candidates(p, d)).length]));
  const payoutById = new Map(r.payouts.map((p) => [p.id, p]));
  const depositById = new Map(r.deposits.map((d) => [d.id, d]));
  const matchedP = r.matches.map((m) => m.payoutId);
  const matchedD = r.matches.map((m) => m.depositId);
  checks.that("match-unique-payout", "No payout is matched twice", new Set(matchedP).size === matchedP.length);
  checks.that("match-unique-deposit", "No bank deposit is matched twice", new Set(matchedD).size === matchedD.length);
  let exact = true;
  let unambiguous = true;
  for (const m of r.matches) {
    const p = payoutById.get(m.payoutId);
    const d = depositById.get(m.depositId);
    if (!p || !d || !candidates(p, d) || m.amount !== p.amount || m.daysApart !== dayNumber(d.date) - dayNumber(p.date)) {
      exact = false;
      continue;
    }
    if (depositsFor.get(p.id) !== 1 || payoutsFor.get(d.id) !== 1) unambiguous = false;
  }
  checks.that("match-exact", `Every match is the same amount to the cent, within ${r.windowDays} day(s)`, exact);
  checks.that("match-unambiguous", "No match was made where more than one pairing was possible", unambiguous);
  const ambiguousP = r.ambiguous.flatMap((a) => a.payoutIds);
  const ambiguousD = r.ambiguous.flatMap((a) => a.depositIds);
  const ambiguousReal = r.ambiguous.every((a) => a.payoutIds.length + a.depositIds.length > 2 && a.payoutIds.length > 0 && a.depositIds.length > 0) && ambiguousP.every((id) => (depositsFor.get(id) ?? 0) > 0) && ambiguousD.every((id) => (payoutsFor.get(id) ?? 0) > 0);
  checks.that("ambiguous-real", "Everything reported as ambiguous has more than one possible pairing", ambiguousReal);
  const noneMissed = r.unmatchedPayoutIds.every((id) => depositsFor.get(id) === 0) && r.unmatchedDepositIds.every((id) => payoutsFor.get(id) === 0);
  checks.that("unmatched-have-none", "Nothing reported as unmatched has a same-amount partner inside the date window", noneMissed);
  const side = (name, label, all, byId, matched, amb, unmatched, reported) => {
    const placed = [...matched, ...amb, ...unmatched];
    const once = new Set(placed).size === placed.length && placed.every((id) => byId.has(id));
    checks.that(`${name}-once`, `Every ${label} is in exactly one of matched, ambiguous, or unmatched`, once && placed.length === all.length, `${all.length} ${label}(s), ${placed.length} placed`);
    checks.equal(`${name}-count`, `Matched + ambiguous + unmatched = all ${label}s (count)`, all.length, matched.length + amb.length + unmatched.length);
    const add = (ids) => ids.reduce((a, id) => a + B(byId.get(id)?.amount ?? 0), 0n);
    const total = all.reduce((a, x) => a + B(x.amount), 0n);
    const parts = { matched: add(matched), ambiguous: add(amb), unmatched: add(unmatched) };
    checks.cents(`${name}-sum`, `Matched + ambiguous + unmatched = all ${label}s (amount, added a second way)`, Number(total), Number(parts.matched + parts.ambiguous + parts.unmatched));
    const same = reported.all.count === all.length && B(reported.all.sum) === total && reported.matched.count === matched.length && B(reported.matched.sum) === parts.matched && reported.ambiguous.count === amb.length && B(reported.ambiguous.sum) === parts.ambiguous && reported.unmatched.count === unmatched.length && B(reported.unmatched.sum) === parts.unmatched;
    checks.that(`${name}-totals`, `The ${label} totals shown match the second pass`, same);
    return parts;
  };
  const pParts = side("payouts", "payout", r.payouts, payoutById, matchedP, ambiguousP, r.unmatchedPayoutIds, r.totals.payouts);
  const dParts = side("deposits", "bank deposit", r.deposits, depositById, matchedD, ambiguousD, r.unmatchedDepositIds, r.totals.deposits);
  checks.cents("matched-equal", "Matched payouts = matched bank deposits", Number(pParts.matched), Number(dParts.matched));
  const open = r.unmatchedPayoutIds.length + ambiguousP.length;
  checks.that("all-payouts-matched", "Every payout was matched to one bank deposit", open === 0, `${r.unmatchedPayoutIds.length} unmatched, ${ambiguousP.length} ambiguous`, "warning");
  const mixedDates = r.payouts.filter((p) => new Set(p.lineRows.map((row) => lineByRow.get(row)?.payoutDate)).size > 1).length;
  checks.that("payout-dates", "Rows grouped into one payout share one payout date", mixedDates === 0, `${mixedDates} payout(s) have rows with different dates; the latest date was used`, "warning");
  const notPositive = r.payouts.filter((p) => p.amount <= 0).length;
  checks.that("payouts-positive", "Every payout is a positive amount", notPositive === 0, `${notPositive} payout(s) are zero or negative and cannot match a deposit`, "warning");
  return checks.all;
}
function strReconcileTables(r) {
  const d = toDecimal;
  const payoutById = new Map(r.payouts.map((p) => [p.id, p]));
  const depositById = new Map(r.deposits.map((x) => [x.id, x]));
  const t = r.totals;
  const summary = [
    ["Reconciliation", "Count", "Amount"],
    ["Payouts in the report", t.payouts.all.count, d(t.payouts.all.sum)],
    ["Payouts matched to one deposit", t.payouts.matched.count, d(t.payouts.matched.sum)],
    ["Payouts with more than one possible deposit (ambiguous)", t.payouts.ambiguous.count, d(t.payouts.ambiguous.sum)],
    ["Payouts with no deposit found", t.payouts.unmatched.count, d(t.payouts.unmatched.sum)],
    ["Bank deposits considered", t.deposits.all.count, d(t.deposits.all.sum)],
    ["Deposits matched to one payout", t.deposits.matched.count, d(t.deposits.matched.sum)],
    ["Deposits with more than one possible payout (ambiguous)", t.deposits.ambiguous.count, d(t.deposits.ambiguous.sum)],
    ["Deposits with no payout found", t.deposits.unmatched.count, d(t.deposits.unmatched.sum)]
  ];
  const matched = [
    ["Payout", "Payout date", "Reservation codes", "Amount", "Deposit date", "Bank description", "Days apart"],
    ...r.matches.map((m) => {
      const p = payoutById.get(m.payoutId);
      const x = depositById.get(m.depositId);
      return [p.key, p.date, p.codes.join(" "), d(p.amount), x.date, x.description, m.daysApart];
    })
  ];
  const ambiguous = [["Group", "Kind", "Date", "Reference", "Amount"]];
  r.ambiguous.forEach((a, i) => {
    for (const id of a.payoutIds) {
      const p = payoutById.get(id);
      ambiguous.push([i + 1, "Payout", p.date, [p.key, ...p.codes].join(" "), d(p.amount)]);
    }
    for (const id of a.depositIds) {
      const x = depositById.get(id);
      ambiguous.push([i + 1, "Bank deposit", x.date, x.description, d(x.amount)]);
    }
  });
  const unmatchedPayouts = [
    ["Payout", "Payout date", "Reservation codes", "Amount"],
    ...r.unmatchedPayoutIds.map((id) => {
      const p = payoutById.get(id);
      return [p.key, p.date, p.codes.join(" "), d(p.amount)];
    })
  ];
  const unmatchedDeposits = [
    ["Bank row", "Date", "Description", "Amount"],
    ...r.unmatchedDepositIds.map((id) => {
      const x = depositById.get(id);
      return [x.rowNumber, x.date, x.description, d(x.amount)];
    })
  ];
  const part = (l, role) => l.components[role] === void 0 ? "" : d(l.components[role]);
  const rows = [
    ["Row", "Reservation code", "Payout date", "Gross earnings", "Host or service fees", "Cleaning fees", "Taxes", "Adjustments", "Computed payout", "Reported payout", "Difference", "Ties"],
    ...r.lines.map((l) => [l.rowNumber, l.code, l.payoutDate, part(l, "gross"), part(l, "hostFee"), part(l, "cleaningFee"), part(l, "taxes"), part(l, "adjustments"), d(l.computedPayout), d(l.payoutAmount), d(l.difference), r.componentsMapped ? l.ties ? "Yes" : "No" : "Not checked"])
  ];
  return { summary, matched, ambiguous, unmatchedPayouts, unmatchedDeposits, rows };
}

export {
  STR_COMPONENT_ROLES,
  STR_PAYOUT_ROLES,
  STR_BANK_ROLES,
  STR_ROLE_LABELS,
  STR_BANK_LABELS,
  STR_DEFAULT_EFFECTS,
  STR_DEFAULT_WINDOW_DAYS,
  strGuessPayoutColumns,
  strGuessBankColumns,
  strExtractPayoutLines,
  strExtractBankDeposits,
  reconcileStrPayouts,
  verifyStrReconciliation,
  strReconcileTables
};
