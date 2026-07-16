"use server";

import { createHmac } from "node:crypto";
import {
  DotyposService,
  ValidationError as DotyposValidationError,
} from "@deskohub/dotypos";
import {
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import type { WorkspaceReservation } from "@/db/schema";
import { env } from "@/env";
import { captureReservationStarted } from "@/features/checkout/backend/analytics";
import {
  buildAuthoritativeWorkspaceCheckoutQuote,
  buildCheckoutPayPath,
  buildSignedPayState,
  payStateDefaultTtlMilliseconds,
  sealPayStateForUrl,
} from "@/features/checkout/backend/checkout";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "@/features/checkout/backend/repositories";
import {
  createWorkspaceDotyposReservation,
  splitCustomerName,
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeServiceLive,
  WorkspaceTableAssignmentServiceLive,
} from "@/features/checkout/backend/reservation";
import type { WorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  getCheckoutReservationDetails,
  legalEvidenceMapSchema,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import {
  type CanonicalDiscountCode,
  normalizeSubmittedDiscountCode,
} from "@/features/discounts";
import { DiscountServiceLiveWithDependencies } from "@/features/discounts/discount.runtime";
import { type Locale, locales, m } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type NormalizedCoworkReservationOrder,
  normalizedCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const preparePayStateSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    locale: Schema.Literals(locales),
    reservationIntentId: Schema.NonEmptyString,
    reservation: normalizedCoworkReservationOrderSchema,
    submittedCode: Schema.optional(Schema.String),
    legalConsent: Schema.optional(Schema.Boolean),
  }),
  { parseOptions: { onExcessProperty: "error" } }
);

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  {
    onExcessProperty: "error",
  }
);

const getReservationHoldExpiresAt = (now: Date) =>
  new Date(now.getTime() + payStateDefaultTtlMilliseconds);

const normalizeIdempotencyPart = (value: string) =>
  value.trim().toLocaleLowerCase("en-US");

