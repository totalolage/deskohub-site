import { Predicate } from "effect";

export const getDiscountAdminValidationMessage = <T>(
  value: T
): string | null => {
  if (Predicate.isString(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = getDiscountAdminValidationMessage(item);
      if (message) return message;
    }
  }
  if (Predicate.isObject(value)) {
    for (const item of Object.values(value)) {
      const message = getDiscountAdminValidationMessage(item);
      if (message) return message;
    }
  }
  return null;
};
