import { Effect, Option, Schema } from "effect";
import Mustache from "mustache";
import type { PostHogFeatureFlagDefinition } from "./definitions";
import { PostHogFeatureFlagError } from "./errors";

type PayloadType =
  | { readonly kind: "array"; readonly items: readonly PayloadType[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "null" }
  | { readonly kind: "number" }
  | {
      readonly kind: "object";
      readonly properties: readonly {
        readonly key: string;
        readonly value: PayloadType;
      }[];
    }
  | { readonly kind: "string" }
  | { readonly kind: "undefined" }
  | { readonly kind: "unknown" };

interface PostHogFeatureFlagContractTemplateView {
  readonly featureFlags: readonly {
    readonly keyLiteral: string;
    readonly payloadType: string;
    readonly hasVariants: boolean;
    readonly variantLiterals: readonly string[];
  }[];
}

export const renderPostHogFeatureFlagContract = Effect.fn(
  "renderPostHogFeatureFlagContract"
)(function* (definitions: readonly PostHogFeatureFlagDefinition[]) {
  const sortedDefinitions = [...definitions].toSorted((left, right) =>
    left.key.localeCompare(right.key)
  );

  if (
    sortedDefinitions.some(
      (definition, index) =>
        definition.key === sortedDefinitions[index - 1]?.key
    )
  ) {
    return yield* new PostHogFeatureFlagError({
      message: "PostHog feature flag keys must be unique.",
    });
  }

  const template = yield* readTemplate("feature-flag-contract.ts.mustache");

  return Mustache.render(template, {
    featureFlags: sortedDefinitions.map((definition) => ({
      keyLiteral: JSON.stringify(definition.key),
      payloadType: renderPayloadTypeForFlag(definition),
      hasVariants: definition.variants.length > 0,
      variantLiterals: definition.variants.map((variant) =>
        JSON.stringify(variant)
      ),
    })),
  } satisfies PostHogFeatureFlagContractTemplateView);
});

interface PostHogFeatureFlagSnapshotTemplateView {
  readonly generatedAtLiteral: string;
  readonly featureFlags: readonly {
    readonly keyLiteral: string;
    readonly constantValueLiteral: string;
  }[];
}

/**
 * Renders the constant value of each of `keys` from `definitions`, read at
 * `generatedAt`. A key without a definition depends on the request.
 */
export const renderPostHogFeatureFlagSnapshot = Effect.fn(
  "renderPostHogFeatureFlagSnapshot"
)(function* ({
  definitions,
  generatedAt,
  keys,
}: {
  readonly definitions: readonly PostHogFeatureFlagDefinition[];
  readonly generatedAt: Date;
  readonly keys: readonly string[];
}) {
  const constantValues = new Map(
    definitions.map(({ constantEnabledValue, key }) => [
      key,
      constantEnabledValue,
    ])
  );
  const template = yield* readTemplate("feature-flag-snapshot.ts.mustache");

  return Mustache.render(template, {
    generatedAtLiteral: JSON.stringify(generatedAt.toISOString()),
    featureFlags: [...new Set(keys)]
      .toSorted((left, right) => left.localeCompare(right))
      .map((key) => ({
        keyLiteral: JSON.stringify(key),
        constantValueLiteral: JSON.stringify(constantValues.get(key) ?? null),
      })),
  } satisfies PostHogFeatureFlagSnapshotTemplateView);
});

const readTemplate = (name: string) =>
  Effect.tryPromise({
    try: () => Bun.file(new URL(`./${name}`, import.meta.url)).text(),
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: `Could not read the feature flag template ${name}.`,
        cause,
      }),
  });

const renderPayloadTypeForFlag = (definition: PostHogFeatureFlagDefinition) =>
  renderPayloadTypeUnion([
    { kind: "undefined" },
    ...Object.values(definition.payloads).map(inferPayloadType),
  ]);

const inferPayloadType = (payload: Schema.Json): PayloadType => {
  if (typeof payload !== "string") return inferJsonPayloadType(payload, 0);
  if (isRedactedPayload(payload)) return { kind: "unknown" };

  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(
    payload
  );
  return Option.isSome(parsed)
    ? inferJsonPayloadType(parsed.value, 0)
    : { kind: "string" };
};

const isRedactedPayload = (payload: string) => {
  const normalized = payload.trim().toLowerCase();
  return normalized === "[redacted]" || normalized === "<redacted>";
};

const inferJsonPayloadType = (
  value: Schema.Json,
  depth: number
): PayloadType => {
  if (depth > 6) return { kind: "unknown" };
  if (value === null) return { kind: "null" };

  switch (typeof value) {
    case "boolean":
      return { kind: "boolean" };
    case "number":
      return { kind: "number" };
    case "string":
      return { kind: "string" };
    case "object": {
      if (isJsonArray(value)) {
        return {
          kind: "array",
          items:
            value.length > 50
              ? [{ kind: "unknown" }]
              : value.map((item) => inferJsonPayloadType(item, depth + 1)),
        };
      }

      return {
        kind: "object",
        properties: Object.entries(value)
          .map(([key, property]) => ({
            key,
            value: inferJsonPayloadType(property, depth + 1),
          }))
          .toSorted((left, right) => left.key.localeCompare(right.key)),
      };
    }
  }
};

const isJsonArray = (value: Schema.Json): value is readonly Schema.Json[] =>
  Array.isArray(value);

const renderPayloadTypeUnion = (types: readonly PayloadType[]) => {
  const renderedTypes = [...new Set(types.map(renderPayloadType))].toSorted();
  return renderedTypes.includes("unknown")
    ? "unknown"
    : renderedTypes.join(" | ");
};

const renderPayloadType = (type: PayloadType): string => {
  switch (type.kind) {
    case "array":
      return renderArrayPayloadType(type.items);
    case "object":
      return renderObjectPayloadType(type.properties);
    default:
      // Every other kind is the TypeScript type of the same name.
      return type.kind;
  }
};

const renderArrayPayloadType = (items: readonly PayloadType[]) =>
  `readonly (${renderPayloadTypeUnion(items.length > 0 ? items : [{ kind: "unknown" }])})[]`;

const renderObjectPayloadType = (
  properties: Extract<PayloadType, { readonly kind: "object" }>["properties"]
) =>
  properties.length === 0
    ? "Readonly<Record<string, never>>"
    : [
        "{",
        ...properties.map(
          (property) =>
            `readonly ${JSON.stringify(property.key)}: ${renderPayloadType(property.value)};`
        ),
        "}",
      ].join(" ");
