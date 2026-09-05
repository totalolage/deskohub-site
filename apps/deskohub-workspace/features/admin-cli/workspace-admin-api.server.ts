import {
  AdministrationDiscountMutationResult,
  AdministrationReservationAccessGrant,
  CliAuthenticationRateLimited,
  CliBearerAuthentication,
  CliGrantRejected,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Match, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  InvoiceAdministrationCustomerError,
  InvoiceAdministrationInProgressError,
  InvoiceAdministrationNotFoundError,
  InvoiceAdministrationService,
} from "@/features/accounting/admin/invoice-administration.service";
import { ManualInvoiceConflictError } from "@/features/accounting/backend/invoice.repository";
import { ManualInvoiceValidationError } from "@/features/accounting/manual-invoice";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "@/features/administration/payment-administration-filters";
import {
  ReservationAccessAdministration,
  type ReservationAccessAdministrationError,
} from "@/features/administration/reservation-access-administration.service";
import {
  type ReservationAdministrationError,
  ReservationAdministrationService,
} from "@/features/administration/reservation-administration.service";
import { refreshCalendarDiscountSourceAfterMutation } from "@/features/discounts/admin/calendar-discount-source-maintenance.server";
import {
  type AdminCustomerProfile,
  type AdminDiscountCode,
  type AdminDiscountCodeClaim,
  type AdminDiscountCodeDetail,
  type AdminVoucher,
  type AdminVoucherClaim,
  type AdminVoucherDetail,
  type DiscountAdminDashboard,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import { executeDiscountAdminMutation } from "@/features/discounts/admin/execute-discount-admin-mutation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  type ReservationAccessGrant,
  reservationAccessProvisioningStaleAfterMilliseconds,
} from "@/features/reservation-access";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";

export const AdminCliApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "cli",
  (handlers) =>
    Effect.gen(function* () {
      const authentication = yield* CliAuthentication;
      const admission = yield* CliAuthenticationAdmission;
      return handlers
        .handle("getInfo", () =>
          Effect.succeed({
            apiVersion: "v1" as const,
            service: "deskohub-workspace" as const,
          })
        )
        .handle("startAuthentication", ({ payload }) =>
          Effect.gen(function* () {
            const allowed =
              yield* admission.isStartAllowed.pipe(mapServiceFailure);
            if (!allowed) {
              return yield* new CliAuthenticationRateLimited({
                message:
                  "Too many CLI authentication requests were started. Try again shortly.",
              });
            }
            return yield* authentication.start(payload).pipe(mapServiceFailure);
          })
        )
        .handle("getAuthenticationStatus", ({ query }) =>
          authentication.status(query.code).pipe(mapServiceFailure)
        )
        .handle("exchangeGrant", ({ payload }) =>
          authentication
            .exchange(payload)
            .pipe(
              Effect.mapError((cause) =>
                cause instanceof CliGrantRejected
                  ? cause
                  : makeServiceUnavailable()
              )
            )
        )
        .handle("getCurrentSession", () => CurrentCliSession);
    })
);

