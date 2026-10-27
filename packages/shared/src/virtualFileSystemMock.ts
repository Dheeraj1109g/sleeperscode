/**
 * In-Memory Virtual File System (VFS) with Atomic Transactions and Checkpoints.
 *
 * Provides isolated, sandboxed file operations for agent testing and file staging,
 * with atomic transactions, rollback checkpoints, and recursive directory tree traversal.
 *
 * @module virtualFileSystemMock
 */

export interface VfsFileEntry {
  readonly type: "file";
  readonly path: string;
  readonly content: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly sizeBytes: number;
}

export interface VfsDirectoryEntry {
  readonly type: "directory";
  readonly path: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export type VfsEntry = VfsFileEntry | VfsDirectoryEntry;

export interface VfsStats {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly sizeBytes: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

/**
 * Normalizes a virtual path to unix-style with leading forward slash and no trailing slash.
 */
export function normalizeVfsPath(p: string): string {
  const unified = p.replace(/\\/g, "/").trim();
  const segments = unified.split("/").filter((s) => s.length > 0 && s !== ".");

  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  return "/" + resolved.join("/");
}

/**
 * Isolated Virtual File System.
 */
export class VirtualFileSystem {
  private readonly entries: Map<string, VfsEntry> = new Map();
  private checkpointSnapshot?: Map<string, VfsEntry>;

  constructor() {
    // Root directory
    this.entries.set("/", {
      type: "directory",
      path: "/",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    });
  }

  public writeFile(filePath: string, content: string): void {
    const target = normalizeVfsPath(filePath);
    if (target === "/") {
      throw new Error("Cannot write file at root directory.");
    }

    const parent = this.getParentDirectory(target);
    this.ensureDirectoryRecursive(parent);

    const now = Date.now();
    const existing = this.entries.get(target);

    this.entries.set(target, {
      type: "file",
      path: target,
      content,
      createdAt: existing ? existing.createdAt : now,
      modifiedAt: now,
      sizeBytes: new TextEncoder().encode(content).length,
    });
  }

  public readFile(filePath: string): string {
    const target = normalizeVfsPath(filePath);
    const entry = this.entries.get(target);
    if (!entry) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (entry.type === "directory") {
      throw new Error(`EISDIR: illegal operation on a directory: ${filePath}`);
    }
    return entry.content;
  }

  public exists(filePath: string): boolean {
    const target = normalizeVfsPath(filePath);
    return this.entries.has(target);
  }

  public isFile(filePath: string): boolean {
    const target = normalizeVfsPath(filePath);
    return this.entries.get(target)?.type === "file";
  }

  public isDirectory(filePath: string): boolean {
    const target = normalizeVfsPath(filePath);
    return this.entries.get(target)?.type === "directory";
  }

  public stat(filePath: string): VfsStats {
    const target = normalizeVfsPath(filePath);
    const entry = this.entries.get(target);
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    return {
      isFile: entry.type === "file",
      isDirectory: entry.type === "directory",
      sizeBytes: entry.type === "file" ? entry.sizeBytes : 0,
      createdAt: entry.createdAt,
      modifiedAt: entry.modifiedAt,
    };
  }

  public mkdir(dirPath: string): void {
    const target = normalizeVfsPath(dirPath);
    if (this.entries.has(target)) {
      if (this.entries.get(target)?.type === "directory") return;
      throw new Error(`EEXIST: file already exists: ${dirPath}`);
    }
    this.ensureDirectoryRecursive(target);
  }

  public remove(targetPath: string): boolean {
    const target = normalizeVfsPath(targetPath);
    if (target === "/") {
      throw new Error("Cannot delete root directory.");
    }

    if (!this.entries.has(target)) return false;

    // Remove entry and all children if directory
    const prefix = target + "/";
    for (const p of Array.from(this.entries.keys())) {
      if (p === target || p.startsWith(prefix)) {
        this.entries.delete(p);
      }
    }

    return true;
  }

  public listDirectory(dirPath: string): readonly string[] {
    const target = normalizeVfsPath(dirPath);
    const entry = this.entries.get(target);
    if (!entry || entry.type !== "directory") {
      throw new Error(`ENOTDIR: not a directory: ${dirPath}`);
    }

    const prefix = target === "/" ? "/" : target + "/";
    const directChildren = new Set<string>();

    for (const p of this.entries.keys()) {
      if (p !== target && p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const childName = rest.split("/")[0];
        if (childName) {
          directChildren.add(childName);
        }
      }
    }

    return Array.from(directChildren).sort();
  }

  /**
   * Creates an atomic checkpoint snapshot of current VFS state.
   */
  public createCheckpoint(): void {
    this.checkpointSnapshot = new Map(this.entries);
  }

  /**
   * Rolls back VFS state to the previously captured checkpoint snapshot.
   */
  public rollback(): boolean {
    if (!this.checkpointSnapshot) return false;
    this.entries.clear();
    for (const [k, v] of this.checkpointSnapshot.entries()) {
      this.entries.set(k, { ...v });
    }
    return true;
  }

  private getParentDirectory(p: string): string {
    const lastSlash = p.lastIndexOf("/");
    if (lastSlash <= 0) return "/";
    return p.slice(0, lastSlash);
  }

  private ensureDirectoryRecursive(dirPath: string): void {
    if (dirPath === "/" || this.entries.has(dirPath)) return;

    const parent = this.getParentDirectory(dirPath);
    this.ensureDirectoryRecursive(parent);

    const now = Date.now();
    this.entries.set(dirPath, {
      type: "directory",
      path: dirPath,
      createdAt: now,
      modifiedAt: now,
    });
  }
}
