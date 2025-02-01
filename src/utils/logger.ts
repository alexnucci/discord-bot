function getTimestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  log(...args: unknown[]) {
    console.log(`[${getTimestamp()}]`, ...args);
  },
  error(...args: unknown[]) {
    console.error(`[${getTimestamp()}]`, ...args);
  },
  info(...args: unknown[]) {
    console.info(`[${getTimestamp()}]`, ...args);
  },
  warn(...args: unknown[]) {
    console.warn(`[${getTimestamp()}]`, ...args);
  },
  debug(...args: unknown[]) {
    console.debug(`[${getTimestamp()}]`, ...args);
  }
}; 