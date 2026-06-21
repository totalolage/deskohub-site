import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type OperationalEvent, operationalEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";

export const operationalEventMessages = {
  workspaceReservationHoldAttachFailedCancelRetryRequired:
    "Dotypos hold attach failed and cancellation retry is required.",
  workspaceReservationHoldCancelled:
    "Workspace reservation hold was cancelled.",
  paidReservationMissingDotyposHold:
    "Paid reservation has no Dotypos reservation hold.",
  paidReservationNoLongerConfirmable:
    "Paid reservation hold is no longer confirmable; manual recovery is required.",
  dotyposReservationHoldConfirmFailed:
    "Dotypos reservation hold could not be confirmed.",
  paidReservationEmailSendFailed: "Paid reservation email could not be sent.",
  paidReservationMarkFulfilledFailed:
    "Paid reservation could not be marked fulfilled.",
  paymentOutcomeCouldNotBeConfirmed:
    "Payment outcome could not be confirmed before hold cleanup.",
} as const;

export type OperationalEventMessage =
  (typeof operationalEventMessages)[keyof typeof operationalEventMessages];

type OperationalEventMessageKey = keyof typeof operationalEventMessages;

const eventMessageKeys = {
  workspace_reservation_hold_attach_failed:
    "workspaceReservationHoldAttachFailedCancelRetryRequired",
  workspace_reservation_hold_cancelled: "workspaceReservationHoldCancelled",
  workspace_paid_fulfillment_missing_hold: "paidReservationMissingDotyposHold",
  workspace_paid_fulfillment_no_longer_confirmable:
    "paidReservationNoLongerConfirmable",
  workspace_paid_fulfillment_confirm_failed:
    "dotyposReservationHoldConfirmFailed",
  workspace_paid_fulfillment_email_failed: "paidReservationEmailSendFailed",
  workspace_paid_fulfillment_mark_fulfilled_failed:
    "paidReservationMarkFulfilledFailed",
  workspace_payment_outcome_unconfirmed_before_cleanup:
    "paymentOutcomeCouldNotBeConfirmed",
} as const satisfies Record<string, OperationalEventMessageKey>;

const eventTypeSchema = z.enum(
  Object.keys(eventMessageKeys) as [
    keyof typeof eventMessageKeys,
    ...(keyof typeof eventMessageKeys)[],
  ]
);

const operationalEventInputSchema = z
  .object({
    workspaceReservationId: z.string().min(1).optional(),
    paymentAttemptId: z.string().min(1).optional(),
    eventType: eventTypeSchema,
    severity: z.enum(["info", "warning", "error"]),
    failureCode: z.string().min(1).optional(),
    dotyposReservationId: z.string().min(1).optional(),
    dotyposCustomerId: z.string().min(1).optional(),
    webhookEventId: z.string().min(1).optional(),
  })
  .strict()
  .transform((input) => ({
    ...input,
    message: operationalEventMessages[eventMessageKeys[input.eventType]],
  }));

export class OperationalEventInputError extends Data.TaggedError(
  "OperationalEventInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type OperationalEventType = keyof typeof eventMessageKeys;

export interface OperationalEventInput {
  readonly workspaceReservationId?: string;
  readonly paymentAttemptId?: string;
  readonly eventType: OperationalEventType;
  readonly severity: "info" | "warning" | "error";
  readonly failureCode?: string;
  readonly dotyposReservationId?: string;
  readonly dotyposCustomerId?: string;
  readonly webhookEventId?: string;
}

type ParsedOperationalEventInput = z.output<typeof operationalEventInputSchema>;

export interface OperationalEventRepository {
  readonly record: (
    input: OperationalEventInput
  ) => Effect.Effect<
    OperationalEvent,
    DatabaseError | OperationalEventInputError
  >;
}

export const OperationalEventRepository =
  Context.Service<OperationalEventRepository>("OperationalEventRepository");

export const parseOperationalEventInput = (input: OperationalEventInput) =>
  operationalEventInputSchema.parse(input);

const toDbEvent = (event: ParsedOperationalEventInput) => ({
  id: postgresUuidV7,
  workspaceReservationId: event.workspaceReservationId,
  paymentAttemptId: event.paymentAttemptId,
  eventType: event.eventType,
  severity: event.severity,
  message: event.message,
  failureCode: event.failureCode,
  dotyposReservationId: event.dotyposReservationId,
  dotyposCustomerId: event.dotyposCustomerId,
  webhookEventId: event.webhookEventId,
});

export const OperationalEventRepositoryLive = Layer.effect(
  OperationalEventRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return OperationalEventRepository.of({
      record: Effect.fn("operationalEvents.record")(
        function* (input) {
          const event = yield* Effect.try({
            try: () => parseOperationalEventInput(input),
            catch: (cause) =>
              new OperationalEventInputError({
                message: "Operational event input is invalid.",
                cause,
              }),
          });

          const [inserted] = yield* runDb("operationalEvents.record", () =>
            db.insert(operationalEvents).values(toDbEvent(event)).returning()
          );

          if (!inserted) {
            return yield* Effect.fail(
              new OperationalEventInputError({
                message: "Operational event insert returned no row.",
              })
            );
          }

          return inserted;
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      ),
    });
  })
);
