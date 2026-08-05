import type { ContactBusinessEmailProps } from "../contact-business";
import type { ContactConfirmationEmailProps } from "../contact-confirmation";
import type { CustomerReservationEmailProps } from "../customer-reservation";
import type { ReservationNotificationEmailProps } from "../reservation-notification";

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
    { label: "Email", value: "customer@example.com" },
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
  followUp:
    "If you want to add anything, reply or write to workspace@deskohub.cz.",
} satisfies ContactConfirmationEmailProps;

export const customerReservationPreviewProps = {
  locale: "en-US",
  preview: "Your Deskohub Workspace access code is 4829",
  heading: "Your workspace access is ready for Friday, June 12",
  accessCode: "4829",
  labels: {
    accessCode: "Access code",
    location: "Where to go",
    directions: "Open route in Google Maps",
    table: "Table",
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
    { label: "Monitors", value: "2x 27 QHD" },
    { label: "Reservation reference", value: "123456789" },
    {
      label: "Order reference",
      value: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
    },
  ],
  followUp:
    "If you want to add anything, reply or write to workspace@deskohub.cz.",
} satisfies CustomerReservationEmailProps;

export const reservationNotificationPreviewProps = {
  preview: "Zaplacená rezervace čeká na kontrolu",
  heading: "Zaplacená workspace rezervace",
  body: "Zaplacená Workspace rezervace je připravená ke kontrole týmem.",
  details: [
    { label: "Jméno", value: "Ada Lovelace" },
    { label: "Email", value: "customer@example.com" },
    { label: "Telefon", value: "+420 123 456 789" },
    { label: "Vstup", value: "Profi Workstation" },
    { label: "Datum rezervace", value: "pátek 12. června 2026" },
    { label: "Káva", value: "Ano" },
    { label: "Monitory", value: "2x 27 QHD" },
    { label: "Číslo rezervace", value: "123456789" },
    {
      label: "Číslo objednávky",
      value: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
    },
  ],
} satisfies ReservationNotificationEmailProps;
