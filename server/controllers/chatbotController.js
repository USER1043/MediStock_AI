import axios from 'axios';
import { runTool, TOOL_DECLARATIONS } from '../services/chatbotTools.js';
import { buildFallbackAnswer, formatLookupsForModel, prefetchForQuestion } from '../services/chatbotPrefetch.js';
import log from '../utils/logger.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Models to try, in order. A busy (503), rate-limited (429) or slow model is retried on the next one;
 * different models have separate free-tier quotas. Override with GEMINI_MODELS (comma-separated).
 */
export const DEFAULT_GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

/** The model may ask for tools this many times per question before it must answer. */
export const MAX_TOOL_ROUNDS = 4;
/** One Gemini call is abandoned after this long. */
export const CALL_TIMEOUT_MS = 10_000;
/** If a call has not answered after this long, the same request is also sent to the next model; the first answer wins. */
export const HEDGE_AFTER_MS = 4_000;
/** The whole answer must be ready this long after the question arrived; otherwise the offline answer is used. */
export const ANSWER_DEADLINE_MS = 12_000;

const userChatHistories = new Map(); // Store conversation memory per user

const geminiModels = () => {
  const list = (process.env.GEMINI_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_GEMINI_MODELS;
};

// GEMINI_API_URL (older setting) replaces the endpoint of the first model
const endpointFor = (model, index) =>
  index === 0 && process.env.GEMINI_API_URL ? process.env.GEMINI_API_URL : `${GEMINI_API_BASE}/${model}:generateContent`;

/**
 * The system instruction. It holds no inventory data: the server attaches what it already looked up to
 * the question, and the model can fetch anything else with the tools in services/chatbotTools.js.
 */
export const buildSystemPrompt = (language, now = new Date()) => {
  const langInstruction = language === 'ta' ? 'Respond in Tamil language.' : 'Respond in English.';

  return `You are MediStock AI, a clinical and professional inventory assistant for pharmacists.
Today is ${now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'long', day: 'numeric' })} (IST).

CORE DIRECTIVES:
1. DATA: A question may come with inventory data the server already looked up; it is live, so answer from it directly. Otherwise, or for anything it does not cover, look it up with the tools (call several in one turn when you need several). Never guess stock, prices, racks or dates; if nothing is found, say so.
2. STOCK RULE: A medicine is in stock ONLY if it has at least one active batch (inStock: true). Otherwise tell the user it is locally unavailable, and if it has expired stock on the shelf, say that it has expired.
3. ALTERNATIVES: If a requested medicine is unavailable, suggest in-stock medicines of the same category (find_alternatives).
4. RACK NUMBERS: When confirming stock, always give the rack number of the active batch to use first (earliest expiry).
5. CLINICAL TONE: Do NOT give medical advice (dosage, diagnosis). Only discuss inventory.
6. FORMAT: Plain text only, no Markdown (no **, #, or tables); use "• " for list items. Be brief: answer first, at most 6 short lines, no greetings or sign-offs.
7. ${langInstruction}`;
};

// Text of a model reply (all text parts joined), or null
const replyText = (content) => {
  const text = (content?.parts || []).map((p) => p.text || '').join('').trim();
  return text || null;
};

// Busy, rate-limited, timed out or unreachable: worth trying the next model
const isRetryable = (error) => {
  const status = error.response?.status;
  if (status) return status === 429 || status >= 500;
  return true; // timeout or network error
};

const describeError = (error) =>
  error.response
    ? `${error.response.status} ${String(error.response.data?.error?.message || error.message).slice(0, 120)}`
    : error.code || error.message;

/**
 * One generateContent call across the model list. It starts on `state.model` (the model that last
 * worked for this question). A retryable failure moves straight to the next model; a call that is
 * still running after HEDGE_AFTER_MS is raced against the next model, and the first answer wins (the
 * other request is cancelled). Fails when every model has failed or the deadline has passed.
 */
const generate = (body, state) => {
  const models = geminiModels();
  return new Promise((resolve, reject) => {
    let next = state.model;
    let running = 0;
    let done = false;
    let lastError = null;
    let hedgeTimer = null;
    const controllers = new Set();

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      for (const c of controllers) c.abort();
      fn(value);
    };

    const launch = () => {
      clearTimeout(hedgeTimer);
      const remaining = state.deadline - Date.now();
      if (next >= models.length || remaining <= 500) {
        if (running === 0) finish(reject, lastError || new Error('No time left to call Gemini'));
        return;
      }
      const i = next++;
      const controller = new AbortController();
      controllers.add(controller);
      running++;
      axios
        .post(endpointFor(models[i], i), body, {
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
          timeout: Math.min(CALL_TIMEOUT_MS, remaining),
          signal: controller.signal,
        })
        .then(({ data }) => {
          state.model = i;
          state.calls.push(models[i]);
          finish(resolve, data);
        })
        .catch((error) => {
          if (done) return;
          running--;
          lastError = error;
          state.failures.push(`${models[i]}: ${describeError(error)}`);
          if (!isRetryable(error) && error.response?.status !== 404) {
            // A bad request or key fails the same way on every model
            if (running === 0) finish(reject, error);
            return;
          }
          if (running === 0 || next < models.length) launch();
        })
        .finally(() => controllers.delete(controller));
      if (next < models.length) hedgeTimer = setTimeout(launch, HEDGE_AFTER_MS);
    };

    launch();
  });
};

