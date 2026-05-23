import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import { m, type WorkspaceLocale } from "@/features/i18n";
import type { ReservationData } from "@/features/reservation/schemas/reservation";
import { StorageError } from "@/shared/backend/errors";
import { workspaceSiteConstants } from "@/shared/utils";

type DetailRow = readonly [string, string];

export interface ReservationSubmission extends ReservationData {
  submittedAt: string;
  locale?: WorkspaceLocale;
}

export interface ReservationService {
  readonly submit: (
    data: ReservationData,
    locale?: WorkspaceLocale
  ) => Effect.Effect<ReservationSubmission, StorageError>;
}

export const ReservationService =
  Context.GenericTag<ReservationService>("ReservationService");

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
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

const formatSubmissionDate = (submittedAt: string, locale?: WorkspaceLocale) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const formatReservationDate = (date: string, locale?: WorkspaceLocale) =>
  new Date(`${date}T12:00:00+01:00`).toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });

const getTierLabel = (tier: WorkspaceProductTier) =>
  getWorkspaceProductByTier(tier).label;

const getMessage = (key: keyof typeof m, locale: WorkspaceLocale) => {
  const message = m[key] as (
    inputs: object,
    options: { locale: WorkspaceLocale }
  ) => string;

  return message({}, { locale });
};

const getMessageWithParams = <TInput extends object>(
  key: keyof typeof m,
  input: TInput,
  locale: WorkspaceLocale
) => {
  const message = m[key] as (
    inputs: TInput,
    options: { locale: WorkspaceLocale }
  ) => string;

  return message(input, { locale });
};

const getMonitorLabel = (
  monitor: WorkspaceProductMonitorOption,
  locale: WorkspaceLocale
) => {
  const labels = {
    "2x27": "reservationEmailMonitor2x27Label",
    "2x32": "reservationEmailMonitor2x32Label",
    "qhd-4k": "reservationEmailMonitorQhd4kLabel",
  } satisfies Record<WorkspaceProductMonitorOption, keyof typeof m>;

  return getMessage(labels[monitor], locale);
};

const getBusinessSubject = (
  name: string,
  date: string,
  locale: WorkspaceLocale
) =>
  getMessageWithParams(
    "reservationEmailBusinessSubject",
    { name, date },
    locale
  );

const getConfirmationSubject = (locale: WorkspaceLocale) =>
  m.reservationEmailConfirmationSubject({}, { locale });

const createDetailRows = (
  submission: ReservationSubmission,
  locale: WorkspaceLocale
): DetailRow[] => {
  const labels = {
    tier: m.reservationEmailTierLabel({}, { locale }),
    date: m.reservationEmailDateLabel({}, { locale }),
    coffee: m.reservationEmailCoffeeLabel({}, { locale }),
    monitors: m.reservationEmailMonitorsLabel({}, { locale }),
    name: m.reservationEmailNameLabel({}, { locale }),
    phone: m.reservationEmailPhoneLabel({}, { locale }),
    submittedAt: m.reservationEmailSubmittedAtLabel({}, { locale }),
  };
  const yes = m.reservationConfirmationYes({}, { locale });
  const no = m.reservationConfirmationNo({}, { locale });

  const rows: DetailRow[] = [
    [labels.tier, getTierLabel(submission.entryTier)],
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
          const emailLocale = locale ?? "en-US";
          const submission: ReservationSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale: emailLocale,
          };
          const rows = createDetailRows(submission, emailLocale);
          const safeMessageHtml = submission.message
            ? formatMessageHtml(submission.message)
            : undefined;
          const intro = m.reservationEmailBusinessIntro(
            {},
            { locale: emailLocale }
          );
          const messageHeading = m.reservationEmailMessageHeading(
            {},
            { locale: emailLocale }
          );
          const messageTextHeading = m.reservationEmailMessageTextHeading(
            {},
            { locale: emailLocale }
          );
          const confirmationHeading = m.reservationEmailCustomerHeading(
            {},
            { locale: emailLocale }
          );
          const confirmationBody = m.reservationEmailCustomerBody(
            {},
            { locale: emailLocale }
          );
          const confirmationFollowUp = m.reservationEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale: emailLocale }
          );

          const businessEmailMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: workspaceRecipient,
            subject: getBusinessSubject(
              data.name,
              formatReservationDate(data.date, emailLocale),
              emailLocale
            ),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${escapeHtml(intro)}</h2>
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                  ${renderRowsHtml(rows)}
                </table>
                ${
                  safeMessageHtml
                    ? `<h3 style="margin-top: 24px; color: #0b1848;">${escapeHtml(messageHeading)}</h3><div style="background: #f4f1ea; border-radius: 16px; padding: 16px; white-space: normal;">${safeMessageHtml}</div>`
                    : ""
                }
              </div>
            `,
            text: [
              intro,
              "",
              ...rows.map(([label, value]) => `${label}: ${value}`),
              ...(submission.message
                ? ["", messageTextHeading, submission.message]
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
                  message: m.reservationEmailSendError(
                    {},
                    { locale: emailLocale }
                  ),
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
            subject: getConfirmationSubject(emailLocale),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${escapeHtml(confirmationHeading)}</h2>
                <p>${escapeHtml(confirmationBody)}</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                  ${renderRowsHtml(rows.slice(0, 4))}
                </table>
                <p style="margin-top: 20px;">${escapeHtml(confirmationFollowUp)}</p>
              </div>
            `,
            text: [
              confirmationHeading,
              "",
              confirmationBody,
              "",
              ...rows.slice(0, 4).map(([label, value]) => `${label}: ${value}`),
              "",
              confirmationFollowUp,
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
