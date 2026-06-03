"use server";

import { createHmac } from "node:crypto";
import {
  DotyposService,
  ValidationError as DotyposValidationError,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { z } from "zod/v4";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import {
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeServiceLive,
} from "@/features/checkout/backend/access-code.service";
import { buildCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import { splitCustomerName } from "@/features/checkout/backend/dotypos-customer-policy";
import { createWorkspaceDotyposReservation } from "@/features/checkout/backend/dotypos-reservation.adapter";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "@/features/checkout/backend/legal-evidence-event.repository";
import {
  OperationalEventRepository,
  OperationalEventRepositoryLive,
} from "@/features/checkout/backend/operational-event.repository";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/pay-state";
import {
  buildSignedPayState,
  sealPayStateForUrl,
} from "@/features/checkout/backend/pay-state.server";
import { ProviderPaymentFinalizationServiceLiveWithDependencies } from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLive,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { buildAuthoritativeWorkspaceCheckoutQuoteEffect } from "@/features/checkout/backend/workspace-checkout-quote.server";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/checkout/backend/workspace-reservation.repository";
import {
  WorkspaceTableAssignmentService,
  WorkspaceTableAssignmentServiceLive,
} from "@/features/checkout/backend/workspace-table-assignment.service";
import type { WorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import {
  legalEvidenceMapSchema,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import { checkoutSummarySchema } from "@/features/checkout/schemas/checkout-summary";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { type Locale, locales, m } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
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
  const payload = {
    schema: "workspace-reservation-submit-key",
    schemaVersion: 1,
    name: normalizeIdempotencyPart(input.name),
    email: normalizeIdempotencyPart(input.email),
    phone: input.phone.replaceAll(/\s+/g, ""),
    date: input.date,
    entryTier: input.entryTier,
    coffee: input.coffee,
    monitorOption: input.monitorOption ?? null,
  };

  return createHmac("sha256", env.CHECKOUT_PAY_STATE_KEYS)
    .update(JSON.stringify(payload))
    .digest("hex");
};

const DotyposEntityWithIdSchema = Schema.Struct({
  id: Schema.NonEmptyString,
});

const decodeDotyposEntityId = Effect.fn(
  "prepareWorkspacePayState.decodeDotyposEntityId"
)(function* (input: {
  readonly value: unknown;
  readonly missingIdMessage: string;
}) {
  const entity = yield* Schema.decodeUnknown(DotyposEntityWithIdSchema)(
    input.value
  ).pipe(
    Effect.mapError(
      () =>
        new DotyposValidationError({
          message: input.missingIdMessage,
        })
    )
  );

  return entity.id;
});

const getDotyposCustomerId = Effect.fn(
  "prepareWorkspacePayState.getDotyposCustomerId"
)((customer: { readonly id?: string | null }) =>
  decodeDotyposEntityId({
    value: customer,
    missingIdMessage: "Dotypos customer was created without an ID",
  })
);

const buildReservationCheckoutDetails = (input: {
  readonly locale: Locale;
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
      summary: checkoutSummarySchema.parse(input.quote.summary),
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
  readonly locale: Locale;
  readonly accepted: boolean;
  readonly acceptedAt: string;
}) {
  const documents = yield* Effect.tryPromise({
    try: () => getLegalAcceptanceSnapshot(input.locale),
    catch: (cause) =>
      new Error("Legal acceptance snapshot could not be created.", { cause }),
  });
  return legalEvidenceMapSchema.parse({
    [documents.privacyPolicy.hash]: {
      documentKey: "privacyPolicy",
      documentHash: documents.privacyPolicy.hash,
      accepted: input.accepted,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: reservationSubmitLegalEvidenceSource,
      document: {
        path: documents.privacyPolicy.path,
        hash: documents.privacyPolicy.hash,
        hashAlgorithm: documents.privacyPolicy.hashAlgorithm,
      },
    },
  });
});

const toReadyResult = (input: {
  readonly locale: Locale;
  readonly reservation: z.infer<ReturnType<typeof getReservationOrderSchema>>;
  readonly quote: WorkspaceCheckoutQuote;
  readonly reservationId: string;
}) => {
  const state = buildSignedPayState({
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
    orderId: input.reservationId,
  });
  const sealedState = sealPayStateForUrl(state);
  return {
    status: "ready" as const,
    redirectUrl: buildCheckoutPayPath(input.locale, sealedState),
  };
};

const EarlyReservationDotyposLive = DotyposService.Default.pipe(
  Layer.provide(DotyposRuntimeConfigLive)
);

const EarlyReservationWorkspaceReservationRepositoryLive =
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationLegalEvidenceEventRepositoryLive =
  LegalEvidenceEventRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationOperationalEventRepositoryLive =
  OperationalEventRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive));

