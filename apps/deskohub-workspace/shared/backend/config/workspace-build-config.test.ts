import { expect, test } from "bun:test";

test("passes the feature flag codegen credential into production builds", async () => {
  const config = (await Bun.file(
    new URL("../../../turbo.json", import.meta.url)
  ).json()) as {
    readonly tasks: {
      readonly build: { readonly env: readonly string[] };
    };
  };

  expect(config.tasks.build.env).toContain("POSTHOG_FEATURE_FLAGS_API_KEY");
});
