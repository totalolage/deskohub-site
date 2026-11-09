import { Order, Predicate } from "effect";

export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<CanonicalJsonValue>
  | { readonly [key: string]: CanonicalJsonValue | undefined };

const isJsonArray = (
  value: CanonicalJsonValue
): value is ReadonlyArray<CanonicalJsonValue> => Array.isArray(value);

/**
 * Serializes a JSON value with object keys sorted, so equal values always
 * produce the same string. Keys whose value is `undefined` are dropped, as in
 * `JSON.stringify`.
 */
export function canonicalJson(value: CanonicalJsonValue): string {
  if (isJsonArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (Predicate.isObject(value)) {
    const entries = Object.entries(value)
      .filter((entry): entry is [string, CanonicalJsonValue] =>
        Predicate.isNotUndefined(entry[1])
      )
      .sort(([left], [right]) => Order.String(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}
