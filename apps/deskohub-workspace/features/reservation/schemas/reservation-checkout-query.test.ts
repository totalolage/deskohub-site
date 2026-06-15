import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { getWorkspaceAvailabilityQueryFromReservationSearchParams } from "./reservation-checkout-query";

describe("getWorkspaceAvailabilityQueryFromReservationSearchParams", () => {
  test("normalizes checkout tier aliases for availability", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      monitorOption: "2x27-qhd",
      tier: "profi",
    });

    expect(query).toMatchObject({
      date: "2099-06-10",
      entryTier: "profi",
      monitorOption: "2x27-qhd",
    });
  });

  test("drops monitor options for tiers that do not use monitors", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      entryTier: "basic",
      monitorOption: "2x27-qhd",
    });

    expect(query).toMatchObject({
      date: "2099-06-10",
      entryTier: "basic",
    });
    expect(query.monitorOption).toBeUndefined();
  });
});
