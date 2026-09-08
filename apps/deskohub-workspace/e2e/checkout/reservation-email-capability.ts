import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import type { DatabaseClient } from "@/db/database-client";
import { workspaceReservations } from "@/db/schema";
import { type Locale, m } from "@/features/i18n";
import {
  getReservationAccessCookieName,
  reservationAccessCookieMaxAgeSeconds,
} from "@/features/reservation/backend/reservation-access-cookie";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenSchema } from "@/features/reservation/reservation-access-token";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import {
  type BrowserRequestResult,
  closeBrowserSession,
  evalBrowserScript,
  openBrowserPage,
  readBrowserUrl,
  requestBrowserGet,
  waitForBrowserCondition,
  waitForBrowserText,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { addRedaction, assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type { CheckoutData, WorkspaceE2EStep } from "../types";
import { withWorkspaceE2ELocalReservationFixture } from "./local-reservation-fixture";

const resendApiOrigin = "https://api.resend.com";
const resendListPageSize = 100;
/** Resend timestamps can drift slightly from the checkout runner clock. */
const startedAtSkewMs = 2 * 60 * 1000;

const listedCustomerEmailSchema = Schema.Struct({
  created_at: Schema.String,
  id: Schema.NonEmptyString,
  to: Schema.Array(Schema.NonEmptyString),
});

const listResponseSchema = Schema.Struct({
  data: Schema.Array(listedCustomerEmailSchema),
});

const retrievedCustomerEmailSchema = Schema.Struct({
  html: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  text: Schema.NullOr(Schema.String),
  to: Schema.Array(Schema.NonEmptyString),
});

type RetrievedCustomerEmail = typeof retrievedCustomerEmailSchema.Type;

export type ReservationEmailAccessLink = {
  readonly token: string;
  readonly url: string;
};

export const isReservationCustomerEmailIdentity = (
  email: Pick<RetrievedCustomerEmail, "id" | "to">,
  {
    deliveryId,
    recipient,
  }: {
    readonly deliveryId: string;
    readonly recipient: string;
  }
) =>
  email.id === deliveryId && email.to.length === 1 && email.to[0] === recipient;

export const parseReservationEmailAccessLink = ({
  body,
  config,
  locale,
  orderId,
}: {
  readonly body: { readonly html: string | null; readonly text: string | null };
  readonly config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret">;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
}): ReservationEmailAccessLink => {
  const candidates = extractHttpsUrls(`${body.text ?? ""}\n${body.html ?? ""}`)
    .map((value) => parseUrl(value))
    .filter((value): value is URL => value !== undefined)
    .filter((value) => isReservationAccessPath(value));

  if (candidates.length !== 1) {
    throw new Error(
      "customer email must contain exactly one reservation access link"
    );
  }

  const [candidate] = candidates;
  assert(candidate, "reservation access link is missing");
  const expectedPath = `/${locale}${reservationAccessPath}/${encodeURIComponent(orderId)}`;
  if (
    candidate.protocol !== "https:" ||
    candidate.origin !== config.baseUrl ||
    candidate.username ||
    candidate.password ||
    candidate.pathname !== expectedPath ||
    candidate.hash
  ) {
    throw new Error(
      "reservation access link does not target the exact preview reservation"
    );
  }

  const accessTokens = candidate.searchParams.getAll("accessToken");
  const token = accessTokens[0];
  if (
    accessTokens.length !== 1 ||
    !token ||
    Option.isNone(Schema.decodeOption(reservationAccessTokenSchema)(token))
  ) {
    throw new Error(
      "reservation access link does not contain one valid access token"
    );
  }

  const allowedSearchParams = new Set([
    "accessToken",
    "x-vercel-protection-bypass",
    "x-vercel-set-bypass-cookie",
  ]);
  if (
    [...candidate.searchParams.keys()].some(
      (key) => !allowedSearchParams.has(key)
    )
  ) {
    throw new Error(
      "reservation access link contains unsupported search parameters"
    );
  }

  const bypassTokens = candidate.searchParams.getAll(
    "x-vercel-protection-bypass"
  );
  const setBypassCookie = candidate.searchParams.getAll(
    "x-vercel-set-bypass-cookie"
  );
  if (config.bypassSecret) {
    if (
      bypassTokens.length !== 1 ||
      bypassTokens[0] !== config.bypassSecret ||
      setBypassCookie.length !== 1 ||
      setBypassCookie[0] !== "true"
    ) {
      throw new Error(
        "reservation access link does not contain the exact preview protection parameters"
      );
    }
  } else if (bypassTokens.length > 0 || setBypassCookie.length > 0) {
    throw new Error(
      "reservation access link contains unconfigured preview protection parameters"
    );
  }

  return { token, url: candidate.toString() };
};

export const assertReservationAccessExchange = (
  response: BrowserRequestResult,
  {
    cleanAccessUrl,
    now = Date.now(),
    orderId,
  }: {
    readonly cleanAccessUrl: string;
    readonly now?: number;
    readonly orderId: WorkspaceReservationId;
  }
) => {
  const cookieName = getReservationAccessCookieName(orderId);
  assert(
    response.status === 307,
    "reservation access exchange did not return 307"
  );
  assert(
    response.locationMatches === true,
    "reservation access exchange did not redirect to the clean access URL"
  );

  const setCookies = response.setCookies.filter(
    (cookie) => cookie.name === cookieName
  );
  assert(
    setCookies.length === 1,
    "reservation access exchange did not set exactly one access cookie"
  );
  const [setCookie] = setCookies;
  assert(setCookie, "reservation access exchange access cookie is missing");
  assert(
    setCookie.domain === undefined,
    "reservation access cookie must be host-only"
  );
  assert(
    setCookie.path === "/",
    "reservation access cookie path is not root-scoped"
  );
  assert(setCookie.httpOnly, "reservation access cookie must be HttpOnly");
  assert(setCookie.secure, "reservation access cookie must be Secure");
  assert(
    setCookie.sameSite === "lax",
    "reservation access cookie must be SameSite=Lax"
  );
  assert(
    setCookie.hasExpires &&
      setCookie.maxAge !== undefined &&
      Number.isInteger(setCookie.maxAge) &&
      setCookie.maxAge > 0 &&
      setCookie.maxAge <= reservationAccessCookieMaxAgeSeconds,
    "reservation access cookie expiry is not bounded"
  );

  const cookies = response.cookies.filter(
    (cookie) => cookie.name === cookieName
  );
  assert(
    cookies.length === 1,
    "reservation access exchange did not retain exactly one access cookie"
  );
  const [cookie] = cookies;
  assert(cookie, "reservation access exchange retained cookie is missing");
  assert(
    cookie.domain === new URL(cleanAccessUrl).hostname,
    "retained reservation access cookie is not scoped to the preview host"
  );
  assert(
    cookie.path === "/",
    "retained reservation access cookie path is not root-scoped"
  );
  assert(
    cookie.httpOnly,
    "retained reservation access cookie must be HttpOnly"
  );
  assert(cookie.secure, "retained reservation access cookie must be Secure");
  assert(
    cookie.sameSite.toLowerCase() === "lax",
    "retained reservation access cookie must be SameSite=Lax"
  );
  assert(
    cookie.expires * 1_000 > now &&
      cookie.expires * 1_000 <=
        now + reservationAccessCookieMaxAgeSeconds * 1_000 + 5_000,
    "retained reservation access cookie expiry is not bounded"
  );
};

export const verifyReservationEmailCapabilityNavigation = ({
  accessLink,
  cleanAccessUrl,
  config,
  data,
  localReservationId,
  orderId,
  run,
  session,
  statusUrl,
}: {
  readonly accessLink: ReservationEmailAccessLink;
  readonly cleanAccessUrl: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: Pick<CheckoutData, "email" | "locale">;
  readonly localReservationId: WorkspaceReservationId;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
  readonly statusUrl: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    addRedaction(localReservationId, true);
    const wrongStatusUrl = makeReservationUrl(
      config.baseUrl,
      data.locale,
      reservationStatusPath,
      localReservationId
    );
    addRedaction(wrongStatusUrl);

    const bypassProbe = yield* requestBrowserGet({
      config,
      run,
      session,
      timeoutMs: config.timeouts.browserAction,
      url: new URL("/favicon.svg", config.baseUrl).toString(),
      maxRedirects: 3,
    });
    yield* tryWorkspaceE2ESync(
      "assert reservation email preview access",
      () => {
        assert(
          bypassProbe.status >= 200 && bypassProbe.status < 300,
          "reservation email capability preview access could not be primed"
        );
      }
    );

    const exchange = yield* requestBrowserGet({
      config,
      expectedLocation: cleanAccessUrl,
      run,
      session,
      timeoutMs: config.timeouts.browserAction,
      url: accessLink.url,
    });
    yield* tryWorkspaceE2ESync("assert reservation access exchange", () =>
      assertReservationAccessExchange(exchange, {
        cleanAccessUrl,
        orderId,
      })
    );

    yield* openBrowserPage(config, run, session, statusUrl, {
      logCommand: false,
      logOutput: false,
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserText({
      description: "fulfilled reservation email capability status",
      matches: (text) => /Your reservation is confirmed\./i.test(text),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* assertFulfilledStatusAccessLink({
      config,
      data,
      orderId,
      run,
      session,
    });

    yield* openBrowserPage(config, run, session, wrongStatusUrl, {
      logCommand: false,
      logOutput: false,
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* assertReservationStatusDenied(
      run,
      session,
      localReservationId,
      data.locale
    );
  });

export const assertPaidReservationEmailCapability = ({
  config,
  customerId,
  data,
  orderId,
  run,
  session,
  startedAt,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly customerId: DotyposCustomerId;
  readonly data: Pick<CheckoutData, "email" | "locale">;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
  readonly startedAt: Date;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const resendApiKey = config.resendApiKey;
    if (!resendApiKey) {
      return yield* workspaceE2EError(
        "WORKSPACE_E2E_RESEND_API_KEY is required for reservation email capability coverage",
        { operation: "configure reservation email capability e2e" }
      );
    }

    addRedaction(resendApiKey);
    addRedaction(config.bypassSecret);
    addRedaction(data.email);
    addRedaction(orderId, true);
    addRedaction(customerId, true);

    const { db } = yield* E2EDatabase;
    const reservationState = yield* pollUntil(
      readPaidReservationEmailState(db, orderId, customerId),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "the paid reservation customer email order and customer state",
        timeoutMs: config.timeouts.datasource,
      }
    );
    yield* tryWorkspaceE2ESync(
      "assert paid reservation customer email database state",
      () => {
        assert(
          reservationState.orderId === orderId,
          "paid reservation email order linkage changed"
        );
        assert(
          reservationState.customerId === customerId,
          "paid reservation email customer linkage changed"
        );
        assert(
          reservationState.paymentState === "paid",
          "paid reservation email payment state was not paid"
        );
        assert(
          reservationState.fulfillmentState === "fulfilled",
          "paid reservation email fulfillment state was not fulfilled"
        );
      }
    );

    const email = yield* retrieveReservationCustomerEmail(resendApiKey, {
      recipient: data.email,
      startedAt,
      deadlineAfterMs: config.timeouts.authDelivery,
      pollIntervalMs: workspaceE2EPollIntervalMs.datasource,
    });

    const accessLink = yield* tryWorkspaceE2ESync(
      "extract reservation customer access link",
      () =>
        parseReservationEmailAccessLink({
          body: email,
          config,
          locale: data.locale,
          orderId,
        })
    );
    addRedaction(accessLink.url);
    addRedaction(accessLink.token, true);

    const originalUrl = yield* readBrowserUrl(run, session);
    if (!originalUrl) {
      return yield* workspaceE2EError(
        "the original checkout browser URL was unavailable",
        { operation: "preserve original checkout browser session" }
      );
    }
    addRedaction(originalUrl);

    const isolatedSession = `${session}-reservation-email-${crypto.randomUUID()}`;
    const cleanAccessUrl = new URL(accessLink.url);
    cleanAccessUrl.search = "";
    cleanAccessUrl.hash = "";
    const statusUrl = makeReservationUrl(
      config.baseUrl,
      data.locale,
      reservationStatusPath,
      orderId
    );
    addRedaction(cleanAccessUrl.toString());
    addRedaction(statusUrl);

    yield* withWorkspaceE2ELocalReservationFixture((localFixture) =>
      Effect.gen(function* () {
        assert(
          localFixture.customerId !== customerId,
          "local reservation fixture customer must differ from the paid reservation customer"
        );
        yield* verifyReservationEmailCapabilityNavigation({
          accessLink,
          cleanAccessUrl: cleanAccessUrl.toString(),
          config,
          data,
          localReservationId: localFixture.reservationId,
          orderId,
          run,
          session: isolatedSession,
          statusUrl,
        }).pipe(
          Effect.ensuring(
            closeBrowserSession(run, isolatedSession).pipe(Effect.ignore)
          )
        );
      })
    );

    const finalOriginalUrl = yield* readBrowserUrl(run, session);
    yield* tryWorkspaceE2ESync(
      "assert original checkout browser session was untouched",
      () => {
        assert(
          finalOriginalUrl === originalUrl,
          "reservation email capability changed the original checkout browser session"
        );
      }
    );
    log("Reservation customer email capability validated");
  });

export const reservationEmailCapabilityStep = ({
  config,
  customerId,
  data,
  orderId,
  run,
  session,
  startedAt,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly customerId: DotyposCustomerId;
  readonly data: Pick<CheckoutData, "email" | "locale">;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
  readonly startedAt: Date;
}): WorkspaceE2EStep<void, E2EDatabase | HttpClient.HttpClient> => ({
  execute: assertPaidReservationEmailCapability({
    config,
    customerId,
    data,
    orderId,
    run,
    session,
    startedAt,
  }),
  id: "assert-customer-reservation-email-capability",
  timeoutMs: config.timeouts.authDelivery,
});

const readPaidReservationEmailState = (
  db: DatabaseClient,
  orderId: WorkspaceReservationId,
  customerId: DotyposCustomerId
) =>
  runDatabaseOperation(
    "read paid reservation customer email state",
    db
      .select({
        customerId: workspaceReservations.dotyposCustomerId,
        fulfillmentState: workspaceReservations.fulfillmentState,
        orderId: workspaceReservations.id,
        paymentState: workspaceReservations.paymentState,
      })
      .from(workspaceReservations)
      .where(
        and(
          eq(workspaceReservations.id, orderId),
          eq(workspaceReservations.dotyposCustomerId, customerId),
          eq(workspaceReservations.paymentState, "paid"),
          eq(workspaceReservations.fulfillmentState, "fulfilled")
        )
      )
      .limit(1)
  ).pipe(Effect.map((rows) => rows[0]));

export const retrieveReservationCustomerEmail = (
  resendApiKey: string,
  {
    deadlineAfterMs = 30_000,
    pollIntervalMs = 5_000,
    recipient,
    startedAt,
  }: {
    /** Test-only override; the runner uses the checked-in timeout. */
    readonly deadlineAfterMs?: number;
    /** Test-only override; the runner uses the checked-in poll interval. */
    readonly pollIntervalMs?: number;
    readonly recipient: string;
    readonly startedAt: Date;
  }
): Effect.Effect<
  RetrievedCustomerEmail,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const deliveryId = yield* pollUntil(
      findReservationCustomerEmailId(resendApiKey, {
        minimumCreatedAt: startedAt.getTime() - startedAtSkewMs,
        recipient,
      }),
      {
        intervalMs: pollIntervalMs,
        label: "the unique paid reservation customer email",
        timeoutMs: deadlineAfterMs,
      }
    );
    addRedaction(deliveryId, true);

    const email = yield* retrieveReservationCustomerEmailById(
      resendApiKey,
      deliveryId
    );
    if (!isReservationCustomerEmailIdentity(email, { deliveryId, recipient })) {
      return yield* workspaceE2EError(
        "retrieved reservation customer email identity did not match the paid checkout",
        {
          diagnosticCode: "auth_delivery_message_invalid",
          operation: "verify reservation customer email identity",
        }
      );
    }
    return email;
  });

const findReservationCustomerEmailId = (
  resendApiKey: string,
  bounds: {
    readonly minimumCreatedAt: number;
    readonly recipient: string;
  }
): Effect.Effect<
  string | undefined,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const matches = yield* listReservationCustomerEmailIds(
      resendApiKey,
      bounds
    );
    if (matches.length > 1) {
      return yield* workspaceE2EError(
        "Resend retrieval matched multiple synthetic messages for the exact recipient",
        {
          diagnosticCode: "auth_delivery_message_ambiguous",
          operation: "list reservation customer emails",
        }
      );
    }
    return matches[0];
  });

const listReservationCustomerEmailIds = (
  resendApiKey: string,
  {
    minimumCreatedAt,
    recipient,
  }: {
    readonly minimumCreatedAt: number;
    readonly recipient: string;
  }
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* executeResendRequest(
      resendApiKey,
      `/emails?limit=${resendListPageSize}`,
      "list reservation customer emails"
    );
    const payload = yield* decodeResendResponse(response, listResponseSchema);
    return yield* tryWorkspaceE2ESync(
      "match reservation customer email list entries",
      () =>
        payload.data
          .filter(
            (message) => message.to.length === 1 && message.to[0] === recipient
          )
          .filter(
            (message) =>
              parseResendCreatedAt(message.created_at) >= minimumCreatedAt
          )
          .map((message) => message.id)
    );
  });

const retrieveReservationCustomerEmailById = (
  resendApiKey: string,
  deliveryId: string
): Effect.Effect<
  RetrievedCustomerEmail,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* executeResendRequest(
      resendApiKey,
      `/emails/${encodeURIComponent(deliveryId)}`,
      "retrieve reservation customer email"
    );
    return yield* decodeResendResponse(response, retrievedCustomerEmailSchema);
  });

