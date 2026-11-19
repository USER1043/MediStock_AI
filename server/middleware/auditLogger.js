/**
 * @file Async audit logger middleware for recording system mutations.
 * @module middleware/auditLogger
 */

import { AuditLog } from '../models/auditLogModel.js';
import log from '../utils/logger.js';

// ── Path → { action, module } resolution table ───────────────────
const ROUTE_MAP = [
    { pattern: /\/api\/inventory\/.*\/adjust/i, action: 'STOCK_UPDATE', module: 'Inventory' },
    { pattern: /\/api\/inventory/i, action: 'MEDICINE_CREATED', module: 'Inventory' },
    { pattern: /\/api\/billing/i, action: 'BILL_GENERATED', module: 'Billing' },
    { pattern: /\/api\/alerts\/.*\/resolve/i, action: 'ALERT_RESOLVED', module: 'Alerts' },
    { pattern: /\/api\/uploads/i, action: 'EXCEL_UPLOAD', module: 'DataImport' },
    { pattern: /\/api\/suppliers/i, action: 'SUPPLIER_CREATED', module: 'Suppliers' },
    { pattern: /\/api\/auth\/register/i, action: 'USER_CREATED', module: 'UserManagement' },
    { pattern: /\/api\/auth/i, action: 'USER_UPDATED', module: 'UserManagement' },
    { pattern: /\/api\/categories/i, action: 'CATEGORY_CREATED', module: 'Category Management' },
];

// Resolves the audit log action type and system module from HTTP method and path.
const resolveActionModule = (method, path) => {
    // DELETE method → always use DELETE action
    if (method === 'DELETE') {
        for (const r of ROUTE_MAP) {
            if (r.pattern.test(path)) return { action: 'DELETE', module: r.module };
        }
        return { action: 'DELETE', module: 'System' };
    }
    for (const r of ROUTE_MAP) {
        if (r.pattern.test(path)) return { action: r.action, module: r.module };
    }
    return { action: 'OTHER', module: 'System' };
};

// ── Middleware ────────────────────────────────────────────────────
export const auditLogger = (req, res, next) => {
    // Only audit mutating methods
    const auditMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!auditMethods.includes(req.method)) return next();

    // Skip login — recorded explicitly in authController with more context
    if (/\/api\/auth\/login/i.test(req.path)) return next();

    // Skip alert resolution — recorded explicitly in alertController with the alert's details.
    // (originalUrl, because req.path is relative to the router by the time 'finish' fires)
    if (/^\/api\/alerts\/[^/]+\/resolve/i.test(req.originalUrl || '')) return next();

    res.on('finish', () => {
        // Only log successful responses
        if (res.statusCode >= 400) return;

        const { action, module } = resolveActionModule(req.method, req.path);

        const ipAddress =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            'unknown';

        // Fire-and-forget — do NOT await; errors are silently swallowed
        // to avoid breaking anything after the response is already sent
        AuditLog.create({
            userId: req.user?.id ?? null,
            username: req.user?.username ?? 'anonymous',
            action,
            module,
            details: {
                body: sanitiseBody(req.body),
                params: req.params,
            },
            ipAddress,
            httpMethod: req.method,
            endpoint: req.path,
            statusCode: res.statusCode,
            timestamp: new Date(),
        }).catch((err) => {
            log('ERROR', 'Audit log write failed', { error: err.message, path: req.path });
        });
    });

    next();
};

// ── Utility: explicit audit entry from controller code ───────────
// Use this for fine-grained logs (e.g. EXCEL_UPLOAD with file details)
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
        log('ERROR', 'Explicit audit entry failed', { error: err.message });
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
