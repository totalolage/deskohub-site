import { Context, Layer, Schema } from "effect";

export const NexiRuntimeConfigSchema = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  apiKey: Schema.NonEmptyString,
  apiTimeout: Schema.Number.pipe(
    Schema.positive(),
    Schema.annotations({ description: "API timeout in milliseconds" })
  ),
});

export type NexiRuntimeConfigObj = Schema.Schema.Type<
  typeof NexiRuntimeConfigSchema
>;

export class NexiRuntimeConfig extends Context.Tag(
  "@deskohub/nexi/NexiRuntimeConfig"
)<NexiRuntimeConfig, NexiRuntimeConfigObj>() {}

export const makeNexiRuntimeConfigLayer = (config: NexiRuntimeConfigObj) =>
  Layer.succeed(NexiRuntimeConfig, config);
