import { Match } from "effect";
import { type Locale, m } from "@/features/i18n";
import { staffEmailLocale } from "@/shared/backend/email/staff-email-locale";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { invoiceDeliveryPreviewProps } from "./_fixtures/preview-props";

export type InvoiceDeliveryEmailProps = {
  readonly invoiceNumber: string;
  readonly invoice:
    | { readonly source: "reservation"; readonly orderId: string }
    | { readonly source: "manual"; readonly requestsPayment: boolean };
  /** Customers read it in the invoice's locale, staff in the staff locale. */
  readonly recipient:
    | { readonly audience: "customer"; readonly locale: Locale }
    | { readonly audience: "internal" };
};

const recipientLocale = ({ recipient }: InvoiceDeliveryEmailProps): Locale =>
  recipient.audience === "customer" ? recipient.locale : staffEmailLocale;

/** The invoice's title and number; the subject and inbox preview. */
export const invoiceDeliveryEmailTitle = (props: InvoiceDeliveryEmailProps) =>
  `${m.invoiceTitle({}, { locale: recipientLocale(props) })} ${props.invoiceNumber}`;

const invoiceDeliveryEmailCopy = (props: InvoiceDeliveryEmailProps) => {
  const { invoice, invoiceNumber } = props;
  const locale = recipientLocale(props);

  return Match.value(props.recipient.audience).pipe(
    Match.when("customer", () => ({
      heading: m.invoiceEmailHeading({}, { locale }),
      body: Match.value(invoice).pipe(
        Match.when({ source: "reservation" }, ({ orderId }) =>
          m.invoiceEmailBody({ invoiceNumber, orderId }, { locale })
        ),
        Match.when({ source: "manual", requestsPayment: true }, () =>
          m.invoiceManualEmailBodyPaymentDetails({ invoiceNumber }, { locale })
        ),
        Match.when({ source: "manual", requestsPayment: false }, () =>
          m.invoiceManualEmailBody({ invoiceNumber }, { locale })
        ),
        Match.exhaustive
      ),
    })),
    Match.when("internal", () => ({
      heading: m.invoiceEmailInternalHeading({}, { locale }),
      body: Match.value(invoice).pipe(
        Match.when({ source: "reservation" }, ({ orderId }) =>
          m.invoiceEmailInternalBody({ invoiceNumber, orderId }, { locale })
        ),
        Match.when({ source: "manual" }, () =>
          m.invoiceManualEmailInternalBody({ invoiceNumber }, { locale })
        ),
        Match.exhaustive
      ),
    })),
    Match.exhaustive
  );
};

/** Covers an issued invoice's PDF attachment for a customer or staff. */
export function InvoiceDeliveryEmail(props: InvoiceDeliveryEmailProps) {
  const { heading, body } = invoiceDeliveryEmailCopy(props);

  return (
    <WorkspaceEmailLayout
      locale={recipientLocale(props)}
      preview={invoiceDeliveryEmailTitle(props)}
    >
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>
    </WorkspaceEmailLayout>
  );
}

InvoiceDeliveryEmail.PreviewProps = invoiceDeliveryPreviewProps;

export default InvoiceDeliveryEmail;
