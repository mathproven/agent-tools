// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AgentInputError,
  PROPERTY_MANAGEMENT,
  beginColumnLog,
  checkValue,
  parseCivilDate,
  readXlsx,
  takeColumnLog,
  writeXlsx
} from "./lib/property-management.mjs";
import "./lib/strPayout.mjs";
import "./lib/camGrossUp.mjs";
import "./lib/expenseStop.mjs";
import {
  CheckList,
  certificateText,
  certify,
  failures,
  formatUSD,
  passedAll,
  warnings
} from "./lib/money.mjs";

// packages/agents/src/cli.ts
import { webcrypto } from "node:crypto";

// packages/agents/src/files.ts
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

// packages/core/src/csv.ts
var PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
var FORMULA_START = /^[=+\-@\t\r]/;
function guardCell(value) {
  if (PLAIN_NUMBER.test(value)) return value;
  return FORMULA_START.test(value) ? `'${value}` : value;
}
function encodeCell(cell, formulaGuard) {
  if (cell === null || cell === void 0) return "";
  let s = typeof cell === "number" ? String(cell) : cell;
  if (formulaGuard) s = guardCell(s);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, options = {}) {
  const guard = options.formulaGuard ?? true;
  const eol = options.lineEnding ?? "\r\n";
  return rows.map((row2) => row2.map((c) => encodeCell(c, guard)).join(",")).join(eol) + eol;
}
function parseCsv(text) {
  const rows = [];
  let row2 = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && /^[ \t]*$/.test(field)) {
      field = "";
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row2.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row2.push(field);
      rows.push(row2);
      row2 = [];
      field = "";
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row2.length > 0) {
    row2.push(field);
    rows.push(row2);
  }
  return rows;
}

// packages/agents/src/files.ts
var MAX_FILE_BYTES = 50 * 1024 * 1024;
function firstFilled(sheets) {
  const filled = sheets.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  return filled ? filled.rows : [];
}
function fromCsvText(text, name) {
  const clean = text.replace(/^﻿/, "");
  const rows = parseCsv(clean);
  const sheets = [{ name, rows }];
  return { name, sheets, rows: firstFilled(sheets) };
}
function looksLikeCsvText(value) {
  const v = value.trim();
  if (/\r?\n/.test(v)) return true;
  if (!v.includes(",") || existsSync(v)) return false;
  const pathLike = /\.(csv|xlsx|xls|txt)$/i.test(v) || /[\\/]/.test(v);
  return !pathLike;
}
function readFileArgument(value) {
  if (looksLikeCsvText(value)) return fromCsvText(value, "pasted CSV");
  const path = resolve(value.trim());
  if (!existsSync(path)) throw new AgentInputError(`No file at "${value}". Give the path to a .csv or .xlsx file on this computer, or the CSV text itself.`);
  const st = statSync(path);
  if (!st.isFile()) throw new AgentInputError(`"${value}" is a folder, not a file.`);
  if (st.size > MAX_FILE_BYTES) throw new AgentInputError(`"${basename(path)}" is larger than 50 MB.`);
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  if (ext === ".csv" || ext === ".txt") return fromCsvText(readFileSync(path, "utf8"), name);
  if (ext === ".xlsx") {
    let sheets;
    try {
      sheets = readXlsx(new Uint8Array(readFileSync(path)));
    } catch (err) {
      throw new AgentInputError(`"${name}" could not be read as an .xlsx workbook (${err instanceof Error ? err.message : "unreadable"}).`);
    }
    return { name, sheets, rows: firstFilled(sheets) };
  }
  if (ext === ".xls") throw new AgentInputError(`"${name}" is an old .xls workbook. Save it as .xlsx or .csv first.`);
  throw new AgentInputError(`"${name}" is not a .csv or .xlsx file.`);
}
function saveProblem(path) {
  const full = resolve(path.trim());
  if (existsSync(full)) return `A file is already at "${full}". Give a new file name; nothing was replaced.`;
  if (!existsSync(dirname(full))) return `The folder "${dirname(full)}" does not exist, so nothing could be saved there.`;
  return "";
}
function saveFile(path, bytes) {
  const full = resolve(path.trim());
  if (existsSync(full)) throw new AgentInputError(`A file is already at "${full}". Give a new file name; nothing was replaced.`);
  writeFileSync(full, bytes, { flag: "wx" });
  return full;
}

