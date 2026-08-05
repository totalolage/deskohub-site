export const getDiscountAdminValidationMessage = (
  value: unknown
): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = getDiscountAdminValidationMessage(item);
      if (message) return message;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const message = getDiscountAdminValidationMessage(item);
      if (message) return message;
    }
  }
  return null;
};
