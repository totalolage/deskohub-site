import { Heading, Section, Text } from "react-email";
import { MultilineEmailText } from "./_components/multiline-email-text";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { contactConfirmationPreviewProps } from "./_fixtures/preview-props";

export type ContactConfirmationEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly body: string;
  readonly message: string;
  readonly followUp: string;
};

export function ContactConfirmationEmail({
  locale,
  preview,
  heading,
  body,
  message,
  followUp,
}: ContactConfirmationEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <Heading className="m-0 text-[30px] font-bold leading-[38px] text-navy">
        {heading}
      </Heading>
      <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
        {body}
      </Text>
      <Section className="mt-5 rounded-2xl bg-cream px-5 py-4">
        <Text className="m-0 text-[15px] leading-[24px] text-navy">
          <MultilineEmailText value={message} />
        </Text>
      </Section>
      <Text className="m-0 mt-5 text-[14px] leading-[23px] text-[#565975]">
        {followUp}
      </Text>
    </WorkspaceEmailLayout>
  );
}

ContactConfirmationEmail.PreviewProps = contactConfirmationPreviewProps;

export default ContactConfirmationEmail;
