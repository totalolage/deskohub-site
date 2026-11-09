import type { AnalyticsConsentStatus } from "../consent/analytics-consent";
import type { NativeUpdateOffer } from "./native-release";
import type { ReadyUpdate } from "./ota-update";

/**
 * The one update banner the app shows at a time. A new native version wins
 * over a downloaded JS update or a rollback: the APK carries the current JS
 * too, and a restart can't fix a runtime the server no longer publishes for.
 * A rollback restarts into the build's embedded update, the same way a
 * downloaded update is applied.
 */
export type UpdatePrompt =
  | ({ readonly kind: "native-release" } & NativeUpdateOffer)
  | { readonly kind: "ota-update"; readonly updateId: string }
  | { readonly kind: "roll-back" };

/** What the visitor dismissed this session, keyed per offered update. */
export type UpdatePromptDismissals = {
  readonly versionCodes: ReadonlySet<number>;
  readonly updateIds: ReadonlySet<string>;
  readonly rollBack: boolean;
};

export const noUpdatePromptDismissals: UpdatePromptDismissals = {
  versionCodes: new Set(),
  updateIds: new Set(),
  rollBack: false,
};

/**
 * Picks the prompt from the newest native offer and the update a restart
 * would launch. `runsEmbeddedUpdate` is `Updates.isEmbeddedLaunch`: an app
 * already on its embedded update gains nothing from restarting after a
 * rollback, which its next start applies anyway.
 */
export const selectUpdatePrompt = ({
  nativeUpdate,
  readyUpdate,
  runsEmbeddedUpdate,
  dismissals,
}: {
  readonly nativeUpdate: NativeUpdateOffer | undefined;
  readonly readyUpdate: ReadyUpdate | undefined;
  readonly runsEmbeddedUpdate: boolean;
  readonly dismissals: UpdatePromptDismissals;
}): UpdatePrompt | undefined => {
  if (
    nativeUpdate !== undefined &&
    !dismissals.versionCodes.has(nativeUpdate.versionCode)
  ) {
    return { kind: "native-release", ...nativeUpdate };
  }
  if (readyUpdate === undefined) {
    return undefined;
  }
  if (readyUpdate.kind === "embedded") {
    return runsEmbeddedUpdate || dismissals.rollBack
      ? undefined
      : { kind: "roll-back" };
  }
  return dismissals.updateIds.has(readyUpdate.updateId)
    ? undefined
    : { kind: "ota-update", updateId: readyUpdate.updateId };
};

export const dismissUpdatePrompt = (
  dismissals: UpdatePromptDismissals,
  prompt: UpdatePrompt
): UpdatePromptDismissals => {
  switch (prompt.kind) {
    case "native-release":
      return {
        ...dismissals,
        versionCodes: new Set(dismissals.versionCodes).add(prompt.versionCode),
      };
    case "ota-update":
      return {
        ...dismissals,
        updateIds: new Set(dismissals.updateIds).add(prompt.updateId),
      };
    case "roll-back":
      return { ...dismissals, rollBack: true };
  }
};

/**
 * Whether the update banner holds back for the analytics consent prompt,
 * which takes the same spot at the bottom of the screen until it has an
 * answer. The offer stays pending and shows once consent is settled.
 */
export const updatePromptWaitsForConsent = (
  consentStatus: AnalyticsConsentStatus
): boolean => consentStatus === "loading" || consentStatus === "undecided";
