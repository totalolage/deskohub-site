import "server-only";

import type {
  EmailValueDefinition,
  EmailValueName,
  EmailValueSnapshot,
  EmailVersionId,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Match, Schema } from "effect";
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

/** A sealed preparation, which every retry of the same delivery replays, or a retryable interruption. */
export type PreparedRecipient =
  | (Prepared & {
      readonly _tag: "Ready";
      readonly values: ReadonlyMap<EmailValueName, EmailValueSnapshot>;
    })
  | (Prepared & {
      readonly _tag: "Skipped";
      readonly reason: EmailPreparationSkipReason;
      readonly valueName: EmailValueName | undefined;
    })
  | (Prepared & {
      readonly _tag: "Failed";
      readonly reason: EmailPreparationFailureReason;
      readonly valueName: EmailValueName | undefined;
    })
  | (Prepared & {
      /** Not sealed: a later retry resumes after the temporary failure passes. */
      readonly _tag: "Unavailable";
      readonly reason: EmailValuesUnavailable["reason"];
      readonly valueName: EmailValueName;
    });

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

      const settled = ({ preparation, version }: Prepared) =>
        Match.value(preparation.state).pipe(
          Match.when("ready", () =>
            recipients.readSnapshots(preparation.id).pipe(
              Effect.map(
                (snapshots): PreparedRecipient => ({
                  _tag: "Ready",
                  preparation,
                  version,
                  values: new Map(
                    snapshots.map(({ valueName, value }) => [valueName, value])
                  ),
                })
              )
            )
          ),
          Match.when("skipped", () =>
            recordedReason(skipReason, preparation).pipe(
              Effect.map(
                (reason): PreparedRecipient => ({
                  _tag: "Skipped",
                  preparation,
                  version,
                  reason,
                  valueName: preparation.outcomeValueName ?? undefined,
                })
              )
            )
          ),
          Match.when("failed", () =>
            recordedReason(failureReason, preparation).pipe(
              Effect.map(
                (reason): PreparedRecipient => ({
                  _tag: "Failed",
                  preparation,
                  version,
                  reason,
                  valueName: preparation.outcomeValueName ?? undefined,
                })
              )
            )
          ),
          Match.orElse((state) =>
            Effect.die(`Preparation ${preparation.id} is still ${state}`)
          )
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
      }) => {
        return Match.value(input.definition.source).pipe(
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
      };

      /** Generates and stores one value unless an earlier attempt already stored it. */
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
            Match.value(conflict.reason).pipe(
              // A concurrent attempt stored this value first; its snapshot wins.
              Match.when("snapshot-conflict", () => Effect.void),
              Match.when("invalid-snapshot", () =>
                Effect.fail(
                  new EmailValuesIncomplete({
                    outcome: {
                      state: "failed",
                      reason: "invalid-value",
                      valueName: input.definition.name,
                    },
                  })
                )
              ),
              Match.orElse(() => Effect.fail(conflict))
            )
          )
        );

      const generate = ({ preparation, version }: Prepared) =>
        Effect.Do.pipe(
          Effect.tap(() =>
            requirePublishedLanguage({
              document: version.document,
              locale: preparation.locale,
            })
          ),
          Effect.bind("stored", () =>
            recipients
              .readSnapshots(preparation.id)
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
                version.document,
                preparation.requiredValueNames
              ).filter((definition) => !stored.has(definition.name)),
              (definition) => storeValue({ preparation, definition }),
              { discard: true }
            )
          ),
          Effect.as<EmailPreparationOutcome>({ state: "ready" }),
          Effect.catchTag("EmailValuesIncomplete", ({ outcome }) =>
            Effect.succeed(outcome)
          ),
          Effect.flatMap((outcome) =>
            recipients.finish(preparation.id, outcome)
          ),
          Effect.flatMap((sealed) => settled({ preparation: sealed, version })),
          Effect.catchTag("EmailValuesUnavailable", ({ reason, valueName }) =>
            Effect.succeed<PreparedRecipient>({
              _tag: "Unavailable",
              preparation,
              version,
              reason,
              valueName,
            })
          )
        );

      return {
        prepare: Effect.fn("EmailRecipientPreparation.prepare")(function* (
          input: RecipientPreparationInput
        ) {
          const preparation = yield* recipients.select(input);
          const version = yield* frozenVersion(preparation);
          return yield* Match.value(preparation).pipe(
            Match.when(isOpen, () => generate({ preparation, version })),
            Match.orElse(() => settled({ preparation, version })),
            // A concurrent attempt may seal first, which rejects this attempt's writes.
            Effect.catchIf(isDatabaseQueryError, (error) =>
              recipients.select(input).pipe(
                Effect.filterOrFail(
                  (current) => !isOpen(current),
                  () => error
                ),
                Effect.flatMap((current) =>
                  settled({ preparation: current, version })
                )
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

const isOpen = (preparation: EmailPreparationRow) =>
  preparation.state === "selected" || preparation.state === "preparing";

const skipReason = Schema.Literals(emailPreparationOutcomeReasons.skipped);
const failureReason = Schema.Literals(emailPreparationOutcomeReasons.failed);

/** The database check pairs every sealed skip or failure with one of its reasons. */
const recordedReason = <S extends Schema.Top>(
  reasons: S,
  preparation: EmailPreparationRow
) =>
  Schema.decodeUnknownEffect(reasons)(preparation.outcomeReason).pipe(
    Effect.orDie
  );