const executeResendRequest = (
  resendApiKey: string,
  path: string,
  operation: string
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    return yield* httpClient
      .execute(
        HttpClientRequest.get(`${resendApiOrigin}${path}`).pipe(
          HttpClientRequest.setHeaders({
            accept: "application/json",
            authorization: `Bearer ${resendApiKey}`,
          })
        )
      )
      .pipe(
        Effect.mapError(() =>
          workspaceE2EError("reservation customer email retrieval failed", {
            diagnosticCode: "auth_delivery_message_retrieve_failed",
            operation,
          })
        )
      );
  });

const decodeResendResponse = <A>(
  response: HttpClientResponse.HttpClientResponse,
  schema: Schema.Decoder<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.gen(function* () {
    if (response.status < 200 || response.status >= 300) {
      return yield* workspaceE2EError(
        "reservation customer email retrieval returned an unsuccessful response",
        {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "decode reservation customer email payload",
        }
      );
    }
    const body = yield* response.json.pipe(
      Effect.mapError(() =>
        workspaceE2EError("reservation customer email payload was unreadable", {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "decode reservation customer email payload",
        })
      )
    );
    return yield* Schema.decodeEffect(schema)(body).pipe(
      Effect.mapError(() =>
        workspaceE2EError("reservation customer email payload was invalid", {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "decode reservation customer email payload",
        })
      )
    );
  });

export const assertReservationStatusDenied = (
  run: Runner,
  session: string,
  orderId: WorkspaceReservationId,
  locale: Locale
) =>
  Effect.gen(function* () {
    const notFoundTitle = m.checkoutStatusNotFoundTitle({}, { locale });
    yield* waitForBrowserCondition(
      run,
      session,
      "reservation status not-found heading",
      `(() => [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim() === ${JSON.stringify(notFoundTitle)}))()`,
      { timeoutMs: 30_000 }
    );

    const result = yield* evalBrowserScript(
      "assert reservation status is denied",
      run,
      session,
      `(() => document.querySelector("#checkout-status-access") === null && !document.body?.innerText.includes(${JSON.stringify(orderId)}))()`,
      { logCommand: false, logOutput: false, timeoutMs: 30_000 }
    );
    yield* tryWorkspaceE2ESync("assert reservation status is denied", () => {
      assert(
        result.stdout.trim() === "true",
        "reservation status was authorized"
      );
    });
  });

const assertFulfilledStatusAccessLink = ({
  config,
  data,
  orderId,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: Pick<CheckoutData, "email" | "locale">;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
}) => {
  const accessPath = `/${data.locale}${reservationAccessPath}/${encodeURIComponent(orderId)}`;
  const statusPath = `/${data.locale}${reservationStatusPath}/${encodeURIComponent(orderId)}`;
  const cookieName = getReservationAccessCookieName(orderId);
  return evalBrowserScript(
    "assert fulfilled reservation access reciprocal link",
    run,
    session,
    `(() => {
      const accessLink = document.querySelector("#checkout-status-access");
      if (!(accessLink instanceof HTMLAnchorElement)) return false;
      let accessUrl;
      try { accessUrl = new URL(accessLink.href); } catch { return false; }
      const hasAccessCookie = document.cookie.split(";").some((part) =>
        part.trim().startsWith(${JSON.stringify(cookieName)} + "=")
      );
      return location.origin === ${JSON.stringify(config.baseUrl)} &&
        location.pathname === ${JSON.stringify(statusPath)} &&
        location.search === "" &&
        !hasAccessCookie &&
        accessUrl.origin === ${JSON.stringify(config.baseUrl)} &&
        accessUrl.pathname === ${JSON.stringify(accessPath)} &&
        accessUrl.search === "" &&
        accessUrl.hash === "";
    })()`,
    {
      logCommand: false,
      logOutput: false,
      timeoutMs: config.timeouts.browserAction,
    }
  ).pipe(
    Effect.flatMap((result) =>
      tryWorkspaceE2ESync(
        "assert fulfilled reservation access reciprocal link",
        () => {
          assert(
            result.stdout.trim() === "true",
            "fulfilled status page did not expose the reciprocal reservation access link"
          );
        }
      )
    )
  );
};

const makeReservationUrl = (
  baseUrl: string,
  locale: CheckoutData["locale"],
  path: string,
  orderId: WorkspaceReservationId
) =>
  new URL(
    `/${locale}${path}/${encodeURIComponent(orderId)}`,
    baseUrl
  ).toString();

const extractHttpsUrls = (body: string) => {
  const hrefs = [
    ...body.matchAll(/\bhref\s*=\s*(["'])(https:\/\/.*?)\1/gi),
  ].map((match) => match[2]);
  const textUrls = body.match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  return [
    ...new Set(
      [...hrefs, ...textUrls]
        .filter((value): value is string => Boolean(value))
        .map((value) => decodeHtmlEntities(value).replace(/[.,!?]+$/, ""))
    ),
  ];
};

const parseResendCreatedAt = (value: string) => {
  const withoutSpace = value.includes("T") ? value : value.replace(" ", "T");
  const hourOnlyOffset = /([+-]\d\d)$/.exec(withoutSpace);
  let withZone = `${withoutSpace}Z`;
  if (hourOnlyOffset) {
    withZone = `${withoutSpace}:00`;
  } else if (/[z]|[+-]\d\d:\d\d$/i.test(withoutSpace)) {
    withZone = withoutSpace;
  }
  const parsed = Date.parse(withZone);
  if (Number.isNaN(parsed)) {
    throw workspaceE2EError(
      "Resend retrieval returned an unreadable message timestamp",
      {
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        operation: "parse Resend message timestamp",
      }
    );
  }
  return parsed;
};

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const isReservationAccessPath = (url: URL) => {
  const path = url.pathname.split("/");
  return (
    path.length === 5 &&
    path[0] === "" &&
    path[2] === "reservation" &&
    path[3] === "access" &&
    Boolean(path[1]) &&
    Boolean(path[4])
  );
};

const decodeHtmlEntities = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
