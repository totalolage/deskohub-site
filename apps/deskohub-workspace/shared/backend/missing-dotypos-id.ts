import { Data } from "effect";

/**
 * A Dotypos customer Workspace needs to address has no valid id, such as a
 * customer Dotypos created without one or a held reservation row without its
 * Dotypos customer id.
 */
export class MissingDotyposId extends Data.TaggedError("MissingDotyposId")<{
  readonly entity: "customer";
  readonly message: string;
}> {}
