"use client";

import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { m } from "@/features/i18n";

type GalleryErrorBoundaryProps = {
  children: ReactNode;
};

export function GalleryErrorBoundary({ children }: GalleryErrorBoundaryProps) {
  return <ErrorBoundary fallback={<GalleryError />}>{children}</ErrorBoundary>;
}

function GalleryError() {
  return (
    <div className="mx-auto max-w-2xl rounded-[1.35rem] border border-chilean-fire/20 bg-white/78 px-5 py-4 text-sm text-navy-blue/78 shadow-[0_18px_60px_-46px_rgba(0,2,79,0.7)] backdrop-blur">
      <p className="font-semibold text-chilean-fire">{m.galleryErrorTitle()}</p>
      <p className="mt-1">{m.galleryErrorDescription()}</p>
    </div>
  );
}
