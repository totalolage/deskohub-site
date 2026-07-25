export type ErrorMetadata = {
  readonly kind:
    | "aggregate_error"
    | "bigint"
    | "boolean"
    | "circular"
    | "error"
    | "function"
    | "null"
    | "number"
    | "object"
    | "string"
    | "symbol"
    | "tagged_object"
    | "truncated"
    | "undefined";
  readonly category?: "custom" | "native";
  readonly cause?: ErrorMetadata;
  readonly errors?: readonly ErrorMetadata[];
};

const nativeErrorPrototypes = new Set<object>([
  Error.prototype,
  EvalError.prototype,
  RangeError.prototype,
  ReferenceError.prototype,
  SyntaxError.prototype,
  TypeError.prototype,
  URIError.prototype,
]);

const getOwnValue = (input: object, property: string): unknown =>
  Object.getOwnPropertyDescriptor(input, property)?.value;

const projectErrorMetadataInternal = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): ErrorMetadata => {
  if (depth > 4) return { kind: "truncated" };
  if (value === null) return { kind: "null" };

  if (typeof value !== "object") {
    return {
      kind: typeof value as Exclude<
        ErrorMetadata["kind"],
        | "aggregate_error"
        | "circular"
        | "error"
        | "null"
        | "object"
        | "tagged_object"
        | "truncated"
      >,
    };
  }

  if (seen.has(value)) return { kind: "circular" };
  seen.add(value);

  if (value instanceof AggregateError) {
    return {
      kind: "aggregate_error",
      errors: value.errors
        .slice(0, 8)
        .map((error) => projectErrorMetadataInternal(error, depth + 1, seen)),
    };
  }

  if (value instanceof Error) {
    const cause = getOwnValue(value, "cause");
    return {
      kind: "error",
      category: nativeErrorPrototypes.has(Object.getPrototypeOf(value))
        ? "native"
        : "custom",
      ...(cause !== undefined
        ? {
            cause: projectErrorMetadataInternal(cause, depth + 1, seen),
          }
        : {}),
    };
  }

  const cause = getOwnValue(value, "cause");
  const nestedErrors = getOwnValue(value, "errors");
  return {
    kind:
      typeof getOwnValue(value, "_tag") === "string"
        ? "tagged_object"
        : "object",
    ...(cause !== undefined
      ? { cause: projectErrorMetadataInternal(cause, depth + 1, seen) }
      : {}),
    ...(Array.isArray(nestedErrors)
      ? {
          errors: nestedErrors
            .slice(0, 8)
            .map((error) =>
              projectErrorMetadataInternal(error, depth + 1, seen)
            ),
        }
      : {}),
  };
};

export const projectErrorMetadata = (value: unknown): ErrorMetadata =>
  projectErrorMetadataInternal(value, 0, new WeakSet());
