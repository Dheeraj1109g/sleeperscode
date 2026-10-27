/**
 * Multi-Agent Orchestration and Task Dependency Graph (DAG) Scheduler.
 *
 * Implements Directed Acyclic Graph topology sorting, circular dependency detection,
 * concurrency-bounded parallel wave generation, and task lifecycle tracking.
 *
 * @module taskDependencyGraph
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TaskNode<TData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly priority?: number;
  readonly data?: TData;
}

export interface TaskExecutionPlan {
  readonly executionWaves: readonly (readonly string[])[];
  readonly totalTasks: number;
  readonly hasCycles: boolean;
  readonly cyclePath?: readonly string[];
}

export interface TaskStateRecord<TData = unknown> {
  readonly node: TaskNode<TData>;
  readonly status: TaskStatus;
  readonly error?: string;
  readonly startTime?: number;
  readonly endTime?: number;
}

/**
 * Task Dependency Graph Scheduler managing multi-agent tasks and workflow DAGs.
 */
export class TaskDependencyGraph<TData = unknown> {
  private readonly nodes: Map<string, TaskNode<TData>> = new Map();
  private readonly states: Map<string, TaskStateRecord<TData>> = new Map();

  public addTask(task: TaskNode<TData>): void {
    if (this.nodes.has(task.id)) {
      throw new Error(`Task with id '${task.id}' is already registered in graph.`);
    }
    this.nodes.set(task.id, task);
    this.states.set(task.id, {
      node: task,
      status: "pending",
    });
  }

  public addTasks(tasks: readonly TaskNode<TData>[]): void {
    for (const task of tasks) {
      this.addTask(task);
    }
  }

  public getTask(id: string): TaskNode<TData> | undefined {
    return this.nodes.get(id);
  }

  public getStatus(id: string): TaskStatus | undefined {
    return this.states.get(id)?.status;
  }

  public setStatus(id: string, status: TaskStatus, error?: string): void {
    const existing = this.states.get(id);
    if (!existing) {
      throw new Error(`Task '${id}' not found in graph.`);
    }

    const now = Date.now();
    const startTime = status === "running" ? now : existing.startTime;
    const endTime =
      status === "completed" || status === "failed" || status === "skipped"
        ? now
        : existing.endTime;

    this.states.set(id, {
      ...existing,
      status,
      error,
      startTime,
      endTime,
    });
  }

  /**
   * Detects circular dependencies using depth-first search cycle detection.
   */
  public detectCycle(): { hasCycle: boolean; cyclePath?: readonly string[] } {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (currentId: string): boolean => {
      visited.add(currentId);
      recursionStack.add(currentId);
      path.push(currentId);

      const node = this.nodes.get(currentId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!this.nodes.has(depId)) {
            continue; // missing external task treated separately
          }
          if (!visited.has(depId)) {
            if (dfs(depId)) return true;
          } else if (recursionStack.has(depId)) {
            path.push(depId);
            return true;
          }
        }
      }

      recursionStack.delete(currentId);
      path.pop();
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return { hasCycle: true, cyclePath: path };
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Generates parallel execution waves via topological dependency sorting.
   * Tasks in the same wave can execute concurrently without blocking each other.
   */
  public computeExecutionPlan(): TaskExecutionPlan {
    const cycleCheck = this.detectCycle();
    if (cycleCheck.hasCycle) {
      return {
        executionWaves: [],
        totalTasks: this.nodes.size,
        hasCycles: true,
        cyclePath: cycleCheck.cyclePath,
      };
    }

    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const [id, node] of this.nodes.entries()) {
      inDegree.set(id, node.dependencies.filter((d) => this.nodes.has(d)).length);
      for (const depId of node.dependencies) {
        if (!dependents.has(depId)) {
          dependents.set(depId, []);
        }
        dependents.get(depId)!.push(id);
      }
    }

    const waves: string[][] = [];
    let currentWave: string[] = [];

    // Find all root tasks with 0 dependencies
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        currentWave.push(id);
      }
    }

    // Sort by priority (higher priority first)
    this.sortTasksByPriority(currentWave);

    const remainingDegrees = new Map(inDegree);

    while (currentWave.length > 0) {
      waves.push(currentWave);
      const nextWave: string[] = [];

      for (const taskId of currentWave) {
        const nextTasks = dependents.get(taskId) ?? [];
        for (const nextId of nextTasks) {
          const currentDeg = remainingDegrees.get(nextId) ?? 0;
          const newDeg = currentDeg - 1;
          remainingDegrees.set(nextId, newDeg);
          if (newDeg === 0) {
            nextWave.push(nextId);
          }
        }
      }

      this.sortTasksByPriority(nextWave);
      currentWave = nextWave;
    }

    return {
      executionWaves: waves,
      totalTasks: this.nodes.size,
      hasCycles: false,
    };
  }

  /**
   * Returns all tasks eligible for immediate execution (all dependencies completed).
   */
  public getExecutableTasks(): readonly TaskNode<TData>[] {
    const ready: TaskNode<TData>[] = [];

    for (const [id, state] of this.states.entries()) {
      if (state.status !== "pending") continue;

      const deps = state.node.dependencies;
      const allDepsMet = deps.every((depId) => {
        const depState = this.states.get(depId);
        return depState && depState.status === "completed";
      });

      if (allDepsMet) {
        ready.push(state.node);
      }
    }

    return ready;
  }

  private sortTasksByPriority(taskIds: string[]): void {
    taskIds.sort((a, b) => {
      const prioA = this.nodes.get(a)?.priority ?? 0;
      const prioB = this.nodes.get(b)?.priority ?? 0;
      return prioB - prioA;
    });
  }
}
