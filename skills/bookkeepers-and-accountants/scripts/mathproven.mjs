// Mathproven agent tools 0.1.4. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  AgentInputError,
  BOOKKEEPING,
  beginColumnLog,
  checkValue,
  isVerified,
  parseCsv,
  present,
  takeColumnLog,
  toCsv
} from "./lib/bookkeeping.mjs";
import {
  DORMANCY_TABLE,
  REF_US_STATES_DC,
  checkDormancyTable,
  daysInMonth,
  dormancyFindings,
  dormancyMoreSources,
  findDormancyRow,
  refAddDays,
  refAddMonths,
  refCheckTable,
  refIsDay
} from "./lib/dormancyPeriods.mjs";
import "./lib/recDifference.mjs";
import {
  readXlsx,
  writeXlsx
} from "./lib/fflate.mjs";
import "./lib/bankRec.mjs";
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

// packages/core/src/bookkeeping/noticeWindows.ts
var NOV12 = "2026-11-12";
var d = (n) => ({ n, unit: "days" });
var mo = (n) => ({ n, unit: "months" });
var win = (earliest, latest, text) => ({ earliest, latest, text });
var between = (most, least) => win(d(most), d(least), `Not more than ${most} days and not less than ${least} days before filing the report.`);
var noMoreThan = (most) => win(d(most), null, `Not more than ${most} days before filing the report; no fewest number of days is set.`);
var atLeast = (least) => win(null, d(least), `At least ${least} days before filing the report; no earliest day is set.`);
var SAME = "The general rule; the source sets no separate notice rule for uncashed vendor or payroll checks.";
function row(code, r) {
  const out = {
    code,
    citation: r.citation,
    sourceUrl: r.sourceUrl,
    checkedOn: NOV12,
    span: r.span,
    noWindow: r.noWindow ?? "",
    amountCents: r.amountCents,
    amountAbove: r.amountAbove ?? false,
    amountText: r.amountText,
    mail: r.mail,
    checkRule: r.checkRule ?? SAME,
    notes: r.notes ?? ""
  };
  if (r.alsoSource) out.alsoSource = r.alsoSource;
  return out;
}
var also = (citation, sourceUrl) => ({ citation, sourceUrl, checkedOn: NOV12 });
var usd = (dollars) => dollars * 100;
var FIRST = "First-class mail.";
var FIRST_AND_EMAIL = "First-class mail; where the owner has agreed to e-mail, by e-mail as well.";
var WRITTEN = "Written notice; the section names no class of mail.";
var NOTICE_ROWS = [
  row("AK", {
    citation: "AS 34.45.280(e), (f)",
    sourceUrl: "https://www.akleg.gov/basis/statutes.asp?media=print&secStart=34.45.280&secEnd=34.45.280",
    span: noMoreThan(120),
    amountCents: usd(100),
    amountText: "$100 or more.",
    mail: WRITTEN,
    notes: "Subsection (f) applies the notice to a holder of property with a total value over $750 presumed abandoned in the year before June 30."
  }),
  row("AL", {
    citation: "Ala. Code § 35-12-76(d)",
    sourceUrl: "https://treasury.alabama.gov/alabama-treasury-law/unclaimed-property-law/",
    span: atLeast(60),
    amountCents: usd(50),
    amountText: "$50, or a greater amount set by rule (the rule was not read).",
    mail: WRITTEN,
    notes: "Read in the act’s text as the State Treasurer publishes it."
  }),
  row("AR", {
    citation: "Arkansas Unclaimed Property Reporting Booklet (Auditor of State, revised July 2026), due diligence",
    sourceUrl: "https://auditor.ar.gov/wp-content/uploads/UCP_Reporting_Booklet_Revised_JULY_2026.pdf",
    span: win(null, d(90), "Owners have at least 90 days to answer before the report is filed; no earliest day is set."),
    amountCents: usd(50),
    amountAbove: true,
    amountText: "Greater than $50.",
    mail: "Written notice to the last known address; the booklet names no class of mail.",
    notes: "Read in the Auditor of State’s booklet; the statute itself was not read here."
  }),
  row("AZ", {
    citation: "A.R.S. § 44-307(E)",
    sourceUrl: "https://www.azleg.gov/ars/44/00307.htm",
    span: null,
    noWindow: "The section sets the notice “prior to” the 120th day before filing, with no earliest day; this table does not turn that wording into a day.",
    amountCents: usd(50),
    amountText: "At least $50.",
    mail: WRITTEN
  }),
  row("CA", {
    citation: "Cal. Code Civ. Proc. § 1520(b) (State Controller, Unclaimed Property Law and Regulations, February 2026)",
    sourceUrl: "https://www.sco.ca.gov/Files-UPD/guide_upd_updlaw.pdf",
    span: null,
    noWindow: "The notice is counted back 6 to 12 months from the time the property becomes reportable, not from the report date.",
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "By mail, or electronically where the owner has agreed; no class of mail is named.",
    notes: "Read in the State Controller’s published compilation of the law; the Legislature’s code site turned automated reading away."
  }),
  row("CO", {
    citation: "C.R.S. 38-13-501(1), (2)",
    sourceUrl: "https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-38.pdf",
    span: between(180, 60),
    amountCents: usd(25),
    amountText: "$25 or more.",
    mail: "First-class mail; where the owner has agreed to e-mail, e-mail may take its place unless it could not be delivered.",
    notes: "Read in the 2024 edition of the Colorado Revised Statutes on the Legislature’s site. House Bill 25-1224 (signed June 4, 2025), as introduced, adds only a subsection (3) on preneed contracts and leaves (1) and (2) as read; the 2025 edition did not open."
  }),
  row("CT", {
    citation: "Conn. Gen. Stat. § 3-65a(a)",
    sourceUrl: "https://www.cga.ct.gov/current/pub/chap_032.htm",
    span: null,
    noWindow: "The notice is counted from the date the presumption of abandonment takes effect, not from the report date.",
    amountCents: null,
    amountText: "The section names no amount.",
    mail: "First-class mail at a minimum; by e-mail as well where the owner has agreed.",
    checkRule: "Wages (§ 3-60b): at least 180 days before the presumption takes effect. Other property, which takes in a vendor check: within one year before it."
  }),
  row("DC", {
    citation: "D.C. Code § 41-155.01(a), (b)",
    sourceUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/41-155.01",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("DE", {
    citation: "12 Del. C. § 1148(a)",
    sourceUrl: "https://delcode.delaware.gov/title12/c011/sc02/index.html",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST,
    checkRule: "The general rule. A security needs a notice whatever its value; a check does not fall under that."
  }),
  row("FL", {
    citation: "Fla. Stat. § 717.117(2), (3)",
    sourceUrl: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0717/0717.html",
    span: between(180, 90),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail, or e-mail where the owner chose it. Over $1,000: a second notice by certified mail, return receipt requested, at least 60 days before filing."
  }),
  row("GA", {
    citation: "Georgia Unclaimed Property Annual Filing Report, Report Year 2026 (Department of Revenue), notice to owners",
    sourceUrl: "https://dor.georgia.gov/document/document/holder-annual-filing-report-information/download",
    span: null,
    noWindow: "The guide counts 60 to 120 days back from the day the property is remitted to the state, not from the report date.",
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "From July 1, 2026: first-class mail from $50 to $10,000, certified mail over $10,000, and e-mail as well where the owner has agreed.",
    notes: "Read in the Department of Revenue’s guide; the statute’s official text is on a commercial publisher’s site and was not read here."
  }),
  row("HI", {
    citation: "HRS § 523A-8(e)",
    sourceUrl: "https://data.capitol.hawaii.gov/hrscurrent/Vol12_Ch0501-0588/HRS0523A/HRS_0523A-0008.htm",
    span: win(mo(6), null, "Not more than six months before filing the report; no fewest number of days is set."),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  }),
  row("IA", {
    citation: "Iowa Code § 556.11(5)",
    sourceUrl: "https://www.legis.iowa.gov/docs/code/556.pdf",
    span: null,
    noWindow: "The section asks for contact before the annual report is filed and sets no number of days.",
    amountCents: usd(50),
    amountText: "Not needed where the owner’s property totals less than $50.",
    mail: "The section and the rule read (781—9.20) name no kind of mail.",
    alsoSource: also("Iowa Admin. Code 781—9.20", "https://www.legis.iowa.gov/docs/iac/rule/781.9.20.pdf")
  }),
  row("ID", {
    citation: "Idaho Code § 14-5-501",
    sourceUrl: "https://legislature.idaho.gov/statutesrules/idstat/Title14/T14CH5/SECT14-5-501/",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail, and e-mail as well where the owner has agreed; a holder may try the owner’s electronic address first."
  }),
  row("IL", {
    citation: "765 ILCS 1026/15-501(a), (b), (c)",
    sourceUrl: "https://www.ilga.gov/Documents/legislation/ilcs/documents/076510260K15-501.htm",
    span: win(mo(12), d(60), "Not more than one year and not less than 60 days before filing the report."),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL,
    checkRule: "The general rule. Certified mail is for virtual currency and securities of $1,000 or more, not checks."
  }),
  row("IN", {
    citation: "IC 32-34-1.5-23",
    sourceUrl: "https://iga.in.gov/laws/2026/ic/titles/32#32-34-1.5-23",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail, or e-mail at the holder’s choice where the owner has agreed to it."
  }),
  row("KS", {
    citation: "K.S.A. 58-3950(e)",
    sourceUrl: "https://www.ksrevisor.gov/statutes/chapters/ch58/058_039_0050.html",
    span: between(120, 60),
    amountCents: usd(100),
    amountText: "$100 or more (reinvestment-plan stock and safe deposit boxes at any value).",
    mail: WRITTEN
  }),
  row("KY", {
    citation: "KRS 393A.270",
    sourceUrl: "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48124",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("LA", {
    citation: "La. R.S. 9:159(E)",
    sourceUrl: "https://legis.la.gov/Legis/Law.aspx?d=106717",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN,
    notes: "The page shows the text as amended by Acts 2026, No. 891, which takes effect January 1, 2027 (the enrolled act, Section 5). The act keeps the 120 and 60 days and the $50 and adds only a paragraph on digital assets, so the window is the same before and after that date."
  }),
  row("MA", {
    citation: "M.G.L. c. 200A, § 7A",
    sourceUrl: "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleII/Chapter200A/Section7A",
    span: atLeast(60),
    amountCents: usd(100),
    amountText: "$100 or more.",
    mail: FIRST
  }),
  row("MD", {
    citation: "Md. Code, Com. Law § 17-308.2",
    sourceUrl: "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=17-308.2&enactments=false",
    span: between(120, 30),
    amountCents: usd(100),
    amountText: "$100 or more.",
    mail: FIRST
  }),
  row("MI", {
    citation: "MCL 567.238(5)",
    sourceUrl: "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-567-238",
    span: between(365, 60),
    amountCents: usd(50),
    amountText: "$50 or more; $100 or more for a holder reporting at least 25,000 properties over $50 that year.",
    mail: WRITTEN
  }),
  row("MN", {
    citation: "Minn. Stat. § 345.41(e)",
    sourceUrl: "https://www.revisor.mn.gov/statutes/cite/345.41",
    span: noMoreThan(120),
    amountCents: usd(100),
    amountText: "$100 or more.",
    mail: WRITTEN
  }),
  row("MO", {
    citation: "RSMo 447.539.5 and 447.503(11)",
    sourceUrl: "https://revisor.mo.gov/main/OneSection.aspx?section=447.539",
    span: null,
    noWindow: "The letter goes within twelve months before the property is turned over to the Treasurer; no fewest number of days is set, and the day is counted from the turnover, not the report date.",
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail, postage prepaid, marked “Address Correction Requested”.",
    alsoSource: also("RSMo 447.503(11)", "https://revisor.mo.gov/main/OneSection.aspx?section=447.503")
  }),
  row("MS", {
    citation: "Mississippi State Treasurer, FAQs for Holders (unclaimed property reporting)",
    sourceUrl: "https://treasury.ms.gov/for-businesses/unclaimed-property-reporting/frequently-asked-questions-for-holders/",
    span: null,
    noWindow: "The Treasurer’s page words its 60 days and $50 as a suggestion, not a rule; the statute itself was not read here.",
    amountCents: null,
    amountText: "Suggested for $50 or more; not set as a rule on the page read.",
    mail: "The page names no kind of mail."
  }),
  row("MT", {
    citation: "Mont. Code Ann. § 70-9-808(5), (6)",
    sourceUrl: "https://mca.legmt.gov/bills/mca/title_0700/chapter_0090/part_0080/section_0080/0700-0090-0080-0080.html",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "Written notice; where the owner has agreed to e-mail, by either first-class mail or e-mail."
  }),
  row("NC", {
    citation: "N.C. Gen. Stat. § 116B-59(a1)",
    sourceUrl: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_116B/Article_4.html",
    span: between(120, 60),
    amountCents: usd(25),
    amountText: "$25 or more from December 1, 2026 (before then, $50 or more for property other than securities).",
    mail: FIRST,
    alsoSource: also("North Carolina Department of State Treasurer, Guide to Unclaimed Property Due Diligence (updated September 22, 2026)", "https://www.nccash.gov/documents/forms-and-guides/guide-unclaimed-property-due-diligence/download"),
    notes: "The amount changes on December 1, 2026 (S.L. 2026-50, s. 5.3(a)); the window stays the same."
  }),
  row("ND", {
    citation: "N.D.C.C. § 47-30.2-26",
    sourceUrl: "https://ndlegis.gov/cencode/t47c30-2.pdf",
    span: noMoreThan(120),
    amountCents: usd(25),
    amountText: "$25 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("NE", {
    citation: "Neb. Rev. Stat. § 69-1310(e)",
    sourceUrl: "https://nebraskalegislature.gov/laws/statutes.php?statute=69-1310",
    span: null,
    noWindow: "The section asks for contact before the annual report is filed and sets no number of days.",
    amountCents: null,
    amountText: "The section names no amount for the notice.",
    mail: "The section names no kind of mail."
  }),
  row("NH", {
    citation: "RSA 471-C:19, V",
    sourceUrl: "https://gc.nh.gov/rsa/html/XLVI/471-C/471-C-mrg.htm",
    span: noMoreThan(120),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  }),
  row("NJ", {
    citation: "New Jersey Unclaimed Property Administration, Holder Guidelines (updated September 2025), citing R.S. 46:30B-50",
    sourceUrl: "https://www.nj.gov/treasury/unclaimed-property/pdf/HolderGuidelines.pdf",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "Certified mail, return receipt requested.",
    alsoSource: also("New Jersey Unclaimed Property Administration, Business FAQs", "https://www.unclaimedproperty.nj.gov/BusinessFAQs.shtml"),
    notes: "Read in the Treasury’s own holder guidelines and FAQ; the statute’s text was not read here. The FAQ says mailing costs may not be taken from the remittance."
  }),
  row("NM", {
    citation: "NMSA 1978 § 7-8A-7(F), as amended by House Bill 386 (2006), passed text on the Legislature’s site",
    sourceUrl: "https://www.nmlegis.gov/sessions/06%20Regular/final/HB0386.html",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN,
    alsoSource: also("Taxation and Revenue Department, Holder Due Diligence", "https://www.tax.newmexico.gov/individuals/holders-overview/holder-due-diligence/"),
    notes: "Second read, November 12, 2026: the section’s text as passed in 2006 sets not more than 120 nor less than 60 days and $50; the Department’s current due diligence page names the same 60 and 120 days and $50. The compiled code on NMOneSource turned automated reading away, so a later change to the section was not ruled out. The Department’s filing kit (RPD-41200) names only the 120 days."
  }),
  row("NV", {
    citation: "NRS 120A.560(9)–(11)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-120A.html",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "Written notice to an address good for first-class mail; by e-mail as well where the owner has agreed.",
    checkRule: "The general rule. Certified mail is for stocks, equity, retirement accounts or virtual currency of $1,000 or more, not checks."
  }),
  row("NY", {
    citation: "N.Y. Office of the State Comptroller, Due Diligence for Companies Holding Abandoned Funds (Aband. Prop. Law § 1422)",
    sourceUrl: "https://www.osc.ny.gov/unclaimed-funds/reporters/due-diligence-companies-holding-abandoned-funds",
    span: atLeast(90),
    amountCents: null,
    amountText: "No amount for the first notice; accounts of $20 or less that are reported together are left out.",
    mail: "First-class mail. Over $1,000 with no answer: certified mail, return receipt requested, at least 60 days before the report.",
    notes: "Read on the Comptroller’s page. Second read, November 12, 2026: Aband. Prop. Law § 1422(1) on the Senate’s site sets first-class mail not less than ninety days before the reporting date. Owner contact by e-mail or login can count as contact (2 NYCRR Part 125)."
  }),
  row("OH", {
    citation: "R.C. 169.03(E)",
    sourceUrl: "https://codes.ohio.gov/ohio-revised-code/section-169.03",
    span: win(null, d(30), "Before the annual report, and the report no sooner than the 30th day after the notice was mailed; no earliest day is set."),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail from $50 to under $1,000; certified mail, return receipt requested, at $1,000 or more."
  }),
  row("OK", {
    citation: "60 O.S. § 661(E)",
    sourceUrl: "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os60.pdf",
    span: noMoreThan(120),
    amountCents: usd(50),
    amountText: "$50 or more, or less where it is one of a run of recurring payments.",
    mail: "Written notice, and e-mail where the owner has agreed; first-class mail to the last known address meets it."
  }),
  row("OR", {
    citation: "ORS 98.352(5)",
    sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors098.html",
    span: atLeast(60),
    amountCents: null,
    amountText: "The section names no amount (the Department’s rule, OAR 170-145-0015, was not read).",
    mail: "The section names no kind of mail."
  }),
  row("PA", {
    citation: "72 P.S. § 1301.10a(a), (b) (Fiscal Code, Art. XIII.1)",
    sourceUrl: "https://www.legis.state.pa.us/WU01/LI/LI/US/PDF/1929/0/0176..PDF",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "First-class mail, unless the owner agreed to an electronic notice that still works."
  }),
  row("RI", {
    citation: "R.I. Gen. Laws § 33-21.1-17(e)",
    sourceUrl: "https://webserver.rilegislature.gov/Statutes/TITLE33/33-21.1/33-21.1-17.htm",
    span: noMoreThan(120),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  }),
  row("SC", {
    citation: "S.C. Code § 27-18-180(E)",
    sourceUrl: "https://www.scstatehouse.gov/code/t27c018.php",
    span: noMoreThan(120),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  }),
  row("SD", {
    citation: "SDCL 43-41B-18",
    sourceUrl: "https://sdlegislature.gov/api/Statutes/43-41B.html?all=true",
    span: null,
    noWindow: "The section asks for the mailing before the annual report is filed and sets no number of days.",
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "Mailed notice; no class of mail is named."
  }),
  row("TN", {
    citation: "Tennessee Treasury, Unclaimed Property Reporting Guide (updated June 2026), due diligence",
    sourceUrl: "https://treasury.tn.gov/Portals/0/Documents/Unclaimed%20Property/Reporting/TNReporting-CompleteReportingGuide.pdf",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: "A first-class letter.",
    notes: "Read in the Treasury’s reporting guide; the statute’s official text is on a commercial publisher’s site and was not read here."
  }),
  row("TX", {
    citation: "Tex. Prop. Code § 74.1011",
    sourceUrl: "https://tcss.legis.texas.gov/resources/PR/htm/PR.74.htm",
    span: null,
    noWindow: "The notice is counted back (at least 60 days) from the day the property is delivered to the Comptroller, not from the report date.",
    amountCents: usd(250),
    amountAbove: true,
    amountText: "More than $250, held on March 1.",
    mail: "By mail or e-mail; no class of mail is named."
  }),
  row("UT", {
    citation: "Utah Code § 67-4a-501",
    sourceUrl: "https://le.utah.gov/xcode/Title67/Chapter4A/C67-4a-S501_2018050820180508.html",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("VA", {
    citation: "Va. Code § 55.1-2524(E)",
    sourceUrl: "https://law.lis.virginia.gov/vacode/title55.1/chapter25/section55.1-2524/",
    span: atLeast(60),
    amountCents: usd(100),
    amountText: "$100 or more.",
    mail: "First-class mail (the chapter’s meaning of due diligence, § 55.1-2500).",
    alsoSource: also("Va. Code § 55.1-2500", "https://law.lis.virginia.gov/vacode/title55.1/chapter25/section55.1-2500/")
  }),
  row("VT", {
    citation: "27 V.S.A. § 1501(a), (b)",
    sourceUrl: "https://legislature.vermont.gov/statutes/fullchapter/27/018",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("WA", {
    citation: "RCW 63.30.280(1), (2)",
    sourceUrl: "https://app.leg.wa.gov/RCW/default.aspx?cite=63.30&full=true",
    span: between(180, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("WI", {
    citation: "Wis. Stat. § 177.0501",
    sourceUrl: "https://docs.legis.wisconsin.gov/statutes/statutes/177/v/0501",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: FIRST_AND_EMAIL
  }),
  row("WV", {
    citation: "W. Va. Code § 36-8-7(e)",
    sourceUrl: "https://code.wvlegislature.gov/36-8-7/",
    span: between(120, 60),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  }),
  row("WY", {
    citation: "W.S. 34-24-118(e)",
    sourceUrl: "https://wyoleg.gov/statutes/compress/title34.pdf",
    span: noMoreThan(120),
    amountCents: usd(50),
    amountText: "$50 or more.",
    mail: WRITTEN
  })
];
var WHY = {
  ME: "Read only through a summarizing reader; the Legislature’s page refused a direct copy, so its figures are not used yet."
};
var NOT_READ = "Not read from an official source for this table yet.";
var NOTICE_NOT_COVERED = REF_US_STATES_DC.filter((m) => !NOTICE_ROWS.some((r) => r.code === m.code)).map((m) => ({ code: m.code, reason: WHY[m.code] ?? NOT_READ }));
var NOTICE_WINDOW_TABLE = {
  id: "unclaimed-property-notice-windows",
  label: "unclaimed property owner-notice windows before the annual report",
  checkedOn: NOV12,
  members: REF_US_STATES_DC,
  rows: NOTICE_ROWS,
  notCovered: NOTICE_NOT_COVERED
};
function noticeMoreSources(r) {
  return r.alsoSource ? [r.alsoSource] : [];
}
function noticeEndWords(e) {
  return `${e.n} ${e.unit === "days" ? e.n === 1 ? "day" : "days" : e.n === 1 ? "month" : "months"}`;
}
function back(reportDate, e) {
  return e.unit === "days" ? refAddDays(reportDate, -e.n) : refAddMonths(reportDate, -e.n);
}
var endOk = (e) => {
  if (e === null) return true;
  const x = e;
  if (typeof x?.n !== "number" || !Number.isSafeInteger(x.n) || x.n < 1) return false;
  return x.unit === "days" && x.n <= 400 || x.unit === "months" && x.n <= 13;
};
var worded = (s, min = 8) => typeof s === "string" && s.trim().length >= min;
function checkNoticeWindowTable(table = NOTICE_WINDOW_TABLE, dormancy2 = DORMANCY_TABLE) {
  const checks = new CheckList();
  checks.addAll(refCheckTable(table, (r) => r.code, noticeMoreSources));
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const badEnds = rows.filter((r) => {
    if (r.span === null) return !worded(r.noWindow, 20);
    if (!r.span || !endOk(r.span.earliest) || !endOk(r.span.latest)) return true;
    return r.span.earliest === null && r.span.latest === null;
  }).map((r) => r.code);
  checks.that("notice-ends", "Every window end is a whole number of days or months, and a row without a window says why", badEnds.length === 0, `ends not whole days or months, or no reason: ${badEnds.join(", ")}`);
  const reportDays = [];
  for (const y of [2027, 2028]) for (let m = 1; m <= 12; m += 1) reportDays.push(`${y}-${String(m).padStart(2, "0")}-${String(daysInMonth(y, m)).padStart(2, "0")}`, `${y}-${String(m).padStart(2, "0")}-01`);
  const badOrder = rows.filter((r) => {
    const w = r.span;
    if (!w || !w.earliest || !w.latest || !endOk(w.earliest) || !endOk(w.latest)) return false;
    return reportDays.some((day) => back(day, w.earliest) >= back(day, w.latest));
  }).map((r) => r.code);
  checks.that("notice-order", "Where a window has two ends, the first mailing day comes before the last", badOrder.length === 0, `the first mailing day is not before the last: ${badOrder.join(", ")}`);
  const badAmount = rows.filter((r) => r.amountCents !== null && (typeof r.amountCents !== "number" || !Number.isSafeInteger(r.amountCents) || r.amountCents < 0)).map((r) => r.code);
  checks.that("notice-amount", "Every amount is whole cents, zero or more, or none", badAmount.length === 0, `not whole cents: ${badAmount.join(", ")}`);
  const badWords = rows.filter((r) => r.span !== null && !worded(r.span?.text, 20) || !worded(r.amountText, 4) || !worded(r.mail) || !worded(r.checkRule, 20)).map((r) => r.code);
  checks.that("notice-words", "Every row states its window, amount, mail and the rule for a check", badWords.length === 0, `missing wording: ${badWords.join(", ")}`);
  const noReport = rows.filter((r) => r.span !== null && !findDormancyRow(r.code, dormancy2)?.report).map((r) => r.code);
  checks.that("notice-report-date", "Every row with a window has a report date in the dormancy table to count back from", noReport.length === 0, `no report date to count from: ${noReport.join(", ")}`);
  return checks.all;
}

// packages/agents/src/tables/index.ts
var MEMBER_SHAPE = /^(?:[A-Za-z]{1,3}|\d{4}-[A-Za-z]{1,3})$/;
var DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
var SITE = "https://mathproven.com";
var STATES_HELP = /* @__PURE__ */ (() => "a state's two-letter postal code (OH, NY), or DC for the District of Columbia")();
var STATE_NOUN = /* @__PURE__ */ (() => ({ one: "state", many: "states" }))();
var NOT_ZERO = /* @__PURE__ */ (() => 'Missing means the table has no row for it, not a figure of zero or "none".')();
var yearsText = /* @__PURE__ */ (() => ((n) => `${n} ${n === 1 ? "year" : "years"}`))();
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
  const later = days.filter((d2) => d2 > date);
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
var dormancy = /* @__PURE__ */ (() => ({
  id: "uncashed-check-dormancy-periods",
  page: "bookkeeping/uncashed-check-dormancy-periods",
  section: "bookkeeping",
  title: "Uncashed check dormancy periods by state (vendor and payroll checks)",
  pageTitle: "Uncashed Check Dormancy Periods by State: Vendor and Payroll, Sourced",
  description: "Each state's unclaimed property dormancy period for an uncashed vendor (accounts payable) check and an uncashed payroll check: the years after which the law presumes it abandoned, which paragraph each figure comes from, the annual report date for business holders where the source states it, and any rule for checks between businesses. Use it when someone asks how long an outstanding or stale check can sit before it is reportable as unclaimed property in a state, or when the state's holder report is due.",
  question: "How many years until an uncashed vendor check is presumed abandoned in North Carolina?",
  subject: "uncashed vendor and payroll check dormancy periods by state",
  notAdvice: "Mathproven gives periods and dates from the cited statutes only; each law has its own conditions, exceptions, and notice steps. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: DORMANCY_TABLE.members,
  table: DORMANCY_TABLE,
  rows: DORMANCY_TABLE.rows,
  notCovered: DORMANCY_TABLE.notCovered,
  check: once(() => checkDormancyTable()),
  findings: once(() => dormancyFindings()),
  codeOf: (r) => r.code,
  sources: (r) => unique([r, ...dormancyMoreSources(r)]),
  rowText: (r) => joinText([
    `Vendor check: ${yearsText(r.vendorYears)} (${r.vendorRule.replace(/\.$/, "")})`,
    `Payroll check: ${yearsText(r.payrollYears)} (${r.payrollRule.replace(/\.$/, "")})`,
    `Annual report: ${r.report ? r.report.text : "not read yet"}`,
    r.vendorException && `Checks between businesses: ${r.vendorException}`,
    r.notes && `Notes (our summary): ${r.notes}`
  ]),
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
function windowWords(w) {
  if (!w) return "No window counted from the report";
  const most = w.earliest ? `not more than ${noticeEndWords(w.earliest)}` : "";
  const least = w.latest ? `at least ${noticeEndWords(w.latest)}` : "";
  return `${[most, least].filter(Boolean).join(", ")} before`.replace(/^./, (c) => c.toUpperCase());
}
var noticeWindows = /* @__PURE__ */ (() => ({
  id: "unclaimed-property-notice-windows",
  page: "bookkeeping/unclaimed-property-notice-windows",
  section: "bookkeeping",
  title: "Unclaimed property owner notice windows before the annual report, by state",
  pageTitle: "Unclaimed Property Owner Notice Windows by State, Before the Report",
  description: "For each state's unclaimed property law (or the state office's own holder guide): the window before the annual report in which the owner notice (due diligence letter) is mailed, the amount at which a notice is asked for, the kind of mail, what applies to an uncashed check, and the report date from the dormancy table the window counts back from. Use it when someone asks when due diligence letters go out before a state's unclaimed property report, or the dollar amount that calls for one.",
  question: "What is the window for mailing unclaimed property owner notices before the Delaware report?",
  subject: "unclaimed property owner notice windows by state",
  notAdvice: "Mathproven gives windows, amounts and mail from the cited sources only; each law has its own conditions and exceptions. General information, not legal advice. Mathproven is not affiliated with any legislature or agency whose statutes or guides are cited here.",
  memberNoun: STATE_NOUN,
  memberHelp: STATES_HELP,
  members: NOTICE_WINDOW_TABLE.members,
  table: NOTICE_WINDOW_TABLE,
  rows: NOTICE_WINDOW_TABLE.rows,
  notCovered: NOTICE_WINDOW_TABLE.notCovered,
  check: once(() => checkNoticeWindowTable()),
  codeOf: (r) => r.code,
  sources: (r) => {
    const report = findDormancyRow(r.code, DORMANCY_TABLE);
    const reportSource = report?.report ? report.reportSource ?? report : null;
    return unique([r, ...noticeMoreSources(r), ...reportSource ? [reportSource] : []]);
  },
  rowText: (r) => {
    const report = findDormancyRow(r.code, DORMANCY_TABLE)?.report;
    return joinText([
      `Window before the report: ${windowWords(r.span)}${r.span ? ` (${r.span.text.replace(/\.$/, "")})` : `: ${r.noWindow.replace(/\.$/, "")}`}`,
      `Amount: ${r.amountText}`,
      `Mail: ${r.mail}`,
      `For an uncashed check (our summary): ${r.checkRule}`,
      r.notes && `Notes: ${r.notes}`,
      `Report date (dormancy table): ${report ? report.text : "not in the dormancy table"}`
    ]);
  },
  dateRule: AS_READ_RULE,
  pick(code, date) {
    return asReadPick(this.rows, this.codeOf, this.notCovered, code, date);
  }
}))();
var AGENT_TABLES = [dormancy, noticeWindows];
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
var pool = [...BOOKKEEPING, ...lookupEntries()];
var names = ["bank_reconciliation_statement", "bank_reconciliation_template", "reconciliation_difference_finder", "duplicate_transactions_finder", "bank_statement_to_excel", "bank_statement_to_ofx", "bank_statement_merge", "petty_cash_reconciliation", "uncashed_check_escheat_list", "uncashed_check_dormancy_periods", "unclaimed_property_notice_windows"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.4", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