const deriveReservationIntentKey = (input: {
  readonly reservationIntentId: string;
  readonly reservation: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly date: string;
    readonly entryTier: string;
    readonly coffee: boolean;
    readonly monitorOption?: string;
  };
}) => {
  const payload = {
    schema: "workspace-reservation-intent-key",
    schemaVersion: 2,
    reservationIntentId: input.reservationIntentId,
    name: normalizeIdempotencyPart(input.reservation.name),
    email: normalizeIdempotencyPart(input.reservation.email),
    phone: input.reservation.phone.replaceAll(/\s+/g, ""),
    date: input.reservation.date,
    entryTier: input.reservation.entryTier,
    coffee: input.reservation.coffee,
    monitorOption: input.reservation.monitorOption ?? null,
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
  const entity = yield* Schema.decodeUnknownEffect(DotyposEntityWithIdSchema)(
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
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: WorkspaceCheckoutQuote;
  readonly legalEvidence: CheckoutDetailsJson["legal"];
}): CheckoutDetailsJson => {
  return {
    schema: "workspace-checkout-details",
    schemaVersion: 1,
    locale: input.locale,
    reservation: getCheckoutReservationDetails(input.reservation),
    payment: {
      expectedPrice: input.quote.payment.expectedPrice,
      undiscountedPrice: input.quote.payment.undiscountedPrice,
      discounts: [...input.quote.payment.discounts],
      summary: input.quote.summary,
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
  const documents = yield* getLegalAcceptanceSnapshot(input.locale);
  return decodeLegalEvidenceMap({
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
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: WorkspaceCheckoutQuote;
  readonly reservationId: string;
  readonly submittedCode: CanonicalDiscountCode | undefined;
}) => {
  const state = buildSignedPayState({
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
    orderId: input.reservationId,
    submittedCode: input.submittedCode,
  });
  const sealedState = sealPayStateForUrl(state);
  const redirectUrl = new URL(
    buildCheckoutPayPath(input.locale, sealedState),
    "https://deskohub.local"
  );
  redirectUrl.searchParams.set("orderId", input.reservationId);
  return {
    status: "ready" as const,
    redirectUrl: `${redirectUrl.pathname}${redirectUrl.search}`,
  };
};

const isReusableHeldReservation = (reservation: WorkspaceReservation) =>
  reservation.reservationState === "held" &&
  reservation.paymentState === "not_started" &&
  Boolean(reservation.dotyposReservationId) &&
  (!reservation.reservationHoldExpiresAt ||
    reservation.reservationHoldExpiresAt > new Date());

const canUseExistingReservationForNewHold = (
  reservation: WorkspaceReservation
) =>
  reservation.reservationState === "draft" ||
  isReusableHeldReservation(reservation);

const getExistingReservationSubmitMessage = (
  reservation: WorkspaceReservation,
  locale: Locale
) =>
  reservation.paymentState === "paid"
    ? m.reservationAlreadyPaidMessage({}, { locale })
    : m.reservationErrorMessage({}, { locale });

const enqueueReservationHoldCleanup = Effect.fn(
  "prepareWorkspacePayState.enqueueReservationHoldCleanup"
)(function* (input: {
  readonly orderId: string;
  readonly reservationHoldExpiresAt: Date | null;
}) {
  if (!input.reservationHoldExpiresAt) {
    yield* Effect.logWarning(
      "Workspace reservation hold cleanup enqueue skipped: missing hold expiry",
      { orderId: input.orderId }
    );
    return;
  }

  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const enqueue = cleanupSchedule
    .enqueueCleanup({
      orderId: input.orderId,
      reservationHoldExpiresAt: input.reservationHoldExpiresAt,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logError("Workspace reservation hold cleanup enqueue failed", {
          orderId: input.orderId,
          cause,
        })
      )
    );

  yield* enqueue.pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(2),
      orElse: () =>
        Effect.logWarning(
          "Workspace reservation hold cleanup enqueue timed out",
          {
            orderId: input.orderId,
          }
        ),
    }),
    Effect.ignore
  );
});

class PendingHoldCreation extends Data.TaggedError("PendingHoldCreation")<{
  readonly reservation: WorkspaceReservation;
}> {}

const pendingHoldCreationRetryPolicy = Schedule.exponential("250 millis").pipe(
  Schedule.modifyDelay((_, delay) =>
    Effect.succeed(Duration.min(delay, Duration.seconds(5)))
  ),
  Schedule.collectWhile(
    (metadata) =>
      metadata.elapsed < 40_000 &&
      Predicate.isTagged(metadata.input, "PendingHoldCreation")
  )
);

const waitForPendingHoldCreation = Effect.fn(
  "prepareWorkspacePayState.waitForPendingHoldCreation"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly reservationId: string;
}) {
  const findSettledReservation = input.reservations
    .findById(input.reservationId)
    .pipe(
      Effect.flatMap((reservation) => {
        if (reservation?.reservationState !== "creating_hold") {
          return Effect.succeed(reservation);
        }

        return Effect.logWarning(
          "Waiting for in-flight workspace reservation hold creation"
        ).pipe(
          Effect.andThen(Effect.fail(new PendingHoldCreation({ reservation })))
        );
      })
    );

  return yield* findSettledReservation.pipe(
    Effect.retry(pendingHoldCreationRetryPolicy),
    Effect.catchTag("PendingHoldCreation", (error) =>
      Effect.succeed(error.reservation)
    )
  );
});

