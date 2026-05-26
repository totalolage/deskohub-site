import { DotyposService, ValidationError } from "@deskohub/dotypos";
import {
  type EmailRecipient,
  StandaloneEmailServiceLayer,
} from "@deskohub/email";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import type { PaymentOrder } from "@/db/schema";
import { WorkspaceCheckoutAccessCodeServiceLive } from "@/features/checkout/backend/access-code.service";
import {
  type WorkspaceCheckoutEmailBookingSummary,
  WorkspaceCheckoutEmailService,
  WorkspaceCheckoutEmailServiceLive,
} from "@/features/checkout/backend/checkout-email.service";
import { createWorkspaceDotyposReservation } from "@/features/checkout/backend/dotypos-reservation.adapter";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
  type PaymentOrderStateError,
} from "@/features/checkout/backend/payment-order.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";

export type WorkspacePaidFulfillmentFailureCode =
  | "dotypos_customer_missing_email"
  | "dotypos_customer_load_failed"
  | "dotypos_reservation_failed"
  | "customer_access_email_failed"
  | "internal_notification_email_failed"
  | "fulfillment_order_load_failed"
  | "fulfillment_claim_failed"
  | "fulfillment_completion_failed";

export class WorkspacePaidFulfillmentError extends Data.TaggedError(
  "WorkspacePaidFulfillmentError"
)<{
  readonly orderId: string;
  readonly failureCode: WorkspacePaidFulfillmentFailureCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface WorkspacePaidFulfillmentService {
  readonly fulfillPaidOrder: (input: {
    readonly orderId: string;
  }) => Effect.Effect<
    void,
    WorkspacePaidFulfillmentError | PaymentOrderStateError
  >;
}

export const WorkspacePaidFulfillmentService =
  Context.GenericTag<WorkspacePaidFulfillmentService>(
    "WorkspacePaidFulfillmentService"
  );

const isFulfillablePaidOrder = (order: PaymentOrder) =>
  order.paymentStatus === "paid" &&
  (order.fulfillmentStatus === "not_started" ||
    order.fulfillmentStatus === "failed");

const isClaimedPaidOrder = (order: PaymentOrder) =>
  order.paymentStatus === "paid" && order.fulfillmentStatus === "processing";

const toBookingSummary = (
  order: PaymentOrder
): WorkspaceCheckoutEmailBookingSummary => ({
  tier: order.checkoutDetails.reservation.tier,
  date: order.checkoutDetails.reservation.date,
  coffee: order.checkoutDetails.reservation.coffee,
  monitorOption: order.checkoutDetails.reservation.monitorOption,
  expectedPrice: order.checkoutDetails.payment.expectedPrice,
});

const getCustomerDisplayName = (customer: {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly companyName?: string | null;
}) =>
  [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") ||
  customer.companyName?.trim() ||
  undefined;

const getCustomerEmailRecipient: (input: {
  readonly orderId: string;
  readonly dotyposCustomerId: string;
}) => Effect.Effect<
  EmailRecipient,
  WorkspacePaidFulfillmentError,
  DotyposService
> = Effect.fn("workspacePaidFulfillment.getCustomerEmailRecipient")(
  function* (input) {
    const dotypos = yield* DotyposService;
    const customer = yield* dotypos.getCustomer(input.dotyposCustomerId).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspacePaidFulfillmentError({
            orderId: input.orderId,
            failureCode: "dotypos_customer_load_failed",
            message: "Dotypos customer could not be loaded for fulfillment.",
            cause,
          })
      )
    );
    const email = customer.email?.trim();

    if (!email) {
      return yield* Effect.fail(
        new WorkspacePaidFulfillmentError({
          orderId: input.orderId,
          failureCode: "dotypos_customer_missing_email",
          message: "Dotypos customer has no email for access-code delivery.",
        })
      );
    }

    return {
      email,
      name: getCustomerDisplayName(customer),
    };
  },
  (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
);

export const WorkspacePaidFulfillmentServiceLive = Layer.effect(
  WorkspacePaidFulfillmentService,
  Effect.gen(function* () {
    const paymentOrders = yield* PaymentOrderRepository;
    const emails = yield* WorkspaceCheckoutEmailService;
    const dotypos = yield* DotyposService;

    const loadOrder: (input: {
      readonly orderId: string;
    }) => Effect.Effect<PaymentOrder | null, WorkspacePaidFulfillmentError> =
      Effect.fn("workspacePaidFulfillment.loadOrder")(
        function* (input) {
          return yield* paymentOrders.findById(input.orderId);
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({ ...input }),
            Effect.mapError(
              (cause) =>
                new WorkspacePaidFulfillmentError({
                  orderId: input.orderId,
                  failureCode: "fulfillment_order_load_failed",
                  message: "Paid order could not be loaded for fulfillment.",
                  cause,
                })
            )
          )
      );

    const reloadClaimedOrder: (input: {
      readonly orderId: string;
    }) => Effect.Effect<PaymentOrder | null, WorkspacePaidFulfillmentError> =
      Effect.fn("workspacePaidFulfillment.reloadClaimedOrder")(
        function* (input) {
          const order = yield* loadOrder(input);

          if (!order || !isClaimedPaidOrder(order)) {
            return null;
          }

          return order;
        }
      );

    const failFulfillment: (input: {
      readonly orderId: string;
      readonly failureCode: WorkspacePaidFulfillmentFailureCode;
      readonly message: string;
      readonly cause?: unknown;
    }) => Effect.Effect<
      never,
      WorkspacePaidFulfillmentError | PaymentOrderStateError
    > = Effect.fn("workspacePaidFulfillment.failFulfillment")(
      function* (input) {
        yield* paymentOrders.markFulfillmentFailed({
          id: input.orderId,
          failureCode: input.failureCode,
          failedAt: new Date(),
        });

        return yield* Effect.fail(new WorkspacePaidFulfillmentError(input));
      },
      (effect, input) =>
        effect.pipe(
          Effect.catchTag("DatabaseError", (cause) =>
            Effect.fail(
              new WorkspacePaidFulfillmentError({
                ...input,
                cause,
              })
            )
          ),
          Effect.annotateLogs(input)
        )
    );

    const ensureReservation: (input: {
      readonly orderId: string;
    }) => Effect.Effect<
      void,
      WorkspacePaidFulfillmentError | PaymentOrderStateError
    > = Effect.fn("workspacePaidFulfillment.ensureReservation")(
      function* (input) {
        const order = yield* reloadClaimedOrder(input);

        if (!order || order.dotyposReservationId) {
          return;
        }

        const reservation = yield* createWorkspaceDotyposReservation({
          paymentOrderId: order.id,
          dotyposCustomerId: order.dotyposCustomerId,
          checkoutDetails: order.checkoutDetails,
          status: "CONFIRMED",
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.catchAll((cause) =>
            failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_failed",
              message: "Dotypos reservation could not be created.",
              cause,
            })
          )
        );

        if (!reservation.id) {
          return yield* failFulfillment({
            orderId: input.orderId,
            failureCode: "dotypos_reservation_failed",
            message: "Dotypos reservation was created without an ID.",
            cause: new ValidationError({
              message: "Dotypos reservation was created without an ID",
            }),
          });
        }

        yield* paymentOrders
          .attachDotyposReservation({
            id: order.id,
            dotyposReservationId: reservation.id,
            reservationCreatedAt: new Date(),
          })
          .pipe(
            Effect.catchTag("PaymentOrderStateError", (cause) =>
              Effect.fail(
                new WorkspacePaidFulfillmentError({
                  orderId: input.orderId,
                  failureCode: "dotypos_reservation_failed",
                  message:
                    "Dotypos reservation marker was not stored because the order is no longer processing.",
                  cause,
                })
              )
            ),
            Effect.catchTag("DatabaseError", (cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "dotypos_reservation_failed",
                message: "Dotypos reservation marker could not be stored.",
                cause,
              })
            )
          );
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    const failMarkerWrite: (input: {
      readonly orderId: string;
      readonly failureCode: WorkspacePaidFulfillmentFailureCode;
      readonly message: string;
    }) => Effect.Effect<never, WorkspacePaidFulfillmentError> = Effect.fn(
      "workspacePaidFulfillment.failMarkerWrite"
    )(function* (input) {
      return yield* Effect.fail(new WorkspacePaidFulfillmentError(input));
    });

    const ensureCustomerAccessEmail: (input: {
      readonly orderId: string;
    }) => Effect.Effect<
      void,
      WorkspacePaidFulfillmentError | PaymentOrderStateError
    > = Effect.fn("workspacePaidFulfillment.ensureCustomerAccessEmail")(
      function* (input) {
        const order = yield* reloadClaimedOrder(input);

        if (!order || order.customerAccessEmailSentAt) {
          return;
        }

        if (!order.dotyposReservationId) {
          return yield* failFulfillment({
            orderId: input.orderId,
            failureCode: "customer_access_email_failed",
            message: "Customer access email requires a Dotypos reservation ID.",
          });
        }

        const customer = yield* getCustomerEmailRecipient({
          orderId: order.id,
          dotyposCustomerId: order.dotyposCustomerId,
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.catchAll((cause) =>
            failFulfillment({
              orderId: input.orderId,
              failureCode: cause.failureCode,
              message: cause.message,
              cause,
            })
          )
        );

        yield* emails
          .sendCustomerAccessEmail({
            orderId: order.id,
            locale: order.checkoutDetails.locale,
            customer,
            booking: toBookingSummary(order),
            dotyposReservationId: order.dotyposReservationId,
          })
          .pipe(
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "customer_access_email_failed",
                message: "Customer access email could not be sent.",
                cause,
              })
            )
          );

        const markerStored = yield* paymentOrders
          .markCustomerAccessEmailSent({ id: order.id, sentAt: new Date() })
          .pipe(
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "customer_access_email_failed",
                message: "Customer access email marker could not be stored.",
                cause,
              })
            )
          );

        if (!markerStored) {
          return yield* failMarkerWrite({
            orderId: input.orderId,
            failureCode: "customer_access_email_failed",
            message:
              "Customer access email marker was not stored because the order is no longer processing.",
          });
        }
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    const ensureInternalNotificationEmail: (input: {
      readonly orderId: string;
    }) => Effect.Effect<
      void,
      WorkspacePaidFulfillmentError | PaymentOrderStateError
    > = Effect.fn("workspacePaidFulfillment.ensureInternalNotificationEmail")(
      function* (input) {
        const order = yield* reloadClaimedOrder(input);

        if (!order || order.internalNotificationSentAt) {
          return;
        }

        if (!order.dotyposReservationId) {
          return yield* failFulfillment({
            orderId: input.orderId,
            failureCode: "internal_notification_email_failed",
            message: "Internal notification requires a Dotypos reservation ID.",
          });
        }

        yield* emails
          .sendInternalPaidReservationEmail({
            orderId: order.id,
            locale: order.checkoutDetails.locale,
            booking: toBookingSummary(order),
            dotyposReservationId: order.dotyposReservationId,
          })
          .pipe(
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "internal_notification_email_failed",
                message: "Internal paid-reservation email could not be sent.",
                cause,
              })
            )
          );

        const markerStored = yield* paymentOrders
          .markInternalNotificationSent({ id: order.id, sentAt: new Date() })
          .pipe(
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "internal_notification_email_failed",
                message: "Internal notification marker could not be stored.",
                cause,
              })
            )
          );

        if (!markerStored) {
          return yield* failMarkerWrite({
            orderId: input.orderId,
            failureCode: "internal_notification_email_failed",
            message:
              "Internal notification marker was not stored because the order is no longer processing.",
          });
        }
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    const completeFulfillment: (input: {
      readonly orderId: string;
    }) => Effect.Effect<
      void,
      WorkspacePaidFulfillmentError | PaymentOrderStateError
    > = Effect.fn("workspacePaidFulfillment.completeFulfillment")(
      function* (input) {
        const order = yield* reloadClaimedOrder(input);

        if (!order) {
          return;
        }

        if (
          !order.dotyposReservationId ||
          !order.customerAccessEmailSentAt ||
          !order.internalNotificationSentAt
        ) {
          return yield* failFulfillment({
            orderId: input.orderId,
            failureCode: "fulfillment_completion_failed",
            message:
              "Fulfillment cannot complete before all durable markers exist.",
          });
        }

        yield* paymentOrders
          .markFulfilled({ id: order.id, fulfilledAt: new Date() })
          .pipe(
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "fulfillment_completion_failed",
                message: "Paid order could not be marked fulfilled.",
                cause,
              })
            )
          );
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    return WorkspacePaidFulfillmentService.of({
      fulfillPaidOrder: Effect.fn("workspacePaidFulfillment.fulfillPaidOrder")(
        function* (input) {
          const order = yield* loadOrder(input);

          if (!order || !isFulfillablePaidOrder(order)) {
            return;
          }

          const claimedOrder = yield* paymentOrders
            .claimPaidFulfillment(order.id)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WorkspacePaidFulfillmentError({
                    orderId: input.orderId,
                    failureCode: "fulfillment_claim_failed",
                    message: "Paid order could not be claimed for fulfillment.",
                    cause,
                  })
              )
            );

          if (!claimedOrder) {
            return;
          }

          yield* ensureReservation(input);
          yield* ensureCustomerAccessEmail(input);
          yield* ensureInternalNotificationEmail(input);
          yield* completeFulfillment(input);
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      ),
    });
  })
);

export const WorkspacePaidFulfillmentServiceLiveWithDependencies =
  WorkspacePaidFulfillmentServiceLive.pipe(
    Layer.provide(PaymentOrderRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(WorkspaceCheckoutEmailServiceLive),
    Layer.provide(WorkspaceCheckoutAccessCodeServiceLive),
    Layer.provide(StandaloneEmailServiceLayer),
    Layer.provide(EmailConfigLayer),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    )
  );
