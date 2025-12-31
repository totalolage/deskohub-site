"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { env } from "@/env";
import { Button } from "@/shared/components/ui/button";

export default function DotyposAuthPage() {
  // Client credentials from Dotykacka support
  const clientId = env.DOTYPOS_CLIENT_ID;
  const clientSecret = env.DOTYPOS_CLIENT_SECRET;
  const [authUrl, setAuthUrl] = useState<string>("");

  if (!clientId || !clientSecret) {
    notFound();
  }

  // Hardcoded redirect URL
  const redirectUrl = "http://localhost:3000/cs-CZ/admin/dotypos/callback";

  useEffect(() => {
    // Generate a random state for CSRF protection on client side
    const state = Math.random().toString(36).substring(7);

    // Correct Dotykacka OAuth URL with /client/connect endpoint
    const url = new URL("https://admin.dotypos.com/client/connect");
    url.searchParams.append("client_id", clientId);
    url.searchParams.append("client_secret", clientSecret);
    url.searchParams.append("scope", "*");
    url.searchParams.append("redirect_uri", redirectUrl);
    url.searchParams.append("state", state);

    setAuthUrl(url.toString());
  }, [clientId, clientSecret]);

  const handleAuthenticate = () => {
    if (authUrl) {
      window.location.href = authUrl;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {clientId ? (
        <Button size="lg" onClick={handleAuthenticate} disabled={!authUrl}>
          Authenticate
        </Button>
      ) : (
        <div className="text-center space-y-4">
          <Button disabled size="lg">
            Authenticate
          </Button>
          <p className="text-sm text-red-600">
            Missing DOTYPOS_CLIENT_ID environment variable
          </p>
        </div>
      )}
    </div>
  );
}