export const AdminCliAdministrationApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "administration",
  (handlers) =>
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      const reservationAdministration = yield* ReservationAdministrationService;
      const reservationAccess = yield* ReservationAccessAdministration;
      const authentication = yield* CliAuthentication;
      const discounts = yield* DiscountAdministration;
      const invoices = yield* InvoiceAdministrationService;
      const mutationIdempotency = yield* CliMutationIdempotency;
      return handlers
        .handle("getOverview", () =>
          administration.loadOverview().pipe(mapServiceFailure)
        )
        .handle("listReservations", ({ query }) =>
          administration.listReservations(query).pipe(mapServiceFailure)
        )
        .handle("getReservation", ({ params }) =>
          administration.loadReservation(params.reservationId).pipe(
            mapServiceFailure,
            Effect.flatMap((detail) =>
              detail
                ? Effect.succeed(detail)
                : new CliResourceNotFound({
                    message: "The reservation was not found.",
                  })
            )
          )
        )
        .handle("cancelReservation", ({ params, payload }) =>
          reservationAdministration
            .cancel({
              accessGrantUpdatedAt: payload.accessGrantUpdatedAt,
              force: payload.force ?? false,
              providerCredentialRemoved: payload.providerCredentialRemoved,
              reservationId: params.reservationId,
              sendCancellationEmail: payload.sendCancellationEmail,
            })
            .pipe(Effect.mapError(mapReservationCancellationFailure))
        )
        .handle("mutateReservationAccess", ({ params, payload }) =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            const request = {
              sessionId: session.id,
              requestId: payload.requestId,
              mutation: {
                kind: "reservation-access" as const,
                reservationId: params.reservationId,
                mutation: payload.mutation,
              },
            };
            const claim = yield* mutationIdempotency
              .claim(request)
              .pipe(mapServiceFailure);
            const applyMutation = reservationAccess
              .mutate({
                reservationId: params.reservationId,
                ...payload.mutation,
              })
              .pipe(
                Effect.map(toCliReservationAccessGrant),
                Effect.tapError((cause) =>
                  cause.reason === "recovery_failed"
                    ? Effect.void
                    : mutationIdempotency
                        .release(request)
                        .pipe(Effect.catch(() => Effect.void))
                ),
                Effect.mapError(mapReservationAccessMutationFailure),
                Effect.tap((result) =>
                  mutationIdempotency
                    .complete({ ...request, result })
                    .pipe(mapServiceFailure)
                )
              );
            const resumeInterruptedMutation = Effect.gen(function* () {
              const reclaimedAt = Temporal.Now.instant();
              const reclaimed = yield* mutationIdempotency
                .reclaimStale({
                  ...request,
                  reclaimedAt,
                  staleBefore: reclaimedAt.subtract({
                    milliseconds:
                      reservationAccessProvisioningStaleAfterMilliseconds,
                  }),
                })
                .pipe(mapServiceFailure);
              if (!reclaimed) {
                return yield* new CliMutationInProgress({
                  requestId: payload.requestId,
                  message:
                    "This reservation access mutation is still being applied. Retrying with the same request identifier is safe.",
                });
              }
              return yield* reservationAccess
                .resumeInterruptedMutation(params.reservationId)
                .pipe(
                  Effect.map(toCliReservationAccessGrant),
                  Effect.tapError(() =>
                    mutationIdempotency
                      .release(request)
                      .pipe(Effect.catch(() => Effect.void))
                  ),
                  Effect.mapError(mapReservationAccessMutationFailure),
                  Effect.tap((result) =>
                    mutationIdempotency
                      .complete({ ...request, result })
                      .pipe(mapServiceFailure)
                  )
                );
            });

            return yield* Match.value(claim).pipe(
              Match.discriminatorsExhaustive("kind")({
                claimed: () => applyMutation,
                completed: ({ result }) =>
                  Schema.decodeUnknownEffect(
                    AdministrationReservationAccessGrant
                  )(result).pipe(Effect.mapError(makeServiceUnavailable)),
                "in-progress": () => resumeInterruptedMutation,
                mismatch: () =>
                  new CliMutationRejected({
                    message:
                      "This mutation request identifier was already used for different input.",
                  }),
              })
            );
          })
        )
        .handle("findReservation", ({ query }) =>
          administration.findReservationId(query.identifier).pipe(
            Effect.map((reservationId) => ({ reservationId })),
            mapServiceFailure
          )
        )
        .handle("listBookings", ({ query }) =>
          administration
            .listBookings({
              date: query.date ?? getCurrentWorkspaceDate().toString(),
              page: query.page,
            })
            .pipe(mapServiceFailure)
        )
        .handle("getBooking", ({ params }) =>
          administration.loadBooking(params.bookingId).pipe(
            mapServiceFailure,
            Effect.flatMap((detail) =>
              detail
                ? Effect.succeed(detail)
                : new CliResourceNotFound({
                    message: "The booking was not found.",
                  })
            )
          )
        )
        .handle("listOrders", ({ query }) => {
          const range = getAdministrationOrderDateTimeBounds(
            query.from,
            query.to
          );
          return administration
            .listOrders({
              fromTime: range.fromTime,
              toTime: range.toTime,
              maxRecords: 50,
            })
            .pipe(mapServiceFailure);
        })
        .handle("getOrder", ({ params }) =>
          administration.loadOrder(params.orderId).pipe(mapServiceFailure)
        )
        .handle("listOperations", ({ query }) => {
          const range = getAdministrationPaymentDateTimeBounds(
            query.from,
            query.to
          );
          const filters = getAdministrationOperationFilters(query);
          return administration
            .listOperations({
              fromTime: range.fromTime,
              toTime: range.toTime,
              maxRecords: 100,
              ...filters,
            })
            .pipe(mapServiceFailure);
        })
        .handle("getOperation", ({ params }) =>
          administration
            .loadOperation(params.operationId)
            .pipe(mapServiceFailure)
        )
        .handle("listCustomers", ({ query }) =>
          administration.listCustomers(query).pipe(mapServiceFailure)
        )
        .handle("searchCustomers", ({ query }) =>
          discounts.searchCustomers(query).pipe(mapServiceFailure)
        )
        .handle("getCustomer", ({ params }) =>
          Effect.all(
            {
              activity: administration.loadCustomerActivity(params.customerId),
              profile: discounts
                .loadCustomerProfile({
                  customerId: params.customerId,
                })
                .pipe(
                  Effect.map(toCliCustomerProfile),
                  Effect.catch(() => Effect.succeed(null))
                ),
            },
            { concurrency: "unbounded" }
          ).pipe(mapServiceFailure)
        )
        .handle("listCustomerReservations", ({ params, query }) =>
          administration
            .loadCustomerReservations({
              customerId: params.customerId,
              page: query.page,
            })
            .pipe(mapServiceFailure)
        )
        .handle("getDiscountDashboard", () =>
          discounts
            .loadDashboard()
            .pipe(Effect.map(toCliDiscountDashboard), mapServiceFailure)
        )
        .handle("getDiscountCode", ({ params }) =>
          discounts.loadCodeDetail({ codeId: params.codeId }).pipe(
            Effect.map(toCliDiscountCodeDetail),
            Effect.catchTag(
              "DiscountAdminNotFoundError",
              () =>
                new CliResourceNotFound({
                  message: "The discount code was not found.",
                })
            ),
            Effect.mapError((cause) =>
              cause instanceof CliResourceNotFound
                ? cause
                : makeServiceUnavailable()
            )
          )
        )
        .handle("getVoucher", ({ params }) =>
          discounts.loadVoucherDetail({ voucherId: params.voucherId }).pipe(
            Effect.map(toCliVoucherDetail),
            Effect.catchTag(
              "DiscountAdminNotFoundError",
              () =>
                new CliResourceNotFound({
                  message: "The voucher was not found.",
                })
            ),
            Effect.mapError((cause) =>
              cause instanceof CliResourceNotFound
                ? cause
                : makeServiceUnavailable()
            )
          )
        )
        .handle("listInvoices", ({ query }) =>
          invoices.list(query).pipe(mapServiceFailure)
        )
        .handle("getInvoice", ({ params }) =>
          invoices
            .get(params.invoiceId)
            .pipe(Effect.mapError(mapInvoiceReadFailure))
        )
        .handle("getInvoicePdf", ({ params }) =>
          invoices.getPdf(params.invoiceId).pipe(
            Effect.map(({ bytes }) => bytes),
            Effect.mapError(mapInvoiceReadFailure)
          )
        )
        .handle("createInvoice", ({ payload }) =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            if (session.approvedBy === null) {
              return yield* new CliMutationRejected({
                message:
                  "This legacy CLI session cannot issue invoices. Run dhw auth again.",
              });
            }
            return yield* invoices
              .create(payload, {
                source: "dhw-cli",
                actor: session.approvedBy,
              })
              .pipe(Effect.mapError(mapInvoiceMutationFailure));
          })
        )
        .handle("resendInvoice", ({ params }) =>
          invoices.retry(params.invoiceId).pipe(
            Effect.mapError((cause) =>
              cause instanceof InvoiceAdministrationNotFoundError
                ? new CliResourceNotFound({
                    message: "The invoice was not found.",
                  })
                : makeServiceUnavailable()
            )
          )
        )
        .handle("listSessions", () =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            if (session.approvedBy === null) return [];
            return yield* authentication
              .listSessions(session.approvedBy)
              .pipe(mapServiceFailure);
          })
        )
        .handle("mutateDiscounts", ({ payload }) =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            const request = {
              sessionId: session.id,
              requestId: payload.requestId,
              mutation: payload.mutation,
            };
            const claim = yield* mutationIdempotency
              .claim(request)
              .pipe(mapServiceFailure);

            return yield* Match.value(claim).pipe(
              Match.discriminatorsExhaustive("kind")({
                claimed: () =>
                  executeDiscountAdminMutation(payload.mutation).pipe(
                    Effect.provideService(DiscountAdministration, discounts),
                    Effect.mapError(mapDiscountMutationFailure),
                    Effect.tap(() =>
                      refreshCalendarDiscountSourceAfterMutation(
                        payload.mutation
                      )
                    ),
                    Effect.tapError((cause) =>
                      cause instanceof CliResourceNotFound ||
                      cause instanceof CliMutationRejected
                        ? mutationIdempotency
                            .release(request)
                            .pipe(Effect.catch(() => Effect.void))
                        : Effect.void
                    ),
                    Effect.tap((result) =>
                      mutationIdempotency
                        .complete({ ...request, result })
                        .pipe(mapServiceFailure)
                    )
                  ),
                completed: ({ result }) =>
                  Schema.decodeUnknownEffect(
                    AdministrationDiscountMutationResult
                  )(result).pipe(
                    Effect.mapError(makeServiceUnavailable),
                    Effect.tap(() =>
                      refreshCalendarDiscountSourceAfterMutation(
                        payload.mutation
                      )
                    )
                  ),
                "in-progress": () =>
                  new CliMutationInProgress({
                    requestId: payload.requestId,
                    message:
                      "This mutation is still being applied. Retrying with the same request identifier is safe.",
                  }),
                mismatch: () =>
                  new CliMutationRejected({
                    message:
                      "This mutation request identifier was already used for different input.",
                  }),
              })
            );
          })
        )
        .handle("renameSession", ({ params, payload }) =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            if (session.approvedBy === null) {
              return yield* new CliResourceNotFound({
                message: "The CLI session was not found.",
              });
            }
            const changed = yield* authentication
              .renameSession({
                owner: session.approvedBy,
                sessionId: params.sessionId,
                clientName: payload.clientName,
              })
              .pipe(mapServiceFailure);
            if (!changed) {
              return yield* new CliResourceNotFound({
                message: "The CLI session was not found.",
              });
            }
            return { changed };
          })
        )
        .handle("revokeSession", ({ params }) =>
          Effect.gen(function* () {
            const session = yield* CurrentCliSession;
            if (session.approvedBy === null) return { changed: false };
            const changed = yield* authentication
              .revoke({
                owner: session.approvedBy,
                sessionId: params.sessionId,
              })
              .pipe(mapServiceFailure);
            return { changed };
          })
        );
    })
);

