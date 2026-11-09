/**
 * Return targets a browser could resolve to another origin, for tests of
 * anything that navigates to a caller-supplied destination.
 */
export const unsafeReturnTargets = [
  "https://evil.example/admin",
  "//evil.example/admin",
  "/\\evil.example/admin",
  "/\\/evil.example",
  "/x/..//evil.example",
  "/x/%2e%2e//evil.example",
  "/x/%2E%2E//evil.example",
  "/.//evil.example",
  "/%2e//evil.example",
  "/x/..\\/evil.example",
  "/x/..\t//evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/x/..\r\n//evil.example",
  "javascript:alert(1)",
] as const;
