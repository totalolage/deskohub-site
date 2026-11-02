import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PostHogFeatureFlagDefinition } from "./definitions";
import { renderPostHogFeatureFlagContract } from "./render";

const definitions: readonly PostHogFeatureFlagDefinition[] = [
  { key: "meeting_room_page", payloads: {}, variants: [] },
  {
    key: "room_experience",
    payloads: {
      control: '{"capacity":8,"features":["screen",true]}',
      fallback: "not-json",
    },
    variants: ["control", "treatment"],
  },
];

describe("renderPostHogFeatureFlagContract", () => {
  test("renders sorted keys, variants, and structural payload types", async () => {
    const contract = await Effect.runPromise(
      renderPostHogFeatureFlagContract([...definitions].reverse())
    );

    expect(contract).toContain('  "meeting_room_page",\n  "room_experience",');
    expect(contract).toContain(
      'readonly value: false | "control" | "treatment";'
    );
    expect(contract).toContain('readonly "capacity": number;');
    expect(contract).toContain(
      'readonly "features": readonly (boolean | string)[];'
    );
    expect(contract).toContain("readonly payload: string | undefined | {");
  });

  test("renders empty, nested, null and too-deep payload structures", async () => {
    const tooDeep = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":1}}}}}}}}';
    const contract = await Effect.runPromise(
      renderPostHogFeatureFlagContract([
        {
          key: "shapes",
          payloads: {
            empty: '{"list":[],"settings":{}}',
            nested: '{"rooms":[{"open":null,"seats":2}]}',
          },
          variants: ["empty", "nested"],
        },
        { key: "too_deep", payloads: { deep: tooDeep }, variants: ["deep"] },
        { key: "unparsed", payloads: { raw: [1, "two"] }, variants: ["raw"] },
      ])
    );

    expect(contract).toContain(
      'readonly payload: undefined | { readonly "list": readonly (unknown)[]; readonly "settings": Readonly<Record<string, never>>; } | { readonly "rooms": readonly ({ readonly "open": null; readonly "seats": number; })[]; };'
    );
    expect(contract).toContain(
      'readonly payload: undefined | { readonly "a": { readonly "b": { readonly "c": { readonly "d": { readonly "e": { readonly "f": { readonly "g": unknown; }; }; }; }; }; }; };'
    );
    expect(contract).toContain(
      "readonly payload: readonly (number | string)[] | undefined;"
    );
  });

  test("never copies configured payload values into generated source", async () => {
    const contract = await Effect.runPromise(
      renderPostHogFeatureFlagContract([
        {
          key: "private_payload",
          payloads: { control: '{"apiKey":"do-not-commit-this-value"}' },
          variants: ["control"],
        },
      ])
    );

    expect(contract).toContain('readonly "apiKey": string;');
    expect(contract).not.toContain("do-not-commit-this-value");
  });

  test("uses unknown for redacted payloads", async () => {
    const contract = await Effect.runPromise(
      renderPostHogFeatureFlagContract([
        {
          key: "redacted_payload",
          payloads: { control: "[REDACTED]" },
          variants: ["control"],
        },
      ])
    );

    expect(contract).toContain("readonly payload: unknown;");
  });

  test("renders TypeScript literals without HTML escaping", async () => {
    const contract = await Effect.runPromise(
      renderPostHogFeatureFlagContract([
        {
          key: "room<&",
          payloads: {},
          variants: ["control<&"],
        },
      ])
    );

    expect(contract).toContain('readonly "room<&": {');
    expect(contract).toContain('readonly value: false | "control<&";');
    expect(contract).not.toContain("&lt;");
    expect(contract).not.toContain("&amp;");
  });
});
