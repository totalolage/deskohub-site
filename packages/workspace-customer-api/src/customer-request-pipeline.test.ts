import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Result } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
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
import { makeWorkspaceCustomerApiClient } from "./client";
import { CustomerAccountApi } from "./customer-account-api";
import type {
  CustomerProfileCompletionInput,
  CustomerProfileInput,
} from "./customer-profile";
import {
  CurrentCustomerSession,
  CustomerAccountId,
  CustomerRequestOriginCheck,
  CustomerRequestRejected,
  CustomerSessionAuthentication,
  customerApiClientHeader,
} from "./customer-session";

/**
 * Serves the real profile endpoints behind both middlewares, added in the
 * order `WorkspaceCustomerApi` adds them (its test pins that order), to show
 * what that order and the payloads' parse options do at runtime.
 */
// A group's `endpoints` record is typed loosely; this names each endpoint's
// declared type.
type AccountEndpoint<Name extends string> = HttpApiEndpoint.WithName<
  HttpApiGroup.Endpoints<typeof CustomerAccountApi>,
  Name
>;
const updateProfileEndpoint = CustomerAccountApi.endpoints
  .updateProfile as AccountEndpoint<"updateProfile">;
const completeProfileEndpoint = CustomerAccountApi.endpoints
  .completeProfile as AccountEndpoint<"completeProfile">;

const api = HttpApi.make("customerRequestPipeline")
  .add(
    HttpApiGroup.make("account")
      .add(updateProfileEndpoint)
      .add(completeProfileEndpoint)
  )
  .prefix("/api/customer")
  .middleware(CustomerSessionAuthentication)
  .middleware(CustomerRequestOriginCheck);

const ran: string[] = [];
const received: (CustomerProfileInput | CustomerProfileCompletionInput)[] = [];
const customerEmail = testEmailAddress("customer");
const otherEmail = testEmailAddress("other");

const server = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "account", (handlers) =>
        handlers
          .handle("updateProfile", ({ payload }) =>
            Effect.sync(() => {
              received.push(payload);
              return { status: "updated" } as const;
            })
          )
          .handle("completeProfile", ({ payload }) =>
            Effect.sync(() => {
              received.push(payload);
              return { status: "completed" } as const;
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
              locale: null,
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

/** The customer API's typed client, answered by the served endpoints. */
const typedClient = makeWorkspaceCustomerApiClient({
  baseUrl: "https://workspace.deskohub.test",
}).pipe(
  Effect.provideService(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.flatMap((webRequest) =>
          Effect.promise(() => server.handler(webRequest))
        ),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.orDie
      )
    )
  )
);

const callTypedClient = <A, E>(
  call: (client: Effect.Success<typeof typedClient>) => Effect.Effect<A, E>
) => {
  ran.length = 0;
  received.length = 0;
  return Effect.runPromise(
    typedClient.pipe(Effect.flatMap(call), Effect.result)
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

describe("the typed client's profile phone", () => {
  test("sends a national phone as the entered text, which the update and the completion accept", async () => {
    const updated = await callTypedClient((client) =>
      client.account.updateProfile({
        payload: { firstName: "Ada", phone: "601 123 456" },
      })
    );
    const updateReceived = [...received];
    const completed = await callTypedClient((client) =>
      client.account.completeProfile({
        headers: {},
        payload: { firstName: "Ada", phone: "601 123 456" },
      })
    );

    expect([updated, completed]).toEqual([
      Result.succeed({ status: "updated" }),
      Result.succeed({ status: "completed" }),
    ]);
    expect([...updateReceived, ...received]).toEqual([
      { firstName: "Ada", phone: "601 123 456" },
      { firstName: "Ada", phone: "601 123 456" },
    ]);
  });

  test("sends a blank phone, which clears the stored phone", async () => {
    const updated = await callTypedClient((client) =>
      client.account.updateProfile({
        payload: { firstName: "Ada", phone: "" },
      })
    );

    expect(updated).toEqual(Result.succeed({ status: "updated" }));
    expect(received).toEqual([{ firstName: "Ada", phone: "" }]);
  });

  test("never delivers a phone without a phone number", async () => {
    const updated = await callTypedClient((client) =>
      client.account.updateProfile({
        payload: { firstName: "Ada", phone: "not a phone" },
      })
    );
    const completed = await callTypedClient((client) =>
      client.account.completeProfile({
        headers: {},
        payload: { firstName: "Ada", phone: "not a phone" },
      })
    );

    expect([Result.isFailure(updated), Result.isFailure(completed)]).toEqual([
      true,
      true,
    ]);
    expect(received).toEqual([]);
  });
});
