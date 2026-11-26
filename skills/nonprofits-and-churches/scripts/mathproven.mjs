// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  NP_AUDIT_THRESHOLDS,
  NP_STATEMENT_LEVELS,
  REF_US_STATES_DC,
  checkNpAuditThresholdTable,
  npAuditThresholdsFindings,
  npBandText,
  refCheckTable,
  refIsDay,
  refSourceProblem
} from "./lib/auditThresholds.mjs";
import {
  AgentInputError,
  NONPROFITS,
  beginColumnLog,
  checkValue,
  isVerified,
  present,
  readXlsx,
  takeColumnLog,
  writeXlsx
} from "./lib/nonprofits.mjs";
import {
  daysInMonth
} from "./lib/calendarDays.mjs";
import "./lib/upgrades.mjs";
import {
  CheckList,
  certificateText,
  certify,
  failures,
  passedAll
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
  return rows.map((row) => row.map((c) => encodeCell(c, guard)).join(",")).join(eol) + eol;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
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
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
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
  const ext2 = extname(path).toLowerCase();
  const name = basename(path);
  if (ext2 === ".csv" || ext2 === ".txt") return fromCsvText(readFileSync(path, "utf8"), name);
  if (ext2 === ".xlsx") {
    let sheets;
    try {
      sheets = readXlsx(new Uint8Array(readFileSync(path)));
    } catch (err) {
      throw new AgentInputError(`"${name}" could not be read as an .xlsx workbook (${err instanceof Error ? err.message : "unreadable"}).`);
    }
    return { name, sheets, rows: firstFilled(sheets) };
  }
  if (ext2 === ".xls") throw new AgentInputError(`"${name}" is an old .xls workbook. Save it as .xlsx or .csv first.`);
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
    if (!wanted.some((ext2) => saveTo.toLowerCase().endsWith(ext2))) return refused(entry, `"saveTo" must end ${wanted.join(" or ")}: "${saveTo}".`, note);
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
      const own = result.file !== void 0 && (entry.fileExtensions ?? []).some((ext2) => saveTo.toLowerCase().endsWith(ext2.toLowerCase()));
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

// packages/core/src/nonprofit/renewalDates.ts
var CHECKED = "2026-11-12";
var months = (n, d = 0) => ({ kind: "months", months: n, days: d });
var monthDay = (m, d) => ({ kind: "month-day", month: m, day: d });
var days = (n) => ({ kind: "days", days: n });
var fixed = (m, d) => ({ kind: "fixed", month: m, day: d });
var anniv = (offsetDays) => ({ kind: "anniversary", offsetDays });
var noExt = (text = "None stated on the source read.") => ({ how: "none", count: null, text });
var ext = (how, count, text) => ({ how, count, text });
var plus = (m, d = 0) => ({ from: "due", months: m, days: d });
function ruled(code, citation, sourceUrl, rule, ruleText, extension, notes) {
  return { code, citation, sourceUrl, checkedOn: CHECKED, status: "rule", rule, ruleText, extension, notes };
}
function notCounted(code, citation, sourceUrl, ruleText, extension, notes) {
  return { code, citation, sourceUrl, checkedOn: CHECKED, status: "not-counted", ruleText, extension, notes };
}
function noRegistration(code, citation, sourceUrl, notes) {
  return { code, citation, sourceUrl, checkedOn: CHECKED, status: "none", ruleText: "No charity registration in the source read, so no renewal date.", extension: noExt("Not applicable."), notes };
}
var ROWS = [
  ruled("AK", "AS 45.68.010(d); Department of Law, Charitable Organization Registration", "https://law.alaska.gov/department/civil/consumer/charityreg.html", fixed(9, 1), "Registration expires September 1 each year; the renewal statement is filed by then.", noExt("None: the department’s page says it grants no extensions for charity registration."), "The statute was also read in the legislature’s print view (akleg.gov). The page says there are no late fees."),
  ruled("AL", "Code of Ala. § 13A-9-71(g)", "https://www.alabamaag.gov/wp-content/uploads/2026/05/File-Consumer-Alabama-Charitable-Code.pdf", days(90), "The annual report is due within 90 days after the close of the fiscal year.", ext("on-request", plus(0, 180), "The Attorney General may extend the time by up to 180 days; counted here from the due date, as the Attorney General’s due-date table counts it."), "Read in the Attorney General’s copy of the Code (the legislature’s code site did not open). The Attorney General’s page calls the annual report the renewal."),
  ruled("AR", "Ark. Code § 4-28-403(a)(1)(A) and (d), as amended by Act 137 of 2019 and Act 338 of 2023", "https://arkleg.state.ar.us/Home/FTPDocument?path=/ACTS/2019R/Public/ACT137.pdf", days(180), "The annual financial report is due no later than 180 days after the last day of the fiscal year.", ext("on-request", plus(6), "The Secretary of State may grant up to six months when the organization files a notice of the need, and three more months on written request (the three are not counted here)."), "Read in the session laws that amended the section; the Secretary of State’s charitable entities page gives the same 180 days."),
  ruled("CA", "Attorney General, Registry of Charities and Fundraisers, Renewals", "https://oag.ca.gov/charities/renewals", months(4, 15), "Annual filings and fees are due 4 months and 15 days after the fiscal year ends.", ext("automatic", plus(6), "Follows an extension granted by the IRS. The page’s examples (May 15, or November 15 with the IRS extension, for a December 31 year end) are six months later, which is what is counted here."), "The page’s second example, a January 31 year end due June 15 (December 15 extended), is the same count. Read on the Attorney General’s page; the Government Code sections were not read."),
  ruled("CO", "C.R.S. § 6-16-104(4)(a) and (5)(a); 8 CCR 1505-9, Rule 5.1.2", "https://www.coloradosos.gov/pubs/rule_making/CurrentRules/8CCR1505-9Charitable.pdf", monthDay(5, 15), "The renewal and financial report are due by the 15th day of the fifth calendar month after the close of the fiscal year.", ext("automatic", { from: "fye", month: 8, day: 15 }, "With an IRS extension filed, the 15th day of the eighth calendar month (the rule’s own date). A further three months may be granted on a sworn request (not counted here)."), "The Secretary of State’s renewal instructions call the eighth-month date an automatic three-month extension."),
  ruled("CT", "Conn. Gen. Stat. § 21a-190b(a)", "https://www.cga.ct.gov/current/pub/chap_419d.htm", months(11), "The registration is renewed each year not later than eleven months after the end of the fiscal year.", noExt(), "The section’s history note says an earlier extension for the financial report was taken out."),
  ruled("FL", "Fla. Stat. § 496.405(1)(a) and (1)(d); § 496.407(3)", "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0496/Sections/0496.405.html", anniv(0), "The renewal statement is due on or before one year after the date the department approved the initial registration statement (its anniversary).", ext("on-request", null, "The department may extend the time for the financial statement, and the registration stays active meanwhile; no length is stated, so no extended date is counted."), "Needs the date the registration was approved. The department sends the renewal form at least 30 days ahead."),
  ruled("IL", "225 ILCS 460/4", "https://www.ilga.gov/legislation/ilcs/fulltext.asp?DocName=022504600K4", months(6), "The annual report is due by June 30 for books kept on a calendar year, or within 6 months after the close of the fiscal year.", ext("on-request", plus(0, 60), "The Attorney General may extend the time by up to 60 days on a timely written request for good cause."), "This is the annual report that keeps the registration in force."),
  ruled("KS", "K.S.A. 17-1763(d)", "https://www.ksrevisor.gov/statutes/chapters/ch17/017_017_0063.html", monthDay(6, "last"), "Registration expires on the last day of the sixth month following the month in which the fiscal year ends.", noExt(), "The date counted is the expiry, by which the renewal is filed."),
  ruled("MD", "Md. Code, Bus. Reg. § 6-408(b); COMAR 01.02.04.03", "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gbr&section=6-408&enactments=false", months(6), "The annual report is due within 6 months after the end of the fiscal year, or a later date the Secretary of State sets.", ext("automatic", { from: "fye", month: 11, day: 15 }, "The Secretary of State’s page gives an automatic extension, with no federal extension needed, to the 15th day of the 11th month after the year end for a registration in good standing; the rule caps any extension there."), "The Secretary of State’s chart counts a January 31 year end to July 31, month end to month end, as counted here."),
  ruled("ME", "9 M.R.S. § 5004(4) and (6); § 5005-B", "https://legislature.maine.gov/statutes/9/title9sec5004.html", fixed(11, 30), "The license expires November 30 each year (or another time the director designates); the renewal application is filed before then.", noExt("None stated. A license may be renewed up to 90 days after it expires, with a late fee (not counted as an extension)."), "The annual fund-raising activity report goes with the renewal. The agency page was not read for a different practice."),
  ruled("MI", "MCL 400.277; Attorney General, renewal solicitation registration form (revised April 2026)", "https://legislature.mi.gov/Laws/MCL?objectName=mcl-400-277", months(7, -30), "A registration expires 1 year and 7 months after the end date of the financial statement filed with " +
    "it, and the renewal is due 30 days before. For the renewal that carries the year just ended, that is " +
    "7 months after this year end, less 30 days.", ext("on-request", null, "On request (by email, letter, or a box on the renewal form) the expiration date is extended by five " +
    "months, and the extension carries to later registrations; the form does not restate the renewal date " +
    "under it, so no extended date is counted."), "Our arithmetic: the registration being renewed was filed with the previous year’s statement, so it expires " +
    "19 months after the previous year end, which is 7 months after this one. The Attorney General’s renewal " +
    "form (michigan.gov) says the same: registrations expire 1 year and 7 months from the fiscal year end " +
    "submitted, and the renewal is due 30 days before. Second read November 12, 2026."),
  ruled("MN", "Minn. Stat. § 309.53, subd. 1", "https://www.revisor.mn.gov/statutes/cite/309.53", monthDay(7, 15), "The annual report is due by July 15 for a calendar year, or the 15th day of the seventh month after the close of the fiscal year.", ext("on-request", plus(4), "For cause shown, the Attorney General may extend the time by up to four months."), ""),
  ruled("MO", "RSMo § 407.462.2", "https://revisor.mo.gov/main/OneSection.aspx?section=407.462", days(75), "The annual report is due within 75 days of the close of each fiscal year.", noExt("None stated in the statute or the Attorney General’s registration questions; the rules were not read."), ""),
  ruled("MS", "Miss. Code Ann. § 79-11-503(4); Mississippi Charities Act Rules, Rules 2.05 and 2.06", "https://www.sos.ms.gov/sites/default/files/charities/MS%20Charities%20Act%20Rules%20-%20September%202025.pdf", monthDay(5, 15), "Renewal is due on or before the 15th day of the fifth month following the close of the fiscal year.", ext("on-request", null, "Extensions for the same time the IRS allows, requested online; the rule states no length, so no extended date is counted."), "The statute was read in the Secretary of State’s compilation of the act."),
  ruled("NC", "N.C.G.S. § 131F-5(c) and (d)", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_131F.html", monthDay(5, 15), "The renewal is due on or before the 15th day of the fifth calendar month after the close of the fiscal year, or the date of an applicable federal extension, whichever is later.", ext("on-request", plus(0, 60), "For good cause the department may extend up to 60 days beyond the due date (counted here). A federal extension date, when later, is the due date instead; the statute does not state that date, so it is not counted."), "A copy of the federal extension application goes to the department within 7 days of filing it."),
  ruled("ND", "N.D.C.C. § 50-22-04(1)", "https://ndlegis.gov/cencode/t50c22.pdf", fixed(9, 1), "The annual report is due on or before September 1 each year.", ext("on-request", { from: "fixed", month: 12, day: 1 }, "On written application before the deadline the Secretary of State may extend the date, never past December 1 (counted here as the latest extended date)."), "An organization whose fiscal year ends within 3 months before the deadline may ask for a standing extension."),
  ruled("NH", "RSA 7:28, V; N.H. Admin. R. Jus 404.04(b) and 404.05", "https://gc.nh.gov/rsa/html/I/7/7-28.htm", months(4, 15), "Annual reports are due on or before 4 months and 15 days following the close of the fiscal year.", ext("on-request", plus(6), "A six-month extension on the unit’s request form, filed by the due date with its fee, for an organization in good standing."), "New Hampshire registers charitable organizations as charitable trusts; the first report has its own timing."),
  ruled("NJ", "N.J.S.A. 45:17A-23(b)", "https://www.njconsumeraffairs.gov/statutes/charitable-registration-and-Investigation-Act.pdf", months(6), "A renewal statement is filed each year within six months after the close of the fiscal year.", ext("on-request", plus(0, 180), "For good cause the Attorney General may extend the time by up to 180 days on a written request received before the deadline; the previous registration stays in effect."), "Read in the Division of Consumer Affairs’ own copy of the act (njconsumeraffairs.gov) and in P.L.2021, c.381; both have the same words for subsection b. Second read November 12, 2026."),
  ruled("NM", "NMSA 1978 § 57-22-6; Department of Justice, auditor and auditor’s report requirements (2024)", "https://nmdoj.gov/wp-content/uploads/NM-Charitable-Organization-Auditor-and-Auditor-Changes-2024.pdf", months(6), "The annual filing is due up to six months following the close of the fiscal year.", ext("on-request", null, "Extensions at the Attorney General’s discretion for good cause; no length is stated, so no extended date is counted."), "The statute text was read in 2023 Senate Bill 240 as passed (nmlegis.gov), the act that last amended the section, where the six-month sentence is unchanged; the Department of Justice’s 2024 guide says the due date is six months after the fiscal period ends. The current compilation did not open. Second read November 12, 2026."),
  ruled("NY", "N.Y. Executive Law § 172-b", "https://www.nysenate.gov/legislation/laws/EXC/172-B", monthDay(5, 15), "The annual financial report is due on or before the 15th day of the fifth calendar month after the close of the fiscal year.", ext("on-request", plus(0, 180), "The Attorney General may extend the time by up to 180 days."), "The Charities Bureau page was not read for its practice."),
  ruled("OH", "Ohio Rev. Code § 1716.02(A)", "https://codes.ohio.gov/ohio-revised-code/section-1716.02", monthDay(5, 15), "The registration is refiled on or before the 15th day of the fifth calendar month after the close of the fiscal year, or by an applicable federal extension date, whichever is later.", ext("automatic", null, "A federal extension date applies when later; the section does not state that date, so no extended date is counted."), ""),
  ruled("OR", "ORS 128.670(5) and (8)(d)", "https://www.oregonlegislature.gov/bills_laws/ors/ors128.html", months(4, 15), "Annual reports are due not later than four months and 15 days following the close of the fiscal year.", ext("on-request", null, "On written application the Attorney General may grant a reasonable period; no length is stated, so no extended date is counted."), "This is the annual report that keeps the registration in force."),
  ruled("PA", "Solicitation of Funds for Charitable Purposes Act, 1990 Act 202, § 5(a) and (k), as amended in 2017 (10 P.S. § 162.5)", "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?txtType=PDF&SessYr=1990&SessInd=0&ActNum=0202.", monthDay(5, 15), "The registration statement is refiled each year and postmarked by the 15th day of the fifth month following the close of the fiscal year.", ext("on-request", { from: "fye", month: 11, day: 15 }, "For good cause the department may extend the time to a mailing date no later than the 15th day of the 11th month following the year end; the previous registration stays in effect."), "The test is the postmark."),
  ruled("TN", "Tennessee Secretary of State, Charitable Solicitations FAQs", "https://sos.tn.gov/charities/faqs", monthDay(6, "last"), "The renewal is due by the last day of the sixth month after the end of the accounting year.", ext("on-request", plus(0, 90), "For good cause the office may extend the time by up to 90 days; a second 60 days with proof of an IRS extension is not counted here."), "Read on the Secretary of State’s questions page; the statute was not read."),
  ruled("VA", "Va. Code § 57-49(A) and (E)", "https://law.lis.virginia.gov/vacode/title57/chapter5/section57-49/", monthDay(5, 15), "The registration statement is refiled on or before the 15th day of the fifth calendar month of each following fiscal year.", ext("on-request", null, "An extension may be granted on written request; no length is stated, so no extended date is counted."), "Counted as the 15th day of the fifth month after the year end, the usual reading of the section’s words."),
  ruled("WA", "WAC 434-120-140(2)", "https://app.leg.wa.gov/WAC/default.aspx?cite=434-120-140", monthDay(11, "last-business"), "The renewal form and fee are received no later than the last business day of the eleventh month after the end of the accounting year.", noExt(), "The rule itself says business day, so the date steps back over a weekend and over Washington’s legal holidays as RCW 1.16.050 lists them (read on the legislature’s site, November 12, 2026), such as Memorial Day when May ends on a Monday."),
  ruled("WI", "Wis. Stat. § 202.12(1)(e) and (3)(a)", "https://docs.legis.wisconsin.gov/statutes/statutes/202/ii/12", fixed(7, 31), "All charitable organization registrations expire July 31 each year.", noExt("None in the statute. The department’s renewal questions describe a late charge window after July 31 (not counted as an extension)."), "The annual financial report is due within 12 months after the end of the fiscal year, a separate date not counted here."),
  notCounted("DC", "D.C. Code § 44-1704(c); Department of Licensing and Consumer Protection, business licensing questions", "https://dlcp.dc.gov/node/1614551", "The charitable solicitation license runs for a two- or four-year term from the day it is issued to the last day of the same month two or four years later; renewal opens 90 days before it expires.", noExt("None stated; late fees after expiry."), "Dated by the license term, not by a fiscal year end."),
  notCounted("HI", "HRS § 467B-6.5", "https://data.capitol.hawaii.gov/hrscurrent/Vol10_Ch0436-0474/HRS0467B/HRS_0467B-0006_0005.htm", "An organization that files a federal annual return files its report within ten business days of filing that return; one that does not, by the 15th day of the fifth month after the close of the fiscal year.", noExt("An organization with a federal extension provides a copy within 20 days after one is requested."), "Which date applies depends on the federal filing, which the page does not know."),
  notCounted("KY", "KRS 367.657(3); Attorney General, charity registration", "https://www.ag.ky.gov/Resources/Consumer-Resources/charity/Pages/registration.aspx", "The federal annual return is filed with the Attorney General each year at the same time it is filed with the IRS.", noExt("None stated by the state."), "Dated by the federal filing, not by a fiscal year end."),
  notCounted("LA", "Attorney General, Charities; La. R.S. 51:1901.1(E)", "https://www.ag.state.la.us/Charities", "Charities that use a professional solicitor register each year at least 10 days before soliciting.", noExt(), "Dated by the solicitation, not by a fiscal year end. The rule the page cites was not read."),
  notCounted("MA", "Attorney General, Frequently Asked Questions about Charitable Organizations; M.G.L. c. 12, § 8F; c. 68, § 19", "https://www.mass.gov/info-details/frequently-asked-questions-about-charitable-organizations", "The annual filing is due within four and one-half months of the end of the fiscal year.", ext("automatic", null, "An automatic six-month extension for organizations registered and in compliance, with no written request."), "Not counted: the source says four and one-half months, and the page does not turn half a month into days."),
  notCounted("NV", "NRS 82A.100(3); NRS 82.523(1)", "https://www.leg.state.nv.us/NRS/NRS-082A.html", "The charity information and financial report go with each annual list, or, for an organization that files none, on the last day of the month of the anniversary of its first filing.", noExt(), "Dated by the annual list or the first filing, which the page does not know."),
  notCounted("OK", "18 O.S. § 552.3(A)", "https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=66919", "The organization registers each year by the date it files its federal annual return or the date, plus extensions, that return is due, whichever comes first.", noExt("Federal extensions count; no separate state extension is stated."), "Dated by the federal return, which the section does not date. Read on the Oklahoma State Courts Network, the Oklahoma Supreme Court’s site."),
  notCounted("RI", "R.I. Gen. Laws § 5-53.1-2(e)", "https://webserver.rilegislature.gov/Statutes/TITLE5/5-53.1/5-53.1-2.htm", "Registration expires one year after the department approves the application (unless the director sets another period), and re-registration, for a similar one-year period, is filed no later than 30 days before the prior registration expires.", noExt("None stated for re-registration. The financial information may follow the IRS due date and extension dates (not counted here)."), "Not counted: the section does not say whether a re-registration’s year runs from its own approval or from the prior expiry, so the first approval date alone may not give the date. Moved from the counted rows on the second read, November 12, 2026."),
  notCounted("SC", "S.C. Code § 33-56-60(A) and § 33-56-30(A)", "https://www.scstatehouse.gov/code/t33c056.php", "The annual financial report is filed within four and one-half months of the close of the fiscal year.", ext("on-request", null, "Unless the Secretary of State grants a written extension; no length is stated."), "Not counted: the source says four and one-half months, and the page does not turn half a month into days."),
  notCounted("UT", "Utah Code §§ 13-22-104 and 13-22-110 (effective May 6, 2026)", "https://le.utah.gov/xcode/Title13/Chapter22/C13-22-S110_2026050620260506.html", "Registration is for professional fundraisers and consultants; a charity that is a nonprofit corporation files its latest federal annual return each year, with no date in the section.", noExt(), "The section dates nothing; the division’s rules were not read."),
  notCounted("WV", "W. Va. Code § 29-19-5(a) and (e)", "https://code.wvlegislature.gov/29-19-5/", "The registration is good for one full year and is refiled in each following year of solicitation.", ext("on-request", null, "For good cause the Secretary of State may extend the due date by up to 90 days; the section does not say which day is due."), "Not counted: neither the section nor the Secretary of State’s questions page states the due day."),
  noRegistration("AZ", "Laws 2013, ch. 234, § 4 (repealing A.R.S. §§ 44-6552 to 44-6560)", "https://www.azleg.gov/legtext/51leg/1r/laws/0234.htm", "The registration sections were repealed in 2013; what is left of the chapter is definitions and unlawful acts."),
  noRegistration("DE", "Division of Revenue, Fundraisers and Charitable Solicitations; 6 Del. C. §§ 2591 to 2597", "https://revenue.delaware.gov/business-tax-forms/fundraisers-and-charitable-solicitations/", "The division’s page says no state statute requires charitable solicitations to be registered."),
  noRegistration("IA", "Iowa Code § 13C.2", "https://www.legis.iowa.gov/docs/code/2026/13C.html", "Registers professional commercial fund-raisers only; a charity gives financial information on request."),
  noRegistration("ID", "Idaho Code §§ 48-1201 to 48-1206 (Idaho Charitable Solicitation Act)", "https://legislature.idaho.gov/statutesrules/idstat/title48/t48ch12/", "The act’s sections are findings, definitions, unlawful acts, enforcement, private actions, and the limit on actions; none is a registration."),
  noRegistration("IN", "Attorney General, Charitable Fundraising", "https://www.in.gov/attorneygeneral/consumer-protection-division/charities-and-donors/charitable-fundraising/", "Professional fundraisers, consultants, and solicitors register; charities that solicit through their own employees or volunteers do not."),
  noRegistration("NE", "Secretary of State, Information: Charitable Solicitors", "https://sos.nebraska.gov/licensing/information-charitable-solicitors", "The page says the law that registered charitable solicitors before 1996 was repealed."),
  noRegistration("SD", "SDCL ch. 37-30", "https://sdlegislature.gov/api/Statutes/37-30.html?all=true", "Registers paid solicitors for each solicitation; no section registers the charity itself."),
  noRegistration("TX", "Attorney General, Charitable Trusts, Registration and Filings", "https://www.texasattorneygeneral.gov/divisions/charitable-trusts/registration-and-filings", "Most charities do not register; certain law enforcement, public safety, and veterans organizations and their solicitors do, and their dates were not read."),
  noRegistration("VT", "9 V.S.A. § 2473", "https://legislature.vermont.gov/statutes/section/09/063/02473", "A paid fundraiser files a notice of solicitation; no section has the charity register."),
  noRegistration("WY", "Secretary of State, Business FAQs", "https://sos.wyo.gov/faqs.aspx?root=BUS", "The page says Wyoming has no state requirements for charities and fund raisers.")
];
var NOT_READ = {
  GA: "Not read: the Secretary of State’s charity pages refused the check twice on November 12, 2026, so no rule was read.",
  MT: "Not read: no official Montana page or code section on charity registration opened on November 12, 2026 (tried twice), and the code’s parts index read has no charitable solicitation part."
};
var WA_HOLIDAYS = {
  code: "WA",
  citation: "RCW 1.16.050(1) and (5)",
  sourceUrl: "https://app.leg.wa.gov/RCW/default.aspx?cite=1.16.050",
  checkedOn: CHECKED,
  holidays: [
    { kind: "fixed", name: "New Year’s Day", month: 1, day: 1 },
    { kind: "nth-weekday", name: "Martin Luther King, Jr. Day", month: 1, weekday: 1, nth: 3 },
    { kind: "nth-weekday", name: "Presidents’ Day", month: 2, weekday: 1, nth: 3 },
    { kind: "nth-weekday", name: "Memorial Day", month: 5, weekday: 1, nth: "last" },
    { kind: "fixed", name: "Juneteenth", month: 6, day: 19 },
    { kind: "fixed", name: "Independence Day", month: 7, day: 4 },
    { kind: "nth-weekday", name: "Labor Day", month: 9, weekday: 1, nth: 1 },
    { kind: "fixed", name: "Veterans Day", month: 11, day: 11 },
    { kind: "nth-weekday", name: "Thanksgiving Day", month: 11, weekday: 4, nth: 4 },
    { kind: "after-nth-weekday", name: "Native American Heritage Day", month: 11, weekday: 4, nth: 4, days: 1 },
    { kind: "fixed", name: "Christmas Day", month: 12, day: 25 }
  ],
  saturday: -1,
  sunday: 1,
  weekendText: "A listed holiday other than Sunday that falls on a Sunday is kept on the Monday after; one that falls on a Saturday, on the Friday before. Sunday itself is listed as a legal holiday."
};
var NP_RENEWAL_DATES = {
  id: "charity-registration-renewal-dates",
  label: "state charity registration renewal due dates",
  checkedOn: CHECKED,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: REF_US_STATES_DC.filter((m) => !ROWS.some((r) => r.code === m.code)).map((m) => ({ code: m.code, kind: "not-read", reason: NOT_READ[m.code] ?? "Not yet read from an official source for this table." })),
  // oscn.net is the Oklahoma State Courts Network, the Oklahoma Supreme Court's own site, which publishes the statutes.
  officialHosts: ["oscn.net"],
  holidays: [WA_HOLIDAYS]
};
function npHolidayListFor(table, row) {
  if (row.rule?.kind !== "month-day" || row.rule.day !== "last-business") return null;
  return (table.holidays ?? []).find((l) => l.code === row.code) ?? null;
}
function npRenewalRuleProblem(rule) {
  if (!rule || typeof rule !== "object") return "no rule";
  const whole = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  switch (rule.kind) {
    case "months":
      return whole(rule.months, 1, 24) && whole(rule.days, -60, 60) ? "" : "months must be 1 to 24 and days -60 to 60";
    case "month-day":
      return whole(rule.month, 1, 12) && (rule.day === "last" || rule.day === "last-business" || whole(rule.day, 1, 31)) ? "" : "the month must be 1 to 12 and the day 1 to 31, last, or last-business";
    case "days":
      return whole(rule.days, 1, 366) ? "" : "days must be 1 to 366";
    case "fixed":
      return whole(rule.month, 1, 12) && whole(rule.day, 1, daysInMonth(2025, rule.month)) ? "" : "not a calendar date";
    case "anniversary":
      return whole(rule.offsetDays, -60, 60) ? "" : "offset must be -60 to 60 days";
    default:
      return "unknown kind of rule";
  }
}
function extensionProblem(e) {
  if (!e || typeof e !== "object") return "no extension entry";
  if (!["automatic", "on-request", "none"].includes(e.how)) return "unknown kind of extension";
  if (typeof e.text !== "string" || e.text.trim().length < 6) return "no extension wording";
  if (e.how === "none" && e.count) return "counts an extension it says is none";
  const c = e.count;
  if (!c) return "";
  const whole = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  if (c.from === "due") return whole(c.months, 0, 12) && whole(c.days, 0, 366) && c.months + c.days > 0 ? "" : "extension length out of range";
  if (c.from === "fye" || c.from === "fixed") return whole(c.month, 1, 12) && whole(c.day, 1, 31) ? "" : "extension date out of range";
  return "unknown extension count";
}
function npHolidayListProblem(list, latest, officialHosts = []) {
  if (!list || typeof list !== "object") return "no holiday list";
  const src = refSourceProblem(list, latest, officialHosts);
  if (src) return src;
  const whole = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const hs = Array.isArray(list.holidays) ? list.holidays : [];
  if (hs.length === 0) return "no holidays";
  const names2 = /* @__PURE__ */ new Set();
  const keys = /* @__PURE__ */ new Set();
  for (const h of hs) {
    if (!h || typeof h.name !== "string" || h.name.trim().length < 3) return "a holiday with no name";
    if (names2.has(h.name)) return `${h.name} listed twice`;
    names2.add(h.name);
    if (!whole(h.month, 1, 12)) return `${h.name}: month out of range`;
    let key;
    if (h.kind === "fixed") {
      if (!whole(h.day, 1, daysInMonth(2025, h.month))) return `${h.name}: not a calendar date`;
      key = `${h.month}/${h.day}`;
    } else if (h.kind === "nth-weekday" || h.kind === "after-nth-weekday") {
      if (!whole(h.weekday, 0, 6)) return `${h.name}: weekday out of range`;
      if (!(h.nth === "last" && h.kind === "nth-weekday") && !whole(h.nth, 1, 4)) return `${h.name}: the nth must be 1 to 4 or last`;
      if (h.kind === "after-nth-weekday" && !whole(h.days, 1, 6)) return `${h.name}: days after must be 1 to 6`;
      key = `${h.kind} ${h.month} ${h.weekday} ${h.nth} ${h.kind === "after-nth-weekday" ? h.days : 0}`;
    } else return "unknown kind of holiday";
    if (keys.has(key)) return `${h.name} is the same day as another holiday`;
    keys.add(key);
  }
  const keptOnWeekday = (shift, from) => shift === 0 || whole(shift, -6, 6) && ![0, 6].includes(((from + shift) % 7 + 7) % 7);
  if (!keptOnWeekday(list.saturday, 6) || !keptOnWeekday(list.sunday, 0)) return "a weekend holiday would be kept on another weekend day";
  if (typeof list.weekendText !== "string" || list.weekendText.trim().length < 20) return "no weekend rule in words";
  return "";
}
function checkNpRenewalTable(table = NP_RENEWAL_DATES) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badRules = [];
  const badExt = [];
  const badText = [];
  for (const r of rows) {
    if (r.status === "rule") {
      const p = npRenewalRuleProblem(r.rule);
      if (p) badRules.push(`${r.code} (${p})`);
    } else if (r.status === "not-counted" || r.status === "none") {
      if (r.rule) badRules.push(`${r.code} (has a rule but is marked ${r.status})`);
    } else badRules.push(`${r.code} (unknown status)`);
    const e = extensionProblem(r.extension);
    if (e) badExt.push(`${r.code} (${e})`);
    if (r.status === "none" && r.extension?.count) badExt.push(`${r.code} (counts an extension with no registration)`);
    if (typeof r.ruleText !== "string" || r.ruleText.trim().length < 20) badText.push(`${r.code} (rule wording)`);
    if (typeof r.notes !== "string") badText.push(`${r.code} (notes)`);
    if (r.status !== "rule" && (typeof r.notes !== "string" || r.notes.trim().length < 20)) badText.push(`${r.code} (the reason it gives no date)`);
  }
  checks.that("np-renew-rules", "Every counted row has a rule whose numbers are in range, and no other row has one", badRules.length === 0, badRules.join("; "));
  checks.that("np-renew-extensions", "Every row says what extension its source gives, and only a stated length is counted", badExt.length === 0, badExt.join("; "));
  checks.that("np-renew-text", "Every row states its rule in words, and a row with no date says why", badText.length === 0, badText.join("; "));
  const lists = Array.isArray(table.holidays) ? table.holidays : [];
  const badHol = [];
  const businessRows = rows.filter((r) => r.status === "rule" && r.rule?.kind === "month-day" && r.rule.day === "last-business").map((r) => r.code);
  for (const code of businessRows) {
    const mine = lists.filter((l) => l?.code === code);
    if (mine.length !== 1) badHol.push(`${code} (${mine.length} holiday lists for a last-business-day rule)`);
  }
  for (const l of lists) {
    if (!businessRows.includes(l?.code)) badHol.push(`${l?.code} (a holiday list with no last-business-day rule to use it)`);
    const p = npHolidayListProblem(l, table.checkedOn, table.officialHosts ?? []);
    if (p) badHol.push(`${l?.code} (${p})`);
  }
  checks.that("np-renew-holidays", "Every last-business-day rule has its state’s holiday list, read on an official source and dated, with every holiday’s numbers in range; no other rule uses one", badHol.length === 0, badHol.join("; "));
  return checks.all;
}
function npRenewalAgreesWithAuditTable(table = NP_RENEWAL_DATES) {
  const auditRows = new Set(NP_AUDIT_THRESHOLDS.rows.map((r) => r.code));
  const clash = table.rows.filter((r) => r.status === "none" && auditRows.has(r.code)).map((r) => r.code);
  const list = new CheckList();
  list.that("np-renew-audit-table", "No state read here as having no charity registration has a row of figures in the charity audit thresholds table", clash.length === 0, `In both: ${clash.join(", ")}`, "warning");
  return list.all[0];
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
  const days2 = [...new Set(rows.map((r) => r.checkedOn))].sort();
  const later = days2.filter((d) => d > date);
  if (later.length > 0) {
    return [`The row was read on ${later.join(" and ")}, after ${date}. The table holds the rule as read that day and no earlier version, so whether it read the same on ${date} is not covered here.`];
  }
  return [`${date} is on or after the day the row was read (${days2.join(" and ")}); the row is the rule as read then. Rules change: the source address is where to read the current text.`];
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
var auditThresholds = /* @__PURE__ */ (() => ({
  id: "charity-audit-thresholds-by-state",
  page: "nonprofits/charity-audit-thresholds-by-state",
  section: "nonprofits",
  title: "Charity audit, review and compilation thresholds by state",
  pageTitle: "Charity Audit Thresholds by State: audit, review, and compilation figures",
  description: `The dollar figures at which a state's charitable solicitation (or charitable trust) law names audited, reviewed or compiled financial statements for a registered charity's registration or annual report, each band with its wording ("at least", "more than", "less than"), what the figures are measured on (total revenue, contributions), and the conditions in words; a state whose source names no figure says what it asks for instead. Use it when someone asks at what revenue a nonprofit needs an audit or a CPA review for its state charity registration.`,
  question: "At what revenue does Pennsylvania ask a charity for audited financial statements?",
  notAdvice: "Mathproven gives figures only, not legal or tax advice. Rules change; the linked official source has the full wording. Mathproven is not affiliated with any agency whose rules are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: NP_AUDIT_THRESHOLDS.members,
  table: NP_AUDIT_THRESHOLDS,
  rows: NP_AUDIT_THRESHOLDS.rows,
  notCovered: NP_AUDIT_THRESHOLDS.notCovered,
  check: once(() => checkNpAuditThresholdTable()),
  findings: once(() => npAuditThresholdsFindings()),
  codeOf: (r) => r.code,
  sources: (r) => [{ citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn }],
  rowText: (r) => joinText([
    `Measured on: ${r.measure}`,
    ...r.tiers.map((t) => `${NP_STATEMENT_LEVELS[t.level].label}: ${npBandText(t)} (${t.accepts})`),
    r.hasConditions && "Has conditions (the note says which)",
    `Conditions (our summary): ${r.notes}`
  ]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var RENEWAL_STATUS = /* @__PURE__ */ (() => ({ rule: "Counted", "not-counted": "Read, not counted", none: "No registration" }))();
var RENEWAL_EXT = /* @__PURE__ */ (() => ({ automatic: "Automatic", "on-request": "On request", none: "None" }))();
var extensionLine = /* @__PURE__ */ (() => ((x) => x.text.startsWith(RENEWAL_EXT[x.how]) ? x.text : `${RENEWAL_EXT[x.how]}. ${x.text}`))();
var renewalDates = /* @__PURE__ */ (() => ({
  id: "charity-registration-renewal-dates-by-state",
  page: "nonprofits/charity-registration-renewal-dates-by-state",
  section: "nonprofits",
  title: "Charity registration renewal due-date rules by state",
  pageTitle: "Charity Registration Renewal Due Dates by State, from a fiscal year end",
  description: "How each state dates the renewal of a charitable solicitation registration (or the annual report that keeps it in force): a number of months or days after the fiscal year end, a day of the Nth month after it, the registration's anniversary, or a fixed calendar date, and any extension, automatic or on request; states with no charity registration say so. Use it when someone asks when a nonprofit's charity registration renewal or annual report is due in a state.",
  question: "How is the charity registration renewal due date set in Pennsylvania?",
  notAdvice: "Mathproven gives renewal rules only, not legal or tax advice. Rules change; the linked official source has the full wording. Mathproven is not affiliated with any agency whose rules are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: NP_RENEWAL_DATES.members,
  table: NP_RENEWAL_DATES,
  rows: NP_RENEWAL_DATES.rows,
  notCovered: NP_RENEWAL_DATES.notCovered,
  check: once(() => [...checkNpRenewalTable(NP_RENEWAL_DATES), npRenewalAgreesWithAuditTable(NP_RENEWAL_DATES)]),
  codeOf: (r) => r.code,
  sources: (r) => {
    const holidays = npHolidayListFor(NP_RENEWAL_DATES, r);
    return unique([r, ...holidays ? [{ citation: holidays.citation, sourceUrl: holidays.sourceUrl, checkedOn: holidays.checkedOn }] : []]);
  },
  rowText: (r) => joinText([`Status: ${RENEWAL_STATUS[r.status]}`, `Renewal rule (our words): ${r.ruleText}`, `Extension: ${extensionLine(r.extension)}`, r.notes && `Notes (our summary): ${r.notes}`]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var AGENT_TABLES = [auditThresholds, renewalDates];
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
var pool = [...NONPROFITS, ...lookupEntries()];
var names = ["donor_retention_rate", "year_end_giving_statements", "gift_acknowledgment_checklist", "donor_deduplication", "donor_upgrades_downgrades", "donation_gift_log_template", "giving_by_fund_and_month", "lybunt_sybunt_report", "quid_pro_quo_payment_split", "charity_audit_thresholds_by_state", "charity_registration_renewal_dates_by_state"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.3", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
