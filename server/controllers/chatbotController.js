import axios from 'axios';
import { Medicine } from '../models/medicineModel.js';
import { isNearExpiry } from '../utils/helpers.js';
import { runTool, TOOL_DECLARATIONS } from '../services/chatbotTools.js';
import log from '../utils/logger.js';
import { isMedicineLowStock } from '../utils/stockLevel.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

const userChatHistories = new Map(); // Store conversation memory per user

/** The model may ask for tools this many times per question before it must answer. */
export const MAX_TOOL_ROUNDS = 4;

/**
 * The system instruction. It holds no inventory data: the model looks up what each question needs
 * with the tools in services/chatbotTools.js.
 */
export const buildSystemPrompt = (language, now = new Date()) => {
  const langInstruction = language === 'ta' ? 'Respond in Tamil language.' : 'Respond in English.';

  return `You are MediStock AI, a clinical and professional inventory assistant for pharmacists.
Today is ${now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'long', day: 'numeric' })} (IST).

CORE DIRECTIVES:
1. USE THE TOOLS: Never guess stock, prices, racks or dates. Look them up with the tools before answering; if a tool finds nothing, say so.
2. STOCK RULE: A medicine is in stock ONLY if it has at least one active batch (inStock: true). Otherwise tell the user it is locally unavailable.
3. ALTERNATIVES: If a requested medicine is unavailable, call find_alternatives with its category and suggest what is in stock.
4. RACK NUMBERS: When confirming stock, always give the rack number of the active batch to use first (earliest expiry).
5. CLINICAL TONE: Do NOT give medical advice (dosage, diagnosis). Only discuss inventory.
6. ${langInstruction}`;
};

// Text of a model reply (all text parts joined), or null
const replyText = (content) => {
  const text = (content?.parts || []).map((p) => p.text || '').join('').trim();
  return text || null;
};

/**
 * Calls Gemini with the inventory tools and runs the tool calls it asks for, until it answers in text.
 * Returns { text, toolCalls } where toolCalls lists the tool names used, in order.
 */
export const callGeminiAPI = async (systemPrompt, chatHistory, userMessage, now = new Date()) => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  // Earlier turns are plain text; the current question goes last
  const contents = chatHistory.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const toolCalls = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const { data } = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
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
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const content = data?.candidates?.[0]?.content;
    const calls = (content?.parts || []).filter((p) => p.functionCall).map((p) => p.functionCall);
    if (calls.length === 0) return { text: replyText(content), toolCalls };
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

  throw new Error(`No answer after ${MAX_TOOL_ROUNDS} rounds of tool calls`);
};

/**
 * Simple keyword fallback if Gemini is unavailable.
 */
const keywordFallback = (message, medicines, language) => {
  const lower = message.toLowerCase();
  const ta = language === 'ta';

  if (lower.includes('low stock') || lower.includes('reorder')) {
    const low = medicines.filter(isMedicineLowStock);
    if (!low.length) return ta ? 'அனைத்து மருந்துகளும் போதுமான அளவில் உள்ளன.' : 'All medicines are adequately stocked.';
    return (ta ? 'குறைந்த இருப்பு மருந்துகள்:\\n' : 'Low stock medicines:\\n') +
      low.map(m => `• ${m.name}: ${m.quantity} units (reorder: ${m.reorderLevel})`).join('\\n');
  }

  if (lower.includes('expir')) {
    const near = medicines.filter(m => m.batches && m.batches.some(b => isNearExpiry(b.expiryDate, 30)));
    if (!near.length) return ta ? 'அடுத்த 30 நாட்களில் காலாவதியாகும் மருந்துகள் இல்லை.' : 'No medicines expiring in the next 30 days.';
    return (ta ? 'விரைவில் காலாவதியாகும் மருந்துகள்:\\n' : 'Medicines expiring soon:\\n') +
      near.map(m => `• ${m.name}: ${m.batches && m.batches[0] ? new Date(m.batches[0].expiryDate).toLocaleDateString() : 'Unknown'}`).join('\\n');
  }

  // Search by name
  const found = medicines.filter(m => lower.includes(m.name.toLowerCase().split(' ')[0]));
  if (found.length) {
    return found.map(m => {
      const mainBatch = m.batches && m.batches.length > 0 ? m.batches[0] : {};
      return `${m.name}\\n  Stock: ${m.quantity} | Price: ₹${m.sellingPrice} | Rack: ${mainBatch.rackNumber || 'N/A'} | Expiry: ${mainBatch.expiryDate ? new Date(mainBatch.expiryDate).toLocaleDateString() : 'N/A'}`
    }).join('\\n\\n');
  }

  return ta
    ? 'மன்னிக்கவும், சரக்கு அல்லது மருந்து பற்றிய கேள்விகளுக்கு மட்டுமே பதிலளிக்க முடியும்.'
    : 'I can help with inventory queries — try asking about stock levels, prices, expiry dates, or a specific medicine name.';
};

// Chatbot query handler
export const chatbotQuery = async (req, res) => {
  try {
    const { message, language = 'en' } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    let response = null;
    let source = 'gemini';

    try {
      const systemPrompt = buildSystemPrompt(language);

      // Pull history for the user session (fallback to 'default' if no user session middleware hooked up yet)
      const userId = req.user?.id || 'default_user';
      let history = userChatHistories.get(userId) || [];

      const result = await callGeminiAPI(systemPrompt, history, message);
      response = result.text;
      if (result.toolCalls.length > 0) log('INFO', 'Chatbot tools used', { tools: result.toolCalls });

      // Update Conversation Memory (keep only last 3 turns = 6 messages); text only, never tool data
      history.push({ role: 'user', text: message });
      history.push({ role: 'model', text: response || 'I encountered an error processing that.' });

      if (history.length > 6) {
        history = history.slice(history.length - 6);
      }
      userChatHistories.set(userId, history);

    } catch (geminiError) {
      log('WARN', 'Gemini API failed, using keyword fallback', { error: geminiError.message });
    }

    if (!response) {
      // Only the fallback needs the whole list
      const medicines = await Medicine.find().lean();
      response = keywordFallback(message, medicines, language);
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
