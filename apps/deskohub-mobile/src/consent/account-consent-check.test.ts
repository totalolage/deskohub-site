import { describe, expect, test } from "bun:test";
import { createAccountConsentCheck } from "./account-consent-check";

describe("createAccountConsentCheck", () => {
  test("holds a signed-in account until its check settles", () => {
    const check = createAccountConsentCheck();
    expect(check.firstCheckPending()).toBe(false);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(true);

    check.settle("acc_1");
    expect(check.holds("acc_1")).toBe(false);
    expect(check.firstCheckPending()).toBe(false);
  });

  test("holds again on a recheck without asking for the first check again", () => {
    const check = createAccountConsentCheck();
    check.follow("acc_1");
    check.settle("acc_1");

    check.recheck();
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(false);
  });

  test("ignores a check of an account no longer signed in", () => {
    const check = createAccountConsentCheck();
    check.follow("acc_1");
    check.follow("acc_2");
    check.settle("acc_1");
    expect(check.holds("acc_2")).toBe(true);
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(true);
  });

  test("starts over after signing out and in again", () => {
    const check = createAccountConsentCheck();
    check.follow("acc_1");
    check.settle("acc_1");
    check.follow(undefined);
    expect(check.firstCheckPending()).toBe(false);

    check.follow("acc_1");
    expect(check.holds("acc_1")).toBe(true);
    expect(check.firstCheckPending()).toBe(true);
  });

  test("notifies only real changes", () => {
    const check = createAccountConsentCheck();
    let notifications = 0;
    check.subscribe(() => notifications++);
    check.follow("acc_1");
    check.follow("acc_1");
    check.settle("acc_1");
    check.settle("acc_1");
    check.settle("acc_2");
    expect(notifications).toBe(2);
  });
});
