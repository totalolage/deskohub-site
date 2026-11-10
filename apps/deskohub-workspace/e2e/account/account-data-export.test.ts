import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  accountDataExportManifestPath,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "@/features/account/account-data-export-sections";
import {
  type AccountDataExportDelivery,
  findAccountDataExportDeliveryProblem,
  findSignedOutAccountDataExportProblem,
  readAccountDataExportArchiveShape,
} from "./account-data-export";

const sectionPaths = accountDataExportSections.map(({ path }) => path);

const archive = (entries: Readonly<Record<string, string>>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, text]) => [name, strToU8(text)])
    )
  );

const completeEntries = (
  manifest: unknown = { schemaVersion: accountDataExportSchemaVersion }
): Record<string, string> => ({
  ...Object.fromEntries(sectionPaths.map((path) => [path, "[]"])),
  [accountDataExportManifestPath]: JSON.stringify(manifest),
});

const filename = "deskohub-account-data-2026-11-09.zip";

const delivered = (
  overrides: Partial<AccountDataExportDelivery> = {}
): AccountDataExportDelivery => ({
  controlState: "delivered",
  download: {
    archive: readAccountDataExportArchiveShape(archive(completeEntries())),
    filename,
  },
  headers: {
    cacheControl: "private, no-store",
    contentDisposition: `attachment; filename="${filename}"`,
    contentType: "application/zip",
    referrerPolicy: "no-referrer",
  },
  status: 200,
  ...overrides,
});

/** A delivery whose download holds an archive of `entries`. */
const downloaded = (
  entries: Readonly<Record<string, string>>
): AccountDataExportDelivery =>
  delivered({
    download: {
      archive: readAccountDataExportArchiveShape(archive(entries)),
      filename,
    },
  });

const withHeaders = (
  headers: Partial<AccountDataExportDelivery["headers"]>
): AccountDataExportDelivery => {
  const base = delivered();
  return delivered({ headers: { ...base.headers, ...headers } });
};

describe("readAccountDataExportArchiveShape", () => {
  test("reads entry names and the manifest schema version", () => {
    expect(
      readAccountDataExportArchiveShape(archive(completeEntries()))
    ).toEqual({
      entryNames: [...sectionPaths, accountDataExportManifestPath],
      kind: "readable",
      schemaVersion: accountDataExportSchemaVersion,
    });
  });

  test("reports no schema version for a missing, malformed, or non-numeric manifest", () => {
    const withoutManifest = Object.fromEntries(
      sectionPaths.map((path) => [path, "[]"])
    );
    for (const entries of [
      withoutManifest,
      { ...withoutManifest, [accountDataExportManifestPath]: "{" },
      completeEntries({
        schemaVersion: String(accountDataExportSchemaVersion),
      }),
      completeEntries(null),
    ]) {
      const shape = readAccountDataExportArchiveShape(archive(entries));
      expect(shape.kind === "readable" && shape.schemaVersion).toBeUndefined();
    }
  });

  test("treats bytes that are not a ZIP as unreadable", () => {
    expect(readAccountDataExportArchiveShape(strToU8("<html>"))).toEqual({
      kind: "unreadable",
    });
  });
});

describe("findAccountDataExportDeliveryProblem", () => {
  test("accepts the contract", () => {
    expect(findAccountDataExportDeliveryProblem(delivered())).toBeNull();
  });

  test.each([
    ["a failed status", delivered({ status: 500 })],
    ["another content type", withHeaders({ contentType: "application/json" })],
    ["an inline response", withHeaders({ contentDisposition: undefined })],
    [
      "an undated file name",
      withHeaders({
        contentDisposition: 'attachment; filename="account-data.zip"',
      }),
    ],
    ["a cacheable response", withHeaders({ cacheControl: "no-store" })],
    ["a kept referrer", withHeaders({ referrerPolicy: undefined })],
    [
      "an unreadable download",
      delivered({ download: { archive: { kind: "unreadable" }, filename } }),
    ],
    [
      "a missing section",
      downloaded(
        Object.fromEntries(Object.entries(completeEntries()).slice(1))
      ),
    ],
    [
      "an entry outside the sections",
      downloaded({ ...completeEntries(), "sessions.json": "[]" }),
    ],
    [
      "another schema version",
      downloaded(
        completeEntries({ schemaVersion: accountDataExportSchemaVersion + 1 })
      ),
    ],
    ["no browser download", delivered({ download: undefined })],
    [
      "a download under another name",
      delivered({
        download: {
          archive: readAccountDataExportArchiveShape(
            archive(completeEntries())
          ),
          filename: "export.zip",
        },
      }),
    ],
    ["an error state", delivered({ controlState: "error" })],
    ["a vanished control", delivered({ controlState: undefined })],
  ])("rejects %s", (_name, delivery) => {
    expect(findAccountDataExportDeliveryProblem(delivery)).toBeString();
  });

  test("names missing sections but only counts unexpected entries", () => {
    const [first] = sectionPaths;
    const missing = downloaded(
      Object.fromEntries(
        Object.entries(completeEntries()).filter(([name]) => name !== first)
      )
    );
    expect(findAccountDataExportDeliveryProblem(missing)).toContain(
      String(first)
    );
    const extra = downloaded({
      ...completeEntries(),
      "synthetic-secret-name.json": "[]",
    });
    expect(findAccountDataExportDeliveryProblem(extra)).not.toContain(
      "synthetic-secret-name"
    );
  });

  test("never echoes a control state outside the rendered set", () => {
    expect(
      findAccountDataExportDeliveryProblem(
        delivered({ controlState: "synthetic-page-text" })
      )
    ).not.toContain("synthetic-page-text");
  });
});

describe("findSignedOutAccountDataExportProblem", () => {
  const refusal = {
    bodyLength: 0,
    cacheControl: "private, no-store",
    status: 404,
  };

  test("accepts an empty private 404", () => {
    expect(findSignedOutAccountDataExportProblem(refusal)).toBeNull();
  });

  test.each([
    ["a served export", { ...refusal, status: 200 }],
    ["a redirect", { ...refusal, status: 307 }],
    ["a cacheable refusal", { ...refusal, cacheControl: undefined }],
    ["a refusal with a body", { ...refusal, bodyLength: 9 }],
  ])("rejects %s", (_name, observed) => {
    expect(findSignedOutAccountDataExportProblem(observed)).toBeString();
  });
});
