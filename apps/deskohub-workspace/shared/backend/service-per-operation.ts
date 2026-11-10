import { Context, Effect, Layer } from "effect";
import { providePerRequest } from "./provide-per-request";

/** A service whose every member is an operation that needs nothing more. */
type Operations<S> = {
  readonly [K in keyof S]: (...input: never) => Effect.Effect<unknown, unknown>;
};

/**
 * `service` with every operation run on its own instance of
 * `implementation`, built for that operation with `providePerRequest` over
 * what its run or request already built. `operations` names each of them.
 *
 * Use it for a service an HTTP API builds for the whole handler whose
 * implementation keeps state for its request, such as a release decision or
 * a consent cache: the handler lives for the process, so a plain
 * implementation would hand that state to every later request.
 *
 * `implementation` holds only that request state. What it requires, such as
 * provider clients and repositories, is built once with the returned Layer,
 * by whoever provides it, and every operation's instance takes that one.
 */
export const servicePerOperation = <I, S extends Operations<S>, RIn = never>(
  service: Context.Key<I, S>,
  operations: { readonly [K in keyof S]: true },
  implementation: Layer.Layer<I, never, RIn>
): Layer.Layer<I, never, RIn> =>
  Layer.effect(
    service,
    Effect.map(Effect.context<RIn>(), (shared) => {
      const forward =
        (name: keyof S) =>
        (...input: ReadonlyArray<unknown>) =>
          Effect.flatMap(
            Effect.service(service),
            (instance): Effect.Effect<unknown, unknown> =>
              Reflect.apply(instance[name], instance, input)
          ).pipe(
            providePerRequest(implementation),
            // The operation's own context wins, so `shared` adds only the
            // requirements built with this Layer, never the span or request
            // context that build ran in.
            Effect.updateContext((operation: Context.Context<never>) =>
              Context.merge(shared, operation)
            )
          );
      const forwarded: Partial<Operations<S>> = {};
      for (const name of Object.keys(operations) as Array<keyof S>) {
        forwarded[name] = forward(name);
      }
      return forwarded as S;
    })
  );
