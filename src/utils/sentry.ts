import { Sentry } from "../deps.ts";
import { getRequiredEnv } from "./env.ts";
import { logger } from "./logger.ts";

export async function initSentry() {
  try {
    const dsn = getRequiredEnv("SENTRY_DSN");
    const environment = Deno.env.get("ENVIRONMENT") ?? "production";
    
    logger.info("Initializing Sentry with:", {
      dsn,
      environment,
      tracesSampleRate: 1.0,
      debug: true,
      enableTracing: true
    });

    // Parse the DSN to ensure it's valid
    const dsnUrl = new URL(dsn);
    if (!dsnUrl.protocol || !dsnUrl.hostname || !dsnUrl.pathname) {
      throw new Error("Invalid Sentry DSN format");
    }

    // Initialize Sentry first
    Sentry.init({
      dsn,
      environment,
      debug: true,
      tracesSampleRate: 1.0,
      sampleRate: 1.0, // Ensure we sample 100% of transactions
      enableTracing: true,
      autoSessionTracking: true,
      maxBreadcrumbs: 100,
      shutdownTimeout: 5000,
      beforeSend(event) {
        logger.debug("Preparing to send event to Sentry:", event);
        // Add runtime info to help debug transport issues
        event.tags = {
          ...event.tags,
          runtime: 'deno',
          version: Deno.version.deno,
          v8: Deno.version.v8,
          typescript: Deno.version.typescript,
          dsn_hostname: dsnUrl.hostname
        };
        return event;
      }
    });

    // Test the connection with a message
    logger.info("Sending test event to Sentry...");
    const eventId = Sentry.captureMessage("Sentry initialization test", {
      level: "info",
      tags: {
        test: "initialization",
        environment
      }
    });
    
    logger.info("✅ Sentry initialized successfully, test event ID:", eventId);
    
    // Force a flush and wait for it
    logger.info("Flushing Sentry events...");
    await Sentry.flush(5000);
    logger.info("✅ Sentry events flushed successfully");

  } catch (error) {
    logger.error("Failed to initialize Sentry:", error);
    if (error instanceof Error) {
      logger.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    throw error; // Re-throw to ensure the app fails if Sentry is required
  }
}

export { Sentry }; 