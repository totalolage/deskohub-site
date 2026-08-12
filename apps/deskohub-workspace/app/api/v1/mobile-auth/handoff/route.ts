import { Effect, Schema } from "effect";
import { NextResponse } from "next/server";
import { MobileSessionHandoffRepository } from "@/features/account/backend/mobile-session-handoff.repository";
import {
  createMobileSessionHandoff,
  exchangeMobileSessionHandoff,
  getNeonSessionCookie,
  MobileSessionHandoffError,
  validateMobileAppScheme,
} from "@/features/account/mobile-session-handoff";
import {
  getCustomerAccountId,
  getFreshCustomerSession,
} from "@/features/account/session.server";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const exchangeSchema = Schema.Struct({
  code: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)),
  verifier: Schema.Trim.check(Schema.isMinLength(32), Schema.isMaxLength(256)),
});

const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const invalidHandoff = () =>
  NextResponse.json(
    { ok: false, error: { code: "invalid_auth_handoff" } },
    { status: 400, headers: noStore }
  );

export const GET = defineWorkspaceRoute(
  {
    operation: "mobileShopAuthHandoffCreate",
    cancellation: "continue-after-disconnect",
  },
  (request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const challenge = url.searchParams.get("challenge") ?? "";
      const scheme = url.searchParams.get("scheme") ?? "";
      if (!validateMobileAppScheme(scheme)) return invalidHandoff();

      const session = yield* Effect.tryPromise({
        // Always validate the primary token with Neon before transferring it.
        // A cached session-data cookie must never authorize a different token.
        try: getFreshCustomerSession,
        catch: () => new MobileSessionHandoffError(),
      });
      if (!session?.user || !getCustomerAccountId(session.user.id)) {
        return NextResponse.redirect(
          new URL("/en-US/auth/sign-in", url.origin),
          303
        );
      }
      const sessionCookie = getNeonSessionCookie(request.headers.get("cookie"));
      if (!sessionCookie) return invalidHandoff();

      const code = yield* createMobileSessionHandoff({
        challenge,
        scheme,
        sessionCookie,
      });
      const callback = new URL(`${scheme}://auth/callback`);
      callback.searchParams.set("code", code);
      return NextResponse.redirect(callback, 303);
    }).pipe(
      Effect.provide(MobileSessionHandoffRepository.LiveWithDependencies),
      Effect.catchTag("MobileSessionHandoffError", () =>
        Effect.succeed(invalidHandoff())
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal("Mobile auth handoff creation failed")
      )
    )
);

export const POST = defineWorkspaceRoute(
  {
    operation: "mobileShopAuthHandoffExchange",
    cancellation: "continue-after-disconnect",
  },
  (request) =>
    Effect.gen(function* () {
      const body = yield* Effect.tryPromise({
        try: () => request.json() as Promise<unknown>,
        catch: () => new MobileSessionHandoffError(),
      });
      const input = yield* Schema.decodeUnknownEffect(exchangeSchema, {
        onExcessProperty: "error",
      })(body).pipe(Effect.mapError(() => new MobileSessionHandoffError()));
      const result = yield* exchangeMobileSessionHandoff(input);
      return NextResponse.json(
        { ok: true, data: result },
        { headers: noStore }
      );
    }).pipe(
      Effect.provide(MobileSessionHandoffRepository.LiveWithDependencies),
      Effect.catchTag("MobileSessionHandoffError", () =>
        Effect.succeed(invalidHandoff())
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal("Mobile auth handoff exchange failed")
      )
    )
);
