import { PrismaClient } from '@prisma/client';
import type { Config } from '../config';

export function createDb(cfg: Config): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: cfg.databaseUrl } }, log: ['warn'] });
}
