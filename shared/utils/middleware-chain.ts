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

export function createMiddlewareChain(
  factories: MiddlewareFactory[],
  index = 0
): NextMiddleware {
  if (factories[index])
    return factories[index]((req, event, res) => {
      return createMiddlewareChain(factories, index + 1)(req, event, res);
    });

  return (req, _event, _res) => NextResponse.next(req);
}
