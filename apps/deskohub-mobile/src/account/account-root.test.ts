import { describe, expect, test } from "bun:test";
import type { Href, ImperativeRouter } from "expo-router";
import { accountRootHref, returnToAccountRoot } from "./account-root";

describe("returnToAccountRoot", () => {
  const recordingRouter = () => {
    type Options = Parameters<ImperativeRouter["dismissTo"]>[1];
    const calls: Array<readonly [string, Href, Options]> = [];
    const record =
      (method: string) =>
      (href: Href, options?: Options): void =>
        void calls.push([method, href, options]);
    return {
      calls,
      router: {
        dismissTo: record("dismissTo"),
        replace: record("replace"),
        push: record("push"),
        navigate: record("navigate"),
      },
    };
  };

  test("goes back down the Account stack to its root, not onto a second root", () => {
    const { calls, router } = recordingRouter();
    returnToAccountRoot(router);
    // A replace would swap the section for a second Account root above the
    // anchored one, which then shows a back arrow to itself (#1125).
    expect(calls).toEqual([["dismissTo", "/account", undefined]]);
  });

  test("the Account root is the Account tab's index", () => {
    expect(accountRootHref).toBe("/account");
  });
});
