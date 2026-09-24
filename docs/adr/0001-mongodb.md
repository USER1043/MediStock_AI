# ADR-0001: MongoDB with embedded batches

**Status:** Accepted

## Context

The core entity is a medicine that holds several **batches**, each with its own expiry date, quantity and rack location. Nearly every workflow (billing, FEFO sorting, chatbot answers, expiry checks) needs a medicine *together with* all its batches. Other data is loosely structured: audit `details` differ per action, and reports hold arbitrary aggregates. The team works in JavaScript end to end.

## Decision

Use **MongoDB** through **Mongoose**. Embed batches as an array in `Medicine`. Embed bill line items in `Bill` as a snapshot. Reference users, customers, suppliers and medicines elsewhere, copying display names where historical readability matters.

## Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| PostgreSQL with `medicines` + `batches` tables | Strong consistency and joins, but every read needs a join, and the variable audit/report payloads would need JSONB anyway. A good fit, but more setup for a small team. |
| Batches as their own Mongo collection | Easier to index and query batches directly, but loses single-document reads and atomic single-document updates of a medicine and its batches. |

## Consequences

- ✅ One query returns a medicine with all its batches; updating one medicine's batches is atomic (single document).
- ✅ Flexible schemas for audit and report data; JSON from database to browser without mapping layers.
- ⚠️ Operations that span documents (a bill touching several medicines, a bill plus stock) are **not atomic** unless multi-document transactions are used, which the code doesn't do today.
- ⚠️ Invariants such as `quantity == Σ batches.quantity` must be enforced in application code.
- ⚠️ Cross-entity analytics (sales per medicine over time) need aggregation pipelines and good indexes.
- Revisit if the product moves to multi-branch accounting with strict financial consistency requirements.
