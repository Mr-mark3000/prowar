import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

export const env = {
  port: Number(process.env.API_PORT || process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://bloodnet:bloodnet_dev_password@localhost:5432/bloodnet_ai',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret:
    process.env.JWT_SECRET || 'bloodnet_dev_jwt_secret_change_in_production_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
};
