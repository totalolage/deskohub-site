import { describe, expect, test } from "bun:test";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import { ensureCampaignRecipientsAllowed } from "./recipient-domain-guard";

const outsideAddress = resendSimulatorAddress("delivered");

const run = (
  deploymentEnvironment: "production" | "preview" | "development",
  emails: readonly string[]
) =>
  Effect.runSyncExit(
    ensureCampaignRecipientsAllowed({ deploymentEnvironment, emails })
  );

describe("ensureCampaignRecipientsAllowed", () => {
  test("allows test-domain recipients outside production", () => {
    expect(
      Exit.isSuccess(
        run("preview", [testEmailAddress("a"), testEmailAddress("b")])
      )
    ).toBe(true);
  });

  test("refuses the whole send when any recipient is outside the test domain", () => {
    for (const environment of ["preview", "development"] as const) {
      const exit = run(environment, [testEmailAddress("a"), outsideAddress]);
      expect(exit).toEqual(
        Exit.fail(
          expect.objectContaining({
            _tag: "CampaignRecipientsOutsideTestDomain",
            recipientCount: 1,
          })
        )
      );
    }
  });

  test("allows any recipient in production", () => {
    expect(Exit.isSuccess(run("production", [outsideAddress]))).toBe(true);
  });
});
