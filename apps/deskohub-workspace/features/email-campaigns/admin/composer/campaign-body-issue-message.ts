import { Predicate } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type {
  CampaignBodyAttributeValue,
  CampaignBodyNode,
} from "../../body/campaign-body-document";
import type { CampaignBodyIssue } from "../../body/campaign-body-rules";

const isButtonLabelPresent = (label: CampaignBodyAttributeValue | undefined) =>
  Predicate.isString(label) && label.trim().length > 0;

/**
 * The node a rule issue points into: the path walks `content` indexes down to
 * the node, then names one of its attributes or marks.
 */
const issueNode = (
  node: CampaignBodyNode,
  path: ReadonlyArray<PropertyKey>
): CampaignBodyNode | undefined => {
  const [key, index, ...rest] = path;
  if (key !== "content") return node;
  const child = Predicate.isNumber(index) ? node.content?.[index] : undefined;
  return child && issueNode(child, rest);
};

/**
 * The admin message for a body rule issue. The rules keep their English
 * messages for the administration API, so the admin UI names the problem from
 * where the issue points: the attribute, and for a button label its content.
 */
export const campaignBodyIssueMessage = (
  doc: CampaignBodyNode,
  { path }: CampaignBodyIssue,
  locale: Locale
): string => {
  if (path.length === 1 && path[0] === "type") {
    return m.emailCampaignsBodyNotDocument({}, { locale });
  }
  if (path.at(-4) === "marks") {
    return m.emailCampaignsBodyLinkHrefInvalid({}, { locale });
  }
  switch (path.at(-1)) {
    case "src":
      return m.emailCampaignsBodyImageSourceInvalid({}, { locale });
    case "href":
      return m.emailCampaignsBodyButtonHrefInvalid({}, { locale });
    case "label":
      return isButtonLabelPresent(issueNode(doc, path)?.attrs?.label)
        ? m.emailCampaignsBodyButtonLabelLineBreaks({}, { locale })
        : m.emailCampaignsBodyButtonLabelMissing({}, { locale });
    default:
      return m.emailCampaignsBodyStructureInvalid({}, { locale });
  }
};
