import { describe, expect, it } from "vite-plus/test";

import { parseAnsiStream, tokensToPlainText } from "./terminalAnsiParser.ts";

describe("parseAnsiStream", () => {
  it("parses unstyled plain text into a single token", () => {
    const tokens = parseAnsiStream("Simple output line");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("Simple output line");
    expect(tokens[0]?.style).toEqual({});
  });

  it("applies bold, italic, and basic foreground colors", () => {
    const raw = "\x1b[1;31mError Alert\x1b[0m Normal";
    const tokens = parseAnsiStream(raw);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.text).toBe("Error Alert");
    expect(tokens[0]?.style.bold).toBe(true);
    expect(tokens[0]?.style.foreground).toEqual({ type: "named", value: "red" });

    expect(tokens[1]?.text).toBe(" Normal");
    expect(tokens[1]?.style.bold).toBeUndefined();
    expect(tokens[1]?.style.foreground).toBeUndefined();
  });

  it("parses 256-color palette escape sequences", () => {
    const raw = "\x1b[38;5;196mHigh Alert\x1b[0m";
    const tokens = parseAnsiStream(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("High Alert");
    expect(tokens[0]?.style.foreground).toEqual({ type: "palette", value: "196" });
  });

  it("parses 24-bit TrueColor RGB escape sequences", () => {
    const raw = "\x1b[38;2;255;128;0mOrange Text\x1b[0m";
    const tokens = parseAnsiStream(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("Orange Text");
    expect(tokens[0]?.style.foreground).toEqual({ type: "rgb", value: "rgb(255, 128, 0)" });
  });

  it("parses background colors correctly", () => {
    const raw = "\x1b[42;30mBlack on Green\x1b[0m";
    const tokens = parseAnsiStream(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.style.background).toEqual({ type: "named", value: "green" });
    expect(tokens[0]?.style.foreground).toEqual({ type: "named", value: "black" });
  });

  it("extracts OSC 8 hyperlinks", () => {
    const raw = "\x1b]8;;https://github.com/yuno7777/sleeperscode\x07Sleepers Repo\x1b]8;;\x07";
    const tokens = parseAnsiStream(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("Sleepers Repo");
    expect(tokens[0]?.style.linkUrl).toBe("https://github.com/yuno7777/sleeperscode");
    expect(tokens[0]?.style.underline).toBe(true);
  });

  it("handles empty strings safely", () => {
    expect(parseAnsiStream("")).toEqual([]);
  });
});

describe("tokensToPlainText", () => {
  it("strips all ANSI formatting and reconstructs clean text", () => {
    const raw = "\x1b[1;32mSuccess:\x1b[0m Process completed in \x1b[33m120ms\x1b[0m";
    const tokens = parseAnsiStream(raw);
    const plain = tokensToPlainText(tokens);

    expect(plain).toBe("Success: Process completed in 120ms");
  });
});
