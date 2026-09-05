import { Context, Schema } from "effect";

export const igloohomeApiTimeoutMaximumMilliseconds = 20_000;

export const IgloohomeRuntimeConfigSchema = Schema.Struct({
  apiUrl: Schema.NonEmptyString,
  authUrl: Schema.NonEmptyString,
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  apiTimeout: Schema.Finite.check(
    Schema.isGreaterThan(0, { description: "API timeout in milliseconds" })
  ).check(Schema.isLessThanOrEqualTo(igloohomeApiTimeoutMaximumMilliseconds)),
});

export type IgloohomeRuntimeConfigObj = Schema.Schema.Type<
  typeof IgloohomeRuntimeConfigSchema
>;

export class IgloohomeRuntimeConfig extends Context.Service<
  IgloohomeRuntimeConfig,
  IgloohomeRuntimeConfigObj
>()("@deskohub/igloohome/IgloohomeRuntimeConfig") {}
