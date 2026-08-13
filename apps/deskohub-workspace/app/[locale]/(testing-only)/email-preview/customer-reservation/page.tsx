import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { createWorkspaceReservationCustomerEmailPreviewHtml } from "@/features/checkout/backend/fulfillment";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createWorkspaceReservationEmailPreviewReservation } from "../_lib/mock-reservation-email-preview";

export const metadata: Metadata = {
  title: "Workspace customer reservation email preview",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function WorkspaceReservationEmailPreviewPage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceReservationEmailPreviewContent />
    </Suspense>
  );
}

async function WorkspaceReservationEmailPreviewContent() {
  await connection();

  const html = await runWithRequestLocale((locale) =>
    createWorkspaceReservationCustomerEmailPreviewHtml({
      accessUrl: `https://workspace.deskohub.cz/${locale}/reservation/access/preview-reservation?accessToken=preview-token`,
      reservation: createWorkspaceReservationEmailPreviewReservation(locale),
    }).pipe(
      runStandaloneWorkspaceEffect("workspaceReservationEmail.previewCustomer")
    )
  );

  return (
    <EmailPreviewFrame
      description="This page renders the real customer reservation email with mock data."
      html={html}
      title="Workspace customer reservation email preview"
    />
  );
}
