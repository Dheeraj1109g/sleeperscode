import { describe, expect, it } from "vite-plus/test";

import { normalizeVfsPath, VirtualFileSystem } from "./virtualFileSystemMock.ts";

describe("normalizeVfsPath", () => {
  it("normalizes relative paths and resolves dot segments", () => {
    expect(normalizeVfsPath("a/b/../c")).toBe("/a/c");
    expect(normalizeVfsPath("C:\\Users\\project\\src")).toBe("/C:/Users/project/src");
    expect(normalizeVfsPath("./src/lib")).toBe("/src/lib");
  });
});

describe("VirtualFileSystem", () => {
  it("writes and reads files with automated parent directory creation", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("/src/index.ts", "console.log('hello');");

    expect(vfs.exists("/src/index.ts")).toBe(true);
    expect(vfs.readFile("/src/index.ts")).toBe("console.log('hello');");
    expect(vfs.isFile("/src/index.ts")).toBe(true);
    expect(vfs.isDirectory("/src")).toBe(true);
  });

  it("lists directory children non-recursively", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("/workspace/src/app.ts", "");
    vfs.writeFile("/workspace/src/utils.ts", "");
    vfs.writeFile("/workspace/README.md", "");

    const rootList = vfs.listDirectory("/workspace");
    expect(rootList).toEqual(["README.md", "src"]);

    const srcList = vfs.listDirectory("/workspace/src");
    expect(srcList).toEqual(["app.ts", "utils.ts"]);
  });

  it("deletes files and directories recursively", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("/deep/nested/folder/file.txt", "data");

    expect(vfs.exists("/deep/nested/folder/file.txt")).toBe(true);
    vfs.remove("/deep/nested");

    expect(vfs.exists("/deep/nested/folder/file.txt")).toBe(false);
    expect(vfs.exists("/deep/nested")).toBe(false);
    expect(vfs.exists("/deep")).toBe(true);
  });

  it("creates atomic checkpoints and performs state rollback", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("/state.json", "version 1");
    vfs.createCheckpoint();

    // Modify existing file and add new file
    vfs.writeFile("/state.json", "version 2");
    vfs.writeFile("/temp.txt", "temp data");
    expect(vfs.readFile("/state.json")).toBe("version 2");
    expect(vfs.exists("/temp.txt")).toBe(true);

    // Rollback to checkpoint
    const success = vfs.rollback();
    expect(success).toBe(true);
    expect(vfs.readFile("/state.json")).toBe("version 1");
    expect(vfs.exists("/temp.txt")).toBe(false);
  });
});
