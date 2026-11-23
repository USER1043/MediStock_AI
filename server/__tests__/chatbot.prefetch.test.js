/**
 * Server-side lookups before the model call (services/chatbotPrefetch.js) and the offline answer built
 * from them, against an in-memory MongoDB. "now" is fixed at 25 Nov 2026 12:00 IST.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { findMentionedMedicines, prefetchForQuestion, analyzeQuestion, buildFallbackAnswer, formatLookupsForModel, soundSkeleton } =
  await import('../services/chatbotPrefetch.js');
const { Medicine } = await import('../models/medicineModel.js');

const NOW = new Date('2026-11-25T06:30:00Z');
const d = (iso) => new Date(`${iso}T00:00:00Z`);
let server;

const med = (name, category, batches, reorderLevel = 20) =>
  Medicine.create({
    name, category, purchasePrice: 2, sellingPrice: 5, reorderLevel,
    quantity: batches.reduce((s, b) => s + b.quantity, 0),
    batches: batches.map((b, i) => ({ batchNumber: `${name.slice(0, 3)}-${i}`, expiryDate: d(b.expiry), quantity: b.quantity, rackNumber: b.rack })),
  });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await med('Paracetamol 500mg', 'Analgesic', [{ expiry: '2026-11-08', quantity: 200, rack: 'A2' }]); // expired
  await med('Aspirin', 'Analgesic', [{ expiry: '2027-05-22', quantity: 500, rack: 'A1' }]);
  await med('Amoxicillin', 'Antibiotic', [{ expiry: '2026-12-13', quantity: 45, rack: 'B2' }], 100); // low, expiring
  await med('Cetirizine', 'Antihistamine', [{ expiry: '2027-04-22', quantity: 150, rack: 'B1' }]);
  await med('Azithromycin', 'Antibiotic', [{ expiry: '2027-01-22', quantity: 60, rack: 'E2' }]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

const tools = (lookups) => lookups.map((l) => l.tool);

describe('finding the medicines a question names', () => {
  test.each([
    ['Do we have paracetamol?', ['Paracetamol 500mg']],
    ['stock of PARACETMOL', ['Paracetamol 500mg']], // typo
    ['amox left?', ['Amoxicillin']], // prefix
    ['cetirizine and aspirin price', ['Aspirin', 'Cetirizine']],
    ['Do we have Dolo 650?', ['Paracetamol 500mg']], // brand name
    ['பாராசிட்டமால் இருக்கா?', ['Paracetamol 500mg']], // Tamil script
    ['அமோக்ஸிசிலின் இருப்பு உள்ளதா?', ['Amoxicillin']],
    ['செட்டிரிசின் இருக்கா?', ['Cetirizine']], // not also "Azithromycin" (one letter apart)
    ['how are sales today', []],
    ['hello', []],
  ])('%s', async (question, expected) => {
    expect((await findMentionedMedicines(question)).sort()).toEqual(expected.sort());
  });

  test('Tamil and English spellings reduce to the same sound skeleton', () => {
    expect(soundSkeleton('பாராசிட்டமால்')).toBe(soundSkeleton('paracetamol'));
    expect(soundSkeleton('செட்டிரிசின்')).toBe(soundSkeleton('cetirizine'));
    expect(soundSkeleton('மெட்ஃபார்மின்')).toBe(soundSkeleton('metformin'));
  });
});

describe('prefetchForQuestion', () => {
  test('an expired medicine gets its alternatives looked up too', async () => {
    const lookups = await prefetchForQuestion('Do we have paracetamol?', [], NOW);
    expect(tools(lookups)).toEqual(['search_medicines', 'find_alternatives']);
    expect(lookups[1].args).toEqual({ category: 'Analgesic', exclude: 'Paracetamol 500mg' });
    expect(lookups[1].result.alternatives.map((m) => m.name)).toEqual(['Aspirin']);
  });

  test('an in-stock medicine needs no alternatives', async () => {
    expect(tools(await prefetchForQuestion('Is cetirizine available?', [], NOW))).toEqual(['search_medicines']);
  });

  test('topics: low stock, expiry (with the window from the question) and the summary', async () => {
    expect(tools(await prefetchForQuestion('Which medicines are low on stock?', [], NOW))).toEqual(['list_low_stock']);
    const exp = await prefetchForQuestion('what expires in 60 days', [], NOW);
    expect(exp[0]).toMatchObject({ tool: 'list_expiring_batches', args: { days: 60 } });
    expect(tools(await prefetchForQuestion("Give me today's sales", [], NOW))).toEqual(['get_inventory_summary']);
    expect(tools(await prefetchForQuestion('குறைந்த இருப்பு மருந்துகள்', [], NOW))).toEqual(['list_low_stock']);
  });

  test('a brand name is noted for the model', async () => {
    const lookups = await prefetchForQuestion('Do we have Dolo 650?', [], NOW);
    expect(lookups[0]).toMatchObject({ tool: 'brand_name', args: { brand: 'dolo' }, result: { generic: 'paracetamol' } });
    expect(tools(lookups)).toEqual(['brand_name', 'search_medicines', 'find_alternatives']);
  });

  test('a follow-up that names nothing reuses the previous question', async () => {
    const history = [{ role: 'user', text: 'price of cetirizine?' }, { role: 'model', text: '₹5' }];
    const lookups = await prefetchForQuestion('and its rack?', history, NOW);
    expect(lookups.map((l) => l.args.query)).toEqual(['Cetirizine']);
  });

  test('a new question that names nothing does not reuse the previous one', async () => {
    const history = [{ role: 'user', text: 'price of cetirizine?' }, { role: 'model', text: '₹5' }];
    expect(await prefetchForQuestion('anything for acidity?', history, NOW)).toEqual([]);
  });

  test('nothing recognisable means no lookups, and the model uses its tools', async () => {
    expect(await prefetchForQuestion('hello there', [], NOW)).toEqual([]);
    expect(formatLookupsForModel([])).toBe('');
  });
});

describe('categories and whether the lookups answer everything', () => {
  test('an everyday word for a category lists its in-stock medicines', async () => {
    const { lookups, covered } = await analyzeQuestion('anything for pain?', [], NOW);
    expect(lookups.map((l) => [l.tool, l.args])).toEqual([['find_alternatives', { category: 'Analgesic' }]]);
    expect(lookups[0].result.alternatives.map((m) => m.name)).toEqual(['Aspirin']); // expired paracetamol left out
    expect(covered).toBe(true);
    expect(buildFallbackAnswer(lookups)).toMatch(/^In stock \(Analgesic\):\n• Aspirin: 500 units/);
  });

  test.each([
    'Do we have paracetamol?',
    'Is Cetirizine available and which rack?',
    'Which medicines are low on stock?',
    'What is expiring in the next 30 days?',
    'Do we have Dolo 650? If not, suggest something.',
    "Give me today's sales",
    'பாராசிட்டமால் இருக்கா?',
  ])('covered: %s', async (question) => {
    expect((await analyzeQuestion(question, [], NOW)).covered).toBe(true);
  });

  test.each([
    ['can I give paracetamol to a child?', 'child'],
    ['which is cheaper, aspirin or cetirizine?', 'cheaper'],
    ['why is amoxicillin low?', 'why'],
  ])('needs the model: %s', async (question, word) => {
    const { covered, leftover } = await analyzeQuestion(question, [], NOW);
    expect(covered).toBe(false);
    expect(leftover).toContain(word);
  });

  test('nothing looked up is never covered', async () => {
    expect((await analyzeQuestion('hello', [], NOW)).covered).toBe(false);
  });
});

describe('buildFallbackAnswer', () => {
  test('expired stock is not reported as available, and alternatives are given', async () => {
    const answer = buildFallbackAnswer(await prefetchForQuestion('Do we have paracetamol?', [], NOW));
    expect(answer).toMatch(/Paracetamol 500mg: not available\. All 200 units on the shelf have expired/);
    expect(answer).toMatch(/In-stock Analgesic alternatives:\n• Aspirin: 500 units, ₹5, rack A1/);
    expect(answer).not.toContain('\\n'); // real line breaks
  });

  test('in stock: quantity, price, and the batch and rack to use first', async () => {
    const answer = buildFallbackAnswer(await prefetchForQuestion('cetirizine?', [], NOW));
    expect(answer).toBe('Cetirizine: in stock, 150 units at ₹5. Use batch Cet-0 first (rack B1, expires 2027-04-22).');
  });

  test('low stock and expiring lists', async () => {
    expect(buildFallbackAnswer(await prefetchForQuestion('low stock?', [], NOW))).toMatch(/^Low stock.*\n• Amoxicillin: 45 units/);
    const exp = buildFallbackAnswer(await prefetchForQuestion('expiring soon?', [], NOW));
    expect(exp).toMatch(/Paracetamol 500mg batch Par-0, rack A2: 200 units, EXPIRED on 2026-11-08/);
    expect(exp).toMatch(/Amoxicillin batch Amo-0, rack B2: 45 units, expires 2026-12-13 \(18 days\)/);
  });

  test('brand names are explained', async () => {
    expect(buildFallbackAnswer(await prefetchForQuestion('Do we have Dolo?', [], NOW))).toMatch(/^Dolo is a brand of paracetamol/);
  });

  test('Tamil answers', async () => {
    const answer = buildFallbackAnswer(await prefetchForQuestion('பாராசிட்டமால் இருக்கா?', [], NOW), 'ta');
    expect(answer).toMatch(/Paracetamol 500mg: கிடைக்கவில்லை/);
    expect(answer).toMatch(/Aspirin/);
  });

  test('nothing looked up: a short help message', () => {
    expect(buildFallbackAnswer([], 'en')).toMatch(/I can help with inventory questions/);
  });
});
