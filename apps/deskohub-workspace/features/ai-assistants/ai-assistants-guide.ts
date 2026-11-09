import { customerMcpServerPath } from "@/features/account/customer-agent-routes";
import { getAccountSectionPath } from "@/features/account/routes";
import { getLocalizedPagePath, type Locale, m } from "@/features/i18n";
import {
  workspaceSiteConstants,
  workspaceSiteOrigin,
} from "@/shared/utils/site-constants";

/**
 * A guide block. Text may wrap words in `<name>…</name>` tags, each a link
 * to the matching `AiAssistantsGuide.links` target.
 */
export type AiAssistantsGuideBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "steps"; readonly items: ReadonlyArray<string> }
  | { readonly kind: "list"; readonly items: ReadonlyArray<string> }
  | { readonly kind: "url"; readonly url: string };

interface AiAssistantsGuideSection {
  /** Stable fragment id, so listings and support replies can link a step. */
  readonly id: string;
  readonly heading: string;
  readonly blocks: ReadonlyArray<AiAssistantsGuideBlock>;
}

export interface AiAssistantsGuide {
  readonly title: string;
  readonly lead: string;
  readonly sections: ReadonlyArray<AiAssistantsGuideSection>;
  /** Link targets of the text tags: site paths or `mailto:` URLs. */
  readonly links: Readonly<
    Record<"privacy" | "assistants" | "contact" | "email", string>
  >;
}

/** The public MCP server customers add as a custom connector. */
const customerMcpServerUrl = `${workspaceSiteOrigin}${customerMcpServerPath}`;

/**
 * How to use Deskohub Workspace from ChatGPT, Claude, and other MCP
 * clients, shared by the HTML page and its Markdown.
 */
export const getAiAssistantsGuide = (locale: Locale): AiAssistantsGuide => {
  const { infoEmail } = workspaceSiteConstants.contact;

  return {
    title: m.aiAssistantsPageTitle({}, { locale }),
    lead: m.aiAssistantsPageLead({}, { locale }),
    links: {
      privacy: getLocalizedPagePath(locale, "/[locale]/privacy-policy"),
      assistants: getAccountSectionPath(locale, "assistants"),
      contact: getLocalizedPagePath(locale, "/[locale]/contact"),
      email: `mailto:${infoEmail}`,
    },
    sections: [
      {
        id: "capabilities",
        heading: m.aiAssistantsCapabilitiesHeading({}, { locale }),
        blocks: [
          {
            kind: "list",
            items: [
              m.aiAssistantsCapabilityOfferings({}, { locale }),
              m.aiAssistantsCapabilityAvailability({}, { locale }),
              m.aiAssistantsCapabilityQuote({}, { locale }),
              m.aiAssistantsCapabilityBookingView({}, { locale }),
              m.aiAssistantsCapabilityReservations({}, { locale }),
            ],
          },
          {
            kind: "paragraph",
            text: m.aiAssistantsCapabilityBookingLinks({}, { locale }),
          },
        ],
      },
      {
        id: "chatgpt",
        heading: m.aiAssistantsChatGptHeading({}, { locale }),
        blocks: [
          {
            kind: "steps",
            items: [
              m.aiAssistantsChatGptStepFind({}, { locale }),
              m.aiAssistantsChatGptStepAdd({}, { locale }),
              m.aiAssistantsChatGptStepAsk({}, { locale }),
            ],
          },
          {
            kind: "paragraph",
            text: m.aiAssistantsChatGptSignIn({}, { locale }),
          },
        ],
      },
      {
        id: "claude",
        heading: m.aiAssistantsClaudeHeading({}, { locale }),
        blocks: [
          {
            kind: "steps",
            items: [
              m.aiAssistantsClaudeStepFind({}, { locale }),
              m.aiAssistantsClaudeStepAdd({}, { locale }),
              m.aiAssistantsClaudeStepAsk({}, { locale }),
            ],
          },
          {
            kind: "paragraph",
            text: m.aiAssistantsClaudeSignIn({}, { locale }),
          },
        ],
      },
      {
        id: "custom-connector",
        heading: m.aiAssistantsCustomConnectorHeading({}, { locale }),
        blocks: [
          {
            kind: "paragraph",
            text: m.aiAssistantsCustomConnectorIntro({}, { locale }),
          },
          { kind: "url", url: customerMcpServerUrl },
          {
            kind: "paragraph",
            text: m.aiAssistantsCustomConnectorSignIn({}, { locale }),
          },
        ],
      },
      {
        id: "payment",
        heading: m.aiAssistantsPaymentHeading({}, { locale }),
        blocks: [
          {
            kind: "paragraph",
            text: m.aiAssistantsPaymentOnSite({}, { locale }),
          },
          {
            kind: "paragraph",
            text: m.aiAssistantsPaymentSiteIsCurrent({}, { locale }),
          },
        ],
      },
      {
        id: "data",
        heading: m.aiAssistantsDataHeading({}, { locale }),
        blocks: [
          { kind: "paragraph", text: m.aiAssistantsDataBody({}, { locale }) },
        ],
      },
      {
        id: "disconnect",
        heading: m.aiAssistantsDisconnectHeading({}, { locale }),
        blocks: [
          {
            kind: "paragraph",
            text: m.aiAssistantsDisconnectBody({}, { locale }),
          },
        ],
      },
      {
        id: "troubleshooting",
        heading: m.aiAssistantsTroubleshootingHeading({}, { locale }),
        blocks: [
          {
            kind: "list",
            items: [
              m.aiAssistantsTroubleshootingNotUsed({}, { locale }),
              m.aiAssistantsTroubleshootingSignIn({}, { locale }),
            ],
          },
        ],
      },
      {
        id: "help",
        heading: m.aiAssistantsHelpHeading({}, { locale }),
        blocks: [
          {
            kind: "paragraph",
            text: m.aiAssistantsHelpBody({ address: infoEmail }, { locale }),
          },
        ],
      },
    ],
  };
};
