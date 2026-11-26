// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  verifyTemplateWorkbook
} from "./templates.mjs";
import {
  SITE_URL
} from "./present.mjs";
import {
  readXlsx,
  writeXlsx
} from "./fflate.mjs";
import {
  AgentInputError,
  columnsInput,
  mapColumns,
  oneFile,
  preferSheet
} from "./sheets.mjs";
import {
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  pmCellToCents,
  pmCellToIsoDate
} from "./reconcile.mjs";
import {
  CheckList,
  assertCents,
  failures,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/nonprofit/gifts.ts
var NP_GIFT_ROLES = ["donorId", "donorName", "email", "address", "date", "amount", "fund", "receivedDescription", "receivedValue"];
var NP_GIFT_ROLE_LABELS = {
  donorId: "Donor id or number",
  donorName: "Donor name",
  email: "Email",
  address: "Mailing address",
  date: "Gift date",
  amount: "Gift amount",
  fund: "Fund",
  receivedDescription: "Description of anything received in return",
  receivedValue: "Value of anything received in return"
};
var NP_GIFT_REQUIRED = ["donorName", "date", "amount"];
var SYNONYMS = {
  donorId: ["donor id", "donor number", "donor no", "constituent id", "member id", "envelope number", "envelope", "giver id", "id"],
  donorName: ["donor name", "donor", "name", "full name", "giver", "constituent", "member", "contributor"],
  email: ["email", "email address", "e mail"],
  address: ["mailing address", "address", "street address", "street"],
  date: ["gift date", "date received", "received date", "date", "received", "contribution date", "deposit date"],
  amount: ["gift amount", "amount", "contribution", "contribution amount", "gift", "total"],
  fund: ["fund", "fund name", "designation", "category", "account", "purpose"],
  receivedDescription: ["received in return", "goods or services", "benefit description", "benefit", "description of benefit", "premium"],
  receivedValue: ["value received", "value of benefit", "benefit value", "goods or services value", "fair market value", "fmv", "value"]
};
var NP_NO_FUND = "(no fund)";
var NO_ID = /^(n\/a|na|none|unknown|0|[-–—]+)$/i;
function npNormalizeText(text) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}
function npNormalizeEmail(text) {
  return text.toLowerCase().replace(/\s+/g, "");
}
function npGuessGiftColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, NP_GIFT_ROLES, SYNONYMS, atHeaderRow);
}
function npExtractGifts(rows, mapping) {
  const c = mapping.columns;
  for (const role of NP_GIFT_REQUIRED) {
    if (c[role] < 0) throw new Error(`Choose the column that holds: ${NP_GIFT_ROLE_LABELS[role]}.`);
  }
  const headers = (rows[mapping.headerRow] ?? []).map((t, i) => t.trim() || `Column ${i + 1}`);
  const out = { gifts: [], problems: [], skipped: [], ignoredRows: 0, headers };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const donorName = sheetCell(cells, c.donorName);
    const idText = sheetCell(cells, c.donorId);
    const donorId = NO_ID.test(idText) ? "" : idText;
    const dateText = sheetCell(cells, c.date);
    const amountText = sheetCell(cells, c.amount);
    let dated = false;
    try {
      dated = dateText !== "" && pmCellToIsoDate(dateText) !== "";
    } catch {
      dated = false;
    }
    if (!dated && (!donorName && !donorId || !amountText)) {
      out.skipped.push({ rowNumber, reason: cells.some(sheetIsTotalWord) ? "total line" : "no gift date and no donor or amount" });
      out.ignoredRows++;
      continue;
    }
    try {
      if (!donorName && !donorId) throw new Error("no donor name or id");
      if (!dateText) throw new Error("no gift date");
      if (!amountText) throw new Error("no gift amount");
      const keyText = npNormalizeText(donorId || donorName);
      if (!keyText) throw new Error(donorId ? "donor id has no letters or digits" : "donor name has no letters or digits");
      const valueText = sheetCell(cells, c.receivedValue);
      const record = {};
      headers.forEach((name, i) => {
        if (!(name in record)) record[name] = (cells[i] ?? "").trim();
      });
      out.gifts.push({
        rowNumber,
        donorKey: donorId ? `id:${keyText}` : `name:${keyText}`,
        donorId,
        donorName: donorName || donorId,
        email: sheetCell(cells, c.email),
        address: sheetCell(cells, c.address),
        date: pmCellToIsoDate(dateText),
        amount: pmCellToCents(amountText),
        fund: sheetCell(cells, c.fund) || NP_NO_FUND,
        receivedDescription: sheetCell(cells, c.receivedDescription),
        receivedValue: valueText ? pmCellToCents(valueText) : null,
        cells: record
      });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}
function npBigTotal(amounts) {
  let total = 0n;
  for (const a of amounts) total += BigInt(a);
  return total;
}

// packages/core/src/nonprofit/acknowledgments.ts
function npCheckAcknowledgments(input) {
  const { gifts, thresholdCents } = input;
  const required = [...input.required];
  if (!Number.isSafeInteger(thresholdCents) || thresholdCents < 0) {
    throw new Error("The gift amount to check from must be a whole number of cents, zero or more.");
  }
  if (required.length === 0) throw new Error("Choose at least one element for the checklist.");
  if (required.some((name) => name.trim() === "") || new Set(required).size !== required.length) {
    throw new Error("The checklist has a blank or repeated element.");
  }
  const isBlank = (gift, name) => (gift.elements[name] ?? "").trim() === "";
  const checked = gifts.filter((g) => g.amount >= thresholdCents);
  const under = gifts.filter((g) => !(g.amount >= thresholdCents));
  const atOrAboveTotal = sum(checked.map((g) => g.amount));
  const belowTotal = sum(under.map((g) => g.amount));
  let complete = 0;
  const incomplete = [];
  for (const g of checked) {
    const missing = required.filter((name) => isBlank(g, name));
    if (missing.length === 0) complete += 1;
    else incomplete.push({ rowNumber: g.rowNumber, donorName: g.donorName, date: g.date, amount: g.amount, missing });
  }
  incomplete.sort((a, b) => a.rowNumber - b.rowNumber);
  const byElement = required.map((element) => ({ element, missing: checked.filter((g) => isBlank(g, element)).length }));
  const checks = new CheckList();
  checks.equal("np-ack-count", "Gifts at or above the amount plus gifts below it equal all gifts", gifts.length, checked.length + under.length);
  checks.cents("np-ack-amount", "Amounts at or above plus below equal the gift list total", Number(npBigTotal(gifts.map((g) => g.amount))), atOrAboveTotal + belowTotal);
  checks.equal("np-ack-complete", "Complete plus incomplete equal the gifts at or above the amount", checked.length, complete + incomplete.length);
  checks.equal(
    "np-ack-elements",
    "Missing elements counted by gift and by element agree",
    incomplete.reduce((n, row) => n + row.missing.length, 0),
    byElement.reduce((n, e) => n + e.missing, 0)
  );
  const seen = /* @__PURE__ */ new Set();
  const repeated = /* @__PURE__ */ new Set();
  for (const g of gifts) {
    if (seen.has(g.rowNumber)) repeated.add(g.rowNumber);
    seen.add(g.rowNumber);
  }
  checks.that("np-ack-rows-once", "Every gift was looked at once", repeated.size === 0, `row(s) ${[...repeated].sort((a, b) => a - b).join(", ")}`);
  checks.that("np-ack-nothing-missing", "No gift at or above the amount has a blank checklist element", incomplete.length === 0, `${incomplete.length} gift(s) with a blank element`, "warning");
  return {
    thresholdCents,
    required,
    atOrAbove: checked.length,
    atOrAboveTotal,
    below: under.length,
    belowTotal,
    complete,
    incomplete,
    byElement,
    checks: checks.all
  };
}
function npAckGiftsFrom(gifts) {
  return gifts.map((g) => ({ rowNumber: g.rowNumber, donorName: g.donorName, date: g.date, amount: g.amount, elements: g.cells }));
}
function npAckTables(r) {
  return {
    summary: [
      ["", "Gifts", "Amount"],
      ["At or above the amount you set", r.atOrAbove, toDecimal(r.atOrAboveTotal)],
      ["Below the amount you set", r.below, toDecimal(r.belowTotal)],
      ["All gifts", r.atOrAbove + r.below, toDecimal(r.atOrAboveTotal + r.belowTotal)],
      ["At or above, every checklist element filled", r.complete, ""],
      ["At or above, a checklist element blank", r.incomplete.length, toDecimal(sum(r.incomplete.map((g) => g.amount)))]
    ],
    incomplete: [["File row", "Donor", "Gift date", "Amount", "Blank elements"], ...r.incomplete.map((g) => [g.rowNumber, g.donorName, g.date, toDecimal(g.amount), g.missing.join("; ")])],
    elements: [["Checklist element", "Gifts where it is blank"], ...r.byElement.map((e) => [e.element, e.missing])]
  };
}

// packages/core/src/nonprofit/dedupCheck.ts
var rowList = (rows) => `row(s) ${[...new Set(rows)].sort((a, b) => a - b).join(", ")}`;
function npVerifyMerges(before, after) {
  const checks = new CheckList();
  const B = (n) => Number.isSafeInteger(n) ? BigInt(n) : 0n;
  const cents = (n) => Number(n);
  const keeperOf = /* @__PURE__ */ new Map();
  const mergedInto = /* @__PURE__ */ new Map();
  for (const m of before.confirmed) {
    mergedInto.set(m.keepId, [...mergedInto.get(m.keepId) ?? [], ...m.mergeIds]);
    for (const id of m.mergeIds) keeperOf.set(id, m.keepId);
  }
  const endsUpWith = (donorId) => keeperOf.get(donorId) ?? donorId;
  const due = /* @__PURE__ */ new Map();
  let totalBefore = 0n;
  for (const g of before.gifts) {
    const key = endsUpWith(g.donorId);
    const d = due.get(key) ?? { count: 0, total: 0n };
    due.set(key, { count: d.count + 1, total: d.total + B(g.amount) });
    totalBefore += B(g.amount);
  }
  const wholeCents = [...before.gifts, ...after.gifts, ...after.donors.map((d) => ({ amount: d.total }))].every((x) => Number.isSafeInteger(x.amount));
  const totalAfter = after.donors.reduce((n, d) => n + B(d.total), 0n);
  if (wholeCents) checks.cents("np-merge-total", "Gift total is the same before and after merging", cents(totalBefore), cents(totalAfter));
  else checks.that("np-merge-total", "Gift total is the same before and after merging", false, "an amount is not a whole number of cents");
  checks.equal("np-merge-count", "Gift count is the same before and after merging", before.gifts.length, after.donors.reduce((n, d) => n + d.count, 0));
  const changed = [];
  const longest = Math.max(before.gifts.length, after.gifts.length);
  for (let i = 0; i < longest; i++) {
    const was = before.gifts[i];
    const is = after.gifts[i];
    if (!was || !is || was.rowNumber !== is.rowNumber || was.amount !== is.amount || was.donorId !== is.fromDonorId) changed.push((was ?? is).rowNumber);
  }
  checks.that("np-merge-gifts-kept", "Every gift is listed after merging with its own row number, amount, and the donor record it had before", changed.length === 0, rowList(changed));
  const left = /* @__PURE__ */ new Map();
  for (const d of after.donors) left.set(d.id, (left.get(d.id) ?? 0) + 1);
  const rowCount = /* @__PURE__ */ new Map();
  for (const g of after.gifts) rowCount.set(g.rowNumber, (rowCount.get(g.rowNumber) ?? 0) + 1);
  const homeless = after.gifts.filter((g) => rowCount.get(g.rowNumber) !== 1 || left.get(g.donorId) !== 1).map((g) => g.rowNumber);
  checks.that("np-merge-one-donor", "Every gift belongs to exactly one donor after merging", homeless.length === 0, rowList(homeless));
  const misplaced = after.gifts.filter((g) => g.donorId !== endsUpWith(g.fromDonorId)).map((g) => g.rowNumber);
  checks.that("np-merge-moved", "A gift changed donor record only when its record was merged away, and then to the record that was kept", misplaced.length === 0, rowList(misplaced));
  checks.equal("np-merge-donors", "Donors before minus donors merged away equal donors after", before.donors.length - keeperOf.size, after.donors.length);
  const expected = before.donors.filter((d) => !keeperOf.has(d.id));
  const wrongDonors = [];
  for (let i = 0; i < Math.max(expected.length, after.donors.length); i++) {
    const want = expected[i];
    const got = after.donors[i];
    const folded = want ? mergedInto.get(want.id) ?? [] : [];
    const same = want !== void 0 && got !== void 0 && want.id === got.id && want.name === got.name && want.email === got.email && want.address === got.address && got.mergedFrom.length === folded.length && got.mergedFrom.every((id, k) => id === folded[k]);
    if (!same) wrongDonors.push((want ?? got).id);
  }
  checks.that("np-merge-donors-kept", "Every donor record that was not merged away is still listed, unchanged, with the records merged into it", wrongDonors.length === 0, [...new Set(wrongDonors)].join(", "));
  const wrongHoldings = after.donors.filter((d) => {
    const owed = due.get(d.id) ?? { count: 0, total: 0n };
    return !Number.isSafeInteger(d.total) || d.count !== owed.count || BigInt(d.total) !== owed.total;
  }).map((d) => d.id);
  checks.that("np-merge-groups", "Each donor after merging holds exactly the gifts of its own record and of the records merged into it", wrongHoldings.length === 0, wrongHoldings.join(", "));
  return checks.all;
}

// packages/core/src/nonprofit/dedup.ts
var NP_MATCH_LABELS = {
  exact: "Same name, email, and address once case, punctuation, and spacing are ignored",
  email: "Same email, different name or address",
  address: "Same address, different name or email",
  name: "Same name, different email or address"
};
function npProposeMergeGroups(donors) {
  const ids = /* @__PURE__ */ new Set();
  for (const d of donors) {
    if (ids.has(d.id)) throw new Error(`Donor id ${d.id} appears twice.`);
    ids.add(d.id);
  }
  const normal = donors.map((d) => ({ name: npNormalizeText(d.name), email: npNormalizeEmail(d.email), address: npNormalizeText(d.address) }));
  const pairs = [];
  for (let i = 0; i < normal.length; i++) {
    for (let j = i + 1; j < normal.length; j++) {
      const a = normal[i];
      const b = normal[j];
      let kind = null;
      if (a.name === b.name && a.email === b.email && a.address === b.address && a.name !== "") kind = "exact";
      else if (a.email !== "" && a.email === b.email) kind = "email";
      else if (a.address !== "" && a.address === b.address) kind = "address";
      else if (a.name !== "" && a.name === b.name) kind = "name";
      if (kind !== null) pairs.push({ i, j, kind });
    }
  }
  const root = normal.map((_, i) => i);
  const find = (i) => {
    let at = i;
    while (root[at] !== at) at = root[at];
    return at;
  };
  for (const p of pairs) {
    const a = find(p.i);
    const b = find(p.j);
    if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
  }
  const groups = [];
  for (let first = 0; first < normal.length; first++) {
    if (find(first) !== first) continue;
    const members = normal.map((_, i) => i).filter((i) => find(i) === first);
    if (members.length < 2) continue;
    const links = pairs.filter((p) => find(p.i) === first).map((p) => ({ a: donors[p.i].id, b: donors[p.j].id, kind: p.kind }));
    groups.push({ ids: members.map((i) => donors[i].id), links, kind: links.every((l) => l.kind === "exact") ? "exact" : "near" });
  }
  return groups;
}
function npApplyMerges(input) {
  const known = /* @__PURE__ */ new Set();
  for (const d of input.donors) {
    if (known.has(d.id)) throw new Error(`Donor id ${d.id} appears twice.`);
    known.add(d.id);
  }
  const inAMerge = /* @__PURE__ */ new Set();
  const keptFor = /* @__PURE__ */ new Map();
  const foldedInto = /* @__PURE__ */ new Map();
  for (const merge of input.confirmed) {
    if (merge.mergeIds.length === 0) throw new Error("A confirmed merge needs at least one record to merge.");
    for (const id of [merge.keepId, ...merge.mergeIds]) {
      if (!known.has(id)) throw new Error(`Merge refers to donor ${id}, which is not in the list.`);
      if (inAMerge.has(id)) throw new Error(`Donor ${id} is in more than one merge.`);
      inAMerge.add(id);
    }
    foldedInto.set(merge.keepId, [...merge.mergeIds]);
    for (const id of merge.mergeIds) keptFor.set(id, merge.keepId);
  }
  const gifts = input.gifts.map((g) => {
    const kept = keptFor.get(g.donorId);
    return { rowNumber: g.rowNumber, fromDonorId: g.donorId, donorId: kept === void 0 ? g.donorId : kept, amount: g.amount };
  });
  const donors = input.donors.filter((d) => !keptFor.has(d.id)).map((d) => {
    const mine = gifts.filter((g) => g.donorId === d.id);
    const folded = foldedInto.get(d.id);
    return { id: d.id, name: d.name, email: d.email, address: d.address, mergedFrom: folded === void 0 ? [] : [...folded], count: mine.length, total: sum(mine.map((g) => g.amount)) };
  });
  return { donors, gifts };
}
function npMergeDonors(input) {
  const set = npApplyMerges(input);
  return { ...set, checks: npVerifyMerges(input, set) };
}
function npDonorRecordsFrom(gifts) {
  const byText = /* @__PURE__ */ new Map();
  const out = { donors: [], gifts: [] };
  for (const g of gifts) {
    const key = JSON.stringify([g.donorId, g.donorName, g.email, g.address]);
    let record = byText.get(key);
    if (!record) {
      record = { id: `D${out.donors.length + 1}`, name: g.donorName, email: g.email, address: g.address };
      byText.set(key, record);
      out.donors.push(record);
    }
    out.gifts.push({ rowNumber: g.rowNumber, donorId: record.id, amount: g.amount });
  }
  return out;
}
function npMergeTables(r) {
  return {
    donors: [
      ["Donor record", "Name", "Email", "Address", "Merged from", "Gifts", "Total given"],
      ...r.donors.map((d) => [d.id, d.name, d.email, d.address, d.mergedFrom.join(", "), d.count, toDecimal(d.total)]),
      ["Total", "", "", "", "", r.gifts.length, toDecimal(sum(r.donors.map((d) => d.total)))]
    ],
    gifts: [["File row", "Donor record before", "Donor record after", "Amount"], ...r.gifts.map((g) => [g.rowNumber, g.fromDonorId, g.donorId, toDecimal(g.amount)])]
  };
}

// packages/core/src/nonprofit/fundMonths.ts
var NP_FUND_MONTHS_MAX = 120;
var compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function monthOf(g) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(g.date)) throw new Error(`Gift on row ${g.rowNumber} has no usable date.`);
  return g.date.slice(0, 7);
}
function nextMonth(month) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
}
function npBuildFundMonths(gifts) {
  if (gifts.length === 0) throw new Error("There are no gifts in the list.");
  const keyed = gifts.map((g) => ({ g, month: monthOf(g) }));
  const first = keyed.reduce((a, b) => compareText(b.month, a) < 0 ? b.month : a, keyed[0].month);
  const last = keyed.reduce((a, b) => compareText(b.month, a) > 0 ? b.month : a, keyed[0].month);
  const months = [];
  for (let m = first; ; m = nextMonth(m)) {
    months.push(m);
    if (m === last) break;
    if (months.length >= NP_FUND_MONTHS_MAX) {
      throw new Error(`The gift dates run from ${first} to ${last}, more than ${NP_FUND_MONTHS_MAX} months. Check that the gift date column is the right one.`);
    }
  }
  const column = new Map(months.map((m, i) => [m, i]));
  const funds = [...new Set(gifts.map((g) => g.fund))].sort(compareText);
  const rows = funds.map((fund) => {
    const mine = keyed.filter((k) => k.g.fund === fund);
    const cells = months.map(() => []);
    for (const k of mine) cells[column.get(k.month)].push(k.g.amount);
    return { fund, byMonth: cells.map(sum), count: mine.length, total: sum(mine.map((k) => k.g.amount)) };
  });
  return {
    months,
    rows,
    monthTotals: months.map((m) => sum(keyed.filter((k) => k.month === m).map((k) => k.g.amount))),
    monthCounts: months.map((m) => keyed.filter((k) => k.month === m).length),
    giftCount: gifts.length,
    grandTotal: sum(gifts.map((g) => g.amount))
  };
}
function npVerifyFundMonths(gifts, set) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const usd = (n) => formatUSD(Number(n));
  const cellKey = (fund, month) => `${month}\0${fund}`;
  const listCells = /* @__PURE__ */ new Map();
  const listFunds = /* @__PURE__ */ new Map();
  const listMonths = /* @__PURE__ */ new Map();
  const bump = (map, key, amount) => {
    const at = map.get(key) ?? { count: 0, total: 0n };
    at.count++;
    at.total += amount;
    map.set(key, at);
  };
  let listTotal = 0n;
  let earliest = "";
  let latest = "";
  const nonPositive = [];
  for (const g of gifts) {
    const amount = B(g.amount);
    const month = g.date.slice(0, 7);
    bump(listCells, cellKey(g.fund, month), amount);
    bump(listFunds, g.fund, amount);
    bump(listMonths, month, amount);
    listTotal += amount;
    if (earliest === "" || month < earliest) earliest = month;
    if (latest === "" || month > latest) latest = month;
    if (g.amount <= 0) nonPositive.push(g.rowNumber);
  }
  for (const r of set.rows) {
    B(r.total);
    for (const c of r.byMonth) B(c);
  }
  for (const t of set.monthTotals) B(t);
  B(set.grandTotal);
  const wholeProblems = notWhole;
  checks.that("np-fm-whole-cents", "Every amount is a whole number of cents", wholeProblems === 0, `${wholeProblems} amount(s) are not whole cents`);
  const N = (n) => typeof n === "number" && Number.isSafeInteger(n) ? BigInt(n) : 0n;
  const expectedMonths = [];
  if (earliest !== "") {
    let y = Number(earliest.slice(0, 4));
    let m = Number(earliest.slice(5, 7));
    const endY = Number(latest.slice(0, 4));
    const endM = Number(latest.slice(5, 7));
    while ((y < endY || y === endY && m <= endM) && expectedMonths.length <= NP_FUND_MONTHS_MAX) {
      expectedMonths.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
      m++;
      if (m === 13) {
        m = 1;
        y++;
      }
    }
  }
  checks.equal("np-fm-months", "The month columns run from the earliest gift to the latest, one per calendar month", expectedMonths.join(" "), set.months.join(" "));
  const expectedFunds = [...listFunds.keys()].sort(compareText);
  const shownFunds = set.rows.map((r) => r.fund);
  checks.equal("np-fm-funds", "There is one row for every fund in the gift list and no other row", expectedFunds.join(" | "), [...shownFunds].sort(compareText).join(" | "));
  const rowSet = new Set(shownFunds);
  const colSet = new Set(set.months);
  let placed = 0;
  for (const [key, at] of listCells) {
    const [month, fund] = key.split("\0");
    if (rowSet.has(fund) && colSet.has(month)) placed += at.count;
  }
  const rowCounts = set.rows.reduce((n, r) => n + r.count, 0);
  const monthCounts = set.monthCounts.reduce((n, c) => n + c, 0);
  const countsOk = placed === gifts.length && rowCounts === gifts.length && monthCounts === gifts.length && set.giftCount === gifts.length;
  checks.that(
    "np-fm-every-gift",
    "Every gift in the list falls in exactly one cell of the table",
    countsOk && rowSet.size === shownFunds.length && colSet.size === set.months.length,
    `the list has ${gifts.length} gift(s); ${placed} have a cell, the rows count ${rowCounts}, the months count ${monthCounts}, and the table says ${set.giftCount}`
  );
  const cellProblems = [];
  const rowProblems = [];
  for (const r of set.rows) {
    let across = 0n;
    set.months.forEach((month, i) => {
      const shown = N(r.byMonth[i]);
      across += shown;
      const want2 = listCells.get(cellKey(r.fund, month))?.total ?? 0n;
      if (shown !== want2 || r.byMonth.length !== set.months.length) cellProblems.push(`${r.fund}, ${month}: the table shows ${usd(shown)}, the list adds up to ${usd(want2)}`);
    });
    const want = listFunds.get(r.fund);
    if (across !== N(r.total) || N(r.total) !== (want?.total ?? 0n) || r.count !== (want?.count ?? 0)) {
      rowProblems.push(`${r.fund}: the row shows ${usd(N(r.total))} in ${r.count} gift(s), its cells add up to ${usd(across)}, the list has ${usd(want?.total ?? 0n)} in ${want?.count ?? 0}`);
    }
  }
  checks.that("np-fm-cells", "Every cell equals the gifts with that fund and that month, added up again from the list", cellProblems.length === 0, cellProblems.slice(0, 6).join("; "));
  checks.that("np-fm-rows", "Every fund total equals its months added across and that fund in the gift list", rowProblems.length === 0, rowProblems.slice(0, 6).join("; "));
  const columnProblems = [];
  set.months.forEach((month, i) => {
    let down = 0n;
    for (const r of set.rows) down += N(r.byMonth[i]);
    const want = listMonths.get(month);
    const shown = N(set.monthTotals[i]);
    if (down !== shown || shown !== (want?.total ?? 0n) || set.monthCounts[i] !== (want?.count ?? 0)) {
      columnProblems.push(`${month}: the table shows ${usd(shown)} in ${set.monthCounts[i] ?? 0} gift(s), its cells add up to ${usd(down)}, the list has ${usd(want?.total ?? 0n)} in ${want?.count ?? 0}`);
    }
  });
  if (set.monthTotals.length !== set.months.length || set.monthCounts.length !== set.months.length) columnProblems.push("the table does not have one total per month");
  checks.that("np-fm-columns", "Every month total equals its funds added down and that month in the gift list", columnProblems.length === 0, columnProblems.slice(0, 6).join("; "));
  let rowsTotal = 0n;
  for (const r of set.rows) rowsTotal += N(r.total);
  let monthsTotal = 0n;
  for (const t of set.monthTotals) monthsTotal += N(t);
  const grand = N(set.grandTotal);
  const grandOk = rowsTotal === listTotal && monthsTotal === listTotal && grand === listTotal;
  checks.add({
    id: "np-fm-grand-total",
    label: "The gift list, the fund totals, and the month totals all add up to the same grand total",
    passed: grandOk,
    severity: "error",
    expected: usd(listTotal),
    actual: usd(grand),
    ...grandOk ? {} : { detail: `the list adds up to ${usd(listTotal)}, the fund totals to ${usd(rowsTotal)}, the month totals to ${usd(monthsTotal)}, and the table shows ${usd(grand)}` }
  });
  checks.that(
    "np-fm-nonpositive",
    "No gift is zero or negative",
    nonPositive.length === 0,
    `${nonPositive.length} gift(s) are zero or negative (a refund or a correction) and are added in as written: row(s) ${nonPositive.slice(0, 20).join(", ")}`,
    "warning"
  );
  return checks.all;
}
function npGivingByFund(gifts) {
  const set = npBuildFundMonths(gifts);
  return { ...set, checks: npVerifyFundMonths(gifts, set) };
}
function npFundMonthTables(set, gifts) {
  const ordered = [...gifts].sort((a, b) => compareText(a.fund, b.fund) || compareText(a.date, b.date) || a.rowNumber - b.rowNumber);
  return {
    table: [
      ["Fund", ...set.months, "Total", "Gifts"],
      ...set.rows.map((r) => [r.fund, ...r.byMonth.map(toDecimal), toDecimal(r.total), r.count]),
      ["Total", ...set.monthTotals.map(toDecimal), toDecimal(set.grandTotal), set.giftCount]
    ],
    gifts: [["Fund", "Month", "Gift date", "Donor", "Amount", "File row"], ...ordered.map((g) => [g.fund, g.date.slice(0, 7), g.date, g.donorName, toDecimal(g.amount), g.rowNumber])]
  };
}

