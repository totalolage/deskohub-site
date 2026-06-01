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
import { type Locale, m } from "@/features/i18n";
import type { ReservationData } from "@/features/reservation/schemas/reservation";
import {
  type EmailDetailRow,
  MultilineEmailText,
  renderEmailRowsText,
  renderWorkspaceEmailHtml,
  WorkspaceEmailRows,
} from "@/shared/backend/email/rendering";
import { StorageError } from "@/shared/backend/errors";
import { workspaceSiteConstants } from "@/shared/utils";

export interface ReservationSubmission extends ReservationData {
  submittedAt: string;
  locale?: Locale;
}

export interface ReservationService {
  readonly submit: (
    data: ReservationData,
    locale?: Locale
  ) => Effect.Effect<ReservationSubmission, StorageError>;
}

export const ReservationService =
  Context.GenericTag<ReservationService>("ReservationService");

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
} as const;

const formatSubmissionDate = (submittedAt: string, locale?: Locale) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const formatReservationDate = (date: string, locale?: Locale) =>
  new Date(`${date}T12:00:00+01:00`).toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });

const getTierLabel = (tier: WorkspaceProductTier) =>
  getWorkspaceProductByTier(tier).label;

const getMessage = (key: keyof typeof m, locale: Locale) => {
  const message = m[key] as (
    inputs: object,
    options: { locale: Locale }
  ) => string;

  return message({}, { locale });
};

const getMessageWithParams = <TInput extends object>(
  key: keyof typeof m,
  input: TInput,
  locale: Locale
) => {
  const message = m[key] as (
    inputs: TInput,
    options: { locale: Locale }
  ) => string;

  return message(input, { locale });
};

const getMonitorLabel = (
  monitor: WorkspaceProductMonitorOption,
  locale: Locale
) => {
  const labels = {
    "2x27-qhd": "reservationEmailMonitor2x27QhdLabel",
    "2x32-qhd": "reservationEmailMonitor2x32QhdLabel",
    "2x27-4k": "reservationEmailMonitor2x27FourKLabel",
    "2x32-4k": "reservationEmailMonitor2x32FourKLabel",
  } satisfies Record<WorkspaceProductMonitorOption, keyof typeof m>;

  return getMessage(labels[monitor], locale);
};

const getBusinessSubject = (name: string, date: string, locale: Locale) =>
  getMessageWithParams(
    "reservationEmailBusinessSubject",
    { name, date },
    locale
  );

const getConfirmationSubject = (locale: Locale) =>
  m.reservationEmailConfirmationSubject({}, { locale });

const messageBlockStyle = {
  background: "#f4f1ea",
  borderRadius: "16px",
  padding: "16px",
  whiteSpace: "normal",
} as const;

const createDetailRows = (
  submission: ReservationSubmission,
  locale: Locale
): EmailDetailRow[] => {
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

  const rows: EmailDetailRow[] = [
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

export const ReservationServiceLive = Layer.effect(
  ReservationService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return ReservationService.of({
      submit: Effect.fn("workspaceReservationSubmit")(
        function* (data, locale) {
          const emailLocale = locale ?? "en-US";
          const submission: ReservationSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale: emailLocale,
          };
          const rows = createDetailRows(submission, emailLocale);
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
            html: renderWorkspaceEmailHtml(
              <div
                style={{
                  fontFamily: "Arial, sans-serif",
                  maxWidth: "640px",
                  margin: "0 auto",
                  color: "#0b1848",
                }}
              >
                <h2 style={{ color: "#0b1848" }}>{intro}</h2>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    marginTop: "16px",
                  }}
                >
                  <tbody>
                    <WorkspaceEmailRows rows={rows} />
                  </tbody>
                </table>
                {submission.message ? (
                  <>
                    <h3 style={{ marginTop: "24px", color: "#0b1848" }}>
                      {messageHeading}
                    </h3>
                    <div style={messageBlockStyle}>
                      <MultilineEmailText value={submission.message} />
                    </div>
                  </>
                ) : null}
              </div>
            ),
            text: [
              intro,
              "",
              ...renderEmailRowsText(rows),
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
            html: renderWorkspaceEmailHtml(
              <div
                style={{
                  fontFamily: "Arial, sans-serif",
                  maxWidth: "640px",
                  margin: "0 auto",
                  color: "#0b1848",
                }}
              >
                <h2 style={{ color: "#0b1848" }}>{confirmationHeading}</h2>
                <p>{confirmationBody}</p>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    marginTop: "16px",
                  }}
                >
                  <tbody>
                    <WorkspaceEmailRows rows={rows.slice(0, 4)} />
                  </tbody>
                </table>
                <p style={{ marginTop: "20px" }}>{confirmationFollowUp}</p>
              </div>
            ),
            text: [
              confirmationHeading,
              "",
              confirmationBody,
              "",
              ...renderEmailRowsText(rows.slice(0, 4)),
              "",
              confirmationFollowUp,
            ].join("\n"),
            tags: ["workspace-reservation-confirmation"],
          };

          yield* emailService
            .send(confirmationMessage)
            .pipe(Effect.catchAll(() => Effect.void));

          return submission;
        },
        (effect, data, locale) =>
          effect.pipe(
            Effect.annotateLogs({
              locale,
              ...data,
            })
          )
      ),
    });
  })
);
