import {
  CurrentCustomerSession,
  CustomerAccessCodeUnavailable,
  type CustomerAccountApi,
  type CustomerAccountDeletionResult,
  CustomerAccountLinkRequired,
  type CustomerAccountState,
  type CustomerAuthEndpoints,
  CustomerAuthApi as CustomerAuthHttpApi,
  CustomerFeatureUnavailable,
  CustomerInvoiceNotIssued,
  CustomerMarketingPreferencesRejected,
  type CustomerProfile,
  type CustomerProfileInput,
  CustomerRateLimited,
  CustomerRequestOriginCheck,
  CustomerRequestRejected,
  CustomerReservationNotFound,
  type CustomerReservationsApi,
  CustomerServiceUnavailable,
  CustomerSessionAuthentication,
  CustomerSessionRequired,
  customerApiClientHeader,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  HttpApiBuilder,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  type FakeWorkspaceData,
  type SampleAccountKind,
  sampleWorkspaceData,
} from "./sample-fixtures";

/** The origin the fake Workspace serves. */
export const fakeWorkspaceOrigin = "https://workspace.deskohub.example";

/** A failure the fake answers for one endpoint before its handler runs. */
export type FakeRequestOutcome =
  | "session-required"
  | "rate-limited"
  | "service-unavailable"
  /**
   * The server handles the request, then the connection breaks: the client
   * sees a transport failure although a write was applied.
   */
  | "transport-failure"
  /** No answer ever comes; the client's timeout decides. */
  | "hang"
  /** The server handles the request, then answers a body nobody can read. */
  | "unreadable-answer"
  /**
   * Better Auth endpoints only: the session is too old for this change
   * (403 `SESSION_NOT_FRESH`), so the customer must confirm it's them.
   */
  | "session-not-fresh";

type EndpointName = HttpApiEndpoint.Name<
  | HttpApiGroup.Endpoints<typeof CustomerAccountApi>
  | HttpApiGroup.Endpoints<typeof CustomerReservationsApi>
  | HttpApiGroup.Endpoints<typeof CustomerAuthEndpoints>
>;

/**
 * An in-memory Workspace serving the real customer API and Better Auth
 * contracts, so the app's real clients, transports and error decoding run
 * against it. Tests and the sample-data mode read and change `data`, inject
 * failures per endpoint, and read `calls`.
 */
export class FakeWorkspace {
  data: FakeWorkspaceData;
  signedIn = true;
  /**
   * How the next deletion request ends. Only `deleted` deletes the account
   * and ends the session.
   */
  deletionOutcome: CustomerAccountDeletionResult["status"] = "deleted";
  /** Endpoint names in the order requests reached them. */
  readonly calls: EndpointName[] = [];
  private readonly outcomes = new Map<EndpointName, FakeRequestOutcome[]>();

  constructor(data: FakeWorkspaceData = sampleWorkspaceData("linked")) {
    this.data = data;
  }

  static forKind(kind: SampleAccountKind, now?: Date) {
    return new FakeWorkspace(sampleWorkspaceData(kind, now));
  }

  /** Answers the endpoint's next `times` requests with `outcome`. */
  fail(endpoint: EndpointName, outcome: FakeRequestOutcome, times = 1) {
    const queued = this.outcomes.get(endpoint) ?? [];
    this.outcomes.set(endpoint, [
      ...queued,
      ...Array.from({ length: times }, () => outcome),
    ]);
  }

  /** Changes the account; other data stays. */
  setAccount(account: CustomerAccountState) {
    this.data = { ...this.data, account };
  }

  /** @internal Takes the next injected outcome for the endpoint. */
  nextOutcome(endpoint: EndpointName): FakeRequestOutcome | undefined {
    const queued = this.outcomes.get(endpoint);
    const next = queued?.shift();
    if (queued?.length === 0) this.outcomes.delete(endpoint);
    return next;
  }
}

const storedProfile = (input: CustomerProfileInput): CustomerProfile => ({
  firstName: input.firstName,
  lastName: input.lastName ?? null,
  phone: input.phone ?? null,
  billing:
    input.billing === undefined
      ? null
      : {
          kind: input.billing.kind,
          addressLine1: input.billing.addressLine1 ?? null,
          addressLine2: input.billing.addressLine2 ?? null,
          city: input.billing.city ?? null,
          zip: input.billing.zip ?? null,
          country: input.billing.country ?? null,
          companyName:
            input.billing.kind === "business"
              ? input.billing.companyName
              : null,
          companyId:
            input.billing.kind === "business"
              ? (input.billing.companyId ?? null)
              : null,
          vatId:
            input.billing.kind === "business"
              ? (input.billing.vatId ?? null)
              : null,
        },
});