// packages/core/src/nonprofit/giftLogTemplate.ts
var NP_TEMPLATE_MAX_FUNDS = 50;
var NP_TEMPLATE_SHEETS = ["Gifts", "Funds", "Log", "Instructions"];
var NP_TEMPLATE_GIFT_HEADERS = ["Donor ID", "Donor name", "Email", "Mailing address", "Gift date", "Gift amount", "Fund", "Received in return", "Value received", "Notes"];
var NP_TEMPLATE_FUND_HEADERS = ["Line", "Fund", "Notes"];
function cleanOrganization(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The organization name is longer than 120 characters.");
  return s;
}
function cleanYear(value) {
  const s = value.trim();
  if (s !== "" && !/^20\d{2}$/.test(s)) throw new Error("The year must be four digits, from 2000 to 2099.");
  return s;
}
function cleanCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > NP_TEMPLATE_MAX_FUNDS) throw new Error(`The number of funds must be a whole number from 1 to ${NP_TEMPLATE_MAX_FUNDS}.`);
  return value;
}
function npGiftLogTemplateSheets(o) {
  const organization = cleanOrganization(o.organization);
  const year = cleanYear(o.year);
  const funds = cleanCount(o.fundCount);
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/nonprofits/${slug}/${site ? "?src=template" : ""}`;
  return [
    {
      name: NP_TEMPLATE_SHEETS[0],
      rows: [[...NP_TEMPLATE_GIFT_HEADERS]],
      money: ["Gift amount", "Value received"],
      widths: [12, 28, 28, 36, 14, 14, 18, 30, 16, 40]
    },
    {
      name: NP_TEMPLATE_SHEETS[1],
      rows: [[...NP_TEMPLATE_FUND_HEADERS], ...Array.from({ length: funds }, (_, i) => [i + 1, "", ""])],
      money: [],
      widths: [8, 34, 40]
    },
    {
      name: NP_TEMPLATE_SHEETS[2],
      rows: [
        ["Item", "Value"],
        ["Kept for", organization],
        ["Year", year],
        ["Date last updated", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: NP_TEMPLATE_SHEETS[3],
      rows: [
        ["Where", "What goes there"],
        ["About this workbook", "A layout to fill in with gifts as they come in. It holds values only, with no formulas, so nothing in it adds up."],
        ["Gifts", "One row per gift, under the header row. Do not leave a row blank between two gifts and do not add a total row."],
        ["Donor ID", "The number or code your records use for the donor, such as an envelope number. It can be left blank; gifts are then grouped by the donor name."],
        ["Donor name", "The name as it is to be printed. Write it the same way on every gift from the same donor."],
        ["Email", "The email address of the donor. It can be left blank."],
        ["Mailing address", "The address on one line. It can be left blank."],
        ["Gift date", "The date the gift was received, written like 2026-03-15."],
        ["Gift amount", "The amount of the gift in dollars."],
        ["Fund", "The fund the gift went to, as named on the Funds sheet. Blank means no fund."],
        ["Received in return", "A description of anything the donor was given in return for the gift, in your own words. Blank when nothing was."],
        ["Value received", "The value in dollars of what is described in the column before it. Blank when nothing was."],
        ["Funds", `One row per fund; rows are numbered 1 to ${funds}. Rows can be added under the last one.`],
        ["Log", "The organization, the year, and the date the workbook was last updated."],
        ["Year-end giving statements", `${page("year-end-giving-statements")} opens this workbook, reads the Gifts sheet, and builds one statement per donor with totals by fund that add back up to the sheet.`],
        ["Acknowledgment checklist", `${page("acknowledgment-checklist")} opens this workbook and lists the gifts that have a blank in the columns picked there.`],
        ["Donor de-duplication", `${page("donor-duplicates")} opens this workbook and lists donor records that share a name, an email, or an address.`]
      ],
      money: [],
      widths: [28, 130]
    }
  ];
}
function npVerifyGiftLogTemplate(o, bytes) {
  const sheets = npGiftLogTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const log = rowsOf(NP_TEMPLATE_SHEETS[2]);
  const cell = (label) => log.find((r) => r[0] === label)?.[1] ?? "";
  checks.equal("organization", "The Log sheet carries the organization name as typed", cleanOrganization(o.organization), cell("Kept for"));
  checks.equal("year", "The Log sheet carries the year as typed", cleanYear(o.year), cell("Year"));
  const funds = rowsOf(NP_TEMPLATE_SHEETS[1]).slice(1);
  checks.that(
    "fund-rows",
    `The Funds sheet has ${o.fundCount} blank rows numbered 1 to ${o.fundCount}`,
    funds.length === o.fundCount && funds.every((r, i) => r[0] === String(i + 1) && r.slice(1).every((c) => c === ""))
  );
  const first = read.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  checks.equal("gifts-first", "The Gifts sheet is the first sheet in the file, the one the tools open", NP_TEMPLATE_SHEETS[0], first?.name ?? "");
  const gifts = rowsOf(NP_TEMPLATE_SHEETS[0]);
  const mapping = npGuessGiftColumns(gifts);
  const expected = NP_GIFT_ROLES.map((_, i) => i);
  const found = mapping.headerRow === 0 && NP_GIFT_ROLES.every((role, i) => mapping.columns[role] === expected[i]);
  checks.that("gifts-readable", "Every part the giving tools read is found in the Gifts header row, each in the column written for it", found);
  let empty2 = false;
  if (found) {
    const x = npExtractGifts(gifts, mapping);
    empty2 = x.gifts.length === 0 && x.problems.length === 0 && x.skipped.length === 0;
  }
  checks.that("gifts-empty", "The Gifts sheet reads as a gift list with nothing entered yet", empty2);
  return checks.all;
}

// packages/core/src/nonprofit/lybunt.ts
var NP_YEAR_GROUPS = ["lapsed", "earlier", "both", "returned", "new", "later"];
function npYearGroupLabel(group, year) {
  const last = year - 1;
  switch (group) {
    case "lapsed":
      return `Gave in ${last}, not in ${year}`;
    case "earlier":
      return `Gave before ${last}, not in ${last} or ${year}`;
    case "both":
      return `Gave in ${last} and in ${year}`;
    case "returned":
      return `Gave in ${year} and before ${last}, not in ${last}`;
    case "new":
      return `First gift in the list is in ${year}`;
    case "later":
      return `Gifts only after ${year}`;
  }
}
var compareText2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function cleanYear2(year) {
  if (!Number.isSafeInteger(year) || year < 1901 || year > 2100) throw new Error("Type the year the report is for, as four digits.");
  return year;
}
function groupOf(inYear, inLast, before) {
  if (inYear) return inLast ? "both" : before ? "returned" : "new";
  if (inLast) return "lapsed";
  return before ? "earlier" : "later";
}
function npBuildYearGroups(gifts, year) {
  const y = cleanYear2(year);
  if (gifts.length === 0) throw new Error("There are no gifts in the list.");
  const byDonor = /* @__PURE__ */ new Map();
  for (const g of gifts) {
    if (g.donorKey === "") throw new Error(`Gift on row ${g.rowNumber} has no donor.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) throw new Error(`Gift on row ${g.rowNumber} has no usable date.`);
    const list = byDonor.get(g.donorKey);
    if (list) list.push(g);
    else byDonor.set(g.donorKey, [g]);
  }
  const yearOf = (g) => Number(g.date.slice(0, 4));
  const donors = [...byDonor.entries()].map(([donorKey, mine]) => {
    const ordered = [...mine].sort((a, b) => compareText2(a.date, b.date) || a.rowNumber - b.rowNumber);
    const latest = ordered[ordered.length - 1];
    const amounts = (pick) => ordered.filter((g) => pick(yearOf(g))).map((g) => g.amount);
    const inYear = amounts((n) => n === y);
    const inLast = amounts((n) => n === y - 1);
    const before = amounts((n) => n < y - 1);
    let email = "";
    for (const g of ordered) if (g.email !== "") email = g.email;
    return {
      donorKey,
      donorName: latest.donorName,
      email,
      group: groupOf(inYear.length > 0, inLast.length > 0, before.length > 0),
      count: ordered.length,
      thisYear: sum(inYear),
      lastYear: sum(inLast),
      earlier: sum(before),
      later: sum(amounts((n) => n > y)),
      lastGiftDate: latest.date
    };
  });
  const rank = new Map(NP_YEAR_GROUPS.map((g, i) => [g, i]));
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || compareText2(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText2(a.donorKey, b.donorKey));
  const groups = NP_YEAR_GROUPS.map((group) => {
    const mine = donors.filter((d) => d.group === group);
    return { group, donors: mine.length, thisYear: sum(mine.map((d) => d.thisYear)), lastYear: sum(mine.map((d) => d.lastYear)), earlier: sum(mine.map((d) => d.earlier)), later: sum(mine.map((d) => d.later)) };
  });
  const total = (pick) => sum(gifts.filter((g) => pick(yearOf(g))).map((g) => g.amount));
  return {
    year: y,
    donors,
    groups,
    giftCount: gifts.length,
    thisYearTotal: total((n) => n === y),
    lastYearTotal: total((n) => n === y - 1),
    earlierTotal: total((n) => n < y - 1),
    laterTotal: total((n) => n > y),
    grandTotal: sum(gifts.map((g) => g.amount))
  };
}
function npVerifyYearGroups(gifts, set) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const usd = (n) => formatUSD(Number(n));
  const pad = (n) => String(n).padStart(4, "0");
  const year = set.year;
  const lastStart = `${pad(year - 1)}-01-01`;
  const yearStart = `${pad(year)}-01-01`;
  const yearEnd = `${pad(year)}-12-31`;
  const stretch = (date) => date > yearEnd ? 3 : date >= yearStart ? 0 : date >= lastStart ? 1 : 2;
  const list = /* @__PURE__ */ new Map();
  const listTotals = [0n, 0n, 0n, 0n];
  const listRows = [0, 0, 0, 0];
  const nonPositive = [];
  for (const g of gifts) {
    const amount = B(g.amount);
    const s = stretch(g.date);
    let facts = list.get(g.donorKey);
    if (!facts) {
      facts = { count: 0, totals: [0n, 0n, 0n, 0n], rows: [0, 0, 0, 0] };
      list.set(g.donorKey, facts);
    }
    facts.count++;
    facts.totals[s] += amount;
    facts.rows[s]++;
    listTotals[s] += amount;
    listRows[s]++;
    if (g.amount <= 0) nonPositive.push(g.rowNumber);
  }
  const shown = (d) => [B(d.thisYear), B(d.lastYear), B(d.earlier), B(d.later)];
  const donorAmounts = /* @__PURE__ */ new Map();
  for (const d of set.donors) donorAmounts.set(d, shown(d));
  const lineAmounts = set.groups.map((l) => [B(l.thisYear), B(l.lastYear), B(l.earlier), B(l.later)]);
  const setTotals = [B(set.thisYearTotal), B(set.lastYearTotal), B(set.earlierTotal), B(set.laterTotal)];
  const grand = B(set.grandTotal);
  checks.that("np-yr-whole-cents", "Every amount is a whole number of cents", notWhole === 0, `${notWhole} amount(s) are not whole cents`);
  const seen = /* @__PURE__ */ new Map();
  for (const d of set.donors) seen.set(d.donorKey, (seen.get(d.donorKey) ?? 0) + 1);
  const missing = [...list.keys()].filter((k) => !seen.has(k)).length;
  const twice = [...seen.values()].filter((n) => n > 1).length;
  const unknown = [...seen.keys()].filter((k) => !list.has(k)).length;
  checks.that(
    "np-yr-every-donor",
    "Every donor in the gift list is on the report exactly once",
    missing === 0 && twice === 0 && unknown === 0,
    `${missing} donor(s) in the list are not on the report, ${twice} are on it more than once, and ${unknown} on the report are not in the list`
  );
  const names = ["in the year", "the year before", "earlier", "later"];
  const groupProblems = [];
  const totalProblems = [];
  let countSum = 0;
  for (const d of set.donors) {
    countSum += Number.isSafeInteger(d.count) ? d.count : 0;
    const facts = list.get(d.donorKey);
    if (!facts) continue;
    const want = facts.rows[0] > 0 ? facts.rows[1] > 0 ? "both" : facts.rows[2] > 0 ? "returned" : "new" : facts.rows[1] > 0 ? "lapsed" : facts.rows[2] > 0 ? "earlier" : "later";
    if (d.group !== want) groupProblems.push(`${d.donorName}: listed under "${npYearGroupLabel(d.group, year)}", their gifts give "${npYearGroupLabel(want, year)}"`);
    const got = donorAmounts.get(d);
    const off = [0, 1, 2, 3].filter((i) => got[i] !== facts.totals[i]);
    if (off.length > 0 || d.count !== facts.count) {
      totalProblems.push(
        `${d.donorName}: ${off.map((i) => `${names[i]} the report shows ${usd(got[i])}, the list adds up to ${usd(facts.totals[i])}`).join(", ")}${d.count !== facts.count ? `${off.length ? "; " : ""}the report counts ${d.count} gift(s), the list has ${facts.count}` : ""}`
      );
    }
  }
  checks.that("np-yr-groups", "Every donor is in the group their own gift dates give", groupProblems.length === 0, groupProblems.slice(0, 6).join("; "));
  checks.that("np-yr-donor-totals", "Each donor's gift count and amounts equal that donor's rows in the gift list, added up again", totalProblems.length === 0, totalProblems.slice(0, 6).join("; "));
  const lineProblems = [];
  if (set.groups.length !== NP_YEAR_GROUPS.length || set.groups.some((l, i) => l.group !== NP_YEAR_GROUPS[i])) lineProblems.push("the report does not have one line per group");
  set.groups.forEach((line, n) => {
    const mine = set.donors.filter((d) => d.group === line.group);
    const added = [0n, 0n, 0n, 0n];
    for (const d of mine) donorAmounts.get(d).forEach((v, i) => added[i] += v);
    const got = lineAmounts[n];
    if (line.donors !== mine.length || [0, 1, 2, 3].some((i) => got[i] !== added[i])) lineProblems.push(`${npYearGroupLabel(line.group, year)}: the line shows ${line.donors} donor(s), its donors number ${mine.length}, or an amount differs from its donors added up`);
  });
  checks.that("np-yr-group-lines", "Each group's donor count and amounts equal its own donors added up", lineProblems.length === 0, lineProblems.slice(0, 6).join("; "));
  const yearProblems = [0, 1, 2, 3].filter((i) => setTotals[i] !== listTotals[i]).map((i) => `${names[i]}: the report shows ${usd(setTotals[i])}, the list adds up to ${usd(listTotals[i])}`);
  checks.that("np-yr-year-totals", "The totals for the year, the year before, earlier, and later each equal the gifts in the list dated then", yearProblems.length === 0, yearProblems.join("; "));
  const listGrand = listTotals[0] + listTotals[1] + listTotals[2] + listTotals[3];
  const shownGrand = setTotals[0] + setTotals[1] + setTotals[2] + setTotals[3];
  const grandOk = shownGrand === listGrand && grand === listGrand;
  checks.add({
    id: "np-yr-grand-total",
    label: "The four totals add up to the gift list",
    passed: grandOk,
    severity: "error",
    expected: usd(listGrand),
    actual: usd(grand),
    ...grandOk ? {} : { detail: `the list adds up to ${usd(listGrand)}, the four totals to ${usd(shownGrand)}, and the report shows ${usd(grand)}` }
  });
  checks.that("np-yr-gift-count", "The donors' gift counts add up to the number of gifts in the list", countSum === gifts.length && set.giftCount === gifts.length, `the list has ${gifts.length} gift(s), the donors' counts add up to ${countSum}, and the report says ${set.giftCount}`);
  checks.that("np-yr-last-year", `The list has gifts dated in ${year - 1}`, listRows[1] > 0, `No gift is dated in ${year - 1}, so no donor can be listed as having given that year. Check the year typed and that the list covers both years.`, "warning");
  checks.that("np-yr-later", `No gift is dated after ${year}`, listRows[3] === 0, `${listRows[3]} gift(s) totalling ${usd(listTotals[3])} are dated after ${year}. They are shown in their own column and do not change a donor's group, except that a donor with no other gifts is listed under "${npYearGroupLabel("later", year)}".`, "warning");
  checks.that("np-yr-nonpositive", "No gift is zero or negative", nonPositive.length === 0, `${nonPositive.length} gift(s) are zero or negative. Each still counts as a gift in its year and is added in as written: row(s) ${nonPositive.slice(0, 20).join(", ")}`, "warning");
  return checks.all;
}
function npDonorsByYear(gifts, year) {
  const set = npBuildYearGroups(gifts, year);
  return { ...set, checks: npVerifyYearGroups(gifts, set) };
}
function npLatestGiftYear(gifts) {
  let latest = "";
  for (const g of gifts) if (/^\d{4}-/.test(g.date) && g.date > latest) latest = g.date;
  return latest === "" ? null : Number(latest.slice(0, 4));
}
function npYearColumns(year) {
  return [`Given in ${year}`, `Given in ${year - 1}`, `Given before ${year - 1}`, `Given after ${year}`];
}
function npYearGroupTables(set) {
  const cols = npYearColumns(set.year);
  return {
    groups: [
      ["Group", "Donors", ...cols],
      ...set.groups.map((l) => [npYearGroupLabel(l.group, set.year), l.donors, toDecimal(l.thisYear), toDecimal(l.lastYear), toDecimal(l.earlier), toDecimal(l.later)]),
      ["Total", set.donors.length, toDecimal(set.thisYearTotal), toDecimal(set.lastYearTotal), toDecimal(set.earlierTotal), toDecimal(set.laterTotal)]
    ],
    donors: [
      ["Group", "Donor", "Email", "Gifts", ...cols, "Latest gift"],
      ...set.donors.map((d) => [npYearGroupLabel(d.group, set.year), d.donorName, d.email, d.count, toDecimal(d.thisYear), toDecimal(d.lastYear), toDecimal(d.earlier), toDecimal(d.later), d.lastGiftDate])
    ]
  };
}

