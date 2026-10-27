/**
 * Resilient WebSocket Connection Pool and Multiplexed Messaging Transport.
 *
 * Provides connection pooling, automatic exponential backoff reconnection with jitter,
 * heartbeat ping-pong health monitoring, offline message queue buffering,
 * and channel-based publish/subscribe routing.
 *
 * @module websocketConnectionPool
 */

export type PoolConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "TERMINATED";

export interface MockOrNativeWebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen?: ((event: unknown) => void) | null;
  onclose?: ((event: { code: number; reason: string }) => void) | null;
  onerror?: ((error: unknown) => void) | null;
  onmessage?: ((event: { data: string }) => void) | null;
}

export interface WebSocketPoolConfig {
  /** Maximum consecutive reconnection attempts before giving up (default: 10) */
  readonly maxRetries?: number;
  /** Initial delay before first retry attempt in milliseconds (default: 500) */
  readonly initialRetryDelayMs?: number;
  /** Maximum retry delay cap in milliseconds (default: 15000) */
  readonly maxRetryDelayMs?: number;
  /** Multiplier for exponential backoff (default: 1.5) */
  readonly backoffMultiplier?: number;
  /** Whether to add random jitter to retry delays (default: false in tests, true in prod) */
  readonly withJitter?: boolean;
  /** Heartbeat check interval in milliseconds (default: 30000) */
  readonly heartbeatIntervalMs?: number;
  /** Time to wait for heartbeat response before declaring connection dead (default: 5000) */
  readonly heartbeatTimeoutMs?: number;
  /** Maximum number of messages to buffer while offline (default: 500) */
  readonly maxOfflineQueueSize?: number;
  /** WebSocket factory constructor */
  readonly wsFactory: (url: string, protocols?: string | string[]) => MockOrNativeWebSocket;
}

export interface PoolStatistics {
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  reconnectCount: number;
  droppedMessages: number;
  offlineQueueSize: number;
  connectedAt: number | null;
  state: PoolConnectionState;
}

export interface QueuedMessage {
  readonly channel: string;
  readonly payload: unknown;
  readonly timestamp: number;
  readonly messageId: string;
}

export interface MessagePayload {
  readonly channel: string;
  readonly type?: string;
  readonly payload: unknown;
  readonly messageId?: string;
  readonly timestamp: number;
}

export type StateChangeListener = (
  state: PoolConnectionState,
  previousState: PoolConnectionState,
) => void;
export type MessageListener<T = unknown> = (payload: T, message: MessagePayload) => void;
export type ErrorListener = (error: unknown) => void;

export class WebSocketConnectionPool {
  private state: PoolConnectionState = "DISCONNECTED";
  private socket: MockOrNativeWebSocket | null = null;
  private url: string = "";
  private protocols?: string | string[];

  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly offlineQueue: QueuedMessage[] = [];
  private readonly subscriptions = new Map<string, Set<MessageListener<any>>>();
  private readonly stateListeners = new Set<StateChangeListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  private stats: PoolStatistics = {
    messagesSent: 0,
    messagesReceived: 0,
    bytesTransferred: 0,
    reconnectCount: 0,
    droppedMessages: 0,
    offlineQueueSize: 0,
    connectedAt: null,
    state: "DISCONNECTED",
  };

  private readonly config: Required<WebSocketPoolConfig>;

  constructor(config: WebSocketPoolConfig) {
    this.config = {
      maxRetries: config.maxRetries ?? 10,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 500,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 15000,
      backoffMultiplier: config.backoffMultiplier ?? 1.5,
      withJitter: config.withJitter ?? false,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 5000,
      maxOfflineQueueSize: config.maxOfflineQueueSize ?? 500,
      wsFactory: config.wsFactory,
    };
  }

  /**
   * Returns current pool connection state.
   */
  public getState(): PoolConnectionState {
    return this.state;
  }

