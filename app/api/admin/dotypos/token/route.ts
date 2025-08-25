import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

function isTokenRequest(body: unknown): body is { code: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "code" in body &&
    typeof (body as Record<string, unknown>).code === "string"
  );
}

function isTokenResponse(data: unknown): data is {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
} {
  return data !== null && typeof data === "object";
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!isTokenRequest(body)) {
      return NextResponse.json(
        { error: "Invalid request body - authorization code is required" },
        { status: 400 }
      );
    }

    const { code } = body;

    // Token exchange API called with authorization code

    if (!code) {
      // No authorization code provided
      return NextResponse.json(
        { error: "Authorization code is required" },
        { status: 400 }
      );
    }

    const clientId = env.DOTYPOS_CLIENT_ID;
    const clientSecret = env.DOTYPOS_CLIENT_SECRET;
    const redirectUrl = "http://localhost:3000/cs-CZ/admin/dotypos/callback";

    // Using configured OAuth2 credentials

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "Missing Dotypos configuration" },
        { status: 500 }
      );
    }

    // Exchange authorization code for tokens
    const tokenUrl = "https://api.dotykacka.cz/v2/oauth/token";
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUrl,
    });

    // Sending token exchange request to Dotypos

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams,
    });

    // Received token response from Dotypos

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      // Token exchange failed - returning error to client
      return NextResponse.json(
        { error: "Token exchange failed", details: errorData },
        { status: tokenResponse.status }
      );
    }

    const tokenData: unknown = await tokenResponse.json();

    if (!isTokenResponse(tokenData)) {
      return NextResponse.json(
        { error: "Invalid token response format" },
        { status: 500 }
      );
    }

    // Token exchange successful

    // In production, you would save these tokens securely
    // For now, we'll return them to display in the UI
    return NextResponse.json({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
    });
  } catch (_error) {
    // Internal error during token exchange
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
