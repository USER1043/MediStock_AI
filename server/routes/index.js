/**
 * @file The API routers and the paths they are mounted at.
 * @module routes
 *
 * server.js mounts exactly this list, so tests can build the same API (and walk every route,
 * see __tests__/audit.coverage.test.js) without importing server.js, which connects to the
 * database and starts listening.
 */
import authRoutes from './authRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import billingRoutes from './billingRoutes.js';
import customerRoutes from './customerRoutes.js';
import alertRoutes from './alertRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import reportRoutes from './reportRoutes.js';
import chatbotRoutes from './chatbotRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import auditRoutes from './auditRoutes.js';
import forecastRoutes from './forecastRoutes.js';

export const apiRouters = [
  ['/api/auth', authRoutes],
  ['/api/audit', auditRoutes],
  ['/api/inventory', inventoryRoutes],
  ['/api/billing', billingRoutes],
  ['/api/customers', customerRoutes],
  ['/api/alerts', alertRoutes],
  ['/api/uploads', uploadRoutes],
  ['/api/reports', reportRoutes],
  ['/api/chatbot', chatbotRoutes],
  ['/api/suppliers', supplierRoutes],
  ['/api/categories', categoryRoutes],
  ['/api/forecast', forecastRoutes],
];

// Mounts every API router on an Express app, in order
export const mountApiRouters = (app) => {
  for (const [path, router] of apiRouters) app.use(path, router);
  return app;
};
