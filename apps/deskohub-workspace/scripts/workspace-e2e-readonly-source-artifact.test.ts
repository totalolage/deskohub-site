import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFrozenManifestText } from "./workspace-e2e-readonly-source-artifact";

const frozenManifestText = readFileSync(
  resolve(
    import.meta.dir,
    "../e2e/fixtures/cleanup-artifact-hashes-37580940745-1.json"
  ),
  "utf8"
);

describe("pinned read-only source artifact manifest", () => {
  test("accepts the frozen source run manifest", () => {
    const manifest = decodeFrozenManifestText(frozenManifestText);
    expect(manifest.runId).toBe("37580940745-1");
    expect(manifest.targetSha).toBe("d027de04a101a7f018960b81e164d53eb36d26cc");
    expect(manifest.files).toHaveLength(36);
  });

  test("rejects changed source context bytes in the frozen manifest", () => {
    const tampered = frozenManifestText.replace(
      '"targetSha": "d027de04a101a7f018960b81e164d53eb36d26cc"',
      '"targetSha": "c027de04a101a7f018960b81e164d53eb36d26cc"'
    );
    expect(tampered).not.toBe(frozenManifestText);
    expect(() => decodeFrozenManifestText(tampered)).toThrow(
      "frozen_source_manifest_pin_mismatch"
    );
  });

  test("rejects changed file hashes even when the manifest still parses", () => {
    const tampered = frozenManifestText.replace(/("sha256": ")[0-9a-f]/, "$1f");
    expect(tampered).not.toBe(frozenManifestText);
    expect(() => decodeFrozenManifestText(tampered)).toThrow(
      "frozen_source_manifest_pin_mismatch"
    );
  });
});
