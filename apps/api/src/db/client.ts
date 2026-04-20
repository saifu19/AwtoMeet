import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';

const url = process.env.MYSQL_URL;
if (!url) {
  throw new Error('MYSQL_URL is not set');
}

export const pool = mysql.createPool({
  uri: url,
  timezone: 'Z', // Force UTC: all Date ↔ MySQL serialization uses GMT+00:00
});
export const db = drizzle(pool, { schema, mode: 'default' });
