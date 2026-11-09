import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { evaluateReferralAttribution } from "./attribution";

const customer = (value: string) => value as DotyposCustomerId;

describe("referral attribution rules", () => {
  test("accepts a first attribution and treats the same referrer as idempotent", () => {
    const first = evaluateReferralAttribution({
      invitedCustomerId: customer("invitee"),
      referrerCustomerId: customer("referrer"),
      existingReferrerByInvitee: new Map(),
    });
    const same = evaluateReferralAttribution({
      invitedCustomerId: customer("invitee"),
      referrerCustomerId: customer("referrer"),
      existingReferrerByInvitee: new Map([
        [customer("invitee"), customer("referrer")],
      ]),
    });

    expect(first).toEqual({ kind: "accepted" });
    expect(same).toEqual({ kind: "already_accepted" });
  });

  test("rejects self-referrals and attempts to change an existing referrer", () => {
    expect(
      evaluateReferralAttribution({
        invitedCustomerId: customer("same"),
        referrerCustomerId: customer("same"),
        existingReferrerByInvitee: new Map(),
      })
    ).toEqual({ kind: "self_referral" });
    expect(
      evaluateReferralAttribution({
        invitedCustomerId: customer("invitee"),
        referrerCustomerId: customer("new-referrer"),
        existingReferrerByInvitee: new Map([
          [customer("invitee"), customer("old-referrer")],
        ]),
      })
    ).toEqual({ kind: "already_attributed" });
  });

  test("rejects direct and transitive cycles", () => {
    expect(
      evaluateReferralAttribution({
        invitedCustomerId: customer("a"),
        referrerCustomerId: customer("b"),
        existingReferrerByInvitee: new Map([[customer("b"), customer("a")]]),
      })
    ).toEqual({ kind: "cycle" });
    expect(
      evaluateReferralAttribution({
        invitedCustomerId: customer("a"),
        referrerCustomerId: customer("c"),
        existingReferrerByInvitee: new Map([
          [customer("c"), customer("b")],
          [customer("b"), customer("a")],
        ]),
      })
    ).toEqual({ kind: "cycle" });
  });
});
