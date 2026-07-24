export const canonicalizeDotyposEntityId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const canonical = value.trim();
  return canonical.length > 0 ? canonical : null;
};
