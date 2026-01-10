import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimberlogsClient, createTimberlogs, Flow } from "./client";

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

  describe("flow", () => {
    const mockFlowResponse = (flowId: string, name: string) => ({
      ok: true,
      json: async () => ({ flowId, name }),
    });

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("creates a flow with server-generated id", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("checkout");

      expect(flow).toBeInstanceOf(Flow);
      expect(flow.name).toBe("checkout");
      expect(flow.id).toBe("checkout-abc12345");
    });

    it("generates unique ids for each flow", async () => {
      (fetch as any)
        .mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"))
        .mockResolvedValueOnce(mockFlowResponse("checkout-xyz98765", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow1 = await client.flow("checkout");
      const flow2 = await client.flow("checkout");

      expect(flow1.id).not.toBe(flow2.id);
    });

    it("logs with flowId and auto-incrementing stepIndex", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("checkout");
      flow.info("Step 1");
      flow.info("Step 2");
      flow.info("Step 3");

      const queue = (client as any).queue;
      expect(queue).toHaveLength(3);
      expect(queue[0].flowId).toBe(flow.id);
      expect(queue[0].stepIndex).toBe(0);
      expect(queue[1].stepIndex).toBe(1);
      expect(queue[2].stepIndex).toBe(2);
    });

    it("supports all log levels", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("test-abc12345", "test"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("test");
      flow.debug("Debug");
      flow.info("Info");
      flow.warn("Warn");
      flow.error("Error");

      const queue = (client as any).queue;
      expect(queue).toHaveLength(4);
      expect(queue[0].level).toBe("debug");
      expect(queue[1].level).toBe("info");
      expect(queue[2].level).toBe("warn");
      expect(queue[3].level).toBe("error");
    });

    it("supports data and tags", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("checkout");
      flow.info("Processing", { orderId: "123" }, { tags: ["payment"] });

      const queue = (client as any).queue;
      expect(queue[0].data).toEqual({ orderId: "123" });
      expect(queue[0].tags).toEqual(["payment"]);
    });

    it("handles Error objects in error()", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("checkout");
      const error = new Error("Payment failed");
      flow.error("Payment error", error);

      const queue = (client as any).queue;
      expect(queue[0].errorName).toBe("Error");
      expect(queue[0].data).toEqual({ message: "Payment failed" });
      expect(queue[0].errorStack).toBeDefined();
    });

    it("allows chaining", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
      });

      const flow = await client.flow("checkout");
      const result = flow.info("Step 1").info("Step 2").warn("Warning");

      expect(result).toBe(flow);
      expect((client as any).queue).toHaveLength(3);
    });

    it("does not create stepIndex gaps when logs are filtered by minLevel", async () => {
      (fetch as any).mockResolvedValueOnce(mockFlowResponse("checkout-abc12345", "checkout"));

      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
        apiKey: "tb_test_key",
        minLevel: "warn", // Only warn and error will be emitted
      });

      const flow = await client.flow("checkout");
      flow.debug("Debug - filtered");  // Should not increment stepIndex
      flow.info("Info - filtered");    // Should not increment stepIndex
      flow.warn("Warn - emitted");     // stepIndex: 0
      flow.error("Error - emitted");   // stepIndex: 1

      const queue = (client as any).queue;
      expect(queue).toHaveLength(2);
      expect(queue[0].level).toBe("warn");
      expect(queue[0].stepIndex).toBe(0);
      expect(queue[1].level).toBe("error");
      expect(queue[1].stepIndex).toBe(1);
    });

    it("throws error when apiKey is not provided", async () => {
      const client = createTimberlogs({
        source: "test-app",
        environment: "production",
      });

      await expect(client.flow("checkout")).rejects.toThrow("API key required to create flows");
    });
  });
});
