// Mathproven agent tools 0.1.2. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.md.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
// packages/agents/src/cli.ts
import { webcrypto } from "node:crypto";

// packages/agents/src/files.ts
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

// packages/core/src/money.ts
var AmountError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AmountError";
  }
};
function assertCents(value, label = "amount") {
  if (!Number.isSafeInteger(value)) {
    throw new AmountError(`${label} must be a whole number of cents, got ${value}`);
  }
  return value;
}
var NUMBER_BODY = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/;
function parseAmount(raw, options = {}) {
  const crIsNegative = options.crIsNegative ?? true;
  let s = raw.trim();
  if (!s) throw new AmountError("empty amount");
  let negative = false;
  let signs = 0;
  s = s.replace(/^\$\s*(?=\()/, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = !negative;
    signs++;
    s = s.slice(1, -1).trim();
  }
  const suffix = /\s*(CR|DR)$/i.exec(s);
  if (suffix) {
    const tag = suffix[1].toUpperCase();
    if (tag === "CR" && crIsNegative) negative = !negative;
    if (tag === "DR" && !crIsNegative) negative = !negative;
    signs++;
    s = s.slice(0, suffix.index).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    signs++;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-") || s.startsWith("+")) {
    if (s.startsWith("-")) negative = !negative;
    signs++;
    s = s.slice(1).trim();
  }
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s.startsWith("-") || s.startsWith("+")) {
    if (s.startsWith("-")) negative = !negative;
    signs++;
    s = s.slice(1).trim();
  }
  if (signs > 1) throw new AmountError(`conflicting signs in amount "${raw}"`);
  if (!s || s === "." || !NUMBER_BODY.test(s)) {
    throw new AmountError(`not a valid amount: "${raw}"`);
  }
  const [whole = "", frac = ""] = s.replace(/,/g, "").split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  assertCents(cents, `amount "${raw}"`);
  return negative && cents !== 0 ? -cents : cents;
}
function decimalToCents(raw) {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  if (!m || !m[2] && !m[3]) throw new AmountError(`not a valid number: "${raw}"`);
  const negative = m[1] === "-";
  const frac = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) throw new AmountError(`number out of range: "${raw}"`);
  const digits = BigInt((m[2] ?? "") + frac || "0");
  const scale = frac.length - exponent - 2;
  let cents;
  let clean = true;
  if (scale <= 0) {
    cents = digits * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    const rem = digits % divisor;
    const roundsUp = 2n * rem >= divisor;
    cents = digits / divisor + (roundsUp ? 1n : 0n);
    clean = (roundsUp ? divisor - rem : rem) * 1000000n < divisor;
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new AmountError(`number out of range: "${raw}"`);
  const n = Number(cents);
  return { cents: negative && n !== 0 ? -n : n, clean };
}
function toDecimal(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
function formatUSD(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}
function sum(values) {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total = assertCents(total + v, "running total");
  }
  return total;
}

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

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0; i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1; i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (; i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0; i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0; i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i = 0; i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0; i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0; i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0; i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0; i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i2) {
      return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0; i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0; i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
};
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i = 0; i < files.length; ++i) {
    var f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// packages/core/src/xlsx.ts
var DECIMAL_2 = /^-?\d+\.\d{2}$/;
function xmlEscape(s) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
function sheetNames(sheets) {
  const used = /* @__PURE__ */ new Set();
  return sheets.map((s, i) => {
    let name = s.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function moneyColumns(sheet) {
  const cols = /* @__PURE__ */ new Set();
  const head = sheet.rows[0] ?? [];
  const body = sheet.rows.slice(1);
  if (sheet.money && sheet.money !== "auto") {
    head.forEach((h, i) => {
      if (typeof h === "string" && sheet.money.includes(h)) cols.add(i);
    });
    return cols;
  }
  for (let i = 0; i < head.length; i++) {
    let filled2 = 0;
    let ok = true;
    for (const row of body) {
      const c = row[i];
      if (c === null || c === void 0 || c === "") continue;
      filled2++;
      if (typeof c !== "string" || !DECIMAL_2.test(c)) {
        ok = false;
        break;
      }
    }
    if (ok && filled2 > 0) cols.add(i);
  }
  return cols;
}
function sheetXml(sheet) {
  const money = moneyColumns(sheet);
  const colCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = [];
  for (let i = 0; i < colCount; i++) {
    const given = sheet.widths?.[i];
    if (given) {
      widths.push(given);
      continue;
    }
    let w = 8;
    for (const row of sheet.rows.slice(0, 200)) w = Math.max(w, String(row[i] ?? "").length + 2);
    widths.push(Math.min(w, 60));
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === void 0 || cell === "") return "";
      const ref = `${columnName(c)}${r + 1}`;
      const style = r === 0 ? 1 : 0;
      if (r > 0 && money.has(c) && typeof cell === "string" && DECIMAL_2.test(cell)) return `<c r="${ref}" s="2"><v>${cell}</v></c>`;
      if (typeof cell === "number" && Number.isSafeInteger(cell)) return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(cell))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + (cols ? `<cols>${cols}</cols>` : "") + `<sheetData>${rows}</sheetData></worksheet>`;
}
var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
function writeXlsx(sheets, fixedDate = new Date(Date.UTC(2020, 0, 1))) {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet");
  const names2 = sheetNames(sheets);
  const files = {};
  const put = (path, xml) => {
    files[path] = strToU8(xml);
  };
  put(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names2.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"
  );
  put(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names2.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
  );
  put(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names2.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${names2.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  put("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipSync(files, { level: 6, mtime: fixedDate });
}
function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&amp;/g, "&");
}
function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? xmlUnescape(m[1] ?? m[2] ?? "") : void 0;
}
function textOf(xml) {
  const cleaned = xml.replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while (m = re.exec(cleaned)) out += xmlUnescape(m[1] ?? "");
  return out;
}
var MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
var MAX_ROWS = 1048576;
var DAYS_1904 = 1462;
var BUILT_IN_DATE_FORMATS = /* @__PURE__ */ new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\[(h+|m+|s+)\]/gi, "h").replace(/\[[^\]]*\]/g, "");
  return /[dy]/i.test(c) || /m/i.test(c) && !/[hs]/i.test(c);
}
function dateStyles(styles) {
  const out = /* @__PURE__ */ new Set();
  if (!styles) return out;
  const custom = /* @__PURE__ */ new Map();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  let index = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id);
    if (code !== void 0 ? isDateFormat(code) : BUILT_IN_DATE_FORMATS.has(id)) out.add(index);
    index++;
  }
  return out;
}
function readXlsx(bytes) {
  let files;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("too large");
        return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name);
      }
    });
  } catch (err2) {
    throw new Error(err2 instanceof Error && err2.message === "too large" ? "This workbook is too large to open here." : "This file is not a readable .xlsx workbook.");
  }
  const read = (path) => {
    const f = files[path];
    return f ? strFromU8(f) : void 0;
  };
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("This file is not a readable .xlsx workbook.");
  const workbookPr = /<workbookPr\s[^>]*>/.exec(workbook);
  const date1904 = workbookPr ? /^(1|true)$/.test(attr(workbookPr[0], "date1904") ?? "") : false;
  const dated = date1904 ? dateStyles(read("xl/styles.xml")) : /* @__PURE__ */ new Set();
  const shared = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) {
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m;
    while (m = re.exec(sst)) shared.push(textOf(m[1] ?? ""));
  }
  const targets = /* @__PURE__ */ new Map();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], "r:id");
    const xml = rid ? read(targets.get(rid) ?? "") : void 0;
    if (xml === void 0) continue;
    const rows = [];
    let width = 0;
    let nextRow = 0;
    const body = xml.replace(/<row(\s[^>]*)?\/>/g, "");
    for (const rm of body.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const rAttr = rm[1] ? attr(rm[1], "r") : void 0;
      const rowIndex = rAttr && /^\d{1,7}$/.test(rAttr) ? Number(rAttr) - 1 : nextRow;
      if (rowIndex < 0 || rowIndex >= MAX_ROWS) throw new Error("This workbook is too large to open here.");
      nextRow = rowIndex + 1;
      const row = [];
      let nextCol = 0;
      for (const cm of rm[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cm[1] ?? "";
        const ref = attr(tag, "r");
        const col = ref && /^[A-Z]{1,3}\d*$/.test(ref) ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        const type = attr(tag, "t");
        const inner = cm[2] ?? "";
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        let value = "";
        if (type === "s") value = v ? shared[Number(v[1])] ?? "" : "";
        else if (type === "inlineStr") value = textOf(inner);
        else if (type === "b") value = v ? v[1] === "1" ? "TRUE" : "FALSE" : "";
        else value = v ? xmlUnescape(v[1]) : "";
        const day = (type === void 0 || type === "n") && dated.size > 0 ? /^(\d{1,7})(\.\d+)?$/.exec(value) : null;
        if (day && dated.has(Number(attr(tag, "s") ?? 0))) value = `${Number(day[1]) + DAYS_1904}${day[2] ?? ""}`;
        while (row.length < col) row.push("");
        row[col] = value;
      }
      while (rows.length < rowIndex) rows.push([]);
      rows[rowIndex] = row;
      width = Math.max(width, row.length);
    }
    for (const row of rows) while (row.length < width) row.push("");
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new Error("This workbook has no readable sheets.");
  return sheets;
}

