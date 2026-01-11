import type { MaybePromise } from "bun";
import { Context, Effect } from "effect";
import { type HTTP_METHOD, isHTTPMethod } from "next/dist/server/web/http";
import { NextResponse } from "next/server";
import { extractLocaleFromRequest } from "@/features/i18n";
import { LocaleValue } from "@/features/localization/effect-locale";

export class RequestValue extends Context.Tag("Request")<
  RequestValue,
  Request
>() {}

type NextRouteHandler = (request: Request) => Promise<NextResponse>;

type RouteEffect<A extends NextResponse, E> = Effect.Effect<
  A,
  E,
  RequestValue | LocaleValue | never
>;
type ErrorHandler<A extends NextResponse, E> = (
  error: E,
  opts?: Partial<{ signal: AbortSignal }>
) => MaybePromise<A>;

type NextRouteHandlerFactory = <A extends NextResponse, E>(opts: {
  effect: RouteEffect<A, E>;
  fallback?: ErrorHandler<A, E>;
}) => NextRouteHandler;

const createHandler =
  (method: HTTP_METHOD): NextRouteHandlerFactory =>
  ({
    effect,
    fallback = () => new NextResponse("Server error", { status: 500 }),
  }) =>
  (request) => {
    const effectLive = effect.pipe(
      Effect.mapError((error) =>
        Promise.resolve(fallback(error, { signal: request.signal }))
      ),
      Effect.merge,
      Effect.andThen(
        Effect.fn(function* (responsePromise) {
          return yield* Effect.promise(() => Promise.resolve(responsePromise));
        })
      ),
      Effect.annotateLogs({
        method,
        path: request.url,
        headers: request.headers.toJSON(),
      }),
      Effect.tapError(Effect.logError),
      Effect.provideService(RequestValue, request),
      Effect.provideService(LocaleValue, extractLocaleFromRequest(request))
    );

    return Effect.runPromise(effectLive);
  };

export const NextRoute = new Proxy(
  {} as Record<HTTP_METHOD, NextRouteHandlerFactory>,
  {
    get(...args): NextRouteHandlerFactory {
      const [, prop] = args;
      if (typeof prop === "string" && isHTTPMethod(prop))
        return createHandler(prop);
      return Reflect.get(...args);
    },
  }
);
