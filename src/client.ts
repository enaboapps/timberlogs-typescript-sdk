import type { LogLevel, LogEntry, TimberlogsConfig, CreateLogArgs } from "./types";

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

const TIMBERLOGS_ENDPOINT = "https://timberlogs-ingest.enaboapps.workers.dev/v1/logs";
const TIMBERLOGS_FLOWS_ENDPOINT = "https://timberlogs-ingest.enaboapps.workers.dev/v1/flows";

function checkStr(value: string | undefined, name: string, maxLen: number): void {
  if (value !== undefined && value.length > maxLen) {
    throw new Error(`${name} exceeds ${maxLen} characters: ${value.length}`);
  }
}

function validateLogEntry(entry: LogEntry): void {
  if (!entry.message || entry.message.length === 0) {
    throw new Error("message must not be empty");
  }
  checkStr(entry.message, "message", 10_000);
  checkStr(entry.errorName, "errorName", 200);
  checkStr(entry.errorStack, "errorStack", 10_000);
  checkStr(entry.userId, "userId", 100);
  checkStr(entry.sessionId, "sessionId", 100);
  checkStr(entry.requestId, "requestId", 100);
  checkStr(entry.flowId, "flowId", 50);
  checkStr(entry.dataset, "dataset", 50);

  if (entry.stepIndex !== undefined && (entry.stepIndex < 0 || entry.stepIndex > 1000)) {
    throw new Error(`stepIndex must be 0-1000, got ${entry.stepIndex}`);
  }

  if (entry.tags) {
    if (entry.tags.length > 20) {
      throw new Error(`tags must have at most 20 items, got ${entry.tags.length}`);
    }
    for (let i = 0; i < entry.tags.length; i++) {
      if (entry.tags[i].length > 50) {
        throw new Error(`tags[${i}] exceeds 50 characters: ${entry.tags[i].length}`);
      }
    }
  }
}

/**
 * A Flow tracks a sequence of related log entries
 *
 * @example
 * const flow = await logger.flow("checkout");
 * flow.info("User started checkout");
 * flow.info("Processing payment");
 * flow.info("Order confirmed");
 */
export class Flow {
  /** The unique identifier for this flow instance */
  readonly id: string;
  /** The human-readable name of the flow */
  readonly name: string;
  private stepIndex = 0;
  private client: TimberlogsClient;

  constructor(id: string, name: string, client: TimberlogsClient) {
    this.id = id;
    this.name = name;
    this.client = client;
  }

  /**
   * Log a debug message in this flow
   */
  debug(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }): this {
    return this.logWithLevel("debug", message, data, options);
  }

  /**
   * Log an info message in this flow
   */
  info(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }): this {
    return this.logWithLevel("info", message, data, options);
  }

  /**
   * Log a warning message in this flow
   */
  warn(message: string, data?: Record<string, unknown>, options?: { tags?: string[] }): this {
    return this.logWithLevel("warn", message, data, options);
  }

  /**
   * Log an error message in this flow
   */
  error(message: string, error?: Error | Record<string, unknown>, options?: { tags?: string[] }): this {
    // Only increment stepIndex if log will actually be emitted
    if (!this.client.shouldLog("error")) {
      return this;
    }

    const step = this.stepIndex++;
    if (error instanceof Error) {
      this.client.log({
        level: "error",
        message,
        errorName: error.name,
        errorStack: error.stack,
        data: { message: error.message ?? "Unknown error" },
        tags: options?.tags,
        flowId: this.id,
        stepIndex: step,
      });
    } else {
      this.client.log({
        level: "error",
        message,
        data: error,
        tags: options?.tags,
        flowId: this.id,
        stepIndex: step,
      });
    }
    return this;
  }

  private logWithLevel(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    options?: { tags?: string[] }
  ): this {
    // Only increment stepIndex if log will actually be emitted
    if (!this.client.shouldLog(level)) {
      return this;
    }

    this.client.log({
      level,
      message,
      data,
      tags: options?.tags,
      flowId: this.id,
      stepIndex: this.stepIndex++,
    });
    return this;
  }
}

export class TimberlogsClient {
  private config: Required<
    Pick<TimberlogsConfig, "source" | "environment" | "batchSize" | "flushInterval" | "minLevel">
  > & {
    apiKey?: string;
    version?: string;
    userId?: string;
    sessionId?: string;
    dataset?: string;
    onError?: (error: Error) => void;
    retry: Required<NonNullable<TimberlogsConfig["retry"]>>;
  };
  private queue: Omit<CreateLogArgs, "apiKey">[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TimberlogsConfig) {
    if (config.batchSize !== undefined && (config.batchSize < 1 || !Number.isInteger(config.batchSize))) {
      throw new Error("batchSize must be a positive integer");
    }
    if (config.flushInterval !== undefined && config.flushInterval < 0) {
      throw new Error("flushInterval must be non-negative");
    }

    this.config = {
      source: config.source,
      environment: config.environment,
      apiKey: config.apiKey,
      version: config.version,
      userId: config.userId,
      sessionId: config.sessionId,
      dataset: config.dataset,
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

    // Auto-start HTTP transport if apiKey provided
    if (config.apiKey) {
      this.startAutoFlush();
    }
  }

  /**
   * Flush remaining logs and stop the client
   */
  async disconnect() {
    this.stopAutoFlush();
    await this.flush();
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
   * Create a new flow for tracking related log entries
   *
   * @example
   * const flow = await logger.flow("checkout");
   * flow.info("User started checkout");
   * flow.info("Processing payment");
   * flow.info("Order confirmed");
   * console.log(flow.id); // "checkout-a7x9k2f3"
   */
  async flow(name: string): Promise<Flow> {
    if (!this.config.apiKey) {
      throw new Error("API key required to create flows");
    }

    const response = await fetch(TIMBERLOGS_FLOWS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create flow: ${text}`);
    }

    const data = (await response.json()) as { flowId: string; name: string };
    return new Flow(data.flowId, data.name, this);
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
        data: { message: error.message ?? "Unknown error" },
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

    validateLogEntry(entry);

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
      flowId: entry.flowId,
      stepIndex: entry.stepIndex,
      dataset: entry.dataset ?? this.config.dataset,
      timestamp: entry.timestamp,
      ipAddress: entry.ipAddress,
      country: entry.country,
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
      await this.sendHttpBatch(logs);
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
    if (!this.config.apiKey) {
      throw new Error("HTTP transport requires apiKey");
    }

    let lastError: Error | null = null;
    let delay = this.config.retry.initialDelayMs;

    for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
      try {
        const response = await fetch(TIMBERLOGS_ENDPOINT, {
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

  /**
   * Check if a log level will be emitted based on minLevel config
   */
  shouldLog(level: LogLevel): boolean {
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
 * const logger = createTimberlogs({
 *   source: "api-server",
 *   environment: "production",
 *   apiKey: "tb_live_xxxxx",
 * });
 *
 * logger.info("Server started", { port: 3000 });
 * logger.error("Something went wrong", new Error("Oops"));
 */
export function createTimberlogs(config: TimberlogsConfig): TimberlogsClient {
  return new TimberlogsClient(config);
}
