/**
 * POST /api/chatbot/query with Gemini mocked (axios.post): the model gets a short system instruction
 * and inventory tools instead of the whole inventory, the server runs the tool calls it asks for and
 * sends the results back, and the keyword fallback still answers when Gemini fails.
 * Uses only the route handler, on an in-memory MongoDB.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post } }));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.GEMINI_API_KEY = 'test-key';

const { chatbotQuery } = await import('../controllers/chatbotController.js');
const { Medicine } = await import('../models/medicineModel.js');

let server;
let userSeq = 0;

const ask = async (message, userId = `user-${++userSeq}`) => {
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await chatbotQuery({ body: { message, language: 'en' }, user: { id: userId } }, res);
  return out;
};

// One Gemini reply: a text answer, or function calls
const textReply = (text) => ({ data: { candidates: [{ content: { role: 'model', parts: [{ text }] } }] } });
const callReply = (...calls) => ({
  data: { candidates: [{ content: { role: 'model', parts: calls.map(([name, args]) => ({ functionCall: { name, args } })) } }] },
});
const requestBody = (i) => post.mock.calls[i][1];

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

test('the prompt carries no inventory; the model looks up what it needs with a tool', async () => {
  post
    .mockResolvedValueOnce(callReply(['search_medicines', { query: 'paracetamol' }]))
    .mockResolvedValueOnce(textReply('Paracetamol 500mg is in stock: 40 units on rack A7.'));

  const out = await ask('Do we have paracetamol?');

  expect(out.status).toBe(200);
  expect(out.body).toMatchObject({ success: true, source: 'gemini', response: 'Paracetamol 500mg is in stock: 40 units on rack A7.' });
  expect(post).toHaveBeenCalledTimes(2);

  // First request: no medicine data at all, and the tools are offered
  const first = JSON.stringify(requestBody(0));
  for (const name of ['Paracetamol', 'Zincovit', 'Montelukast', 'A7', 'S2', 'M3']) expect(first).not.toContain(name);
  expect(requestBody(0).tools[0].functionDeclarations.map((t) => t.name)).toContain('search_medicines');
  expect(requestBody(0).systemInstruction.parts[0].text).toMatch(/inventory assistant/);

  // Second request: the model's call, then the tool result with only the matching medicine
  const contents = requestBody(1).contents;
  expect(contents.at(-2).parts[0].functionCall).toEqual({ name: 'search_medicines', args: { query: 'paracetamol' } });
  const result = contents.at(-1).parts[0].functionResponse;
  expect(result.name).toBe('search_medicines');
  expect(result.response.medicines.map((m) => m.name)).toEqual(['Paracetamol 500mg']);
  expect(result.response.medicines[0].activeBatches[0].rack).toBe('A7');
  expect(JSON.stringify(requestBody(1))).not.toContain('Zincovit');
});

test('several calls in one turn are all answered, in order', async () => {
  post
    .mockResolvedValueOnce(callReply(['list_low_stock', {}], ['get_inventory_summary', {}]))
    .mockResolvedValueOnce(textReply('All good.'));

  await ask('Anything low? And how did we do today?');

  const parts = requestBody(1).contents.at(-1).parts;
  expect(parts.map((p) => p.functionResponse.name)).toEqual(['list_low_stock', 'get_inventory_summary']);
  expect(parts[1].functionResponse.response.totalMedicines).toBe(3);
});

test('a model that keeps calling tools is cut off and the keyword fallback answers', async () => {
  post.mockResolvedValue(callReply(['list_low_stock', {}]));

  const out = await ask('low stock?');

  expect(post).toHaveBeenCalledTimes(5); // MAX_TOOL_ROUNDS (4) + 1
  expect(out.body.source).toBe('fallback');
  expect(out.body.response).toMatch(/adequately stocked|Low stock/);
});

test('when Gemini fails the keyword fallback answers from the database', async () => {
  post.mockRejectedValue(new Error('offline'));

  const out = await ask('stock of zincovit');

  expect(out.body.source).toBe('fallback');
  expect(out.body.response).toMatch(/Zincovit Tablet/);
});

test('memory keeps only the question and answer text, never tool data', async () => {
  post
    .mockResolvedValueOnce(callReply(['search_medicines', { query: 'montelukast' }]))
    .mockResolvedValueOnce(textReply('Montelukast is on rack M3.'))
    .mockResolvedValueOnce(textReply('You are welcome.'));

  await ask('Where is montelukast?', 'memory-user');
  await ask('Thanks', 'memory-user');

  expect(requestBody(2).contents).toEqual([
    { role: 'user', parts: [{ text: 'Where is montelukast?' }] },
    { role: 'model', parts: [{ text: 'Montelukast is on rack M3.' }] },
    { role: 'user', parts: [{ text: 'Thanks' }] },
  ]);
});
