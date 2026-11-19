/**
 * Every write route (POST/PUT/PATCH/DELETE) of the real API routers must have a row in
 * AUDIT_ROUTES: an action and module to record, or an explicit skip. Otherwise a new route would
 * silently land in the activity log as OTHER / System.
 */
import { jest } from '@jest/globals';
import fs from 'fs';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const { apiRouters } = await import('../routes/index.js');
const { AUDIT_ROUTES } = await import('../middleware/auditLogger.js');
const { AUDIT_ACTIONS, AUDIT_MODULES } = await import('../models/auditLogModel.js');

const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];
const trimSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

// "METHOD /api/mount/route" for every write route, the way the audit middleware builds its key
const writeRouteKeys = () => {
  const keys = [];
  for (const [mountPath, router] of apiRouters) {
    for (const layer of router.stack) {
      if (!layer.route) {
        // router.use(...) middleware is fine; a nested router would hide routes from this walk
        if (layer.handle?.stack) throw new Error(`Nested router under ${mountPath}: extend this test to walk it`);
        continue;
      }
      if (typeof layer.route.path !== 'string') throw new Error(`Non-string route path under ${mountPath}`);
      for (const method of WRITE_METHODS) {
        if (layer.route.methods[method]) {
          keys.push(`${method.toUpperCase()} ${trimSlash(mountPath + layer.route.path)}`);
        }
      }
    }
  }
  return keys;
};

describe('audit route table', () => {
  const keys = writeRouteKeys();

  test('the walk finds the write routes (sanity check)', () => {
    expect(keys).toContain('POST /api/inventory/:id/adjust-quantity');
    expect(keys).toContain('PATCH /api/categories/:id/approve'); // router.route() style
    expect(keys).toContain('POST /api/suppliers'); // router.post('/')
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  test('every write route has an action or an explicit skip', () => {
    const missing = keys.filter((key) => !AUDIT_ROUTES[key]);
    expect(missing).toEqual([]);
  });

  test('every row belongs to a real write route (no stale rows)', () => {
    const stale = Object.keys(AUDIT_ROUTES).filter((key) => !keys.includes(key));
    expect(stale).toEqual([]);
  });

  test('every mapped action and module is allowed by the AuditLog model', () => {
    const rows = Object.entries(AUDIT_ROUTES).filter(([, row]) => !row.skip);
    const bad = [];
    for (const [key, row] of rows) {
      const actions = typeof row.action === 'function'
        ? [row.action({ body: {} }), row.action({ body: { status: 'approved' } })]
        : [row.action];
      for (const action of actions) if (!AUDIT_ACTIONS.includes(action)) bad.push(`${key}: action ${action}`);
      if (!AUDIT_MODULES.includes(row.module)) bad.push(`${key}: module ${row.module}`);
    }
    expect(bad).toEqual([]);
  });

  test('the Activity Log page offers every action and module the model allows', () => {
    const page = fs.readFileSync(new URL('../../src/pages/ActivityLog.jsx', import.meta.url), 'utf8');
    const actionBlock = page.match(/const ACTION_OPTIONS = \[([\s\S]*?)\n\];/)[1];
    const moduleBlock = page.match(/const MODULE_OPTIONS = \[([\s\S]*?)\];/)[1];
    const actions = [...actionBlock.matchAll(/value: '([A-Z0-9_]+)'/g)].map((m) => m[1]);
    const modules = [...moduleBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...actions].sort()).toEqual([...AUDIT_ACTIONS].sort());
    expect([...modules].sort()).toEqual([...AUDIT_MODULES].sort());
  });

  test('server.js mounts the API through this list and adds no write routes of its own', () => {
    const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    expect(source).toContain('mountApiRouters(app)');
    expect(source).not.toMatch(/app\.(post|put|patch|delete|all)\(/);
    expect(source).not.toMatch(/app\.use\(\s*['"]\/api\/[^'"]*['"]\s*,\s*\w+Routes\b/);
  });
});
