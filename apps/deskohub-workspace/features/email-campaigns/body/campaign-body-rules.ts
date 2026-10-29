import { Data, Option, Predicate, Result } from "effect";
import { formatError } from "@/shared/utils/error-formatting";
import type {
  CampaignBodyAttributeValue,
  CampaignBodyNode,
} from "./campaign-body-document";
import { campaignBodySchema } from "./campaign-body-extensions";
import {
  isCampaignImageAlignment,
  isCampaignImageWidth,
} from "./campaign-image";

type IssuePath = ReadonlyArray<PropertyKey>;

/**
 * Why a body breaks the campaign content set. `path` points into the body
 * document: the node, then the attribute or mark at fault.
 */
export type CampaignBodyIssue = Data.TaggedEnum<{
  NotDocument: { readonly path: IssuePath };
  /** The TipTap schema rejects the body; `reason` is its message. */
  StructureInvalid: { readonly path: IssuePath; readonly reason: string };
  LinkHrefInvalid: { readonly path: IssuePath };
  ImageSourceInvalid: { readonly path: IssuePath };
  /** The alignment isn't left, center or right, or the width isn't whole pixels. */
  ImageLayoutInvalid: { readonly path: IssuePath };
  ButtonLabelMissing: { readonly path: IssuePath };
  /** Markdown turns carriage returns into line breaks, losing them on export. */
  ButtonLabelLineBreaks: { readonly path: IssuePath };
  ButtonHrefInvalid: { readonly path: IssuePath };
}>;

export const CampaignBodyIssue = Data.taggedEnum<CampaignBodyIssue>();

/**
 * The issue in English, as the administration API and its CLI report it.
 * Keep the text stable: it reaches API clients verbatim.
 */
export const englishCampaignBodyIssueMessage = (
  issue: CampaignBodyIssue
): string =>
  CampaignBodyIssue.$match(issue, {
    NotDocument: () => 'A body must be a "doc" node.',
    StructureInvalid: ({ reason }) => reason,
    LinkHrefInvalid: () => "A link must use an https: or mailto: URL.",
    ImageSourceInvalid: () =>
      "An image must come from the Deskohub Cloudinary account.",
    ImageLayoutInvalid: () =>
      "An image must align left, center or right, and give its width in whole pixels.",
    ButtonLabelMissing: () => "A button needs a label.",
    ButtonLabelLineBreaks: () =>
      "A button label must break lines with line feeds only.",
    ButtonHrefInvalid: () => "A button needs an https: or mailto: URL.",
  });

const campaignLinkProtocols: ReadonlySet<string> = new Set([
  "https:",
  "mailto:",
]);

/** Links and buttons may only open `https:` pages or `mailto:` addresses. */
export const isCampaignLinkHref = (
  href: CampaignBodyAttributeValue | undefined
): href is string =>
  Predicate.isString(href) &&
  campaignLinkProtocols.has(URL.parse(href)?.protocol ?? "");

/**
 * Images must be delivered from our own Cloudinary account, `imageCloudName`.
 * Without one configured, no image source qualifies.
 */
const isCampaignImageSource = (
  source: CampaignBodyAttributeValue | undefined,
  imageCloudName: Option.Option<string>
): source is string => {
  if (!Predicate.isString(source)) return false;
  const url = URL.parse(source);

  return Option.exists(
    imageCloudName,
    (cloudName) =>
      url?.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      url.pathname.startsWith(`/${cloudName}/image/`)
  );
};

const hasText = (value: CampaignBodyAttributeValue | undefined): boolean =>
  Predicate.isString(value) && value.trim().length > 0;

/** What's wrong with a button's label, if anything. */
export const campaignButtonLabelIssue = (
  label: CampaignBodyAttributeValue | undefined,
  path: IssuePath
): Option.Option<
  Extract<
    CampaignBodyIssue,
    { readonly _tag: "ButtonLabelMissing" | "ButtonLabelLineBreaks" }
  >
