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

test("includes runtime feature flag overrides in the Workspace build cache", async () => {
  const [appConfig, rootConfig] = (await Promise.all([
    Bun.file(new URL("../../../turbo.json", import.meta.url)).json(),
    Bun.file(new URL("../../../../../turbo.json", import.meta.url)).json(),
  ])) as [
    {
      readonly tasks: {
        readonly build: { readonly env: readonly string[] };
      };
    },
    {
      readonly globalPassThroughEnv: readonly string[];
    },
  ];

  expect(appConfig.tasks.build.env).toContain("POSTHOG_FEATURE_FLAG_OVERRIDES");
  expect(rootConfig.globalPassThroughEnv).toContain(
    "POSTHOG_FEATURE_FLAG_OVERRIDES"
  );
});
