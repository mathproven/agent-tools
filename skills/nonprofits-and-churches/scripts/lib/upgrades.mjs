// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AmountError,
  CheckList,
  decimalToCents,
  failures,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/core/src/statements/reconcile.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

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
var compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function cleanYear(year) {
  if (!Number.isSafeInteger(year) || year < 1901 || year > 2100) throw new Error("Type the year the report is for, as four digits.");
  return year;
}
function groupOf(inYear, inLast, before) {
  if (inYear) return inLast ? "both" : before ? "returned" : "new";
  if (inLast) return "lapsed";
  return before ? "earlier" : "later";
}
function npBuildYearGroups(gifts, year) {
  const y = cleanYear(year);
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
    const ordered = [...mine].sort((a, b) => compareText(a.date, b.date) || a.rowNumber - b.rowNumber);
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
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || compareText(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText(a.donorKey, b.donorKey));
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

// packages/core/src/nonprofit/upgrades.ts
var NP_UP_GROUPS = ["upgraded", "same", "downgraded", "lastOnly", "thisOnly", "neither"];
var MONTHS2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function npUpYearName(year, startMonth) {
  return startMonth === 1 ? String(year) : `FY${year}`;
}
function npUpYearSpan(year, startMonth) {
  if (startMonth === 1) return `January ${year} to December ${year}`;
  return `${MONTHS2[startMonth - 1]} ${year - 1} to ${MONTHS2[startMonth - 2]} ${year}`;
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
var compareText2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function cleanYear2(year) {
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
  const y = cleanYear2(year);
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
    const ordered = [...mine].sort((a, b) => compareText2(a.date, b.date) || a.rowNumber - b.rowNumber);
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
  donors.sort((a, b) => rank.get(a.group) - rank.get(b.group) || Math.abs(b.change) - Math.abs(a.change) || compareText2(npNormalizeText(a.donorName), npNormalizeText(b.donorName)) || compareText2(a.donorKey, b.donorKey));
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

export {
  sheetRowChecks,
  sheetNormalizeHeader,
  NP_GIFT_ROLES,
  NP_GIFT_ROLE_LABELS,
  NP_GIFT_REQUIRED,
  npNormalizeText,
  npNormalizeEmail,
  npGuessGiftColumns,
  npExtractGifts,
  npBigTotal,
  npBuildYearGroups,
  npDonorsByYear,
  npLatestGiftYear,
  npYearGroupTables,
  NP_UP_GROUPS,
  npUpYearName,
  npUpYearSpan,
  npUpGroupLabel,
  npUpYearOf,
  npUpLatestYear,
  npBuildUpgrades,
  npVerifyUpgrades,
  npDonorUpgrades,
  npUpColumns,
  npUpgradeTables
};
