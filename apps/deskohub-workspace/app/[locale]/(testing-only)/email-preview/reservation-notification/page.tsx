import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createWorkspaceReservationNotificationEmailPreviewHtml } from "@/features/checkout/backend/workspace-reservation-email.service";
import { isLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import {
  createWorkspaceReservationEmailPreviewReservation,
  workspaceReservationEmailPreviewCustomer,
} from "../_lib/mock-reservation-email-preview";

export const metadata: Metadata = {
  title: "Workspace reservation notification email preview",
  robots: {
    index: false,
    follow: false,
  },
};

type WorkspaceReservationNotificationEmailPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function WorkspaceReservationNotificationEmailPreviewPage({
  params,
}: WorkspaceReservationNotificationEmailPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const html = await runWithRequestLocale(locale, () =>
    createWorkspaceReservationNotificationEmailPreviewHtml({
      reservation: createWorkspaceReservationEmailPreviewReservation(locale),
      customer: workspaceReservationEmailPreviewCustomer,
    })
  );

  return (
    <EmailPreviewFrame
      description="This page renders the real reservation notification email sent to the Deskohub address with mock data."
      html={html}
      title="Workspace reservation notification email preview"
    />
  );
}
