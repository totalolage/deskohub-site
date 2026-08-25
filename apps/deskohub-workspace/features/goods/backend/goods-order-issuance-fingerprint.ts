import { createHash } from "node:crypto";
import type { IssueGoodsOrderRequest } from "../goods-order";

type GoodsOrderFingerprintInput = Pick<
  IssueGoodsOrderRequest,
  "acknowledged" | "quoteToken"
>;

export const getGoodsOrderIssuanceFingerprint = (
  input: GoodsOrderFingerprintInput
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        acknowledged: input.acknowledged,
        quoteToken: input.quoteToken,
      })
    )
    .digest("hex");
