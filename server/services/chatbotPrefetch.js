/**
 * @file Server-side lookups for a chatbot question, run before the model is called.
 * @module services/chatbotPrefetch
 *
 * Most questions name a medicine or ask about low stock, expiry or today's sales. Running those tool
 * lookups up front and handing the results to the model with the question means it can usually answer
 * in ONE call instead of two to five tool round trips (each round trip is a slow, rate-limited request
 * on the free Gemini tier). The model still has the tools for anything the lookups missed.
 *
 * The same lookups power the offline answer (`buildFallbackAnswer`) when the model is unavailable, so
 * that answer follows the same stock and expiry rules as the model's (an expired batch is not stock).
 */
import { Medicine } from '../models/medicineModel.js';
import { runTool } from './chatbotTools.js';

/** At most this many named medicines are looked up per question. */
export const MAX_NAMED_LOOKUPS = 3;

const INTENTS = {
  lowStock: /low[\s-]*(on[\s-]*)?stock|running\s+low|reorder|out\s+of\s+stock|shortage|restock|குறைந்த|குறைவு|பற்றாக்குறை/i,
  expiry: /expir|expiring|காலாவதி/i,
  summary: /summary|overview|sales|sold|revenue|today'?s?\s+(business|bills?)|how\s+many\s+(medicines|items|products)|சுருக்கம்|விற்பனை/i,
};

// Lower-case words of at least 3 letters/digits, any script (Tamil vowel signs and virama are marks)
const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]{2,}/gu) || []);

/**
 * Common Indian brand names -> the generic name the inventory uses. A question about "Dolo 650" then
 * finds paracetamol without the model having to guess through several searches.
 */
export const BRAND_TO_GENERIC = {
  dolo: 'paracetamol', crocin: 'paracetamol', calpol: 'paracetamol', pacimol: 'paracetamol', tylenol: 'paracetamol',
  brufen: 'ibuprofen', ibugesic: 'ibuprofen', advil: 'ibuprofen', combiflam: 'ibuprofen',
  disprin: 'aspirin', ecosprin: 'aspirin',
  augmentin: 'amoxicillin', mox: 'amoxicillin', novamox: 'amoxicillin', clavam: 'amoxicillin',
  azee: 'azithromycin', azithral: 'azithromycin', zithromax: 'azithromycin',
  okacet: 'cetirizine', cetzine: 'cetirizine', zyrtec: 'cetirizine',
  glycomet: 'metformin', glucophage: 'metformin',
  amlong: 'amlodipine', stamlo: 'amlodipine', amlip: 'amlodipine',
  omez: 'omeprazole', ocid: 'omeprazole',
  limcee: 'vitamin', celin: 'vitamin',
};

// Tamil consonants -> a rough Latin sound class (vowels are ignored on both sides)
const TAMIL_CONSONANTS = {
  க: 'k', ங: 'n', ச: 's', ஞ: 'n', ட: 't', ண: 'n', த: 't', ந: 'n', ப: 'p', ம: 'm', ய: '', ர: 'r',
  ல: 'l', வ: 'v', ழ: 'l', ள: 'l', ற: 'r', ன: 'n', ஜ: 's', ஷ: 's', ஸ: 's', ஹ: '',
};
const isTamil = (word) => /[\u0B80-\u0BFF]/.test(word);

/**
 * A consonant skeleton for comparing a Tamil-script word with a Latin name: "பாராசிட்டமால்" and
 * "paracetamol" both become "prstml". Voiced and unvoiced sounds share a class (Tamil script doesn't
 * distinguish them), vowels are dropped and repeats collapsed.
 */
export const soundSkeleton = (word) => {
  let latin;
  if (isTamil(word)) {
    latin = [...word].map((ch) => TAMIL_CONSONANTS[ch] ?? '').join('');
  } else {
    latin = word.toLowerCase()
      .replace(/ph/g, 'p').replace(/x/g, 'ks').replace(/q/g, 'k').replace(/c/g, 's')
      .replace(/[gG]/g, 'k').replace(/d/g, 't').replace(/b/g, 'p').replace(/f/g, 'p').replace(/[zj]/g, 's')
      .replace(/w/g, 'v').replace(/[aeiouyh]/g, '').replace(/[^a-z]/g, '');
  }
  return latin.replace(/(.)\1+/g, '$1');
};

