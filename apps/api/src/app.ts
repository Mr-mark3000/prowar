import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { pool } from './db/pool';
import { errorHandler } from './middleware/errorHandler';
import alertsRoutes from './routes/alerts.routes';
import analyticsRoutes from './routes/analytics.routes';
import authRoutes from './routes/auth.routes';
import consumptionRoutes from './routes/consumption.routes';
import inventoryRoutes from './routes/inventory.routes';
import organizationsRoutes from './routes/organizations.routes';
import requestsRoutes from './routes/requests.routes';
import transfersRoutes from './routes/transfers.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'bloodnet-api', db: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'bloodnet-api', db: 'disconnected' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/organizations', organizationsRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/consumption', consumptionRoutes);
  app.use('/api/requests', requestsRoutes);
  app.use('/api/transfers', transfersRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', alertsRoutes);

  app.use(errorHandler);
  return app;
}
