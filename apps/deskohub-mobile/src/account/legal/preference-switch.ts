import { type Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

/** What a switch over a saved account preference shows. */
export interface PreferenceSwitchState {
  /** Whether the switch shows the preference as on. */
  readonly granted: boolean;
  /** Whether the switch takes input. */
  readonly enabled: boolean;
}

/**
 * What a switch over a saved preference shows: the saved state, or the
 * customer's choice while it is being saved and, after a save, until a read
 * of the saved state succeeds, so the switch neither flips back in between
 * nor falls back to the old state when that read fails. It takes input only
 * while it shows a current read.
 */
export const preferenceSwitchState = <P>({
  preference,
  save,
  requested,
  isGranted,
}: {
  readonly preference: AsyncResult.AsyncResult<P, unknown>;
  readonly save: AsyncResult.AsyncResult<unknown, unknown>;
  /** The value the customer last chose, if any. */
  readonly requested: boolean | undefined;
  readonly isGranted: (current: P) => boolean;
}): PreferenceSwitchState => {
  const saved = Option.exists(AsyncResult.value(preference), isGranted);
  const saving = save.waiting;
  const current = AsyncResult.isSuccess(preference) && !preference.waiting;
  const awaitingSavedState = AsyncResult.isSuccess(save) && !current;
  return {
    granted:
      (saving || awaitingSavedState) && requested !== undefined
        ? requested
        : saved,
    enabled: !saving && current,
  };
};

/** What a preference switch tells the customer about the last save. */
export type PreferenceSaveFeedback<Failure> =
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | Failure;

/**
 * The feedback for the last save: saving while it runs, then saved or the
 * failure's own feedback, and nothing before any save.
 */
export const preferenceSaveFeedback = <E, Failure>(
  save: AsyncResult.AsyncResult<unknown, E>,
  failureFeedback: (cause: Cause.Cause<E>) => Failure
): PreferenceSaveFeedback<Failure> | undefined =>
  save.waiting
    ? { kind: "saving" }
    : AsyncResult.match(save, {
        onInitial: () => undefined,
        onSuccess: () => ({ kind: "saved" }) as const,
        onFailure: ({ cause }) => failureFeedback(cause),
      });
