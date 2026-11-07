import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
} from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  type HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { CustomerAccountApi } from "./customer-account-api";
import type { CustomerProfileInput } from "./customer-profile";
import {
  CurrentCustomerSession,
  CustomerAccountId,
  CustomerRequestOriginCheck,
  CustomerRequestRejected,
  CustomerSessionAuthentication,
  customerApiClientHeader,
} from "./customer-session";

/**
 * Serves the real `updateProfile` endpoint behind both middlewares, added in
 * the order `WorkspaceCustomerApi` adds them (its test pins that order), to
 * show what that order and the payload's parse options do at runtime.
 */
// A group's `endpoints` record is typed loosely; this names the endpoint's
// declared type.
const updateProfileEndpoint = CustomerAccountApi.endpoints
  .updateProfile as HttpApiEndpoint.WithName<
  HttpApiGroup.Endpoints<typeof CustomerAccountApi>,
  "updateProfile"
>;

const api = HttpApi.make("customerRequestPipeline")
  .add(HttpApiGroup.make("account").add(updateProfileEndpoint))
  .prefix("/api/customer")
  .middleware(CustomerSessionAuthentication)
  .middleware(CustomerRequestOriginCheck);

const ran: string[] = [];
const received: CustomerProfileInput[] = [];
const customerEmail = testEmailAddress("customer");
const otherEmail = testEmailAddress("other");

const server = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "account", (handlers) =>
        handlers.handle("updateProfile", ({ payload }) =>
          Effect.sync(() => {
            received.push(payload);
            return { status: "updated" } as const;
          })
        )
      )
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerRequestOriginCheck, (httpEffect) =>
          HttpServerRequest.HttpServerRequest.pipe(
            Effect.tap(() => Effect.sync(() => ran.push("origin check"))),
            Effect.filterOrFail(
              (request) =>
                request.headers[customerApiClientHeader.name] ===
                customerApiClientHeader.value,
              () => new CustomerRequestRejected({})
            ),
            Effect.andThen(httpEffect)
          )
        ),
        Layer.succeed(CustomerSessionAuthentication, (httpEffect) =>
          Effect.suspend(() => {
            ran.push("session authentication");
            return Effect.provideService(httpEffect, CurrentCustomerSession, {
              accountId: CustomerAccountId.make("account-1"),
              email: customerEmail,
            });
          })
        )
      )
    ),
    Layer.provide(HttpServer.layerServices)
  ),
  { disableLogger: true }
);
afterAll(() => server.dispose());

const updateProfile = (body: unknown, headers: Record<string, string> = {}) => {
  ran.length = 0;
  received.length = 0;
  return server.handler(
    new Request(
      "https://workspace.deskohub.test/api/customer/account/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }
    )
  );
};

const fromClient = {
  [customerApiClientHeader.name]: customerApiClientHeader.value,
};

describe("customer request pipeline", () => {
  test("refuses a request without the client header before any session lookup", async () => {
    const response = await updateProfile({ firstName: "Ada" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ _tag: "CustomerRequestRejected" });
    expect(ran).toEqual(["origin check"]);
  });

  test("authenticates the session after the origin check", async () => {
    const response = await updateProfile({ firstName: " Ada " }, fromClient);

    expect(response.status).toBe(200);
    expect(ran).toEqual(["origin check", "session authentication"]);
    expect(received).toEqual([{ firstName: "Ada" }]);
  });

  test("refuses a profile payload with a field the contract doesn't know", async () => {
    const unknownField = await updateProfile(
      { firstName: "Ada", email: otherEmail },
      fromClient
    );
    const unknownBillingField = await updateProfile(
      {
        firstName: "Ada",
        billing: { kind: "personal", city: "Brno", iban: "CZ00" },
      },
      fromClient
    );

    expect([unknownField.status, unknownBillingField.status]).toEqual([
      400, 400,
    ]);
    expect(received).toEqual([]);
  });

  test("refuses a phone number the provider normalizer can't parse", async () => {
    const response = await updateProfile(
      { firstName: "Ada", phone: "not a phone" },
      fromClient
    );

    expect(response.status).toBe(400);
    expect(received).toEqual([]);
  });
});
