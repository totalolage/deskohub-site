import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const storageKey = "deskohub:account-sign-in-code";
const email = testEmailAddress("sign-in-request");
const returnTo = "/en-US/reservation?date=2026-10-20";

let store: typeof import("./email-sign-in-request");

describe("email sign-in request of this tab", () => {
  beforeAll(async () => {
    registerWorkspaceComponentTestEnv();
    // Stored before link-only requests were kept: no `signInCode` field.
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ email, requestedAt: Date.now() })
    );
    // A fresh module instance, as on a new document: it reads storage once.
    const freshDocument = "fresh-document";
    store = (await import(
      `./email-sign-in-request.ts?${freshDocument}`
    )) as typeof store;
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("restores a stored request, read as a code request when it predates the flag", () => {
    const { result } = renderHook(() => store.useEmailSignInRequest());
    const [request, , restored] = result.current;

    expect(restored).toBe(true);
    expect(request?.email).toBe(email);
    expect(request && store.hasSignInCode(request)).toBe(true);
  });

  test("shows a request stored on another page to every mounted reader", () => {
    const first = renderHook(() => store.useEmailSignInRequest());
    const second = renderHook(() => store.useEmailSignInRequest());

    act(() => {
      store.rememberEmailSignInRequest({
        email,
        requestedAt: Date.now(),
        signInCode: false,
        attemptId: "550e8400-e29b-41d4-a716-446655440000",
        returnTo,
      });
    });

    for (const { result } of [first, second]) {
      const [request] = result.current;
      expect(request?.returnTo).toBe(returnTo);
      expect(request && store.hasSignInCode(request)).toBe(false);
    }
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? "")).toMatchObject({
      email,
      signInCode: false,
      returnTo,
    });
  });

  test("keeps the request on screen when only its stored copy is forgotten", () => {
    act(() => {
      store.rememberEmailSignInRequest({ email, requestedAt: Date.now() });
    });
    const { result } = renderHook(() => store.useEmailSignInRequest());

    store.forgetEmailSignInRequest();

    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(result.current[0]?.email).toBe(email);
  });

  test("drops a request older than its link and code", () => {
    act(() => {
      store.rememberEmailSignInRequest({
        email,
        requestedAt: Date.now() - 10 * 60 * 1000,
      });
    });
    const { result } = renderHook(() => store.useEmailSignInRequest());

    expect(result.current[0]).toBeNull();
    expect(result.current[2]).toBe(true);
  });

  test("clears the request for every reader", () => {
    const { result } = renderHook(() => store.useEmailSignInRequest());

    act(() => {
      store.rememberEmailSignInRequest(null);
    });

    expect(result.current[0]).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
});
