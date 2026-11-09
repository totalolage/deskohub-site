import { Data } from "effect";
import { formatError } from "@/shared/utils/error-formatting";

/** A campaign body that doesn't fit the campaign content set. */
export class InvalidCampaignBody extends Data.TaggedError(
  "InvalidCampaignBody"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromCause = (cause: unknown) =>
    new InvalidCampaignBody({ message: formatError(cause).message, cause });
}
