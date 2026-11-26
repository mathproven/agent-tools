// Mathproven agent tools 0.1.1. Copyright 2026 OpenSlot LLC; see LICENSE and THIRD-PARTY-NOTICES.
// Built by scripts/build-plugin.mjs with esbuild from the TypeScript source of Mathproven's core and agents
// packages: bundled, not minified. Each "// packages/..." line names the source file of the code after it.
// It makes no network request and sends nothing anywhere.
import {
  CheckList,
  assertCents,
  formatUSD,
  parseAmount
} from "./money.mjs";

// packages/core/src/construction/lienWaiverStatutes.ts
var STATUTORY_WAIVER_TEXTS = [
  {
    state: "AZ",
    waiverType: "conditional-progress",
    citation: "A.R.S. § 33-1008(D)(1)",
    sourceUrl: "https://www.azleg.gov/ars/33/01008.htm",
    checkedOn: "2026-10-10",
    sha256: "4c9773df2b4b6a2ff1ac181e2c237432242988ccee31e50478445283da7f2cbe",
    text: "Conditional waiver and release on progress payment\nProject: ______________________\nJob No.: ______________________\nOn " +
      "receipt by the undersigned of a check from _________________\n(maker of check)\nin the sum of $______________ " +
      "payable to _______________________\n(amount of check) (payee or payees of check)\nand when the check " +
      "has been properly endorsed and has been paid by the bank on which it is drawn, this document becomes " +
      "effective to release any mechanic's lien, any state or federal statutory bond right, any private bond " +
      "right, any claim for payment and any rights under any similar ordinance, rule or statute related to " +
      "claim or payment rights for persons in the undersigned's position that the undersigned has on the job " +
      "of ______________________________________________________________\n(owner)\nlocated at __________________________________ " +
      "to the following\n(job description)\nextent. This release covers a progress payment for all labor, services, " +
      "equipment or materials furnished to the jobsite or to ______________________________________________________________,\n(person " +
      "with whom undersigned contracted)\nthrough _______________ only and does not cover any retention,\n(date)\npending " +
      "modifications and changes or items furnished after that date. Before any recipient of this document " +
      "relies on it, that person should verify evidence of payment to the undersigned.\nThe undersigned warrants " +
      "that he either has already paid or will use the monies he receives from this progress payment to promptly " +
      "pay in full all of his laborers, subcontractors, materialmen and suppliers for all work, materials, " +
      "equipment or services provided for or to the above referenced project up to the date of this waiver.\nDate: " +
      "____________________ _________________________________\n(Company name)\nBy: ____________________________\n(Signature)\n_________________________________\n(Title)"
  },
  {
    state: "AZ",
    waiverType: "unconditional-progress",
    citation: "A.R.S. § 33-1008(D)(2)",
    sourceUrl: "https://www.azleg.gov/ars/33/01008.htm",
    checkedOn: "2026-10-10",
    sha256: "1bc32fa25596bcab3a84aa67536a3879badf8de7d9455f034791c70f616dfcc1",
    text: "Unconditional waiver and release on progress payment\nProject: _________________\nJob No.: _________________\nThe " +
      "undersigned has been paid and has received a progress payment in the sum of $_____________ for all labor, " +
      "services, equipment or material furnished to the jobsite or to ______________________________________________________________\n(person " +
      "with whom undersigned contracted)\non the job of ________________________________________________\n(owner)\nlocated " +
      "at ___________________________________________________\n(job description)\nand does hereby release any " +
      "mechanic's lien, any state or federal statutory bond right, any private bond right, any claim for payment " +
      "and any rights under any similar ordinance, rule or statute related to claim or payment rights for persons " +
      "in the undersigned's position that the undersigned has on the above referenced project to the following " +
      "extent. This release covers a progress payment for all labor, services, equipment or materials furnished " +
      "to the jobsite or to _______________________________________________________________\n(person with whom " +
      "undersigned contracted)\nthrough ________________ only and does not cover any retention,\n(date)\npending " +
      "modifications and changes or items furnished after that date.\nThe undersigned warrants that he either " +
      "has already paid or will use the monies he receives from this progress payment to promptly pay in full " +
      "all of his laborers, subcontractors, materialmen and suppliers for all work, materials, equipment or " +
      "services provided for or to the above referenced project up to the date of this waiver.\nDated: ____________________ " +
      "________________________________\n(Company name)\nBy: ____________________________\n(Signature)\n________________________________\n(Title)\n(Each " +
      "unconditional waiver shall contain the following language, in type at least as large as the largest " +
      "type otherwise on the document:)\nNotice: This document waives rights unconditionally and states that " +
      "you have been paid for giving up those rights. This document is enforceable against you if you sign " +
      "it, even if you have not been paid. If you have not been paid, use a conditional release form."
  },
  {
    state: "AZ",
    waiverType: "conditional-final",
    citation: "A.R.S. § 33-1008(D)(3)",
    sourceUrl: "https://www.azleg.gov/ars/33/01008.htm",
    checkedOn: "2026-10-10",
    sha256: "8a19315d83fa62ed88ced1f8cb49a641b7ea4fc5dcdfa72a742f01ee51c3388b",
    text: "Conditional waiver and release on final payment\nProject: _______________\nJob No.: _______________\nOn " +
      "receipt by the undersigned of a check from ________________\n(maker of check)\nin the sum of $_________________ " +
      "payable to ____________________\n(amount of check) (payee or payees of check)\nand when the check has " +
      "been properly endorsed and has been paid by the bank on which it is drawn, this document becomes effective " +
      "to release any mechanic's lien, any state or federal statutory bond right, any private bond right, any " +
      "claim for payment and any rights under any similar ordinance, rule or statute related to claim or payment " +
      "rights for persons in the undersigned's position, the undersigned has on the job of ___________________ " +
      "located at ______________________________.\n(owner) (job description)\nThis release covers the final " +
      "payment to the undersigned for all labor, services, equipment or materials furnished to the jobsite " +
      "or to _________________________________________________________,\n(person with whom undersigned contracted)\nexcept " +
      "for disputed claims in the amount of $__________. Before any recipient of this document relies on it, " +
      "the person should verify evidence of payment to the undersigned.\nThe undersigned warrants that he either " +
      "has already paid or will use the monies he receives from this final payment to promptly pay in full " +
      "all his laborers, subcontractors, materialmen and suppliers for all work, materials, equipment or services " +
      "provided for or to the above referenced project up to the date of this waiver.\nDated: ____________________ " +
      "_________________________________\n(Company name)\nBy: _____________________________\n(Signature)\n_________________________________\n(Title)"
  },
  {
    state: "AZ",
    waiverType: "unconditional-final",
    citation: "A.R.S. § 33-1008(D)(4)",
    sourceUrl: "https://www.azleg.gov/ars/33/01008.htm",
    checkedOn: "2026-10-10",
    sha256: "abc9869a9f1d9aecc9aff558d4f754d56023a433225927f70d273d8a4d6d040d",
    text: "Unconditional waiver and release on final payment\nProject: _______________\nJob No.: _______________\nThe " +
      "undersigned has been paid in full for all labor, services, equipment or material furnished to the jobsite " +
      "or to _______________________________________________________________,\n(person with whom undersigned " +
      "contracted)\non the job of _____________ located at _______________________\n(owner) (job description)\nand " +
      "does hereby waive and release any right to mechanic's lien, any state or federal statutory bond right, " +
      "any private bond right, any claim for payment and any rights under any similar ordinance, rule or statute " +
      "related to claim or payment rights for persons in the undersigned's position, except for disputed claims " +
      "for extra work in the amount of $ ___________.\nThe undersigned warrants that he either has already " +
      "paid or will use the monies he receives from this final payment to promptly pay in full all of his laborers, " +
      "subcontractors, materialmen and suppliers for all work, materials, equipment or services provided for " +
      "or to the above referenced project.\nDated: ____________________ _________________________________\n(Company " +
      "name)\nBy: ____________________________\n(Signature)\n_________________________________\n(Title)\n(Each " +
      "unconditional waiver shall contain the following language in type at least as large as the largest type " +
      "otherwise on the document:)\nNotice:\nThis document waives rights unconditionally and states that you " +
      "have been paid for giving up those rights. This document is enforceable against you if you sign it, " +
      "even if you have not been paid. If you have not been paid, use a conditional release form."
  },
  {
    state: "CA",
    waiverType: "conditional-final",
    citation: "Cal. Civ. Code § 8136",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=8136",
    checkedOn: "2026-10-10",
    sha256: "7be12a4101767da8b5232e9deec87a036171c4c33c8de2622442e25b55c54272",
    text: "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT\nNOTICE: THIS DOCUMENT WAIVES THE CLAIMANT’S LIEN, STOP " +
      "PAYMENT NOTICE, AND PAYMENT BOND RIGHTS EFFECTIVE ON RECEIPT OF PAYMENT. A PERSON SHOULD NOT RELY ON " +
      "THIS DOCUMENT UNLESS SATISFIED THAT THE CLAIMANT HAS RECEIVED PAYMENT.\nIdentifying Information\nName " +
      "of Claimant:\nName of Customer:\nJob Location:\nOwner:\nConditional Waiver and Release\nThis document " +
      "waives and releases lien, stop payment notice, and payment bond rights the claimant has for labor and " +
      "service provided, and equipment and material delivered, to the customer on this job. Rights based upon " +
      "labor or service provided, or equipment or material delivered, pursuant to a written change order that " +
      "has been fully executed by the parties prior to the date that this document is signed by the claimant, " +
      "are waived and released by this document, unless listed as an Exception below. This document is effective " +
      "only on the claimant’s receipt of payment from the financial institution on which the following check " +
      "is drawn:\nMaker of Check:\nAmount of Check: $\nCheck Payable to:\nExceptions\nThis document does not " +
      "affect any of the following:\nDisputed claims for extras in the amount of: $\nSignature\nClaimant’s " +
      "Signature:\nClaimant’s Title:\nDate of Signature:"
  },
  {
    state: "CA",
    waiverType: "unconditional-final",
    citation: "Cal. Civ. Code § 8138",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=8138",
    checkedOn: "2026-10-10",
    sha256: "e1324d6e8ee7cdb697dab3ecc6c11d102ca4a6410f963359b33167bd085ce918",
    text: "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT\nNOTICE TO CLAIMANT: THIS DOCUMENT WAIVES AND RELEASES " +
      "LIEN, STOP PAYMENT NOTICE, AND PAYMENT BOND RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID " +
      "FOR GIVING UP THOSE RIGHTS. THIS DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE " +
      "NOT BEEN PAID. IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL WAIVER AND RELEASE FORM.\nIdentifying Information\nName " +
      "of Claimant:\nName of Customer:\nJob Location:\nOwner:\nUnconditional Waiver and Release\nThis document " +
      "waives and releases lien, stop payment notice, and payment bond rights the claimant has for all labor " +
      "and service provided, and equipment and material delivered, to the customer on this job. Rights based " +
      "upon labor or service provided, or equipment or material delivered, pursuant to a written change order " +
      "that has been fully executed by the parties prior to the date that this document is signed by the claimant, " +
      "are waived and released by this document, unless listed as an Exception below. The claimant has been " +
      "paid in full.\nExceptions\nThis document does not affect the following:\nDisputed claims for extras " +
      "in the amount of: $\nSignature\nClaimant’s Signature:\nClaimant’s Title:\nDate of Signature:"
  },
  {
    state: "NV",
    waiverType: "conditional-progress",
    citation: "NRS 108.2457(5)(a)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-108.html#NRS108Sec2457",
    checkedOn: "2026-10-10",
    sha256: "6b49a09d233cf92cc163e33ca107642179a8d03baca80dc696e571b884eb33fb",
    text: "CONDITIONAL WAIVER AND RELEASE\nUPON PROGRESS PAYMENT\nProperty Name:..............................................................................................................\nProperty " +
      "Location:.........................................................................................................\nUndersigned’s " +
      "Customer:.............................................................................................\nInvoice/Payment " +
      "Application Number:.....................................................................\nPayment Amount:..............................................................................................." +
      "...........\nUpon receipt by the undersigned of a check in the above-referenced Payment Amount payable " +
      "to the undersigned, and when the check has been properly endorsed and has been paid by the bank on which " +
      "it is drawn, this document becomes effective to release and the undersigned shall be deemed to waive " +
      "any notice of lien, any private bond right, any claim for payment and any rights under any similar ordinance, " +
      "rule or statute related to payment rights that the undersigned has on the above-described Property to " +
      "the following extent:\nThis release covers a progress payment for the work, materials or equipment furnished " +
      "by the undersigned to the Property or to the Undersigned’s Customer which are the subject of the Invoice " +
      "or Payment Application, but only to the extent of the Payment Amount or such portion of the Payment " +
      "Amount as the undersigned is actually paid, and does not cover any retention withheld, any items, modifications " +
      "or changes pending approval, disputed items and claims, or items furnished that are not paid. Before " +
      "any recipient of this document relies on it, the recipient should verify evidence of payment to the " +
      "undersigned. The undersigned warrants that he or she either has already paid or will use the money received " +
      "from this progress payment promptly to pay in full all laborers, subcontractors, materialmen and suppliers " +
      "for all work, materials or equipment that are the subject of this waiver and release.\nDated:......................................\n.......................................................\n(Company " +
      "Name)\nBy:.................................................\nIts:................................................."
  },
  {
    state: "NV",
    waiverType: "unconditional-progress",
    citation: "NRS 108.2457(5)(b)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-108.html#NRS108Sec2457",
    checkedOn: "2026-10-10",
    sha256: "9e98aca86de18bfcbecb6c28a263b3549d74c1e6eac88594d851deaa6c8c5bbd",
    text: "UNCONDITIONAL WAIVER AND RELEASE\nUPON PROGRESS PAYMENT\nProperty Name:..............................................................................................................\nProperty " +
      "Location:.........................................................................................................\nUndersigned’s " +
      "Customer:.............................................................................................\nInvoice/Payment " +
      "Application Number:.....................................................................\nPayment Amount:..............................................................................................." +
      "...........\nThe undersigned has been paid and has received a progress payment in the above-referenced " +
      "Payment Amount for all work, materials and equipment the undersigned furnished to the Customer for the " +
      "above-described Property and does hereby waive and release any notice of lien, any private bond right, " +
      "any claim for payment and any rights under any similar ordinance, rule or statute related to payment " +
      "rights that the undersigned has on the above-described Property to the following extent:\nThis release " +
      "covers a progress payment for the work, materials and equipment furnished by the undersigned to the " +
      "Property or to the Undersigned’s Customer which are the subject of the Invoice or Payment Application, " +
      "but only to the extent of the Payment Amount or such portion of the Payment Amount as the undersigned " +
      "is actually paid, and does not cover any retention withheld, any items, modifications or changes pending " +
      "approval, disputed items and claims, or items furnished that are not paid. The undersigned warrants " +
      "that he or she either has already paid or will use the money received from this progress payment promptly " +
      "to pay in full all laborers, subcontractors, materialmen and suppliers for all work, materials or equipment " +
      "that are the subject of this waiver and release.\nDated:......................................\n.......................................................\n(Company " +
      "Name)\nBy:.................................................\nIts:.................................................\n(Each " +
      "unconditional waiver and release must contain the following language, in type at least as large as the " +
      "largest type otherwise on the document:)\nNotice: This document waives rights unconditionally and states " +
      "that you have been paid for giving up those rights. This document is enforceable against you if you " +
      "sign it to the extent of the Payment Amount or the amount received. If you have not been paid, use a " +
      "conditional release form."
  },
  {
    state: "NV",
    waiverType: "conditional-final",
    citation: "NRS 108.2457(5)(c)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-108.html#NRS108Sec2457",
    checkedOn: "2026-10-10",
    sha256: "57f9c6af5776ed027d3e98d1a066903418c6ea666ff8b83a545604946cc857ab",
    text: "CONDITIONAL WAIVER AND RELEASE\nUPON FINAL PAYMENT\nProperty Name:..............................................................................................................\nProperty " +
      "Location:.........................................................................................................\nUndersigned’s " +
      "Customer:.............................................................................................\nInvoice/Payment " +
      "Application Number:.....................................................................\nPayment Amount:..............................................................................................." +
      "...........\nPayment Period:.............................................................................................................\nAmount " +
      "of Disputed Claims:.......................................................................................\nUpon " +
      "receipt by the undersigned of a check in the above-referenced Payment Amount payable to the undersigned, " +
      "and when the check has been properly endorsed and has been paid by the bank on which it is drawn, this " +
      "document becomes effective to release and the undersigned shall be deemed to waive any notice of lien, " +
      "any private bond right, any claim for payment and any rights under any similar ordinance, rule or statute " +
      "related to payment rights that the undersigned has on the above-described Property to the following " +
      "extent:\nThis release covers the final payment to the undersigned for all work, materials or equipment " +
      "furnished by the undersigned to the Property or to the Undersigned’s Customer and does not cover payment " +
      "for Disputed Claims, if any. Before any recipient of this document relies on it, the recipient should " +
      "verify evidence of payment to the undersigned. The undersigned warrants that he or she either has already " +
      "paid or will use the money received from the final payment promptly to pay in full all laborers, subcontractors, " +
      "materialmen and suppliers for all work, materials or equipment that are the subject of this waiver and " +
      "release.\nDated:......................................\n.......................................................\n(Company " +
      "Name)\nBy:.................................................\nIts:................................................."
  },
  {
    state: "NV",
    waiverType: "unconditional-final",
    citation: "NRS 108.2457(5)(d)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-108.html#NRS108Sec2457",
    checkedOn: "2026-10-10",
    sha256: "cf9d1780a0e1da39e82e96aec7e0ee0aed645457ad78b864466f94a75d100f8f",
    text: "UNCONDITIONAL WAIVER AND RELEASE\nUPON FINAL PAYMENT\nProperty Name:..............................................................................................................\nProperty " +
      "Location:.........................................................................................................\nUndersigned’s " +
      "Customer:.............................................................................................\nInvoice/Payment " +
      "Application Number:.....................................................................\nPayment Amount:..............................................................................................." +
      "...........\nAmount of Disputed Claims:.......................................................................................\nThe " +
      "undersigned has been paid in full for all work, materials and equipment furnished to the Customer for " +
      "the above-described Property and does hereby waive and release any notice of lien, any private bond " +
      "right, any claim for payment and any rights under any similar ordinance, rule or statute related to " +
      "payment rights that the undersigned has on the above-described Property, except for the payment of Disputed " +
      "Claims, if any, noted above. The undersigned warrants that he or she either has already paid or will " +
      "use the money received from this final payment promptly to pay in full all laborers, subcontractors, " +
      "materialmen and suppliers for all work, materials and equipment that are the subject of this waiver " +
      "and release.\nDated:......................................\n.......................................................\n(Company " +
      "Name)\nBy:.................................................\nIts:.................................................\n(Each " +
      "unconditional waiver and release must contain the following language, in type at least as large as the " +
      "largest type otherwise on the document:)\nNotice: This document waives rights unconditionally and states " +
      "that you have been paid for giving up those rights. This document is enforceable against you if you " +
      "sign it, even if you have not been paid. If you have not been paid, use a conditional release form."
  }
];

