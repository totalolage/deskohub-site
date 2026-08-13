import {
  CliAuthenticationRateLimited,
  CliBearerAuthentication,
  CliGrantRejected,
  CliMutationInProgress,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Match, Redacted } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { AdministrationLive } from "@/features/administration/administration.runtime";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "@/features/administration/payment-administration-filters";
import {
  type ReservationAdministrationError,
  ReservationAdministrationService,
} from "@/features/administration/reservation-administration.service";
import { DiscountAdministrationLive } from "@/features/discounts/admin/discount-administration.runtime";
import {
  type AdminCustomerProfile,
  type AdminDiscountCode,
  type AdminDiscountCodeClaim,
  type AdminDiscountCodeDetail,
  type DiscountAdminDashboard,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import { executeDiscountAdminMutation } from "@/features/discounts/admin/execute-discount-admin-mutation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
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
      const authentication = yield* CliAuthentication;
      const discounts = yield* DiscountAdministration;
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
              reservationId: params.reservationId,
              sendCancellationEmail: payload.sendCancellationEmail,
            })
            .pipe(Effect.mapError(mapReservationCancellationFailure))
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
        .handle("listSessions", () =>
          authentication.listSessions().pipe(mapServiceFailure)
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
                completed: ({ result }) => Effect.succeed(result),
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
          authentication
            .renameSession({
              sessionId: params.sessionId,
              clientName: payload.clientName,
            })
            .pipe(
              mapServiceFailure,
              Effect.flatMap((changed) =>
                changed
                  ? Effect.succeed({ changed })
                  : new CliResourceNotFound({
                      message: "The CLI session was not found.",
                    })
              )
            )
        )
        .handle("revokeSession", ({ params }) =>
          authentication.revoke(params.sessionId).pipe(
            Effect.map((changed) => ({ changed })),
            mapServiceFailure
          )
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

const toCliCustomerProfile = (profile: AdminCustomerProfile) => ({
  ...profile,
  codes: profile.codes.map(toCliDiscountCode),
  claims: profile.claims.map(toCliDiscountCodeClaim),
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

const toCliDiscountDashboard = (dashboard: DiscountAdminDashboard) => ({
  ...dashboard,
  discounts: dashboard.discounts.map((discount) => ({
    ...discount,
    createdAt: discount.createdAt.toString(),
    updatedAt: discount.updatedAt.toString(),
  })),
  codes: dashboard.codes.map(toCliDiscountCode),
});

const toCliDiscountCodeDetail = (detail: AdminDiscountCodeDetail) => ({
  ...detail,
  code: toCliDiscountCode(detail.code),
  claims: detail.claims.map(toCliDiscountCodeClaim),
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
    Layer.provide(AdministrationLive),
    Layer.provide(ReservationAdministrationService.LiveWithDependencies),
    Layer.provide(DiscountAdministrationLive),
    Layer.provide(CliMutationIdempotency.LiveWithDependencies),
    Layer.provide(CliAuthenticationAdmission.Live),
    Layer.provide(CliAuthentication.LiveWithDependencies)
  ),
  noStore
).pipe(Layer.provide(NodeHttpServer.layerHttpServices));

export const handleWorkspaceAdminApiRequest = HttpRouter.toWebHandler(
  WorkspaceAdminApiLive,
  { disableLogger: true }
).handler;
