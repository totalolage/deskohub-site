import { Data } from "effect";

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly url?: string;
}> {
  get code() {
    return "NETWORK_ERROR";
  }
}
