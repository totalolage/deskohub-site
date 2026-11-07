import type { NativeUpdateOffer } from "./native-release";

/**
 * The one update banner the app shows at a time. A new native version wins
 * over a downloaded JS update: the APK carries that update too, and a restart
 * can't fix a runtime the server no longer publishes for.
 */
export type UpdatePrompt =
  | ({ readonly kind: "native-release" } & NativeUpdateOffer)
  | { readonly kind: "ota-update"; readonly updateId: string };

/** What the visitor dismissed this session, keyed per offered update. */
export type UpdatePromptDismissals = {
  readonly versionCodes: ReadonlySet<number>;
  readonly updateIds: ReadonlySet<string>;
};

export const noUpdatePromptDismissals: UpdatePromptDismissals = {
  versionCodes: new Set(),
  updateIds: new Set(),
};

export const selectUpdatePrompt = ({
  nativeUpdate,
  readyUpdateId,
  dismissals,
}: {
  readonly nativeUpdate: NativeUpdateOffer | undefined;
  readonly readyUpdateId: string | undefined;
  readonly dismissals: UpdatePromptDismissals;
}): UpdatePrompt | undefined => {
  if (
    nativeUpdate !== undefined &&
    !dismissals.versionCodes.has(nativeUpdate.versionCode)
  ) {
    return { kind: "native-release", ...nativeUpdate };
  }
  if (readyUpdateId !== undefined && !dismissals.updateIds.has(readyUpdateId)) {
    return { kind: "ota-update", updateId: readyUpdateId };
  }
  return undefined;
};

export const dismissUpdatePrompt = (
  dismissals: UpdatePromptDismissals,
  prompt: UpdatePrompt
): UpdatePromptDismissals =>
  prompt.kind === "native-release"
    ? {
        ...dismissals,
        versionCodes: new Set(dismissals.versionCodes).add(prompt.versionCode),
      }
    : {
        ...dismissals,
        updateIds: new Set(dismissals.updateIds).add(prompt.updateId),
      };
