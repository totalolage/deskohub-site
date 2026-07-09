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

const getScalarProperty = (
  input: object,
  property: string
): string | number | boolean | undefined => {
  const value = Object.getOwnPropertyDescriptor(input, property)?.value;

  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
};

export const serializeErrorForLog = (error: unknown, depth = 0): unknown => {
  if (depth > 2) {
    return "[truncated]";
  }

  if (
    error === null ||
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return error;
  }

  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: error.errors.map((cause) =>
        serializeErrorForLog(cause, depth + 1)
      ),
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined && {
        cause: serializeErrorForLog(error.cause, depth + 1),
      }),
      ...(getScalarProperty(error, "code") !== undefined && {
        code: getScalarProperty(error, "code"),
      }),
      ...(getScalarProperty(error, "status") !== undefined && {
        status: getScalarProperty(error, "status"),
      }),
      ...(getScalarProperty(error, "statusCode") !== undefined && {
        statusCode: getScalarProperty(error, "statusCode"),
      }),
    };
  }

  if (typeof error === "object") {
    const details = {
      name: getScalarProperty(error, "name"),
      message: getScalarProperty(error, "message"),
      code: getScalarProperty(error, "code"),
      status: getScalarProperty(error, "status"),
      statusCode: getScalarProperty(error, "statusCode"),
    };
    const entries = Object.entries(details).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined
    );

    return entries.length > 0
      ? Object.fromEntries(entries)
      : Object.prototype.toString.call(error);
  }

  return String(error);
};
