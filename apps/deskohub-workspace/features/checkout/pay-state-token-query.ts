/**
 * The query parameter carrying a signed Pay state. Kept free of the Pay-state
 * implementation so the proxy can recognize it without loading checkout code.
 */
export const payStateTokenQueryParam = "payState" as const;
