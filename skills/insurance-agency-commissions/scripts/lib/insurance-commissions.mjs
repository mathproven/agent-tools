// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  STAMPING_FEE_TABLE,
  sfListOffer
} from "./surplusLinesStampingFees.mjs";
import {
  REF_US_STATES_DC,
  SURPLUS_LINES_TAX_TABLE,
  anniversary,
  civilDayNumber,
  computeSurplusLinesTax,
  parseCivilDate,
  refMemberName,
  slApplyPpm,
  slPercentText,
  slRow,
  slWithinHalfCent
} from "./surplusLinesTax.mjs";
import {
  COMMISSION_BUCKETS,
  COMMISSION_BUCKET_LABELS,
  INS_BOOK_LABELS,
  INS_BOOK_ROLES,
  INS_CARRIER_LABELS,
  INS_CARRIER_ROLES,
  INS_STATEMENT_LABELS,
  INS_STATEMENT_REFUSE,
  INS_STATEMENT_ROLES,
  INS_STATEMENT_SYNONYMS,
  MISSING_LINE_LABELS,
  MISSING_LINE_ROLES,
  MISSING_POLICY_LABELS,
  MISSING_POLICY_ROLES,
  carrierSummaryTables,
  commissionReconcileTables,
  commissionStatementRows,
  findMissingCommissions,
  insAssertDistinct,
  insBpText,
  insCell,
  insExtractBookLines,
  insExtractCarrierLines,
  insExtractMissingLines,
  insExtractMissingPolicies,
  insExtractStatementLines,
  insGroupKey,
  insGuessBookColumns,
  insGuessCarrierColumns,
  insGuessColumns,
  insGuessMissingLineColumns,
  insGuessMissingPolicyColumns,
  insGuessRateFormat,
  insGuessStatementColumns,
  insIsTotalLabel,
  insNeedColumn,
  insOptionalCents,
  insReadCarrierTotalsSheet,
  isIsoDate,
  missingCommissionTables,
  normalizeCommissionStatement,
  pmDaysBetween,
  reconcileCommissions,
  scaledParse,
  sheetNormalizeHeader,
  sumCsvColumn,
  summarizeCommissionsByCarrier,
  toCsv
} from "./missingCommissions.mjs";
import {
  CheckList,
  allocate,
  applyRate,
  assertCents,
  divRound,
  failures,
  formatUSD,
  parseAmount,
  passedAll,
  percentToBasisPoints,
  sum,
  toDecimal,
  warnings
} from "./money.mjs";

// packages/core/src/insurance/commissionCalc.ts
var COMMISSION_CALC_MAX_PREMIUM = 1e10;
var COMMISSION_CALC_MAX_TERM_DAYS = 3660;
var KIND_LABEL = { new: "new business", renewal: "renewal" };
function rate(bp, label) {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 1e4) throw new Error(`${label} must be between 0% and 100%`);
  return bp;
}
var pct = (bp) => `${insBpText(bp)}%`;
function countDays(c) {
  const effective = civilDayNumber(parseCivilDate(c.effectiveDate, "effective date"));
  const expiration = civilDayNumber(parseCivilDate(c.expirationDate, "expiration date"));
  const cancelled = civilDayNumber(parseCivilDate(c.cancellationDate, "cancellation date"));
  const termDays = expiration - effective;
  if (termDays < 1) throw new Error("The expiration date must be after the effective date");
  if (termDays > COMMISSION_CALC_MAX_TERM_DAYS) throw new Error("The policy term is longer than ten years");
  const daysInForce = cancelled - effective;
  if (daysInForce < 0 || daysInForce > termDays) throw new Error("The cancellation date must be on or between the effective date and the expiration date");
  return { termDays, daysInForce, daysNotUsed: termDays - daysInForce };
}
function validate(input) {
  const premium = assertCents(input.premium, "Premium");
  if (premium <= 0) throw new Error("Enter a premium greater than zero");
  if (premium > COMMISSION_CALC_MAX_PREMIUM) throw new Error(`The premium is more than ${formatUSD(COMMISSION_CALC_MAX_PREMIUM)}, the most this calculator takes`);
  if (input.kind !== "new" && input.kind !== "renewal") throw new Error("Pick new business or renewal");
  const newBp = input.newRateBp === void 0 ? void 0 : rate(input.newRateBp, "The new business rate");
  const renewalBp = input.renewalRateBp === void 0 ? void 0 : rate(input.renewalRateBp, "The renewal rate");
  const rateBp = input.kind === "new" ? newBp : renewalBp;
  if (rateBp === void 0) throw new Error(input.kind === "new" ? "Enter the new business rate" : "Enter the renewal rate");
  if (input.producerShareBp !== void 0) rate(input.producerShareBp, "The producer share");
  let days = null;
  const c = input.cancellation;
  if (c?.method === "dates") days = countDays(c);
  else if (c?.method === "amount") {
    const back = assertCents(c.returnPremium, "Return premium");
    if (back < 0) throw new Error("The return premium cannot be negative");
    if (back > premium) throw new Error("The return premium cannot be more than the premium");
  } else if (c !== void 0) throw new Error("Pick how the cancellation is entered: by dates or by return premium");
  return { rateBp, otherBp: input.kind === "new" ? renewalBp : newBp, days };
}
function computeCommissionCalc(input) {
  const { rateBp, otherBp, days } = validate(input);
  const premium = input.premium;
  const usd2 = formatUSD;
  const steps = [];
  const step = (id, label, working, amount) => {
    steps.push({ id, label, working, amount });
    return amount;
  };
  const commission = step("commission", `Commission at the ${KIND_LABEL[input.kind]} rate`, `${usd2(premium)} × ${pct(rateBp)} = ${usd2(applyRate(premium, rateBp))}`, applyRate(premium, rateBp));
  let otherRateCommission = null;
  if (otherBp !== void 0) {
    const other = input.kind === "new" ? "renewal" : "new";
    otherRateCommission = step("other-rate", `For comparison, the same premium at the ${KIND_LABEL[other]} rate`, `${usd2(premium)} × ${pct(otherBp)} = ${usd2(applyRate(premium, otherBp))}`, applyRate(premium, otherBp));
  }
  const c = input.cancellation;
  let returnPremium = 0;
  let chargeback = 0;
  if (c?.method === "dates" && days) {
    const back = divRound(premium * days.daysNotUsed, days.termDays);
    returnPremium = step("return-premium", "Return premium, pro rata by days", `${usd2(premium)} × ${days.daysNotUsed} days not used ÷ ${days.termDays} days in the term = ${usd2(back)}`, back);
  } else if (c?.method === "amount") {
    returnPremium = step("return-premium", "Return premium", `${usd2(c.returnPremium)} as entered`, c.returnPremium);
  }
  const earnedPremium = premium - returnPremium;
  let commissionKept = commission;
  if (c) {
    step("earned-premium", "Earned premium", `${usd2(premium)} − ${usd2(returnPremium)} = ${usd2(earnedPremium)}`, earnedPremium);
    chargeback = step("chargeback", `Chargeback at ${pct(rateBp)} of the return premium`, `${usd2(returnPremium)} × ${pct(rateBp)} = ${usd2(applyRate(returnPremium, rateBp))}`, applyRate(returnPremium, rateBp));
    commissionKept = step("kept", "Commission kept after the chargeback", `${usd2(commission)} − ${usd2(chargeback)} = ${usd2(commission - chargeback)}`, commission - chargeback);
  }
  let producer = null;
  let house = null;
  if (input.producerShareBp !== void 0) {
    const share = input.producerShareBp;
    const weights = [1e4 - share, share];
    const [housePaid = 0, producerPaid = 0] = allocate(commission, weights);
    step("producer-commission", `Producer share of the commission (${pct(share)})`, `${usd2(commission)} × ${pct(share)} = ${usd2(producerPaid)}`, producerPaid);
    step("house-commission", "House share of the commission", `${usd2(commission)} − ${usd2(producerPaid)} = ${usd2(housePaid)}`, housePaid);
    let houseBack = 0;
    let producerBack = 0;
    if (c) {
      [houseBack = 0, producerBack = 0] = allocate(chargeback, weights);
      step("producer-chargeback", `Producer share of the chargeback (${pct(share)})`, `${usd2(chargeback)} × ${pct(share)} = ${usd2(producerBack)}`, producerBack);
      step("house-chargeback", "House share of the chargeback", `${usd2(chargeback)} − ${usd2(producerBack)} = ${usd2(houseBack)}`, houseBack);
      step("producer-kept", "Producer keeps", `${usd2(producerPaid)} − ${usd2(producerBack)} = ${usd2(producerPaid - producerBack)}`, producerPaid - producerBack);
      step("house-kept", "House keeps", `${usd2(housePaid)} − ${usd2(houseBack)} = ${usd2(housePaid - houseBack)}`, housePaid - houseBack);
    }
    producer = { commission: producerPaid, chargeback: producerBack, kept: producerPaid - producerBack };
    house = { commission: housePaid, chargeback: houseBack, kept: housePaid - houseBack };
  }
  const figures = {
    input,
    steps,
    rateBp,
    commission,
    otherRateCommission,
    cancelled: c !== void 0,
    termDays: days?.termDays ?? null,
    daysInForce: days?.daysInForce ?? null,
    daysNotUsed: days?.daysNotUsed ?? null,
    returnPremium,
    earnedPremium,
    chargeback,
    commissionKept,
    producer,
    house
  };
  return { ...figures, checks: verifyCommissionCalc(figures) };
}
function bigRate(amount, bp) {
  return (2n * amount * BigInt(bp) + 10000n) / 20000n;
}
function bigProducerPart(total, shareBp) {
  return (2n * total * BigInt(shareBp) + 9999n) / 20000n;
}
function verifyCommissionCalc(r) {
  const { input } = r;
  const { rateBp, otherBp } = validate(input);
  const checks = new CheckList();
  const b = (n) => BigInt(n);
  const premium = b(input.premium);
  const usd2 = formatUSD;
  checks.equal("rate-used", "The rate applied is the one entered for this kind of term", rateBp, r.rateBp);
  const commission2 = bigRate(premium, rateBp);
  checks.equal("commission-second", "Commission, worked a second way", commission2.toString(), b(r.commission).toString());
  if (otherBp !== void 0) checks.equal("other-rate-second", "The comparison at the other rate, worked a second way", bigRate(premium, otherBp).toString(), r.otherRateCommission === null ? "not shown" : b(r.otherRateCommission).toString());
  const c = input.cancellation;
  let back2 = 0n;
  if (c?.method === "dates") {
    const term2 = pmDaysBetween(c.effectiveDate, c.expirationDate);
    const inForce2 = pmDaysBetween(c.effectiveDate, c.cancellationDate);
    checks.equal("days-second", "Days in the term and days in force, counted a second way", `${term2} and ${inForce2}`, `${r.termDays} and ${r.daysInForce}`);
    checks.equal("days-add", "Days in force plus days not used equal the days in the term", term2, (r.daysInForce ?? -1) + (r.daysNotUsed ?? -1));
    const notUsed2 = b(term2 - inForce2);
    back2 = (2n * premium * notUsed2 + b(term2)) / (2n * b(term2));
    checks.equal("return-second", "Return premium, worked a second way", back2.toString(), b(r.returnPremium).toString());
  } else if (c?.method === "amount") {
    back2 = b(c.returnPremium);
    checks.cents("return-entered", "The return premium used is the amount entered", c.returnPremium, r.returnPremium);
  }
  const chargeback2 = bigRate(back2, rateBp);
  if (c) {
    checks.that("cancelled-shown", "A cancellation was entered, so the return premium and the chargeback are shown", r.cancelled);
    checks.cents("earned-plus-return", "Earned premium plus return premium equals the premium", input.premium, r.earnedPremium + r.returnPremium);
    checks.equal("chargeback-second", "Chargeback, worked a second way", chargeback2.toString(), b(r.chargeback).toString());
    checks.cents("kept-plus-chargeback", "Commission kept plus the chargeback equals the commission", r.commission, r.commissionKept + r.chargeback);
    const onEarned = bigRate(premium - back2, rateBp);
    const gap = b(r.commissionKept) - onEarned;
    checks.that("kept-near-earned", "Commission kept is within one cent of the rate times the earned premium", gap >= -1n && gap <= 1n, `${usd2(r.commissionKept)} kept against ${usd2(Number(onEarned))} on the earned premium`);
    checks.that("chargeback-within", "The chargeback is not more than the commission", r.chargeback >= 0 && r.chargeback <= r.commission);
  } else {
    checks.that("no-cancellation", "No cancellation was entered, so no chargeback is shown and the whole commission is kept", !r.cancelled && r.returnPremium === 0 && r.chargeback === 0 && r.earnedPremium === input.premium && r.commissionKept === r.commission);
  }
  if (input.producerShareBp !== void 0) {
    const share = input.producerShareBp;
    const producerPaid2 = bigProducerPart(commission2, share);
    const producerBack2 = bigProducerPart(chargeback2, share);
    const p = r.producer;
    const hs = r.house;
    checks.equal("producer-second", "Producer share of the commission and of the chargeback, worked a second way", `${producerPaid2} and ${producerBack2}`, p ? `${p.commission} and ${p.chargeback}` : "not shown");
    checks.cents("shares-add", "Producer share plus house share equals the commission", r.commission, (p?.commission ?? 0) + (hs?.commission ?? 0));
    if (c) checks.cents("chargeback-shares-add", "Producer and house shares of the chargeback equal the chargeback", r.chargeback, (p?.chargeback ?? 0) + (hs?.chargeback ?? 0));
    checks.cents("kept-shares-add", "What the producer keeps plus what the house keeps equals the commission kept", r.commissionKept, (p?.kept ?? 0) + (hs?.kept ?? 0));
    checks.that("kept-is-difference", "Each side keeps its share of the commission less its share of the chargeback", p !== null && hs !== null && p.kept === p.commission - p.chargeback && hs.kept === hs.commission - hs.chargeback);
  } else {
    checks.that("no-shares", "No producer share was entered, so none is shown", r.producer === null && r.house === null);
  }
  const stepAmount = new Map(r.steps.map((s) => [s.id, s.amount]));
  const expected = [
    ["commission", r.commission],
    ["other-rate", r.otherRateCommission],
    ["return-premium", r.cancelled ? r.returnPremium : null],
    ["earned-premium", r.cancelled ? r.earnedPremium : null],
    ["chargeback", r.cancelled ? r.chargeback : null],
    ["kept", r.cancelled ? r.commissionKept : null],
    ["producer-commission", r.producer ? r.producer.commission : null],
    ["house-commission", r.house ? r.house.commission : null],
    ["producer-chargeback", r.producer && r.cancelled ? r.producer.chargeback : null],
    ["house-chargeback", r.house && r.cancelled ? r.house.chargeback : null],
    ["producer-kept", r.producer && r.cancelled ? r.producer.kept : null],
    ["house-kept", r.house && r.cancelled ? r.house.kept : null]
  ];
  const wanted = expected.filter(([, amount]) => amount !== null);
  checks.that("steps-shown", "The steps listed carry the same amounts as the result", wanted.length === r.steps.length && wanted.every(([id, amount]) => stepAmount.get(id) === amount));
  return checks.all;
}
function commissionCalcRules(r) {
  const out = [`Commission is the premium times the ${KIND_LABEL[r.input.kind]} rate entered (${pct(r.rateBp)}).`];
  const c = r.input.cancellation;
  if (c?.method === "dates") {
    out.push(
      `The term runs from ${c.effectiveDate} to ${c.expirationDate}: ${r.termDays} days. Days in force are counted from the effective date up to, not including, the cancellation date (${c.cancellationDate}): ${r.daysInForce} days, leaving ${r.daysNotUsed} days not used.`,
      "The return premium is pro rata by days. A carrier can work a return premium out another way; this page reads no policy or contract."
    );
  } else if (c?.method === "amount") {
    out.push("The return premium is the amount entered, for example from a cancellation notice.");
  }
  if (c) out.push("The chargeback is the return premium times the same rate.");
  if (r.input.producerShareBp !== void 0) out.push("The producer share is taken to the cent; an exact half cent goes to the house, so the two parts add up to the whole.");
  out.push("Each multiplication is rounded once to the cent, with half a cent rounding away from zero.");
  return out;
}
function commissionOneYearTermEnd(effectiveDate) {
  return anniversary(effectiveDate, 1);
}
function commissionCalcRows(r) {
  return [["Step", "Working", "Amount"], ...r.steps.map((s, i) => [`${i + 1}. ${s.label}`, s.working, toDecimal(s.amount)])];
}

