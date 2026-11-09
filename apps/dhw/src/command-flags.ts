import { type Option, Record } from "effect";

/**
 * Keeps the optional flags the operator passed, keyed by the request field
 * each one fills and in the order given, and leaves the others out.
 */
export const presentFlagValues = <
  const Flags extends Readonly<
    Record.ReadonlyRecord<string, Option.Option<unknown>>
  >,
>(
  flags: Flags
) =>
  Record.getSomes(flags) as {
    readonly [Field in keyof Flags]?: Option.Option.Value<Flags[Field]>;
  };
