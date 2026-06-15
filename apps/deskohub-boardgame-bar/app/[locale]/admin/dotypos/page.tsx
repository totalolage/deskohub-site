"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Button } from "@/shared/components/ui/button";

type DotyposAuthUrlResponse = {
  authUrl?: string;
};

const loadDotyposAuthUrl = async ({
  locale,
  signal,
}: {
  locale: string;
  signal: AbortSignal;
}) => {
  const response = await fetch(
    `/api/admin/dotypos/auth-url?locale=${encodeURIComponent(locale)}`,
    { signal }
  );

  if (!response.ok) {
    throw new Error("Unable to prepare Dotypos OAuth URL");
  }

  const data = (await response.json()) as DotyposAuthUrlResponse;
  if (!data.authUrl) {
    throw new Error("Dotypos OAuth URL is missing");
  }

  return data.authUrl;
};

export default function DotyposAuthPage() {
  const params = useParams<{ locale?: string }>();
  const localeParam = params.locale;
  const locale = Array.isArray(localeParam)
    ? (localeParam[0] ?? "en-US")
    : (localeParam ?? "en-US");
  const {
    data: authUrl = "",
    error,
    isLoading,
  } = useQuery({
    queryKey: ["dotypos-auth-url", locale],
    queryFn: ({ signal }) => loadDotyposAuthUrl({ locale, signal }),
    retry: false,
  });
  const errorMessage = error instanceof Error ? error.message : null;

  const handleAuthenticate = () => {
    if (authUrl) {
      window.location.href = authUrl;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {!errorMessage ? (
        <Button
          size="lg"
          onClick={handleAuthenticate}
          disabled={isLoading || !authUrl}
        >
          Authenticate
        </Button>
      ) : (
        <div className="text-center space-y-4">
          <Button disabled size="lg">
            Authenticate
          </Button>
          <p className="text-sm text-red-600">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
