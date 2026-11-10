import { type Context, Effect, Layer } from "effect";
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
 */
export const servicePerOperation = <I, S extends Operations<S>>(
  service: Context.Key<I, S>,
  operations: { readonly [K in keyof S]: true },
  implementation: Layer.Layer<I>
): Layer.Layer<I> => {
  const forward =
    (name: keyof S) =>
    (...input: ReadonlyArray<unknown>) =>
      Effect.flatMap(
        Effect.service(service),
        (instance): Effect.Effect<unknown, unknown> =>
          Reflect.apply(instance[name], instance, input)
      ).pipe(providePerRequest(implementation));
  const forwarded: Partial<Operations<S>> = {};
  for (const name of Object.keys(operations) as Array<keyof S>) {
    forwarded[name] = forward(name);
  }
  return Layer.sync(service, () => forwarded as S);
};
