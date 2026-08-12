import { Heading, Text } from "react-email";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";

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
      <Heading className="m-0 text-[30px] font-bold leading-[38px] text-navy">
        {heading}
      </Heading>
      <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
        {body}
      </Text>
    </WorkspaceEmailLayout>
  );
}

export default InvoiceDeliveryEmail;
