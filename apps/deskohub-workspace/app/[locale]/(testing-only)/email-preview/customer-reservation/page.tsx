import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { createWorkspaceReservationCustomerEmailPreviewHtml } from "@/features/checkout/backend/workspace-reservation-email.service";
import { isLocale, type Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createWorkspaceReservationEmailPreviewReservation } from "../_lib/mock-reservation-email-preview";

export const metadata: Metadata = {
  title: "Workspace customer reservation email preview",
  robots: {
    index: false,
    follow: false,
  },
};

type WorkspaceReservationEmailPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function WorkspaceReservationEmailPreviewPage({
  params,
}: WorkspaceReservationEmailPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <Suspense fallback={null}>
      <WorkspaceReservationEmailPreviewContent locale={locale} />
    </Suspense>
  );
}

async function WorkspaceReservationEmailPreviewContent({
  locale,
}: {
  locale: Locale;
}) {
  await connection();

  const html = await runWithRequestLocale(locale, () =>
    createWorkspaceReservationCustomerEmailPreviewHtml({
      reservation: createWorkspaceReservationEmailPreviewReservation(locale),
    })
  );

  return (
    <EmailPreviewFrame
      description="This page renders the real customer reservation email with mock data."
      html={html}
      title="Workspace customer reservation email preview"
    />
  );
}
