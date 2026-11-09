import { Effect, Layer } from "effect";
import {
  type WorkspaceE2EHostedPaymentPermit,
  WorkspaceE2EHostedPaymentPermitService,
} from "./hosted-payment-permit.service";

const unboundedHostedPaymentPermit: WorkspaceE2EHostedPaymentPermit = {
  withPermit: (_operation, effect) => effect,
};

export const WorkspaceE2EHostedPaymentPermitServiceMock = Layer.succeed(
  WorkspaceE2EHostedPaymentPermitService,
  unboundedHostedPaymentPermit
);

/** Pass-through permit that reports whether a hosted session is open. */
export const makeWorkspaceE2EHostedPaymentPermitRecorder = () => {
  let openSessions = 0;
  const recordingPermit: WorkspaceE2EHostedPaymentPermit = {
    withPermit: (_operation, effect) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          openSessions += 1;
        }),
        () => effect,
        () =>
          Effect.sync(() => {
            openSessions -= 1;
          })
      ),
  };
  return {
    isHolding: () => openSessions > 0,
    layer: Layer.succeed(
      WorkspaceE2EHostedPaymentPermitService,
      recordingPermit
    ),
  };
};
