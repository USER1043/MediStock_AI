/**
 * POST /api/chatbot/query with Gemini mocked (axios.post). Questions the server's lookups fully answer
 * get a direct answer with no model call; others go to Gemini with the looked-up data. Free-tier
 * requests are saved by caching, cooling down a model after 429/503 and a per-user budget; busy or slow
 * models are retried on the next one; and the offline answer is used when Gemini can't answer in time.
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
delete process.env.CHATBOT_DIRECT_ANSWERS;

const {
  chatbotQuery, resetChatbotState, MAX_TOOL_ROUNDS, MAX_TOOL_ROUNDS_WITH_DATA, DEFAULT_GEMINI_MODELS, HEDGE_AFTER_MS,
  USER_MODEL_QUESTIONS_PER_MINUTE,
} = await import('../controllers/chatbotController.js');
const { Medicine } = await import('../models/medicineModel.js');

let server;
let userSeq = 0;

const ask = async (message, userId = `user-${++userSeq}`, language = 'en') => {
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await chatbotQuery({ body: { message, language }, user: { id: userId } }, res);
  return out;
};

// Needs the model: names medicines, but "compare" is not something the lookups answer
const MODEL_QUESTION = 'compare zincovit and montelukast';

// One Gemini reply: a text answer, or function calls
const textReply = (text) => ({ data: { candidates: [{ content: { role: 'model', parts: [{ text }] } }] } });
const callReply = (...calls) => ({
  data: { candidates: [{ content: { role: 'model', parts: calls.map(([name, args]) => ({ functionCall: { name, args } })) } }] },
});
const httpError = (status, message = 'error', details = []) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: { error: { message, details } } },
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

beforeEach(() => {
  post.mockReset();
  resetChatbotState();
});

describe('questions the lookups fully answer cost no model call', () => {
  test.each([
    ['Do we have paracetamol?', /Paracetamol 500mg: in stock, 40 units at ₹5\. Use batch A7-1 first \(rack A7/],
    ['where is montelukast', /Montelukast 10mg: in stock.*rack M3/],
    ['low stock?', /All medicines are above their reorder level/],
    ['anything expiring soon?', /No stock expires within 30 days/],
  ])('%s', async (question, answer) => {
    const out = await ask(question);
    expect(post).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ success: true, source: 'direct' });
    expect(out.body.response).toMatch(answer);
  });

  test('CHATBOT_DIRECT_ANSWERS=false sends them to the model instead', async () => {
    process.env.CHATBOT_DIRECT_ANSWERS = 'false';
    post.mockResolvedValueOnce(textReply('Yes, 40 units on rack A7.'));

    const out = await ask('Do we have paracetamol?');

    expect(out.body).toMatchObject({ source: 'gemini', response: 'Yes, 40 units on rack A7.' });
    delete process.env.CHATBOT_DIRECT_ANSWERS;
  });
});

test('other questions go to the model in one call, with only the matching medicines attached', async () => {
  post.mockResolvedValueOnce(textReply('Zincovit is ₹9, Montelukast ₹12.'));

  const out = await ask(MODEL_QUESTION);

  expect(out.status).toBe(200);
  expect(out.body).toMatchObject({ success: true, source: 'gemini', response: 'Zincovit is ₹9, Montelukast ₹12.' });
  expect(post).toHaveBeenCalledTimes(1);

  const [url, body, config] = post.mock.calls[0];
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODELS[0]}:generateContent`);
  expect(config.headers['x-goog-api-key']).toBe('test-key'); // a header, not the URL
  expect(url).not.toContain('test-key');
  expect(body.systemInstruction.parts[0].text).toMatch(/inventory assistant/);
  expect(body.systemInstruction.parts[0].text).toMatch(/Plain text only/);
  expect(body.tools[0].functionDeclarations.map((t) => t.name)).toContain('search_medicines');

  const text = userText(0);
  expect(text).toMatch(/^compare zincovit and montelukast\n\n\[Inventory data the server already looked up/);
  expect(text).toContain('"rack":"S2"');
  expect(text).toContain('"rack":"M3"');
  expect(JSON.stringify(body)).not.toContain('Paracetamol');
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

describe('saving free-tier requests', () => {
  test('the same question about the same data is answered from the cache', async () => {
    post.mockResolvedValueOnce(textReply('Zincovit is cheaper.'));

    const first = await ask(MODEL_QUESTION, 'cache-a');
    const second = await ask(MODEL_QUESTION, 'cache-b');

    expect(post).toHaveBeenCalledTimes(1);
    expect(first.body.source).toBe('gemini');
    expect(second.body).toMatchObject({ source: 'cache', response: 'Zincovit is cheaper.' });
  });

  test('the same user asking again later in the conversation also hits the cache', async () => {
    post.mockResolvedValueOnce(textReply('Zincovit is cheaper.'));

    await ask(MODEL_QUESTION, 'cache-e');
    await ask('Do we have paracetamol?', 'cache-e'); // changes the conversation
    const again = await ask(`${MODEL_QUESTION}?`, 'cache-e');

    expect(post).toHaveBeenCalledTimes(1);
    expect(again.body.source).toBe('cache');
  });

  test('a cached answer is not reused once the data changes', async () => {
    post.mockResolvedValueOnce(textReply('first')).mockResolvedValueOnce(textReply('second'));

    await ask(MODEL_QUESTION, 'cache-c');
    await Medicine.updateOne({ name: 'Zincovit Tablet' }, { sellingPrice: 10 });
    const out = await ask(MODEL_QUESTION, 'cache-d');
    await Medicine.updateOne({ name: 'Zincovit Tablet' }, { sellingPrice: 9 });

    expect(post).toHaveBeenCalledTimes(2);
    expect(out.body.response).toBe('second');
  });

  test('a model that answered 429 is skipped until its retry delay has passed', async () => {
    post
      .mockRejectedValueOnce(httpError(429, 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }]))
      .mockResolvedValueOnce(textReply('one'))
      .mockResolvedValueOnce(textReply('two'));

    await ask(MODEL_QUESTION);
    await ask('compare paracetamol and montelukast');

    expect([modelOf(0), modelOf(1), modelOf(2)]).toEqual([DEFAULT_GEMINI_MODELS[0], DEFAULT_GEMINI_MODELS[1], DEFAULT_GEMINI_MODELS[1]]);
  });

  test('when every model is cooling down the answer comes straight from the inventory', async () => {
    post.mockRejectedValue(httpError(429, 'quota'));

    await ask(MODEL_QUESTION); // both models answer 429
    post.mockClear();
    const out = await ask('compare paracetamol and montelukast');

    expect(post).not.toHaveBeenCalled();
    expect(out.body.source).toBe('fallback');
    expect(out.body.response).toMatch(/Paracetamol 500mg: in stock/);
  });

  test(`one user gets at most ${USER_MODEL_QUESTIONS_PER_MINUTE} model answers a minute`, async () => {
    post.mockImplementation(async () => textReply('ok'));

    for (let i = 0; i < USER_MODEL_QUESTIONS_PER_MINUTE; i++) await ask(`compare zincovit and montelukast ${i}`, 'busy-user');
    const over = await ask('compare zincovit and montelukast again', 'busy-user');

    expect(post).toHaveBeenCalledTimes(USER_MODEL_QUESTIONS_PER_MINUTE);
    expect(over.body.source).toBe('fallback');
    expect(over.body.response).toMatch(/Zincovit Tablet: in stock/);
  });

  test(`with data attached the model gets ${MAX_TOOL_ROUNDS_WITH_DATA} extra tool round, then the offline answer`, async () => {
    post.mockResolvedValue(callReply(['list_low_stock', {}]));

    const out = await ask(MODEL_QUESTION);

    expect(post).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS_WITH_DATA + 1);
    expect(out.body.source).toBe('fallback');
  });

  test('without data a model that keeps calling tools is cut off after the full limit', async () => {
    post.mockResolvedValue(callReply(['list_low_stock', {}]));

    const out = await ask('how is everything');

    expect(post).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(out.body.source).toBe('fallback');
  });
});

describe('busy, slow and failing models', () => {
  test('a busy model (503) is retried on the next model', async () => {
    post
      .mockRejectedValueOnce(httpError(503, 'high demand'))
      .mockResolvedValueOnce(textReply('Zincovit ₹9, Montelukast ₹12.'));

    const out = await ask(MODEL_QUESTION);

    expect(out.body).toMatchObject({ source: 'gemini', response: 'Zincovit ₹9, Montelukast ₹12.' });
    expect([modelOf(0), modelOf(1)]).toEqual(DEFAULT_GEMINI_MODELS);
  });

  test('a bad request (400) is not retried on another model', async () => {
    post.mockRejectedValue(httpError(400, 'invalid argument'));

    const out = await ask(MODEL_QUESTION);

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
    const out = await ask(MODEL_QUESTION);

    expect(out.body).toMatchObject({ source: 'gemini', response: 'Montelukast 10mg is on rack M3.' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(HEDGE_AFTER_MS - 50);
    expect(modelOf(1)).toBe(DEFAULT_GEMINI_MODELS[1]);
    expect(aborted).toBe(true); // the slow request is cancelled
  }, 15000);

  test('GEMINI_MODELS sets the models to try', async () => {
    process.env.GEMINI_MODELS = 'model-a, model-b';
    post.mockRejectedValueOnce(httpError(500, 'internal')).mockResolvedValueOnce(textReply('ok'));

    await ask(MODEL_QUESTION);

    expect([modelOf(0), modelOf(1)]).toEqual(['model-a', 'model-b']);
    delete process.env.GEMINI_MODELS;
  });

  test('when Gemini fails, the offline answer uses the looked-up data', async () => {
    post.mockRejectedValue(new Error('offline'));

    const out = await ask(MODEL_QUESTION);

    expect(out.body.source).toBe('fallback');
    expect(out.body.response).toMatch(/Zincovit Tablet: in stock, 25 units at ₹9\. Use batch S2-1 first \(rack S2/);
    expect(out.body.response).toMatch(/Montelukast 10mg: in stock/);
  });

  test('the offline answer follows the language', async () => {
    post.mockRejectedValue(new Error('offline'));

    const out = await ask('ஜிங்கோவிட் ஒப்பிடு', undefined, 'ta');

    expect(out.body.response).toMatch(/இருப்பில் உள்ளது|உதவ முடியும்/);
  });
});

test('memory keeps only the question and answer text, never the looked-up data', async () => {
  post.mockResolvedValueOnce(textReply('It is an antiasthmatic.'));

  await ask('Where is montelukast?', 'memory-user'); // answered directly
  await ask('compare it with zincovit', 'memory-user');

  const contents = requestBody(0).contents;
  expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'Where is montelukast?' }] });
  expect(contents[1].role).toBe('model');
  expect(contents[1].parts[0].text).toMatch(/^Montelukast 10mg: in stock/);
  expect(contents[2].parts[0].text).toMatch(/^compare it with zincovit/);
});
