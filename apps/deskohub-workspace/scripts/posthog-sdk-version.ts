import { join, resolve } from "node:path";
import { Schema } from "effect";
import workspacePackage from "../package.json";

const appRoot = resolve(import.meta.dir, "..");

/**
 * The posthog-js version Workspace pins. The PostHog identity browser check
 * bundles and serves this install and reports it as the verified SDK, so the
 * pin is the single source of truth for that evidence.
 */
export const expectedPosthogSdkVersion: string =
  workspacePackage.dependencies["posthog-js"];

/**
 * Whether the capture came only from the pinned SDK: at least one event, and
 * every event's `$lib_version` equals the pin. An event with no version fails,
 * so a correctly versioned event can never vouch for one that is unversioned.
 */
export const capturedOnlyByPinnedSdk = (libVersions: readonly unknown[]) =>
  libVersions.length > 0 &&
  libVersions.every((version) => version === expectedPosthogSdkVersion);

const decodeInstalledPackage = Schema.decodeUnknownSync(
  Schema.Struct({ version: Schema.String })
);

/** The posthog-js version actually installed for Workspace. */
export const readInstalledPosthogSdkVersion = async () =>
  decodeInstalledPackage(
    await Bun.file(join(appRoot, "node_modules/posthog-js/package.json")).json()
  ).version;
