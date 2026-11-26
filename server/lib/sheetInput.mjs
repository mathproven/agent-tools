// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
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

export {
  sheetIsTotalWord,
  sheetRowChecks,
  sheetNormalizeHeader,
  sheetGuessColumns,
  sheetDataRows,
  sheetCell,
  scaledParse,
  scaledParseNumber,
  scaledFormat
};
