// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  isIsoDate,
  pmCellToCents,
  pmCellToIsoDate,
  pmNormalizeHeader
} from "./reconcile.mjs";

// packages/core/src/bookkeeping/cells.ts
function bkCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(\s.*)?$/.exec(s);
  if (m) return pmCellToIsoDate(order === "dmy" ? `${m[2]}/${m[1]}/${m[3]}` : `${m[1]}/${m[2]}/${m[3]}`);
  return pmCellToIsoDate(s);
}
function bkFormatDate(iso, format) {
  if (!isIsoDate(iso)) throw new Error(`"${iso}" is not a valid date.`);
  const [y, m, d] = iso.split("-");
  return format === "iso" ? iso : format === "mdy" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}
function bkMoneyCell(raw, kind = "bank") {
  const s = (raw ?? "").trim();
  if (s === "" || /^[-–—]+$/.test(s)) return void 0;
  return pmCellToCents(s, { crIsNegative: kind === "card" });
}
var BK_STATEMENT_ROLES = ["date", "description", "amount", "debit", "credit", "balance"];
var BK_ROLE_LABELS = {
  date: "Date",
  description: "Description",
  amount: "Amount (one signed column)",
  debit: "Money out (debit or withdrawal column)",
  credit: "Money in (credit or deposit column)",
  balance: "Running balance"
};
var SYNONYMS = {
  date: ["date", "posting date", "posted date", "post date", "transaction date", "trans date", "effective date", "value date"],
  // 'running bal': Bank of America's checking export heads its balance column "Running Bal." (14 Nov 2026)
  balance: ["balance", "running balance", "running bal", "ledger balance", "closing balance", "available balance"],
  debit: ["debit", "debits", "debit amount", "withdrawal", "withdrawals", "withdrawal amount", "money out", "paid out", "charges"],
  credit: ["credit", "credits", "credit amount", "deposit", "deposits", "deposit amount", "money in", "paid in"],
  amount: ["amount", "transaction amount", "amt", "value"],
  description: ["description", "transaction description", "memo", "details", "narrative", "payee", "name", "particulars", "reference"]
};
var ORDER = ["date", "balance", "debit", "credit", "amount", "description"];
function matchHeaders(header) {
  const names = header.map(pmNormalizeHeader);
  const found = Object.fromEntries(ORDER.map((r) => [r, -1]));
  const taken = /* @__PURE__ */ new Set();
  for (const exact of [true, false]) {
    for (const role of ORDER) {
      if (found[role] >= 0) continue;
      search: for (const syn of SYNONYMS[role]) {
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
  if (found.debit >= 0 && found.credit >= 0) found.amount = -1;
  else if (found.amount >= 0) found.debit = found.credit = -1;
  return found;
}
var score = (columns) => Object.values(columns).filter((c) => c >= 0).length;
function bkGuessStatementColumns(rows, atHeaderRow) {
  let headerRow = atHeaderRow ?? Math.max(0, rows.findIndex((r) => r.some((c) => c.trim() !== "")));
  let columns = matchHeaders(rows[headerRow] ?? []);
  if (atHeaderRow === void 0) {
    rows.slice(0, 25).forEach((row, i) => {
      const candidate = matchHeaders(row);
      if (score(candidate) > score(columns)) {
        columns = candidate;
        headerRow = i;
      }
    });
  }
  return { headerRow, columns, dateOrder: "mdy", flipSigns: false };
}
function bkHeaderList(rows, headerRow) {
  const names = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return "the header row is empty";
  return `headers found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`;
}

export {
  bkCellToIsoDate,
  bkFormatDate,
  bkMoneyCell,
  BK_STATEMENT_ROLES,
  BK_ROLE_LABELS,
  bkGuessStatementColumns,
  bkHeaderList
};
