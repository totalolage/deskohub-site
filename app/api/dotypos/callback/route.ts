import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/shared/utils/logger";

/**
 * OAuth callback endpoint for Dotypos
 * GET /api/dotypos/callback
 *
 * Handles the OAuth redirect from Dotypos and extracts the tokens
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Extract parameters from Dotypos redirect
    const token = searchParams.get("token");
    const cloudId = searchParams.get("cloudid");
    const state = searchParams.get("state");

    // Validate required parameters
    if (!token || !cloudId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required parameters",
          message: "Token or Cloud ID not provided in callback",
        },
        { status: 400 }
      );
    }

    // Log for debugging
    logger.log("Dotypos callback received:", {
      hasToken: !!token,
      cloudId,
      state,
    });

    // Redirect back to the setup page with the tokens
    // The setup page will display them for manual configuration
    // Include locale in the redirect (default to en-US)
    const redirectUrl = new URL("/en-US/admin/dotypos-setup", request.url);
    redirectUrl.searchParams.set("token", token);
    redirectUrl.searchParams.set("cloudid", cloudId);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    logger.error("Dotypos callback error:", error);

    // Redirect to setup page with error
    const errorUrl = new URL("/en-US/admin/dotypos-setup", request.url);
    errorUrl.searchParams.set("error", "callback_failed");
    errorUrl.searchParams.set(
      "message",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.redirect(errorUrl);
  }
}
