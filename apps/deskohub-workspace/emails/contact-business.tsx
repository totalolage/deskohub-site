import { Heading, Section, Text } from "react-email";
import { MultilineEmailText } from "./_components/multiline-email-text";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { contactBusinessPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContactBusinessEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly messageHeading: string;
  readonly details: readonly WorkspaceEmailDetail[];
  readonly message: string;
};

export function ContactBusinessEmail({
  locale,
  preview,
  heading,
  messageHeading,
  details,
  message,
}: ContactBusinessEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <Heading className="m-0 text-[30px] font-bold leading-[38px] text-navy">
        {heading}
      </Heading>
      <WorkspaceEmailDetails details={details} />
      <Heading
        as="h2"
        className="m-0 mt-7 text-[18px] font-bold leading-[26px] text-navy"
      >
        {messageHeading}
      </Heading>
      <Section className="mt-3 rounded-2xl bg-cream px-5 py-4">
        <Text className="m-0 text-[15px] leading-[24px] text-navy">
          <MultilineEmailText value={message} />
        </Text>
      </Section>
    </WorkspaceEmailLayout>
  );
}

ContactBusinessEmail.PreviewProps = contactBusinessPreviewProps;

export default ContactBusinessEmail;
