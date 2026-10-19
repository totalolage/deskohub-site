import { testEmailAddress } from "@deskohub/test-email";
import { createElement } from "react";
import { CampaignBodyContent } from "@/features/email-campaigns/body/campaign-body-content";
import { workspaceSiteConstants } from "@/shared/utils";
import type { ContactBusinessEmailProps } from "../contact-business";
import type { ContactConfirmationEmailProps } from "../contact-confirmation";
import type { CustomerReservationEmailProps } from "../customer-reservation";
import type { InvoiceDeliveryEmailProps } from "../invoice-delivery";
import type { ReservationAuthorEmailProps } from "../reservation-author";
import type { ReservationNotificationEmailProps } from "../reservation-notification";
import type { WorkspaceCampaignEmailProps } from "../workspace-campaign";

const customerEmail = testEmailAddress("customer");

const customerMessage =
  "Hello,\n\nI'd like to confirm that the Profi pass includes both monitors and coffee. Thank you!";

const workspaceLocationMapUrl =
  "https://workspace.deskohub.cz/workspace-location-map.jpeg";

export const contactBusinessPreviewProps = {
  locale: "cs-CZ",
  preview: "Nová zpráva od Ada Lovelace",
  heading: "Nová zpráva z kontaktního formuláře Workspace",
  messageHeading: "Zpráva",
  details: [
    { label: "Jméno", value: "Ada Lovelace" },
    { label: "Email", value: customerEmail },
    { label: "Telefon", value: "+420 123 456 789" },
    { label: "Datum a čas", value: "pátek 12. června 2026 v 9:00" },
  ],
  message: customerMessage,
} satisfies ContactBusinessEmailProps;

export const contactConfirmationPreviewProps = {
  locale: "en-US",
  preview: "We received your Workspace message",
  heading: "Your message is in",
  body: "Thanks for reaching out. We will get back to you as soon as possible with next steps or an answer.",
  message: customerMessage,
  followUp: `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`,
} satisfies ContactConfirmationEmailProps;

export const customerReservationPreviewProps = {
  locale: "en-US",
  preview: "Your Deskohub Workspace reservation is confirmed",
  heading: "Your workspace reservation is confirmed for Friday, June 12",
  access: {
    button: "Show access code",
    url: "https://workspace.deskohub.cz/en-US/reservation/access/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C?accessToken=preview-token",
  },
  invoice: {
    label: "Invoice",
    download: "Download",
    url: "https://workspace.deskohub.cz/en-US/reservation/invoice/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C?accessToken=preview-token",
  },
  labels: {
    location: "Where to go",
    directions: "Open route in Google Maps",
    table: "Table",
    tables: "Tables",
    network: "Wi-Fi",
    networkName: "Network name",
    networkPassword: "Password",
  },
  location: {
    address: "Turnovská 430/10, 180 00 Praha 8 - Libeň",
    directionsUrl:
      "https://www.google.com/maps/dir/?api=1&destination=50.103277,14.479023",
    mapImageSrc: workspaceLocationMapUrl,
  },
  table: {
    mode: "assigned",
    name: "12",
  },
  network: {
    ssid: "Deskohub Workspace",
    password: "Workspace42",
    qrImageSrc:
      "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=WIFI%3AT%3AWPA%3BS%3ADeskohub%20Workspace%3BP%3AWorkspace42%3B%3B",
  },
  details: [
    { label: "Entry tier", value: "Profi Workstation" },
    { label: "Reservation date", value: "Friday, June 12, 2026" },
    { label: "Coffee", value: "Yes" },
    { label: "Monitors", value: "2x 27″ QHD" },
    { label: "Reservation reference", value: "123456789" },
    {
      label: "Order reference",
      value: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
    },
  ],
  followUp: `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`,
} satisfies CustomerReservationEmailProps;

export const reservationAuthorPreviewProps = {
  locale: "en-US",
  preview: "Your reservation for Ada Lovelace is confirmed",
  heading: "You booked Profi Workstation for Ada Lovelace",
  body: "We emailed the access details to the reservation's customer separately.",
  status: {
    button: "View reservation",
    url: "https://workspace.deskohub.cz/en-US/reservation/status/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  },
  labels: {
    location: "Where to go",
    directions: "Open route in Google Maps",
    table: "Table",
    tables: "Tables",
  },
  location: customerReservationPreviewProps.location,
  table: customerReservationPreviewProps.table,
  details: customerReservationPreviewProps.details,
  followUp: customerReservationPreviewProps.followUp,
} satisfies ReservationAuthorEmailProps;

export const reservationNotificationPreviewProps = {
  preview: "Zaplacená rezervace čeká na kontrolu",
  heading: "Zaplacená workspace rezervace",
  body: "Zaplacená Workspace rezervace je připravená ke kontrole týmem.",
  details: [
    { label: "Jméno", value: "Ada Lovelace" },
    { label: "Email", value: customerEmail },
    { label: "Telefon", value: "+420 123 456 789" },
    { label: "Vstup", value: "Profi Workstation" },
    { label: "Datum rezervace", value: "pátek 12. června 2026" },
    { label: "Káva", value: "Ano" },
    { label: "Monitory", value: "2x 27″ QHD" },
    { label: "Číslo rezervace", value: "123456789" },
    {
      label: "Číslo objednávky",
      value: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
    },
  ],
} satisfies ReservationNotificationEmailProps;

export const invoiceDeliveryPreviewProps = {
  locale: "en-US",
  preview: "Invoice WS-FV-2026-000003",
  heading: "Your invoice is attached",
  body: "Invoice WS-FV-2026-000003 for order reservation-3 is attached as a PDF.",
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
  footer: {
    note: "Tento e-mail dostáváte, protože jste souhlasili se zasíláním marketingových sdělení od Deskohub Workspace.",
    link: {
      label: "Odhlásit odběr nebo změnit nastavení",
      href: `https://${workspaceSiteConstants.brand.domain}/cs-CZ/marketing-preferences/access?token=preview`,
    },
  },
} satisfies WorkspaceCampaignEmailProps;
