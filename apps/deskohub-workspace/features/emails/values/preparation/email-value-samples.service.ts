import type {
  EmailDocument,
  EmailValueDefinition,
  EmailValueName,
  EmailValueSnapshot,
} from "@deskohub/workspace-admin-api";
import { requiredEmailValueNames } from "@deskohub/workspace-admin-api";
import { Clock, Context, Data, Effect, Layer, Match } from "effect";
import type {
  EmailPreparationFailureReason,
  EmailPreparationSkipReason,
} from "@/db/schema/emails";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CustomerValues } from "../customer";
import { sampleEmailDiscountValue } from "../discount";
import {
  customerValueSnapshot,
  type EmailValuesUnavailable,
  referencedDefinitions,
  requirePublishedLanguage,
} from "./email-value-generation";
import {
  syntheticEmailCustomer,
  syntheticEmailCustomerId,
} from "./synthetic-email-customer";

/**
 * Whose data a sample shows. A real customer's data needs a signed-in
 * administrator; everything else uses the synthetic customer.
 */
export type EmailSampleRecipient = Data.TaggedEnum<{
  Synthetic: Record<never, never>;
  Customer: { readonly customerId: DotyposCustomerId };
}>;
export const EmailSampleRecipient = Data.taggedEnum<EmailSampleRecipient>();

/** Values for a preview, test send, or dry run. Nothing is stored or issued. */
export type EmailValueSample = Data.TaggedEnum<{
  Ready: {
    readonly values: ReadonlyMap<EmailValueName, EmailValueSnapshot>;
  };
  Skipped: {
    readonly reason: EmailPreparationSkipReason;
    readonly valueName: EmailValueName | undefined;
  };
  Failed: {
    readonly reason: EmailPreparationFailureReason;
    readonly valueName: EmailValueName | undefined;
  };
  Unavailable: {
    readonly reason: EmailValuesUnavailable["reason"];
    readonly valueName: EmailValueName;
  };
}>;
export const EmailValueSample = Data.taggedEnum<EmailValueSample>();

interface IEmailValueSamples {
  /**
   * Generates what preparation would for this document and language, with
   * non-redeemable sample discount codes, and writes nothing.
   */
  readonly sample: (input: {
    readonly document: EmailDocument;
    readonly locale: string;
    readonly recipient: EmailSampleRecipient;
  }) => Effect.Effect<EmailValueSample>;
}

export class EmailValueSamples extends Context.Service<
  EmailValueSamples,
  IEmailValueSamples
>()("@deskohub-workspace/emails/EmailValueSamples") {
  /** Needs administrator-checked `CustomerValues` for real-customer samples. */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const administratorCustomers = yield* CustomerValues;
      const syntheticCustomers = CustomerValues.Synthetic(
        syntheticEmailCustomer
      );

      const valueSnapshot = (input: {
        readonly definition: EmailValueDefinition;
        readonly locale: string;
        readonly recipient: EmailSampleRecipient;
      }) =>
        Match.value(input.definition.source).pipe(
          Match.discriminatorsExhaustive("kind")({
            customer: (source) =>
              Match.value(input.recipient).pipe(
                Match.tagsExhaustive({
                  Customer: ({ customerId }) =>
                    customerValueSnapshot({
                      customerId,
                      definition: { ...input.definition, source },
                      locale: input.locale,
                    }).pipe(
                      Effect.provideService(
                        CustomerValues,
                        administratorCustomers
                      )
                    ),
                  Synthetic: () =>
                    customerValueSnapshot({
                      customerId: syntheticEmailCustomerId,
                      definition: { ...input.definition, source },
                      locale: input.locale,
                    }).pipe(Effect.provide(syntheticCustomers)),
                })
              ),
            discount: (source) =>
              Clock.currentTimeMillis.pipe(
                Effect.map(
                  (now): EmailValueSnapshot => ({
                    _tag: "Resolved",
                    value: sampleEmailDiscountValue(
                      source,
                      Temporal.Instant.fromEpochMilliseconds(now)
                    ),
                  })
                )
              ),
          })
        );

      return {
        sample: Effect.fn("EmailValueSamples.sample")((input) =>
          requirePublishedLanguage(input).pipe(
            Effect.andThen(() =>
              Effect.forEach(
                referencedDefinitions(
                  input.document,
                  requiredEmailValueNames(input.document)
                ),
                (definition) =>
                  valueSnapshot({ ...input, definition }).pipe(
                    Effect.map((value) => [definition.name, value] as const)
                  )
              )
            ),
            Effect.map((values) =>
              EmailValueSample.Ready({ values: new Map(values) })
            ),
            Effect.catchTag("EmailValuesIncomplete", ({ outcome }) =>
              Effect.succeed(
                Match.value(outcome).pipe(
                  Match.discriminatorsExhaustive("state")({
                    skipped: ({ reason, valueName }) =>
                      EmailValueSample.Skipped({ reason, valueName }),
                    failed: ({ reason, valueName }) =>
                      EmailValueSample.Failed({ reason, valueName }),
                  })
                )
              )
            ),
            Effect.catchTag("EmailValuesUnavailable", ({ reason, valueName }) =>
              Effect.succeed(
                EmailValueSample.Unavailable({ reason, valueName })
              )
            )
          )
        ),
      } satisfies IEmailValueSamples;
    })
  );

  static Live = this.Default.pipe(Layer.provide(CustomerValues.Live));
}
