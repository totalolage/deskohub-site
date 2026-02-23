"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";

export default function DotyposAuthPage() {
  const params = useParams<{ locale?: string }>();
  const [authUrl, setAuthUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const localeParam = params.locale;
  const locale = Array.isArray(localeParam)
    ? (localeParam[0] ?? "en-US")
    : (localeParam ?? "en-US");

  useEffect(() => {
    const controller = new AbortController();

    const loadAuthUrl = async () => {
      try {
        setError(null);
        const response = await fetch(
          `/api/admin/dotypos/auth-url?locale=${encodeURIComponent(locale)}`,
          {
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error("Unable to prepare Dotypos OAuth URL");
        }

        const data = (await response.json()) as { authUrl?: string };
        if (!data.authUrl) {
          throw new Error("Dotypos OAuth URL is missing");
        }

        setAuthUrl(data.authUrl);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to prepare Dotypos OAuth URL"
        );
      }
    };

    loadAuthUrl();

    return () => {
      controller.abort();
    };
  }, [locale]);

  const handleAuthenticate = () => {
    if (authUrl) {
      window.location.href = authUrl;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {!error ? (
        <Button size="lg" onClick={handleAuthenticate} disabled={!authUrl}>
          Authenticate
        </Button>
      ) : (
        <div className="text-center space-y-4">
          <Button disabled size="lg">
            Authenticate
          </Button>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
