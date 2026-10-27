import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MockOrNativeWebSocket, WebSocketConnectionPool } from "./websocketConnectionPool";

class FakeWebSocket implements MockOrNativeWebSocket {
  public readyState = 0; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
  public sentMessages: string[] = [];
  public closedWith?: { code?: number; reason?: string };

  public onopen?: ((event: unknown) => void) | null;
  public onclose?: ((event: { code: number; reason: string }) => void) | null;
  public onerror?: ((error: unknown) => void) | null;
  public onmessage?: ((event: { data: string }) => void) | null;

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {}

  public open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  public send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  public close(code = 1000, reason = "Normal"): void {
    this.readyState = 3;
    this.closedWith = { code, reason };
    this.onclose?.({ code, reason });
  }

  public triggerMessage(data: string): void {
    this.onmessage?.({ data });
  }

  public triggerError(err: unknown): void {
    this.onerror?.(err);
  }
}

describe("WebSocketConnectionPool", () => {
  let createdSockets: FakeWebSocket[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    createdSockets = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createPool = (customConfig = {}) => {
    return new WebSocketConnectionPool({
      wsFactory: (url, protocols) => {
        const ws = new FakeWebSocket(url, protocols);
        createdSockets.push(ws);
        return ws;
      },
      initialRetryDelayMs: 100,
      backoffMultiplier: 2,
      maxRetryDelayMs: 1000,
      withJitter: false,
      heartbeatIntervalMs: 5000,
      heartbeatTimeoutMs: 1000,
      ...customConfig,
    });
  };

  it("should initialize in DISCONNECTED state", () => {
    const pool = createPool();
    expect(pool.getState()).toBe("DISCONNECTED");
    const stats = pool.getStatistics();
    expect(stats.messagesSent).toBe(0);
    expect(stats.messagesReceived).toBe(0);
    expect(stats.offlineQueueSize).toBe(0);
  });

  it("should transition to CONNECTING then CONNECTED upon opening", () => {
    const pool = createPool();
    const states: string[] = [];
    pool.onStateChange((state) => states.push(state));

    pool.connect("wss://api.example.com/stream");
    expect(states).toContain("CONNECTING");
    expect(createdSockets.length).toBe(1);

    createdSockets[0].open();
    expect(pool.getState()).toBe("CONNECTED");
    expect(states).toContain("CONNECTED");
  });

  it("should buffer messages when offline and flush them upon connection", () => {
    const pool = createPool();
    // Send while disconnected
    const queued1 = pool.send("agent_events", { event: "agent_boot" });
    const queued2 = pool.send("agent_events", { event: "tool_call" });

    expect(queued1).toBe(false);
    expect(queued2).toBe(false);
    expect(pool.getStatistics().offlineQueueSize).toBe(2);

    pool.connect("wss://example.com/ws");
    createdSockets[0].open();

    expect(pool.getState()).toBe("CONNECTED");
    expect(createdSockets[0].sentMessages.length).toBe(2);
    expect(pool.getStatistics().offlineQueueSize).toBe(0);
    expect(pool.getStatistics().messagesSent).toBe(2);

    const first = JSON.parse(createdSockets[0].sentMessages[0]);
    expect(first.channel).toBe("agent_events");
    expect(first.payload).toEqual({ event: "agent_boot" });
  });

  it("should deliver incoming messages to channel subscribers and wildcards", () => {
    const pool = createPool();
    pool.connect("wss://example.com/ws");
    createdSockets[0].open();

    const receivedA: any[] = [];
    const receivedWildcard: any[] = [];

    const unsubA = pool.subscribe("notifications", (payload) => {
      receivedA.push(payload);
    });

    pool.subscribe("*", (payload, meta) => {
      receivedWildcard.push({ payload, meta });
    });

    createdSockets[0].triggerMessage(
      JSON.stringify({
        channel: "notifications",
        payload: { title: "Build Successful" },
        timestamp: Date.now(),
      }),
    );

    expect(receivedA.length).toBe(1);
    expect(receivedA[0]).toEqual({ title: "Build Successful" });
    expect(receivedWildcard.length).toBe(1);
    expect(receivedWildcard[0].meta.channel).toBe("notifications");

    unsubA();
    createdSockets[0].triggerMessage(
      JSON.stringify({
        channel: "notifications",
        payload: { title: "Second notice" },
        timestamp: Date.now(),
      }),
    );
    expect(receivedA.length).toBe(1); // Unsubscribed
    expect(receivedWildcard.length).toBe(2); // Wildcard still triggers
  });

  it("should automatically attempt reconnection with backoff on close", () => {
    const pool = createPool({ initialRetryDelayMs: 200, backoffMultiplier: 2 });
    pool.connect("wss://example.com/ws");
    createdSockets[0].open();

    // Sudden disconnection
    createdSockets[0].close(1006, "Abnormal closure");
    expect(pool.getState()).toBe("RECONNECTING");

    // Advance timer to trigger first reconnection
    vi.advanceTimersByTime(200);
    expect(createdSockets.length).toBe(2);

    // Second connection fails
    createdSockets[1].close(1006, "Abnormal closure again");
    vi.advanceTimersByTime(400); // 200 * 2 = 400ms backoff
    expect(createdSockets.length).toBe(3);

    // Reconnect succeeds
    createdSockets[2].open();
    expect(pool.getState()).toBe("CONNECTED");
    expect(pool.getStatistics().reconnectCount).toBe(2);
  });

  it("should calculate backoff delays accurately without jitter", () => {
    const pool = createPool({
      initialRetryDelayMs: 100,
      backoffMultiplier: 2,
      maxRetryDelayMs: 1000,
      withJitter: false,
    });

    expect(pool.computeBackoffDelay(0)).toBe(100);
    expect(pool.computeBackoffDelay(1)).toBe(200);
    expect(pool.computeBackoffDelay(2)).toBe(400);
    expect(pool.computeBackoffDelay(3)).toBe(800);
    expect(pool.computeBackoffDelay(4)).toBe(1000); // Capped at max
  });

  it("should send periodic heartbeat pings and acknowledge pongs", () => {
    const pool = createPool({ heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 });
    pool.connect("wss://example.com/ws");
    createdSockets[0].open();

    // Fast-forward to heartbeat ping trigger
    vi.advanceTimersByTime(5000);
    expect(createdSockets[0].sentMessages.length).toBe(1);

    const pingMsg = JSON.parse(createdSockets[0].sentMessages[0]);
    expect(pingMsg.channel).toBe("__heartbeat__");

    // Reply with pong
    createdSockets[0].triggerMessage(
      JSON.stringify({
        channel: "__heartbeat__",
        type: "pong",
        payload: { ok: true },
        timestamp: Date.now(),
      }),
    );

    // Fast forward past heartbeat timeout, verify socket stays open
    vi.advanceTimersByTime(1500);
    expect(createdSockets[0].readyState).toBe(1);
  });

  it("should close zombie socket if heartbeat pong is not received within timeout", () => {
    const pool = createPool({ heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 });
    pool.connect("wss://example.com/ws");
    createdSockets[0].open();

    vi.advanceTimersByTime(5000); // Ping sent
    expect(createdSockets[0].sentMessages.length).toBe(1);

    // Advance past timeout WITHOUT pong
    vi.advanceTimersByTime(1001);
    expect(createdSockets[0].closedWith?.code).toBe(4000);
    expect(createdSockets[0].closedWith?.reason).toBe("Heartbeat Timeout");
  });

  it("should terminate and clear queue when terminate() is invoked", () => {
    const pool = createPool();
    pool.send("channel", "data");
    expect(pool.getStatistics().offlineQueueSize).toBe(1);

    pool.terminate();
    expect(pool.getState()).toBe("TERMINATED");
    expect(pool.getStatistics().offlineQueueSize).toBe(0);
  });
});
