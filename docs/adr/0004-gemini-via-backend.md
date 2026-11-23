# ADR-0004: Call Gemini only from the backend

**Status:** Accepted (supersedes an earlier client-side integration)

## Context

The chatbot originally called the Gemini API from the browser, which meant shipping the API key in the frontend bundle, where anyone could extract and misuse it. The assistant also needs **live inventory data** to answer accurately, and that data lives behind the API.

## Decision

Route all LLM calls through `POST /api/chatbot/query`. The server:

1. Requires a logged-in user (`protect`).
2. Sends a system instruction with strict rules (stock only if an active batch exists, give rack numbers, suggest same-category alternatives, no medical advice).
3. Looks up the data the question names, then calls Gemini 3.5 Flash-Lite (`temperature 0.3`, a second model on a busy or slow first one) with the last 3 exchanges of per-user history, that data and read-only inventory tools. The model can request any other live data it needs (function calling) and the server runs those queries. *(Updated: this originally injected a text snapshot of the whole inventory into every prompt; see [chatbot.md](../chatbot.md#2-prompt-and-tools).)*
4. Answers directly from the looked-up data if Gemini can't answer within 12 s.

`GEMINI_API_KEY` exists only in `server/.env`. `src/utils/geminiAPI.js` is now just a thin client for the backend endpoint.

## Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| Keep calling Gemini from the browser | Leaks the key; can't add live data without exposing more endpoints; no auth or auditing. |
| Retrieval-augmented generation with a vector store | More scalable for big catalogues, but unnecessary infrastructure for a few hundred SKUs. |
| Function calling / tool use | Cleaner and more token-efficient; a good next step once the catalogue grows. |

## Consequences

- ✅ The key is never exposed; usage is tied to authenticated users.
- ✅ Answers reflect live stock; the fallback keeps the feature working when the LLM is unavailable.
- ✅ Prompt size no longer grows with the inventory: only the data a question needs is sent.
- ⚠️ Chat memory is an in-process `Map`: lost on restart and not shared across instances.
- ✅ The key is sent in the `x-goog-api-key` header.
