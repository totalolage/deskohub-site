import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertReservationAccessExchange,
  isReservationCustomerEmailIdentity,
  parseReservationEmailAccessLink,
  retrieveReservationCustomerEmail,
  verifyReservationEmailCapabilityNavigation,
} from "./reservation-email-capability";

const baseUrl = "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app";
const bypassSecret = "preview-protection-secret";
const orderId = workspaceReservationIdSchema.make(
  "workspace-reservation-email-capability"
);
const otherOrderId = workspaceReservationIdSchema.make(
  "workspace-reservation-email-capability-other"
);
const token = "legacy-reservation-access-token";
const deliveryId = "re_0123456789abcdef";

const accessUrl = (overrides: { orderId?: string; query?: string } = {}) =>
  `${baseUrl}/en-US/reservation/access/${overrides.orderId ?? orderId}?accessToken=${token}&x-vercel-protection-bypass=${bypassSecret}&x-vercel-set-bypass-cookie=true${overrides.query ?? ""}`;

const linkBody = (url: string) => ({
  html: `<a href="${url.replaceAll("&", "&amp;")}">Show access code</a>`,
  text: url,
});

const config = {
  baseUrl,
  bypassSecret,
} as const;
const browserConfig: WorkspaceE2EConfig = {
  ...config,
  expectedHost: new URL(baseUrl).host,
  timeouts: workspaceE2ETimeouts,
};
const recipient = "synthetic@example.test";
const startedAt = new Date("2099-01-01T00:00:00.000Z");

type NavigationAuthorization = "scoped" | "any-cookie-all-orders";

const makeNavigationRunner = (authorization: NavigationAuthorization) => {
  type Session = {
    readonly cookieOrders: Set<string>;
    currentOrder?: string;
  };
  type Call = {
    readonly args: readonly string[];
    readonly command: string;
    readonly options: Parameters<Runner>[2];
    readonly session: string;
    readonly url?: string;
  };

  const sessions = new Map<string, Session>();
  const calls: Call[] = [];
  const faviconUrl = new URL("/favicon.svg", baseUrl).toString();
  const targetStatusUrl = `${baseUrl}/en-US/reservation/status/${orderId}`;
  const otherStatusUrl = `${baseUrl}/en-US/reservation/status/${otherOrderId}`;

  const run: Runner = async (_command, args, options) => {
    const session = args[1];
    if (!session) throw new Error("session missing");
    const command = ["request", "open", "wait", "eval"].find((value) =>
      args.includes(value)
    );
    if (!command) throw new Error("command missing");
    const commandIndex = args.indexOf(command);
    let url: string | undefined;
    if (command === "request") url = args[commandIndex + 2];
    else if (command === "open") url = args[commandIndex + 1];
    calls.push({ args, command, options, session, url });

    const state = sessions.get(session) ?? { cookieOrders: new Set<string>() };
    sessions.set(session, state);

    if (command === "request") {
      if (url === faviconUrl) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: '{"cookies":[],"setCookies":[],"status":200}',
        };
      }
      if (url === accessUrl()) {
        state.cookieOrders.add(orderId);
        const expires = Math.floor(Date.now() / 1000) + 60;
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            cookies: [
              {
                domain: new URL(baseUrl).hostname,
                expires,
                httpOnly: true,
                name: getReservationAccessCookieName(orderId),
                path: "/",
                sameSite: "Lax",
                secure: true,
              },
            ],
            locationMatches: true,
            setCookies: [
              {
                hasExpires: true,
                httpOnly: true,
                maxAge: 60,
                name: getReservationAccessCookieName(orderId),
                path: "/",
                sameSite: "lax",
                secure: true,
              },
            ],
            status: 307,
          }),
        };
      }
      throw new Error(`unexpected request URL: ${url}`);
    }

    if (command === "open") {
      if (url === targetStatusUrl) state.currentOrder = orderId;
      else if (url === otherStatusUrl) state.currentOrder = otherOrderId;
      else throw new Error(`unexpected open URL: ${url}`);
      return { exitCode: 0, stderr: "", stdout: url };
    }

    if (command === "eval") {
      if (options?.input?.includes("document.body?.innerText ??")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout:
            state.currentOrder === orderId
              ? "Your reservation is confirmed."
              : "",
        };
      }
      const authorized =
        state.currentOrder === orderId && state.cookieOrders.has(orderId);
      const anyCookieAuthorizes =
        authorization === "any-cookie-all-orders" &&
        state.cookieOrders.size > 0;
      let stdout = "false";
      if (state.currentOrder === orderId && authorized) stdout = "true";
      else if (state.currentOrder === otherOrderId && !anyCookieAuthorizes)
        stdout = "true";
      return {
        exitCode: 0,
        stderr: "",
        stdout,
      };
    }

    return { exitCode: 0, stderr: "", stdout: "" };
  };

  return { calls, run };
};

