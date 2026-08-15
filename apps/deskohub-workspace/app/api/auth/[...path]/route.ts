import type { NeonAuth } from "@neondatabase/auth/next/server";
import { getNeonAuth } from "@/features/account/auth.server";

type AuthHandlers = ReturnType<NeonAuth["handler"]>;
type AuthRouteContext = Parameters<AuthHandlers["GET"]>[1];
type AuthMethod = keyof AuthHandlers;

const dispatch = (
  method: AuthMethod,
  request: Request,
  context: AuthRouteContext
) => {
  const auth = getNeonAuth();
  if (!auth) {
    return Response.json(
      { code: "NEON_AUTH_NOT_CONFIGURED", error: "Authentication unavailable" },
      { status: 503 }
    );
  }
  return auth.handler()[method](request, context);
};

export const GET = (request: Request, context: AuthRouteContext) =>
  dispatch("GET", request, context);
export const POST = (request: Request, context: AuthRouteContext) =>
  dispatch("POST", request, context);
export const PUT = (request: Request, context: AuthRouteContext) =>
  dispatch("PUT", request, context);
export const DELETE = (request: Request, context: AuthRouteContext) =>
  dispatch("DELETE", request, context);
export const PATCH = (request: Request, context: AuthRouteContext) =>
  dispatch("PATCH", request, context);
