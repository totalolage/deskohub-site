import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import {
  type CustomerAccountScope,
  CustomerApi,
  type CustomerAuthApi,
  type CustomerSessionCheck,
} from "./customer-api.service";
import { customerRead } from "./customer-request";
import type { DeviceCapabilities } from "./device-capabilities";
import type { DotyposReadBudget } from "./dotypos-read-budget";

/** Everything account screens' Effects may require. */
export type CustomerDataServices =
  | CustomerApi
  | CustomerAuthApi
  | CustomerAccountScope
  | CustomerSessionCheck
  | DotyposReadBudget
  | DeviceCapabilities;

const notProvided: Layer.Layer<CustomerDataServices> = Layer.effectContext(
  Effect.die("The customer data layer is used outside CustomerDataProvider")
);

/**
 * The layer behind the account screens' data, set per registry:
 * `CustomerDataProvider` seeds the live layer for the signed-in account (or
 * the sample-data layer in development), tests seed fakes with
 * `Atom.initialValue`. Kept alive so it never falls back to the default.
 */
export const customerDataLayer = Atom.keepAlive(Atom.make(notProvided));

// Atom runtimes memoize layers in one MemoMap shared by every registry, so a
// static layer such as `DotyposReadBudget.Default` built for one account would
// serve the next account while the first registry lives. Each registry builds
// its layer with a map of its own.
const builtPerRegistry = <A, E>(layer: Layer.Layer<A, E>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const memoMap = yield* Layer.makeMemoMap;
      return yield* Layer.buildWithMemoMap(layer, memoMap, yield* Effect.scope);
    })
  );

/**
 * The one runtime account screens run Effects in. Each signed-in account gets
 * its own registry, so caches, the read budget and in-flight requests never
 * cross accounts. Queries are `customerDataRuntime.atom(...)` (or a family of
 * them), mutations `customerDataRuntime.fn(...)`.
 */
export const customerDataRuntime = Atom.runtime((get) =>
  builtPerRegistry(get(customerDataLayer))
);

/**
 * The signed-in account (GET /account), which gates every section. Kept
 * alive for the account's registry; mutations that change it refresh it.
 */
export const accountAtom = customerDataRuntime
  .atom(
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.account.getAccount({ headers: {} })
    ).pipe(customerRead({ dotyposBacked: true }))
  )
  .pipe(Atom.keepAlive);
