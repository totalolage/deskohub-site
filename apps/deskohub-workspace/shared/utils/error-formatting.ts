interface ErrorWithTag {
  _tag: string;
  code?: string;
  message?: string;
  details?: unknown;
}

function isErrorWithTag(error: unknown): error is ErrorWithTag {
  if (error === null || typeof error !== "object") {
    return false;
  }

  if (!("_tag" in error)) {
    return false;
  }

  return typeof error._tag === "string";
}

export function formatEffectError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (isErrorWithTag(error)) {
    return {
      code: error.code || error._tag,
      message: error.message || "An error occurred",
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNKNOWN_ERROR",
      message: error.message,
      details: error.stack,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
  };
}
