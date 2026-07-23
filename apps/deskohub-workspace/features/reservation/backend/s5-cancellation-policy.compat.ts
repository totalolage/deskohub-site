// Compatibility seam for the public S5-01 cancellation policy at
// 315d2214837c32a47585f6563a0f96a62a477765. Stage 6 must resolve this file in
// favor of S5-01's shared owner/lease policy symbol rather than keeping a copy.
export const getS5CancellationAction = (
  status: "NEW" | "CANCELLED" | "CONFIRMED"
) =>
  ({
    CANCELLED: "complete",
    CONFIRMED: "refuse",
    NEW: "delete",
  })[status] as "complete" | "delete" | "refuse";
