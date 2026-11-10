import { isSupportedLocale } from "@deskohub/i18n/locale-registry";
import {
  CurrentCustomerSession,
  CustomerAccessCodeUnavailable,
  type CustomerAccountApi,
  type CustomerAccountDeletionResult,
  CustomerAccountLinkRequired,
  type CustomerAccountState,
  type CustomerAuthEndpoints,
  CustomerAuthApi as CustomerAuthHttpApi,
  CustomerAvatarRejected,
  type CustomerAvatarRejectionReason,
  CustomerFeatureUnavailable,
  CustomerInvoiceNotIssued,
  CustomerMarketingPreferencesRejected,
  type CustomerOrderStatus,
  type CustomerProfile,
  type CustomerProfileSave,
  CustomerRateLimited,
  CustomerRequestOriginCheck,
  CustomerRequestRejected,
  CustomerReservationNotFound,
  type CustomerReservationOrderId,
  type CustomerReservationsApi,
  CustomerServiceUnavailable,
  CustomerSessionAuthentication,
  CustomerSessionRequired,
  customerApiClientHeader,
  type ProfileCompletionReferralOutcome,
  profileCompletionSaveOf,
  profileUpdateSaveOf,
  type SaveCustomerAnalyticsPreference,
  type SyncCustomerAnalyticsConsent,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Clock, Effect, Layer, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Multipart,
} from "effect/unstable/http";
import {
  HttpApiBuilder,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import { fakeBookingGroup } from "../../booking/testing/fake-booking-api";
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
   * How first-time completion answers a submitted referral code: the outcome
   * it reports (and stores on the linked account), or `"unavailable"`, which
   * refuses the completion and creates nothing.
   */
  referralCodeAnswer: ProfileCompletionReferralOutcome | "unavailable" = {
    status: "applied",
  };
  /**
   * How the next deletion request ends. Only `deleted` deletes the account
   * and ends the session.
   */
  deletionOutcome: CustomerAccountDeletionResult["status"] = "deleted";
  /** Endpoint names in the order requests reached them. */
  readonly calls: EndpointName[] = [];
  /**
   * The account's current analytics decision, if it made one; `notice` says
   * whether a grant was given under the current privacy notice.
   */
  analyticsDecision: FakeAnalyticsDecision | undefined;
  /** What each analytics consent sync sent, in order. */
  readonly analyticsSyncs: SyncCustomerAnalyticsConsent[] = [];
  /** What each analytics preference save sent, in order. */
  readonly analyticsPreferenceSaves: SaveCustomerAnalyticsPreference[] = [];
  /**
   * Runs while an analytics consent sync or preference save is handled,
   * before it answers, as when the device changes meanwhile.
   */
  onAnalyticsConsentRequest: (() => void) | undefined;
  /**
   * Awaited before an analytics consent sync answers, as a slow response;
   * the answer is the account's decision once it settles.
   */
  analyticsSyncDelay: Promise<void> | undefined;
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

  /** Moves a sample order to `status`; other data stays. */
  setOrderStatus(
    orderId: CustomerReservationOrderId,
    status: CustomerOrderStatus
  ) {
    const order = this.data.orders.get(orderId);
    if (order === undefined) throw new Error(`no sample order ${orderId}`);
    this.data = {
      ...this.data,
      orders: new Map(this.data.orders).set(orderId, {
        ...order,
        state: { ...order.state, status },
      }),
    };
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

  /** The parts of each avatar upload the Workspace admitted, in order. */
  readonly avatarUploads: Array<ReadonlyArray<FakeAvatarUploadPart>> = [];
  private readonly avatarRejections: CustomerAvatarRejectionReason[] = [];

  /** Refuses the next admitted avatar upload with `reason` (422). */
  rejectNextAvatar(reason: CustomerAvatarRejectionReason) {
    this.avatarRejections.push(reason);
  }

  /** @internal Takes the next queued avatar refusal. */
  nextAvatarRejection(): CustomerAvatarRejectionReason | undefined {
    return this.avatarRejections.shift();
  }
}

/** The account's analytics decision as the fake Workspace keeps it. */
export interface FakeAnalyticsDecision {
  readonly granted: boolean;
  readonly decidedAt: string;
  readonly notice: "current" | "earlier";
}

/**
 * The Workspace's sync rules in brief: a device choice newer than the
 * account's decision becomes it; the answer is the account's withdrawal over
 * an accepting choice it didn't take, or its current-notice grant for a
 * device without a choice.
 */
const syncAnalyticsConsent = (
  workspace: FakeWorkspace,
  { choice }: SyncCustomerAnalyticsConsent
) => {
  const current = workspace.analyticsDecision;
  if (choice === null) {
    return current?.granted && current.notice === "current"
      ? { kind: "grant" as const, decidedAt: current.decidedAt }
      : { kind: "unchanged" as const };
  }
  const mirrored =
    current === undefined ||
    Date.parse(choice.decidedAt) > Date.parse(current.decidedAt);
  if (mirrored) {
    workspace.analyticsDecision = {
      granted: choice.analytics,
      decidedAt: new Date(Date.parse(choice.decidedAt)).toISOString(),
      notice: "current",
    };
    return { kind: "unchanged" as const };
  }
  return choice.analytics && !current.granted
    ? { kind: "withdraw" as const, decidedAt: current.decidedAt }
    : { kind: "unchanged" as const };
};

/** One part of an avatar upload body, as the fake Workspace read it. */
export type FakeAvatarUploadPart =
  | {
      readonly _tag: "File";
      readonly field: string;
      readonly name: string;
      readonly contentType: string;
      readonly bytes: Uint8Array;
    }
  | { readonly _tag: "Field"; readonly field: string; readonly value: string };

// Reads every part of an upload body. A body the multipart parser can't read,
// such as a React Native URI part in the on-device sample-data mode, records
// no parts; other failures surface.
const avatarUploadParts = (
  payload: Stream.Stream<Multipart.Part, Multipart.MultipartError>
) =>
  payload.pipe(
    Stream.mapEffect(
      (part): Effect.Effect<FakeAvatarUploadPart, Multipart.MultipartError> =>
        Multipart.isFile(part)
          ? Effect.map(part.contentEffect, (bytes) => ({
              _tag: "File" as const,
              field: part.key,
              name: part.name,
              contentType: part.contentType,
              bytes,
            }))
          : Effect.succeed({
              _tag: "Field" as const,
              field: part.key,
              value: Multipart.isField(part) ? part.value : "",
            })
    ),
    Stream.runCollect,
    Effect.catchTag("MultipartError", () => Effect.succeed([]))
  );

// The saved language the Workspace's session check reads with the session.
const savedLocaleOf = ({ locale }: CustomerAccountState) =>
  locale !== null && isSupportedLocale(locale) ? locale : null;

// Dotypos stores a cleared phone as blank, which reads back as no phone.
const storedProfile = (input: CustomerProfileSave): CustomerProfile => ({
  firstName: input.firstName,
  lastName: input.lastName ?? null,
  phone: input.phone || null,
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
          Effect.all([linkedAccount, profileUpdateSaveOf(payload)]).pipe(
            Effect.flatMap(([current, save]) =>
              update((data) => ({
                ...data,
                account: { ...current, profile: storedProfile(save) },
              }))
            ),
            Effect.as({ status: "updated" as const })
          )
        )
        // Any signed-in account saves its language, except while its
        // deletion is pending.
        .handle("updateLocale", ({ payload: { locale } }) =>
          Effect.suspend(() =>
            workspace.data.account.kind === "deletion-pending"
              ? Effect.fail(
                  new CustomerAccountLinkRequired({
                    reason: "deletion-pending",
                  })
                )
              : update((data) => ({
                  ...data,
                  account: { ...data.account, locale },
                }))
          ).pipe(Effect.as({ locale }))
        )
        .handle("completeProfile", ({ payload }) =>
          Effect.flatMap(profileCompletionSaveOf(payload), (save) =>
            Effect.suspend(
              (): Effect.Effect<
                | {
                    readonly status: "completed";
                    readonly referral?: ProfileCompletionReferralOutcome;
                  }
                | { readonly status: "referral-code-unavailable" },
                CustomerAccountLinkRequired
              > => {
                const current = workspace.data.account;
                if (current.kind !== "completion-required") {
                  return Effect.fail(
                    new CustomerAccountLinkRequired({
                      reason: linkRequiredReason(current),
                    })
                  );
                }
                const answer = workspace.referralCodeAnswer;
                if (save.referralCode !== undefined && answer === "unavailable")
                  return Effect.succeed({
                    status: "referral-code-unavailable" as const,
                  });
                const referral =
                  save.referralCode === undefined || answer === "unavailable"
                    ? undefined
                    : answer;
                return update((data) => ({
                  ...data,
                  account: {
                    kind: "linked",
                    email: current.email,
                    deletion: current.deletion,
                    passkeys: current.passkeys,
                    assistants: current.assistants,
                    locale: current.locale,
                    profile: storedProfile(save),
                    avatar: { kind: "available", avatar: null },
                    referralsEnabled: current.referralsEnabled,
                    referrals: data.referrals,
                    ...(referral && { signupReferral: referral }),
                  },
                })).pipe(
                  Effect.as({
                    status: "completed" as const,
                    ...(referral && { referral }),
                  })
                );
              }
            )
          )
        )
        .handle("uploadAvatar", ({ payload }) =>
          Effect.Do.pipe(
            // Admitted only while avatars are released for a linked account.
            Effect.bind("current", () =>
              Effect.filterOrFail(
                linkedAccount,
                (account) => account.avatar.kind !== "hidden",
                () => new CustomerFeatureUnavailable({ feature: "avatars" })
              )
            ),
            Effect.bind("parts", () => avatarUploadParts(payload)),
            Effect.tap(({ parts }) =>
              Effect.sync(() => workspace.avatarUploads.push(parts))
            ),
            Effect.tap(() =>
              Effect.suspend(() => {
                const reason = workspace.nextAvatarRejection();
                return reason === undefined
                  ? Effect.void
                  : Effect.fail(new CustomerAvatarRejected({ reason }));
              })
            ),
            Effect.flatMap(({ current }) => {
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
        )
        .handle("removeAvatar", () =>
          Effect.filterOrFail(
            linkedAccount,
            (account) => account.avatar.kind !== "hidden",
            () => new CustomerFeatureUnavailable({ feature: "avatars" })
          ).pipe(
            Effect.flatMap((current) =>
              update((data) => ({
                ...data,
                account: {
                  ...current,
                  avatar: { kind: "available", avatar: null },
                },
              }))
            )
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
        .handle("syncAnalyticsConsent", ({ payload }) =>
          Effect.sync(() => {
            workspace.analyticsSyncs.push(payload);
            workspace.onAnalyticsConsentRequest?.();
          }).pipe(
            Effect.andThen(
              Effect.promise(
                () => workspace.analyticsSyncDelay ?? Promise.resolve()
              )
            ),
            Effect.map(() => syncAnalyticsConsent(workspace, payload))
          )
        )
        .handle("getAnalyticsPreference", () =>
          Effect.sync(() => ({
            granted: workspace.analyticsDecision?.granted ?? false,
          }))
        )
        // The decision is made now, answered to the millisecond.
        .handle("saveAnalyticsPreference", ({ payload }) =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            const { granted } = payload;
            workspace.analyticsPreferenceSaves.push(payload);
            workspace.onAnalyticsConsentRequest?.();
            const decidedAt = new Date(now).toISOString();
            workspace.analyticsDecision = {
              granted,
              decidedAt,
              notice: "current",
            };
            return { granted, decidedAt };
          })
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
        .handle("acknowledgeSignupReferral", () =>
          Effect.flatMap(linkedAccount, ({ signupReferral: _, ...current }) =>
            update((data) => ({ ...data, account: current }))
          )
        )
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

  const booking = fakeBookingGroup(workspace);

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
                  locale: workspace.data.account.locale,
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
            locale: savedLocaleOf(workspace.data.account),
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
