import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  assertExactStagingLayout,
  decodeFrozenManifestText,
  selectedPinnedFiles,
  verifyPinnedSourceBackup,
} from "./workspace-e2e-readonly-source-artifact";

const frozenManifestText = readFileSync(
  resolve(
    import.meta.dir,
    "../e2e/fixtures/cleanup-artifact-hashes-37580940745-1.json"
  ),
  "utf8"
);
const frozenManifest = decodeFrozenManifestText(frozenManifestText);

const withTemporaryDirectory = async <T>(run: (root: string) => Promise<T>) => {
  const root = await mkdtemp(join(tmpdir(), "workspace-e2e-source-artifact-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const createCheckout = async (root: string) => {
  for (const { path } of frozenManifest.files) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "pinned fixture placeholder");
  }
};

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

  test("selects only frozen paths from a source checkout containing extra artifacts", async () => {
    await withTemporaryDirectory(async (root) => {
      const checkout = join(root, "checkout");
      await createCheckout(checkout);
      for (let index = 0; index < 7; index += 1) {
        const extraDirectory = join(checkout, `extra-artifact-${index}`);
        await mkdir(extraDirectory);
        await writeFile(join(extraDirectory, "unmatched.bin"), "untrusted");
      }

      const selected = await selectedPinnedFiles(checkout, frozenManifest);
      expect(selected.files).toHaveLength(36);
      expect(
        selected.files
          .map((file) => relative(checkout, file).replaceAll("\\", "/"))
          .toSorted()
      ).toEqual(frozenManifest.files.map(({ path }) => path).toSorted());
    });
  });

  test("rejects a symlink at a pinned source path", async () => {
    await withTemporaryDirectory(async (root) => {
      const checkout = join(root, "checkout");
      await createCheckout(checkout);
      const pinnedPath = frozenManifest.files.find(
        ({ path }) => path === "run-context.json"
      );
      if (!pinnedPath) throw new Error("run context pin is missing");
      const pinnedFile = join(checkout, pinnedPath.path);
      const externalFile = join(root, "external.json");
      await writeFile(externalFile, "untrusted");
      await rm(pinnedFile);
      await symlink(externalFile, pinnedFile);

      await expect(
        selectedPinnedFiles(checkout, frozenManifest)
      ).rejects.toThrow("source_file_type_invalid");
    });
  });

  test("rejects path traversal even if a caller supplies an unpinned manifest object", async () => {
    await withTemporaryDirectory(async (root) => {
      const checkout = join(root, "checkout");
      await createCheckout(checkout);
      const unsafeManifest = {
        ...frozenManifest,
        files: frozenManifest.files.map((file) =>
          file.path === "run-context.json"
            ? { ...file, path: "../../outside.json" }
            : file
        ),
      } as typeof frozenManifest;

      await expect(
        selectedPinnedFiles(checkout, unsafeManifest)
      ).rejects.toThrow("source_manifest_path_invalid");
    });
  });

  test("requires staged checkout trees to contain only the pinned paths", async () => {
    await withTemporaryDirectory(async (root) => {
      const checkout = join(root, "checkout");
      await createCheckout(checkout);
      await expect(
        assertExactStagingLayout(checkout, frozenManifest)
      ).resolves.toMatchObject({ files: expect.any(Array) });

      await mkdir(join(checkout, "unmatched-stage-output"));
      await writeFile(
        join(checkout, "unmatched-stage-output", "unexpected.bin"),
        "untrusted"
      );
      await expect(
        assertExactStagingLayout(checkout, frozenManifest)
      ).rejects.toThrow("restored_source_root_entries_invalid");
    });
  });

  test("rejects a preserved backup whose pinned bytes changed", async () => {
    await withTemporaryDirectory(async (root) => {
      const checkout = join(root, "checkout");
      await createCheckout(checkout);

      await expect(verifyPinnedSourceBackup(checkout)).rejects.toThrow(
        "source_artifact_hash_pin_mismatch"
      );
    });
  });
});
