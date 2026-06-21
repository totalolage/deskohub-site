import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";

/**
 * OAuth callback endpoint for Dotypos
 * GET /api/dotypos/callback
 *
 * Handles the OAuth redirect from Dotypos and extracts the tokens
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const searchParams = request.nextUrl.searchParams;
        yield* Effect.logInfo("Dotypos callback received");

        // Extract parameters from Dotypos redirect
        const token = searchParams.get("token");
        const cloudId = searchParams.get("cloudid");
        const state = searchParams.get("state");

        // Validate required parameters
        if (!token || !cloudId) {
          yield* Effect.logWarning("Dotypos callback missing required params", {
            hasCloudId: Boolean(cloudId),
            hasState: Boolean(state),
            hasToken: Boolean(token),
          });
          return NextResponse.json(
            {
              success: false,
              error: "Missing required parameters",
              message: "Token or Cloud ID not provided in callback",
            },
            { status: 400 }
          );
        }

        // Dotypos callback received with token and cloudId

        // Redirect back to the setup page with the tokens
        // The setup page will display them for manual configuration
        // Include locale in the redirect (default to en-US)
        const redirectUrl = new URL("/en-US/admin/dotypos-setup", request.url);
        redirectUrl.searchParams.set("token", token);
        redirectUrl.searchParams.set("cloudid", cloudId);
        if (state) {
          redirectUrl.searchParams.set("state", state);
        }
        yield* Effect.logInfo("Dotypos callback redirect URL built");

        return NextResponse.redirect(redirectUrl);
      }).pipe(Effect.scoped)
    );
  } catch (error) {
    // Redirect to setup page with error
    const errorUrl = new URL("/en-US/admin/dotypos-setup", request.url);
    errorUrl.searchParams.set("error", "callback_failed");
    errorUrl.searchParams.set(
      "message",
      error instanceof Error ? error.message : "Unknown error"
    );
    await Effect.runPromise(
      Effect.logError("Dotypos callback route failed", {
        error,
        errorUrl: errorUrl.toString(),
      })
    );

    return NextResponse.redirect(errorUrl);
  }
}
