/**
 * POST /api/chatbot/query with Gemini mocked (axios.post). The server looks up what the question names
 * and sends that with it, the model can call the inventory tools for anything else, busy or slow models
 * are retried on the next one, and the offline answer is used when Gemini can't answer in time.
 * Uses only the route handler, on an in-memory MongoDB.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post } }));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.GEMINI_API_KEY = 'test-key';
delete process.env.GEMINI_API_URL;
delete process.env.GEMINI_MODELS;

const { chatbotQuery, MAX_TOOL_ROUNDS, DEFAULT_GEMINI_MODELS, HEDGE_AFTER_MS } = await import('../controllers/chatbotController.js');
const { Medicine } = await import('../models/medicineModel.js');

let server;
let userSeq = 0;

const ask = async (message, userId = `user-${++userSeq}`, language = 'en') => {
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await chatbotQuery({ body: { message, language }, user: { id: userId } }, res);
  return out;
};

// One Gemini reply: a text answer, or function calls
const textReply = (text) => ({ data: { candidates: [{ content: { role: 'model', parts: [{ text }] } }] } });
const callReply = (...calls) => ({
  data: { candidates: [{ content: { role: 'model', parts: calls.map(([name, args]) => ({ functionCall: { name, args } })) } }] },
});
const httpError = (status, message = 'error') => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: { error: { message } } },
});
const requestBody = (i) => post.mock.calls[i][1];
const modelOf = (i) => post.mock.calls[i][0].match(/models\/([^:]+):/)[1];
const userText = (i) => requestBody(i).contents.at(-1).parts[0].text;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  const batch = (rack, quantity) => [{ batchNumber: `${rack}-1`, expiryDate: new Date('2030-01-01'), quantity, rackNumber: rack }];
  await Medicine.create([
    { name: 'Paracetamol 500mg', category: 'Analgesic', purchasePrice: 2, sellingPrice: 5, reorderLevel: 10, quantity: 40, batches: batch('A7', 40) },
    { name: 'Zincovit Tablet', category: 'Supplement', purchasePrice: 3, sellingPrice: 9, reorderLevel: 10, quantity: 25, batches: batch('S2', 25) },
    { name: 'Montelukast 10mg', category: 'Antiasthmatic', purchasePrice: 4, sellingPrice: 12, reorderLevel: 10, quantity: 30, batches: batch('M3', 30) },
  ]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(() => post.mockReset());

test('a named medicine is looked up first, so the model answers in one call', async () => {
  post.mockResolvedValueOnce(textReply('Paracetamol 500mg is in stock: 40 units on rack A7.'));

  const out = await ask('Do we have paracetamol?');

  expect(out.status).toBe(200);
  expect(out.body).toMatchObject({ success: true, source: 'gemini', response: 'Paracetamol 500mg is in stock: 40 units on rack A7.' });
  expect(post).toHaveBeenCalledTimes(1);

  const [url, body, config] = post.mock.calls[0];
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODELS[0]}:generateContent`);
  expect(config.headers['x-goog-api-key']).toBe('test-key'); // a header, not the URL
  expect(url).not.toContain('test-key');
  expect(body.systemInstruction.parts[0].text).toMatch(/inventory assistant/);
  expect(body.systemInstruction.parts[0].text).toMatch(/Plain text only/);
  expect(body.tools[0].functionDeclarations.map((t) => t.name)).toContain('search_medicines');

  // The question carries only the matching medicine, never the whole inventory
  const text = userText(0);
  expect(text).toMatch(/^Do we have paracetamol\?\n\n\[Inventory data the server already looked up/);
  expect(text).toContain('"rack":"A7"');
  for (const other of ['Zincovit', 'Montelukast']) expect(JSON.stringify(body)).not.toContain(other);
});

test('without a recognisable name the model looks things up with tools', async () => {
  post
    .mockResolvedValueOnce(callReply(['search_medicines', { query: 'zinc' }]))
    .mockResolvedValueOnce(textReply('Zincovit Tablet is on rack S2.'));

  const out = await ask('anything for vitamin deficiency?');

  expect(out.body.source).toBe('gemini');
  expect(userText(0)).toBe('anything for vitamin deficiency?'); // nothing prefetched
  const contents = requestBody(1).contents;
  expect(contents.at(-2).parts[0].functionCall).toEqual({ name: 'search_medicines', args: { query: 'zinc' } });
  const result = contents.at(-1).parts[0].functionResponse;
  expect(result.response.medicines.map((m) => m.name)).toEqual(['Zincovit Tablet']);
});

test('several calls in one turn are all answered, in order', async () => {
  post
    .mockResolvedValueOnce(callReply(['list_low_stock', {}], ['get_inventory_summary', {}]))
    .mockResolvedValueOnce(textReply('All good.'));

  await ask('how is everything');

  const parts = requestBody(1).contents.at(-1).parts;
  expect(parts.map((p) => p.functionResponse.name)).toEqual(['list_low_stock', 'get_inventory_summary']);
  expect(parts[1].functionResponse.response.totalMedicines).toBe(3);
});

test('a busy model (503) is retried on the next model', async () => {
  post
    .mockRejectedValueOnce(httpError(503, 'high demand'))
    .mockResolvedValueOnce(textReply('Zincovit Tablet: 25 units, rack S2.'));

  const out = await ask('stock of zincovit');

  expect(out.body).toMatchObject({ source: 'gemini', response: 'Zincovit Tablet: 25 units, rack S2.' });
  expect([modelOf(0), modelOf(1)]).toEqual(DEFAULT_GEMINI_MODELS);
});

test('a bad request (400) is not retried on another model', async () => {
  post.mockRejectedValue(httpError(400, 'invalid argument'));

  const out = await ask('stock of zincovit');

  expect(post).toHaveBeenCalledTimes(1);
  expect(out.body.source).toBe('fallback');
});

test('a slow model is raced against the next one and the first answer wins', async () => {
  let aborted = false;
  post
    .mockImplementationOnce((_url, _body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('canceled')); });
    }))
    .mockResolvedValueOnce(textReply('Montelukast 10mg is on rack M3.'));

  const started = Date.now();
  const out = await ask('where is montelukast');

  expect(out.body).toMatchObject({ source: 'gemini', response: 'Montelukast 10mg is on rack M3.' });
  expect(Date.now() - started).toBeGreaterThanOrEqual(HEDGE_AFTER_MS - 50);
  expect(modelOf(1)).toBe(DEFAULT_GEMINI_MODELS[1]);
  expect(aborted).toBe(true); // the slow request is cancelled
}, 15000);

test('GEMINI_MODELS sets the models to try', async () => {
  process.env.GEMINI_MODELS = 'model-a, model-b';
  post.mockRejectedValueOnce(httpError(429, 'quota')).mockResolvedValueOnce(textReply('ok'));

  await ask('stock of zincovit');

  expect([modelOf(0), modelOf(1)]).toEqual(['model-a', 'model-b']);
  delete process.env.GEMINI_MODELS;
});

test('a model that keeps calling tools is cut off and the offline answer is used', async () => {
  post.mockResolvedValue(callReply(['list_low_stock', {}]));

  const out = await ask('low stock?');

  expect(post).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
  expect(out.body.source).toBe('fallback');
  expect(out.body.response).toMatch(/All medicines are above their reorder level/);
});

test('when Gemini fails, the offline answer uses the looked-up data', async () => {
  post.mockRejectedValue(new Error('offline'));

  const out = await ask('stock of zincovit');

  expect(out.body.source).toBe('fallback');
  expect(out.body.response).toBe('Zincovit Tablet: in stock, 25 units at ₹9. Use batch S2-1 first (rack S2, expires 2030-01-01).');
});

test('the offline answer follows the language', async () => {
  post.mockRejectedValue(new Error('offline'));

  const out = await ask('ஜிங்கோவிட் இருக்கா?', undefined, 'ta');

  expect(out.body.response).toMatch(/இருப்பில் உள்ளது|உதவ முடியும்/);
});

test('memory keeps only the question and answer text, never the looked-up data', async () => {
  post
    .mockResolvedValueOnce(textReply('Montelukast is on rack M3.'))
    .mockResolvedValueOnce(textReply('You are welcome.'));

  await ask('Where is montelukast?', 'memory-user');
  await ask('Thanks', 'memory-user');

  const contents = requestBody(1).contents;
  expect(contents.slice(0, 2)).toEqual([
    { role: 'user', parts: [{ text: 'Where is montelukast?' }] },
    { role: 'model', parts: [{ text: 'Montelukast is on rack M3.' }] },
  ]);
  expect(contents[2].parts[0].text).toMatch(/^Thanks/);
});
