import { readFileSync } from "node:fs";

/**
 * Structural extraction helpers for static source-contract checks.
 *
 * These checks read tracked repository sources as *policy artifacts* and
 * compute verdicts from structural properties (ordered identifiers, call
 * counts, extracted literal sets, import specifiers). They never assert that
 * a pinned prose substring exists in the file.
 */

export const readTrackedSource = (filePath: string): string =>
  readFileSync(filePath, "utf8");

export const countOccurrences = (source: string, needle: string): number =>
  source.split(needle).length - 1;

/**
 * Strips `//` line comments so occurrence counts key on active code only: a
 * commented-out call must not satisfy a structural presence check.
 */
/**
 * Removes real `//` and `/* ... *\/` comments while leaving string and
 * template-literal contents untouched: a `//` or `/*` inside a literal is
 * character data, not a comment opener, so it must not discard active code.
 */
const stripComments = (
  source: string,
  options: { readonly block?: boolean } = {}
): string => {
  const stripBlock = options.block ?? true;
  let output = "";
  let index = 0;
  // 0 = code, 1 = '...', 2 = "..."
  let literalState = 0;
  // Stack for template literals: each template (including templates nested
  // inside interpolations) pushes a frame. `text` is template character data;
  // `interp` is code between `${` and its matching `}`.
  type TemplateFrame = { mode: "text" | "interp"; braceDepth: number };
  const templateStack: TemplateFrame[] = [];
  let lineComment = false;
  let blockComment = false;

  const topTemplateFrame = () => templateStack[templateStack.length - 1];

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      }
      index += 1;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += " ";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    const textFrame = topTemplateFrame();
    if (textFrame?.mode === "text") {
      // Template character data: everything here, including `}`, `//`, and
      // `/*`, is ordinary text until the closing backtick or a `${`.
      if (char === "\\") {
        output += char + next;
        index += 2;
        continue;
      }
      if (char === "`") {
        templateStack.pop();
        output += char;
        index += 1;
        continue;
      }
      if (char === "$" && next === "{") {
        textFrame.mode = "interp";
        textFrame.braceDepth = 0;
        output += char + next;
        index += 2;
        continue;
      }
      output += char;
      index += 1;
      continue;
    }

    if (literalState === 1 || literalState === 2) {
      if (char === "\\") {
        output += char + next;
        index += 2;
        continue;
      }
      if (
        (literalState === 1 && char === "'") ||
        (literalState === 2 && char === '"')
      ) {
        literalState = 0;
      }
      output += char;
      index += 1;
      continue;
    }

    // Code states: outside any literal, or inside a template interpolation.
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (stripBlock && char === "/" && next === "*") {
      blockComment = true;
      index += 2;
      continue;
    }
    if (char === "'") {
      literalState = 1;
      output += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      literalState = 2;
      output += char;
      index += 1;
      continue;
    }
    if (char === "`") {
      templateStack.push({ mode: "text", braceDepth: 0 });
      output += char;
      index += 1;
      continue;
    }
    const interpFrame = topTemplateFrame();
    if (interpFrame?.mode === "interp") {
      if (char === "{") {
        interpFrame.braceDepth += 1;
      } else if (char === "}") {
        if (interpFrame.braceDepth === 0) {
          interpFrame.mode = "text";
        } else {
          interpFrame.braceDepth -= 1;
        }
      }
    }

    output += char;
    index += 1;
  }
  return output;
};

export const stripLineComments = (source: string): string =>
  stripComments(source, { block: false }).replace(/\s+/g, " ");

/** Extracts `id: "..."` step identifiers in source order. */
export const extractStepIds = (source: string): readonly string[] =>
  [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");

/** Extracts double-quoted string literals in source order. */
export const extractStringLiterals = (source: string): readonly string[] =>
  [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");

/** Extracts static import specifiers (module side) in source order. */
export const extractImportSpecifiers = (source: string): readonly string[] =>
  [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g
    ),
    ...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1] ?? "");

/**
 * Ordered code tokens (identifiers, string literals, punctuation) with
 * comments stripped, so verdicts can key on code structure instead of raw
 * text formatting.
 */
export const sourceTokens = (source: string): readonly string[] =>
  [
    ...stripComments(source).matchAll(
      /[A-Za-z_$][\w$]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\.\.\.|\S/g
    ),
  ].map((match) => match[0] ?? "");

/** Number of exact, adjacent occurrences of a token sequence. */
export const countTokenSequence = (
  tokens: readonly string[],
  sequence: readonly string[]
): number =>
  sequence.length === 0
    ? 0
    : tokens.reduce(
        (count, _, index) =>
          sequence.every((token, offset) => tokens[index + offset] === token)
            ? count + 1
            : count,
        0
      );

/** Index of the first exact occurrence of a token sequence, or -1. */
export const tokenSequenceIndex = (
  tokens: readonly string[],
  sequence: readonly string[]
): number => {
  if (sequence.length === 0) return -1;
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return index;
    }
  }
  return -1;
};

export const sliceBetween = (
  source: string,
  startNeedle: string,
  endNeedle: string
): string => {
  const start = source.indexOf(startNeedle);
  if (start < 0) return "";
  const endOffset = source.indexOf(endNeedle, start);
  return endOffset < 0 ? source.slice(start) : source.slice(start, endOffset);
};