const makeNavigationInput = (run: Runner) => ({
  accessLink: { token, url: accessUrl() },
  cleanAccessUrl: `${baseUrl}/en-US/reservation/access/${orderId}`,
  config: browserConfig,
  data: { email: recipient, locale: "en-US" as const },
  localReservationId: otherOrderId,
  orderId,
  run,
  session: "email-isolated",
  statusUrl: `${baseUrl}/en-US/reservation/status/${orderId}`,
});

test("checks the target and other reservation after exchange in one session", async () => {
  const scoped = makeNavigationRunner("scoped");

  await Effect.runPromise(
    verifyReservationEmailCapabilityNavigation(makeNavigationInput(scoped.run))
  );

  expect(
    scoped.calls.map(({ command, session, url }) => [command, session, url])
  ).toEqual([
    ["request", "email-isolated", new URL("/favicon.svg", baseUrl).toString()],
    ["request", "email-isolated", accessUrl()],
    [
      "open",
      "email-isolated",
      `${baseUrl}/en-US/reservation/status/${orderId}`,
    ],
    ["eval", "email-isolated", undefined],
    ["eval", "email-isolated", undefined],
    [
      "open",
      "email-isolated",
      `${baseUrl}/en-US/reservation/status/${otherOrderId}`,
    ],
    ["wait", "email-isolated", undefined],
    ["eval", "email-isolated", undefined],
  ]);
  expect(
    scoped.calls
      .filter(({ command }) => command === "request")
      .every(({ args }) => args.includes("--no-har"))
  ).toBe(true);
  const exchangeCall = scoped.calls.find(
    ({ command, url }) => command === "request" && url === accessUrl()
  );
  expect(exchangeCall?.options?.request).toEqual({
    expectedLocation: `${baseUrl}/en-US/reservation/access/${orderId}`,
    maxRedirects: 0,
  });

  const broken = makeNavigationRunner("any-cookie-all-orders");
  await expect(
    Effect.runPromise(
      verifyReservationEmailCapabilityNavigation(
        makeNavigationInput(broken.run)
      )
    )
  ).rejects.toThrow("reservation status was authorized");
});

test("extracts the exact preview access link from synthetic email HTML", () => {
  expect(
    parseReservationEmailAccessLink({
      body: linkBody(accessUrl()),
      config,
      locale: "en-US",
      orderId,
    })
  ).toEqual({ token, url: accessUrl() });
});

test("rejects multiple reservation access links", () => {
  expect(() =>
    parseReservationEmailAccessLink({
      body: linkBody(
        `${accessUrl()} ${accessUrl({ orderId: `${orderId}-other` })}`
      ),
      config,
      locale: "en-US",
      orderId,
    })
  ).toThrow("exactly one reservation access link");
});

test("rejects a reservation access link for another order", () => {
  expect(() =>
    parseReservationEmailAccessLink({
      body: linkBody(accessUrl({ orderId: `${orderId}-other` })),
      config,
      locale: "en-US",
      orderId,
    })
  ).toThrow("exact preview reservation");
});

test("rejects malformed, foreign, and unsupported access links", () => {
  for (const url of [
    accessUrl({ query: "&accessToken=duplicate" }),
    accessUrl({ query: "&redirect=https%3A%2F%2Fevil.example" }),
    accessUrl().replace(baseUrl, "https://other-preview.vercel.app"),
    accessUrl().replace(`accessToken=${token}`, "accessToken="),
    accessUrl().replace("https://", "https://user:password@"),
  ]) {
    expect(() =>
      parseReservationEmailAccessLink({
        body: linkBody(url),
        config,
        locale: "en-US",
        orderId,
      })
    ).toThrow();
  }
});

test("accepts only the exact scoped access cookie exchange metadata", () => {
  const now = Date.parse("2099-01-01T00:00:00Z");
  const cleanAccessUrlValue = `${baseUrl}/en-US/reservation/access/${orderId}`;
  const response = {
    cookies: [
      {
        domain: new URL(baseUrl).hostname,
        expires: now / 1000 + 86_400,
        httpOnly: true,
        name: getReservationAccessCookieName(orderId),
        path: "/",
        sameSite: "Lax",
        secure: true,
      },
    ],
    locationMatches: true,
    setCookies: [
      {
        hasExpires: true,
        httpOnly: true,
        maxAge: 86_400,
        name: getReservationAccessCookieName(orderId),
        path: "/",
        sameSite: "lax",
        secure: true,
      },
    ],
    status: 307,
  };
  expect(() =>
    assertReservationAccessExchange(response, {
      cleanAccessUrl: cleanAccessUrlValue,
      now,
      orderId,
    })
  ).not.toThrow();
});

