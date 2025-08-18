"use client";

import { CheckCircle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export default function DotyposCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");
  const [tokens, setTokens] = useState<{
    accessToken?: string;
    refreshToken?: string;
    cloudId?: string;
  } | null>(null);

  useEffect(() => {
    console.log("Dotypos Callback Page loaded");
    console.log("Current URL:", window.location.href);
    console.log("Search params:", searchParams.toString());

    // Dotykacka returns token directly, not an authorization code
    const token = searchParams.get("token"); // This is the refresh token
    const cloudId = searchParams.get("cloudid");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    console.log("Received refresh token:", token ? "***present***" : "missing");
    console.log("Received cloud ID:", cloudId);
    console.log("Received state:", state);
    console.log("Received error:", error);

    if (error) {
      console.error("OAuth error received:", error);
      setStatus("error");
      setMessage(`Authentication failed: ${error}`);
      return;
    }

    if (token) {
      console.log("Refresh token received directly from Dotykacka");
      // No need to exchange - we already have the refresh token
      setTokens({
        refreshToken: token,
        cloudId: cloudId || undefined,
      });
      setStatus("success");
      setMessage("Authentication successful! Refresh token received.");
    } else {
      console.error("No refresh token received");
      setStatus("error");
      setMessage("No refresh token received");
    }
  }, [searchParams]);

  const _exchangeCodeForTokens = async (code: string) => {
    try {
      console.log("Sending token exchange request to API...");
      const response = await fetch("/api/admin/dotypos/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      console.log("Token exchange response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Token exchange failed:", errorText);
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const data: unknown = await response.json();
      console.log("Token exchange successful:", data);

      if (data && typeof data === "object" && !Array.isArray(data)) {
        const tokenData = data as Record<string, unknown>;
        setTokens({
          accessToken:
            typeof tokenData.accessToken === "string"
              ? tokenData.accessToken
              : undefined,
          refreshToken:
            typeof tokenData.refreshToken === "string"
              ? tokenData.refreshToken
              : undefined,
          cloudId:
            typeof tokenData.cloudId === "string"
              ? tokenData.cloudId
              : undefined,
        });
      }
      setStatus("success");
      setMessage("Authentication successful! Tokens received.");
    } catch (error) {
      console.error("Token exchange error:", error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Token exchange failed"
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="animate-spin" />}
            {status === "success" && <CheckCircle className="text-green-500" />}
            {status === "error" && <XCircle className="text-red-500" />}
            Dotypos Authentication
          </CardTitle>
          <CardDescription>
            {status === "loading" && "Processing authentication..."}
            {status === "success" && "Authentication completed"}
            {status === "error" && "Authentication failed"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <p
              className={status === "error" ? "text-red-600" : "text-gray-600"}
            >
              {message}
            </p>
          </div>

          {tokens && (
            <div className="space-y-2 p-4 bg-gray-100 rounded-lg">
              <p className="text-xs font-semibold text-gray-700">
                Authentication Details (for development only):
              </p>
              <div className="space-y-1">
                {tokens.refreshToken && (
                  <p className="text-xs break-all">
                    <strong>Refresh Token:</strong>{" "}
                    {tokens.refreshToken.substring(0, 20)}...
                  </p>
                )}
                {tokens.cloudId && (
                  <p className="text-xs">
                    <strong>Cloud ID:</strong> {tokens.cloudId}
                  </p>
                )}
                {tokens.accessToken && (
                  <p className="text-xs break-all">
                    <strong>Access Token:</strong>{" "}
                    {tokens.accessToken.substring(0, 20)}...
                  </p>
                )}
              </div>
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-xs text-yellow-800 font-semibold mb-2">
                  ⚠️ Add these to your .env file:
                </p>
                <code className="text-xs bg-white p-2 block rounded border border-gray-300">
                  DOTYPOS_REFRESH_TOKEN={tokens.refreshToken}
                  <br />
                  DOTYPOS_CLOUD_ID={tokens.cloudId || "381429880"}
                </code>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {status === "error" && (
              <Button asChild variant="outline" className="flex-1">
                <Link href="/admin/dotypos">Try Again</Link>
              </Button>
            )}
            <Button asChild className="flex-1">
              <Link href="/admin">Back to Admin</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
