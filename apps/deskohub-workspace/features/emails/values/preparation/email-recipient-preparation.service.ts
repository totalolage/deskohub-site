import "server-only";

import type {
  EmailValueDefinition,
  EmailValueName,
  EmailValueSnapshot,
  EmailVersionId,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Match, Schema } from "effect";
import {
  type EmailPreparationFailureReason,
  type EmailPreparationRow,
  type EmailPreparationSkipReason,
  type EmailVersionRow,
  emailPreparationOutcomeReasons,
} from "@/db/schema/emails";
import {
  type DatabaseQueryError,
  isDatabaseQueryError,
} from "@/db/sql-constraint";
import type { CampaignSendId } from "@/features/email-campaigns/campaign-identifiers";
import {
  EmailPersistence,
  type EmailPreparationConflict,
  type EmailPreparationOutcome,
  EmailRecipientPersistence,
  EmailVersionInvalid,
} from "@/features/emails/backend";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CustomerValues } from "../customer";
import { EmailDiscountValues } from "../discount";
import {
  customerValueSnapshot,
  EmailValuesIncomplete,
  EmailValuesUnavailable,
  referencedDefinitions,
  requirePublishedLanguage,
  retryTemporary,
} from "./email-value-generation";

/** One logical recipient delivery; the caller selects the email version and language. */
export type RecipientPreparationInput = {
  readonly sendId: CampaignSendId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly emailVersionId: EmailVersionId;
  readonly locale: string;
};

type Prepared = {
  readonly preparation: EmailPreparationRow;
  readonly version: EmailVersionRow;
};

/**
 * A sealed preparation, which every retry of the same delivery replays, or a
 * temporary interruption that leaves it open for a later retry.
 */
export type PreparedRecipient = Data.TaggedEnum<{
  Ready: Prepared & {
    readonly values: ReadonlyMap<EmailValueName, EmailValueSnapshot>;
  };
  Skipped: Prepared & {
    readonly reason: EmailPreparationSkipReason;
    readonly valueName: EmailValueName | undefined;
  };
  Failed: Prepared & {
    readonly reason: EmailPreparationFailureReason;
    readonly valueName: EmailValueName | undefined;
  };
  /** Recorded but not sealed. Delivery may retry later; codes already issued stay with this preparation. */
  Unavailable: Prepared & {
    readonly reason: EmailValuesUnavailable["reason"];
    readonly valueName: EmailValueName;
  };
}>;
export const PreparedRecipient = Data.taggedEnum<PreparedRecipient>();

type PreparationFailure =
  | DatabaseQueryError
  | EmailPreparationConflict
  | EmailVersionInvalid;

interface IEmailRecipientPreparation {
  /**
   * Freezes the recipient's values before anything is rendered or sent. The
   * first call selects the version and language and generates each referenced
   * value in configured order; a later call resumes stored work or replays the
   * sealed result without reading the customer again.
   */
  readonly prepare: (
    input: RecipientPreparationInput
  ) => Effect.Effect<PreparedRecipient, PreparationFailure>;
}

export class EmailRecipientPreparation extends Context.Service<
  EmailRecipientPreparation,
  IEmailRecipientPreparation
