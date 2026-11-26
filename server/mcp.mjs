#!/usr/bin/env node
// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  NONPROFITS,
  NONPROFITS_NOT_FOR_AGENTS
} from "./lib/nonprofits.mjs";
import {
  TRUCKING,
  TRUCKING_NOT_FOR_AGENTS
} from "./lib/trucking.mjs";
import {
  CONSTRUCTION,
  CONSTRUCTION_NOT_FOR_AGENTS
} from "./lib/construction.mjs";
import "./lib/payappcheck.mjs";
import "./lib/promptPay.mjs";
import "./lib/lienWaiver.mjs";
import {
  PROPERTY_MANAGEMENT,
  PROPERTY_MANAGEMENT_NOT_FOR_AGENTS
} from "./lib/property-management.mjs";
import "./lib/strPayout.mjs";
import "./lib/percent.mjs";
import {
  GENERAL
} from "./lib/general.mjs";
import {
  BOOKKEEPING,
  BOOKKEEPING_NOT_FOR_AGENTS
} from "./lib/bookkeeping.mjs";
import "./lib/dormancyPeriods.mjs";
import "./lib/recDifference.mjs";
import "./lib/cells.mjs";
import {
  INSURANCE_COMMISSIONS,
  INSURANCE_COMMISSIONS_NOT_FOR_AGENTS
} from "./lib/insurance-commissions.mjs";
import "./lib/missingCommissions.mjs";
import "./lib/surplusLinesStampingFees.mjs";
import "./lib/surplusLinesTax.mjs";
import {
  parseCsv,
  toCsv
} from "./lib/csv.mjs";
import {
  refIsDay
} from "./lib/sourced.mjs";
import {
  LAW_TRUST,
  LAW_TRUST_NOT_FOR_AGENTS
} from "./lib/law-trust.mjs";
import {
  ECOMMERCE,
  ECOMMERCE_NOT_FOR_AGENTS
} from "./lib/ecommerce.mjs";
import "./lib/usStates.mjs";
import {
  verifyTemplateWorkbook
} from "./lib/templates.mjs";
import {
  SITE_URL,
  isVerified,
  present
} from "./lib/present.mjs";
import {
  readXlsx,
  writeXlsx
} from "./lib/fflate.mjs";
import {
  AgentInputError,
  beginColumnLog,
  checkValue,
  columnsInput,
  mapColumns,
  oneFile,
  preferSheet,
  takeColumnLog
} from "./lib/sheets.mjs";
import {
  scaledFormat,
  scaledParse,
  sheetCell,
  sheetDataRows,
  sheetGuessColumns,
  sheetIsTotalWord,
  sheetRowChecks
} from "./lib/sheetInput.mjs";
import {
  pmCellToCents,
  pmCellToIsoDate
} from "./lib/reconcile.mjs";
import "./lib/calendarDays.mjs";
import {
  CheckList,
  certificateText,
  certify,
  failures,
  formatUSD,
  parseAmount,
  passedAll,
  sum,
  toDecimal
} from "./lib/money.mjs";

// packages/agents/src/mcp.ts
import { webcrypto } from "node:crypto";

// packages/agents/src/countFile.ts
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
function countFilePath(pluginData, home = homedir()) {
  const data = (pluginData ?? "").trim();
  if (data !== "") return join(data, "runs.json");
  return join(home, ".mathproven", "runs.json");
}
function readCounts(path, month) {
  const empty = { month, runs: {} };
  if (!existsSync(path)) return empty;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const data = parsed;
  if (data.month !== month || typeof data.runs !== "object" || data.runs === null) return empty;
  const runs = {};
  for (const [tool, n] of Object.entries(data.runs)) {
    if (TOOL_NAME.test(tool) && Number.isSafeInteger(n) && n > 0) runs[tool] = n;
  }
  return { month, runs };
}
function writeCounts(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(data)}
`, "utf8");
    renameSync(temp, path);
  } catch (err) {
    try {
      rmSync(temp, { force: true });
    } catch {
    }
    throw err;
  }
}
var FileRunCounter = class {
  constructor(path) {
    this.path = path;
  }
  used(tool, month) {
    return readCounts(this.path, month).runs[tool] ?? 0;
  }
  add(tool, month) {
    const data = readCounts(this.path, month);
    data.runs[tool] = (data.runs[tool] ?? 0) + 1;
    try {
      writeCounts(this.path, data);
    } catch {
    }
  }
};

// packages/agents/src/files.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { basename, dirname as dirname2, extname, resolve } from "node:path";
var MAX_FILE_BYTES = 50 * 1024 * 1024;
function firstFilled(sheets) {
  const filled = sheets.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  return filled ? filled.rows : [];
}
function fromCsvText(text2, name) {
  const clean = text2.replace(/^﻿/, "");
  const rows = parseCsv(clean);
  const sheets = [{ name, rows }];
  return { name, sheets, rows: firstFilled(sheets) };
}
function looksLikeCsvText(value) {
  const v = value.trim();
  if (/\r?\n/.test(v)) return true;
  if (!v.includes(",") || existsSync2(v)) return false;
  const pathLike = /\.(csv|xlsx|xls|txt)$/i.test(v) || /[\\/]/.test(v);
  return !pathLike;
}
function readFileArgument(value) {
  if (looksLikeCsvText(value)) return fromCsvText(value, "pasted CSV");
  const path = resolve(value.trim());
  if (!existsSync2(path)) throw new AgentInputError(`No file at "${value}". Give the path to a .csv or .xlsx file on this computer, or the CSV text itself.`);
  const st = statSync(path);
  if (!st.isFile()) throw new AgentInputError(`"${value}" is a folder, not a file.`);
  if (st.size > MAX_FILE_BYTES) throw new AgentInputError(`"${basename(path)}" is larger than 50 MB.`);
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  if (ext === ".csv" || ext === ".txt") return fromCsvText(readFileSync2(path, "utf8"), name);
  if (ext === ".xlsx") {
    let sheets;
    try {
      sheets = readXlsx(new Uint8Array(readFileSync2(path)));
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
  if (existsSync2(full)) return `A file is already at "${full}". Give a new file name; nothing was replaced.`;
  if (!existsSync2(dirname2(full))) return `The folder "${dirname2(full)}" does not exist, so nothing could be saved there.`;
  return "";
}
function saveFile(path, bytes) {
  const full = resolve(path.trim());
  if (existsSync2(full)) throw new AgentInputError(`A file is already at "${full}". Give a new file name; nothing was replaced.`);
  writeFileSync2(full, bytes, { flag: "wx" });
  return full;
}

// packages/core/src/license.ts
var LICENSE_PREFIX = "th1";
var LICENSE_MAX_SECONDS_AHEAD = 40 * 86400;
function fromBase64Url(text2) {
  const bin = atob(text2.replace(/-/g, "+").replace(/_/g, "/"));
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
  const text2 = `Mathproven, ${entry.title}: not run. ${message}`;
  return { ok: false, verified: false, text: note ? [note, text2].join("\n\n") : text2 };
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
  const text2 = [note, shown.text, saveNote].filter((s) => s !== "").join("\n\n");
  return { ok: true, verified: shown.verified, text: text2, structured: shown.structured };
}

// packages/agents/src/version.ts
var AGENTS_VERSION = "0.1.0";

// packages/agents/src/mcp.ts
var LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
var MODERN_VERSIONS = ["2026-07-28"];
var SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
var SERVER_NAME = "mathproven";
var SERVER_TITLE = "Mathproven";
var META_VERSION = "io.modelcontextprotocol/protocolVersion";
var META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
var LIST_TTL_MS = 36e5;
var ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unsupportedVersion: -32022 };
function inputProperty(input) {
  const base = { title: input.label, description: input.description };
  switch (input.kind) {
    case "files":
      return { type: "array", ...base, items: { type: "string" } };
    case "amounts":
      return { type: "array", ...base, items: { type: "string" } };
    case "choice":
      return { type: "string", ...base, enum: [...input.choices ?? []] };
    case "boolean":
      return { type: "boolean", ...base };
    case "year":
      return { type: "string", ...base, pattern: "^[0-9]{4}$" };
    case "date":
      return { type: "string", ...base, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
    case "file":
    case "amount":
    case "number":
    case "text":
      return { type: "string", ...base };
  }
}
function inputSchema(entry) {
  const properties = {};
  const required = [];
  for (const input of inputsOf(entry)) {
    properties[input.name] = inputProperty(input);
    if (input.required) required.push(input.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
function toolOf(entry) {
  return {
    name: entry.name,
    title: entry.title,
    description: entry.description,
    inputSchema: inputSchema(entry),
    annotations: { title: entry.title, readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  };
}
function settingValue(value) {
  const v = (value ?? "").trim();
  return /^\$\{[^}]*\}$/.test(v) ? "" : v;
}
function serverSettings() {
  const pluginKey = settingValue(process.env.CLAUDE_PLUGIN_OPTION_MATHPROVEN_KEY);
  const appKey = settingValue(process.env.MATHPROVEN_KEY);
  const pluginData = settingValue(process.env.CLAUDE_PLUGIN_DATA);
  return { key: pluginKey || appKey, pluginData };
}
function serverInstructions(entries2, titles = {}) {
  const named = (section) => titles[section] ?? section.replace(/[-_]+/g, " ");
  const tools = entries2.filter((e) => e.kind !== "lookup");
  const lookups = entries2.filter((e) => e.kind === "lookup");
  const sections = [...new Set(tools.map((e) => e.section))].map((s) => `${named(s)} (${tools.filter((e) => e.section === s).length})`);
  const lines = [
    `Mathproven's checked-math tools, run on this computer: ${tools.length} tool${tools.length === 1 ? "" : "s"} by section, ${sections.join(", ")}.`,
    "Each tool recomputes its result a second way and returns it with a reconciliation certificate, or says NOT VERIFIED and names the check that failed."
  ];
  if (lookups.length > 0) {
    const subjects = lookups.map((e) => e.subject ?? e.title);
    lines.push(`It also holds ${lookups.length} lookup table${lookups.length === 1 ? "" : "s"}, each answer with its citation and official source: ${subjects.join("; ")}.`);
  }
  lines.push("It reads only the files a call names and its own count of the month's free runs, and sends nothing anywhere.");
  return lines.join(" ");
}
function errorMessage(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: data === void 0 ? { code, message } : { code, message, data } };
}
function isId(v) {
  return typeof v === "string" || typeof v === "number" && Number.isFinite(v);
}
function ensureWebCrypto() {
  const g = globalThis;
  if (!g.crypto || !g.crypto.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
}
var McpServer = class {
  constructor(options) {
    this.options = options;
    this.version = options.version ?? AGENTS_VERSION;
    this.instructions = options.instructions ?? serverInstructions(options.entries, options.sectionTitles);
    const settings = options.settings ?? serverSettings();
    this.key = settingValue(settings.key);
    this.counter = options.counter ?? new FileRunCounter(countFilePath(settingValue(settings.pluginData)));
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.byName = new Map(options.entries.map((e) => [e.name, e]));
    this.tools = options.entries.map(toolOf);
  }
  tools;
  byName;
  version;
  key;
  counter;
  now;
  /** What the server holds, sent as `instructions` (serverInstructions). */
  instructions;
  serverInfo() {
    return { name: SERVER_NAME, title: SERVER_TITLE, version: this.version };
  }
  /** The answer to one parsed message, or null for a notification (nothing is sent back). */
  async handle(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return errorMessage(null, ERRORS.invalidRequest, "Invalid request: each message must be one JSON-RPC object.");
    const req = raw;
    const hasId = "id" in req && req.id !== void 0;
    if (typeof req.method !== "string") {
      if (!hasId || "result" in req || "error" in req) return null;
      return errorMessage(isId(req.id) ? req.id : null, ERRORS.invalidRequest, 'Invalid request: "method" is missing.');
    }
    if (!hasId) return null;
    if (!isId(req.id)) return errorMessage(null, ERRORS.invalidRequest, 'Invalid request: "id" must be a string or a number.');
    const id = req.id;
    const params = typeof req.params === "object" && req.params !== null && !Array.isArray(req.params) ? req.params : {};
    const meta = typeof params._meta === "object" && params._meta !== null ? params._meta : {};
    const asked = meta[META_VERSION];
    const modern = asked !== void 0;
    if (modern && !MODERN_VERSIONS.includes(asked)) {
      return errorMessage(id, ERRORS.unsupportedVersion, "Unsupported protocol version", { supported: [...SUPPORTED_VERSIONS], requested: asked });
    }
    const done = (result, cached = false) => {
      if (!modern) return { jsonrpc: "2.0", id, result };
      const extra = cached ? { ttlMs: LIST_TTL_MS, cacheScope: "public" } : {};
      return { jsonrpc: "2.0", id, result: { resultType: "complete", ...result, ...extra, _meta: { [META_SERVER_INFO]: this.serverInfo() } } };
    };
    try {
      switch (req.method) {
        case "initialize": {
          const wanted = params.protocolVersion;
          const protocolVersion = typeof wanted === "string" && LEGACY_VERSIONS.includes(wanted) ? wanted : LEGACY_VERSIONS[0];
          return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: this.serverInfo(), instructions: this.instructions } };
        }
        case "server/discover":
          return {
            jsonrpc: "2.0",
            id,
            result: { resultType: "complete", supportedVersions: [...SUPPORTED_VERSIONS], capabilities: { tools: {} }, instructions: this.instructions, _meta: { [META_SERVER_INFO]: this.serverInfo() }, ttlMs: LIST_TTL_MS, cacheScope: "public" }
          };
        case "ping":
          return done({});
        case "tools/list":
          return done({ tools: this.tools }, true);
        case "tools/call":
          return done(await this.call(params));
        default:
          return errorMessage(id, ERRORS.methodNotFound, `Method not found: "${req.method}". This server answers initialize, server/discover, ping, tools/list and tools/call.`);
      }
    } catch (err) {
      if (err instanceof ParamsError) return errorMessage(id, ERRORS.invalidParams, err.message);
      return errorMessage(id, ERRORS.internal, "The server could not answer this request.");
    }
  }
  /** One tool call: the runner's outcome as text and as structured content. */
  async call(params) {
    const name = params.name;
    if (typeof name !== "string" || name === "") throw new ParamsError('tools/call needs "name": the tool to run.');
    const entry = this.byName.get(name);
    if (!entry) throw new ParamsError(`Unknown tool: "${name}". The tools are the ones tools/list gives.`);
    const args = params.arguments ?? {};
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      const text2 = `Mathproven, ${entry.title}: not run. The arguments must be an object of named inputs.`;
      return { content: [{ type: "text", text: text2 }], structuredContent: { tool: entry.name, verified: false, refused: true, message: text2 }, isError: true };
    }
    ensureWebCrypto();
    const ctx = {
      now: this.now(),
      ref: this.options.ref,
      version: this.version,
      readFile: readFileArgument,
      saveProblem,
      writeFile: saveFile,
      counter: this.counter,
      ...this.key !== "" ? { key: this.key } : {}
    };
    const outcome = await runEntry(entry, args, ctx);
    const structuredContent = outcome.structured ?? { tool: entry.name, verified: false, refused: true, message: outcome.text };
    return { content: [{ type: "text", text: outcome.text }], structuredContent, isError: !outcome.ok };
  }
  /** The answer to one line of input: one message, a batch (an array, answered as an array), or a parse error. */
  async handleLine(line) {
    const text2 = line.trim();
    if (text2 === "") return null;
    let parsed;
    try {
      parsed = JSON.parse(text2);
    } catch {
      return errorMessage(null, ERRORS.parse, "Parse error: a message must be one JSON object on one line.");
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return errorMessage(null, ERRORS.invalidRequest, "Invalid request: an empty batch.");
      const out = [];
      for (const item of parsed) {
        const answer = await this.handle(item);
        if (answer) out.push(answer);
      }
      return out.length > 0 ? out : null;
    }
    return this.handle(parsed);
  }
};
var ParamsError = class extends Error {
};
var MAX_LINE_CHARS = 64 * 1024 * 1024;
var TOO_LONG = {
  jsonrpc: "2.0",
  id: null,
  error: { code: ERRORS.invalidRequest, message: "Invalid request: a message longer than 64 MiB was refused. Give a large file by its path, not as text." }
};
function startMcpServer(options, streams = { input: process.stdin, output: process.stdout }) {
  const server = new McpServer(options);
  let buffer = "";
  let dropping = false;
  let queue = Promise.resolve();
  const send = (answer) => {
    if (!answer) return;
    try {
      streams.output.write(`${JSON.stringify(answer)}
`);
    } catch {
    }
  };
  const take = (line) => {
    queue = queue.then(async () => send(await server.handleLine(line))).catch(() => void 0);
  };
  const refuseLong = () => {
    queue = queue.then(() => send(TOO_LONG)).catch(() => void 0);
  };
  return new Promise((resolveDone) => {
    streams.input.setEncoding?.("utf8");
    streams.input.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        if (dropping) dropping = false;
        else if (at > MAX_LINE_CHARS) refuseLong();
        else take(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
      if (buffer.length > MAX_LINE_CHARS) {
        if (!dropping) refuseLong();
        dropping = true;
        buffer = "";
      }
    });
    streams.input.on("end", () => {
      if (!dropping && buffer.trim() !== "") take(buffer);
      buffer = "";
      void queue.then(() => resolveDone());
    });
  });
}
function runMcpProcess(options) {
  process.stdout.on("error", () => void 0);
  try {
    void startMcpServer(options);
  } catch (err) {
    process.stderr.write(`Mathproven MCP server could not start: ${err instanceof Error ? err.message : "unknown reason"}
`);
    process.exitCode = 1;
  }
}

