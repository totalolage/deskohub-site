import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import type {
  ReservationData,
  ReservationEntryTier,
  ReservationMonitorOption,
} from "@/features/reservation/schemas/reservation";
import { StorageError } from "@/shared/backend/errors";
import { workspaceSiteConstants } from "@/shared/utils";

type DetailRow = readonly [string, string];

export interface ReservationSubmission extends ReservationData {
  submittedAt: string;
  locale?: string;
}

export interface ReservationService {
  readonly submit: (
    data: ReservationData,
    locale?: string
  ) => Effect.Effect<ReservationSubmission, StorageError>;
}

export const ReservationService =
  Context.GenericTag<ReservationService>("ReservationService");

const workspaceRecipient = {
  email: "workspace@deskohub.com",
  name: workspaceSiteConstants.brand.name,
} as const;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatMessageHtml = (message: string) =>
  escapeHtml(message).replaceAll("\n", "<br />");

const formatSubmissionDate = (submittedAt: string, locale?: string) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const formatReservationDate = (date: string, locale?: string) =>
  new Date(`${date}T12:00:00+01:00`).toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });

const getTierLabel = (tier: ReservationEntryTier, locale?: string) => {
  const labels = {
    "basic-day-pass": locale === "cs-CZ" ? "Basic Day Pass" : "Basic Day Pass",
    "cowork-plus": locale === "cs-CZ" ? "Cowork Plus" : "Cowork Plus",
    "profi-workstation":
      locale === "cs-CZ" ? "Profi Workstation" : "Profi Workstation",
  } satisfies Record<ReservationEntryTier, string>;

  return labels[tier];
};

const getMonitorLabel = (
  monitor: ReservationMonitorOption,
  locale?: string
) => {
  const labels = {
    "2x27": locale === "cs-CZ" ? '2 × 27" monitory' : '2 × 27" monitors',
    "2x32": locale === "cs-CZ" ? '2 × 32" monitory' : '2 × 32" monitors',
    "qhd-4k": locale === "cs-CZ" ? "QHD / 4K sestava" : "QHD / 4K setup",
  } satisfies Record<ReservationMonitorOption, string>;

  return labels[monitor];
};

const getBusinessSubject = (name: string, date: string, locale?: string) =>
  locale === "cs-CZ"
    ? `Nová rezervace Workspace - ${name} - ${date}`
    : `New Workspace reservation - ${name} - ${date}`;

const getConfirmationSubject = (locale?: string) =>
  locale === "cs-CZ"
    ? "Rezervace přijata - Deskohub Workspace"
    : "Reservation received - Deskohub Workspace";

const createDetailRows = (
  submission: ReservationSubmission,
  locale?: string
): DetailRow[] => {
  const labels = {
    tier: locale === "cs-CZ" ? "Vstup" : "Entry tier",
    date: locale === "cs-CZ" ? "Datum rezervace" : "Reservation date",
    coffee: locale === "cs-CZ" ? "Káva" : "Coffee",
    monitors: locale === "cs-CZ" ? "Monitory" : "Monitors",
    name: locale === "cs-CZ" ? "Jméno" : "Name",
    phone: locale === "cs-CZ" ? "Telefon" : "Phone",
    submittedAt: locale === "cs-CZ" ? "Odesláno" : "Submitted at",
  };
  const yes = locale === "cs-CZ" ? "Ano" : "Yes";
  const no = locale === "cs-CZ" ? "Ne" : "No";

  const rows: DetailRow[] = [
    [labels.tier, getTierLabel(submission.entryTier, locale)],
    [labels.date, formatReservationDate(submission.date, locale)],
    [labels.coffee, submission.coffee ? yes : no],
    [labels.name, submission.name],
    ["Email", submission.email],
    [labels.submittedAt, formatSubmissionDate(submission.submittedAt, locale)],
  ];

  if (submission.monitorOption) {
    rows.splice(3, 0, [
      labels.monitors,
      getMonitorLabel(submission.monitorOption, locale),
    ]);
  }

  if (submission.phone) {
    rows.splice(rows.length - 1, 0, [labels.phone, submission.phone]);
  }

  return rows;
};

