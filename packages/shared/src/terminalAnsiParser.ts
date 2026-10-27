/**
 * Virtual Terminal ANSI Sequence Parser and Color Transformer.
 *
 * Parses raw terminal streams into styled tokens, translates SGR parameters
 * (TrueColor 24-bit, 256-color palette, basic 16-color), and extracts OSC 8 hyperlinks.
 *
 * @module terminalAnsiParser
 */

export interface TerminalColor {
  readonly type: "named" | "palette" | "rgb";
  readonly value: string;
}

export interface TerminalStyle {
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
  readonly strikethrough?: boolean;
  readonly foreground?: TerminalColor;
  readonly background?: TerminalColor;
  readonly linkUrl?: string;
}

export interface TerminalToken {
  readonly text: string;
  readonly style: TerminalStyle;
}

const NAMED_COLORS: readonly string[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

const BRIGHT_NAMED_COLORS: readonly string[] = [
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
];

/**
 * Parses raw terminal string into an array of styled tokens.
 */
export function parseAnsiStream(raw: string): readonly TerminalToken[] {
  if (!raw) return [];

  const tokens: TerminalToken[] = [];
  let currentStyle: TerminalStyle = {};

  // Regex matches CSI sequences (\x1b[...m), OSC 8 hyperlinks (\x1b]8;;...\x07), or generic text
  // eslint-disable-next-line no-control-regex
  const tokenRegex =
    /(\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07[^\x1b]*\x1b\]8;;\x07|[^\x1b]+|\x1b[^\x1b\x07]*)/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(raw)) !== null) {
    const chunk = match[0];
    if (!chunk) continue;

    if (chunk.startsWith("\x1b[")) {
      // CSI SGR sequence: \x1b[ ... m
      if (chunk.endsWith("m")) {
        currentStyle = applySgrParameters(chunk, currentStyle);
      }
    } else if (chunk.startsWith("\x1b]8;")) {
      // OSC 8 hyperlink: \x1b]8;params;URL\x07TEXT\x1b]8;;\x07
      const oscMatch = /^\x1b\]8;[^\x07;]*;([^\x07]+)\x07([^\x1b]*)\x1b\]8;;\x07$/.exec(chunk);
      if (oscMatch) {
        const [, url, linkText] = oscMatch;
        if (url && linkText) {
          tokens.push({
            text: linkText,
            style: { ...currentStyle, linkUrl: url, underline: true },
          });
        }
      }
    } else if (!chunk.startsWith("\x1b")) {
      // Plain text content
      tokens.push({
        text: chunk,
        style: { ...currentStyle },
      });
    }
  }

  return tokens;
}

/**
 * Applies ANSI Select Graphic Rendition (SGR) codes to update terminal style.
 */
function applySgrParameters(sequence: string, baseStyle: TerminalStyle): TerminalStyle {
  const codes = sequence
    .slice(2, -1)
    .split(";")
    .map((s) => (s ? Number.parseInt(s, 10) : 0))
    .filter((n) => Number.isFinite(n));

  if (codes.length === 0) codes.push(0);

  let style = { ...baseStyle };

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? 0;

    if (code === 0) {
      style = {};
    } else if (code === 1) {
      style = { ...style, bold: true };
    } else if (code === 2) {
      style = { ...style, dim: true };
    } else if (code === 3) {
      style = { ...style, italic: true };
    } else if (code === 4) {
      style = { ...style, underline: true };
    } else if (code === 7) {
      style = { ...style, inverse: true };
    } else if (code === 9) {
      style = { ...style, strikethrough: true };
    } else if (code === 22) {
      style = { ...style, bold: false, dim: false };
    } else if (code === 23) {
      style = { ...style, italic: false };
    } else if (code === 24) {
      style = { ...style, underline: false };
    } else if (code === 27) {
      style = { ...style, inverse: false };
    } else if (code === 29) {
      style = { ...style, strikethrough: false };
    } else if (code >= 30 && code <= 37) {
      const color = NAMED_COLORS[code - 30] ?? "white";
      style = { ...style, foreground: { type: "named", value: color } };
    } else if (code === 39) {
      style = { ...style, foreground: undefined };
    } else if (code >= 40 && code <= 47) {
      const color = NAMED_COLORS[code - 40] ?? "black";
      style = { ...style, background: { type: "named", value: color } };
    } else if (code === 49) {
      style = { ...style, background: undefined };
    } else if (code >= 90 && code <= 97) {
      const color = BRIGHT_NAMED_COLORS[code - 90] ?? "white";
      style = { ...style, foreground: { type: "named", value: color } };
    } else if (code >= 100 && code <= 107) {
      const color = BRIGHT_NAMED_COLORS[code - 100] ?? "black";
      style = { ...style, background: { type: "named", value: color } };
    } else if (code === 38 || code === 48) {
      // Extended colors: 38;5;n (256 color) or 38;2;r;g;b (24-bit TrueColor)
      const isForeground = code === 38;
      const format = codes[i + 1];

      if (format === 5 && codes[i + 2] !== undefined) {
        const paletteIndex = codes[i + 2]!;
        i += 2;
        const color: TerminalColor = { type: "palette", value: String(paletteIndex) };
        style = isForeground ? { ...style, foreground: color } : { ...style, background: color };
      } else if (
        format === 2 &&
        codes[i + 2] !== undefined &&
        codes[i + 3] !== undefined &&
        codes[i + 4] !== undefined
      ) {
        const r = codes[i + 2]!;
        const g = codes[i + 3]!;
        const b = codes[i + 4]!;
        i += 4;
        const color: TerminalColor = { type: "rgb", value: `rgb(${r}, ${g}, ${b})` };
        style = isForeground ? { ...style, foreground: color } : { ...style, background: color };
      }
    }
  }

  return style;
}

/**
 * Converts styled terminal tokens to plain text with all formatting stripped.
 */
export function tokensToPlainText(tokens: readonly TerminalToken[]): string {
  return tokens.map((token) => token.text).join("");
}
