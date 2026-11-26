// Mathproven agent tools 0.1.3. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AgentInputError,
  CRYPTO,
  CheckList,
  assertCents,
  beginColumnLog,
  certificateText,
  certify,
  checkValue,
  failures,
  formatUSD,
  isVerified,
  parseCivilDate,
  passedAll,
  present,
  readXlsx,
  takeColumnLog,
  writeXlsx
} from "./lib/crypto.mjs";

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

// packages/core/src/construction/percent.ts
function assertBp(bp) {
  if (!Number.isSafeInteger(bp)) throw new Error("A percent must be a whole number of basis points");
}
function percentTextFromBp(bp) {
  assertBp(bp);
  if (bp < 0) throw new Error("A percent rate cannot be negative");
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

// packages/core/src/crypto/gainsThresholds.ts
var CX_GAINS_STATUSES = [
  { code: "S", name: "Single", sourceName: "All Other Individuals" },
  { code: "MFJ", name: "Married filing jointly or surviving spouse", sourceName: "Married Individuals Filing Joint Returns and Surviving Spouse" },
  { code: "MFS", name: "Married filing separately", sourceName: "Married Individuals Filing Separate Returns" },
  { code: "HOH", name: "Head of household", sourceName: "Heads of Household" }
];
var CX_GAINS_YEARS = [2025, 2026, 2027];
var CX_NIIT_RATE_BP = 380;
function cxGainsCode(taxYear, status) {
  return `${taxYear}-${status}`;
}
var CX_GAINS_MEMBERS = CX_GAINS_YEARS.flatMap((year) => CX_GAINS_STATUSES.map((s) => ({ code: cxGainsCode(year, s.code), name: `${year}, ${s.name.toLowerCase()}` })));
function cxGainsStatusName(status) {
  return CX_GAINS_STATUSES.find((s) => s.code === status)?.name ?? status;
}
function cxGainsRateText(rateBp) {
  return `${percentTextFromBp(rateBp)}%`;
}
var CHECKED = "2026-10-19";
var CHECKED_2027 = "2026-11-12";
var RP_BY_YEAR = {
  2025: { citation: "Rev. Proc. 2024-40, § 2.03", sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf", checkedOn: CHECKED },
  2026: { citation: "Rev. Proc. 2025-32, § 4.03", sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf", checkedOn: CHECKED },
  2027: { citation: "Rev. Proc. 2026-35, § 3.03", sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-26-35.pdf", checkedOn: CHECKED_2027 }
};
var USC = "https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/";
var NIIT_URL = `${USC}USCODE-2024-title26-subtitleA-chap2A-sec1411.htm`;
var NIIT_PARAGRAPH = { MFJ: "(b)(1)", MFS: "(b)(2)", S: "(b)(3)", HOH: "(b)(3)" };
var CX_GAINS_HOLDING_SOURCE = {
  citation: "26 U.S.C. § 1222(3)",
  sourceUrl: `${USC}USCODE-2024-title26-subtitleA-chap1-subchapP-partIII-sec1222.htm`,
  checkedOn: CHECKED
};
var CX_GAINS_METHOD_SOURCE = {
  citation: "26 U.S.C. § 1(h)(1)(B)-(D) and § 1(j)(5)",
  sourceUrl: `${USC}USCODE-2024-title26-subtitleA-chap1-subchapA-partI-sec1.htm`,
  checkedOn: CHECKED
};
var usd = (dollars) => assertCents(dollars * 100, "table amount");
function row(taxYear, status, zeroMaxDollars, fifteenMaxDollars, niitDollars, notes, sourceStatus) {
  const source = RP_BY_YEAR[taxYear];
  return {
    code: cxGainsCode(taxYear, status),
    taxYear,
    status,
    sourceStatus: sourceStatus ?? CX_GAINS_STATUSES.find((s) => s.code === status).sourceName,
    zeroMax: usd(zeroMaxDollars),
    fifteenMax: usd(fifteenMaxDollars),
    niitThreshold: usd(niitDollars),
    niitSource: { citation: `26 U.S.C. § 1411(a)(1), ${NIIT_PARAGRAPH[status]}`, sourceUrl: NIIT_URL, checkedOn: CHECKED },
    citation: source.citation,
    sourceUrl: source.sourceUrl,
    checkedOn: source.checkedOn,
    notes
  };
}
var SINGLE = "The revenue procedure lists this status as all other individuals (other than estates and trusts). The net investment income tax threshold is a fixed amount in the statute, the same as for a head of household.";
var JOINT = "The revenue procedure lists joint returns and surviving spouses together. The net investment income tax threshold is a fixed amount in the statute, not adjusted for inflation.";
var SEPARATE = "The 0% line is the same as for single filers. The net investment income tax threshold is half the joint amount, as the statute sets it.";
var HEAD = "Head of household as section 2(b) of the Code defines it. The net investment income tax threshold is a fixed amount in the statute, the same as for single filers.";
var ROWS = [
  row(2025, "S", 48350, 533400, 2e5, SINGLE),
  row(2025, "MFJ", 96700, 600050, 25e4, JOINT),
  row(2025, "MFS", 48350, 3e5, 125e3, SEPARATE),
  row(2025, "HOH", 64750, 566700, 2e5, HEAD),
  row(2026, "S", 49450, 545500, 2e5, SINGLE),
  row(2026, "MFJ", 98900, 613700, 25e4, JOINT),
  row(2026, "MFS", 49450, 306850, 125e3, SEPARATE),
  row(2026, "HOH", 66200, 579600, 2e5, HEAD),
  // Rev. Proc. 2026-35 § 3.03 (page 7 of the PDF), read 2026-11-12. It names heads of household "Heads of Households".
  row(2027, "S", 51050, 563200, 2e5, SINGLE),
  row(2027, "MFJ", 102100, 633600, 25e4, JOINT),
  row(2027, "MFS", 51050, 316800, 125e3, SEPARATE),
  row(2027, "HOH", 68350, 598400, 2e5, HEAD, "Heads of Households")
];
var CX_GAINS_THRESHOLDS = {
  id: "long-term-capital-gains-thresholds",
  label: "federal long-term capital gains rate thresholds",
  checkedOn: CHECKED_2027,
  members: CX_GAINS_MEMBERS,
  rows: ROWS,
  notCovered: []
};
var isAmount = (c) => typeof c === "number" && Number.isSafeInteger(c);
function cxCheckGainsTable(table = CX_GAINS_THRESHOLDS) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, (r) => r.code, (r) => [r.niitSource]));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badKeys = rows.filter((r) => r.code !== cxGainsCode(r.taxYear, r.status)).map((r) => r.code);
  checks.that("cx-gains-keys", "Each row's code is its tax year and filing status", badKeys.length === 0, `code does not match its year and status: ${badKeys.join(", ")}`);
  const badAmounts = rows.filter((r) => ![r.zeroMax, r.fifteenMax, r.niitThreshold].every((c) => isAmount(c) && c > 0 && c % 100 === 0) || !(r.zeroMax < r.fifteenMax)).map((r) => r.code);
  checks.that("cx-gains-amounts", "Every amount is whole dollars and more than zero, and each 0% line is below its 15% line", badAmounts.length === 0, `check the amounts in ${badAmounts.join(", ")}`);
  const years = [...new Set(rows.map((r) => r.taxYear))].sort((a, b) => a - b);
  const get = (year, status) => rows.find((r) => r.taxYear === year && r.status === status);
  const notHalf = [];
  const niitOff = [];
  for (const year of years) {
    const joint = get(year, "MFJ");
    for (const status of ["S", "MFS"]) {
      const r = get(year, status);
      if (joint && r && r.zeroMax * 2 !== joint.zeroMax) notHalf.push(cxGainsCode(year, status));
    }
    const single = get(year, "S");
    const head = get(year, "HOH");
    const separate = get(year, "MFS");
    if (single && head && single.niitThreshold !== head.niitThreshold) niitOff.push(`${year}: single and head of household differ`);
    if (joint && separate && separate.niitThreshold * 2 !== joint.niitThreshold) niitOff.push(`${year}: separate is not half of joint`);
  }
  for (const s of CX_GAINS_STATUSES) {
    const amounts = new Set(rows.filter((r) => r.status === s.code).map((r) => r.niitThreshold));
    if (amounts.size > 1) niitOff.push(`${s.name.toLowerCase()}: not the same in every year`);
  }
  checks.that("cx-gains-half", "The single and married-filing-separately 0% lines are half the joint 0% line, as section 1(j)(5) sets them", notHalf.length === 0, `not half the joint line: ${notHalf.join(", ")}`);
  checks.that(
    "cx-gains-niit",
    "The net investment income tax thresholds are the fixed amounts the statute sets: the same every year, single equal to head of household, separate returns half of joint",
    niitOff.length === 0,
    niitOff.join("; ")
  );
  const lower = [];
  for (const r of rows) {
    const earlier = rows.find((o) => o.status === r.status && o.taxYear === r.taxYear - 1);
    if (earlier && (r.zeroMax < earlier.zeroMax || r.fifteenMax < earlier.fifteenMax)) lower.push(r.code);
  }
  checks.that("cx-gains-indexed", "No line is lower in a later tax year than in the year before", lower.length === 0, `lower than the year before: ${lower.join(", ")}`, "warning");
  return checks.all;
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
var GAINS_YEARS_TEXT = /* @__PURE__ */ (() => `${CX_GAINS_YEARS.slice(0, -1).join(", ")} and ${CX_GAINS_YEARS[CX_GAINS_YEARS.length - 1]}`)();
var gains = /* @__PURE__ */ (() => ({
  id: "capital-gains-rate-thresholds",
  page: "crypto/capital-gains-rate-thresholds",
  section: "crypto",
  title: "Long-term capital gains rate thresholds (0%, 15%, 20%) by filing status",
  pageTitle: "Long-Term Capital Gains Brackets 2025 to 2027: 0%, 15%, 20% Thresholds",
  description: `The federal taxable income lines where the 0%, 15% and 20% rates on long-term capital gains (crypto held more than one year included) begin, by filing status, for tax years ${GAINS_YEARS_TEXT}, each read from the IRS revenue procedure, with the net investment income tax threshold for the status. Use it when someone asks the long-term capital gains brackets or the 0% gains limit for a tax year and filing status.`,
  question: "What are the 2026 long-term capital gains brackets for married filing jointly?",
  notAdvice: "Mathproven gives thresholds only; it does not say what to report or file. Mathproven is not affiliated with the IRS or any agency whose documents are cited here.",
  memberNoun: { one: "tax year and filing status", many: "tax years and filing statuses" },
  memberHelp: `a filing status: S (single), MFJ (married filing jointly or surviving spouse), MFS (married filing separately) or HOH (head of household), with the tax year taken from the date; or a tax year and status together, such as 2026-MFJ (tax years ${GAINS_YEARS_TEXT})`,
  members: CX_GAINS_THRESHOLDS.members,
  table: CX_GAINS_THRESHOLDS,
  rows: CX_GAINS_THRESHOLDS.rows,
  notCovered: CX_GAINS_THRESHOLDS.notCovered,
  check: once(() => cxCheckGainsTable()),
  codeOf: (r) => r.code,
  sources: (r) => unique([r, r.niitSource, CX_GAINS_HOLDING_SOURCE]),
  rowText: (r) => joinText([
    `Tax year ${r.taxYear}, ${cxGainsStatusName(r.status).toLowerCase()} (the revenue procedure's "${r.sourceStatus}")`,
    `0% rate on taxable income up to ${formatUSD(r.zeroMax)}; 15% rate over ${formatUSD(r.zeroMax)} up to ${formatUSD(r.fifteenMax)}; 20% rate over ${formatUSD(r.fifteenMax)}`,
    `Net investment income tax (${cxGainsRateText(CX_NIIT_RATE_BP)}) threshold: ${formatUSD(r.niitThreshold)}`,
    r.notes && `Notes (our summary): ${r.notes}`
  ]),
  dateRule: `A date picks the tax year (its calendar year) when the member is a filing status alone. The table holds tax years ${GAINS_YEARS_TEXT}; any other year is not covered.`,
  tableNotes: ["The 0% rate covers taxable income up to the first figure, the 15% rate the taxable income above it up to the second figure, and the 20% rate the taxable income above that. Long-term means held more than one year."],
  resolve(raw, date) {
    const text = raw.trim().toUpperCase();
    const m = /^(?:(\d{4})-)?([A-Z]{1,3})$/.exec(text);
    const status = m ? CX_GAINS_STATUSES.find((s) => s.code === m[2]) : void 0;
    if (!m || !status) throw new AgentInputError(`That is not a member of this table. Give ${this.memberHelp}.`);
    const year = m[1] ? Number(m[1]) : Number(date.slice(0, 4));
    if (year < 1900 || year > 2200) throw new AgentInputError(`The tax year must be a year from 1900 to 2200. Give ${this.memberHelp}.`);
    return { code: cxGainsCode(year, status.code), name: `${year}, ${status.name.toLowerCase()}` };
  },
  pick(code, date) {
    const row2 = this.rows.find((r) => r.code === code);
    const year = Number(code.slice(0, 4));
    if (!row2) return { rows: [], notCovered: `The table holds tax years ${GAINS_YEARS_TEXT} only; tax year ${year} has no row (other years, and estates and trusts, are not part of this table).`, notes: [] };
    const notes = [];
    if (Number(date.slice(0, 4)) !== year) notes.push(`The row is for tax year ${year}, as the member names it; the date ${date} falls in ${date.slice(0, 4)}.`);
    else notes.push(`${date} falls in tax year ${year}, the year this row is for.`);
    return { rows: [row2], notes };
  }
}))();
var AGENT_TABLES = [gains];
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
var pool = [...CRYPTO, ...lookupEntries()];
var names = ["crypto_capital_gains_worksheet", "crypto_proceeds_tie_out", "crypto_holding_period_split", "crypto_average_cost_per_coin", "crypto_trade_log_template", "capital_gains_rate_thresholds"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.3", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
