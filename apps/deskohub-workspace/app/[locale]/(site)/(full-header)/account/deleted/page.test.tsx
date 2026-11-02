import { afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
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
/** What the page's `redirect` throws, carrying where it sends the visitor. */
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

let currentUser: Effect.Effect<
  CustomerAccountSession | null,
  CustomerAccountAccessError
> = Effect.succeed(null);
const authentication = await import(
  "@/features/account/backend/customer-authentication.service"
);
/** The real service tag, read through `currentUser` above. */
class CustomerAuthentication extends authentication.CustomerAuthentication {
  static override Default = Layer.succeed(
    authentication.CustomerAuthentication,
    { currentUser: Effect.suspend(() => currentUser) }
  );
}
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ ...authentication, CustomerAuthentication })
);

async function renderDeletedPage() {
  const { default: CustomerAccountDeletedPage } = await import("./page");
  const page: ReactNode = await CustomerAccountDeletedPage();
  return renderToStaticMarkup(page);
}

const signInHrefOf = (markup: string) =>
  /<a[^>]*href="([^"]*)"/.exec(markup)?.[1];

test("keeps the deleted-account page out of search results", async () => {
  const { generateMetadata } = await import("./page");

  expect(await generateMetadata()).toEqual({
    title: m.accountDeletedMetadataTitle({}, { locale: "en-US" }),
    description: m.accountDeletedMetadataDescription({}, { locale: "en-US" }),
    robots: { index: false, follow: false },
  });
});

describe("CustomerAccountDeletedPage", () => {
  afterEach(() => {
    currentUser = Effect.succeed(null);
  });

  test("offers a signed-out visitor to sign in again", async () => {
    const markup = await renderDeletedPage();

    expect(markup).toContain(m.accountDeletedTitle({}, { locale: "en-US" }));
    expect(signInHrefOf(markup)).toBe("/en-US/auth/sign-in");
  });

  test("still offers sign-in when the session can't be read", async () => {
    currentUser = Effect.fail(
      customerAccountUnavailable("authentication.session")
    );

    const markup = await renderDeletedPage();

    expect(signInHrefOf(markup)).toBe("/en-US/auth/sign-in");
  });

  test("sends a visitor with a live session to the account", async () => {
    currentUser = Effect.succeed({
      accountId: "account-synthetic-1" as CustomerAccountId,
      email: testEmailAddress("synthetic.customer"),
      deletionRequested: false,
    } as CustomerAccountSession);

    const rendered = renderDeletedPage();

    await expect(rendered).rejects.toBeInstanceOf(RedirectSignal);
    const location = await rendered.catch(
      (signal: RedirectSignal) => signal.location
    );
    expect(location).toBe("/en-US/account");
  });
});