// packages/core/src/property/calendarDays.ts
var ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function isLeapYear(year) {
  return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
}
function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
function parseCivilDate(iso2, label = "date") {
  const m = ISO.exec(typeof iso2 === "string" ? iso2.trim() : "");
  if (!m) throw new Error(`The ${label} must be a date written as YYYY-MM-DD.`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200) throw new Error(`The ${label} has a year outside 1900 to 2200.`);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`The ${label} "${iso2}" is not a real calendar date.`);
  }
  return { year, month, day };
}

// packages/agents/src/values.ts
var AgentInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentInputError";
  }
};
function asText(value, input) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new AgentInputError(`"${input.name}" (${input.label}) must be given as text.`);
}
function amountCents(raw, what) {
  try {
    return parseAmount(raw);
  } catch (err2) {
    const why = err2 instanceof Error ? err2.message : "not an amount";
    throw new AgentInputError(`${what} "${raw}" is not an amount in dollars and cents (${why}).`);
  }
}
function amountList(value, input) {
  if (Array.isArray(value)) return value.map((v) => asText(v, input));
  const text = asText(value, input);
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => asText(v, input));
    } catch {
    }
  }
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
}
function checkValue(input, value) {
  const what = `"${input.name}" (${input.label})`;
  switch (input.kind) {
    case "text": {
      const t = asText(value, input);
      if (t.length > 2e4) throw new AgentInputError(`${what} is longer than 20,000 characters.`);
      return t;
    }
    case "amount":
      return amountCents(asText(value, input), what);
    case "amounts": {
      const items = amountList(value, input);
      if (items.length === 0) throw new AgentInputError(`${what} has no amounts in it.`);
      if (items.length > 1e5) throw new AgentInputError(`${what} has more than 100,000 amounts.`);
      return items.map((raw, i) => amountCents(raw, `Item ${i + 1} of ${what}`));
    }
    case "date": {
      const t = asText(value, input);
      try {
        parseCivilDate(t, input.label.toLowerCase());
      } catch (err2) {
        throw new AgentInputError(`${what} must be a real day written YYYY-MM-DD (${err2 instanceof Error ? err2.message : "not a date"}).`);
      }
      return t;
    }
    case "year": {
      const t = asText(value, input);
      if (!/^\d{4}$/.test(t)) throw new AgentInputError(`${what} must be a year written as four digits.`);
      const y = Number(t);
      if (y < 1900 || y > 2200) throw new AgentInputError(`${what} must be a year from 1900 to 2200.`);
      return y;
    }
    case "number": {
      const t = asText(value, input);
      if (!/^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/.test(t) || !/\d/.test(t)) throw new AgentInputError(`${what} must be a number, such as 1250 or 12.5.`);
      return t.replace(/,/g, "");
    }
    case "choice": {
      const t = asText(value, input);
      const choices = input.choices ?? [];
      const hit = choices.find((c) => c.toLowerCase() === t.toLowerCase());
      if (hit === void 0) throw new AgentInputError(`${what} must be one of: ${choices.join(", ")}.`);
      return hit;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const t = asText(value, input).toLowerCase();
      if (t === "true" || t === "yes") return true;
      if (t === "false" || t === "no") return false;
      throw new AgentInputError(`${what} must be true or false.`);
    }
    case "file":
    case "files":
      throw new AgentInputError(`${what} is a file and is read by the runner.`);
  }
}

