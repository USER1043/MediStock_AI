# ADR-0005: Batch-level stock with FEFO consumption

**Status:** Accepted, partially implemented

## Context

Pharmacies lose money when medicines expire on the shelf, and staff waste time looking for stock. Stock of the same medicine arrives in batches with different expiry dates and may sit on different racks. Regulations and good practice call for dispensing the batch that expires first (**First-Expired, First-Out**).

## Decision

- Model stock per **batch** (`batchNumber`, `expiryDate`, `quantity`, `rackNumber`) embedded in `Medicine`, alongside a denormalised total `quantity`.
- Present medicines sorted by earliest batch expiry (`GET /api/inventory`, the billing picker).
- When deducting stock, consume batches in ascending expiry order (implemented in `adjustQuantity`).
- Record every stock movement in `InventoryHistory`.
- Treat stock received on a purchase order as a new batch.

## Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| A single quantity per medicine | Simple, but can't do expiry tracking, FEFO, or rack lookup. |
| FIFO (by arrival date) | Easier, but arrival order doesn't guarantee expiry order. FEFO directly targets expiry waste. |
| A separate batch collection with stock reservations | More robust under concurrency, but more complex than a single shop needs today. |

## Consequences

- ✅ Enables expiry-aware UI, rack lookup in the chatbot, and expiry-based alerts.
- ✅ Adjustments deduct from the right batches automatically.
- ⚠️ **Billing does not yet deduct at batch level.** `createBill` lowers only the medicine total, so batch quantities drift from the total. Bringing billing in line with `adjustQuantity` (and recording the actual batch per bill line) is the main follow-up.
- ⚠️ Keeping `quantity` equal to the batch sum depends on every write path; nothing enforces it.
- ⚠️ Expiry alerts read a top-level `expiryDate` that doesn't exist, so near-expiry and expired alerts never fire until they're changed to read batch expiries.
