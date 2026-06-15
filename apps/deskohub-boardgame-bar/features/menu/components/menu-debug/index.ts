"use client";

import dynamic from "next/dynamic";

export const MenuPdfDebugView = dynamic(
  () =>
    import("./menu-debug-client-component").then(
      (mod) => mod.MenuPdfDebugViewClientOnly
    ),
  { ssr: false }
);
