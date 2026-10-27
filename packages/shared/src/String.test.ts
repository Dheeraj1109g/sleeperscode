import { describe, expect, it } from "vite-plus/test";

import { capitalize, pluralize, slugify, stripAnsi, truncate } from "./String.ts";

describe("truncate", () => {
  it("trims surrounding whitespace", () => {
    expect(truncate("   hello world   ")).toBe("hello world");
  });

  it("returns shorter strings unchanged", () => {
    expect(truncate("alpha", 10)).toBe("alpha");
  });

  it("truncates long strings and appends an ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde...");
  });

  it("supports a custom ellipsis", () => {
    expect(truncate("abcdefghij", 5, "…")).toBe("abcde…");
  });
});

describe("stripAnsi", () => {
  it("strips SGR color codes", () => {
    expect(stripAnsi("\x1b[31mRed Alert\x1b[0m")).toBe("Red Alert");
  });

  it("strips 256-color and 24-bit color sequences", () => {
    expect(stripAnsi("\x1b[38;5;196mHello\x1b[0m \x1b[48;2;0;255;0mWorld\x1b[0m")).toBe(
      "Hello World",
    );
  });

  it("strips cursor movement and clear codes", () => {
    expect(stripAnsi("\x1b[2K\x1b[1GLine updated")).toBe("Line updated");
  });

  it("returns plain strings unmodified", () => {
    expect(stripAnsi("pure plain text")).toBe("pure plain text");
  });
});

describe("slugify", () => {
  it("converts mixed-case strings with spaces to hyphenated lowercase", () => {
    expect(slugify("Sleepers Code Workspace")).toBe("sleepers-code-workspace");
  });

  it("strips special characters and punctuation", () => {
    expect(slugify("Feature: Add #123 (New Protocol!)")).toBe("feature-add-123-new-protocol");
  });

  it("collapses multiple consecutive delimiters into a single hyphen", () => {
    expect(slugify("hello --- ___ --- world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--leading-and-trailing--")).toBe("leading-and-trailing");
  });

  it("normalizes unicode diacritics", () => {
    expect(slugify("café résumé")).toBe("cafe-resume");
  });
});

describe("capitalize", () => {
  it("capitalizes the first letter of a word", () => {
    expect(capitalize("sleepers")).toBe("Sleepers");
  });

  it("returns an empty string when given an empty string", () => {
    expect(capitalize("")).toBe("");
  });

  it("leaves already capitalized strings unchanged", () => {
    expect(capitalize("Already capitalized")).toBe("Already capitalized");
  });
});

describe("pluralize", () => {
  it("returns singular form when count is 1", () => {
    expect(pluralize(1, "thread")).toBe("1 thread");
  });

  it("returns plural form when count is 0 or greater than 1", () => {
    expect(pluralize(0, "thread")).toBe("0 threads");
    expect(pluralize(5, "thread")).toBe("5 threads");
  });

  it("accepts a custom plural form", () => {
    expect(pluralize(1, "process", "processes")).toBe("1 process");
    expect(pluralize(2, "process", "processes")).toBe("2 processes");
  });
});