// packages/agents/src/tables/index.ts
var MEMBER_SHAPE = /^(?:[A-Za-z]{1,3}|\d{4}-[A-Za-z]{1,3})$/;
var DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
var SITE = "https://mathproven.com";
var NOT_ZERO = /* @__PURE__ */ (() => 'Missing means the table has no row for it, not a figure of zero or "none".')();
var sentence = /* @__PURE__ */ (() => ((s) => {
  const t = s.trim();
  return t === "" || /[.!?]$/.test(t) ? t : `${t}.`;
}))();
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
var AGENT_TABLES = [];
function tablePageUrl(t, ref) {
  return `${SITE}/${t.page}/${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
}
function resolveMember(t, raw, date) {
  const text2 = raw.trim();
  if (!MEMBER_SHAPE.test(text2)) throw new AgentInputError(`The member must be a member's code: ${t.memberHelp}. It is never an amount or a name.`);
  if (t.resolve) return t.resolve(text2, date);
  const code = text2.toUpperCase();
  const found = t.members.find((m) => m.code === code);
  if (!found) throw new AgentInputError(`That code is not one of this table's ${t.members.length} ${t.memberNoun.many}. Give ${t.memberHelp}.`);
  return found;
}
function checkDay(raw) {
  const text2 = raw.trim();
  if (!DAY_SHAPE.test(text2) || !refIsDay(text2) || text2 < "1900-01-01" || text2 > "2200-12-31") throw new AgentInputError("The date must be a real day written YYYY-MM-DD, such as 2026-08-15.");
  return text2;
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
    subject: t.subject,
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

// packages/core/src/crypto/input.ts
var CX_QUANTITY_PLACES = 8;
var CX_TRADE_ROLES = ["date", "type", "asset", "quantity", "amount", "fee", "basis", "account"];
var CX_TRADE_LABELS = {
  date: "Date (and time)",
  type: "Type (buy or sell)",
  asset: "Asset",
  quantity: "Quantity",
  amount: "Total cost or proceeds",
  fee: "Fee",
  basis: "Cost basis listed for a sale",
  account: "Account or wallet"
};
var SYNONYMS = {
  date: ["timestamp", "date", "date time", "time", "date sold", "transaction date", "trade date", "datetime", "date utc", "timestamp utc"],
  type: ["transaction type", "type", "side", "action", "operation", "trade type"],
  asset: ["asset", "currency", "coin", "symbol", "ticker", "base asset", "base currency", "token"],
  quantity: ["quantity transacted", "quantity", "amount of asset", "units", "qty", "size", "volume", "quantity sold"],
  amount: ["proceeds", "total", "subtotal", "total usd", "usd amount", "gross proceeds", "value usd", "cost", "amount usd", "amount"],
  fee: ["fee", "fees", "fee usd", "fees usd", "commission", "fees and or spread"],
  basis: ["cost basis", "basis", "cost basis usd"],
  account: ["account", "wallet", "exchange", "portfolio", "source", "account name"]
};
function cxGuessTradeColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, CX_TRADE_ROLES, SYNONYMS, atHeaderRow);
}
function cxTimestamp(raw) {
  const s = raw.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso) return `${pmCellToIsoDate(iso[1])}T${iso[2]}:${iso[3]}:${iso[4] ?? "00"}`;
  const time = /\s(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*(?:UTC|Z)?$/.exec(s);
  if (!time) return `${pmCellToIsoDate(s)}T00:00:00`;
  let hour = Number(time[1]);
  const half = time[4]?.toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (hour > 23 || Number(time[2]) > 59 || Number(time[3] ?? "0") > 59) throw new Error(`not a recognizable time: "${raw}"`);
  return `${pmCellToIsoDate(s.slice(0, time.index))}T${String(hour).padStart(2, "0")}:${time[2]}:${time[3] ?? "00"}`;
}
function cxSide(text2) {
  const t = text2.toLowerCase();
  if (/\b(sell|sold|sale|dispos\w*)\b/.test(t)) return "sell";
  if (/\b(buy|bought|purchase\w*)\b/.test(t)) return "buy";
  return null;
}
function cxExtractTrades(rows, mapping, defaultSide) {
  const c = mapping.columns;
  for (const role of ["date", "asset", "amount"]) if (c[role] < 0) throw new Error(`Choose the column that holds: ${CX_TRADE_LABELS[role]}.`);
  if (c.type < 0 && !defaultSide) throw new Error(`Choose the column that holds: ${CX_TRADE_LABELS.type}.`);
  const out = { trades: [], problems: [], skipped: [], otherRows: 0 };
  const abs2 = (n) => n < 0 ? -n : n;
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const dateText = sheetCell(cells, c.date);
    const typeText = sheetCell(cells, c.type);
    if (!dateText && cells.some(sheetIsTotalWord)) {
      out.skipped.push({ rowNumber, reason: "total line" });
      continue;
    }
    if (!dateText && !sheetCell(cells, c.asset) && !sheetCell(cells, c.amount)) {
      out.skipped.push({ rowNumber, reason: "no date, asset, or amount" });
      continue;
    }
    const side = c.type >= 0 ? cxSide(typeText) : defaultSide;
    if (!side) {
      out.skipped.push({ rowNumber, reason: typeText ? `not a buy or a sale (${typeText.slice(0, 40)})` : "no type" });
      out.otherRows++;
      continue;
    }
    try {
      if (!dateText) throw new Error("no date");
      const asset = sheetCell(cells, c.asset).toUpperCase();
      if (!asset) throw new Error("no asset");
      const quantityText2 = sheetCell(cells, c.quantity);
      let quantity = quantityText2 ? scaledParse(quantityText2, CX_QUANTITY_PLACES, "quantity") : 0n;
      if (quantity < 0n) quantity = -quantity;
      const amountText = sheetCell(cells, c.amount);
      if (!amountText) throw new Error("no cost or proceeds");
      const feeText = sheetCell(cells, c.fee);
      const basisText = sheetCell(cells, c.basis);
      out.trades.push({
        rowNumber,
        timestamp: cxTimestamp(dateText),
        side,
        asset,
        quantity,
        amount: abs2(pmCellToCents(amountText)),
        fee: feeText ? abs2(pmCellToCents(feeText)) : 0,
        basis: basisText ? abs2(pmCellToCents(basisText)) : null,
        account: sheetCell(cells, c.account)
      });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}

// packages/core/src/crypto/lotsCheck.ts
var text = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var magnitude = (n) => n < 0n ? -n : n;
var rowList = (rows) => [...new Set(rows)].sort((a, b) => a - b).join(", ");
function cxSecondLotPass(input) {
  const adjust = input.feeHandling === "adjust";
  const byAsset = /* @__PURE__ */ new Map();
  for (const t of input.trades) {
    let lists = byAsset.get(t.asset);
    if (!lists) {
      lists = { buys: [], sales: [] };
      byAsset.set(t.asset, lists);
    }
    (t.side === "buy" ? lists.buys : lists.sales).push(t);
  }
  const inTime = (a, b) => text(a.timestamp, b.timestamp) || a.rowNumber - b.rowNumber;
  const sells = [];
  const pieces = [];
  const holdings = [];
  for (const asset of [...byAsset.keys()].sort(text)) {
    const { buys, sales } = byAsset.get(asset);
    buys.sort(inTime);
    sales.sort(inTime);
    const quantities = [];
    const costs = [];
    const lotRows = [];
    let nextBuy = 0;
    for (const sale of sales) {
      while (nextBuy < buys.length && buys[nextBuy].timestamp <= sale.timestamp) {
        const buy = buys[nextBuy++];
        quantities.push(buy.quantity);
        costs.push(BigInt(buy.amount) + (adjust ? BigInt(buy.fee) : 0n));
        lotRows.push(buy.rowNumber);
      }
      let left = sale.quantity;
      let matched = 0n;
      let used = 0n;
      while (left > 0n) {
        let pick = -1;
        if (input.method === "fifo") {
          pick = quantities.findIndex((q) => q > 0n);
        } else {
          for (let i = quantities.length - 1; i >= 0; i--) {
            if (quantities[i] > 0n && (pick < 0 || costs[i] * quantities[pick] >= costs[pick] * quantities[i])) pick = i;
          }
        }
        if (pick < 0) break;
        const held = quantities[pick];
        const cost = costs[pick];
        const take = left < held ? left : held;
        const n = cost * (held - take);
        const stays = n / held + (2n * (n % held) > held ? 1n : 0n);
        quantities[pick] = held - take;
        costs[pick] = stays;
        left -= take;
        matched += take;
        used += cost - stays;
        pieces.push({ sellRowNumber: sale.rowNumber, buyRowNumber: lotRows[pick], quantity: take, costBasis: Number(cost - stays) });
      }
      sells.push({ sellRowNumber: sale.rowNumber, quantity: matched, costBasis: Number(used) });
    }
    for (; nextBuy < buys.length; nextBuy++) {
      quantities.push(buys[nextBuy].quantity);
      costs.push(BigInt(buys[nextBuy].amount) + (adjust ? BigInt(buys[nextBuy].fee) : 0n));
    }
    holdings.push({ asset, quantity: quantities.reduce((a, q) => a + q, 0n), costBasis: Number(costs.reduce((a, c) => a + c, 0n)) });
  }
  sells.sort((a, b) => a.sellRowNumber - b.sellRowNumber);
  pieces.sort((a, b) => a.sellRowNumber - b.sellRowNumber);
  return { sells, pieces, holdings };
}
function cxIsRounded(value, n, d) {
  if (d <= 0n) return false;
  const gap = magnitude(value * d - n);
  if (2n * gap !== d) return 2n * gap < d;
  return magnitude(value * d) > magnitude(n);
}
function cxIsRealTimestamp(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  const daysIn = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}
function cxVerifyGains(input, result, second) {
  const checks = new CheckList();
  const adjust = input.feeHandling === "adjust";
  const quantityText2 = (q) => scaledFormat(q, CX_QUANTITY_PLACES, true);
  let notWhole = 0;
  const cents = (n) => {
    if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
    notWhole++;
    return 0n;
  };
  const units = (q) => {
    if (typeof q === "bigint") return q;
    notWhole++;
    return 0n;
  };
  const buys = /* @__PURE__ */ new Map();
  const sales = /* @__PURE__ */ new Map();
  const seenRows = /* @__PURE__ */ new Set();
  const repeatedRows = [];
  const assets = /* @__PURE__ */ new Set();
  const accounts = /* @__PURE__ */ new Set();
  let saleProceeds = 0n;
  for (const t of input.trades) {
    if (seenRows.has(t.rowNumber)) repeatedRows.push(t.rowNumber);
    seenRows.add(t.rowNumber);
    assets.add(t.asset);
    accounts.add(t.account);
    const amount = cents(t.amount);
    const fee = adjust ? cents(t.fee) : 0n;
    if (t.side === "buy") {
      if (!buys.has(t.rowNumber)) buys.set(t.rowNumber, { asset: t.asset, timestamp: t.timestamp, quantity: units(t.quantity), cost: amount + fee });
    } else {
      saleProceeds += amount - fee;
      if (!sales.has(t.rowNumber)) sales.set(t.rowNumber, { asset: t.asset, timestamp: t.timestamp, quantity: units(t.quantity), proceeds: amount - fee });
    }
  }
  const rows = result.rows.map((r) => ({ ...r, q: units(r.quantity), p: cents(r.proceeds), c: cents(r.costBasis), g: cents(r.gain) }));
  const left = result.remaining.map((l) => ({ ...l, q: units(l.quantity), c: cents(l.costBasis) }));
  const short = result.shortfalls.map((s) => ({ ...s, q: units(s.quantity), p: cents(s.proceeds) }));
  const otherSells = second.sells.map((s) => ({ row: s.sellRowNumber, q: units(s.quantity), c: cents(s.costBasis) }));
  const otherPieces = second.pieces.map((p) => ({ sell: p.sellRowNumber, buy: p.buyRowNumber, q: units(p.quantity), c: cents(p.costBasis) }));
  const otherHoldings = second.holdings.map((h) => ({ asset: h.asset, q: units(h.quantity), c: cents(h.costBasis) }));
  checks.that("cx-gain-whole-numbers", "Every amount is a whole number of cents and every quantity a whole number of units", notWhole === 0, `${notWhole} figure(s) are not whole numbers`);
  const matchedBySale = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const m = matchedBySale.get(r.sellRowNumber) ?? { q: 0n, c: 0n };
    matchedBySale.set(r.sellRowNumber, { q: m.q + r.q, c: m.c + r.c });
  }
  const engineSales = [];
  const otherBySale = /* @__PURE__ */ new Map();
  for (const s of otherSells) {
    if (otherBySale.has(s.row) || !sales.has(s.row)) engineSales.push(s.row);
    otherBySale.set(s.row, { q: s.q, c: s.c });
  }
  for (const row of /* @__PURE__ */ new Set([...sales.keys(), ...matchedBySale.keys()])) {
    const mine = matchedBySale.get(row) ?? { q: 0n, c: 0n };
    const theirs = otherBySale.get(row) ?? { q: 0n, c: 0n };
    if (mine.q !== theirs.q || mine.c !== theirs.c) engineSales.push(row);
  }
  const pairs = /* @__PURE__ */ new Map();
  const pairOf = (sell, buy) => {
    const key = `${sell}:${buy}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { sell, q: 0n, c: 0n, other: { q: 0n, c: 0n } };
      pairs.set(key, pair);
    }
    return pair;
  };
  for (const r of rows) {
    const pair = pairOf(r.sellRowNumber, r.buyRowNumber);
    pair.q += r.q;
    pair.c += r.c;
  }
  for (const p of otherPieces) {
    const pair = pairOf(p.sell, p.buy);
    pair.other.q += p.q;
    pair.other.c += p.c;
  }
  for (const pair of pairs.values()) if (pair.q !== pair.other.q || pair.c !== pair.other.c) engineSales.push(pair.sell);
  const leftByAsset = /* @__PURE__ */ new Map();
  for (const l of left) {
    const m = leftByAsset.get(l.asset) ?? { q: 0n, c: 0n };
    leftByAsset.set(l.asset, { q: m.q + l.q, c: m.c + l.c });
  }
  const engineAssets = [];
  const otherAssets = /* @__PURE__ */ new Set();
  for (const h of otherHoldings) {
    const mine = leftByAsset.get(h.asset) ?? { q: 0n, c: 0n };
    if (otherAssets.has(h.asset) || mine.q !== h.q || mine.c !== h.c) engineAssets.push(h.asset);
    otherAssets.add(h.asset);
  }
  for (const asset of /* @__PURE__ */ new Set([...assets, ...leftByAsset.keys()])) if (!otherAssets.has(asset)) engineAssets.push(asset);
  checks.that(
    "cx-gain-engines",
    "A second lot engine, written a different way, agrees on the lots, quantity, and cost basis of every sale and on what is left of every asset",
    engineSales.length === 0 && engineAssets.length === 0,
    [engineSales.length ? `sale row(s) ${rowList(engineSales)}` : "", engineAssets.length ? `asset(s) ${[...new Set(engineAssets)].sort(text).join(", ")}` : ""].filter(Boolean).join("; ")
  );
  const strayRows = rows.filter((r) => {
    const sale = sales.get(r.sellRowNumber);
    const buy = buys.get(r.buyRowNumber);
    return !sale || !buy || sale.asset !== r.asset || buy.asset !== r.asset || r.acquired !== buy.timestamp || r.disposed !== sale.timestamp || r.q <= 0n;
  });
  const strayShort = short.filter((s) => {
    const sale = sales.get(s.sellRowNumber);
    return !sale || sale.asset !== s.asset || s.disposed !== sale.timestamp || s.q <= 0n;
  });
  const lotRows = /* @__PURE__ */ new Set();
  const strayLots = left.filter((l) => {
    const buy = buys.get(l.buyRowNumber);
    const repeated = lotRows.has(l.buyRowNumber);
    lotRows.add(l.buyRowNumber);
    return repeated || !buy || buy.asset !== l.asset || l.acquired !== buy.timestamp || l.q <= 0n;
  });
  checks.that(
    "cx-gain-rows-trades",
    "Every worksheet row, lot still held, and unmatched quantity belongs to a real buy or sale of its own asset and carries that trade’s date and time",
    strayRows.length === 0 && strayShort.length === 0 && strayLots.length === 0,
    [strayRows.length + strayShort.length ? `sale row(s) ${rowList([...strayRows, ...strayShort].map((r) => r.sellRowNumber))}` : "", strayLots.length ? `buy row(s) ${rowList(strayLots.map((l) => l.buyRowNumber))}` : ""].filter(Boolean).join("; ")
  );
  const badQuantity = [.../* @__PURE__ */ new Set([...assets, ...rows.map((r) => r.asset), ...left.map((l) => l.asset), ...short.map((s) => s.asset)])].filter((asset) => {
    const of = (list, pick) => [...list].filter((x) => x.asset === asset).reduce((a, x) => a + pick(x), 0n);
    const bought = of(buys.values(), (b) => b.quantity);
    const sold = of(sales.values(), (s) => s.quantity);
    const matched = of(rows, (r) => r.q);
    return bought - matched !== of(left, (l) => l.q) || sold !== matched + of(short, (s) => s.q);
  });
  checks.that("cx-gain-quantity", "Quantity is conserved for every asset: bought minus sold equals what is left", badQuantity.length === 0, badQuantity.sort(text).join(", "));
  const fromLot = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const m = fromLot.get(r.buyRowNumber) ?? { q: 0n, c: 0n };
    fromLot.set(r.buyRowNumber, { q: m.q + r.q, c: m.c + r.c });
  }
  const leftInLot = /* @__PURE__ */ new Map();
  for (const l of left) {
    const m = leftInLot.get(l.buyRowNumber) ?? { q: 0n, c: 0n };
    leftInLot.set(l.buyRowNumber, { q: m.q + l.q, c: m.c + l.c });
  }
  const badLots = [...buys].filter(([row, buy]) => {
    const used = fromLot.get(row) ?? { q: 0n, c: 0n };
    const kept = leftInLot.get(row) ?? { q: 0n, c: 0n };
    return used.q + kept.q !== buy.quantity || used.c + kept.c !== buy.cost;
  });
  checks.that("cx-gain-lots", "Every lot is conserved: what was sold from it plus what is left equals what was bought, in quantity and in cost", badLots.length === 0, `buy row(s) ${rowList(badLots.map(([row]) => row))}`);
  const badBasis = [.../* @__PURE__ */ new Set([...assets, ...rows.map((r) => r.asset), ...left.map((l) => l.asset)])].filter((asset) => {
    const cost = [...buys.values()].filter((b) => b.asset === asset).reduce((a, b) => a + b.cost, 0n);
    const used = rows.filter((r) => r.asset === asset).reduce((a, r) => a + r.c, 0n);
    const kept = left.filter((l) => l.asset === asset).reduce((a, l) => a + l.c, 0n);
    return cost !== used + kept;
  });
  checks.that("cx-gain-basis", "Cost basis used plus basis left equals total cost, for every asset", badBasis.length === 0, badBasis.sort(text).join(", "));
  const lotState = /* @__PURE__ */ new Map();
  const badCost = [];
  for (const r of rows) {
    const buy = buys.get(r.buyRowNumber);
    if (!buy) continue;
    const lot = lotState.get(r.buyRowNumber) ?? { q: buy.quantity, c: buy.cost };
    const fits = r.q > 0n && r.q <= lot.q;
    const right = fits && (r.q === lot.q ? r.c === lot.c : cxIsRounded(r.c, lot.c * r.q, lot.q));
    if (!right) badCost.push(r.sellRowNumber);
    lotState.set(r.buyRowNumber, { q: lot.q - r.q, c: lot.c - r.c });
  }
  checks.that("cx-gain-row-cost", "Each row’s cost basis is its lot’s cost times the quantity taken divided by the lot’s quantity, rounded to the cent, and a lot taken whole gives all its cost", badCost.length === 0, `sale row(s) ${rowList(badCost)}`);
  const shownProceeds = rows.reduce((a, r) => a + r.p, 0n) + short.reduce((a, s) => a + s.p, 0n);
  checks.cents("cx-gain-proceeds", "Proceeds on the worksheet plus proceeds of any unmatched quantity equal total sale proceeds", Number(saleProceeds), Number(shownProceeds));
  const running = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const sale = sales.get(r.sellRowNumber);
    if (!sale) continue;
    const so = running.get(r.sellRowNumber) ?? { q: 0n, p: 0n, bad: false };
    const q = so.q + r.q;
    const p = so.p + r.p;
    running.set(r.sellRowNumber, { q, p, bad: so.bad || q > sale.quantity || !cxIsRounded(p, sale.proceeds * q, sale.quantity) });
  }
  const shortBySale = /* @__PURE__ */ new Map();
  for (const s of short) {
    const m = shortBySale.get(s.sellRowNumber) ?? { q: 0n, p: 0n };
    shortBySale.set(s.sellRowNumber, { q: m.q + s.q, p: m.p + s.p });
  }
  const badProceeds = [...sales].filter(([row, sale]) => {
    const so = running.get(row) ?? { q: 0n, p: 0n, bad: false };
    const rest = shortBySale.get(row) ?? { q: 0n, p: 0n };
    return so.bad || so.q + rest.q !== sale.quantity || so.p + rest.p !== sale.proceeds;
  });
  checks.that("cx-gain-row-proceeds", "Each sale’s own proceeds are split over its rows by quantity, to the cent, and any unmatched quantity carries the rest", badProceeds.length === 0, `sale row(s) ${rowList(badProceeds.map(([row]) => row))}`);
  const badGain = rows.filter((r) => r.g !== r.p - r.c).map((r) => r.sellRowNumber);
  checks.that("cx-gain-sum", "Gain or loss is proceeds minus cost basis on every row", badGain.length === 0, `sale row(s) ${rowList(badGain)}`);
  const badDates = rows.filter((r) => !cxIsRealTimestamp(r.acquired) || !cxIsRealTimestamp(r.disposed) || r.acquired > r.disposed).map((r) => r.sellRowNumber);
  checks.that("cx-gain-dates", "Acquired and disposed are real calendar dates and times, and every lot was acquired on or before the time it was sold", badDates.length === 0, `sale row(s) ${rowList(badDates)}`);
  checks.that("cx-gain-holdings", "No sale is larger than the holdings before it", short.length === 0, short.map((s) => `row ${s.sellRowNumber}: ${quantityText2(s.q)} ${s.asset} more than was held`).join("; "));
  checks.that("cx-gain-rows-once", "Every trade row was read once", repeatedRows.length === 0, `row(s) ${rowList(repeatedRows)}`);
  const named = [...accounts].sort(text).map((a) => a || "(no account)");
  checks.that("cx-gain-accounts", "All trades come from one account or wallet", accounts.size <= 1, `trades come from ${accounts.size} accounts or wallets (${named.slice(0, 6).join(", ")}${named.length > 6 ? ", …" : ""}); lots are pooled per asset across all of them`, "warning");
  return checks.all;
}

// packages/core/src/crypto/lots.ts
function cxRoundDiv(n, d) {
  if (d <= 0n) throw new Error("Division by zero or a negative number.");
  const abs2 = n < 0n ? -n : n;
  const q = abs2 / d + (2n * (abs2 % d) >= d ? 1n : 0n);
  return n < 0n ? -q : q;
}
function cxBuyCost(trade, feeHandling) {
  return feeHandling === "adjust" ? trade.amount + trade.fee : trade.amount;
}
function cxSellProceeds(trade, feeHandling) {
  return feeHandling === "adjust" ? trade.amount - trade.fee : trade.amount;
}
function cxOrderTrades(trades) {
  for (const t of trades) {
    if (typeof t.quantity !== "bigint" || t.quantity <= 0n) throw new Error(`Row ${t.rowNumber}: the quantity must be more than zero.`);
    if (!Number.isSafeInteger(t.amount) || t.amount < 0) throw new Error(`Row ${t.rowNumber}: the cost or proceeds must be a whole number of cents, zero or more.`);
    if (!Number.isSafeInteger(t.fee) || t.fee < 0) throw new Error(`Row ${t.rowNumber}: the fee must be a whole number of cents, zero or more.`);
    if (t.asset === "") throw new Error(`Row ${t.rowNumber}: no asset.`);
  }
  const rank = (t) => t.side === "buy" ? 0 : 1;
  return [...trades].sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : rank(a) - rank(b) || a.rowNumber - b.rowNumber);
}
function cxMatchLots(input) {
  const rows = [];
  const shortfalls = [];
  const lots = [];
  for (const trade of cxOrderTrades(input.trades)) {
    if (trade.side === "buy") {
      lots.push({ buyRowNumber: trade.rowNumber, asset: trade.asset, acquired: trade.timestamp, quantity: trade.quantity, costBasis: cxBuyCost(trade, input.feeHandling) });
      continue;
    }
    const proceeds = BigInt(cxSellProceeds(trade, input.feeHandling));
    let left = trade.quantity;
    let matched = 0n;
    let given = 0n;
    while (left > 0n) {
      let lot = null;
      for (const candidate of lots) {
        if (candidate.asset !== trade.asset || candidate.quantity <= 0n) continue;
        if (lot === null) {
          lot = candidate;
          if (input.method === "fifo") break;
        } else if (BigInt(candidate.costBasis) * lot.quantity > BigInt(lot.costBasis) * candidate.quantity) {
          lot = candidate;
        }
      }
      if (lot === null) break;
      const take = left < lot.quantity ? left : lot.quantity;
      const cost = take === lot.quantity ? lot.costBasis : Number(cxRoundDiv(BigInt(lot.costBasis) * take, lot.quantity));
      lot.quantity -= take;
      lot.costBasis -= cost;
      matched += take;
      left -= take;
      const upTo = cxRoundDiv(proceeds * matched, trade.quantity);
      const piece = Number(upTo - given);
      given = upTo;
      rows.push({
        sellRowNumber: trade.rowNumber,
        buyRowNumber: lot.buyRowNumber,
        asset: trade.asset,
        acquired: lot.acquired,
        disposed: trade.timestamp,
        quantity: take,
        proceeds: piece,
        costBasis: cost,
        gain: piece - cost
      });
    }
    if (left > 0n) {
      shortfalls.push({ sellRowNumber: trade.rowNumber, asset: trade.asset, disposed: trade.timestamp, quantity: left, proceeds: Number(proceeds - given) });
    }
  }
  return { method: input.method, rows, remaining: lots.filter((lot) => lot.quantity > 0n), shortfalls };
}
function cxCapitalGainsWorksheet(input) {
  cxOrderTrades(input.trades);
  const result = cxMatchLots(input);
  const checks = cxVerifyGains(input, result, cxSecondLotPass(input));
  const totalProceeds = sum(result.rows.map((r) => r.proceeds));
  const totalCostBasis = sum(result.rows.map((r) => r.costBasis));
  return { ...result, totalProceeds, totalCostBasis, totalGain: totalProceeds - totalCostBasis, checks };
}
function cxGainsTables(r) {
  const q = (n) => scaledFormat(n, CX_QUANTITY_PLACES, true);
  const day = (timestamp) => timestamp.slice(0, 10);
  return {
    rows: [
      ["Asset", "Quantity", "Date acquired", "Date disposed", "Proceeds", "Cost basis", "Gain or loss", "Sale row", "Buy row"],
      ...r.rows.map((x) => [x.asset, q(x.quantity), day(x.acquired), day(x.disposed), toDecimal(x.proceeds), toDecimal(x.costBasis), toDecimal(x.gain), x.sellRowNumber, x.buyRowNumber]),
      ["Total", "", "", "", toDecimal(r.totalProceeds), toDecimal(r.totalCostBasis), toDecimal(r.totalGain), "", ""]
    ],
    remaining: [["Asset", "Quantity", "Date acquired", "Cost basis", "Buy row"], ...r.remaining.map((l) => [l.asset, q(l.quantity), day(l.acquired), toDecimal(l.costBasis), l.buyRowNumber])],
    shortfalls: [["Sale row", "Asset", "Date disposed", "Quantity with no lot", "Proceeds of that quantity"], ...r.shortfalls.map((s) => [s.sellRowNumber, s.asset, day(s.disposed), q(s.quantity), toDecimal(s.proceeds)])]
  };
}

// packages/core/src/crypto/averageCost.ts
var CX_PRICE_PLACES = 8;
var CENT_UNITS = 10n ** 14n;
function validate(input) {
  if (input.buys.length === 0) throw new Error("Add at least one buy.");
  for (const b of input.buys) {
    if (typeof b.quantity !== "bigint" || b.quantity <= 0n) throw new Error(`Line ${b.line}: the quantity must be more than zero.`);
    if (!Number.isSafeInteger(b.amount) || b.amount < 0) throw new Error(`Line ${b.line}: the cost must be a whole number of cents, zero or more.`);
    if (!Number.isSafeInteger(b.fee) || b.fee < 0) throw new Error(`Line ${b.line}: the fee must be a whole number of cents, zero or more.`);
  }
  if (input.price !== null && input.price !== void 0 && (typeof input.price !== "bigint" || input.price < 0n)) throw new Error("The price to compare with must be zero or more.");
}
var unitCost = (cost, quantity) => cxRoundDiv(BigInt(cost) * CENT_UNITS, quantity);
function cxAverageCost(input) {
  validate(input);
  const lines = input.buys.map((b) => {
    const cost = input.feeHandling === "adjust" ? b.amount + b.fee : b.amount;
    return { line: b.line, quantity: b.quantity, cost, unitCost: unitCost(cost, b.quantity) };
  });
  let totalQuantity = 0n;
  let totalAmount = 0;
  let totalFees = 0;
  let totalCost = 0;
  input.buys.forEach((b, i) => {
    totalQuantity += b.quantity;
    totalAmount += b.amount;
    totalFees += b.fee;
    totalCost += lines[i].cost;
  });
  if (!Number.isSafeInteger(totalAmount + totalFees)) throw new Error("The total cost is too large to work with.");
  const price = input.price ?? null;
  const value = price === null ? null : Number(cxRoundDiv(totalQuantity * price, CENT_UNITS));
  if (value !== null && !Number.isSafeInteger(value)) throw new Error("The value at that price is too large to work with.");
  const result = { feeHandling: input.feeHandling, lines, totalQuantity, totalAmount, totalFees, totalCost, average: unitCost(totalCost, totalQuantity), price, value, difference: value === null ? null : value - totalCost };
  return { ...result, checks: cxVerifyAverageCost(input, result) };
}
var abs = (n) => n < 0n ? -n : n;
function cxVerifyAverageCost(input, r) {
  const checks = new CheckList();
  const adjust = input.feeHandling === "adjust";
  const whole = 10n ** BigInt(CX_QUANTITY_PLACES);
  let units = 0n;
  let fraction = 0n;
  let amounts = 0n;
  let fees = 0n;
  for (const b of input.buys) {
    units += b.quantity / whole;
    fraction += b.quantity % whole;
    amounts += BigInt(b.amount);
    fees += BigInt(b.fee);
  }
  const quantity = units * whole + fraction;
  const cost = adjust ? amounts + fees : amounts;
  const same = r.lines.length === input.buys.length && input.buys.every((b, i) => {
    const l = r.lines[i];
    return l.line === b.line && l.quantity === b.quantity && BigInt(l.cost) === BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n);
  });
  checks.that("ac-lines", adjust ? "Every buy is in the result once, with its quantity, and its cost is the amount paid plus the fee" : "Every buy is in the result once, with its quantity, and its cost is the amount paid with the fee left out", same);
  checks.equal("ac-quantity", "Total quantity equals the quantities added a second way", scaledFormat(quantity, CX_QUANTITY_PLACES, true), scaledFormat(r.totalQuantity, CX_QUANTITY_PLACES, true));
  checks.cents("ac-amount", "Total paid before fees equals the amounts added a second way", Number(amounts), r.totalAmount);
  checks.cents("ac-fees", "Total fees equal the fees added a second way", Number(fees), r.totalFees);
  checks.cents("ac-cost", adjust ? "Total cost equals total paid before fees plus total fees" : "Total cost equals total paid before fees, with fees left out", Number(cost), r.totalCost);
  const back = (perUnit, q, c) => q > 0n && 2n * abs(perUnit * q - c * CENT_UNITS) <= q;
  const offLines = r.lines.filter((l) => !back(l.unitCost, l.quantity, BigInt(l.cost))).map((l) => l.line);
  checks.that("ac-line-unit", "Each buy's cost per unit, multiplied by its quantity, gives its cost back", offLines.length === 0, `Not so on line(s) ${offLines.join(", ")}`);
  checks.that("ac-average", "The average cost per unit, multiplied by the total quantity, gives the total cost back", back(r.average, quantity, cost), `${cxFormatPrice(r.average)} × ${scaledFormat(quantity, CX_QUANTITY_PLACES, true)} is not ${toDecimal(Number(cost))}`);
  const between = input.buys.length > 0 && input.buys.some((b) => (BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n)) * quantity <= cost * b.quantity) && input.buys.some((b) => (BigInt(b.amount) + (adjust ? BigInt(b.fee) : 0n)) * quantity >= cost * b.quantity);
  const low = r.lines.reduce((m, l) => l.unitCost < m ? l.unitCost : m, r.lines[0]?.unitCost ?? 0n);
  const high = r.lines.reduce((m, l) => l.unitCost > m ? l.unitCost : m, r.lines[0]?.unitCost ?? 0n);
  checks.that("ac-range", "The average cost per unit lies between the lowest and the highest cost per unit among the buys", between && r.average >= low && r.average <= high);
  const price = input.price ?? null;
  if (price !== null) {
    const ok = r.value !== null && r.price === price && 2n * abs(BigInt(r.value) * CENT_UNITS - quantity * price) <= CENT_UNITS;
    checks.that("ac-value", "The value at the price typed is the total quantity times that price, to the cent", ok);
    checks.cents("ac-difference", "The difference is the value at the price typed minus the total cost", (r.value ?? 0) - Number(cost), r.difference ?? Number.NaN);
  } else {
    checks.that("ac-no-price", "No price was typed, so no value is shown", r.value === null && r.difference === null && r.price === null);
  }
  return checks.all;
}
function cxFormatPrice(value) {
  const text2 = scaledFormat(abs(value), CX_PRICE_PLACES);
  const [whole, decimals] = text2.split(".");
  const trimmed = decimals.replace(/0+$/, "").padEnd(2, "0");
  return `${value < 0n ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${trimmed}`;
}
function cxAverageCostTables(r) {
  const q = (n) => scaledFormat(n, CX_QUANTITY_PLACES, true);
  const p = (n) => scaledFormat(n, CX_PRICE_PLACES);
  return {
    lines: [
      ["Line", "Quantity", "Cost", "Cost per unit"],
      ...r.lines.map((l) => [l.line, q(l.quantity), toDecimal(l.cost), p(l.unitCost)]),
      ["Total", q(r.totalQuantity), toDecimal(r.totalCost), p(r.average)]
    ],
    summary: [
      ["Item", "Value"],
      ["Fees", r.feeHandling === "adjust" ? "Added to cost" : "Left out"],
      ["Total quantity", q(r.totalQuantity)],
      ["Total paid before fees", toDecimal(r.totalAmount)],
      ["Total fees", toDecimal(r.totalFees)],
      ["Total cost", toDecimal(r.totalCost)],
      ["Average cost per unit", p(r.average)],
      ...r.price !== null && r.value !== null && r.difference !== null ? [["Price compared with", p(r.price)], ["Value at that price", toDecimal(r.value)], ["Value minus total cost", toDecimal(r.difference)]] : []
    ]
  };
}

// packages/core/src/crypto/holdingPeriod.ts
var CX_HELD_ROLES = ["asset", "quantity", "acquired", "disposed", "proceeds", "basis", "gain"];
var CX_HELD_LABELS = {
  asset: "Asset",
  quantity: "Quantity",
  acquired: "Date acquired",
  disposed: "Date disposed",
  proceeds: "Proceeds",
  basis: "Cost basis",
  gain: "Gain or loss listed in the file"
};
var SYNONYMS2 = {
  asset: ["asset", "currency", "coin", "symbol", "ticker", "token", "description", "asset name"],
  quantity: ["quantity", "qty", "units", "amount", "size", "quantity sold"],
  acquired: ["date acquired", "acquired", "acquisition date", "date bought", "buy date", "purchase date", "date purchased", "open date", "received date"],
  disposed: ["date disposed", "disposed", "date sold", "sale date", "sell date", "disposal date", "date of sale", "close date", "sold date"],
  proceeds: ["proceeds", "gross proceeds", "sale proceeds", "proceeds usd", "amount received"],
  basis: ["cost basis", "basis", "cost basis usd", "cost"],
  gain: ["gain or loss", "gain loss", "gains losses", "realized gain", "realized gain loss", "gain", "profit", "profit loss"]
};
function cxGuessHeldColumns(rows, atHeaderRow) {
  return sheetGuessColumns(rows, CX_HELD_ROLES, SYNONYMS2, atHeaderRow);
}
function cxExtractHeldRows(rows, mapping) {
  const c = mapping.columns;
  for (const role of ["acquired", "disposed", "proceeds", "basis"]) if (c[role] < 0) throw new Error(`Choose the column that holds: ${CX_HELD_LABELS[role]}.`);
  const out = { rows: [], problems: [], skipped: [], fileTotal: null };
  const optional = (text2) => {
    if (!text2) return null;
    try {
      return pmCellToCents(text2);
    } catch {
      return null;
    }
  };
  for (const { rowNumber, cells } of sheetDataRows(rows, mapping.headerRow)) {
    const acquiredText = sheetCell(cells, c.acquired);
    const disposedText = sheetCell(cells, c.disposed);
    const proceedsText = sheetCell(cells, c.proceeds);
    const basisText = sheetCell(cells, c.basis);
    const gainText = sheetCell(cells, c.gain);
    if (!acquiredText && !disposedText) {
      if (cells.some(sheetIsTotalWord)) {
        out.fileTotal ??= { rowNumber, proceeds: optional(proceedsText), costBasis: optional(basisText), gain: optional(gainText) };
        out.skipped.push({ rowNumber, reason: "total line" });
        continue;
      }
      if (!proceedsText && !basisText) {
        out.skipped.push({ rowNumber, reason: "no dates and no amounts" });
        continue;
      }
    }
    try {
      if (!acquiredText) throw new Error("no date acquired");
      if (!disposedText) throw new Error("no date disposed");
      if (!proceedsText) throw new Error("no proceeds");
      if (!basisText) throw new Error("no cost basis");
      out.rows.push({
        rowNumber,
        asset: sheetCell(cells, c.asset).toUpperCase(),
        quantity: sheetCell(cells, c.quantity),
        acquired: pmCellToIsoDate(acquiredText),
        disposed: pmCellToIsoDate(disposedText),
        proceeds: pmCellToCents(proceedsText),
        costBasis: pmCellToCents(basisText),
        listedGain: gainText ? pmCellToCents(gainText) : null
      });
    } catch (err) {
      out.problems.push({ rowNumber, reason: err instanceof Error ? err.message : "could not be read" });
    }
  }
  return out;
}
var CX_HELD_NAMES = {
  "year-or-less": "One year or less",
  "over-a-year": "More than one year"
};
function fields(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a date written as YYYY-MM-DD: "${date}".`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
var isLeap = (year) => year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
var monthLength = (year, month) => month === 2 ? isLeap(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
var write = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function cxOverAYearFrom(acquired) {
  let [y, m, d] = fields(acquired);
  if (d < monthLength(y, m)) d += 1;
  else if (m < 12) [m, d] = [m + 1, 1];
  else [y, m, d] = [y + 1, 1, 1];
  y += 1;
  if (m === 2 && d === 29 && !isLeap(y)) [m, d] = [3, 1];
  return write(y, m, d);
}
function cxDayNumber(date) {
  const [year, month, day] = fields(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
function cxOverAYearByDays(acquired, disposed) {
  const [y, m, d] = fields(acquired);
  const anniversary = m === 2 && d === monthLength(y, 2) ? write(y + 1, 2, monthLength(y + 1, 2)) : write(y + 1, m, d);
  return cxDayNumber(disposed) - cxDayNumber(acquired) > cxDayNumber(anniversary) - cxDayNumber(acquired);
}
function listRows(rows) {
  return `row(s) ${rows.slice(0, 20).join(", ")}${rows.length > 20 ? ` and ${rows.length - 20} more` : ""}`;
}
function cxHoldingPeriodSplit(rows, fileTotal = null) {
  for (const r of rows) {
    if (!Number.isSafeInteger(r.proceeds) || !Number.isSafeInteger(r.costBasis)) throw new Error(`Row ${r.rowNumber}: proceeds and cost basis must be whole numbers of cents.`);
    if (r.listedGain !== null && !Number.isSafeInteger(r.listedGain)) throw new Error(`Row ${r.rowNumber}: the gain or loss must be a whole number of cents.`);
    fields(r.acquired);
    fields(r.disposed);
  }
  const lines = rows.map((r) => ({
    ...r,
    daysHeld: cxDayNumber(r.disposed) - cxDayNumber(r.acquired),
    held: r.disposed >= cxOverAYearFrom(r.acquired) ? "over-a-year" : "year-or-less",
    gain: r.proceeds - r.costBasis
  }));
  const group = (held) => {
    const mine = lines.filter((l) => l.held === held);
    return { held, count: mine.length, proceeds: sum(mine.map((l) => l.proceeds)), costBasis: sum(mine.map((l) => l.costBasis)), gain: sum(mine.map((l) => l.gain)) };
  };
  const groups = [group("year-or-less"), group("over-a-year")];
  const totalProceeds = groups[0].proceeds + groups[1].proceeds;
  const totalCostBasis = groups[0].costBasis + groups[1].costBasis;
  const totalGain = groups[0].gain + groups[1].gain;
  const result = { lines, groups, totalProceeds, totalCostBasis, totalGain };
  return { ...result, checks: cxVerifyHoldingPeriod(rows, fileTotal, result) };
}
function cxVerifyHoldingPeriod(rows, fileTotal, r) {
  const checks = new CheckList();
  const same = r.lines.length === rows.length && rows.every((row, i) => {
    const l = r.lines[i];
    return l.rowNumber === row.rowNumber && l.acquired === row.acquired && l.disposed === row.disposed && l.proceeds === row.proceeds && l.costBasis === row.costBasis;
  });
  checks.that("hp-rows", "The result has every row of the file once, with the dates and amounts read from it", same);
  const backwards = rows.filter((x) => x.disposed < x.acquired).map((x) => x.rowNumber);
  checks.that("hp-dates", "Every row was acquired on or before the date it was disposed", backwards.length === 0, `Disposed before acquired: ${listRows(backwards)}`);
  const disagree = r.lines.filter((l) => l.held === "over-a-year" !== cxOverAYearByDays(l.acquired, l.disposed)).map((l) => l.rowNumber);
  checks.that("hp-two-ways", "The one-year line worked out from calendar dates and from day counts puts every row in the same group", disagree.length === 0, `The two ways differ on ${listRows(disagree)}`);
  const badGain = r.lines.filter((l) => l.gain !== l.proceeds - l.costBasis).map((l) => l.rowNumber);
  checks.that("hp-row-gain", "Gain or loss is proceeds minus cost basis on every row", badGain.length === 0, `Not so on ${listRows(badGain)}`);
  checks.equal("hp-once", "Every row is in exactly one group: the two row counts add up to the number of rows", rows.length, r.groups[0].count + r.groups[1].count);
  let allProceeds = 0n;
  let allBasis = 0n;
  for (const g of r.groups) {
    const over = g.held === "over-a-year";
    let count = 0;
    let proceeds = 0n;
    let basis = 0n;
    for (const row of rows) {
      if (cxOverAYearByDays(row.acquired, row.disposed) !== over) continue;
      count++;
      proceeds += BigInt(row.proceeds);
      basis += BigInt(row.costBasis);
    }
    allProceeds += proceeds;
    allBasis += basis;
    const name = CX_HELD_NAMES[g.held];
    checks.equal(`hp-count-${g.held}`, `${name}: the row count equals the rows counted a second way`, count, g.count);
    checks.cents(`hp-proceeds-${g.held}`, `${name}: proceeds equal the rows added a second way`, Number(proceeds), g.proceeds);
    checks.cents(`hp-basis-${g.held}`, `${name}: cost basis equals the rows added a second way`, Number(basis), g.costBasis);
    checks.cents(`hp-gain-${g.held}`, `${name}: gain or loss equals proceeds minus cost basis`, Number(proceeds - basis), g.gain);
  }
  checks.cents("hp-total-proceeds", "Total proceeds equal the proceeds of the two groups", Number(allProceeds), r.totalProceeds);
  checks.cents("hp-total-basis", "Total cost basis equals the cost basis of the two groups", Number(allBasis), r.totalCostBasis);
  checks.cents("hp-total-gain", "Total gain or loss equals total proceeds minus total cost basis", Number(allProceeds - allBasis), r.totalGain);
  const listed = rows.filter((x) => x.listedGain !== null);
  if (listed.length > 0) {
    const off = listed.filter((x) => x.listedGain !== x.proceeds - x.costBasis).map((x) => x.rowNumber);
    checks.that("hp-listed-gain", `The gain or loss the file lists on ${listed.length} row(s) equals proceeds minus cost basis on each`, off.length === 0, `The file's figure differs on ${listRows(off)}`);
  }
  if (fileTotal) {
    if (fileTotal.proceeds !== null) checks.cents("hp-file-proceeds", `Proceeds on the file's own total line (row ${fileTotal.rowNumber}) equal the proceeds of the rows`, fileTotal.proceeds, r.totalProceeds);
    if (fileTotal.costBasis !== null) checks.cents("hp-file-basis", `Cost basis on the file's own total line (row ${fileTotal.rowNumber}) equals the cost basis of the rows`, fileTotal.costBasis, r.totalCostBasis);
    if (fileTotal.gain !== null) checks.cents("hp-file-gain", `Gain or loss on the file's own total line (row ${fileTotal.rowNumber}) equals the gain or loss of the rows`, fileTotal.gain, r.totalGain);
  }
  const near = rows.filter((x) => x.disposed >= x.acquired && Math.abs(cxDayNumber(x.disposed) - cxDayNumber(cxOverAYearFrom(x.acquired))) <= 1).map((x) => x.rowNumber);
  checks.that("hp-near-line", "No row was disposed within a day of its one-year line", near.length === 0, `Within a day of the line, where one day decides the group: ${listRows(near)}`, "warning");
  return checks.all;
}
function cxHoldingPeriodTables(r) {
  return {
    summary: [
      ["Held", "Rows", "Proceeds", "Cost basis", "Gain or loss"],
      ...r.groups.map((g) => [CX_HELD_NAMES[g.held], g.count, toDecimal(g.proceeds), toDecimal(g.costBasis), toDecimal(g.gain)]),
      ["Total", r.lines.length, toDecimal(r.totalProceeds), toDecimal(r.totalCostBasis), toDecimal(r.totalGain)]
    ],
    rows: [
      ["Asset", "Quantity", "Date acquired", "Date disposed", "Days held", "Line date", "Held", "Proceeds", "Cost basis", "Gain or loss", "File row"],
      ...r.lines.map((l) => [l.asset, l.quantity, l.acquired, l.disposed, l.daysHeld, cxOverAYearFrom(l.acquired), CX_HELD_NAMES[l.held], toDecimal(l.proceeds), toDecimal(l.costBasis), toDecimal(l.gain), l.rowNumber])
    ]
  };
}

// packages/core/src/crypto/tieOut.ts
function cxProceedsTieOut(input) {
  const { disposals, reported } = input;
  if (disposals.length === 0) throw new Error("There are no sales in the export.");
  if (reported.length === 0) throw new Error("Type the total proceeds from the broker statement.");
  const typed = /* @__PURE__ */ new Map();
  for (const entry of reported) {
    if (typed.has(entry.account)) throw new Error(`Account ${entry.account} has more than one typed total.`);
    typed.set(entry.account, entry);
  }
  const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const listedBasis = (d) => d.basis === null ? 0 : d.basis;
  const shown = (account) => account === "" ? "(no account)" : account;
  const accountNames = [.../* @__PURE__ */ new Set([...disposals.map((d) => d.account), ...reported.map((r) => r.account)])].sort(byText);
  const accounts = accountNames.map((account) => {
    const mine = disposals.filter((d) => d.account === account);
    const proceeds = sum(mine.map((d) => d.proceeds));
    const basis = sum(mine.map(listedBasis));
    const entry = typed.get(account);
    const reportedProceeds2 = entry === void 0 ? null : entry.proceeds;
    const reportedBasis = entry === void 0 || entry.basis === void 0 ? null : entry.basis;
    const reportedCount = entry === void 0 || entry.count === void 0 ? null : entry.count;
    return {
      account,
      count: mine.length,
      proceeds,
      basis,
      reportedProceeds: reportedProceeds2,
      difference: reportedProceeds2 === null ? null : proceeds - reportedProceeds2,
      reportedBasis,
      basisDifference: reportedBasis === null ? null : basis - reportedBasis,
      reportedCount
    };
  });
  const linesBy = (keyOf) => [...new Set(disposals.map(keyOf))].sort(byText).map((key) => {
    const mine = disposals.filter((d) => keyOf(d) === key);
    return { key, count: mine.length, proceeds: sum(mine.map((d) => d.proceeds)), basis: sum(mine.map(listedBasis)) };
  });
  const byAsset = linesBy((d) => d.asset);
  const byMonth = linesBy((d) => d.date.slice(0, 7));
  const count = disposals.length;
  const totalProceeds = sum(disposals.map((d) => d.proceeds));
  const totalBasis = sum(disposals.map(listedBasis));
  const reportedProceeds = sum(reported.map((r) => r.proceeds));
  const checks = new CheckList();
  checks.cents("cx-tie-proceeds", "Total proceeds in your export equal the total typed from the broker statement", reportedProceeds, totalProceeds);
  const untied = accounts.filter((a) => a.reportedProceeds === null || a.difference !== 0);
  checks.that(
    "cx-tie-accounts",
    "Every account's proceeds equal the amount typed for it",
    untied.length === 0,
    untied.map((a) => `${shown(a.account)}: export ${formatUSD(a.proceeds)}, statement ${a.reportedProceeds === null ? "not typed" : formatUSD(a.reportedProceeds)}`).join("; ")
  );
  const basisTyped = reported.some((r) => r.basis !== void 0);
  if (basisTyped) {
    const off = accounts.filter((a) => a.reportedBasis !== null && a.basisDifference !== 0);
    checks.that(
      "cx-tie-basis",
      "Cost basis in your export equals the amount typed, wherever one was typed",
      off.length === 0,
      off.map((a) => `${shown(a.account)}: export ${formatUSD(a.basis)}, statement ${formatUSD(a.reportedBasis === null ? 0 : a.reportedBasis)}`).join("; ")
    );
  }
  if (reported.some((r) => r.count !== void 0)) {
    const off = accounts.filter((a) => a.reportedCount !== null && a.reportedCount !== a.count);
    checks.that("cx-tie-count", "The number of sales equals the count typed, wherever one was typed", off.length === 0, off.map((a) => `${shown(a.account)}: export ${a.count}, statement ${a.reportedCount}`).join("; "));
  }
  let allProceeds = 0n;
  let allBasis = 0n;
  for (const d of disposals) {
    allProceeds += BigInt(d.proceeds);
    allBasis += BigInt(listedBasis(d));
  }
  const readds = (lines) => {
    let proceeds = 0n;
    let basis = 0n;
    let n = 0;
    for (const line of lines) {
      proceeds += BigInt(line.proceeds);
      basis += BigInt(line.basis);
      n += line.count;
    }
    return { ok: proceeds === allProceeds && basis === allBasis && n === disposals.length, proceeds };
  };
  const assets = readds(byAsset);
  checks.that(
    "cx-tie-by-asset",
    "Asset totals re-add to the export total and every sale is under exactly one asset",
    assets.ok,
    `assets add to ${formatUSD(Number(assets.proceeds))}, export total ${formatUSD(Number(allProceeds))}`
  );
  const months = readds(byMonth);
  checks.that(
    "cx-tie-by-month",
    "Month totals re-add to the export total and every sale is in exactly one month",
    months.ok,
    `months add to ${formatUSD(Number(months.proceeds))}, export total ${formatUSD(Number(allProceeds))}`
  );
  const seen = /* @__PURE__ */ new Set();
  const repeated = /* @__PURE__ */ new Set();
  for (const d of disposals) {
    if (seen.has(d.rowNumber)) repeated.add(d.rowNumber);
    seen.add(d.rowNumber);
  }
  checks.that("cx-tie-rows-once", "Every sale was counted once", repeated.size === 0, `row(s) ${[...repeated].sort((a, b) => a - b).join(", ")}`);
  if (basisTyped) {
    const unlisted = disposals.filter((d) => d.basis === null).length;
    checks.that("cx-tie-basis-listed", "Every sale in the export lists a cost basis", unlisted === 0, `${unlisted} sale(s) list no cost basis and count as zero`, "warning");
  }
  return { accounts, byAsset, byMonth, count, totalProceeds, totalBasis, reportedProceeds, difference: totalProceeds - reportedProceeds, checks: checks.all };
}
function cxDisposalsFrom(trades, lessFees) {
  return trades.filter((t) => t.side === "sell").map((t) => ({ rowNumber: t.rowNumber, date: t.timestamp.slice(0, 10), asset: t.asset, account: t.account, proceeds: lessFees ? t.amount - t.fee : t.amount, basis: t.basis }));
}
function cxTieOutTables(r) {
  const opt = (c) => c === null ? "" : toDecimal(c);
  const lines = (label, list) => [
    [label, "Sales", "Proceeds", "Cost basis listed"],
    ...list.map((l) => [l.key, l.count, toDecimal(l.proceeds), toDecimal(l.basis)]),
    ["Total", r.count, toDecimal(r.totalProceeds), toDecimal(r.totalBasis)]
  ];
  return {
    accounts: [
      ["Account", "Sales", "Proceeds in export", "Proceeds typed", "Difference", "Cost basis listed", "Cost basis typed", "Basis difference"],
      ...r.accounts.map((a) => [a.account || "(no account)", a.count, toDecimal(a.proceeds), opt(a.reportedProceeds), opt(a.difference), toDecimal(a.basis), opt(a.reportedBasis), opt(a.basisDifference)]),
      ["Total", r.count, toDecimal(r.totalProceeds), toDecimal(r.reportedProceeds), toDecimal(r.difference), toDecimal(r.totalBasis), "", ""]
    ],
    byAsset: lines("Asset", r.byAsset),
    byMonth: lines("Month", r.byMonth)
  };
}

// packages/core/src/crypto/tradeLogTemplate.ts
var CX_TEMPLATE_MAX_ACCOUNTS = 50;
var CX_TEMPLATE_SHEETS = ["Trades", "Accounts", "Log", "Instructions"];
var CX_TEMPLATE_TRADE_HEADERS = ["Date", "Type", "Asset", "Quantity", "Total USD", "Fee USD", "Cost basis USD", "Account", "Notes"];
var CX_TEMPLATE_ACCOUNT_HEADERS = ["Line", "Account or wallet", "Kind", "Notes"];
function cleanOwner(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The name is longer than 120 characters.");
  return s;
}
function cleanYear(value) {
  const s = value.trim();
  if (s !== "" && !/^20\d{2}$/.test(s)) throw new Error("The year must be four digits, from 2000 to 2099.");
  return s;
}
function cleanCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > CX_TEMPLATE_MAX_ACCOUNTS) throw new Error(`The number of accounts and wallets must be a whole number from 1 to ${CX_TEMPLATE_MAX_ACCOUNTS}.`);
  return value;
}
function cxTradeLogTemplateSheets(o) {
  const owner = cleanOwner(o.owner);
  const year = cleanYear(o.year);
  const accounts = cleanCount(o.accountCount);
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/crypto/${slug}/${site ? "?src=template" : ""}`;
  return [
    {
      name: CX_TEMPLATE_SHEETS[0],
      rows: [[...CX_TEMPLATE_TRADE_HEADERS]],
      money: ["Total USD", "Fee USD", "Cost basis USD"],
      widths: [20, 12, 10, 16, 16, 12, 18, 22, 40]
    },
    {
      name: CX_TEMPLATE_SHEETS[1],
      rows: [[...CX_TEMPLATE_ACCOUNT_HEADERS], ...Array.from({ length: accounts }, (_, i) => [i + 1, "", "", ""])],
      money: [],
      widths: [8, 34, 20, 40]
    },
    {
      name: CX_TEMPLATE_SHEETS[2],
      rows: [
        ["Item", "Value"],
        ["Kept for", owner],
        ["Year", year],
        ["Date last updated", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: CX_TEMPLATE_SHEETS[3],
      rows: [
        ["Where", "What goes there"],
        ["About this workbook", "A layout to fill in with buys and sales. It holds values only, with no formulas, so nothing in it calculates."],
        ["Trades", "One row per transaction, under the header row. Do not leave a row blank between two transactions and do not add a total row."],
        ["Date", "The date, with the time when there is one, written like 2026-03-15 or 2026-03-15 16:45:00. The time is kept as written."],
        ["Type", "Buy or Sell. A row with any other type (Send, Receive, Reward, Convert) can be kept here; the tools list it by row number and do not use it."],
        ["Asset", "The symbol, such as BTC."],
        ["Quantity", "How much was bought or sold, with up to 8 decimal places."],
        ["Total USD", "What the buy cost or what the sale brought in, in dollars, before the fee."],
        ["Fee USD", "The fee on the transaction, in dollars. Blank means no fee."],
        ["Cost basis USD", "Only for a sale, and only when a statement or export lists a cost basis for it. Blank otherwise. The tools never fill this in."],
        ["Account", "The account or wallet the row belongs to, as named on the Accounts sheet."],
        ["Accounts", `One row per exchange account or wallet; rows are numbered 1 to ${accounts}. Rows can be added under the last one.`],
        ["Log", "Whose trades these are, the year, and the date the workbook was last updated."],
        ["Capital gains worksheet", `${page("capital-gains-worksheet")} opens this workbook, reads the Trades sheet, and matches each sale to the lots it came from under the method picked there.`],
        ["Proceeds tie-out", `${page("proceeds-tie-out")} opens this workbook, adds up the sales on the Trades sheet, and compares the totals with the ones typed from a broker statement.`]
      ],
      money: [],
      widths: [26, 130]
    }
  ];
}
function cxVerifyTradeLogTemplate(o, bytes) {
  const sheets = cxTradeLogTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const log = rowsOf(CX_TEMPLATE_SHEETS[2]);
  const cell = (label) => log.find((r) => r[0] === label)?.[1] ?? "";
  checks.equal("owner", "The Log sheet carries the name as typed", cleanOwner(o.owner), cell("Kept for"));
  checks.equal("year", "The Log sheet carries the year as typed", cleanYear(o.year), cell("Year"));
  const accounts = rowsOf(CX_TEMPLATE_SHEETS[1]).slice(1);
  checks.that(
    "account-rows",
    `The Accounts sheet has ${o.accountCount} blank rows numbered 1 to ${o.accountCount}`,
    accounts.length === o.accountCount && accounts.every((r, i) => r[0] === String(i + 1) && r.slice(1).every((c) => c === ""))
  );
  const first = read.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  checks.equal("trades-first", "The Trades sheet is the first sheet in the file, the one the tools open", CX_TEMPLATE_SHEETS[0], first?.name ?? "");
  const trades = rowsOf(CX_TEMPLATE_SHEETS[0]);
  const mapping = cxGuessTradeColumns(trades);
  const found = mapping.headerRow === 0 && CX_TRADE_ROLES.every((role) => mapping.columns[role] >= 0);
  const distinct = new Set(CX_TRADE_ROLES.map((role) => mapping.columns[role])).size === CX_TRADE_ROLES.length;
  checks.that("trades-readable", "Every part the tie-out and the capital gains worksheet read is found in the Trades header row, each in a column of its own", found && distinct);
  let empty = false;
  if (found) {
    const x = cxExtractTrades(trades, mapping);
    empty = x.trades.length === 0 && x.problems.length === 0 && x.skipped.length === 0;
  }
  checks.that("trades-empty", "The Trades sheet reads as a trade list with nothing entered yet", empty);
  return checks.all;
}

// packages/agents/src/registry/crypto.ts
var FEE_CHOICES = ["added", "left out"];
var feeHandlingOf = (choice) => choice === "added" ? "adjust" : "ignore";
var METHOD_CHOICES = ["first in first out", "highest cost first"];
var METHOD_NAMES = { fifo: "First in, first out", hcfo: "Highest cost first" };
var GAINS_TRADE_COLUMNS = { roles: CX_TRADE_ROLES, labels: CX_TRADE_LABELS, required: ["date", "type", "asset", "quantity", "amount"], guess: (rows, at) => cxGuessTradeColumns(rows, at) };
var TIE_OUT_TRADE_COLUMNS = { roles: CX_TRADE_ROLES, labels: CX_TRADE_LABELS, required: ["date", "asset", "amount"], guess: (rows, at) => cxGuessTradeColumns(rows, at) };
var HELD_COLUMNS = { roles: CX_HELD_ROLES, labels: CX_HELD_LABELS, required: ["acquired", "disposed", "proceeds", "basis"], guess: (rows, at) => cxGuessHeldColumns(rows, at) };
var quantityText = (q) => scaledFormat(q, CX_QUANTITY_PLACES, true);
var TRADES_SHEET = /^trades$/i;
function fieldText(v) {
  if (v === null || v === void 0) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new AgentInputError('Each field of a purchase in "buys" must be a number or text.');
}
var BUY_KEYS = ["quantity", "amountPaid", "fee"];
function readBuyLines(raw) {
  const text2 = raw.trim();
  let items;
  if (text2.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text2);
    } catch {
      throw new AgentInputError('"buys" starts with "[" but is not a JSON list. Give one purchase per line as "quantity; amount paid; fee", or a JSON list of [quantity, amount paid, fee].');
    }
    if (!Array.isArray(parsed)) throw new AgentInputError('"buys" must be a list of purchases.');
    items = parsed.map((b, i) => {
      if (Array.isArray(b)) return b.map(fieldText);
      if (b !== null && typeof b === "object") {
        const o = b;
        const unknown = Object.keys(o).filter((k) => !BUY_KEYS.includes(k));
        if (unknown.length > 0) throw new AgentInputError(`Purchase ${i + 1} of "buys" has ${unknown.map((k) => `"${k}"`).join(", ")}; a purchase written as an object takes only "quantity", "amountPaid" and "fee".`);
        return [fieldText(o.quantity), fieldText(o.amountPaid), fieldText(o.fee)];
      }
      throw new AgentInputError(`Purchase ${i + 1} of "buys" must be [quantity, amount paid, fee] or {"quantity", "amountPaid", "fee"}.`);
    });
  } else {
    items = text2.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map((l) => {
      if (!/[;|\t]/.test(l)) throw new AgentInputError(`Each line of "buys" is "quantity; amount paid; fee", the three separated by semicolons: "${l.slice(0, 80)}".`);
      return l.split(/[;|\t]/).map((s) => s.trim());
    });
  }
  const buys = [];
  items.forEach((fields2, i) => {
    const line = i + 1;
    while (fields2.length > 3 && fields2[fields2.length - 1] === "") fields2.pop();
    if (fields2.every((f2) => f2 === "")) return;
    if (fields2.length > 3) throw new AgentInputError(`Purchase ${line} of "buys" has more than three parts; give quantity, amount paid and fee.`);
    const [q = "", a = "", f = ""] = fields2;
    let quantity;
    try {
      quantity = scaledParse(q.replace(/^\$/, ""), CX_QUANTITY_PLACES, "quantity");
    } catch {
      throw new AgentInputError(`Purchase ${line}: the quantity "${q}" is not a number with up to 8 decimal places.`);
    }
    if (quantity <= 0n) throw new AgentInputError(`Purchase ${line}: the quantity must be more than zero.`);
    if (a === "") throw new AgentInputError(`Purchase ${line}: the amount paid is missing.`);
    const cents = (text3, what) => {
      if (text3 === "") return 0;
      let c;
      try {
        c = parseAmount(text3);
      } catch {
        throw new AgentInputError(`Purchase ${line}: the ${what} "${text3}" is not an amount in dollars and cents.`);
      }
      if (c < 0) throw new AgentInputError(`Purchase ${line}: the ${what} must be zero or more.`);
      return c;
    };
    buys.push({ line, quantity, amount: cents(a, "amount paid"), fee: cents(f, "fee") });
  });
  if (buys.length === 0) throw new AgentInputError('Type at least one purchase in "buys": its quantity and the amount paid.');
  if (buys.length > 200) throw new AgentInputError('"buys" has more than 200 purchases; the page takes up to 200 lines.');
  return buys;
}
function averageSummary(r, asset) {
  const of = asset ? ` of ${asset}` : "";
  const total = quantityText(r.totalQuantity);
  const parts = [
    `${r.lines.length} purchase(s)${of}, fees ${r.feeHandling === "adjust" ? "added to cost" : "left out"}: total quantity ${total}, total paid before fees ${formatUSD(r.totalAmount)}, total fees ${formatUSD(r.totalFees)}, total cost ${formatUSD(r.totalCost)}.`,
    `Average cost per unit: ${formatUSD(r.totalCost)} divided by ${total} is ${cxFormatPrice(r.average)}.`
  ];
  if (r.price !== null && r.value !== null && r.difference !== null) {
    const diff = r.difference === 0 ? "the same as the total cost" : `which is ${formatUSD(Math.abs(r.difference))} ${r.difference > 0 ? "more" : "less"} than the total cost`;
    parts.push(`At ${cxFormatPrice(r.price)} per unit, ${total} is worth ${formatUSD(r.value)}, ${diff}.`);
  }
  return parts.join(" ");
}
var averageCost = {
  name: "crypto_average_cost_per_coin",
  page: "crypto/average-cost-calculator",
  section: "crypto",
  kind: "tool",
  title: "Average cost per coin across several purchases",
  description: "Works out the average cost per unit of one coin or token across several purchases: total quantity, total paid before fees, total fees, total cost, and total cost divided by total quantity to eight decimal places, with each purchase's own cost per unit beside it. Fees are added to cost or left out, as chosen. Every total is added a second way, every divided figure is multiplied back to give its cost, and the average is checked to lie between the lowest and the highest cost per unit. With a price per unit given, it also shows what the total quantity is worth at that price and the difference from the total cost. Use it when someone asks for their average cost per coin, or their cost per unit across several buys of the same asset. Not for sales or lot matching, not for several different coins in one run, and it does not say what cost basis to report.",
  question: "I bought Bitcoin three times this year. What is my average cost per coin with the fees included?",
  inputs: [
    {
      name: "buys",
      kind: "text",
      label: "Purchases",
      description: 'The purchases of one asset, one per line as "quantity; amount paid; fee" (semicolons between the three), for example "0.5; 15,000.00; 15.00". Quantity takes up to 8 decimal places; amount paid is the total for the purchase in dollars before the fee; a blank fee is zero. A JSON list also works, each purchase as [quantity, amount paid, fee] or as {"quantity", "amountPaid", "fee"} (no other keys). Up to 200 purchases.',
      required: true
    },
    { name: "fees", kind: "choice", label: "Fees", choices: FEE_CHOICES, description: '"added": each purchase costs its amount paid plus its fee. "left out": each costs its amount paid alone (the total of the fees is still shown). The person chooses; it is not picked for them.', required: true },
    { name: "price", kind: "number", label: "Price per unit to compare with", description: "Optional. A price per unit in dollars, up to 8 decimal places, written without the $ sign (such as 40000 or 0.00001234): the value of the total quantity at that price and its difference from the total cost are shown.", required: false },
    { name: "asset", kind: "text", label: "Asset", description: "Optional. The asset symbol, such as BTC, for the heading of the result.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven divides total cost by total quantity; it does not match sales to lots, it is not a tax form, and it does not say what to report.",
  run({ values }) {
    const buys = readBuyLines(String(values.buys ?? ""));
    let price = null;
    if (values.price !== void 0) {
      const text2 = String(values.price);
      if (text2.endsWith("%")) throw new AgentInputError('"price" is a price per unit in dollars, not a percent.');
      try {
        price = scaledParse(text2, CX_PRICE_PLACES, "price");
      } catch {
        throw new AgentInputError(`"price" "${text2}" is not a price with up to 8 decimal places.`);
      }
      if (price < 0n) throw new AgentInputError('"price" must be zero or more.');
    }
    const asset = String(values.asset ?? "").trim().toUpperCase().slice(0, 20);
    const r = cxAverageCost({ buys, feeHandling: feeHandlingOf(values.fees), price });
    const t = cxAverageCostTables(r);
    const summary = asset ? [t.summary[0], ["Asset", asset], ...t.summary.slice(1)] : t.summary;
    return {
      summary: averageSummary(r, asset),
      tables: [
        { name: "Average cost", rows: summary },
        { name: "Buys", rows: t.lines }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: three purchases of one coin, fees added to cost, compared with $40,000.00 per unit",
      args: { buys: "0.5; 15,000.00; 15.00\n0.25; 10,000.00; 10.00\n0.1; 4,500.00; 4.50", fees: "added", price: "40000.00", asset: "BTC" },
      verified: true,
      contains: [
        "total quantity 0.85",
        "$29,500.00",
        "$29.50",
        "$29,529.50",
        "$34,740.58823529",
        "$34,000.00",
        "$4,470.50",
        "| 1 | 0.5 | 15015.00 | 30030.00000000 |",
        "| 2 | 0.25 | 10010.00 | 40040.00000000 |",
        "| 3 | 0.1 | 4504.50 | 45045.00000000 |"
      ]
    },
    {
      label: "The page's worked example with fees left out",
      args: { buys: '[["0.5", "15000.00", "15.00"], ["0.25", "10000.00", "10.00"], ["0.1", "4500.00", "4.50"]]', fees: "left out" },
      verified: true,
      contains: ["total cost $29,500.00", "$34,705.88235294"]
    }
  ]
};
var capitalGains = {
  name: "crypto_capital_gains_worksheet",
  page: "crypto/capital-gains-worksheet",
  section: "crypto",
  kind: "tool",
  title: "Crypto capital gains worksheet, lot by lot, from an exchange export",
  description: "Builds a lot-by-lot gains worksheet from an exchange or wallet export of buys and sales (.csv or .xlsx): each sale is matched to the lots it came from under the method chosen (first in, first out, or highest cost first), giving asset, quantity, date acquired, date disposed, proceeds, cost basis and gain or loss per row, plus the lots still held. A second lot engine written a different way has to agree; quantity and cost are proved conserved per asset and per lot, each sale's proceeds are split by quantity to the cent, and a sale larger than the holdings before it is listed and never given a zero basis. Transfers, rewards and swaps are listed, not matched; lots are pooled per asset across accounts. Use it when someone needs gains and losses or cost basis per sale worked out from their own trade history, as at tax time. Not a tax form, it does not pick the method, and it does not say what to report.",
  question: "Can you work out my crypto capital gains from this exchange export, first in first out, with fees included?",
  inputs: [
    {
      name: "tradeExport",
      kind: "file",
      label: "Trade export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date (and time), type (buy or sell), asset, quantity and total cost or proceeds are needed; fee and account are used when present. Rows of any other type (transfers, rewards, conversions or swaps) are listed and not used. In a workbook, a sheet named Trades is the one read.",
      required: true
    },
    { name: "method", kind: "choice", label: "Lot method", choices: METHOD_CHOICES, description: '"first in first out" takes the oldest lot first; "highest cost first" takes the lot with the highest cost per unit first. The person chooses; it is not picked for them.', required: true },
    { name: "fees", kind: "choice", label: "Fees", choices: FEE_CHOICES, description: '"added": each purchase fee is added to its cost and each sale fee is subtracted from its proceeds. "left out": fees are not used. The person chooses; it is not picked for them.', required: true },
    columnsInput("Trade export", GAINS_TRADE_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven builds a worksheet of your own trades under the method you picked; it is not a tax form, is not in any agency's form layout, and does not say what to report.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "tradeExport"), TRADES_SHEET);
    const mapping = mapColumns(file, GAINS_TRADE_COLUMNS, values.columns, "Trade export");
    const method = values.method === "highest cost first" ? "hcfo" : "fifo";
    const feeHandling = feeHandlingOf(values.fees);
    const x = cxExtractTrades(file.rows, mapping);
    const problems = [...x.problems, ...x.trades.filter((t2) => t2.quantity === 0n).map((t2) => ({ rowNumber: t2.rowNumber, reason: "no quantity" }))];
    const trades = x.trades.filter((t2) => t2.quantity > 0n);
    const r = cxCapitalGainsWorksheet({ trades, method, feeHandling });
    const t = cxGainsTables(r);
    const held = /* @__PURE__ */ new Map();
    for (const lot of r.remaining) {
      const m = held.get(lot.asset) ?? { q: 0n, c: 0 };
      held.set(lot.asset, { q: m.q + lot.quantity, c: m.c + lot.costBasis });
    }
    const sales = trades.filter((tr) => tr.side === "sell").length;
    const stillHeld = held.size === 0 ? "Nothing is left in any lot." : `Still held: ${[...held].map(([asset, h]) => `${quantityText(h.q)} ${asset} carrying ${formatUSD(h.c)} of cost basis`).join("; ")}.`;
    const summary = [
      `${METHOD_NAMES[method]}, fees ${feeHandling === "adjust" ? "added to cost and subtracted from proceeds" : "left out"}: ${sales} sale(s) matched into ${r.rows.length} worksheet row(s). Proceeds ${formatUSD(r.totalProceeds)}, cost basis ${formatUSD(r.totalCostBasis)}, gain or loss ${formatUSD(r.totalGain)}.`,
      stillHeld,
      x.otherRows ? `${x.otherRows} row(s) that are neither a buy nor a sale (transfers, rewards, conversions or swaps of one coin into another) are not used; they are listed on the certificate.` : "",
      "Lots are pooled per asset across every account or wallet in the file."
    ].filter(Boolean);
    return {
      summary: summary.join(" "),
      tables: [
        { name: "Worksheet", rows: t.rows },
        { name: "Sales with no lot", rows: t.shortfalls },
        { name: "Lots still held", rows: t.remaining }
      ],
      checks: [...r.checks, ...sheetRowChecks(problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: two purchases and two sales of BTC, first in first out, fees added",
      args: { tradeExport: "fixture:crypto/exchange-trades.csv", method: "first in first out", fees: "added" },
      verified: true,
      contains: ["Proceeds $50,949.00", "cost basis $38,038.00", "gain or loss $12,911.00", "0.3 BTC carrying $12,012.00", "14985.00", "9009.00", "5976.00", "27972.00", "21021.00", "6951.00", "7992.00", "8008.00", "-16.00"]
    },
    {
      label: "The same export, highest cost first",
      args: { tradeExport: "fixture:crypto/exchange-trades.csv", method: "highest cost first", fees: "added" },
      verified: true,
      contains: ["cost basis $41,041.00", "gain or loss $9,908.00"]
    },
    {
      label: "A sale larger than the holdings before it is not verified",
      args: { tradeExport: "Timestamp,Transaction Type,Asset,Quantity Transacted,Subtotal,Fees\n2026-01-05 10:15:00,Buy,BTC,1,30000.00,30.00\n2026-03-15 16:45:00,Sell,BTC,1.5,45000.00,45.00\n", method: "first in first out", fees: "added" },
      verified: false,
      failedCheck: "cx-gain-holdings"
    },
    {
      label: "A trade row whose total cannot be read is not verified",
      args: { tradeExport: "Timestamp,Transaction Type,Asset,Quantity Transacted,Subtotal,Fees\n2026-01-05 10:15:00,Buy,BTC,1,30000.00,30.00\n2026-03-15 16:45:00,Sell,BTC,0.5,2OOOO.00,15.00\n", method: "first in first out", fees: "added" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var holdingPeriod = {
  name: "crypto_holding_period_split",
  page: "crypto/holding-period-split",
  section: "crypto",
  kind: "tool",
  title: "Short-term and long-term split of a crypto gains worksheet",
  description: "Splits a lot-by-lot gains worksheet (.csv or .xlsx, one row per lot sold with date acquired, date disposed, proceeds and cost basis) into rows held one year or less and rows held more than one year, often called short-term and long-term, with the row count, proceeds, cost basis and gain or loss of each group, and every row with its days held and the date its one-year line falls on. The one-year line is worked out two ways that have to agree on every row (the count starts the day after the date acquired), group totals are added a second way, a gain column or total line in the file is checked against the rows, and rows disposed within a day of the line are flagged. Use it when someone asks how much of their crypto gain is short-term and how much long-term, from a worksheet they already have. Not for building the worksheet from raw trades or for tax rates, and it does not say which rule applies or what to report.",
  question: "How much of my crypto gain this year is short-term and how much is long-term? Here is my gains worksheet.",
  inputs: [
    {
      name: "gainsWorksheet",
      kind: "file",
      label: "Gains worksheet",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per lot sold: date acquired, date disposed, proceeds and cost basis are needed; asset, quantity and a gain or loss column are used when present. A total line is checked against the rows. A blank cost basis is unreadable, never zero.",
      required: true
    },
    columnsInput("Gains worksheet", HELD_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven applies the rule stated on the page (the count starts the day after the date acquired, and a row is held more than one year when the date disposed is on or after that day one year later), using dates only; it counts and adds, it is not a tax form, and it does not say what to report.",
  run({ files, values }) {
    const file = oneFile(files, "gainsWorksheet");
    const x = cxExtractHeldRows(file.rows, mapColumns(file, HELD_COLUMNS, values.columns, "Gains worksheet"));
    if (x.rows.length === 0 && x.problems.length === 0) throw new Error("No row with a date acquired and a date disposed was found under the header row.");
    const r = cxHoldingPeriodSplit(x.rows, x.fileTotal);
    const t = cxHoldingPeriodTables(r);
    const group = r.groups.map((g) => `${CX_HELD_NAMES[g.held]}: ${g.count} row(s), proceeds ${formatUSD(g.proceeds)}, cost basis ${formatUSD(g.costBasis)}, gain or loss ${formatUSD(g.gain)}.`);
    return {
      summary: [...group, `Together: ${r.lines.length} row(s), proceeds ${formatUSD(r.totalProceeds)}, cost basis ${formatUSD(r.totalCostBasis)}, gain or loss ${formatUSD(r.totalGain)}.`, "Rule applied: the count starts the day after the date acquired, and a row is held more than one year when the date disposed is on or after that day one year later."].join(" "),
      tables: [
        { name: "By holding period", rows: t.summary },
        { name: "Rows", rows: t.rows }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, x.skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: four lots of BTC and ETH, one disposed on the first day past its one-year line",
      args: { gainsWorksheet: "fixture:crypto/lot-worksheet.csv" },
      verified: true,
      contains: [
        "One year or less: 2 row(s), proceeds $19,985.00, cost basis $13,209.00, gain or loss $6,776.00",
        "More than one year: 2 row(s), proceeds $35,964.00, cost basis $29,029.00, gain or loss $6,935.00",
        "proceeds $55,949.00, cost basis $42,238.00, gain or loss $13,711.00",
        "| 319 | 2026-01-06 | One year or less |",
        "| 366 | 2026-01-06 | More than one year |",
        "| 434 | 2026-02-11 | More than one year |",
        "| 204 | 2025-03-11 | One year or less |",
        "Within a day of the line, where one day decides the group: row(s) 3"
      ]
    },
    {
      label: "A total line that does not equal the rows is not verified",
      args: { gainsWorksheet: "Asset,Date acquired,Date disposed,Proceeds,Cost basis\nBTC,2025-01-05,2025-11-20,14985.00,9009.00\nBTC,2025-02-10,2026-04-20,7992.00,8008.00\nTotal,,,23977.00,17017.00\n" },
      verified: false,
      failedCheck: "hp-file-proceeds"
    },
    {
      label: "A row with a blank cost basis is not verified",
      args: { gainsWorksheet: "Asset,Date acquired,Date disposed,Proceeds,Cost basis\nBTC,2025-01-05,2025-11-20,14985.00,9009.00\nBTC,2025-02-10,2026-04-20,7992.00,\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
function readAccountTotals(raw) {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map((l) => {
    const parts = l.split("|").map((s) => s.trim());
    if (parts.length < 2 || parts.length > 4) throw new AgentInputError(`Each line of "statementByAccount" is "account | total proceeds | cost basis | number of sales", the last two optional: "${l.slice(0, 80)}".`);
    return { account: parts[0], proceeds: parts[1], basis: parts[2] ?? "", count: parts[3] ?? "" };
  });
}
var NO_ACCOUNT = "(no account)";
var shownAccount = (account) => account === "" ? NO_ACCOUNT : account;
function typedTotal(account, proceeds, basis, count) {
  const where = account === "" ? "the sales with no account" : `account ${account}`;
  const cents = (text2, what) => {
    try {
      return parseAmount(text2);
    } catch {
      throw new AgentInputError(`The ${what} typed for ${where}, "${text2}", is not an amount in dollars and cents.`);
    }
  };
  if (proceeds === "") throw new AgentInputError(`Type the total proceeds printed on the statement for ${where}.`);
  if (count !== "" && !/^\d+$/.test(count)) throw new AgentInputError("The number of sales must be a whole number.");
  return { account, proceeds: cents(proceeds, "total proceeds"), ...basis === "" ? {} : { basis: cents(basis, "cost basis") }, ...count === "" ? {} : { count: Number(count) } };
}
var proceedsTieOut = {
  name: "crypto_proceeds_tie_out",
  page: "crypto/proceeds-tie-out",
  section: "crypto",
  kind: "tool",
  title: "Crypto proceeds tie-out: an export against a broker statement",
  description: "Adds up the sales in a person's own exchange or wallet export (.csv or .xlsx) and sets them against the totals typed from a broker statement: total proceeds and each account's proceeds side by side with the difference, plus cost basis and the number of sales wherever those are typed, and the export broken down by asset and by month so a difference can be located. Asset and month totals are re-added to the export total in a separate pass, every sale is counted once, and buys, transfers, rewards and swaps are listed and not added up. When only the comparison with the typed figures fails, the export's own totals and breakdown are still given, marked not verified, so the difference can be located. Use it when the proceeds on a broker or exchange statement do not match someone's own records, or to confirm that they do. Not for working out gains or cost basis, and it does not say which figure is right or what belongs on a return.",
  question: "The total proceeds on my exchange tax statement do not match my own trade export. Where is the difference?",
  inputs: [
    {
      name: "tradeExport",
      kind: "file",
      label: "Trade or sales export",
      description: "A .csv or .xlsx file (a path, or the CSV text) with one row per transaction: date, asset and proceeds are needed; type, quantity, fee, cost basis and account are used when present. With a type column only sales are added up; with none, every row is a sale. In a workbook, a sheet named Trades is the one read.",
      required: true
    },
    { name: "statementProceeds", kind: "amount", label: "Total proceeds on the statement", description: "The total proceeds printed on the broker statement, when the export has one account or no account column. For several accounts, give statementByAccount instead.", required: false },
    { name: "statementBasis", kind: "amount", label: "Cost basis on the statement", description: "Optional, with statementProceeds: the total cost basis printed on the statement.", required: false },
    { name: "statementSales", kind: "number", label: "Number of sales on the statement", description: "Optional, with statementProceeds: the number of sales the statement lists, a whole number.", required: false },
    {
      name: "statementByAccount",
      kind: "text",
      label: "Statement totals by account",
      description: 'For an export with several accounts: one line per account as "account | total proceeds | cost basis | number of sales", the last two optional, with each account named as it is in the export, for example "Main | 4,889.75"; sales with a blank account are named "(no account)". Every account in the export needs a line for the result to tie out.',
      required: false
    },
    { name: "proceedsLessFees", kind: "boolean", label: "Take proceeds less fees", description: "Optional. true takes each sale's proceeds as its amount minus its fee; without it, proceeds are taken as written in the export.", required: false },
    columnsInput("Trade or sales export", TIE_OUT_TRADE_COLUMNS)
  ],
  limits: "site",
  // The comparisons with what the person typed from the statement; every other check is of the export's own arithmetic.
  comparisonChecks: ["cx-tie-proceeds", "cx-tie-accounts", "cx-tie-basis", "cx-tie-count"],
  notAdvice: "Mathproven shows where the arithmetic differs; it does not say which figure is right or what belongs on a return.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "tradeExport"), TRADES_SHEET);
    const mapping = mapColumns(file, TIE_OUT_TRADE_COLUMNS, values.columns, "Trade or sales export");
    const x = cxExtractTrades(file.rows, mapping, mapping.columns.type < 0 ? "sell" : void 0);
    const disposals = cxDisposalsFrom(x.trades, values.proceedsLessFees === true);
    const buys = x.trades.filter((t2) => t2.side === "buy");
    const skipped = [...x.skipped, ...buys.map((t2) => ({ rowNumber: t2.rowNumber, reason: "a buy (only sales are added up)" }))].sort((a, b) => a.rowNumber - b.rowNumber);
    const otherRows = x.otherRows + buys.length;
    if (disposals.length === 0) {
      const unread = x.problems.length ? ` ${x.problems.length} row(s) could not be read: ${x.problems.slice(0, 10).map((p) => `row ${p.rowNumber} (${p.reason})`).join(", ")}.` : "";
      throw new AgentInputError(`There are no sales in the export to add up.${unread}`);
    }
    const accounts = [...new Set(disposals.map((d) => d.account))].sort();
    const accountList = accounts.map(shownAccount).join(", ");
    const single = values.statementProceeds !== void 0;
    const byAccount = values.statementByAccount !== void 0;
    if (single && byAccount) throw new AgentInputError("Give either statementProceeds (one account) or statementByAccount (one line per account), not both.");
    if (!single && (values.statementBasis !== void 0 || values.statementSales !== void 0)) throw new AgentInputError("statementBasis and statementSales go with statementProceeds; for several accounts, put them on each line of statementByAccount.");
    const reported = [];
    if (single) {
      if (accounts.length > 1) throw new AgentInputError(`The export's sales are in ${accounts.length} accounts (${accountList}). Give the statement's totals for each with statementByAccount, one line per account, for example "${shownAccount(accounts[0])} | 1,234.56".`);
      const cents = values.statementProceeds;
      const basis = values.statementBasis;
      const count = values.statementSales;
      if (count !== void 0 && !/^\d+$/.test(count)) throw new AgentInputError("The number of sales must be a whole number.");
      reported.push({ account: accounts[0], proceeds: cents, ...basis === void 0 ? {} : { basis }, ...count === void 0 ? {} : { count: Number(count) } });
    } else if (byAccount) {
      const seen = /* @__PURE__ */ new Set();
      for (const line of readAccountTotals(String(values.statementByAccount))) {
        const typed = line.account.toLowerCase() === NO_ACCOUNT ? "" : line.account;
        const account = accounts.find((a) => a === typed) ?? accounts.find((a) => a.toLowerCase() === typed.toLowerCase());
        if (account === void 0) throw new AgentInputError(`The export has no sales in an account named "${line.account}". The accounts its sales are in: ${accountList}.`);
        if (seen.has(account)) throw new AgentInputError(`Account ${shownAccount(account)} has more than one line in statementByAccount.`);
        seen.add(account);
        reported.push(typedTotal(account, line.proceeds, line.basis, line.count));
      }
      if (reported.length === 0) throw new AgentInputError("statementByAccount has no lines in it.");
    } else {
      throw new AgentInputError(`Type the total proceeds from the broker statement: statementProceeds for one account, or statementByAccount with one line per account (the accounts the export's sales are in: ${accountList}).`);
    }
    const r = cxProceedsTieOut({ disposals, reported });
    const t = cxTieOutTables(r);
    const list = (lines) => lines.map((l) => `${l.key} ${formatUSD(l.proceeds)}`).join(", ");
    const summary = [
      `${r.count} sale(s) in the export add up to ${formatUSD(r.totalProceeds)} against ${formatUSD(r.reportedProceeds)} typed from the statement, a difference of ${formatUSD(r.difference)}.`,
      `By asset: ${list(r.byAsset)}. By month: ${list(r.byMonth)}.`,
      otherRows ? `${otherRows} row(s) that are not sales (buys, transfers, rewards, conversions or swaps) are not added up; they are listed on the certificate.` : "",
      values.proceedsLessFees === true ? "Each sale's proceeds are its amount minus its fee." : "Proceeds are taken as written in the export."
    ].filter(Boolean);
    return {
      summary: summary.join(" "),
      tables: [
        { name: "Accounts", rows: t.accounts },
        { name: "By asset", rows: t.byAsset },
        { name: "By month", rows: t.byMonth }
      ],
      checks: [...r.checks, ...sheetRowChecks(x.problems, skipped)]
    };
  },
  examples: [
    {
      label: "The page's worked example: five sales in one account against $4,889.75 on the statement, not verified, with the breakdown that puts the $310.25 at the SOL sale in February",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementProceeds: "4,889.75" },
      verified: false,
      failedCheck: "cx-tie-proceeds",
      contains: [
        "expected $4,889.75, found $5,200.00): off by $310.25",
        "They are NOT a verified result",
        "add up to $5,200.00 against $4,889.75 typed from the statement, a difference of $310.25",
        "By asset: BTC $3,350.00, ETH $1,539.75, SOL $310.25",
        "By month: 2026-01 $1,890.50, 2026-02 $2,410.25, 2026-03 $899.25",
        "| Main | 5 | 5200.00 | 4889.75 | 310.25 |",
        "| SOL | 1 | 310.25 | 295.00 |",
        "| 2026-02 | 2 | 2410.25 | 2095.00 |"
      ]
    },
    {
      label: "The same export against a statement that prints $5,200.00: the breakdown by asset and by month",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementProceeds: "5,200.00" },
      verified: true,
      contains: ["add up to $5,200.00", "BTC $3,350.00", "ETH $1,539.75", "SOL $310.25", "2026-01 $1,890.50", "2026-02 $2,410.25", "2026-03 $899.25"]
    },
    {
      label: "Statement totals typed per account, with cost basis and the number of sales",
      args: { tradeExport: "fixture:crypto/sales-export.csv", statementByAccount: "Main | 5,200.00 | 4,705.00 | 5" },
      verified: true,
      contains: ["add up to $5,200.00", "| Main | 5 | 5200.00 | 5200.00 | 0.00 | 4705.00 | 4705.00 | 0.00 |"]
    },
    {
      label: "A sale whose proceeds cannot be read is not verified, and no figures are given even though the statement total matches the rest",
      args: { tradeExport: "Date Sold,Asset,Proceeds,Account\n2026-01-14,BTC,1250.00,Main\n2026-02-19,SOL,31O.25,Main\n", statementProceeds: "1,250.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var fileSlug = (text2) => text2.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
var TEMPLATE_ROWS = {
  Trades: () => "One per transaction, under the header row",
  Accounts: (o) => `${o.accountCount} numbered`,
  Log: () => "Name and year filled in",
  Instructions: () => "What each column holds"
};
var tradeLogTemplate = {
  name: "crypto_trade_log_template",
  page: "crypto/trade-log-template",
  section: "crypto",
  kind: "template",
  title: "Blank crypto trade log workbook (Excel)",
  description: "Builds a blank Excel trade log (.xlsx) for a year of crypto buys and sales: a Trades sheet with date, type, asset, quantity, total USD, fee USD, cost basis USD, account and notes columns, an Accounts sheet with the number of numbered rows asked for, a Log sheet with the name and year, and an Instructions sheet saying what each column holds. The finished file is read back before it is handed over: its sheet names, header rows and row counts are compared with what was asked for, the Trades header is matched the way the gains worksheet and the proceeds tie-out read it, and no cell holds a formula. Use it when someone wants a spreadsheet to keep track of their crypto trades through the year or for tax season. Not a calculator: it holds values only and works nothing out.",
  question: "Can you make me a spreadsheet to log my crypto trades for 2026? I use three exchanges and wallets.",
  inputs: [
    { name: "name", kind: "text", label: "Name", description: "Optional. Whose trades the log holds, printed on the Log sheet and used in the file name; up to 120 characters.", required: false },
    { name: "year", kind: "year", label: "Year", description: "Optional. The year the log covers, four digits from 2000 to 2099, printed on the Log sheet and used in the file name.", required: false },
    { name: "accountCount", kind: "number", label: "Number of accounts and wallets", description: "Optional. How many numbered rows the Accounts sheet starts with, a whole number from 1 to 50; 2 when not given, as on the page.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in; it holds values only, with no formulas, so it does not calculate, and it does not say what to report.",
  run({ values }) {
    const countText = values.accountCount === void 0 ? "2" : String(values.accountCount);
    if (!/^\d+$/.test(countText)) throw new AgentInputError("The number of accounts and wallets must be a whole number from 1 to 50.");
    const options = { owner: String(values.name ?? ""), year: values.year === void 0 ? "" : String(values.year), accountCount: Number(countText), siteUrl: SITE_URL };
    const sheets = cxTradeLogTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = cxVerifyTradeLogTemplate(options, bytes);
    const suggestedName = `${["crypto-trade-log", fileSlug(options.owner), options.year.trim()].filter(Boolean).join("-")}.xlsx`;
    const rows = sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), TEMPLATE_ROWS[s.name]?.(options) ?? String(s.rows.length - 1)]);
    const owner = options.owner.trim();
    return {
      summary: `A blank trade log workbook, ${suggestedName}, with ${sheets.length} sheets: ${sheets.map((s) => s.name).join(", ")}. The Log sheet carries ${owner ? owner : "no name"} and ${options.year ? options.year : "no year"}; the Accounts sheet has rows numbered 1 to ${options.accountCount}, all blank; the Trades sheet has its header row and nothing under it.`,
      tables: [{ name: "Sheets", rows: [["Sheet", "Columns", "Rows to fill in"], ...rows] }],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Sam Example, 2026, three accounts and wallets",
      args: { name: "Sam Example", year: "2026", accountCount: "3" },
      verified: true,
      contains: ["crypto-trade-log-sam-example-2026.xlsx", "Date, Type, Asset, Quantity, Total USD, Fee USD, Cost basis USD, Account, Notes", "Line, Account or wallet, Kind, Notes", "3 numbered", "Item, Value", "Where, What goes there"]
    }
  ]
};
var CRYPTO = [capitalGains, proceedsTieOut, holdingPeriod, averageCost, tradeLogTemplate];
var CRYPTO_NOT_FOR_AGENTS = [];

// packages/agents/src/registry/index.ts
var TOOL_ENTRIES = [
  ...GENERAL,
  ...NONPROFITS,
  ...TRUCKING,
  ...CRYPTO,
  ...BOOKKEEPING,
  ...CONSTRUCTION,
  ...ECOMMERCE,
  ...INSURANCE_COMMISSIONS,
  ...LAW_TRUST,
  ...PROPERTY_MANAGEMENT
];
var ENTRIES = [...TOOL_ENTRIES, ...lookupEntries()];
var NOT_FOR_AGENTS = [
  ...NONPROFITS_NOT_FOR_AGENTS,
  ...TRUCKING_NOT_FOR_AGENTS,
  ...CRYPTO_NOT_FOR_AGENTS,
  ...BOOKKEEPING_NOT_FOR_AGENTS,
  ...CONSTRUCTION_NOT_FOR_AGENTS,
  ...ECOMMERCE_NOT_FOR_AGENTS,
  ...INSURANCE_COMMISSIONS_NOT_FOR_AGENTS,
  ...LAW_TRUST_NOT_FOR_AGENTS,
  ...PROPERTY_MANAGEMENT_NOT_FOR_AGENTS
];

// mp-entry:mp-entry:main
var all = [...ENTRIES];
var entries = all.filter((e) => e.kind !== "lookup");
runMcpProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.4", sectionTitles: { "general": "prove the math", "nonprofits": "nonprofits and churches", "trucking": "trucking fuel tax", "crypto": "crypto proceeds and gains", "bookkeeping": "bookkeepers and accountants", "construction": "construction subcontractors", "ecommerce": "E-commerce sellers", "insurance-commissions": "insurance agency commissions", "law-trust": "law firm trust accounts", "property-management": "property managers" } });
