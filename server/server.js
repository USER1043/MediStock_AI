/**
 * @file Main server initialization and routing setup.
 * @module server
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import log from './utils/logger.js';
import { errorHandler, notFound, requestLogger } from './middleware/errorHandler.js';
import boxen from 'boxen';

// Import routes
import { mountApiRouters } from './routes/index.js';
import { auditLogger } from './middleware/auditLogger.js';
import { markAlertsStaleOnWrite } from './services/alertService.js';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Connect to MongoDB
await connectDB();

// Middleware
const allowedOrigins = process.env.FRONTEND_URL.split(',');

console.log('CORS Allowed Origins:', allowedOrigins);

// Resolves and validates incoming CORS origins dynamically.
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS: Blocked unauthorized origin - ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(auditLogger);  // async fire-and-forget — logs after response is sent

// API Routes
// Stock-changing requests make stored alerts stale, so the next alert read regenerates them
app.use(['/api/inventory', '/api/billing', '/api/uploads', '/api/suppliers'], markAlertsStaleOnWrite());

mountApiRouters(app); // /api/auth, /api/inventory, ... (see routes/index.js)

// Serves uploaded files securely with defensive browser execution controls.
app.use('/uploads', express.static('uploads', {
  setHeaders: (res, path, stat) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'");
    res.set('X-Frame-Options', 'DENY');
  }
}));

// Serves the root server API index route.
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MediStock Backend Server is running',
    version: '1.0.0',
    health: '/api/health',
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    const text = [
      `MediStock Backend Server Started Successfully`,
      `API Server:  http://localhost:5000`,
      `Health:      http://localhost:5000/api/health`,
      `Environment: ${process.env.NODE_ENV || 'development'}`,
      `Database:    ${process.env.MONGODB_URI || 'Not configured'}`
    ].join('\n');

    const formattedBox = boxen(text, {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'green',
      title: 'System Status',
      titleAlignment: 'center'
    });

    console.log(formattedBox);
  });
}

export default app;
