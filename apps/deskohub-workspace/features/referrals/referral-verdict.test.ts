import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import {
  evaluateReferral,
  type InvitationReferral,
  type InvitationWindow,
} from "./referral-verdict";

const customer = (value: string) => value as DotyposCustomerId;
const invited = customer("invited");
const referral = (referrer: string): InvitationReferral => ({
  referrerDotyposCustomerId: customer(referrer),
  promotionCodeId: `code-of-${referrer}` as PromotionCodeId,
});

/** Runs the evaluation and records which facts it loaded, in order. */
const evaluate = (facts: {
  readonly target?: InvitationReferral;
  readonly attribution?: InvitationReferral;
  readonly invitationWindow?: InvitationWindow;
  readonly referrerByInvitee?: ReadonlyMap<
    DotyposCustomerId,
    DotyposCustomerId
  >;
}) => {
  const loaded: string[] = [];
  const load = <A>(name: string, value: A) =>
    Effect.sync(() => {
      loaded.push(name);
      return value;
    });
  const verdict = Effect.runSync(
    evaluateReferral({
      invitedDotyposCustomerId: invited,
      target: load("target", facts.target),
      attribution: load("attribution", facts.attribution),
      invitationWindow: load(
        "invitationWindow",
        facts.invitationWindow ?? "open"
      ),
      referrerByInvitee: load(
        "referrerByInvitee",
        facts.referrerByInvitee ?? new Map()
      ),
    })
  );
  return { verdict, loaded };
};

describe("referral verdict", () => {
  test("invites through an open window when the referral graph stays acyclic", () => {
    expect(evaluate({ target: referral("referrer") })).toEqual({
      verdict: { kind: "eligible", referral: referral("referrer") },
      loaded: [
        "target",
        "attribution",
        "invitationWindow",
        "referrerByInvitee",
      ],
    });
  });

  test("rejects a code that can't refer anyone, or refers its own owner, before reading the customer", () => {
    expect(evaluate({})).toEqual({
      verdict: { kind: "rejected", reason: "unavailable" },
      loaded: ["target"],
    });
    expect(evaluate({ target: referral("invited") })).toEqual({
      verdict: { kind: "rejected", reason: "self_referral" },
      loaded: ["target"],
    });
  });

  test("settles an existing referral without reading the invitation window", () => {
    expect(
      evaluate({
        target: referral("referrer"),
        attribution: referral("referrer"),
        invitationWindow: "closed",
      })
    ).toEqual({
      verdict: { kind: "already_accepted", referral: referral("referrer") },
      loaded: ["target", "attribution"],
    });
    expect(
      evaluate({
        target: referral("referrer"),
        attribution: referral("someone-else"),
      })
    ).toEqual({
      verdict: { kind: "rejected", reason: "already_attributed" },
      loaded: ["target", "attribution"],
    });
  });

  test.each([
    ["closed", "ineligible"],
    ["held", "pending_payment"],
  ] as const)(
    "rejects a %s invitation window as %s before reading the referral graph",
    (invitationWindow, reason) => {
      expect(
        evaluate({ target: referral("referrer"), invitationWindow })
      ).toEqual({
        verdict: { kind: "rejected", reason },
        loaded: ["target", "attribution", "invitationWindow"],
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

  test("stops at the first failing fact and passes its failure through", () => {
    const loaded: string[] = [];
    const failure = Effect.runSync(
      evaluateReferral({
        invitedDotyposCustomerId: invited,
        target: Effect.succeed(referral("referrer")),
        attribution: Effect.succeed(undefined),
        invitationWindow: Effect.fail("history unavailable" as const),
        referrerByInvitee: Effect.sync(() => {
          loaded.push("referrerByInvitee");
          return new Map();
        }),
      }).pipe(Effect.flip)
    );
    expect(failure).toBe("history unavailable");
    expect(loaded).toEqual([]);
  });
});
