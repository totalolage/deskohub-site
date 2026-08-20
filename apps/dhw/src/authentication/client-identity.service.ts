import { hostname } from "node:os";
import { Context, Effect, Layer } from "effect";
import { DHW_BUILD_TARGET } from "../build-info";

interface IClientIdentity {
  readonly defaultName: Effect.Effect<string>;
}

export class ClientIdentity extends Context.Service<
  ClientIdentity,
  IClientIdentity
>()("ClientIdentity") {
  static Default = Layer.succeed(this, {
    defaultName: Effect.try({
      try: hostname,
      catch: () => undefined,
    }).pipe(
      Effect.catch(() => Effect.succeed("")),
      Effect.map(makeDefaultClientName)
    ),
  });
}

export function makeDefaultClientName(machineName: string) {
  const normalized = machineName.trim();
  if (normalized.length === 0) return `dhw ${DHW_BUILD_TARGET}`;
  return `dhw on ${normalized}`.slice(0, 80);
}
