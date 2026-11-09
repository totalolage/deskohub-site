import { Effect, Layer } from "effect";
import { AccountReadBudget } from "../account-read-budget";
import { accountDeviceLayer } from "../account-scoped-storage";
import {
  CustomerAccountScope,
  CustomerSessionCheck,
} from "../customer-api.service";
import type { CustomerDataServices } from "../customer-data-runtime";
import { deviceCapabilitiesLayer } from "../device-capabilities-layer";
import type { SampleAccountKind } from "../sample-data-mode";
import { fakeCustomerApiLayer } from "./fake-customer-data";
import { FakeWorkspace, fakeWorkspaceOrigin } from "./fake-workspace";

/**
 * The development-only sample-data layer: the real clients over a fake
 * Workspace seeded with synthetic fixtures, with the device's real share
 * sheet, clipboard and picker. Loaded only behind the sample-data switch.
 */
export const sampleCustomerDataLayer = (
  kind: SampleAccountKind
): Layer.Layer<CustomerDataServices> => {
  const workspace = FakeWorkspace.forKind(kind);
  return Layer.mergeAll(
    fakeCustomerApiLayer(workspace),
    AccountReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, { recheck: Effect.void }),
    accountDeviceLayer(deviceCapabilitiesLayer).pipe(
      Layer.provideMerge(
        Layer.succeed(CustomerAccountScope, {
          accountId: workspace.data.accountId,
          apiOrigin: fakeWorkspaceOrigin,
          sessionStartedAt: 0,
        })
      )
    )
  );
};