const listEntry = (
  overrides: {
    readonly created_at?: string;
    readonly id?: string;
    readonly to?: readonly string[];
  } = {}
) => ({
  created_at: startedAt.toISOString(),
  id: deliveryId,
  to: [recipient],
  ...overrides,
});

const makeRetrieval = ({
  listData = [listEntry()],
  retrieved = {},
}: {
  readonly listData?: readonly unknown[];
  readonly retrieved?: {
    readonly html?: string | null;
    readonly id?: string;
    readonly text?: string | null;
    readonly to?: readonly string[];
  };
} = {}) => {
  const requests: Request[] = [];
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return request.url.includes("/emails/")
      ? Response.json({
          html: linkBody(accessUrl()).html,
          id: deliveryId,
          text: linkBody(accessUrl()).text,
          to: [recipient],
          ...retrieved,
        })
      : Response.json({ data: listData });
  };

  const result = Effect.runPromise(
    retrieveReservationCustomerEmail("re_full-access-retrieval-key", {
      deadlineAfterMs: 50,
      pollIntervalMs: 10,
      recipient,
      startedAt,
    }).pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
        )
      )
    )
  );
  return { requests, result };
};

test("lists one exact recipient after checkout start then retrieves its exact id", async () => {
  const { requests, result } = makeRetrieval();

  const retrieved = await result;
  expect(retrieved.id).toBe(deliveryId);
  expect(
    isReservationCustomerEmailIdentity(retrieved, {
      deliveryId,
      recipient,
    })
  ).toBe(true);
  expect(
    isReservationCustomerEmailIdentity(retrieved, {
      deliveryId,
      recipient: "different@example.test",
    })
  ).toBe(false);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.url).toBe("https://api.resend.com/emails?limit=100");
  expect(requests[1]?.url).toBe(`https://api.resend.com/emails/${deliveryId}`);
  expect(requests[0]?.headers.get("authorization")).toBe(
    "Bearer re_full-access-retrieval-key"
  );
});

test("ignores internal messages with a different recipient and fails closed", async () => {
  const { requests, result } = makeRetrieval({
    listData: [listEntry({ to: ["internal@example.test"] })],
  });

  await expect(result).rejects.toThrow("Timed out");
  expect(requests.every((request) => !request.url.includes("/emails/"))).toBe(
    true
  );
});

test("ignores messages created before checkout start and fails closed", async () => {
  const { requests, result } = makeRetrieval({
    listData: [listEntry({ created_at: "2020-01-01T00:00:00.000Z" })],
  });

  await expect(result).rejects.toThrow("Timed out");
  expect(requests.every((request) => !request.url.includes("/emails/"))).toBe(
    true
  );
});

test("rejects duplicate exact-recipient messages as ambiguous", async () => {
  const { requests, result } = makeRetrieval({
    listData: [listEntry(), listEntry({ id: "message-2" })],
  });

  await expect(result).rejects.toThrow("multiple");
  expect(requests).toHaveLength(1);
});

test("rejects a retrieved message whose recipient or id changed", async () => {
  const wrongRecipient = makeRetrieval({
    retrieved: { to: ["internal@example.test"] },
  });
  await expect(wrongRecipient.result).rejects.toThrow("identity");

  const wrongId = makeRetrieval({ retrieved: { id: "message-2" } });
  await expect(wrongId.result).rejects.toThrow("identity");
});

test("maps provider rejection and malformed payloads to fixed errors", async () => {
  const rejectedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return request.url.includes("/emails/")
      ? new Response("provider body", { status: 500 })
      : Response.json({ data: [listEntry()] });
  };
  const rejected = retrieveReservationCustomerEmail("key", {
    deadlineAfterMs: 50,
    pollIntervalMs: 10,
    recipient,
    startedAt,
  }).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, rejectedFetch))
      )
    )
  );
  const rejectedResult = Effect.runPromise(rejected);
  await expect(rejectedResult).rejects.toThrow("unsuccessful response");
  await expect(rejectedResult).rejects.not.toThrow("provider body");

  const malformedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return request.url.includes("/emails/")
      ? Response.json({ id: deliveryId, to: [recipient] })
      : Response.json({ data: [listEntry()] });
  };
  const malformed = retrieveReservationCustomerEmail("key", {
    deadlineAfterMs: 50,
    pollIntervalMs: 10,
    recipient,
    startedAt,
  }).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, malformedFetch))
      )
    )
  );
  await expect(Effect.runPromise(malformed)).rejects.toThrow(
    "payload was invalid"
  );
});
