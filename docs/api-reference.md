# API Reference

> **TL;DR** — REST over JSON at `/api/*`. Authenticate with `POST /api/auth/login` and send `Authorization: Bearer <token>` on every other call. **Auth** column: `public` = no token; `any` = any logged-in user; `owner` / `owner, staff` = role-restricted. The owner can always call routes guarded by `authorize(...)`. Response shape and error codes: [backend.md](backend.md#4-response-and-error-contract).

Base URL (local): `http://localhost:5000/api`

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Liveness check with timestamp |

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/login` | public | `{username, password}` → `{token, user}` or `{requires2FA: true, username}` |
| POST | `/login/verify-2fa` | public | `{username, token}` (TOTP) → `{token, user}` |
| GET | `/me` | any | Current user (`isTwoFactorEnabled`, never `password` or `twoFactorSecret`) |
| POST | `/2fa/setup` | any | → `{qrCodeUrl, secret}` (not saved yet) |
| POST | `/2fa/verify-setup` | any | `{token, secret}` → enables 2FA |
| POST | `/register` | owner | `{username, email, password, role?}` — create a user. A password that breaks the [policy](security.md#passwords) (8+ characters, at most 72 bytes, lower, upper, number, symbol) → `400 {errorCode: "WEAK_PASSWORD", message, failedRules}` |
| GET | `/users` | owner | List users (same fields as `/me`, no secrets) |
| PUT | `/users/:id` | owner | Update username, email, role, isActive or password (same password policy and `400` as `/register`) |
| DELETE | `/users/:id` | owner | Delete a staff user (not yourself, not another owner) |

## Inventory — `/api/inventory`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | All medicines, sorted by earliest batch expiry (FEFO) |
| GET | `/search` | any | Search medicines |
| GET | `/low-stock` | any | Medicines at or below their reorder level (`out`, `critical`, `low`), most urgent first, each with `stockLevel` |
| GET | `/near-expiry` | any | Medicines with batches expiring soon |
| GET | `/expired` | any | Medicines with expired batches |
| GET | `/history` | owner, staff | Inventory movement ledger |
| GET | `/intelligence` | owner | Fast/slow movers, critical items, recommendations |
| GET | `/:id` | any | One medicine |
| POST | `/` | owner, staff | `{name, category, batchNumber, expiryDate, quantity, purchasePrice, sellingPrice, rackNumber, reorderLevel?, supplier?}`; batch fields may instead be nested as `batches: [{…}]`. Upserts by `name`: tops up the batch with the same `batchNumber` **and** expiry day, otherwise adds a new batch (an existing batch's expiry is never overwritten). `supplier` must be the `_id` of an existing supplier (400 otherwise, nothing written); omitted or empty means none. When the name already exists only the batch is added, so `supplier` is checked but not stored. |
| PUT | `/:id` | owner, staff | `{name?, category?, purchasePrice?, sellingPrice?, reorderLevel?, supplier?, __v?, batches?: [{_id, batchNumber?, expiryDate?, rackNumber?, quantity?}], reason?}`. Edits batches in place by `_id` (others untouched); a batch quantity change moves the total by the same amount and is logged as an `adjustment`. The total can't be set directly (400). `supplier` must be the `_id` of an existing supplier (400, nothing written); an empty `supplier` (`""`/`null`) leaves the stored one unchanged. Returns 409 if `__v` is stale or the name belongs to another medicine. |
| DELETE | `/:id` | owner | Delete medicine |
| POST | `/:id/adjust-quantity` | owner, staff | `{quantityChanged, reason, batchNumber?, expiryDate?, rackNumber?}`. Negative values deduct FEFO from the oldest batch. Positive values require `batchNumber` and `expiryDate`: they top up the batch with that number and expiry day, or create a new batch. Returns 409 on a concurrent change. |

## Billing — `/api/billing`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | All bills (newest first) |
| GET | `/summary` | any | Sales summary |
| GET | `/date-range` | any | Bills in a date range (query params) |
| GET | `/:id` | any | One bill |
| GET | `/customer/:customerId` | any | A customer's bills |
| POST | `/` | owner, staff | `{customerId?, customerName, customerType?, items: [{medicineId, quantity}], paymentMethod?}`. Deducts stock from batches FEFO-style, adds 12% GST, generates a PDF, sends notifications. Returns 409 if the stock changed concurrently (retry). |
| POST | `/payment/confirm` | owner, staff | Confirm a payment |

## Customers — `/api/customers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | List |
| GET | `/stats` | any | Customer statistics |
| GET | `/search` | any | Search by name, phone or email (`?query=`, matched literally and case-insensitively) |
| GET | `/:id` | any | One customer |
| POST | `/` | owner, staff | Create (`phone` must be unique) |
| PUT | `/:id` | owner, staff | Update `name`, `phone`, `email`, `customerType`, `address`, `city` only (computed totals are ignored). `400` on a duplicate `phone` or invalid value. |
| DELETE | `/:id` | owner | Delete. `409` if the customer has any bills. |

## Alerts — `/api/alerts`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | Alerts (expiry alerts are one per batch, with `batchId` and a `batch` snapshot), unresolved first, then critical → info, newest change first. Query: `resolved=true\|false`, `type=low_stock\|near_expiry\|expired\|overstock`, `severity=critical\|warning\|info`. Regenerates first if stale. |
| GET | `/critical` | any | Unresolved critical alerts, counted per batch for `expired` (`count` drives the sidebar badge and matches the dashboard's Critical Alerts tile). Regenerates first if stale. |
| GET | `/recommendations` | any | Medicine recommendations |
| POST | `/generate` | owner, staff | Force a generation run. Returns `created`, `updated`, `autoResolved`, `pruned` counts and the new alerts in `alerts`. |
| PUT | `/:id/resolve` | owner, staff | Acknowledge: records `resolvedBy`/`resolvedByName`/`resolvedAt` and writes an `ALERT_RESOLVED` activity entry. `409` if already resolved, `404` if not found. |

The list endpoints and `/generate` also return `lastGeneratedAt` (this process's last run, or `null`) and `refreshIntervalMinutes` (15). "Stale" means the last run is 15+ minutes old or stock changed since; see [core-flows.md](core-flows.md#5-alert-generation) for generation, acknowledgement and retention.

## Uploads (Excel) — `/api/uploads`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/excel` | owner, staff | `multipart/form-data`, field `file` (.xlsx/.xls, ≤ 5 MB). Imports medicines and batches. The `supplier` cell is a supplier name or id; rows with an unknown supplier fail and are listed in `uploadLog.errors`. |
| GET | `/` | any | Upload history (from `AuditLog`) |
| GET | `/export` | any | Download inventory as Excel (supplier column holds the supplier name) |
| GET | `/:id` | any | One upload log |

## Suppliers and purchase orders — `/api/suppliers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/suppliers` (also `/`) | owner, staff (`/`: any) | List suppliers |
| POST | `/suppliers` (also `/`) | owner | Create supplier |
| PUT | `/suppliers/:id` | owner | Update supplier |
| GET | `/reorder/suggestions` | owner, staff | Current `AI_Draft` POs (created by the forecast run) in the "suggestion" shape, with the medicine's live `current_stock` and `reorder_level` (`null` if the medicine was deleted) |
| POST | `/purchase-orders` | owner | `{suggestion_id, expected_delivery_date?, notes?}`: activate a draft (→ `Pending`) |
| GET | `/purchase-orders` | owner, staff | Non-draft POs; filter with `?status=&supplier_id=` |
| PUT | `/purchase-orders/:id` | owner, staff | `{order_status, received_quantity?, actual_delivery_date?}`. `Received` adds stock as a new batch and updates the supplier score. |

## Forecasting — `/api/forecast` (all routes require login)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/run` | owner | Run the forecast for every medicine, validate the new `AI_Draft` POs, then replace the old drafts with them (one transaction on a replica set; a failed run keeps the old drafts) |
| POST | `/retrain` | owner | Same as `/run`, logged as `MODEL_RETRAINED` (called after an owner's Excel import) |
| GET | `/recommendations` | any | Forecast-originated POs mapped to `{predictedDemand, optimalReorderQty, priority, status, orderStatus}`. `status` is a review label: `new` (`AI_Draft`), `adjusted` (`Adjusted`), `rejected` (`Cancelled`), or `approved` (any later PO stage) |
| POST | `/recommendations` | owner, staff | Manual recommendation. Always creates an `AI_Draft` (the body can't set the status) |
| PUT | `/recommendations/:id` | owner, staff; owner for `approved` / `rejected` | `{status?: approved\|rejected, quantity?, priority?, restockingDate?}`. No status: the edits are applied and the draft becomes `Adjusted` (staff or owner). `approved` → `Pending` (sets `approved_by`; edits in the same request are applied) and `rejected` → `Cancelled` (no edits allowed) are owner-only (403 `OWNER_ONLY`). `quantity` must be a positive whole number; any other status, an unknown priority or date, or an empty body is 400 `INVALID_INPUT`. Only drafts (`AI_Draft`, `Adjusted`) can be changed, in one atomic conditional update: any other PO, including a draft that another request approved, rejected or deleted first, is 409 `NOT_A_DRAFT`; an unknown id is 404 |
| DELETE | `/recommendations/:id` | owner | Delete a draft (`AI_Draft` or `Adjusted`). 403 for staff, 409 `NOT_A_DRAFT` for any other PO, 404 for an unknown id |
| GET | `/parameters` | any | Forecast parameters (creates defaults if missing) |
| POST | `/parameters` | owner | Save parameters |
| GET | `/trend` | any | 14-day actual vs predicted series |

## Reports — `/api/reports`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/summary` | any | KPI summary; `lowStockMedicines` and `inventory: {out, critical, low, ok}` use the shared stock levels |
| GET | `/dashboard/analytics` | any | Chart data |
| GET | `/sales` | owner | Sales report (`?period=&startDate=&endDate=`) |
| GET | `/purchase` | owner | Purchase report |
| GET | `/inventory` | any | Inventory report: `outOfStockCount`, `criticalStockCount`, `lowStockCount` (everything at or below reorder level), `okStockCount` |
| GET | `/forecast`, `/demand` | any | Legacy mock forecast (`calculateDemandForecast`: average × random ±20%). Not the LSTM. |
| GET | `/classification` | any | Stock classification |

## Chatbot — `/api/chatbot`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/query` | any | `{message, language: 'en'\|'ta'}` → `{response, source: 'gemini'\|'fallback', disclaimer}` |

## Categories — `/api/categories`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | Distinct medicine categories |
| POST | `/` | owner, staff | No-op (categories come from medicines) |
| PATCH | `/:id/approve` | owner | No-op |

## Audit — `/api/audit`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | owner | Audit log, paginated (`page`, default `limit` 20) and filterable |
| GET | `/stats` | owner | Aggregated audit statistics |

---

## Example

```bash
# Log in
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<owner username>","password":"<password>"}' | jq -r .token)

# Create a bill
curl -X POST localhost:5000/api/billing \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerName":"Walk-in","items":[{"medicineId":"<id>","quantity":2}],"paymentMethod":"cash"}'
```

---

## Future improvements

- Publish an **OpenAPI 3** spec (generated from route definitions or `zod` schemas) with Swagger UI at `/api/docs`.
- Version the API (`/api/v1`) before any breaking change.
- Paginate list endpoints (`/inventory`, `/billing`, `/customers`), which currently return every document. `/audit` already paginates.

## Related files

`server/routes/*.js` · `server/server.js`