// packages/core/src/insurance/splits.ts
var INS_HOUSE = "House";
var ruleKey = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
var payeeKey = (s) => `${s.house ? "H" : "P"}:${ruleKey(s.payee)}`;
function insSplitRule(key, houseBp, producers) {
  const shares = producers.map((p) => ({ payee: p.name.trim(), bp: p.bp }));
  if (houseBp !== 0) shares.unshift({ payee: INS_HOUSE, bp: houseBp, house: true });
  return { key, shares };
}
function validate2(input) {
  const seenRows = /* @__PURE__ */ new Set();
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.rowNumber)) throw new Error("Every line needs a whole row number.");
    if (seenRows.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the lines.`);
    seenRows.add(l.rowNumber);
    assertCents(l.commission, `commission on row ${l.rowNumber}`);
  }
  const rules = /* @__PURE__ */ new Map();
  for (const rule of input.rules) {
    const key = ruleKey(rule.key);
    const name = key === "" ? "the rule for all other lines" : `the rule for "${rule.key.trim()}"`;
    if (rules.has(key)) throw new Error(`There are two copies of ${name}.`);
    if (rule.shares.length === 0) throw new Error(`Add at least one share to ${name}.`);
    const seen = /* @__PURE__ */ new Set();
    let total = 0;
    for (const s of rule.shares) {
      if (ruleKey(s.payee) === "") throw new Error(`Every share in ${name} needs a name.`);
      if (!Number.isSafeInteger(s.bp) || s.bp < 0 || s.bp > 1e4) throw new Error(`The share for ${s.payee.trim()} in ${name} must be between 0% and 100%.`);
      if (seen.has(payeeKey(s))) throw new Error(`${s.payee.trim()} is listed twice in ${name}.`);
      seen.add(payeeKey(s));
      total += s.bp;
    }
    if (total === 0) throw new Error(`The shares in ${name} are all zero.`);
    rules.set(key, rule);
  }
  return rules;
}
function computeProducerSplits(input) {
  const rules = validate2(input);
  const lines = [];
  const unsplit = [];
  const payees = /* @__PURE__ */ new Map();
  for (const line of input.lines) {
    const rule = rules.get(ruleKey(line.ruleKey)) ?? rules.get("");
    if (!rule) {
      unsplit.push({ ...line });
      continue;
    }
    const amounts = allocate(line.commission, rule.shares.map((s) => s.bp));
    const parts = rule.shares.map((s, i) => ({ payee: s.payee.trim(), house: Boolean(s.house), bp: s.bp, amount: amounts[i] }));
    for (const p of parts) {
      let t = payees.get(payeeKey(p));
      if (!t) {
        t = { payee: p.payee, house: p.house, lines: 0, total: 0 };
        payees.set(payeeKey(p), t);
      }
      t.lines++;
      t.total = assertCents(t.total + p.amount, "payee total");
    }
    lines.push({ ...line, parts, bpTotal: rule.shares.reduce((n, s) => n + s.bp, 0) });
  }
  const list = [...payees.values()];
  const figures = {
    lines,
    unsplit,
    payees: list,
    houseTotal: sum(list.filter((p) => p.house).map((p) => p.total)),
    producerTotal: sum(list.filter((p) => !p.house).map((p) => p.total)),
    commissionTotal: sum(input.lines.map((l) => l.commission)),
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifyProducerSplits(input, figures) };
}
function verifyProducerSplits(input, r) {
  const rules = validate2(input);
  const checks = new CheckList();
  checks.that("rows-read", "Every row with data was read", r.problems.length === 0, `${r.problems.length} row(s) could not be read and are not in the result; first: row ${r.problems[0]?.rowNumber} (${r.problems[0]?.reason})`);
  const source = new Map(input.lines.map((l) => [l.rowNumber, l]));
  const placed = [...r.lines.map((l) => l.rowNumber), ...r.unsplit.map((l) => l.rowNumber)];
  checks.equal("count", "Lines in = lines split + lines with no rule (count)", input.lines.length, placed.length);
  checks.that("each-once", "Every line appears once, with the commission read from the file", new Set(placed).size === placed.length && [...r.lines, ...r.unsplit].every((l) => source.get(l.rowNumber)?.commission === l.commission));
  checks.that("every-line-split", "Every line has a split rule", r.unsplit.length === 0, `${r.unsplit.length} line(s) have no rule and are not split; first: row ${r.unsplit[0]?.rowNumber}`);
  let partsOff = 0;
  let percentOff = 0;
  let firstPercent = "";
  let ruleOff = 0;
  let total = 0n;
  let house = 0n;
  let producers = 0n;
  const perPayee = /* @__PURE__ */ new Map();
  for (const l of r.lines) {
    let lineSum = 0n;
    let bp = 0;
    for (let i = l.parts.length - 1; i >= 0; i--) {
      const p = l.parts[i];
      lineSum += BigInt(p.amount);
      bp += p.bp;
      if (p.house) house += BigInt(p.amount);
      else producers += BigInt(p.amount);
      const t = perPayee.get(payeeKey(p)) ?? { lines: 0, total: 0n };
      t.lines++;
      t.total += BigInt(p.amount);
      perPayee.set(payeeKey(p), t);
    }
    total += lineSum;
    if (lineSum !== BigInt(l.commission)) partsOff++;
    if (bp !== 1e4 || l.bpTotal !== bp) {
      percentOff++;
      if (!firstPercent) firstPercent = `row ${l.rowNumber} adds up to ${insBpText(bp)}%`;
    }
    const rule = rules.get(ruleKey(source.get(l.rowNumber)?.ruleKey ?? "")) ?? rules.get("");
    const want = rule ? allocate(l.commission, rule.shares.map((s) => s.bp)) : [];
    if (!rule || want.length !== l.parts.length || rule.shares.some((s, i) => l.parts[i].amount !== want[i] || l.parts[i].bp !== s.bp || payeeKey(l.parts[i]) !== payeeKey(s))) ruleOff++;
  }
  checks.that("line-splits", "Each line's splits add up to the line's commission", partsOff === 0, `${partsOff} line(s) do not add up`);
  checks.that("percent-100", "Split percentages add up to 100% on every line", percentOff === 0, `${percentOff} line(s) do not add up to 100%; first: ${firstPercent}`);
  checks.that("rule-applied", "Every part is the share its rule gives, recomputed line by line", ruleOff === 0, `${ruleOff} line(s) differ from their rule`);
  let commissionTotal = 0n;
  for (const l of input.lines) commissionTotal += BigInt(l.commission);
  checks.cents("totals", "Producer totals + house total = total commission", Number(commissionTotal), r.producerTotal + r.houseTotal);
  checks.cents("readd", "All split parts, added a second way, = total commission", Number(commissionTotal), Number(total));
  const payeesOk = r.payees.length === perPayee.size && r.payees.every((p) => {
    const t = perPayee.get(payeeKey(p));
    return t !== void 0 && t.lines === p.lines && t.total === BigInt(p.total);
  });
  checks.that("payee-totals", "Each payee's total is the sum of that payee's parts (second pass)", payeesOk && BigInt(r.houseTotal) === house && BigInt(r.producerTotal) === producers && BigInt(r.commissionTotal) === commissionTotal);
  return checks.all;
}
function producerPayoutRows(r, payee) {
  const rows = [["Row", "Policy number", "Insured name", "Line commission", "Share %", "Payout"]];
  for (const l of r.lines) {
    const part = l.parts.find((p) => payeeKey(p) === payeeKey(payee));
    if (part) rows.push([l.rowNumber, l.policy, l.insured, toDecimal(l.commission), insBpText(part.bp), toDecimal(part.amount)]);
  }
  rows.push(["", "", "Total", "", "", toDecimal(payee.total)]);
  return rows;
}
function producerSplitTables(r) {
  return {
    summary: [
      ["Payee", "Kind", "Lines", "Payout"],
      ...r.payees.map((p) => [p.payee, p.house ? "House" : "Producer", p.lines, toDecimal(p.total)]),
      ["Producers", "", "", toDecimal(r.producerTotal)],
      ["House", "", "", toDecimal(r.houseTotal)],
      ["Total commission", "", r.lines.length + r.unsplit.length, toDecimal(r.commissionTotal)]
    ],
    lines: [
      ["Row", "Policy number", "Insured name", "Producer code", "Line commission", "Payee", "Share %", "Payout"],
      ...r.lines.flatMap((l) => l.parts.map((p) => [l.rowNumber, l.policy, l.insured, l.ruleKey, toDecimal(l.commission), p.payee, insBpText(p.bp), toDecimal(p.amount)]))
    ],
    unsplit: [["Row", "Policy number", "Insured name", "Producer code", "Line commission"], ...r.unsplit.map((l) => [l.rowNumber, l.policy, l.insured, l.ruleKey, toDecimal(l.commission)])]
  };
}

// packages/core/src/insurance/surplusLinesList.ts
var SL_LIST_ROLES = ["policy", "insured", "state", "premium"];
var SL_LIST_LABELS = {
  policy: "Policy number",
  insured: "Insured",
  state: "Home state",
  premium: "Premium"
};
var SYNONYMS = {
  policy: INS_STATEMENT_SYNONYMS.policy,
  insured: INS_STATEMENT_SYNONYMS.insured,
  state: ["home state", "insured home state", "home state of insured", "home state code", "state", "state code", "st"],
  premium: ["premium", "gross premium", "premium amount", "written premium", "taxable premium", "net premium", "total premium"]
};
var REFUSE = {
  policy: INS_STATEMENT_REFUSE.policy ?? /\b(date|type|premium|holder)\b/,
  premium: /\b(rate|pct|percent|date|x|tax|fee|fees|charge)\b/,
  state: /\b(date|tax|total|premium|amount)\b/,
  insured: /\b(state|date|premium)\b/
};
function slGuessListColumns(rows, atHeaderRow) {
  const { headerRow, columns } = insGuessColumns(rows, ["policy", "premium", "state", "insured"], SYNONYMS, REFUSE, "premium", atHeaderRow);
  return { headerRow, columns };
}
var nameKey = (s) => s.trim().replace(/[.\s]+/g, " ").trim().toLowerCase();
function slStateCode(cell) {
  const s = nameKey(cell);
  if (s === "") return void 0;
  const m = REF_US_STATES_DC.find((x) => x.code.toLowerCase() === s.replace(/ /g, "") || nameKey(x.name) === s);
  return m?.code;
}
function slExtractPolicyLines(rows, mapping, defaultState = "") {
  if (rows.length <= mapping.headerRow + 1) throw new Error("The sheet has no rows under its header row.");
  const c = mapping.columns;
  const premiumCol = insNeedColumn(c.premium, SL_LIST_LABELS.premium, rows, mapping.headerRow);
  insAssertDistinct(c);
  const fallback = defaultState.trim() === "" ? "" : slStateCode(defaultState);
  if (fallback === void 0) throw new Error(`"${defaultState.trim()}" is not a state code or name. Type a two-letter code such as OR, or a state name.`);
  const lines = [];
  const problems = [];
  const totalRows = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || row.every((x) => x.trim() === "")) return;
    const rowNumber = index + 1;
    const policy = insCell(row, c.policy);
    const rawPremium = insCell(row, premiumCol);
    if (insIsTotalLabel(policy) || !policy && row.some(insIsTotalLabel)) {
      const total = { rowNumber };
      const amount = insOptionalCents(rawPremium, "total", []);
      if (amount !== void 0) total.premium = amount;
      totalRows.push(total);
      return;
    }
    const reasons = [];
    const premium = insOptionalCents(rawPremium, "premium", reasons);
    if (rawPremium === "") reasons.push("no premium");
    const rawState = insCell(row, c.state);
    let state = "";
    if (rawState === "") {
      if (fallback) state = fallback;
      else reasons.push("no home state");
    } else {
      const code = slStateCode(rawState);
      if (code) state = code;
      else reasons.push(`the home state "${rawState}" is not a state code or name`);
    }
    if (reasons.length || premium === void 0) {
      problems.push({ rowNumber, reason: reasons.join("; ") });
      return;
    }
    lines.push({ rowNumber, policy, insured: insCell(row, c.insured), state, premium });
  });
  if (lines.length === 0 && problems.length === 0) throw new Error("No policies were found under the header row. Check the header row and the column mapping.");
  return { lines, problems, totalRows };
}
var SL_TYPED_MAX_PPM = 1e5;
function slPercentToPpm(raw) {
  const s = raw.trim().replace(/%$/, "").trim();
  if (s === "") throw new Error("No rate was typed.");
  const v = scaledParse(s, 4, "rate");
  if (v < 0n) throw new Error(`The rate "${raw}" is less than zero.`);
  if (v > BigInt(SL_TYPED_MAX_PPM)) throw new Error(`The rate "${raw}" is above ${slPercentText(SL_TYPED_MAX_PPM)}.`);
  return Number(v);
}
function slTableFeeFor(code, day) {
  let r;
  try {
    r = sfListOffer(code, day, STAMPING_FEE_TABLE);
  } catch {
    return void 0;
  }
  return r ? { name: r.name, ppm: r.ppm, on: day, from: r.from, to: r.to, citation: r.citation, sourceUrl: r.sourceUrl, checkedOn: r.checkedOn } : void 0;
}
function slApplySigned(premium, ppm) {
  assertCents(premium, "premium");
  return premium < 0 ? 0 - slApplyPpm(-premium, ppm) : slApplyPpm(premium, ppm);
}
function typedMap(typed, table) {
  const out = /* @__PURE__ */ new Map();
  for (const t of typed ?? []) {
    const name = refMemberName(REF_US_STATES_DC, t.code);
    if (!REF_US_STATES_DC.some((m) => m.code === t.code)) throw new Error(`"${t.code}" is not a state code.`);
    if (out.has(t.code)) throw new Error(`${name} has rates typed twice.`);
    for (const [what, ppm] of [["tax rate", t.taxPpm], ["fee rate", t.feePpm]]) {
      if (ppm !== void 0 && (!Number.isSafeInteger(ppm) || ppm <= 0 || ppm > SL_TYPED_MAX_PPM)) {
        throw new Error(`The ${what} typed for ${name} must be above 0% and at most ${slPercentText(SL_TYPED_MAX_PPM)}.`);
      }
    }
    if (t.taxPpm !== void 0 && slRow(t.code, table)) throw new Error(`${name} has a row in the table, so its tax rate comes from the table and cannot be typed.`);
    if (t.feeFromTable !== void 0) {
      const offer = slTableFeeFor(t.code, t.feeFromTable);
      if (!offer) throw new Error(`The stamping fee table has no percent fee for ${name} for policies effective ${t.feeFromTable} that the tax table does not already carry.`);
      if (t.feePpm !== offer.ppm) throw new Error(`The fee for ${name} is marked as the stamping fee table's, but ${t.feePpm === void 0 ? "none is given" : slPercentText(t.feePpm)} is not that table's ${slPercentText(offer.ppm)}.`);
    }
    if (t.taxPpm !== void 0 || t.feePpm !== void 0) out.set(t.code, t);
  }
  return out;
}
function validateLines(lines) {
  const seen = /* @__PURE__ */ new Set();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.rowNumber)) throw new Error("Every policy needs a whole row number.");
    if (seen.has(l.rowNumber)) throw new Error(`Row number ${l.rowNumber} appears twice in the policy list.`);
    seen.add(l.rowNumber);
    assertCents(l.premium, `premium on row ${l.rowNumber}`);
    if (!REF_US_STATES_DC.some((m) => m.code === l.state)) throw new Error(`Row ${l.rowNumber} has no home state the list can use.`);
  }
}
function slStatesNeedingRate(lines, typed = [], table = SURPLUS_LINES_TAX_TABLE) {
  const codes = [...new Set(lines.map((l) => l.state))].filter((c) => !slRow(c, table) && typed.find((t) => t.code === c)?.taxPpm === void 0);
  return codes.map((c) => refMemberName(REF_US_STATES_DC, c)).sort();
}
var stateOrder = (a, b) => refMemberName(REF_US_STATES_DC, a).localeCompare(refMemberName(REF_US_STATES_DC, b));
function computeSurplusLinesList(input, table = SURPLUS_LINES_TAX_TABLE) {
  validateLines(input.lines);
  const typed = typedMap(input.typed, table);
  const missing = slStatesNeedingRate(input.lines, [...typed.values()], table);
  if (missing.length) throw new Error(`The rates table has no row for ${missing.join(", ")}. Type a tax rate for ${missing.length === 1 ? "it" : "each"} to work the list.`);
  const policies = input.lines.map((l) => {
    const row = slRow(l.state, table);
    const t = typed.get(l.state);
    const taxPpm = row ? row.taxPpm : t.taxPpm;
    const chargePpm = row?.charge?.ppm ?? 0;
    const feePpm = t?.feePpm ?? 0;
    const tax = slApplySigned(l.premium, taxPpm);
    const charge = slApplySigned(l.premium, chargePpm);
    const fee = slApplySigned(l.premium, feePpm);
    return {
      ...l,
      taxPpm,
      chargeName: row?.charge?.name ?? null,
      chargePpm,
      feePpm,
      tax,
      charge,
      fee,
      total: assertCents(tax + charge + fee, "policy total"),
      rateTyped: !row,
      feeTyped: feePpm > 0 && t?.feeFromTable === void 0,
      feeFromTable: feePpm > 0 && t?.feeFromTable !== void 0,
      conditions: row?.rateHasConditions ?? false
    };
  });
  const codes = [...new Set(policies.map((p) => p.state))].sort(stateOrder);
  const states = codes.map((code) => {
    const own = policies.filter((p) => p.state === code);
    const first = own[0];
    const row = slRow(code, table);
    return {
      code,
      name: refMemberName(REF_US_STATES_DC, code),
      rowNumbers: own.map((p) => p.rowNumber),
      policies: own.length,
      returns: own.filter((p) => p.premium < 0).length,
      premium: sum(own.map((p) => p.premium)),
      tax: sum(own.map((p) => p.tax)),
      charge: sum(own.map((p) => p.charge)),
      fee: sum(own.map((p) => p.fee)),
      total: sum(own.map((p) => p.total)),
      taxPpm: first.taxPpm,
      chargeName: first.chargeName,
      chargePpm: first.chargePpm,
      feePpm: first.feePpm,
      rateTyped: first.rateTyped,
      feeTyped: first.feeTyped,
      feeFromTable: first.feeFromTable,
      tableFee: first.feeFromTable ? slTableFeeFor(code, typed.get(code).feeFromTable) ?? null : null,
      conditions: first.conditions,
      citation: row?.citation ?? null,
      sourceUrl: row?.sourceUrl ?? null,
      checkedOn: row?.checkedOn ?? null
    };
  });
  const figures = {
    policies,
    states,
    lineCount: policies.length,
    premium: sum(policies.map((p) => p.premium)),
    tax: sum(policies.map((p) => p.tax)),
    charge: sum(policies.map((p) => p.charge)),
    fee: sum(policies.map((p) => p.fee)),
    total: sum(policies.map((p) => p.total)),
    problems: [...input.problems ?? []]
  };
  return { ...figures, checks: verifySurplusLinesList(input, figures, table) };
}
var isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
var big = (v) => isInt(v) ? BigInt(v) : 0n;
var abs = (v) => v < 0 ? -v : v;
function signedWithinHalfCent(premium, ppm, amount) {
  if (!isInt(premium) || !isInt(ppm) || !isInt(amount)) return false;
  if (premium === 0) return amount === 0;
  if (amount !== 0 && amount < 0 !== premium < 0) return false;
  return slWithinHalfCent(abs(premium), ppm, abs(amount));
}
function verifySurplusLinesList(input, r, table = SURPLUS_LINES_TAX_TABLE) {
  const typed = typedMap(input.typed, table);
  const checks = new CheckList();
  const problems = r.problems ?? [];
  checks.that("sl-list-rows-read", "Every row with data was read", problems.length === 0, `${problems.length} row(s) could not be read and are not in the totals; first: row ${problems[0]?.rowNumber} (${problems[0]?.reason})`);
  const ps = Array.isArray(r.policies) ? r.policies : [];
  const lines = input.lines;
  const sameLines = ps.length === lines.length && lines.every((l, i) => ps[i]?.rowNumber === l.rowNumber && ps[i]?.premium === l.premium && ps[i]?.state === l.state);
  checks.that("sl-list-policies", `Every policy read (${lines.length}) is in the result once, in list order, with its premium and home state as read`, sameLines, `${ps.length} in the result`);
  const badRates = [];
  const badMarks = [];
  for (const p of ps) {
    const row = slRow(p.state, table);
    const t = typed.get(p.state);
    const taxPpm = row ? row.taxPpm : t?.taxPpm;
    const chargePpm = row?.charge?.ppm ?? 0;
    const feePpm = t?.feePpm ?? 0;
    if (taxPpm === void 0 || p.taxPpm !== taxPpm || p.chargePpm !== chargePpm || p.feePpm !== feePpm || p.chargeName !== (row?.charge?.name ?? null)) badRates.push(`row ${p.rowNumber}`);
    const fromTable = feePpm > 0 && t?.feeFromTable !== void 0;
    if (p.rateTyped !== !row || p.feeTyped !== (feePpm > 0 && !fromTable) || p.feeFromTable !== fromTable || p.conditions !== (row?.rateHasConditions ?? false)) badMarks.push(`row ${p.rowNumber}`);
  }
  checks.that("sl-list-rates", "Each policy uses the table row’s rates for its home state, or the rates typed for that state", badRates.length === 0, `${badRates.length} policy(ies) differ; first: ${badRates[0]}`);
  const groups = Array.isArray(r.states) ? r.states : [];
  for (const s of groups) {
    const row = slRow(s.code, table);
    const feePpm = typed.get(s.code)?.feePpm ?? 0;
    const fromTable = feePpm > 0 && typed.get(s.code)?.feeFromTable !== void 0;
    if (s.rateTyped !== !row || s.feeTyped !== (feePpm > 0 && !fromTable) || s.feeFromTable !== fromTable || (row ? s.citation !== row.citation : s.citation !== null)) badMarks.push(s.code);
  }
  checks.that("sl-list-typed-marked", "Every typed rate is marked as typed, and nothing from the table is marked typed", badMarks.length === 0, `marked wrong: ${badMarks.slice(0, 5).join(", ")}`);
  const badTableFees = [];
  for (const s of groups) {
    const t = typed.get(s.code);
    if (t?.feeFromTable === void 0) {
      if (s.tableFee) badTableFees.push(`${s.code} shows a stamping fee table row it was not given`);
      continue;
    }
    const offer = slTableFeeFor(s.code, t.feeFromTable);
    const tf = s.tableFee;
    if (!offer || !tf || tf.ppm !== offer.ppm || tf.on !== offer.on || tf.citation !== offer.citation || tf.from !== offer.from || s.feePpm !== offer.ppm) badTableFees.push(s.code);
  }
  checks.that("sl-list-table-fee", "Every fee labeled as the stamping fee table’s is that table’s row for its home state on the date named", badTableFees.length === 0, `differ: ${badTableFees.join("; ")}`);
  const badMath = [];
  for (const p of ps) {
    const ok = signedWithinHalfCent(p.premium, p.taxPpm, p.tax) && signedWithinHalfCent(p.premium, p.chargePpm, p.charge) && signedWithinHalfCent(p.premium, p.feePpm, p.fee) && isInt(p.total) && big(p.tax) + big(p.charge) + big(p.fee) === BigInt(p.total);
    if (!ok) badMath.push(`row ${p.rowNumber}`);
  }
  checks.that(
    "sl-list-per-policy",
    "Each policy’s tax, second charge, and typed fee is its premium × the rate, half a cent rounded up on the premium without its sign (a return keeps its minus sign), checked by cross-multiplying; each total is their sum",
    badMath.length === 0,
    `${badMath.length} policy(ies) off; first: ${badMath[0]}`
  );
  const badCalc = [];
  for (const p of ps) {
    if (p.premium === 0 || !slRow(p.state, table) || !isInt(p.premium)) continue;
    const one = computeSurplusLinesTax(abs(p.premium), p.state, table);
    const sign = p.premium < 0 ? -1 : 1;
    if (one.tax * sign !== p.tax || one.charge * sign !== p.charge) badCalc.push(`row ${p.rowNumber}`);
  }
  checks.that("sl-list-calculator", "For every policy in a state the table has, the single-premium calculator on the rates page gives the same tax and second charge", badCalc.length === 0, `${badCalc.length} policy(ies) differ; first: ${badCalc[0]}`);
  const membership = /* @__PURE__ */ new Map();
  let groupOk = new Set(groups.map((s) => s.code)).size === groups.length;
  for (const s of groups) {
    for (const n of Array.isArray(s.rowNumbers) ? s.rowNumbers : []) {
      membership.set(n, (membership.get(n) ?? 0) + 1);
      if (ps.find((p) => p.rowNumber === n)?.state !== s.code) groupOk = false;
    }
    if (s.policies !== (Array.isArray(s.rowNumbers) ? s.rowNumbers.length : -1)) groupOk = false;
  }
  if (!ps.every((p) => membership.get(p.rowNumber) === 1) || membership.size !== ps.length) groupOk = false;
  checks.that("sl-list-one-group", "Every policy is in exactly one state group, the one for its home state", groupOk);
  const second = /* @__PURE__ */ new Map();
  const all = { premium: 0n, tax: 0n, charge: 0n, fee: 0n, total: 0n };
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    const g = second.get(p.state) ?? { n: 0, returns: 0, premium: 0n, tax: 0n, charge: 0n, fee: 0n, total: 0n };
    g.n++;
    if (p.premium < 0) g.returns++;
    g.premium += big(p.premium);
    g.tax += big(p.tax);
    g.charge += big(p.charge);
    g.fee += big(p.fee);
    g.total += big(p.total);
    second.set(p.state, g);
    all.premium += big(p.premium);
    all.tax += big(p.tax);
    all.charge += big(p.charge);
    all.fee += big(p.fee);
    all.total += big(p.total);
  }
  const offStates = groups.filter((s) => {
    const g = second.get(s.code);
    return !g || g.n !== s.policies || g.returns !== s.returns || g.premium !== big(s.premium) || g.tax !== big(s.tax) || g.charge !== big(s.charge) || g.fee !== big(s.fee) || g.total !== big(s.total) || !isInt(s.total);
  });
  checks.that("sl-list-state-totals", "Each state’s policies, premium, tax, second charge, typed fee, and total are the sums of its policies, added again a second way", offStates.length === 0 && second.size === groups.length, `differ: ${offStates.map((s) => s.code).join(", ")}`);
  const stateSum = (k) => groups.reduce((n, s) => n + big(s[k]), 0n);
  const grandOk = ["premium", "tax", "charge", "fee", "total"].every((k) => stateSum(k) === all[k] && big(r[k]) === all[k] && isInt(r[k])) && r.lineCount === ps.length;
  checks.that("sl-list-grand", "The state totals add up to the list totals (premium, tax, second charge, typed fee, and total), and the list totals to the policies", grandOk, `state totals ${formatUSD(Number(stateSum("total")))}, list total ${isInt(r.total) ? formatUSD(r.total) : String(r.total)}, policies ${formatUSD(Number(all.total))}`);
  if (input.listPremiumTotal !== void 0) {
    checks.cents("sl-list-total-row", "The premium on the policies equals the total row printed on the list", input.listPremiumTotal, Number(all.premium));
  }
  const csv = toCsv(surplusLinesListTables(r).byPolicy);
  let exported = Number.NaN;
  try {
    exported = sumCsvColumn(csv, "Total");
  } catch {
  }
  checks.that("sl-list-export-sum", "The Total column of the per-policy export, read back, adds up to the list total", exported === Number(all.total), `export ${Number.isSafeInteger(exported) ? formatUSD(exported) : "unreadable"}`);
  const tableFeeDays = [...new Set(groups.filter((s) => s.feeFromTable).map((s) => s.tableFee?.on ?? "?"))];
  if (tableFeeDays.length) {
    checks.that("sl-list-table-fee-date", "Every policy has the effective date the stamping fee table’s fees were taken for", false, `the stamping fee table's fees are its rates for policies effective ${tableFeeDays.join(", ")}; a policy effective on another day can fall under another rate`, "warning");
  }
  const typedStates = groups.filter((s) => s.rateTyped || s.feeTyped).map((s) => `${s.name} (${[s.rateTyped ? "tax rate" : "", s.feeTyped ? "fee" : ""].filter(Boolean).join(" and ")})`);
  checks.that("sl-list-typed", "Every rate used is from the rates table", typedStates.length === 0, `typed, not from the table: ${typedStates.join("; ")}`, "warning");
  const cond = groups.filter((s) => s.conditions).map((s) => s.name);
  checks.that("sl-list-conditions", "No home state on the list has conditions on its rate in the table", cond.length === 0, `the table's source puts conditions on the rate for ${cond.join(", ")} (see the row's note on the rates page); the figures are premium × the row's general rate`, "warning");
  const unnamed = ps.filter((p) => typeof p.policy !== "string" || p.policy.trim() === "").length;
  checks.that("sl-list-policy-named", "Every row names a policy number", unnamed === 0, `${unnamed} row(s) have none`, "warning");
  return checks.all;
}
var safeDec = (c) => isInt(c) ? toDecimal(c) : String(c);
var ratePct = (ppm) => isInt(ppm) && ppm >= 0 ? slPercentText(ppm) : String(ppm);
var sourceWord = (rateTyped, feeTyped, feeFromTable = false) => rateTyped ? feeTyped ? "Typed: tax rate and fee" : feeFromTable ? "Typed: tax rate; fee from the stamping fee table" : "Typed: tax rate" : feeTyped ? "Table; fee typed" : feeFromTable ? "Table; fee from the stamping fee table" : "Table";
function surplusLinesListTables(r) {
  const ps = Array.isArray(r.policies) ? r.policies : [];
  const ss = Array.isArray(r.states) ? r.states : [];
  return {
    byPolicy: [
      ["Row", "Policy number", "Insured", "Home state", "Premium", "Tax rate", "Tax", "Second charge rate", "Second charge", "Further fee rate", "Further fee", "Total", "Rates from"],
      ...ps.map((p) => [p.rowNumber, p.policy, p.insured, p.state, safeDec(p.premium), ratePct(p.taxPpm), safeDec(p.tax), p.chargePpm ? ratePct(p.chargePpm) : "", safeDec(p.charge), p.feePpm ? ratePct(p.feePpm) : "", safeDec(p.fee), safeDec(p.total), sourceWord(p.rateTyped, p.feeTyped, p.feeFromTable)])
    ],
    byState: [
      ["Home state", "Policies", "Returns", "Premium", "Tax rate", "Tax", "Second charge", "Further fee", "Total", "Rates from"],
      ...ss.map((s) => [`${s.name} (${s.code})`, s.policies, s.returns, safeDec(s.premium), ratePct(s.taxPpm), safeDec(s.tax), safeDec(s.charge), safeDec(s.fee), safeDec(s.total), sourceWord(s.rateTyped, s.feeTyped, s.feeFromTable)]),
      ["All states", r.lineCount, ss.reduce((n, s) => n + (isInt(s.returns) ? s.returns : 0), 0), safeDec(r.premium), "", safeDec(r.tax), safeDec(r.charge), safeDec(r.fee), safeDec(r.total), ""]
    ]
  };
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
    let filled = 0;
    let ok = true;
    for (const row of body) {
      const c = row[i];
      if (c === null || c === void 0 || c === "") continue;
      filled++;
      if (typeof c !== "string" || !DECIMAL_2.test(c)) {
        ok = false;
        break;
      }
    }
    if (ok && filled > 0) cols.add(i);
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
  const names = sheetNames(sheets);
  const files = {};
  const put = (path, xml) => {
    files[path] = strToU8(xml);
  };
  put(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"
  );
  put(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
  );
  put(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
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

// packages/core/src/property/templates.ts
function verifyTemplateWorkbook(sheets, bytes) {
  const checks = new CheckList();
  const read = readXlsx(bytes);
  checks.equal("sheets", "The workbook has the expected sheets, in order", sheets.map((s) => s.name).join(", "), read.map((s) => s.name).join(", "));
  sheets.forEach((s, i) => {
    const got = read[i];
    const header = (s.rows[0] ?? []).map((c) => String(c ?? "")).join(" | ");
    checks.equal(`header-${i}`, `${s.name}: header row reads back as written`, header, (got?.rows[0] ?? []).slice(0, (s.rows[0] ?? []).length).join(" | "));
    checks.equal(`rows-${i}`, `${s.name}: row count reads back as written`, s.rows.length, got?.rows.length ?? 0);
  });
  let formulas = false;
  for (const s of sheets) for (const row of s.rows) for (const c of row) if (typeof c === "string" && /^=/.test(c)) formulas = true;
  checks.that("values-only", "The workbook holds values only, no formulas", !formulas);
  return checks.all;
}

// packages/core/src/insurance/trackingTemplate.ts
var COMMISSION_TEMPLATE_MAX_ROWS = 200;
var COMMISSION_TEMPLATE_SHEETS = ["Month", "Carriers", "Producers", "Book of business", "Commission log", "Instructions"];
var COMMISSION_TEMPLATE_CARRIER_HEADERS = ["Line", "Carrier", "Statement total", "Payment received", "Date received", "Notes"];
var COMMISSION_TEMPLATE_PRODUCER_HEADERS = ["Line", "Producer", "Producer code", "House percent", "Producer percent"];
var COMMISSION_TEMPLATE_BOOK_HEADERS = ["Policy number", "Insured name", "Carrier", "Line of business", "Producer code", "Effective date", "Premium", "Expected rate %", "Expected commission"];
var COMMISSION_TEMPLATE_LOG_HEADERS = ["Carrier", "Policy number", "Insured name", "Line of business", "Transaction type", "Effective date", "Producer code", "Premium", "Commission rate %", "Commission amount"];
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > COMMISSION_TEMPLATE_MAX_ROWS) throw new Error(`${label} must be a whole number from 1 to ${COMMISSION_TEMPLATE_MAX_ROWS}.`);
  return value;
}
function cleanAgency(value) {
  const s = value.replace(/[\u0000-\u001f￾￿]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 120) throw new Error("The agency name is longer than 120 characters.");
  return s;
}
function cleanMonth(value) {
  const s = value.trim();
  if (s !== "" && !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(s)) throw new Error("The statement month must be a year and a month written as YYYY-MM.");
  return s;
}
function commissionTrackingTemplateSheets(o) {
  const agency = cleanAgency(o.agency);
  const month = cleanMonth(o.month);
  const carriers = count(o.carrierCount, "The number of carriers");
  const producers = count(o.producerCount, "The number of producers");
  const site = (o.siteUrl ?? "").trim().replace(/\/+$/, "");
  const page = (slug) => `${site}/insurance-commissions/${slug}/${site ? "?src=template" : ""}`;
  return [
    {
      name: COMMISSION_TEMPLATE_SHEETS[0],
      rows: [
        ["Item", "Value"],
        ["Agency", agency],
        ["Statement month", month],
        ["Prepared by", ""],
        ["Date prepared", ""]
      ],
      money: [],
      widths: [24, 36]
    },
    {
      name: COMMISSION_TEMPLATE_SHEETS[1],
      rows: [[...COMMISSION_TEMPLATE_CARRIER_HEADERS], ...Array.from({ length: carriers }, (_, i) => [i + 1, "", "", "", "", ""])],
      money: ["Statement total", "Payment received"],
      widths: [8, 34, 18, 18, 16, 40]
    },
    {
      name: COMMISSION_TEMPLATE_SHEETS[2],
      rows: [[...COMMISSION_TEMPLATE_PRODUCER_HEADERS], ...Array.from({ length: producers }, (_, i) => [i + 1, "", "", "", ""])],
      money: [],
      widths: [8, 30, 16, 16, 18]
    },
    {
      name: COMMISSION_TEMPLATE_SHEETS[3],
      rows: [[...COMMISSION_TEMPLATE_BOOK_HEADERS]],
      money: ["Premium", "Expected commission"],
      widths: [18, 32, 24, 22, 16, 16, 14, 18, 22]
    },
    {
      name: COMMISSION_TEMPLATE_SHEETS[4],
      rows: [[...COMMISSION_TEMPLATE_LOG_HEADERS]],
      money: ["Premium", "Commission amount"],
      widths: [24, 18, 32, 22, 18, 16, 16, 14, 20, 20]
    },
    {
      name: COMMISSION_TEMPLATE_SHEETS[5],
      rows: [
        ["Where", "What goes there"],
        ["About this workbook", "A layout to fill in for one month of agency commissions. It holds values only, with no formulas, so nothing in it calculates."],
        ["Month", "The agency and the statement month this workbook covers."],
        ["Carriers", `One row per carrier; rows are numbered 1 to ${carriers}. Statement total is the total printed on that carrier's statement for the month. Payment received is the check or deposit amount.`],
        ["Producers", `One row per producer; rows are numbered 1 to ${producers}. Producer code is the code that appears on commission lines. House percent and Producer percent on a row add up to 100.`],
        ["Book of business", "One row per policy, under the header row: what the policy is expected to pay this month. Fill in Expected commission, or Premium and Expected rate % (12.5 means 12.5%)."],
        ["Commission log", "One row per line on a carrier statement, under the header row, with the carrier named on every row. A chargeback is a negative Commission amount."],
        ["Adding rows", "Rows can be added under the last one on any sheet. Rows left blank are skipped when a sheet is opened in a tool."],
        ["Summary by carrier", `${page("commission-summary-by-carrier")} opens this workbook, adds the Commission log up by carrier and line of business, and compares each carrier with its row on the Carriers sheet.`],
        ["Expected versus paid", `${page("expected-vs-paid-reconciler")} takes this workbook in both boxes: the Book of business sheet is read as the book and the Commission log sheet as the statement.`],
        ["Producer splits", `${page("producer-split-calculator")} opens the Commission log sheet and divides each line by the rules typed on that page from the Producers sheet.`],
        ["One policy at a time", `${page("commission-calculator")} works out the commission on one policy, and a chargeback when it cancels.`]
      ],
      money: [],
      widths: [26, 130]
    }
  ];
}
function verifyCommissionTrackingTemplate(o, bytes) {
  const sheets = commissionTrackingTemplateSheets(o);
  const checks = new CheckList();
  checks.addAll(verifyTemplateWorkbook(sheets, bytes));
  const read = readXlsx(bytes);
  const rowsOf = (name) => read.find((s) => s.name === name)?.rows ?? [];
  const month = rowsOf(COMMISSION_TEMPLATE_SHEETS[0]);
  const cell = (label) => month.find((r) => r[0] === label)?.[1] ?? "";
  checks.equal("agency", "The Month sheet carries the agency name as typed", cleanAgency(o.agency), cell("Agency"));
  checks.equal("month", "The Month sheet carries the statement month as typed", cleanMonth(o.month), cell("Statement month"));
  const numbered = (name, n) => {
    const body = rowsOf(name).slice(1);
    return body.length === n && body.every((r, i) => r[0] === String(i + 1) && r.slice(1).every((c) => c === ""));
  };
  checks.that("carrier-rows", `The Carriers sheet has ${o.carrierCount} blank rows numbered 1 to ${o.carrierCount}`, numbered(COMMISSION_TEMPLATE_SHEETS[1], o.carrierCount));
  checks.that("producer-rows", `The Producers sheet has ${o.producerCount} blank rows numbered 1 to ${o.producerCount}`, numbered(COMMISSION_TEMPLATE_SHEETS[2], o.producerCount));
  const book = insGuessBookColumns(rowsOf(COMMISSION_TEMPLATE_SHEETS[3]));
  checks.that("book-readable", "Every part the reconciler reads from a book of business is found in the Book of business header row", book.headerRow === 0 && INS_BOOK_ROLES.every((role) => book.columns[role] >= 0));
  const log = rowsOf(COMMISSION_TEMPLATE_SHEETS[4]);
  const asStatement = insGuessStatementColumns(log);
  const asCarrierLines = insGuessCarrierColumns(log);
  checks.that(
    "log-readable",
    "Every part the statement, reconciler, split, and carrier summary tools read is found in the Commission log header row",
    asStatement.headerRow === 0 && INS_STATEMENT_ROLES.every((role) => asStatement.columns[role] >= 0) && asCarrierLines.headerRow === 0 && INS_CARRIER_ROLES.every((role) => asCarrierLines.columns[role] >= 0)
  );
  const carriers = insReadCarrierTotalsSheet(rowsOf(COMMISSION_TEMPLATE_SHEETS[1]));
  checks.that("carriers-readable", "The Carriers sheet is recognized as the list of statement totals, with nothing entered yet", carriers !== null && carriers.totals.length === 0 && carriers.problems.length === 0);
  return checks.all;
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
function preferSheet(file, prefer) {
  const sheet = file.sheets.find((s) => prefer.test(s.name) && s.rows.some((r) => r.some((cell) => cell.trim() !== "")));
  return sheet ? { ...file, rows: sheet.rows } : file;
}

// packages/agents/src/registry/insurance-commissions.ts
var usd = formatUSD;
var LOG_SHEET = /^commission log$/i;
var BOOK_SHEET = /^book of business$/i;
var CARRIERS_SHEET = /^carriers$/i;
var filledSheets = (file) => file.sheets.filter((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
var RATE_FORMATS = ["percent", "fraction"];
function rateFormatInput(name, what) {
  return {
    name,
    kind: "choice",
    label: `How ${what} are written`,
    description: `Optional. "percent" when 12.5 means 12.5%, "fraction" when 0.125 means 12.5%. A cell with a % sign is always a percent. Without it, read from the column: fraction when every filled rate is a plain number below 1.`,
    required: false,
    choices: RATE_FORMATS
  };
}
function rateFormatOf(rows, headerRow, col, given) {
  if (given === "percent" || given === "fraction") return given;
  return insGuessRateFormat(rows, headerRow, col);
}
function amountText(raw, what) {
  try {
    return parseAmount(raw);
  } catch (err2) {
    throw new AgentInputError(`${what} "${raw}" is not an amount in dollars and cents (${err2 instanceof Error ? err2.message : "not an amount"}).`);
  }
}
function percentBp(raw, what) {
  if (raw === void 0) return void 0;
  const s = raw.trim().replace(/%$/, "").trim();
  let bp;
  try {
    bp = percentToBasisPoints(s);
  } catch {
    throw new AgentInputError(`${what} "${raw}" must be a percent from 0 to 100 with at most two decimals, such as 15 or 12.5.`);
  }
  if (bp > 1e4) throw new AgentInputError(`${what} "${raw}" is more than 100%.`);
  return bp;
}
function namedList(text, what, example) {
  if (text === void 0 || text.trim() === "") return [];
  const t = text.trim();
  if (t.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      throw new AgentInputError(`"${what}" starts with "{" but is not a JSON object. Write it as "${example}".`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AgentInputError(`"${what}" must be written as "${example}".`);
    return Object.entries(parsed).map(([k, v]) => [k.trim(), typeof v === "number" ? String(v) : String(v ?? "").trim()]);
  }
  const pieces = [];
  for (const line of t.split(/[;\n]/)) {
    let cur = "";
    for (const tok of line.split(",")) {
      if (/[=:]/.test(cur) && /[=:]/.test(tok)) {
        pieces.push(cur);
        cur = tok;
      } else cur = cur === "" ? tok : `${cur},${tok}`;
    }
    if (cur.trim() !== "") pieces.push(cur);
  }
  return pieces.map((p) => {
    const eq = p.lastIndexOf("=");
    const at = eq >= 0 ? eq : p.lastIndexOf(":");
    const name = at < 0 ? "" : p.slice(0, at).trim();
    const value = at < 0 ? "" : p.slice(at + 1).trim();
    if (name === "" || value === "") throw new AgentInputError(`"${what}" must be written as "${example}", separated by semicolons or new lines: "${p.trim()}".`);
    return [name, value];
  });
}
function dayOf(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
var plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
var commissionCalculator = {
  name: "insurance_commission_calculator",
  page: "insurance-commissions/commission-calculator",
  section: "insurance-commissions",
  kind: "tool",
  title: "Insurance commission on one policy, with the chargeback on a cancellation",
  description: "Works out the commission on one insurance policy step by step: premium times the new business or renewal rate, and, when the policy was cancelled, the return premium pro rata by days (or as typed from a cancellation notice), the chargeback at the same rate and the commission kept; with a producer share, the producer and house parts to the cent. Every step is worked a second time with separate whole-number arithmetic, the day counts are recounted, and kept plus chargeback is checked to equal the commission. Use it when someone asks what the commission is on a premium, or how much commission comes back when a policy cancels mid-term. Not for a short-rate table or a minimum earned premium, and not for a whole statement of lines.",
  question: "A $4,800 policy written January 15 at 15% new business commission cancelled May 15. What is the chargeback and what do I keep?",
  inputs: [
    { name: "premium", kind: "amount", label: "Premium for the term", description: "The premium for the policy term, in dollars, such as 4800.00.", required: true },
    { name: "termKind", kind: "choice", label: "This term is", description: '"new" for new business or "renewal" for a renewal: picks which rate is applied.', required: true, choices: ["new", "renewal"] },
    { name: "newBusinessRate", kind: "number", label: "New business rate (%)", description: "The new business commission rate as a percent with at most two decimals, such as 15 or 12.5. Needed when the term is new business; with a renewal it is shown for comparison.", required: false },
    { name: "renewalRate", kind: "number", label: "Renewal rate (%)", description: "The renewal commission rate as a percent, such as 10. Needed when the term is a renewal; with new business it is shown for comparison.", required: false },
    { name: "producerShare", kind: "number", label: "Producer share of the commission (%)", description: "Optional. The producer's percent of the commission, such as 40; the house keeps the rest.", required: false },
    { name: "effectiveDate", kind: "date", label: "Effective date", description: "For a cancellation worked from dates: the day the term started, YYYY-MM-DD.", required: false },
    { name: "expirationDate", kind: "date", label: "Expiration date", description: "For a cancellation worked from dates: the day the term ends, YYYY-MM-DD. Without it, one year after the effective date.", required: false },
    { name: "cancellationDate", kind: "date", label: "Cancellation date", description: "For a cancellation worked from dates: the day the policy was cancelled, YYYY-MM-DD. Days in force run up to, not including, this day.", required: false },
    { name: "returnPremium", kind: "amount", label: "Return premium", description: "For a cancellation with the return premium already known (from a cancellation notice): the amount, instead of the dates.", required: false }
  ],
  limits: "site",
  notAdvice: "Mathproven applies the rates and dates given and proves the arithmetic; it makes no statement about what any carrier contract, commission schedule or producer agreement requires.",
  run({ values }) {
    const premium = values.premium;
    const kind = values.termKind === "renewal" ? "renewal" : "new";
    const newRateBp = percentBp(values.newBusinessRate, "The new business rate");
    const renewalRateBp = percentBp(values.renewalRate, "The renewal rate");
    const producerShareBp = percentBp(values.producerShare, "The producer share");
    const effective = values.effectiveDate;
    const expiration = values.expirationDate;
    const cancelled = values.cancellationDate;
    const back = values.returnPremium;
    const anyDate = effective !== void 0 || expiration !== void 0 || cancelled !== void 0;
    if (back !== void 0 && anyDate) throw new AgentInputError("Give the cancellation either as dates or as the return premium amount, not both.");
    let cancellation;
    if (back !== void 0) cancellation = { method: "amount", returnPremium: back };
    else if (anyDate) {
      if (cancelled === void 0) throw new AgentInputError("The effective and expiration dates are used only for a cancellation: give the cancellation date too, or leave the dates out.");
      if (effective === void 0) throw new AgentInputError("A cancellation worked from dates needs the effective date.");
      let end = expiration;
      if (end === void 0) {
        try {
          end = commissionOneYearTermEnd(effective);
        } catch (err2) {
          throw new AgentInputError(err2 instanceof Error ? err2.message : "The expiration date could not be worked out.");
        }
      }
      cancellation = { method: "dates", effectiveDate: effective, expirationDate: end, cancellationDate: cancelled };
    }
    const input = {
      premium,
      kind,
      ...newRateBp === void 0 ? {} : { newRateBp },
      ...renewalRateBp === void 0 ? {} : { renewalRateBp },
      ...producerShareBp === void 0 ? {} : { producerShareBp },
      ...cancellation ? { cancellation } : {}
    };
    const r = computeCommissionCalc(input);
    const result = [["Item", "Amount"], ["Commission", toDecimal(r.commission)]];
    if (r.cancelled) result.push(["Return premium", toDecimal(r.returnPremium)], ["Chargeback", toDecimal(-r.chargeback)], ["Commission kept", toDecimal(r.commissionKept)]);
    if (r.producer && r.house) result.push([r.cancelled ? "Producer keeps" : "Producer share", toDecimal(r.producer.kept)], [r.cancelled ? "House keeps" : "House share", toDecimal(r.house.kept)]);
    const parts = [`Commission ${usd(r.commission)}: ${usd(premium)} at the ${kind === "new" ? "new business" : "renewal"} rate of ${insBpText(r.rateBp)}%.`];
    if (r.otherRateCommission !== null) parts.push(`At the ${kind === "new" ? "renewal" : "new business"} rate it would be ${usd(r.otherRateCommission)}.`);
    if (r.cancelled) {
      if (r.termDays !== null) parts.push(`The term is ${r.termDays} days and the policy was in force for ${r.daysInForce} of them, leaving ${r.daysNotUsed} days not used.`);
      parts.push(`Return premium ${usd(r.returnPremium)}, earned premium ${usd(r.earnedPremium)}, chargeback ${usd(r.chargeback)}, commission kept ${usd(r.commissionKept)}.`);
    }
    if (r.producer && r.house) parts.push(`The producer ${r.cancelled ? "keeps" : "gets"} ${usd(r.producer.kept)} and the house ${usd(r.house.kept)}.`);
    return {
      summary: parts.join(" "),
      tables: [
        { name: "Steps", rows: commissionCalcRows(r) },
        { name: "Result", rows: result },
        { name: "Rules", rows: [["Rule"], ...commissionCalcRules(r).map((t) => [t])] }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: $4,800.00 new business at 15% (renewal 10%), producer 40%, January 15, 2026 to January 15, 2027, cancelled May 15, 2026",
      args: { premium: "4800.00", termKind: "new", newBusinessRate: "15", renewalRate: "10", producerShare: "40", effectiveDate: "2026-01-15", expirationDate: "2027-01-15", cancellationDate: "2026-05-15" },
      verified: true,
      contains: ["$720.00", "$480.00", "245 days not used", "$3,221.92", "$1,578.08", "$483.29", "$236.71", "$288.00", "$432.00", "$193.32", "$289.97", "$94.68", "$142.03"]
    }
  ]
};
var STATEMENT_COLUMNS = { roles: INS_STATEMENT_ROLES, labels: INS_STATEMENT_LABELS, required: ["commission"], guess: (rows, at) => insGuessStatementColumns(rows, at) };
var statementToExcel = {
  name: "commission_statement_to_excel",
  page: "insurance-commissions/commission-statement-to-excel",
  section: "insurance-commissions",
  kind: "tool",
  title: "Commission statement to clean rows, tied to the statement total",
  description: "Reads an insurance commission statement spreadsheet (.csv or .xlsx) in any layout and turns it into one clean row per statement line: policy number, insured, line, transaction type, effective date, producer, premium, rate and commission. The lines are added up and compared with the statement total and the payment received when they are given, and with the file's own total row when it has exactly one; premium times rate is compared with the commission on every row that shows both, and rows that differ are listed. Use it when someone wants a carrier's commission statement as a normalized table, or wants to know whether a statement's lines add up to what was paid. Not for PDF statements, and not for comparing a statement with a book of business.",
  question: "Can you turn this commission statement into clean rows and check that it adds up to the $1,064 we were paid?",
  inputs: [
    { name: "statement", kind: "file", label: "Commission statement", description: 'A .csv or .xlsx file (a path, or the CSV text) with a header row and one row per statement line. Only the commission amount column is needed; policy number, insured, line, transaction type, effective date, premium, commission rate and producer are read when present. Title rows above the header and a total row are handled. In a workbook, a sheet named "Commission log" is read when there is one.', required: true },
    { name: "statementTotal", kind: "amount", label: "Statement total", description: "Optional. The total printed on the statement, compared with the sum of the lines.", required: false },
    { name: "paymentReceived", kind: "amount", label: "Payment received", description: "Optional. The check or deposit amount received, compared with the sum of the lines.", required: false },
    rateFormatInput("rateFormat", "rates"),
    columnsInput("Commission statement", STATEMENT_COLUMNS)
  ],
  limits: "site",
  // The statement total and the payment are typed by the person; the file's own total row is not, so it is not listed.
  comparisonChecks: ["lines-total", "lines-payment", "total-payment"],
  notAdvice: "Mathproven adds up the lines in the file and compares them with the totals given; it makes no statement about what any carrier contract or commission schedule requires.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "statement"), LOG_SHEET);
    const m = mapColumns(file, STATEMENT_COLUMNS, values.columns, "Commission statement");
    const mapping = { ...m, rateFormat: rateFormatOf(file.rows, m.headerRow, m.columns.rate, values.rateFormat) };
    const read = insExtractStatementLines(file.rows, mapping);
    const fileTotals = read.totalRows.filter((t) => t.commission !== void 0);
    const fileTotal = read.totalRows.length === 1 && fileTotals.length === 1 ? fileTotals[0].commission : void 0;
    const statementTotal = values.statementTotal;
    const paymentAmount = values.paymentReceived;
    const r = normalizeCommissionStatement({
      lines: read.lines,
      problems: read.problems,
      ...statementTotal === void 0 ? {} : { statementTotal },
      ...paymentAmount === void 0 ? {} : { paymentAmount },
      ...fileTotal === void 0 ? {} : { fileTotal }
    });
    const totals = [["Item", "Amount"], ["Sum of commission lines", toDecimal(r.commissionTotal)], ["Premium total", toDecimal(r.premiumTotal)]];
    if (r.statementTotal !== void 0) totals.push(["Statement total entered", toDecimal(r.statementTotal)]);
    if (r.paymentAmount !== void 0) totals.push(["Payment received entered", toDecimal(r.paymentAmount)]);
    if (r.fileTotal !== void 0) totals.push(["The file's own total row", toDecimal(r.fileTotal)]);
    const compared = [r.statementTotal !== void 0 ? `the statement total ${usd(r.statementTotal)}` : "", r.paymentAmount !== void 0 ? `the payment received ${usd(r.paymentAmount)}` : "", r.fileTotal !== void 0 ? `the file's own total row ${usd(r.fileTotal)}` : ""].filter(Boolean);
    const leftOut = read.totalRows.length ? ` ${plural(read.totalRows.length, "total row")} in the file (row ${read.totalRows.map((t) => t.rowNumber).join(", ")}) left out of the lines.` : "";
    return {
      summary: `${plural(r.lineCount, "line")} read: commission ${usd(r.commissionTotal)} on ${usd(r.premiumTotal)} of premium${compared.length ? `, compared with ${compared.join(", ")}` : ""}. Premium × rate was compared on ${plural(r.rateRows, "row")} and differs from the commission on ${r.mismatches.length}.${leftOut}`,
      tables: [
        { name: "Commission lines", rows: commissionStatementRows(r.lines) },
        { name: "Totals", rows: totals },
        { name: "Rate differences", rows: commissionStatementRows(r.mismatches) }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: five lines with a title row and a total row, statement total and payment $1,064.00",
      args: { statement: "fixture:insurance/commission-statement.csv", statementTotal: "1064.00", paymentReceived: "1064.00" },
      verified: true,
      contains: [
        "5 lines read: commission $1,064.00 on $10,143.32 of premium",
        "Premium × rate was compared on 5 rows and differs from the commission on 0.",
        "| Sum of commission lines | 1064.00 |",
        "| 5 | POL-10023 | Northside Dental PC | Workers compensation | Renewal | 2026-02-01 | LEE | 3333.33 | 7.50 | 250.00 | 250.00 | 0.00 |",
        "| 7 | POL-10025 | Harbor Cycle Shop | General liability | New | 2026-02-12 |  | 999.99 | 12.50 | 125.00 | 125.00 | 0.00 |"
      ]
    },
    {
      label: "The page's own variation: the second line reads $125.01, so the lines add up to $1,064.01 and do not tie",
      args: {
        statement: "Policy #,Insured,Premium,Comm %,Commission\nPOL-10021,Maple Street Bakery LLC,4800.00,12.5,600.00\nPOL-10022,Jordan Rivera,1250.00,10,125.01\nPOL-10023,Northside Dental PC,3333.33,7.5,250.00\nPOL-10024,Avery Chen,-240.00,15,-36.00\nPOL-10025,Harbor Cycle Shop,999.99,12.5,125.00\n",
        statementTotal: "1064.00",
        paymentReceived: "1064.00"
      },
      verified: false,
      failedCheck: "lines-total"
    },
    {
      label: "A statement total typed as $1,065.00 does not tie: the lines are shown beneath the failed comparison",
      args: { statement: "fixture:insurance/commission-statement.csv", statementTotal: "1065.00" },
      verified: false,
      failedCheck: "lines-total",
      contains: ["expected $1,065.00, found $1,064.00", "| Sum of commission lines | 1064.00 |"]
    },
    {
      label: "A statement row whose commission cannot be read is not verified",
      args: { statement: "Policy #,Insured,Commission\nPOL-1,Ann Lee,100.00\nPOL-2,Bo Diaz,1OO.00\n", statementTotal: "200.00" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var CARRIER_COLUMNS = { roles: INS_CARRIER_ROLES, labels: INS_CARRIER_LABELS, required: ["commission"], guess: (rows, at) => insGuessCarrierColumns(rows, at) };
var carrierSummary = {
  name: "commission_summary_by_carrier",
  page: "insurance-commissions/commission-summary-by-carrier",
  section: "insurance-commissions",
  kind: "tool",
  title: "Commission summary by carrier and line of business, tied to each statement",
  description: "Rolls a month of insurance commission lines (.csv or .xlsx, one row per line with the carrier on it, such as a commission log) up by carrier and by line of business within each carrier. Each carrier's lines are compared with the total printed on its statement and the payment received when they are given, and every subtotal is rebuilt a second way from the lines; carrier totals and line-of-business totals must both add up to all the commission. Carrier names match ignoring case and extra spaces. When the workbook has a Carriers sheet with statement totals (the commission tracking template), those totals are read too. Use it when someone asks for commission by carrier or by line of business for a month, or whether each carrier paid what its lines add up to. Not for comparing lines with a book of business, and not for one policy.",
  question: "Here is February's commission log. Can you total it by carrier and line of business and check each carrier against its statement total?",
  inputs: [
    { name: "commissionLines", kind: "file", label: "Commission lines", description: 'A .csv or .xlsx file (a path, or the CSV text) with one row per commission line. The commission amount is needed; carrier, line of business, policy number and premium are read when present. In a workbook, a sheet named "Commission log" is read, and a sheet named "Carriers" with statement totals and payments is read as those totals.', required: true },
    { name: "statementTotals", kind: "text", label: "Statement total for each carrier", description: `Optional. The total printed on each carrier's statement, as "<carrier> = <amount>" separated by semicolons or new lines, for example "Carrier A = 689.00; Carrier B = 625.00". A carrier given here replaces its total from a Carriers sheet.`, required: false },
    { name: "paymentsReceived", kind: "text", label: "Payment received from each carrier", description: 'Optional. The check or deposit from each carrier, written the same way: "Carrier A = 689.00; Carrier B = 625.00".', required: false },
    { name: "defaultCarrier", kind: "text", label: "Carrier for rows that name none", description: "Optional. For a file from one carrier with no carrier column, or rows with a blank carrier: the carrier's name.", required: false },
    columnsInput("Commission lines", CARRIER_COLUMNS)
  ],
  limits: "site",
  // Each carrier's statement total and payment are typed by the person (or read from the Carriers sheet they filled in).
  comparisonChecks: ["statement-totals", "payments"],
  notAdvice: "Mathproven shows the arithmetic difference between the lines in the file and the totals given; it makes no statement about what any carrier contract or commission schedule requires.",
  run({ files, values }) {
    const opened = oneFile(files, "commissionLines");
    const file = preferSheet(opened, LOG_SHEET);
    const m = mapColumns(file, CARRIER_COLUMNS, values.columns, "Commission lines");
    const read = insExtractCarrierLines(file.rows, m, values.defaultCarrier ?? "");
    const carriersSheet = opened.sheets.length > 1 ? filledSheets(opened).find((s) => s.rows !== file.rows && CARRIERS_SHEET.test(s.name)) : void 0;
    const fromSheet = carriersSheet ? insReadCarrierTotalsSheet(carriersSheet.rows) : null;
    const totals = /* @__PURE__ */ new Map();
    for (const t2 of fromSheet?.totals ?? []) totals.set(insGroupKey(t2.carrier), { ...t2 });
    const typed = (text, input, field) => {
      const seen = /* @__PURE__ */ new Set();
      for (const [name, raw] of namedList(text, input, "Carrier A = 689.00; Carrier B = 625.00")) {
        const key = insGroupKey(name);
        if (seen.has(key)) throw new AgentInputError(`"${input}" names ${name} twice.`);
        seen.add(key);
        const t2 = totals.get(key) ?? { carrier: name };
        t2[field] = amountText(raw, `The amount for ${name} in "${input}"`);
        totals.set(key, t2);
      }
    };
    typed(values.statementTotals, "statementTotals", "statementTotal");
    typed(values.paymentsReceived, "paymentsReceived", "paymentReceived");
    const r = summarizeCommissionsByCarrier({
      lines: read.lines,
      statementTotals: [...totals.values()],
      problems: [...read.problems, ...(fromSheet?.problems ?? []).map((p) => ({ rowNumber: p.rowNumber, reason: `Carriers sheet: ${p.reason}` }))]
    });
    const t = carrierSummaryTables(r);
    const compared = r.carriers.filter((c) => c.statementTotal !== void 0 || c.paymentReceived !== void 0);
    const differ = compared.filter((c) => (c.statementDifference ?? 0) !== 0 || (c.paymentDifference ?? 0) !== 0);
    const notes = [
      fromSheet?.totals.length ? `Amounts for ${plural(fromSheet.totals.length, "carrier")} were read from the workbook's Carriers sheet.` : "",
      read.totalRows.length ? `${plural(read.totalRows.length, "total row")} in the file left out of the lines.` : ""
    ].filter(Boolean);
    return {
      summary: `${plural(r.lineCount, "line")} from ${plural(r.carriers.length, "carrier")}: commission ${usd(r.commissionTotal)} on ${usd(r.premiumTotal)} of premium. By carrier: ${r.carriers.map((c) => `${c.carrier} ${usd(c.commission)}`).join(", ")}. ${compared.length} of ${r.carriers.length} carrier(s) compared with a statement total or payment; ${differ.length} differ.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      tables: [
        { name: "By carrier", rows: t.byCarrier },
        { name: "Each carrier against its statement total", rows: t.againstStatements },
        { name: "Each carrier against the payment received", rows: t.againstPayments },
        { name: "By carrier and line of business", rows: t.byCarrierAndProduct },
        { name: "By line of business, all carriers", rows: t.byProduct },
        { name: "Totals", rows: [["Item", "Amount"], ["Commission total, all carriers", toDecimal(r.commissionTotal)], ["Premium total", toDecimal(r.premiumTotal)]] }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: nine February lines from three carriers, statement totals $689.00, $625.00 and $495.00",
      args: { commissionLines: "fixture:insurance/commission-log.csv", statementTotals: "Carrier A = 689.00; Carrier B = 625.00; Carrier C = 495.00" },
      verified: true,
      contains: [
        "9 lines from 3 carriers: commission $1,809.00 on $16,343.32 of premium. By carrier: Carrier A $689.00, Carrier B $625.00, Carrier C $495.00.",
        "| Carrier A | 3 | 5810.00 | 689.00 |",
        "| Carrier B | 3 | 6333.32 | 625.00 |",
        "| Carrier C | 3 | 4200.00 | 495.00 |",
        "| Carrier B | 625.00 | 625.00 | 0.00 |",
        "| Commercial package | 2 | 6800.00 | 850.00 |",
        "| General liability | 1 | 999.99 | 125.00 |",
        "| Homeowners | 2 | 1260.00 | 189.00 |",
        "| Personal auto | 3 | 3950.00 | 395.00 |",
        "| Workers compensation | 1 | 3333.33 | 250.00 |"
      ]
    },
    {
      label: "The page's own variation: Carrier B's statement total typed as $650.00 does not tie to its lines",
      args: { commissionLines: "fixture:insurance/commission-log.csv", statementTotals: "Carrier A = 689.00; Carrier B = 650.00; Carrier C = 495.00" },
      verified: false,
      failedCheck: "statement-totals",
      // Only the typed total differs, so the lines' own figures are shown beneath it, as on the page, to find the difference.
      contains: ["Carrier B: lines $625.00, statement total $650.00", "| Carrier B | 625.00 | 650.00 | -25.00 |"]
    }
  ]
};
var ROWS_TO_FILL = {
  Month: () => "Agency and statement month filled in",
  Carriers: (o) => `${o.carrierCount} numbered`,
  Producers: (o) => `${o.producerCount} numbered`,
  "Book of business": () => "One per policy, under the header row",
  "Commission log": () => "One per statement line, under the header row",
  Instructions: () => "What each sheet holds"
};
function templateCount(raw, fallback, what) {
  if (raw === void 0) return fallback;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 200) throw new AgentInputError(`${what} must be a whole number from 1 to 200.`);
  return Number(s);
}
var fileSlug = (text) => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
var trackingTemplate = {
  name: "commission_tracking_template",
  page: "insurance-commissions/commission-tracking-template",
  section: "insurance-commissions",
  kind: "template",
  title: "Insurance commission tracking workbook for one month (Excel)",
  description: "Builds a blank Excel workbook for tracking one month of an insurance agency's commissions: a Month sheet with the agency and statement month, a Carriers sheet with numbered rows for each carrier's statement total and payment, a Producers sheet with split percents, a Book of business sheet, a Commission log and an Instructions sheet. Values only, no formulas. The finished file is read back before it is handed over: sheet names, header rows and row counts are compared with what was asked for, and the Book of business and Commission log header rows are matched the way the commission tools match them. Use it when someone wants a commission tracking spreadsheet or template to fill in. Not for calculating anything: the workbook holds no formulas.",
  question: "Can you make me a commission tracking spreadsheet for February for an agency with 12 carriers and 4 producers?",
  inputs: [
    { name: "agency", kind: "text", label: "Agency name", description: "Optional. The agency name for the Month sheet and the file name, at most 120 characters.", required: false },
    { name: "month", kind: "text", label: "Statement month", description: "Optional. The month the workbook covers, written YYYY-MM, such as 2026-02.", required: false },
    { name: "carrierCount", kind: "number", label: "Number of carriers", description: "Optional. How many numbered rows the Carriers sheet starts with, a whole number from 1 to 200. Without it, 10.", required: false },
    { name: "producerCount", kind: "number", label: "Number of producers", description: "Optional. How many numbered rows the Producers sheet starts with, a whole number from 1 to 200. Without it, 3.", required: false }
  ],
  limits: "free",
  notAdvice: "Mathproven builds a layout to fill in, with values only; the workbook does not calculate, and nothing in it says what any carrier or producer is owed.",
  run({ values }) {
    const options = {
      agency: values.agency ?? "",
      month: values.month ?? "",
      carrierCount: templateCount(values.carrierCount, 10, "The number of carriers"),
      producerCount: templateCount(values.producerCount, 3, "The number of producers"),
      siteUrl: SITE_URL
    };
    const sheets = commissionTrackingTemplateSheets(options);
    const bytes = writeXlsx(sheets);
    const checks = verifyCommissionTrackingTemplate(options, bytes);
    const agency = sheets[0]?.rows[1]?.[1] ?? "";
    const month = options.month.trim();
    const suggestedName = `${["commission-tracking-template", fileSlug(agency), month].filter(Boolean).join("-")}.xlsx`;
    return {
      summary: `A commission tracking workbook with ${plural(sheets.length, "sheet")} (${COMMISSION_TEMPLATE_SHEETS.join(", ")})${agency ? ` for ${agency}` : ""}${month ? `, statement month ${month}` : ""}: ${options.carrierCount} numbered carrier row(s) and ${options.producerCount} numbered producer row(s), all blank. File name: ${suggestedName}.`,
      tables: [{ name: "Sheets", rows: [["Sheet", "Columns", "Rows to fill in"], ...sheets.map((s) => [s.name, (s.rows[0] ?? []).map((c) => String(c ?? "")).join(", "), ROWS_TO_FILL[s.name]?.(options) ?? String(s.rows.length - 1)])] }],
      checks,
      file: { suggestedName, bytes }
    };
  },
  examples: [
    {
      label: "The page's worked example: Example Agency LLC, February 2026, 12 carriers and 4 producers",
      args: { agency: "Example Agency LLC", month: "2026-02", carrierCount: "12", producerCount: "4" },
      verified: true,
      contains: ["commission-tracking-template-example-agency-llc-2026-02.xlsx", "12 numbered", "4 numbered", "Line, Carrier, Statement total, Payment received, Date received, Notes", "Carrier, Policy number, Insured name, Line of business, Transaction type, Effective date, Producer code, Premium, Commission rate %, Commission amount"]
    }
  ]
};
var BOOK_COLUMNS = { roles: INS_BOOK_ROLES, labels: INS_BOOK_LABELS, required: ["policy"], guess: (rows, at) => insGuessBookColumns(rows, at) };
var PAID_LINE_ROLES = ["policy", "insured", "commission"];
var PAID_LINE_COLUMNS = { roles: PAID_LINE_ROLES, labels: INS_STATEMENT_LABELS, required: ["policy", "commission"], guess: (rows, at) => insGuessStatementColumns(rows, at) };
var reconciler = {
  name: "commission_expected_vs_paid_reconciliation",
  page: "insurance-commissions/expected-vs-paid-reconciler",
  section: "insurance-commissions",
  kind: "tool",
  title: "Insurance commission reconciliation: expected from the book against paid on the statement",
  description: "Compares an agency's book-of-business export (what each policy was expected to pay: an expected commission, or premium times an expected rate) with a commission statement (what was paid), matching only on exactly the same policy number, ignoring case and extra spaces. Each policy lands in one bucket: paid as expected, short-paid, over-paid, paid but not in book, or in book but not paid, with the difference. Both sides are proved to add up by count and amount in an independent pass, no row is used twice, and near matches (same number without punctuation, or same insured) are listed for review and never accepted. Use it when someone asks which policies a carrier underpaid, overpaid or did not pay this month. Not for policies due over several months by date (aging), and not for one policy's commission.",
  question: "Here is our book of business and this month's commission statement. Which policies were short-paid or not paid?",
  inputs: [
    { name: "bookOfBusiness", kind: "file", label: "Book of business", description: 'A .csv or .xlsx file (a path, or the CSV text) with one row per policy: policy number, and either an expected commission amount or a premium and an expected rate (the amount is used when both are there); insured name when present. In a workbook, a sheet named "Book of business" is read when there is one.', required: true },
    { name: "statement", kind: "file", label: "Commission statement", description: 'A .csv or .xlsx file (a path, or the CSV text) with one row per statement line: policy number and commission amount; insured name when present. In a workbook, a sheet named "Commission log" is read when there is one.', required: true },
    rateFormatInput("bookRateFormat", "the book's expected rates"),
    columnsInput("Book of business", BOOK_COLUMNS, "bookColumns"),
    columnsInput("Commission statement", PAID_LINE_COLUMNS, "statementColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven shows the arithmetic difference between what the book expected and what the statement paid; it makes no statement about what any contract or commission schedule requires.",
  run({ files, values }) {
    const bookFile = preferSheet(oneFile(files, "bookOfBusiness"), BOOK_SHEET);
    const statementFile = preferSheet(oneFile(files, "statement"), LOG_SHEET);
    const bm = mapColumns(bookFile, BOOK_COLUMNS, values.bookColumns, "Book of business");
    const sm = mapColumns(statementFile, PAID_LINE_COLUMNS, values.statementColumns, "Commission statement");
    const bookRead = insExtractBookLines(bookFile.rows, { ...bm, rateFormat: rateFormatOf(bookFile.rows, bm.headerRow, bm.columns.expectedRate, values.bookRateFormat) });
    const statementRead = insExtractStatementLines(statementFile.rows, {
      headerRow: sm.headerRow,
      rateFormat: "percent",
      columns: { policy: sm.columns.policy, insured: sm.columns.insured, commission: sm.columns.commission, premium: -1, rate: -1, effectiveDate: -1, product: -1, transactionType: -1, producer: -1 }
    });
    const r = reconcileCommissions({
      book: bookRead.lines,
      statement: statementRead.lines,
      problems: [...bookRead.problems.map((p) => ({ rowNumber: p.rowNumber, reason: `book: ${p.reason}` })), ...statementRead.problems.map((p) => ({ rowNumber: p.rowNumber, reason: `statement: ${p.reason}` }))]
    });
    const t = commissionReconcileTables(r);
    const leftOut = bookRead.totalRows.length + statementRead.totalRows.length;
    const bucketText = COMMISSION_BUCKETS.map((b) => `${COMMISSION_BUCKET_LABELS[b].toLowerCase()} ${r.totals[b].policies}`).join(", ");
    return {
      summary: `${plural(r.bookCount, "book row")} (${usd(r.expectedTotal)} expected) against ${plural(r.statementCount, "statement line")} (${usd(r.paidTotal)} paid), matched on the exact policy number: ${bucketText}. ${plural(r.possibleMatches.length, "possible match", "possible matches")} listed for review, not accepted.${leftOut ? ` ${plural(leftOut, "total row")} in the files left out.` : ""}`,
      tables: [
        { name: "Summary", rows: t.summary },
        ...COMMISSION_BUCKETS.map((b) => ({ name: COMMISSION_BUCKET_LABELS[b], rows: t.buckets[b] })),
        { name: "Possible matches (listed for review, not accepted)", rows: t.possibleMatches }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: a book of six policies against a statement of five lines",
      args: { bookOfBusiness: "fixture:insurance/book-of-business.csv", statement: "fixture:insurance/commission-statement.csv" },
      verified: true,
      contains: [
        "6 book rows ($1,285.00 expected) against 5 statement lines ($1,064.00 paid), matched on the exact policy number: paid as expected 2, short-paid 1, over-paid 1, paid but not in book 1, in book but not paid 2. 1 possible match listed",
        "| Paid as expected | 2 | 2 | 2 | 850.00 | 850.00 | 0.00 |",
        "| Short-paid | 1 | 1 | 1 | 150.00 | 125.00 | -25.00 |",
        "| Over-paid | 1 | 1 | 1 | -40.00 | -36.00 | 4.00 |",
        "| Paid but not in book | 1 | 0 | 1 | 0.00 | 125.00 | 125.00 |",
        "| In book but not paid | 2 | 2 | 0 | 325.00 | 0.00 | -325.00 |",
        "| All rows | 7 | 6 | 5 | 1285.00 | 1064.00 | -221.00 |",
        "| POL-10025 | Harbor Cycle Shop | 125.00 | POL 10025 | Harbor Cycle Shop | 125.00 | Same number without punctuation or leading zeros |"
      ]
    },
    {
      label: "A book row whose premium cannot be read is not verified",
      args: { bookOfBusiness: "Policy Number,Named Insured,Annual Premium,Expected Rate %\nPOL-1,Ann Lee,1000.00,10\nPOL-2,Bo Diaz,2OOO.00,10\n", statement: "Policy #,Insured,Commission\nPOL-1,Ann Lee,100.00\n" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var POLICY_COLUMNS = { roles: MISSING_POLICY_ROLES, labels: MISSING_POLICY_LABELS, required: ["policy", "payableDate"], guess: (rows, at) => insGuessMissingPolicyColumns(rows, at) };
var LINE_COLUMNS = { roles: MISSING_LINE_ROLES, labels: MISSING_LINE_LABELS, required: ["policy", "commission"], guess: (rows, at) => insGuessMissingLineColumns(rows, at) };
var missingCommissions = {
  name: "missing_insurance_commission_finder",
  page: "insurance-commissions/missing-commission-finder",
  section: "insurance-commissions",
  kind: "tool",
  title: "Missing insurance commissions: policies with no statement line, aged by days",
  description: "Compares an agency's policy list (policy number, carrier, effective or renewal date, and an expected commission or premium times an expected rate) with commission statement lines. A line counts for a policy when the policy number is exactly the same, the carrier is the same where both name one, and the line is dated in the policy's payable period. Every policy payable by the as-of date that no line matches is listed with its age in days (0-30, 31-60, 61-90, over 90) and its expected commission, totalled by carrier and by age. Every policy is proved matched, listed or payable later, every line matched or not, by count and amount; near matches are listed for review and never accepted. Use it when someone asks which policies have not been paid commission yet, or how old their unpaid commissions are. Not for short-paid amounts on matched policies, and not for one policy.",
  question: "Which of our policies still have no commission on any statement as of June 30, and how old are they?",
  inputs: [
    { name: "policyList", kind: "file", label: "Policy list", description: 'A .csv or .xlsx file (a path, or the CSV text) with one row per policy: policy number, effective or renewal date, and either an expected commission amount or a premium and an expected rate; carrier and insured name when present. In a workbook, a sheet named "Book of business" is read when there is one.', required: true },
    { name: "statement", kind: "file", label: "Commission statement lines", description: 'A .csv or .xlsx file (a path, or the CSV text) with one row per statement line, from one carrier or several: policy number and commission amount; carrier, date and insured name when present. In a workbook, a sheet named "Commission log" is read when there is one.', required: true },
    { name: "asOf", kind: "date", label: "As of", description: "Optional. The day ages are counted to, YYYY-MM-DD; a policy payable after it is not listed. Without it, today.", required: false },
    { name: "defaultCarrier", kind: "text", label: "Carrier for statement lines that name none", description: "Optional. For a statement from one carrier with no carrier column, or lines with a blank carrier: the carrier's name.", required: false },
    rateFormatInput("policyRateFormat", "the policy list's expected rates"),
    columnsInput("Policy list", POLICY_COLUMNS, "policyColumns"),
    columnsInput("Commission statement lines", LINE_COLUMNS, "statementColumns")
  ],
  limits: "site",
  notAdvice: "Mathproven shows only that no line in the statement file was found for a policy and its date; it makes no statement about what any carrier owes or what any agreement or commission schedule requires.",
  run({ files, values, now }) {
    const policyFile = preferSheet(oneFile(files, "policyList"), BOOK_SHEET);
    const statementFile = preferSheet(oneFile(files, "statement"), LOG_SHEET);
    const asOf = values.asOf ?? dayOf(now);
    if (!isIsoDate(asOf)) throw new AgentInputError(`The as-of date "${asOf}" is not a real day written YYYY-MM-DD.`);
    const pm = mapColumns(policyFile, POLICY_COLUMNS, values.policyColumns, "Policy list");
    const lm = mapColumns(statementFile, LINE_COLUMNS, values.statementColumns, "Commission statement lines");
    const policyRead = insExtractMissingPolicies(policyFile.rows, { ...pm, rateFormat: rateFormatOf(policyFile.rows, pm.headerRow, pm.columns.expectedRate, values.policyRateFormat) });
    const lineRead = insExtractMissingLines(statementFile.rows, { ...lm, rateFormat: "percent" }, values.defaultCarrier ?? "");
    const r = findMissingCommissions({
      policies: policyRead.rows,
      lines: lineRead.lines,
      asOf,
      problems: [...policyRead.problems.map((x) => ({ rowNumber: x.rowNumber, reason: `policy list: ${x.reason}` })), ...lineRead.problems.map((x) => ({ rowNumber: x.rowNumber, reason: `statement: ${x.reason}` }))]
    });
    const t = missingCommissionTables(r);
    const leftOut = policyRead.totalRows.length + lineRead.totalRows.length;
    const byCarrier = r.carriers.map((c) => `${c.carrier} ${usd(c.expected)}`).join(", ");
    return {
      summary: `As of ${asOf}: ${plural(r.terms.length, "policy", "policies")} (${usd(r.expectedTotal)} expected). Matched to a statement line: ${r.totals.matched.policies} (${usd(r.totals.matched.expected)} expected, ${usd(r.totals.matched.paid)} on their lines). No statement line found: ${r.totals.listed.policies} (${usd(r.listedExpected)} expected${byCarrier ? `; by carrier ${byCarrier}` : ""}). Payable after the as-of date: ${r.totals.notYet.policies} (${usd(r.totals.notYet.expected)}). Statement lines: ${r.lineCount} (${usd(r.commissionTotal)}), of them ${r.unmatchedLines.length} not matched (${usd(r.unmatchedCommission)}). ${plural(r.possibleMatches.length, "possible match", "possible matches")} listed for review, not accepted.${leftOut ? ` ${plural(leftOut, "total row")} in the files left out.` : ""}`,
      tables: [
        { name: "Summary", rows: t.summary },
        { name: "Expected commission with no statement line, by carrier and age", rows: t.byCarrier },
        { name: "Policies with no statement line", rows: t.listed },
        { name: "Possible matches (listed for review, not accepted)", rows: t.possibleMatches },
        { name: "Statement lines not matched to a policy", rows: t.unmatchedLines },
        { name: "Policies matched to a statement line", rows: t.matched },
        { name: "Policies payable after the as-of date", rows: t.notYet }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: seven policies from two carriers against four statement lines, as of June 30, 2026",
      args: { policyList: "fixture:insurance/missing-policy-list.csv", statement: "fixture:insurance/missing-statement-lines.csv", asOf: "2026-06-30" },
      verified: true,
      contains: [
        "As of 2026-06-30: 7 policies ($1,765.00 expected). Matched to a statement line: 2 ($695.00 expected, $695.00 on their lines). No statement line found: 4 ($770.00 expected; by carrier Example Mutual $420.00, Sample Casualty $350.00). Payable after the as-of date: 1 ($300.00). Statement lines: 4 ($1,010.00), of them 2 not matched ($315.00). 2 possible matches listed",
        "| POL-30021 | Sunrise Yoga Studio | Sample Casualty | 2026-03-01 | 121 | Over 90 days | 5 | 200.00 |",
        "| POL-20013 | Harbor Cycle Shop | Example Mutual | 2026-04-20 | 71 | 61–90 days | 4 | 180.00 |",
        "| POL-30022 | Jordan Rivera | Sample Casualty | 2026-05-20 | 41 | 31–60 days | 6 | 150.00 |",
        "| POL-20012 | Northside Dental PC | Example Mutual | 2026-06-15 | 15 | 0–30 days | 3 | 240.00 |",
        "| All carriers | 4 | 240.00 | 150.00 | 180.00 | 200.00 | 770.00 |",
        "| 4 | POL-20013 | Harbor Cycle Shop | Example Mutual | 2025-04-20 | 165.00 | Dated before the policy became payable |"
      ]
    },
    {
      label: "A policy row with no effective or renewal date is not verified",
      args: { policyList: "Policy Number,Carrier,Effective Date,Expected Commission\nPOL-1,Example Mutual,2026-05-01,100.00\nPOL-2,Example Mutual,,200.00\n", statement: "Policy #,Carrier,Eff Date,Commission\nPOL-1,Example Mutual,2026-05-01,100.00\n", asOf: "2026-06-30" },
      verified: false,
      failedCheck: "rows-read"
    }
  ]
};
var SPLIT_LINE_ROLES = ["policy", "insured", "commission", "producer"];
var SPLIT_LINE_COLUMNS = { roles: SPLIT_LINE_ROLES, labels: INS_STATEMENT_LABELS, required: ["commission"], guess: (rows, at) => insGuessStatementColumns(rows, at) };
var PRODUCER_SLOTS = 3;
var RULES_EXAMPLE = "KIM: House 40, Kim Ortiz 60; LEE: House 50, Lee Park 30, Sam Diaz 20; *: House 100";
function readSplitRules(text) {
  const rules = [];
  for (const piece of text.split(/[;\n]/)) {
    if (piece.trim() === "") continue;
    const colon = piece.indexOf(":");
    if (colon < 0) throw new AgentInputError(`Each split rule is written "<producer code>: House <percent>, <producer name> <percent>", for example "${RULES_EXAMPLE}": "${piece.trim()}".`);
    const code = piece.slice(0, colon).trim();
    const key = code === "*" ? "" : code;
    let houseBp;
    const producers = [];
    for (const share of piece.slice(colon + 1).split(",")) {
      if (share.trim() === "") continue;
      const m = /^(.+?)\s*(?:=\s*|\s+)(\d+(?:\.\d+)?)\s*%?$/.exec(share.trim());
      if (!m) throw new AgentInputError(`A share in the rule for ${key === "" ? "all other lines" : `"${code}"`} is written "<name> <percent>", such as "Kim Ortiz 60": "${share.trim()}".`);
      const bp = percentBp(m[2], `The percent for ${m[1].trim()}`);
      if (m[1].trim().toLowerCase() === "house") {
        if (houseBp !== void 0) throw new AgentInputError(`The rule for ${key === "" ? "all other lines" : `"${code}"`} names the house twice.`);
        houseBp = bp;
      } else producers.push({ name: m[1].trim(), bp });
    }
    if (producers.length > PRODUCER_SLOTS) throw new AgentInputError(`A rule takes the house share and up to ${PRODUCER_SLOTS} producers; the rule for ${key === "" ? "all other lines" : `"${code}"`} names ${producers.length}.`);
    rules.push(insSplitRule(key, houseBp ?? 0, producers));
  }
  if (rules.length === 0) throw new AgentInputError(`Give at least one split rule, for example "${RULES_EXAMPLE}".`);
  return rules;
}
var producerSplits = {
  name: "producer_commission_split_calculator",
  page: "insurance-commissions/producer-split-calculator",
  section: "insurance-commissions",
  kind: "tool",
  title: "Producer commission splits on paid lines, to the cent, with payout statements",
  description: "Splits each paid insurance commission line (.csv or .xlsx) among producers and a house share by the percentages in a rule for the line's producer or agent code, with a catch-all rule for lines no other rule names. Cents that do not divide evenly go to the shares with the largest remainders, so the parts of every line add up to the line exactly. Checks: each line's parts equal its commission, the percentages add up to 100% on every line, every part is recalculated from its rule, producer plus house totals equal all commission, and every line has a rule. Gives totals by payee and a payout statement per producer. Use it when someone asks how much each producer is owed from a commission statement under their split percentages. Not for deciding what the splits should be, and not for one policy.",
  question: "Kim gets 60% of her lines and the house 40%; Lee 30%, Sam 20% and the house 50% of Lee's. What does each producer get from this statement?",
  inputs: [
    { name: "paidLines", kind: "file", label: "Paid commission lines", description: `A .csv or .xlsx file (a path, or the CSV text) with one row per paid line: the commission amount, and the producer or agent code that picks each line's rule; policy number and insured when present. In a workbook, a sheet named "Commission log" is read when there is one.`, required: true },
    { name: "splitRules", kind: "text", label: "Split rules", description: `One rule per producer code, separated by semicolons or new lines: "<code>: House <percent>, <producer name> <percent>" with up to three producers, the shares adding up to 100. The code "*" is the rule for every line no other rule names. For example "${RULES_EXAMPLE}".`, required: true },
    columnsInput("Paid commission lines", SPLIT_LINE_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven applies the percentages given and proves the arithmetic; it makes no statement about what any producer agreement or contract requires.",
  run({ files, values }) {
    const file = preferSheet(oneFile(files, "paidLines"), LOG_SHEET);
    const rules = readSplitRules(values.splitRules);
    const m = mapColumns(file, SPLIT_LINE_COLUMNS, values.columns, "Paid commission lines");
    const read = insExtractStatementLines(file.rows, {
      headerRow: m.headerRow,
      rateFormat: "percent",
      columns: { policy: m.columns.policy, insured: m.columns.insured, commission: m.columns.commission, producer: m.columns.producer, premium: -1, rate: -1, effectiveDate: -1, product: -1, transactionType: -1 }
    });
    const r = computeProducerSplits({ lines: read.lines.map((l) => ({ rowNumber: l.rowNumber, policy: l.policy, insured: l.insured, commission: l.commission, ruleKey: l.producer })), rules, problems: read.problems });
    const t = producerSplitTables(r);
    const producers = r.payees.filter((p) => !p.house);
    const tables = [
      { name: "Summary", rows: t.summary },
      ...producers.map((p) => ({ name: `Payout statement: ${p.payee}`, rows: producerPayoutRows(r, p) })),
      { name: "All splits", rows: t.lines }
    ];
    if (r.unsplit.length) tables.push({ name: "Lines with no rule", rows: t.unsplit });
    return {
      summary: `${plural(r.lines.length + r.unsplit.length, "line")} (${usd(r.commissionTotal)} of commission), ${r.lines.length} split by ${plural(rules.length, "rule")}${r.unsplit.length ? `, ${r.unsplit.length} with no rule` : ""}. Producers: ${producers.map((p) => `${p.payee} ${usd(p.total)}`).join(", ") || "none"}, together ${usd(r.producerTotal)}; house ${usd(r.houseTotal)}.`,
      tables,
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: five paid lines, rules KIM 40/60, LEE 50/30/20 and house 100% for every other line",
      args: { paidLines: "fixture:insurance/commission-statement.csv", splitRules: RULES_EXAMPLE },
      verified: true,
      contains: [
        "5 lines ($1,064.00 of commission), 5 split by 3 rules. Producers: Kim Ortiz $435.00, Lee Park $64.20, Sam Diaz $42.80, together $542.00; house $522.00.",
        "| 6 | POL-10024 | Avery Chen | -36.00 | 30.00 | -10.80 |",
        "| 6 | POL-10024 | Avery Chen | -36.00 | 20.00 | -7.20 |",
        "| 7 | POL-10025 | Harbor Cycle Shop |  | 125.00 | House | 100.00 | 125.00 |",
        "| Total commission |  | 5 | 1064.00 |"
      ]
    },
    {
      label: "Rules with no catch-all leave the line with no producer code unsplit, which is not verified",
      args: { paidLines: "fixture:insurance/commission-statement.csv", splitRules: "KIM: House 40, Kim Ortiz 60; LEE: House 50, Lee Park 30, Sam Diaz 20" },
      verified: false,
      failedCheck: "every-line-split"
    },
    {
      label: "A rule whose shares add up to 90% is not verified",
      args: { paidLines: "fixture:insurance/commission-statement.csv", splitRules: "KIM: House 30, Kim Ortiz 60; *: House 100" },
      verified: false,
      failedCheck: "percent-100"
    }
  ]
};
var SL_COLUMNS = { roles: SL_LIST_ROLES, labels: SL_LIST_LABELS, required: ["premium"], guess: (rows, at) => slGuessListColumns(rows, at) };
function stateCodeOf(name, input) {
  const code = slStateCode(name);
  if (!code) throw new AgentInputError(`"${name}" in "${input}" is not a state code or name. Write a two-letter code such as OR, or a state name.`);
  return code;
}
function typedPpm(raw, code, input) {
  let ppm;
  try {
    ppm = slPercentToPpm(raw);
  } catch (err2) {
    throw new AgentInputError(`The rate for ${refMemberName(REF_US_STATES_DC, code)} in "${input}": ${err2 instanceof Error ? err2.message : `"${raw}" is not a rate`} Write a percent with at most four decimals, such as 0.15.`);
  }
  if (ppm === 0) throw new AgentInputError(`The rate for ${refMemberName(REF_US_STATES_DC, code)} in "${input}" is "${raw}", which is not a rate above 0%.`);
  return ppm;
}
var STATES_WITHOUT_ROW = REF_US_STATES_DC.filter((m) => !slRow(m.code, SURPLUS_LINES_TAX_TABLE));
var TAX_RATES_WHEN = STATES_WITHOUT_ROW.length ? `Today that is: ${STATES_WITHOUT_ROW.map((m) => `${m.name} (${m.code})`).join(", ")}.` : "Today the table has a row for every state and DC, so no state takes a typed tax rate and one given is refused.";
var surplusLinesList = {
  name: "surplus_lines_tax_on_policy_list",
  page: "insurance-commissions/surplus-lines-tax-on-a-policy-list",
  section: "insurance-commissions",
  kind: "tool",
  title: "Surplus lines premium tax on a policy list, with totals by home state",
  description: "Works out the surplus lines premium tax and any second charge on every policy in a period's list (.csv or .xlsx: home state and premium on each row, a return as a negative premium), from the site's sourced state surplus lines tax rates table, and totals them by the insured's home state in whole cents. Each figure is premium times rate, half a cent rounded up on the premium without its sign, checked a second way and against the single-premium calculator for the same state; state totals must add up to the list total and to the list's own total row. A further fee such as a stamping fee can be typed as a percent, or taken from the site's stamping fee table, and a state the table has no row for needs its rate typed; anything typed is labeled as typed. Use it when someone asks for surplus lines tax on a list of policies or a period's bordereau. Not for deciding which home state applies or what to file.",
  question: "Here is our October surplus lines policy list. What is the premium tax on each policy and the total by home state?",
  inputs: [
    { name: "policyList", kind: "file", label: "Policy list", description: "A .csv or .xlsx file (a path, or the CSV text) with one row per policy or endorsement: the premium (a return as a negative amount or in brackets) and the insured's home state as a two-letter code or a name; policy number and insured when present. A total row is left out and compared with the policies.", required: true },
    { name: "defaultState", kind: "text", label: "Home state for rows that name none", description: "Optional. For a list from one state with no state column, or rows with a blank state: the state, such as OR or Oregon.", required: false },
    { name: "taxRates", kind: "text", label: "Tax rate typed for a state the table lacks", description: `Optional. Only for a home state on the list that the rates table has no row for, as "<state> = <percent>" separated by semicolons; a state the table has a row for takes its rate from the table and cannot be typed. ${TAX_RATES_WHEN}`, required: false },
    { name: "feeRates", kind: "text", label: "Further fee typed for a state", description: 'Optional. A further fee the table does not carry, such as a stamping fee, as a percent of premium for any home state on the list: "<state> = <percent>", for example "TX = 0.15; NY = 0.15". Labeled as typed everywhere it appears.', required: false },
    { name: "stampingFeeStates", kind: "text", label: "States that take the stamping fee table's fee", description: `Optional. Home states on the list whose further fee is the site's stamping fee table's percent fee (where that table has one figured to the cent) for policies effective on the fee date, separated by commas: "TX, NY", or "all" for every state on the list it has one for. A state takes a typed fee or the table's, never both.`, required: false },
    { name: "feeDate", kind: "date", label: "Policy effective date for the stamping fee table", description: "Optional, and only with stampingFeeStates: the policy effective date the stamping fee table's fees are taken for, YYYY-MM-DD. Without it, today.", required: false },
    columnsInput("Policy list", SL_COLUMNS)
  ],
  limits: "site",
  notAdvice: "Mathproven shows the arithmetic on the rates table's rows and on any rate typed; it does not say what to charge, collect or file, what is taxable, or which home state applies. Mathproven is not affiliated with any state agency whose rules are cited in the table.",
  run({ files, values, now }) {
    const file = oneFile(files, "policyList");
    const m = mapColumns(file, SL_COLUMNS, values.columns, "Policy list");
    const ex = slExtractPolicyLines(file.rows, m, values.defaultState ?? "");
    const onList = new Set(ex.lines.map((l) => l.state));
    const typed = /* @__PURE__ */ new Map();
    const typedFor = (code) => {
      let t = typed.get(code);
      if (!t) {
        t = { code };
        typed.set(code, t);
      }
      return t;
    };
    const mustBeOnList = (code, input) => {
      if (!onList.has(code)) throw new AgentInputError(`${refMemberName(REF_US_STATES_DC, code)} is named in "${input}" but is not a home state on the list.`);
    };
    for (const [input, field] of [["taxRates", "taxPpm"], ["feeRates", "feePpm"]]) {
      for (const [name, raw] of namedList(values[input], input, "TX = 0.15; NY = 0.15")) {
        const code = stateCodeOf(name, input);
        mustBeOnList(code, input);
        const t = typedFor(code);
        if (t[field] !== void 0) throw new AgentInputError(`${refMemberName(REF_US_STATES_DC, code)} is named twice in "${input}".`);
        if (field === "taxPpm" && slRow(code, SURPLUS_LINES_TAX_TABLE)) throw new AgentInputError(`${refMemberName(REF_US_STATES_DC, code)} has a row in the rates table, so its tax rate comes from the table and cannot be typed.`);
        t[field] = typedPpm(raw, code, input);
      }
    }
    const feeDay = values.feeDate ?? dayOf(now);
    const wanted = (values.stampingFeeStates ?? "").trim();
    if (values.feeDate !== void 0 && wanted === "") throw new AgentInputError(`"feeDate" is used only with "stampingFeeStates": name the home states that take the stamping fee table's fee (or "all"), or leave the date out.`);
    const noTableFee = [];
    if (wanted !== "") {
      const all = wanted.toLowerCase() === "all";
      const codes = all ? [...onList].sort() : wanted.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => stateCodeOf(s, "stampingFeeStates"));
      for (const code of codes) {
        if (!all) mustBeOnList(code, "stampingFeeStates");
        const offer = slTableFeeFor(code, feeDay);
        if (!offer) {
          if (all) {
            noTableFee.push(refMemberName(REF_US_STATES_DC, code));
            continue;
          }
          throw new AgentInputError(`The stamping fee table has no percent fee figured to the cent for ${refMemberName(REF_US_STATES_DC, code)} for policies effective ${feeDay} that the rates table does not already carry.`);
        }
        const t = typedFor(code);
        if (t.feePpm !== void 0 && t.feeFromTable === void 0) throw new AgentInputError(`${refMemberName(REF_US_STATES_DC, code)} has a fee typed in "feeRates" and is also named in "stampingFeeStates": a state takes a typed fee or the table's, never both.`);
        t.feePpm = offer.ppm;
        t.feeFromTable = offer.on;
      }
    }
    const listPremiumTotal = ex.totalRows.find((t) => t.premium !== void 0)?.premium;
    const r = computeSurplusLinesList({ lines: ex.lines, typed: [...typed.values()], problems: ex.problems, ...listPremiumTotal === void 0 ? {} : { listPremiumTotal } }, SURPLUS_LINES_TAX_TABLE);
    const tables = surplusLinesListTables(r);
    const returns = r.policies.filter((p) => p.premium < 0).length;
    const sources = [["Home state", "Rate or fee", "Source", "Address", "Read on"]];
    for (const s of r.states) {
      if (s.citation && s.sourceUrl) sources.push([`${s.name} (${s.code})`, `Tax rate ${slPercentText(s.taxPpm)}${s.chargeName ? ` and ${s.chargeName} ${slPercentText(s.chargePpm)}` : ""}, from the rates table`, s.citation, s.sourceUrl, s.checkedOn ?? ""]);
      if (s.feeFromTable && s.tableFee) sources.push([`${s.name} (${s.code})`, `${s.tableFee.name} ${slPercentText(s.tableFee.ppm)}, from the stamping fee table for policies effective ${s.tableFee.on}`, s.tableFee.citation, s.tableFee.sourceUrl, s.tableFee.checkedOn]);
    }
    const typedStates = r.states.filter((s) => s.rateTyped || s.feeTyped);
    const tableFees = r.states.filter((s) => s.feeFromTable && s.tableFee);
    const notes = [
      ex.totalRows.length ? `${plural(ex.totalRows.length, "total row")} in the file left out of the policies${listPremiumTotal === void 0 ? "" : ` and compared with them (${usd(listPremiumTotal)})`}.` : "",
      typedStates.length ? `Typed, not from the table: ${typedStates.map((s) => `${s.name} (${[s.rateTyped ? `tax rate ${slPercentText(s.taxPpm)}` : "", s.feeTyped ? `fee ${slPercentText(s.feePpm)}` : ""].filter(Boolean).join(", ")})`).join("; ")}.` : "",
      tableFees.length ? `Fee from the stamping fee table, its rate for policies effective ${feeDay}: ${tableFees.map((s) => `${s.name} ${slPercentText(s.feePpm)} (${s.tableFee.name})`).join("; ")}.` : "",
      noTableFee.length ? `The stamping fee table has no percent fee figured to the cent for policies effective ${feeDay} for ${noTableFee.join(", ")}, so no table fee was added for ${noTableFee.length === 1 ? "it" : "them"}.` : ""
    ].filter(Boolean);
    return {
      summary: `${plural(r.lineCount, "policy", "policies")} (${returns} return premium(s)) in ${plural(r.states.length, "home state")}: ${usd(r.premium)} of premium, ${usd(r.tax)} of surplus lines tax, ${usd(r.charge)} of second charges and ${usd(r.fee)} of further fees, ${usd(r.total)} in all. By state: ${r.states.map((s) => `${s.name} ${usd(s.total)}`).join(", ")}. A state total is the sum of its policies, each rounded to the cent first.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      tables: [
        { name: "Totals by home state", rows: tables.byState },
        { name: "Tax on each policy", rows: tables.byPolicy },
        { name: "Totals", rows: [["Item", "Amount"], ["Premium", toDecimal(r.premium)], ["Surplus lines tax", toDecimal(r.tax)], ["Second charges from the table", toDecimal(r.charge)], ["Further fees (typed or from the stamping fee table)", toDecimal(r.fee)], ["Total, all states", toDecimal(r.total)]] },
        { name: "Sources", rows: sources }
      ],
      checks: r.checks
    };
  },
  examples: [
    {
      label: "The page's worked example: six October policies in four home states, one a Texas return of -$1,200.00, list total $30,358.82",
      args: { policyList: "fixture:insurance/surplus-lines-policy-list.csv" },
      verified: true,
      contains: [
        "6 policies (1 return premium(s)) in 4 home states: $30,358.82 of premium, $1,012.39 of surplus lines tax, $48.02 of second charges and $0.00 of further fees, $1,060.41 in all. By state: Michigan $83.34, New York $193.52, Oregon $240.35, Texas $543.20.",
        "| Michigan (MI) | 1 | 0 | 3333.33 | 2% | 66.67 | 16.67 | 0.00 | 83.34 | Table |",
        "| Oregon (OR) | 2 | 0 | 10449.99 | 2% | 209.00 | 31.35 | 0.00 | 240.35 | Table |",
        "| Texas (TX) | 2 | 1 | 11200.00 | 4.85% | 543.20 | 0.00 | 0.00 | 543.20 | Table |",
        "| All states | 6 | 1 | 30358.82 |  | 1012.39 | 48.02 | 0.00 | 1060.41 |  |",
        "| 2 | SL-1001 | Harbor Bakery LLC | OR | 8250.00 | 2% | 165.00 | 0.3% | 24.75 |  | 0.00 | 189.75 | Table |",
        "| 5 | SL-0977 | Mesa Freight Inc | TX | -1200.00 | 4.85% | -58.20 |  | 0.00 |  | 0.00 | -58.20 | Table |"
      ]
    },
    {
      label: "A policy row whose premium cannot be read is not verified",
      args: { policyList: 'Policy number,Insured,Home state,Premium\nSL-1,Harbor Bakery LLC,OR,"8,250.00"\nSL-2,Ridge Storage Co,TX,"12,4OO.00"\n' },
      verified: false,
      failedCheck: "sl-list-rows-read"
    }
  ]
};
var INSURANCE_COMMISSIONS = [commissionCalculator, statementToExcel, carrierSummary, trackingTemplate, reconciler, missingCommissions, producerSplits, surplusLinesList];
var INSURANCE_COMMISSIONS_NOT_FOR_AGENTS = [];

export {
  writeXlsx,
  readXlsx,
  AgentInputError,
  checkValue,
  isVerified,
  present,
  beginColumnLog,
  takeColumnLog,
  INSURANCE_COMMISSIONS,
  INSURANCE_COMMISSIONS_NOT_FOR_AGENTS
};
