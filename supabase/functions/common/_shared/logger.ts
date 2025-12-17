// supabase/functions/common/_shared/logger.ts
// Structured logging for Edge Functions

// deno-lint-ignore-file no-explicit-any
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

declare const crypto: {
  randomUUID(): string;
};

declare const performance: {
  now(): number;
};

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLogLevel(): LogLevel {
  const level = Deno.env.get("LOG_LEVEL")?.toLowerCase() as LogLevel | undefined;
  return level && LOG_LEVELS[level] !== undefined ? level : "info";
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

class Logger {
  private requestId?: string;

  /**
   * Create a logger instance with an optional request ID for tracing.
   */
  withRequestId(requestId: string): Logger {
    const newLogger = new Logger();
    newLogger.requestId = requestId;
    return newLogger;
  }

  /**
   * Generate a unique request ID.
   */
  generateRequestId(): string {
    return crypto.randomUUID();
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(data && { data }),
      ...(this.requestId && { requestId: this.requestId }),
    };

    const formatted = formatLog(entry);

    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.info(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log("error", message, data);
  }

  /**
   * Log an error with stack trace.
   */
  logError(error: Error, context?: Record<string, unknown>) {
    this.error(error.message, {
      name: error.name,
      stack: error.stack,
      ...context,
    });
  }

  /**
   * Create a timing logger for measuring operation duration.
   */
  time(operation: string): () => void {
    const start = performance.now();
    this.debug(`Starting: ${operation}`);

    return () => {
      const duration = performance.now() - start;
      this.info(`Completed: ${operation}`, { durationMs: Math.round(duration) });
    };
  }
}

export const logger = new Logger();
export { Logger };
