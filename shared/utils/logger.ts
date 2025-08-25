/**
 * Logger utility for conditional logging based on environment
 * Only logs in non-production environments to prevent debug information in production
 */

export const logger = {
  /**
   * Debug level logging - only in development
   */
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      // biome-ignore lint/suspicious/noConsole: Logger utility needs to use console internally
      console.debug(...args);
    }
  },

  /**
   * Standard logging - only in development
   */
  log: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      // biome-ignore lint/suspicious/noConsole: Logger utility needs to use console internally
      console.log(...args);
    }
  },

  /**
   * Info level logging - only in development
   */
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      // biome-ignore lint/suspicious/noConsole: Logger utility needs to use console internally
      console.info(...args);
    }
  },

  /**
   * Warning level logging - always logs (important warnings should be visible)
   */
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },

  /**
   * Error level logging - always logs (errors should always be visible)
   */
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
