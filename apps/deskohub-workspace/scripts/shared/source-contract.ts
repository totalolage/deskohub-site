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
  ].map((match) => match[1] ?? "");

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
