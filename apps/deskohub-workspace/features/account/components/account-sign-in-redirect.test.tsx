import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let documentNavigations: string[] = [];
let originalAssign: typeof window.location.assign;
let originalReplace: typeof window.location.replace;

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  originalAssign = window.location.assign;
  originalReplace = window.location.replace;
  window.location.assign = ((href: string) => {
    documentNavigations.push(`assign:${href}`);
  }) as typeof window.location.assign;
  window.location.replace = ((href: string) => {
    documentNavigations.push(`replace:${href}`);
  }) as typeof window.location.replace;
});

afterEach(() => {
  cleanup();
  documentNavigations = [];
});

afterAll(() => {
  window.location.assign = originalAssign;
  window.location.replace = originalReplace;
  unregisterWorkspaceComponentTestEnv();
});

test("loads the sign-in page with a document navigation", async () => {
  const { AccountSignInRedirect } = await import("./account-sign-in-redirect");

  await act(async () => {
    render(<AccountSignInRedirect locale="en-US" />);
  });

  expect(documentNavigations).toEqual(["replace:/en-US/auth/sign-in"]);
});

test("stands down while the page is already leaving, such as after a deletion", async () => {
  const { leaveDocument } = await import(
    "@/shared/browser/document-navigation"
  );
  const { AccountSignInRedirect } = await import("./account-sign-in-redirect");

  leaveDocument("/en-US/account/deleted");
  await act(async () => {
    render(<AccountSignInRedirect locale="en-US" />);
  });

  expect(documentNavigations).toEqual(["assign:/en-US/account/deleted"]);
});
