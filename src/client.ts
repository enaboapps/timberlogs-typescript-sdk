import type { LogLevel, LogEntry, TimberlogsConfig, CreateLogArgs, BatchLogArgs } from "./types";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_RETRY = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

export class TimberlogsClient {
  private config: Required<
    Pick<TimberlogsConfig, "source" | "environment" | "batchSize" | "flushInterval" | "minLevel">
  > & {
    apiKey?: string;
    endpoint?: string;
    version?: string;
    userId?: string;
    sessionId?: string;
    onError?: (error: Error) => void;
    retry: Required<NonNullable<TimberlogsConfig["retry"]>>;
  };
  private queue: Omit<CreateLogArgs, "apiKey">[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private createLogFn: ((args: CreateLogArgs) => Promise<unknown>) | null = null;
  private createBatchLogsFn: ((args: BatchLogArgs) => Promise<unknown>) | null = null;
  private useHttp: boolean = false;

  constructor(config: TimberlogsConfig) {
    this.config = {
      source: config.source,
      environment: config.environment,
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      version: config.version,
      userId: config.userId,
      sessionId: config.sessionId,
      batchSize: config.batchSize ?? 10,
      flushInterval: config.flushInterval ?? 5000,
      minLevel: config.minLevel ?? "debug",
      onError: config.onError,
      retry: {
        maxRetries: config.retry?.maxRetries ?? DEFAULT_RETRY.maxRetries,
        initialDelayMs: config.retry?.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs,
        maxDelayMs: config.retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
      },
    };

    // Auto-start HTTP transport if apiKey and endpoint provided
    if (config.apiKey && config.endpoint) {
      this.useHttp = true;
      this.startAutoFlush();
    }
  }

  /**
   * Connect the client to custom mutation functions
   * Use this when you have direct backend access (e.g., Convex)
   */
  connect(mutations: {
    createLog: (args: CreateLogArgs) => Promise<unknown>;
    createBatchLogs: (args: BatchLogArgs) => Promise<unknown>;
  }) {
    this.createLogFn = mutations.createLog;
    this.createBatchLogsFn = mutations.createBatchLogs;
    this.useHttp = false;
    this.startAutoFlush();
    return this;
  }

  /**
   * Disconnect and flush remaining logs
   */
  async disconnect() {
    this.stopAutoFlush();
    await this.flush();
    this.createLogFn = null;
    this.createBatchLogsFn = null;
  }

  /**
   * Set the user ID for subsequent logs
   */
  setUserId(userId: string | undefined) {
    this.config.userId = userId;
    return this;
  }

  /**
   * Set the session ID for subsequent logs
   */
  setSessionId(sessionId: string | undefined) {
    this.config.sessionId = sessionId;
    return this;
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }) {
    return this.log({ level: "debug", message, data, tags: options?.tags });
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }) {
    return this.log({ level: "info", message, data, tags: options?.tags });
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }) {
    return this.log({ level: "warn", message, data, tags: options?.tags });
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | Record<string, unknown>, options?: { tags?: string[] }) {
    if (error instanceof Error) {
      return this.log({
        level: "error",
        message,
        errorName: error.name,
        errorStack: error.stack,
        data: { message: error.message },
        tags: options?.tags,
      });
    }
    return this.log({ level: "error", message, data: error, tags: options?.tags });
  }

  /**
   * Log a message with the specified level
   */
  log(entry: LogEntry) {
    if (!this.shouldLog(entry.level)) {
      return this;
    }

    const logArgs: Omit<CreateLogArgs, "apiKey"> = {
      level: entry.level,
      message: entry.message,
      source: this.config.source,
      environment: this.config.environment,
      version: this.config.version,
      userId: entry.userId ?? this.config.userId,
      sessionId: entry.sessionId ?? this.config.sessionId,
      requestId: entry.requestId,
      data: entry.data,
      errorName: entry.errorName,
      errorStack: entry.errorStack,
      tags: entry.tags,
    };

    this.queue.push(logArgs);

    if (this.queue.length >= this.config.batchSize) {
      this.flush().catch(this.handleError.bind(this));
    }

    return this;
  }

  /**
   * Immediately send all queued logs
   */
  async flush() {
    if (this.queue.length === 0) return;

    const logs = [...this.queue];
    this.queue = [];

    try {
      if (this.useHttp) {
        await this.sendHttpBatch(logs);
      } else if (logs.length === 1 && this.createLogFn) {
        await this.createLogFn({ ...logs[0], apiKey: this.config.apiKey });
      } else if (this.createBatchLogsFn) {
        await this.createBatchLogsFn({ apiKey: this.config.apiKey, logs });
      }
    } catch (error) {
      this.handleError(error as Error);
      // Re-queue failed logs
      this.queue.unshift(...logs);
    }
  }

  /**
   * Send logs via HTTP with retry
   */
  private async sendHttpBatch(logs: Omit<CreateLogArgs, "apiKey">[]) {
    if (!this.config.endpoint || !this.config.apiKey) {
      throw new Error("HTTP transport requires endpoint and apiKey");
    }

    let lastError: Error | null = null;
    let delay = this.config.retry.initialDelayMs;

    for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
      try {
        const response = await fetch(this.config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey,
          },
          body: JSON.stringify({ logs }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        return; // Success
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.retry.maxRetries) {
          await this.sleep(delay);
          delay = Math.min(delay * 2, this.config.retry.maxDelayMs);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel];
  }

  private startAutoFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(this.handleError.bind(this));
    }, this.config.flushInterval);
  }

  private stopAutoFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private handleError(error: Error) {
    if (this.config.onError) {
      this.config.onError(error);
    } else {
      console.error("[Timberlogs] Error:", error);
    }
  }
}

/**
 * Create a new Timberlogs client
 *
 * @example
 * // With HTTP transport
 * const logger = createTimberlogs({
 *   source: "api-server",
 *   environment: "production",
 *   apiKey: "tb_live_xxxxx",
 *   endpoint: "https://your-app.com/api/logs",
 * });
 *
 * logger.info("Server started", { port: 3000 });
 * logger.error("Something went wrong", new Error("Oops"));
 *
 * @example
 * // With custom backend integration
 * const logger = createTimberlogs({
 *   source: "web-app",
 *   environment: "production",
 * });
 * logger.connect({
 *   createLog: myCreateLogFn,
 *   createBatchLogs: myBatchLogsFn,
 * });
 */
export function createTimberlogs(config: TimberlogsConfig): TimberlogsClient {
  return new TimberlogsClient(config);
}