// packages/core/src/nonprofit/partGift.ts
var NP_PART_GIFT_THRESHOLD = {
  cents: 7500,
  citation: "26 U.S.C. § 6115(a)",
  sourceUrl: "https://www.govinfo.gov/content/pkg/USCODE-2023-title26/html/USCODE-2023-title26-subtitleF-chap61-subchapB-sec6115.htm",
  moreSources: [
    {
      title: "Charitable contributions: Quid pro quo contributions",
      url: "https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-quid-pro-quo-contributions"
    }
  ],
  checkedOn: "2026-10-14",
  notes: "Our summary: the statute sets a threshold of more than $75 for a payment made partly as a gift and partly for goods or services, and the statute and the IRS page both describe exceptions. Here it is used only to flag payments; whether a payment is covered, or an exception applies, is not decided here."
};
var NP_PART_GIFT_LINES = ["flagged", "small", "zero", "none"];
function npPartGiftLineLabel(line) {
  const over = formatUSD(NP_PART_GIFT_THRESHOLD.cents);
  switch (line) {
    case "flagged":
      return `More than ${over}, with a value received`;
    case "small":
      return `${over} or less, with a value received`;
    case "zero":
      return "Value received entered as zero";
    case "none":
      return "No value received entered";
  }
}
var compareText3 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var isCents = (n) => typeof n === "number" && Number.isSafeInteger(n);
function npPartGiftValueProblems(input) {
  const typed = input.typed ?? /* @__PURE__ */ new Map();
  const byRow = /* @__PURE__ */ new Map();
  for (const g of input.gifts) if (!byRow.has(g.rowNumber)) byRow.set(g.rowNumber, g);
  const out = [];
  for (const [rowNumber, value] of typed) {
    const g = byRow.get(rowNumber);
    if (!g) out.push({ rowNumber, reason: "a value was typed for this row, which is not a payment in the gift list", inList: false });
    else if (g.receivedValue !== null) {
      const has = isCents(g.receivedValue) ? ` (${formatUSD(g.receivedValue)})` : "";
      out.push({ rowNumber, reason: `the gift list already has a value received for this payment${has}, and a typed value only fills a blank`, inList: true });
    } else if (!isCents(value)) out.push({ rowNumber, reason: "the value typed is not a whole number of cents", inList: false });
  }
  for (const g of input.gifts) {
    const inList = g.receivedValue !== null;
    const value = inList ? g.receivedValue : typed.get(g.rowNumber);
    if (value === void 0 || value === null) continue;
    if (!isCents(value)) {
      if (inList) out.push({ rowNumber: g.rowNumber, reason: "the value received in the gift list is not a whole number of cents", inList });
      continue;
    }
    if (!isCents(g.amount)) continue;
    if (value < 0) out.push({ rowNumber: g.rowNumber, reason: `the value received, ${formatUSD(value)}, is below zero`, inList });
    else if (value > 0 && value > g.amount) out.push({ rowNumber: g.rowNumber, reason: `the value received, ${formatUSD(value)}, is more than the payment, ${formatUSD(g.amount)}`, inList });
  }
  return out.sort((a, b) => a.rowNumber - b.rowNumber);
}
function npPartGiftProblemText(problems) {
  const shown = problems.slice(0, 6).map((p) => `on row ${p.rowNumber} ${p.reason}`);
  const more = problems.length > shown.length ? `; and ${problems.length - shown.length} more` : "";
  return `A value received was refused on ${problems.length} payment(s): ${shown.join("; ")}${more}. A value received is zero or more and no more than its payment, and none is changed to fit.`;
}
function npBuildPartGiftSplit(input) {
  const { gifts } = input;
  const typed = input.typed ?? /* @__PURE__ */ new Map();
  if (gifts.length === 0) throw new Error("There are no payments in the gift list.");
  for (const g of gifts) {
    if (g.donorKey === "") throw new Error(`The payment on row ${g.rowNumber} has no donor.`);
    assertCents(g.amount, `the payment on row ${g.rowNumber}`);
  }
  const problems = npPartGiftValueProblems(input);
  if (problems.length > 0) throw new Error(npPartGiftProblemText(problems));
  const threshold = NP_PART_GIFT_THRESHOLD.cents;
  const payments = [...gifts].sort((a, b) => a.rowNumber - b.rowNumber).map((g) => {
    const typedValue = typed.get(g.rowNumber);
    const valueFrom = g.receivedValue !== null ? "list" : typedValue !== void 0 ? "typed" : "none";
    const value = valueFrom === "list" ? g.receivedValue : valueFrom === "typed" ? typedValue : null;
    const partAbove = assertCents(g.amount - (value ?? 0), `the part above the value on row ${g.rowNumber}`);
    const line = value === null ? "none" : value === 0 ? "zero" : g.amount > threshold ? "flagged" : "small";
    return {
      rowNumber: g.rowNumber,
      donorKey: g.donorKey,
      donorName: g.donorName,
      date: g.date,
      fund: g.fund,
      receivedDescription: g.receivedDescription,
      amount: g.amount,
      value,
      valueFrom,
      partAbove,
      flagged: line === "flagged",
      line
    };
  });
  const valueOf = (p) => p.value ?? 0;
  const byDonor = /* @__PURE__ */ new Map();
  for (const p of payments) {
    const list = byDonor.get(p.donorKey);
    if (list) list.push(p);
    else byDonor.set(p.donorKey, [p]);
  }
  const donors = [...byDonor.entries()].map(([donorKey, mine]) => {
    const ordered = [...mine].sort((a, b) => compareText3(a.date, b.date) || a.rowNumber - b.rowNumber);
    return {
      donorKey,
      donorName: ordered[ordered.length - 1].donorName,
      payments: mine.length,
      amount: sum(mine.map((p) => p.amount)),
      value: sum(mine.map(valueOf)),
      partAbove: sum(mine.map((p) => p.partAbove)),
      flagged: mine.filter((p) => p.flagged).length
    };
  });
  donors.sort((a, b) => compareText3(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText3(a.donorKey, b.donorKey));
  const lines = NP_PART_GIFT_LINES.map((line) => {
    const mine = payments.filter((p) => p.line === line);
    return { line, payments: mine.length, amount: sum(mine.map((p) => p.amount)), value: sum(mine.map(valueOf)), partAbove: sum(mine.map((p) => p.partAbove)) };
  });
  return {
    thresholdCents: threshold,
    payments,
    donors,
    lines,
    total: {
      payments: payments.length,
      amount: sum(payments.map((p) => p.amount)),
      value: sum(payments.map(valueOf)),
      partAbove: sum(payments.map((p) => p.partAbove)),
      flagged: payments.filter((p) => p.flagged).length
    }
  };
}
function npPartGiftFlagHeader() {
  return `More than ${formatUSD(NP_PART_GIFT_THRESHOLD.cents)} with a value received`;
}
var VALUE_FROM = { list: "Gift list", typed: "Typed here", none: "" };
function npPartGiftTables(set) {
  const head = ["File row", "Donor", "Gift date", "Fund", "Received in return", "Amount paid", "Value received", "Value from", "Part above the value", npPartGiftFlagHeader()];
  const row = (p) => [
    p.rowNumber,
    p.donorName,
    p.date,
    p.fund,
    p.receivedDescription,
    toDecimal(p.amount),
    p.value === null ? "" : toDecimal(p.value),
    VALUE_FROM[p.valueFrom],
    toDecimal(p.partAbove),
    p.flagged ? "Yes" : ""
  ];
  const t = set.total;
  return {
    summary: [
      ["", "Payments", "Amount paid", "Value received", "Part above the value"],
      ...set.lines.map((l) => [npPartGiftLineLabel(l.line), l.payments, toDecimal(l.amount), toDecimal(l.value), toDecimal(l.partAbove)]),
      ["All payments", t.payments, toDecimal(t.amount), toDecimal(t.value), toDecimal(t.partAbove)]
    ],
    payments: [head, ...set.payments.map(row)],
    entered: [head, ...set.payments.filter((p) => p.value !== null).map(row)],
    donors: [
      ["Donor", "Payments", "Amount paid", "Value received", "Part above the value", "Flagged payments"],
      ...set.donors.map((d) => [d.donorName, d.payments, toDecimal(d.amount), toDecimal(d.value), toDecimal(d.partAbove), d.flagged]),
      ["Total", t.payments, toDecimal(t.amount), toDecimal(t.value), toDecimal(t.partAbove), t.flagged]
    ]
  };
}

// packages/core/src/nonprofit/partGiftCheck.ts
var empty = () => ({ payments: 0, amount: 0n, value: 0n, part: 0n, flagged: 0 });
function rowList2(rows) {
  const all = [...new Set(rows)].sort((a, b) => a - b);
  const shown = all.slice(0, 20);
  return `row(s) ${shown.join(", ")}${all.length > shown.length ? ` and ${all.length - shown.length} more` : ""}`;
}
function npVerifyPartGiftSplit(input, set) {
  const checks = new CheckList();
  const typed = input.typed ?? /* @__PURE__ */ new Map();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const usd = (n) => formatUSD(Number(n));
  const threshold = BigInt(NP_PART_GIFT_THRESHOLD.cents);
  const over = usd(threshold);
  const rows = /* @__PURE__ */ new Map();
  const listRowCount = /* @__PURE__ */ new Map();
  const donors = /* @__PURE__ */ new Map();
  const lines = new Map(NP_PART_GIFT_LINES.map((l) => [l, empty()]));
  const list = empty();
  const small = [];
  const described = [];
  const nonPositive = [];
  for (const g of input.gifts) {
    listRowCount.set(g.rowNumber, (listRowCount.get(g.rowNumber) ?? 0) + 1);
    const amount = B(g.amount);
    const typedValue = typed.get(g.rowNumber);
    const from = g.receivedValue !== null ? "list" : typedValue !== void 0 ? "typed" : "none";
    const value = from === "list" ? B(g.receivedValue) : from === "typed" ? B(typedValue) : null;
    const part = amount - (value ?? 0n);
    const isOver = amount - threshold > 0n;
    const line = value === null ? "none" : value === 0n ? "zero" : isOver ? "flagged" : "small";
    if (!rows.has(g.rowNumber)) rows.set(g.rowNumber, { gift: g, amount, value, from, part, line });
    const flagged = line === "flagged" ? 1 : 0;
    let donor = donors.get(g.donorKey);
    if (!donor) {
      donor = empty();
      donors.set(g.donorKey, donor);
    }
    for (const s of [list, lines.get(line), donor]) {
      s.payments += 1;
      s.amount += amount;
      s.value += value ?? 0n;
      s.part += part;
      s.flagged += flagged;
    }
    if (line === "small") small.push(g.rowNumber);
    if (value === null && g.receivedDescription.trim() !== "") described.push(g.rowNumber);
    if (amount <= 0n) nonPositive.push(g.rowNumber);
  }
  const strayTyped = [];
  for (const row of typed.keys()) {
    const facts = rows.get(row);
    if (!facts || facts.gift.receivedValue !== null) strayTyped.push(row);
  }
  const splitRowCount = /* @__PURE__ */ new Map();
  const changed = [];
  const valueOff = [];
  const notAdding = [];
  const outside = [];
  const flagOff = [];
  let paid = 0n;
  for (const p of set.payments) {
    splitRowCount.set(p.rowNumber, (splitRowCount.get(p.rowNumber) ?? 0) + 1);
    const amount = B(p.amount);
    const value = p.value === null ? null : B(p.value);
    const part = B(p.partAbove);
    paid += amount;
    if (part + (value ?? 0n) !== amount) notAdding.push(p.rowNumber);
    if (value !== null && (value < 0n || value > 0n && value > amount)) outside.push(p.rowNumber);
    const facts = rows.get(p.rowNumber);
    if (!facts) continue;
    const g = facts.gift;
    if (p.donorKey !== g.donorKey || p.donorName !== g.donorName || p.date !== g.date || p.fund !== g.fund || p.receivedDescription !== g.receivedDescription || amount !== facts.amount) changed.push(p.rowNumber);
    if (p.valueFrom !== facts.from || value !== facts.value) valueOff.push(p.rowNumber);
    if (p.line !== facts.line || p.flagged !== (facts.line === "flagged")) flagOff.push(p.rowNumber);
  }
  const donorSeen = /* @__PURE__ */ new Map();
  const donorOff = [];
  for (const d of set.donors) {
    donorSeen.set(d.donorKey, (donorSeen.get(d.donorKey) ?? 0) + 1);
    const want = donors.get(d.donorKey);
    const amount = B(d.amount);
    const value = B(d.value);
    const part = B(d.partAbove);
    if (!want || d.payments !== want.payments || amount !== want.amount || value !== want.value || part !== want.part || d.flagged !== want.flagged) donorOff.push(d.donorName);
  }
  const lineOff = [];
  if (set.lines.length !== NP_PART_GIFT_LINES.length || set.lines.some((l, i) => l.line !== NP_PART_GIFT_LINES[i])) lineOff.push("the summary does not have one line of each kind, in order");
  for (const l of set.lines) {
    const want = lines.get(l.line);
    const amount = B(l.amount);
    const value = B(l.value);
    const part = B(l.partAbove);
    if (!want || l.payments !== want.payments || amount !== want.amount || value !== want.value || part !== want.part) {
      lineOff.push(want ? `${npPartGiftLineLabel(l.line)}: the line shows ${l.payments} payment(s), ${usd(amount)} paid, ${usd(value)} value received, ${usd(part)} above the value; its payments in the list give ${want.payments}, ${usd(want.amount)}, ${usd(want.value)}, ${usd(want.part)}` : `a line of an unknown kind, "${String(l.line)}"`);
    }
  }
  const totalAmount = B(set.total.amount);
  const totalValue = B(set.total.value);
  const totalPart = B(set.total.partAbove);
  checks.that("np-pg-whole-cents", "Every amount and value in the gift list, typed on the page, and in the split is a whole number of cents", notWhole === 0, `${notWhole} amount(s) are not whole numbers of cents`);
  const offRows = [];
  for (const [row, n] of listRowCount) if (n !== 1 || splitRowCount.get(row) !== 1) offRows.push(row);
  for (const row of splitRowCount.keys()) if (!listRowCount.has(row)) offRows.push(row);
  checks.that("np-pg-every-row-once", "Every payment in the gift list is split exactly once, and the split holds no other row", offRows.length === 0, rowList2(offRows));
  checks.that("np-pg-payments-match", "Each payment shows the donor, date, fund, description, and amount that its row in the gift list has", changed.length === 0, rowList2(changed));
  checks.that(
    "np-pg-values-match",
    "Each value received is the one in the gift list for that row, or the one typed for it where the list is blank",
    valueOff.length === 0 && strayTyped.length === 0,
    [valueOff.length ? `${rowList2(valueOff)} show a different value or say it came from somewhere else` : "", strayTyped.length ? `a value is typed for ${rowList2(strayTyped)}, which are not in the list or already have a value there` : ""].filter(Boolean).join("; ")
  );
  checks.that("np-pg-each-adds-up", "For every payment, the part above the value plus the value received equals the amount paid", notAdding.length === 0, rowList2(notAdding));
  checks.that("np-pg-value-within", "No value received is below zero or more than its payment", outside.length === 0, rowList2(outside));
  const thresholdOk = set.thresholdCents === NP_PART_GIFT_THRESHOLD.cents;
  checks.that(
    "np-pg-flags",
    `Every payment is flagged exactly when it is more than ${over} and a value received of more than zero is entered`,
    thresholdOk && flagOff.length === 0,
    [thresholdOk ? "" : `the split was flagged at ${Number.isSafeInteger(set.thresholdCents) ? formatUSD(set.thresholdCents) : String(set.thresholdCents)}, not ${over}`, flagOff.length ? `${rowList2(flagOff)} carry a flag or a line their amount and value do not give` : ""].filter(Boolean).join("; ")
  );
  const missingDonors = [...donors.keys()].filter((k) => !donorSeen.has(k)).length;
  const twiceDonors = [...donorSeen.values()].filter((n) => n > 1).length;
  const unknownDonors = [...donorSeen.keys()].filter((k) => !donors.has(k)).length;
  checks.that(
    "np-pg-donor-totals",
    "Each donor's payments, amount paid, value received, part above the value, and flagged payments equal that donor's rows in the gift list, worked out again",
    donorOff.length === 0 && missingDonors === 0 && twiceDonors === 0 && unknownDonors === 0,
    [donorOff.length ? `totals differ for ${donorOff.slice(0, 6).join("; ")}` : "", missingDonors || twiceDonors || unknownDonors ? `${missingDonors} donor(s) in the list have no line, ${twiceDonors} have more than one, and ${unknownDonors} line(s) name a donor not in the list` : ""].filter(Boolean).join("; ")
  );
  checks.that("np-pg-lines", "Each summary line equals its own payments in the gift list, worked out again", lineOff.length === 0, lineOff.slice(0, 4).join("; "));
  const listOk = paid === list.amount && totalAmount === list.amount && set.payments.length === input.gifts.length && set.total.payments === input.gifts.length;
  checks.add({
    id: "np-pg-list-total",
    label: "The payments add up to the gift list's own total, by count and by amount",
    passed: listOk,
    severity: "error",
    expected: usd(list.amount),
    actual: usd(totalAmount),
    ...listOk ? {} : { detail: `the gift list has ${input.gifts.length} payment(s) adding up to ${usd(list.amount)}; the split holds ${set.payments.length} adding up to ${usd(paid)}, and its total says ${set.total.payments} and ${usd(totalAmount)}` }
  });
  const totalsOk = totalValue === list.value && totalPart === list.part && set.total.flagged === list.flagged && totalValue + totalPart === totalAmount;
  checks.add({
    id: "np-pg-totals",
    label: "The totals of value received, part above the value, and flagged payments, worked out again from the gift list, agree, and value received plus part above equals the amount paid",
    passed: totalsOk,
    severity: "error",
    expected: `${usd(list.value)} + ${usd(list.part)} = ${usd(list.amount)}`,
    actual: `${usd(totalValue)} + ${usd(totalPart)} = ${usd(totalAmount)}`,
    ...totalsOk ? {} : { detail: `worked out again: ${usd(list.value)} value received, ${usd(list.part)} above the value, ${list.flagged} flagged; the split shows ${usd(totalValue)}, ${usd(totalPart)}, ${set.total.flagged}` }
  });
  checks.that(
    "np-pg-small-with-value",
    `No payment of ${over} or less has a value received entered`,
    small.length === 0,
    `${small.length} payment(s) of ${over} or less have a value received entered. Each is split and shown, and none is flagged, because the flag is for payments of more than ${over}: ${rowList2(small)}`,
    "warning"
  );
  checks.that(
    "np-pg-described-no-value",
    "Every payment with something written as received in return has a value received entered",
    described.length === 0,
    `${described.length} payment(s) have something written as received in return and no value entered. No value is guessed, so nothing is taken off them: ${rowList2(described)}`,
    "warning"
  );
  checks.that("np-pg-nonpositive", "No payment is zero or negative", nonPositive.length === 0, `${nonPositive.length} payment(s) are zero or negative and are split as written: ${rowList2(nonPositive)}`, "warning");
  return checks.all;
}
function npSplitPartGifts(input) {
  const set = npBuildPartGiftSplit(input);
  return { ...set, checks: npVerifyPartGiftSplit(input, set) };
}

// packages/core/src/nonprofit/retention.ts
var NP_RET_GROUPS = ["firstKept", "firstLapsed", "repeatKept", "repeatLapsed", "new", "returned", "neither"];
function npRetGroupLabel(group, year) {
  const last = year - 1;
  switch (group) {
    case "firstKept":
      return `First-year: first gift in ${last}, gave again in ${year}`;
    case "firstLapsed":
      return `First-year: first gift in ${last}, no gift in ${year}`;
    case "repeatKept":
      return `Repeat: gave in ${last} and before, gave again in ${year}`;
    case "repeatLapsed":
      return `Repeat: gave in ${last} and before, no gift in ${year}`;
    case "new":
      return `Not a ${last} donor: first gift in the list is in ${year}`;
    case "returned":
      return `Not a ${last} donor: gave in ${year} and before ${last}`;
    case "neither":
      return `Not a ${last} donor: no gift in ${last} or ${year}`;
  }
}
var NP_RET_RATES = ["donor", "firstYear", "repeat", "dollar"];
var compareText4 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function tenthsOf(numerator, denominator) {
  const n = BigInt(numerator) * 1000n;
  const d = BigInt(denominator);
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  if (2n * (a % d) >= d) q += 1n;
  return Number(neg ? -q : q);
}
function npRetPercent(tenths) {
  const neg = tenths < 0;
  const a = Math.abs(tenths);
  return `${neg ? "-" : ""}${Math.floor(a / 10)}.${a % 10}%`;
}
function noneReason(id, year, denominator, donors) {
  const last = year - 1;
  switch (id) {
    case "donor":
      return `No donors in ${last}`;
    case "firstYear":
      return `No first-year donors in ${last}`;
    case "repeat":
      return `No repeat donors in ${last}`;
    case "dollar":
      return donors === 0 ? `No donors in ${last}` : `${last} gifts add up to ${formatUSD(denominator)}, so there is no dollar rate`;
  }
}
function rate(id, numerator, denominator, year, donors) {
  const unit = id === "dollar" ? "cents" : "donors";
  const usable = denominator > 0;
  return { id, numerator, denominator, unit, tenths: usable ? tenthsOf(numerator, denominator) : null, none: usable ? null : noneReason(id, year, denominator, donors) };
}
function retGroupOf(lybunt, before) {
  switch (lybunt) {
    case "both":
      return before ? "repeatKept" : "firstKept";
    case "lapsed":
      return before ? "repeatLapsed" : "firstLapsed";
    case "new":
      return "new";
    case "returned":
      return "returned";
    case "earlier":
    case "later":
      return "neither";
  }
}
function npBuildRetention(gifts, year) {
  const yg = npBuildYearGroups(gifts, year);
  const y = yg.year;
  const before = /* @__PURE__ */ new Set();
  for (const g of gifts) if (Number(g.date.slice(0, 4)) < y - 1) before.add(g.donorKey);
  const donors = yg.donors.map((d) => ({ donorKey: d.donorKey, donorName: d.donorName, email: d.email, group: retGroupOf(d.group, before.has(d.donorKey)), lastYear: d.lastYear, thisYear: d.thisYear }));
  const rank = new Map(NP_RET_GROUPS.map((g, i) => [g, i]));
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || compareText4(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText4(a.donorKey, b.donorKey));
  const groups = NP_RET_GROUPS.map((group) => {
    const mine = donors.filter((d) => d.group === group);
    return { group, donors: mine.length, lastYear: sum(mine.map((d) => d.lastYear)), thisYear: sum(mine.map((d) => d.thisYear)) };
  });
  const line = (g) => groups[rank.get(g)];
  const firstKept = line("firstKept").donors;
  const repeatKept = line("repeatKept").donors;
  const firstYear = firstKept + line("firstLapsed").donors;
  const repeat = repeatKept + line("repeatLapsed").donors;
  const lastYearDonors = firstYear + repeat;
  const kept = firstKept + repeatKept;
  const keptThisYear = line("firstKept").thisYear + line("repeatKept").thisYear;
  const lastYearTotal = yg.lastYearTotal;
  return {
    year: y,
    donors,
    groups,
    lastYearDonors,
    kept,
    lapsed: lastYearDonors - kept,
    firstYear,
    repeat,
    lastYearTotal,
    keptThisYear,
    thisYearTotal: yg.thisYearTotal,
    rates: [rate("donor", kept, lastYearDonors, y, lastYearDonors), rate("firstYear", firstKept, firstYear, y, firstYear), rate("repeat", repeatKept, repeat, y, repeat), rate("dollar", keptThisYear, lastYearTotal, y, lastYearDonors)]
  };
}
function npVerifyRetention(gifts, set) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const usd = (n) => formatUSD(Number(n));
  const year = set.year;
  const pad = (n) => String(n).padStart(4, "0");
  const lastStart = `${pad(year - 1)}-01-01`;
  const yearStart = `${pad(year)}-01-01`;
  const yearEnd = `${pad(year)}-12-31`;
  const stretch = (date) => date > yearEnd ? 3 : date >= yearStart ? 0 : date >= lastStart ? 1 : 2;
  const list = /* @__PURE__ */ new Map();
  const listRows = [0, 0, 0, 0];
  const listTotals = [0n, 0n, 0n, 0n];
  const nonPositive = [];
  for (const g of gifts) {
    const a = B(g.amount);
    const s = stretch(g.date);
    let f = list.get(g.donorKey);
    if (!f) list.set(g.donorKey, f = { rows: [0, 0, 0, 0], totals: [0n, 0n, 0n, 0n] });
    f.rows[s]++;
    f.totals[s] += a;
    listRows[s]++;
    listTotals[s] += a;
    if (g.amount <= 0) nonPositive.push(g.rowNumber);
  }
  const shown = /* @__PURE__ */ new Map();
  for (const d of set.donors) shown.set(d, [B(d.lastYear), B(d.thisYear)]);
  const lines = set.groups.map((l) => [B(l.lastYear), B(l.thisYear)]);
  const setLast = B(set.lastYearTotal);
  const setKeptThis = B(set.keptThisYear);
  const setThis = B(set.thisYearTotal);
  const rateNums = set.rates.map((r) => B(r.numerator));
  checks.that("np-ret-whole-cents", "Every amount is a whole number of cents", notWhole === 0, `${notWhole} amount(s) are not whole cents`);
  const seen = /* @__PURE__ */ new Map();
  for (const d of set.donors) seen.set(d.donorKey, (seen.get(d.donorKey) ?? 0) + 1);
  const missing = [...list.keys()].filter((k) => !seen.has(k)).length;
  const twice = [...seen.values()].filter((n) => n > 1).length;
  const unknown = [...seen.keys()].filter((k) => !list.has(k)).length;
  checks.that(
    "np-ret-every-donor",
    "Every donor in the gift list is in exactly one group, and no other donor is",
    missing === 0 && twice === 0 && unknown === 0,
    `${missing} donor(s) in the list are in no group, ${twice} are in more than one, and ${unknown} in the result are not in the list`
  );
  const want = (f) => {
    const [inYear, inLast, before] = [f.rows[0] > 0, f.rows[1] > 0, f.rows[2] > 0];
    if (inLast) return before ? inYear ? "repeatKept" : "repeatLapsed" : inYear ? "firstKept" : "firstLapsed";
    if (inYear) return before ? "returned" : "new";
    return "neither";
  };
  const groupProblems = [];
  const amountProblems = [];
  for (const d of set.donors) {
    const f = list.get(d.donorKey);
    if (!f) continue;
    const w = want(f);
    if (d.group !== w) groupProblems.push(`${d.donorName}: shown under "${npRetGroupLabel(d.group, year)}", their gifts give "${npRetGroupLabel(w, year)}"`);
    const [l, t] = shown.get(d);
    if (l !== f.totals[1] || t !== f.totals[0]) amountProblems.push(`${d.donorName}: shown ${usd(l)} in ${year - 1} and ${usd(t)} in ${year}, the list adds up to ${usd(f.totals[1])} and ${usd(f.totals[0])}`);
  }
  checks.that("np-ret-groups", "Every donor is in the group their own gift dates give", groupProblems.length === 0, groupProblems.slice(0, 6).join("; "));
  checks.that("np-ret-donor-amounts", "Each donor's amounts for the two years equal that donor's rows in the gift list, added up again", amountProblems.length === 0, amountProblems.slice(0, 6).join("; "));
  const lineProblems = [];
  if (set.groups.length !== NP_RET_GROUPS.length || set.groups.some((l, i) => l.group !== NP_RET_GROUPS[i])) lineProblems.push("the result does not have one line per group");
  set.groups.forEach((l, n) => {
    const mine = set.donors.filter((d) => d.group === l.group);
    let a = 0n;
    let b = 0n;
    for (const d of mine) {
      const [x, y] = shown.get(d);
      a += x;
      b += y;
    }
    if (l.donors !== mine.length || lines[n][0] !== a || lines[n][1] !== b) lineProblems.push(`${npRetGroupLabel(l.group, year)}: the line shows ${l.donors} donor(s) and ${usd(lines[n][0])} / ${usd(lines[n][1])}, its donors number ${mine.length} and add up to ${usd(a)} / ${usd(b)}`);
  });
  checks.that("np-ret-group-lines", "Each group's donor count and amounts equal its own donors added up", lineProblems.length === 0, lineProblems.slice(0, 6).join("; "));
  let listLastDonors = 0;
  let listKept = 0;
  let listFirst = 0;
  let listKeptFirst = 0;
  let listKeptRepeat = 0;
  let keptThis = 0n;
  for (const f of list.values()) {
    if (f.rows[1] === 0) continue;
    listLastDonors++;
    const kept = f.rows[0] > 0;
    const first = f.rows[2] === 0;
    if (kept) {
      listKept++;
      keptThis += f.totals[0];
      if (first) listKeptFirst++;
      else listKeptRepeat++;
    }
    if (first) listFirst++;
  }
  const listRepeat = listLastDonors - listFirst;
  checks.add({
    id: "np-ret-kept-lapsed",
    label: "Donors kept plus donors lapsed equals last year's donors",
    passed: set.kept + set.lapsed === listLastDonors && set.lastYearDonors === listLastDonors && set.kept === listKept,
    severity: "error",
    expected: `${listLastDonors} donor(s) gave in ${year - 1}`,
    actual: `${set.kept} kept + ${set.lapsed} lapsed = ${set.kept + set.lapsed}`
  });
  checks.add({
    id: "np-ret-first-repeat",
    label: "First-year donors plus repeat donors equals last year's donors",
    passed: set.firstYear + set.repeat === listLastDonors && set.firstYear === listFirst && set.repeat === listRepeat,
    severity: "error",
    expected: `${listLastDonors} donor(s) gave in ${year - 1}`,
    actual: `${set.firstYear} first-year + ${set.repeat} repeat = ${set.firstYear + set.repeat}`
  });
  const groupThis = lines.reduce((s, l) => s + l[1], 0n);
  const groupLast = lines.reduce((s, l) => s + l[0], 0n);
  const dollarProblems = [];
  if (setLast !== listTotals[1] || groupLast !== listTotals[1]) dollarProblems.push(`${year - 1}: the result shows ${usd(setLast)} and its groups add up to ${usd(groupLast)}, the gifts dated ${year - 1} add up to ${usd(listTotals[1])}`);
  if (setThis !== listTotals[0] || groupThis !== listTotals[0]) dollarProblems.push(`${year}: the result shows ${usd(setThis)} and its groups add up to ${usd(groupThis)}, the gifts dated ${year} add up to ${usd(listTotals[0])}`);
  if (setKeptThis !== keptThis) dollarProblems.push(`the donors kept gave ${usd(keptThis)} in ${year} by the list, the result shows ${usd(setKeptThis)}`);
  checks.add({
    id: "np-ret-dollars",
    label: "The dollar figures tie to the gift list",
    passed: dollarProblems.length === 0,
    severity: "error",
    expected: `${usd(listTotals[1])} in ${year - 1}, ${usd(listTotals[0])} in ${year}`,
    actual: `${usd(setLast)} in ${year - 1}, ${usd(setThis)} in ${year}`,
    ...dollarProblems.length ? { detail: dollarProblems.join("; ") } : {}
  });
  const expected = {
    donor: [BigInt(listKept), BigInt(listLastDonors)],
    firstYear: [BigInt(listKeptFirst), BigInt(listFirst)],
    repeat: [BigInt(listKeptRepeat), BigInt(listRepeat)],
    dollar: [keptThis, listTotals[1]]
  };
  const rateProblems = [];
  if (set.rates.length !== NP_RET_RATES.length || set.rates.some((r, i) => r.id !== NP_RET_RATES[i])) rateProblems.push("the result does not have the four rates in order");
  set.rates.forEach((r, i) => {
    const e = expected[r.id];
    if (!e) return;
    const [en, ed] = e;
    const num = rateNums[i];
    const den = B(r.denominator);
    if (num !== en || den !== ed) {
      rateProblems.push(`${r.id}: shown ${num} over ${den}, the list gives ${en} over ${ed}`);
      return;
    }
    if (ed <= 0n) {
      if (r.tenths !== null || !r.none) rateProblems.push(`${r.id}: the denominator is ${ed}, so there is no rate, but one is shown`);
      return;
    }
    if (r.tenths === null || !Number.isSafeInteger(r.tenths)) {
      rateProblems.push(`${r.id}: no percentage shown for ${en} over ${ed}`);
      return;
    }
    const twice2 = 2n * (en * 1000n - BigInt(r.tenths) * ed);
    const ok = en >= 0n ? twice2 >= -ed && twice2 < ed : twice2 > -ed && twice2 <= ed;
    if (!ok) rateProblems.push(`${r.id}: ${en} over ${ed} does not round to ${npRetPercent(r.tenths)}`);
  });
  checks.that("np-ret-rates", "Each rate is its own count over its own count, and its percentage is that fraction rounded to one decimal place", rateProblems.length === 0, rateProblems.join("; "));
  let lyProblems = [];
  try {
    const ly = npDonorsByYear(gifts, year);
    const bad = failures(ly.checks);
    if (bad.length) lyProblems.push(`the LYBUNT report's own checks fail: ${bad.map((c) => c.label).join("; ")}`);
    const keys = (pick) => ly.donors.filter((d) => pick(d.group)).map((d) => d.donorKey).sort().join("\n");
    const mine = (pick) => set.donors.filter((d) => pick(d.group)).map((d) => d.donorKey).sort().join("\n");
    if (keys((g) => g === "both") !== mine((g) => g === "firstKept" || g === "repeatKept")) lyProblems.push(`the donors kept are not the LYBUNT report's donors who gave in ${year - 1} and in ${year}`);
    if (keys((g) => g === "lapsed") !== mine((g) => g === "firstLapsed" || g === "repeatLapsed")) lyProblems.push(`the donors lapsed are not the LYBUNT report's donors who gave in ${year - 1}, not in ${year}`);
  } catch (err) {
    lyProblems = [`the LYBUNT report could not be built: ${err instanceof Error ? err.message : "unknown reason"}`];
  }
  checks.that("np-ret-lybunt", "The LYBUNT report on the same list agrees about who gave in which year", lyProblems.length === 0, lyProblems.join("; "));
  checks.that("np-ret-last-year", `The list has gifts dated in ${year - 1}`, listRows[1] > 0, `No gift is dated in ${year - 1}, so there were no donors last year and no rate can be worked out. Check the year typed and that the list covers both years.`, "warning");
  checks.that("np-ret-history", `The list has gifts dated before ${year - 1}`, listRows[2] > 0, `No gift is dated before ${year - 1}, so every ${year - 1} donor counts as first-year and none as repeat. First-year means the donor's first gift in this list.`, "warning");
  checks.that("np-ret-later", `No gift is dated after ${year}`, listRows[3] === 0, `${listRows[3]} gift(s) totalling ${usd(listTotals[3])} are dated after ${year}. They change no rate.`, "warning");
  checks.that("np-ret-nonpositive", "No gift is zero or negative", nonPositive.length === 0, `${nonPositive.length} gift(s) are zero or negative. Each still counts as a gift in its year and is added in as written: row(s) ${nonPositive.slice(0, 20).join(", ")}`, "warning");
  return checks.all;
}
function npDonorRetention(gifts, year) {
  const set = npBuildRetention(gifts, year);
  return { ...set, checks: npVerifyRetention(gifts, set) };
}
var RATE_NAMES = {
  donor: "Donor retention",
  firstYear: "First-year retention",
  repeat: "Repeat retention",
  dollar: "Dollar retention"
};
function npRetRateWords(id, year) {
  const last = year - 1;
  switch (id) {
    case "donor":
      return { name: RATE_NAMES.donor, numerator: `${last} donors who gave again in ${year}`, denominator: `donors who gave in ${last}` };
    case "firstYear":
      return { name: RATE_NAMES.firstYear, numerator: `first-year ${last} donors who gave again in ${year}`, denominator: `donors whose first gift in the list is in ${last}` };
    case "repeat":
      return { name: RATE_NAMES.repeat, numerator: `repeat ${last} donors who gave again in ${year}`, denominator: `donors who gave in ${last} and before ${last}` };
    case "dollar":
      return { name: RATE_NAMES.dollar, numerator: `what the donors kept gave in ${year}`, denominator: `what all ${last} donors gave in ${last}` };
  }
}
function npRetentionTables(set) {
  const last = set.year - 1;
  const show = (r, n) => r.unit === "cents" ? formatUSD(n) : String(n);
  return {
    rates: [
      ["Rate", "Numerator", "Denominator", "Fraction", "Percent"],
      ...set.rates.map((r) => {
        const w = npRetRateWords(r.id, set.year);
        return [w.name, w.numerator, w.denominator, `${show(r, r.numerator)} / ${show(r, r.denominator)}`, r.tenths === null ? r.none ?? "" : npRetPercent(r.tenths)];
      })
    ],
    groups: [
      ["Group", "Donors", `Given in ${last}`, `Given in ${set.year}`],
      ...set.groups.map((l) => [npRetGroupLabel(l.group, set.year), l.donors, toDecimal(l.lastYear), toDecimal(l.thisYear)]),
      ["Total", set.donors.length, toDecimal(set.lastYearTotal), toDecimal(set.thisYearTotal)]
    ],
    donors: [
      ["Group", "Donor", "Email", `Given in ${last}`, `Given in ${set.year}`],
      ...set.donors.map((d) => [npRetGroupLabel(d.group, set.year), d.donorName, d.email, toDecimal(d.lastYear), toDecimal(d.thisYear)])
    ]
  };
}

