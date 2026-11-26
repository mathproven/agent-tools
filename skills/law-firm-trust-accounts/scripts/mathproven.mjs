// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AgentInputError,
  LAW_TRUST,
  beginColumnLog,
  checkValue,
  isVerified,
  present,
  readXlsx,
  takeColumnLog,
  writeXlsx
} from "./lib/law-trust.mjs";
import "./lib/earnedFees.mjs";
import "./lib/dormantBalances.mjs";
import {
  CheckList,
  certificateText,
  certify,
  failures,
  parseCivilDate,
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

// packages/core/src/law/recordRetention.ts
var TRUST_RETENTION_START_LABELS = {
  termination: "End of the representation",
  distribution: "Final distribution of the funds or property",
  "later-of": "End of the representation or distribution of the funds or property, whichever is later",
  "earlier-of": "End of the representation or distribution of the funds or property, whichever comes first",
  "record-event": "The transaction or event the record shows",
  "fiscal-year-end": "End of the fiscal year (a rolling period before the most recent one)"
};
var READ_OCT_19 = "2026-10-19";
var READ_OCT_20 = "2026-10-20";
var CHECKED = READ_OCT_20;
function row(code, years, start, citation, sourceUrl, notes, checkedOn = READ_OCT_19) {
  return { code, years, start, citation, sourceUrl, checkedOn, notes };
}
var ROWS = [
  row("AK", 5, "termination", "Alaska Rules of Professional Conduct, Rule 1.15(a)", "https://courts.alaska.gov/rules/docs/prof.pdf", "Complete records of trust account funds and other property."),
  row("AL", 6, "termination", "Ala. Rules of Professional Conduct, Rule 1.15(a) and (e)", "https://judicial.alabama.gov/docs/library/rules/cond1_15.pdf", "Paragraph (a) covers complete records of trust account funds and other property; paragraph (e) lists the financial records kept for the same six years. Rule as amended effective February 15, 2025.", READ_OCT_20),
  row("AR", 5, "termination", "Ark. Rules of Professional Conduct, Rule 1.15(a)(3)", "https://opinions.arcourts.gov/ark/cr/en/item/1868/index.do", "Complete records of trust account funds and other property, kept five years after the end of the representation or the last contact with a prospective client. Read in the rules as the Arkansas Judiciary’s rules site prints them, current to June 12, 2025.", READ_OCT_20),
  row("AZ", 5, "termination", "Ariz. R. Sup. Ct. 42, ER 1.15(a), and Rule 43(b)(2)(A)", "https://govt.westlaw.com/azrules/Document/NB2A6AC6053CE11EEB3BAF488F1DE96F5", "Complete records of trust account funds and other property. Rule 43(b)(2)(A) keeps the complete trust account records, including those ER 1.15 requires, for the same five years after termination of the representation. Both rules effective January 1, 2024.", READ_OCT_20),
  row("CA", 5, "distribution", "Cal. Rules of Professional Conduct, rule 1.15(d)(5)", "https://www.calbar.ca.gov/Portals/0/documents/rules/Rule_1.15.pdf", "Records of all funds and property held under the rule, kept no less than five years after the final appropriate distribution. The standards printed with the rule list the records and run the same five years from the disbursement."),
  row("CO", 7, "record-event", "Colo. Rules of Professional Conduct, Rule 1.15D(a)", "https://www.coloradolegalregulation.com/PDF/Registration/Rule%201%2015A-E.pdf", "The trust account records the rule lists are kept seven years after the event they record. Rules 1.15A to 1.15E replaced Rule 1.15 in 2014."),
  row("CT", 7, "termination", "Conn. Rules of Professional Conduct, Rule 1.15(b) and (j) (2026 Practice Book)", "https://www.jud.ct.gov/Publications/PracticeBook/PB.pdf", "Paragraph (b) covers complete records of trust account funds and other property; paragraph (j) lists the financial records kept for the same seven years. Read in the official 2026 Practice Book."),
  row("DC", 5, "termination", "D.C. Rules of Professional Conduct, Rule 1.15(a)", "https://www.dcbar.org/for-lawyers/legal-ethics/rules-of-professional-conduct/client-lawyer-relationship/safekeeping-property", "Complete records of trust account funds and other property."),
  row("DE", 5, "record-event", "Del. Lawyers’ Rules of Professional Conduct, Rule 1.15(a) and (d) (order of November 18, 2025)", "https://courts.delaware.gov/forms/download.aspx?id=311788", "Paragraph (a): complete records, five years after the events they record. Paragraph (d): practice books and records five years after the year they relate to, and fiduciary records five years after the fiduciary obligation ends. Read in the amending order, effective November 20, 2025."),
  row("FL", 6, "termination", "Rules Regulating The Florida Bar, Rule 5-1.2(f)", "https://www-media.floridabar.org/uploads/2026/10/2027_04-OCT-Chapter-5-RRTFB.pdf", "The records the trust account chapter requires, kept six years after the final conclusion of each representation in which the funds or property were received."),
  row("GA", 6, "termination", "Ga. Rules of Professional Conduct, Rule 1.15(I)(a)", "https://www.gabar.org/handbook/", "Complete records of trust account funds and other property. Read in the State Bar of Georgia handbook."),
  row("HI", 6, "termination", "Haw. Rules of Professional Conduct, Rule 1.15(a)", "https://www.courts.state.hi.us/wp-content/uploads/2024/09/hrpcond_ada.htm", "Complete records of trust account funds and other property. The rule also points to the Hawai‘i Rules Governing Trust Accounting."),
  row("IA", 6, "termination", "Iowa Ct. R. 45.2(3)(a)", "https://www.legis.iowa.gov/docs/ACO/CourtRulesChapter/45.pdf", "The client trust account rules list the records kept for each client trust account, among them the receipt and disbursement journal."),
  row("ID", 5, "termination", "Idaho Rules of Professional Conduct, Rule 1.15(a)", "https://isb.idaho.gov/wp-content/uploads/IRPC-acc.pdf", "Complete records of trust account funds and other property."),
  row("IL", 7, "termination", "Ill. Rules of Professional Conduct, Rule 1.15A(a)", "https://www.illinoiscourts.gov/resources/2cb26076-f0d0-4b54-b701-69c406f04ca9/file", "For each client matter, complete records of client trust account funds and other property. Rule 1.15A lists the records."),
  row("IN", 5, "termination", "Ind. Rules of Professional Conduct, Rule 1.15(a)", "https://rules.incourts.gov/Content/prof-conduct/rule1-15/current.htm", "Complete records of trust account funds and other property."),
  row("KS", 5, "termination", "Kan. Sup. Ct. R. 240, KRPC 1.15(a)", "https://www.kscourts.gov/Rules-Orders/Rules/1-15-Client-Lawyer-Relationship-Safekeeping-Proper", "Complete records of trust account funds and other property."),
  row("KY", 5, "termination", "Ky. SCR 3.130(1.15)(a)", "https://govt.westlaw.com/kyrules/Document/N45D4E370BB6A11ECB07CABA075E1F7F9", "Complete records of trust account funds and other property. The account is kept in a bank that has agreed to notify the Kentucky Bar Association of any overdraft.", READ_OCT_20),
  row("LA", 5, "termination", "La. Rules of Professional Conduct, Rule 1.15(a)", "https://www.ladb.org/docs/Publication/ROPC/ROPC1-15.pdf", "Complete records of trust account funds and other property. Read in the rule as amended effective December 1, 2022, published by the Louisiana Attorney Disciplinary Board.", READ_OCT_20),
  row("MA", 6, "later-of", "Mass. SJC Rule 3:07, Rules of Professional Conduct, Rule 1.15(f)", "https://www.mass.gov/supreme-judicial-court-rules/rules-of-professional-conduct-rule-115-safekeeping-property", "Contemporaneous and complete records of trust property, kept six years after termination of the representation and after distribution of the property, so the table counts from whichever comes later. Rule as effective September 1, 2024.", READ_OCT_20),
  row("MD", 5, "record-event", "Md. Rules 19-301.15(a) and 19-407(d)", "https://govt.westlaw.com/mdc/Document/NE8F743B0A6F211EFB7BCDC7F1DFFAE41", "Complete records of the account funds and other property, kept at least five years after the date each record was created. Rule 19-407(d) keeps bank statements, canceled checks, deposit slips, and the records it lists for the same five years. Rule as amended effective July 1, 2025.", READ_OCT_20),
  row("ME", 8, "termination", "Me. Rules of Professional Conduct, Rule 1.15(b)(2)(iii)", "https://www.courts.maine.gov/rules/text/mr_prof_conduct_only_2023-09-28.pdf", "Complete records of all funds, securities, and other properties of a client that come into the lawyer’s possession."),
  row("MI", 5, "termination", "Mich. Rules of Professional Conduct, Rule 1.15(b)(2)", "https://www.courts.michigan.gov/siteassets/rules-instructions-administrative-orders/rules-of-professional-conduct/michigan-rules-of-professional-conduct.pdf?r=1", "Complete records of trust account funds and other property. Rules as updated with Supreme Court orders effective January 1, 2026.", READ_OCT_20),
  row("MN", 6, "termination", "Minn. Rules of Professional Conduct, Rule 1.15(h)", "https://olpr.mncourts.gov/wp-content/uploads/2026/07/MN-Rules-of-Professional-Conduct-as-of-July-1-2026.pdf", "Records of client and third-person funds and property, six years after completion of the employment they relate to. Other practice books and records: six years after the end of the taxable year."),
  row("MO", 6, "later-of", "Mo. Sup. Ct. R. 4-1.15(f)", "https://www.courts.mo.gov/courts/ClerkHandbooksP2RulesOnly.nsf/c0c6ffa99df4993f86256ba50057dcb8/14649d79be0d211b8625769d0079035c", "Complete records of client trust accounts, kept at least six years after the later of the end of the representation and the last disbursement of funds. A comment to the rule still gives five years for some bank records; paragraph (f) says six. Rule effective November 19, 2019.", READ_OCT_20),
  row("MS", 7, "termination", "Miss. Rules of Professional Conduct, Rule 1.15(a)", "https://courts.ms.gov/research/rules/msrulesofcourt/rules_of_professional_conduct.pdf", "Complete records of trust account funds and other property."),
  row("MT", 5, "termination", "Mont. Rules of Professional Conduct, Rule 1.15(a)", "https://courts.mt.gov/external/rules/mtr_prof_cond.pdf", "Complete records of trust account funds and other property. Read in the State Law Library of Montana’s copy of the rules, last amended October 29, 2020.", READ_OCT_20),
  row("NC", 6, "fiscal-year-end", "N.C. Rules of Professional Conduct, Rule 1.15-3(h)", "https://www.ncbar.gov/for-lawyers/ethics/rules-of-professional-conduct/rule-115-3-records-and-accountings/", "Records of all entrusted property are kept for at least the six years before the lawyer’s most recent fiscal year end, so the window moves forward each year. Paragraph (i) sets conditions for keeping them electronically."),
  row("ND", 6, "termination", "N.D. Rules of Professional Conduct, Rule 1.15(h)", "https://www.ndcourts.gov/legal-resources/rules/ndrprofconduct/1-15", "Records sufficient to show compliance with the rule, kept on a current basis."),
  row("NE", 5, "termination", "Neb. Ct. R. of Prof. Cond. § 3-501.15(a)", "https://supremecourt.nebraska.gov/supreme-court-rules/chapter-3-attorneys-and-practice-law/article-5-nebraska-rules-professional-conduct/%C2%A7%C2%A7-3-5011-3-50118-client-lawyer-relationship/%C2%A7-3-50115-safekeeping-property", "Complete records of trust account funds and other property."),
  row("NH", 6, "distribution", "N.H. Sup. Ct. R. 50(2)(B) and N.H. Rules of Professional Conduct, Rule 1.15(a)", "https://www.courts.nh.gov/rules-supreme-court-state-new-hampshire", "Supreme Court Rule 50(2)(B) lists the trust account records kept six years from the time of final distribution; Rule 1.15(a) keeps records of other client property six years after its final distribution. Read on the court’s rules pages, which show a rule’s text after a search.", READ_OCT_20),
  row("NJ", 7, "record-event", "N.J. RPC 1.15(a) and R. 1:21-6(c)(1)", "https://www.njcourts.gov/attorneys/rules-of-court", "Complete records of trust account funds and other property, kept seven years after the events they record. Court Rule 1:21-6(c)(1) lists the bookkeeping records kept for the same seven years. Read in the court’s Rules of Court, with amendments effective on or before September 1, 2026.", READ_OCT_20),
  row("NM", 5, "termination", "N.M. Rules of Professional Conduct, Rule 16-115(A) NMRA", "https://nmonesource.com/nmos/nmra/en/item/5699/index.do", "Complete records of trust account funds and other property, kept five years after termination of the representation. Read in the current New Mexico Rules Annotated on NMOneSource.com.", READ_OCT_20),
  row("NV", 5, "termination", "Nev. Rules of Professional Conduct, Rule 1.15(a)", "https://www.leg.state.nv.us/CourtRules/RPC.html", "Complete records of trust account funds and other property."),
  row("NY", 7, "record-event", "22 NYCRR 1200.0, Rules of Professional Conduct, Rule 1.15(d)(1)", "https://www.nycourts.gov/legacyPDFS/rules/jointappellate/NY-Rules-Prof-Conduct-1200.pdf", "The bookkeeping records the rule lists, kept seven years after the events they record. Read in the courts’ own compilation of the rules (dated January 1, 2017) and in the Department of State’s online codes and rules (marked current through May 31, 2021), which agree; both call themselves unofficial, since the official version is the printed state code.", READ_OCT_20),
  row("OH", 7, "earlier-of", "Ohio Rules of Professional Conduct, Rule 1.15(a)", "https://www.supremecourt.ohio.gov/docs/LegalResources/Rules/ProfConduct/profConductRules.pdf", "Records of trust account funds and other property; the rule lists the records kept for funds. Rules as amended effective January 1, 2026."),
  row("OK", 5, "termination", "Okla. Rules of Professional Conduct, Rule 1.15(a) (5 O.S. ch. 1, app. 3-A)", "https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=493000", "Complete records of trust account funds and other property."),
  row("OR", 5, "termination", "Or. Rules of Professional Conduct, Rule 1.15-1(a)", "https://www.osbar.org/_docs/rulesregs/orpc.pdf", "Complete records of trust account funds and other property."),
  row("PA", 5, "later-of", "Pa.R.P.C. 1.15(c) (204 Pa. Code § 81.4)", "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/204/chapter81/s1.15.html", "Complete records of the receipt, maintenance, and disposition of the funds and property; the period runs from the end of the client-lawyer or fiduciary relationship or the distribution, whichever is later. Monthly reconciliation records are kept five years too."),
  row("RI", 7, "termination", "R.I. Sup. Ct. Rules, Art. V, Rules of Professional Conduct, Rule 1.15(a)", "https://www.courts.ri.gov/Courts/SupremeCourt/Documents/Supreme-Rules-Article5.pdf", "Complete records of trust account funds and other property."),
  row("SC", 6, "termination", "S.C. Rules of Professional Conduct, Rule 1.15(a) (Rule 407, SCACR)", "https://www.sccourts.org/resources/judicial-community/court-rules/appellate/rule-407/rule-115/", "Complete records of trust account funds and other property. Rule 417, SCACR (financial recordkeeping) lists the records and keeps them six years after termination as well."),
  row("SD", 5, "termination", "S.D. Rules of Professional Conduct, Rule 1.15(a) (SDCL 16-18-A)", "https://sdlegislature.gov/api/Statutes/16-18-A.html", "Complete records of trust account funds and other property. Read in the rules as the legislature’s code site prints them, under SDCL 16-18-A.", READ_OCT_20),
  row("TN", 5, "termination", "Tenn. Sup. Ct. R. 8, RPC 1.15(b)", "https://www.tncourts.gov/rules/supreme-court/8", "Complete records of trust funds and other property. Supreme Court Rule 9, section 35.1(a)(2) keeps the account records (checkbooks, ledgers, journals, closing statements, and others) at least five years after final disposition of the underlying matter.", READ_OCT_20),
  row("TX", 5, "termination", "Tex. Disciplinary Rules of Professional Conduct, Rule 1.15(a)", "https://www.txcourts.gov/media/1459244/texas-disciplinary-rules-of-professional-conduct-pdf.pdf", "Complete records of trust account funds and other property. Rules effective March 7, 2025, in which the safekeeping rule is numbered 1.15."),
  row("UT", 5, "termination", "Utah Sup. Ct. Rules of Professional Practice, Rule 3-1.15(a)", "https://legacy.utcourts.gov/rules/view.php?type=ucja&rule=13-1.15", "Complete records of trust account funds and other property. The rule was formerly Code of Judicial Administration rule 13-1.15."),
  row("VA", 5, "termination", "Rules of Sup. Ct. of Va., Part 6, § II, Rule 1.15(c)(4)", "https://vsb.org/Site/Site/news/rules-news/20200109-rpc-1.15.aspx", "All records the rule covers, kept at least five calendar years after termination of the representation or fiduciary responsibility. Read in the amended rule the Virginia State Bar published on its adoption (effective March 15, 2020); the bar’s notice of the next amendment (effective February 20, 2022) describes it as changing comment 1.", READ_OCT_20),
  row("VT", 6, "termination", "Vt. Rules of Professional Conduct, Rule 1.15(a)(1)", "https://www.vtcourts.gov/sites/default/files/documents/VermontRulesofProfessionalConduct.pdf", "Complete records of trust account funds and other property. Rules 1.15A and 1.15B set out the trust accounting system the funds are kept under.", READ_OCT_20),
  row("WA", 7, "record-event", "Washington RPC 1.15B(a)", "https://www.courts.wa.gov/court_rules/pdf/RPC/GA_RPC_01_15b_00.pdf", "Current trust account records, in electronic or paper form, kept for at least seven years after the events they record. The rule lists the records required."),
  row("WI", 6, "termination", "Wis. SCR 20:1.15(g)(1)", "https://www.wicourts.gov/sc/rules/chap20a.pdf", "Complete records of trust account funds, deposits, disbursements, and other trust property, with electronic records backed up. Fiduciary account records follow their own six-year terms."),
  row("WV", 5, "termination", "W. Va. Rules of Professional Conduct, Rule 1.15(a)", "https://www.courtswv.gov/legal-community/court-rules/west-virginia-rules-professional-conduct", "Complete records of trust account funds and other property."),
  row("WY", 5, "termination", "Wyo. Rules of Professional Conduct for Attorneys at Law, Rule 1.15(g)", "https://www.wyocourts.gov/app/uploads/2026/06/WY-Rules-Prof-Conduct-Eff.-9-21-26.pdf", "The trust account records the rule lists, in the version effective September 21, 2026.")
];
var NOT_READ = "Not read from the official rule yet.";
var GAP_REASONS = {};
var OFFICIAL_HOSTS = ["coloradolegalregulation.com", "dcbar.org", "floridabar.org", "gabar.org", "govt.westlaw.com", "ladb.org", "nmonesource.com", "oscn.net", "osbar.org", "sccourts.org", "vsb.org"];
var TRUST_RECORD_RETENTION = {
  id: "trust-record-retention",
  label: "lawyer trust account record retention periods",
  checkedOn: CHECKED,
  members: REF_US_STATES_DC,
  rows: ROWS,
  notCovered: notCoveredFor(ROWS, GAP_REASONS),
  officialHosts: OFFICIAL_HOSTS
};
function notCoveredFor(rows, reasons) {
  const have = new Set(rows.map((r) => r.code));
  return REF_US_STATES_DC.filter((m) => !have.has(m.code)).map((m) => ({ code: m.code, reason: reasons[m.code] ?? NOT_READ }));
}
var KNOWN_STARTS = new Set(Object.keys(TRUST_RETENTION_START_LABELS));
function checkTrustRetentionTable(table = TRUST_RECORD_RETENTION) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badYears = rows.filter((r) => !Number.isSafeInteger(r.years) || r.years < 1 || r.years > 10).map((r) => `${r.code} (${String(r.years)})`);
  checks.that("retention-years", "Every period is a whole number of years from 1 to 10", badYears.length === 0, `not a whole number of years from 1 to 10: ${badYears.join(", ")}`);
  const badStart = rows.filter((r) => !KNOWN_STARTS.has(r.start) || typeof r.notes !== "string" || r.notes.trim().length < 10 || r.notes.length > 400).map((r) => r.code);
  checks.that("retention-start", "Every row says what its period runs from and carries a short note", badStart.length === 0, `start or note missing or too long: ${badStart.join(", ")}`);
  return checks.all;
}
var START_PHRASES = {
  termination: "the end of the representation",
  distribution: "the final distribution of the funds or property",
  "later-of": "the later of the end of the representation and the distribution of the funds or property",
  "earlier-of": "the earlier of the end of the representation and the distribution of the funds or property",
  "record-event": "the transaction or event the record shows",
  "fiscal-year-end": "the end of the most recent fiscal year, counting back over a rolling period"
};
var START_ORDER = Object.keys(TRUST_RETENTION_START_LABELS);
var NAME_AT_MOST = 5;
var ALL_MEMBERS = "(the 50 states and the District of Columbia)";
var yearsText = (n) => `${n} ${n === 1 ? "year" : "years"}`;
var groupSize = (groups) => groups.reduce((n, g) => n + g.codes.length, 0);
var startPhrase = (start) => START_PHRASES[start] ?? `"${start}"`;
function joinAnd(parts) {
  return parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
function joinSemi(parts) {
  return parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}
function figuresByTally(table) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const years = rows.map((r) => ({ code: r.code, value: r.years }));
  const tally = refTally(years);
  const most = tally[0]?.codes.length ?? 0;
  const top = tally.filter((g) => g.codes.length === most);
  const others = tally.filter((g) => g.codes.length !== most).sort((a, b) => a.value - b.value);
  let ext = null;
  try {
    ext = refExtremes(years);
  } catch {
    ext = null;
  }
  const rank = (s) => {
    const i = START_ORDER.indexOf(s);
    return i < 0 ? START_ORDER.length : i;
  };
  const starts = refTally(rows.map((r) => ({ code: r.code, value: String(r.start) }))).sort((a, b) => b.codes.length - a.codes.length || rank(a.value) - rank(b.value)).map((g) => ({ start: g.value, codes: g.codes }));
  return {
    members: table.members.length,
    withRow: rows.length,
    top,
    others,
    othersCount: rows.length - groupSize(top),
    shortest: ext ? { value: ext.min, codes: ext.minCodes } : null,
    longest: ext ? { value: ext.max, codes: ext.maxCodes } : null,
    starts,
    otherStartsCount: rows.length - (starts[0]?.codes.length ?? 0)
  };
}
function figuresByRuns(table) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const runs = [];
  for (const r of [...rows].sort((a, b) => a.years - b.years)) {
    const last = runs[runs.length - 1];
    if (last && last.value === r.years) last.codes.push(r.code);
    else runs.push({ value: r.years, codes: [r.code] });
  }
  let most = 0;
  for (const g of runs) if (g.codes.length > most) most = g.codes.length;
  const top = runs.filter((g) => g.codes.length === most);
  const others = runs.filter((g) => g.codes.length !== most);
  const starts = START_ORDER.map((s) => ({ start: s, codes: rows.filter((r) => r.start === s).map((r) => r.code) })).filter((g) => g.codes.length > 0).sort((a, b) => b.codes.length - a.codes.length);
  return {
    members: table.members.length,
    withRow: table.members.filter((m) => rows.some((r) => r.code === m.code)).length,
    top,
    others,
    othersCount: groupSize(others),
    shortest: runs[0] ?? null,
    longest: runs[runs.length - 1] ?? null,
    starts,
    otherStartsCount: groupSize(starts.slice(1))
  };
}
function retentionSentences(id, f, members) {
  if (f.withRow === 0) return [{ id: `${id}-none`, text: `None of the ${f.members} jurisdictions ${ALL_MEMBERS} has a row yet, so there is nothing to count.` }];
  const n = f.withRow;
  const named = (codes) => codes.length <= NAME_AT_MOST ? ` (${refNameList(codes, members)})` : "";
  const who = (codes) => codes.length <= NAME_AT_MOST ? refNameList(codes, members) : `${codes.length} jurisdictions`;
  const sets = (g) => `${g.codes.length} ${g.codes.length === 1 ? "sets" : "set"} ${yearsText(g.value)}${named(g.codes)}`;
  const out = [];
  const scope = n === f.members ? `All ${n} jurisdictions ${ALL_MEMBERS} have a row` : `${n} of the ${f.members} jurisdictions ${ALL_MEMBERS} ${n === 1 ? "has" : "have"} a row`;
  const [only] = f.top;
  const most = f.top.length === 1 && only ? `of those ${n}, ${only.codes.length} ${only.codes.length === 1 ? "sets" : "set"} a retention period of ${yearsText(only.value)}${named(only.codes)}, the most common figure` : `of those ${n}, the most common figures are tied: ${joinAnd(f.top.map(sets))}`;
  out.push({ id: `${id}-most-common`, text: `${scope}; ${most}.` });
  const [oneOther] = f.others;
  if (oneOther) {
    out.push({ id: `${id}-other-periods`, text: f.othersCount === 1 ? `The one other row sets ${yearsText(oneOther.value)}${named(oneOther.codes)}.` : `Of the other ${f.othersCount}, ${joinAnd(f.others.map(sets))}.` });
  }
  if (f.shortest && f.longest) {
    out.push({
      id: `${id}-range`,
      text: f.shortest.value === f.longest.value ? `Every row sets the same retention period, ${yearsText(f.shortest.value)}.` : `The shortest retention period in a row is ${yearsText(f.shortest.value)} (${who(f.shortest.codes)}) and the longest is ${yearsText(f.longest.value)} (${who(f.longest.codes)}).`
    });
  }
  const [first, ...rest] = f.starts;
  if (first) {
    const k = first.codes.length;
    const subject = k === n ? `all ${n}` : `${k}`;
    out.push({ id: `${id}-start-common`, text: `Of the ${n} with a row, ${subject} ${k === 1 ? "counts" : "count"} the period from ${startPhrase(first.start)}${k === n ? "" : named(first.codes)}.` });
  }
  if (rest.length > 0) {
    const parts = rest.map((g) => `${startPhrase(g.start)} (${who(g.codes)})`);
    out.push({ id: `${id}-start-other`, text: f.otherStartsCount === 1 ? `The one other row counts it from ${parts[0]}.` : `The other ${f.otherStartsCount} count it from: ${joinSemi(parts)}.` });
  }
  return out;
}
var FINDING_CHECK_LABELS = {
  none: "No rows to count, confirmed a second way",
  "most-common": "Jurisdictions with a row and the most common period, counted a second way",
  "other-periods": "The other periods, counted a second way",
  range: "The shortest and longest periods, found a second way",
  "start-common": "The largest group by what the period runs from, counted a second way",
  "start-other": "The other groups by what the period runs from, counted a second way"
};
function trustRecordRetentionFindings(table = TRUST_RECORD_RETENTION) {
  const findings = retentionSentences(table.id, figuresByTally(table), table.members);
  return { findings, checks: verifyTrustRecordRetentionFindings(findings, table) };
}
function verifyTrustRecordRetentionFindings(findings, table = TRUST_RECORD_RETENTION) {
  const checks = new CheckList();
  const id = table.id;
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const gaps = Array.isArray(table.notCovered) ? table.notCovered.length : 0;
  const second = figuresByRuns(table);
  checks.that(
    `${id}-findings-coverage`,
    `Each row is a different jurisdiction, and with the not-covered list they make all ${table.members.length}`,
    rows.length === second.withRow && second.withRow + gaps === table.members.length,
    `${rows.length} rows for ${second.withRow} jurisdictions, and ${gaps} not covered, of ${table.members.length}`
  );
  const expected = retentionSentences(id, second, table.members);
  const none = "(no such sentence)";
  for (const fid of [.../* @__PURE__ */ new Set([...expected.map((f) => f.id), ...findings.map((f) => f.id)])]) {
    const label = FINDING_CHECK_LABELS[fid.startsWith(`${id}-`) ? fid.slice(id.length + 1) : fid] ?? `A sentence the second count does not make (${fid})`;
    checks.equal(fid, label, expected.find((f) => f.id === fid)?.text ?? none, findings.find((f) => f.id === fid)?.text ?? none);
  }
  checks.equal(`${id}-years-add-up`, "The groups by period add up to the jurisdictions with a row", second.withRow, groupSize([...second.top, ...second.others]));
  checks.equal(`${id}-starts-add-up`, "The groups by what the period runs from add up to the jurisdictions with a row", second.withRow, groupSize(second.starts));
  return checks.all;
}