const CliBearerAuthenticationLive = Layer.effect(
  CliBearerAuthentication,
  Effect.gen(function* () {
    const authentication = yield* CliAuthentication;
    return {
      bearer: (httpEffect, { credential }) =>
        authentication
          .authenticateSession(`Bearer ${Redacted.value(credential)}`)
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof CliSessionUnauthorized
                ? cause
                : makeServiceUnavailable()
            ),
            Effect.flatMap((session) =>
              Effect.provideService(httpEffect, CurrentCliSession, session)
            )
          ),
    } satisfies CliBearerAuthentication["Service"];
  })
);

const makeServiceUnavailable = () =>
  new CliServiceUnavailable({
    message: "The administration API is temporarily unavailable.",
  });

const mapServiceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(makeServiceUnavailable));

const mapDiscountMutationFailure = (
  cause: Effect.Error<ReturnType<typeof executeDiscountAdminMutation>>
) =>
  Match.value(cause).pipe(
    Match.tag(
      "DiscountAdminNotFoundError",
      ({ message }) => new CliResourceNotFound({ message })
    ),
    Match.tag(
      "DiscountAdminAudienceError",
      ({ message }) => new CliMutationRejected({ message })
    ),
    Match.tag(
      "DiscountAdminConflictError",
      ({ message }) => new CliMutationRejected({ message })
    ),
    Match.orElse(makeServiceUnavailable)
  );

