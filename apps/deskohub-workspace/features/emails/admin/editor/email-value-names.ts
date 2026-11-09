import type { EmailCustomerFieldPath } from "./email-value-options";

/** Value names allow 64 characters; keep room for a `_12` suffix. */
const baseLength = 60;

/** `segment` as a value name: `displayName` becomes `display_name`. */
const valueNameBase = (segment: string): string => {
  const base = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, baseLength)
    .replace(/_+$/, "");
  if (!base) return "value";
  return /^[a-z]/.test(base) ? base : `value_${base}`.slice(0, baseLength);
};

/**
 * A valid value name for a new definition that no other definition has: the
 * customer field's last path segment, such as `display_name`, or `discount`
 * for a discount value, numbered from `_2` while it's taken.
 */
export const suggestedEmailValueName = (
  source: EmailCustomerFieldPath | "discount",
  takenNames: Iterable<string | undefined>
): string => {
  const base = valueNameBase(
    source === "discount" ? "discount" : (source.at(-1) ?? "")
  );
  const taken = new Set(takenNames);
  if (!taken.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const name = `${base}_${number}`;
    if (!taken.has(name)) return name;
  }
};
