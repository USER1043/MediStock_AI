/**
 * @file Async audit logger middleware for recording system mutations.
 * @module middleware/auditLogger
 */

import { AuditLog } from '../models/auditLogModel.js';
import log from '../utils/logger.js';
import { requestPath } from '../utils/helpers.js';

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const entry = (action, module) => ({ action, module });
const skip = (reason) => ({ skip: reason });
const LOGGED_BY_CONTROLLER = 'logged by its controller';

// Approving a forecast recommendation goes through the generic edit route with status 'approved'
const recommendationUpdate = (req) =>
    req.body?.status === 'approved' ? 'REORDER_APPROVED' : 'RECOMMENDATION_UPDATED';

/**
 * One row per write route: "METHOD /full/route/template" → { action, module }, or { skip: reason }
 * for routes that are logged by their own code or not logged at all. `action` may be a function
 * of the request. Every POST/PUT/PATCH/DELETE route must be listed here; audit.coverage.test.js
 * walks the routers and fails on any that is not.
 */
export const AUDIT_ROUTES = {
    // Users
    'POST /api/auth/register': entry('USER_CREATED', 'UserManagement'),
    'PUT /api/auth/users/:id': entry('USER_UPDATED', 'UserManagement'),
    'DELETE /api/auth/users/:id': entry('USER_DELETED', 'UserManagement'),
    'POST /api/auth/2fa/verify-setup': entry('TWO_FA_ENABLED', 'UserManagement'),
    'POST /api/auth/2fa/setup': skip('only generates a secret; verify-setup enables 2FA'),
    'POST /api/auth/login': skip(LOGGED_BY_CONTROLLER), // USER_LOGIN
    'POST /api/auth/login/verify-2fa': skip(LOGGED_BY_CONTROLLER), // USER_LOGIN

    // Inventory
    'POST /api/inventory': entry('MEDICINE_CREATED', 'Inventory'),
    'PUT /api/inventory/:id': entry('MEDICINE_UPDATED', 'Inventory'),
    'DELETE /api/inventory/:id': entry('MEDICINE_DELETED', 'Inventory'),
    'POST /api/inventory/:id/adjust-quantity': entry('STOCK_UPDATE', 'Inventory'),

    // Billing
    'POST /api/billing': entry('BILL_GENERATED', 'Billing'),
    'POST /api/billing/payment/confirm': entry('PAYMENT_CONFIRMED', 'Billing'),

    // Customers
    'POST /api/customers': entry('CUSTOMER_CREATED', 'Customers'),
    'PUT /api/customers/:id': entry('CUSTOMER_UPDATED', 'Customers'),
    'DELETE /api/customers/:id': entry('CUSTOMER_DELETED', 'Customers'),

    // Suppliers and orders
    'POST /api/suppliers': entry('SUPPLIER_CREATED', 'Suppliers'),
    'POST /api/suppliers/suppliers': entry('SUPPLIER_CREATED', 'Suppliers'),
    'PUT /api/suppliers/suppliers/:id': entry('SUPPLIER_UPDATED', 'Suppliers'),
    'POST /api/suppliers/reorder/generate': entry('REORDER_GENERATED', 'Orders'),
    'POST /api/suppliers/purchase-orders': entry('ORDER_CREATED', 'Orders'),
    'PUT /api/suppliers/purchase-orders/:id': entry('ORDER_STATUS_UPDATE', 'Orders'),

    // Categories
    'POST /api/categories': entry('CATEGORY_CREATED', 'Categories'),
    'PATCH /api/categories/:id/approve': entry('CATEGORY_APPROVED', 'Categories'),

    // Forecasting
    'POST /api/forecast/recommendations': entry('RECOMMENDATION_CREATED', 'Forecasting'),
    'PUT /api/forecast/recommendations/:id': entry(recommendationUpdate, 'Forecasting'),
    'DELETE /api/forecast/recommendations/:id': entry('RECOMMENDATION_DELETED', 'Forecasting'),
    'POST /api/forecast/parameters': entry('FORECAST_SETTINGS_UPDATED', 'Forecasting'),
    'POST /api/forecast/run': skip(LOGGED_BY_CONTROLLER), // FORECAST_RUN
    'POST /api/forecast/retrain': skip(LOGGED_BY_CONTROLLER), // MODEL_RETRAINED

    // Uploads
    'POST /api/uploads/excel': skip(LOGGED_BY_CONTROLLER), // EXCEL_UPLOAD

    // Alerts
    'PUT /api/alerts/:id/resolve': skip(LOGGED_BY_CONTROLLER), // ALERT_RESOLVED
    'POST /api/alerts/generate': skip('system housekeeping'),

    // Chatbot
    'POST /api/chatbot/query': skip('a read'),
};

