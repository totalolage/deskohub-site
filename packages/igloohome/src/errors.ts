import { Data } from "effect";

export type IgloohomeRequestOutcome = "rejected" | "ambiguous";

export class IgloohomeRequestError extends Data.TaggedError(
  "IgloohomeRequestError"
)<{
  readonly operation: "authenticate" | "issue_hourly_algopin";
  readonly outcome: IgloohomeRequestOutcome;
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
}> {}
