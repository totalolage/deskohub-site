import type { Customer } from "@deskohub/dotypos/generated/types.gen";
import type { NetworkError } from "@deskohub/email/backend/network-error";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type {
  EmailMessage,
  EmailRecipient,
} from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema/workspace-reservations";
import {
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { isLocale, type Locale, m } from "@/features/i18n";
import {
  type EmailDetailRow,
  renderEmailRowsText,
  renderWorkspaceEmailHtml,
  WorkspaceEmailRows,
} from "@/shared/backend/email/rendering";
import { workspaceSiteConstants } from "@/shared/utils";

export interface WorkspaceReservationEmailService {
  readonly sendPaidReservationEmails: (input: {
    readonly reservation: WorkspaceReservation;
    readonly customer: Customer;
    readonly tableName?: string;
  }) => Effect.Effect<void, EmailServiceError | NetworkError>;
}

export const WorkspaceReservationEmailService =
  Context.GenericTag<WorkspaceReservationEmailService>(
    "WorkspaceReservationEmailService"
  );

const workspaceRecipient: EmailRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
};

const getReservationLocale = (locale: string): Locale =>
  isLocale(locale) ? locale : "cs-CZ";

const getCustomerName = (customer: Customer) =>
  [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") ||
  customer.companyName?.trim() ||
  customer.email?.trim() ||
  "Workspace customer";

const formatReservationDate = (
  reservation: WorkspaceReservation,
  locale: Locale
) =>
  (
    reservation.reservationCreatedAt ?? reservation.createdAt
  ).toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });

export const createReservationRows = (
  reservation: WorkspaceReservation,
  customer: Customer,
  locale: Locale,
  options?: { readonly includeAccessCode?: boolean }
): EmailDetailRow[] => {
  const monitorOption = reservation.productMonitorOption ?? undefined;
  const rows: EmailDetailRow[] = [
    [m.reservationEmailNameLabel({}, { locale }), getCustomerName(customer)],
    [
      m.reservationEmailDateLabel({}, { locale }),
      formatReservationDate(reservation, locale),
    ],
    [
      m.reservationEmailTierLabel({}, { locale }),
      isWorkspaceProductTier(reservation.productTier)
        ? getWorkspaceProductTierTitle(reservation.productTier, locale)
        : reservation.productTier,
    ],
    [
      m.reservationEmailCoffeeLabel({}, { locale }),
      reservation.productCoffee
        ? m.checkoutStatusYes({}, { locale })
        : m.checkoutStatusNo({}, { locale }),
    ],
  ];

  if (options?.includeAccessCode) {
    rows.push([
      m.checkoutEmailAccessCodeLabel({}, { locale }),
      reservation.customerAccessCode,
    ]);
  }

  if (customer.phone?.trim()) {
    rows.splice(1, 0, [
      m.reservationEmailPhoneLabel({}, { locale }),
      customer.phone,
    ]);
  }

  if (isWorkspaceProductMonitorOption(monitorOption)) {
    rows.splice(4, 0, [
      m.reservationEmailMonitorsLabel({}, { locale }),
      getWorkspaceProductMonitorTitle(monitorOption, locale),
    ]);
  }

  if (reservation.dotyposReservationId) {
    rows.push([
      m.checkoutEmailDotyposReservationIdLabel({}, { locale }),
      reservation.dotyposReservationId,
    ]);
  }

  rows.push([m.checkoutStatusOrderIdLabel({}, { locale }), reservation.id]);

  return rows;
};

