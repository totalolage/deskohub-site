import "server-only";

import {
  CurrentCustomerSession,
  CustomerAccountId,
  CustomerRequestOriginCheck,
  CustomerRequestRejected,
  CustomerServiceUnavailable,
  CustomerSessionAuthentication,
  CustomerSessionRequired,
  customerApiClientHeader,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { CustomerRequestOrigins } from "@/features/account/backend/auth/customer-request-origins.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import { accountAccessApiFailure } from "./customer-api-failure";
import { spendCustomerRequestBudgets } from "./customer-request-budget";

/**
 * Refuses, before any session lookup and on every method, a request that
 * lacks the customer API client header, that the browser marks cross-site,
 * or whose `Origin` Better Auth doesn't trust. The custom header needs a
 * CORS preflight the API never grants, so a cross-site page can't send it;
 * the other two checks back it up. Native clients send no `Origin`. When
 * Better Auth can't say whether an origin is trusted, the request is
 * refused too, never trusted.
 */
export const CustomerRequestOriginCheckLive = Layer.effect(
  CustomerRequestOriginCheck,
  Effect.gen(function* () {
    const origins = yield* CustomerRequestOrigins;

    const originTrusted = (origin: string) =>
      origins.isTrusted(origin).pipe(Effect.orElseSucceed(() => false));

    return (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, ({ headers }) =>
        Effect.succeed(headers).pipe(
          Effect.filterOrFail(
            (headers) =>
              headers[customerApiClientHeader.name] ===
                customerApiClientHeader.value &&
              headers["sec-fetch-site"] !== "cross-site",
            () => new CustomerRequestRejected()
          ),
          Effect.flatMap((headers) =>
            Option.fromNullishOr(headers.origin).pipe(
              Option.match({
                onNone: () => Effect.void,
                onSome: (origin) =>
                  originTrusted(origin).pipe(
                    Effect.filterOrFail(
                      (trusted) => trusted,
                      () => new CustomerRequestRejected()
                    )
                  ),
              })
            )
          ),
          Effect.andThen(httpEffect)
        )
      );
  })
);

const decodeAccountId = Schema.decodeUnknownEffect(CustomerAccountId);

/**
 * Resolves the verified customer from the request's authoritative Better
 * Auth session, then spends the account's request budgets
 * (`spendCustomerRequestBudgets`). No session, or an unverified one, asks to
 * sign in again; a session that can't be read is unavailable.
 */
export const CustomerSessionAuthenticationLive = Layer.effect(
  CustomerSessionAuthentication,
  Effect.gen(function* () {
    const authentication = yield* CustomerAuthentication;
    const budget = yield* RequestBudget;

    const currentSession = authentication.currentUser.pipe(
      Effect.mapError(accountAccessApiFailure),
      // A session read never fails as an account without a profile.
      Effect.catchTag("CustomerAccountLinkRequired", () =>
        Effect.fail(new CustomerServiceUnavailable())
      ),
      Effect.flatMap((session) =>
        Option.fromNullishOr(session).pipe(
          Option.match({
            onNone: () => Effect.fail(new CustomerSessionRequired()),
            onSome: ({ accountId, email, localePreference }) =>
              decodeAccountId(accountId).pipe(
                Effect.mapError(() => new CustomerSessionRequired()),
                Effect.map((accountId) => ({
                  accountId,
                  email,
                  locale: localePreference ?? null,
                }))
              ),
          })
        )
      )
    );

    return (httpEffect, { group, endpoint }) =>
      currentSession.pipe(
        Effect.tap((session) =>
          spendCustomerRequestBudgets({
            session,
            group: group.identifier,
            endpoint: endpoint.name,
          }).pipe(Effect.provideService(RequestBudget, budget))
        ),
        Effect.flatMap((session) =>
          Effect.provideService(httpEffect, CurrentCustomerSession, session)
        )
      );
  })
);
