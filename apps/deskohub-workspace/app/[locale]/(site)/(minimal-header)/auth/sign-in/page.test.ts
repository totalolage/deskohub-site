import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { getLocalizedPagePath } from "@/features/i18n/routing";

const events: string[] = [];
const withSearchParams = (searchParams: Record<string, string | string[]>) => ({
  searchParams: Promise.resolve(searchParams),
});

type Node = ReactElement<{ readonly children?: Node | readonly Node[] }>;
const findSignInCard = (node: Node): Node | undefined =>
  node.type === SignInCard
    ? node
    : [node.props.children ?? []]
        .flat()
        .map(findSignInCard)
        .find((found) => found !== undefined);
const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const areAccountsEnabled = mock(() => Promise.resolve(true));
const connection = mock(() => Promise.resolve());

mock.module("next/navigation", () => ({ notFound }));
mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));
const SignInCard = () => null;
mock.module("@/features/account/components/sign-in-card", () => ({
  SignInCard,
}));
mock.module("@/features/i18n", () => ({ getLocalizedPagePath, m: {} }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

describe("customer sign-in route boundary", () => {
  beforeEach(() => {
    events.length = 0;
    notFound.mockReset();
    notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return true;
    });
    connection.mockReset();
    connection.mockImplementation(async () => {
      events.push("connection");
    });
  });

  test("checks the account gate after establishing the request-bound page", async () => {
    const { default: CustomerSignInPage } = await import("./page");

    const output = await CustomerSignInPage(withSearchParams({}));

    expect(output).toMatchObject({ type: "main" });
    expect(events).toEqual(["connection", "gate"]);
  });

  test("returns not found after establishing a request when disabled", async () => {
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return false;
    });
    const { default: CustomerSignInPage } = await import("./page");

    await expect(CustomerSignInPage(withSearchParams({}))).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(events).toEqual(["connection", "gate"]);
    expect(connection).toHaveBeenCalledTimes(1);
  });

  test("passes only a same-origin return target to the sign-in card", async () => {
    const { default: CustomerSignInPage } = await import("./page");
    const returnToFor = async (
      searchParams: Record<string, string | string[]>
    ) =>
      findSignInCard(
        (await CustomerSignInPage(withSearchParams(searchParams))) as Node
      )?.props;

    expect(
      await returnToFor({ returnTo: "/cs-CZ/admin/invoices?page=2" })
    ).toEqual({ locale: "en-US", returnTo: "/cs-CZ/admin/invoices?page=2" });
    for (const returnTo of [
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example/admin",
      "javascript:alert(1)",
      ["//evil.example/admin", "/admin"],
    ]) {
      expect(await returnToFor({ returnTo })).toEqual({
        locale: "en-US",
        returnTo: undefined,
      });
    }
    expect(await returnToFor({})).toEqual({
      locale: "en-US",
      returnTo: undefined,
    });
  });
});
