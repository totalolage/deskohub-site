import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { createWorkspaceReservationNotificationEmailPreviewHtml } from "@/features/checkout/backend/fulfillment";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createWorkspaceReservationEmailPreviewReservation } from "../_lib/mock-reservation-email-preview";

export const metadata: Metadata = {
  title: "Workspace reservation notification email preview",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function WorkspaceReservationNotificationEmailPreviewPage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceReservationNotificationEmailPreviewContent />
    </Suspense>
  );
}

async function WorkspaceReservationNotificationEmailPreviewContent() {
  await connection();

  const html = await runWithRequestLocale((locale) =>
    createWorkspaceReservationNotificationEmailPreviewHtml({
      reservation: createWorkspaceReservationEmailPreviewReservation(locale),
    }).pipe(
      runStandaloneWorkspaceEffect(
        "workspaceReservationEmail.previewNotification"
      )
    )
  );

  return (
    <EmailPreviewFrame
      description="This page renders the real reservation notification email sent to the Deskohub address with mock data."
      html={html}
      title="Workspace reservation notification email preview"
    />
  );
}
