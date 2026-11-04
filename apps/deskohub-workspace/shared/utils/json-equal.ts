/**
 * Whether two JSON-shaped values encode identically, property order
 * included. Signed snapshots compare this way, so a reordered value differs.
 */
export const haveSameJsonEncoding = <A>(left: A, right: A) =>
  JSON.stringify(left) === JSON.stringify(right);