// packages/core/src/license.ts
var LICENSE_PREFIX = "th1";
var LICENSE_MAX_SECONDS_AHEAD = 40 * 86400;
function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function verifyLicenseKey(key, publicKeyJwk, nowSeconds) {
  if (!publicKeyJwk) return null;
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return null;
  try {
    const publicKey = await globalThis.crypto.subtle.importKey("jwk", publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    if (claims.plan !== "pro" && claims.plan !== "firm" || !Number.isSafeInteger(claims.exp)) return null;
    const exp = claims.exp;
    if (exp <= nowSeconds) return null;
    if (exp - nowSeconds > LICENSE_MAX_SECONDS_AHEAD) return null;
    return { plan: claims.plan, exp };
  } catch {
    return null;
  }
}

// packages/agents/src/publicKey.ts
var LICENSE_PUBLIC_KEY = {
  kty: "EC",
  crv: "P-256",
  x: "awxbKSQo8sU9VXdPERV0E8JN2zy7OL_DcqRccYVpuqc",
  y: "tvxiXTMZ8O-nmzNHKEpnzXx5Gd7u8YfxSt0nseKN9J8"
};

// packages/agents/src/license.ts
async function planFromKey(key, now, publicKey = LICENSE_PUBLIC_KEY) {
  const k = (key ?? "").trim();
  if (k === "") return { plan: "free", keyProblem: "", expires: "" };
  const claims = await verifyLicenseKey(k, publicKey, Math.floor(now.getTime() / 1e3));
  if (!claims) {
    return {
      plan: "free",
      keyProblem: "The key given is not a current Mathproven key (expired, mistyped, or not issued by mathproven.com), so the free plan applies. A fresh key is on the account page at https://mathproven.com/account/.",
      expires: ""
    };
  }
  return { plan: claims.plan, keyProblem: "", expires: new Date(claims.exp * 1e3).toISOString().slice(0, 10) };
}

// packages/agents/src/limits.ts
var FREE_RUNS_PER_MONTH = 3;
var FILES_PER_RUN = { free: 1, pro: 25, firm: Number.POSITIVE_INFINITY };
var PLANS_INFO_URL = "https://mathproven.com/agents/#plans";
function tooManyFilesMessage(plan, given, allowed = FILES_PER_RUN[plan]) {
  const more = plan === "free" ? "the Pro and Firm plans" : "the Firm plan";
  return `${given} files were given and this run's plan reads ${allowed} a run. Reading more files in one run is part of ${more}, which take the key from a Mathproven account page (${PLANS_INFO_URL}). Run the files in smaller groups instead.`;
}
function monthUsedMessage(tool, month) {
  return `This computer has used its ${FREE_RUNS_PER_MONTH} free runs of ${tool} for ${month}. More runs a month are part of the Pro and Firm plans, which take the key from a Mathproven account page (${PLANS_INFO_URL}). The count starts again next month.`;
}
function monthOf(now) {
  return now.toISOString().slice(0, 7);
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

// packages/agents/src/runner.ts
var SAVE_TO = {
  name: "saveTo",
  kind: "text",
  label: "Save the result to",
  description: "Optional. A path on this computer ending .xlsx or .csv: the full result and its certificate are saved there (never over an existing file). Only a verified result is saved.",
  required: false
};
var TEMPLATE_SAVE_TO = {
  name: "saveTo",
  kind: "text",
  label: "Save the workbook to",
  description: "Optional. A path on this computer ending .xlsx for the blank workbook (never over an existing file). Without it the workbook is saved under its own name in the current folder.",
  required: false
};
var KEY = {
  name: "key",
  kind: "text",
  label: "Mathproven key",
  description: 'Optional. The key from a Mathproven account page (it starts "th1."), for a Pro or Firm plan. Checked on this computer; it is never sent anywhere.',
  required: false
};
function inputsOf(entry, opts = {}) {
  const out = [...entry.inputs];
  if (entry.kind === "template") out.push(TEMPLATE_SAVE_TO);
  else if (entry.kind !== "lookup") {
    const own = entry.fileExtensions ?? [];
    out.push(own.length === 0 ? SAVE_TO : { ...SAVE_TO, description: `Optional. A path on this computer ending .xlsx or .csv (the full result and its certificate), or ${own.join(" or ")} (the file the page itself downloads). Never saved over an existing file; only a verified result is saved.` });
  }
  if (entry.limits === "site" && !opts.keyless) out.push(KEY);
  return out;
}
function refused(entry, message, note = "") {
  const text = `Mathproven, ${entry.title}: not run. ${message}`;
  return { ok: false, verified: false, text: note ? [note, text].join("\n\n") : text };
}
function fileValues(input, value) {
  const list = Array.isArray(value) ? value : [value];
  if (input.kind === "file" && list.length !== 1) throw new AgentInputError(`"${input.name}" (${input.label}) takes one file.`);
  if (list.length === 0) throw new AgentInputError(`"${input.name}" (${input.label}) has no file in it.`);
  return list.map((v) => {
    if (typeof v !== "string" || v.trim() === "") throw new AgentInputError(`"${input.name}" (${input.label}) must be a path to a .csv or .xlsx file, or the CSV text itself.`);
    return v;
  });
}
var SHEET_NAME_BAD = /[\\/?*[\]:]/g;
function sheetName(name, used) {
  const base = (name.replace(SHEET_NAME_BAD, " ").trim() || "Sheet").slice(0, 31);
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}
function resultFile(path, tables, certificate) {
  const lower = path.toLowerCase();
  const certRows = certificate.split("\n").map((l) => [l]);
  if (lower.endsWith(".xlsx")) {
    const used = /* @__PURE__ */ new Set();
    const sheets = tables.map((t) => ({ name: sheetName(t.name, used), rows: t.rows }));
    sheets.push({ name: sheetName("Certificate", used), rows: certRows });
    return writeXlsx(sheets);
  }
  if (lower.endsWith(".csv")) {
    const rows = [];
    for (const t of tables) {
      rows.push([t.name]);
      for (const r of t.rows) rows.push([...r]);
      rows.push([]);
    }
    for (const r of certRows) rows.push(r);
    return new TextEncoder().encode(toCsv(rows));
  }
  throw new AgentInputError(`"saveTo" must end .xlsx or .csv: "${path}".`);
}
async function runEntry(entry, rawArgs, ctx) {
  if (rawArgs !== void 0 && rawArgs !== null && (typeof rawArgs !== "object" || Array.isArray(rawArgs))) return refused(entry, "The arguments must be an object of named inputs.");
  const args = rawArgs ?? {};
  const inputs = inputsOf(entry, { keyless: ctx.keyless });
  const known = new Set(inputs.map((i) => i.name));
  const unknown = Object.keys(args).filter((k) => !known.has(k));
  if (unknown.length > 0) return refused(entry, `Unknown input(s): ${unknown.join(", ")}. This tool takes: ${inputs.map((i) => i.name).join(", ")}.`);
  const given = (name) => args[name] !== void 0 && args[name] !== null && !(typeof args[name] === "string" && args[name].trim() === "");
  const missing = inputs.filter((i) => i.required && !given(i.name));
  if (missing.length > 0) return refused(entry, `Needed and not given: ${missing.map((i) => `"${i.name}" (${i.label}: ${i.description})`).join("; ")}`);
  const keyText = ctx.keyless ? void 0 : given("key") ? String(args.key) : ctx.key;
  const planCheck = ctx.plan ? { plan: ctx.plan, keyProblem: "", expires: "" } : await planFromKey(keyText, ctx.now);
  const note = planCheck.keyProblem;
  const plan = entry.limits === "site" ? planCheck.plan : "firm";
  let saveTo = "";
  if (given("saveTo")) {
    if (typeof args.saveTo !== "string") return refused(entry, '"saveTo" must be a path written as text.', note);
    saveTo = args.saveTo.trim();
    const wanted = entry.kind === "template" ? [".xlsx"] : [".xlsx", ".csv", ...entry.fileExtensions ?? []];
    if (!wanted.some((ext) => saveTo.toLowerCase().endsWith(ext))) return refused(entry, `"saveTo" must end ${wanted.join(" or ")}: "${saveTo}".`, note);
    if (!ctx.writeFile) return refused(entry, 'Saving a file is not available here. Run it again without "saveTo".', note);
    const problem = ctx.saveProblem?.(saveTo) ?? "";
    if (problem) return refused(entry, problem, note);
  }
  const files = {};
  const values = {};
  try {
    for (const input of entry.inputs) {
      if (!given(input.name)) {
        values[input.name] = void 0;
        continue;
      }
      if (input.kind === "file" || input.kind === "files") {
        const list = fileValues(input, args[input.name]);
        const allowed = plan === "free" ? Math.max(FILES_PER_RUN.free, entry.freeFilesPerRun ?? 0) : FILES_PER_RUN[plan];
        if (list.length > allowed) return refused(entry, ctx.keyless ? `${list.length} files were given and this copy of the tool reads ${allowed} a run. Run the files in smaller groups.` : tooManyFilesMessage(plan, list.length, allowed), note);
        files[input.name] = list.map((v) => ctx.readFile(v));
      } else {
        values[input.name] = checkValue(input, args[input.name]);
      }
    }
  } catch (err) {
    return refused(entry, err instanceof Error ? err.message : "An input could not be read.", note);
  }
  const month = monthOf(ctx.now);
  const counted = entry.limits === "site" && plan === "free" && ctx.counter !== void 0;
  if (counted && ctx.counter.used(entry.name, month) >= FREE_RUNS_PER_MONTH) return refused(entry, monthUsedMessage(entry.title, month), note);
  let result;
  let columnsRead = [];
  beginColumnLog();
  try {
    result = entry.run({ files, values, now: ctx.now });
  } catch (err) {
    takeColumnLog();
    return refused(entry, err instanceof Error ? err.message : "The input could not be used.", note);
  }
  columnsRead = takeColumnLog();
  const verified = isVerified(result.checks);
  const cert = await certify(entry.name, ctx.version, result.checks, JSON.stringify(result.tables), ctx.now);
  const certText = certificateText(cert);
  let savedTo = null;
  let saveNote = "";
  if (verified && entry.kind === "template" && result.file) {
    if (!ctx.writeFile) return refused(entry, "The workbook is made as a file, and saving files is not available where this ran. Run it where files can be saved (Claude Code, Cowork on this computer, or the local server), or download it from the web page.", note);
    const target = saveTo !== "" ? saveTo : result.file.suggestedName;
    try {
      savedTo = ctx.writeFile(target, result.file.bytes);
    } catch (err) {
      return refused(entry, err instanceof Error ? err.message : "The workbook could not be saved.", note);
    }
  } else if (verified && saveTo !== "") {
    try {
      const own = result.file !== void 0 && (entry.fileExtensions ?? []).some((ext) => saveTo.toLowerCase().endsWith(ext.toLowerCase()));
      savedTo = ctx.writeFile(saveTo, own ? result.file.bytes : resultFile(saveTo, result.tables, certText));
    } catch (err) {
      return refused(entry, err instanceof Error ? err.message : "The file could not be saved.", note);
    }
  } else if (!verified && saveTo !== "") {
    saveNote = "Nothing was saved: only a verified result is saved.";
  }
  if (counted) ctx.counter.add(entry.name, month);
  const shown = present(entry, result, ctx.ref, certText, savedTo, columnsRead);
  const text = [note, shown.text, saveNote].filter((s) => s !== "").join("\n\n");
  return { ok: true, verified: shown.verified, text, structured: shown.structured };
}

// packages/agents/src/version.ts
var AGENTS_VERSION = "0.1.0";

// packages/agents/src/cli.ts
var DEFAULT_SCRIPT = "scripts/mathproven.mjs";
var BOOLEAN_WORDS = /^(true|false|yes|no)$/i;
function parseFlags(tokens, kinds = /* @__PURE__ */ new Map()) {
  const flags = {};
  let stray = 0;
  const noValue = [];
  const put = (name, value) => {
    const had = flags[name];
    if (had === void 0) flags[name] = value;
    else flags[name] = Array.isArray(had) ? [...had, value] : [had, value];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--") || token === "--") {
      stray++;
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq > 0) {
      put(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = tokens[i + 1];
    const kind = body === "json" ? "text" : kinds.get(body);
    if (kind === "boolean") {
      if (next !== void 0 && BOOLEAN_WORDS.test(next)) {
        put(body, next);
        i++;
      } else put(body, true);
    } else if (kind !== void 0) {
      if (next === void 0) noValue.push(body);
      else {
        put(body, next);
        i++;
      }
    } else if (next === void 0 || next.startsWith("--")) put(body, true);
    else {
      put(body, next);
      i++;
    }
  }
  return { flags, stray, noValue };
}
function inputPlaceholder(input) {
  switch (input.kind) {
    case "file":
      return "<path to a .csv or .xlsx file>";
    case "files":
      return "<path to a .csv or .xlsx file>";
    case "amount":
      return "<amount, such as 1,234.56>";
    case "amounts":
      return '["<amount>","<amount>"]';
    case "date":
      return "<YYYY-MM-DD>";
    case "year":
      return "<YYYY>";
    case "number":
      return "<number>";
    case "choice":
      return `<${(input.choices ?? []).join("|")}>`;
    case "boolean":
      return "<true|false>";
    case "text":
      return "<text>";
  }
}
function quoted(text) {
  return `'${text.replace(/'/g, "'\\''")}'`;
}
function commandLine(entry, script = DEFAULT_SCRIPT) {
  const parts = ["node", script, entry.name];
  for (const input of entry.inputs) {
    if (!input.required) continue;
    parts.push(`--${input.name}`, quoted(inputPlaceholder(input)));
  }
  return parts.join(" ");
}
function inputLine(input) {
  const many = input.kind === "files" || input.kind === "amounts" ? " (repeat the option for each one)" : "";
  return `--${input.name} ${inputPlaceholder(input)}  ${input.required ? "needed" : "optional"}. ${input.label}: ${input.description}${many}`;
}
function describeEntry(entry, options) {
  const script = options.script ?? DEFAULT_SCRIPT;
  return [
    `${entry.title} (${entry.name})`,
    "",
    entry.description,
    "",
    "Inputs:",
    ...inputsOf(entry, { keyless: options.keyless === true }).map((i) => `  ${inputLine(i)}`),
    "",
    "Run:",
    `  ${commandLine(entry, script)}`,
    "",
    `Every input can also be given as --<input>=<value> (for a value that starts with "--"), or all at once as --json '{"<input>": "<value>"}'.`
  ].join("\n");
}
function usage(options) {
  const script = options.script ?? DEFAULT_SCRIPT;
  const lines = [
    "Mathproven: verified paperwork math, run where your assistant runs. Nothing is sent to Mathproven.",
    "",
    `  node ${script} list                      the tools here`,
    `  node ${script} describe <tool>           a tool's inputs and its command`,
    `  node ${script} <tool> --<input> <value>  run a tool`,
    `  node ${script} <tool> --<input>=<value>  the same, for a value that starts with "--"`,
    `  node ${script} <tool> --json '<object>'  run a tool with its inputs as one JSON object`
  ];
  if (options.keyHelp) lines.push("", options.keyHelp);
  lines.push("", "Exit code 0: verified. 2: a check failed (NOT VERIFIED). 1: nothing was calculated.");
  return lines.join("\n");
}
function listText(entries2, json) {
  if (json) return JSON.stringify(entries2.map((e) => ({ name: e.name, title: e.title, kind: e.kind, section: e.section })));
  return entries2.map((e) => `${e.name}: ${e.title}`).join("\n");
}
function findEntry(entries2, name) {
  if (!name) return void 0;
  const want = name.trim().toLowerCase().replace(/-/g, "_");
  return entries2.find((e) => e.name === want);
}
function noSuchTool(entries2, name, options) {
  return { code: 1, text: `No tool named "${name}" here. The tools here are:
${listText(entries2, false)}

Run "node ${options.script ?? DEFAULT_SCRIPT} describe <tool>" for one tool's inputs.` };
}
function toolArgs(entry, flags, keyless = false) {
  const args = {};
  const json = flags.json;
  if (json !== void 0) {
    if (typeof json !== "string") return { problem: `--json takes one JSON object, such as --json '{"year": "2026"}'.` };
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { problem: `--json is not valid JSON. It takes one object, such as --json '{"year": "2026"}'.` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { problem: "--json takes one JSON object of named inputs." };
    Object.assign(args, parsed);
  }
  const inputs = inputsOf(entry, { keyless });
  const kinds = new Map(inputs.map((i) => [i.name, i.kind]));
  for (const [name, value] of Object.entries(flags)) {
    if (name === "json") continue;
    const many = kinds.get(name) === "files" || kinds.get(name) === "amounts";
    args[name] = Array.isArray(value) && !many ? value[value.length - 1] : value;
  }
  if (!keyless && !kinds.has("key")) delete args.key;
  return { args };
}
function ensureWebCrypto() {
  const g = globalThis;
  if (!g.crypto || !g.crypto.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
}
async function runCli(argv, options, now = /* @__PURE__ */ new Date()) {
  const entries2 = options.entries;
  const keyless = options.keyless === true;
  const [command, ...rest] = argv;
  if (command === void 0) return { code: 1, text: usage(options) };
  if (command === "help" || command === "--help" || command === "-h") return { code: 0, text: usage(options) };
  if (command === "list") return { code: 0, text: listText(entries2, rest.includes("--json")) };
  if (command === "describe") {
    const entry2 = findEntry(entries2, rest[0]);
    if (!entry2) return rest[0] ? noSuchTool(entries2, rest[0], options) : { code: 1, text: `Name a tool: node ${options.script ?? DEFAULT_SCRIPT} describe <tool>.

${listText(entries2, false)}` };
    return { code: 0, text: describeEntry(entry2, options) };
  }
  const entry = findEntry(entries2, command);
  if (!entry) return noSuchTool(entries2, command, options);
  const kinds = new Map(inputsOf(entry, { keyless }).map((i) => [i.name, i.kind]));
  const { flags, stray, noValue } = parseFlags(rest, kinds);
  if (stray > 0) return { code: 1, text: `Mathproven, ${entry.title}: not run. An unexpected word was given: every input is given as --<input> <value> (or --<input>=<value>).

${describeEntry(entry, options)}` };
  if (noValue.length > 0) return { code: 1, text: `Mathproven, ${entry.title}: not run. ${noValue.map((n) => `--${n}`).join(", ")} needs a value after it.` };
  const parsed = toolArgs(entry, flags, keyless);
  if ("problem" in parsed) return { code: 1, text: `Mathproven, ${entry.title}: not run. ${parsed.problem}` };
  ensureWebCrypto();
  const ctx = {
    now,
    ref: options.ref,
    version: options.version ?? AGENTS_VERSION,
    readFile: readFileArgument,
    saveProblem,
    writeFile: saveFile,
    ...keyless ? { keyless: true } : {}
  };
  try {
    const outcome = await runEntry(entry, parsed.args, ctx);
    return { code: !outcome.ok ? 1 : outcome.verified ? 0 : 2, text: outcome.text };
  } catch (err) {
    return { code: 1, text: `Mathproven, ${entry.title}: not run. ${err instanceof Error ? err.message : "The run stopped."}` };
  }
}
async function runCliProcess(options) {
  const result = await runCli(process.argv.slice(2), options);
  process.stdout.write(`${result.text}
`);
  process.exitCode = result.code;
}

// packages/core/src/reference/sourced.ts
var STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"]
];
var REF_US_STATES = STATES.map(([code, name]) => ({ code, name }));
var REF_US_STATES_DC = [...REF_US_STATES, { code: "DC", name: "District of Columbia" }].sort((a, b) => a.name.localeCompare(b.name));
function refMemberName(members, code) {
  return members.find((m) => m.code === code)?.name ?? code;
}
function refIsDay(text) {
  if (typeof text !== "string") return false;
  try {
    parseCivilDate(text);
    return true;
  } catch {
    return false;
  }
}
function refIsOfficialUrl(url, officialHosts = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host.endsWith(".gov") || host.endsWith(".us") || officialHosts.some((h) => host === h || host.endsWith(`.${h}`));
}
function refSourceProblem(s, latest, officialHosts = []) {
  if (!s) return "no source";
  if (typeof s.citation !== "string" || s.citation.trim().length < 6) return "no citation";
  if (typeof s.sourceUrl !== "string" || !refIsOfficialUrl(s.sourceUrl, officialHosts)) return "no official https source address";
  if (!refIsDay(s.checkedOn)) return "no checked date";
  if (s.checkedOn > latest) return `checked ${s.checkedOn}, after the table's date ${latest}`;
  return "";
}
var listed = (items) => [...new Set(items)].sort().join(", ");
function refCheckTable(table, keyOf = (r) => r.code, moreSources = () => []) {
  const checks = new CheckList();
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const members = new Set(table.members.map((m) => m.code));
  const strangers = [...rows.map((r) => r.code), ...gaps.map((g) => g.code)].filter((code) => !members.has(code));
  const keys = /* @__PURE__ */ new Map();
  for (const r of rows) keys.set(keyOf(r), (keys.get(keyOf(r)) ?? 0) + 1);
  const twice = [...keys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const gapCount = /* @__PURE__ */ new Map();
  for (const g of gaps) gapCount.set(g.code, (gapCount.get(g.code) ?? 0) + 1);
  const gapTwice = [...gapCount.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const covered = new Set(rows.map((r) => r.code));
  const both = gaps.map((g) => g.code).filter((code) => covered.has(code));
  const unaccounted = [...members].filter((code) => !covered.has(code) && !gapCount.has(code));
  checks.that(
    "ref-members",
    "Every member is in the table or listed once as not yet covered, and no row appears twice",
    strangers.length + twice.length + gapTwice.length + both.length + unaccounted.length === 0,
    [
      strangers.length ? `not a member: ${listed(strangers)}` : "",
      twice.length ? `row more than once: ${listed(twice)}` : "",
      gapTwice.length ? `not-covered more than once: ${listed(gapTwice)}` : "",
      both.length ? `both covered and not covered: ${listed(both)}` : "",
      unaccounted.length ? `missing from both lists: ${listed(unaccounted)}` : ""
    ].filter(Boolean).join("; ")
  );
  const unsourced = [];
  const hosts = table.officialHosts ?? [];
  if (!refIsDay(table.checkedOn)) unsourced.push(`the table (its date ${table.checkedOn} is not a real day)`);
  for (const r of rows) {
    const own = refSourceProblem(r, table.checkedOn, hosts);
    if (own) unsourced.push(`${keyOf(r)} (${own})`);
    for (const more of moreSources(r)) {
      const extra = refSourceProblem(more, table.checkedOn, hosts);
      if (extra) unsourced.push(`${keyOf(r)} further source (${extra})`);
    }
  }
  for (const g of gaps) if (typeof g.reason !== "string" || g.reason.trim().length < 10) unsourced.push(`${g.code} (no reason given for leaving it out)`);
  checks.that("ref-sourced", "Every row names the official source it was read from, links it, and carries the date it was checked", unsourced.length === 0, unsourced.slice(0, 12).join("; "));
  checks.that("ref-coverage", "Every member has a row", gaps.length === 0, `${gaps.length} not yet covered: ${listed(gaps.map((g) => g.code))}`, "warning");
  return checks.all;
}

// packages/core/src/reference/findings.ts
function refNameList(codes, members) {
  const names2 = [...new Set(codes)].map((c) => refMemberName(members, c)).sort((a, b) => a.localeCompare(b));
  if (names2.length <= 1) return names2[0] ?? "";
  return `${names2.slice(0, -1).join(", ")} and ${names2[names2.length - 1]}`;
}
function refTally(items) {
  const by = /* @__PURE__ */ new Map();
  for (const it of items) by.set(it.value, [...by.get(it.value) ?? [], it.code]);
  return [...by].map(([value, codes]) => ({ value, codes })).sort((a, b) => b.codes.length - a.codes.length || (typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
}
function refExtremes(items) {
  if (items.length === 0) return null;
  for (const it of items) if (!Number.isSafeInteger(it.value)) throw new Error(`Not a whole number: ${it.value} (${it.code})`);
  const min = Math.min(...items.map((i) => i.value));
  const max = Math.max(...items.map((i) => i.value));
  return { min, minCodes: items.filter((i) => i.value === min).map((i) => i.code), max, maxCodes: items.filter((i) => i.value === max).map((i) => i.code) };
}

// packages/core/src/property/depositRules.ts
var CHECKED = "2026-10-10";
var NONE_STATED = "None stated in the cited sections";
var DEPOSIT_RULES = [
  {
    state: "AZ",
    name: "Arizona",
    maxDepositHalfMonths: 3,
    maxDepositText: "1.5 months' rent, counting prepaid rent; a tenant may choose to prepay more",
    deadlines: [{ days: 14, basis: "business", appliesTo: "Itemized list of deductions with any amount due", clockStarts: "termination of the tenancy, delivery of possession, and demand by the tenant" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "A.R.S. § 33-1321",
    sourceUrl: "https://www.azleg.gov/ars/33/01321.htm",
    checkedOn: CHECKED,
    notes: "The 14 days leave out Saturdays, Sundays, and legal holidays, so no calendar date is computed here."
  },
  {
    state: "DE",
    name: "Delaware",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent for agreements of a year or more, and for month-to-month or open-ended primary residences once the tenancy has lasted a year; the limits do not cover furnished units",
    deadlines: [{ days: 20, basis: "calendar", appliesTo: "Deposit, or itemized list of damages with the difference", clockStarts: "expiration or termination of the rental agreement" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "25 Del. C. § 5514",
    sourceUrl: "https://delcode.delaware.gov/title25/c055/index.html",
    checkedOn: CHECKED,
    notes: "A separate pet deposit of up to 1 month's rent is described in the same section."
  },
  {
    state: "FL",
    name: "Florida",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [
      { days: 15, basis: "calendar", appliesTo: "Return of the deposit when no claim is made on it", clockStarts: "termination of the rental agreement" },
      { days: 30, basis: "calendar", appliesTo: "Written notice of intention to impose a claim on the deposit", clockStarts: "termination of the rental agreement" }
    ],
    interest: "conditional",
    interestFixedRateBp: null,
    interestText: "Depends on how the deposit is held: none in a non-interest-bearing account; in an interest-bearing account, at least 75% of the account’s annualized average rate or 5% simple, as the landlord elects; 5% simple when a surety bond is posted",
    citation: "Fla. Stat. § 83.49",
    sourceUrl: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0083/Sections/0083.49.html",
    checkedOn: CHECKED,
    notes: "After a notice of claim the section sets further periods for the tenant’s objection and for the balance."
  },
  {
    state: "IA",
    name: "Iowa",
    maxDepositHalfMonths: 4,
    maxDepositText: "2 months' rent",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Deposit or written statement of reasons for withholding", clockStarts: "termination of the tenancy and receipt of the tenant’s mailing address or delivery instructions" }],
    interest: "conditional",
    interestFixedRateBp: null,
    interestText: "No rate stated. The section says interest earned on a deposit during the first five years of a tenancy is the landlord’s property",
    citation: "Iowa Code § 562A.12",
    sourceUrl: "https://www.legis.iowa.gov/docs/code/562A.12.pdf",
    checkedOn: CHECKED,
    notes: "The count needs both events: the tenancy ending and the landlord receiving the tenant’s address."
  },
  {
    state: "ID",
    name: "Idaho",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [
      { days: 21, basis: "calendar", appliesTo: "Refund when the agreement fixes no time", clockStarts: "surrender of the premises by the tenant" },
      { days: 30, basis: "calendar", appliesTo: "Outer limit when the agreement fixes a time", clockStarts: "surrender of the premises by the tenant" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "Idaho Code § 6-321",
    sourceUrl: "https://legislature.idaho.gov/statutesrules/idstat/Title6/T6CH3/SECT6-321/",
    checkedOn: CHECKED,
    notes: "A refund of less than the full deposit comes with a signed itemized statement under the same section."
  },
  {
    state: "KS",
    name: "Kansas",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent unfurnished; 1.5 months' furnished; an added half month's rent where pets are allowed",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Outer limit for returning the balance", clockStarts: "termination of the tenancy, delivery of possession, and demand by the tenant" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "K.S.A. 58-2550",
    sourceUrl: "https://www.ksrevisor.gov/statutes/chapters/ch58/058_025_0050.html",
    checkedOn: CHECKED,
    notes: "The figure shown is the unfurnished tier. The section also gives 14 days counted from when the amount of charges is determined, inside the 30-day limit."
  },
  {
    state: "ME",
    name: "Maine",
    maxDepositHalfMonths: 4,
    maxDepositText: "2 months' rent",
    deadlines: [
      { days: 30, basis: "calendar", appliesTo: "Written rental agreement: the time stated in the agreement, at most 30 days", clockStarts: "not spelled out for written agreements in the section; see source" },
      { days: 21, basis: "calendar", appliesTo: "Tenancy at will", clockStarts: "termination of the tenancy or surrender and acceptance of the premises, whichever is later" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "14 M.R.S. §§ 6032, 6033, 6038",
    sourceUrl: "https://legislature.maine.gov/statutes/14/title14sec6033.html",
    moreSources: ["https://legislature.maine.gov/statutes/14/title14sec6032.html", "https://legislature.maine.gov/statutes/14/title14sec6038.html"],
    checkedOn: CHECKED,
    notes: "Two different periods depending on whether there is a written agreement."
  },
  {
    state: "MI",
    name: "Michigan",
    maxDepositHalfMonths: 3,
    maxDepositText: "1.5 months' rent",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Mailing of the itemized notice of damages with the difference", clockStarts: "termination of occupancy" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "MCL 554.602, 554.609",
    sourceUrl: "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-554-609",
    moreSources: ["https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-554-602"],
    checkedOn: CHECKED,
    notes: "Section 554.609 was amended in 2026 to cover electronic payment of the difference, with its own 10-day period after the notice is mailed."
  },
  {
    state: "MN",
    name: "Minnesota",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [
      { days: 21, basis: "calendar", appliesTo: "Deposit with interest, or written statement of reasons for withholding (three weeks)", clockStarts: "termination of the tenancy, and after receipt of the tenant’s mailing address or delivery instructions" },
      { days: 5, basis: "calendar", appliesTo: "Tenant leaves because the building is legally condemned", clockStarts: "the date the tenant leaves, and after receipt of the tenant’s mailing address or delivery instructions" }
    ],
    interest: "yes",
    interestFixedRateBp: 100,
    interestText: "1% a year, simple and not compounded, from the first day of the month after full payment of the deposit; amounts under $1 are left out",
    citation: "Minn. Stat. § 504B.178",
    sourceUrl: "https://www.revisor.mn.gov/statutes/cite/504B.178",
    checkedOn: CHECKED,
    notes: "The statute writes the main period as three weeks; 21 days is that period in days."
  },
  {
    state: "MO",
    name: "Missouri",
    maxDepositHalfMonths: 4,
    maxDepositText: "2 months' rent",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Full deposit, or itemized list of damages with the balance", clockStarts: "the date of termination of the tenancy" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: "None; the section says interest earned on a deposit is the landlord’s property",
    citation: "RSMo § 535.300",
    sourceUrl: "https://revisor.mo.gov/main/OneSection.aspx?section=535.300",
    checkedOn: CHECKED,
    notes: "The section’s definition of a security deposit leaves out money labelled as a pet deposit."
  },
  {
    state: "MT",
    name: "Montana",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [
      { days: 30, basis: "calendar", appliesTo: "Written list of charges with the difference", clockStarts: "termination of the tenancy or surrender and acceptance of the premises, whichever is first" },
      { days: 10, basis: "calendar", appliesTo: "No damages, no cleaning needed, no unpaid rent or utilities", clockStarts: "not spelled out in the subsection; see source" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "MCA § 70-25-202",
    sourceUrl: "https://mca.legmt.gov/bills/mca/title_0700/chapter_0250/part_0020/section_0020/0700-0250-0020-0020.html",
    checkedOn: CHECKED,
    notes: "Only the return section was read for this row; other sections of the chapter were not."
  },
  {
    state: "NC",
    name: "North Carolina",
    maxDepositHalfMonths: 4,
    maxDepositText: "2 weeks' rent for week-to-week, 1.5 months' for month-to-month, 2 months' for longer terms",
    deadlines: [
      { days: 30, basis: "calendar", appliesTo: "Itemized accounting with the balance, or an interim accounting", clockStarts: "termination of the tenancy and delivery of possession to the landlord" },
      { days: 60, basis: "calendar", appliesTo: "Final accounting when an interim accounting was given", clockStarts: "termination of the tenancy and delivery of possession to the landlord" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "N.C.G.S. §§ 42-50, 42-51, 42-52",
    sourceUrl: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_42/GS_42-52.html",
    moreSources: [
      "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_42/GS_42-50.html",
      "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_42/GS_42-51.html"
    ],
    checkedOn: CHECKED,
    notes: "The figure shown is the tier for terms longer than month to month; week-to-week and month-to-month tenancies have the lower tiers listed."
  },
  {
    state: "NE",
    name: "Nebraska",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent, plus a pet deposit of up to one quarter of a month's rent; housing agencies are outside this limit",
    deadlines: [{ days: 14, basis: "calendar", appliesTo: "Balance with a written itemization", clockStarts: "the date of termination of the tenancy" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "Neb. Rev. Stat. § 76-1416",
    sourceUrl: "https://nebraskalegislature.gov/laws/statutes.php?statute=76-1416",
    checkedOn: CHECKED,
    notes: "The section describes mailing to the last-known address when the tenant leaves no instructions."
  },
  {
    state: "NH",
    name: "New Hampshire",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent or $100, whichever is greater",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Deposit with any interest due", clockStarts: "termination of the tenancy" }],
    interest: "conditional",
    interestFixedRateBp: null,
    interestText: "When a deposit is held a year or longer; the rate follows the savings rate at the New Hampshire institution holding it, so no number is printed here; see source",
    citation: "RSA 540-A:6, 540-A:7",
    sourceUrl: "https://gc.nh.gov/rsa/html/LV/540-A/540-A-7.htm",
    moreSources: ["https://gc.nh.gov/rsa/html/LV/540-A/540-A-6.htm"],
    checkedOn: CHECKED,
    notes: "Section 540-A:6 also lets a tenant ask for accrued interest every three years."
  },
  {
    state: "NV",
    name: "Nevada",
    maxDepositHalfMonths: 6,
    maxDepositText: "3 months' rent, counting last month's rent and any surety bond together with the deposit",
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Itemized accounting with the remaining deposit", clockStarts: "termination of the tenancy" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "NRS 118A.242",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-118A.html",
    checkedOn: CHECKED,
    notes: "The source page is the whole chapter; the deposit section is 118A.242."
  },
  {
    state: "OH",
    name: "Ohio",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Itemized notice of deductions with the amount due", clockStarts: "termination of the rental agreement and delivery of possession" }],
    interest: "conditional",
    interestFixedRateBp: 500,
    interestText: "5% a year on the part of a deposit above $50 or one month's rent, whichever is greater, when the tenant stays six months or more; figured and paid annually",
    citation: "Ohio R.C. § 5321.16",
    sourceUrl: "https://codes.ohio.gov/ohio-revised-code/section-5321.16",
    checkedOn: CHECKED,
    notes: "Interest applies only to the excess over the threshold, not to the whole deposit."
  },
  {
    state: "RI",
    name: "Rhode Island",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent; a separate furniture deposit of up to 1 month's rent where furnished items are worth $5,000 or more",
    deadlines: [{ days: 20, basis: "calendar", appliesTo: "Itemized notice with the amount due", clockStarts: "the latest of termination of the tenancy, delivery of possession, or the tenant giving a forwarding address" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "R.I. Gen. Laws § 34-18-19",
    sourceUrl: "https://webserver.rilegislature.gov/Statutes/TITLE34/34-18/34-18-19.htm",
    checkedOn: CHECKED,
    notes: "The count starts from the last of three events, so the move-out date may not be the start."
  },
  {
    state: "SD",
    name: "South Dakota",
    maxDepositHalfMonths: 2,
    maxDepositText: "1 month's rent; a larger deposit by agreement where special conditions pose a danger to maintenance of the premises",
    deadlines: [
      { days: 21, basis: "calendar", appliesTo: "Deposit or written statement of reasons for withholding", clockStarts: "termination of the tenancy and receipt of the tenant’s mailing address or delivery instructions" },
      { days: 45, basis: "calendar", appliesTo: "Itemized accounting, when the tenant asks for one", clockStarts: "termination of the tenancy" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "SDCL 43-32-6.1, 43-32-24",
    sourceUrl: "https://sdlegislature.gov/api/Statutes/43-32-24.html",
    moreSources: ["https://sdlegislature.gov/api/Statutes/43-32-6.1.html"],
    checkedOn: CHECKED,
    notes: "Section 43-32-24 shows a 2026 session law in its history; 21 days is the figure on the page when checked."
  },
  {
    state: "VA",
    name: "Virginia",
    maxDepositHalfMonths: 4,
    maxDepositText: "2 months' rent",
    deadlines: [{ days: 45, basis: "calendar", appliesTo: "Itemized notice with any amount due", clockStarts: "the termination date of the tenancy or the date the tenant vacates, whichever is last" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: NONE_STATED,
    citation: "Va. Code § 55.1-1226",
    sourceUrl: "https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1226/",
    checkedOn: CHECKED,
    notes: "The section has separate periods tied to final utility bills."
  },
  {
    state: "VT",
    name: "Vermont",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [
      { days: 14, basis: "calendar", appliesTo: "Deposit with a written statement of deductions", clockStarts: "the date the landlord discovers the tenant vacated or abandoned, or the date the tenant vacated when the landlord had notice of it" },
      { days: 60, basis: "calendar", appliesTo: "Seasonal rental that is not a primary residence", clockStarts: "not spelled out in the sentence; see source" }
    ],
    interest: "no",
    interestFixedRateBp: null,
    interestText: "None in the section; it says a town ordinance may authorize interest",
    citation: "9 V.S.A. § 4461",
    sourceUrl: "https://legislature.vermont.gov/statutes/section/09/137/04461",
    checkedOn: CHECKED,
    notes: "The section lets towns add their own deposit ordinances."
  },
  {
    state: "WA",
    name: "Washington",
    maxDepositHalfMonths: null,
    maxDepositText: NONE_STATED,
    deadlines: [{ days: 30, basis: "calendar", appliesTo: "Statement of the basis for retaining any deposit, with any refund", clockStarts: "termination of the rental agreement and vacation of the premises, or the landlord learning of an abandonment" }],
    interest: "no",
    interestFixedRateBp: null,
    interestText: "None; the landlord receives interest on the trust account unless agreed otherwise in writing",
    citation: "RCW 59.18.270, 59.18.280",
    sourceUrl: "https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.280",
    moreSources: ["https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.270"],
    checkedOn: CHECKED,
    notes: "Mailing within the 30 days counts under the section."
  }
];
var DEPOSIT_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"]
].map(([state, name]) => ({ state, name }));
function depositStatesNotCovered() {
  return DEPOSIT_STATES.filter((s) => !DEPOSIT_RULES.some((r) => r.state === s.state));
}
function halfMonthsLabel(halfMonths) {
  if (!Number.isSafeInteger(halfMonths) || halfMonths < 1) throw new Error("Half-months must be a whole number of one or more.");
  const whole = (halfMonths - halfMonths % 2) / 2;
  const text = halfMonths % 2 === 0 ? String(whole) : `${whole === 0 ? "0" : whole}.5`;
  return halfMonths === 2 ? "1 month's rent" : `${text} months' rent`;
}

// packages/core/src/property/lateFeeLimits.ts
var FIRST_READ = "2026-10-19";
var SECOND_READ = "2026-10-20";
var NO_WAIT = "The cited section sets no waiting period.";
var ANY = "Any late rent payment";
var pct = (bp, base = "rent") => ({ kind: "percent", bp, base });
var flat = (cents) => ({ kind: "flat", cents });
var one = (label, term) => ({ label, rule: "one", terms: [term] });
function row(code, citation, sourceUrl, t, checkedOn = FIRST_READ, dayBasis = "calendar") {
  return { code, citation, sourceUrl, checkedOn, dayBasis, ...t };
}
var LATE_FEE_LIMITS = [
  row("CO", "C.R.S. § 38-12-105(1)", "https://leg.colorado.gov/sites/default/files/images/olls/crs2024-title-38.pdf", {
    capText: "The greater of $50 or 5% of the past-due rent payment.",
    cases: [{ label: ANY, rule: "greater", terms: [flat(5e3), pct(500, "unpaid")] }],
    feeFromDay: 7,
    graceText: "No fee unless the payment is late by at least seven calendar days.",
    notes: "Covers tenants and mobile home owners. The fee has to be in the rental agreement, with written notice within 180 days of the due date. One fee per late payment unless all fees on it stay within the cap; no fee on rent a subsidy provider pays; no interest on a fee; no eviction for unpaid fees. Read in the legislature's Colorado Revised Statutes 2024 printout."
  }),
  row("CT", "Conn. Gen. Stat. § 47a-15a", "https://www.cga.ct.gov/current/pub/chap_830.htm#sec_47a-15a", {
    capText: "The lesser of $5 a day up to $50, or 5% of the delinquent rent payment.",
    cases: [{ label: `${ANY} ($50.00 is the most the $5-a-day charge reaches)`, rule: "lesser", terms: [flat(5e3), pct(500, "unpaid")] }],
    feeFromDay: 10,
    graceText: "The grace period is the nine days after the due date (four days in a one-week tenancy); a late charge is only on a payment made after it.",
    notes: "Needs a valid written agreement to pay a late charge. Only one late charge per delinquent payment, however long it stays unpaid. Where a government or charitable entity pays part of the rent, the 5% is of the tenant's share."
  }),
  row("DE", "25 Del. C. § 5501(d)", "https://delcode.delaware.gov/title25/c055/index.html", {
    capText: "5% of the monthly rent.",
    cases: [one(ANY, pct(500))],
    feeFromDay: 6,
    graceText: "No late charge within 5 days of the agreed payment day. If the landlord keeps no office or other permanent place in the county where rent can be paid, the payment day moves 3 days later.",
    notes: "Applies where the rental agreement provides for a late charge. The section counts a late charge as additional rent."
  }),
  row("DC", "D.C. Code § 42-3505.31", "https://code.dccouncil.gov/us/dc/council/code/sections/42-3505.31", {
    capText: "5% of the full rent due.",
    cases: [one(ANY, pct(500))],
    feeFromDay: 6,
    graceText: "No fee unless the full rent is still unpaid 5 days after the due date, or after any longer grace period the lease gives.",
    notes: "The written lease has to state the maximum fee. One fee per late payment; no interest on a fee; no taking a fee out of a later rent payment; no eviction for an unpaid fee; no fee on rent a subsidy provider pays. Unpaid fees can be invoiced with 30 days to pay."
  }),
  row("HI", "Haw. Rev. Stat. § 521-21(f)", "https://www.capitol.hawaii.gov/hrscurrent/Vol12_Ch0501-0588/HRS0521/HRS_0521-0021.htm", {
    capText: "8% of the rent due.",
    cases: [one(ANY, pct(800))],
    feeFromDay: null,
    graceText: NO_WAIT,
    notes: "Applies where the rental agreement provides for a late charge on rent not paid when due."
  }),
  row(
    "ID",
    "Idaho Code § 55-305",
    "https://legislature.idaho.gov/statutesrules/idstat/Title55/T55CH3/SECT55-305",
    {
      capText: "A reasonable fee; the section sets no figure.",
      cases: [{ label: ANY, rule: "reasonable", terms: [] }],
      feeFromDay: null,
      graceText: NO_WAIT,
      notes: "Covers fees on residential tenants, late fees included. A fee may not be more than the rental agreement states, or be one the agreement leaves out, unless the agreement is oral or, for a written one, the owner gives 30 days' written notice of the change. Applies to rental agreements made or renewed on or after July 1, 2023."
    },
    SECOND_READ
  ),
  row("IA", "Iowa Code § 562A.9(4)", "https://www.legis.iowa.gov/docs/code/562A.9.pdf", {
    capText: "Rent of $700 a month or less: $12 a day and $60 a month at most. Rent over $700 a month: $20 a day and $100 a month at most.",
    cases: [
      { label: "Monthly rent of $700.00 or less: the monthly total ($12.00 a day)", rule: "one", terms: [flat(6e3)], rentAtMost: 7e4 },
      { label: "Monthly rent over $700.00: the monthly total ($20.00 a day)", rule: "one", terms: [flat(1e4)], rentOver: 7e4 }
    ],
    feeFromDay: null,
    graceText: NO_WAIT,
    notes: "A limit on what a rental agreement may provide for. The daily figure and the monthly total both apply."
  }),
  row("ME", "14 M.R.S. § 6028", "https://legislature.maine.gov/statutes/14/title14sec6028.html", {
    capText: "4% of one month's rent.",
    cases: [one(ANY, pct(400))],
    feeFromDay: 16,
    graceText: "A payment counts as late only if it is not made within 15 days of the due date.",
    notes: "The tenant has to have been told in writing, when the rental agreement was made, that a penalty of up to 4% of a month's rent may be charged."
  }),
  row("MD", "Md. Code, Real Prop. § 8-208(d)(3)", "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=grp&section=8-208&enactments=false", {
    capText: "5% of the unpaid rent due for the rental period.",
    cases: [one(ANY, pct(500, "unpaid"))],
    feeFromDay: null,
    graceText: NO_WAIT,
    notes: "A limit on what a lease may provide. Leases with rent paid weekly: $3 a week and $12 a month at most."
  }),
  row("MA", "Mass. Gen. Laws ch. 186, § 15B(1)(c)", "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleI/Chapter186/Section15B", {
    capText: "No amount set in the cited section.",
    cases: [{ label: ANY, rule: "none", terms: [] }],
    feeFromDay: 30,
    graceText: "No interest or penalty for late rent until 30 days after the rent was due.",
    notes: "A limit on what a lease or other rental agreement may impose."
  }),
  row("MN", "Minn. Stat. § 504B.177(a)", "https://www.revisor.mn.gov/statutes/cite/504B.177", {
    capText: "8% of the overdue rent payment.",
    cases: [one(ANY, pct(800, "unpaid"))],
    feeFromDay: null,
    graceText: "The cited section sets no waiting period; the written agreement has to say when the fee is imposed.",
    notes: "Needs a written agreement. Where the landlord has a housing assistance payments contract with a government, the fee is figured on the tenant's portion only. A conflicting federal rule for a subsidized tenancy can be followed instead."
  }),
  row("NV", "NRS 118A.210(4)", "https://www.leg.state.nv.us/NRS/NRS-118A.html#NRS118ASec210", {
    capText: "A reasonable fee, not more than 5% of the periodic rent.",
    cases: [one(ANY, pct(500))],
    feeFromDay: 3,
    graceText: "For a tenancy longer than week to week, no fee until at least 3 calendar days after the due date.",
    notes: "The fee has to be set out in the rental agreement. The maximum may not grow on account of a fee already charged."
  }),
  row(
    "NJ",
    "N.J.S.A. 2A:42-6.1 and 2A:42-6.3, as amended by P.L.2001, c.142",
    "https://pub.njleg.gov/bills/2000/PL01/142_.HTM",
    {
      capText: "No amount set in the cited sections.",
      cases: [{ label: "Rent due on the first of the month, for the tenants the sections name", rule: "none", terms: [] }],
      feeFromDay: 6,
      graceText: "Five business days of grace (not counting Saturdays, Sundays, or state or federal holidays), and no late charge that includes them. Only where rent is due on the first of the month.",
      notes: "Covers only premises rented by senior citizens receiving Social Security old age pensions, railroad retirement pensions, or other government pensions in their place, and by people receiving Social Security disability benefits, Supplemental Security Income, or Work First New Jersey benefits. Read in the 2001 chapter law on the legislature site, and confirmed in its compiled statutes."
    },
    SECOND_READ,
    "business"
  ),
  row(
    "NM",
    "NMSA 1978 § 47-8-15(D), as amended by Laws 2025, ch. 122 (S.B. 267)",
    "https://www.nmlegis.gov/Sessions/25%20Regular/final/SB0267.pdf",
    {
      capText: "5% of the rent for each rental period the resident is in default.",
      cases: [one(ANY, pct(500))],
      feeFromDay: null,
      graceText: NO_WAIT,
      notes: "Applies where the rental agreement provides for a late fee. Figured on rent only, not deposits, other fees, or utilities. Notice of the fee has to be given by the last day of the rental period after the one in default. Read in the 2025 act as passed (signed as chapter 122) on the legislature site; the compiled statutes site refused automated reading."
    },
    SECOND_READ
  ),
  row("NY", "N.Y. Real Prop. Law § 238-a(2)", "https://legislation.nysenate.gov/pdf/laws/RPP238-A/", {
    capText: "The lesser of $50 or 5% of the monthly rent.",
    cases: [{ label: ANY, rule: "lesser", terms: [flat(5e3), pct(500)] }],
    feeFromDay: 6,
    graceText: "No fee unless the rent has not been paid within five days of the due date.",
    notes: "Applies to residential dwelling units. Some cooperative housing shareholders may instead be charged up to 8% of the monthly maintenance fee where their lease or occupancy agreement allows it."
  }),
  row("NC", "N.C. Gen. Stat. § 42-46(a)", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_42/GS_42-46.html", {
    capText: "Rent due monthly: the greater of $15 or 5% of the monthly rent.",
    cases: [{ label: "Rent due monthly", rule: "greater", terms: [flat(1500), pct(500)] }],
    feeFromDay: 5,
    graceText: "Only when a payment is five calendar days or more late, counting the day after the due date as day one.",
    notes: "Rent due weekly: the greater of $4 or 5% of the weekly rent. One fee per late payment, and it may not be taken out of a later payment so as to put that one in default. Where rent is subsidized by a government program, fees are figured on the tenant's share only."
  }),
  row("OR", "ORS 90.260", "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html", {
    capText: "One of three kinds, set out in a written rental agreement: a reasonable flat amount once per rental period; a reasonable daily amount from the fifth day, each day at most 6% of that flat amount; or 5% of the periodic rent for each five-day period, or part of one, the rent stays unpaid.",
    cases: [
      { label: "A reasonable flat amount, once per rental period", rule: "reasonable", terms: [] },
      { label: "A daily amount from the fifth day, each day at most 6% of a reasonable flat amount", rule: "reasonable", terms: [] },
      { label: "5% of the periodic rent for each five-day period, or part of one, from the fifth day", rule: "one", terms: [pct(500)] }
    ],
    feeFromDay: 4,
    graceText: "Only if the rent is not received by the fourth day of the rental period. The section counts from the start of the rental period; the date here takes the due date as that period's first day.",
    notes: "The section measures a reasonable amount by what landlords customarily charge in that rental market. Daily and five-day charges run only through that rental period. The agreement has to state the kind and amount of the charge and when it becomes due."
  }),
  row(
    "TN",
    "Tenn. Code Ann. § 66-28-201(d), as amended by 2011 Pub. Ch. 272 (H.B. 1760)",
    "https://capitol.tn.gov/Bills/107/Amend/HA0302.pdf",
    {
      capText: "10% of the amount of rent past due.",
      cases: [one(ANY, pct(1e3, "unpaid"))],
      feeFromDay: 5,
      graceText: "Five days of grace, counting the due date as the first; a fee only after them. If the fifth day is a Sunday or legal holiday, no fee on rent paid the next business day.",
      notes: "Part of the Uniform Residential Landlord and Tenant Act, which applies only in counties over 75,000 in population by the census its scope section names. Read in the 2011 House amendment (Public Chapter 272, rental agreements from October 1, 2011) and, on October 20, 2026, in the compiled section in Tennessee's public access code: both give the same cap and grace."
    },
    SECOND_READ
  ),
  row("TX", "Tex. Prop. Code § 92.019", "https://tcss.legis.texas.gov/resources/PR/htm/PR.92.htm#92.019", {
    capText: "A reasonable fee. The section treats a fee as reasonable when it is not more than 12% of the rent for the rental period (a structure with four or fewer units) or 10% (more than four units), or when it is more but not more than the landlord's uncertain damages from the late payment.",
    cases: [
      one("Dwelling in a structure with four or fewer units", pct(1200)),
      one("Dwelling in a structure with more than four units", pct(1e3))
    ],
    feeFromDay: 3,
    graceText: "No fee unless some of the rent has stayed unpaid two full days after the original due date.",
    notes: "Notice of the fee has to be in a written lease. An initial fee and a daily fee together count as one late fee."
  }),
  row(
    "UT",
    "Utah Code § 57-22-4(5)(a)",
    "https://le.utah.gov/xcode/Title57/Chapter22/C57-22-S4_2021050520210505.html",
    {
      capText: "The greater of 10% of the rent in the rental agreement or $75.",
      cases: [{ label: ANY, rule: "greater", terms: [pct(1e3), flat(7500)] }],
      feeFromDay: null,
      graceText: NO_WAIT,
      notes: "Part of the Utah Fit Premises Act, which covers a unit that is the renter's principal residence, and not a boarding or rooming house, a mobile home lot, or recreational property rented occasionally. Other fees and costs may not be more than the rental agreement states; one it leaves out needs a month-to-month agreement and 15 days' notice."
    },
    SECOND_READ
  ),
  row("VA", "Va. Code § 55.1-1204(E)", "https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1204/", {
    capText: "The lesser of 10% of the periodic rent or 10% of the remaining balance due.",
    cases: [{ label: ANY, rule: "lesser", terms: [pct(1e3), pct(1e3, "unpaid")] }],
    feeFromDay: null,
    graceText: "The cited subsection sets no waiting period. Where no written rental agreement is offered, the terms in subsection C treat rent due on the first as late if not paid by the fifth.",
    notes: "A late charge only if the written rental agreement provides for one."
  }),
  row("WA", "RCW 59.18.170(2)", "https://app.leg.wa.gov/RCW/default.aspx?cite=59.18&full=true", {
    capText: "No amount set in the cited section.",
    cases: [{ label: ANY, rule: "none", terms: [] }],
    feeFromDay: 6,
    graceText: "No late fee on rent paid within five days after the due date. Once rent is more than five days past due, fees may run from the first day after the due date.",
    notes: "A tenant whose main income is a monthly government benefit that arrives after the due date can ask in writing to move the due date; the section limits how far."
  })
];
var LATE_FEE_NOT_COVERED = [
  {
    code: "AL",
    reason: "The Uniform Residential Landlord and Tenant Act (Ala. Code title 35, chapter 9A) on the legislature's code site was read in full on 2026-10-20 and sets no late fee figure or waiting period; § 35-9A-421(b) lets a notice to terminate for unpaid rent name the late fees owed."
  },
  {
    code: "AK",
    reason: "The legislature's statutes site refused automated reading on 2026-10-20. The Landlord and Tenant Act (AS 34.03) as printed by the Alaska Court System from the 2016 Alaska Statutes was read in full that day and sets no late fee figure or waiting period; later changes were not checked."
  },
  {
    code: "AZ",
    reason: "The Residential Landlord and Tenant Act on the legislature site was read on 2026-10-20 (all section titles, and § 33-1368 in full). § 33-1368(B) speaks of a reasonable late fee set out in a written rental agreement but sets no figure or waiting period. § 33-1414 sets a five-day minimum and a $5-a-day cap for mobile home park rental agreements only."
  },
  {
    code: "AR",
    reason: "The Arkansas Code is published on a vendor's site. The 2007 act that created the Residential Landlord-Tenant Act (Act 1004), read in full on the legislature site on 2026-10-20, counts late charges as part of rent but sets no late fee figure or waiting period; later acts were checked by search only."
  },
  {
    code: "CA",
    reason: "Civ. Code § 1671, read on the legislature's code site on 2026-10-20, is the general liquidated damages section: in a lease of a dwelling such a provision is void unless it sets an amount agreed where actual damage would be impracticable or extremely difficult to fix. It does not name late fees and sets no late fee figure or waiting period."
  },
  {
    code: "FL",
    reason: "Chapter 83 of the 2026 Florida Statutes on the Senate site was read in full on 2026-10-20. Its residential part sets no late fee figure or waiting period; the only late fee figure in the chapter is in the self-storage part."
  },
  {
    code: "GA",
    reason: "The Official Code of Georgia is published on a vendor's site. The 2024 Safe at Home Act (HB 404) as passed, read on the legislature's site on 2026-10-20, revises O.C.G.A. § 44-7-50 to require a notice to vacate or pay past-due rent and late fees within three business days before a dispossessory filing, and sets no late fee figure or waiting period; the rest of the chapter was not read."
  },
  {
    code: "IL",
    reason: "The Landlord and Tenant Act (765 ILCS 705) on the General Assembly site was read on 2026-10-19 and sets no late fee figure or waiting period. Other Illinois laws and local ordinances were not checked."
  },
  {
    code: "IN",
    reason: "Article 31 of Indiana Code title 32 (landlord-tenant relations), in the 2026 code on the General Assembly's site, was read in full on 2026-10-20 and sets no late fee figure or waiting period."
  },
  {
    code: "KS",
    reason: "Chapter 58 of the Kansas Statutes on the revisor's site was read on 2026-10-20 (every section title, and the Residential Landlord and Tenant Act's rental agreement and prohibited-terms sections in full). It sets no late fee figure or waiting period for housing; its one late fee section covers self-storage."
  },
  {
    code: "KY",
    reason: "KRS chapter 383 on the legislature site was read on 2026-10-20 (section titles, and the rent and prohibited-provisions sections of the Uniform Residential Landlord and Tenant Act in full) and sets no late fee figure or waiting period for housing."
  },
  {
    code: "LA",
    reason: "The Civil Code's lease articles and the lease sections of Revised Statutes title 9 that could be opened on the legislature site were read on 2026-10-20 and set no late fee figure or waiting period. The full section lists could not be loaded automatically, so not every section was read."
  },
  {
    code: "MI",
    reason: "The Truth in Renting Act and the landlord and tenant relationships act on the legislature site were read on 2026-10-20 (section titles, and the prohibited lease provisions section in full) and set no late fee figure or waiting period."
  },
  {
    code: "MS",
    reason: "The legislature's site links the Mississippi Code to a vendor's copy, which refused automated reading on 2026-10-20. A 2025 act on the legislature site (House Bill 1200) counts late fees a rental agreement requires as rent and sets no figure or waiting period; the rest of the Residential Landlord and Tenant Act was not read."
  },
  {
    code: "MO",
    reason: "The section lists of RSMo chapters 441 and 535 on the revisor's site were read on 2026-10-20 and name no late fee section. Only a few of the sections were read in full."
  },
  {
    code: "MT",
    reason: "The Residential Landlord and Tenant Act (MCA title 70, chapter 24) on the legislature site was read on 2026-10-20 (section titles, and the definitions and rent sections in full). Its definition of rent includes late fees agreed in the rental agreement; it sets no figure or waiting period."
  },
  {
    code: "NE",
    reason: "The section list of the Uniform Residential Landlord and Tenant Act (Neb. Rev. Stat. 76-1401 to 76-1449) on the legislature site was read on 2026-10-20 and names no late fee section; the definitions and rent sections, read in full, set no late fee figure or waiting period."
  },
  {
    code: "NH",
    reason: "RSA 540 and 540-A on the General Court site were read in full on 2026-10-20 and set no late fee figure or waiting period for residential rent. RSA 205-A:6, IV bars a late fee on rent paid in full within 7 calendar days of the due date, in manufactured housing parks only."
  },
  {
    code: "ND",
    reason: "Chapter 47-16 of the Century Code (leasing of real property), read in full in the legislature's PDF on 2026-10-20, sets no late fee figure or waiting period."
  },
  {
    code: "OH",
    reason: "Chapter 5321 of the Ohio Revised Code (landlords and tenants) on the state's code site was read in full on 2026-10-20 and sets no late fee figure or waiting period."
  },
  {
    code: "OK",
    reason: "The Residential Landlord and Tenant Act (41 O.S.) on the Oklahoma courts' statutes site (oscn.net) was read on 2026-10-20 (section titles, and the definitions, rent, and prohibited-provisions sections in full) and sets no late fee figure or waiting period."
  },
  {
    code: "PA",
    reason: "The Landlord and Tenant Act of 1951 on the General Assembly site was read in full on 2026-10-20 and sets no late fee figure or waiting period."
  },
  {
    code: "RI",
    reason: "The Residential Landlord and Tenant Act (chapter 34-18) on the legislature site was read on 2026-10-20 (its section list, and the rent and fee sections in full) and sets no late fee figure or waiting period. § 31-44-7 bars a grace period under 7 days and a late charge over 5% of the monthly rent in mobile and manufactured home park leases only."
  },
  {
    code: "SC",
    reason: "The Residential Landlord and Tenant Act (S.C. Code title 27, chapter 40) on the legislature site was read in full on 2026-10-20. Its definition of rent includes late charges; it sets no late fee figure or waiting period."
  },
  {
    code: "SD",
    reason: "Chapter 43-32 of the South Dakota Codified Laws (lease of real property) on the legislature site was read in full on 2026-10-20 and sets no late fee figure or waiting period."
  },
  {
    code: "VT",
    reason: "The Residential Rental Agreements chapter (9 V.S.A. chapter 137) on the legislature site was read in full on 2026-10-20 and sets no late fee figure or waiting period."
  },
  {
    code: "WV",
    reason: "The landlord and tenant articles (W. Va. Code chapter 37, articles 6 and 6A) on the legislature site were read on 2026-10-20 (section titles, and the rent and deposit sections in full) and set no late fee figure or waiting period; § 37-6A-2 lets reasonable late charges named in the rental agreement come out of a deposit."
  },
  {
    code: "WI",
    reason: "Wis. Admin. Code ATCP 134.09(8), read on the legislature's code site on 2026-10-20, allows a late rent fee only as the rental agreement specifically provides and bars a fee for not paying one, but sets no amount or waiting period. Wis. Stat. chapter 704 sets none for housing either."
  },
  {
    code: "WY",
    reason: "The Residential Rental Property article (Wyo. Stat. 1-21-1201 to 1-21-1211), read in full in the legislature's title 1 file on 2026-10-20, sets no late fee figure or waiting period."
  }
];
var LATE_FEE_TABLE = {
  id: "rent-late-fee-limits",
  label: "residential rent late fee limits by state",
  checkedOn: SECOND_READ,
  members: REF_US_STATES_DC,
  rows: LATE_FEE_LIMITS,
  notCovered: LATE_FEE_NOT_COVERED
};
function lateFeePercent(bp) {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return `${whole}%`;
  const digits = String(frac).padStart(2, "0");
  return `${whole}.${digits.endsWith("0") ? digits[0] : digits}%`;
}
function lateFeeTermText(t) {
  return t.kind === "flat" ? formatUSD(t.cents) : `${lateFeePercent(t.bp)} of the ${t.base === "rent" ? "rent" : "unpaid rent"}`;
}
function lateFeeCaseText(c) {
  const terms = c.terms.map(lateFeeTermText);
  switch (c.rule) {
    case "one":
      return terms[0] ?? "";
    case "greater":
      return `the greater of ${terms.join(" or ")}`;
    case "lesser":
      return `the lesser of ${terms.join(" or ")}`;
    case "reasonable":
      return "a reasonable amount (no figure set)";
    default:
      return "no amount set";
  }
}
function lateFeeDayText(r) {
  if (r.feeFromDay === null) return "None set";
  return r.dayBasis === "business" ? `Business day ${r.feeFromDay} after the due date` : `Day ${r.feeFromDay} after the due date`;
}
function lateFeeTopPercent(r) {
  const bps = r.cases.flatMap((c) => c.terms.flatMap((t) => t.kind === "percent" ? [t.bp] : []));
  return bps.length ? Math.max(...bps) : null;
}
function banded(c) {
  return c.rentOver !== void 0 || c.rentAtMost !== void 0;
}
function figureProblem(r) {
  if (!Array.isArray(r.cases) || r.cases.length === 0) return "no cases";
  for (const c of r.cases) {
    const n = c.terms.length;
    if (c.rule === "one" && n !== 1) return `"${c.label}" needs one figure`;
    if ((c.rule === "greater" || c.rule === "lesser") && n < 2) return `"${c.label}" needs two figures to compare`;
    if ((c.rule === "reasonable" || c.rule === "none") && n !== 0) return `"${c.label}" names figures but says none are set`;
    for (const t of c.terms) {
      if (t.kind === "percent" && !(Number.isSafeInteger(t.bp) && t.bp >= 1 && t.bp <= 2e3)) return `"${c.label}" has a percent outside 0.01% to 20%`;
      if (t.kind === "percent" && t.base !== "rent" && t.base !== "unpaid") return `"${c.label}" has a percent of an unknown amount`;
      if (t.kind === "flat" && !(Number.isSafeInteger(t.cents) && t.cents >= 100 && t.cents <= 5e4)) return `"${c.label}" has a flat figure outside $1 to $500`;
    }
  }
  const bands = r.cases.filter(banded);
  if (bands.length) {
    if (bands.length !== r.cases.length) return "some cases have rent bands and some do not";
    const ordered = [...bands].sort((a, b) => (a.rentOver ?? -1) - (b.rentOver ?? -1));
    if (ordered[0].rentOver !== void 0) return "the rent bands do not start at zero";
    if (ordered[ordered.length - 1].rentAtMost !== void 0) return "the rent bands have a top";
    for (let i = 1; i < ordered.length; i++) if (ordered[i].rentOver !== ordered[i - 1].rentAtMost) return "the rent bands leave a gap or overlap";
  }
  if (r.feeFromDay !== null && !(Number.isSafeInteger(r.feeFromDay) && r.feeFromDay >= 1 && r.feeFromDay <= 60)) return "the first fee day is not a whole number from 1 to 60";
  if (r.dayBasis !== "calendar" && r.dayBasis !== "business") return "unknown day basis";
  return "";
}
function checkLateFeeTable(table = LATE_FEE_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const figures = rows.map((r) => [r.code, figureProblem(r)]).filter(([, p]) => p);
  checks.that("late-fee-figures", "Every row's figures fit its rule, within plausible ranges, with rent bands that cover every rent once", figures.length === 0, figures.map(([c, p]) => `${c}: ${p}`).join("; "));
  const empty = rows.filter((r) => {
    const says = r.feeFromDay !== null || r.cases.some((c) => c.rule !== "none");
    const text = [r.capText, r.graceText, r.notes].every((s) => typeof s === "string" && s.trim().length >= 10);
    return !says || !text;
  });
  checks.that("late-fee-content", 'Every row sets a figure, says "reasonable", or sets a waiting period, and carries its summary and notes', empty.length === 0, `nothing to show for: ${empty.map((r) => r.code).join(", ")}`);
  return checks.all;
}
function amountKind(r) {
  if (r.cases.some((c) => c.rule === "one" || c.rule === "greater" || c.rule === "lesser")) return "figure";
  if (r.cases.some((c) => c.rule === "reasonable")) return "reasonable";
  return "none";
}
function amountKindByText(r) {
  const words = r.cases.map(lateFeeCaseText);
  if (words.some((w) => /[$%]/.test(w))) return "figure";
  if (words.includes("a reasonable amount (no figure set)")) return "reasonable";
  if (words.length > 0 && words.every((w) => w === "no amount set") && lateFeeDayText(r) !== "None set") return "none";
  return "";
}
var codeOrder = (a, b) => a.localeCompare(b);
var sortedCodes = (codes) => [...codes].sort(codeOrder);
var codesOf = (rows) => sortedCodes(rows.map((r) => r.code));
function spreadByTally(codes, items) {
  const whole = items.filter((i) => Number.isSafeInteger(i.value));
  const tally = refTally(whole);
  const most = tally[0]?.codes.length ?? 0;
  const ext = refExtremes(whole);
  return {
    codes: sortedCodes(codes),
    top: tally.filter((t) => t.codes.length === most).map((t) => ({ value: t.value, codes: sortedCodes(t.codes) })),
    low: ext ? { value: ext.min, codes: sortedCodes(ext.minCodes) } : null,
    high: ext ? { value: ext.max, codes: sortedCodes(ext.maxCodes) } : null
  };
}
function spreadBySorting(codes, keys) {
  const pairs = [...keys].map((k) => {
    const [v, code] = k.split("|");
    return { value: Number(v), code: code ?? "" };
  }).sort((a, b) => a.value - b.value || codeOrder(a.code, b.code));
  const runs = [];
  for (const p of pairs) {
    const last = runs[runs.length - 1];
    if (last && last.value === p.value) last.codes.push(p.code);
    else runs.push({ value: p.value, codes: [p.code] });
  }
  let most = 0;
  for (const run of runs) if (run.codes.length > most) most = run.codes.length;
  return { codes: sortedCodes(codes), top: runs.filter((run) => run.codes.length === most), low: runs[0] ?? null, high: runs[runs.length - 1] ?? null };
}
function lateFeeWho(codes, members) {
  return codes.length <= 5 ? refNameList(codes, members) : `${codes.length} of them`;
}
function lateFeeCountNamed(codes, members) {
  return codes.length >= 1 && codes.length <= 5 ? `${codes.length} (${refNameList(codes, members)})` : String(codes.length);
}
function andList(words) {
  return words.length <= 1 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
function spreadWords(s, label, members) {
  if (!s.low || !s.high) return { range: "", common: "" };
  if (s.low.value === s.high.value) return { range: `all ${label(s.low.value)}`, common: "" };
  const range = `from ${label(s.low.value)} (${lateFeeWho(s.low.codes, members)}) to ${label(s.high.value)} (${lateFeeWho(s.high.codes, members)})`;
  const most = s.top[0]?.codes.length ?? 0;
  if (most < 2) return { range, common: "" };
  const common = s.top.length === 1 ? `; ${label(s.top[0].value)} is the most common, in ${lateFeeWho(s.top[0].codes, members)}` : `; ${andList(s.top.map((t) => most <= 5 ? `${label(t.value)} (${refNameList(t.codes, members)})` : label(t.value)))} are the most common, each in ${most} of them`;
  return { range, common };
}
function agree(checks, id, label, first, second) {
  const a = first;
  const b = second;
  const off = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k]) ?? "none"} one way, ${JSON.stringify(b[k]) ?? "none"} the other`);
  checks.that(id, label, off.length === 0, off.join("; "));
}
var rowPercents = (r) => [...new Set(r.cases.flatMap((c) => c.terms.flatMap((t) => t.kind === "percent" ? [t.bp] : [])))];
var rowFlats = (r) => [...new Set(r.cases.flatMap((c) => c.terms.flatMap((t) => t.kind === "flat" ? [t.cents] : [])))];
function lateFeeFindings(table = LATE_FEE_TABLE) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered : [];
  const members = table.members;
  const id = table.id;
  const checks = new CheckList();
  const n = rows.length;
  const ofRows = `Of the ${n} with a row`;
  const verb = (k, one2, many) => k === 1 ? one2 : many;
  const kind = (k) => codesOf(rows.filter((r) => amountKind(r) === k));
  const figure = kind("figure");
  const reasonable = kind("reasonable");
  const none = kind("none");
  const byText = (k) => codesOf(rows.filter((r) => amountKindByText(r) === k));
  const memberCodes = members.map((m) => m.code);
  agree(
    checks,
    `${id}-figure`,
    'The rows, and how many set a figure, say only "reasonable", or set no amount: counted again from the members list and from the printed figures',
    { withRow: n, members: members.length, figure, reasonable, none },
    { withRow: memberCodes.filter((c) => rows.some((r) => r.code === c)).length, members: new Set(memberCodes).size, figure: byText("figure"), reasonable: byText("reasonable"), none: byText("none") }
  );
  const whole = members === REF_US_STATES_DC ? " (the 50 states and DC)" : "";
  const figureText = `${n} of the ${members.length}${whole} ${verb(n, "has", "have")} a row: ${lateFeeCountNamed(figure, members)} ${verb(figure.length, "sets", "set")} a dollar or percent figure for the fee, ${lateFeeCountNamed(reasonable, members)} ${verb(reasonable.length, "says", "say")} only that the fee must be reasonable, and ${lateFeeCountNamed(none, members)} ${verb(none.length, "sets", "set")} a waiting period but no amount.`;
  const pctFirst = spreadByTally(
    codesOf(rows.filter((r) => rowPercents(r).length > 0)),
    rows.flatMap((r) => rowPercents(r).map((value) => ({ code: r.code, value })))
  );
  const pctKeys = /* @__PURE__ */ new Set();
  for (const r of rows) for (const c of r.cases) for (const t of c.terms) if (t.kind === "percent") pctKeys.add(`${t.bp}|${r.code}`);
  const pctSecond = spreadBySorting(codesOf(rows.filter((r) => lateFeeTopPercent(r) !== null)), pctKeys);
  agree(checks, `${id}-percent`, "The percents named: how many rows, the lowest, the highest, and the most common, worked out again by sorting each state's percents", pctFirst, pctSecond);
  const pctWords = spreadWords(pctFirst, lateFeePercent, members);
  const percentText = `${ofRows}, ${pctFirst.codes.length} ${verb(pctFirst.codes.length, "names", "name")} a percent of the rent or of the unpaid rent${pctWords.range ? `, ${pctWords.range}` : ""}${pctWords.common}.`;
  const flatFirst = spreadByTally(
    codesOf(rows.filter((r) => rowFlats(r).length > 0)),
    rows.flatMap((r) => rowFlats(r).map((value) => ({ code: r.code, value })))
  );
  const flatKeys = /* @__PURE__ */ new Set();
  for (const r of rows) for (const c of r.cases) for (const t of c.terms) if (t.kind === "flat") flatKeys.add(`${t.cents}|${r.code}`);
  const flatSecond = spreadBySorting(codesOf(rows.filter((r) => r.cases.some((c) => lateFeeCaseText(c).includes("$")))), flatKeys);
  agree(checks, `${id}-flat`, "The dollar amounts named: how many rows, the lowest, the highest, and the most common, worked out again by sorting each state's amounts", flatFirst, flatSecond);
  const flatWords = spreadWords(flatFirst, formatUSD, members);
  const flatText = `${ofRows}, ${flatFirst.codes.length} ${verb(flatFirst.codes.length, "names", "name")} a dollar amount${flatWords.range ? `, ${flatWords.range}` : ""}${flatWords.common}.`;
  const greater = codesOf(rows.filter((r) => r.cases.some((c) => c.rule === "greater")));
  const lesser = codesOf(rows.filter((r) => r.cases.some((c) => c.rule === "lesser")));
  const neither = codesOf(rows.filter((r) => amountKind(r) === "figure" && !r.cases.some((c) => c.rule === "greater" || c.rule === "lesser")));
  const saysWords = (start) => codesOf(rows.filter((r) => r.cases.some((c) => lateFeeCaseText(c).startsWith(start))));
  agree(
    checks,
    `${id}-compare`,
    "The rows that take the greater or the lesser of two figures: counted again from the printed words",
    { greater, lesser },
    { greater: saysWords("the greater of "), lesser: saysWords("the lesser of ") }
  );
  const compareText = `${ofRows}, ${lateFeeCountNamed(greater, members)} ${verb(greater.length, "takes", "take")} the greater of two figures and ${lateFeeCountNamed(lesser, members)} ${verb(lesser.length, "takes", "take")} the lesser of two figures.`;
  const calendar = codesOf(rows.filter((r) => r.feeFromDay !== null && r.dayBasis === "calendar"));
  const business = codesOf(rows.filter((r) => r.feeFromDay !== null && r.dayBasis === "business"));
  const noWait = codesOf(rows.filter((r) => r.feeFromDay === null));
  const dayWords = (test) => codesOf(rows.filter((r) => test(lateFeeDayText(r))));
  const withWait = calendar.length + business.length;
  agree(
    checks,
    `${id}-wait`,
    "The rows with a waiting period in calendar days, in business days, or none: counted again from the printed first fee day",
    { withWait, calendar, business, none: noWait },
    { withWait: dayWords((w) => w !== "None set").length, calendar: dayWords((w) => w.startsWith("Day ")), business: dayWords((w) => w.startsWith("Business day ")), none: dayWords((w) => w === "None set") }
  );
  const howCounted = business.length === 0 ? ", all in calendar days" : calendar.length === 0 ? `, all in business days` : `, ${calendar.length} in calendar days and ${lateFeeCountNamed(business, members)} in business days`;
  const waitText = `${ofRows}, ${withWait} ${verb(withWait, "sets", "set")} a waiting period before a late fee${withWait > 0 ? howCounted : ""}, and ${noWait.length} ${verb(noWait.length, "sets", "set")} none.`;
  const calRows = rows.filter((r) => r.feeFromDay !== null && r.dayBasis === "calendar");
  const dayFirst = spreadByTally(codesOf(calRows), calRows.map((r) => ({ code: r.code, value: r.feeFromDay })));
  const dayKeys = /* @__PURE__ */ new Set();
  const printed = rows.filter((r) => /^Day \d+ after the due date$/.test(lateFeeDayText(r)));
  for (const r of printed) dayKeys.add(`${/^Day (\d+)/.exec(lateFeeDayText(r))[1]}|${r.code}`);
  const daySecond = spreadBySorting(codesOf(printed), dayKeys);
  agree(checks, `${id}-first-day`, "The first fee days in calendar days: how many rows, the earliest, the latest, and the most common, worked out again from the printed days by sorting", dayFirst, daySecond);
  const dWords = spreadWords(dayFirst, (v) => `day ${v}`, members);
  const firstDayText = calRows.length === 0 ? `${ofRows}, none counts its waiting period in calendar days.` : dayFirst.low && dayFirst.high && dayFirst.low.value === dayFirst.high.value ? `Of the ${calRows.length} with a waiting period in calendar days, the first fee day is day ${dayFirst.low.value} after the due date in all of them.` : `Of the ${calRows.length} with a waiting period in calendar days, the first fee day runs ${dWords.range} after the due date${dWords.common}.`;
  const sums = [];
  if (n + gaps.length !== members.length) sums.push(`${n} rows and ${gaps.length} not covered make ${n + gaps.length}, not the ${members.length} members`);
  if (figure.length + reasonable.length + none.length !== n) sums.push(`figure, "reasonable", and no amount make ${figure.length + reasonable.length + none.length}, not ${n}`);
  const textKinds = byText("figure").length + byText("reasonable").length + byText("none").length;
  if (textKinds !== n) sums.push(`the printed figure, "reasonable", and no amount make ${textKinds}, not ${n}`);
  if (greater.length + lesser.length + neither.length !== figure.length) sums.push(`greater, lesser, and neither make ${greater.length + lesser.length + neither.length}, not the ${figure.length} with a figure`);
  if (calendar.length + business.length + noWait.length !== n) sums.push(`calendar, business, and no waiting period make ${calendar.length + business.length + noWait.length}, not ${n}`);
  checks.that(`${id}-groups`, "The rows and the not-covered list make every member, and each finding's groups add up to the rows they split", sums.length === 0, sums.join("; "));
  return {
    findings: [
      { id: "figure", text: figureText },
      { id: "percent", text: percentText },
      { id: "flat", text: flatText },
      { id: "compare", text: compareText },
      { id: "wait", text: waitText },
      { id: "first-day", text: firstDayText }
    ],
    checks: checks.all
  };
}

// packages/agents/src/tables/index.ts
var MEMBER_SHAPE = /^(?:[A-Za-z]{1,3}|\d{4}-[A-Za-z]{1,3})$/;
var DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
var SITE = "https://mathproven.com";
var STATES_HELP = /* @__PURE__ */ (() => "a state's two-letter postal code (OH, NY), or DC for the District of Columbia")();
var STATE_NOUN = /* @__PURE__ */ (() => ({ one: "state", many: "states" }))();
var NOT_ZERO = /* @__PURE__ */ (() => 'Missing means the table has no row for it, not a figure of zero or "none".')();
var sentence = /* @__PURE__ */ (() => ((s) => {
  const t = s.trim();
  return t === "" || /[.!?]$/.test(t) ? t : `${t}.`;
}))();
var joinText = /* @__PURE__ */ (() => ((parts) => parts.filter((p) => typeof p === "string" && p.trim() !== "").map(sentence).join(" ")))();
function unique(sources) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of sources) {
    const key = `${s.citation}|${s.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ citation: s.citation, sourceUrl: s.sourceUrl, checkedOn: s.checkedOn });
  }
  return out;
}
var AS_READ_RULE = /* @__PURE__ */ (() => "The rows carry no dates of their own: each is the rule as read on the day beside its source, and the table holds no other version. A date on or after that day gets the row; a date before it gets the row with a plain note that the rule in force on that earlier date is not in the table.")();
function asReadNotes(rows, date) {
  const days = [...new Set(rows.map((r) => r.checkedOn))].sort();
  const later = days.filter((d) => d > date);
  if (later.length > 0) {
    return [`The row was read on ${later.join(" and ")}, after ${date}. The table holds the rule as read that day and no earlier version, so whether it read the same on ${date} is not covered here.`];
  }
  return [`${date} is on or after the day the row was read (${days.join(" and ")}); the row is the rule as read then. Rules change: the source address is where to read the current text.`];
}
function gapReason(gaps, code, fallback) {
  return gaps.find((g) => g.code === code)?.reason ?? fallback;
}
function asReadPick(rows, codeOf, gaps, code, date) {
  const mine = rows.filter((r) => codeOf(r) === code);
  if (mine.length === 0) return { rows: [], notCovered: gapReason(gaps, code, "Not read from an official source for this table yet."), notes: [] };
  return { rows: mine, notes: asReadNotes(mine, date) };
}
function once(f) {
  let done = false;
  let value;
  const get = () => {
    if (!done) {
      value = f();
      done = true;
    }
    return value;
  };
  return Object.assign(get, { computed: () => done });
}
var lateFees = /* @__PURE__ */ (() => ({
  id: "rent-late-fee-limits",
  page: "property-management/rent-late-fee-limits",
  section: "property-management",
  title: "Residential rent late fee limits and grace periods by state",
  pageTitle: "Rent Late Fee Limits by State: Caps and Grace Periods, with Sources",
  description: "The most a state statute lets a landlord charge as a late fee on residential rent (a percent of the rent or of the unpaid rent, a flat amount, or the greater or lesser of two, by rent band where the statute has them) and how many days after the due date the statute makes the landlord wait before charging one, with the conditions in words. Use it when someone asks the legal cap on a rent late fee or the grace period for rent in a state.",
  question: "What is the most a landlord can charge as a late fee on rent in North Carolina?",
  notAdvice: "Mathproven gives figures and waiting periods from the cited statutes only; leases, cities, and counties can set lower limits or longer waits. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: LATE_FEE_TABLE.members,
  table: LATE_FEE_TABLE,
  rows: LATE_FEE_TABLE.rows,
  notCovered: LATE_FEE_TABLE.notCovered,
  check: once(() => checkLateFeeTable()),
  findings: once(() => lateFeeFindings()),
  codeOf: (r) => r.code,
  sources: (r) => [{ citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn }],
  rowText: (r) => joinText([
    `Late fee cap: ${r.capText}`,
    ...r.cases.map((c) => `${c.label}: ${lateFeeCaseText(c)}`),
    `First fee day: ${lateFeeDayText(r)}. ${r.graceText}`,
    r.notes && `Conditions (our summary): ${r.notes}`
  ]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var DEPOSIT_MEMBERS = /* @__PURE__ */ (() => DEPOSIT_STATES.map((s) => ({ code: s.state, name: s.name })))();
var DEPOSIT_GAP = /* @__PURE__ */ (() => "Left out until its official sources have been read; missing does not mean no rule.")();
var depositMore = /* @__PURE__ */ (() => ((r) => (r.moreSources ?? []).map((url, i) => ({ citation: `Further official page read for this row (source ${i + 2})`, sourceUrl: url, checkedOn: r.checkedOn }))))();
var DEPOSIT_REF = /* @__PURE__ */ (() => ({
  id: "security-deposit-rules",
  label: "residential security deposit rules by state",
  checkedOn: DEPOSIT_RULES.reduce((d, r) => r.checkedOn > d ? r.checkedOn : d, ""),
  members: DEPOSIT_MEMBERS,
  rows: DEPOSIT_RULES.map((rule) => ({ code: rule.state, citation: rule.citation, sourceUrl: rule.sourceUrl, checkedOn: rule.checkedOn, rule })),
  notCovered: depositStatesNotCovered().map((s) => ({ code: s.state, reason: DEPOSIT_GAP }))
}))();
var depositRules = /* @__PURE__ */ (() => ({
  id: "security-deposit-rules",
  page: "property-management/security-deposit-rules",
  section: "property-management",
  title: "Residential security deposit rules by state: maximum, return period, interest",
  pageTitle: "Security Deposit Rules by State: Maximums, Return Periods, Interest",
  description: "Each state's residential security deposit statute: the maximum deposit it states (in months of rent, with its other tiers in words), the days it gives for returning the deposit or an itemized list after move-out and what starts each count, and whether it requires interest to be paid to the tenant. Use it when someone asks how much a landlord may take as a security deposit, or how many days a landlord has to return one, in a state.",
  question: "How many days does a Florida landlord have to return a security deposit?",
  notAdvice: "Mathproven gives each statute's figures, not a statement of what anyone is required to do. Statutes differ on how days are counted and on what starts the count; the row and its source say which event the statute names.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: DEPOSIT_MEMBERS,
  table: DEPOSIT_RULES,
  rows: DEPOSIT_RULES,
  notCovered: DEPOSIT_REF.notCovered,
  check: once(() => refCheckTable(DEPOSIT_REF, (r) => r.code, (r) => depositMore(r.rule))),
  codeOf: (r) => r.state,
  sources: (r) => unique([{ citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn }, ...depositMore(r)]),
  rowText: (r) => joinText([
    `Maximum deposit: ${r.maxDepositHalfMonths === null ? r.maxDepositText : `${halfMonthsLabel(r.maxDepositHalfMonths)} (${r.maxDepositText})`}`,
    ...r.deadlines.map((d) => `Return period: ${d.days} ${d.basis === "business" ? "days, not counting weekends or legal holidays" : "days"}: ${d.appliesTo}. Counted from: ${d.clockStarts}`),
    `Interest: ${r.interest === "yes" ? "Yes" : r.interest === "conditional" ? "Conditional" : "No requirement stated"}. ${r.interestText}`,
    r.notes && `Notes (our summary): ${r.notes}`
  ]),
  dateRule: AS_READ_RULE,
  // The page's convention (DEPOSIT_MAX_CONVENTION) in words for text: the page shows the chosen maximum in bold.
  tableNotes: ["Where a statute states more than one maximum, the figure in months of rent is the one for an unfurnished unit rented for a fixed term longer than month to month, with no pet or other add-on; every other tier is written out beside it."],
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var AGENT_TABLES = [lateFees, depositRules];
function tablePageUrl(t, ref) {
  return `${SITE}/${t.page}/${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
}
function resolveMember(t, raw, date) {
  const text = raw.trim();
  if (!MEMBER_SHAPE.test(text)) throw new AgentInputError(`The member must be a member's code: ${t.memberHelp}. It is never an amount or a name.`);
  if (t.resolve) return t.resolve(text, date);
  const code = text.toUpperCase();
  const found = t.members.find((m) => m.code === code);
  if (!found) throw new AgentInputError(`That code is not one of this table's ${t.members.length} ${t.memberNoun.many}. Give ${t.memberHelp}.`);
  return found;
}
function checkDay(raw) {
  const text = raw.trim();
  if (!DAY_SHAPE.test(text) || !refIsDay(text) || text < "1900-01-01" || text > "2200-12-31") throw new AgentInputError("The date must be a real day written YYYY-MM-DD, such as 2026-08-15.");
  return text;
}
function withoutFigures(checks) {
  return checks.map((c) => ({ id: c.id, label: c.label, passed: c.passed, severity: c.severity }));
}
function failedLines(checks) {
  return failures(checks).map((c) => c.label).join("; ");
}
function readTable(t, memberRaw, dateRaw, dateGiven = true) {
  const date = checkDay(dateRaw);
  const member = resolveMember(t, memberRaw, date);
  const checks = t.check();
  const verified = passedAll(checks);
  const pick = t.pick(member.code, date, dateGiven);
  const who = `${member.name} (${member.code})`;
  const notes = [...pick.notes, ...t.tableNotes ?? []];
  if (!verified) {
    return {
      table: t.id,
      title: t.title,
      page: tablePageUrl(t),
      member,
      date,
      rows: [],
      notCovered: null,
      notes: [],
      checks: withoutFigures(checks),
      verified,
      summary: `${t.title}: the table's own certificate failed (${failedLines(checks)}), so no row is given for ${who}.`
    };
  }
  const rows = pick.rows.map((r) => ({ text: t.rowText(r), sources: unique(t.sources(r)) }));
  const notCovered = rows.length === 0 ? pick.notCovered ?? "Not covered by this table." : null;
  const summary = notCovered === null ? `${who}, for ${date}: ${rows.length === 1 ? "its row" : `its ${rows.length} rows`} in the table, with the citation, source address and day read of each.` : `${who} is not covered by this table for ${date}. ${sentence(notCovered)} ${NOT_ZERO}`;
  return { table: t.id, title: t.title, page: tablePageUrl(t), member, date, rows, notCovered, notes, checks, verified, summary };
}
for (const t of AGENT_TABLES) {
  t.check();
  t.findings?.();
}

// packages/agents/src/tables/entries.ts
function dayOf(now) {
  return now.toISOString().slice(0, 10);
}
function lookupEntryName(t) {
  return t.id.replace(/-/g, "_");
}
function memberInput(t) {
  return { name: "member", kind: "text", label: t.memberNoun.one.replace(/^./, (c) => c.toUpperCase()), description: `The ${t.memberNoun.one} to read, by its code: ${t.memberHelp}.`, required: true };
}
function dateInput(t) {
  return { name: "date", kind: "date", label: "Date", description: `Optional. The day the answer is for, written YYYY-MM-DD; without it, the run's own day. ${t.dateRule}`, required: false };
}
var ANSWER_LINE = "Each row comes with its citation, official source address and the day it was read; a member with no row is answered as not covered, with the reason, never as a zero.";
var EXAMPLES = {
  "charity-audit-thresholds-by-state": [
    {
      label: "The page's worked example: Pennsylvania's three bands",
      args: { member: "PA", date: "2026-11-25" },
      verified: true,
      contains: ["at least $100,000 and less than $250,000", "at least $250,000 and less than $750,000", "at least $750,000", "https://"]
    },
    { label: "Alabama is not covered: its source names no figure", args: { member: "AL" }, verified: true, contains: ["not covered", "names no audited, reviewed, or compiled statement"] }
  ],
  "charity-registration-renewal-dates-by-state": [
    { label: "Pennsylvania's rule, from the page's worked example", args: { member: "PA", date: "2026-11-25" }, verified: true, contains: ["Status: Counted", "Renewal rule (our words):", "Extension:"] },
    { label: "Georgia is not covered: not read for this table", args: { member: "GA" }, verified: true, contains: ["not covered"] }
  ],
  "fuel-tax-rates-third-quarter-2026": [
    {
      label: "The page's worked example: New York's diesel rate for a day in the quarter",
      args: { member: "NY", date: "2026-08-15" },
      verified: true,
      contains: ["$0.3805", "New York State Department of Taxation and Finance, IFTA-105", "2026-10-14"]
    },
    { label: "Kentucky: the surcharge is kept apart from the base rate", args: { member: "ky", date: "2026-07-01" }, verified: true, contains: ["$0.2200", "diesel $0.1050"] },
    { label: "Oregon is not covered: the quarter's tables print no diesel rate for it", args: { member: "OR", date: "2026-09-30" }, verified: true, contains: ["not covered", "no diesel rate for Oregon"] },
    { label: "A date outside the quarter is not covered, and says which quarter the table holds", args: { member: "NY", date: "2026-11-25" }, verified: true, contains: ["not covered", "July 1, 2026 to September 30, 2026"] }
  ],
  "capital-gains-rate-thresholds": [
    {
      label: "The page's worked example: 2027, single",
      args: { member: "S", date: "2027-03-01" },
      verified: true,
      contains: ["$51,050.00", "$563,200.00", "$200,000.00", "Rev. Proc. 2026-35"]
    },
    { label: "A tax year and status together", args: { member: "2026-MFJ" }, verified: true, contains: ["$98,900.00", "$613,700.00", "$250,000.00"] },
    { label: "Tax year 2028 is not covered", args: { member: "MFJ", date: "2028-06-01" }, verified: true, contains: ["not covered", "tax years 2025, 2026 and 2027 only"] }
  ],
  "uncashed-check-dormancy-periods": [
    {
      label: "The page's worked example: North Carolina, vendor and payroll checks",
      args: { member: "NC", date: "2026-10-19" },
      verified: true,
      contains: ["Vendor check: 5 years", "Payroll check: 1 year", "N.C. Gen. Stat."]
    },
    { label: "A date before the row was read: the earlier rule is not covered", args: { member: "NC", date: "2020-01-01" }, verified: true, contains: ["not covered here", "Vendor check: 5 years"] }
  ],
  "unclaimed-property-notice-windows": [
    {
      label: "The page's worked example: Delaware's 120 to 60 days before the report",
      args: { member: "DE", date: "2026-12-01" },
      verified: true,
      contains: ["Not more than 120 days, at least 60 days before"]
    },
    { label: "New York's window, from the same example", args: { member: "NY", date: "2026-12-01" }, verified: true, contains: ["At least 90 days before"] },
    { label: "Maine is not covered", args: { member: "ME" }, verified: true, contains: ["not covered"] }
  ],
  "prompt-payment-deadlines": [
    {
      label: "The page's worked example: Ohio, a contractor pays a subcontractor",
      args: { member: "OH", date: "2026-03-02" },
      verified: true,
      contains: ["Contractor pays a subcontractor: 10 days after", "18.00% per year", "Ohio Rev. Code § 4113.61(A)(1)"]
    },
    { label: "New Hampshire is not covered", args: { member: "NH" }, verified: true, contains: ["not covered"] }
  ],
  "retainage-limits": [
    { label: "The page's worked example: California, public jobs", args: { member: "CA" }, verified: true, contains: ["Public jobs: general rate 5.00%", "Cal. Pub. Contract Code § 7201(b)", "Rate has conditions"] },
    { label: "Texas is not covered: not checked yet", args: { member: "TX" }, verified: true, contains: ["not covered", "missing does not mean no limit"] }
  ],
  "economic-nexus-thresholds": [
    { label: `The page's worked example: Kansas reads "in excess of" $100,000`, args: { member: "KS" }, verified: true, contains: ["More than $100,000.00", "Sales test only"] },
    { label: 'Rhode Island reads "equal to or exceeding" $100,000', args: { member: "RI" }, verified: true, contains: ["$100,000.00 or more", "200 or more", "Either test"] },
    { label: "A date before the row was read: the earlier rule is not covered", args: { member: "WA", date: "2019-01-01" }, verified: true, contains: ["not covered here", "no longer applies from 2019-03-14"] }
  ],
  "surplus-lines-tax-rates": [
    { label: "The page's worked example: Oregon's 2% tax and 0.3% second charge", args: { member: "OR" }, verified: true, contains: ["Surplus lines premium tax rate: 2%", "Second charge: 0.3% (State Fire Marshal tax)"] },
    { label: "A date before the row was read: the earlier rule is not covered", args: { member: "OR", date: "2025-01-01" }, verified: true, contains: ["not covered here"] }
  ],
  "surplus-lines-stamping-fees": [
    { label: "The page's worked example: New York, a policy effective December 15, 2026", args: { member: "NY", date: "2026-12-15" }, verified: true, contains: ["0.15%", "2023-01-01 to 2026-12-31"] },
    { label: "The page's worked example: New York, a policy effective January 15, 2027", args: { member: "NY", date: "2027-01-15" }, verified: true, contains: ["0.17%", "2027-01-01 on"] },
    { label: "Michigan is not covered: not read", args: { member: "MI", date: "2026-12-15" }, verified: true, contains: ["not covered"] },
    { label: "A policy date before every window the table holds is not covered", args: { member: "NY", date: "2022-06-01" }, verified: true, contains: ["not covered", "a fee for that date was not read"] }
  ],
  "trust-record-retention-by-state": [
    { label: "The page's worked example: Pennsylvania, five years", args: { member: "PA" }, verified: true, contains: ["5 years", "whichever is later"] },
    { label: "A date before the row was read: the earlier rule is not covered", args: { member: "PA", date: "2024-06-30" }, verified: true, contains: ["not covered here"] }
  ],
  "rent-late-fee-limits": [
    { label: "The page's worked example: North Carolina takes the greater of two figures", args: { member: "NC", date: "2026-11-01" }, verified: true, contains: ["the greater of $15.00 or 5% of the rent", "Day 5 after the due date"] },
    { label: "The page's worked example: New York takes the lesser", args: { member: "NY", date: "2026-11-01" }, verified: true, contains: ["the lesser of $50.00 or 5% of the rent", "Day 6 after the due date"] },
    { label: "Alabama is not covered", args: { member: "AL" }, verified: true, contains: ["not covered"] }
  ],
  "security-deposit-rules": [
    { label: "The page's worked example: Florida's 15 and 30 days", args: { member: "FL", date: "2025-06-30" }, verified: true, contains: ["Return period: 15 days", "Return period: 30 days"] },
    { label: "California is not covered: its sources have not been read", args: { member: "CA" }, verified: true, contains: ["not covered", "missing does not mean no rule"] }
  ]
};
function cellsOf(rows) {
  return rows.map((r) => [...r]);
}
function entryFor(t) {
  return {
    name: lookupEntryName(t),
    page: t.page,
    section: t.section,
    kind: "lookup",
    title: t.title,
    description: `${t.description} ${ANSWER_LINE}`,
    question: t.question,
    inputs: [memberInput(t), dateInput(t)],
    limits: "free",
    notAdvice: t.notAdvice,
    run({ values, now }) {
      const member = typeof values.member === "string" ? values.member : "";
      const given = typeof values.date === "string";
      const a = readTable(t, member, given ? values.date : dayOf(now), given);
      const who = `${a.member.name} (${a.member.code})`;
      const tables = [];
      if (a.notCovered !== null) {
        tables.push({ name: "Not covered", rows: cellsOf([["Member", "Date", "Reason"], [who, a.date, a.notCovered]]) });
      } else if (a.rows.length > 0) {
        tables.push({ name: "Rows", rows: cellsOf([["Member", "Row", "Citation", "Source address", "Read on"], ...a.rows.map((r) => [who, r.text, r.sources[0]?.citation ?? "", r.sources[0]?.sourceUrl ?? "", r.sources[0]?.checkedOn ?? ""])]) });
        const more = a.rows.flatMap((r) => r.sources.slice(1).map((s) => [who, s.citation, s.sourceUrl, s.checkedOn]));
        if (more.length > 0) tables.push({ name: "Further sources", rows: cellsOf([["Member", "Citation", "Source address", "Read on"], ...more]) });
      }
      return { summary: [a.summary, ...a.notes].join(" "), tables, checks: a.checks };
    },
    examples: EXAMPLES[t.id] ?? []
  };
}
function lookupEntries() {
  return AGENT_TABLES.map(entryFor);
}

// mp-entry:mp-entry:main
var pool = [...PROPERTY_MANAGEMENT, ...lookupEntries()];
var names = ["cam_reconciliation_tenant_shares", "cam_gross_up_pool_split", "base_year_expense_stop_true_up", "owner_statement_from_ledger", "security_deposit_interest_statement", "short_term_rental_payout_reconciler", "cam_reconciliation_template_workbook", "owner_statement_template_workbook", "rent_late_fee_limits", "security_deposit_rules"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.1", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
