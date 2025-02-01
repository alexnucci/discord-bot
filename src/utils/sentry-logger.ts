import { Sentry } from "../deps.ts";
import { logger } from "./logger.ts";

export class SentryLogger {
  static addBreadcrumb(message: string, data?: Record<string, unknown>) {
    try {
      logger.debug("Adding Sentry breadcrumb:", { message, data });
      Sentry.addBreadcrumb({
        type: 'debug',
        category: 'app',
        message,
        data,
        level: 'info'
      });
    } catch (error) {
      logger.error('Failed to add Sentry breadcrumb:', error);
    }
  }

  static async captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', extra?: Record<string, unknown>) {
    try {
      logger.debug("Preparing to capture Sentry message:", { message, level, extra });
      
      // Add a breadcrumb for debugging
      this.addBreadcrumb('Capturing message', { message, level, extra });
      
      const eventId = Sentry.captureMessage(message, {
        level,
        extra: {
          ...extra,
          timestamp: new Date().toISOString()
        }
      });
      
      logger.debug("Sentry message captured with ID:", eventId);
      
      // Force a flush to ensure delivery
      try {
        await Sentry.flush(5000);
        logger.debug("Successfully flushed message event:", eventId);
        return eventId;
      } catch (flushError) {
        logger.error('Failed to flush message event:', { eventId, error: flushError });
        throw flushError;
      }
    } catch (error) {
      logger.error('Failed to capture Sentry message:', error);
      throw error;
    }
  }

  static async captureException(error: Error, extra?: Record<string, unknown>) {
    try {
      logger.debug("Preparing to capture Sentry exception:", { 
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }, 
        extra 
      });
      
      // Add a breadcrumb for debugging
      this.addBreadcrumb('Capturing exception', { 
        errorName: error.name,
        errorMessage: error.message,
        extra
      });
      
      const eventId = Sentry.captureException(error, {
        extra: {
          ...extra,
          timestamp: new Date().toISOString()
        }
      });
      
      logger.debug("Sentry exception captured with ID:", eventId);
      
      // Force a flush to ensure delivery
      try {
        await Sentry.flush(5000);
        logger.debug("Successfully flushed exception event:", eventId);
        return eventId;
      } catch (flushError) {
        logger.error('Failed to flush exception event:', { eventId, error: flushError });
        throw flushError;
      }
    } catch (sentryError) {
      logger.error('Failed to capture Sentry exception:', sentryError);
      logger.error('Original error:', error);
      throw sentryError;
    }
  }
} 