const renderRowsHtml = (rows: readonly DetailRow[]) =>
  rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>${escapeHtml(label)}:</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${escapeHtml(value)}</td>
      </tr>`
    )
    .join("");

export const ReservationServiceLive = Layer.effect(
  ReservationService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return ReservationService.of({
      submit: (data, locale) =>
        Effect.gen(function* () {
          const submission: ReservationSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };
          const rows = createDetailRows(submission, locale);
          const safeMessageHtml = submission.message
            ? formatMessageHtml(submission.message)
            : undefined;
          const intro =
            locale === "cs-CZ"
              ? "Nová rezervace coworkingu z webu Workspace."
              : "New coworking reservation from the Workspace website.";

          const businessEmailMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: workspaceRecipient,
            subject: getBusinessSubject(
              data.name,
              formatReservationDate(data.date, locale),
              locale
            ),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${escapeHtml(intro)}</h2>
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                  ${renderRowsHtml(rows)}
                </table>
                ${
                  safeMessageHtml
                    ? `<h3 style="margin-top: 24px; color: #0b1848;">${
                        locale === "cs-CZ" ? "Zpráva" : "Message"
                      }</h3><div style="background: #f4f1ea; border-radius: 16px; padding: 16px; white-space: normal;">${safeMessageHtml}</div>`
                    : ""
                }
              </div>
            `,
            text: [
              intro,
              "",
              ...rows.map(([label, value]) => `${label}: ${value}`),
              ...(submission.message
                ? [
                    "",
                    locale === "cs-CZ" ? "Zpráva:" : "Message:",
                    submission.message,
                  ]
                : []),
            ].join("\n"),
            replyTo: {
              email: data.email,
              name: data.name,
            },
            tags: ["workspace-reservation-form"],
            metadata: {
              source: "workspace-reservation-form",
              customerName: data.name,
              customerEmail: data.email,
              reservationDate: data.date,
              entryTier: data.entryTier,
              submittedAt: submission.submittedAt,
            },
          };

          yield* emailService.send(businessEmailMessage).pipe(
            Effect.mapError(
              (error) =>
                new StorageError({
                  message:
                    locale === "cs-CZ"
                      ? "Rezervaci se nepodařilo odeslat. Zkus to prosím znovu později."
                      : "Failed to send your reservation. Please try again later.",
                  operation: "workspace.reservation.submit",
                  cause: error,
                })
            )
          );

          const confirmationMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: {
              email: data.email,
              name: data.name,
            },
            subject: getConfirmationSubject(locale),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${
                  locale === "cs-CZ"
                    ? "Rezervace dorazila"
                    : "Your reservation is in"
                }</h2>
                <p>${
                  locale === "cs-CZ"
                    ? "Děkujeme. Rezervaci jsme přijali a ozveme se s potvrzením nebo dalším krokem."
                    : "Thank you. We received your reservation and will follow up with confirmation or next steps."
                }</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                  ${renderRowsHtml(rows.slice(0, 4))}
                </table>
                <p style="margin-top: 20px;">${
                  locale === "cs-CZ"
                    ? `Pokud chceš cokoliv doplnit, napiš nám na ${workspaceSiteConstants.contact.infoEmail}.`
                    : `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`
                }</p>
              </div>
            `,
            text: [
              locale === "cs-CZ"
                ? "Rezervace dorazila"
                : "Your reservation is in",
              "",
              locale === "cs-CZ"
                ? "Děkujeme. Rezervaci jsme přijali a ozveme se s potvrzením nebo dalším krokem."
                : "Thank you. We received your reservation and will follow up with confirmation or next steps.",
              "",
              ...rows.slice(0, 4).map(([label, value]) => `${label}: ${value}`),
              "",
              locale === "cs-CZ"
                ? `Pokud chceš cokoliv doplnit, napiš nám na ${workspaceSiteConstants.contact.infoEmail}.`
                : `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`,
            ].join("\n"),
            tags: ["workspace-reservation-confirmation"],
          };

          yield* emailService
            .send(confirmationMessage)
            .pipe(Effect.catchAll(() => Effect.void));

          return submission;
        }).pipe(
          Effect.withSpan("workspaceReservationSubmit", {
            attributes: {
              "reservation.entryTier": data.entryTier,
              "reservation.date": data.date,
            },
          })
        ),
    });
  })
);
