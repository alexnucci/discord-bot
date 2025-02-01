import { logger } from "./utils/logger.ts";
import { query } from "./db/client.ts";
import { readMessages, archiveMessage, initializeQueue } from "./db/queue.ts";
import { withGuildWorkspace, DISCORD_EVENT_DEFINITION_ID } from "./db/meta.ts";

// Types
interface GuildEvent {
  guildId: string;
  [key: string]: unknown;
}

// Custom JSON serializer to handle BigInt
const JSONStringifyWithBigInt = (obj: unknown): string => {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint'
      ? value.toString()
      : value
  );
};

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 1000;

async function processMessage(msg: any) {
  const { guild_id, message, received_at } = msg.payload;
  
  try {
    await withGuildWorkspace({ guildId: guild_id } as GuildEvent, 'message_create', async (workspace_id) => {
      const messageData = {
        ...message,
        _metadata: {
          msg_id: msg.msg_id,
          enqueued_at: msg.enqueued_at
        }
      };

      const insertResult = await query(
        `INSERT INTO ledger.tracks (definition_id, project_id, data, received_at) 
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(messageData), received_at]
      );

      logger.info(`✅ Message saved to main DB with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
    });

    // Archive the message after successful processing
    await archiveMessage(msg.msg_id);
  } catch (error) {
    logger.error(`Failed to process message ${msg.msg_id}:`, error);
    // Don't archive - it will become visible again after VT expires
  }
}

async function startConsumer() {
  logger.info("Starting message consumer...");
  
  // Initialize the queue before starting to consume
  await initializeQueue();
  logger.info("Queue initialized");
  
  while (true) {
    try {
      const messages = await readMessages(BATCH_SIZE);
      
      if (messages.length > 0) {
        logger.info(`Processing ${messages.length} messages`);
        await Promise.all(messages.map(processMessage));
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      logger.error("Consumer error:", error);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS * 5));
    }
  }
}

if (import.meta.main) {
  startConsumer().catch(error => {
    logger.error("Fatal consumer error:", error);
    Deno.exit(1);
  });
} 