const linkRequiredReason = (
  account: CustomerAccountState
): CustomerAccountLinkRequired["reason"] =>
  account.kind === "deletion-pending" || account.kind === "support-required"
    ? account.kind
    : "profile-missing";

// The account carries the session settings as the Workspace reads them now:
// `passkeys` and `assistants` reflect the standalone lists, present only
// where the account state carries them.
const accountView = (data: FakeWorkspaceData): CustomerAccountState => ({
  ...data.account,
  ...(data.account.passkeys === undefined
    ? {}
    : {
        passkeys: {
          ...data.account.passkeys,
          passkeys: [...data.passkeys],
        },
      }),
  ...(data.account.assistants === undefined
    ? {}
    : { assistants: [...data.assistants] }),
});

const serverLayer = (workspace: FakeWorkspace) => {
  const linkedAccount = Effect.suspend(() => {
    const { account } = workspace.data;
    return account.kind === "linked"
      ? Effect.succeed(account)
      : Effect.fail(
          new CustomerAccountLinkRequired({
            reason: linkRequiredReason(account),
          })
        );
  });
  const order = (orderId: string) =>
    Effect.suspend(() => {
      const found = workspace.data.orders.get(orderId);
      return found === undefined
        ? Effect.fail(new CustomerReservationNotFound())
        : Effect.succeed(found);
    });
  const update = (change: (data: FakeWorkspaceData) => FakeWorkspaceData) =>
    Effect.sync(() => {
      workspace.data = change(workspace.data);
    });

  const account = HttpApiBuilder.group(
    WorkspaceCustomerApi,
    "account",
    (handlers) =>
      handlers
        .handle("getAccount", () =>
          Effect.sync(() => accountView(workspace.data))
        )
        .handle("updateProfile", ({ payload }) =>
          Effect.flatMap(linkedAccount, (current) =>
            update((data) => ({
              ...data,
              account: { ...current, profile: storedProfile(payload) },
            }))
          ).pipe(Effect.as({ status: "updated" as const }))
        )
        .handle("completeProfile", ({ payload }) =>
          Effect.suspend(() => {
            const current = workspace.data.account;
            if (current.kind !== "completion-required") {
              return Effect.fail(
                new CustomerAccountLinkRequired({
                  reason: linkRequiredReason(current),
                })
              );
            }
            return update((data) => ({
              ...data,
              account: {
                kind: "linked",
                email: current.email,
                deletion: current.deletion,
                passkeys: current.passkeys,
                assistants: current.assistants,
                profile: storedProfile(payload),
                avatar: { kind: "available", avatar: null },
                referralsEnabled: current.referralsEnabled,
                referrals: data.referrals,
              },
            })).pipe(Effect.as({ status: "completed" as const }));
          })
        )
        .handle("uploadAvatar", () =>
          Effect.flatMap(linkedAccount, (current) => {
            const avatar = {
              url: `${fakeWorkspaceOrigin}/avatars/sample.png`,
              version: Date.now(),
            };
            return update((data) => ({
              ...data,
              account: { ...current, avatar: { kind: "available", avatar } },
            })).pipe(Effect.as(avatar));
          })
        )
        .handle("removeAvatar", () =>
          Effect.flatMap(linkedAccount, (current) =>
            update((data) => ({
              ...data,
              account: {
                ...current,
                avatar: { kind: "available", avatar: null },
              },
            }))
          )
        )
        .handle("listPasskeys", () =>
          Effect.suspend(() =>
            workspace.data.account.passkeys === undefined
              ? Effect.fail(
                  new CustomerFeatureUnavailable({ feature: "passkeys" })
                )
              : Effect.succeed(workspace.data.passkeys)
          )
        )
        .handle("listAssistantConnections", () =>
          Effect.sync(() => workspace.data.assistants)
        )
        .handle("getMarketingPreferences", () =>
          Effect.flatMap(linkedAccount, () =>
            Effect.sync(() => workspace.data.marketing)
          )
        )
        .handle("saveMarketingPreferences", ({ payload }) =>
          Effect.flatMap(linkedAccount, () =>
            payload.context === workspace.data.marketing.context
              ? update((data) => ({
                  ...data,
                  marketing: {
                    status: payload.granted ? "active" : "withdrawn",
                    context: `${data.marketing.context}+`,
                  },
                }))
              : Effect.fail(
                  new CustomerMarketingPreferencesRejected({
                    reason: "stale-context",
                  })
                )
          )
        )
        .handle("getReferrals", () =>
          Effect.flatMap(linkedAccount, (current) =>
            current.referralsEnabled
              ? Effect.succeed(workspace.data.referrals)
              : Effect.fail(
                  new CustomerFeatureUnavailable({ feature: "referrals" })
                )
          )
        )
        .handle("acknowledgeSignupReferral", () => Effect.void)
        .handle("requestDeletion", () =>
          Effect.sync(() => {
            const status = workspace.deletionOutcome;
            if (status === "deleted") workspace.signedIn = false;
            return { status };
          })
        )
  );

  const reservations = HttpApiBuilder.group(
    WorkspaceCustomerApi,
    "reservations",
    (handlers) =>
      handlers
        .handle("listReservations", () =>
          Effect.suspend(() => {
            const current = workspace.data.account;
            return current.kind === "linked" ||
              current.kind === "review-account"
              ? Effect.succeed(workspace.data.history)
              : Effect.fail(
                  new CustomerAccountLinkRequired({
                    reason: linkRequiredReason(current),
                  })
                );
          })
        )
        .handle("getReservationStatus", ({ params }) =>
          Effect.map(order(params.orderId), (found) => found.state)
        )
        .handle("getReservationAccess", ({ params }) =>
          Effect.flatMap(order(params.orderId), (found) =>
            found.access === undefined
              ? Effect.fail(new CustomerAccessCodeUnavailable())
              : Effect.succeed(found.access)
          )
        )
        .handle("getReservationInvoice", ({ params }) =>
          Effect.flatMap(order(params.orderId), (found) =>
            found.invoice === undefined
              ? Effect.fail(new CustomerInvoiceNotIssued())
              : Effect.succeed(found.invoice)
          )
        )
  );

  const booking = HttpApiBuilder.group(
    WorkspaceCustomerApi,
    "booking",
    (handlers) => handlers
  );

  const auth = HttpApiBuilder.group(CustomerAuthHttpApi, "auth", (handlers) =>
    handlers
      .handle("getSession", () =>
        Effect.sync(() =>
          workspace.signedIn
            ? {
                session: {
                  id: "sample-session-1",
                  userId: workspace.data.accountId,
                  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                },
                user: {
                  id: workspace.data.accountId,
                  email: workspace.data.account.email,
                  emailVerified: true,
                  name: "",
                },
              }
            : null
        )
      )
      .handle("signOut", () =>
        Effect.sync(() => {
          workspace.signedIn = false;
          return { success: true };
        })
      )
      .handle("updatePasskey", ({ payload }) =>
        Effect.suspend(
          (): BetterAuthAnswer<{
            readonly passkey: {
              readonly id: string;
              readonly name: string;
              readonly createdAt: string;
            };
          }> => {
            const passkey = workspace.data.passkeys.find(
              (candidate) => candidate.id === payload.id
            );
            if (passkey === undefined)
              return betterAuthNotFound({ code: "PASSKEY_NOT_FOUND" });
            return update((data) => ({
              ...data,
              passkeys: data.passkeys.map((candidate) =>
                candidate.id === payload.id
                  ? { ...candidate, name: payload.name }
                  : candidate
              ),
            })).pipe(
              Effect.as({
                passkey: {
                  id: passkey.id,
                  name: payload.name,
                  createdAt: passkey.createdAt,
                },
              })
            );
          }
        )
      )
      .handle("deletePasskey", ({ payload }) =>
        Effect.suspend((): BetterAuthAnswer<{ readonly status: boolean }> => {
          if (
            !workspace.data.passkeys.some(
              (candidate) => candidate.id === payload.id
            )
          ) {
            return betterAuthNotFound({ code: "PASSKEY_NOT_FOUND" });
          }
          return update((data) => ({
            ...data,
            passkeys: data.passkeys.filter(
              (candidate) => candidate.id !== payload.id
            ),
          })).pipe(Effect.as({ status: true }));
        })
      )
      .handle("deleteConsent", ({ payload }) =>
        Effect.suspend((): BetterAuthAnswer<void> => {
          if (
            !workspace.data.assistants.some(
              (candidate) => candidate.id === payload.id
            )
          ) {
            return betterAuthNotFound({
              error: "not_found",
              error_description: "no consent",
            });
          }
          return update((data) => ({
            ...data,
            assistants: data.assistants.filter(
              (candidate) => candidate.id !== payload.id
            ),
          }));
        })
      )
  );

  const customerMiddleware = Layer.mergeAll(
    Layer.succeed(CustomerRequestOriginCheck, (httpEffect) =>
      HttpServerRequest.HttpServerRequest.pipe(
        Effect.filterOrFail(
          (request) =>
            request.headers[customerApiClientHeader.name] ===
              customerApiClientHeader.value &&
            request.headers.origin === undefined,
          () => new CustomerRequestRejected({})
        ),
        Effect.andThen(httpEffect)
      )
    ),
    // Injected outcomes are answered as the Workspace's own middleware would.
    Layer.succeed(CustomerSessionAuthentication, (httpEffect, { endpoint }) =>
      Effect.gen(function* () {
        const name = endpoint.name as EndpointName;
        workspace.calls.push(name);
        const outcome = workspace.nextOutcome(name);
        if (outcome === "session-required" || !workspace.signedIn) {
          return yield* new CustomerSessionRequired();
        }
        if (outcome === "rate-limited") return yield* new CustomerRateLimited();
        if (outcome === "service-unavailable") {
          return yield* new CustomerServiceUnavailable();
        }
        if (outcome === "hang") return yield* Effect.never;
        const response = yield* Effect.provideService(
          httpEffect,
          CurrentCustomerSession,
          {
            accountId: workspace.data.accountId,
            email: workspace.data.account.email,
          }
        );
        if (outcome === "transport-failure") return brokenConnection();
        if (outcome === "unreadable-answer") {
          return HttpServerResponse.text("<html>gateway</html>", {
            status: 200,
            contentType: "application/json",
          });
        }
        return response;
      })
    )
  );

  return Layer.mergeAll(
    HttpApiBuilder.layer(WorkspaceCustomerApi).pipe(
      Layer.provide(Layer.mergeAll(account, reservations, booking)),
      Layer.provide(customerMiddleware)
    ),
    HttpApiBuilder.layer(CustomerAuthHttpApi).pipe(Layer.provide(auth))
  ).pipe(Layer.provide(HttpServer.layerServices));
};

