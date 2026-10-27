/**
 * Agent Conversation Checkpoint and Branching History Manager.
 *
 * Implements immutable turn checkpoints, branch switching, rollback to earlier
 * states, and tree flattening for multi-turn agent threads.
 *
 * @module conversationHistoryManager
 */

export type TurnRole = "user" | "assistant" | "system" | "tool";

export interface ConversationTurn {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: TurnRole;
  readonly content: string;
  readonly timestamp: number;
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly input: unknown;
    readonly output?: unknown;
  }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationBranchSummary {
  readonly branchId: string;
  readonly leafTurnId: string;
  readonly totalTurns: number;
  readonly createdAt: number;
}

/**
 * Branching conversation manager tracking checkpoints and alternate paths.
 */
export class ConversationHistoryManager {
  private readonly turns: Map<string, ConversationTurn> = new Map();
  private activeLeafId: string | null = null;

  constructor(initialTurns: readonly ConversationTurn[] = []) {
    for (const turn of initialTurns) {
      this.turns.set(turn.id, turn);
      this.activeLeafId = turn.id;
    }
  }

  /**
   * Appends a new turn continuing from the currently active leaf.
   */
  public appendTurn(
    role: TurnRole,
    content: string,
    options: {
      readonly id?: string;
      readonly toolCalls?: readonly {
        readonly name: string;
        readonly input: unknown;
        readonly output?: unknown;
      }[];
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly timestamp?: number;
    } = {},
  ): ConversationTurn {
    const id = options.id ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const turn: ConversationTurn = {
      id,
      parentId: this.activeLeafId,
      role,
      content,
      timestamp: options.timestamp ?? Date.now(),
      toolCalls: options.toolCalls,
      metadata: options.metadata,
    };

    this.turns.set(id, turn);
    this.activeLeafId = id;
    return turn;
  }

  /**
   * Switches the active conversation branch by pointing to a different leaf turn.
   */
  public switchBranch(leafTurnId: string): boolean {
    if (!this.turns.has(leafTurnId)) {
      return false;
    }
    this.activeLeafId = leafTurnId;
    return true;
  }

  /**
   * Rolls back the conversation to a target turn ID, pruning subsequent turns on this path.
   */
  public rollbackTo(turnId: string): boolean {
    if (!this.turns.has(turnId)) {
      return false;
    }
    this.activeLeafId = turnId;
    return true;
  }

  /**
   * Returns the linear history of turns from root down to the active leaf.
   */
  public getLinearHistory(leafId = this.activeLeafId): readonly ConversationTurn[] {
    if (!leafId || !this.turns.has(leafId)) {
      return [];
    }

    const path: ConversationTurn[] = [];
    let currentId: string | null = leafId;

    while (currentId !== null) {
      const turn = this.turns.get(currentId);
      if (!turn) break;
      path.push(turn);
      currentId = turn.parentId;
    }

    return path.reverse();
  }

  /**
   * Identifies all distinct leaf turns in the tree (branch tips).
   */
  public getBranchLeaves(): readonly string[] {
    const parentSet = new Set<string>();
    for (const turn of this.turns.values()) {
      if (turn.parentId !== null) {
        parentSet.add(turn.parentId);
      }
    }

    const leaves: string[] = [];
    for (const id of this.turns.keys()) {
      if (!parentSet.has(id)) {
        leaves.push(id);
      }
    }

    return leaves;
  }

  public getTurn(id: string): ConversationTurn | undefined {
    return this.turns.get(id);
  }

  public size(): number {
    return this.turns.size;
  }

  public getActiveLeafId(): string | null {
    return this.activeLeafId;
  }

  /**
   * Serializes the entire conversation tree to a JSON string.
   */
  public serialize(): string {
    return JSON.stringify({
      activeLeafId: this.activeLeafId,
      turns: Array.from(this.turns.values()),
    });
  }

  /**
   * Deserializes a conversation tree from JSON.
   */
  public static deserialize(jsonString: string): ConversationHistoryManager {
    const parsed = JSON.parse(jsonString) as {
      activeLeafId: string | null;
      turns: ConversationTurn[];
    };
    const manager = new ConversationHistoryManager(parsed.turns);
    if (parsed.activeLeafId && manager.turns.has(parsed.activeLeafId)) {
      manager.activeLeafId = parsed.activeLeafId;
    }
    return manager;
  }
}
