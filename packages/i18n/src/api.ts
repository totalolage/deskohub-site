import { Context, Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";

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

function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.includes(value as HttpMethod);
}

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

type NextRouteHandlerFactory<LocaleTag> = <A extends NextResponse, E>(opts: {
  effect: Effect.Effect<A, E, RequestValue | LocaleTag | never>;
  fallback?: ErrorHandler<A, E>;
}) => NextRouteHandler;

type CreateNextRouteOptions<Locale extends string, LocaleTag> = {
  localeTag: Context.Tag<LocaleTag, Locale>;
  extractLocaleFromRequest: (request: NextRequest) => Locale;
};

export function createNextRoute<Locale extends string, LocaleTag>({
  localeTag,
  extractLocaleFromRequest,
}: CreateNextRouteOptions<Locale, LocaleTag>) {
  const createHandler =
    (method: HttpMethod): NextRouteHandlerFactory<LocaleTag> =>
    ({
      effect,
      fallback = () => new NextResponse("Server error", { status: 500 }),
    }) =>
    (request) => {
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
        Effect.provideService(localeTag, extractLocaleFromRequest(request))
      );

      return Effect.runPromise(effectLive);
    };

  return new Proxy(
    {} as Record<HttpMethod, NextRouteHandlerFactory<LocaleTag>>,
    {
      get(...args): NextRouteHandlerFactory<LocaleTag> {
        const [, prop] = args;
        if (typeof prop === "string" && isHttpMethod(prop)) {
          return createHandler(prop);
        }

        return Reflect.get(...args);
      },
    }
  );
}
