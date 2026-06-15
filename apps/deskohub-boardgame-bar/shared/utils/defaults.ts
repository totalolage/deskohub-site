type Key<
  O extends object,
  K extends string | number | symbol,
> = K extends keyof O ? O[K] : never;

export const defaults = <D extends object, T extends object>(
  defaults: D,
  target: T
) =>
  Object.fromEntries(
    [...Object.keys(defaults), ...Object.keys(target)]
      .filter((key, index, keys) => keys.indexOf(key) === index)
      .map((key) => [
        key,
        (target as Record<string, unknown>)[key] ??
          (defaults as Record<string, unknown>)[key],
      ])
  ) as {
    [K in keyof T | keyof D]: K extends keyof T
      ? T[K] extends null | undefined
        ? null | undefined extends T[K]
          ? Key<D, K>
          : NonNullable<T[K]> | Key<D, K>
        : T[K]
      : Key<D, K>;
  };
