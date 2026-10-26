import { Data } from "effect";

/**
 * A Dotypos record Workspace needs to address has no valid id, such as a
 * customer or reservation Dotypos created without one.
 */
export class MissingDotyposId extends Data.TaggedError("MissingDotyposId")<{
  readonly entity: "reservation" | "customer";
  readonly message: string;
}> {}
