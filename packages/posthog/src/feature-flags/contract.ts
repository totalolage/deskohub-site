export interface PostHogFeatureFlagDefinitionContract {
  readonly payload: unknown;
  readonly value: boolean | string;
}

type ValidPostHogFeatureFlagDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

declare const postHogFeatureFlagDefinitions: unique symbol;

export interface PostHogFeatureFlagContract<
  Definitions extends ValidPostHogFeatureFlagDefinitions<Definitions>,
> {
  readonly keys: readonly Extract<keyof Definitions, string>[];
  readonly [postHogFeatureFlagDefinitions]?: Definitions;
}

export type PostHogFeatureFlagKey<Definitions> = Extract<
  keyof Definitions,
  string
>;

export type PostHogFeatureFlagValue<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> = Definitions[Key] extends { readonly value: infer Value } ? Value : never;

export type PostHogFeatureFlagPayload<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> = Definitions[Key] extends { readonly payload: infer Payload }
  ? Payload
  : never;

export const definePostHogFeatureFlags = <
  const Definitions extends ValidPostHogFeatureFlagDefinitions<Definitions>,
>(
  keys: readonly PostHogFeatureFlagKey<Definitions>[]
): PostHogFeatureFlagContract<Definitions> => ({ keys });
