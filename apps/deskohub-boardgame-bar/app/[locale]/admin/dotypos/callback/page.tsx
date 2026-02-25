"use client";

import { CheckCircle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

function DotyposCallbackContent() {
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
    // Dotykacka returns token directly, not an authorization code
    const token = searchParams.get("token"); // This is the refresh token
    const cloudId = searchParams.get("cloudid");
    const error = searchParams.get("error");

    // Extract OAuth callback parameters

    if (error) {
      setStatus("error");
      setMessage(`Authentication failed: ${error}`);
      return;
    }

    if (token) {
      // No need to exchange - we already have the refresh token
      setTokens({
        refreshToken: token,
        cloudId: cloudId || undefined,
      });
      setStatus("success");
      setMessage("Authentication successful! Refresh token received.");
    } else {
      setStatus("error");
      setMessage("No refresh token received");
    }
  }, [searchParams]);

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

export default function DotyposCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="animate-spin" />
                Dotypos Authentication
              </CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <DotyposCallbackContent />
    </Suspense>
  );
}
