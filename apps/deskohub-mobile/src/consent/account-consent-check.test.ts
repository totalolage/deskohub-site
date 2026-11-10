import { describe, expect, test } from "bun:test";
import { createAccountConsentCheck } from "./account-consent-check";
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
    expect(check.firstCheckPending()).toBe(false);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(true);

    check.settle("acc_1", granted);
    expect(check.holds("acc_1")).toBe(false);
    expect(check.firstCheckPending()).toBe(false);
  });

  test("holds again on a recheck without asking for the first check again", () => {
    const { check } = checkOfDevice();
    check.follow("acc_1");
    check.settle("acc_1", granted);

    check.recheck();
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(false);
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
    expect(check.firstCheckPending()).toBe(true);
  });

  test("starts over after signing out and in again", () => {
    const { check } = checkOfDevice();
    check.follow("acc_1");
    check.settle("acc_1", granted);
    check.follow(undefined);
    expect(check.firstCheckPending()).toBe(false);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(true);
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
