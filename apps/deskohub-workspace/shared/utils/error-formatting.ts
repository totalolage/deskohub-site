export function formatError(cause: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  const error = cause;
  if (error instanceof Error) {
    return {
      code: error.name || "UNKNOWN_ERROR",
      message: error.message,
      details: error.stack,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
  };
}
