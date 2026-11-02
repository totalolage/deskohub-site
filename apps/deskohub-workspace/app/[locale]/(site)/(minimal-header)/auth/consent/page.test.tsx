import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerAgentSessionState } from "@/features/account/components/customer-agent-session.server";
import {
  signInPurposeParam,
  signInReturnParam,
} from "@/features/account/routes";

mock.module("server-only", () => ({}));
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
/** What the page's `redirect` throws, carrying where it sends the customer. */
class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`Redirected to ${location}`);
  }
}
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...nextHeaders,
  headers: () => Promise.resolve(new Headers()),
}));

let session: CustomerAgentSessionState = "signed-in";
mock.module(
  "@/features/account/components/customer-agent-session.server",
  () => ({ readCustomerAgentSession: () => Promise.resolve(session) })
);

let findClient: () => Promise<unknown> = () =>
  Promise.resolve({
    client_id: "https://agent.example/client.json",
    client_name: "Example Agent",
  });
// Loading the real module bootstraps Better Auth against Postgres, so the
// mock supplies every export itself.
mock.module("@/features/account/server/auth.server", () => ({
  auth: { api: { getOAuthClientPublic: () => findClient() } },
  customerMcpResource: "http://localhost:3000/api/mcp",
}));

let administratorAccess: Effect.Effect<{ readonly kind: string }, Error> =
  Effect.succeed({ kind: "customer" });
const currentAdministrator = await import(
  "@/features/administrators/backend/current-administrator"
);
mock.module("@/features/administrators/backend/current-administrator", () => ({
  ...currentAdministrator,
  currentAdministratorAccess: Effect.suspend(() => administratorAccess),
}));
mock.module(
  "@/features/administrators/server/administrator-access-layer.server",
  () => ({ administratorAccessLayer: Layer.empty })
);

mock.module("@/features/account/components/customer-agent-notice", () => ({
  CustomerAgentNotice: ({ notice }: { readonly notice: string }) => (
    <p data-notice={notice} />
  ),
}));
mock.module("@/features/account/components/customer-agent-consent", () => ({
  CustomerAgentConsent: ({
    administration,
    client,
    redirect,
    scopes,
  }: {
    readonly administration: boolean;
    readonly client: { readonly name: string; readonly host?: string };
    readonly redirect: { readonly host: string };
    readonly scopes: ReadonlyArray<string>;
  }) => (
    <form
      data-administration={String(administration)}
      data-client={client.name}
      data-client-host={client.host}
      data-redirect-host={redirect.host}
      data-scopes={scopes.join(" ")}
    />
  ),
}));

const inAnHour = () => String(Math.floor(Date.now() / 1000) + 3600);

const consentQuery = (overrides: Record<string, string> = {}) => ({
  client_id: "https://agent.example/client.json",
  redirect_uri: "https://agent.example/callback",
  scope: "reservations:read offline_access",
  exp: inAnHour(),
  sig: "signature",
  ...overrides,
});

async function renderConsentPage(query: Record<string, string>) {
  const { default: CustomerAgentConsentPage } = await import("./page");
  const page: ReactNode = await CustomerAgentConsentPage({
    searchParams: Promise.resolve(query),
  });
  return renderToStaticMarkup(page);
}

/** The value of `attribute` on the first element rendered inside `<main>`. */
const attributeOf = (markup: string, attribute: string) =>
  new RegExp(`<main[^>]*>.*?${attribute}="([^"]*)"`, "s").exec(markup)?.[1];

const noticeOf = (markup: string) => attributeOf(markup, "data-notice");

describe("CustomerAgentConsentPage", () => {
  afterEach(() => {
    session = "signed-in";
    findClient = () =>
      Promise.resolve({
        client_id: "https://agent.example/client.json",
        client_name: "Example Agent",
      });
    administratorAccess = Effect.succeed({ kind: "customer" });
  });

  test("asks a signed-in customer about the requested scopes", async () => {
    const markup = await renderConsentPage(consentQuery());

    expect(attributeOf(markup, "data-client")).toBe("Example Agent");
    expect(attributeOf(markup, "data-client-host")).toBe("agent.example");
    expect(attributeOf(markup, "data-redirect-host")).toBe("agent.example");
    expect(attributeOf(markup, "data-scopes")).toBe(
      "reservations:read offline_access"
    );
    expect(attributeOf(markup, "data-administration")).toBe("false");
  });

  test("offers administration to an administrator", async () => {
    administratorAccess = Effect.succeed({ kind: "administrator" });
    const markup = await renderConsentPage(
      consentQuery({ scope: "administration offline_access" })
    );

    expect(attributeOf(markup, "data-administration")).toBe("true");
  });

  test("explains a request that can't succeed before asking to sign in", async () => {
    session = "signed-out";
    const unsigned = await renderConsentPage(consentQuery({ sig: "" }));
    const expired = await renderConsentPage(
      consentQuery({ exp: String(Math.floor(Date.now() / 1000) - 60) })
    );

    expect(noticeOf(unsigned)).toBe("unknown-request");
    expect(noticeOf(expired)).toBe("expired");
  });

  test("sends a signed-out customer to sign in and back to the request", async () => {
    session = "signed-out";
    const query = consentQuery();
    const rendered = renderConsentPage(query);

    await expect(rendered).rejects.toBeInstanceOf(RedirectSignal);
    const location = await rendered.catch(
      (signal: RedirectSignal) => signal.location
    );
    const target = new URL(location, "https://site.test");
    const returnTo = new URL(
      target.searchParams.get(signInReturnParam) ?? "",
      "https://site.test"
    );
    expect(target.pathname).toBe("/en-US/auth/sign-in");
    expect(target.searchParams.get(signInPurposeParam)).toBe("assistant");
    expect(returnTo.pathname).toBe("/en-US/auth/consent");
    expect(Object.fromEntries(returnTo.searchParams)).toEqual(query);
  });

  test("stops a deletion-pending or unreadable session", async () => {
    session = "deletion-pending";
    const deletionPending = await renderConsentPage(consentQuery());
    session = "unavailable";
    const unavailable = await renderConsentPage(consentQuery());

    expect(noticeOf(deletionPending)).toBe("deletion-pending");
    expect(noticeOf(unavailable)).toBe("unavailable");
  });

  test("stops when the client or administrator grant can't be read", async () => {
    findClient = () => Promise.resolve(null);
    const unknownClient = await renderConsentPage(consentQuery());
    findClient = () => Promise.reject(new Error("connection reset"));
    const clientUnavailable = await renderConsentPage(consentQuery());
    findClient = () =>
      Promise.resolve({
        client_id: "https://agent.example/client.json",
        client_name: "Example Agent",
      });
    administratorAccess = Effect.fail(new Error("grant read failed"));
    const administratorUnavailable = await renderConsentPage(
      consentQuery({ scope: "administration offline_access" })
    );

    expect(noticeOf(unknownClient)).toBe("unknown-request");
    expect(noticeOf(clientUnavailable)).toBe("unavailable");
    expect(noticeOf(administratorUnavailable)).toBe("unavailable");
  });

  test("stops a non-administrator asked only for administration", async () => {
    const markup = await renderConsentPage(
      consentQuery({ scope: "administration offline_access" })
    );

    expect(noticeOf(markup)).toBe("administration-only");
  });
});
