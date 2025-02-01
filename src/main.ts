// @deno-types="https://deno.land/std@0.208.0/runtime/mod.ts"
import { createBot, Intents, startBot } from "./deps.ts";
import { initSentry, Sentry } from "./utils/sentry.ts";
import { query } from "./db/client.ts";
import { getRequiredEnv } from "./utils/env.ts";
import { logger } from "./utils/logger.ts";
import { SentryLogger } from "./utils/sentry-logger.ts";
import { logUnregisteredGuild, withGuildWorkspace, DISCORD_EVENT_DEFINITION_ID } from "./db/meta.ts";
import { initializeQueue, enqueueMessage } from "./db/queue.ts";

// Custom JSON serializer to handle BigInt
const JSONStringifyWithBigInt = (obj: unknown): string => {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint'
      ? value.toString()
      : value
  );
};

// Add after the WorkspaceResult interface
const getEventType = (numericType: number | string): { type: number, type_code: string } => {
  // Message types from Discord API
  const messageTypes: Record<number, string> = {
    0: 'DEFAULT',
    1: 'RECIPIENT_ADD',
    2: 'RECIPIENT_REMOVE',
    3: 'CALL',
    4: 'CHANNEL_NAME_CHANGE',
    5: 'CHANNEL_ICON_CHANGE',
    6: 'CHANNEL_PINNED_MESSAGE',
    7: 'GUILD_MEMBER_JOIN',
    8: 'USER_PREMIUM_GUILD_SUBSCRIPTION',
    9: 'USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1',
    10: 'USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2',
    11: 'USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3',
    12: 'CHANNEL_FOLLOW_ADD',
    14: 'GUILD_DISCOVERY_DISQUALIFIED',
    15: 'GUILD_DISCOVERY_REQUALIFIED',
    16: 'GUILD_DISCOVERY_GRACE_PERIOD_INITIAL_WARNING',
    17: 'GUILD_DISCOVERY_GRACE_PERIOD_FINAL_WARNING',
    18: 'THREAD_CREATED',
    19: 'REPLY',
    20: 'CHAT_INPUT_COMMAND',
    21: 'THREAD_STARTER_MESSAGE',
    22: 'GUILD_INVITE_REMINDER',
    23: 'CONTEXT_MENU_COMMAND',
    24: 'AUTO_MODERATION_ACTION',
    25: 'ROLE_SUBSCRIPTION_PURCHASE',
    26: 'INTERACTION_PREMIUM_UPSELL',
    27: 'STAGE_START',
    28: 'STAGE_END',
    29: 'STAGE_SPEAKER',
    30: 'STAGE_TOPIC',
    31: 'GUILD_APPLICATION_PREMIUM_SUBSCRIPTION'
  };

  if (typeof numericType === 'number') {
    return {
      type: numericType,
      type_code: messageTypes[numericType] || 'UNKNOWN'
    };
  }

  // For reaction and message update events
  const eventTypes: Record<string, number> = {
    'REACTION_ADD': 1000,
    'REACTION_REMOVE': 1001,
    'MESSAGE_DELETE': 1002,
    'MESSAGE_UPDATE': 1003,
    
    // Channel events
    'CHANNEL_CREATE': 1004,
    'CHANNEL_DELETE': 1005,
    'THREAD_CREATE': 1006,
    'THREAD_DELETE': 1007,
    
    // Member events
    'MEMBER_JOIN': 1008,
    'MEMBER_LEAVE': 1009,
    'MEMBER_UPDATE': 1010,
    
    // Role events
    'ROLE_CREATE': 1011,
    'ROLE_DELETE': 1012,
    'ROLE_UPDATE': 1013,
    
    // Voice events
    'VOICE_STATE_UPDATE': 1014,
    
    // Emoji events
    'EMOJI_CREATE': 1015,
    'EMOJI_DELETE': 1016,
    'EMOJI_UPDATE': 1017,
    
    // Sticker events
    'STICKER_CREATE': 1018,
    'STICKER_DELETE': 1019,
    'STICKER_UPDATE': 1020
  };

  return {
    type: eventTypes[numericType] || 0,
    type_code: numericType
  };
};

