import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthSessionState } from "../auth/auth-session-state";
import {
  type AccountConsentCheck,
  createAccountConsentCheck,
  useConsentPromptWaits,
} from "./account-consent-check";
import type { StoredConsent } from "./analytics-consent";

const granted: StoredConsent = {
  kind: "decided",
  categories: ["necessary", "analytics"],
  decidedAt: "2026-11-01T08:00:00.000Z",
};

/** A check of a device whose choice the test sets. */
const checkOfDevice = (initial: StoredConsent = granted) => {
  let choice = initial;
  const check = createAccountConsentCheck(() => choice);
  return {
    check,
    choose: (next: StoredConsent) => {
      choice = next;
    },
  };
};

describe("createAccountConsentCheck", () => {
  test("holds a signed-in account until its check settles", () => {
    const { check } = checkOfDevice();
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending("acc_1")).toBe(true);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending("acc_1")).toBe(true);

    check.settle("acc_1", granted);
    expect(check.holds("acc_1")).toBe(false);
    expect(check.firstCheckPending("acc_1")).toBe(false);
  });

  test("holds again on a recheck without asking for the first check again", () => {
    const { check } = checkOfDevice();
    check.follow("acc_1");
    check.settle("acc_1", granted);

    check.recheck();
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending("acc_1")).toBe(false);
  });

  test("holds a new choice from the moment it is stored until a check settles for it", () => {
    const { check, choose } = checkOfDevice({ kind: "undecided" });
    check.follow("acc_1");
    check.settle("acc_1", { kind: "undecided" });
    let notifications = 0;
    check.subscribe(() => notifications++);

    choose(granted);
    expect(check.holds("acc_1")).toBe(true);
    expect(notifications).toBe(0);

    check.settle("acc_1", { kind: "undecided" });
    expect(check.holds("acc_1")).toBe(true);

    check.settle("acc_1", { ...granted });
    expect(check.holds("acc_1")).toBe(false);
    expect(notifications).toBe(1);
  });

  test("ignores a check of an account no longer signed in", () => {
    const { check } = checkOfDevice();
    check.follow("acc_1");
    check.follow("acc_2");
    check.settle("acc_1", granted);
    expect(check.holds("acc_2")).toBe(true);
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending("acc_2")).toBe(true);
    expect(check.firstCheckPending("acc_1")).toBe(true);
  });

  test("starts over after signing out and in again", () => {
    const { check } = checkOfDevice();
    check.follow("acc_1");
    check.settle("acc_1", granted);
    check.follow(undefined);
    expect(check.firstCheckPending("acc_1")).toBe(true);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending("acc_1")).toBe(true);
  });

  test("notifies only real changes", () => {
    const { check } = checkOfDevice();
    let notifications = 0;
    check.subscribe(() => notifications++);
    check.follow("acc_1");
    check.follow("acc_1");
    check.settle("acc_1", granted);
    check.settle("acc_1", granted);
    check.settle("acc_2", granted);
    expect(notifications).toBe(2);
  });
});

describe("useConsentPromptWaits", () => {
  const signedIn = (id: string): AuthSessionState => ({
    status: "signed-in",
    user: { id, email: testEmailAddress(id) },
    signedInAt: new Date("2026-11-01T08:00:00.000Z"),
  });
  const sessions: readonly AuthSessionState[] = [
    { status: "restoring" },
    { status: "signed-out" },
    signedIn("acc_1"),
  ];

  /** The hook's answer on a server render of `session`. */
  const waitsOnServer = (
    check: AccountConsentCheck | undefined,
    session: AuthSessionState
  ) => {
    let waits: boolean | undefined;
    function Probe() {
      waits = useConsentPromptWaits(check, session);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    return waits;
  };

  test("never waits without a check, as on the web bundle", () => {
    for (const session of sessions) {
      expect(waitsOnServer(undefined, session)).toBe(false);
    }
  });

  test("waits while restoring and for the rendered account's first check", () => {
    const { check } = checkOfDevice({ kind: "undecided" });
    check.follow("acc_0");
    check.settle("acc_0", { kind: "undecided" });
    expect(sessions.map((session) => waitsOnServer(check, session))).toEqual([
      true,
      false,
      true,
    ]);

    check.follow("acc_1");
    expect(waitsOnServer(check, signedIn("acc_1"))).toBe(true);
    check.settle("acc_1", { kind: "undecided" });
    expect(waitsOnServer(check, signedIn("acc_1"))).toBe(false);
  });
});
