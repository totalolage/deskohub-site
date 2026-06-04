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

const createReservationRows = (
  reservation: WorkspaceReservation,
  customer: Customer,
  locale: Locale
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
    [
      m.checkoutEmailAccessCodeLabel({}, { locale }),
      reservation.customerAccessCode,
    ],
  ];

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
  readonly body: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  renderWorkspaceEmailHtml(
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        color: "#0b1848",
      }}
    >
      <h2 style={{ color: "#0b1848" }}>{input.heading}</h2>
      <p>{input.body}</p>
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
  readonly body: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  [
    input.heading,
    "",
    input.body,
    "",
    ...renderEmailRowsText(input.rows),
    ...(input.followUp ? ["", input.followUp] : []),
  ].join("\n");

export const WorkspaceReservationEmailServiceLive = Layer.effect(
  WorkspaceReservationEmailService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return WorkspaceReservationEmailService.of({
      sendPaidReservationEmails: Effect.fn(
        "workspaceReservationEmail.sendPaidReservationEmails"
      )(function* ({ reservation, customer }) {
        const locale = getReservationLocale(reservation.locale);
        const customerName = getCustomerName(customer);
        const customerEmail = customer.email?.trim();
        const rows = createReservationRows(reservation, customer, locale);
        const metadata = {
          source: "workspace-paid-fulfillment",
          workspaceReservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          dotyposCustomerId: reservation.dotyposCustomerId,
          customerEmail,
        };

        if (customerEmail) {
          const heading = m.checkoutEmailCustomerAccessHeading({}, { locale });
          const body = m.checkoutEmailCustomerAccessBody({}, { locale });
          const followUp = m.reservationEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale }
          );
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail, name: customerName },
            replyTo: workspaceRecipient,
            subject: m.checkoutEmailCustomerAccessSubject({}, { locale }),
            html: createEmailHtml({ heading, body, rows, followUp }),
            text: createEmailText({ heading, body, rows, followUp }),
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
            rows,
          }),
          text: createEmailText({
            heading: internalHeading,
            body: internalBody,
            rows,
          }),
          tags: ["workspace-paid-reservation-internal"],
          metadata,
        };

        yield* emailService.send(internalMessage).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Workspace reservation internal email failed", {
              cause,
              workspaceReservationId: reservation.id,
            })
          ),
          Effect.asVoid
        );
      }),
    });
  })
);
