import type { CartLine } from "./shop";

export const MAX_QUANTITY_PER_PRODUCT = 10;
export const MAX_CART_QUANTITY = 30;

export function getCartQuantity(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function normalizeCart(lines: readonly CartLine[]): CartLine[] {
  const quantities = new Map<string, number>();

  for (const line of lines) {
    if (typeof line.productId !== "string" || !Number.isFinite(line.quantity))
      continue;
    const quantity = Math.max(
      0,
      Math.min(MAX_QUANTITY_PER_PRODUCT, Math.floor(line.quantity))
    );
    if (quantity === 0) continue;
    const cartRoom =
      MAX_CART_QUANTITY -
      [...quantities.values()].reduce((sum, value) => sum + value, 0);
    if (cartRoom === 0) break;
    quantities.set(line.productId, Math.min(quantity, cartRoom));
  }

  return [...quantities].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

export function setCartQuantity(
  lines: readonly CartLine[],
  productId: string,
  requestedQuantity: number
): CartLine[] {
  const currentQuantity =
    lines.find((line) => line.productId === productId)?.quantity ?? 0;
  const quantityWithoutProduct = getCartQuantity(lines) - currentQuantity;
  const quantity = Math.max(
    0,
    Math.min(
      MAX_QUANTITY_PER_PRODUCT,
      MAX_CART_QUANTITY - quantityWithoutProduct,
      Math.floor(requestedQuantity)
    )
  );
  const nextLines = lines.filter((line) => line.productId !== productId);

  if (quantity > 0) nextLines.push({ productId, quantity });
  return nextLines;
}

export function getLocalCartTotal(
  lines: readonly CartLine[],
  products: readonly { id: string; price: { minorUnits: number } }[]
): number {
  const prices = new Map(
    products.map((product) => [product.id, product.price.minorUnits])
  );
  return lines.reduce(
    (total, line) => total + (prices.get(line.productId) ?? 0) * line.quantity,
    0
  );
}
