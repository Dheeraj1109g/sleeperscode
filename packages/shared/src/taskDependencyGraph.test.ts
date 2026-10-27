import { describe, expect, it } from "vite-plus/test";

import { TaskDependencyGraph } from "./taskDependencyGraph.ts";

describe("TaskDependencyGraph", () => {
  it("registers tasks and retrieves by id", () => {
    const graph = new TaskDependencyGraph();
    graph.addTask({ id: "lint", name: "Lint Check", dependencies: [] });
    graph.addTask({ id: "build", name: "Build Project", dependencies: ["lint"] });

    expect(graph.getTask("lint")?.name).toBe("Lint Check");
    expect(graph.getStatus("lint")).toBe("pending");
    expect(graph.getTask("build")?.dependencies).toEqual(["lint"]);
  });

  it("prevents registering duplicate task ids", () => {
    const graph = new TaskDependencyGraph();
    graph.addTask({ id: "t1", name: "Task 1", dependencies: [] });
    expect(() => graph.addTask({ id: "t1", name: "Task 1 Dupe", dependencies: [] })).toThrow(
      "already registered",
    );
  });

  it("detects circular dependencies", () => {
    const graph = new TaskDependencyGraph();
    graph.addTask({ id: "a", name: "Task A", dependencies: ["b"] });
    graph.addTask({ id: "b", name: "Task B", dependencies: ["c"] });
    graph.addTask({ id: "c", name: "Task C", dependencies: ["a"] });

    const cycle = graph.detectCycle();
    expect(cycle.hasCycle).toBe(true);

    const plan = graph.computeExecutionPlan();
    expect(plan.hasCycles).toBe(true);
    expect(plan.executionWaves).toHaveLength(0);
  });

  it("computes parallel execution waves topologically", () => {
    const graph = new TaskDependencyGraph();
    // Wave 0: task1, task2 (no dependencies)
    graph.addTask({ id: "task1", name: "Task 1", dependencies: [] });
    graph.addTask({ id: "task2", name: "Task 2", dependencies: [] });
    // Wave 1: task3 (depends on task1)
    graph.addTask({ id: "task3", name: "Task 3", dependencies: ["task1"] });
    // Wave 2: task4 (depends on task2 and task3)
    graph.addTask({ id: "task4", name: "Task 4", dependencies: ["task2", "task3"] });

    const plan = graph.computeExecutionPlan();
    expect(plan.hasCycles).toBe(false);
    expect(plan.executionWaves).toHaveLength(3);

    // Wave 0 contains task1 & task2
    expect(plan.executionWaves[0]).toContain("task1");
    expect(plan.executionWaves[0]).toContain("task2");

    // Wave 1 contains task3
    expect(plan.executionWaves[1]).toEqual(["task3"]);

    // Wave 2 contains task4
    expect(plan.executionWaves[2]).toEqual(["task4"]);
  });

  it("sorts tasks in execution waves by priority", () => {
    const graph = new TaskDependencyGraph();
    graph.addTask({ id: "low", name: "Low Prio", dependencies: [], priority: 1 });
    graph.addTask({ id: "critical", name: "Critical Prio", dependencies: [], priority: 100 });
    graph.addTask({ id: "med", name: "Med Prio", dependencies: [], priority: 50 });

    const plan = graph.computeExecutionPlan();
    expect(plan.executionWaves[0]).toEqual(["critical", "med", "low"]);
  });

  it("identifies executable tasks based on dependency completion", () => {
    const graph = new TaskDependencyGraph();
    graph.addTask({ id: "setup", name: "Setup", dependencies: [] });
    graph.addTask({ id: "compile", name: "Compile", dependencies: ["setup"] });

    // Initially only setup is executable
    let executable = graph.getExecutableTasks();
    expect(executable).toHaveLength(1);
    expect(executable[0]?.id).toBe("setup");

    // Mark setup as running - not yet completed
    graph.setStatus("setup", "running");
    executable = graph.getExecutableTasks();
    expect(executable).toHaveLength(0);

    // Mark setup as completed - compile becomes executable
    graph.setStatus("setup", "completed");
    executable = graph.getExecutableTasks();
    expect(executable).toHaveLength(1);
    expect(executable[0]?.id).toBe("compile");
  });
});
