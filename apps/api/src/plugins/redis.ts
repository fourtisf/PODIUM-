import { Redis } from 'ioredis';
import type { Config } from '../config';

export function createRedis(cfg: Config): Redis {
  return new Redis(cfg.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
}
