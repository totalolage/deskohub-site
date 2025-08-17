"use client";

import { Button } from "@/shared/components/ui/button";
import { useEffect } from "react";

export default function DotyposAuthPage() {
  // Client credentials from Dotykacka support
  const clientId = "deskohub";
  const clientSecret = "KXUjm8zjoF8Vjg0G03mo";
  
  // Hardcoded redirect URL
  const redirectUrl = "http://localhost:3000/cs-CZ/admin/dotypos/callback";
  
  // Generate a random state for CSRF protection
  const state = Math.random().toString(36).substring(7);
  
  // Correct Dotykacka OAuth URL with /client/connect endpoint
  const authUrl = `https://admin.dotykacka.cz/client/connect?client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=*&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${state}`;

  useEffect(() => {
    console.log("Dotypos Auth Page loaded");
    console.log("Client ID:", clientId);
    console.log("Client Secret:", clientSecret ? "***configured***" : "missing");
    console.log("Redirect URL:", redirectUrl);
    console.log("State:", state);
    console.log("Full auth URL:", authUrl);
  }, [authUrl, clientId, clientSecret, redirectUrl, state]);

  const handleAuthenticate = () => {
    console.log("Authenticating with Dotypos...");
    console.log("Redirecting to:", authUrl);
    window.location.href = authUrl;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {clientId ? (
        <Button size="lg" onClick={handleAuthenticate}>
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