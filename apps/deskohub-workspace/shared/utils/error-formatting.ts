export function formatEffectError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
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
