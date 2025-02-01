import { query } from "./client.ts";
import { logger } from "../utils/logger.ts";
import { SentryLogger } from "../utils/sentry-logger.ts";

export const META_WORKSPACE_ID = 1;
export const NEW_GUILD_DEFINITION_ID = 68;
export const DISCORD_EVENT_DEFINITION_ID = 67;

interface GuildEvent {
  guildId: string | number | bigint;
  [key: string]: unknown;
}

interface WorkspaceResult {
  workspace_id: string | number | bigint;
}

const JSONStringifyWithBigInt = (obj: unknown): string => {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint'
      ? value.toString()
      : value
  );
};

export async function logUnregisteredGuild(guildId: string | number | bigint, eventData: unknown) {
  try {
    logger.info(`📝 Logging unregistered guild: ${guildId} to meta workspace`);
    logger.debug('Event data:', eventData);
    
    const metaData = {
      ...eventData,
      _metadata: {
        timestamp: new Date().toISOString(),
        event_type: 'new_guild_identified',
        guild_id: guildId.toString()
      }
    };

    logger.debug('Prepared meta data:', metaData);
    logger.debug('Using definition_id:', NEW_GUILD_DEFINITION_ID);
    logger.debug('Using workspace_id:', META_WORKSPACE_ID);

    const insertResult = await query(
      `INSERT INTO ledger.tracks 
      (definition_id, project_id, data) 
      VALUES ($1, $2, $3)
      RETURNING id`,
      [NEW_GUILD_DEFINITION_ID, META_WORKSPACE_ID, JSONStringifyWithBigInt(metaData)]
    );

    logger.info(`✅ Unregistered guild logged with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
    
  } catch (error) {
    logger.error("❌ Failed to log unregistered guild. Error details:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      guild_id: guildId.toString(),
      meta_workspace_id: META_WORKSPACE_ID,
      definition_id: NEW_GUILD_DEFINITION_ID
    });

    SentryLogger.captureException(error instanceof Error ? error : new Error(String(error)), {
      context: {
        guild_id: guildId.toString(),
        event: 'log_unregistered_guild',
        timestamp: new Date().toISOString(),
        meta_workspace_id: META_WORKSPACE_ID,
        definition_id: NEW_GUILD_DEFINITION_ID
      }
    });
  }
}

export async function withGuildWorkspace<T extends GuildEvent>(
  event: T,
  eventType: string,
  handler: (workspace_id: string | number | bigint, event: T) => Promise<void>
): Promise<void> {
  try {
    if (!event.guildId) {
      logger.warn(`❌ Skipping ${eventType}: No guild ID`);
      return;
    }

    logger.info(`🔍 Looking up workspace for guild: ${event.guildId}`);
    
    const results = await query<WorkspaceResult>(
      "SELECT * FROM __retrievers.discord_guild_details($1)",
      [event.guildId.toString()]
    );

    if (results.length === 0) {
      logger.warn(`❌ No workspace found for guild: ${event.guildId}`);
      try {
        await logUnregisteredGuild(event.guildId, event);
        logger.info(`✅ Successfully logged unregistered guild: ${event.guildId}`);
      } catch (error) {
        logger.error(`❌ Failed to log unregistered guild: ${event.guildId}`, error);
        SentryLogger.captureException(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    const workspace_id = Array.isArray(results[0]) ? results[0][0] : results[0].workspace_id;
    
    if (!workspace_id) {
      logger.error("❌ No workspace_id found in results");
      return;
    }

    await handler(workspace_id, event);

  } catch (error) {
    SentryLogger.captureException(error instanceof Error ? error : new Error(String(error)), {
      context: {
        guild_id: event.guildId.toString(),
        event_type: eventType,
        timestamp: new Date().toISOString()
      }
    });
    logger.error(`❌ Failed to process ${eventType}:`, error);
  }
} 