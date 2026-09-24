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
| GET | `/me` | any | Current user |
| POST | `/2fa/setup` | any | → `{qrCodeUrl, secret}` (not saved yet) |
| POST | `/2fa/verify-setup` | any | `{token, secret}` → enables 2FA |
| POST | `/register` | owner | `{username, email, password, role?}` — create a user |
| GET | `/users` | owner | List users |
| PUT | `/users/:id` | owner | Update username, email, role, isActive or password |
| DELETE | `/users/:id` | owner | Delete a staff user (not yourself, not another owner) |

## Inventory — `/api/inventory`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | All medicines, sorted by earliest batch expiry (FEFO) |
| GET | `/search` | any | Search medicines |
| GET | `/low-stock` | any | Medicines at or below the low-stock threshold |
| GET | `/near-expiry` | any | Medicines with batches expiring soon |
| GET | `/expired` | any | Medicines with expired batches |
| GET | `/history` | owner, staff | Inventory movement ledger |
| GET | `/intelligence` | owner | Fast/slow movers, critical items, recommendations |
| GET | `/:id` | any | One medicine |
| POST | `/` | owner, staff | `{name, category, batchNumber, expiryDate, quantity, purchasePrice, sellingPrice, rackNumber, reorderLevel?, supplier?}`. Upserts by `name`: adds a new batch or tops up an existing one. |
| PUT | `/:id` | owner, staff | Update medicine fields |
| DELETE | `/:id` | owner | Delete medicine |
| POST | `/:id/adjust-quantity` | owner, staff | `{quantityChanged, reason}`. Negative values deduct FEFO from the oldest batch; positive values add to the newest batch. |

## Billing — `/api/billing`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | All bills (newest first) |
| GET | `/summary` | any | Sales summary |
| GET | `/date-range` | any | Bills in a date range (query params) |
| GET | `/:id` | any | One bill |
| GET | `/customer/:customerId` | any | A customer's bills |
| POST | `/` | owner, staff | `{customerId?, customerName, customerType?, items: [{medicineId, quantity}], paymentMethod?}`. Deducts stock, adds 12% GST, generates a PDF, sends notifications. |
| POST | `/payment/confirm` | owner, staff | Confirm a payment |

## Customers — `/api/customers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | List |
| GET | `/stats` | any | Customer statistics |
| GET | `/search` | any | Search by name or phone |
| GET | `/:id` | any | One customer |
| POST | `/` | owner, staff | Create (`phone` must be unique) |
| PUT | `/:id` | owner, staff | Update |
| DELETE | `/:id` | owner | Delete |

## Alerts — `/api/alerts`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | any | All alerts |
| GET | `/critical` | any | Critical, unresolved alerts |
| GET | `/recommendations` | any | Medicine recommendations |
| POST | `/generate` | owner, staff | Scan inventory and create alerts (see [core-flows.md](core-flows.md#5-alert-generation)) |
| PUT | `/:id/resolve` | owner, staff | Mark resolved |

## Uploads (Excel) — `/api/uploads`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/excel` | owner, staff | `multipart/form-data`, field `file` (.xlsx/.xls, ≤ 5 MB). Imports medicines and batches. |
| GET | `/` | any | Upload history (from `AuditLog`) |
| GET | `/export` | any | Download inventory as Excel |
| GET | `/:id` | any | One upload log |

## Suppliers and purchase orders — `/api/suppliers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/suppliers` (also `/`) | owner, staff (`/`: any) | List suppliers |
| POST | `/suppliers` (also `/`) | owner | Create supplier |
| PUT | `/suppliers/:id` | owner | Update supplier |
| POST | `/reorder/generate` | owner, staff | Rule-based `AI_Draft` POs for medicines at or below reorder level |
| GET | `/reorder/suggestions` | owner, staff | Current `AI_Draft` POs in the legacy "suggestion" shape |
| POST | `/purchase-orders` | owner | `{suggestion_id, expected_delivery_date?, notes?}`: activate a draft (→ `Pending`) |
| GET | `/purchase-orders` | owner, staff | Non-draft POs; filter with `?status=&supplier_id=` |
| PUT | `/purchase-orders/:id` | owner, staff | `{order_status, received_quantity?, actual_delivery_date?}`. `Received` adds stock as a new batch and updates the supplier score. |

## Forecasting — `/api/forecast` (all routes require login)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/run` | owner | Delete existing AI drafts, run the forecast for every medicine, create new `AI_Draft` POs |
| POST | `/retrain` | any | Same as `/run` (called after Excel import) |
| GET | `/recommendations` | any | Forecast-originated POs mapped to `{predictedDemand, optimalReorderQty, priority, status}` |
| POST | `/recommendations` | any | Manual recommendation (creates an `AI_Draft`) |
| PUT | `/recommendations/:id` | any | `{status: approved\|rejected\|adjusted\|pending, approvedQty?, optimalReorderQty?, priority?, restockingDate?}` |
| DELETE | `/recommendations/:id` | any | Delete a recommendation |
| GET | `/parameters` | any | Forecast parameters (creates defaults if missing) |
| POST | `/parameters` | owner | Save parameters |
| GET | `/trend` | any | 14-day actual vs predicted series |

## Reports — `/api/reports`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/summary` | any | KPI summary |
| GET | `/dashboard/analytics` | any | Chart data |
| GET | `/sales` | owner | Sales report (`?period=&startDate=&endDate=`) |
| GET | `/purchase` | owner | Purchase report |
| GET | `/inventory` | any | Inventory report |
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
