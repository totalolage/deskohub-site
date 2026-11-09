import { describe, expect, test } from "bun:test";
import {
  type ReferralAccountOverview,
  ReferralCode,
} from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import {
  type AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  copyReferralCodeAtom,
  formatReferralDiscount,
  referralsAtom,
  referralsFailure,
  referralsView,
  shareReferralLinkAtom,
} from "./referrals";

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

// Normalizes Intl's no-break spaces so expectations read plainly.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("referralsAtom", () => {
  test("reads a linked account's summary and share link", async () => {
    const data = makeFakeCustomerData("linked");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        summary: { code: "SAMPLE-ALEX", inviteeCount: 3 },
        shareUrl: data.workspace.data.referrals.shareUrl,
      },
    });
    expect(data.workspace.calls).toEqual(["getReferrals"]);
  });

  test("answers feature-unavailable while referrals aren't released", async () => {
    const data = makeFakeCustomerData("linked");
    const { account } = data.workspace.data;
    if (account.kind !== "linked") throw new Error("expected a linked account");
    data.workspace.setAccount({ ...account, referralsEnabled: false });

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerFeatureUnavailable", feature: "referrals" },
    });
  });

  test("answers link-required for an account without a usable profile", async () => {
    const data = makeFakeCustomerData("support-required");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountLinkRequired",
        reason: "support-required",
      },
    });
  });

  test("fails when the summary can't be read", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("getReferrals", "service-unavailable");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerServiceUnavailable" },
    });
  });
});

describe("referral actions", () => {
  test("copies the code as non-sensitive text", async () => {
    const data = makeFakeCustomerData("linked");
    data.registry.mount(copyReferralCodeAtom);

    data.registry.set(copyReferralCodeAtom, "SAMPLE-ALEX");
    const result = await run(data.registry, copyReferralCodeAtom);

    expect(result._tag).toBe("Success");
    expect(data.device.copied).toEqual([
      { text: "SAMPLE-ALEX", sensitive: false },
    ]);
  });

  test("shares the link with the invitation", async () => {
    const data = makeFakeCustomerData("linked");
    data.registry.mount(shareReferralLinkAtom);
    const link = {
      url: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
      message: "Invitation",
    };

    data.registry.set(shareReferralLinkAtom, link);
    const result = await run(data.registry, shareReferralLinkAtom);

    expect(result._tag).toBe("Success");
    expect(data.device.sharedLinks).toEqual([link]);
  });
});

describe("referralsView", () => {
  const overview: ReferralAccountOverview = {
    summary: {
      code: ReferralCode.make("SAMPLE-ALEX"),
      inviteeCount: 3,
      eligibleInviteeCount: 2,
      discount: "10",
      savings: [
        { value: 15000, exponent: 2, currency: "CZK" },
        { value: 1250, exponent: 2, currency: "EUR" },
      ],
    },
    shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
  };

  test("summarizes invitees, discount and savings per currency", () => {
    const view = referralsView(overview, "en-US");

    expect({ ...view, savings: view.savings.map(plain) }).toEqual({
      code: "SAMPLE-ALEX",
      shareUrl: overview.shareUrl,
      eligibleInvitees: 2,
      invitees: 3,
      noInvitees: false,
      discount: "10%",
      savings: ["CZK 150", "€12.50"],
    });
  });

  test("reports no invitees and no savings", () => {
    const view = referralsView(
      {
        ...overview,
        summary: {
          ...overview.summary,
          inviteeCount: 0,
          eligibleInviteeCount: 0,
          discount: "0",
          savings: [],
        },
      },
      "cs-CZ"
    );

    expect(view.noInvitees).toBe(true);
    expect(view.savings).toEqual([]);
  });
});

describe("formatReferralDiscount", () => {
  test.each([
    ["10", "en-US", "10%"],
    ["10.25", "en-US", "11%"],
    ["10.00", "en-US", "10%"],
    ["15", "cs-CZ", "15 %"],
  ] as const)("formats %s in %s as %s", (discount, locale, expected) => {
    expect(plain(formatReferralDiscount(discount, locale))).toBe(expected);
  });
});

describe("referral savings", () => {
  test.each([
    [15000, "CZK", "en-US", "CZK 150"],
    [15000, "CZK", "cs-CZ", "150 Kč"],
    [15050, "CZK", "cs-CZ", "150,50 Kč"],
    [1250, "EUR", "cs-CZ", "12,50 €"],
  ] as const)(
    "formats %d minor %s in %s as %s",
    (value, currency, locale, expected) => {
      const view = referralsView(
        {
          summary: {
            code: ReferralCode.make("SAMPLE-ALEX"),
            inviteeCount: 1,
            eligibleInviteeCount: 1,
            discount: "5",
            savings: [{ value, exponent: 2, currency }],
          },
          shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
        },
        locale
      );

      expect(view.savings.map(plain)).toEqual([expected]);
    }
  );
});

describe("referralsFailure", () => {
  test("words each failure the screen explains itself", () => {
    expect(
      referralsFailure(
        CustomerViewError.FeatureUnavailable({ feature: "referrals" })
      )
    ).toBe("not-released");
    expect(referralsFailure(CustomerViewError.Unavailable())).toBe(
      "summary-unavailable"
    );
    expect(referralsFailure(CustomerViewError.TimedOut())).toBe(
      "summary-unavailable"
    );
    expect(referralsFailure(CustomerViewError.RateLimited())).toBeUndefined();
    expect(
      referralsFailure(
        CustomerViewError.LinkRequired({ reason: "support-required" })
      )
    ).toBeUndefined();
  });
});
