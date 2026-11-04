import { Data } from "effect";

/**
 * A stored Dotypos reference Workspace needs to address has no valid id, such
 * as a held reservation row without its Dotypos customer id.
 */
export class MissingDotyposId extends Data.TaggedError("MissingDotyposId")<{
  readonly entity: "customer";
  readonly message: string;
}> {}
