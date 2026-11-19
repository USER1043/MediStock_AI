import axios from 'axios';
import { Medicine } from '../models/medicineModel.js';
import { Bill } from '../models/billModel.js';
import { isNearExpiry, isExpired } from '../utils/helpers.js';
import log from '../utils/logger.js';
import { isMedicineLowStock } from '../utils/stockLevel.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const userChatHistories = new Map(); // Store conversation memory per user

/**
 * Fetch a live snapshot of the inventory and format it as a readable context block.
 */
const buildInventoryContext = async () => {
  const medicines = await Medicine.find().lean();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayBills = await Bill.find({ createdAt: { $gte: today } }).lean();
  const todaySales = todayBills.reduce((s, b) => s + b.grandTotal, 0);

  const lowStock = medicines.filter(isMedicineLowStock);
  const nearExpiry = medicines.filter(m => m.batches && m.batches.some(b => isNearExpiry(b.expiryDate, 30)));
  const expired = medicines.filter(m => m.batches && m.batches.some(b => isExpired(b.expiryDate)));

  const medicineList = medicines.map(m => {
    // SCHEMA-AWARE: Only consider batches with quantity > 0 AND expiryDate > today
    const activeBatches = (m.batches || []).filter(b => b.quantity > 0 && new Date(b.expiryDate) > new Date());

    let batchInfo = 'Status: Out of Stock / Expired';
    if (activeBatches.length > 0) {
      batchInfo = 'Active Batches: ' + activeBatches.map(b => `[Rack: ${b.rackNumber || 'N/A'}, Qty: ${b.quantity}, Exp: ${new Date(b.expiryDate).toLocaleDateString()}]`).join(', ');
    }

    return `• Name: ${m.name} | Category: ${m.category || 'N/A'} | ${batchInfo} | Total Qty: ${m.quantity} | Price: ₹${m.sellingPrice}`;
  }).join('\n');

  return `
=== LIVE PHARMACY INVENTORY DATA (as of ${new Date().toLocaleString('en-IN')}) ===

SUMMARY:
- Total medicines: ${medicines.length}
- Low stock: ${lowStock.length}
- Today's sales: ₹${todaySales.toFixed(2)} across ${todayBills.length} bill(s)

FULL MEDICINE LIST WITH VERIFIED BATCHES & RACK NUMBERS:
${medicineList || 'No medicines in inventory.'}
===
`;
};

/**
 * Build the system prompt with live inventory injected.
 */
const buildSystemPrompt = (inventoryContext, language) => {
  const langInstruction = language === 'ta'
    ? 'Respond in Tamil language.'
    : 'Respond in English.';

  return `You are MediStock AI, an intelligent, clinical, and highly professional Context-Aware Inventory Assistant for pharmacists.

CORE DIRECTIVES:
1. SCHEMA-AWARE VERIFICATION: A medicine is ONLY considered "in stock" if the 'Active Batches' property explicitly lists a batch (meaning Qty > 0 and Expiry > Today). If a medicine says "Status: Out of Stock / Expired", you MUST tell the user it is locally unavailable.
2. PROACTIVE ASSISTANCE: If the requested item is expired or out of stock, YOU MUST proactively search the live inventory list for other available medicines with the EXACT SAME Category and suggest them as alternatives.
3. VERIFY RACK NUMBERS: Whenever confirming stock for a medicine, ALWAYS extract and provide the Rack Number from the Active Batches text so the pharmacist knows exactly where to retrieve it.
4. CLINICAL TONE: Maintain a professional, polite, and clinical tone at all times. Do NOT provide medical advice (dosage, diagnosis). Only discuss inventory.
5. ${langInstruction}

${inventoryContext}
`;
};

/**
 * Call Gemini API with the full context prompt.
 */
const callGeminiAPI = async (systemPrompt, chatHistory, userMessage) => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  // Convert tracked chat history into Gemini format
  const contents = chatHistory.map(turn => ({
    role: turn.role, // 'user' or 'model'
    parts: [{ text: turn.text }]
  }));

  // Append current user message with hidden background system context
  contents.push({
    role: 'user',
    parts: [{ text: `[SYSTEM CONTEXT - HIDDEN FROM USER]\n${systemPrompt}\n[END SYSTEM]\n\nUser Message: ${userMessage}` }]
  });

  const { data } = await axios.post(
    `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
    {
      contents,
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

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
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

    // Always fetch live inventory
    const medicines = await Medicine.find().lean();
    let response = null;
    let source = 'gemini';

    try {
      const inventoryContext = await buildInventoryContext();
      const systemPrompt = buildSystemPrompt(inventoryContext, language);

      // Pull history for the user session (fallback to 'default' if no user session middleware hooked up yet)
      const userId = req.user?.id || 'default_user';
      let history = userChatHistories.get(userId) || [];

      response = await callGeminiAPI(systemPrompt, history, message);

      // Update Conversation Memory (keep only last 3 turns = 6 messages)
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