const mapInvoiceReadFailure = (cause: unknown) =>
  cause instanceof InvoiceAdministrationNotFoundError
    ? new CliResourceNotFound({ message: "The invoice was not found." })
    : makeServiceUnavailable();

const mapInvoiceMutationFailure = (cause: unknown) => {
  if (cause instanceof InvoiceAdministrationInProgressError) {
    return new CliMutationInProgress({
      message: cause.message,
      requestId: CliMutationRequestId.make(cause.invoiceId),
    });
  }
  if (
    cause instanceof InvoiceAdministrationCustomerError ||
    cause instanceof ManualInvoiceConflictError ||
    cause instanceof ManualInvoiceValidationError
  ) {
    return new CliMutationRejected({ message: cause.message });
  }
  return makeServiceUnavailable();
};

const mapReservationCancellationFailure = (
  cause: ReservationAdministrationError
) => {
  if (cause.code === "not_found") {
    return new CliResourceNotFound({ message: cause.message });
  }
  if (cause.code === "not_cancellable") {
    return new CliMutationRejected({ message: cause.message });
  }
  return makeServiceUnavailable();
};

const mapReservationAccessMutationFailure = (
  cause: ReservationAccessAdministrationError
) =>
  Match.value(cause.reason).pipe(
    Match.when(
      "not_found",
      () => new CliResourceNotFound({ message: cause.message })
    ),
    Match.when(
      "invalid_state",
      () => new CliMutationRejected({ message: cause.message })
    ),
    Match.when("retryable_failure", makeServiceUnavailable),
    Match.when("recovery_failed", makeServiceUnavailable),
    Match.exhaustive
  );

