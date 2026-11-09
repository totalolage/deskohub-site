import { Effect, Layer } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { AccountReadBudget } from "../account-read-budget";
import {
  AccountExitFence,
  makeAccountExitFence,
} from "../account-scoped-storage";
import {
  type CustomerDataServices,
  customerDataLayer,
  customerDataRuntime,
} from "../customer-data-runtime";
import {
  type FakeDevice,
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "./fake-customer-data";
import { FakeWorkspace } from "./fake-workspace";
import type { SampleAccountKind } from "./sample-fixtures";

type AccountExitFenceApi = ReturnType<typeof makeAccountExitFence>;

/** A registry whose data runtime runs on `layer`, as one account's would. */
export const makeCustomerDataRegistry = (
  layer: Layer.Layer<CustomerDataServices>
) =>
  AtomRegistry.make({
    initialValues: [Atom.initialValue(customerDataLayer, layer)],
  });

/**
 * A registry over a fake Workspace in the given account state, with the
 * workspace and device to arrange and assert on.
 */
export const makeFakeCustomerData = (
  kind: SampleAccountKind = "linked",
  workspace: FakeWorkspace = FakeWorkspace.forKind(kind),
  fence: AccountExitFenceApi = makeAccountExitFence()
) => {
  const device: FakeDevice = makeFakeDevice();
  const registry = makeCustomerDataRegistry(
    fakeCustomerDataLayer({
      workspace,
      device,
      fence: Layer.succeed(AccountExitFence, fence),
    })
  );
  return { registry, workspace, device, fence };
};

/**
 * Mounts an async atom and resolves with its settled value, or rejects with
 * its failure, like a screen waiting for its data.
 */
export const settle = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) => {
  const unmount = registry.mount(atom);
  return Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  ).finally(unmount);
};

/** The account reads the registry's data runtime has left, by its own count. */
export const remainingAccountReads = (registry: AtomRegistry.AtomRegistry) =>
  Effect.runPromise(
    Effect.provideContext(
      Effect.flatMap(
        Effect.service(AccountReadBudget),
        (budget) => budget.remaining
      ),
      AsyncResult.getOrThrow(registry.get(customerDataRuntime))
    )
  );
