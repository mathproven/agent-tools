// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  parseCivilDate
} from "./calendarDays.mjs";
import {
  NP_GIFT_REQUIRED,
  NP_GIFT_ROLES,
  NP_GIFT_ROLE_LABELS,
  npBigTotal,
  npBuildYearGroups,
  npDonorUpgrades,
  npDonorsByYear,
  npExtractGifts,
  npGuessGiftColumns,
  npLatestGiftYear,
  npNormalizeEmail,
  npNormalizeText,
  npUpLatestYear,
  npUpYearName,
  npUpYearSpan,
  npUpgradeTables,
  npYearGroupTables,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./upgrades.mjs";
import {
  CheckList,
  assertCents,
  failures,
  formatUSD,
  parseAmount,
  passedAll,
  sum,
  toDecimal,
  warnings
} from "./money.mjs";

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
var compareText2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
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
    const ordered = [...mine].sort((a, b) => compareText2(a.date, b.date) || a.rowNumber - b.rowNumber);
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
  donors.sort((a, b) => compareText2(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText2(a.donorKey, b.donorKey));
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
var compareText3 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
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
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || compareText3(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText3(a.donorKey, b.donorKey));
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
  } catch (err2) {
    lyProblems = [`the LYBUNT report could not be built: ${err2 instanceof Error ? err2.message : "unknown reason"}`];
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
function preferSheet(file, prefer) {
  const sheet = file.sheets.find((s) => prefer.test(s.name) && s.rows.some((r) => r.some((cell) => cell.trim() !== "")));
  return sheet ? { ...file, rows: sheet.rows } : file;
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
  writeXlsx,
  readXlsx,
  AgentInputError,
  checkValue,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  GIFT_COLUMNS,
  reportYear,
  checklistColumns,
  confirmedMerges,
  typedValues,
  depositsByFund,
  NONPROFITS,
  NONPROFITS_NOT_FOR_AGENTS
};
