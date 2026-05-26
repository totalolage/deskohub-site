import type { NetworkError } from "@deskohub/email/backend/network-error";
import {
  EmailConfigTag,
  type EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type {
  EmailMessage,
  EmailRecipient,
} from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/access-code.service";
import {
  formatWorkspaceMoney,
  getWorkspaceProductByTier,
} from "@/features/checkout/product-catalog";
import { getWorkspaceProductMonitorTitle } from "@/features/checkout/product-catalog.i18n";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { type Locale, m } from "@/features/i18n";
import {
  type EmailDetailRow,
  renderEmailRowsText,
  renderWorkspaceEmailHtml,
  WorkspaceEmailRow,
  WorkspaceEmailRows,
} from "@/shared/backend/email/rendering";
import { workspaceSiteConstants } from "@/shared/utils";

type WorkspaceCheckoutEmailReservationSummary = Pick<
  CheckoutDetailsJson["reservation"],
  "tier" | "date" | "coffee" | "monitorOption"
>;

export type WorkspaceCheckoutEmailBookingSummary =
  WorkspaceCheckoutEmailReservationSummary &
    Pick<CheckoutDetailsJson["payment"], "expectedPrice">;

export interface SendWorkspaceCustomerAccessEmailInput {
  readonly orderId: string;
  readonly locale: Locale;
  readonly customer: EmailRecipient;
  readonly booking: WorkspaceCheckoutEmailBookingSummary;
  readonly dotyposReservationId: string;
}

export interface SendWorkspaceInternalPaidReservationEmailInput {
  readonly orderId: string;
  readonly locale: Locale;
  readonly booking: WorkspaceCheckoutEmailBookingSummary;
  readonly dotyposReservationId: string;
}

export interface WorkspaceCheckoutEmailService {
  readonly sendCustomerAccessEmail: (
    input: SendWorkspaceCustomerAccessEmailInput
  ) => Effect.Effect<void, EmailServiceError | NetworkError>;
  readonly sendInternalPaidReservationEmail: (
    input: SendWorkspaceInternalPaidReservationEmailInput
  ) => Effect.Effect<void, EmailServiceError | NetworkError>;
}

export const WorkspaceCheckoutEmailService =
  Context.GenericTag<WorkspaceCheckoutEmailService>(
    "WorkspaceCheckoutEmailService"
  );

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
} as const;

const formatReservationDate = (date: string, locale: Locale) => {
  try {
    return Temporal.PlainDate.from(date).toLocaleString(locale, {
      calendar: "iso8601",
      dateStyle: "full",
    });
  } catch {
    return date;
  }
};

const getProductLabel = (tier: CheckoutDetailsJson["reservation"]["tier"]) =>
  getWorkspaceProductByTier(tier).label;

const createBookingRows = (
  booking: WorkspaceCheckoutEmailBookingSummary,
  locale: Locale
): EmailDetailRow[] => {
  const yes = m.reservationConfirmationYes({}, { locale });
  const no = m.reservationConfirmationNo({}, { locale });
  const rows: EmailDetailRow[] = [
    [
      m.checkoutStatusSummaryTierLabel({}, { locale }),
      getProductLabel(booking.tier),
    ],
    [
      m.checkoutStatusSummaryDateLabel({}, { locale }),
      formatReservationDate(booking.date, locale),
    ],
    [
      m.checkoutStatusSummaryCoffeeLabel({}, { locale }),
      booking.coffee ? yes : no,
    ],
  ];

  if (booking.monitorOption) {
    rows.push([
      m.checkoutStatusSummaryMonitorLabel({}, { locale }),
      getWorkspaceProductMonitorTitle(booking.monitorOption, locale),
    ]);
  }

  rows.push([
    m.checkoutStatusSummaryPriceLabel({}, { locale }),
    formatWorkspaceMoney(booking.expectedPrice, locale),
  ]);

  return rows;
};

