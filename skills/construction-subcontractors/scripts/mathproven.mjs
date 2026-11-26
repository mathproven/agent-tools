// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AgentInputError,
  CONSTRUCTION,
  beginColumnLog,
  checkValue,
  isVerified,
  present,
  takeColumnLog
} from "./lib/construction.mjs";
import {
  US_STATES
} from "./lib/lienWaiver.mjs";
import {
  formatPercentBp
} from "./lib/payappcheck.mjs";
import "./lib/lateInterest.mjs";
import {
  PROMPT_PAY_JOB_LABELS,
  PROMPT_PAY_PAYMENT_LABELS,
  PROMPT_PAY_TABLE,
  checkPromptPayTable,
  promptPayFindings,
  promptPayRateLabel,
  promptPaySources,
  refCheckTable,
  refIsDay
} from "./lib/promptPay.mjs";
import "./lib/fringeCredit.mjs";
import {
  certificateText,
  certify,
  failures,
  passedAll
} from "./lib/money.mjs";
import {
  readXlsx,
  writeXlsx
} from "./lib/fflate.mjs";

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

// packages/core/src/construction/retainageLimits.ts
var CHECKED = "2026-10-10";
var CA_CODE = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml";
function row(state, jobType, capBp, rateHasConditions, citation, sourceUrl, notes) {
  return { state, jobType, capBp, rateHasConditions, citation, sourceUrl, checkedOn: CHECKED, notes };
}
function rowNov7(state, jobType, capBp, rateHasConditions, citation, sourceUrl, notes) {
  return { ...row(state, jobType, capBp, rateHasConditions, citation, sourceUrl, notes), checkedOn: "2026-11-07" };
}
var RETAINAGE_LIMITS = [
  row("AZ", "public", 1e3, true, "A.R.S. § 34-221(C)", "https://www.azleg.gov/ars/34/00221.htm", "10% of estimates is retained. After the contract is 50% complete, no more than 5% of later progress payments while progress is satisfactory; 10% can be reinstated if it is not."),
  row("CA", "public", 500, true, "Cal. Pub. Contract Code § 7201(b)", `${CA_CODE}?lawCode=PCC&sectionNum=7201`, "5% of each payment and 5% of the contract price in total. The section lists exceptions, including some subcontracts where a requested bond is not furnished."),
  row("CA", "private", 500, true, "Cal. Civ. Code § 8811(b)", `${CA_CODE}?lawCode=CIV&sectionNum=8811`, "Contracts entered into on or after January 1, 2026. 5% of each payment and 5% of the contract price in total. Does not cover residential projects that are not mixed-use and are four stories or less; the section has a bond-related exception too."),
  row("CT", "public", 750, true, "Conn. Gen. Stat. § 49-41b", "https://www.cga.ct.gov/current/pub/chap_847.htm", "Public work contracts that require a payment bond and a full performance bond. State agency contracts: 7.5%, reduced to 5% once the contract is 50% complete. Department of Transportation contracts: 2.5%. Municipal contracts: 5%."),
  rowNov7("DE", "public", 500, true, "Del. Code Ann. tit. 29, § 6962(d)(5)", "https://delcode.delaware.gov/title29/c069/sc04/index.html", "Large public works contracts covered by the section: 5% of the value of the work the contractor has completed. Once the work is complete the agency may release 60% of what it holds; Transportation contracts have their own variable-retainage rule in the section."),
  row("FL", "public", 500, true, "Fla. Stat. § 255.078(1)", "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0255/Sections/0255.078.html", "5% of each progress payment. The section does not apply when the construction services cost $200,000 or less, and has an exception for some federally funded work."),
  rowNov7("HI", "public", 500, true, "Haw. Rev. Stat. § 103-32.1(c)(1)", "https://data.capitol.hawaii.gov/hrscurrent/Vol02_Ch0046-0115/HRS0103/HRS_0103-0032_0001.htm", "No more than 5% of the total amount due the contractor. After 50% of the contract is done and progress is satisfactory, nothing more is withheld."),
  row("ID", "public", 500, true, "Idaho Code § 54-1926(3)", "https://legislature.idaho.gov/statutesrules/idstat/Title54/T54CH19/SECT54-1926/", "Applies when the public body requires a performance or payment bond of more than 50% of the contract amount. The same 5% limit applies to what a contractor holds from a subcontractor on that work."),
  rowNov7("IL", "public", 1e3, true, "30 ILCS 550/1", "https://www.ilga.gov/Documents/legislation/ilcs/documents/003005500K1.htm", "Local governmental units, contractor furnishing the required bond: up to 10% of each payment before the contract is 50% complete, then retainage is reduced so that no more than 5% is held. The page also shows an amended text, effective June 1, 2027, that adds rules for State agencies."),
  rowNov7("IL", "private", 1e3, true, "815 ILCS 603/20", "https://www.ilga.gov/Documents/legislation/ilcs/documents/081506030K20.htm", "Up to 10% of each payment before the contract is 50% complete, then reduced so that no more than 5% is held. Under 815 ILCS 603/5, contracts paid with public funds and residences of up to 12 units in a building are not covered."),
  rowNov7("IN", "public", 600, true, "Ind. Code § 36-1-12-14(c)", "https://iga.in.gov/laws/2026/ic/titles/36#36-1-12-14", "Public work contracts over $200,000 other than roads and bridges. The board either holds no more than 6% of work satisfactorily completed until the work is 50% done and nothing after, or no more than 3% until substantial completion. State Public Works Division projects follow the same two choices under Ind. Code § 4-13.6-7-3."),
  row("KS", "public", 500, true, "K.S.A. 16-1904(a)", "https://www.ksrevisor.gov/statutes/chapters/ch16/016_019_0004.html", "5% of the contract or subcontract value. A higher rate, never more than 10%, is allowed when the owner or contractor determines it is needed to ensure performance."),
  row("KS", "private", 500, true, "K.S.A. 16-1804(a)", "https://www.ksrevisor.gov/statutes/chapters/ch16/016_018_0004.html", "5% of the contract or subcontract value. A higher rate, never more than 10%, is allowed when the owner or contractor determines it is needed to ensure performance."),
  rowNov7("KY", "public", 1e3, true, "KRS 371.410(1)", "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=35259", "Up to 10% of any undisputed payment until the project is 50% complete; once 51% is complete, the total held may not be more than 5% of the contract amount. KRS 371.425 applies this to public and private work except residential construction, with listed exceptions for some utility work."),
  rowNov7("KY", "private", 1e3, true, "KRS 371.410(1)", "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=35259", "Same section as public work: up to 10% of any undisputed payment until the project is 50% complete, then no more than 5% of the contract amount in total. Residential construction is not covered (KRS 371.425)."),
  rowNov7("LA", "public", 1e3, true, "La. R.S. 38:2248(A)", "https://legis.la.gov/legis/LawPrint.aspx?d=94968", "Public works projects under $500,000: no more than 10% of the contract price withheld; projects of $500,000 or more: no more than 5%. Held until 45 days after formal acceptance is recorded. The Department of Transportation and Development has its own section."),
  row("MA", "public", 500, false, "Mass. Gen. Laws ch. 30, § 39K", "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIII/Chapter30/Section39K", "Public building construction contracts covered by this section: 5% of the approved amount of each periodic payment. Other deductions listed in the section are separate from this retention."),
  row("MA", "private", 500, true, "Mass. Gen. Laws ch. 149, § 29F(b)", "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXXI/Chapter149/Section29F", "5% of any progress payment. Covers projects where the prime contract with the owner is at least $3,000,000; projects of one to four dwelling units are not covered."),
  row("MD", "public", 500, true, "Md. Code, State Fin. & Proc. § 13-225(b)", "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gsf&section=13-225&enactments=false", "State procurement contracts for construction where the contractor has furnished 100% payment security and 100% performance security."),
  row("MD", "private", 500, true, "Md. Code, Real Prop. § 9-304(c)", "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=grp&section=9-304&enactments=false", "Applies when the contractor has furnished 100% performance security and 100% payment security: 5% of each payment and 5% of the contract price. Contracts under $100,000 and certain state-housing-funded projects are not covered."),
  row("MI", "public", 1e3, true, "Mich. Comp. Laws § 125.1563(2)", "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-125-1563", "Construction contracts with public agencies covered by 1980 PA 524: 10% of the value of work in place until the work is 50% in place. After that, no more is held unless the agency determines progress is not satisfactory."),
  row("MN", "public", 500, true, "Minn. Stat. § 15.72, subd. 2", "https://www.revisor.mn.gov/statutes/cite/15.72", "5% of each progress payment on a public contract for a public improvement. The section also limits what may be held after substantial completion."),
  row("MN", "private", 500, false, "Minn. Stat. § 337.10, subd. 4", "https://www.revisor.mn.gov/statutes/cite/337.10", "5% on a building and construction contract. This subdivision does not apply to public agencies or to contracts for certain professional services."),
  row("MO", "private", 1e3, true, "Mo. Rev. Stat. § 436.303", "https://revisor.mo.gov/main/OneSection.aspx?section=436.303", "10% of each payment due from the owner to the contractor on private construction work. The contract may allow more to be held if performance does not meet the contract."),
  row("MT", "public", 500, false, "Mont. Code Ann. § 28-2-2110", "https://mca.legmt.gov/bills/mca/title_0280/chapter_0020/part_0210/section_0100/0280-0020-0210-0100.html", "Construction contracts under Title 28, chapter 2, part 21 where the owner is a city, town, county, school district, or special district (the part's definition of government entity). A contractor may not hold a higher rate from a subcontractor than the owner holds."),
  row("MT", "private", 500, false, "Mont. Code Ann. § 28-2-2110", "https://mca.legmt.gov/bills/mca/title_0280/chapter_0020/part_0210/section_0100/0280-0020-0210-0100.html", "Construction contracts under Title 28, chapter 2, part 21. A contractor may not hold a higher rate from a subcontractor than the owner holds."),
  row("NC", "public", 500, true, "N.C. Gen. Stat. § 143-134.1(b1)", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_143/GS_143-134.1.html", "No retainage is allowed when total project costs are under $150,000. Otherwise 5% of each periodic payment; once the project is 50% complete, no further retainage if the conditions in the section are met."),
  rowNov7("NE", "public", 1e3, true, "Neb. Rev. Stat. § 45-1204(1)", "https://nebraskalegislature.gov/laws/statutes.php?statute=45-1204", "Political subdivisions as owners; State of Nebraska contracts are outside this act. Never more than the contract states and never above 10%. Once the work is 50% complete and the contractor gives the assurances the section describes, no more than 5% of each later payment."),
  rowNov7("NE", "private", 1e3, true, "Neb. Rev. Stat. § 45-1204(1)", "https://nebraskalegislature.gov/laws/statutes.php?statute=45-1204", "Never more than the contract states and never above 10%. Once the work is 50% complete and the contractor gives the assurances the section describes, no more than 5% of each later payment. Residential property of four or fewer units is outside the act."),
  row("NV", "public", 500, true, "NRS 338.515", "https://www.leg.state.nv.us/NRS/NRS-338.html#NRS338Sec515", "5% of each progress payment until 50% of the work is done. After that the section sets lower or equal limits (2.5% or 5% of each payment) depending on what else the public body withholds."),
  row("NV", "private", 500, false, "NRS 624.609(2)", "https://www.leg.state.nv.us/NRS/NRS-624.html#NRS624Sec609", "Agreements between an owner of real property and a prime contractor: a retention amount of no more than 5% of each payment, when the agreement allows retention."),
  row("NY", "public", 500, true, "N.Y. State Fin. Law § 139-f(1)", "https://www.nysenate.gov/legislation/laws/STF/139-F", "5% of each progress payment. More than 5%, up to 10%, is allowed when the public owner does not require both a performance bond and a labor and material bond for the full contract amount."),
  rowNov7("OH", "public", 400, true, "Ohio Rev. Code § 153.12(A)", "https://codes.ohio.gov/ohio-revised-code/section-153.12", "The section sets the least the owner pays on approved labor estimates (96%), so no more than 4% of each labor estimate is held; text effective September 17, 2026. Materials delivered to the site are paid at 92% of invoice cost under § 153.14 until built in."),
  rowNov7("OK", "public", 500, true, "61 O.S. § 113.1(A)", "https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=85268", "Up to 5% of all partial payments. Once more than 50% of the contract amount is complete and progress is found satisfactory, retainage drops to 2.5% of the amount earned to date."),
  row("OR", "public", 500, true, "ORS 279C.570(7)", "https://www.oregonlegislature.gov/bills_laws/ors/ors279C.html", "5% of each progress payment on a public improvement contract. The agency may reduce it as work progresses and may end it after 50% of the work is complete."),
  row("OR", "private", 500, false, "ORS 701.420(1)", "https://www.oregonlegislature.gov/bills_laws/ors/ors701.html", "5% of the contract price of the work completed, on contracts for construction and home improvement. Does not apply to federal projects or work paid for with federal money (ORS 701.440)."),
  rowNov7("PA", "public", 1e3, true, "62 Pa.C.S. § 3921(a)", "https://www.palegis.us/statutes/consolidated/view-statute?93&iFrame=true&txtType=HTM&ttl=62&div=00.&chpt=039.&sctn=021.&subsctn=000.", "No more than 10% of the amount due until 50% of the contract is complete; then half of what was held is returned and later holdback is no more than 5% of the value of completed work. Department of General Services contracts have a 6% limit under subsection (b)."),
  row("RI", "public", 500, false, "R.I. Gen. Laws § 37-12-10.1(a)", "https://webserver.rilegislature.gov/Statutes/TITLE37/37-12/37-12-10.1.htm", "5% of any progress payment on state or municipal public works projects, other than contracts under § 37-12-10. The same subsection also covers contracts for construction as defined in § 5-65-1."),
  rowNov7("TX", "public", 1e3, true, "Tex. Gov't Code § 2252.032(b)", "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.2252.htm", "Public works contracts under $5 million: no more than 10% of the contract price, and no more than 10% on any bid or schedule-of-values item. Contracts of $5 million or more: no more than 5%. Subsection (i) lists exceptions."),
  rowNov7("UT", "public", 500, false, "Utah Code § 13-8-5(3)", "https://le.utah.gov/xcode/Title13/Chapter8/C13-8-S5_2023022720230227.html", "Applies to public agencies and private owners alike: no more than 5% of each payment and no more than 5% of the total construction price. Covers nonresidential work only (on a mixed project, the nonresidential share)."),
  rowNov7("UT", "private", 500, false, "Utah Code § 13-8-5(3)", "https://le.utah.gov/xcode/Title13/Chapter8/C13-8-S5_2023022720230227.html", "Same section as public work: no more than 5% of each payment and no more than 5% of the total construction price. Covers nonresidential work only (on a mixed project, the nonresidential share)."),
  row("VA", "public", 500, false, "Va. Code § 2.2-4333", "https://law.lis.virginia.gov/vacode/title2.2/chapter43/section2.2-4333/", "Public construction contracts with progress payments based on estimated percentage of completion: at least 95% of the earned sum is paid when due. Subcontracts on the project with similar progress payments are covered too."),
  row("WA", "public", 500, false, "RCW 60.28.011(1)", "https://app.leg.wa.gov/RCW/default.aspx?cite=60.28.011", "5% of the moneys earned by the contractor on a public improvement contract. Contracts funded with federal transportation money rely on the contract bond instead."),
  row("WA", "private", 500, false, "RCW 60.30.010(1)", "https://app.leg.wa.gov/RCW/default.aspx?cite=60.30.010", "5% of the contract price of the work completed on private construction projects. Does not apply to single-family residential construction of fewer than 12 units."),
  row("WI", "public", 500, true, "Wis. Stat. § 66.0901(9)(b)", "https://docs.legis.wisconsin.gov/statutes/statutes/66/ix/0901/9", "Public work contracts of $1,000 or more let by a municipality as the section defines that word: 5% of each estimate until 50% of the work is complete, then nothing further unless the job is certified as not proceeding satisfactorily; total retainage is never more than 10% of the work completed.")
];
function retainageTableSummary(rows = RETAINAGE_LIMITS) {
  const counts = /* @__PURE__ */ new Map();
  for (const r of rows) counts.set(r.capBp, (counts.get(r.capBp) ?? 0) + 1);
  const byRate = [...counts].map(([capBp, n]) => ({ capBp, rows: n })).sort((a, b) => b.rows - a.rows || a.capBp - b.capBp);
  return {
    rows: rows.length,
    states: new Set(rows.map((r) => r.state)).size,
    byRate,
    rowsWithConditions: rows.filter((r) => r.rateHasConditions).length,
    lastChecked: rows.reduce((d, r) => r.checkedOn > d ? r.checkedOn : d, "")
  };
}
function retainageStatesNotCovered() {
  const covered = new Set(RETAINAGE_LIMITS.map((r) => r.state));
  return US_STATES.filter(([code]) => !covered.has(code)).map(([code, name]) => ({ code, name }));
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
function promptDeadlineText(d) {
  const days = `${d.days} ${d.count === "business" ? "business days" : "days"}`;
  const rate = d.rate ? `${promptPayRateLabel(d.rate)}: ${d.rateText}` : d.rateText;
  return joinText([
    `${PROMPT_PAY_PAYMENT_LABELS[d.payment]}: ${days} after ${d.from}`,
    `Late-payment interest: ${rate}`,
    d.graceDays !== void 0 && `Interest is owed only when payment comes more than ${d.graceDays} days after the due date`,
    d.caveat && `Condition: ${d.caveat}`
  ]);
}
var promptPay = /* @__PURE__ */ (() => ({
  id: "prompt-payment-deadlines",
  page: "construction/prompt-payment-deadlines",
  section: "construction",
  title: "State prompt payment deadlines for construction, with late-payment interest",
  pageTitle: "State Prompt Payment Deadlines for Construction: Days, Interest, Statutes",
  description: "Each state's prompt payment statute for construction, public and private jobs: the days an owner has to pay the prime contractor, the days a contractor has to pay a subcontractor after being paid, what starts each count, and the late-payment interest rate the section states (a fixed rate, or the section's floating rate in words). Use it when someone asks how long an owner or general contractor has to pay on a construction job in a state, or what interest a late construction payment carries.",
  question: "How many days does a contractor in Ohio have to pay a subcontractor, and what interest applies when it is late?",
  notAdvice: "Mathproven gives days and rates as each cited section states them. Nothing here says whether a section applies to a particular contract or what to do about a late payment. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: PROMPT_PAY_TABLE.members,
  table: PROMPT_PAY_TABLE,
  rows: PROMPT_PAY_TABLE.rows,
  notCovered: PROMPT_PAY_TABLE.notCovered,
  check: once(() => checkPromptPayTable()),
  findings: once(() => promptPayFindings()),
  codeOf: (r) => r.code,
  sources: (r) => unique([r, ...promptPaySources(r)]),
  rowText: (r) => joinText([`${PROMPT_PAY_JOB_LABELS[r.job]} jobs`, ...r.deadlines.map(promptDeadlineText), r.notes && `Notes (our summary): ${r.notes}`]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var RETAINAGE_MEMBERS = /* @__PURE__ */ (() => US_STATES.map(([code, name]) => ({ code, name })))();
var RETAINAGE_GAP = /* @__PURE__ */ (() => "Not checked for this table yet; missing does not mean no limit.")();
var RETAINAGE_REF = /* @__PURE__ */ (() => ({
  id: "retainage-limits",
  label: "state retainage limits",
  checkedOn: retainageTableSummary().lastChecked,
  members: RETAINAGE_MEMBERS,
  rows: RETAINAGE_LIMITS.map((limit) => ({ code: limit.state, citation: limit.citation, sourceUrl: limit.sourceUrl, checkedOn: limit.checkedOn, limit })),
  notCovered: retainageStatesNotCovered().map((s) => ({ code: s.code, reason: RETAINAGE_GAP })),
  // oscn.net is the Oklahoma State Courts Network, the Oklahoma judiciary's site, which publishes the Oklahoma
  // Statutes (the core's other tables name it the same way).
  officialHosts: ["oscn.net"]
}))();
var retainage = /* @__PURE__ */ (() => ({
  id: "retainage-limits",
  page: "construction/retainage-limits",
  section: "construction",
  title: "State retainage limits on public and private construction jobs",
  pageTitle: "State Retainage Limits — public and private job caps with statute links",
  description: "The general retainage rate a state statute sets for what may be held back from a progress payment on public and on private construction jobs, where a statute sets a number, with a flag where the section attaches conditions to that rate (a step-down part-way through, a contract-size threshold, a bond condition) and the conditions in words. Use it when someone asks the maximum retainage or retention percentage on a construction contract in a state.",
  question: "What is the retainage limit on a public job in California?",
  notAdvice: "Mathproven gives the general rate from the cited statutes on the checked date in each row; rules change. General information, not advice.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: RETAINAGE_MEMBERS,
  table: RETAINAGE_LIMITS,
  rows: RETAINAGE_LIMITS,
  notCovered: RETAINAGE_REF.notCovered,
  check: once(() => refCheckTable(RETAINAGE_REF, (r) => `${r.code} ${r.limit.jobType}`)),
  findings: once(() => {
    const s = retainageTableSummary();
    const rates = s.byRate.map((r) => `${formatPercentBp(r.capBp)} in ${r.rows} ${r.rows === 1 ? "row" : "rows"}`).join(", ");
    const text = `${s.rows} rows covering ${s.states} states. General rate: ${rates}. ${s.rowsWithConditions} of the ${s.rows} rows have conditions on that rate (each row's note says which). Newest check: ${s.lastChecked}.`;
    return { findings: [{ id: "retainage-summary", text }], checks: [] };
  }),
  codeOf: (r) => r.state,
  sources: (r) => [{ citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn }],
  rowText: (r) => joinText([`${r.jobType === "public" ? "Public" : "Private"} jobs: general rate ${formatPercentBp(r.capBp)}`, r.rateHasConditions && "Rate has conditions (the note says which)", r.notes]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    const p = asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
    if (p.rows.length !== 1) return p;
    const other = p.rows[0].jobType === "public" ? "private" : "public";
    return { ...p, notes: [...p.notes, `${other === "public" ? "Public" : "Private"} jobs in this state: not covered (not checked for this table yet; missing does not mean no limit).`] };
  }
}))();
var AGENT_TABLES = [promptPay, retainage];
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
var pool = [...CONSTRUCTION, ...lookupEntries()];
var names = ["pay_application_builder", "pay_application_checker", "pay_application_template_workbook", "schedule_of_values_builder", "progress_billing_statement", "retainage_calculator", "retainage_tracker_release_invoice", "lien_waiver_generator", "late_payment_interest_calculator", "over_under_billing_wip_schedule", "prevailing_wage_fringe_credit", "prompt_payment_deadlines", "retainage_limits"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.3", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
