import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import {
  evaluateReferral,
  type InvitationReferral,
  type InvitationWindow,
  type ReferralEvaluation,
  type ReferrerByInvitee,
} from "./referral-verdict";

const customer = (value: string) => value as DotyposCustomerId;
const invited = customer("invited");
const referral = (referrer: string): InvitationReferral => ({
  referrerDotyposCustomerId: customer(referrer),
  promotionCodeId: `code-of-${referrer}` as PromotionCodeId,
});

/** Answers each fact the evaluation asks for and records the order asked. */
const evaluate = (facts: {
  readonly target?: InvitationReferral;
  readonly attribution?: InvitationReferral;
  readonly invitationWindow?: InvitationWindow;
  readonly referrerByInvitee?: ReferrerByInvitee;
}) => {
  const asked: string[] = [];
  const answer = (evaluation: ReferralEvaluation) => {
    if (evaluation.kind !== "decided") asked.push(evaluation.kind);
    switch (evaluation.kind) {
      case "decided":
        return evaluation.verdict;
      case "needs_attribution":
        return answer(evaluation.resume(facts.attribution));
      case "needs_invitation_window":
        return answer(evaluation.resume(facts.invitationWindow ?? "open"));
      case "needs_referrer_by_invitee":
        return answer(evaluation.resume(facts.referrerByInvitee ?? new Map()));
    }
  };
  const verdict = answer(
    evaluateReferral({
      invitedDotyposCustomerId: invited,
      target: facts.target,
    })
  );
  return { verdict, asked };
};

describe("referral verdict", () => {
  test("invites through an open window when the referral graph stays acyclic", () => {
    expect(evaluate({ target: referral("referrer") })).toEqual({
      verdict: { kind: "eligible", referral: referral("referrer") },
      asked: [
        "needs_attribution",
        "needs_invitation_window",
        "needs_referrer_by_invitee",
      ],
    });
  });

  test("rejects a code that can't refer anyone, or refers its own owner, before asking about the customer", () => {
    expect(evaluate({})).toEqual({
      verdict: { kind: "rejected", reason: "unavailable" },
      asked: [],
    });
    expect(evaluate({ target: referral("invited") })).toEqual({
      verdict: { kind: "rejected", reason: "self_referral" },
      asked: [],
    });
  });

  test("settles an existing referral without asking for the invitation window", () => {
    expect(
      evaluate({
        target: referral("referrer"),
        attribution: referral("referrer"),
        invitationWindow: "closed",
      })
    ).toEqual({
      verdict: { kind: "already_accepted", referral: referral("referrer") },
      asked: ["needs_attribution"],
    });
    expect(
      evaluate({
        target: referral("referrer"),
        attribution: referral("someone-else"),
      })
    ).toEqual({
      verdict: { kind: "rejected", reason: "already_attributed" },
      asked: ["needs_attribution"],
    });
  });

  test.each([
    ["closed", "ineligible"],
    ["held", "pending_payment"],
  ] as const)(
    "rejects a %s invitation window as %s before asking for the referral graph",
    (invitationWindow, reason) => {
      expect(
        evaluate({ target: referral("referrer"), invitationWindow })
      ).toEqual({
        verdict: { kind: "rejected", reason },
        asked: ["needs_attribution", "needs_invitation_window"],
      });
    }
  );

  test("rejects a referral that would close a cycle", () => {
    expect(
      evaluate({
        target: referral("referrer"),
        // The referrer was invited by someone the customer invited.
        referrerByInvitee: new Map([
          [customer("referrer"), customer("middle")],
          [customer("middle"), invited],
        ]),
      }).verdict
    ).toEqual({ kind: "rejected", reason: "cycle" });
  });

  test("confirms a same-referrer attribution recorded after the customer's own was read", () => {
    expect(
      evaluate({
        target: referral("referrer"),
        referrerByInvitee: new Map([[invited, customer("referrer")]]),
      }).verdict
    ).toEqual({ kind: "already_accepted", referral: referral("referrer") });
  });
});
