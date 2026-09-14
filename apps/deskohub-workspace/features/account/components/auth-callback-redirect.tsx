"use client";

import { useEffect } from "react";
import type { Locale } from "@/features/i18n";
import { handOffReturn } from "@/shared/browser/return-window";
import { AuthCallbackLoading } from "./auth-callback-loading";

export function AuthCallbackRedirect({ locale }: { readonly locale: Locale }) {
  useEffect(() => {
    let active = true;
    const accountPath = `/${locale}/account`;
    const navigateToAccount = () => {
      if (!active) return;
      try {
        window.location.replace(accountPath);
      } catch {
        // The document is already leaving or the browser blocked navigation.
      }
    };

    let attemptId = "";
    let hasError = false;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      attemptId = searchParams.get("attempt") ?? "";
      hasError = searchParams.has("error");
    } catch {
      // A missing query is handled by the shared handoff validator.
    }

    if (hasError) {
      navigateToAccount();
      return () => {
        active = false;
      };
    }

    let handoff: Promise<boolean>;
    try {
      handoff = handOffReturn({ attemptId });
    } catch {
      navigateToAccount();
      return () => {
        active = false;
      };
    }

    void handoff
      .then((handled) => {
        if (!active) return;
        if (!handled) {
          navigateToAccount();
          return;
        }

        let closed = false;
        try {
          window.close();
          closed = window.closed === true;
        } catch {
          // Fall back to navigation when closing is unavailable or blocked.
        }
        if (!closed) navigateToAccount();
      })
      .catch(navigateToAccount);

    return () => {
      active = false;
    };
  }, [locale]);

  return <AuthCallbackLoading locale={locale} />;
}