const EarlyReservationHoldCleanupLive = ReservationHoldCleanupServiceLive.pipe(
  Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
  Layer.provide(EarlyReservationWorkspaceReservationRepositoryLive),
  Layer.provide(EarlyReservationOperationalEventRepositoryLive),
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
  EarlyReservationWorkspaceReservationRepositoryLive,
  EarlyReservationLegalEvidenceEventRepositoryLive,
  EarlyReservationOperationalEventRepositoryLive,
  EarlyReservationHoldCleanupLive,
  EarlyReservationAvailabilityLive,
  EarlyReservationTableAssignmentLive,
  WorkspaceCheckoutAccessCodeServiceLive,
  EarlyReservationDotyposLive
);

export const prepareWorkspacePayStateEffect = Effect.fn(
  "prepareWorkspacePayState"
)(
  function* (input) {
    yield* Effect.annotateLogsScoped({ locale: input.locale });

    const reservationSubmitKey = deriveReservationSubmitKey(input.reservation);
    const acceptedAt = new Date().toISOString();
    const privacyEvidence = yield* getReservationPrivacyEvidence({
      locale: input.locale,
      accepted: input.legalConsent === true,
      acceptedAt,
    });
    const legalEvents = yield* LegalEvidenceEventRepository;

    if (input.legalConsent !== true) {
      yield* legalEvents
        .recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            evidence,
          }))
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Reservation legal evidence recording failed", {
              cause,
            })
          ),
          Effect.ignore
        );

      return {
        status: "error" as const,
        message: m.reservationValidationLegalConsentRequired(),
      };
    }

    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;
    let existingReservation =
      yield* reservations.findBySubmitKey(reservationSubmitKey);

    if (
      existingReservation?.reservationState === "held" &&
      existingReservation.reservationHoldExpiresAt &&
      existingReservation.reservationHoldExpiresAt <= new Date()
    ) {
      const existingReservationId = existingReservation.id;
      const holdCleanup = yield* ReservationHoldCleanupService;
      yield* holdCleanup
        .cancelOrderHold({
          orderId: existingReservationId,
          holdExpiredAt: new Date(),
        })
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning(
              "Expired existing reservation hold cleanup failed",
              {
                orderId: existingReservationId,
                cause,
              }
            )
          ),
          Effect.ignore
        );
      existingReservation = yield* reservations.findById(existingReservationId);
    }

    const quote = yield* buildAuthoritativeWorkspaceCheckoutQuoteEffect(
      input.reservation
    ).pipe(Effect.provideService(DotyposService, dotypos));

    if (
      existingReservation?.reservationState === "held" &&
      existingReservation.dotyposReservationId &&
      (!existingReservation.reservationHoldExpiresAt ||
        existingReservation.reservationHoldExpiresAt > new Date())
    ) {
      yield* reservations.updateProductIntent({
        id: existingReservation.id,
        productTier: input.reservation.entryTier,
        productCoffee: input.reservation.coffee,
        productMonitorOption: input.reservation.monitorOption,
        locale: input.locale,
      });
      yield* legalEvents.recordMany(
        Object.values(privacyEvidence).map((evidence) => ({
          workspaceReservationId: existingReservation.id,
          evidence,
        }))
      );

      return toReadyResult({
        locale: input.locale,
        reservation: input.reservation,
        quote,
        reservationId: existingReservation.id,
      });
    }

    const availability = yield* WorkspaceAvailabilityService;
    yield* availability.ensureAvailable({
      date: input.reservation.date,
      entryTier: input.reservation.entryTier,
      monitorOption: input.reservation.monitorOption,
    });

    const customerName = splitCustomerName(input.reservation.name);
    const customer = yield* dotypos.findOrCreateCustomer({
      ...customerName,
      email: input.reservation.email,
      phone: input.reservation.phone,
    });
    const dotyposCustomerId = yield* getDotyposCustomerId(customer);
    const holdExpiresAt = getReservationHoldExpiresAt(new Date());
    const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
    const customerAccessCode = yield* accessCodes.generateCustomerAccessCode();

    const draft = yield* reservations.createDraft({
      reservationSubmitKey,
      dotyposCustomerId,
      customerAccessCode,
      productTier: input.reservation.entryTier,
      productCoffee: input.reservation.coffee,
      productMonitorOption: input.reservation.monitorOption,
      locale: input.locale,
      reservationHoldExpiresAt: holdExpiresAt,
    });

    const claimed = yield* reservations.claimHoldCreation(draft.id);
    if (!claimed) {
      return {
        status: "error" as const,
        message: m.reservationErrorMessage({}, { locale: input.locale }),
      };
    }

    const checkoutDetails = buildReservationCheckoutDetails({
      locale: input.locale,
      reservation: input.reservation,
      quote,
      legalEvidence: privacyEvidence,
    });
    const dotyposReservation = yield* createWorkspaceDotyposReservation({
      paymentOrderId: draft.id,
      dotyposCustomerId,
      checkoutDetails: checkoutDetails as CheckoutDetailsJson,
      status: "NEW",
    })
      .pipe(
        Effect.provideService(DotyposService, dotypos),
        Effect.provideService(
          WorkspaceTableAssignmentService,
          yield* WorkspaceTableAssignmentService
        )
      )
      .pipe(
        Effect.tapError(() =>
          reservations.releaseHoldCreation(draft.id).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Reservation hold creation release failed", {
                orderId: draft.id,
                cause,
              })
            ),
            Effect.ignore
          )
        )
      );

    const dotyposReservationId = yield* decodeDotyposEntityId({
      value: dotyposReservation,
      missingIdMessage: "Dotypos reservation was created without an ID",
    }).pipe(
      Effect.tapError(() =>
        reservations.releaseHoldCreation(draft.id).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Reservation hold creation release failed", {
              orderId: draft.id,
              cause,
            })
          ),
          Effect.ignore
        )
      )
    );

    yield* reservations
      .attachHold({
        id: draft.id,
        dotyposReservationId,
        reservationCreatedAt: new Date(),
        reservationHoldExpiresAt: holdExpiresAt,
      })
      .pipe(
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            const operationalEvents = yield* OperationalEventRepository;
            yield* operationalEvents
              .record({
                workspaceReservationId: draft.id,
                eventType: "workspace_reservation_hold_attach_failed",
                severity: "error",
                failureCode: "attach_failed_cancel_required",
                dotyposReservationId,
                dotyposCustomerId,
              })
              .pipe(
                Effect.tapError((recordCause) =>
                  Effect.logWarning(
                    "Reservation hold attach failure event recording failed",
                    {
                      orderId: draft.id,
                      cause: recordCause,
                    }
                  )
                ),
                Effect.ignore
              );

            yield* dotypos.cancelReservation(dotyposReservationId).pipe(
              Effect.catchAll((cancelCause) =>
                Effect.gen(function* () {
                  yield* reservations.markAttachFailedCancellationRequired({
                    id: draft.id,
                    dotyposReservationId,
                    reservationCreatedAt: new Date(),
                    failureCode: "attach_failed_cancel_failed",
                  });
                  return yield* Effect.fail(cancelCause);
                })
              )
            );
            yield* reservations.releaseHoldCreation(draft.id).pipe(
              Effect.tapError((releaseCause) =>
                Effect.logWarning("Reservation hold creation release failed", {
                  orderId: draft.id,
                  cause: releaseCause,
                })
              ),
              Effect.ignore
            );

            return yield* Effect.fail(cause);
          })
        )
      );

    yield* legalEvents.recordMany(
      Object.values(privacyEvidence).map((evidence) => ({
        workspaceReservationId: draft.id,
        evidence,
      }))
    );

    return toReadyResult({
      locale: input.locale,
      reservation: input.reservation,
      quote,
      reservationId: draft.id,
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        locale: input.locale,
        reservationDate: input.reservation.date,
        entryTier: input.reservation.entryTier,
        coffee: input.reservation.coffee,
        monitorOption: input.reservation.monitorOption ?? null,
        legalConsent: input.legalConsent === true,
      }),
      Effect.mapError(
        (error) =>
          new PublicSafeActionError({
            message: m.reservationErrorMessage({}, { locale: input.locale }),
            cause: error,
          })
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
