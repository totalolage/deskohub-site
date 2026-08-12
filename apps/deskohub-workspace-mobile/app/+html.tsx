import { ScrollViewStyleReset } from "expo-router/html";
import type { ReactNode } from "react";

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <meta charSet="utf-8" />
        <title>Deskohub Workspace</title>
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="theme-color" content="#00024F" />
        <meta name="application-name" content="Deskohub Workspace" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icon-256.png" />

        <ScrollViewStyleReset />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static app-owned CSS */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static app-owned service-worker registration */}
        <script dangerouslySetInnerHTML={{ __html: registerServiceWorker }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
  width: 100%;
}
body {
  background-color: #F5F4EF;
}
input[role="switch"] {
  -webkit-appearance: none !important;
  appearance: none !important;
  opacity: 0;
}`;

const registerServiceWorker = `
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
  });
}`;
