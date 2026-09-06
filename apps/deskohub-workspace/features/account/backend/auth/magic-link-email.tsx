import { Effect } from "effect";
import { Link, Section } from "react-email";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "@/emails/_components/workspace-email-content";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "@/emails/_components/workspace-email-layout";
import { m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import type { MagicLinkDeliveryRequest } from "./send-magic-link-email";

export type MagicLinkEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly url: string;
};

/**
 * Account-owned magic-link renderer. The bearer URL is embedded only in the
 * rendered body and must never reach logs, traces, or error messages.
 */
export function MagicLinkEmail({ locale, url }: MagicLinkEmailProps) {
  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={m.accountMagicLinkEmailHeading({}, { locale })}
    >
      <WorkspaceEmailHeading>
        {m.accountMagicLinkEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.accountMagicLinkEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      <Section className="mt-6 text-center">
        <Link
          className="inline-block rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
          href={url}
          rel="noopener"
          style={{ backgroundColor: "#00df99", color: "#00024f" }}
          target="_blank"
        >
          {m.accountMagicLinkEmailButton({}, { locale })}
        </Link>
      </Section>
      <WorkspaceEmailNote>
        {m.accountMagicLinkEmailNote({}, { locale })}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

export const renderMagicLinkEmail = (request: MagicLinkDeliveryRequest) =>
  Effect.map(
    renderWorkspaceEmail(
      MagicLinkEmail({ locale: request.locale, url: request.url })
    ),
    (rendered) => ({
      subject: m.accountMagicLinkEmailSubject({}, { locale: request.locale }),
      ...rendered,
    })
  );