async function main() {
  try {
    // Initialize Sentry
    await initSentry();
    logger.info("Sentry initialized");

    // Initialize PGMQ queue
    await initializeQueue();
    logger.info("Queue initialized");

    // Create Discord bot instance
    const bot = createBot({
      token: getRequiredEnv("DISCORD_BOT_TOKEN"),
      intents: Intents.Guilds | 
               Intents.GuildMessages | 
               Intents.MessageContent | 
               Intents.GuildMessageReactions |
               Intents.DirectMessageReactions |
               Intents.GuildWebhooks |     // For channel events
               Intents.GuildModeration |
               Intents.GuildMembers |        // For member events
               Intents.GuildPresences |
               Intents.GuildVoiceStates |
               Intents.GuildEmojisAndStickers,  // Add this intent
      events: {
        ready() {
          logger.info("Successfully connected to Discord gateway");
        },
        async messageCreate(_bot, message) {
          try {
            await enqueueMessage(message.guildId, message);
            logger.info("Message enqueued successfully");
          } catch (error) {
            logger.error("Failed to enqueue message:", error);
            Sentry.captureException(error, {
              extra: {
                context: {
                  guild_id: message.guildId,
                  event_type: "message_create",
                  timestamp: new Date().toISOString()
                }
              }
            });
          }
        },

        async reactionAdd(_bot, reaction, userId) {
          await withGuildWorkspace(reaction, 'reaction_add', async (workspace_id, reaction) => {
            const reactionData = {
              ...reaction,
              userId,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('REACTION_ADD')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(reactionData)]
            );

            logger.info(`✅ Reaction saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async reactionRemove(_bot, reaction, userId) {
          await withGuildWorkspace(reaction, 'reaction_remove', async (workspace_id, reaction) => {
            const reactionData = {
              ...reaction,
              userId,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('REACTION_REMOVE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(reactionData)]
            );

            logger.info(`✅ Reaction removal saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async messageDelete(_bot, message, oldMessage) {
          await withGuildWorkspace(message, 'message_delete', async (workspace_id, message) => {
            const deleteData = {
              ...message,
              old_message: oldMessage,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('MESSAGE_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(deleteData)]
            );

            logger.info(`✅ Message deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async messageUpdate(_bot, message, oldMessage) {
          await withGuildWorkspace(message, 'message_update', async (workspace_id, message) => {
            const updateData = {
              ...message,
              old_message: oldMessage,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('MESSAGE_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(updateData)]
            );

            logger.info(`✅ Message update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Add new channel event handlers
        async channelCreate(_bot, channel) {
          await withGuildWorkspace(channel, 'channel_create', async (workspace_id, channel) => {
            const channelData = {
              ...channel,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('CHANNEL_CREATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(channelData)]
            );

            logger.info(`✅ Channel creation saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async channelDelete(_bot, channel) {
          await withGuildWorkspace(channel, 'channel_delete', async (workspace_id, channel) => {
            const channelData = {
              ...channel,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('CHANNEL_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(channelData)]
            );

            logger.info(`✅ Channel deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async threadCreate(_bot, thread) {
          await withGuildWorkspace(thread, 'thread_create', async (workspace_id, thread) => {
            const threadData = {
              ...thread,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('THREAD_CREATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(threadData)]
            );

            logger.info(`✅ Thread creation saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async threadDelete(_bot, thread) {
          await withGuildWorkspace(thread, 'thread_delete', async (workspace_id, thread) => {
            const threadData = {
              ...thread,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('THREAD_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(threadData)]
            );

            logger.info(`✅ Thread deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Add new member event handlers
        async guildMemberAdd(_bot, member) {
          await withGuildWorkspace(member, 'member_add', async (workspace_id, member) => {
            const memberData = {
              ...member,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('MEMBER_JOIN')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(memberData)]
            );

            logger.info(`✅ Member join saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async guildMemberRemove(_bot, member) {
          await withGuildWorkspace(member, 'member_remove', async (workspace_id, member) => {
            const memberData = {
              ...member,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('MEMBER_LEAVE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(memberData)]
            );

            logger.info(`✅ Member leave saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async guildMemberUpdate(_bot, member, oldMember) {
          await withGuildWorkspace(member, 'member_update', async (workspace_id, member) => {
            const memberData = {
              ...member,
              old_member: oldMember,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('MEMBER_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(memberData)]
            );

            logger.info(`✅ Member update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Role Events
        async roleCreate(_bot, role) {
          await withGuildWorkspace(role, 'role_create', async (workspace_id, role) => {
            const roleData = {
              ...role,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('ROLE_CREATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(roleData)]
            );

            logger.info(`✅ Role creation saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async roleDelete(_bot, role) {
          await withGuildWorkspace(role, 'role_delete', async (workspace_id, role) => {
            const roleData = {
              ...role,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('ROLE_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(roleData)]
            );

            logger.info(`✅ Role deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async roleUpdate(_bot, role, oldRole) {
          await withGuildWorkspace(role, 'role_update', async (workspace_id, role) => {
            const roleData = {
              ...role,
              old_role: oldRole,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('ROLE_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(roleData)]
            );

            logger.info(`✅ Role update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Voice Events
        async voiceStateUpdate(_bot, voiceState) {
          await withGuildWorkspace(voiceState, 'voice_state_update', async (workspace_id, voiceState) => {
            const voiceData = {
              ...voiceState,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('VOICE_STATE_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(voiceData)]
            );

            logger.info(`✅ Voice state update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Emoji Events
        async emojiCreate(_bot, emoji) {
          await withGuildWorkspace(emoji, 'emoji_create', async (workspace_id, emoji) => {
            const emojiData = {
              ...emoji,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('EMOJI_CREATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(emojiData)]
            );

            logger.info(`✅ Emoji creation saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async emojiDelete(_bot, emoji) {
          await withGuildWorkspace(emoji, 'emoji_delete', async (workspace_id, emoji) => {
            const emojiData = {
              ...emoji,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('EMOJI_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(emojiData)]
            );

            logger.info(`✅ Emoji deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async emojiUpdate(_bot, emoji, oldEmoji) {
          await withGuildWorkspace(emoji, 'emoji_update', async (workspace_id, emoji) => {
            const emojiData = {
              ...emoji,
              old_emoji: oldEmoji,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('EMOJI_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(emojiData)]
            );

            logger.info(`✅ Emoji update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        // Sticker Events
        async stickerCreate(_bot, sticker) {
          await withGuildWorkspace(sticker, 'sticker_create', async (workspace_id, sticker) => {
            const stickerData = {
              ...sticker,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('STICKER_CREATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(stickerData)]
            );

            logger.info(`✅ Sticker creation saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async stickerDelete(_bot, sticker) {
          await withGuildWorkspace(sticker, 'sticker_delete', async (workspace_id, sticker) => {
            const stickerData = {
              ...sticker,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('STICKER_DELETE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(stickerData)]
            );

            logger.info(`✅ Sticker deletion saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        },

        async stickerUpdate(_bot, sticker, oldSticker) {
          await withGuildWorkspace(sticker, 'sticker_update', async (workspace_id, sticker) => {
            const stickerData = {
              ...sticker,
              old_sticker: oldSticker,
              _metadata: {
                timestamp: new Date().toISOString(),
                ...getEventType('STICKER_UPDATE')
              }
            };

            const insertResult = await query(
              `INSERT INTO ledger.tracks (definition_id, project_id, data) 
               VALUES ($1, $2, $3)
               RETURNING id`,
              [DISCORD_EVENT_DEFINITION_ID, workspace_id, JSONStringifyWithBigInt(stickerData)]
            );

            logger.info(`✅ Sticker update saved with ID: ${insertResult[0]?.[0] ?? 'unknown'}`);
          });
        }
      }
    });

    logger.info("🚀 Starting Discord bot...");
    await startBot(bot);

  } catch (error) {
    Sentry.captureException(error);
    logger.error("💥 Fatal error:", error);
    throw error;
  }
}

// Start the bot
main(); 