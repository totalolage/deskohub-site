import { strFromU8, unzipSync } from "fflate";
import {
  accountDataExportManifestPath,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "@/features/account/account-data-export-sections";

/**
 * What the lane learns from one account data export: the response the
 * legal-page control received and what the control did with it. It holds the
 * archive's entry names and manifest schema version, never an entry's
 * contents, so nothing the export reads about the synthetic account can reach
 * a failure message, annotation, or log.
 */
export type AccountDataExportDelivery = {
  readonly status: number;
  readonly headers: {
    readonly cacheControl: string | undefined;
    readonly contentDisposition: string | undefined;
    readonly contentType: string | undefined;
    readonly referrerPolicy: string | undefined;
  };
  /** The browser download the control started, if any. */
  readonly download: AccountDataExportDownload | undefined;
  /** The control's `data-state` once it stopped pending. */
  readonly controlState: string | undefined;
};

/**
 * The file the browser saved from the control: its suggested name and the
 * shape of the archive read from the saved file, which is what a customer
 * receives.
 */
export type AccountDataExportDownload = {
  readonly filename: string;
  readonly archive: AccountDataExportArchiveShape;
};

export type AccountDataExportArchiveShape =
  | {
      readonly kind: "readable";
      readonly entryNames: readonly string[];
      /** The manifest's `schemaVersion` when it is a number. */
      readonly schemaVersion: number | undefined;
    }
  | { readonly kind: "unreadable" };

/** What a signed-out request for the export received. */
export type AccountDataExportRefusal = {
  readonly status: number;
  readonly cacheControl: string | undefined;
  readonly bodyLength: number;
};

/** The archive's only permitted entries: every section, then the manifest. */
const expectedEntryNames: readonly string[] = [
  ...accountDataExportSections.map(({ path }) => path),
  accountDataExportManifestPath,
];

const exportFilenamePattern = /^deskohub-account-data-\d{4}-\d{2}-\d{2}\.zip$/;
const attachmentFilenamePattern = /^attachment; filename="([^"]+)"$/;
const privateCacheControl = "private, no-store";

/** The control states the export block renders. */
const controlStates = new Set(["idle", "pending", "delivered", "error"]);

const readSchemaVersion = (manifest: Uint8Array): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(strFromU8(manifest));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { schemaVersion } = parsed as { readonly schemaVersion?: unknown };
    return typeof schemaVersion === "number" ? schemaVersion : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reads the entry names and manifest schema version of an export archive
 * held in memory. Anything that is not a ZIP is unreadable.
 */
export const readAccountDataExportArchiveShape = (
  bytes: Uint8Array
): AccountDataExportArchiveShape => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { kind: "unreadable" };
  }
  const manifest = entries[accountDataExportManifestPath];
  return {
    entryNames: Object.keys(entries),
    kind: "readable",
    schemaVersion: manifest ? readSchemaVersion(manifest) : undefined,
  };
};

/**
 * Why a delivered export breaks its contract, as a code-owned sentence, or
 * `null` when it holds: a private, dated ZIP attachment that the browser
 * downloaded under its attachment name, whose entries are exactly the export
 * sections and the manifest, with a manifest at the current schema version,
 * and that left the control delivered.
 */
export const findAccountDataExportDeliveryProblem = (
  delivery: AccountDataExportDelivery
): string | null => {
  const { download, headers } = delivery;
  if (delivery.status !== 200)
    return `the export responded with status ${delivery.status}`;
  if (headers.contentType !== "application/zip")
    return "the export was not served as application/zip";
  const filename = attachmentFilenamePattern.exec(
    headers.contentDisposition ?? ""
  )?.[1];
  if (!filename || !exportFilenamePattern.test(filename))
    return "the export was not a dated account data ZIP attachment";
  if (headers.cacheControl !== privateCacheControl)
    return "the export response was not private and uncached";
  if (headers.referrerPolicy !== "no-referrer")
    return "the export response did not suppress the referrer";
  if (!download) return "the control started no browser download of the export";
  const { archive } = download;
  if (archive.kind === "unreadable")
    return "the downloaded export was not a readable ZIP archive";
  const missing = expectedEntryNames.filter(
    (name) => !archive.entryNames.includes(name)
  );
  if (missing.length > 0)
    return `the export archive lacks ${missing.join(", ")}`;
  const unexpected = archive.entryNames.filter(
    (name) => !expectedEntryNames.includes(name)
  ).length;
  if (unexpected > 0)
    return `the export archive has ${unexpected} entries outside the export sections`;
  if (archive.schemaVersion !== accountDataExportSchemaVersion)
    return "the export manifest does not carry the current schema version";
  if (download.filename !== filename)
    return "the control did not save the export under its attachment name";
  if (delivery.controlState !== "delivered") {
    const state =
      delivery.controlState !== undefined &&
      controlStates.has(delivery.controlState)
        ? delivery.controlState
        : "unknown";
    return `the export control settled as ${state}, not delivered`;
  }
  return null;
};

/**
 * Why a signed-out export request was not refused privately, or `null`: an
 * empty, private, uncached 404 that does not reveal the export exists.
 */
export const findSignedOutAccountDataExportProblem = (
  refusal: AccountDataExportRefusal
): string | null => {
  if (refusal.status !== 404)
    return `the signed-out export responded with status ${refusal.status}`;
  if (refusal.cacheControl !== privateCacheControl)
    return "the signed-out refusal was not private and uncached";
  if (refusal.bodyLength !== 0) return "the signed-out refusal carried a body";
  return null;
};