export const prepareWorkspacePayState = Effect.fn("prepareWorkspacePayState")(
  function* (input) {
    const botProtection = yield* BotProtectionService;
    yield* botProtection.verifyHuman({ verificationFailurePolicy: "allow" });

    const reservationIntentKey = deriveReservationIntentKey({
      reservationIntentId: input.reservationIntentId,
      reservation: input.reservation,
    });
    yield* Effect.annotateLogsScoped({
      locale: input.locale,
      input,
      reservationIntentKey,
    });
    yield* Effect.logInfo("Workspace reservation submit started");

    const acceptedAt = new Date().toISOString();
    const privacyEvidence = yield* getReservationPrivacyEvidence({
      locale: input.locale,
      accepted: input.legalConsent === true,
      acceptedAt,
    });
    yield* Effect.annotateLogsScoped({ privacyEvidence });
    const legalEvents = yield* LegalEvidenceEventRepository;

    if (input.legalConsent !== true) {
      yield* Effect.logInfo(
        "Workspace reservation submit rejected: missing legal consent"
      );

      yield* legalEvents
        .recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            evidence,
          }))
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logError("Reservation legal evidence recording failed", {
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
    const submittedCode = Option.getOrUndefined(
      yield* normalizeSubmittedDiscountCode({
        submittedCode: input.submittedCode,
      })
    );
    let existingReservation =
      yield* reservations.findByIntentKey(reservationIntentKey);
    yield* Effect.annotateLogsScoped({ existingReservation });
    yield* Effect.logDebug("Workspace reservation intent key lookup completed");

    if (existingReservation?.reservationState === "creating_hold") {
      existingReservation = yield* waitForPendingHoldCreation({
        reservations,
        reservationId: existingReservation.id,
      });
      yield* Effect.annotateLogsScoped({ existingReservation });
    }

    if (
      existingReservation &&
      !canUseExistingReservationForNewHold(existingReservation)
    ) {
      yield* Effect.logInfo(
        "Workspace reservation submit rejected: intent key belongs to a non-reusable reservation"
      );

      yield* legalEvents
        .recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            workspaceReservationId: existingReservation.id,
            evidence,
          }))
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logError("Reservation legal evidence recording failed", {
              cause,
            })
          ),
          Effect.ignore
        );

      return {
        status: "error" as const,
        message: getExistingReservationSubmitMessage(
          existingReservation,
          input.locale
        ),
      };
    }

    if (existingReservation && isReusableHeldReservation(existingReservation)) {
      yield* Effect.logInfo(
        "Existing workspace reservation hold reused for checkout prep"
      );

      const quote = yield* buildAuthoritativeWorkspaceCheckoutQuote({
        reservation: input.reservation,
        dotyposCustomerId: existingReservation.dotyposCustomerId,
        locale: input.locale,
        submittedCode,
      });
      yield* Effect.annotateLogsScoped({ quote });
      yield* Effect.logDebug("Workspace reservation quote built");

      yield* reservations.updateProductIntent({
        id: existingReservation.id,
        product: input.reservation,
        locale: input.locale,
      });
      yield* legalEvents.recordMany(
        Object.values(privacyEvidence).map((evidence) => ({
          workspaceReservationId: existingReservation.id,
          evidence,
        }))
      );
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return toReadyResult({
        locale: input.locale,
        reservation: input.reservation,
        quote,
        reservationId: existingReservation.id,
        submittedCode,
      });
    }

    const availability = yield* WorkspaceAvailabilityService;
    yield* availability.ensureAvailable({
      kind: "cowork",
      date: input.reservation.date,
      entryTier: input.reservation.entryTier,
      monitorOption: input.reservation.monitorOption,
    });
    yield* Effect.logDebug("Workspace reservation availability confirmed");

    const customerName = splitCustomerName(input.reservation.name);
    const customer = yield* dotypos.findOrCreateCustomer(
      {
        ...customerName,
        email: input.reservation.email,
        phone: input.reservation.phone,
      },
      { lookupFields: ["email"] }
    );
    yield* Effect.annotateLogsScoped({ customer });
    const dotyposCustomerId = yield* getDotyposCustomerId(customer);
    yield* Effect.annotateLogsScoped({ dotyposCustomerId });
    yield* Effect.logDebug("Workspace reservation Dotypos customer resolved");

    const quote = yield* buildAuthoritativeWorkspaceCheckoutQuote({
      reservation: input.reservation,
      dotyposCustomerId,
      locale: input.locale,
      submittedCode,
    });
    yield* Effect.annotateLogsScoped({ quote });
    yield* Effect.logDebug("Workspace reservation quote built");

    const holdExpiresAt = getReservationHoldExpiresAt(new Date());
    const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
    const customerAccessCode = yield* accessCodes.generateCustomerAccessCode();

    const reservationDraft = yield* reservations.createDraft({
      reservationIntentKey,
      dotyposCustomerId,
      customerAccessCode,
      product: input.reservation,
      locale: input.locale,
      reservationHoldExpiresAt: holdExpiresAt,
    });
    yield* Effect.annotateLogsScoped({ reservationDraft });
    yield* Effect.logInfo("Workspace reservation draft ready");

    const claimed = yield* reservations.claimHoldCreation(reservationDraft.id);
    if (!claimed) {
      const claimConflictReservation = yield* waitForPendingHoldCreation({
        reservations,
        reservationId: reservationDraft.id,
      });
      yield* Effect.annotateLogsScoped({ claimConflictReservation });

      if (
        claimConflictReservation &&
        isReusableHeldReservation(claimConflictReservation)
      ) {
        yield* Effect.logInfo(
          "Existing workspace reservation hold reused after concurrent hold creation"
        );

        const reusedQuote = yield* buildAuthoritativeWorkspaceCheckoutQuote({
          reservation: input.reservation,
          dotyposCustomerId: claimConflictReservation.dotyposCustomerId,
          locale: input.locale,
          submittedCode,
        });

        yield* reservations.updateProductIntent({
          id: claimConflictReservation.id,
          product: input.reservation,
          locale: input.locale,
        });
        yield* legalEvents.recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            workspaceReservationId: claimConflictReservation.id,
            evidence,
          }))
        );
        yield* Effect.logInfo("Workspace reservation checkout prep ready");

        return toReadyResult({
          locale: input.locale,
          reservation: input.reservation,
          quote: reusedQuote,
          reservationId: claimConflictReservation.id,
          submittedCode,
        });
      }

      yield* Effect.logError(
        "Workspace reservation hold creation claim failed"
      );

      return {
        status: "error" as const,
        message: m.reservationErrorMessage({}, { locale: input.locale }),
      };
    }
    yield* Effect.logDebug("Workspace reservation hold creation claimed");

    const checkoutDetails = buildReservationCheckoutDetails({
      locale: input.locale,
      reservation: input.reservation,
      quote,
      legalEvidence: privacyEvidence,
    });
    yield* Effect.annotateLogsScoped({ checkoutDetails });
    const dotyposReservation = yield* createWorkspaceDotyposReservation({
      paymentOrderId: reservationDraft.id,
      dotyposCustomerId,
      checkoutDetails,
      status: "NEW",
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (cause) {
          yield* Effect.logError(
            "Workspace Dotypos reservation hold creation failed",
            {
              cause,
            }
          );

          yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
            Effect.tapError((releaseCause) =>
              Effect.logError("Reservation hold creation release failed", {
                cause: releaseCause,
              })
            ),
            Effect.ignore
          );
        })
      )
    );
    yield* Effect.annotateLogsScoped({ dotyposReservation });

    const dotyposReservationId = yield* decodeDotyposEntityId({
      value: dotyposReservation,
      missingIdMessage: "Dotypos reservation was created without an ID",
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (cause) {
          yield* Effect.logError(
            "Workspace Dotypos reservation hold was created without an ID",
            {
              cause,
            }
          );

          yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
            Effect.tapError((releaseCause) =>
              Effect.logError("Reservation hold creation release failed", {
                cause: releaseCause,
              })
            ),
            Effect.ignore
          );
        })
      )
    );
    yield* Effect.annotateLogsScoped({ dotyposReservationId });
    yield* Effect.logInfo("Workspace Dotypos reservation hold created");

    const reservationCreatedAt = new Date();

    yield* reservations
      .attachHold({
        id: reservationDraft.id,
        dotyposReservationId,
        reservationCreatedAt,
        reservationHoldExpiresAt: holdExpiresAt,
      })
      .pipe(
        Effect.catch(
          Effect.fn(function* (cause) {
            yield* Effect.logError(
              "Workspace reservation hold attach failed; cancelling Dotypos hold",
              {
                cause,
              }
            );

            yield* dotypos.cancelReservation(dotyposReservationId).pipe(
              Effect.catch((cancelCause) =>
                Effect.gen(function* () {
                  yield* Effect.logFatal(
                    "Workspace reservation hold attach cleanup failed",
                    {
                      reservationDraftId: reservationDraft.id,
                      dotyposReservationId,
                      cause: cancelCause,
                    }
                  );

                  yield* reservations
                    .markAttachFailedCancellationRequired({
                      id: reservationDraft.id,
                      dotyposReservationId,
                      reservationCreatedAt: new Date(),
                      failureCode: "attach_failed_cancel_failed",
                    })
                    .pipe(
                      Effect.tapError((markerCause) =>
                        Effect.logFatal(
                          "Workspace reservation hold attach cleanup marker failed",
                          {
                            reservationDraftId: reservationDraft.id,
                            dotyposReservationId,
                            cause: markerCause,
                          }
                        )
                      )
                    );

                  yield* Effect.logWarning(
                    "Workspace reservation hold cancellation marked for retry",
                    {
                      reservationDraftId: reservationDraft.id,
                      dotyposReservationId,
                    }
                  );
                  return yield* Effect.fail(cancelCause);
                })
              )
            );
            yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
              Effect.tapError((releaseCause) =>
                Effect.logError("Reservation hold creation release failed", {
                  cause: releaseCause,
                })
              ),
              Effect.ignore
            );

            return yield* Effect.fail(cause);
          })
        )
      );
    yield* Effect.logInfo("Workspace reservation hold attached");
    yield* enqueueReservationHoldCleanup({
      orderId: reservationDraft.id,
      reservationHoldExpiresAt: holdExpiresAt,
    });
    yield* captureReservationStarted({
      reservation: {
        id: reservationDraft.id,
        dotyposReservationId,
      },
      timestamp: reservationCreatedAt,
    });

    yield* legalEvents.recordMany(
      Object.values(privacyEvidence).map((evidence) => ({
        workspaceReservationId: reservationDraft.id,
        evidence,
      }))
    );

    yield* Effect.logInfo("Workspace reservation checkout prep ready");

    return toReadyResult({
      locale: input.locale,
      reservation: input.reservation,
      quote,
      reservationId: reservationDraft.id,
      submittedCode,
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        input,
      }),
      Effect.mapError(
        (error) =>
          new PublicSafeActionError({
            message: Match.value(error).pipe(
              Match.tag("BotDetectedError", () =>
                m.reservationRateLimitMessage({}, { locale: input.locale })
              ),
              Match.tag("DiscountCodeUnavailableError", () =>
                m.reservationDiscountCodeUnavailable(
                  {},
                  { locale: input.locale }
                )
              ),
              Match.orElse(() =>
                m.reservationErrorMessage({}, { locale: input.locale })
              )
            ),
            cause: error,
          })
      )
    )
);

const preparePayStateAction = createEffectSafeAction(
  preparePayStateSchema,
  prepareWorkspacePayState,
  Layer.mergeAll(
    Layer.mergeAll(
      WorkspaceReservationRepositoryLive,
      LegalEvidenceEventRepositoryLive
    ).pipe(Layer.provide(WorkspaceDatabaseLive)),
    WorkspaceAvailabilityService.LiveWithDependencies,
    WorkspaceTableAssignmentServiceLive.pipe(
      Layer.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(WorkspaceDatabaseLive)
        )
      ),
      Layer.provide(DotyposServiceLive)
    ),
    WorkspaceCheckoutAccessCodeServiceLive,
    ReservationHoldCleanupScheduleService.Live,
    BotProtectionService.Live,
    PostHogEventServiceLive,
    DotyposServiceLive,
    DiscountServiceLiveWithDependencies
  )
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