>()("@deskohub-workspace/emails/EmailRecipientPreparation") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const emails = yield* EmailPersistence;
      const recipients = yield* EmailRecipientPersistence;
      const discounts = yield* EmailDiscountValues;
      const customers = yield* CustomerValues;

      const frozenVersion = (preparation: EmailPreparationRow) =>
        emails.getVersion(preparation.emailVersionId).pipe(
          Effect.flatMap(Effect.fromNullishOr),
          Effect.catchTag(
            "NoSuchElementError",
            () =>
              new EmailVersionInvalid({
                versionId: preparation.emailVersionId,
              })
          )
        );

      /** The preparation as stored now; selection returns the existing row. */
      const current = ({ preparation, version }: Prepared) =>
        recipients
          .select({
            sendId: preparation.sendId,
            dotyposCustomerId: preparation.dotyposCustomerId,
            emailVersionId: preparation.emailVersionId,
            locale: preparation.locale,
          })
          .pipe(Effect.map((row): Prepared => ({ preparation: row, version })));

      const replay = (prepared: Prepared) =>
        recipients.readSnapshots(prepared.preparation.id).pipe(
          Effect.map((snapshots) =>
            PreparedRecipient.Ready({
              ...prepared,
              values: new Map(
                snapshots.map(({ valueName, value }) => [valueName, value])
              ),
            })
          )
        );

      const recorded = (prepared: Prepared) =>
        Match.value(prepared.preparation).pipe(
          Match.discriminatorsExhaustive("state")({
            selected: () => Effect.die("An open preparation has no outcome"),
            preparing: () => Effect.die("An open preparation has no outcome"),
            ready: () => replay(prepared),
            skipped: () =>
              recordedReason(skipReason, prepared.preparation).pipe(
                Effect.map((reason) =>
                  PreparedRecipient.Skipped({
                    ...prepared,
                    reason,
                    valueName:
                      prepared.preparation.outcomeValueName ?? undefined,
                  })
                )
              ),
            failed: () =>
              recordedReason(failureReason, prepared.preparation).pipe(
                Effect.map((reason) =>
                  PreparedRecipient.Failed({
                    ...prepared,
                    reason,
                    valueName:
                      prepared.preparation.outcomeValueName ?? undefined,
                  })
                )
              ),
          })
        );

      const discountValueSnapshot = (input: {
        readonly preparation: EmailPreparationRow;
        readonly definition: EmailValueDefinition;
      }) => {
        const valueName = input.definition.name;
        const stop = (reason: EmailPreparationFailureReason) =>
          Effect.fail(
            new EmailValuesIncomplete({
              outcome: { state: "failed", reason, valueName },
            })
          );
        return discounts
          .issue({ preparationId: input.preparation.id, valueName })
          .pipe(
            retryTemporary(isDatabaseQueryError),
            Effect.map(
              ({ code, expiresAt }): EmailValueSnapshot => ({
                _tag: "Resolved",
                value: { code, expiresAt },
              })
            ),
            Effect.catchIf(isDatabaseQueryError, () =>
              Effect.fail(
                new EmailValuesUnavailable({
                  reason: "issuance-unavailable",
                  valueName,
                })
              )
            ),
            Effect.catchTags({
              EmailDiscountValueUnavailable: () => stop("discount-unavailable"),
              DiscountCodeSpaceExhausted: () => stop("discount-unavailable"),
              EmailPreparationConflict: () => stop("invalid-value"),
              EmailVersionInvalid: () => stop("invalid-value"),
            })
          );
      };

      const valueSnapshot = (input: {
        readonly preparation: EmailPreparationRow;
        readonly definition: EmailValueDefinition;
      }) =>
        Match.value(input.definition.source).pipe(
          Match.discriminatorsExhaustive("kind")({
            customer: (source) =>
              customerValueSnapshot({
                customerId: input.preparation.dotyposCustomerId,
                definition: { ...input.definition, source },
                locale: input.preparation.locale,
              }).pipe(Effect.provideService(CustomerValues, customers)),
            discount: () => discountValueSnapshot(input),
          })
        );

      /** Generates and stores one value. A concurrent attempt's stored value wins. */
      const storeValue = (input: {
        readonly preparation: EmailPreparationRow;
        readonly definition: EmailValueDefinition;
      }) =>
        valueSnapshot(input).pipe(
          Effect.flatMap((value) =>
            recipients.saveSnapshot({
              preparationId: input.preparation.id,
              valueName: input.definition.name,
              value,
            })
          ),
          Effect.catchTag("EmailPreparationConflict", (conflict) =>
            Match.value(conflict).pipe(
              Match.discriminatorsExhaustive("reason")({
                "snapshot-conflict": () => Effect.void,
                "invalid-snapshot": () =>
                  Effect.fail(
                    new EmailValuesIncomplete({
                      outcome: {
                        state: "failed",
                        reason: "invalid-value",
                        valueName: input.definition.name,
                      },
                    })
                  ),
                "not-found": () => Effect.fail(conflict),
                "issuance-conflict": () => Effect.fail(conflict),
                "delivery-conflict": () => Effect.fail(conflict),
              })
            )
          )
        );

      /**
       * Records an exhausted attempt on the open preparation. Another attempt
       * may have sealed it meanwhile; then its sealed result is reported.
       */
      const interrupted = (
        prepared: Prepared,
        { reason, valueName }: EmailValuesUnavailable
      ) =>
        recipients
          .recordUnavailable(prepared.preparation.id, { reason, valueName })
          .pipe(
            Effect.flatMap((preparation) =>
              Match.value(preparation).pipe(
                Match.discriminatorsExhaustive("state")({
                  selected: () =>
                    Effect.succeed(
                      PreparedRecipient.Unavailable({
                        preparation,
                        version: prepared.version,
                        reason,
                        valueName,
                      })
                    ),
                  preparing: () =>
                    Effect.succeed(
                      PreparedRecipient.Unavailable({
                        preparation,
                        version: prepared.version,
                        reason,
                        valueName,
                      })
                    ),
                  ready: () =>
                    recorded({ preparation, version: prepared.version }),
                  skipped: () =>
                    recorded({ preparation, version: prepared.version }),
                  failed: () =>
                    recorded({ preparation, version: prepared.version }),
                })
              )
            )
          );

      const generate = (
        prepared: Prepared
      ): Effect.Effect<PreparedRecipient, PreparationFailure> =>
        Effect.Do.pipe(
          Effect.tap(() =>
            requirePublishedLanguage({
              document: prepared.version.document,
              locale: prepared.preparation.locale,
            })
          ),
          Effect.bind("stored", () =>
            recipients
              .readSnapshots(prepared.preparation.id)
              .pipe(
                Effect.map(
                  (snapshots) =>
                    new Set(snapshots.map(({ valueName }) => valueName))
                )
              )
          ),
          Effect.tap(({ stored }) =>
            Effect.forEach(
              referencedDefinitions(
                prepared.version.document,
                prepared.preparation.requiredValueNames
              ).filter((definition) => !stored.has(definition.name)),
              (definition) =>
                storeValue({ preparation: prepared.preparation, definition }),
              { discard: true }
            )
          ),
          Effect.as<EmailPreparationOutcome>({ state: "ready" }),
          Effect.catchTag("EmailValuesIncomplete", ({ outcome }) =>
            Effect.succeed(outcome)
          ),
          Effect.flatMap((outcome) =>
            recipients.finish(prepared.preparation.id, outcome)
          ),
          // An open row means another attempt stored the value this one lacked; resume from it.
          Effect.flatMap((sealed) =>
            settle({ preparation: sealed, version: prepared.version })
          ),
          Effect.catchTag("EmailValuesUnavailable", (unavailable) =>
            interrupted(prepared, unavailable)
          )
        );

      /** Generates an open preparation and replays a sealed one. */
      const settle = (
        prepared: Prepared
      ): Effect.Effect<PreparedRecipient, PreparationFailure> =>
        Match.value(prepared.preparation).pipe(
          Match.discriminatorsExhaustive("state")({
            selected: () => generate(prepared),
            preparing: () => generate(prepared),
            ready: () => recorded(prepared),
            skipped: () => recorded(prepared),
            failed: () => recorded(prepared),
          })
        );

      return {
        prepare: Effect.fn("EmailRecipientPreparation.prepare")(function* (
          input: RecipientPreparationInput
        ) {
          const preparation = yield* recipients.select(input);
          const prepared: Prepared = {
            preparation,
            version: yield* frozenVersion(preparation),
          };
          return yield* settle(prepared).pipe(
            // A concurrent attempt may seal first, which rejects this attempt's writes.
            Effect.catchIf(isDatabaseQueryError, (error) =>
              current(prepared).pipe(
                Effect.filterOrFail(
                  ({ preparation: latest }) =>
                    latest.state !== "selected" && latest.state !== "preparing",
                  () => error
                ),
                Effect.flatMap(recorded)
              )
            )
          );
        }),
      } satisfies IEmailRecipientPreparation;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        EmailDiscountValues.Default,
        CustomerValues.DeliveryLive
      ).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            EmailPersistence.Default,
            EmailRecipientPersistence.Default
          )
        )
      )
    )
  );
}

const skipReason = Schema.Literals(emailPreparationOutcomeReasons.skipped);
const failureReason = Schema.Literals(emailPreparationOutcomeReasons.failed);

/** Reads a sealed row's reason; the database check guarantees it matches the state. */
const recordedReason = <S extends Schema.Top>(
  reasons: S,
  preparation: EmailPreparationRow
) =>
  Schema.decodeUnknownEffect(reasons)(preparation.outcomeReason).pipe(
    Effect.orDie
  );
