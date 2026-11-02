import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerAgentSessionState } from "@/features/account/components/customer-agent-session.server";
import { customerAgentAuthorizePath } from "@/features/account/customer-agent-routes";
import {
  signInPurposeParam,
  signInReturnParam,
} from "@/features/account/routes";
import { m } from "@/features/i18n";

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
mock.module("@/features/account/components/customer-agent-notice", () => ({
  CustomerAgentNotice: ({ notice }: { readonly notice: string }) => (
    <p data-notice={notice} />
  ),
}));

const connectQuery = {
  client_id: "https://agent.example/client.json",
  redirect_uri: "https://agent.example/callback",
  scope: "reservations:read",
};

async function renderConnectPage(query: Record<string, string>) {
  const { default: CustomerAgentConnectPage } = await import("./page");
  const page: ReactNode = await CustomerAgentConnectPage({
    searchParams: Promise.resolve(query),
  });
  return renderToStaticMarkup(page);
}

/** Where rendering the page redirected, failing if it rendered instead. */
async function redirectOf(query: Record<string, string>) {
  const rendered = renderConnectPage(query);
  await expect(rendered).rejects.toBeInstanceOf(RedirectSignal);
  const location = await rendered.catch(
    (signal: RedirectSignal) => signal.location
  );
  return new URL(location, "https://site.test");
}

const noticeOf = (markup: string) =>
  /<main[^>]*>.*?data-notice="([^"]*)"/s.exec(markup)?.[1];

test("keeps the connect step out of search results", async () => {
  const { generateMetadata } = await import("./page");

  expect(await generateMetadata()).toEqual({
    title: m.customerAgentConnectMetadataTitle({}, { locale: "en-US" }),
    description: m.customerAgentConnectMetadataDescription(
      {},
      { locale: "en-US" }
    ),
    robots: { index: false, follow: false },
  });
});

describe("CustomerAgentConnectPage", () => {
  afterEach(() => {
    session = "signed-in";
  });

  test("sends a signed-in customer on to the authorization request", async () => {
    const target = await redirectOf(connectQuery);

    expect(target.pathname).toBe(customerAgentAuthorizePath);
    expect(Object.fromEntries(target.searchParams)).toEqual(connectQuery);
  });

  test("sends a signed-out customer to sign in and back to this step", async () => {
    session = "signed-out";
    const target = await redirectOf(connectQuery);
    const returnTo = new URL(
      target.searchParams.get(signInReturnParam) ?? "",
      "https://site.test"
    );

    expect(target.pathname).toBe("/en-US/auth/sign-in");
    expect(target.searchParams.get(signInPurposeParam)).toBe("assistant");
    expect(returnTo.pathname).toBe("/en-US/auth/connect");
    expect(returnTo.searchParams.get("client_id")).toBe(connectQuery.client_id);
  });

  test("explains a request that names no client", async () => {
    const markup = await renderConnectPage({ scope: "reservations:read" });

    expect(noticeOf(markup)).toBe("unknown-request");
  });

  test("stops a deletion-pending or unreadable session", async () => {
    session = "deletion-pending";
    const deletionPending = await renderConnectPage(connectQuery);
    session = "unavailable";
    const unavailable = await renderConnectPage(connectQuery);

    expect(noticeOf(deletionPending)).toBe("deletion-pending");
    expect(noticeOf(unavailable)).toBe("unavailable");
  });
});