// packages/core/src/nonprofit/statementsCheck.ts
var rowList3 = (rows) => `row(s) ${[...new Set(rows)].sort((a, b) => a - b).join(", ")}`;
function npVerifyStatements(gifts, set, depositsByFund2) {
  const checks = new CheckList();
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const cents = (n) => Number(n);
  const listRows = /* @__PURE__ */ new Map();
  const listRowCount = /* @__PURE__ */ new Map();
  const donors = /* @__PURE__ */ new Map();
  const listFunds = /* @__PURE__ */ new Map();
  let listTotal = 0n;
  let listReceived = 0n;
  for (const g of gifts) {
    const amount = B(g.amount);
    const received = g.receivedValue === null ? 0n : B(g.receivedValue);
    if (!listRows.has(g.rowNumber)) listRows.set(g.rowNumber, g);
    listRowCount.set(g.rowNumber, (listRowCount.get(g.rowNumber) ?? 0) + 1);
    let d = donors.get(g.donorKey);
    if (!d) {
      d = { count: 0, total: 0n, received: 0n, funds: /* @__PURE__ */ new Map(), names: /* @__PURE__ */ new Set(), ordered: [] };
      donors.set(g.donorKey, d);
    }
    d.count += 1;
    d.total += amount;
    d.received += received;
    d.names.add(g.donorName);
    d.ordered.push(g);
    const f = d.funds.get(g.fund) ?? { count: 0, total: 0n };
    d.funds.set(g.fund, { count: f.count + 1, total: f.total + amount });
    listFunds.set(g.fund, (listFunds.get(g.fund) ?? 0n) + amount);
    listTotal += amount;
    listReceived += received;
  }
  for (const d of donors.values()) d.ordered.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowNumber - b.rowNumber);
  const stmtRowCount = /* @__PURE__ */ new Map();
  const wrongDonorRows = [];
  const changedRows = [];
  const stmtFunds = /* @__PURE__ */ new Map();
  const stmtKeyCount = /* @__PURE__ */ new Map();
  const badTotals = [];
  const badReceived = [];
  const badDetails = [];
  let stmtTotal = 0n;
  let stmtCount = 0;
  let stmtReceived = 0n;
  for (const s of set.statements) {
    stmtKeyCount.set(s.donorKey, (stmtKeyCount.get(s.donorKey) ?? 0) + 1);
    const total = B(s.total);
    const received = B(s.receivedValueTotal);
    stmtTotal += total;
    stmtCount += s.count;
    stmtReceived += received;
    for (const g of s.gifts) {
      stmtRowCount.set(g.rowNumber, (stmtRowCount.get(g.rowNumber) ?? 0) + 1);
      const listed = listRows.get(g.rowNumber);
      if (!listed) continue;
      if (listed.donorKey !== s.donorKey) wrongDonorRows.push(g.rowNumber);
      if (g.date !== listed.date || g.fund !== listed.fund || g.amount !== listed.amount || g.receivedValue !== listed.receivedValue || g.receivedDescription !== listed.receivedDescription) changedRows.push(g.rowNumber);
    }
    let fundSum = 0n;
    let fundCount = 0;
    const seenFunds = /* @__PURE__ */ new Set();
    let fundsMatch = true;
    const mine = donors.get(s.donorKey);
    for (const f of s.byFund) {
      const amount = B(f.total);
      fundSum += amount;
      fundCount += f.count;
      stmtFunds.set(f.fund, (stmtFunds.get(f.fund) ?? 0n) + amount);
      const want = mine?.funds.get(f.fund);
      if (seenFunds.has(f.fund) || !want || want.total !== amount || want.count !== f.count) fundsMatch = false;
      seenFunds.add(f.fund);
    }
    const totalsOk = mine !== void 0 && total === mine.total && s.count === mine.count && s.gifts.length === mine.count && fundsMatch && seenFunds.size === mine.funds.size && fundSum === total && fundCount === s.count;
    if (!totalsOk) badTotals.push(s.donorName);
    if (!mine || received !== mine.received) badReceived.push(s.donorName);
    const latest = mine?.ordered[mine.ordered.length - 1];
    const latestWith = (pick) => {
      for (let i = (mine?.ordered.length ?? 0) - 1; i >= 0; i--) if (pick(mine.ordered[i]) !== "") return pick(mine.ordered[i]);
      return "";
    };
    if (!latest || s.donorName !== latest.donorName || s.address !== latestWith((g) => g.address) || s.email !== latestWith((g) => g.email)) badDetails.push(s.donorName);
  }
  const summaryGrand = B(set.grandTotal);
  const summaryFunds = set.fundTotals.map((f) => ({ fund: f.fund, count: f.count, total: B(f.total) }));
  const typedDeposits = depositsByFund2 ? Object.entries(depositsByFund2).map(([name, amount]) => ({ name, amount: B(amount) })) : void 0;
  checks.that("np-stmt-whole-cents", "Every amount in the gift list and on the statements is a whole number of cents", notWhole === 0, `${notWhole} amount(s) are not whole numbers of cents`);
  const offRows = [];
  for (const [row, n] of listRowCount) if (n !== 1 || stmtRowCount.get(row) !== 1) offRows.push(row);
  for (const row of stmtRowCount.keys()) if (!listRowCount.has(row)) offRows.push(row);
  checks.that("np-stmt-every-gift-once", "Every gift is on exactly one statement", offRows.length === 0, rowList3(offRows));
  const donorTrouble = [...donors.keys()].filter((key) => stmtKeyCount.get(key) !== 1).concat([...stmtKeyCount.keys()].filter((key) => !donors.has(key)));
  checks.that(
    "np-stmt-own-donor",
    "Every gift is on the statement of its own donor, and every donor has exactly one statement",
    wrongDonorRows.length === 0 && donorTrouble.length === 0,
    [wrongDonorRows.length ? rowList3(wrongDonorRows) : "", donorTrouble.length ? `donor(s) ${[...new Set(donorTrouble)].sort().join(", ")}` : ""].filter(Boolean).join("; ")
  );
  checks.that("np-stmt-gifts-match", "Each gift on a statement shows the date, fund, amount, and value received that the gift list has for that row", changedRows.length === 0, rowList3(changedRows));
  checks.that("np-stmt-donor-details", "Each statement carries the name, address, and email recorded on that donor’s own latest gifts", badDetails.length === 0, badDetails.join("; "));
  checks.that("np-stmt-donor-totals", "Each statement’s total, gift count, and fund totals are that donor’s gifts in the list added up", badTotals.length === 0, badTotals.join("; "));
  checks.that("np-stmt-received", "Each statement’s value received in return is the sum of the values recorded on that donor’s gifts", badReceived.length === 0, badReceived.join("; "));
  checks.cents("np-stmt-received-total", "Value received in return on the statements adds up to the gift list overall", cents(listReceived), cents(stmtReceived));
  const fundNames = [.../* @__PURE__ */ new Set([...listFunds.keys(), ...stmtFunds.keys()])].sort();
  const badFunds = fundNames.filter((f) => (listFunds.get(f) ?? 0n) !== (stmtFunds.get(f) ?? 0n));
  checks.that("np-stmt-fund-totals", "Statements add up to the gift list for every fund", badFunds.length === 0, badFunds.join("; "));
  checks.cents("np-stmt-grand-total", "Statements add up to the gift list overall", cents(listTotal), cents(stmtTotal));
  checks.equal("np-stmt-gift-count", "Statements hold as many gifts as the gift list", gifts.length, stmtCount);
  const stmtFundCounts = /* @__PURE__ */ new Map();
  for (const s of set.statements) for (const f of s.byFund) stmtFundCounts.set(f.fund, (stmtFundCounts.get(f.fund) ?? 0) + f.count);
  const summaryNames = new Set(summaryFunds.map((f) => f.fund));
  const summaryOk = summaryGrand === stmtTotal && set.giftCount === stmtCount && summaryNames.size === summaryFunds.length && summaryNames.size === stmtFunds.size && summaryFunds.every((f) => stmtFunds.has(f.fund) && stmtFunds.get(f.fund) === f.total && stmtFundCounts.get(f.fund) === f.count);
  checks.that("np-stmt-summary", "Summary totals equal the statements", summaryOk);
  if (typedDeposits) {
    const lines = /* @__PURE__ */ new Map();
    for (const g of gifts) {
      const key = npNormalizeText(g.fund);
      const line = lines.get(key) ?? { name: g.fund, gifts: 0n, deposits: 0n };
      line.gifts += Number.isSafeInteger(g.amount) ? BigInt(g.amount) : 0n;
      lines.set(key, line);
    }
    for (const { name, amount } of typedDeposits) {
      const key = npNormalizeText(name);
      const line = lines.get(key) ?? { name: name.trim(), gifts: 0n, deposits: 0n };
      line.deposits += amount;
      lines.set(key, line);
    }
    const off = [...lines.values()].filter((l) => l.gifts !== l.deposits);
    checks.that("np-stmt-deposits", "Gift list ties to the typed deposits for every fund", off.length === 0, off.map((l) => `${l.name}: gifts ${formatUSD(cents(l.gifts))}, deposits ${formatUSD(cents(l.deposits))}`).join("; "));
  }
  const nonPositive = gifts.filter((g) => !(g.amount > 0)).map((g) => g.rowNumber);
  checks.that("np-stmt-nonpositive", "No gift is zero or negative", nonPositive.length === 0, rowList3(nonPositive), "warning");
  const years = [...new Set(gifts.map((g) => g.date.slice(0, 4)))].sort();
  checks.that("np-stmt-one-year", "All gifts are dated in one calendar year", years.length <= 1, years.join(", "), "warning");
  return checks.all;
}