// Edit distance, capped: returns max + 1 as soon as it is certainly larger than max
const editDistance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
};

// Does a word of the question refer to this medicine-name word? Exact, a prefix of 4+ letters
// ("amox" -> "amoxicillin"), a small typo in a longer word ("paracetmol"), or the same name in Tamil
// script ("அமோக்ஸிசிலின்").
const wordMatches = (q, n) => {
  if (q === n) return true;
  if (isTamil(q)) {
    const a = soundSkeleton(q);
    const b = soundSkeleton(n);
    return a.length >= 4 && (a === b || (a.length >= 7 && b.length >= 7 && editDistance(a, b, 1) <= 1));
  }
  if (q.length >= 4 && n.startsWith(q)) return true;
  if (n.length >= 6 && q.length >= 5) return editDistance(q, n, n.length >= 9 ? 2 : 1) <= (n.length >= 9 ? 2 : 1);
  return false;
};

/**
 * Names of medicines the text mentions, best match first: medicines whose distinctive (first) name
 * word appears in the text. Reads only the names.
 */
export const findMentionedMedicines = async (text) => {
  // A brand name counts as a mention of its generic name
  const qWords = words(text).flatMap((w) => (BRAND_TO_GENERIC[w] ? [w, BRAND_TO_GENERIC[w]] : [w]));
  if (qWords.length === 0) return [];
  const medicines = await Medicine.find({}, 'name').lean();
  const hits = [];
  for (const { name } of medicines) {
    const first = words(name)[0];
    if (!first) continue;
    const exact = qWords.includes(first);
    if (exact || qWords.some((q) => wordMatches(q, first))) hits.push({ name, exact });
  }
  return hits
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name))
    .map((h) => h.name)
    .slice(0, MAX_NAMED_LOOKUPS);
};

