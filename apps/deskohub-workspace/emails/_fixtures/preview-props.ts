import "@/shared/polyfills/temporal";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { createElement } from "react";
import { CampaignBodyContent } from "@/features/email-campaigns/body/campaign-body-content";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
import { WorkspaceCampaignFooter } from "../_components/workspace-campaign-footer";
import type { ContactBusinessEmailProps } from "../contact-business";
import type { ContactConfirmationEmailProps } from "../contact-confirmation";
import type { CustomerReservationEmailProps } from "../customer-reservation";
import type { InvoiceDeliveryEmailProps } from "../invoice-delivery";
import type { ReservationAuthorEmailProps } from "../reservation-author";
import type { ReservationCancellationEmailProps } from "../reservation-cancellation";
import type { ReservationNotificationEmailProps } from "../reservation-notification";
import type { WorkspaceCampaignEmailProps } from "../workspace-campaign";

const customerEmail = testEmailAddress("customer");

const customerMessage =
  "Hello,\n\nI'd like to confirm that the Profi pass includes both monitors and coffee. Thank you!";

export const contactBusinessPreviewProps = {
  name: "Ada Lovelace",
  email: customerEmail,
  phone: "+420 123 456 789",
  message: customerMessage,
  submittedAt: "2026-06-12T07:00:00.000Z",
  // Previews show the live subject, without the test tag.
  environment: { isProduction: true },
} satisfies ContactBusinessEmailProps;

export const contactConfirmationPreviewProps = {
  locale: "en-US",
  message: customerMessage,
} satisfies ContactConfirmationEmailProps;

const previewReservation = {
  id: workspaceReservationIdSchema.make("workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C"),
  dotyposReservationId: DotyposReservationIdSchema.make("123456789"),
  reservationDetails: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
  },
  reservedFrom: Temporal.Instant.from("2026-06-12T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-13T07:00:00Z"),
  seats: 1,
  placement: { table: { mode: "assigned", name: "12" } },
} satisfies CustomerReservationEmailProps["reservation"];

export const customerReservationPreviewProps = {
  locale: "en-US",
  reservation: previewReservation,
  accessUrl:
    "https://workspace.deskohub.cz/en-US/reservation/access/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C?accessToken=preview-token",
  invoiceUrl:
    "https://workspace.deskohub.cz/en-US/reservation/invoice/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C?accessToken=preview-token",
  network: {
    ssid: "Deskohub Workspace",
    password: "Workspace42",
    qrImageSrc:
      "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=WIFI%3AT%3AWPA%3BS%3ADeskohub%20Workspace%3BP%3AWorkspace42%3B%3B",
  },
} satisfies CustomerReservationEmailProps;

export const reservationAuthorPreviewProps = {
  locale: "en-US",
  reservation: {
    ...previewReservation,
    customer: { firstName: "Ada", lastName: "Lovelace", companyName: null },
  },
  statusUrl:
    "https://workspace.deskohub.cz/en-US/reservation/status/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
} satisfies ReservationAuthorEmailProps;

export const reservationNotificationPreviewProps = {
  reservation: previewReservation,
  customer: {
    name: "Ada Lovelace",
    email: customerEmail,
    phone: "+420 123 456 789",
  },
} satisfies ReservationNotificationEmailProps;

export const reservationCancellationPreviewProps = {
  locale: "en-US",
  reservation: previewReservation,
} satisfies ReservationCancellationEmailProps;

export const invoiceDeliveryPreviewProps = {
  invoiceNumber: "WS-FV-2026-000003",
  invoice: { source: "reservation", orderId: "reservation-3" },
  recipient: { audience: "customer", locale: "en-US" },
} satisfies InvoiceDeliveryEmailProps;

const text = (value: string) => ({ type: "text", text: value });

const paragraph = (value: string) => ({
  type: "paragraph",
  content: [text(value)],
});

export const workspaceCampaignPreviewProps = {
  locale: "cs-CZ",
  preview: "Nové zasedačky a podzimní akce ve Workspace",
  body: createElement(CampaignBodyContent, {
    body: {
      formatVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [text("Podzim ve Workspace")],
          },
          paragraph(
            "Otevřeli jsme dvě nové zasedací místnosti a prodloužili otevírací dobu."
          ),
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [paragraph("Zasedačka pro 8 lidí")],
              },
              { type: "listItem", content: [paragraph("Otevřeno do 22:00")] },
            ],
          },
          { type: "horizontalRule" },
          {
            type: "ctaButton",
            attrs: {
              label: "Rezervovat",
              href: `https://${workspaceSiteConstants.brand.domain}/cs-CZ/meeting-room`,
            },
          },
        ],
      },
    },
  }),
  footer: WorkspaceCampaignFooter.Marketing({
    marketingPreferencesUrl: `https://${workspaceSiteConstants.brand.domain}/cs-CZ/marketing-preferences/access?token=preview`,
  }),
} satisfies WorkspaceCampaignEmailProps;
