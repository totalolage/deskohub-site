import { describe, expect, test } from "bun:test";
import { getClaimReleaseReasonLabel } from "./claim-release-reason";

describe("getClaimReleaseReasonLabel", () => {
  test("describes each known release reason in the route locale", () => {
    expect(
      getClaimReleaseReasonLabel(
        "payment_abandoned_after_provider_cutoff",
        "en-US"
      )
    ).toBe("Payment abandoned after the payment window closed");
    expect(
      getClaimReleaseReasonLabel(
        "payment_abandoned_after_provider_cutoff",
        "cs-CZ"
      )
    ).toBe("Platba nebyla dokončena ve lhůtě pro zaplacení");
    expect(
      getClaimReleaseReasonLabel("admin_forced_payment_cancellation", "cs-CZ")
    ).toBe("Platbu zrušil administrátor");
    for (const reason of [
      "nexi_hpp_create_failed",
      "nexi_hpp_create_unconfirmed",
      "nexi_payment_failed",
    ]) {
      expect(getClaimReleaseReasonLabel(reason, "cs-CZ")).not.toBe(
        getClaimReleaseReasonLabel("unknown_reason", "cs-CZ")
      );
    }
  });

  test("gives an unknown reason generic copy instead of the code", () => {
    expect(getClaimReleaseReasonLabel("synthetic_terminal", "en-US")).toBe(
      "Released for another reason"
    );
    expect(getClaimReleaseReasonLabel("synthetic_terminal", "cs-CZ")).toBe(
      "Uvolněno z jiného důvodu"
    );
  });
});
