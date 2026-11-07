import { Effect, type Layer } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import {
  type CustomerDataServices,
  customerDataLayer,
} from "../customer-data-runtime";
import {
  type FakeDevice,
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "./fake-customer-data";
import { FakeWorkspace } from "./fake-workspace";
import type { SampleAccountKind } from "./sample-fixtures";

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
  workspace: FakeWorkspace = FakeWorkspace.forKind(kind)
) => {
  const device: FakeDevice = makeFakeDevice();
  const registry = makeCustomerDataRegistry(
    fakeCustomerDataLayer({ workspace, device })
  );
  return { registry, workspace, device };
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
