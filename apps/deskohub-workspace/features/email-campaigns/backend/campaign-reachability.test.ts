import { describe, expect, test } from "bun:test";
import type { DotyposCustomer } from "@deskohub/dotypos";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { Option, Result } from "effect";
import {
  CampaignEligibilityStage,
  campaignEligibility,
} from "./campaign-reachability";

const customer = (overrides: Partial<DotyposCustomer> = {}) =>
  Option.some({
    id: "1",
    _cloudId: "cloud",
    email: testEmailAddress("customer"),
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    ...overrides,
  } as DotyposCustomer);

const outsideAddress = resendSimulatorAddress("delivered");

const unreachableProfiles = [
  [Option.none(), "missing-from-dotypos"],
  [customer({ deleted: true }), "deleted-customer"],
  [customer({ email: "  " }), "missing-email"],
  [customer({ email: "not-an-address" }), "invalid-email"],
] as const;

const delivery = (
  overrides: Partial<{
    consenting: boolean;
    deploymentEnvironment: "production" | "preview" | "development";
  }> = {}
) =>
  CampaignEligibilityStage.Delivery({
    consenting: true,
    deploymentEnvironment: "preview",
    ...overrides,
  });

describe("campaignEligibility", () => {
  test("gives resolution and delivery the same reason for a profile the campaign can't reach", () => {
    for (const [profile, reason] of unreachableProfiles) {
      expect(
        campaignEligibility({
          profile,
          stage: CampaignEligibilityStage.Resolution(),
        })
      ).toEqual(Result.fail(reason));
      expect(campaignEligibility({ profile, stage: delivery() })).toEqual(
        Result.fail(reason)
      );
    }
  });

  test("gives both stages the decoded profile email", () => {
    const profile = customer({ email: testEmailAddress("ada") });
    expect(
      campaignEligibility({
        profile,
        stage: CampaignEligibilityStage.Resolution(),
      })
    ).toEqual(Result.succeed(testEmailAddress("ada")));
    expect(campaignEligibility({ profile, stage: delivery() })).toEqual(
      Result.succeed(testEmailAddress("ada"))
    );
  });

  test("skips at delivery a recipient whose consent is gone, before reading the profile", () => {
    expect(
      campaignEligibility({
        profile: Option.none(),
        stage: delivery({ consenting: false }),
      })
    ).toEqual(Result.fail("consent-withdrawn"));
  });

  test("skips at delivery an address outside the test domain outside production only", () => {
    const profile = customer({ email: outsideAddress });
    for (const deploymentEnvironment of ["preview", "development"] as const) {
      expect(
        campaignEligibility({
          profile,
          stage: delivery({ deploymentEnvironment }),
        })
      ).toEqual(Result.fail("outside-test-domain"));
    }
    expect(
      campaignEligibility({
        profile,
        stage: delivery({ deploymentEnvironment: "production" }),
      })
    ).toEqual(Result.succeed(outsideAddress));
  });

  test("keeps at resolution an address outside the test domain, which the send refuses in bulk", () => {
    expect(
      campaignEligibility({
        profile: customer({ email: outsideAddress }),
        stage: CampaignEligibilityStage.Resolution(),
      })
    ).toEqual(Result.succeed(outsideAddress));
  });
});
