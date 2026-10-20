import { Predicate, Result } from "effect";
import { getClientEnv } from "@/client-env";
import { formatError } from "@/shared/utils/error-formatting";
import type {
  CampaignBodyAttributeValue,
  CampaignBodyNode,
} from "./campaign-body-document";
import { campaignBodySchema } from "./campaign-body-extensions";

export type CampaignBodyIssue = {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly issue: string;
};

const campaignLinkProtocols: ReadonlySet<string> = new Set([
  "https:",
  "mailto:",
]);

/** Links and buttons may only open `https:` pages or `mailto:` addresses. */
const isCampaignLinkHref = (
  href: CampaignBodyAttributeValue | undefined
): href is string =>
  Predicate.isString(href) &&
  campaignLinkProtocols.has(URL.parse(href)?.protocol ?? "");

/**
 * Images must be delivered from our own Cloudinary account. The account is
 * read only here, so bodies without images validate without Cloudinary config.
 */
const isCampaignImageSource = (
  source: CampaignBodyAttributeValue | undefined
): source is string => {
  if (!Predicate.isString(source)) return false;
  const url = URL.parse(source);

  return (
    url?.protocol === "https:" &&
    url.hostname === "res.cloudinary.com" &&
    url.pathname.startsWith(
      `/${getClientEnv().NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/`
    )
  );
};

const hasText = (value: CampaignBodyAttributeValue | undefined): boolean =>
  Predicate.isString(value) && value.trim().length > 0;

const nodeIssues = (
  node: CampaignBodyNode,
  path: ReadonlyArray<PropertyKey>
): ReadonlyArray<CampaignBodyIssue> => {
  const own: Array<CampaignBodyIssue> = [];

  for (const [index, mark] of (node.marks ?? []).entries()) {
    if (mark.type === "link" && !isCampaignLinkHref(mark.attrs?.href)) {
      own.push({
        path: [...path, "marks", index, "attrs", "href"],
        issue: "A link must use an https: or mailto: URL.",
      });
    }
  }

  if (node.type === "image" && !isCampaignImageSource(node.attrs?.src)) {
    own.push({
      path: [...path, "attrs", "src"],
      issue: "An image must come from the Deskohub Cloudinary account.",
    });
  }

  if (node.type === "ctaButton") {
    if (!hasText(node.attrs?.label)) {
      own.push({
        path: [...path, "attrs", "label"],
        issue: "A button needs a label.",
      });
    } else if (String(node.attrs?.label).includes("\r")) {
      // Markdown turns carriage returns into line breaks, so the label could
      // not survive a Markdown export.
      own.push({
        path: [...path, "attrs", "label"],
        issue: "A button label must break lines with line feeds only.",
      });
    }
    if (!isCampaignLinkHref(node.attrs?.href)) {
      own.push({
        path: [...path, "attrs", "href"],
        issue: "A button needs an https: or mailto: URL.",
      });
    }
  }

  return [
    ...own,
    ...(node.content ?? []).flatMap((child, index) =>
      nodeIssues(child, [...path, "content", index])
    ),
  ];
};

/**
 * Checks a body against the TipTap schema of the campaign content set: known
 * nodes and marks, valid nesting. A body that passes can be rendered.
 */
export const campaignBodyStructureIssues = (
  doc: CampaignBodyNode
): ReadonlyArray<CampaignBodyIssue> => {
  if (doc.type !== campaignBodySchema.topNodeType.name) {
    return [{ path: ["type"], issue: 'A body must be a "doc" node.' }];
  }

  const schemaIssue = Result.try({
    try: () => campaignBodySchema.nodeFromJSON(doc).check(),
    catch: (error): CampaignBodyIssue => ({
      path: [],
      issue: formatError(error).message,
    }),
  });

  return Result.isFailure(schemaIssue) ? [schemaIssue.failure] : [];
};

/**
 * Checks a body against the campaign content set: its structure plus the
 * rules the schema can't express, which links, buttons and images must meet.
 */
export const campaignBodyIssues = (
  doc: CampaignBodyNode
): ReadonlyArray<CampaignBodyIssue> => {
  const structureIssues = campaignBodyStructureIssues(doc);
  return structureIssues.length > 0 ? structureIssues : nodeIssues(doc, []);
};
