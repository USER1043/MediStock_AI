# Architecture Decision Records

Short records of significant decisions: the context, what was decided, the alternatives, and the consequences. They explain *why* the code looks the way it does.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-mongodb.md) | MongoDB with embedded batches | Accepted |
| [0002](0002-jwt-auth.md) | Stateless JWT auth with role claims | Accepted |
| [0003](0003-in-process-forecasting.md) | Forecasting with TensorFlow.js inside the API process | Accepted |
| [0004](0004-gemini-via-backend.md) | Call Gemini only from the backend | Accepted |
| [0005](0005-fefo-batch-ledger.md) | Batch-level stock with FEFO consumption | Accepted (partially implemented) |

**Adding an ADR:** copy the structure of an existing one, use the next number, and link it here. Don't edit an accepted ADR's decision. Supersede it with a new ADR instead.
