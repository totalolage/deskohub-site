import { expect, test } from "bun:test";

test("keeps the feature flag codegen credential out of production builds", async () => {
  const config = (await Bun.file(
    new URL("../../../turbo.json", import.meta.url)
  ).json()) as {
    readonly tasks: {
      readonly build: { readonly env: readonly string[] };
      readonly "feature-flags:sync": { readonly env: readonly string[] };
    };
  };

  expect(config.tasks.build.env).not.toContain("POSTHOG_FEATURE_FLAGS_API_KEY");
  expect(config.tasks.build.env).not.toContain("POSTHOG_HOST");
  expect(config.tasks["feature-flags:sync"].env).toContain(
    "POSTHOG_FEATURE_FLAGS_API_KEY"
  );
});
