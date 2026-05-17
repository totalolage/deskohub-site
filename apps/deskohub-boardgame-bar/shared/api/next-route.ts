import { Context, Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { extractLocaleFromRequest } from "@/features/i18n";
import { LocaleValue } from "@/features/localization/effect-locale";

const HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];
type MaybePromise<T> = T | Promise<T>;

export class RequestValue extends Context.Tag("@deskohub/i18n/Request")<
  RequestValue,
  Request
>() {}

type NextRouteHandler = (request: NextRequest) => Promise<NextResponse>;

type ErrorHandler<A extends NextResponse, E> = (
  error: E,
  opts?: Partial<{ signal: AbortSignal }>
) => MaybePromise<A>;

type NextRouteHandlerFactory = <A extends NextResponse, E>(opts: {
  effect: Effect.Effect<A, E, RequestValue | LocaleValue | never>;
  fallback?: ErrorHandler<A, E>;
}) => NextRouteHandler;

function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.includes(value as HttpMethod);
}

function createRouteHandler(method: HttpMethod): NextRouteHandlerFactory {
  return ({
    effect,
    fallback = () => new NextResponse("Server error", { status: 500 }),
  }) => {
    return (request) => {
      const effectLive = effect.pipe(
        Effect.annotateLogs({
          method,
          url: request.url,
          headers: {
            host: request.headers.get("host"),
            referer: request.headers.get("referer"),
            "user-agent": request.headers.get("user-agent"),
          },
        }),
        Effect.tapError(Effect.logError),
        Effect.catchAll((error) =>
          Effect.promise(() =>
            Promise.resolve(
              fallback(error, {
                signal: request.signal,
              })
            )
          )
        ),
        Effect.provideService(RequestValue, request),
        Effect.provideService(LocaleValue, extractLocaleFromRequest(request))
      );

      return Effect.runPromise(effectLive);
    };
  };
}

export const NextRoute = new Proxy(
  {} as Record<HttpMethod, NextRouteHandlerFactory>,
  {
    get(...args): NextRouteHandlerFactory {
      const [, prop] = args;
      if (typeof prop === "string" && isHttpMethod(prop)) {
        return createRouteHandler(prop);
      }

      return Reflect.get(...args);
    },
  }
);
