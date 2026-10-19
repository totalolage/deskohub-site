import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { createReservationAuthorEmailPreviewHtml } from "@/features/checkout/backend/fulfillment";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createWorkspaceReservationEmailPreviewReservation } from "../_lib/mock-reservation-email-preview";

export const metadata: Metadata = {
  title: "Workspace reservation author email preview",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ReservationAuthorEmailPreviewPage() {
  return (
    <Suspense fallback={null}>
      <ReservationAuthorEmailPreviewContent />
    </Suspense>
  );
}

async function ReservationAuthorEmailPreviewContent() {
  await connection();

  const html = await runWithRequestLocale((locale) => {
    const reservation =
      createWorkspaceReservationEmailPreviewReservation(locale);

    return createReservationAuthorEmailPreviewHtml({
      statusUrl: `https://workspace.deskohub.cz/${locale}/reservation/status/${reservation.id}`,
      reservation,
    }).pipe(
      runStandaloneWorkspaceEffect("workspaceReservationEmail.previewAuthor")
    );
  });

  return (
    <EmailPreviewFrame
      description="This page renders the real reservation author confirmation email with mock data."
      html={html}
      title="Workspace reservation author email preview"
    />
  );
}
