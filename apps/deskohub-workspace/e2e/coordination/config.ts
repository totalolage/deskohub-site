import { Context, Layer, type Redacted } from "effect";

export interface AllocationRuntimeConfigValue {
  readonly githubApiUrl: string;
  readonly githubToken: Redacted.Redacted;
}

export class AllocationRuntimeConfig extends Context.Service<
  AllocationRuntimeConfig,
  AllocationRuntimeConfigValue
>()("WorkspaceE2E/AllocationRuntimeConfig") {
  static layer = (config: AllocationRuntimeConfigValue) =>
    Layer.succeed(this, config);
}