  /**
   * Returns snapshot of connection metrics and counters.
   */
  public getStatistics(): Readonly<PoolStatistics> {
    return {
      ...this.stats,
      offlineQueueSize: this.offlineQueue.length,
      state: this.state,
    };
  }

  /**
   * Connects to the target WebSocket endpoint.
   */
  public connect(url: string, protocols?: string | string[]): void {
    if (this.state === "CONNECTED" || this.state === "CONNECTING") {
      return;
    }

    this.url = url;
    this.protocols = protocols;
    this.initiateConnection();
  }

  private initiateConnection(): void {
    this.transitionState(this.retryCount > 0 ? "RECONNECTING" : "CONNECTING");

    try {
      this.socket = this.config.wsFactory(this.url, this.protocols);
      this.bindSocketEvents(this.socket);
    } catch (err) {
      this.handleConnectionFailure(err);
    }
  }

  private bindSocketEvents(ws: MockOrNativeWebSocket): void {
    ws.onopen = () => {
      this.retryCount = 0;
      this.stats.connectedAt = Date.now();
      this.transitionState("CONNECTED");
      this.startHeartbeat();
      this.flushOfflineQueue();
    };

    ws.onmessage = (event) => {
      this.handleIncomingRawMessage(event.data);
    };

    ws.onerror = (error) => {
      this.notifyErrors(error);
    };

    ws.onclose = () => {
      this.cleanupTimers();
      if (this.state !== "TERMINATED" && this.state !== "DISCONNECTED") {
        this.scheduleReconnection();
      }
    };
  }

  private handleIncomingRawMessage(raw: string): void {
    try {
      this.stats.messagesReceived += 1;
      this.stats.bytesTransferred += raw.length;

      const parsed = JSON.parse(raw) as MessagePayload;

      // Handle heartbeat responses
      if (parsed.channel === "__heartbeat__" && parsed.type === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }

      // Deliver to subscribed listeners
      const listeners = this.subscriptions.get(parsed.channel);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) {
          try {
            listener(parsed.payload, parsed);
          } catch (listenerErr) {
            this.notifyErrors(listenerErr);
          }
        }
      }

