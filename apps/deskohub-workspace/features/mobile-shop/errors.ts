import { Data } from "effect";
import type { MobileShopErrorCode } from "./contracts";

export class MobileShopFailure extends Data.TaggedError("MobileShopFailure")<{
  readonly code: MobileShopErrorCode;
  readonly cause?: unknown;
}> {
  static unauthorized = (cause?: unknown) =>
    new MobileShopFailure({ code: "unauthorized", cause });

  static integrationUnavailable = (cause?: unknown) =>
    new MobileShopFailure({ code: "service_unavailable", cause });
}
