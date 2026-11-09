import { Option } from "effect";

/**
 * A release gate's value for every visitor: `on` or `off` when the flag is
 * the same for everyone, `undecided` when PostHog decides it per visitor or
 * the value can't be read without a request.
 */
export type GlobalRelease = "on" | "undecided" | "off";

/** The release a flag's `constantValue` describes. */
export const globalRelease = (
  constantValue: Option.Option<boolean>
): GlobalRelease =>
  Option.match(constantValue, {
    onNone: () => "undecided",
    onSome: (enabled) => (enabled ? "on" : "off"),
  });
