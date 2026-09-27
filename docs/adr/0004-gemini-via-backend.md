# ADR-0004: Call Gemini only from the backend

**Status:** Accepted (supersedes an earlier client-side integration)

## Context

The chatbot originally called the Gemini API from the browser, which meant shipping the API key in the frontend bundle, where anyone could extract and misuse it. The assistant also needs **live inventory data** to answer accurately, and that data lives behind the API.

## Decision

Route all LLM calls through `POST /api/chatbot/query`. The server:

1. Requires a logged-in user (`protect`).
2. Builds a text snapshot of live inventory and today's sales.
3. Prepends a system prompt with strict rules (stock only if an active batch exists, give rack numbers, suggest same-category alternatives, no medical advice).
4. Calls Gemini 2.0 Flash (`temperature 0.3`) with the last 3 exchanges of per-user history.
5. Falls back to deterministic keyword answers if Gemini fails.

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
- ⚠️ Prompt size grows with inventory size (the whole catalogue is sent each time).
- ⚠️ Chat memory is an in-process `Map`: lost on restart and not shared across instances.
- ⚠️ The key is sent as a URL query parameter, and safety settings are `BLOCK_NONE`. Both should be tightened.