const toCliReservationAccessGrant = (grant: ReservationAccessGrant) => ({
  id: grant.id,
  state: grant.state,
  provider: grant.provider,
  credentialType: grant.credentialType,
  deviceId: grant.deviceId,
  providerCredentialId: grant.providerCredentialId,
  accessName: `Deskohub ${grant.reservationId}`.slice(0, 60),
  scheduledStartsAt: grant.scheduledAccessStartsAt.toString(),
  startsAt: grant.accessStartsAt.toString(),
  endsAt: grant.accessEndsAt.toString(),
  provisioningStartedAt: grant.provisioningStartedAt?.toString() ?? null,
  issuedAt: grant.issuedAt?.toString() ?? null,
  failedAt: grant.failedAt?.toString() ?? null,
  failureCode: grant.failureCode,
  createdAt: grant.createdAt.toString(),
  updatedAt: grant.updatedAt.toString(),
});

const toCliCustomerProfile = (profile: AdminCustomerProfile) => ({
  ...profile,
  codes: profile.codes.map(toCliDiscountCode),
  claims: profile.claims.map(toCliDiscountCodeClaim),
  vouchers: profile.vouchers.map(toCliVoucher),
  voucherClaims: profile.voucherClaims.map(toCliVoucherClaim),
});

const toCliDiscountCode = <Code extends AdminDiscountCode>(code: Code) => ({
  ...code,
  validFrom: code.validFrom?.toString() ?? null,
  validUntil: code.validUntil?.toString() ?? null,
  createdAt: code.createdAt.toString(),
  updatedAt: code.updatedAt.toString(),
});

