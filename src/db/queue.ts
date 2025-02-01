import { Pool } from "../deps.ts";
import { getRequiredEnv } from "../utils/env.ts";
import { logger } from "../utils/logger.ts";

// Custom JSON serializer to handle BigInt
const JSONStringifyWithBigInt = (obj: unknown): string => {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint'
      ? value.toString()
      : value
  );
};

// Create a connection pool for the queue database
const queuePool = new Pool({
  hostname: getRequiredEnv("QUEUE_POSTGRES_HOST"),
  database: getRequiredEnv("QUEUE_POSTGRES_DATABASE"),
  user: getRequiredEnv("QUEUE_POSTGRES_USER"),
  password: getRequiredEnv("QUEUE_POSTGRES_PASSWORD"),
  port: parseInt(getRequiredEnv("QUEUE_POSTGRES_PORT")),
}, 20);

const DISCORD_QUEUE = "discord_messages";
const VT_SECONDS = 300; // 5 minutes visibility timeout

export async function initializeQueue() {
  const client = await queuePool.connect();
  try {
    // Create the queue if it doesn't exist
    await client.queryArray(`SELECT pgmq.create($1)`, [DISCORD_QUEUE]);
    logger.info(`Queue ${DISCORD_QUEUE} initialized`);
  } catch (error) {
    if (!error.message.includes("already exists")) {
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function enqueueMessage(guildId: string, message: unknown) {
  const client = await queuePool.connect();
  try {
    const payload = {
      guild_id: guildId,
      message,
      received_at: new Date().toISOString()
    };
    
    const result = await client.queryArray(
      `SELECT pgmq.send($1, $2)`,
      [DISCORD_QUEUE, JSONStringifyWithBigInt(payload)]
    );
    
    logger.info(`Message enqueued with ID: ${result.rows[0][0]}`);
    return result.rows[0][0];
  } finally {
    client.release();
  }
}

export async function readMessages(qty = 10) {
  const client = await queuePool.connect();
  try {
    const result = await client.queryArray(
      `SELECT * FROM pgmq.read($1, $2, $3)`,
      [DISCORD_QUEUE, VT_SECONDS, qty]
    );
    return result.rows.map(row => ({
      msg_id: row[0],
      read_ct: row[1],
      enqueued_at: row[2],
      vt: row[3],
      payload: row[4]
    }));
  } finally {
    client.release();
  }
}

export async function archiveMessage(msgId: number) {
  const client = await queuePool.connect();
  try {
    await client.queryArray(
      `SELECT pgmq.archive($1::text, $2::bigint)`,
      [DISCORD_QUEUE, msgId]
    );
    logger.info(`Message ${msgId} archived`);
  } finally {
    client.release();
  }
}

export async function deleteMessage(msgId: number) {
  const client = await queuePool.connect();
  try {
    await client.queryArray(
      `SELECT pgmq.delete($1, $2)`,
      [DISCORD_QUEUE, msgId]
    );
    logger.info(`Message ${msgId} deleted`);
  } finally {
    client.release();
  }
}

export { queuePool }; 