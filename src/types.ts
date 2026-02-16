export type LogLevel = "debug" | "info" | "warn" | "error";
export type Environment = "development" | "staging" | "production";

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  errorName?: string;
  errorStack?: string;
  tags?: string[];
  flowId?: string;
  stepIndex?: number;
  dataset?: string;
  timestamp?: string;
  ipAddress?: string;
  country?: string;
}

export interface TimberlogsConfig {
  /** Your application/service name */
  source: string;
  /** Environment (development, staging, production) */
  environment: Environment;
  /** API key for authentication (required for HTTP transport) */
  apiKey?: string;
  /** Application version */
  version?: string;
  /** Default user ID for logs */
  userId?: string;
  /** Default session ID for logs */
  sessionId?: string;
  /** Default dataset for log routing */
  dataset?: string;
  /** Number of logs to batch before sending (default: 10) */
  batchSize?: number;
  /** Interval in ms to flush logs (default: 5000) */
  flushInterval?: number;
  /** Minimum log level to send (default: debug) */
  minLevel?: LogLevel;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Retry configuration */
  retry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

export interface CreateLogArgs {
  apiKey?: string;
  level: LogLevel;
  message: string;
  source: string;
  environment: Environment;
  version?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
  errorName?: string;
  errorStack?: string;
  tags?: string[];
  flowId?: string;
  stepIndex?: number;
  dataset?: string;
  timestamp?: string;
  ipAddress?: string;
  country?: string;
}

export interface BatchLogArgs {
  apiKey?: string;
  logs: Omit<CreateLogArgs, "apiKey">[];
}