const toCliDiscountCodeClaim = (claim: AdminDiscountCodeClaim) => ({
  ...claim,
  reservationExpiresAt: claim.reservationExpiresAt.toString(),
  reservedAt: claim.reservedAt.toString(),
  redeemedAt: claim.redeemedAt?.toString() ?? null,
  releasedAt: claim.releasedAt?.toString() ?? null,
});

const toCliVoucher = <Voucher extends AdminVoucher>(voucher: Voucher) => ({
  ...voucher,
  validFrom: voucher.validFrom?.toString() ?? null,
  validUntil: voucher.validUntil?.toString() ?? null,
  createdAt: voucher.createdAt.toString(),
  updatedAt: voucher.updatedAt.toString(),
});

const toCliVoucherClaim = (claim: AdminVoucherClaim) => ({
  ...claim,
  reservationExpiresAt: claim.reservationExpiresAt.toString(),
  reservedAt: claim.reservedAt.toString(),
  redeemedAt: claim.redeemedAt?.toString() ?? null,
  releasedAt: claim.releasedAt?.toString() ?? null,
});

const toCliDiscountDashboard = (dashboard: DiscountAdminDashboard) => ({
  ...dashboard,
  discounts: dashboard.discounts.map((discount) => ({
    ...discount,
    createdAt: discount.createdAt.toString(),
    updatedAt: discount.updatedAt.toString(),
  })),
  codes: dashboard.codes.map(toCliDiscountCode),
  vouchers: dashboard.vouchers.map(toCliVoucher),
});

const toCliDiscountCodeDetail = (detail: AdminDiscountCodeDetail) => ({
  ...detail,
  code: toCliDiscountCode(detail.code),
  claims: detail.claims.map(toCliDiscountCodeClaim),
});

const toCliVoucherDetail = (detail: AdminVoucherDetail) => ({
  ...detail,
  voucher: toCliVoucher(detail.voucher),
  claims: detail.claims.map(toCliVoucherClaim),
});

const noStore = HttpRouter.middleware(
  (effect) =>
    Effect.map(effect, (response) =>
      HttpServerResponse.setHeader(
        response,
        "Cache-Control",
        "private, no-store"
      )
    ),
  { global: true }
);

const WorkspaceAdminApiLive = Layer.merge(
  HttpApiBuilder.layer(WorkspaceAdminApi).pipe(
    Layer.provide(AdminCliApiHandlers),
    Layer.provide(AdminCliAdministrationApiHandlers),
    Layer.provide(CliBearerAuthenticationLive),
    Layer.provide(AdministrationService.Live),
    Layer.provide(ReservationAdministrationService.Live),
    Layer.provide(ReservationAccessAdministration.Live),
    Layer.provide(DiscountAdministration.Live),
    Layer.provide(InvoiceAdministrationService.Live),
    Layer.provide(CliMutationIdempotency.Live),
    Layer.provide(CliAuthenticationAdmission.Default),
    Layer.provide(CliAuthentication.Live)
  ),
  noStore
).pipe(Layer.provide(NodeHttpServer.layerHttpServices));

export const handleWorkspaceAdminApiRequest = HttpRouter.toWebHandler(
  WorkspaceAdminApiLive,
  { disableLogger: true }
).handler;
