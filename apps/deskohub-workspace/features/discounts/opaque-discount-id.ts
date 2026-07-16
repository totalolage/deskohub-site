import { createHash } from "node:crypto";
import { Schema } from "effect";
import { discountIdSchema } from "./contracts";

const decodeDiscountId = Schema.decodeUnknownSync(discountIdSchema);

export const deriveOpaqueDiscountId = (input: {
  readonly providerNamespace: string;
  readonly providerReference: string;
}) =>
  decodeDiscountId(
    createHash("sha256")
      .update(
        JSON.stringify([input.providerNamespace, input.providerReference])
      )
      .digest("base64url")
  );
