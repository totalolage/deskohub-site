import { Context, Schema } from "effect";

export const NexiRuntimeConfigSchema = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  apiKey: Schema.NonEmptyString,
  apiTimeout: Schema.Number.check(
    Schema.isGreaterThan(0, { description: "API timeout in milliseconds" })
  ),
});

export type NexiRuntimeConfigObj = Schema.Schema.Type<
  typeof NexiRuntimeConfigSchema
>;

export class NexiRuntimeConfig extends Context.Service<
  NexiRuntimeConfig,
  NexiRuntimeConfigObj
>()("@deskohub/nexi/NexiRuntimeConfig") {}
