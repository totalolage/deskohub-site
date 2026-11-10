import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { act, Profiler } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthSessionState } from "../auth/auth-session-state";
import { appAccountConsentCheck } from "../consent/account-consent-check";
import { appAnalyticsConsent } from "../consent/use-analytics-consent";
import { AppLocaleProvider } from "../i18n/locale-context";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

let session: AuthSessionState = { status: "restoring" };
mock.module("expo-router", () => expoRouterStandIn());
mock.module("../auth/use-auth-session", () => ({
  useAuthSession: () => session,
}));

const { AnalyticsRoot } = await import("./analytics-root");

const restoring: AuthSessionState = { status: "restoring" };
const signedOut: AuthSessionState = { status: "signed-out" };
const signedIn = (id: string): AuthSessionState => ({
  status: "signed-in",
  user: { id, email: testEmailAddress(id) },
  signedInAt: new Date("2026-11-10T08:00:00.000Z"),
});

const { render, container } = clientRoot();

/** Whether the prompt is up: the root renders it around no screens. */
const promptShowing = () => container().childElementCount > 0;

/** Whether each commit of the root left the prompt up, in order. */
const frames: boolean[] = [];
const app = () => (
  <AppLocaleProvider locale="en-US">
    <Profiler id="analytics-root" onRender={() => frames.push(promptShowing())}>
      <AnalyticsRoot>{null}</AnalyticsRoot>
    </Profiler>
  </AppLocaleProvider>
);

// The native app, with no stored consent answer and no PostHog project, so
// no client starts.
const globals = globalThis as { __DEV__?: boolean };
const postHogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
// React DOM warns about the React Native host names and props it renders.
const { error } = console;
const hostWarnings = spyOn(console, "error").mockImplementation((...args) => {
  if (
    !/incorrect casing|unrecognized in this browser|does not recognize the|Unknown event handler/.test(
      String(args[0])
    )
  )
    error(...args);
});
beforeAll(async () => {
  globals.__DEV__ = false;
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  await Effect.runPromise(
    eventually(() => appAnalyticsConsent().status() === "undecided")
  );
});
afterAll(() => {
  hostWarnings.mockRestore();
  delete globals.__DEV__;
  if (postHogKey !== undefined)
    process.env.EXPO_PUBLIC_POSTHOG_KEY = postHogKey;
  appAccountConsentCheck.follow(undefined);
});

describe("AnalyticsRoot on the server", () => {
  test("renders in every session state", () => {
    for (const state of [restoring, signedOut, signedIn("account-a")]) {
      session = state;
      expect(() => renderToStaticMarkup(app())).not.toThrow();
    }
  });
});

describe("AnalyticsRoot's consent prompt", () => {
  /** The frames `step` commits, and whether the prompt is up after it. */
  const commits = async (step: () => Promise<void>) => {
    frames.length = 0;
    await step();
    return { frames: [...frames], showing: promptShowing() };
  };
  const renderUnder = (next: AuthSessionState) =>
    commits(async () => {
      session = next;
      await render(app());
    });
  /** The signed-in account's sync finishing, whatever its answer. */
  const settleCheck = (accountId: string) =>
    commits(() =>
      act(async () => {
        appAccountConsentCheck.settle(accountId, { kind: "undecided" });
      })
    );
  const expectNoPromptFrame = ({ frames }: { readonly frames: boolean[] }) => {
    expect(frames.length).toBeGreaterThan(0);
    expect(frames).not.toContain(true);
  };

  test("waits for a restored session's first account check", async () => {
    expectNoPromptFrame(await renderUnder(restoring));
    expectNoPromptFrame(await renderUnder(signedIn("account-a")));
    expect(await settleCheck("account-a")).toMatchObject({ showing: true });
  });

  test("asks while signed out, then waits for the next account's check", async () => {
    expect(await renderUnder(signedOut)).toMatchObject({ showing: true });
    expectNoPromptFrame(await renderUnder(signedIn("account-b")));
    expect(await settleCheck("account-b")).toMatchObject({ showing: true });
  });

  test("waits for an account signed in over a checked one", async () => {
    await renderUnder(signedIn("account-c"));
    expect(await settleCheck("account-c")).toMatchObject({ showing: true });

    expectNoPromptFrame(await renderUnder(signedIn("account-d")));
    expect(await settleCheck("account-d")).toMatchObject({ showing: true });
    expect(await renderUnder(signedOut)).toMatchObject({ showing: true });
  });
});