const createEmailHtml = (input: {
  readonly heading: string;
  readonly body?: string;
  readonly locale: Locale;
  readonly accessCode?: string;
  readonly tableName?: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  renderWorkspaceEmailHtml(
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        color: "#00024f",
      }}
    >
      <h2 style={{ color: "#00024f" }}>{input.heading}</h2>
      {input.body ? <p>{input.body}</p> : null}
      {input.accessCode ? (
        <div
          style={{
            margin: "24px 0 18px",
            background: "#f4f1ea",
            border: "1px solid #e6ded2",
            borderRadius: "24px",
            overflow: "hidden",
            boxShadow: "0 18px 40px rgba(0, 2, 79, 0.12)",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, #00024f 0%, #06145f 58%, #004f66 100%)",
              color: "#f4f1ea",
              padding: "22px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {m.checkoutEmailAccessCodeLabel({}, { locale: input.locale })}
            </div>
            <div
              style={{
                fontSize: "64px",
                lineHeight: "1",
                fontWeight: 800,
                letterSpacing: "0.08em",
                marginTop: "10px",
              }}
            >
              {input.accessCode}
            </div>
          </div>
          {input.tableName ? (
            <div
              style={{
                background: "#e9fff6",
                borderTop: "4px solid #00df99",
                color: "#00024f",
                padding: "20px 24px 24px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#00024f",
                }}
              >
                {m.checkoutEmailTableNumberLabel({}, { locale: input.locale })}
              </div>
              <div
                style={{
                  fontSize: "56px",
                  lineHeight: "1",
                  fontWeight: 800,
                  marginTop: "8px",
                }}
              >
                {input.tableName}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "16px",
        }}
      >
        <tbody>
          <WorkspaceEmailRows rows={input.rows} />
        </tbody>
      </table>
      {input.followUp ? (
        <p style={{ marginTop: "20px" }}>{input.followUp}</p>
      ) : null}
    </div>
  );

const createEmailText = (input: {
  readonly heading: string;
  readonly body?: string;
  readonly locale: Locale;
  readonly accessCode?: string;
  readonly tableName?: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  [
    input.heading,
    ...(input.body ? ["", input.body] : []),
    ...(input.accessCode
      ? [
          "",
          `${m.checkoutEmailAccessCodeLabel({}, { locale: input.locale })}: ${input.accessCode}`,
        ]
      : []),
    ...(input.tableName
      ? [
          "",
          `${m.checkoutEmailTableNumberLabel({}, { locale: input.locale })}: ${input.tableName}`,
        ]
      : []),
    "",
    ...renderEmailRowsText(input.rows),
    ...(input.followUp ? ["", input.followUp] : []),
  ].join("\n");

export const createWorkspaceReservationCustomerEmailPreviewHtml = (input: {
  readonly reservation: WorkspaceReservation;
  readonly customer: Customer;
  readonly tableName: string;
}) => {
  const locale = getReservationLocale(input.reservation.locale);
  const rows = createReservationRows(input.reservation, input.customer, locale);

  return createEmailHtml({
    heading: m.checkoutEmailCustomerAccessHeading({}, { locale }),
    locale,
    accessCode: input.reservation.customerAccessCode,
    tableName: input.tableName,
    rows,
    followUp: m.reservationEmailCustomerFollowUp(
      { email: workspaceSiteConstants.contact.infoEmail },
      { locale }
    ),
  });
};

export const WorkspaceReservationEmailServiceLive = Layer.effect(
  WorkspaceReservationEmailService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return WorkspaceReservationEmailService.of({
      sendPaidReservationEmails: Effect.fn(
        "workspaceReservationEmail.sendPaidReservationEmails"
      )(function* ({ reservation, customer, tableName }) {
        const locale = getReservationLocale(reservation.locale);
        const customerName = getCustomerName(customer);
        const customerEmail = customer.email?.trim();
        const customerRows = createReservationRows(
          reservation,
          customer,
          locale
        );
        const internalRows = createReservationRows(
          reservation,
          customer,
          locale,
          {
            includeAccessCode: true,
          }
        );
        const metadata = {
          source: "workspace-paid-fulfillment",
          workspaceReservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          dotyposCustomerId: reservation.dotyposCustomerId,
          customerEmail,
        };

        if (customerEmail) {
          const heading = m.checkoutEmailCustomerAccessHeading({}, { locale });
          const followUp = m.reservationEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale }
          );
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail, name: customerName },
            replyTo: workspaceRecipient,
            subject: m.checkoutEmailCustomerAccessSubject({}, { locale }),
            html: createEmailHtml({
              heading,
              locale,
              accessCode: reservation.customerAccessCode,
              tableName,
              rows: customerRows,
              followUp,
            }),
            text: createEmailText({
              heading,
              locale,
              accessCode: reservation.customerAccessCode,
              tableName,
              rows: customerRows,
              followUp,
            }),
            tags: ["workspace-paid-reservation-access"],
            metadata,
          };

          yield* emailService.send(customerMessage).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Workspace reservation customer email failed", {
                cause,
                workspaceReservationId: reservation.id,
              })
            ),
            Effect.asVoid
          );
        } else {
          yield* Effect.logWarning(
            "Workspace reservation customer email skipped: missing customer email",
            { workspaceReservationId: reservation.id }
          );
          return yield* Effect.fail(
            new EmailServiceError(
              "Workspace reservation customer email is missing."
            )
          );
        }

        const internalHeading = m.checkoutEmailInternalPaidReservationHeading(
          {},
          { locale }
        );
        const internalBody = m.checkoutEmailInternalPaidReservationBody(
          {},
          { locale }
        );
        const internalMessage: EmailMessage = {
          from: emailConfig.defaultFrom,
          to: workspaceRecipient,
          replyTo: customerEmail
            ? { email: customerEmail, name: customerName }
            : undefined,
          subject: m.checkoutEmailInternalPaidReservationSubject(
            { orderId: reservation.id },
            { locale }
          ),
          html: createEmailHtml({
            heading: internalHeading,
            body: internalBody,
            locale,
            rows: internalRows,
          }),
          text: createEmailText({
            heading: internalHeading,
            body: internalBody,
            locale,
            rows: internalRows,
          }),
          tags: ["workspace-paid-reservation-internal"],
          metadata,
        };

        yield* emailService.send(internalMessage).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Workspace reservation internal email failed", {
              cause,
              workspaceReservationId: reservation.id,
            })
          ),
          Effect.ignore
        );
      }),
    });
  })
);
