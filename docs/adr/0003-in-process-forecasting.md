# ADR-0003: Forecasting with TensorFlow.js inside the API process

**Status:** Accepted

## Context

The owner wants purchase orders drafted from predicted demand. Sales history per medicine is short (the system uses at most 90 days) and the catalogue is small (hundreds of items). The team and codebase are JavaScript-only, and hosting is a single Node service.

## Decision

Implement forecasting in `server/ml/` with **@tensorflow/tfjs**. For each medicine, build a daily series, train a small **LSTM** (window 7, 20 units, 50 epochs) at request time, predict `horizon × 7` days, apply owner-defined monthly multipliers, and compute a reorder quantity. Run it synchronously when `POST /api/forecast/run` (or `/retrain`) is called. Fall back to heuristics when history is too short.

## Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| Python microservice (Prophet / statsmodels / PyTorch) | Better ML ecosystem and performance, but a second language, deployable and network hop for a small workload. |
| Classical methods only (moving average, Holt-Winters) | Cheaper and more explainable. Holt-Winters is implemented in `demandForecast.js` but not wired in; the LSTM was chosen to capture non-linear short-term patterns. |
| Managed forecasting service (e.g. cloud AutoML) | Cost and data-sharing concerns; too heavy for this scale. |
| Pre-trained, persisted models | Faster runs, but needs model storage and a retraining schedule. Deferred. |

## Consequences

- ✅ One language and one deployable; tests can call `lstmForecast` directly.
- ✅ Each medicine gets its own model, adapted to its pattern.
- ⚠️ **CPU-heavy work on the request path**: run time grows linearly with catalogue size and competes with API traffic (the pure-JavaScript `tfjs` backend is slow).
- ⚠️ Non-deterministic results (no random seed) and no backtesting on real data yet.
- ⚠️ Models aren't persisted; every run retrains from scratch.
- Revisit when a forecast run takes longer than a normal HTTP timeout, or when forecasting across many stores: move to a background job queue, persist models, consider `tfjs-node` or a Python worker, and add backtesting to pick the best model per SKU.