      // Wildcard listeners
      const wildcardListeners = this.subscriptions.get("*");
      if (wildcardListeners) {
        for (const listener of wildcardListeners) {
          try {
            listener(parsed.payload, parsed);
          } catch (listenerErr) {
            this.notifyErrors(listenerErr);
          }
        }
      }
    } catch (parseErr) {
      this.notifyErrors(parseErr);
    }
  }

  /**
   * Sends a structured message across the given channel.
   * If disconnected and bufferIfOffline is true, enqueues until reconnection.
   */
  public send(channel: string, payload: unknown, options?: { bufferIfOffline?: boolean }): boolean {
    const buffer = options?.bufferIfOffline ?? true;
    const message: MessagePayload = {
      channel,
      payload,
      timestamp: Date.now(),
      messageId: `msg_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
    };

    const serialized = JSON.stringify(message);

    if (this.state === "CONNECTED" && this.socket && this.socket.readyState === 1) {
      try {
        this.socket.send(serialized);
        this.stats.messagesSent += 1;
        this.stats.bytesTransferred += serialized.length;
        return true;
      } catch (err) {
        this.notifyErrors(err);
      }
    }

    if (buffer) {
      if (this.offlineQueue.length >= this.config.maxOfflineQueueSize) {
        this.offlineQueue.shift(); // Evict oldest
        this.stats.droppedMessages += 1;
      }

      this.offlineQueue.push({
        channel,
        payload,
        timestamp: message.timestamp,
        messageId: message.messageId!,
      });
      return false;
    }

    return false;
  }

  /**
   * Subscribes a listener to a specific message channel.
   * Supports '*' for wildcard all-channels observation.
   * Returns an unsubscribe function.
   */
  public subscribe<T = unknown>(channel: string, listener: MessageListener<T>): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }

    this.subscriptions.get(channel)!.add(listener as MessageListener<any>);

    return () => {
      const set = this.subscriptions.get(channel);
      if (set) {
        set.delete(listener as MessageListener<any>);
        if (set.size === 0) {
          this.subscriptions.delete(channel);
        }
      }
    };
  }

  /**
   * Registers a connection state transition listener.
   */
  public onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Registers an error listener.
   */
  public onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * Disconnects the socket gracefully.
   */
  public disconnect(reason = "Client Disconnect"): void {
    this.cleanupTimers();
    this.transitionState("DISCONNECTED");
    if (this.socket) {
      try {
        this.socket.close(1000, reason);
      } catch {}
      this.socket = null;
    }
  }

  /**
   * Completely terminates pool, preventing any further auto-reconnections.
   */
  public terminate(): void {
    this.cleanupTimers();
    this.offlineQueue.length = 0;
    this.transitionState("TERMINATED");
    if (this.socket) {
      try {
        this.socket.close(1001, "Pool Terminated");
      } catch {}
      this.socket = null;
    }
    this.subscriptions.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
  }

  /**
   * Flushes and drains pending offline queued messages.
   */
  public flushOfflineQueue(): number {
    if (this.state !== "CONNECTED" || !this.socket || this.socket.readyState !== 1) {
      return 0;
    }

    let flushed = 0;
    while (this.offlineQueue.length > 0) {
      const item = this.offlineQueue.shift()!;
      const msg: MessagePayload = {
        channel: item.channel,
        payload: item.payload,
        timestamp: item.timestamp,
        messageId: item.messageId,
      };
      const serialized = JSON.stringify(msg);
      try {
        this.socket.send(serialized);
        this.stats.messagesSent += 1;
        this.stats.bytesTransferred += serialized.length;
        flushed += 1;
      } catch (err) {
        this.notifyErrors(err);
        this.offlineQueue.unshift(item); // Re-queue
        break;
      }
    }
    return flushed;
  }

  /**
   * Computes exponential backoff delay with optional random jitter.
   */
  public computeBackoffDelay(attempt: number): number {
    const rawDelay = Math.min(
      this.config.initialRetryDelayMs * Math.pow(this.config.backoffMultiplier, attempt),
      this.config.maxRetryDelayMs,
    );

    if (!this.config.withJitter) {
      return Math.round(rawDelay);
    }

    // Full jitter between 0 and rawDelay
    return Math.round(Math.random() * rawDelay);
  }

  private scheduleReconnection(): void {
    if (this.retryCount >= this.config.maxRetries) {
      this.transitionState("DISCONNECTED");
      return;
    }

    this.transitionState("RECONNECTING");
    const delay = this.computeBackoffDelay(this.retryCount);
    this.retryCount += 1;
    this.stats.reconnectCount += 1;

    this.retryTimer = setTimeout(() => {
      this.initiateConnection();
    }, delay);
  }

  private handleConnectionFailure(err: unknown): void {
    this.notifyErrors(err);
    this.scheduleReconnection();
  }

  private startHeartbeat(): void {
    this.cleanupHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeatPing();
    }, this.config.heartbeatIntervalMs);
  }

  private sendHeartbeatPing(): void {
    if (this.state !== "CONNECTED") return;

    this.send("__heartbeat__", { pingId: `hb_${Date.now()}` }, { bufferIfOffline: false });

    this.heartbeatTimeoutTimer = setTimeout(() => {
      // Heartbeat timed out! Force socket termination and reconnect
      if (this.socket) {
        try {
          this.socket.close(4000, "Heartbeat Timeout");
        } catch {}
      }
    }, this.config.heartbeatTimeoutMs);
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
    this.startHeartbeat();
  }

  private transitionState(newState: PoolConnectionState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.stats.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState, oldState);
      } catch (err) {
        this.notifyErrors(err);
      }
    }
  }

  private notifyErrors(error: unknown): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch {}
    }
  }

  private cleanupHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private cleanupTimers(): void {
    this.cleanupHeartbeat();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