// packages/agents/src/tables/index.ts
var MEMBER_SHAPE = /^(?:[A-Za-z]{1,3}|\d{4}-[A-Za-z]{1,3})$/;
var DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
var SITE = "https://mathproven.com";
var STATES_HELP = /* @__PURE__ */ (() => "a state's two-letter postal code (OH, NY), or DC for the District of Columbia")();
var NOT_ZERO = /* @__PURE__ */ (() => 'Missing means the table has no row for it, not a figure of zero or "none".')();
var yearsText2 = /* @__PURE__ */ (() => ((n) => `${n} ${n === 1 ? "year" : "years"}`))();
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
var trustRetention = /* @__PURE__ */ (() => ({
  id: "trust-record-retention-by-state",
  page: "law-trust/trust-record-retention-by-state",
  section: "law-trust",
  title: "Lawyer trust account record retention periods by state",
  pageTitle: "Trust Account Record Retention by State: Years and Court Rule Links",
  description: "How many years each jurisdiction's own court rule (its safekeeping-property rule or trust account record-keeping rule) says complete lawyer trust account (IOLTA) records are kept, and what day the period runs from (the end of the representation, the final distribution, the later or earlier of the two, the transaction itself, or the fiscal year end). Use it when someone asks how long a law firm keeps client trust account records in a state.",
  question: "How many years does Pennsylvania's rule say lawyer trust account records are kept?",
  subject: "lawyer trust account record retention periods by state",
  notAdvice: "Mathproven gives periods as each cited rule states them. Nothing here says which records a rule covers in a particular case or what to keep or discard. Mathproven is not affiliated with any court or bar whose rules are cited here.",
  memberNoun: { one: "jurisdiction", many: "jurisdictions" },
  memberHelp: STATES_HELP,
  members: TRUST_RECORD_RETENTION.members,
  table: TRUST_RECORD_RETENTION,
  rows: TRUST_RECORD_RETENTION.rows,
  notCovered: TRUST_RECORD_RETENTION.notCovered,
  check: once(() => checkTrustRetentionTable()),
  findings: once(() => trustRecordRetentionFindings()),
  codeOf: (r) => r.code,
  sources: (r) => [{ citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn }],
  rowText: (r) => joinText([`${yearsText2(r.years)}`, `Period runs from: ${TRUST_RETENTION_START_LABELS[r.start]}`, `Notes (our summary): ${r.notes}`]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var AGENT_TABLES = [trustRetention];
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

// mp-entry:mp-entry:main
var pool = [...LAW_TRUST, ...lookupEntries()];
var names = ["three_way_trust_reconciliation", "client_trust_ledger_card", "trust_receipts_disbursements_journal", "trust_negative_balance_scan", "trust_ledgers_from_bank_statement", "earned_fees_left_in_trust", "dormant_trust_balance_report", "three_way_reconciliation_template", "trust_record_retention_by_state"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.4", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
