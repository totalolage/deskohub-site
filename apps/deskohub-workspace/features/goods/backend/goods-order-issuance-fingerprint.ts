import { createHash } from "node:crypto";
import type { GoodsOrderIssuanceFacts } from "../goods-order";

type GoodsOrderFingerprintInput = Pick<
  GoodsOrderIssuanceFacts,
  "expectedCart" | "legalDocuments"
>;

export const getGoodsOrderIssuanceFingerprint = (
  input: GoodsOrderFingerprintInput
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        cart: {
          revision: input.expectedCart.revision,
          items: input.expectedCart.items
            .map(({ productId, quantity }) => ({ productId, quantity }))
            .toSorted((left, right) =>
              left.productId.localeCompare(right.productId)
            ),
        },
        legalDocuments: input.legalDocuments
          .map(({ acknowledgements, document, documentKey }) => ({
            documentKey,
            documentHash: document.hash,
            acknowledgements: Object.entries(acknowledgements ?? {}).toSorted(
              ([left], [right]) => left.localeCompare(right)
            ),
          }))
          .toSorted((left, right) =>
            left.documentKey.localeCompare(right.documentKey)
          ),
      })
    )
    .digest("hex");