// packages/agents/src/files.ts
var MAX_FILE_BYTES = 50 * 1024 * 1024;
function firstFilled(sheets) {
  const filled2 = sheets.find((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
  return filled2 ? filled2.rows : [];
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
    } catch (err2) {
      throw new AgentInputError(`"${name}" could not be read as an .xlsx workbook (${err2 instanceof Error ? err2.message : "unreadable"}).`);
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

// packages/core/src/verify.ts
var CheckList = class {
  items = [];
  /** Two cent amounts must match exactly. */
  cents(id, label, expected, actual, severity = "error") {
    const passed = expected === actual;
    this.items.push({
      id,
      label,
      passed,
      severity,
      expected: formatUSD(expected),
      actual: formatUSD(actual),
      ...passed ? {} : { detail: `off by ${formatUSD(actual - expected)}` }
    });
    return passed;
  }
  /** Two plain values must match exactly. */
  equal(id, label, expected, actual, severity = "error") {
    const passed = expected === actual;
    this.items.push({ id, label, passed, severity, expected: String(expected), actual: String(actual) });
    return passed;
  }
  /** A condition must hold. */
  that(id, label, condition, detail, severity = "error") {
    this.items.push({ id, label, passed: condition, severity, ...detail && !condition ? { detail } : {} });
    return condition;
  }
  add(check) {
    this.items.push(check);
  }
  addAll(checks) {
    for (const c of checks) this.items.push(c);
  }
  get all() {
    return [...this.items];
  }
  get passed() {
    return passedAll(this.items);
  }
};
function passedAll(checks) {
  return checks.every((c) => c.passed || c.severity === "warning");
}
function failures(checks) {
  return checks.filter((c) => !c.passed && c.severity === "error");
}
function warnings(checks) {
  return checks.filter((c) => !c.passed && c.severity === "warning");
}
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function certify(tool, toolVersion, checks, output, now = /* @__PURE__ */ new Date()) {
  const cert = {
    tool,
    toolVersion,
    generatedAt: now.toISOString(),
    passed: passedAll(checks),
    checksRun: checks.length,
    checksFailed: failures(checks).length,
    warnings: warnings(checks).length,
    checks: [...checks]
  };
  if (output !== void 0) cert.outputSha256 = await sha256Hex(output);
  return cert;
}
function certificateText(cert) {
  const lines = [
    `Reconciliation certificate: ${cert.tool} v${cert.toolVersion}`,
    `Generated: ${cert.generatedAt}`,
    `Result: ${cert.passed ? "PASSED" : "FAILED"} (${cert.checksRun} checks, ${cert.checksFailed} failed, ${cert.warnings} warnings)`
  ];
  for (const c of cert.checks) {
    const mark = c.passed ? "PASS" : c.severity === "warning" ? "WARN" : "FAIL";
    let line = `  [${mark}] ${c.label}`;
    if (c.expected !== void 0 || c.actual !== void 0) line += ` (expected ${c.expected}, got ${c.actual})`;
    if (c.detail) line += ` — ${c.detail}`;
    lines.push(line);
  }
  if (cert.outputSha256) lines.push(`Output SHA-256: ${cert.outputSha256}`);
  return lines.join("\n");
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

// packages/core/src/sheetInput.ts
function sheetIsTotalWord(cell) {
  return /^(?:grand|statement|report|page|sub)?[\s-]*totals?\b/i.test(cell.trim());
}
function sheetRowList(rows) {
  const MAX_REASONS = 8;
  const MAX_ROWS3 = 20;
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
    const first = numbers.slice(0, MAX_ROWS3);
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
  const names2 = header.map(sheetNormalizeHeader);
  const used = /* @__PURE__ */ new Set();
  const columns = {};
  let hits = 0;
  for (const role of roles) columns[role] = -1;
  for (const exact of [true, false]) {
    for (const role of roles) {
      if (columns[role] >= 0) continue;
      for (const word of synonyms[role]) {
        const col = names2.findIndex((n, i) => !used.has(i) && n !== "" && (exact ? n === word : ` ${n} `.includes(` ${word} `)));
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

// packages/agents/src/sheets.ts
function columnsInput(fileLabel, c, name = "columns") {
  const needed = c.required.map((r) => c.labels[r]);
  const optional = c.roles.filter((r) => !c.required.includes(r)).map((r) => c.labels[r]);
  return {
    name,
    kind: "text",
    label: `Columns of the ${fileLabel.toLowerCase()}`,
    description: `Optional. Only when a column is guessed wrongly from the header words: name it as "<column> = <header in the file>", separated by commas, for example "${needed[0] ?? "Amount"} = ${needed[0] ?? "Amount"} received"; "<column> = none" leaves an optional column out. The answer lists the columns it read.${needed.length ? ` Needed: ${needed.join(", ")}.` : ""}${optional.length ? ` Used when present: ${optional.join(", ")}.` : ""}`,
    required: false
  };
}
var columnLog = null;
function beginColumnLog() {
  columnLog = [];
}
function takeColumnLog() {
  const out = columnLog ?? [];
  columnLog = null;
  return out;
}
function logColumns(fileLabel, file, c, mapping) {
  if (!columnLog) return;
  const header = file.rows[mapping.headerRow] ?? [];
  const used = c.roles.filter((r) => mapping.columns[r] >= 0).map((r) => `${c.labels[r]} = "${(header[mapping.columns[r]] ?? "").trim() || `column ${mapping.columns[r] + 1}`}"`);
  const unused = c.roles.filter((r) => mapping.columns[r] < 0).map((r) => c.labels[r]);
  columnLog.push(`${fileLabel} (${file.name}, header on row ${mapping.headerRow + 1}): ${used.join("; ") || "none"}${unused.length ? `. Not in the file: ${unused.join(", ")}` : ""}.`);
}
function labelKey(text) {
  return sheetNormalizeHeader(text.replace(/\([^)]*\)/g, " "));
}
function headerIndex(header, text) {
  const want = sheetNormalizeHeader(text);
  const exact = header.findIndex((h) => sheetNormalizeHeader(h) === want);
  if (exact >= 0) return exact;
  const letter = /^[A-Za-z]{1,2}$/.test(text.trim()) ? text.trim().toUpperCase() : "";
  if (letter) {
    let n = 0;
    for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n - 1 < header.length) return n - 1;
  }
  return -1;
}
var NONE = /* @__PURE__ */ new Set(["none", "not in this file", "not in the file", "no column", "-"]);
function parseOverride(override, c) {
  const out = [];
  for (const part of override.split(/[,;\n]/)) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new AgentInputError(`"columns" must be written as "<column> = <header in the file>": "${part.trim()}".`);
    const roleText = labelKey(part.slice(0, eq));
    const headerText = part.slice(eq + 1).trim();
    const exact = c.roles.find((r) => labelKey(c.labels[r]) === roleText || sheetNormalizeHeader(r) === roleText || sheetNormalizeHeader(c.labels[r]) === roleText);
    const starts = roleText === "" ? [] : c.roles.filter((r) => `${labelKey(c.labels[r])} `.startsWith(`${roleText} `));
    const role = exact ?? (starts.length === 1 ? starts[0] : void 0);
    if (role === void 0) throw new AgentInputError(`"${part.slice(0, eq).trim()}" is not one of this file's columns. They are: ${c.roles.map((r) => c.labels[r]).join(", ")}.`);
    const none = headerText === "" || NONE.has(headerText.toLowerCase());
    if (none && c.required.includes(role)) throw new AgentInputError(`${c.labels[role]} is needed, so it cannot be left out; name its header.`);
    out.push({ role, header: none ? null : headerText, text: part.trim() });
  }
  return out;
}
function rowHolding(rows, headers) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) if (headers.every((h) => headerIndex(rows[i] ?? [], h) >= 0)) return i;
  return -1;
}
function mapColumns(file, c, override, fileLabel) {
  let mapping = c.guess(file.rows);
  const named = override && override.trim() !== "" ? parseOverride(override, c) : [];
  const headersNamed = named.filter((n) => n.header !== null && !/^[A-Za-z]{1,2}$/.test(n.header)).map((n) => n.header);
  if (headersNamed.length > 0 && !headersNamed.every((h) => headerIndex(file.rows[mapping.headerRow] ?? [], h) >= 0)) {
    const row = rowHolding(file.rows, headersNamed);
    if (row >= 0 && row !== mapping.headerRow) {
      const again = c.guess(file.rows, row);
      mapping = again.headerRow === row ? again : { headerRow: row, columns: Object.fromEntries(c.roles.map((r) => [r, -1])) };
    }
  }
  const header = file.rows[mapping.headerRow] ?? [];
  const columns = { ...mapping.columns };
  for (const n of named) {
    if (n.header === null) {
      columns[n.role] = -1;
      continue;
    }
    const col = headerIndex(header, n.header);
    if (col < 0) throw new AgentInputError(`The ${fileLabel.toLowerCase()} has no header "${n.header}". Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}.`);
    columns[n.role] = col;
  }
  const missing = c.required.filter((r) => columns[r] < 0);
  if (missing.length > 0) {
    throw new AgentInputError(
      `The ${fileLabel.toLowerCase()} (${file.name}) has no column for: ${missing.map((r) => c.labels[r]).join(", ")}. Its headers are: ${header.filter((h) => h.trim() !== "").join(", ") || "(none found)"}. Name the column with "columns", for example "${c.labels[missing[0]]} = <header>".`
    );
  }
  const result = { ...mapping, headerRow: mapping.headerRow, columns };
  logColumns(fileLabel, file, c, result);
  return result;
}
function oneFile(files, name) {
  const f = files[name]?.[0];
  if (!f) throw new AgentInputError(`"${name}" is needed.`);
  return f;
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
  } catch (err2) {
    return refused(entry, err2 instanceof Error ? err2.message : "An input could not be read.", note);
  }
  const month = monthOf(ctx.now);
  const counted = entry.limits === "site" && plan === "free" && ctx.counter !== void 0;
  if (counted && ctx.counter.used(entry.name, month) >= FREE_RUNS_PER_MONTH) return refused(entry, monthUsedMessage(entry.title, month), note);
  let result;
  let columnsRead = [];
  beginColumnLog();
  try {
    result = entry.run({ files, values, now: ctx.now });
  } catch (err2) {
    takeColumnLog();
    return refused(entry, err2 instanceof Error ? err2.message : "The input could not be used.", note);
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
    } catch (err2) {
      return refused(entry, err2 instanceof Error ? err2.message : "The workbook could not be saved.", note);
    }
  } else if (verified && saveTo !== "") {
    try {
      const own = result.file !== void 0 && (entry.fileExtensions ?? []).some((ext) => saveTo.toLowerCase().endsWith(ext.toLowerCase()));
      savedTo = ctx.writeFile(saveTo, own ? result.file.bytes : resultFile(saveTo, result.tables, certText));
    } catch (err2) {
      return refused(entry, err2 instanceof Error ? err2.message : "The file could not be saved.", note);
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
  } catch (err2) {
    return { code: 1, text: `Mathproven, ${entry.title}: not run. ${err2 instanceof Error ? err2.message : "The run stopped."}` };
  }
}
async function runCliProcess(options) {
  const result = await runCli(process.argv.slice(2), options);
  process.stdout.write(`${result.text}
`);
  process.exitCode = result.code;
}

// packages/core/src/statements/reconcile.ts
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// packages/core/src/property/sheetCells.ts
var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var DAY_MS = 864e5;
function iso(year, month, day, raw) {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isIsoDate(value)) throw new Error(`not a real date: "${raw}"`);
  return value;
}
function pmCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]), raw);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    const year = m[3].length === 2 ? yy < 30 ? 2e3 + yy : 1900 + yy : yy;
    return order === "dmy" ? iso(year, Number(m[2]), Number(m[1]), raw) : iso(year, Number(m[1]), Number(m[2]), raw);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[2]), raw);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[1]), raw);
  }
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const serial = Number(m[1]);
    if (serial >= 2e4 && serial <= 8e4) return new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS).toISOString().slice(0, 10);
  }
  throw new Error(`not a recognizable date: "${raw}"`);
}