// packages/core/src/construction/usStates.ts
var US_STATES = [
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
];
function stateName(code) {
  return US_STATES.find(([c]) => c === code)?.[1];
}

// packages/core/src/construction/lienWaiver.ts
var WAIVER_TYPES = ["conditional-progress", "unconditional-progress", "conditional-final", "unconditional-final"];
var WAIVER_TYPE_LABELS = {
  "conditional-progress": "Conditional waiver on progress payment",
  "unconditional-progress": "Unconditional waiver on progress payment",
  "conditional-final": "Conditional waiver on final payment",
  "unconditional-final": "Unconditional waiver on final payment"
};
var STATUTORY_FORM_STATES = ["AZ", "CA", "FL", "GA", "MA", "MI", "MS", "MO", "NV", "TX", "UT", "WY"];
var STATUTORY_FORM_MISSING = "This state is commonly listed as having its own statutory waiver form, and this tool does not hold that form's text, so it generates nothing for this state";
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function isValidIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}
function longDate(iso) {
  if (!isValidIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function sha256HexSync(text) {
  const data = new TextEncoder().encode(text);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(data.length + 9 + 63 >> 6 << 6);
  padded.set(data);
  padded[data.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const hash = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  const w = new Uint32Array(64);
  const rotr = (x, n) => x >>> n | x << 32 - n;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15];
      const b2 = w[i - 2];
      const s0 = rotr(a2, 7) ^ rotr(a2, 18) ^ a2 >>> 3;
      const s1 = rotr(b2, 17) ^ rotr(b2, 19) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + s1 + ch + K[i] + w[i] >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = s0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => {
      hash[i] = hash[i] + v >>> 0;
    });
  }
  return hash.map((v) => v.toString(16).padStart(8, "0")).join("");
}
var AMOUNT_FIELDS = ["amountUSD", "amountNoSign"];
function fieldValues(input) {
  const t = (s) => (s ?? "").trim().replace(/\s+/g, " ");
  const usd = formatUSD(input.amount);
  const disputed = input.disputedAmount === null || input.disputedAmount === void 0 ? "" : formatUSD(input.disputedAmount);
  const name = t(input.projectName);
  const address = t(input.projectAddress);
  const maker = t(input.makerOfCheck);
  return {
    claimant: t(input.claimant),
    customer: t(input.customer),
    owner: t(input.owner),
    projectName: name,
    projectAddress: address,
    jobLocation: [name, address].filter(Boolean).join(", "),
    throughDate: longDate(input.throughDate.trim()),
    amountUSD: usd,
    amountNoSign: usd.replace("$", ""),
    makerOfCheck: maker,
    payee: t(input.payee),
    reference: t(input.reference),
    disputedUSD: disputed,
    disputedNoSign: disputed.replace("$", ""),
    paymentPeriod: t(input.paymentPeriod),
    exceptions: t(input.exceptions) || "None.",
    makerClause: maker ? ` by a check from ${maker}` : ""
  };
}
var HEADER = [
  "Project: {{projectName}}",
  "Project address: {{projectAddress}}",
  "Property owner: {{owner}}",
  "Claimant (the party signing this waiver): {{claimant}}",
  "Customer (the party that hired the claimant): {{customer}}"
];
var SIGNATURE = ["Claimant: {{claimant}}", "Signature: ______________________________", "Printed name and title: ______________________________", "Date signed: ______________________________"];
var NOT_WAIVED_PROGRESS = "3. What is not waived. This waiver does not cover: (a) retainage that has not been paid; (b) labor, services, equipment, or materials furnished after the through date; (c) change orders, extras, and claims that are pending or disputed and have not been paid; and (d) anything listed under Exceptions.";
var GENERIC_TEMPLATES = {
  "conditional-progress": [
    "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    ...HEADER,
    "Through date: {{throughDate}}",
    "Payment amount: {{amountUSD}}",
    "1. Condition. This waiver takes effect only when the claimant has actually received payment of {{amountUSD}}{{makerClause}}. A payment made by check is received when the check has cleared the bank it is drawn on. Until then this document waives nothing.",
    "2. What is waived. Once that payment is received, the claimant gives up its lien rights, payment bond rights, and other rights to make a claim against the project or the property for labor, services, equipment, and materials it furnished to the customer for this project through the through date, up to the payment amount.",
    NOT_WAIVED_PROGRESS,
    "4. Exceptions: {{exceptions}}",
    ...SIGNATURE
  ].join("\n"),
  "unconditional-progress": [
    "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    ...HEADER,
    "Through date: {{throughDate}}",
    "Payment amount: {{amountUSD}}",
    "1. Payment received. The claimant states that it has received payment of {{amountUSD}} for labor, services, equipment, and materials it furnished to the customer for this project through the through date.",
    "2. What is waived. This waiver takes effect when it is signed and does not depend on any later event. The claimant gives up its lien rights, payment bond rights, and other rights to make a claim against the project or the property for labor, services, equipment, and materials it furnished to the customer for this project through the through date, up to the payment amount.",
    NOT_WAIVED_PROGRESS,
    "4. Exceptions: {{exceptions}}",
    "This document says payment has already been received, and it takes effect on signing.",
    ...SIGNATURE
  ].join("\n"),
  "conditional-final": [
    "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    ...HEADER,
    "Work furnished through: {{throughDate}}",
    "Final payment amount: {{amountUSD}}",
    "1. Condition. This waiver takes effect only when the claimant has actually received final payment of {{amountUSD}}{{makerClause}}. A payment made by check is received when the check has cleared the bank it is drawn on. Until then this document waives nothing.",
    "2. What is waived. Once that payment is received, the claimant gives up all of its lien rights, payment bond rights, and other rights to make a claim against the project or the property for labor, services, equipment, and materials it furnished to the customer for this project, including retainage.",
    "3. What is not waived. This waiver does not cover anything listed under Exceptions.",
    "4. Exceptions: {{exceptions}}",
    ...SIGNATURE
  ].join("\n"),
  "unconditional-final": [
    "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    ...HEADER,
    "Work furnished through: {{throughDate}}",
    "Final payment amount: {{amountUSD}}",
    "1. Payment received. The claimant states that it has received final payment of {{amountUSD}} and has been paid in full for labor, services, equipment, and materials it furnished to the customer for this project, including retainage.",
    "2. What is waived. This waiver takes effect when it is signed and does not depend on any later event. The claimant gives up all of its lien rights, payment bond rights, and other rights to make a claim against the project or the property for labor, services, equipment, and materials it furnished to the customer for this project.",
    "3. What is not waived. This waiver does not cover anything listed under Exceptions.",
    "4. Exceptions: {{exceptions}}",
    "This document says final payment has already been received, and it takes effect on signing.",
    ...SIGNATURE
  ].join("\n")
};
function renderGeneric(type, values) {
  const parts = [];
  const template = GENERIC_TEMPLATES[type];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m;
  while (m = re.exec(template)) {
    if (m.index > last) parts.push({ kind: "text", value: template.slice(last, m.index) });
    const key = m[1];
    if (!(key in values)) throw new Error(`Unknown placeholder {{${key}}} in the ${type} wording.`);
    const value = values[key];
    if (value !== "" || key === "makerClause") parts.push({ kind: "fill", value });
    else parts.push({ kind: "blank", value: "__________" });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ kind: "text", value: template.slice(last) });
  return parts;
}
var RUN = /_{3,}|\.{6,}/g;
var LABEL_LINE = /[:$]$/;
var SIGN3 = ["sign", "sign", "sign"];
var STATUTORY_SLOT_MAPS = {
  // Arizona: project, job no., then the blanks in the body, then date, company name, signature, title.
  "AZ:conditional-progress": { style: "runs", slots: ["projectName", "reference", "makerOfCheck", "amountNoSign", "payee", "owner", "projectAddress", "customer", "throughDate", "sign", "claimant", "sign", "sign"] },
  "AZ:unconditional-progress": { style: "runs", slots: ["projectName", "reference", "amountNoSign", "customer", "owner", "projectAddress", "customer", "throughDate", "sign", "claimant", "sign", "sign"] },
  "AZ:conditional-final": { style: "runs", slots: ["projectName", "reference", "makerOfCheck", "amountNoSign", "payee", "owner", "projectAddress", "customer", "disputedNoSign", "sign", "claimant", "sign", "sign"] },
  "AZ:unconditional-final": { style: "runs", slots: ["projectName", "reference", "customer", "owner", "projectAddress", "disputedNoSign", "sign", "claimant", "sign", "sign"] },
  // California: label lines in order. 'none' marks a sentence that ends in a colon and is not a blank.
  // (The two California progress-payment forms are not stored yet; see lienWaiverStatutes.ts.)
  "CA:conditional-final": { style: "labels", slots: ["claimant", "customer", "jobLocation", "owner", "none", "makerOfCheck", "amountNoSign", "payee", "none", "disputedNoSign", ...SIGN3] },
  "CA:unconditional-final": { style: "labels", slots: ["claimant", "customer", "jobLocation", "owner", "none", "disputedNoSign", ...SIGN3] },
  // Nevada: the header lines, then date, company name, by, its.
  "NV:conditional-progress": { style: "runs", slots: ["projectName", "projectAddress", "customer", "reference", "amountUSD", "sign", "claimant", "sign", "sign"] },
  "NV:unconditional-progress": { style: "runs", slots: ["projectName", "projectAddress", "customer", "reference", "amountUSD", "sign", "claimant", "sign", "sign"] },
  "NV:conditional-final": { style: "runs", slots: ["projectName", "projectAddress", "customer", "reference", "amountUSD", "paymentPeriod", "disputedUSD", "sign", "claimant", "sign", "sign"] },
  "NV:unconditional-final": { style: "runs", slots: ["projectName", "projectAddress", "customer", "reference", "amountUSD", "disputedUSD", "sign", "claimant", "sign", "sign"] }
};
function findStatutoryText(state, waiverType) {
  return STATUTORY_WAIVER_TEXTS.find((f) => f.state === state && f.waiverType === waiverType);
}
function countStatutoryBlanks(text, style) {
  if (style === "runs") return (text.match(RUN) ?? []).length;
  return text.split("\n").filter((line) => LABEL_LINE.test(line)).length;
}
function renderStatutory(text, map, values) {
  const parts = [];
  const openBlanks = [];
  let n = 0;
  const place = (original, lead) => {
    const slot = map.slots[n++];
    if (slot === void 0 || slot === "none") {
      if (original) parts.push({ kind: "text", value: original });
      return;
    }
    const value = slot === "sign" ? "" : values[slot];
    if (value === "") {
      if (slot !== "sign") openBlanks.push(slot);
      parts.push({ kind: "blank", value: original || `${lead}__________`, original });
    } else parts.push({ kind: "fill", value: `${lead}${value}`, original });
  };
  if (map.style === "runs") {
    let last = 0;
    for (const m of text.matchAll(RUN)) {
      if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
      const before = text[m.index - 1] ?? " ";
      place(m[0], /[\s$(]/.test(before) ? "" : " ");
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  } else {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      parts.push({ kind: "text", value: i < lines.length - 1 && !LABEL_LINE.test(line) ? `${line}
` : line });
      if (LABEL_LINE.test(line)) {
        place("", line.endsWith("$") ? "" : " ");
        if (i < lines.length - 1) parts.push({ kind: "text", value: "\n" });
      }
    });
  }
  return { parts, openBlanks, blanksFound: n };
}
var escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function statuteTextIntact(documentText, storedText, style, slots) {
  let pattern;
  if (style === "runs") {
    pattern = storedText.split(RUN).map(escapeRegExp).join("([^\\n]*?)");
  } else {
    let n = 0;
    pattern = storedText.split("\n").map((line) => {
      if (!LABEL_LINE.test(line)) return escapeRegExp(line);
      const slot = slots?.[n++];
      return escapeRegExp(line) + (slot === "none" ? "" : "([^\\n]*)");
    }).join("\n");
  }
  return new RegExp(`^${pattern}$`).test(documentText);
}
function statuteTextFromParts(parts) {
  return parts.map((p) => p.kind === "text" ? p.value : p.original ?? "").join("");
}
function isWaiverType(s) {
  return WAIVER_TYPES.includes(s);
}
function generateLienWaiver(input) {
  assertCents(input.amount, "waiver amount");
  if (input.paymentDue !== null && input.paymentDue !== void 0) assertCents(input.paymentDue, "payment due");
  if (input.disputedAmount !== null && input.disputedAmount !== void 0) assertCents(input.disputedAmount, "disputed amount");
  const negative = [
    ["waiver amount", input.amount],
    ["payment due", input.paymentDue],
    ["disputed amount", input.disputedAmount]
  ].filter(([, value]) => typeof value === "number" && value < 0);
  const state = input.state.trim().toUpperCase();
  if (!stateName(state)) throw new Error(`"${input.state}" is not a state code this tool knows. Pick the state where the project is.`);
  const checks = new CheckList();
  const values = fieldValues(input);
  const typeOk = isWaiverType(input.waiverType);
  checks.that("type-valid", "Waiver type is one of the four types", typeOk, `"${input.waiverType}" is not a waiver type`);
  for (const [key, label] of [
    ["claimant", "Claimant name is filled in"],
    ["customer", "Customer name is filled in"],
    ["owner", "Owner name is filled in"],
    ["projectName", "Project name is filled in"],
    ["projectAddress", "Project address is filled in"]
  ]) {
    checks.that(`${key}-present`, label, values[key] !== "", "This field is empty");
  }
  checks.that("through-date-valid", "Through date is a valid date", isValidIsoDate(input.throughDate.trim()), `"${input.throughDate}" is not a calendar date`);
  checks.that("amount-positive", "Waiver amount is more than zero", input.amount > 0, `Amount entered is ${formatUSD(input.amount)}`);
  const amountsOk = checks.that(
    "amounts-not-negative",
    "No amount on the waiver is negative",
    negative.length === 0,
    `Negative: ${negative.map(([name, value]) => `${name} (${formatUSD(value)})`).join(", ")}. Nothing is generated until every amount is zero or more`
  );
  if (input.paymentDue === null || input.paymentDue === void 0) {
    checks.that("amount-matches-payment-due", "Waiver amount = current payment due from the pay application", false, "Payment due was left blank, so the amounts were not compared", "warning");
  } else {
    checks.cents("amount-matches-payment-due", "Waiver amount = current payment due from the pay application", input.paymentDue, input.amount);
  }
  const stored = typeOk ? findStatutoryText(state, input.waiverType) : void 0;
  const needsStatutory = STATUTORY_FORM_STATES.includes(state);
  let form = "generic";
  let parts = [];
  let openBlanks = [];
  let source;
  let blanksOnForm = null;
  if (!typeOk) {
    form = needsStatutory ? "unavailable" : "generic";
  } else if (!amountsOk) {
    form = "unavailable";
  } else if (needsStatutory && !stored) {
    form = "unavailable";
    checks.that("statutory-form-available", `${stateName(state)}: statutory form text is on file for this waiver type`, false, STATUTORY_FORM_MISSING);
  } else if (stored) {
    form = "statutory";
    const map = STATUTORY_SLOT_MAPS[`${state}:${input.waiverType}`];
    const hashOk = checks.equal("statute-hash", `Stored ${stored.citation} text matches its recorded SHA-256`, stored.sha256, sha256HexSync(stored.text));
    const blanks = map ? countStatutoryBlanks(stored.text, map.style) : -1;
    const mapOk = checks.equal("statute-blanks", "Every blank in the statutory form has a known position", map ? map.slots.length : 0, blanks);
    if (map && hashOk && mapOk) {
      const r = renderStatutory(stored.text, map, values);
      parts = r.parts;
      openBlanks = r.openBlanks;
      source = { citation: stored.citation, sourceUrl: stored.sourceUrl, checkedOn: stored.checkedOn, sha256: stored.sha256 };
      blanksOnForm = map.slots;
      const documentText = parts.map((x) => x.value).join("");
      checks.that("statute-text-intact", "With the filled-in blanks set aside, the document equals the stored statute text", statuteTextIntact(documentText, stored.text, map.style, map.slots), "The rendered document differs from the stored statute text");
      checks.that("blanks-filled", "Every blank other than the signature lines is filled in", openBlanks.length === 0, `Left blank: ${openBlanks.join(", ")}`, "warning");
    } else {
      form = "unavailable";
    }
  } else {
    parts = renderGeneric(input.waiverType, values);
    blanksOnForm = [...GENERIC_TEMPLATES[input.waiverType].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  }
  if (blanksOnForm && parts.length > 0) {
    const has = (...fields) => fields.some((f) => blanksOnForm.includes(f));
    const typed = (text2) => (text2 ?? "").trim() !== "";
    const dropped = [
      ["claimant", typed(input.claimant), has("claimant")],
      ["customer", typed(input.customer), has("customer")],
      ["owner", typed(input.owner), has("owner")],
      ["project name", typed(input.projectName), has("projectName", "jobLocation")],
      ["project address", typed(input.projectAddress), has("projectAddress", "jobLocation")],
      ["through date", typed(input.throughDate), has("throughDate")],
      ["maker of check", typed(input.makerOfCheck), has("makerOfCheck", "makerClause")],
      ["payee", typed(input.payee), has("payee")],
      ["job, invoice, or pay application number", typed(input.reference), has("reference")],
      ["disputed amount", input.disputedAmount !== null && input.disputedAmount !== void 0, has("disputedUSD", "disputedNoSign")],
      ["payment period", typed(input.paymentPeriod), has("paymentPeriod")],
      ["exceptions", typed(input.exceptions), has("exceptions")]
    ].filter(([, entered, onForm]) => entered && !onForm).map(([name]) => name);
    checks.that("fields-without-blank", "Every field that was filled in has a blank on this form", dropped.length === 0, `This form has no blank for: ${dropped.join(", ")}. ${dropped.length === 1 ? "It is" : "They are"} not on the document`, "warning");
  }
  const text = parts.map((p) => p.value).join("");
  if (parts.length > 0 && typeOk) {
    const printed = collectAmountFills(input, parts, form === "statutory" ? STATUTORY_SLOT_MAPS[`${state}:${input.waiverType}`] : void 0);
    if (printed.length === 0) {
      checks.that("amount-printed", "The waiver amount is printed on the document", false, "This form has no blank for the payment amount", "warning");
    } else {
      const readBack = printed.map((s) => {
        try {
          return parseAmount(s);
        } catch {
          return Number.NaN;
        }
      });
      checks.that("amount-printed", `The amount printed on the document reads back as ${formatUSD(input.amount)}`, readBack.every((c) => c === input.amount), `Printed: ${printed.join(", ")}`);
    }
  }
  return { input: { ...input, state }, form, parts, text, ...source ? { source } : {}, openBlanks, checks: checks.all };
}
function collectAmountFills(input, parts, map) {
  if (map) {
    const real = map.slots.filter((s) => s !== "none");
    const blanks = parts.filter((p) => p.kind !== "text");
    return blanks.filter((p, i) => AMOUNT_FIELDS.includes(real[i] ?? "") && p.kind === "fill").map((p) => p.value.trim());
  }
  const keys = [...GENERIC_TEMPLATES[input.waiverType].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const fills = parts.filter((p) => p.kind !== "text");
  return fills.filter((_, i) => AMOUNT_FIELDS.includes(keys[i] ?? "")).map((p) => p.value.trim());
}
function lienWaiverPlainText(result) {
  if (!result.text) return "";
  const lines = [result.text, ""];
  if (result.source) lines.push(`Form wording: ${result.source.citation}, as published at ${result.source.sourceUrl} on ${result.source.checkedOn}.`);
  else lines.push("Form wording: generic plain-language wording. It is not any state's statutory form.");
  return lines.join("\n") + "\n";
}

export {
  US_STATES,
  stateName,
  WAIVER_TYPES,
  WAIVER_TYPE_LABELS,
  STATUTORY_FORM_STATES,
  STATUTORY_FORM_MISSING,
  isValidIsoDate,
  longDate,
  sha256HexSync,
  GENERIC_TEMPLATES,
  STATUTORY_SLOT_MAPS,
  findStatutoryText,
  countStatutoryBlanks,
  statuteTextIntact,
  statuteTextFromParts,
  generateLienWaiver,
  lienWaiverPlainText
};
