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

    expect(contract).toContain(
      'import { definePostHogFeatureFlags } from "@deskohub/posthog/feature-flags";'
    );
    expect(contract).toContain(
      "export const postHogFeatureFlags = definePostHogFeatureFlags<"
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

  test("rejects duplicate keys through the Effect error channel", async () => {
    const result = await Effect.runPromiseExit(
      renderPostHogFeatureFlagContract([
        { key: "duplicate", payloads: {}, variants: [] },
        { key: "duplicate", payloads: {}, variants: [] },
      ])
    );

    expect(result._tag).toBe("Failure");
  });
});
