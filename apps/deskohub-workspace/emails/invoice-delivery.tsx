import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { invoiceDeliveryPreviewProps } from "./_fixtures/preview-props";

export type InvoiceDeliveryEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly body: string;
};

export function InvoiceDeliveryEmail({
  locale,
  preview,
  heading,
  body,
}: InvoiceDeliveryEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>
    </WorkspaceEmailLayout>
  );
}

InvoiceDeliveryEmail.PreviewProps = invoiceDeliveryPreviewProps;

export default InvoiceDeliveryEmail;
