"use client";

import { useEffect } from "react";
import { removeUrlCredentials } from "@/shared/utils/url-credentials";

/**
 * Browsers refuse relative fetches from a document opened through a
 * `https://user:password@host` URL. Next.js server actions post to the
 * relative current URL, so they fail before any request is sent. Reload the
 * same page without the embedded credentials; the browser keeps the Basic
 * authorization for the realm.
 */
export function useCredentialFreeDocumentUrl() {
  useEffect(() => {
    const url = removeUrlCredentials(document.URL);
    if (url) window.location.replace(url);
  }, []);
}
