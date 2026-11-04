import { Effect } from "effect";
import {
  InvoiceDeliveryEmail,
  type InvoiceDeliveryEmailProps,
  invoiceDeliveryEmailTitle,
} from "@/emails/invoice-delivery";
import { isManualInvoiceDocument } from "@/features/accounting/invoice";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import {
  getInvoiceSettlement,
  InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { internalWorkspaceEmailSubject } from "@/shared/backend/email/workspace-email-recipients";
import type { Invoice } from "./invoice.repository";

/** Renders the email that carries an issued invoice to one audience. */
export const renderInvoiceDeliveryEmail = (input: {
  readonly invoice: Invoice;
  readonly audience: InvoiceEmailDeliveryAudience;
}) => {
  const { document } = input.invoice;
  const props: InvoiceDeliveryEmailProps = {
    invoiceNumber: input.invoice.invoiceNumber,
    invoice: isManualInvoiceDocument(document)
      ? {
          source: "manual",
          requestsPayment: InvoiceSettlement.$is("PaymentRequested")(
            getInvoiceSettlement(document)
          ),
        }
      : {
          source: "reservation",
          orderId: input.invoice.workspaceReservationId ?? "",
        },
    recipient:
      input.audience === "customer"
        ? { audience: "customer", locale: document.locale }
        : { audience: "internal" },
  };
  const title = invoiceDeliveryEmailTitle(props);

  return Effect.map(
    renderWorkspaceEmail(<InvoiceDeliveryEmail {...props} />),
    (rendered) => ({
      subject:
        input.audience === "customer"
          ? title
          : internalWorkspaceEmailSubject(title),
      ...rendered,
    })
  );
};
