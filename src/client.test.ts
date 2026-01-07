import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimberlogsClient, createTimberlogs } from "./client";

describe("TimberlogsClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createTimberlogs", () => {
    it("creates a client instance", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "development",
      });
      expect(client).toBeInstanceOf(TimberlogsClient);
    });
  });

  describe("logging methods", () => {
    it("queues debug logs", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "development",
      });

      client.debug("Debug message", { key: "value" });
      // Access private queue for testing
      expect((client as any).queue).toHaveLength(1);
      expect((client as any).queue[0]).toMatchObject({
        level: "debug",
        message: "Debug message",
        data: { key: "value" },
        source: "test-app",
        environment: "development",
      });
    });

    it("queues info logs", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.info("Info message");
      expect((client as any).queue[0]).toMatchObject({
        level: "info",
        message: "Info message",
      });
    });

    it("queues warn logs", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "staging",
      });

      client.warn("Warning message");
      expect((client as any).queue[0]).toMatchObject({
        level: "warn",
        message: "Warning message",
      });
    });

    it("queues error logs with Error object", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      const error = new Error("Something went wrong");
      client.error("Error occurred", error);

      expect((client as any).queue[0]).toMatchObject({
        level: "error",
        message: "Error occurred",
        errorName: "Error",
        data: { message: "Something went wrong" },
      });
      expect((client as any).queue[0].errorStack).toBeDefined();
    });

    it("queues error logs with data object", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.error("Error occurred", { errorCode: 500 });
      expect((client as any).queue[0]).toMatchObject({
        level: "error",
        message: "Error occurred",
        data: { errorCode: 500 },
      });
    });

    it("supports tags in convenience methods", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.info("Tagged message", { foo: "bar" }, { tags: ["auth", "login"] });
      expect((client as any).queue[0].tags).toEqual(["auth", "login"]);
    });

    it("supports tags in log method", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.log({
        level: "info",
        message: "Tagged via log",
        tags: ["feature-flag"],
      });
      expect((client as any).queue[0].tags).toEqual(["feature-flag"]);
    });
  });

  describe("minLevel filtering", () => {
    it("filters logs below minLevel", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        minLevel: "warn",
      });

      client.debug("Debug");
      client.info("Info");
      client.warn("Warn");
      client.error("Error");

      expect((client as any).queue).toHaveLength(2);
      expect((client as any).queue[0].level).toBe("warn");
      expect((client as any).queue[1].level).toBe("error");
    });

    it("includes all logs when minLevel is debug", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "development",
        minLevel: "debug",
      });

      client.debug("Debug");
      client.info("Info");
      client.warn("Warn");
      client.error("Error");

      expect((client as any).queue).toHaveLength(4);
    });
  });

  describe("setUserId and setSessionId", () => {
    it("sets userId for subsequent logs", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.setUserId("user-123");
      client.info("User action");

      expect((client as any).queue[0].userId).toBe("user-123");
    });

    it("sets sessionId for subsequent logs", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.setSessionId("session-abc");
      client.info("Session action");

      expect((client as any).queue[0].sessionId).toBe("session-abc");
    });

    it("allows chaining", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.setUserId("user-123").setSessionId("session-abc").info("Chained");

      expect((client as any).queue[0].userId).toBe("user-123");
      expect((client as any).queue[0].sessionId).toBe("session-abc");
    });
  });

  describe("batching", () => {
    it("triggers flush when batch size is reached", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        batchSize: 3,
      });

      // Spy on flush method
      const flushSpy = vi.spyOn(client, "flush");

      client.info("Log 1");
      client.info("Log 2");
      expect(flushSpy).not.toHaveBeenCalled();

      client.info("Log 3");
      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe("connect", () => {
    it("uses createLog for single log", async () => {
      const mockCreateLog = vi.fn().mockResolvedValue(undefined);
      const mockCreateBatchLogs = vi.fn().mockResolvedValue(undefined);

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.connect({
        createLog: mockCreateLog,
        createBatchLogs: mockCreateBatchLogs,
      });

      client.info("Single log");
      await client.flush();

      expect(mockCreateLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          message: "Single log",
        })
      );
      expect(mockCreateBatchLogs).not.toHaveBeenCalled();
    });

    it("uses createBatchLogs for multiple logs", async () => {
      const mockCreateLog = vi.fn().mockResolvedValue(undefined);
      const mockCreateBatchLogs = vi.fn().mockResolvedValue(undefined);

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.connect({
        createLog: mockCreateLog,
        createBatchLogs: mockCreateBatchLogs,
      });

      client.info("Log 1");
      client.info("Log 2");
      await client.flush();

      expect(mockCreateBatchLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          logs: expect.arrayContaining([
            expect.objectContaining({ message: "Log 1" }),
            expect.objectContaining({ message: "Log 2" }),
          ]),
        })
      );
      expect(mockCreateLog).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("flushes remaining logs on disconnect", async () => {
      const mockCreateLog = vi.fn().mockResolvedValue(undefined);

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      client.connect({
        createLog: mockCreateLog,
        createBatchLogs: vi.fn(),
      });

      client.info("Final log");
      await client.disconnect();

      expect(mockCreateLog).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("calls onError callback on failure", async () => {
      const onError = vi.fn();
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        onError,
      });

      client.connect({
        createLog: vi.fn().mockRejectedValue(new Error("Network error")),
        createBatchLogs: vi.fn(),
      });

      client.info("Will fail");
      await client.flush();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("re-queues logs on failure", async () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        onError: vi.fn(),
      });

      client.connect({
        createLog: vi.fn().mockRejectedValue(new Error("Network error")),
        createBatchLogs: vi.fn(),
      });

      client.info("Will fail");
      expect((client as any).queue).toHaveLength(1);

      await client.flush();
      expect((client as any).queue).toHaveLength(1);
    });
  });

  describe("config defaults", () => {
    it("uses default config values", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      expect((client as any).config.batchSize).toBe(10);
      expect((client as any).config.flushInterval).toBe(5000);
      expect((client as any).config.minLevel).toBe("debug");
    });

    it("allows overriding defaults", () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        batchSize: 50,
        flushInterval: 10000,
        minLevel: "error",
      });

      expect((client as any).config.batchSize).toBe(50);
      expect((client as any).config.flushInterval).toBe(10000);
      expect((client as any).config.minLevel).toBe("error");
    });
  });
});
