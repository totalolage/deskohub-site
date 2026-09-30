import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import {
  buildZipArchive,
  isSafeZipEntryPath,
  ZipArchiveAssemblyError,
  zipArchiveMaxEntries,
} from "./zip-archive";

describe("buildZipArchive", () => {
  test("assembles UTF-8 entries that decode back to the exact content", () => {
    const bytes = buildZipArchive([
      { path: "manifest.json", content: '{"schemaVersion":2}' },
      { path: "identity.json", content: '{"email":"ada@example.test"}' },
      { path: "početna.json", content: '{"note":"český text ✓"}' },
    ]);
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "identity.json",
      "manifest.json",
      "početna.json",
    ]);
    expect(new TextDecoder().decode(unzipped["identity.json"])).toBe(
      '{"email":"ada@example.test"}'
    );
    expect(new TextDecoder().decode(unzipped["početna.json"])).toBe(
      '{"note":"český text ✓"}'
    );
  });

  test("rejects unsafe, duplicate, oversized, and over-count archives without producing output", () => {
    expect(() =>
      buildZipArchive([{ path: "/absolute.json", content: "{}" }])
    ).toThrow(ZipArchiveAssemblyError);
    expect(() =>
      buildZipArchive([{ path: "a/../escape.json", content: "{}" }])
    ).toThrow(ZipArchiveAssemblyError);
    expect(() =>
      buildZipArchive([
        { path: "same.json", content: "{}" },
        { path: "same.json", content: "{}" },
      ])
    ).toThrow(ZipArchiveAssemblyError);
    expect(() =>
      buildZipArchive([
        { path: "big.json", content: "x".repeat(5 * 1024 * 1024) },
      ])
    ).toThrow(ZipArchiveAssemblyError);
    expect(() =>
      buildZipArchive(
        Array.from({ length: zipArchiveMaxEntries + 1 }, (_, index) => ({
          path: `entry-${index}.json`,
          content: "{}",
        }))
      )
    ).toThrow(ZipArchiveAssemblyError);
    // Two entries individually under the per-entry cap but jointly over the
    // total cap must also fail closed.
    expect(() =>
      buildZipArchive(
        Array.from({ length: 3 }, (_, index) => ({
          path: `entry-${index}.json`,
          content: "x".repeat(3 * 1024 * 1024),
        }))
      )
    ).toThrow(ZipArchiveAssemblyError);
  });

  test("respects custom tighter limits", () => {
    expect(() =>
      buildZipArchive([{ path: "a.json", content: "{}" }], { maxEntries: 0 })
    ).toThrow(ZipArchiveAssemblyError);
    const bytes = buildZipArchive([{ path: "a.json", content: "{}" }], {
      maxTotalBytes: 2,
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("isSafeZipEntryPath", () => {
  test("accepts ordinary nested names and rejects traversal and control characters", () => {
    expect(isSafeZipEntryPath("sections/identity.json")).toBe(true);
    expect(isSafeZipEntryPath("manifest.json")).toBe(true);
    expect(isSafeZipEntryPath("")).toBe(false);
    expect(isSafeZipEntryPath("/leadingslash.json")).toBe(false);
    expect(isSafeZipEntryPath("back\\slash.json")).toBe(false);
    expect(isSafeZipEntryPath("a/../b.json")).toBe(false);
    expect(isSafeZipEntryPath("new\nline.json")).toBe(false);
  });
});
