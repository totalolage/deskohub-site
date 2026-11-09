import { Effect, Layer } from "effect";
import { apiOrigin, authClient } from "../auth/auth-client";
import { AccountReadBudget } from "./account-read-budget";
import {
  type AccountSession,
  accountDeviceLayer,
} from "./account-scoped-storage";
import {
  CustomerAccountScope,
  CustomerApi,
  CustomerAuthApi,
  CustomerSessionCheck,
} from "./customer-api.service";
import { customerApiTransportLayer } from "./customer-api-transport";
import type { CustomerDataServices } from "./customer-data-runtime";
import { deviceCapabilitiesLayer } from "./device-capabilities-layer";

/**
 * The production data layer for one signed-in account. A 401 asks the
 * Better Auth client to read the session again (the same signal its own
 * session hooks use), so the guard redirects only once the session is gone.
 */
export const liveCustomerDataLayer = ({
  accountId,
  sessionStartedAt,
}: AccountSession): Layer.Layer<CustomerDataServices> =>
  Layer.mergeAll(
    Layer.mergeAll(CustomerApi.Default, CustomerAuthApi.Default).pipe(
      Layer.provide(customerApiTransportLayer)
    ),
    AccountReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, {
      recheck: Effect.sync(() => authClient.$store.notify("$sessionSignal")),
    }),
    accountDeviceLayer(deviceCapabilitiesLayer).pipe(
      Layer.provideMerge(
        Layer.succeed(CustomerAccountScope, {
          accountId,
          apiOrigin,
          sessionStartedAt,
        })
      )
    )
  );
