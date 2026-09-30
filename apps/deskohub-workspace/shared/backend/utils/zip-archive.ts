import { zipSync } from "fflate";

/**
 * The hard ceiling on how many files one archive may carry. The allowlisted
 * export manifest stays far below it; the bound exists so a future caller
 * cannot turn unbounded input into unbounded output.
 */
export const zipArchiveMaxEntries = 32;

/**
 * The hard ceiling on the uncompressed total payload size in bytes. When the
 * caller exceeds it, assembly fails instead of silently truncating content.
 */
export const zipArchiveMaxTotalBytes = 8 * 1024 * 1024;

/**
 * The hard ceiling on one entry's uncompressed content size in bytes.
 */
export const zipArchiveMaxEntryBytes = 4 * 1024 * 1024;

/**
 * One UTF-8 text file inside the assembled archive. The path is the exact
 * archive entry name: it must not start with a slash, contain `..`, or be
 * blank, so an entry can never escape or shadow another entry.
 */
export type ZipArchiveEntry = {
  readonly path: string;
  readonly content: string;
};

/**
 * A path that is safe to use verbatim as an archive entry name: nonblank,
 * no leading slash, no `..` segment, no backslash, no control characters.
 */
export const isSafeZipEntryPath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 255 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").includes("..") &&
  ![...path].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * The collected reasons an archive could not be assembled. Assembly is
 * fail-closed: the caller receives this error instead of a truncated or
 * partial archive, and nothing is written anywhere.
 */
export class ZipArchiveAssemblyError extends Error {
  constructor(reasons: readonly string[]) {
    super(`zip archive assembly failed closed: ${reasons.join("; ")}`);
    this.name = "ZipArchiveAssemblyError";
  }
}

/**
 * Assembles UTF-8 text entries into an in-memory ZIP archive. Every limit is
 * enforced before any byte leaves the function: an unsafe path, a duplicate
 * entry, an oversized entry, or an oversized total fails the whole assembly
 * with a {@link ZipArchiveAssemblyError}. The result exists only in the
 * caller's memory; this module never writes to disk or a store.
 */
export const buildZipArchive = (
  entries: readonly ZipArchiveEntry[],
  limits: {
    readonly maxEntries?: number;
    readonly maxTotalBytes?: number;
    readonly maxEntryBytes?: number;
  } = {}
): Uint8Array => {
  const maxEntries = limits.maxEntries ?? zipArchiveMaxEntries;
  const maxTotalBytes = limits.maxTotalBytes ?? zipArchiveMaxTotalBytes;
  const maxEntryBytes = limits.maxEntryBytes ?? zipArchiveMaxEntryBytes;

  const reasons: string[] = [];
  if (entries.length > maxEntries) {
    reasons.push(`entry count ${entries.length} exceeds ${maxEntries}`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (!isSafeZipEntryPath(entry.path)) {
      reasons.push(`unsafe entry path rejected`);
      continue;
    }
    if (seen.has(entry.path)) {
      reasons.push(`duplicate entry path`);
      continue;
    }
    seen.add(entry.path);
    const byteLength = Buffer.byteLength(entry.content, "utf8");
    if (byteLength > maxEntryBytes) {
      reasons.push(`entry exceeds per-entry limit`);
      continue;
    }
    totalBytes += byteLength;
  }
  if (totalBytes > maxTotalBytes) {
    reasons.push(`total content ${totalBytes} bytes exceeds ${maxTotalBytes}`);
  }
  if (reasons.length > 0) throw new ZipArchiveAssemblyError(reasons);

  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.path] = Buffer.from(entry.content, "utf8");
  }
  try {
    return zipSync(files, { level: 6 });
  } catch (cause) {
    throw new ZipArchiveAssemblyError([
      `zip encoder rejected the archive: ${cause instanceof Error ? cause.name : "unknown"}`,
    ]);
  }
};
