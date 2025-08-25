"use client";

import { AlertCircle, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export default function DotyposSetupPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{
    refreshToken: string;
    cloudId: string;
  } | null>(null);

  useEffect(() => {
    // Check URL parameters for tokens after redirect
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const cloudId = params.get("cloudid");
    const error = params.get("error");
    const errorMessage = params.get("message");

    if (token && cloudId) {
      setTokens({ refreshToken: token, cloudId });
    }

    if (error) {
      alert(`OAuth failed: ${errorMessage || error}`);
    }

    // Set redirect URI to the API callback endpoint
    const baseUrl = window.location.origin;
    setRedirectUri(`${baseUrl}/api/dotypos/callback`);
  }, []);

  const generateAuthUrl = () => {
    if (!clientId || !clientSecret) {
      alert("Please enter both Client ID and Client Secret");
      return;
    }

    const state = `setup-${Date.now()}`;
    const url =
      `https://admin.dotykacka.cz/client/connect?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `client_secret=${encodeURIComponent(clientSecret)}&` +
      `scope=*&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    setAuthUrl(url);
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Failed to copy to clipboard
    }
  };

  const envContent = tokens
    ? `# Dotypos API Configuration
DOTYPOS_CLIENT_ID=${clientId}
DOTYPOS_CLIENT_SECRET=${clientSecret}
DOTYPOS_REFRESH_TOKEN=${tokens.refreshToken}
DOTYPOS_CLOUD_ID=${tokens.cloudId}
DOTYPOS_API_URL=https://api.dotykacka.cz/v2`
    : "";

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Dotypos API Setup</CardTitle>
          <CardDescription>
            One-time setup to obtain refresh token for backend API access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!tokens ? (
            <>
              {/* Step 1: Enter Credentials */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">
                  Step 1: Enter API Credentials
                </h3>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    You should have received these credentials from Dotypos
                    after registering your application. Keep them secure and
                    never expose them in client-side code.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="clientId">Client ID</Label>
                  <Input
                    id="clientId"
                    type="text"
                    value={clientId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setClientId(e.target.value)
                    }
                    placeholder="Enter your Dotypos Client ID"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clientSecret">Client Secret</Label>
                  <Input
                    id="clientSecret"
                    type="password"
                    value={clientSecret}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setClientSecret(e.target.value)
                    }
                    placeholder="Enter your Dotypos Client Secret"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="redirectUri">
                    Redirect URI (auto-filled)
                  </Label>
                  <Input
                    id="redirectUri"
                    type="text"
                    value={redirectUri}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRedirectUri(e.target.value)
                    }
                    placeholder="Redirect URI"
                  />
                </div>

                <Button onClick={generateAuthUrl} className="w-full">
                  Generate Authorization URL
                </Button>
              </div>

              {/* Step 2: Authorize */}
              {authUrl && (
                <div className="space-y-4 pt-4 border-t">
                  <h3 className="text-lg font-semibold">
                    Step 2: Authorize Application
                  </h3>
                  <Alert>
                    <AlertDescription>
                      Click the button below to open the Dotypos authorization
                      page. Log in with your Dotypos account and grant access to
                      your application. You'll be redirected back here with the
                      tokens.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label>Authorization URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={authUrl}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copyToClipboard(authUrl, "url")}
                      >
                        {copied === "url" ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      window.location.href = authUrl;
                    }}
                    className="w-full"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Go to Dotypos Authorization Page
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Step 3: Save Tokens */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">
                  Step 3: Save Your Tokens
                </h3>
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    Success! Authorization completed. Save these values to your
                    .env.local file.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Refresh Token</Label>
                  <div className="flex gap-2">
                    <Input
                      value={tokens.refreshToken}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(tokens.refreshToken, "refresh")
                      }
                    >
                      {copied === "refresh" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Cloud ID</Label>
                  <div className="flex gap-2">
                    <Input
                      value={tokens.cloudId}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(tokens.cloudId, "cloud")}
                    >
                      {copied === "cloud" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Complete .env.local Configuration</Label>
                  <div className="relative">
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
                      <code>{envContent}</code>
                    </pre>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute top-2 right-2 text-gray-400 hover:text-gray-100"
                      onClick={() => copyToClipboard(envContent, "env")}
                    >
                      {copied === "env" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Important:</strong> Add these values to your
                    .env.local file (not .env) to keep them secure. Never commit
                    these credentials to version control.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={() => {
                    setTokens(null);
                    setAuthUrl("");
                    window.history.replaceState(
                      {},
                      "",
                      window.location.pathname
                    );
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Start Over
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
