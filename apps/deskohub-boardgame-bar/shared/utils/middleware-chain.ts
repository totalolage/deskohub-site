import {
  type ChainedMiddleware,
  createMiddlewareChain as createMiddlewareChainShared,
  type MiddlewareFactory,
} from "@deskohub/i18n/next";
import { type NextRequest, NextResponse } from "next/server";

export type NextMiddleware = ChainedMiddleware;
export type { MiddlewareFactory };

export function createMiddlewareChain(factories: MiddlewareFactory[]) {
  return createMiddlewareChainShared(factories, (request: NextRequest) =>
    NextResponse.next(request)
  );
}