// Better Auth refuses a missing resource with 404 and its own body, such as
// `{ code: "PASSKEY_NOT_FOUND" }`. Failing with `CustomerAuthRejected` would
// not do: every reason shares that class, so the server encodes it with the
// first schema, as 400 invalid-request.
const betterAuthNotFound = (body: Readonly<Record<string, string>>) =>
  Effect.succeed(HttpServerResponse.jsonUnsafe(body, { status: 404 }));

/** A handler's answer, or a response it gives as Better Auth would. */
type BetterAuthAnswer<A> = Effect.Effect<
  A | HttpServerResponse.HttpServerResponse
>;

// The server marks a response whose connection the client must see break.
const brokenConnectionHeader = "x-fake-workspace-broken-connection";
const brokenConnection = () =>
  HttpServerResponse.empty({
    status: 500,
    headers: { [brokenConnectionHeader]: "1" },
  });

// Better Auth endpoints have no customer middleware, so the client records
// them and answers their injected outcomes and signed-out mutations as Better
// Auth does.
const endpointOfAuthPath: Record<string, EndpointName> = {
  "/api/auth/get-session": "getSession",
  "/api/auth/sign-out": "signOut",
  "/api/auth/passkey/update-passkey": "updatePasskey",
  "/api/auth/passkey/delete-passkey": "deletePasskey",
  "/api/auth/oauth2/delete-consent": "deleteConsent",
};