// A follow-up that points back at the previous question ("and its rack?", "அதன் விலை?")
const REFERS_BACK = /\b(it|its|it's|that|this|those|these|them|they|same)\b|அது|அதன்|இது|இதன்|அவை/i;

const daysIn = (text) => {
  const m = String(text).match(/(\d{1,3})\s*(day|days|நாள்|நாட்கள்)/i);
  return m ? Number(m[1]) : undefined;
};

/**
 * Runs the lookups the question clearly needs. Returns `[{ tool, args, result }]` (possibly empty),
 * in the order they were run. A follow-up that names nothing but points back ("and its rack?") reuses
 * the medicines named in the previous question.
 */
export const prefetchForQuestion = async (message, history = [], now = new Date()) => {
  const lookups = [];
  const run = async (tool, args = {}) => {
    const result = await runTool(tool, args, now);
    lookups.push({ tool, args, result });
    return result;
  };

  const wantsLow = INTENTS.lowStock.test(message);
  const wantsExpiry = INTENTS.expiry.test(message);
  const wantsSummary = INTENTS.summary.test(message);

  for (const w of words(message)) {
    if (BRAND_TO_GENERIC[w]) lookups.push({ tool: 'brand_name', args: { brand: w }, result: { generic: BRAND_TO_GENERIC[w], note: 'Brand name; stock is kept under the generic name' } });
  }

  let names = await findMentionedMedicines(message);
  if (names.length === 0 && !wantsLow && !wantsExpiry && !wantsSummary && REFERS_BACK.test(message)) {
    const lastQuestion = [...history].reverse().find((t) => t.role === 'user')?.text;
    if (lastQuestion) names = await findMentionedMedicines(lastQuestion);
  }

  // Named medicines, then alternatives for any that cannot be sold
  const unavailableCategories = new Map();
  for (const name of names) {
    const result = await run('search_medicines', { query: name });
    const exact = (result.medicines || []).find((m) => m.name === name) || result.medicines?.[0];
    if (exact && !exact.inStock && exact.category && exact.category !== 'N/A') {
      unavailableCategories.set(exact.category, exact.name);
    }
  }
  for (const [category, exclude] of unavailableCategories) await run('find_alternatives', { category, exclude });

  if (wantsLow) await run('list_low_stock');
  if (wantsExpiry) await run('list_expiring_batches', { days: daysIn(message) });
  if (wantsSummary) await run('get_inventory_summary');

  return lookups;
};

/** The lookups as text for the model, appended to the user's question. */
export const formatLookupsForModel = (lookups) =>
  lookups.length === 0
    ? ''
    : `\n\n[Inventory data the server already looked up for this question. It is live and authoritative; use it, and call a tool only for anything it does not cover.]\n${lookups
        .map((l) => `${l.tool}(${JSON.stringify(l.args)}) -> ${JSON.stringify(l.result)}`)
        .join('\n')}`;

// ── Offline answer ───────────────────────────────────────────────────────

const T = {
  en: {
    inStock: (m, b) => `${m.name}: in stock, ${m.sellableQuantity} units at ₹${m.price}. Use batch ${b.batch} first (rack ${b.rack}, expires ${b.expiry}).`,
    expiredOnly: (m) => `${m.name}: not available. All ${m.expiredQuantityStillOnShelf} units on the shelf have expired; remove them.`,
    noStock: (m) => `${m.name}: not available (out of stock).`,
    notFound: (q) => `${q}: not in the inventory.`,
    brand: (b, g) => `${b[0].toUpperCase()}${b.slice(1)} is a brand of ${g}; stock is listed under ${g}.`,
    alternatives: (cat, list) => `In-stock ${cat} alternatives:\n${list}`,
    noAlternatives: (cat) => `No other ${cat} medicine is in stock.`,
    alt: (m) => `• ${m.name}: ${m.sellableQuantity} units, ₹${m.price}, rack ${m.activeBatches[0]?.rack || 'N/A'}`,
    lowHeader: 'Low stock (most urgent first):',
    low: (m) => `• ${m.name}: ${m.totalQuantity} units (reorder at ${m.reorderLevel}, ${m.stockLevel})`,
    lowNone: 'All medicines are above their reorder level.',
    expHeader: (d) => `Expired or expiring within ${d} days:`,
    exp: (b) => `• ${b.medicine} batch ${b.batch}, rack ${b.rack}: ${b.quantity} units, ${b.status === 'expired' ? `EXPIRED on ${b.expiry}` : `expires ${b.expiry} (${b.daysLeft} days)`}`,
    expNone: (d) => `No stock expires within ${d} days.`,
    summary: (s) => `Inventory: ${s.totalMedicines} medicines, ${s.lowStockMedicines} low on stock, ${s.medicinesWithExpiredStock} with expired stock.\nToday's sales: ₹${s.todaySales.amount} from ${s.todaySales.bills} bills.`,
    more: (n) => `…and ${n} more.`,
    help: 'I can help with inventory questions: ask about a medicine by name, low stock, expiring batches, or today\'s sales.',
  },
  ta: {
    inStock: (m, b) => `${m.name}: இருப்பில் உள்ளது, ${m.sellableQuantity} அலகுகள், விலை ₹${m.price}. முதலில் தொகுதி ${b.batch} (ரேக் ${b.rack}, காலாவதி ${b.expiry}).`,
    expiredOnly: (m) => `${m.name}: கிடைக்கவில்லை. அலமாரியில் உள்ள ${m.expiredQuantityStillOnShelf} அலகுகளும் காலாவதியானவை; அவற்றை அகற்றவும்.`,
    noStock: (m) => `${m.name}: கிடைக்கவில்லை (இருப்பு இல்லை).`,
    notFound: (q) => `${q}: சரக்கில் இல்லை.`,
    brand: (b, g) => `${b} என்பது ${g} மருந்தின் பிராண்ட் பெயர்; இருப்பு ${g} பெயரில் உள்ளது.`,
    alternatives: (cat, list) => `இருப்பில் உள்ள ${cat} மாற்று மருந்துகள்:\n${list}`,
    noAlternatives: (cat) => `வேறு ${cat} மருந்து இருப்பில் இல்லை.`,
    alt: (m) => `• ${m.name}: ${m.sellableQuantity} அலகுகள், ₹${m.price}, ரேக் ${m.activeBatches[0]?.rack || 'N/A'}`,
    lowHeader: 'குறைந்த இருப்பு (அவசரம் முதலில்):',
    low: (m) => `• ${m.name}: ${m.totalQuantity} அலகுகள் (மறு ஆர்டர் நிலை ${m.reorderLevel})`,
    lowNone: 'அனைத்து மருந்துகளும் போதுமான அளவில் உள்ளன.',
    expHeader: (d) => `காலாவதியானவை அல்லது ${d} நாட்களில் காலாவதியாகுபவை:`,
    exp: (b) => `• ${b.medicine} தொகுதி ${b.batch}, ரேக் ${b.rack}: ${b.quantity} அலகுகள், ${b.status === 'expired' ? `${b.expiry} அன்று காலாவதியானது` : `${b.expiry} அன்று காலாவதி (${b.daysLeft} நாட்கள்)`}`,
    expNone: (d) => `${d} நாட்களில் எந்த இருப்பும் காலாவதியாகவில்லை.`,
    summary: (s) => `சரக்கு: ${s.totalMedicines} மருந்துகள், ${s.lowStockMedicines} குறைந்த இருப்பு, ${s.medicinesWithExpiredStock} காலாவதி இருப்புடன்.\nஇன்றைய விற்பனை: ₹${s.todaySales.amount}, ${s.todaySales.bills} பில்கள்.`,
    more: (n) => `…மேலும் ${n}.`,
    help: 'சரக்கு கேள்விகளுக்கு உதவ முடியும்: மருந்தின் பெயர், குறைந்த இருப்பு, காலாவதி அல்லது இன்றைய விற்பனை பற்றி கேளுங்கள்.',
  },
};

const withMore = (t, lines, result) =>
  result.truncated ? [...lines, t.more(result.total - lines.length)] : lines;

/**
 * A deterministic answer from the lookups, for when the model is unavailable. Same rules as the tools:
 * a medicine is available only with an active (unexpired, non-empty) batch.
 */
export const buildFallbackAnswer = (lookups, language = 'en') => {
  const t = T[language] || T.en;
  const parts = [];
  for (const { tool, args, result } of lookups) {
    if (result?.error) continue;
    if (tool === 'brand_name') {
      parts.push(t.brand(args.brand, result.generic));
    } else if (tool === 'search_medicines') {
      const m = (result.medicines || []).find((x) => x.name.toLowerCase() === String(args.query).toLowerCase()) || result.medicines?.[0];
      if (!m) parts.push(t.notFound(args.query));
      else if (m.inStock) parts.push(t.inStock(m, m.activeBatches[0]));
      else if (m.expiredQuantityStillOnShelf) parts.push(t.expiredOnly(m));
      else parts.push(t.noStock(m));
    } else if (tool === 'find_alternatives') {
      const alts = result.alternatives || [];
      parts.push(alts.length ? t.alternatives(result.category, withMore(t, alts.map(t.alt), result).join('\n')) : t.noAlternatives(result.category));
    } else if (tool === 'list_low_stock') {
      const low = result.lowStock || [];
      parts.push(low.length ? [t.lowHeader, ...withMore(t, low.map(t.low), result)].join('\n') : t.lowNone);
    } else if (tool === 'list_expiring_batches') {
      const batches = result.batches || [];
      parts.push(batches.length ? [t.expHeader(result.windowDays), ...withMore(t, batches.map(t.exp), result)].join('\n') : t.expNone(result.windowDays));
    } else if (tool === 'get_inventory_summary') {
      parts.push(t.summary(result));
    }
  }
  return parts.length ? parts.join('\n\n') : t.help;
};
