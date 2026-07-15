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
    readonly valueType: string;
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

  const template = yield* readPostHogFeatureFlagContractTemplate();

  return Mustache.render(template, {
    featureFlags: sortedDefinitions.map((definition) => ({
      keyLiteral: JSON.stringify(definition.key),
      payloadType: renderPayloadTypeForFlag(definition),
      valueType: renderValueType(definition),
    })),
  } satisfies PostHogFeatureFlagContractTemplateView);
});

function readPostHogFeatureFlagContractTemplate() {
  return Effect.tryPromise({
    try: () =>
      Bun.file(
        new URL("./feature-flag-contract.ts.mustache", import.meta.url)
      ).text(),
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: "Could not read the feature flag contract template.",
        cause,
      }),
  });
}

const renderValueType = (definition: PostHogFeatureFlagDefinition) =>
  definition.variants.length === 0
    ? "boolean"
    : [
        "false",
        ...definition.variants.map((variant) => JSON.stringify(variant)),
      ].join(" | ");

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
      if (Array.isArray(value)) {
        return {
          kind: "array",
          items:
            value.length > 50
              ? [{ kind: "unknown" }]
              : value.map((item) => inferJsonPayloadType(item, depth + 1)),
        };
      }

      const entries = Object.entries(value);
      if (entries.length > 50) return { kind: "unknown" };

      return {
        kind: "object",
        properties: entries
          .map(([key, property]) => ({
            key,
            value: inferJsonPayloadType(property, depth + 1),
          }))
          .toSorted((left, right) => left.key.localeCompare(right.key)),
      };
    }
  }
};

const renderPayloadTypeUnion = (types: readonly PayloadType[]) => {
  const renderedTypes = [...new Set(types.map(renderPayloadType))].toSorted();
  return renderedTypes.includes("unknown")
    ? "unknown"
    : renderedTypes.join(" | ");
};

const renderPayloadType = (type: PayloadType): string => {
  switch (type.kind) {
    case "array":
      return `readonly (${renderPayloadTypeUnion(type.items.length > 0 ? type.items : [{ kind: "unknown" }])})[]`;
    case "boolean":
    case "null":
    case "number":
    case "string":
    case "undefined":
    case "unknown":
      return type.kind;
    case "object":
      return type.properties.length === 0
        ? "Readonly<Record<string, never>>"
        : [
            "{",
            ...type.properties.map(
              (property) =>
                `readonly ${JSON.stringify(property.key)}: ${renderPayloadType(property.value)};`
            ),
            "}",
          ].join(" ");
  }
};
