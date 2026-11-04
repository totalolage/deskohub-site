import type {
  EmailCustomerSelection,
  EmailDocument,
  EmailValueDefinition,
  EmailValueName,
  EmailValueSnapshot,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Data,
  Duration,
  Effect,
  Match,
  Predicate,
  Schedule,
} from "effect";
import type { EmailPreparationUnavailableReason } from "@/db/schema/emails";
import type { EmailPreparationOutcome } from "@/features/emails/backend";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CustomerValues } from "../customer";

/** How often preparation retries a temporary customer-source or issuance failure before recording it. */
export const EmailPreparationRetry = Context.Reference<{
  readonly retries: number;
  readonly baseDelay: Duration.Input;
}>("@deskohub-workspace/emails/EmailPreparationRetry", {
  defaultValue: () => ({ retries: 3, baseDelay: Duration.seconds(1) }),
});

/** Generation stopped at a definition; preparation records this outcome instead of values. */
export class EmailValuesIncomplete extends Data.TaggedError(
  "EmailValuesIncomplete"
)<{
  readonly outcome: Exclude<EmailPreparationOutcome, { state: "ready" }>;
}> {}

/**
 * A temporary source or issuance failure outlasted its retries. Preparation
 * records it and stays open, so a later delivery retry resumes from the
 * stored values.
 */
export class EmailValuesUnavailable extends Data.TaggedError(
  "EmailValuesUnavailable"
)<{
  readonly reason: EmailPreparationUnavailableReason;
  readonly valueName: EmailValueName;
}> {}

type CustomerDefinition = EmailValueDefinition & {
  readonly source: EmailCustomerSelection;
};

/** The frozen definitions this document's published languages reference, in configured order. */
export const referencedDefinitions = (
  document: EmailDocument,
  requiredNames: readonly EmailValueName[]
): readonly EmailValueDefinition[] => {
  const required = new Set(requiredNames);
  return document.values.filter((definition) => required.has(definition.name));
};

/** A recipient language the selected version was never published in skips before any value work. */
export const requirePublishedLanguage = (input: {
  readonly document: EmailDocument;
  readonly locale: string;
}) =>
  Effect.succeed(input.document).pipe(
    Effect.filterOrFail(
      (document) => Object.hasOwn(document.translations, input.locale),
      () =>
        new EmailValuesIncomplete({
          outcome: { state: "skipped", reason: "missing-language" },
        })
    ),
    Effect.asVoid
  );

/**
 * A customer value as the email will render it. Temporary source failures
 * retry; missing data takes the language's fallback or skips the recipient;
 * every other failure ends preparation.
 */
export const customerValueSnapshot = Effect.fn(
  "EmailValueGeneration.customerValueSnapshot"
)(function* (input: {
  readonly customerId: DotyposCustomerId;
  readonly definition: CustomerDefinition;
  readonly locale: string;
}) {
  const customers = yield* CustomerValues;
  const valueName = input.definition.name;
  const stop = (outcome: EmailValuesIncomplete["outcome"]) =>
    Effect.fail(new EmailValuesIncomplete({ outcome }));
  return yield* customers.resolve(input).pipe(
    retryTemporary(Predicate.isTagged("CustomerValueUnavailable")),
    Effect.map((value): EmailValueSnapshot => ({ _tag: "Resolved", value })),
    Effect.catchTags({
      CustomerValueMissing: (missing) =>
        Match.value(missing).pipe(
          Match.discriminatorsExhaustive("reason")({
            "field-absent": () =>
              Effect.fromNullishOr(
                input.definition.fallback?.[input.locale]
              ).pipe(
                Effect.map(
                  (text): EmailValueSnapshot => ({ _tag: "Fallback", text })
                ),
                Effect.catch(() =>
                  stop({ state: "skipped", reason: "missing-value", valueName })
                )
              ),
            // A deleted or unknown customer is no recipient; fallbacks cover missing fields only.
            "customer-not-found": () =>
              stop({ state: "skipped", reason: "missing-customer", valueName }),
          })
        ),
      CustomerValueUnavailable: () =>
        Effect.fail(
          new EmailValuesUnavailable({
            reason: "customer-unavailable",
            valueName,
          })
        ),
      CustomerValueRejected: () =>
        stop({ state: "failed", reason: "customer-rejected", valueName }),
      EmailCustomerSelectionInvalid: () =>
        stop({ state: "failed", reason: "customer-rejected", valueName }),
      CustomerValueUnauthorized: () =>
        stop({ state: "failed", reason: "customer-unauthorized", valueName }),
    })
  );
});

/** Retries temporary failures under the configured preparation policy. */
export const retryTemporary =
  <Failure>(isTemporary: (error: Failure) => boolean) =>
  <A, E extends Failure, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(EmailPreparationRetry, ({ retries, baseDelay }) =>
      effect.pipe(
        Effect.retry({
          schedule: Schedule.exponential(baseDelay).pipe(
            Schedule.both(Schedule.recurs(retries))
          ),
          while: isTemporary,
        })
      )
    );
