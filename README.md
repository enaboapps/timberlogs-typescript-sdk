# Timberlogs TypeScript SDK

A lightweight, flexible TypeScript SDK for structured logging with Timberlogs.

## Installation

```bash
npm install timberlogs-client
# or
pnpm add timberlogs-client
# or
yarn add timberlogs-client
```

## Quick Start

```typescript
import { createTimberlogs } from "timberlogs-client";

const logger = createTimberlogs({
  source: "my-app",
  environment: "production",
  apiKey: "your-api-key",
});

// Log messages at different levels
logger.debug("Debug information", { details: "..." });
logger.info("User logged in", { userId: "123" });
logger.warn("Rate limit approaching", { current: 95, limit: 100 });
logger.error("Payment failed", new Error("Insufficient funds"));
```

## Features

- **Multiple log levels**: debug, info, warn, error
- **Structured logging**: Attach arbitrary data to logs
- **Tags support**: Categorize logs with tags
- **Automatic batching**: Efficiently send logs in batches
- **Retry with backoff**: Automatic retries on failure
- **User/Session tracking**: Track logs by user and session
- **Flexible transport**: HTTP transport with automatic retries

## Configuration

```typescript
const logger = createTimberlogs({
  // Required
  source: "my-app",           // Your application name
  environment: "production",   // development | staging | production
  apiKey: "your-api-key",     // Your Timberlogs API key

  // Optional
  version: "1.0.0",            // App version
  userId: "user-123",          // Default user ID
  sessionId: "session-abc",    // Default session ID
  batchSize: 10,               // Logs to batch before sending (default: 10)
  flushInterval: 5000,         // Auto-flush interval in ms (default: 5000)
  minLevel: "debug",           // Minimum log level (default: debug)

  // Error handling
  onError: (error) => console.error("Logging error:", error),

  // Retry configuration
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
  },
});
```

## Usage

### Basic Logging

```typescript
logger.debug("Debug message");
logger.info("Info message", { key: "value" });
logger.warn("Warning message");
logger.error("Error message", new Error("Something went wrong"));
```

### With Tags

```typescript
logger.info("User action", { action: "click" }, { tags: ["analytics", "ui"] });
logger.error("Auth failed", error, { tags: ["auth", "security"] });

// Or using the log method
logger.log({
  level: "info",
  message: "Feature enabled",
  tags: ["feature-flag", "experiment-a"],
});
```

### User and Session Tracking

```typescript
// Set for all subsequent logs
logger.setUserId("user-123");
logger.setSessionId("session-abc");

// Now all logs include these IDs
logger.info("Action performed"); // Includes userId and sessionId

// Chainable
logger
  .setUserId("user-456")
  .setSessionId("session-xyz")
  .info("Logged in");
```

### Flow Tracking

Track related logs across multi-step processes. **Note:** Flow tracking requires an `apiKey` to be configured, as flow IDs are generated server-side.

```typescript
// Create a flow (async operation)
const flow = await logger.flow("checkout");

// All flow logs share the same flowId with auto-incrementing stepIndex
flow.info("Started checkout", { userId: "123" });
flow.info("Validated cart", { items: 3 });
flow.info("Payment processed", { amount: 99.99 });
flow.info("Order confirmed", { orderId: "ord_456" });

// Access flow properties
console.log(flow.id);   // "checkout-a1b2c3d4"
console.log(flow.name); // "checkout"
```

### Manual Flush

```typescript
// Force send all queued logs immediately
await logger.flush();

// Disconnect and flush before shutdown
await logger.disconnect();
```

## API Reference

### `createTimberlogs(config)`

Creates a new Timberlogs client instance.

### `TimberlogsClient`

#### Methods

| Method | Description |
|--------|-------------|
| `debug(message, data?, options?)` | Log a debug message |
| `info(message, data?, options?)` | Log an info message |
| `warn(message, data?, options?)` | Log a warning message |
| `error(message, error?, options?)` | Log an error message |
| `log(entry)` | Log with full control over entry |
| `flow(name)` | Create a flow for tracking related logs (async) |
| `setUserId(userId)` | Set user ID for subsequent logs |
| `setSessionId(sessionId)` | Set session ID for subsequent logs |
| `flush()` | Immediately send all queued logs |
| `disconnect()` | Flush and stop the client |

### Types

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";
type Environment = "development" | "staging" | "production";

interface LogEntry {
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
}
```

## Releasing

1. Bump the version in `package.json`
2. Commit and push to `main`
3. Create a GitHub release with tag `vX.Y.Z` (e.g., `v1.3.1`)
4. The `publish.yml` workflow automatically runs tests, builds, and publishes to npm via OIDC trusted publishing

## Support

Questions or feedback? Email us at [support@timberlogs.dev](mailto:support@timberlogs.dev)

## License

MIT