/**
 * Calls Gemini with the inventory tools and runs the tool calls it asks for, until it answers in text.
 * Returns { text, toolCalls, models } where toolCalls lists the tool names used and models the model
 * that served each call, in order.
 */
export const callGeminiAPI = async (systemPrompt, chatHistory, userMessage, now = new Date(), deadline = Date.now() + ANSWER_DEADLINE_MS) => {
  // Read at call time so tests (and a key added to .env before a restart) work without re-importing
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  // Earlier turns are plain text; the current question goes last
  const contents = chatHistory.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const state = { apiKey, deadline, model: 0, calls: [], failures: [] };
  const toolCalls = [];
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await generate(
        {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [...contents], // a copy: the loop keeps appending to `contents`
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 600,
          },
        },
        state
      );

      const content = data?.candidates?.[0]?.content;
      const calls = (content?.parts || []).filter((p) => p.functionCall).map((p) => p.functionCall);
      if (calls.length === 0) return { text: replyText(content), toolCalls, models: state.calls, failures: state.failures };
      if (round === MAX_TOOL_ROUNDS) break;

      // Keep the model's turn as sent (it may carry signatures Gemini expects back), then answer every call
      contents.push(content);
      const responses = [];
      for (const call of calls) {
        toolCalls.push(call.name);
        responses.push({ functionResponse: { name: call.name, response: await runTool(call.name, call.args, now) } });
      }
      contents.push({ role: 'user', parts: responses });
    }
  } catch (error) {
    error.failures = state.failures;
    throw error;
  }

  const error = new Error(`No answer after ${MAX_TOOL_ROUNDS} rounds of tool calls`);
  error.failures = state.failures;
  throw error;
};

// Chatbot query handler
export const chatbotQuery = async (req, res) => {
  try {
    const { message, language = 'en' } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const started = Date.now();
    const now = new Date(started);

    // Pull history for the user session (fallback to 'default' if no user session middleware hooked up yet)
    const userId = req.user?.id || 'default_user';
    let history = userChatHistories.get(userId) || [];

    // Look up what the question clearly needs: the model can usually answer in one call, and the
    // offline answer uses the same data if the model is unavailable
    let lookups = [];
    try {
      lookups = await prefetchForQuestion(message, history, now);
    } catch (lookupError) {
      log('WARN', 'Chatbot lookups failed', { error: lookupError.message });
    }

    let response = null;
    let source = 'gemini';

    try {
      const systemPrompt = buildSystemPrompt(language, now);
      const result = await callGeminiAPI(systemPrompt, history, message + formatLookupsForModel(lookups), now, started + ANSWER_DEADLINE_MS);
      response = result.text;
      log('INFO', 'Chatbot answered by Gemini', {
        ms: Date.now() - started,
        models: result.models,
        prefetched: lookups.map((l) => l.tool),
        ...(result.toolCalls.length > 0 && { tools: result.toolCalls }),
        ...(result.failures.length > 0 && { retried: result.failures }),
      });

      // Update Conversation Memory (keep only last 3 turns = 6 messages); question and answer text only,
      // never the looked-up data or tool results
      if (response) {
        history.push({ role: 'user', text: message });
        history.push({ role: 'model', text: response });
        if (history.length > 6) {
          history = history.slice(history.length - 6);
        }
        userChatHistories.set(userId, history);
      }
    } catch (geminiError) {
      log('WARN', 'Gemini unavailable, answering from the inventory directly', {
        error: geminiError.message,
        ms: Date.now() - started,
        attempts: geminiError.failures,
      });
    }

    if (!response) {
      response = buildFallbackAnswer(lookups, language);
      source = 'fallback';
    }

    log('INFO', `Chatbot query processed via ${source}`, { message: message.substring(0, 50) });

    res.status(200).json({
      success: true,
      response,
      disclaimer: '⚠️ This is an AI assistant. Not for medical advice.',
      language,
      source,
    });
  } catch (error) {
    log('ERROR', 'Chatbot query error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error processing chatbot query',
      error: error.message,
    });
  }
};
