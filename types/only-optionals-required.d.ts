import type { OptionalKeys } from "./optional-keys";

export type OnlyOptionalsRequired<T extends object> = Required<
  Pick<T, OptionalKeys<T>>
>;
