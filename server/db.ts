import { drizzle } from 'drizzle-orm/node-postgres';
import { pool, usingPooler } from './core/db';
import * as schema from '../shared/schema';

export const db = drizzle(pool, {
  schema,
  ...(usingPooler ? { prepare: false } : {}),
});
