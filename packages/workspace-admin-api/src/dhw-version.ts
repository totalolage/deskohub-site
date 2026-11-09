import { Context, Option, Schema } from "effect";

/** The request header that carries the calling `dhw` binary's version. */
export const dhwVersionHeader = "x-dhw-version";

/**
 * A `dhw` version: a semantic version, with build metadata on development
 * and pull-request builds (`1.20.0+pr.12.abc123`).
 */
export const DhwVersion = Schema.String.check(
  Schema.isPattern(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  )
)
  .pipe(Schema.brand("DhwVersion"))
  .annotate({ identifier: "DhwVersion" });
export type DhwVersion = typeof DhwVersion.Type;

/**
 * The oldest `dhw` allowed to call an endpoint, as an endpoint or group
 * annotation. Raise it when a response gains a field an older binary would
 * drop and then write back. The server rejects a missing, malformed, or
 * older `x-dhw-version` before the handler runs.
 */
export const MinimumDhwVersion = Context.Reference<Option.Option<DhwVersion>>(
  "@deskohub/workspace-admin-api/MinimumDhwVersion",
  { defaultValue: Option.none }
);

/**
 * Which error refuses a `dhw` older than an operation's minimum, as an
 * endpoint or group annotation. A released binary decodes only the errors
 * its own contract declared on the endpoint, so an operation that gains a
 * minimum after release refuses with `CliServiceUnavailable`, which every
 * authenticated operation declared from the start. Operations that declared
 * `CliInputInvalid` from their first release refuse with it.
 */
export const OutdatedDhwRefusal = Context.Reference<
  "CliInputInvalid" | "CliServiceUnavailable"
>("@deskohub/workspace-admin-api/OutdatedDhwRefusal", {
  defaultValue: () => "CliInputInvalid",
});
