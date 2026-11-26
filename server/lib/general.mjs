// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  bkCellToIsoDate
} from "./cells.mjs";
import {
  AgentInputError,
  columnsInput,
  mapColumns,
  oneFile
} from "./sheets.mjs";
import {
  scaledFormat,
  scaledParseNumber,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetNormalizeHeader,
  sheetRowChecks
} from "./sheetInput.mjs";
import {
  pmCellToIsoDate
} from "./reconcile.mjs";
import {
  AmountError,
  CheckList,
  decimalToCents,
  formatUSD,
  parseAmount,
  sum,
  toDecimal
} from "./money.mjs";

// packages/agents/src/registry/general.ts
var MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
var MAX_ROWS = 1e5;
function addUp(values, what) {
  try {
    return sum(values);
  } catch (err) {
    if (err instanceof AmountError) throw new AgentInputError(`${what} add up to more than can be counted exactly to the cent.`);
    throw err;
  }
}
function addUpBig(values) {
  let t = 0n;
  for (let i = values.length - 1; i >= 0; i--) t += BigInt(values[i]);
  return t;
}
function bigCents(v, what) {
  if (v > MAX_SAFE || v < -MAX_SAFE) throw new AgentInputError(`${what} comes to more than can be counted exactly to the cent.`);
  return Number(v);
}
function prefixSums(values, what) {
  const out = [0];
  let acc = 0;
  for (const v of values) {
    acc = addUp([acc, v], what);
    out.push(acc);
  }
  return out;
}
function listOf(items, max = 12) {
  const shown = items.slice(0, max);
  return shown.join("; ") + (items.length > max ? `; and ${items.length - max} more` : "");
}
function columnLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function filled(cell) {
  return cell !== void 0 && cell.trim() !== "";
}
var DASHES = /^\$?\s*[-–—−]+\s*$/;
var NA = /^(n\/?a|n\.a\.|none|nil)$/i;
var STORED_NUMBER = /^[+-]?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
var EXPONENT = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;
function cellCents(raw) {
  const s = raw.trim().replace(/[−–—]/g, "-").replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  if (s === "") return null;
  try {
    return parseAmount(s);
  } catch {
  }
  const m = STORED_NUMBER.exec(s);
  if (!m || !m[1] && !m[2]) return null;
  const frac = m[2] ?? "";
  if (m[3] !== void 0) {
    const digits = `${m[1] ?? ""}${frac}`.replace(/^0+/, "").replace(/0+$/, "");
    if (digits.length < 15) return null;
  } else if (frac.length > 2 && frac.endsWith("0")) return null;
  try {
    const { cents, clean } = decimalToCents(s);
    return clean ? cents : null;
  } catch {
    return null;
  }
}
function readMoney(raw, dashIsZero) {
  const s = (raw ?? "").trim();
  if (s === "" || NA.test(s)) return void 0;
  if (DASHES.test(s)) return dashIsZero ? 0 : void 0;
  return cellCents(s);
}
function readPercent(raw) {
  const s = (raw ?? "").trim().replace(/[−–—]/g, "-");
  if (s === "" || NA.test(s) || DASHES.test(s)) return void 0;
  const m = /^(\()?\s*([+-]?[\d.,]+)\s*%\s*(\))?$/.exec(s);
  if (!m || Boolean(m[1]) !== Boolean(m[3])) return null;
  try {
    const v = scaledParseNumber(m[2], 2, "percent");
    return m[1] ? -v : v;
  } catch {
    return null;
  }
}
function cellKind(raw) {
  const s = (raw ?? "").trim();
  if (s === "") return "blank";
  if (NA.test(s)) return "na";
  if (DASHES.test(s) || cellCents(s) !== null) return "money";
  if (EXPONENT.test(s)) return "numberish";
  if (/\d/.test(s) && /%\s*\)?$/.test(s)) return "percent";
  try {
    pmCellToIsoDate(s);
    return "date";
  } catch {
  }
  const bare = s.replace(/\b(US|C|CA|A|AU|NZ|HK|S|R|MX|NT)\s*\$/gi, "").replace(new RegExp("\\p{Sc}", "gu"), "").replace(/\b(USD|EUR|GBP|CAD|AUD|NZD|INR|JPY|CNY|CHF|SEK|NOK|DKK|MXN|BRL|ZAR|Rs\.?|CR|DR)\b/gi, "").replace(/[*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "");
  if (/\d/.test(bare) && /^[\s\d.,'’()+\-−–—]*$/.test(bare)) return "numberish";
  return "text";
}
var figureKind = (k) => k === "money" || k === "numberish";
var numberLikeKind = (k) => k === "money" || k === "numberish" || k === "percent";
var SIGN_WORD = /^(debits?|credits?|dr|cr|db|d|c|withdrawals?|deposits?|in|out|money in|money out|paid in|paid out|\+|-|plus|minus|charges?|payments?|receipts?)$/i;
var MINUS_WORD = /^(debits?|dr|db|d|withdrawals?|out|money out|paid out|-|minus|charges?|payments?)$/i;
var signColumnWords = (words) => words.length > 0 && words.every((w) => SIGN_WORD.test(w.trim())) && words.some((w) => MINUS_WORD.test(w.trim()));
function columnByName(header, text) {
  const want = sheetNormalizeHeader(text);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want && want !== "");
  if (exact >= 0) return exact;
  const letters = text.trim();
  if (/^[A-Za-z]{1,2}$/.test(letters)) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  return -1;
}
function headerList(header) {
  const names = header.map((h) => h.trim()).filter((h) => h !== "");
  return names.length ? names.join(", ") : "(none found)";
}
function shortText(text, max = 40) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
function rowNumberInput(text, input) {
  if (!/^\d+$/.test(text)) throw new AgentInputError(`"${input}" must be a row number as the spreadsheet shows it: "${text}" is not one.`);
  return Number(text);
}
function signsInput(text, header, input) {
  const m = /^(.+?)\s*(?::\s*(.+?))?\s*=\s*(minus|none)\s*$/i.exec(text);
  if (!m) throw new AgentInputError(`"${input}" must be written "<column>: <word> = minus" (for example "Type: Debit = minus") or "<column> = none": "${text}".`);
  const col = columnByName(header, m[1]);
  if (col < 0) throw new AgentInputError(`"${input}" names the column "${m[1]}", which is not among the headers: ${headerList(header)}.`);
  if (m[3].toLowerCase() === "none") return { col, minus: null };
  const words = (m[2] ?? "").split(/[,;/]|\bor\b/i).map((w) => w.trim().toLowerCase()).filter((w) => w !== "");
  if (words.length === 0) throw new AgentInputError(`"${input}" must name the word that means money out, for example "Type: Debit = minus".`);
  return { col, minus: new Set(words) };
}
var NOT_ADVICE = "Mathproven adds up the figures as they were given and compares them; it does not say which figure is right or what to do about a difference.";
var LARGEST_PART = 1e14;
var ONE_PER_LINE = 'Give each part on its own line, or a JSON list such as ["600.00", "350.00", "125.00"]: a comma inside one amount is read as a thousands separator, so "600,350,125" is one amount.';
function partClues(diff, parts) {
  const abs = Math.abs(diff);
  const clues = [];
  parts.forEach((p, i) => {
    if (clues.length >= 3) return;
    if (Math.abs(p) === abs) clues.push(`the difference is the size of part ${i + 1} (${formatUSD(p)})`);
    else if (2 * Math.abs(p) === abs) clues.push(`the difference is twice part ${i + 1} (${formatUSD(p)})`);
  });
  if (parts.length === 1) clues.push(`only one part was given. ${ONE_PER_LINE}`);
  return clues.length ? `; ${clues.join("; ")}` : "";
}
var totalAgainstParts = {
  name: "check_total_against_parts",
  page: "agents",
  section: "general",
  kind: "check",
  title: "Check that a total equals the sum of its parts",
  description: "Use it to check figures an assistant, a spreadsheet or another tool produced: a stated total and the amounts it should be made of, such as invoice lines, expense items, the pieces of a split payment or the lines of a budget. It adds the parts in integer cents, compares the sum with the stated total and says exactly how far off it is, then adds the parts a second way (whole-number arithmetic, last part to first) and checks that the two sums agree. The result lists every part with a running total, and the stated total, the sum and the difference. Negative parts (refunds, credits) are added as negatives; each part goes on its own line or in a JSON list. Not for totals made by multiplying (quantity times price, hours times a rate), percentages or rounding rules, and not for a whole table of rows and columns.",
  question: "My assistant says these invoice lines come to $1,050.00. Do they really add up to that?",
  inputs: [
    { name: "total", kind: "amount", label: "Stated total", description: 'The total as it was given (by an assistant, a spreadsheet, an invoice or a report), for example "1,050.00" or "$1,050.00". A negative total is written -12.00 or (12.00).', required: true },
    { name: "parts", kind: "amounts", label: "Parts", description: 'The amounts the total should be made of: each on its own line, or a JSON list such as ["600.00", "350.00", "-25.00"]. A comma inside one amount is a thousands separator ("600,350,125" is one amount). Negative parts are written -25.00 or (25.00).', required: true },
    { name: "label", kind: "text", label: "What the total is", description: 'Optional. A few words naming the total, such as "invoice 1042" or "March expenses", used in the result.', required: false }
  ],
  limits: "free",
  notAdvice: NOT_ADVICE,
  // The stated total is a figure the person typed: when only it disagrees, the parts and their sum are shown, marked not verified.
  comparisonChecks: ["parts-add-to-total"],
  run({ values }) {
    const stated = values.total;
    const parts = values.parts ?? [];
    if (parts.length === 0) throw new AgentInputError("There are no parts to add up. Give the amounts the total should be made of.");
    const huge = parts.findIndex((p) => Math.abs(p) > LARGEST_PART);
    if (huge >= 0) throw new AgentInputError(`Part ${huge + 1} (${formatUSD(parts[huge])}) is more than a trillion dollars, which is not a real part. ${ONE_PER_LINE}`);
    if (parts.length === 1 && stated !== 0 && Math.abs(parts[0]) > 1e3 * Math.abs(stated)) {
      throw new AgentInputError(`Only one part was given, ${formatUSD(parts[0])}, more than a thousand times the stated total of ${formatUSD(stated)}. ${ONE_PER_LINE}`);
    }
    const label = typeof values.label === "string" && values.label !== "" ? shortText(values.label, 80) : "The stated total";
    const running = prefixSums(parts, "The parts").slice(1);
    const added = running[running.length - 1];
    const second = bigCents(addUpBig(parts), "The sum of the parts");
    const diff = added - stated;
    const checks = new CheckList();
    checks.add({
      id: "parts-add-to-total",
      label: "The parts add up to the stated total",
      passed: diff === 0,
      severity: "error",
      expected: formatUSD(stated),
      actual: formatUSD(added),
      ...diff === 0 ? {} : { detail: `off by ${formatUSD(diff)}: the ${parts.length} part(s) come to ${formatUSD(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than the stated total${partClues(diff, parts)}` }
    });
    checks.cents("second-way", "The parts added a second way (whole-number arithmetic, last part to first) give the same sum", added, second);
    const verdict = diff === 0 ? `the same as the stated ${formatUSD(stated)}` : `${formatUSD(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than the stated ${formatUSD(stated)}`;
    return {
      summary: `${label}: ${parts.length} part(s) add up to ${formatUSD(added)}, ${verdict}. Added a second way, last part to first, they come to ${formatUSD(second)}.`,
      tables: [
        { name: "Parts", rows: [["Part", "Amount", "Running total"], ...parts.map((p, i) => [i + 1, toDecimal(p), toDecimal(running[i])])] },
        { name: "Total", rows: [["Stated total", "Parts added up", "Difference"], [toDecimal(stated), toDecimal(added), toDecimal(diff)]] }
      ],
      checks: checks.all
    };
  },
  examples: [
    {
      label: "Invoice 1042: three lines and a $25.00 credit come to the stated $1,050.00",
      args: { total: "$1,050.00", parts: ["600.00", "350.00", "125.00", "-25.00"], label: "Invoice 1042" },
      verified: true,
      contains: ["$1,050.00", "1050.00", "-25.00", "1075.00"]
    },
    {
      label: "The same lines against a stated total of $1,100.00 are not verified",
      args: { total: "1,100.00", parts: ["600.00", "350.00", "125.00", "-25.00"] },
      verified: false,
      failedCheck: "parts-add-to-total",
      contains: ["off by -$50.00"]
    }
  ]
};
var NOT_MONEY_WORDS = /* @__PURE__ */ new Set(["id", "no", "nr", "num", "number", "ref", "reference", "code", "account", "acct", "year", "yr", "fy", "qty", "quantity", "count", "units", "hours", "hrs", "rate", "percent", "pct", "share", "zip", "phone", "sku", "seq", "date", "day", "month", "paid", "balance"]);
function notMoneyHeader(header) {
  const raw = header.trim();
  if (/^(#|no\.?|№)$/i.test(raw) || raw.includes("%")) return true;
  return sheetNormalizeHeader(raw).split(" ").some((w) => NOT_MONEY_WORDS.has(w));
}
function totalHeader(header) {
  if (header.includes("%")) return null;
  const n = sheetNormalizeHeader(header);
  if (["total", "totals", "grand total", "row total", "line total"].includes(n)) return "exact";
  if (/^totals?\b/.test(n) || /\btotals?$/.test(n)) return "loose";
  return null;
}
var WHOLE_TOTAL = /^(grand\s+)?(sub[\s-]?)?totals?\s*:?$/i;
var TOTAL_WORD = /\b(sub[\s-]?)?totals?\b/i;
var WHOLE_SUM = /^sum\s*:?$/i;
var SUM_LIKE = /^(all|overall|combined)\b|\b(sum|net|gross|profit|income|balance)\b/i;
var saysTotal = (text) => {
  const t = text.trim();
  return t !== "" && (WHOLE_TOTAL.test(t) || TOTAL_WORD.test(t) || WHOLE_SUM.test(t));
};
function totalWordy(text) {
  const t = text.trim();
  return t !== "" && (saysTotal(t) || SUM_LIKE.test(t));
}
function findHeaderRow(rows) {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    const cells = row.filter(filled);
    if (cells.length < 2) continue;
    if (!cells.every((c) => !figureKind(cellKind(c)) || /^(19|20)\d{2}$/.test(c.trim()))) continue;
    if (!cells.some((c) => cellKind(c) === "text")) continue;
    let score = 0;
    row.forEach((h, col) => {
      if (!filled(h)) return;
      let figures = 0;
      let other = 0;
      for (let j = i + 1; j < Math.min(rows.length, i + 201); j++) {
        const c = rows[j]?.[col];
        const k = cellKind(c);
        if (k === "blank" || k === "na" || k === "text" && totalWordy(c)) continue;
        if (figureKind(k)) figures++;
        else other++;
      }
      if (figures > 0 && figures >= other) score++;
    });
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}
var rowSaysTotal = (r) => saysTotal(r.label) || saysTotal(r.first);
var tableCrossFoot = {
  name: "check_table_cross_foot",
  page: "agents",
  section: "general",
  kind: "check",
  title: "Cross-foot a table: rows to row totals, columns to the totals row",
  description: 'Use it to check figures an assistant, a spreadsheet or another tool produced: a table (.csv or .xlsx, ' +
    'or CSV text) with a row-total column (its header is, starts or ends with "Total"), a totals row (labelled ' +
    'just "Total", "Grand total" or "Subtotal"), or both, such as a budget by month or sales by region. Every ' +
    'column of amounts beside the row total is a part of it unless the parts are named. In integer cents ' +
    'it adds each row across to its row total, each column that the totals row gives a figure for down to ' +
    'it, and each subtotal against the rows above it; with a row-total column it also works out the grand ' +
    'total every way. When a row, column or sign could be read two ways it fails by name and asks: a row ' +
    'equal to the rows above it, a label with a total word, a row of figures with no label, Debit and Credit ' +
    'words beside unsigned amounts, figures above the header, a second header, an empty totals row, a figure ' +
    'that is not dollars and cents. Not for products or differences.',
  question: "Can you check that every row and column of this budget spreadsheet adds up to its totals?",
  inputs: [
    { name: "table", kind: "file", label: "Table", description: 'A .csv or .xlsx file (a path), or the CSV text itself: one header row, then rows of amounts, 100,000 rows at most. Row totals sit in a column whose header is, starts or ends with "Total". A total line is a row labelled just "Total", "Totals", "Grand total", "Subtotal" or "Sub-total" (the last is the totals row; earlier ones are subtotals). "n/a" and a lone dash read as nothing.', required: true },
    { name: "totalColumn", kind: "text", label: "Row-total column", description: `Optional. The header (or column letter) of the column holding each row's total, when its header does not say "Total" or two headers do; "none" when the table has no row-total column.`, required: false },
    { name: "amountColumns", kind: "text", label: "Amount columns", description: "Optional. The headers (or column letters) of the columns each row total is made of, separated by commas. Without it, every column of amounts other than the row total is a part (a column of account numbers, years or quantities too, which then makes the rows fail). Columns of amounts not named are still added down when the totals row gives their figure.", required: false },
    { name: "totalRows", kind: "text", label: "Total and subtotal rows", description: 'Optional. The row numbers, as the spreadsheet shows them, of every total and subtotal row, such as "6, 12, 20" (the last is the totals row), or "none" when no row is a total. Give it when the check asks which rows are totals. A row labelled as a total must be among them.', required: false },
    { name: "headerRow", kind: "text", label: "Header row", description: "Optional. The row number of the header row, when the check asks for it: rows above it are then left out, as asked (a title, a row of years over the quarters), unless one of them is a total line.", required: false },
    { name: "signColumn", kind: "text", label: "Sign column", description: 'Optional, when the check asks for it: a column of words such as Debit and Credit beside amounts written without a sign. Write "<column>: <word> = minus" (for example "Type: Debit = minus") to subtract those rows, or "<column> = none" to add the amounts as written.', required: false }
  ],
  limits: "free",
  notAdvice: NOT_ADVICE,
  run({ files, values }) {
    const file = oneFile(files, "table");
    const rows = file.rows;
    const headerText = typeof values.headerRow === "string" ? values.headerRow.trim() : "";
    let headerRow;
    if (headerText !== "") {
      const n = rowNumberInput(headerText, "headerRow");
      if (n < 1 || n > rows.length || !(rows[n - 1] ?? []).some(filled)) throw new AgentInputError(`Row ${headerText}, given in "headerRow", is not a filled row of the table.`);
      headerRow = n - 1;
    } else {
      headerRow = findHeaderRow(rows);
      if (headerRow < 0) {
        const filledRows = rows.filter((r) => r.some(filled)).length;
        throw new AgentInputError(
          filledRows <= 1 ? `The table (${file.name}) has no rows under its header row, so there is nothing to add up.` : `The table (${file.name}) has no header row with columns of amounts under it. It needs one row of headers, then rows of amounts; name the header row with "headerRow".`
        );
      }
    }
    const header = rows[headerRow] ?? [];
    const region = sheetDataRows(rows, headerRow);
    if (region.length === 0) throw new AgentInputError(`The table (${file.name}) has no rows under its header row, so there is nothing to add up.`);
    if (region.length > MAX_ROWS) throw new AgentInputError(`The table (${file.name}) has ${region.length.toLocaleString("en-US")} rows under its header row, more than the ${MAX_ROWS.toLocaleString("en-US")} this check reads. Check it in parts.`);
    let width = header.length;
    for (const r of region) width = Math.max(width, r.cells.length);
    const nameOf = (c) => (header[c] ?? "").trim() || `column ${columnLetter(c)}`;
    const named = (c) => `${columnLetter(c)} (${nameOf(c)})`;
    const all = Array.from({ length: width }, (_, c) => c);
    const above = rows.slice(0, headerRow).map((cells, i) => ({ rowNumber: i + 1, cells }));
    const holdsFigures = (cells) => cells.some((c) => numberLikeKind(cellKind(c)));
    const aboveFigures = above.filter((r) => holdsFigures(r.cells) && (headerText === "" || r.cells.some((c) => saysTotal(c))));
    const aboveLeft = headerText !== "" ? above.filter((r) => r.cells.some(filled) && !aboveFigures.includes(r)).map((r) => r.rowNumber) : [];
    const kinds = all.map(() => ({ money: 0, numberish: 0, percent: 0, date: 0, text: 0 }));
    for (const r of region) {
      for (const c of all) {
        const t = r.cells[c];
        const k = cellKind(t);
        if (k === "blank" || k === "na" || k === "text" && totalWordy(t)) continue;
        kinds[c][k]++;
      }
    }
    const figures = (c) => kinds[c].money + kinds[c].numberish;
    const isAmountColumn = (c) => figures(c) >= 1 && figures(c) >= kinds[c].percent + kinds[c].date + kinds[c].text;
    const isPercentColumn = (c) => !isAmountColumn(c) && kinds[c].percent >= 1 && kinds[c].percent >= kinds[c].date + kinds[c].text;
    const holds = (c) => kinds[c].date > kinds[c].text ? "dates" : "text";
    const findNamed = (text, input) => {
      const c = columnByName(header, text);
      if (c < 0 || c >= width) throw new AgentInputError(`The table has no column "${text}" (given in "${input}"). Its headers are: ${headerList(header)}.`);
      return c;
    };
    let T = -1;
    const totalText = typeof values.totalColumn === "string" ? values.totalColumn : "";
    if (totalText !== "") {
      if (!/^none$/i.test(totalText)) T = findNamed(totalText, "totalColumn");
    } else {
      const candidates = all.filter((c) => totalHeader(header[c] ?? "") !== null && isAmountColumn(c));
      const exact = candidates.filter((c) => totalHeader(header[c] ?? "") === "exact");
      if (candidates.length === 1) T = candidates[0];
      else if (exact.length === 1) T = exact[0];
      else if (candidates.length > 1) throw new AgentInputError(`More than one column could hold each row's total: ${candidates.map(named).join(", ")}. Name it with "totalColumn" (or "none"), and the parts with "amountColumns" if a column of figures is not one.`);
    }
    let parts;
    const amountText = typeof values.amountColumns === "string" ? values.amountColumns : "";
    const partsNamed = amountText !== "";
    if (partsNamed) {
      parts = amountText.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s !== "").map((s) => findNamed(s, "amountColumns"));
      if (new Set(parts).size !== parts.length) throw new AgentInputError('"amountColumns" names the same column twice.');
      if (T >= 0 && parts.includes(T)) throw new AgentInputError(`"amountColumns" names the row-total column ${named(T)}. Name only the columns its total is made of.`);
    } else {
      parts = all.filter((c) => c !== T && isAmountColumn(c));
    }
    if (parts.length === 0 && T < 0) {
      throw new AgentInputError(`The table (${file.name}) has no column of amounts under its header row. Its headers are: ${headerList(header)}. Name the columns with "amountColumns".`);
    }
    const across = T >= 0 ? [...parts, T] : parts;
    const downOnly = all.filter((c) => !across.includes(c) && (isAmountColumn(c) || isPercentColumn(c)));
    const footCols = [...parts.map((c) => ({ c, role: "part", percent: false })), ...T >= 0 ? [{ c: T, role: "total", percent: false }] : [], ...downOnly.map((c) => ({ c, role: "down", percent: isPercentColumn(c) }))];
    const tk = T >= 0 ? parts.length : -1;
    const money = parts.length + (T >= 0 ? 1 : 0);
    const inFoot = new Set(footCols.map((f) => f.c));
    const fmt = (k, v) => footCols[k].percent ? `${scaledFormat(v, 2)}%` : formatUSD(v);
    const fmtCell = (k, v) => v === void 0 ? "" : footCols[k].percent ? `${scaledFormat(v, 2)}%` : toDecimal(v);
    const namedK = (k) => named(footCols[k].c);
    const read = region.map(({ rowNumber, cells }) => {
      const first = cells.find(filled) ?? "";
      let label = "";
      for (let c = 0; c < cells.length; c++) {
        if (!inFoot.has(c) && filled(cells[c])) {
          label = shortText(cells[c]);
          break;
        }
      }
      const bad = [];
      let any = false;
      const fig = footCols.map((f, k) => {
        const t = cells[f.c];
        if (filled(t) && t.trim() === first.trim() && totalWordy(t) && cellKind(t) === "text") return void 0;
        const v = f.percent ? readPercent(t) : readMoney(t, true);
        if (v === null) {
          bad.push({ k, text: `cell ${columnLetter(f.c)}${rowNumber} ("${shortText(t ?? "", 20)}", ${nameOf(f.c)})` });
          any = true;
          return void 0;
        }
        if (v !== void 0) any = true;
        return v;
      });
      const filledCells = fig.every((v) => v === void 0) && bad.length > 0 ? cells.map((t, c) => ({ t, c })).filter((x) => filled(x.t)) : [];
      const headerLike = filledCells.length >= 2 && filledCells.every((x) => cellKind(x.t) === "text" && !totalWordy(x.t)) && filledCells.some((x) => inFoot.has(x.c));
      return { rowNumber, label, first, cells, fig, bad, any, headerLike };
    });
    const moneyK = footCols.map((_, k) => k).filter((k) => !footCols[k].percent);
    const signText = typeof values.signColumn === "string" ? values.signColumn.trim() : "";
    let signAsk = [];
    let signNote = "";
    if (signText !== "") {
      const signs = signsInput(signText, header, "signColumn");
      if (signs.minus !== null) {
        let n = 0;
        for (const r of read) {
          if (!signs.minus.has((r.cells[signs.col] ?? "").trim().toLowerCase())) continue;
          n++;
          for (const k of moneyK) if (r.fig[k] !== void 0 && r.fig[k] !== 0) r.fig[k] = -r.fig[k];
        }
        signNote = `The amounts of ${n} row(s) whose ${named(signs.col)} reads ${[...signs.minus].map((w) => `"${w}"`).join(" or ")} were subtracted, as "signColumn" says.`;
      } else signNote = `${named(signs.col)} was not read as a sign, as "signColumn" says.`;
    } else {
      const anyNegative = read.some((r) => moneyK.some((k) => (r.fig[k] ?? 0) < 0));
      if (!anyNegative) {
        signAsk = all.filter((c) => {
          if (inFoot.has(c)) return false;
          return signColumnWords(read.filter((r) => !rowSaysTotal(r)).map((r) => r.cells[c]).filter(filled));
        });
      }
    }
    const emptyTotals = read.filter((r) => !r.any && !r.headerLike && rowSaysTotal(r));
    const emptySet = new Set(emptyTotals);
    const leftOut = [];
    for (const r of read) if (!r.any && !emptySet.has(r)) leftOut.push({ rowNumber: r.rowNumber, reason: "no amount in it (a heading or a note)" });
    const withAmounts = read.filter((r) => r.any && !r.headerLike);
    const secondHeaders = read.filter((r) => r.headerLike);
    let lines;
    const totalRowsText = typeof values.totalRows === "string" ? values.totalRows.trim() : "";
    const explicit = totalRowsText !== "";
    const givenIssues = [];
    if (explicit) {
      const wanted = /* @__PURE__ */ new Set();
      const byNumber = new Set(withAmounts.map((r) => r.rowNumber));
      for (const n of /^none$/i.test(totalRowsText) ? [] : totalRowsText.split(/[,;\s]+/).filter((s) => s !== "")) {
        const number = rowNumberInput(n, "totalRows");
        if (!byNumber.has(number)) throw new AgentInputError(`Row ${n}, given in "totalRows", is not a row of amounts under the header row.`);
        wanted.add(number);
      }
      lines = withAmounts.filter((r) => wanted.has(r.rowNumber));
      for (const r of withAmounts) {
        if (!wanted.has(r.rowNumber) && rowSaysTotal(r)) givenIssues.push(`row ${r.rowNumber} (${r.label || r.first}) is labelled as a total, but "totalRows" does not list it; list it, or give it another label if it is an item`);
      }
      let since = 0;
      for (const r of withAmounts) {
        if (!wanted.has(r.rowNumber)) {
          since++;
          continue;
        }
        if (!rowSaysTotal(r) && !SUM_LIKE.test(r.label) && r.label !== "" && since < 2 && r !== lines[lines.length - 1]) givenIssues.push(`row ${r.rowNumber} (${r.label}) is named a subtotal in "totalRows", but it is labelled like an item and stands for ${since} row(s) above it`);
        since = 0;
      }
    } else {
      lines = withAmounts.filter((r) => WHOLE_TOTAL.test(r.label) || WHOLE_TOTAL.test(r.first));
    }
    const G = lines[lines.length - 1];
    const isLine = new Set(lines);
    const asked = [];
    if (!explicit) {
      const labelled = withAmounts.filter((r) => r.label !== "").length;
      const labelledTable = labelled > 0 && labelled * 2 >= withAmounts.length;
      const lastItem = [...withAmounts].reverse().find((r) => !isLine.has(r));
      let groupSize = 0;
      let groupSums = footCols.slice(0, money).map(() => 0);
      const reset = () => {
        groupSize = 0;
        groupSums = footCols.slice(0, money).map(() => 0);
      };
      for (const r of withAmounts) {
        if (G && r.rowNumber > G.rowNumber) break;
        if (isLine.has(r)) {
          reset();
          continue;
        }
        const label = r.label;
        let why = "";
        if (label !== "" && saysTotal(label)) why = `is labelled "${label}", which may name a total or an item`;
        else if (label === "" && labelledTable) why = "has amounts and no label, so it may be a total line";
        else {
          const sumLike = SUM_LIKE.test(label);
          const defined = footCols.slice(0, money).map((_, k) => k).filter((k) => r.fig[k] !== void 0);
          const equal = groupSize >= (sumLike ? 1 : 2) && r.bad.length === 0 && defined.some((k) => r.fig[k] !== 0) && defined.every((k) => r.fig[k] === groupSums[k]);
          if (equal) why = `equals the sum of the ${groupSize} row(s) above it`;
          else if (sumLike && !G && r === lastItem) why = `is the last row, labelled "${label}", and no row is labelled as the totals row`;
        }
        if (why) {
          asked.push({ row: r, why });
          reset();
          continue;
        }
        groupSize++;
        groupSums = groupSums.map((v, k) => addUp([v, r.fig[k] ?? 0], `Column ${namedK(k)}`));
      }
    }
    const subtotals = lines.slice(0, -1);
    const data = withAmounts.filter((r) => !isLine.has(r) && (!G || r.rowNumber < G.rowNumber));
    const below = G ? withAmounts.filter((r) => r.rowNumber > G.rowNumber) : [];
    if (!(T >= 0 && parts.length > 0) && !G && emptyTotals.length === 0) {
      const why = T >= 0 ? `the row-total column ${named(T)} has no other column of amounts beside it` : 'no column header says "Total" (the row totals)';
      throw new AgentInputError(`There is nothing to add up against in ${file.name}: ${why}, and no row is labelled "Total" (the totals row). Name the row-total column with "totalColumn", the amount columns with "amountColumns", or the totals row with "totalRows".`);
    }
    const checks = new CheckList();
    const rowText = (r) => `row ${r.rowNumber}${r.label ? ` (${r.label})` : ""}`;
    const partsOf = (r) => r.fig.slice(0, parts.length);
    const dataRowNumbers = data.map((r) => r.rowNumber);
    const prefix = footCols.map((_, k) => prefixSums(data.map((r) => r.fig[k] ?? 0), `Column ${namedK(k)}`));
    const position = (rowNumber) => {
      let lo = 0;
      let hi = dataRowNumbers.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (dataRowNumbers[mid] < rowNumber) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const between = (k, from, to) => prefix[k][position(to)] - prefix[k][position(from + 1)];
    const countBetween = (from, to) => position(to) - position(from + 1);
    const downAll = footCols.map((_, k) => prefix[k][data.length]);
    const unreadIn = (k, from, to) => {
      const at = data.slice(position(from + 1), position(to)).filter((r) => r.bad.some((b) => b.k === k)).map((r) => `${columnLetter(footCols[k].c)}${r.rowNumber}`);
      return at.length ? `; cell(s) ${at.slice(0, 10).join(", ")}${at.length > 10 ? ` and ${at.length - 10} more` : ""} could not be read` : "";
    };
    const end = (G?.rowNumber ?? Number.MAX_SAFE_INTEGER) + 1;
    let acrossChecked = 0;
    if (T >= 0 && parts.length > 0) {
      const fails = [];
      const acrossRows = [...data, ...subtotals, ...G ? [G] : []].sort((a, b) => a.rowNumber - b.rowNumber);
      for (const r of acrossRows) {
        if (r.bad.some((b) => b.k < money)) continue;
        if (isLine.has(r) && (partsOf(r).some((f) => f === void 0) || r.fig[tk] === void 0)) continue;
        acrossChecked++;
        const sumAcross = addUp(partsOf(r).map((f) => f ?? 0), `The amounts in row ${r.rowNumber}`);
        const stated = r.fig[tk];
        if (stated === void 0) {
          if (sumAcross !== 0) fails.push(`${rowText(r)}: no row total, its amounts add up to ${formatUSD(sumAcross)}`);
        } else if (stated !== sumAcross) {
          fails.push(`${rowText(r)}: the amounts add up to ${formatUSD(sumAcross)}, the row total says ${formatUSD(stated)} (off by ${formatUSD(sumAcross - stated)})`);
        }
      }
      const doubtful = partsNamed ? [] : parts.filter((c) => notMoneyHeader(header[c] ?? ""));
      const hint = doubtful.length ? `. The parts are every column of amounts beside the row total, ${doubtful.map(named).join(", ")} included; if a column is not part of the row totals, name the parts with "amountColumns"` : "";
      checks.add({
        id: "row-totals",
        label: `Each row's amounts (${parts.map(nameOf).join(", ")}) add up to its row total`,
        passed: fails.length === 0,
        severity: "error",
        expected: `${acrossChecked} of ${acrossChecked} rows`,
        actual: `${acrossChecked - fails.length} of ${acrossChecked} rows`,
        ...fails.length ? { detail: `${fails.length} row(s) do not add up: ${listOf(fails)}${hint}` } : {}
      });
    }
    const footed = footCols.map((_, k) => k).filter((k) => G?.fig[k] !== void 0);
    const notFooted = G ? footCols.map((_, k) => k).filter((k) => G.fig[k] === void 0 && !G.bad.some((b) => b.k === k)) : [];
    if (G && footed.length > 0) {
      const fails = [];
      for (const k of footed) {
        const stated = G.fig[k];
        if (downAll[k] !== stated) fails.push(`column ${namedK(k)}: the rows add up to ${fmt(k, downAll[k])}, the totals row (row ${G.rowNumber}) says ${fmt(k, stated)} (off by ${fmt(k, downAll[k] - stated)})${unreadIn(k, 0, end)}`);
      }
      checks.add({
        id: "column-totals",
        label: `Each column the totals row gives a figure for (${footed.map(namedK).join(", ")}) adds up to it`,
        passed: fails.length === 0,
        severity: "error",
        expected: `${footed.length} of ${footed.length} columns`,
        actual: `${footed.length - fails.length} of ${footed.length} columns`,
        ...fails.length ? { detail: `${fails.length} column(s) do not add up: ${listOf(fails)}` } : {}
      });
    }
    if (G) {
      const blankWithFigures = notFooted.filter((k) => downAll[k] !== 0);
      checks.that("totals-row-blank", "The totals row gives a figure for every column of amounts", blankWithFigures.length === 0, `The totals row (row ${G.rowNumber}) has no figure for ${blankWithFigures.map(namedK).join(", ")}, so ${blankWithFigures.length === 1 ? "that column is" : "those columns are"} not footed`, "warning");
    }
    if (T < 0 && G && footed.length > 0) {
      const differing = footed.filter((k) => bigCents(addUpBig(data.map((r) => r.fig[k] ?? 0)), `Column ${namedK(k)}`) !== downAll[k]);
      checks.that("columns-second-way", "Each footed column added a second way (whole-number arithmetic, bottom row to top) gives the same figure", differing.length === 0, `differs for ${differing.map(namedK).join(", ")}`);
    }
    if (subtotals.length > 0) {
      const fails = [];
      const bounds = [0];
      for (const s of subtotals) {
        const ks = footCols.map((_, k) => k).filter((k) => s.fig[k] !== void 0);
        const ties = (from) => ks.every((k) => between(k, from, s.rowNumber) === s.fig[k]);
        const nearest = bounds[bounds.length - 1];
        const tried = countBetween(nearest, s.rowNumber) > 0 ? [nearest] : bounds.slice().reverse();
        if (!tried.some(ties)) {
          const n = countBetween(nearest, s.rowNumber);
          for (const k of ks) {
            const down = between(k, nearest, s.rowNumber);
            if (down !== s.fig[k]) fails.push(`${rowText(s)}, column ${namedK(k)}: the ${n} row(s) above it add up to ${fmt(k, down)}, it says ${fmt(k, s.fig[k])} (off by ${fmt(k, down - s.fig[k])})${unreadIn(k, nearest, s.rowNumber)}`);
          }
        }
        bounds.push(s.rowNumber);
      }
      checks.add({
        id: "subtotals",
        label: `Each subtotal row (${listOf(subtotals.map((s) => `row ${s.rowNumber}`), 20)}) equals the rows above it, back to the total line before it`,
        passed: fails.length === 0,
        severity: "error",
        ...fails.length ? { detail: `${fails.length} subtotal figure(s) do not add up: ${listOf(fails)}` } : {}
      });
    }
    const totalsAdvice = (rowsAsked) => {
      const lineRows = lines.map((l) => l.rowNumber);
      const allRows = [...lineRows, ...rowsAsked].sort((a, b) => a - b);
      return allRows.length <= 20 ? ` Give "totalRows" the row numbers of every total and subtotal row (for example "${allRows.join(", ")}" if they are all totals, or "${lineRows.join(", ") || "none"}" if the others are items).` : ' Give "totalRows" the row numbers of every total and subtotal row.';
    };
    if (asked.length > 0) {
      checks.add({
        id: "sum-rows",
        label: "No row that may be a total is decided by a guess",
        passed: false,
        severity: "error",
        detail: `${listOf(asked.map((a) => `${rowText(a.row)} ${a.why}`))}. Counted as an item, a total counts the rows above it twice; taken as a total, an item is left out; so it is not decided by its own figures.${totalsAdvice(asked.map((a) => a.row.rowNumber))} A row whose label has a total word is a total; if it is an item, give it another label.`
      });
    }
    if (givenIssues.length > 0) {
      checks.add({
        id: "total-rows-given",
        label: `The rows named in "totalRows" agree with the table's own labels`,
        passed: false,
        severity: "error",
        detail: `${listOf(givenIssues)}.`
      });
    }
    if (emptyTotals.length > 0) {
      checks.add({
        id: "empty-total-lines",
        label: "Every total line has its figures",
        passed: false,
        severity: "error",
        detail: `${listOf(emptyTotals.map(rowText))} ${emptyTotals.length === 1 ? "is a total line with no figures" : "are total lines with no figures"}: a formula with no saved value reads as blank. Save the file in the spreadsheet program, or give the figures.`
      });
    }
    if (below.length > 0) {
      checks.add({
        id: "below-totals",
        label: "No row with amounts lies below the totals row",
        passed: false,
        severity: "error",
        detail: `${below.length} row(s) with amounts are below the totals row (row ${G.rowNumber}) and in no total: ${listOf(below.map(rowText))}. If the totals row is lower down, name every total row with "totalRows".`
      });
    }
    if (aboveFigures.length > 0) {
      checks.add({
        id: "rows-above-header",
        label: "No figure lies above the header row",
        passed: false,
        severity: "error",
        detail: `The header row was taken to be row ${headerRow + 1}, and ${listOf(aboveFigures.map((r) => `row ${r.rowNumber} (${r.cells.filter(filled).map((c) => shortText(c, 20)).join(", ")})`), 6)} above it ${aboveFigures.length === 1 ? "holds" : "hold"} figures that were not read. ${headerText !== "" ? "A total line above the header row is not left out." : 'Give the table as one header row with its rows under it, or name the header row with "headerRow" to leave the rows above it out.'}`
      });
    }
    if (secondHeaders.length > 0) {
      checks.add({
        id: "second-header",
        label: "The table has one header row",
        passed: false,
        severity: "error",
        detail: `${listOf(secondHeaders.map((r) => `row ${r.rowNumber} (${r.cells.filter(filled).map((c) => shortText(c, 20)).join(", ")})`), 6)} holds words where the figures are, like a second header row: the sheet may hold two tables. Check each table on its own.`
      });
    }
    if (signAsk.length > 0) {
      const c0 = signAsk[0];
      const words = [...new Set(read.map((r) => (r.cells[c0] ?? "").trim()).filter((w) => w !== ""))].slice(0, 4);
      checks.add({
        id: "sign-column",
        label: "Every amount carries its own sign",
        passed: false,
        severity: "error",
        detail: `${signAsk.map(named).join(", ")} ${signAsk.length === 1 ? "holds" : "hold"} only words like ${words.map((w) => `"${w}"`).join(", ")} beside amounts written without a sign, so some rows may be money out. Say how with "signColumn", for example "${nameOf(c0)}: ${words.find((w) => /debit|dr|out|withdraw|charge|payment|minus|^-$/i.test(w)) ?? words[0]} = minus", or "${nameOf(c0)} = none" to add the amounts as written.`
      });
    }
    if (!partsNamed) {
      const mixed = all.filter((c) => !inFoot.has(c) && figures(c) > 0);
      if (mixed.length > 0) {
        const sample = (c) => region.filter((r) => figureKind(cellKind(r.cells[c]))).slice(0, 3).map((r) => `${columnLetter(c)}${r.rowNumber} "${shortText(r.cells[c] ?? "", 20)}"`).join(", ");
        checks.add({
          id: "mixed-columns",
          label: "No column of words also holds figures",
          passed: false,
          severity: "error",
          detail: `${listOf(mixed.map((c) => `column ${named(c)} is mostly words but holds figures (${sample(c)})`))}. It is not added. If it is a column of amounts, name the parts with "amountColumns"; naming the parts also leaves it out as asked.`
        });
      }
    }
    const unchecked = [];
    for (const l of lines) {
      l.cells.forEach((t, c) => {
        if (inFoot.has(c) || !filled(t) || !numberLikeKind(cellKind(t))) return;
        unchecked.push(`cell ${columnLetter(c)}${l.rowNumber} ("${shortText(t, 20)}", ${nameOf(c)})`);
      });
    }
    if (unchecked.length > 0) {
      checks.add({
        id: "unchecked-total-figures",
        label: "Every figure in a total line is checked",
        passed: false,
        severity: "error",
        detail: `${listOf(unchecked)} ${unchecked.length === 1 ? "is a figure" : "are figures"} in a total line under a column that is not added up, so ${unchecked.length === 1 ? "it" : "they"} cannot be checked. Name the columns with "amountColumns", or give the table without that column.`
      });
    }
    const ways = [];
    let oneByOne = 0;
    if (tk >= 0) {
      const partK = parts.map((_, k) => k);
      if (G && G.fig[tk] !== void 0) ways.push({ name: `the grand total in the totals row (cell ${columnLetter(T)}${G.rowNumber})`, value: G.fig[tk] });
      ways.push({ name: "the row totals added down", value: downAll[tk] });
      if (G && partK.length > 0 && partK.every((k) => G.fig[k] !== void 0)) ways.push({ name: "the column totals added across", value: addUp(partK.map((k) => G.fig[k]), "The totals row") });
      const everyAmount = [];
      for (const r of data) {
        if (partK.length > 0) for (const k of partK) everyAmount.push(r.fig[k] ?? 0);
        else everyAmount.push(r.fig[tk] ?? 0);
      }
      oneByOne = bigCents(addUpBig(everyAmount), "The table");
      const passed = ways.every((w) => w.value === oneByOne);
      checks.add({
        id: "grand-total",
        label: ways.length > 1 ? "The grand total agrees every way it can be worked out, and with every amount added one at a time (whole-number arithmetic)" : "The row totals added down agree with every amount added one at a time (whole-number arithmetic)",
        passed,
        severity: "error",
        expected: formatUSD(ways[0].value),
        actual: formatUSD(oneByOne),
        ...passed ? {} : { detail: [...ways, { name: "every amount added one at a time", value: oneByOne }].map((w) => `${w.name}: ${formatUSD(w.value)}`).join("; ") }
      });
    }
    const unreadable = read.filter((r) => !r.headerLike).flatMap((r) => r.bad.map((b) => b.text));
    checks.add({
      id: "rows-read",
      label: "Every cell in a column of amounts or percentages is a figure that can be read",
      passed: unreadable.length === 0,
      severity: "error",
      ...unreadable.length ? { detail: `${unreadable.length} cell(s) could not be read as amounts in dollars and cents (or percentages) and are left out of every sum: ${listOf(unreadable, 20)}` } : {}
    });
    checks.add(sheetRowChecks([], leftOut)[1]);
    const listed = [...data, ...subtotals].sort((a, b) => a.rowNumber - b.rowNumber);
    const rowsTable = [
      ["Row", "Label", ...parts.map(nameOf), ...parts.length > 0 && T >= 0 ? ["Added across"] : [], ...T >= 0 ? [`Row total (${nameOf(T)})`] : [], ...T >= 0 && parts.length > 0 ? ["Difference"] : []],
      ...listed.map((r) => {
        const sumAcross = parts.length > 0 && T >= 0 ? addUp(partsOf(r).map((f) => f ?? 0), `The amounts in row ${r.rowNumber}`) : void 0;
        const stated = tk >= 0 ? r.fig[tk] : void 0;
        return [
          r.rowNumber,
          isLine.has(r) ? `${r.label} (subtotal)` : r.label,
          ...partsOf(r).map((f, k) => fmtCell(k, f)),
          ...sumAcross !== void 0 ? [toDecimal(sumAcross)] : [],
          ...T >= 0 ? [fmtCell(tk, stated)] : [],
          ...T >= 0 && sumAcross !== void 0 ? [stated === void 0 ? "" : toDecimal(sumAcross - stated)] : []
        ];
      })
    ];
    const columnsTable = [
      ["Column", "Header", "Used as", "Added down", "Totals row", "Difference"],
      ...footCols.map((f, k) => {
        const stated = G?.fig[k];
        const use = f.role === "part" ? "part of the row total" : f.role === "total" ? "row total" : f.percent ? "percentages" : "amounts, not a part";
        return [columnLetter(f.c), nameOf(f.c), `${use}${stated === void 0 ? ", not footed (no figure in the totals row)" : ""}`, fmtCell(k, downAll[k]), fmtCell(k, stated), stated === void 0 ? "" : fmtCell(k, downAll[k] - stated)];
      })
    ];
    const tables = [
      { name: "Rows", rows: rowsTable },
      { name: "Columns", rows: columnsTable },
      ...tk >= 0 ? [{ name: "Grand total", rows: [["Way", "Amount"], ...ways.map((w) => [w.name, toDecimal(w.value)]), ["every amount added one at a time", toDecimal(oneByOne)]] }] : []
    ];
    const notAdded = all.filter((c) => !inFoot.has(c) && (filled(header[c]) || kinds[c].text + kinds[c].date + figures(c) > 0)).map((c) => `${named(c)}: ${figures(c) > 0 ? "words and figures" : holds(c)}`);
    const summary = [
      `${file.name}: ${data.length} item row(s)${lines.length ? `, ${lines.length} total line(s) (${listOf(lines.map((l) => `row ${l.rowNumber}`), 10)})${explicit ? ', as "totalRows" gives them' : ""}` : ""}.`,
      T >= 0 && parts.length > 0 ? `${acrossChecked} row(s) added across: ${parts.map(nameOf).join(", ")} to the row total in ${named(T)}.` : T >= 0 ? `${named(T)} holds the row totals; there is no other column of amounts to add across.` : "There is no row-total column, so nothing was added across.",
      G ? footed.length ? `Footed down to the totals row (row ${G.rowNumber}): ${footed.map((k) => `${namedK(k)}${footCols[k].role === "down" ? footCols[k].percent ? " (percentages)" : " (not a part)" : ""}`).join(", ")}.` : `The totals row (row ${G.rowNumber}) gives no figure, so no column was footed.` : "No column was footed down, as there is no totals row.",
      notFooted.length ? `Not footed (no figure in the totals row): ${notFooted.map(namedK).join(", ")}.` : "",
      subtotals.length ? `${subtotals.length} subtotal row(s) checked against the rows above them.` : "",
      tk >= 0 ? `Grand total ${formatUSD(oneByOne)}: ${ways.map((w) => w.name).join(", ")} and every amount added one at a time ${ways.every((w) => w.value === oneByOne) ? "all give the same figure" : "do not all agree"}.` : "With no row-total column there is no grand total to cross-foot; each footed column stands on its own.",
      notAdded.length ? `Columns not added: ${notAdded.join("; ")}.` : "",
      !G && !explicit && emptyTotals.length === 0 ? 'No row is labelled just "Total", "Grand total" or "Subtotal", so no row was taken as the totals row and every row is counted as an item.' : "",
      !G && explicit ? '"totalRows" says no row is a total, so every row is counted as an item.' : "",
      signNote,
      aboveLeft.length ? `Row(s) ${aboveLeft.join(", ")} above the header row were left out, as asked.` : ""
    ].filter((x) => x !== "").join(" ");
    return { summary, tables, checks: checks.all };
  },
  examples: [
    {
      label: "A department budget by quarter, five lines with a row-total column and a totals row, grand total $65,346.25",
      args: { table: "agents-fixture:general/budget-by-quarter.csv" },
      verified: true,
      contains: ["$65,346.25", "65346.25", "16130.00", "17190.75", "-155.00"]
    },
    {
      label: "The same budget with one row total changed is not verified",
      args: { table: 'Department,Q1,Q2,Total\nSalaries,"12,000.00","12,000.00","24,000.00"\nRent,"3,000.00","3,000.00","6,500.00"\nTotal,"15,000.00","15,000.00","30,000.00"\n' },
      verified: false,
      failedCheck: "row-totals",
      contains: ["row 3 (Rent)"]
    },
    {
      label: "A cell that cannot be read as an amount is not verified",
      args: { table: 'Department,Q1,Q2,Total\nSalaries,"12,000.00",12OO.00,"13,200.00"\nTotal,"12,000.00","1,200.00","13,200.00"\n' },
      verified: false,
      failedCheck: "rows-read",
      contains: ["cell C2"]
    }
  ]
};
var LIST_ROLES = ["amount", "moneyOut", "moneyIn", "reference", "date", "description"];
var LIST_LABELS = { amount: "Amount", moneyOut: "Money out", moneyIn: "Money in", reference: "Reference", date: "Date", description: "Description" };
var LIST_SYNONYMS = {
  date: ["date", "posting date", "posted date", "post date", "transaction date", "trans date", "effective date", "value date", "payment date", "invoice date", "order date", "posted", "day"],
  moneyOut: ["money out", "paid out", "debit", "debits", "debit amount", "withdrawal", "withdrawals", "withdrawal amount", "charges"],
  moneyIn: ["money in", "paid in", "credit", "credits", "credit amount", "deposit", "deposits", "deposit amount"],
  amount: ["amount", "transaction amount", "amt", "net amount", "payment amount", "invoice amount", "total", "value", "net", "sum", "paid"],
  reference: ["reference", "ref", "ref no", "reference number", "reference no", "check number", "check no", "cheque number", "cheque no", "check", "cheque", "transaction id", "txn id", "invoice number", "invoice no", "document number", "doc no", "order id", "order number", "order no", "confirmation", "id", "invoice", "order", "number", "no", "num"],
  description: ["description", "transaction description", "memo", "details", "narrative", "payee", "name", "particulars", "vendor", "customer", "notes", "note"]
};
var LIST_MATCH_ORDER = ["date", "moneyOut", "moneyIn", "amount", "reference", "description"];
function guessListColumns(rows, atHeaderRow) {
  const g = sheetGuessColumns(rows, LIST_MATCH_ORDER, LIST_SYNONYMS, atHeaderRow);
  const columns = { ...g.columns };
  if (columns.moneyOut >= 0 && columns.moneyIn >= 0) columns.amount = -1;
  else if (columns.amount >= 0) columns.moneyOut = columns.moneyIn = -1;
  return { headerRow: g.headerRow, columns };
}
var LIST_COLUMNS = { roles: LIST_ROLES, labels: LIST_LABELS, required: ["amount"], guess: guessListColumns };
var LIST_COLUMNS_READ = { ...LIST_COLUMNS, required: [] };
function listColumnsInput(fileLabel, name) {
  const base = columnsInput(fileLabel, LIST_COLUMNS, name);
  return { ...base, description: base.description.replace("Needed: Amount.", "Needed: Amount, or Money out and Money in.") };
}
var BALANCE_LINE = /^(beginning|opening|starting|ending|closing) balance\b/i;
var BALANCE_OR_NET = /^(opening|closing|beginning|ending|starting|previous|new|available|ledger|current|running)\s+balance\b|^balance\s*:?$|\bbalance\s+(forward|b\/?f|c\/?f|brought forward|carried forward)\b|^(brought|carried)\s+forward\b|^net(\s+(change|total|movement|amount))?\s*:?$|\bnet change\b/i;
var DEBITS_WORDS = /\b(debits?|withdrawals?|money out|paid out|charges)\b/i;
var CREDITS_WORDS = /\b(credits?|deposits?|money in|paid in|receipts)\b/i;
function refKey(ref) {
  const k = ref.toUpperCase().replace(/\s+/g, "").replace(/^#/, "");
  return /^\d+$/.test(k) ? k.replace(/^0+(?=\d)/, "") : k;
}
function dayNumber(iso) {
  return iso === "" ? Number.NaN : Date.parse(`${iso}T00:00:00Z`) / 864e5;
}
function readList(file, override, name, input, flip, signsText, signsName, dateOrder) {
  const mapping = mapColumns(file, LIST_COLUMNS_READ, override, name);
  const col = { ...mapping.columns };
  const header = file.rows[mapping.headerRow] ?? [];
  if (col.amount >= 0 && (col.moneyOut >= 0 || col.moneyIn >= 0)) {
    const guess = guessListColumns(file.rows, mapping.headerRow).columns;
    const namedAmount = col.amount !== guess.amount;
    const namedSplit = col.moneyOut !== guess.moneyOut || col.moneyIn !== guess.moneyIn;
    if (namedAmount && !namedSplit) col.moneyOut = col.moneyIn = -1;
    else if (namedSplit && !namedAmount) col.amount = -1;
    else throw new AgentInputError(`For the ${name}, name either one Amount column or the Money out and Money in columns, not both.`);
  }
  if (col.amount < 0 && col.moneyOut < 0 && col.moneyIn < 0) {
    throw new AgentInputError(`The ${name} (${file.name}) has no amount column. Its headers are: ${headerList(header)}. Name it with "${input}", for example "Amount = <header>", or "Money out = <header>, Money in = <header>".`);
  }
  const used = LIST_ROLES.map((r) => col[r]).filter((c) => c >= 0);
  if (new Set(used).size !== used.length) throw new AgentInputError(`For the ${name}, the same column is named for two different parts. Each column can be used once.`);
  const dataRows = sheetDataRows(file.rows, mapping.headerRow);
  if (dataRows.length === 0) throw new AgentInputError(`The ${name} (${file.name}) has no rows under its header row, so there is nothing to reconcile.`);
  if (dataRows.length > MAX_ROWS) throw new AgentInputError(`The ${name} (${file.name}) has ${dataRows.length.toLocaleString("en-US")} rows, more than the ${MAX_ROWS.toLocaleString("en-US")} this check reads. Reconcile it in parts, a month at a time say.`);
  const cell = (cells, c) => c >= 0 ? (cells[c] ?? "").trim() : "";
  const headerNames = new Set(header.map(sheetNormalizeHeader).filter((h) => h !== ""));
  const split = col.amount < 0;
  const signs = signsText !== "" ? signsInput(signsText, header, signsName) : void 0;
  if (signs !== void 0 && split) throw new AgentInputError(`"${signsName}" is for a list with one amount column; the ${name} has money out and money in columns, which give the sign already.`);
  let order = dateOrder ?? "mdy";
  let dateAmbiguous;
  if (col.date >= 0 && dateOrder === void 0) {
    const texts = dataRows.map(({ cells }) => cell(cells, col.date)).filter((t) => t !== "");
    const reads = (t, o) => {
      try {
        return bkCellToIsoDate(t, o);
      } catch {
        return null;
      }
    };
    const missM = texts.filter((t) => reads(t, "mdy") === null).length;
    const missD = texts.filter((t) => reads(t, "dmy") === null).length;
    if (missM > 0 && missD < missM) order = "dmy";
    else if (missM === 0 && missD === 0) {
      const differing = texts.find((t) => reads(t, "mdy") !== reads(t, "dmy"));
      if (differing !== void 0) dateAmbiguous = `"${shortText(differing, 20)}" reads as ${reads(differing, "mdy")} month first and ${reads(differing, "dmy")} day first`;
    }
  }
  const out = {
    name,
    fileName: file.name,
    rows: [],
    problems: [],
    leftOut: [],
    hasReference: false,
    hasDate: false,
    split,
    totalLines: [],
    headers: headerList(header),
    headerRow: mapping.headerRow,
    above: file.rows.slice(0, mapping.headerRow).map((cells, i) => ({ rowNumber: i + 1, cells })).filter((r) => r.cells.some((c) => numberLikeKind(cellKind(c)))),
    signNote: "",
    ...dateAmbiguous ? { dateAmbiguous } : {}
  };
  let subtracted = 0;
  for (const { rowNumber, cells } of dataRows) {
    const unread = [];
    const money = (c, what, unsigned) => {
      const t = cell(cells, c);
      const v = readMoney(t, false);
      if (v === null) {
        unread.push(`the ${what} "${shortText(t, 20)}" could not be read`);
        return void 0;
      }
      if (unsigned !== "" && v !== void 0 && v < 0) {
        unread.push(`the ${what} "${shortText(t, 20)}" is negative, and a ${unsigned} column holds amounts without a sign`);
        return void 0;
      }
      return v;
    };
    if (cells.filter((c) => headerNames.has(sheetNormalizeHeader(c))).length >= 2) {
      out.problems.push({ rowNumber, reason: "it repeats the header row, so the sheet may hold a second table; give each list as its own table" });
      continue;
    }
    const amountCell = money(col.amount, "amount", "");
    const outCell = money(col.moneyOut, "money out amount", "money out");
    const inCell = money(col.moneyIn, "money in amount", "money in");
    const noAmount = amountCell === void 0 && outCell === void 0 && inCell === void 0 && unread.length === 0;
    let written = split ? (inCell ?? 0) - (outCell ?? 0) : amountCell ?? 0;
    if (signs?.minus && signs.minus.has(cell(cells, signs.col).toLowerCase()) && written !== 0) {
      written = -written;
      subtracted++;
    }
    const first = cells.find(filled);
    const wholeTotal = cells.find((c) => WHOLE_TOTAL.test(c.trim()));
    if (first !== void 0 && sheetIsTotalWord(first) || wholeTotal !== void 0) {
      const label = shortText(first !== void 0 && sheetIsTotalWord(first) ? first : wholeTotal);
      if (unread.length) out.problems.push({ rowNumber, reason: `a total line: ${unread.join("; ")}` });
      else if (noAmount) out.problems.push({ rowNumber, reason: "a total line with no figure (a formula with no saved value reads as blank; save the file in the spreadsheet program, or give the figure)" });
      else {
        out.totalLines.push({ rowNumber, label, before: out.rows.length, ...split ? { ...outCell !== void 0 ? { out: outCell } : {}, ...inCell !== void 0 ? { in: inCell } : {} } : { single: written } });
        out.leftOut.push({ rowNumber, reason: "the list's own total line (checked against its rows)" });
      }
      continue;
    }
    const sumCell = cells.find((c) => WHOLE_SUM.test(c.trim()));
    if (sumCell !== void 0 && !noAmount) {
      out.problems.push({ rowNumber, reason: `it is labelled "${shortText(sumCell)}", which may be the list's own total or an item, so it is not decided by a guess: label it "Total" if it is a total, or give it another label if it is an item` });
      continue;
    }
    const balanceCell = cells.find((c) => BALANCE_OR_NET.test(c.trim()));
    if (balanceCell !== void 0 && !noAmount) {
      out.problems.push({ rowNumber, reason: `it is a balance or net line ("${shortText(balanceCell)}"), which carries or sums other rows and is not an item to pair: give the list without it` });
      continue;
    }
    const dateText = cell(cells, col.date);
    const refText = cell(cells, col.reference);
    const description = cell(cells, col.description);
    if (noAmount) {
      if (BALANCE_LINE.test(description) || dateText === "" && refText === "") out.leftOut.push({ rowNumber, reason: "no amount (a heading, a note or a balance line)" });
      else out.problems.push({ rowNumber, reason: "no amount" });
      continue;
    }
    const reasons = [...unread];
    let date = "";
    if (dateText !== "") {
      try {
        date = bkCellToIsoDate(dateText, order);
      } catch {
        reasons.push(`the date "${shortText(dateText, 20)}" could not be read`);
      }
    }
    if ((outCell ?? 0) !== 0 && (inCell ?? 0) !== 0) reasons.push("both a money out and a money in amount on one row");
    if (reasons.length) {
      out.problems.push({ rowNumber, reason: reasons.join("; ") });
      continue;
    }
    out.rows.push({ rowNumber, amount: flip && written !== 0 ? -written : written, written, out: outCell ?? 0, in: inCell ?? 0, reference: refText, refKey: refKey(refText), date, day: dayNumber(date), description });
  }
  if (out.rows.length === 0 && out.problems.length === 0) throw new AgentInputError(`The ${name} (${file.name}) has no row with an amount in it, so there is nothing to reconcile.`);
  out.hasReference = col.reference >= 0 && out.rows.some((r) => r.refKey !== "");
  out.hasDate = col.date >= 0 && out.rows.some((r) => r.date !== "");
  if (signs !== void 0) {
    out.signNote = signs.minus === null ? ` In the ${name}, ${header[signs.col]?.trim() || "that column"} was not read as a sign, as "${signsName}" says.` : ` In the ${name}, ${subtracted} row(s) whose ${header[signs.col]?.trim() || "sign column"} reads ${[...signs.minus].map((w) => `"${w}"`).join(" or ")} were read as money out, as "${signsName}" says.`;
  } else if (!split && !out.rows.some((r) => r.written < 0)) {
    const amountCols = /* @__PURE__ */ new Set([col.amount, col.date]);
    for (let c = 0; c < header.length; c++) {
      if (amountCols.has(c)) continue;
      const words = dataRows.map(({ cells }) => cell(cells, c)).filter((w) => w !== "" && !sheetIsTotalWord(w) && !WHOLE_TOTAL.test(w));
      if (signColumnWords(words)) {
        out.signAsk = { col: header[c]?.trim() || columnLetter(c), words: [...new Set(words)].slice(0, 4) };
        break;
      }
    }
  }
  return out;
}
function totalLineFails(list) {
  const fails = [];
  const outs = prefixSums(list.rows.map((r) => list.split ? r.out : r.written < 0 ? -r.written : 0), `The money out of the ${list.name}`);
  const ins = prefixSums(list.rows.map((r) => list.split ? r.in : r.written > 0 ? r.written : 0), `The money in of the ${list.name}`);
  const nets = prefixSums(list.rows.map((r) => r.written), `The amounts of the ${list.name}`);
  let from = 0;
  for (const t of list.totalLines) {
    const tie = (what, stated, pre, unsigned) => {
      const a = pre[t.before] - pre[from];
      const b = pre[t.before];
      const same = (x) => unsigned ? Math.abs(stated) === Math.abs(x) : stated === x;
      if (same(a) || same(b)) return;
      fails.push(`row ${t.rowNumber} (${t.label}) says ${formatUSD(stated)} for ${what}; the rows above it come to ${formatUSD(a)}${from > 0 ? ` since the total before it and ${formatUSD(b)} in all` : ""}`);
    };
    let plain = false;
    if (list.split) {
      if (t.out !== void 0) tie("money out", t.out, outs, true);
      if (t.in !== void 0) tie("money in", t.in, ins, true);
      plain = t.out !== void 0 && t.in !== void 0;
    } else if (t.single !== void 0) {
      if (DEBITS_WORDS.test(t.label) && !CREDITS_WORDS.test(t.label)) tie("money out", t.single, outs, true);
      else if (CREDITS_WORDS.test(t.label) && !DEBITS_WORDS.test(t.label)) tie("money in", t.single, ins, true);
      else {
        plain = true;
        tie("the rows", t.single, nets, false);
      }
    }
    if (plain) from = t.before;
  }
  return fails;
}
var MATCH_MODES = ["reference", "amount and date", "amount"];
var DATE_ORDERS = ["month first", "day first"];
function finish(as, bs, pairs) {
  const usedA = new Set(pairs.map((p) => p.a));
  const usedB = new Set(pairs.map((p) => p.b));
  return { pairs, restA: as.filter((a) => !usedA.has(a)), restB: bs.filter((b) => !usedB.has(b)) };
}
function pairByKey(as, bs, key, by) {
  const pool = /* @__PURE__ */ new Map();
  for (const b of bs) {
    const k = key(b);
    const p = pool.get(k);
    if (p) p.list.push(b);
    else pool.set(k, { list: [b], next: 0 });
  }
  const pairs = [];
  for (const a of as) {
    const p = pool.get(key(a));
    if (p && p.next < p.list.length) pairs.push({ a, b: p.list[p.next++], by });
  }
  return finish(as, bs, pairs);
}
function pairByAmount(as, bs) {
  const byAmount = /* @__PURE__ */ new Map();
  bs.forEach((b, i) => {
    const g = byAmount.get(b.amount) ?? { dated: [], undated: [] };
    if (Number.isNaN(b.day)) g.undated.push(b);
    else g.dated.push({ b, i });
    byAmount.set(b.amount, g);
  });
  const pools = /* @__PURE__ */ new Map();
  for (const [amount, g] of byAmount) {
    g.dated.sort((x, y) => x.b.day - y.b.day || x.i - y.i);
    const n = g.dated.length;
    const right = new Int32Array(n + 1).map((_, j) => j);
    const left = new Int32Array(n + 1).map((_, j) => j);
    const block = new Int32Array(n);
    for (let j = 0; j < n; j++) block[j] = j > 0 && g.dated[j - 1].b.day === g.dated[j].b.day ? block[j - 1] : j;
    pools.set(amount, { dated: g.dated, undated: g.undated, uNext: 0, right, left, block });
  }
  const findRight = (p, j) => {
    let r = j;
    while (p.right[r] !== r) r = p.right[r];
    while (p.right[j] !== r) {
      const next = p.right[j];
      p.right[j] = r;
      j = next;
    }
    return r;
  };
  const findLeft = (p, j) => {
    let r = j + 1;
    while (p.left[r] !== r) r = p.left[r];
    let x = j + 1;
    while (p.left[x] !== r) {
      const next = p.left[x];
      p.left[x] = r;
      x = next;
    }
    return r - 1;
  };
  const take = (p, j) => {
    p.right[j] = j + 1;
    p.left[j + 1] = j;
    return p.dated[j].b;
  };
  const pairs = [];
  for (const a of as) {
    const p = pools.get(a.amount);
    if (!p) continue;
    const n = p.dated.length;
    let b;
    if (!Number.isNaN(a.day) && n > 0) {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (p.dated[mid].b.day < a.day) lo = mid + 1;
        else hi = mid;
      }
      const r = findRight(p, lo);
      const l0 = findLeft(p, lo - 1);
      const l = l0 >= 0 ? findRight(p, p.block[l0]) : -1;
      const dr = r < n ? p.dated[r].b.day - a.day : Number.POSITIVE_INFINITY;
      const dl = l >= 0 ? a.day - p.dated[l].b.day : Number.POSITIVE_INFINITY;
      if (r < n || l >= 0) {
        const pickRight = dr < dl || dr === dl && r < n && (l < 0 || p.dated[r].i < p.dated[l].i);
        b = take(p, pickRight ? r : l);
      }
    }
    if (!b && p.uNext < p.undated.length) b = p.undated[p.uNext++];
    if (!b && n > 0) {
      const r = findRight(p, 0);
      if (r < n) b = take(p, r);
    }
    if (b) pairs.push({ a, b, by: "amount" });
  }
  return finish(as, bs, pairs);
}
function pairByReference(as, bs) {
  const withRef = (r) => r.refKey !== "";
  const p1 = pairByKey(as.filter(withRef), bs.filter(withRef), (r) => `${r.refKey}|${r.amount}`, "reference");
  const p2 = pairByKey(p1.restA, p1.restB, (r) => r.refKey, "reference");
  return finish(as, bs, [...p1.pairs, ...p2.pairs]);
}
function pairRest(as, bs, pair, refsApart) {
  if (!refsApart) return pair(as, bs);
  const p1 = pair(as.filter((r) => r.refKey !== ""), bs.filter((r) => r.refKey === ""));
  const usedB = new Set(p1.pairs.map((p) => p.b));
  const p2 = pair(as.filter((r) => r.refKey === ""), bs.filter((b) => !usedB.has(b)));
  return finish(as, bs, [...p1.pairs, ...p2.pairs]);
}
function partnerCount(xs, ys, key, keyOfPartner) {
  const pool = /* @__PURE__ */ new Map();
  for (const y of ys) pool.set(keyOfPartner(y), (pool.get(keyOfPartner(y)) ?? 0) + 1);
  let n = 0;
  for (const x of xs) {
    const k = key(x);
    const left = pool.get(k) ?? 0;
    if (left > 0) {
      pool.set(k, left - 1);
      n++;
    }
  }
  return n;
}
function rowWords(r) {
  return `row ${r.rowNumber}${r.date ? ` ${r.date}` : ""}${r.reference ? ` ref ${shortText(r.reference, 20)}` : ""}${r.description ? ` "${shortText(r.description, 30)}"` : ""} ${formatUSD(r.amount)}`;
}
function listName(value, fallback) {
  return typeof value === "string" && value !== "" ? shortText(value, 60) : fallback;
}
var twoListsReconcile = {
  name: "check_two_lists_reconcile",
  page: "agents",
  section: "general",
  kind: "check",
  title: "Reconcile two lists: matched, unmatched and differing items",
  description: 'Use it to check figures an assistant, a spreadsheet or another tool produced: two lists that should ' +
    'hold the same items, such as a bank statement and a ledger, or invoices and payments received (.csv ' +
    'or .xlsx files, or CSV text). By reference, rows with the same reference pair (two that differ in amount ' +
    'are a difference) and rows without one pair by amount and date; or it pairs by amount and date, or by ' +
    'amount alone. Every row is placed exactly once, the difference between the totals is shown to equal ' +
    'what is only in each list plus the amount differences, worked out a second way, and each total line ' +
    'a list holds (a first cell starting "Total", or a cell that is just "Total", "Subtotal" or "Grand total") ' +
    'is checked against its rows. These fail and ask: a "Sum" row, a balance or net line, Debit and Credit ' +
    'words beside unsigned amounts, dates that read two ways, figures above the header. Verified only when ' +
    'nothing is unmatched or differs. Not for duplicates within one list.',
  question: "Do my bank statement and my ledger for March agree? Here are both files.",
  inputs: [
    { name: "listA", kind: "file", label: "First list", description: `A .csv or .xlsx file (a path), or the CSV text itself: one header row, then one row per item (100,000 at most) with an amount column (or money out and money in columns, amounts without a sign). A reference (check number, invoice number, transaction id), a date and a description column are used when present. Rows starting "Total", and rows with a cell that is just "Total", are the list's own totals and are checked against its rows.`, required: true },
    { name: "listB", kind: "file", label: "Second list", description: "The list to compare with the first, in the same form; its columns and their order need not match the first list's.", required: true },
    { name: "nameA", kind: "text", label: "Name of the first list", description: 'Optional. What the first list is, such as "bank statement", used in the result. Without it, "list A".', required: false },
    { name: "nameB", kind: "text", label: "Name of the second list", description: 'Optional. What the second list is, such as "ledger", used in the result. Without it, "list B".', required: false },
    { name: "matchBy", kind: "choice", label: "Match by", choices: MATCH_MODES, description: 'Optional. "reference": rows with the same reference pair, and rows with no reference pair by amount and date (or amount); two rows whose references differ never pair. "amount and date": the same amount on the same day. "amount": the same amount, nearest date first. Without it: reference when both lists have a reference column and share at least one reference, otherwise amount and date when both have dates, otherwise amount.', required: false },
    { name: "reverseSignsB", kind: "boolean", label: "Second list signs reversed", description: "Optional. true when the second list writes amounts with the opposite sign from the first (money in negative where the first list has it positive): its amounts are read the other way round.", required: false },
    { name: "signsA", kind: "text", label: "Sign column of the first list", description: 'Optional, when the check asks for it: the first list has a column of words such as Debit and Credit beside amounts written without a sign. Write "<column>: <word> = minus" (for example "Type: Debit = minus") to read those rows as money out, or "<column> = none" to read the amounts as written.', required: false },
    { name: "signsB", kind: "text", label: "Sign column of the second list", description: 'Optional, the same for the second list, for example "Dr/Cr: Dr = minus".', required: false },
    { name: "dateOrder", kind: "choice", label: "Date order", choices: DATE_ORDERS, description: 'Optional, when the check asks for it: how dates written with slashes read in both lists, "month first" (03/04/2026 is March 4) or "day first" (3 April). Dates written 2026-03-04 are not affected.', required: false },
    listColumnsInput("First list", "columnsA"),
    listColumnsInput("Second list", "columnsB")
  ],
  limits: "free",
  notAdvice: "Mathproven pairs the rows of the two lists and adds up what is left over; it does not say which list is right or what to do about a difference.",
  // Two lists that do not agree are the finding, not a fault in the arithmetic: the pairing is shown, marked not verified.
  comparisonChecks: ["lists-agree"],
  run({ files, values }) {
    const nameA = listName(values.nameA, "list A");
    const nameB = listName(values.nameB, "list B");
    const dateOrder = values.dateOrder === "day first" ? "dmy" : values.dateOrder === "month first" ? "mdy" : void 0;
    const text = (v) => typeof v === "string" ? v.trim() : "";
    const A = readList(oneFile(files, "listA"), values.columnsA, nameA, "columnsA", false, text(values.signsA), "signsA", dateOrder);
    const B = readList(oneFile(files, "listB"), values.columnsB, nameB, "columnsB", values.reverseSignsB === true, text(values.signsB), "signsB", dateOrder);
    const canRef = A.hasReference && B.hasReference;
    const canDate = A.hasDate && B.hasDate;
    const plain = canDate ? "amount and date" : "amount";
    const requested = values.matchBy;
    const lacking = (need) => [A, B].filter((l) => need === "reference" ? !l.hasReference : !l.hasDate).map((l) => `the ${l.name} (${l.fileName}) has none (headers: ${l.headers})`).join("; ");
    if (requested === "reference" && !canRef) throw new AgentInputError(`Matching by reference needs a filled reference column in both lists: ${lacking("reference")}. Name it with "columnsA" or "columnsB" ("Reference = <header>"), or match by amount and date, or amount.`);
    if (requested === "amount and date" && !canDate) throw new AgentInputError(`Matching by amount and date needs a date column in both lists: ${lacking("date")}. Name it with "columnsA" or "columnsB" ("Date = <header>"), or match by amount.`);
    let mode = requested ?? plain;
    let note = "";
    let first = { pairs: [], restA: A.rows, restB: B.rows };
    if (requested === "reference" || requested === void 0 && canRef) {
      const byRef = pairByReference(A.rows, B.rows);
      if (requested === void 0 && byRef.pairs.length === 0) {
        note = ` Both lists have a reference column, but no reference is in both, so the references were set aside and rows were matched by ${plain}.`;
        mode = plain;
      } else {
        mode = "reference";
        first = byRef;
      }
    }
    const fallback = mode === "reference" ? plain : mode;
    const byFallback = (x, y) => fallback === "amount and date" ? pairByKey(x, y, (r) => `${r.amount}|${r.date}`, "amount and date") : pairByAmount(x, y);
    const second = pairRest(first.restA, first.restB, byFallback, mode === "reference");
    const allPairs = [...first.pairs, ...second.pairs];
    const matched = allPairs.filter((p) => p.a.amount === p.b.amount).sort((x, y) => x.a.rowNumber - y.a.rowNumber);
    const differ = allPairs.filter((p) => p.a.amount !== p.b.amount).sort((x, y) => x.a.rowNumber - y.a.rowNumber);
    const onlyA = second.restA;
    const onlyB = second.restB;
    const totalA = addUp(A.rows.map((r) => r.amount), `The amounts of the ${nameA}`);
    const totalB = addUp(B.rows.map((r) => r.amount), `The amounts of the ${nameB}`);
    const difference = totalA - totalB;
    const sumOnlyA = addUpBig(onlyA.map((r) => r.amount));
    const sumOnlyB = addUpBig(onlyB.map((r) => r.amount));
    const sumDiffer = addUpBig(differ.map((p) => p.a.amount - p.b.amount));
    const explained = bigCents(sumOnlyA - sumOnlyB + sumDiffer, "The difference between the lists");
    const oa = bigCents(sumOnlyA, `What is only in the ${nameA}`);
    const ob = bigCents(sumOnlyB, `What is only in the ${nameB}`);
    const dd = bigCents(sumDiffer, "The amount differences");
    const checks = new CheckList();
    const accounted = (list, side, only) => {
      const placed = /* @__PURE__ */ new Map();
      for (const p of allPairs) {
        const r = side === "a" ? p.a : p.b;
        placed.set(r, (placed.get(r) ?? 0) + 1);
      }
      for (const r of only) placed.set(r, (placed.get(r) ?? 0) + 1);
      let count = 0;
      for (const n of placed.values()) count += n;
      const once = list.rows.filter((r) => placed.get(r) === 1).length;
      const passed = once === list.rows.length && count === list.rows.length;
      checks.add({
        id: `accounted-${side}`,
        label: `Every row read from the ${list.name} is placed exactly once: matched, matched with a different amount, or only in the ${list.name}`,
        passed,
        severity: "error",
        expected: `${list.rows.length} row(s)`,
        actual: `${count} placement(s), ${once} row(s) placed once`
      });
    };
    accounted(A, "a", onlyA);
    accounted(B, "b", onlyB);
    checks.cents("difference-explained", `The ${nameA} total minus the ${nameB} total equals what is only in the ${nameA}, minus what is only in the ${nameB}, plus the amount differences (added a second way)`, difference, explained);
    const agree = onlyA.length === 0 && onlyB.length === 0 && differ.length === 0;
    const why = [];
    if (onlyA.length) why.push(`${onlyA.length} row(s) only in the ${nameA}: ${listOf(onlyA.map(rowWords), 10)}`);
    if (onlyB.length) why.push(`${onlyB.length} row(s) only in the ${nameB}: ${listOf(onlyB.map(rowWords), 10)}`);
    if (differ.length) why.push(`${differ.length} pair(s) with the same reference and different amounts: ${listOf(differ.map((p) => `ref ${shortText(p.a.reference, 20)}, ${nameA} row ${p.a.rowNumber} ${formatUSD(p.a.amount)} against ${nameB} row ${p.b.rowNumber} ${formatUSD(p.b.amount)} (off by ${formatUSD(p.a.amount - p.b.amount)})`), 10)}`);
    if (!agree) {
      why.push(`The ${nameA} totals ${formatUSD(totalA)} and the ${nameB} ${formatUSD(totalB)}, a difference of ${formatUSD(difference)}: ${formatUSD(oa)} only in the ${nameA}, minus ${formatUSD(ob)} only in the ${nameB}, plus ${formatUSD(dd)} in amount differences`);
      const opposite = partnerCount(onlyA, onlyB, (r) => String(-r.amount), (r) => String(r.amount));
      if (opposite > 0) why.push(`${opposite} row(s) only in the ${nameA} have a row only in the ${nameB} of the same amount with the opposite sign (reverseSignsB reads the ${nameB}'s amounts the other way round)`);
      const sameAmount = partnerCount(onlyA, onlyB, (r) => String(r.amount), (r) => String(r.amount));
      if (sameAmount > 0 && mode === "reference") why.push(`${sameAmount} row(s) only in the ${nameA} have a row only in the ${nameB} of the same amount under a different reference; rows with different references are not paired`);
      else if (sameAmount > 0 && fallback === "amount and date") why.push(`${sameAmount} row(s) only in the ${nameA} have a row only in the ${nameB} of the same amount on another date (matchBy "amount" pairs by amount alone, nearest date first)`);
    }
    checks.add({
      id: "lists-agree",
      label: `The two lists agree: every row of the ${nameA} pairs with a row of the ${nameB} of the same amount, and nothing is left over`,
      passed: agree,
      severity: "error",
      expected: "nothing unmatched, nothing differing",
      actual: `${onlyA.length} only in the ${nameA}, ${onlyB.length} only in the ${nameB}, ${differ.length} with different amounts`,
      ...agree ? {} : { detail: `${why.join(". ")}.` }
    });
    for (const [list, side] of [[A, "a"], [B, "b"]]) {
      if (list.totalLines.length === 0) continue;
      const fails = totalLineFails(list);
      checks.add({
        id: `list-total-${side}`,
        label: `The ${list.name}'s own total line(s) (${listOf(list.totalLines.map((t) => `row ${t.rowNumber}`), 10)}) equal its rows added up`,
        passed: fails.length === 0,
        severity: "error",
        expected: `${list.totalLines.length} of ${list.totalLines.length} total line(s)`,
        actual: `${list.totalLines.length - fails.length} of ${list.totalLines.length} total line(s)`,
        ...fails.length ? { detail: listOf(fails) } : {}
      });
    }
    for (const [list, side] of [[A, "a"], [B, "b"]]) {
      if (list.above.length > 0) {
        checks.add({
          id: `rows-above-header-${side}`,
          label: `No figure lies above the header row of the ${list.name}`,
          passed: false,
          severity: "error",
          detail: `The header row of the ${list.name} was taken to be row ${list.headerRow + 1}, and ${listOf(list.above.map((r) => `row ${r.rowNumber} (${r.cells.filter(filled).map((c) => shortText(c, 20)).join(", ")})`), 6)} above it ${list.above.length === 1 ? "holds" : "hold"} figures that were not read. Give the list as one header row with its rows under it (a statement's opening lines removed), so nothing in it is passed over.`
        });
      }
      if (list.signAsk) {
        const minusWord = list.signAsk.words.find((w) => /debit|dr|out|withdraw|charge|payment|minus|^-$/i.test(w)) ?? list.signAsk.words[0];
        checks.add({
          id: `sign-column-${side}`,
          label: `Every amount of the ${list.name} carries its own sign`,
          passed: false,
          severity: "error",
          detail: `The ${list.name}'s column ${list.signAsk.col} holds only words like ${list.signAsk.words.map((w) => `"${w}"`).join(", ")} beside amounts written without a sign, so some rows may be money out. Say how with "signs${side.toUpperCase()}", for example "${list.signAsk.col}: ${minusWord} = minus", or "${list.signAsk.col} = none" to read the amounts as written.`
        });
      }
    }
    if (fallback === "amount and date" && dateOrder === void 0 && (A.dateAmbiguous || B.dateAmbiguous)) {
      checks.add({
        id: "date-order",
        label: "Every date used to pair rows reads one way only",
        passed: false,
        severity: "error",
        detail: `${[A, B].filter((l) => l.dateAmbiguous).map((l) => `In the ${l.name}, ${l.dateAmbiguous}`).join("; ")}, and no date in the list tells which. Rows are paired by date, so say how the dates read with "dateOrder" ("month first" or "day first").`
      });
    }
    if (mode !== "reference" && requested !== void 0 && canRef) {
      const crossed = second.pairs.filter((p) => p.a.refKey !== "" && p.b.refKey !== "" && p.a.refKey !== p.b.refKey);
      checks.that(
        "references-differ",
        "Rows paired by amount carry the same reference where both lists give one",
        crossed.length === 0,
        `${crossed.length} pair(s) were matched by ${fallback}, as asked, although their references differ: ${listOf(crossed.map((p) => `${nameA} row ${p.a.rowNumber} ref ${shortText(p.a.reference, 20)} with ${nameB} row ${p.b.rowNumber} ref ${shortText(p.b.reference, 20)}`), 10)}`,
        "warning"
      );
    }
    for (const [list, side] of [[A, "a"], [B, "b"]]) {
      checks.addAll(sheetRowChecks(list.problems, list.leftOut).map((c) => ({ ...c, id: `${c.id}-${side}`, label: `${c.label} (${list.name})` })));
    }
    const both = (x, y) => x === y ? x : `${x} / ${y}`;
    const matchedTable = [
      [`Row in ${nameA}`, `Row in ${nameB}`, "Matched by", "Date", "Reference", "Description", "Amount"],
      ...matched.map((p) => [p.a.rowNumber, p.b.rowNumber, p.by, both(p.a.date, p.b.date), both(p.a.reference, p.b.reference), p.a.description || p.b.description, toDecimal(p.a.amount)])
    ];
    const onlyTable = (only) => [["Row", "Date", "Reference", "Description", "Amount"], ...only.map((r) => [r.rowNumber, r.date, r.reference, r.description, toDecimal(r.amount)])];
    const differTable = [
      [`Row in ${nameA}`, `Row in ${nameB}`, "Reference", "Date", `Amount in ${nameA}`, `Amount in ${nameB}`, "Difference"],
      ...differ.map((p) => [p.a.rowNumber, p.b.rowNumber, both(p.a.reference, p.b.reference), both(p.a.date, p.b.date), toDecimal(p.a.amount), toDecimal(p.b.amount), toDecimal(p.a.amount - p.b.amount)])
    ];
    const summaryTable = [
      ["Line", "Amount"],
      [`Total of the ${nameA} (${A.rows.length} rows)`, toDecimal(totalA)],
      [`Total of the ${nameB} (${B.rows.length} rows)`, toDecimal(totalB)],
      [`Difference (${nameA} minus ${nameB})`, toDecimal(difference)],
      [`Explained by: only in the ${nameA} (${onlyA.length} rows)`, toDecimal(oa)],
      [`Explained by: only in the ${nameB}, taken away (${onlyB.length} rows)`, toDecimal(-ob)],
      [`Explained by: amount differences (${differ.length} pairs)`, toDecimal(dd)],
      ["Explained difference", toDecimal(explained)]
    ];
    const how = mode === "reference" ? `reference (${first.pairs.length} pair(s)), then rows without a reference by ${fallback} (${second.pairs.length} pair(s))` : mode;
    const totalsChecked = [A, B].filter((l) => l.totalLines.length > 0).map((l) => `the ${l.name}'s ${l.totalLines.length} total line(s)`);
    const summary = `The ${nameA} (${A.fileName}): ${A.rows.length} row(s), total ${formatUSD(totalA)}. The ${nameB} (${B.fileName}): ${B.rows.length} row(s), total ${formatUSD(totalB)}. Matched by ${how}: ${matched.length} pair(s) of the same amount, ${differ.length} pair(s) with different amounts, ${onlyA.length} row(s) only in the ${nameA} and ${onlyB.length} only in the ${nameB}. ${agree ? "The two lists agree, and the totals are the same both ways." : `The lists do not agree; their totals differ by ${formatUSD(difference)}.`}${totalsChecked.length ? ` Checked against their rows: ${totalsChecked.join(" and ")}.` : ""}${values.reverseSignsB === true ? ` The ${nameB}'s amounts were read with their signs reversed.` : ""}${A.signNote}${B.signNote}${dateOrder ? ` Dates with slashes were read ${values.dateOrder}, as "dateOrder" says.` : ""}${note}`;
    return {
      summary,
      tables: [
        { name: "Matched", rows: matchedTable },
        { name: `Only in ${nameA}`, rows: onlyTable(onlyA) },
        { name: `Only in ${nameB}`, rows: onlyTable(onlyB) },
        { name: "Different amounts", rows: differTable },
        { name: "Summary", rows: summaryTable }
      ],
      checks: checks.all
    };
  },
  examples: [
    {
      label: "A March bank statement and ledger: seven rows each, two checks matched by number and dated apart, the rest by amount and date",
      args: { listA: "agents-fixture:general/bank-march.csv", listB: "agents-fixture:general/ledger-march.csv", nameA: "bank statement", nameB: "ledger" },
      verified: true,
      contains: ["$1,808.02", "1808.02", "7 pair(s) of the same amount", "reference (2 pair(s))"]
    },
    {
      label: "A ledger missing the bank fee, with check 1042 entered as $1,020.00, is not verified and names both",
      args: {
        listA: "agents-fixture:general/bank-march.csv",
        listB: "Date,Ref,Memo,Amount\n2026-03-02,,Customer deposit,2500.00\n2026-03-01,1041,Rent,-450.00\n2026-03-05,,Office supplies,-89.99\n2026-03-06,1042,Payroll,-1020.00\n2026-03-12,,Customer deposit,1150.00\n2026-03-20,,Office supplies,-89.99\n",
        nameA: "bank statement",
        nameB: "ledger"
      },
      verified: false,
      failedCheck: "lists-agree",
      contains: ["Service fee", "ref 1042", "-$192.00", "They are NOT a verified result"]
    }
  ]
};
var GENERAL = [totalAgainstParts, tableCrossFoot, twoListsReconcile];

export {
  GENERAL
};
