import type {
  AsyncResult,
  Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { settle } from "../../../customer-api/testing/customer-data-test-registry";

/** The settled value of a booking read the test expects to succeed. */
export const settledValue = async <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
): Promise<A> => {
  const result = await settle(registry, atom);
  if (result._tag !== "Success") {
    throw new Error(`expected a value, got ${String(result.failure)}`);
  }
  return result.success;
};
