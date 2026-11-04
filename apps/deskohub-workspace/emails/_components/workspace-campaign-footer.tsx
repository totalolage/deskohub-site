import { Data, Match } from "effect";
import { Link, Text } from "react-email";
import { type Locale, m } from "@/features/i18n";

/**
 * Why the recipient gets a campaign email. A marketing email links to the
 * customer's marketing preferences, where they can unsubscribe; an
 * operational email states that it is a service message, in the campaign's
 * own words when it gives an `operationalReason`.
 */
export type WorkspaceCampaignFooter = Data.TaggedEnum<{
  Marketing: { readonly marketingPreferencesUrl: string };
  Operational: { readonly operationalReason: string | undefined };
}>;

export const WorkspaceCampaignFooter =
  Data.taggedEnum<WorkspaceCampaignFooter>();

export function WorkspaceCampaignFooterText({
  footer,
  locale,
}: {
  readonly footer: WorkspaceCampaignFooter;
  readonly locale: Locale;
}) {
  return (
    <Text className="m-0 px-5 pt-2 text-center text-[12px] leading-[18px] text-[#666983]">
      {Match.valueTags(footer, {
        Marketing: ({ marketingPreferencesUrl }) => (
          <>
            {m.emailCampaignMarketingFooter({}, { locale })}{" "}
            <Link
              className="text-[#666983] underline"
              href={marketingPreferencesUrl}
            >
              {m.emailCampaignMarketingFooterLink({}, { locale })}
            </Link>
          </>
        ),
        Operational: ({ operationalReason }) =>
          operationalReason ?? m.emailCampaignOperationalFooter({}, { locale }),
      })}
    </Text>
  );
}
