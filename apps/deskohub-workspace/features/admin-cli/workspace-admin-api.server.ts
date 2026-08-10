import {
  CliAuthenticationRateLimited,
  CliBearerAuthentication,
  CliGrantRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { AdministrationLive } from "@/features/administration/administration.runtime";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "@/features/administration/payment-administration-filters";
import { DiscountAdministrationLive } from "@/features/discounts/admin/discount-administration.runtime";
import {
  type AdminCustomerProfile,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";

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

export const AdminCliReadApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "administration",
  (handlers) =>
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      const discounts = yield* DiscountAdministration;
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
                  customerId: params.customerId as DotyposCustomerId,
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

const toCliCustomerProfile = (profile: AdminCustomerProfile) => ({
  ...profile,
  codes: profile.codes.map((code) => ({
    ...code,
    validFrom: code.validFrom?.toString() ?? null,
    validUntil: code.validUntil?.toString() ?? null,
    createdAt: code.createdAt.toString(),
    updatedAt: code.updatedAt.toString(),
  })),
  claims: profile.claims.map((claim) => ({
    ...claim,
    reservationExpiresAt: claim.reservationExpiresAt.toString(),
    reservedAt: claim.reservedAt.toString(),
    redeemedAt: claim.redeemedAt?.toString() ?? null,
    releasedAt: claim.releasedAt?.toString() ?? null,
  })),
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
    Layer.provide(AdminCliReadApiHandlers),
    Layer.provide(CliBearerAuthenticationLive),
    Layer.provide(AdministrationLive),
    Layer.provide(DiscountAdministrationLive),
    Layer.provide(CliAuthenticationAdmission.Live),
    Layer.provide(CliAuthentication.LiveWithDependencies)
  ),
  noStore
).pipe(Layer.provide(NodeHttpServer.layerHttpServices));

export const handleWorkspaceAdminApiRequest = HttpRouter.toWebHandler(
  WorkspaceAdminApiLive,
  { disableLogger: true }
).handler;
