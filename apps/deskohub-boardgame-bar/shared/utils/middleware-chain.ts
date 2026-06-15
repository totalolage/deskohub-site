import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";

export type NextMiddleware = (
  request: NextRequest,
  event: NextFetchEvent,
  response?: NextResponse
) =>
  | NextResponse
  | Response
  | null
  | undefined
  | Promise<NextResponse | Response | null | undefined>;

export type MiddlewareFactory = (next: NextMiddleware) => NextMiddleware;

export function createMiddlewareChain(factories: MiddlewareFactory[]) {
  return createMiddlewareChainAtIndex(factories, 0);
}

function createMiddlewareChainAtIndex(
  factories: readonly MiddlewareFactory[],
  index: number
): NextMiddleware {
  const factory = factories[index];
  if (!factory) return (request) => NextResponse.next(request);

  return factory((request, event, response) =>
    createMiddlewareChainAtIndex(factories, index + 1)(request, event, response)
  );
}
