export type OptionalKeys<T extends object> = {
  [K in keyof T]-?: {
    [UniqueSymbol]?: never;
  } extends Pick<T, K>
    ? K
    : never;
}[keyof T];
