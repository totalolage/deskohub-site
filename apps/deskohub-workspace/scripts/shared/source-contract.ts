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
export const stripLineComments = (source: string): string =>
  source
    .split("\n")
    .map((line) => {
      const commentAt = line.indexOf("//");
      return commentAt === -1 ? line : line.slice(0, commentAt);
    })
    .join("\n")
    .replace(/\s+/g, " ");

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
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .matchAll(
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