// packages/core/src/nonprofit/statements.ts
function npCompareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function npBuildStatements(gifts) {
  if (gifts.length === 0) throw new Error("There are no gifts in the list.");
  for (const g of gifts) {
    if (g.donorKey === "") throw new Error(`Gift on row ${g.rowNumber} has no donor.`);
  }
  const fundTotalsOf = (list) => {
    const byFund = /* @__PURE__ */ new Map();
    for (const g of list) byFund.set(g.fund, [...byFund.get(g.fund) ?? [], g]);
    return [...byFund.entries()].map(([fund, mine]) => ({ fund, count: mine.length, total: sum(mine.map((g) => g.amount)) })).sort((a, b) => npCompareText(a.fund, b.fund));
  };
  const byDonor = /* @__PURE__ */ new Map();
  for (const g of gifts) byDonor.set(g.donorKey, [...byDonor.get(g.donorKey) ?? [], g]);
  const statements = [...byDonor.entries()].map(([donorKey, mine]) => {
    const ordered = [...mine].sort((a, b) => npCompareText(a.date, b.date) || a.rowNumber - b.rowNumber);
    const last = ordered[ordered.length - 1];
    const latest = (pick) => {
      for (let i = ordered.length - 1; i >= 0; i--) {
        const value = pick(ordered[i]);
        if (value !== "") return value;
      }
      return "";
    };
    const received = [];
    for (const g of ordered) if (g.receivedValue !== null) received.push(g.receivedValue);
    return {
      donorKey,
      donorName: last.donorName,
      address: latest((g) => g.address),
      email: latest((g) => g.email),
      gifts: ordered,
      byFund: fundTotalsOf(ordered),
      count: ordered.length,
      total: sum(ordered.map((g) => g.amount)),
      receivedValueTotal: sum(received)
    };
  });
  statements.sort((a, b) => npCompareText(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || npCompareText(a.donorKey, b.donorKey));
  return { statements, fundTotals: fundTotalsOf(gifts), giftCount: gifts.length, grandTotal: sum(gifts.map((g) => g.amount)) };
}
function npYearEndStatements(input) {
  const set = npBuildStatements(input.gifts);
  return { ...set, checks: npVerifyStatements(input.gifts, set, input.depositsByFund) };
}
function npStatementTables(set) {
  return {
    donors: [
      ["Donor", "Address", "Gifts", "Total given", "Value received in return"],
      ...set.statements.map((s) => [s.donorName, s.address, s.count, toDecimal(s.total), toDecimal(s.receivedValueTotal)]),
      ["Total", "", set.giftCount, toDecimal(set.grandTotal), toDecimal(sum(set.statements.map((s) => s.receivedValueTotal)))]
    ],
    funds: [["Fund", "Gifts", "Total given"], ...set.fundTotals.map((f) => [f.fund, f.count, toDecimal(f.total)]), ["Total", set.giftCount, toDecimal(set.grandTotal)]],
    gifts: [
      ["Donor", "Gift date", "Fund", "Amount", "Received in return", "Value received in return", "File row"],
      ...set.statements.flatMap((s) => s.gifts.map((g) => [s.donorName, g.date, g.fund, toDecimal(g.amount), g.receivedDescription, g.receivedValue === null ? "" : toDecimal(g.receivedValue), g.rowNumber]))
    ]
  };
}

// packages/core/src/nonprofit/upgrades.ts
var NP_UP_GROUPS = ["upgraded", "same", "downgraded", "lastOnly", "thisOnly", "neither"];
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function npUpYearName(year, startMonth) {
  return startMonth === 1 ? String(year) : `FY${year}`;
}
function npUpYearSpan(year, startMonth) {
  if (startMonth === 1) return `January ${year} to December ${year}`;
  return `${MONTHS[startMonth - 1]} ${year - 1} to ${MONTHS[startMonth - 2]} ${year}`;
}
function npUpGroupLabel(group, year, startMonth = 1) {
  const now = npUpYearName(year, startMonth);
  const last = npUpYearName(year - 1, startMonth);
  switch (group) {
    case "upgraded":
      return `Gave more in ${now} than in ${last}`;
    case "same":
      return `Gave the same in ${last} and ${now}`;
    case "downgraded":
      return `Gave less in ${now} than in ${last}`;
    case "lastOnly":
      return `Gave in ${last}, not in ${now}`;
    case "thisOnly":
      return `Gave in ${now}, not in ${last}`;
    case "neither":
      return `No gift in ${last} or ${now}`;
  }
}
var compareText5 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function cleanYear3(year) {
  if (!Number.isSafeInteger(year) || year < 1901 || year > 2100) throw new Error("Type the year the report is for, as four digits.");
  return year;
}
function cleanStartMonth(startMonth) {
  if (!Number.isSafeInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error("Choose the month the year starts in.");
  return startMonth;
}
function npUpYearOf(date, startMonth) {
  const calendar = Number(date.slice(0, 4));
  return startMonth > 1 && Number(date.slice(5, 7)) >= startMonth ? calendar + 1 : calendar;
}
function npUpLatestYear(gifts, startMonth) {
  let latest = "";
  for (const g of gifts) if (/^\d{4}-\d{2}-\d{2}$/.test(g.date) && g.date > latest) latest = g.date;
  return latest === "" ? null : npUpYearOf(latest, startMonth);
}
function groupOf2(inLast, inThis, change) {
  if (inLast && inThis) return change > 0 ? "upgraded" : change < 0 ? "downgraded" : "same";
  if (inLast) return "lastOnly";
  return inThis ? "thisOnly" : "neither";
}
function npBuildUpgrades(gifts, year, startMonth = 1) {
  const y = cleanYear3(year);
  const start = cleanStartMonth(startMonth);
  if (gifts.length === 0) throw new Error("There are no gifts in the list.");
  const byDonor = /* @__PURE__ */ new Map();
  for (const g of gifts) {
    if (g.donorKey === "") throw new Error(`Gift on row ${g.rowNumber} has no donor.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) throw new Error(`Gift on row ${g.rowNumber} has no usable date.`);
    const list = byDonor.get(g.donorKey);
    if (list) list.push(g);
    else byDonor.set(g.donorKey, [g]);
  }
  const donors = [...byDonor.entries()].map(([donorKey, mine]) => {
    const ordered = [...mine].sort((a, b) => compareText5(a.date, b.date) || a.rowNumber - b.rowNumber);
    const inYear = (n) => ordered.filter((g) => npUpYearOf(g.date, start) === n).map((g) => g.amount);
    const last = inYear(y - 1);
    const now = inYear(y);
    const lastYear = sum(last);
    const thisYear = sum(now);
    const change = thisYear - lastYear;
    let email = "";
    for (const g of ordered) if (g.email !== "") email = g.email;
    return { donorKey, donorName: ordered[ordered.length - 1].donorName, email, group: groupOf2(last.length > 0, now.length > 0, change), lastYear, thisYear, change };
  });
  const rank = new Map(NP_UP_GROUPS.map((g, i) => [g, i]));
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || Math.abs(b.change) - Math.abs(a.change) || compareText5(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText5(a.donorKey, b.donorKey));
  const groups = NP_UP_GROUPS.map((group) => {
    const mine = donors.filter((d) => d.group === group);
    return { group, donors: mine.length, lastYear: sum(mine.map((d) => d.lastYear)), thisYear: sum(mine.map((d) => d.thisYear)), change: sum(mine.map((d) => d.change)) };
  });
  const line = (g) => groups[rank.get(g)];
  const total = (pick) => sum(gifts.filter((g) => pick(npUpYearOf(g.date, start))).map((g) => g.amount));
  const lastYearTotal = total((n) => n === y - 1);
  const thisYearTotal = total((n) => n === y);
  return {
    year: y,
    startMonth: start,
    donors,
    groups,
    bridge: { start: lastYearTotal, raised: line("upgraded").change, lowered: line("downgraded").change, stopped: -line("lastOnly").lastYear, started: line("thisOnly").thisYear, end: thisYearTotal },
    giftCount: gifts.length,
    lastYearTotal,
    thisYearTotal,
    otherTotal: total((n) => n !== y && n !== y - 1),
    grandTotal: sum(gifts.map((g) => g.amount))
  };
}
function npVerifyUpgrades(gifts, set) {
  const checks = new CheckList();
  const { year, startMonth } = set;
  const periodOk = Number.isSafeInteger(year) && year >= 1901 && year <= 2100 && Number.isSafeInteger(startMonth) && startMonth >= 1 && startMonth <= 12;
  checks.that("np-up-period", "The report names a real year and start month", periodOk, `the report says year ${year}, starting in month ${startMonth}`);
  if (!periodOk) return checks.all;
  let notWhole = 0;
  const B = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const usd = (n) => formatUSD(Number(n));
  const nowName = npUpYearName(year, startMonth);
  const lastName = npUpYearName(year - 1, startMonth);
  const label = (g) => npUpGroupLabel(g, year, startMonth);
  const mm = String(startMonth).padStart(2, "0");
  const first = (y) => `${String(startMonth === 1 ? y : y - 1).padStart(4, "0")}-${mm}-01`;
  const lastStart = first(year - 1);
  const thisStart = first(year);
  const nextStart = first(year + 1);
  const finalMonth = startMonth === 1 ? `${String(year).padStart(4, "0")}-12-01` : `${String(year).padStart(4, "0")}-${String(startMonth - 1).padStart(2, "0")}-01`;
  const stretch = (date) => date >= thisStart && date < nextStart ? 0 : date >= lastStart && date < thisStart ? 1 : 2;
  const list = /* @__PURE__ */ new Map();
  const listRows = [0, 0, 0];
  const listTotals = [0n, 0n, 0n];
  const nonPositive = [];
  let laterRows = 0;
  let laterTotal = 0n;
  let latest = "";
  for (const g of gifts) {
    const a = B(g.amount);
    const s = stretch(g.date);
    let f = list.get(g.donorKey);
    if (!f) list.set(g.donorKey, f = { rows: [0, 0, 0], totals: [0n, 0n, 0n] });
    f.rows[s]++;
    f.totals[s] += a;
    listRows[s]++;
    listTotals[s] += a;
    if (g.amount <= 0) nonPositive.push(g.rowNumber);
    if (g.date >= nextStart) {
      laterRows++;
      laterTotal += a;
    }
    if (g.date > latest) latest = g.date;
  }
  const shown = /* @__PURE__ */ new Map();
  for (const d of set.donors) shown.set(d, [B(d.lastYear), B(d.thisYear), B(d.change)]);
  const lines = set.groups.map((l) => [B(l.lastYear), B(l.thisYear), B(l.change)]);
  const br = set.bridge;
  const steps = [B(br.start), B(br.raised), B(br.lowered), B(br.stopped), B(br.started), B(br.end)];
  const setLast = B(set.lastYearTotal);
  const setThis = B(set.thisYearTotal);
  const setOther = B(set.otherTotal);
  const setGrand = B(set.grandTotal);
  checks.that("np-up-whole-cents", "Every amount is a whole number of cents", notWhole === 0, `${notWhole} amount(s) are not whole cents`);
  const seen = /* @__PURE__ */ new Map();
  for (const d of set.donors) seen.set(d.donorKey, (seen.get(d.donorKey) ?? 0) + 1);
  const missing = [...list.keys()].filter((k) => !seen.has(k)).length;
  const twice = [...seen.values()].filter((n) => n > 1).length;
  const unknown = [...seen.keys()].filter((k) => !list.has(k)).length;
  checks.that(
    "np-up-every-donor",
    "Every donor in the gift list is in exactly one group, and no other donor is",
    missing === 0 && twice === 0 && unknown === 0,
    `${missing} donor(s) in the list are in no group, ${twice} are in more than one, and ${unknown} on the report are not in the list`
  );
  const want = (f) => {
    if (f.rows[0] > 0 && f.rows[1] > 0) return f.totals[0] > f.totals[1] ? "upgraded" : f.totals[0] < f.totals[1] ? "downgraded" : "same";
    if (f.rows[1] > 0) return "lastOnly";
    return f.rows[0] > 0 ? "thisOnly" : "neither";
  };
  const groupProblems = [];
  const amountProblems = [];
  for (const d of set.donors) {
    const f = list.get(d.donorKey);
    if (!f) continue;
    const w = want(f);
    if (d.group !== w) groupProblems.push(`${d.donorName}: listed under "${label(d.group)}", their gifts give "${label(w)}"`);
    const [l, t, c] = shown.get(d);
    if (l !== f.totals[1] || t !== f.totals[0]) amountProblems.push(`${d.donorName}: shown ${usd(l)} in ${lastName} and ${usd(t)} in ${nowName}, the list adds up to ${usd(f.totals[1])} and ${usd(f.totals[0])}`);
    else if (c !== t - l) amountProblems.push(`${d.donorName}: the change is shown as ${usd(c)}, the two years differ by ${usd(t - l)}`);
  }
  checks.that("np-up-groups", "Every donor is in the group their own gifts give", groupProblems.length === 0, groupProblems.slice(0, 6).join("; "));
  checks.that("np-up-donor-amounts", "Each donor's two amounts equal that donor's rows in the gift list added up again, and the change is their difference", amountProblems.length === 0, amountProblems.slice(0, 6).join("; "));
  const lineProblems = [];
  if (set.groups.length !== NP_UP_GROUPS.length || set.groups.some((l, i) => l.group !== NP_UP_GROUPS[i])) lineProblems.push("the report does not have one line per group");
  set.groups.forEach((l, n) => {
    const mine = set.donors.filter((d) => d.group === l.group);
    const added = [0n, 0n, 0n];
    for (const d of mine) shown.get(d).forEach((v, i) => added[i] += v);
    const got = lines[n];
    if (l.donors !== mine.length || got[0] !== added[0] || got[1] !== added[1] || got[2] !== added[2]) lineProblems.push(`${label(l.group)}: the line shows ${l.donors} donor(s), its donors number ${mine.length}, or an amount differs from its donors added up`);
  });
  checks.that("np-up-group-lines", "Each group's donor count and amounts equal its own donors added up", lineProblems.length === 0, lineProblems.slice(0, 6).join("; "));
  const listGrand = listTotals[0] + listTotals[1] + listTotals[2];
  const yearProblems = [];
  if (setLast !== listTotals[1]) yearProblems.push(`${lastName}: the report shows ${usd(setLast)}, the list adds up to ${usd(listTotals[1])}`);
  if (setThis !== listTotals[0]) yearProblems.push(`${nowName}: the report shows ${usd(setThis)}, the list adds up to ${usd(listTotals[0])}`);
  if (setOther !== listTotals[2]) yearProblems.push(`other dates: the report shows ${usd(setOther)}, the list adds up to ${usd(listTotals[2])}`);
  if (setGrand !== listGrand || setLast + setThis + setOther !== listGrand) yearProblems.push(`the whole list adds up to ${usd(listGrand)}, the report shows ${usd(setGrand)} and its three totals add up to ${usd(setLast + setThis + setOther)}`);
  checks.add({
    id: "np-up-year-totals",
    label: "The totals for the two years and for other dates each equal the gifts in the list dated then, and add up to the whole list",
    passed: yearProblems.length === 0,
    severity: "error",
    expected: usd(listGrand),
    actual: usd(setGrand),
    ...yearProblems.length ? { detail: yearProblems.join("; ") } : {}
  });
  let raised = 0n;
  let lowered = 0n;
  let stopped = 0n;
  let started = 0n;
  let changes = 0n;
  for (const f of list.values()) {
    const inLast = f.rows[1] > 0;
    const inThis = f.rows[0] > 0;
    const diff = f.totals[0] - f.totals[1];
    changes += diff;
    if (inLast && inThis) {
      if (diff > 0n) raised += diff;
      else lowered += diff;
    } else if (inLast) stopped -= f.totals[1];
    else if (inThis) started += f.totals[0];
  }
  const bridgeOk = steps[0] === listTotals[1] && steps[1] === raised && steps[2] === lowered && steps[3] === stopped && steps[4] === started && steps[5] === listTotals[0] && steps[0] + steps[1] + steps[2] + steps[3] + steps[4] === steps[5];
  checks.add({
    id: "np-up-bridge",
    label: `${lastName} giving, plus and minus each group's change, equals ${nowName} giving`,
    passed: bridgeOk,
    severity: "error",
    expected: usd(listTotals[0]),
    actual: usd(steps[0] + steps[1] + steps[2] + steps[3] + steps[4]),
    ...bridgeOk ? {} : { detail: `from the list: ${usd(listTotals[1])} + ${usd(raised)} + ${usd(lowered)} + ${usd(stopped)} + ${usd(started)} = ${usd(listTotals[0])}; the report shows ${steps.map(usd).join(", ")}` }
  });
  let shownChanges = 0n;
  for (const v of shown.values()) shownChanges += v[2];
  const difference = listTotals[0] - listTotals[1];
  checks.add({
    id: "np-up-two-ways",
    label: `Every donor's change added up equals ${nowName} gifts minus ${lastName} gifts`,
    passed: shownChanges === difference && changes === difference,
    severity: "error",
    expected: usd(difference),
    actual: usd(shownChanges)
  });
  if (startMonth === 1) {
    let lyProblems = [];
    try {
      const ly = npDonorsByYear(gifts, year);
      const bad = failures(ly.checks);
      if (bad.length) lyProblems.push(`the LYBUNT report's own checks fail: ${bad.map((c) => c.label).join("; ")}`);
      const keys = (pick) => ly.donors.filter((d) => pick(d.group)).map((d) => d.donorKey).sort().join("\n");
      const mine = (pick) => set.donors.filter((d) => pick(d.group)).map((d) => d.donorKey).sort().join("\n");
      if (keys((g) => g === "both") !== mine((g) => g === "upgraded" || g === "same" || g === "downgraded")) lyProblems.push(`the donors compared are not the LYBUNT report's donors who gave in ${year - 1} and in ${year}`);
      if (keys((g) => g === "lapsed") !== mine((g) => g === "lastOnly")) lyProblems.push(`the donors with no gift in ${year} are not the LYBUNT report's donors who gave in ${year - 1}, not in ${year}`);
    } catch (err) {
      lyProblems = [`the LYBUNT report could not be built: ${err instanceof Error ? err.message : "unknown reason"}`];
    }
    checks.that("np-up-lybunt", "The LYBUNT report on the same list agrees about who gave in which year", lyProblems.length === 0, lyProblems.join("; "));
  }
  checks.that("np-up-last-year", `The list has gifts dated in ${lastName}`, listRows[1] > 0, `No gift is dated in ${lastName} (${npUpYearSpan(year - 1, startMonth)}), so no donor can be compared. Check the year typed and that the list covers both years.`, "warning");
  checks.that("np-up-this-year", `The list has gifts dated in ${nowName}`, listRows[0] > 0, `No gift is dated in ${nowName} (${npUpYearSpan(year, startMonth)}), so no donor can be compared. Check the year typed and that the list covers both years.`, "warning");
  checks.that(
    "np-up-part-year",
    `The list reaches the last month of ${nowName}`,
    latest >= finalMonth,
    `The latest gift in the list is dated ${latest}, before the last month of ${nowName} (${npUpYearSpan(year, startMonth)}). If the year is not finished or not all entered, a whole ${lastName} is being compared with part of ${nowName}, and a donor can show as giving less or as not giving only for that reason.`,
    "warning"
  );
  checks.that("np-up-later", `No gift is dated after ${nowName}`, laterRows === 0, `${laterRows} gift(s) totalling ${usd(laterTotal)} are dated after ${nowName}. They are left out of the comparison.`, "warning");
  checks.that("np-up-nonpositive", "No gift is zero or negative", nonPositive.length === 0, `${nonPositive.length} gift(s) are zero or negative. Each still counts as a gift in its year and is added in as written: row(s) ${nonPositive.slice(0, 20).join(", ")}`, "warning");
  return checks.all;
}
function npDonorUpgrades(gifts, year, startMonth = 1) {
  const set = npBuildUpgrades(gifts, year, startMonth);
  return { ...set, checks: npVerifyUpgrades(gifts, set) };
}
function npUpColumns(year, startMonth = 1) {
  return [`Given in ${npUpYearName(year - 1, startMonth)}`, `Given in ${npUpYearName(year, startMonth)}`];
}
function npUpgradeTables(set) {
  const [lastCol, nowCol] = npUpColumns(set.year, set.startMonth);
  const label = (g) => npUpGroupLabel(g, set.year, set.startMonth);
  const count = (g) => set.groups.find((l) => l.group === g)?.donors ?? 0;
  const lastName = npUpYearName(set.year - 1, set.startMonth);
  const nowName = npUpYearName(set.year, set.startMonth);
  return {
    groups: [
      ["Group", "Donors", lastCol, nowCol, "Change"],
      ...set.groups.map((l) => [label(l.group), l.donors, toDecimal(l.lastYear), toDecimal(l.thisYear), toDecimal(l.change)]),
      ["Total", set.donors.length, toDecimal(set.lastYearTotal), toDecimal(set.thisYearTotal), toDecimal(set.thisYearTotal - set.lastYearTotal)]
    ],
    bridge: [
      ["Step", "Donors", "Amount"],
      [`Given in ${lastName}`, "", toDecimal(set.bridge.start)],
      ["Added by donors who gave more", count("upgraded"), toDecimal(set.bridge.raised)],
      ["Taken off by donors who gave less", count("downgraded"), toDecimal(set.bridge.lowered)],
      [`${lastName} gifts from donors with no gift in ${nowName}`, count("lastOnly"), toDecimal(set.bridge.stopped)],
      [`${nowName} gifts from donors with no gift in ${lastName}`, count("thisOnly"), toDecimal(set.bridge.started)],
      [`Given in ${nowName}`, "", toDecimal(set.bridge.end)]
    ],
    donors: [
      ["Group", "Donor", "Email", lastCol, nowCol, "Change"],
      ...set.donors.map((d) => [label(d.group), d.donorName, d.email, toDecimal(d.lastYear), toDecimal(d.thisYear), toDecimal(d.change)])
    ]
  };
}

// packages/agents/src/registry/nonprofits.ts
var GIFT_COLUMNS = { roles: NP_GIFT_ROLES, labels: NP_GIFT_ROLE_LABELS, required: NP_GIFT_REQUIRED, guess: (rows, atHeaderRow) => npGuessGiftColumns(rows, atHeaderRow) };
var GIFTS_SHEET = /^gifts$/i;
var YEAR_MIN = 1901;
var YEAR_MAX = 2100;
var YEAR_RANGE = `from ${YEAR_MIN} to ${YEAR_MAX}`;
function reportYear(given, x, latest, task) {
  let year = given;
  if (year === void 0) {
    const found = latest();
    if (found === null) {
      if (x.problems.length > 0) {
        const shown = x.problems.slice(0, 8).map((p) => `row ${p.rowNumber}: ${p.reason}`).join("; ");
        const more = x.problems.length > 8 ? `; and ${x.problems.length - 8} more` : "";
        throw new AgentInputError(`No gift in the list could be read, so there is no year ${task}. ${x.problems.length} row(s) could not be read: ${shown}${more}.`);
      }
      throw new AgentInputError(`The gift list has no gift with a date that could be read, so there is no year ${task}.`);
    }
    year = found;
  }
  if (year < YEAR_MIN || year > YEAR_MAX) throw new AgentInputError(`The year must be ${YEAR_RANGE}; ${year} was ${given === void 0 ? "the latest year in the gift list" : "given"}.`);
  return year;
}
var donorRetention = {
  name: "donor_retention_rate",
  page: "nonprofits/donor-retention-rate",
  section: "nonprofits",
  kind: "tool",
  title: "Donor retention rate from a gift list",
  description: "Works out a nonprofit's donor retention for a year from its gift list (.csv or .xlsx, one row per gift): of last year's donors, how many gave again this year, split into first-year and repeat donors, plus dollar retention, each as an exact fraction with its counts. Every donor is placed in exactly one group, and retained plus lapsed is checked to equal last year's donors. Use it when someone asks for retention, renewal or lapse rates from their own gift records. Not for benchmarking against other charities, and not for a list without gift dates.",
  question: "What was our donor retention rate this year? Here is our gift list from our donor database.",
  inputs: [
    { name: "giftList", kind: "file", label: "Gift list", description: "A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and amount are needed; a donor id keeps two spellings of one name together. It should cover this year and last year, and earlier years tell first-year donors from repeat donors.", required: true },
    { name: "year", kind: "year", label: "Year", description: `The year the rates are for, four digits ${YEAR_RANGE}; last year is the year before it. Without it, the latest year with a gift in the list.`, required: false },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven counts donors by the dates of the gifts in the list and adds up what each gave; it does not compare a rate with any outside figure or say what to do about any donor.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "giftList"), GIFTS_SHEET);
    const x = npExtractGifts(file.rows, mapColumns(file, GIFT_COLUMNS, values.columns, "Gift list"));
    const year = reportYear(values.year, x, () => npLatestGiftYear(x.gifts), "to work out");
    const r = npDonorRetention(x.gifts, year);
    const t = npRetentionTables(r);
    return {
      summary: `${r.lastYearDonors} donor(s) gave in ${r.year - 1}: ${r.kept} retained (gave again in ${r.year}) and ${r.lapsed} lapsed; ${r.firstYear} first-year and ${r.repeat} repeat. ${r.donors.length} donor(s) in the list in all.`,
      tables: [
        { name: "Rates", rows: t.rates },
        { name: "Groups", rows: t.groups },
        { name: "Donors", rows: t.donors }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: 17 gifts from 9 donors, 2023 to 2026, year 2026",
      args: { giftList: "fixture:nonprofit/retention-gifts.csv", year: "2026" },
      verified: true,
      contains: ["3 / 6", "50.0%", "1 / 3", "33.3%", "66.7%", "$379.50 / $1,075.00", "35.3%"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor ID,Donor Name,Gift Date,Amount\n1,Ann Lee,2025-03-01,50.00\n1,Ann Lee,2026-03-01,5O.00\n", year: "2026" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readGiftList(args, preferGifts) {
  const opened = oneFile(args.files, "giftList");
  const file = preferGifts ? preferSheet(opened, GIFTS_SHEET) : opened;
  return npExtractGifts(file.rows, mapColumns(file, GIFT_COLUMNS, args.values.columns, "Gift list"));
}
function giftListInput(description) {
  return { name: "giftList", kind: "file", label: "Gift list", description, required: true };
}
var GIFT_LIST_BASICS = "A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed; a donor id (an envelope number works) keeps two spellings of one name together.";
function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function checklistColumns(text, headers) {
  let parts;
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new AgentInputError('"checklist" starts with "[" but is not a list of column names.');
    }
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string")) throw new AgentInputError('"checklist" must be a list of column names.');
    parts = parsed.map((p) => p.trim()).filter((p) => p !== "");
  } else {
    parts = trimmed.split(/[,;\n]/).map((p) => p.trim()).filter((p) => p !== "");
  }
  if (parts.length === 0) throw new AgentInputError("Name at least one column of the gift list for the checklist.");
  const names = [...new Set(headers)];
  const out = [];
  for (const part of parts) {
    const want = sheetNormalizeHeader(part);
    const hit = names.find((h) => h === part) ?? names.find((h) => h.toLowerCase() === part.toLowerCase()) ?? (want === "" ? void 0 : names.find((h) => sheetNormalizeHeader(h) === want));
    if (hit === void 0) throw new AgentInputError(`The gift list has no column "${part}" for the checklist. Its columns are: ${names.join(", ")}.`);
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}
var acknowledgmentChecklist = {
  name: "gift_acknowledgment_checklist",
  page: "nonprofits/acknowledgment-checklist",
  section: "nonprofits",
  kind: "tool",
  title: "Gift acknowledgment checklist: gift records with blank fields",
  description: "Lists the gifts at or above an amount the organization sets whose record has a blank in any column it names from its own gift list (.csv or .xlsx, one row per gift): a thank-you sent date, a mailing address, a letter date, or any column it added itself. Gifts at or above plus gifts below are checked to equal all gifts by count and by amount, complete plus incomplete to equal the gifts at or above, and blanks counted gift by gift to equal blanks counted column by column. Use it when someone wants to know which gifts have no thank-you or acknowledgment date recorded, or which gift records over an amount are missing an address or another detail. Not for deciding which gifts need an acknowledgment or what one has to say (the amount and the columns are the organization's own choice), and not for writing the letters.",
  question: "Which gifts of $250 or more in our gift list have no thank-you date or no mailing address filled in?",
  inputs: [
    giftListInput(`${GIFT_LIST_BASICS} Every other column of the file can be named in the checklist.`),
    { name: "amountFrom", kind: "amount", label: "Gift amount to check from", description: `Gifts of this amount or more are checked, for example "250.00". It is the organization's own choice; nothing is filled in for it.`, required: true },
    {
      name: "checklist",
      kind: "text",
      label: "Columns that must not be blank",
      description: 'The columns of the gift list that must be filled in for those gifts, by their header text in the file, separated by commas, for example "Thank-you Sent, Mailing Address"; a header with a comma in it is named in a JSON list, for example ["Letter sent, date", "Mailing Address"]. Any column can be named, including ones the organization added. A cell that is empty or holds only spaces counts as blank.',
      required: true
    },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven compares the gift list with the amount and the checklist columns given; it does not say what an acknowledgment has to contain or which gifts need one.",
  run(args) {
    const x = readGiftList(args, true);
    const required = checklistColumns(String(args.values.checklist ?? ""), x.headers);
    const r = npCheckAcknowledgments({ gifts: npAckGiftsFrom(x.gifts), thresholdCents: args.values.amountFrom, required });
    const t = npAckTables(r);
    const byColumn = r.byElement.map((e) => `${e.element} ${e.missing}`).join(", ");
    const listed = r.incomplete.length === 0 ? `None of them has a blank in ${listWords(r.required)}.` : `${r.incomplete.length} ${r.incomplete.length === 1 ? "has" : "have"} a blank checklist column and ${r.incomplete.length === 1 ? "is" : "are"} listed under Blank elements, ${formatUSD(sum(r.incomplete.map((g) => g.amount)))} in all. Blanks by column: ${byColumn}.`;
    return {
      summary: `${r.atOrAbove} gift(s) are at or above ${formatUSD(r.thresholdCents)} (total ${formatUSD(r.atOrAboveTotal)}) and ${r.below} below it (total ${formatUSD(r.belowTotal)}): ${r.atOrAbove + r.below} gift(s), ${formatUSD(r.atOrAboveTotal + r.belowTotal)} in all. ${r.complete} of the ${r.atOrAbove} at or above have every checklist column filled. ${listed}`,
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Blank elements", rows: t.incomplete },
        { name: "By element", rows: t.elements }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: seven gifts, $250.00 and up, Thank-you Sent and Mailing Address",
      args: { giftList: "fixture:nonprofit/gift-list.csv", amountFrom: "250.00", checklist: "Thank-you Sent, Mailing Address" },
      verified: true,
      contains: ["4 gift(s) are at or above $250.00 (total $2,050.00)", "3 below it (total $300.75)", "$2,350.75", "Blanks by column: Thank-you Sent 1, Mailing Address 0", "| 7 | Casey Marchetti | 2026-09-01 | 1000.00 | Thank-you Sent |"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor Name,Gift Date,Amount,Thank-you Sent\nAnn Lee,2026-01-05,300.00,2026-01-09\nBo Park,2026-02-05,3OO.00,\n", amountFrom: "250", checklist: "Thank-you Sent" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function groupIds(g) {
  return g.ids.join(", ");
}
function confirmedMerges(text, groups) {
  if (text === void 0 || text.trim() === "") return [];
  const proposed = groups.length === 0 ? "none were proposed" : groups.map((g, i) => `${i + 1}) ${groupIds(g)}`).join("; ");
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of text.split(/[;\n]/)) {
    const ids = part.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter((s) => s !== "");
    if (ids.length === 0) continue;
    const group = groups.find((g) => new Set(ids).size === ids.length && ids.length === g.ids.length && ids.every((id) => g.ids.includes(id)));
    if (!group) {
      throw new AgentInputError(`"${part.trim()}" is not one of the proposed groups. A merge names every record of one proposed group, the record to keep first, and groups are separated by semicolons. The proposed groups are: ${proposed}.`);
    }
    if (used.has(group)) throw new AgentInputError(`The group ${groupIds(group)} is named twice in "merge".`);
    used.add(group);
    out.push({ keepId: ids[0], mergeIds: group.ids.filter((id) => id !== ids[0]) });
  }
  return out;
}
var donorDeduplication = {
  name: "donor_deduplication",
  page: "nonprofits/donor-duplicates",
  section: "nonprofits",
  kind: "tool",
  title: "Donor de-duplication: find duplicate donor records, merge with proof",
  description: "Finds donor records in a gift list (.csv or .xlsx, one row per gift, with donor name, email and mailing address columns) that look like the same person: the same name, email and address once case, punctuation and spacing are ignored, or the same email, the same address or the same name with the rest different. Each group is listed with the reason it was proposed; only the groups named as confirmed are merged, into the record named first. After merging, the gift count and total are checked to be unchanged, every gift to belong to exactly one donor record, and each kept record to hold exactly its own gifts and those merged into it. Use it when someone wants to clean up duplicate donors, merge two spellings of one donor, or check a donor list for doubles before statements or a mailing. Not for deciding who is the same person (nothing is merged unless its group is named), and abbreviations such as Street and St are not matched.",
  question: "Can you find the duplicate donors in our gift list and merge them without losing any gifts?",
  inputs: [
    giftListInput("A .csv or .xlsx file (a path, or the CSV text) with one row per gift: donor name, gift date and gift amount are needed, and email and mailing address columns let near matches be found. Each distinct donor id, name, email and address, exactly as written, becomes one donor record, numbered D1, D2 and so on."),
    {
      name: "merge",
      kind: "text",
      label: "Groups to merge",
      description: 'Optional. The proposed groups the person confirmed, by their record numbers, the record to keep first, groups separated by semicolons: "D1, D2; D3, D4". Each must be a whole proposed group. Without it nothing is merged and the proposed groups are listed.',
      required: false
    },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven merges nothing until a group is confirmed; the record named first is kept and the others in the group are folded into it. It does not decide who is the same donor.",
  run(args) {
    const x = readGiftList(args, true);
    const set = npDonorRecordsFrom(x.gifts);
    const groups = npProposeMergeGroups(set.donors);
    const confirmed = confirmedMerges(args.values.merge, groups);
    const r = npMergeDonors({ donors: set.donors, gifts: set.gifts, confirmed });
    const t = npMergeTables(r);
    const byId = new Map(set.donors.map((d) => [d.id, d]));
    const fate = /* @__PURE__ */ new Map();
    for (const m of confirmed) {
      fate.set(m.keepId, "Kept");
      for (const id of m.mergeIds) fate.set(id, `Merged into ${m.keepId}`);
    }
    const proposedRows = [["Group", "Match", "Donor record", "Name", "Email", "Address", "Why proposed", "In this run"]];
    groups.forEach((g, i) => {
      const why = [...new Set(g.links.map((l) => NP_MATCH_LABELS[l.kind]))].join("; ");
      for (const id of g.ids) {
        const d = byId.get(id);
        proposedRows.push([i + 1, g.kind === "exact" ? "Exact match after normalizing" : "Near match", id, d?.name ?? "", d?.email ?? "", d?.address ?? "", why, fate.get(id) ?? "Not merged"]);
      }
    });
    const total = formatUSD(sum(r.gifts.map((g) => g.amount)));
    const merged = confirmed.length === 0 ? "No group was named to merge, so nothing was merged." : `${confirmed.length} group(s) merged: ${set.donors.length} donor record(s) before, ${r.donors.length} after.`;
    return {
      summary: `${groups.length} group(s) of likely duplicate donor records proposed among ${set.donors.length} donor record(s). ${merged} ${r.gifts.length} gift(s) and ${total} before and after.`,
      tables: [
        { name: "Proposed groups", rows: proposedRows },
        { name: "Donors after merging", rows: t.donors },
        { name: "Gifts", rows: t.gifts }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: eight gifts, three groups proposed, the first two confirmed",
      args: { giftList: "fixture:nonprofit/donor-list-dupes.csv", merge: "D1, D2; D3, D4" },
      verified: true,
      contains: ["3 group(s) of likely duplicate donor records proposed among 7 donor record(s)", "7 donor record(s) before, 5 after", "8 gift(s) and $845.00 before and after", "| D1 | Dana Whitcombe | dana@example.org | 3 Oak Ct, Fairview | D2 | 3 | 150.00 |", "| D3 | Eli Fontaine | eli@example.org | 9 Pine Way, Fairview | D4 | 2 | 225.00 |"]
    },
    {
      label: "The same list with no group named: the three groups are proposed and nothing is merged",
      args: { giftList: "fixture:nonprofit/donor-list-dupes.csv" },
      verified: true,
      contains: ["No group was named to merge", "Same email, different name or address", "Same address, different name or email"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Name,Email,Date,Amount\nAnn Lee,ann@example.org,2026-01-05,50.00\nann lee,ann@example.org,2026-02-05,5O.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var donorUpgrades = {
  name: "donor_upgrades_downgrades",
  page: "nonprofits/donor-upgrades-downgrades",
  section: "nonprofits",
  kind: "tool",
  title: "Donor upgrades and downgrades: who gave more or less than last year",
  description: "Compares each donor's giving in two years from a gift list (.csv or .xlsx, one row per gift): who gave more, the same or less than the year before and by how much, and who gave in only one of the two years, with donor counts and dollars per group and a table carrying last year's total to this year's. Calendar or fiscal years; a fiscal year is named for the calendar year it ends in. Every donor is placed in exactly one group, worked out a second way from the gift dates, and every donor's change is checked to add up to this year's gifts minus last year's. Use it when someone asks which donors increased or decreased their giving, for donor upgrades and downgrades, or for a year-over-year giving comparison from their own records. Not for saying which donors to contact, and not for a list without gift dates.",
  question: "Which of our donors gave more this year than last year, and which gave less?",
  inputs: [
    giftListInput(`${GIFT_LIST_BASICS} It should cover both years compared.`),
    { name: "year", kind: "year", label: "Year", description: `The later of the two years, four digits ${YEAR_RANGE}; it is compared with the year before it. For a fiscal year, the calendar year it ends in. Without it, the latest year with a gift in the list.`, required: false },
    {
      name: "startMonth",
      kind: "choice",
      label: "Month the year starts in",
      description: "January for a calendar year (used when not given). For a fiscal year, its first month: with July, 2026 runs from July 2025 to June 2026.",
      required: false,
      choices: MONTH_NAMES
    },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven compares what the gifts in the list add up to in two years; it does not say what to do about any donor.",
  run(args) {
    const x = readGiftList(args, false);
    const startText = args.values.startMonth;
    const startMonth = startText === void 0 ? 1 : MONTH_NAMES.indexOf(startText) + 1;
    const year = reportYear(args.values.year, x, () => npUpLatestYear(x.gifts, startMonth), "to compare");
    const r = npDonorUpgrades(x.gifts, year, startMonth);
    const t = npUpgradeTables(r);
    const count = (g) => r.groups.find((l) => l.group === g)?.donors ?? 0;
    const now = npUpYearName(r.year, r.startMonth);
    const before = npUpYearName(r.year - 1, r.startMonth);
    const span = r.startMonth === 1 ? "" : ` (${now} is ${npUpYearSpan(r.year, r.startMonth)})`;
    return {
      summary: `Of the ${count("upgraded") + count("same") + count("downgraded")} donor(s) who gave in both years, ${count("upgraded")} gave more in ${now} than in ${before}, ${count("same")} gave the same, and ${count("downgraded")} gave less. All giving went from ${formatUSD(r.lastYearTotal)} to ${formatUSD(r.thisYearTotal)}${span}: ${formatUSD(r.bridge.raised)} added by donors who gave more, ${formatUSD(r.bridge.lowered)} from donors who gave less, ${formatUSD(r.bridge.stopped)} from donors with no gift in ${now}, and ${formatUSD(r.bridge.started)} from donors with no gift in ${before}.`,
      tables: [
        { name: "Groups", rows: t.groups },
        { name: "Year to year", rows: t.bridge },
        { name: "Donors", rows: t.donors }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: fourteen gifts from seven donors, 2022 to 2025, year 2025",
      args: { giftList: "fixture:nonprofit/upgrade-gifts.csv", year: "2025" },
      verified: true,
      contains: ["2 gave more in 2025 than in 2024, 1 gave the same, and 1 gave less", "from $1,005.50 to $835.75", "$150.25 added by donors who gave more", "-$300.00 from donors who gave less", "-$60.00 from donors with no gift in 2025", "$40.00 from donors with no gift in 2024"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor ID,Donor Name,Gift Date,Amount\n1,Ann Lee,2024-03-01,50.00\n1,Ann Lee,2025-03-01,5O.00\n", year: "2025" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function fileSlug(text) {
  return text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
var TEMPLATE_ROWS = {
  Gifts: () => "One per gift, under the header row",
  Funds: (o) => `${o.fundCount} numbered`,
  Log: () => "Organization and year filled in",
  Instructions: () => "What each column holds"
};
var giftLogTemplate = {
  name: "donation_gift_log_template",
  page: "nonprofits/gift-log-template",
  section: "nonprofits",
  kind: "template",
  title: "Gift log workbook for tracking donations (Excel template)",
  description: "Builds a blank Excel gift log for tracking donations at a nonprofit or church: a Gifts sheet with columns for donor id (an envelope number works), donor name, email, mailing address, gift date, gift amount, fund, anything received in return and its value, and notes; a Funds sheet with numbered rows; a Log sheet with the organization name and the year; and an instructions sheet saying what each column holds. The finished workbook is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked, the Gifts header row is matched the way the giving tools read it, and no cell holds a formula. Use it when someone wants a donation tracking spreadsheet, a gift log or a donor giving record to fill in through the year. Not for adding anything up (it holds values only, no formulas), and not for statements or receipts.",
  question: "Can you make me a spreadsheet for our church to log donations as they come in this year?",
  inputs: [
    { name: "organization", kind: "text", label: "Organization name", description: "Optional. The organization the log is kept for, up to 120 characters; it goes on the Log sheet and in the file name.", required: false },
    { name: "year", kind: "year", label: "Year", description: "Optional. The calendar year the log covers, four digits from 2000 to 2099; it goes on the Log sheet and in the file name.", required: false },
    { name: "fundCount", kind: "number", label: "Number of funds", description: `Optional. How many numbered rows the Funds sheet starts with, a whole number from 1 to ${NP_TEMPLATE_MAX_FUNDS}; 3 when not given. Rows can be added later.`, required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in, with values only and no formulas; it does not add anything up or say what a gift record has to hold.",
  run({ values }) {
    const countText = values.fundCount;
    if (countText !== void 0 && !/^\d+$/.test(countText)) throw new AgentInputError(`The number of funds must be a whole number from 1 to ${NP_TEMPLATE_MAX_FUNDS}.`);
    const options = {
      organization: values.organization ?? "",
      year: values.year === void 0 ? "" : String(values.year),
      fundCount: countText === void 0 ? 3 : Number(countText),
      siteUrl: SITE_URL
    };
    const sheets = npGiftLogTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = npVerifyGiftLogTemplate(options, bytes);
    const suggestedName = `${["gift-log", fileSlug(options.organization), options.year.trim()].filter(Boolean).join("-")}.xlsx`;
    const rows = [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), TEMPLATE_ROWS[s.name]?.(options) ?? String(s.rows.length - 1)])];
    const org = options.organization.trim();
    const kept = org || options.year ? ` The Log sheet carries ${listWords([org, options.year].filter(Boolean))}.` : "";
    return {
      summary: `A gift log workbook with ${sheets.length} sheets (${sheets.map((s) => s.name).join(", ")}): the Gifts sheet has its header row and nothing under it, and the Funds sheet has ${options.fundCount} blank row(s) numbered 1 to ${options.fundCount}.${kept} It holds values only, with no formulas. File name: ${suggestedName}.`,
      tables: [{ name: "Sheets", rows }],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Fairview Community Pantry, 2026, three funds",
      args: { organization: "Fairview Community Pantry", year: "2026", fundCount: "3" },
      verified: true,
      contains: ["gift-log-fairview-community-pantry-2026.xlsx", "Fairview Community Pantry and 2026", "Donor ID, Donor name, Email, Mailing address, Gift date, Gift amount, Fund, Received in return, Value received, Notes", "| Funds | Line, Fund, Notes | 3 numbered |"]
    }
  ]
};
var givingByFund = {
  name: "giving_by_fund_and_month",
  page: "nonprofits/giving-by-fund",
  section: "nonprofits",
  kind: "tool",
  title: "Giving by fund and month from a gift list",
  description: "Totals a gift list (.csv or .xlsx, one row per gift) by fund and calendar month: one row per fund, one column per month from the first gift to the last (a month with no gifts shows zeros), with a total for every fund and every month. Every cell is added up again straight from the list by a separate routine, the fund totals and the month totals are both checked to equal the list, and every gift is checked to fall in exactly one cell. A gift with no fund goes in a row named (no fund); fund names are used exactly as written. Use it when someone needs giving by fund or designation per month, fund totals for a board or finance committee report, or monthly gift figures to set beside bank deposits. Not for deciding which fund a gift belongs to, and not for totals per donor.",
  question: "How much came in to each of our funds each month this year? Here is our gift list.",
  inputs: [giftListInput(`${GIFT_LIST_BASICS} The fund column sets the rows; without one every gift goes in one row.`), columnsInput("Gift list", GIFT_COLUMNS)],
  limits: "site",
  notAdvice: "Mathproven arranges and adds up the gifts in the list by the fund and the gift date written on each row; it does not decide which fund a gift belongs to.",
  run(args) {
    const opened = oneFile(args.files, "giftList");
    const mapping = mapColumns(opened, GIFT_COLUMNS, args.values.columns, "Gift list");
    const x = npExtractGifts(opened.rows, mapping);
    const r = npGivingByFund(x.gifts);
    const t = npFundMonthTables(r, x.gifts);
    const funds = r.rows.map((row) => `${row.fund} ${formatUSD(row.total)}`).join(", ");
    const noFund = mapping.columns.fund < 0 ? " No fund column was found or named, so every gift is in one row named (no fund)." : "";
    return {
      summary: `${r.giftCount} gift(s) in ${r.rows.length} fund(s) over ${r.months.length} month(s), ${r.months[0]} to ${r.months[r.months.length - 1]}: ${funds}; ${formatUSD(r.grandTotal)} in all, the same across the funds, down the months and in the gift list.${noFund}`,
      tables: [
        { name: "By fund and month", rows: t.table },
        { name: "Gifts", rows: t.gifts }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: seven gifts to three funds during 2026",
      args: { giftList: "fixture:nonprofit/gift-list.csv" },
      verified: true,
      contains: ["7 gift(s) in 3 fund(s) over 12 month(s), 2026-01 to 2026-12", "Building $800.00, General $1,350.00, Missions $200.75", "$2,350.75 in all", "total line"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor Name,Gift Date,Amount,Fund\nAnn Lee,2026-01-05,50.00,General\nBo Park,2026-02-05,5O.00,General\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var lybuntReport = {
  name: "lybunt_sybunt_report",
  page: "nonprofits/lybunt-report",
  section: "nonprofits",
  kind: "tool",
  title: "LYBUNT and SYBUNT report: donors who gave last year, not this year",
  description: "Groups every donor in a gift list (.csv or .xlsx, one row per gift, covering more than one year) by the calendar years they gave in: gave last year but not this year (LYBUNT), gave only in earlier years (SYBUNT), gave in both years, came back after a year without a gift, or first gave this year, with what each gave this year, last year and earlier, and the date of their latest gift. Every donor is in exactly one group, worked out a second time from the gift dates, and the totals for this year, last year and earlier add back up to the list. Use it when someone asks which donors lapsed, who gave last year and has not given yet this year, or for a LYBUNT or SYBUNT list from their own gift records. Not for saying which donors to contact, and not for fiscal years.",
  question: "Which of our donors gave last year but have not given yet this year?",
  inputs: [
    giftListInput(`${GIFT_LIST_BASICS} It should cover at least this year and last year.`),
    { name: "year", kind: "year", label: "Year", description: `The year the report is for, four digits ${YEAR_RANGE}; last year is the year before it and anything before that is earlier. Without it, the latest year with a gift in the list.`, required: false },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven lists donors by the dates of the gifts in the list and adds up what each gave; it does not say what to do about any donor.",
  run(args) {
    const x = readGiftList(args, false);
    const year = reportYear(args.values.year, x, () => npLatestGiftYear(x.gifts), "to report on");
    const r = npDonorsByYear(x.gifts, year);
    const t = npYearGroupTables(r);
    const line = (g) => r.groups.find((l) => l.group === g);
    const lapsed = line("lapsed");
    const earlier = line("earlier");
    const later = r.laterTotal !== 0 ? `, ${formatUSD(r.laterTotal)} after ${r.year}` : "";
    return {
      summary: `${r.donors.length} donor(s) and ${r.giftCount} gift(s), grouped for ${r.year}. ${lapsed.donors} donor(s) gave in ${r.year - 1} and not in ${r.year} (LYBUNT), ${formatUSD(lapsed.lastYear)} given in ${r.year - 1}; ${earlier.donors} gave only before ${r.year - 1} (SYBUNT), ${formatUSD(earlier.earlier)} given then. Over all donors: ${formatUSD(r.thisYearTotal)} given in ${r.year}, ${formatUSD(r.lastYearTotal)} in ${r.year - 1} and ${formatUSD(r.earlierTotal)} before ${r.year - 1}${later}, ${formatUSD(r.grandTotal)} in all. A donor gave in a year when the list has at least one gift from them dated in that year.`,
      tables: [
        { name: "Groups", rows: t.groups },
        { name: "Donors", rows: t.donors }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: ten gifts from six donors, 2023 to 2026, year 2026",
      args: { giftList: "fixture:nonprofit/gift-list-years.csv", year: "2026" },
      verified: true,
      contains: ["grouped for 2026", "2 donor(s) gave in 2025 and not in 2026 (LYBUNT), $440.00 given in 2025", "1 gave only before 2025 (SYBUNT)", "$385.50 given in 2026, $690.00 in 2025 and $1,325.25 before 2025", "$2,400.75 in all", "| Gave in 2025, not in 2026 | Finley Okonkwo | finley@example.org | 1 | 0.00 | 40.00 | 0.00 | 0.00 | 2025-12-31 |"]
    },
    {
      label: "The same list for 2025, a year before its latest: the year given is the one grouped",
      args: { giftList: "fixture:nonprofit/gift-list-years.csv", year: "2025" },
      verified: true,
      contains: ["grouped for 2025", "1 donor(s) gave in 2024 and not in 2025 (LYBUNT), $125.25 given in 2024", "1 gave only before 2024 (SYBUNT), $1,000.00 given then", "$690.00 given in 2025, $325.25 in 2024 and $1,000.00 before 2024, $385.50 after 2025, $2,400.75 in all"]
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor ID,Donor Name,Gift Date,Amount\n1,Ann Lee,2025-03-01,50.00\n1,Ann Lee,2026-03-01,5O.00\n", year: "2026" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function typedValues(text) {
  const out = /* @__PURE__ */ new Map();
  if (text === void 0 || text.trim() === "") return out;
  for (const part of text.split(/[;\n]|,(?=\s*(?:row\s*)?\d+\s*[=:])/i)) {
    if (part.trim() === "") continue;
    const m = /^\s*(?:row\s*)?(\d+)\s*[=:]\s*(.+?)\s*$/i.exec(part);
    if (!m) throw new AgentInputError(`"valuesReceived" is written as "<file row> = <amount>", separated by commas: "${part.trim()}".`);
    const row = Number(m[1]);
    if (out.has(row)) throw new AgentInputError(`"valuesReceived" gives row ${row} twice.`);
    let cents;
    try {
      cents = parseAmount(m[2]);
    } catch {
      throw new AgentInputError(`Each value received is an amount, such as 40 or 40.00, with no more than two decimal places. The value for row ${row}, "${m[2]}", could not be read.`);
    }
    out.set(row, cents);
  }
  return out;
}
var partGiftSplit = {
  name: "quid_pro_quo_payment_split",
  page: "nonprofits/part-gift-splitter",
  section: "nonprofits",
  kind: "tool",
  title: "Part-gift (quid pro quo) payments split by the value received",
  description: "Splits each payment in a gift list (.csv or .xlsx, one row per payment) that was partly a gift, such as a benefit dinner ticket or an item bought at a charity auction, into the value the donor received and the part above it, using the organization's own good-faith values from the list's value column or given per row. Each payment of more than $75.00 with a value received of more than zero is flagged (the threshold in 26 U.S.C. § 6115(a); exactly $75.00 is not more). Value plus part above is checked to equal each payment, every row to be split exactly once, and the totals by donor and overall to tie to the list. Use it when someone needs quid pro quo contribution figures, gala or auction payments split into the value received and the part above it, or the payments over $75 with goods or services received. Not for estimating a value (none is guessed), and not for deciding what a donor may deduct, what the organization sends, or whether an exception applies.",
  question: "Our harvest dinner tickets and auction items are in this gift list with their values. Can you split each payment into the value received and the part above it?",
  inputs: [
    giftListInput(`${GIFT_LIST_BASICS} Columns for what the donor received in return and its value are read when the list has them.`),
    {
      name: "valuesReceived",
      kind: "text",
      label: "Values received, by file row",
      description: `Optional. The good-faith value of what the donor received, for payments whose value cell is blank (every payment when the list has no value column), written "<file row> = <amount>" and separated by commas, for example "5 = 30.00, 8 = 0". The row is the payment's row number in the file as a spreadsheet shows it. A value already in the list is used as it is, and a payment with no value given is split with nothing taken off.`,
      required: false
    },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven splits each payment by the value received that is entered and adds up the parts; it does not say what a donor may deduct, what the organization sends, or whether an exception in the law applies.",
  run(args) {
    const x = readGiftList(args, true);
    const typed = typedValues(args.values.valuesReceived);
    const problems = npPartGiftValueProblems({ gifts: x.gifts, typed });
    if (problems.length > 0) {
      const fromList = problems.some((p) => p.inList) ? " A value that comes from the gift list is changed in the list itself." : "";
      throw new Error(`${npPartGiftProblemText(problems)}${fromList}`);
    }
    const r = npSplitPartGifts({ gifts: x.gifts, typed });
    const t = npPartGiftTables(r);
    const over = formatUSD(NP_PART_GIFT_THRESHOLD.cents);
    const flagged = r.lines.find((l) => l.line === "flagged");
    const flaggedText = !flagged || flagged.payments === 0 ? "" : ` The flagged payments come to ${formatUSD(flagged.amount)} paid, ${formatUSD(flagged.value)} value received and ${formatUSD(flagged.partAbove)} above the value.`;
    return {
      summary: `${r.total.payments} payment(s) from ${r.donors.length} donor(s). ${r.total.flagged} payment(s) are more than ${over} with a value received entered.${flaggedText} ${formatUSD(r.total.amount)} paid = ${formatUSD(r.total.value)} value received + ${formatUSD(r.total.partAbove)} above the value. Nothing is rounded: the part above the value is the amount paid less the value received, in whole cents.`,
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Payments", rows: t.payments },
        { name: "By donor", rows: t.donors }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: Thistlemere Chapel's harvest dinner and auction, seven payments",
      args: { giftList: "fixture:nonprofit/gift-list-harvest.csv" },
      verified: true,
      contains: ["3 payment(s) are more than $75.00", "$610.00 paid, $350.00 value received and $260.00 above the value", "$995.00 paid = $400.00 value received + $595.00 above the value", "| Morgan Valtonen | 2 | 600.00 | 250.00 | 350.00 | 1 |"]
    },
    {
      label: "A payment row whose amount cannot be read is not verified",
      args: { giftList: "Donor,Gift date,Amount,Value received\nAnn Lee,2026-09-26,120.00,60.00\nBo Park,2026-09-26,9O.00,40.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function depositsByFund(text) {
  if (text === void 0) return void 0;
  const lines = text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return void 0;
  const out = {};
  for (const line of lines) {
    const m = /^(.+?)\s*[=:\t]\s*(.+)$/.exec(line);
    if (!m) throw new AgentInputError(`Deposits "${line}" is not written as Fund = amount.`);
    const fund = m[1];
    if (Object.prototype.hasOwnProperty.call(out, fund)) throw new AgentInputError(`Deposits lists the fund "${fund}" twice.`);
    try {
      out[fund] = parseAmount(m[2]);
    } catch {
      throw new AgentInputError(`The deposit for "${fund}", "${m[2]}", is not an amount in dollars and cents.`);
    }
  }
  return out;
}
var yearEndStatements = {
  name: "year_end_giving_statements",
  page: "nonprofits/year-end-giving-statements",
  section: "nonprofits",
  kind: "tool",
  title: "Year-end giving statements from a gift list",
  description: "Builds one year-end giving statement per donor from a nonprofit's or church's gift list (.csv or .xlsx, " +
    "one row per gift): each donor's gifts with date, fund and amount, totals by fund, the total given, and " +
    "the value of anything recorded as received in return. Gifts go together by donor id or envelope number " +
    "when the list has one, otherwise by name. Every gift is checked to be on exactly one statement, its " +
    "own donor's, each statement is added up again from that donor's rows, and the statements add back up " +
    "to the gift list fund by fund and overall. Deposits per fund from the bank or the books can be given " +
    "to tie each fund. Use it when someone needs annual contribution statements, year-end giving statements " +
    "or church giving statements from their own donation records. Not for writing the statement's wording " +
    "(the organization's own words go on it), and not for picking the year: give the gifts for the period " +
    "the statements cover; gifts dated in more than one year are flagged.",
  question: "Can you make our year-end giving statements for each donor from this gift list, with totals by fund?",
  inputs: [
    giftListInput(`${GIFT_LIST_BASICS} Email, mailing address and fund columns, and columns for what a donor received in return and its value, are read when the list has them. A workbook with a sheet named Gifts is read from that sheet.`),
    {
      name: "deposits",
      kind: "text",
      label: "Deposits per fund",
      description: 'Optional. Deposits per fund for the same period, from the bank or the books, to tie the gift list to: "<fund> = <amount>", one per line or separated by semicolons, for example "General = 1,350.00; Building = 800.00". Fund names are compared with case, punctuation and spacing ignored. A fund that differs is listed with both amounts and the result is not verified.',
      required: false
    },
    columnsInput("Gift list", GIFT_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven arranges and adds up the gifts in the list; it does not decide what a statement has to say, and the wording is the organization's own.",
  run(args) {
    const x = readGiftList(args, true);
    const r = npYearEndStatements({ gifts: x.gifts, depositsByFund: depositsByFund(args.values.deposits) });
    const t = npStatementTables(r);
    const byFundRows = [["Donor", "Donor id", "Fund", "Gifts", "Total given"], ...r.statements.flatMap((s) => s.byFund.map((f) => [s.donorName, s.gifts[s.gifts.length - 1]?.donorId ?? "", f.fund, f.count, toDecimal(f.total)]))];
    const received = sum(r.statements.map((s) => s.receivedValueTotal));
    const funds = r.fundTotals.map((f) => `${f.fund} ${formatUSD(f.total)}`).join(", ");
    const left = x.skipped.length ? ` ${x.skipped.length} row(s) with no gift date and no donor or amount (totals or notes) are not gifts and are left out.` : "";
    return {
      summary: `${r.statements.length} statement(s), one per donor, holding ${r.giftCount} gift(s) and ${formatUSD(r.grandTotal)}, the same as the gift list. By fund: ${funds}. Value recorded as received in return: ${formatUSD(received)} on the statements and in the list.${left}`,
      tables: [
        { name: "Donors", rows: t.donors },
        { name: "Funds", rows: t.funds },
        { name: "Statement totals by fund", rows: byFundRows },
        { name: "Gifts", rows: t.gifts }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: seven gifts from three donors across three funds, with the deposits typed",
      args: { giftList: "fixture:nonprofit/gift-list.csv", deposits: "Building = 800.00; General = 1,350.00; Missions = 200.75" },
      verified: true,
      contains: ["3 statement(s), one per donor, holding 7 gift(s) and $2,350.75", "Building $800.00, General $1,350.00, Missions $200.75", "$150.00 on the statements", "| Avery Lindqvist | 12 Elm St, Fairview | 3 | 875.25 | 0.00 |", "| Blake Oyelaran | 48 Mill Rd, Fairview | 2 | 400.00 | 105.00 |", "| Casey Marchetti | 7 Harbor Ln, Fairview | 2 | 1075.50 | 45.00 |", "| Avery Lindqvist | 1001 | Building | 1 | 500.00 |", "| Casey Marchetti | 1003 | General | 1 | 1000.00 |"]
    },
    {
      label: "Deposits that do not tie to the gift list are not verified",
      args: { giftList: "fixture:nonprofit/gift-list.csv", deposits: "Building = 800.00; General = 1,300.00; Missions = 200.75" },
      verified: false,
      failedCheck: "np-stmt-deposits"
    },
    {
      label: "A gift row whose amount cannot be read is not verified",
      args: { giftList: "Donor Name,Gift Date,Amount,Fund\nAnn Lee,2026-01-05,50.00,General\nBo Park,2026-02-05,5O.00,General\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var NONPROFITS = [donorRetention, yearEndStatements, acknowledgmentChecklist, donorDeduplication, donorUpgrades, giftLogTemplate, givingByFund, lybuntReport, partGiftSplit];
var NONPROFITS_NOT_FOR_AGENTS = [];

export {
  GIFT_COLUMNS,
  reportYear,
  checklistColumns,
  confirmedMerges,
  typedValues,
  depositsByFund,
  NONPROFITS,
  NONPROFITS_NOT_FOR_AGENTS
};