const betterAuthRefusal = (
  outcome: FakeRequestOutcome | undefined,
  signedIn: boolean
): Response | undefined => {
  const json = (status: number, body: object) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  if (outcome === "session-required" || !signedIn) {
    return json(401, { code: "UNAUTHORIZED" });
  }
  if (outcome === "rate-limited") return json(429, {});
  if (outcome === "service-unavailable") return json(503, {});
  if (outcome === "session-not-fresh") {
    return json(403, { code: "SESSION_NOT_FRESH" });
  }
  return undefined;
};

/** An `HttpClient` that sends requests to the fake Workspace in memory. */
export const fakeWorkspaceHttpClient = (
  workspace: FakeWorkspace
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(serverLayer(workspace), {
            disableLogger: true,
          })
        ),
        (handler) => Effect.promise(() => handler.dispose())
      );
      return HttpClient.make((request, url) =>
        Effect.gen(function* () {
          const authEndpoint = endpointOfAuthPath[url.pathname];
          const authOutcome =
            authEndpoint === undefined
              ? undefined
              : workspace.nextOutcome(authEndpoint);
          if (authEndpoint !== undefined) workspace.calls.push(authEndpoint);
          if (authOutcome === "hang") return yield* Effect.never;
          const refusal =
            authEndpoint === undefined
              ? undefined
              : betterAuthRefusal(
                  authOutcome,
                  workspace.signedIn || authEndpoint === "getSession"
                );
          if (refusal !== undefined) {
            return HttpClientResponse.fromWeb(request, refusal);
          }
          const webRequest = yield* Effect.orDie(
            HttpClientRequest.toWeb(request)
          );
          const response = yield* Effect.promise(() =>
            server.handler(webRequest)
          );
          if (
            authOutcome === "transport-failure" ||
            response.headers.has(brokenConnectionHeader)
          ) {
            return yield* new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            });
          }
          return HttpClientResponse.fromWeb(request, response);
        })
      );
    })
  );