> => {
  if (!hasText(label)) {
    return Option.some(CampaignBodyIssue.ButtonLabelMissing({ path }));
  }
  return String(label).includes("\r")
    ? Option.some(CampaignBodyIssue.ButtonLabelLineBreaks({ path }))
    : Option.none();
};

const nodeIssues = (
  node: CampaignBodyNode,
  path: IssuePath,
  imageCloudName: Option.Option<string>
): ReadonlyArray<CampaignBodyIssue> => {
  const own: Array<CampaignBodyIssue> = [];

  for (const [index, mark] of (node.marks ?? []).entries()) {
    if (mark.type === "link" && !isCampaignLinkHref(mark.attrs?.href)) {
      own.push(
        CampaignBodyIssue.LinkHrefInvalid({
          path: [...path, "marks", index, "attrs", "href"],
        })
      );
    }
  }

  if (
    node.type === "image" &&
    !isCampaignImageSource(node.attrs?.src, imageCloudName)
  ) {
    own.push(
      CampaignBodyIssue.ImageSourceInvalid({ path: [...path, "attrs", "src"] })
    );
  }

  if (node.type === "image") {
    const align = node.attrs?.align;
    const width = node.attrs?.width;
    // An unset alignment or width keeps the default: centered, filling the
    // column.
    if (
      align !== undefined &&
      align !== null &&
      !isCampaignImageAlignment(align)
    ) {
      own.push(
        CampaignBodyIssue.ImageLayoutInvalid({
          path: [...path, "attrs", "align"],
        })
      );
    }
    if (width !== undefined && width !== null && !isCampaignImageWidth(width)) {
      own.push(
        CampaignBodyIssue.ImageLayoutInvalid({
          path: [...path, "attrs", "width"],
        })
      );
    }
  }

  if (node.type === "ctaButton") {
    own.push(
      ...Option.toArray(
        campaignButtonLabelIssue(node.attrs?.label, [...path, "attrs", "label"])
      )
    );
    if (!isCampaignLinkHref(node.attrs?.href)) {
      own.push(
        CampaignBodyIssue.ButtonHrefInvalid({
          path: [...path, "attrs", "href"],
        })
      );
    }
  }

  return [
    ...own,
    ...(node.content ?? []).flatMap((child, index) =>
      nodeIssues(child, [...path, "content", index], imageCloudName)
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
    return [CampaignBodyIssue.NotDocument({ path: ["type"] })];
  }

  const schemaIssue = Result.try({
    try: () => campaignBodySchema.nodeFromJSON(doc).check(),
    catch: (error) =>
      CampaignBodyIssue.StructureInvalid({
        path: [],
        reason: formatError(error).message,
      }),
  });

  return Result.isFailure(schemaIssue) ? [schemaIssue.failure] : [];
};

/**
 * Checks a body against the campaign content set: its structure plus the
 * rules the schema can't express, which links, buttons and images must meet.
 * Images must come from the Cloudinary account `imageCloudName`.
 */
export const campaignBodyIssues = (
  doc: CampaignBodyNode,
  imageCloudName: Option.Option<string>
): ReadonlyArray<CampaignBodyIssue> => {
  const structureIssues = campaignBodyStructureIssues(doc);
  return structureIssues.length > 0
    ? structureIssues
    : nodeIssues(doc, [], imageCloudName);
};

const contentNodeTypes: ReadonlySet<string> = new Set([
  "image",
  "ctaButton",
  "horizontalRule",
]);

/** What the editor holds for a body nobody has written yet. */
export const emptyCampaignBody: CampaignBodyNode = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** The body has no text, image, button or rule: nothing to send. */
export const isCampaignBodyEmpty = (node: CampaignBodyNode): boolean =>
  !contentNodeTypes.has(node.type) &&
  (node.text ?? "").trim().length === 0 &&
  (node.content ?? []).every(isCampaignBodyEmpty);
