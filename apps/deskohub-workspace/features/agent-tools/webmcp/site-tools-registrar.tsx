"use client";

import { useEffect } from "react";
import type { Locale } from "@/features/i18n";
import { publishQuoteTool } from "./site-tool-catalog";
import { getModelContext } from "./webmcp-detection";

/**
 * Registers the public agent tools as WebMCP site tools for the document's
 * lifetime. Browsers without `document.modelContext` load nothing more: the
 * registration module is imported only after feature detection.
 */
export function SiteToolsRegistrar({ locale }: { readonly locale: Locale }) {
  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) return;

    const registration = new AbortController();
    void import("./register-site-tools").then(({ registerReadSiteTools }) =>
      registerReadSiteTools({
        locale,
        modelContext,
        signal: registration.signal,
      })
    );
    return () => {
      registration.abort();
      publishQuoteTool(undefined);
    };
  }, [locale]);

  return null;
}
