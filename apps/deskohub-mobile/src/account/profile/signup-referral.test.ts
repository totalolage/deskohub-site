import { describe, expect, test } from "bun:test";
import type {
  CustomerAccountState,
  ProfileCompletionReferralOutcome,
} from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { sampleWorkspaceData } from "../../customer-api/testing/sample-fixtures";
import {
  acknowledgeSignupReferralAtom,
  isDismissible,
  signupReferralMessage,
  signupReferralOf,
} from "./signup-referral";

const linkedWith = (
  signupReferral: ProfileCompletionReferralOutcome | undefined,
  referralsEnabled = true
): CustomerAccountState => {
  const account = sampleWorkspaceData("linked").account;
  if (account.kind !== "linked") throw new Error("expected a linked sample");
  return { ...account, referralsEnabled, signupReferral };
};

describe("signupReferralOf", () => {
  test("shows a linked account's stored outcome", () => {
    expect(signupReferralOf(linkedWith({ status: "applied" }))).toEqual(
      Option.some({ status: "applied" })
    );
  });

  test("shows nothing without an outcome, with referrals off or before linking", () => {
    expect(signupReferralOf(linkedWith(undefined))).toEqual(Option.none());
    expect(signupReferralOf(linkedWith({ status: "applied" }, false))).toEqual(
      Option.none()
    );
    expect(
      signupReferralOf(sampleWorkspaceData("completion-required").account)
    ).toEqual(Option.none());
  });
});

describe("outcome", () => {
  test("each outcome has its own message", () => {
    const outcomes: ReadonlyArray<ProfileCompletionReferralOutcome> = [
      { status: "applied" },
      { status: "pending" },
      { status: "not-applied", reason: "already-referred" },
      { status: "not-applied", reason: "not-eligible" },
      { status: "not-applied", reason: "code-unusable" },
      { status: "not-applied", reason: "profile-already-completed" },
    ];
    expect(new Set(outcomes.map(signupReferralMessage)).size).toBe(
      outcomes.length
    );
  });

  test("only a settled outcome can be dismissed", () => {
    expect(isDismissible({ status: "pending" })).toBe(false);
    expect(isDismissible({ status: "applied" })).toBe(true);
    expect(
      isDismissible({ status: "not-applied", reason: "not-eligible" })
    ).toBe(true);
  });
});

describe("acknowledgeSignupReferralAtom", () => {
  test("dismisses the outcome and reads the account again without it", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.setAccount(linkedWith({ status: "applied" }));
    await settle(registry, accountAtom);

    registry.mount(acknowledgeSignupReferralAtom);
    registry.set(acknowledgeSignupReferralAtom, undefined);
    const result = await Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(acknowledgeSignupReferralAtom, {
          suspendOnWaiting: true,
        })(registry)
      )
    );
    const account = await settle(registry, accountAtom);

    expect(result._tag).toBe("Success");
    expect(workspace.calls).toEqual([
      "getAccount",
      "acknowledgeSignupReferral",
      "getAccount",
    ]);
    expect(
      account._tag === "Success" && signupReferralOf(account.success)
    ).toEqual(Option.none());
  });

  test("a failed dismissal keeps the outcome", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.setAccount(linkedWith({ status: "applied" }));
    await settle(registry, accountAtom);
    workspace.fail("acknowledgeSignupReferral", "service-unavailable");

    registry.mount(acknowledgeSignupReferralAtom);
    registry.set(acknowledgeSignupReferralAtom, undefined);
    const result = await Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(acknowledgeSignupReferralAtom, {
          suspendOnWaiting: true,
        })(registry)
      )
    );

    expect(result._tag).toBe("Failure");
    expect(workspace.calls).toEqual([
      "getAccount",
      "acknowledgeSignupReferral",
    ]);
  });
});
