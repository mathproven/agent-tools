// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  failures,
  passedAll,
  warnings
} from "./money.mjs";

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

export {
  isVerified,
  SITE_URL,
  present
};
