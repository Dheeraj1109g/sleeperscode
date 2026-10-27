import { describe, expect, it } from "vite-plus/test";

import { ConversationHistoryManager } from "./conversationHistoryManager.ts";

describe("ConversationHistoryManager", () => {
  it("builds linear sequence of turns sequentially", () => {
    const manager = new ConversationHistoryManager();
    const t1 = manager.appendTurn("user", "Hello agent", { id: "turn-1" });
    const t2 = manager.appendTurn("assistant", "Hello! How can I help?", { id: "turn-2" });
    const t3 = manager.appendTurn("user", "Run the build", { id: "turn-3" });

    expect(t1.parentId).toBeNull();
    expect(t2.parentId).toBe("turn-1");
    expect(t3.parentId).toBe("turn-2");

    const history = manager.getLinearHistory();
    expect(history).toHaveLength(3);
    expect(history.map((t) => t.id)).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  it("supports branching from earlier turns", () => {
    const manager = new ConversationHistoryManager();
    manager.appendTurn("user", "Initial question", { id: "t1" });
    manager.appendTurn("assistant", "Option A response", { id: "t2-a" });

    // Rollback to t1 and branch into Option B
    manager.rollbackTo("t1");
    expect(manager.getActiveLeafId()).toBe("t1");

    manager.appendTurn("assistant", "Option B response", { id: "t2-b" });
    expect(manager.getActiveLeafId()).toBe("t2-b");

    // History of active branch B
    const historyB = manager.getLinearHistory();
    expect(historyB.map((t) => t.id)).toEqual(["t1", "t2-b"]);

    // Switch back to branch A
    manager.switchBranch("t2-a");
    const historyA = manager.getLinearHistory();
    expect(historyA.map((t) => t.id)).toEqual(["t1", "t2-a"]);

    // Identifies both leaf branches
    const leaves = manager.getBranchLeaves();
    expect(leaves).toContain("t2-a");
    expect(leaves).toContain("t2-b");
    expect(leaves).toHaveLength(2);
  });

  it("serializes and deserializes preserving tree branches", () => {
    const manager = new ConversationHistoryManager();
    manager.appendTurn("user", "Message 1", { id: "m1" });
    manager.appendTurn("assistant", "Message 2", { id: "m2" });

    const serialized = manager.serialize();
    const restored = ConversationHistoryManager.deserialize(serialized);

    expect(restored.size()).toBe(2);
    expect(restored.getActiveLeafId()).toBe("m2");
    expect(restored.getLinearHistory().map((t) => t.content)).toEqual(["Message 1", "Message 2"]);
  });
});