const createCustomerAccessMessage = (
  input: SendWorkspaceCustomerAccessEmailInput,
  accessCode: string,
  from: EmailMessage["from"]
): EmailMessage => {
  const rows = createBookingRows(input.booking, input.locale);
  const heading = m.checkoutEmailCustomerAccessHeading(
    {},
    { locale: input.locale }
  );
  const body = m.checkoutEmailCustomerAccessBody({}, { locale: input.locale });
  const accessCodeLabel = m.checkoutEmailAccessCodeLabel(
    {},
    { locale: input.locale }
  );
  const reservationIdLabel = m.checkoutEmailDotyposReservationIdLabel(
    {},
    { locale: input.locale }
  );
  const note = m.checkoutEmailCustomerAccessStubNote(
    {},
    { locale: input.locale }
  );

  return {
    from,
    to: input.customer,
    subject: m.checkoutEmailCustomerAccessSubject({}, { locale: input.locale }),
    html: renderWorkspaceEmailHtml(
      <div
        style={{
          fontFamily: "Arial, sans-serif",
          maxWidth: "640px",
          margin: "0 auto",
          color: "#0b1848",
        }}
      >
        <h2 style={{ color: "#0b1848" }}>{heading}</h2>
        <p>{body}</p>
        <div
          style={{
            background: "#f4f1ea",
            borderRadius: "16px",
            padding: "20px",
            margin: "20px 0",
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            <strong>{accessCodeLabel}</strong>
          </p>
          <p style={{ fontSize: "32px", letterSpacing: "0.2em", margin: 0 }}>
            {accessCode}
          </p>
        </div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "16px",
          }}
        >
          <tbody>
            <WorkspaceEmailRows rows={rows} />
            <tr>
              <td
                style={{ padding: "8px 0", borderBottom: "1px solid #e6e9f3" }}
              >
                <strong>{reservationIdLabel}:</strong>
              </td>
              <td
                style={{ padding: "8px 0", borderBottom: "1px solid #e6e9f3" }}
              >
                {input.dotyposReservationId}
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: "20px", color: "#4f587c" }}>{note}</p>
      </div>
    ),
    text: [
      heading,
      "",
      body,
      "",
      `${accessCodeLabel}: ${accessCode}`,
      `${reservationIdLabel}: ${input.dotyposReservationId}`,
      "",
      ...renderEmailRowsText(rows),
      "",
      note,
    ].join("\n"),
    tags: ["workspace-checkout-customer-access-stub"],
    metadata: {
      source: "workspace-checkout-email-stub",
      kind: "customer-access",
      orderId: input.orderId,
      locale: input.locale,
      reservationDate: input.booking.date,
      entryTier: input.booking.tier,
      dotyposReservationId: input.dotyposReservationId,
    },
  };
};

const createInternalPaidReservationMessage = (
  input: SendWorkspaceInternalPaidReservationEmailInput,
  accessCode: string,
  from: EmailMessage["from"]
): EmailMessage => {
  const rows = createBookingRows(input.booking, input.locale);
  const heading = m.checkoutEmailInternalPaidReservationHeading(
    {},
    { locale: input.locale }
  );
  const intro = m.checkoutEmailInternalPaidReservationBody(
    {},
    { locale: input.locale }
  );
  const orderIdLabel = m.checkoutStatusOrderIdLabel(
    {},
    { locale: input.locale }
  );
  const accessCodeLabel = m.checkoutEmailAccessCodeLabel(
    {},
    { locale: input.locale }
  );
  const reservationIdLabel = m.checkoutEmailDotyposReservationIdLabel(
    {},
    { locale: input.locale }
  );
  const note = m.checkoutEmailInternalPaidReservationStubNote(
    {},
    { locale: input.locale }
  );

  return {
    from,
    to: workspaceRecipient,
    subject: m.checkoutEmailInternalPaidReservationSubject(
      { orderId: input.orderId },
      { locale: input.locale }
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
        <h2 style={{ color: "#0b1848" }}>{heading}</h2>
        <p>{intro}</p>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "16px",
          }}
        >
          <tbody>
            <WorkspaceEmailRow label={orderIdLabel} value={input.orderId} />
            <WorkspaceEmailRow
              label={reservationIdLabel}
              value={input.dotyposReservationId}
            />
            <WorkspaceEmailRow label={accessCodeLabel} value={accessCode} />
            <WorkspaceEmailRows rows={rows} />
          </tbody>
        </table>
        <p style={{ marginTop: "20px", color: "#4f587c" }}>{note}</p>
      </div>
    ),
    text: [
      heading,
      "",
      intro,
      "",
      `${orderIdLabel}: ${input.orderId}`,
      `${reservationIdLabel}: ${input.dotyposReservationId}`,
      `${accessCodeLabel}: ${accessCode}`,
      ...renderEmailRowsText(rows),
      "",
      note,
    ].join("\n"),
    tags: ["workspace-checkout-internal-paid-reservation-stub"],
    metadata: {
      source: "workspace-checkout-email-stub",
      kind: "internal-paid-reservation",
      orderId: input.orderId,
      locale: input.locale,
      reservationDate: input.booking.date,
      entryTier: input.booking.tier,
      dotyposReservationId: input.dotyposReservationId,
    },
  };
};

export const WorkspaceCheckoutEmailServiceLive = Layer.effect(
  WorkspaceCheckoutEmailService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;
    const accessCodes = yield* WorkspaceCheckoutAccessCodeService;

    return WorkspaceCheckoutEmailService.of({
      sendCustomerAccessEmail: Effect.fn(
        "workspaceCheckoutEmail.sendCustomerAccessEmail"
      )(
        function* (input) {
          const accessCode = yield* accessCodes.resolveCustomerAccessCode({
            orderId: input.orderId,
            dotyposReservationId: input.dotyposReservationId,
          });

          yield* emailService.send(
            createCustomerAccessMessage(
              input,
              accessCode,
              emailConfig.defaultFrom
            )
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      ),
      sendInternalPaidReservationEmail: Effect.fn(
        "workspaceCheckoutEmail.sendInternalPaidReservationEmail"
      )(
        function* (input) {
          const accessCode = yield* accessCodes.resolveCustomerAccessCode({
            orderId: input.orderId,
            dotyposReservationId: input.dotyposReservationId,
          });

          yield* emailService.send(
            createInternalPaidReservationMessage(
              input,
              accessCode,
              emailConfig.defaultFrom
            )
          );
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              ...input,
            })
          )
      ),
    });
  })
);