// packages/core/src/bookkeeping/cells.ts
function bkCellToIsoDate(raw, order = "mdy") {
  const s = raw.trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(\s.*)?$/.exec(s);
  if (m) return pmCellToIsoDate(order === "dmy" ? `${m[2]}/${m[1]}/${m[3]}` : `${m[1]}/${m[2]}/${m[3]}`);
  return pmCellToIsoDate(s);
}

// packages/agents/src/registry/general.ts
var MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
var MAX_ROWS2 = 1e5;
function addUp(values, what) {
  try {
    return sum(values);
  } catch (err2) {
    if (err2 instanceof AmountError) throw new AgentInputError(`${what} add up to more than can be counted exactly to the cent.`);
    throw err2;
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
function listOf(items, max2 = 12) {
  const shown = items.slice(0, max2);
  return shown.join("; ") + (items.length > max2 ? `; and ${items.length - max2} more` : "");
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
  const names2 = header.map((h) => h.trim()).filter((h) => h !== "");
  return names2.length ? names2.join(", ") : "(none found)";
}
function shortText(text, max2 = 40) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max2 ? `${t.slice(0, max2 - 1)}…` : t;
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
    if (region.length > MAX_ROWS2) throw new AgentInputError(`The table (${file.name}) has ${region.length.toLocaleString("en-US")} rows under its header row, more than the ${MAX_ROWS2.toLocaleString("en-US")} this check reads. Check it in parts.`);
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
function dayNumber(iso2) {
  return iso2 === "" ? Number.NaN : Date.parse(`${iso2}T00:00:00Z`) / 864e5;
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
  if (dataRows.length > MAX_ROWS2) throw new AgentInputError(`The ${name} (${file.name}) has ${dataRows.length.toLocaleString("en-US")} rows, more than the ${MAX_ROWS2.toLocaleString("en-US")} this check reads. Reconcile it in parts, a month at a time say.`);
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
  const pool2 = /* @__PURE__ */ new Map();
  for (const b of bs) {
    const k = key(b);
    const p = pool2.get(k);
    if (p) p.list.push(b);
    else pool2.set(k, { list: [b], next: 0 });
  }
  const pairs = [];
  for (const a of as) {
    const p = pool2.get(key(a));
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
  const pool2 = /* @__PURE__ */ new Map();
  for (const y of ys) pool2.set(keyOfPartner(y), (pool2.get(keyOfPartner(y)) ?? 0) + 1);
  let n = 0;
  for (const x of xs) {
    const k = key(x);
    const left = pool2.get(k) ?? 0;
    if (left > 0) {
      pool2.set(k, left - 1);
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

// mp-entry:mp-entry:main
var pool = [...GENERAL];
var names = ["check_total_against_parts", "check_table_cross_foot", "check_two_lists_reconcile"];
var entries = names.map((name) => pool.find((e) => e.name === name)).filter((e) => e !== void 0);
runCliProcess({ entries, ref: "marketplace-claude-plugin", version: "0.1.2", keyHelp: "A Mathproven key, when there is one: --key <key>. It is checked here, against Mathproven's public key, and never sent anywhere." });
