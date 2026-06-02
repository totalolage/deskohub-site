"use server";

import { createHmac, randomUUID } from "node:crypto";
import { DotyposService, ValidationError as DotyposValidationError } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { z } from "zod/v4";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { buildCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  splitCustomerName,
} from "@/features/checkout/backend/dotypos-customer-policy";
import { createWorkspaceDotyposReservation } from "@/features/checkout/backend/dotypos-reservation.adapter";
import {
  LegalEvidenceAuditRepository,
  LegalEvidenceAuditRepositoryLive,
} from "@/features/checkout/backend/legal-evidence-audit.repository";
import {
  buildSignedPayState,
  sealPayStateForUrl,
} from "@/features/checkout/backend/pay-state.server";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/pay-state";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import {
  ReservationRecoveryRepository,
  ReservationRecoveryRepositoryLive,
} from "@/features/checkout/backend/reservation-recovery.repository";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLive,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  getWorkspaceProductByTier,
} from "@/features/checkout/product-catalog";
import {
  legalEvidenceMapSchema,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import {
  buildAuthoritativeWorkspaceCheckoutQuoteEffect,
} from "@/features/checkout/backend/workspace-checkout-quote.server";
import type { WorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  WorkspaceTableAssignmentServiceLive,
} from "@/features/checkout/backend/workspace-table-assignment.service";
import { env } from "@/env";
import { locales, m } from "@/features/i18n";
import {
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLive,
} from "@/features/reservation/backend/workspace-availability.service";
import { getReservationOrderSchema } from "@/features/reservation/schemas/reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const getPreparePayStateSchema = () =>
  z.object({
    locale: z.enum(locales),
    reservation: getReservationOrderSchema(),
    legalConsent: z.boolean().optional(),
  });

const generateOrderId = () =>
  `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
    .toString(36)
    .toUpperCase()}`;

const getReservationHoldExpiresAt = (now: Date) =>
  new Date(now.getTime() + payStateDefaultTtlMilliseconds);

const normalizeIdempotencyPart = (value: string) =>
  value.trim().toLocaleLowerCase("en-US");

const deriveReservationSubmitKey = (input: {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly date: string;
  readonly entryTier: string;
  readonly coffee: boolean;
  readonly monitorOption?: string;
}) => {
  const tuple = [
    normalizeIdempotencyPart(input.name),
    normalizeIdempotencyPart(input.email),
    input.phone.replaceAll(/\s+/g, ""),
    input.date,
    input.entryTier,
    input.coffee ? "coffee" : "no-coffee",
    input.monitorOption ?? "no-monitor",
  ].join("\u001f");

  return createHmac("sha256", env.CHECKOUT_PAY_STATE_KEYS)
    .update(tuple)
    .digest("hex");
};

const getDotyposCustomerId = (customer: { readonly id?: string | null }) =>
  Effect.gen(function* () {
    if (!customer.id) {
      return yield* Effect.fail(
        new DotyposValidationError({
          message: "Dotypos customer was created without an ID",
        })
      );
    }

    return customer.id;
  });

const buildReservationCheckoutDetails = (input: {
  readonly locale: (typeof locales)[number];
  readonly reservation: z.infer<ReturnType<typeof getReservationOrderSchema>>;
  readonly quote: WorkspaceCheckoutQuote;
  readonly legalEvidence: CheckoutDetailsJson["legal"];
}): Omit<CheckoutDetailsJson, "fulfillment"> => {
  const product = getWorkspaceProductByTier(input.reservation.entryTier);
  const baseCheckoutPrice =
    input.quote.payment.undiscountedPrice ?? input.quote.payment.expectedPrice;

  return {
    schema: "workspace-checkout-details",
    schemaVersion: 1,
    locale: input.locale,
    reservation: {
      tier: input.reservation.entryTier,
      date: input.reservation.date,
      coffee: input.reservation.coffee,
      monitorOption: product.requiresMonitorOption
        ? input.reservation.monitorOption
        : undefined,
    },
    payment: {
      expectedPrice: input.quote.payment.expectedPrice,
      quoteFingerprint: input.quote.fingerprint,
      summary: input.quote.summary,
      ...(input.quote.payment.customerDiscount && {
        undiscountedPrice: baseCheckoutPrice,
        customerDiscount: input.quote.payment.customerDiscount,
      }),
    },
    legal: input.legalEvidence,
  };
};

const getReservationPrivacyEvidence = Effect.fn(
  "prepareWorkspacePayState.getReservationPrivacyEvidence"
)(function* (input: {
  readonly locale: (typeof locales)[number];
  readonly accepted: boolean;
  readonly acceptedAt: string;
}) {
  const documents = yield* Effect.tryPromise({
    try: () => getLegalAcceptanceSnapshot(input.locale),
    catch: (cause) =>
      new Error("Legal acceptance snapshot could not be created.", { cause }),
  });
  const privacyPolicy = documents.privacyPolicy;

  return legalEvidenceMapSchema.parse({
    [privacyPolicy.hash]: {
      documentKey: "privacyPolicy",
      documentHash: privacyPolicy.hash,
      accepted: input.accepted,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: reservationSubmitLegalEvidenceSource,
      document: {
        path: privacyPolicy.path,
        hash: privacyPolicy.hash,
        hashAlgorithm: privacyPolicy.hashAlgorithm,
      },
    },
  });
});

const EarlyReservationDotyposLive = DotyposService.Default.pipe(
  Layer.provide(DotyposRuntimeConfigLive)
);

const EarlyReservationPaymentOrderRepositoryLive =
  PaymentOrderRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationLegalEvidenceAuditRepositoryLive =
  LegalEvidenceAuditRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationRecoveryRepositoryLive =
  ReservationRecoveryRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationHoldCleanupLive = ReservationHoldCleanupServiceLive.pipe(
  Layer.provide(EarlyReservationPaymentOrderRepositoryLive),
  Layer.provide(EarlyReservationDotyposLive)
);

const EarlyReservationAvailabilityLive = WorkspaceAvailabilityServiceLive.pipe(
  Layer.provide(EarlyReservationHoldCleanupLive),
  Layer.provide(EarlyReservationDotyposLive)
);

const EarlyReservationTableAssignmentLive =
  WorkspaceTableAssignmentServiceLive.pipe(
    Layer.provide(EarlyReservationDotyposLive)
  );

const EarlyReservationSubmitLive = Layer.mergeAll(
  EarlyReservationPaymentOrderRepositoryLive,
  EarlyReservationLegalEvidenceAuditRepositoryLive,
  EarlyReservationRecoveryRepositoryLive,
  EarlyReservationHoldCleanupLive,
  EarlyReservationAvailabilityLive,
  EarlyReservationTableAssignmentLive,
  EarlyReservationDotyposLive
).pipe(Layer.orDie);

export const prepareWorkspacePayStateEffect = Effect.fn(
  "prepareWorkspacePayState"
)(
      function* (input) {
        yield* Effect.annotateLogsScoped({ locale: input.locale });
        yield* Effect.logInfo("Preparing workspace checkout quote");

        const reservationSubmitKey = deriveReservationSubmitKey(
          input.reservation
        );
        const acceptedAt = new Date().toISOString();
        const privacyEvidence = yield* getReservationPrivacyEvidence({
          locale: input.locale,
          accepted: input.legalConsent === true,
          acceptedAt,
        });

        if (input.legalConsent !== true) {
          const audit = yield* LegalEvidenceAuditRepository;
          for (const evidence of Object.values(privacyEvidence)) {
            yield* audit.recordRejected({
              idempotencyKey: reservationSubmitKey,
              evidence,
            });
          }

          return {
            status: "error" as const,
            message: m.reservationValidationLegalConsentRequired(),
          };
        }

        const paymentOrders = yield* PaymentOrderRepository;
        const dotypos = yield* DotyposService;
        let existingOrder = yield* paymentOrders.findByReservationSubmitKey(
          reservationSubmitKey
        );

        if (
          existingOrder?.dotyposReservationStatus === "NEW" &&
          existingOrder.dotyposReservationId &&
          existingOrder.reservationHoldExpiresAt &&
          existingOrder.reservationHoldExpiresAt <= new Date()
        ) {
          const holdCleanup = yield* ReservationHoldCleanupService;
          yield* holdCleanup
            .cancelOrderHold({
              orderId: existingOrder.id,
              holdExpiredAt: new Date(),
            })
            .pipe(Effect.ignore);
          existingOrder = yield* paymentOrders.findById(existingOrder.id);
        }

        if (
          existingOrder?.dotyposReservationStatus === "NEW" &&
          existingOrder.dotyposReservationId &&
          (!existingOrder.reservationHoldExpiresAt ||
            existingOrder.reservationHoldExpiresAt > new Date())
        ) {
          const quote = yield* buildAuthoritativeWorkspaceCheckoutQuoteEffect(
            input.reservation
          ).pipe(Effect.provideService(DotyposService, dotypos));
          yield* paymentOrders.updateCheckoutDetails({
            id: existingOrder.id,
            checkoutDetails: buildReservationCheckoutDetails({
              locale: input.locale,
              reservation: input.reservation,
              quote,
              legalEvidence: privacyEvidence,
            }),
          });
          const state = buildSignedPayState({
            locale: input.locale,
            reservation: input.reservation,
            quote,
            orderId: existingOrder.id,
          });
          const sealedState = sealPayStateForUrl(state);
          const payUrl = buildCheckoutPayPath(input.locale, sealedState);

          if (payUrl.type !== "payPath") {
            return {
              status: "error" as const,
              message: m.checkoutPayStateTooLarge({}, { locale: input.locale }),
            };
          }

          return { status: "ready" as const, redirectUrl: payUrl.path };
        }

        const quote = yield* buildAuthoritativeWorkspaceCheckoutQuoteEffect(
          input.reservation
        ).pipe(Effect.provideService(DotyposService, dotypos));

        const availability = yield* WorkspaceAvailabilityService;
        yield* availability.ensureAvailable({
          date: input.reservation.date,
          entryTier: input.reservation.entryTier,
          monitorOption: input.reservation.monitorOption,
        });

        const checkoutDetails = buildReservationCheckoutDetails({
          locale: input.locale,
          reservation: input.reservation,
          quote,
          legalEvidence: privacyEvidence,
        });

        const order = yield* Effect.gen(function* () {
          if (existingOrder) {
            if (
              (existingOrder.dotyposReservationStatus === "CANCELLED" ||
                (existingOrder.dotyposReservationStatus === "none" &&
                  !existingOrder.dotyposReservationId)) &&
              existingOrder.paymentStatus === "created" &&
              !existingOrder.securityToken &&
              !existingOrder.lastProviderStatus
            ) {
              return yield* paymentOrders.updateCheckoutDetails({
                id: existingOrder.id,
                checkoutDetails,
              });
            }

            return yield* Effect.fail(
              new Error("Existing reservation submit is not retryable")
            );
          }

          const now = new Date();
          const customerName = splitCustomerName(input.reservation.name);
          const customer = yield* dotypos.findOrCreateCustomer(
            {
              ...customerName,
              email: input.reservation.email,
              phone: input.reservation.phone,
            },
            { lookupFields: ["email"] }
          );
          const dotyposCustomerId = yield* getDotyposCustomerId(customer);

          return yield* paymentOrders.create({
            id: generateOrderId(),
            dotyposCustomerId,
            correlationId: randomUUID(),
            reservationSubmitKey,
            reservationHoldExpiresAt: getReservationHoldExpiresAt(now),
            checkoutDetails,
          });
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed(null)
          )
        );

        if (!order) {
          return { status: "error" as const, message: m.reservationErrorMessage({}, { locale: input.locale }) };
        }

        const claimed = yield* paymentOrders.claimReservationCreation(order.id);
        if (!claimed) {
          return { status: "error" as const, message: m.reservationErrorMessage({}, { locale: input.locale }) };
        }

        const recovery = yield* ReservationRecoveryRepository;
        const reservation = yield* createWorkspaceDotyposReservation({
          paymentOrderId: order.id,
          dotyposCustomerId: order.dotyposCustomerId,
          checkoutDetails: order.checkoutDetails,
          status: "NEW",
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.catchAll((cause) =>
            paymentOrders.releaseReservationCreation(order.id).pipe(
              Effect.ignore,
              Effect.zipRight(Effect.fail(cause))
            )
          )
        );

        const reservationId = reservation.id;

        if (!reservationId) {
          yield* paymentOrders.releaseReservationCreation(order.id).pipe(
            Effect.ignore
          );
          return yield* Effect.fail(
            new DotyposValidationError({
              message: "Dotypos reservation was created without an ID",
            })
          );
        }

        yield* paymentOrders
          .attachNewReservationHold({
            id: order.id,
            dotyposReservationId: reservationId,
            reservationCreatedAt: new Date(),
            reservationHoldExpiresAt: getReservationHoldExpiresAt(new Date()),
          })
          .pipe(
            Effect.catchAll((cause) =>
              dotypos.cancelReservation(reservationId).pipe(
                Effect.matchEffect({
                  onFailure: (cancelCause) =>
                    paymentOrders.markReservationAttachCancellationPending({
                      id: order.id,
                      dotyposReservationId: reservationId,
                      reservationCreatedAt: new Date(),
                      failureCode: "attach_failed_cancel_failed",
                      failureMessage: String(cancelCause),
                    }).pipe(
                      Effect.ignore,
                      Effect.zipRight(recovery.recordAttachFailure({
                      orderId: order.id,
                      reservationSubmitKey,
                      dotyposCustomerId: order.dotyposCustomerId,
                      dotyposReservationId: reservationId,
                      attemptedCancellationResult: "failed",
                      cancellationAttemptedAt: new Date(),
                      failureReason: `attach_failed_cancel_failed:${String(cancelCause)}`,
                    }))
                    ),
                  onSuccess: () =>
                    recovery.recordAttachFailure({
                      orderId: order.id,
                      reservationSubmitKey,
                      dotyposCustomerId: order.dotyposCustomerId,
                      dotyposReservationId: reservationId,
                      attemptedCancellationResult: "cancelled",
                      cancellationAttemptedAt: new Date(),
                      failureReason: "attach_failed",
                    }).pipe(
                      Effect.zipRight(
                        paymentOrders.releaseReservationCreation(order.id).pipe(
                          Effect.ignore
                        )
                      )
                    ),
                }),
                Effect.zipRight(Effect.fail(cause))
              )
            )
          );

        yield* Effect.logInfo("Workspace checkout quote prepared");

        const state = buildSignedPayState({
          locale: input.locale,
          reservation: input.reservation,
          quote,
          orderId: order.id,
        });
      const sealedState = sealPayStateForUrl(state);
      const payUrl = buildCheckoutPayPath(input.locale, sealedState);

      if (payUrl.type !== "payPath") {
        return {
          status: "error" as const,
          message: m.checkoutPayStateTooLarge({}, { locale: input.locale }),
        };
      }

      return {
        status: "ready" as const,
        redirectUrl: payUrl.path,
      };
    },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs(input),
      Effect.mapError(
        (error) =>
          new PublicSafeActionError(
            m.reservationErrorMessage({}, { locale: input.locale }),
            { cause: error }
          )
      )
    )
);

const preparePayStateAction = createEffectSafeAction(
  getPreparePayStateSchema(),
  prepareWorkspacePayStateEffect,
  EarlyReservationSubmitLive
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
