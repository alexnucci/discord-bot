import { Pool } from "../deps.ts";
import { getRequiredEnv } from "../utils/env.ts";
import { logger } from "../utils/logger.ts";

// Create a connection pool
const pool = new Pool({
  hostname: getRequiredEnv("POSTGRES_HOST"),
  database: getRequiredEnv("POSTGRES_DB"),
  user: getRequiredEnv("POSTGRES_USER"),
  password: getRequiredEnv("POSTGRES_PASSWORD"),
  port: parseInt(getRequiredEnv("POSTGRES_PORT")),
}, 20); // Max 20 connections

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Helper function for typed queries with retry logic
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = await pool.connect();
    try {
      const result = await client.queryArray<T>(sql, params);
      if (attempt > 1) {
        logger.info(`Query succeeded on attempt ${attempt}`);
      }
      return result.rows;
    } catch (error) {
      lastError = error;
      logger.error(`Database query failed (attempt ${attempt}/${MAX_RETRIES}):`, error);
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    } finally {
      client.release();
    }
  }
  
  throw lastError;
}

export { pool }; 