// "/api/categories/" → "/api/categories"
const trimSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/**
 * The route template that handled the request, e.g. "POST /api/inventory/:id/adjust-quantity",
 * or null when no route handled it. Read at 'finish' time: req.path is relative to the router by
 * then, but req.baseUrl (the router's mount path) and req.route (the matched route) are set.
 */
export const routeKeyOf = (req) => {
    if (!req.route || typeof req.route.path !== 'string') return null;
    return `${req.method} ${trimSlash(`${req.baseUrl || ''}${req.route.path}`)}`;
};

/**
 * The { action, module } to record for a request, or null when its route is skipped.
 * A write with no row in AUDIT_ROUTES is still recorded, as OTHER / System.
 */
export const resolveAuditEntry = (req) => {
    const key = routeKeyOf(req);
    const row = key ? AUDIT_ROUTES[key] : undefined;
    if (!row) return { action: 'OTHER', module: 'System' };
    if (row.skip) return null;
    const action = typeof row.action === 'function' ? row.action(req) : row.action;
    return { action, module: row.module };
};

const clientIp = (req) =>
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

// ── Middleware ────────────────────────────────────────────────────
export const auditLogger = (req, res, next) => {
    // Only audit mutating methods
    if (!AUDITED_METHODS.has(req.method)) return next();

    // The route is only known once a router has handled the request, so decide after the response
    res.on('finish', () => {
        // Only log successful responses
        if (res.statusCode >= 400) return;

        const resolved = resolveAuditEntry(req);
        if (!resolved) return;

        const endpoint = requestPath(req);
        if (resolved.action === 'OTHER') {
            log('WARN', 'Audited a write that has no AUDIT_ROUTES row', { route: routeKeyOf(req), endpoint });
        }

        // Fire-and-forget: the response is already sent, so a failed write is only logged
        AuditLog.create({
            userId: req.user?.id ?? null,
            username: req.user?.username ?? 'anonymous',
            action: resolved.action,
            module: resolved.module,
            details: {
                body: sanitiseBody(req.body),
                params: req.params,
            },
            ipAddress: clientIp(req),
            httpMethod: req.method,
            endpoint,
            statusCode: res.statusCode,
            timestamp: new Date(),
        }).catch((err) => {
            log('ERROR', 'Audit log write failed', {
                error: err.message,
                method: req.method,
                endpoint,
                action: resolved.action,
            });
        });
    });

    next();
};

// ── Utility: explicit audit entry from controller code ───────────
// Use this for fine-grained logs (e.g. EXCEL_UPLOAD with file details). Routes that log this way
// are marked skip(...) in AUDIT_ROUTES so they are not logged twice.
export const createAuditEntry = async ({
    userId,
    username,
    action,
    module,
    details,
    ipAddress = 'server',
    httpMethod = 'POST',
    endpoint = '',
    statusCode = 200,
}) => {
    try {
        await AuditLog.create({
            userId,
            username,
            action,
            module,
            details,
            ipAddress,
            httpMethod,
            endpoint,
            statusCode,
            timestamp: new Date(),
        });
    } catch (err) {
        log('ERROR', 'Explicit audit entry failed', { error: err.message, action, endpoint });
    }
};

// ── Helper: strip sensitive fields before logging ─────────────────
const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'key', 'auth']);

function sanitiseBody(body) {
    if (!body || typeof body !== 'object') return body;
    const safe = {};
    for (const [k, v] of Object.entries(body)) {
        safe[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    return safe;
}
