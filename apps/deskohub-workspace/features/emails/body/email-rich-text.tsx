import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { ReactNode } from "react";
import {
  Button,
  Column,
  Heading,
  Hr,
  Img,
  Link,
  Row,
  Section,
  Text,
} from "react-email";
import type {
  CampaignBodyAttributeValue,
  CampaignBodyNode,
} from "@/features/email-campaigns/body/campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "@/features/email-campaigns/body/campaign-body-extensions";
import {
  type CampaignImageAlignment,
  campaignBodyColumnWidth,
  defaultCampaignImageAlignment,
  isCampaignImageAlignment,
  isCampaignImageWidth,
} from "@/features/email-campaigns/body/campaign-image";

const headingClassNames = {
  1: "m-0 mt-6 text-[26px] font-bold leading-[34px] text-navy sm:text-[30px] sm:leading-[38px]",
  2: "m-0 mt-6 text-[21px] font-bold leading-[28px] text-navy",
  3: "m-0 mt-5 text-[17px] font-bold leading-[24px] text-navy",
} as const;

const headingLevel = (node: ProseMirrorNode): 1 | 2 | 3 => {
  const level = node.attrs.level;
  return level === 1 || level === 2 ? level : 3;
};

const isInListItem = (parent: ProseMirrorNode | undefined): boolean =>
  parent?.type.name === "listItem";

const listClassName = "m-0 mt-4 pl-6 text-[16px] leading-[25px] text-[#373a59]";

/**
 * Outlook's Word engine aligns by the cell's `align` and ignores auto margins;
 * other clients center a block image by its margins.
 */
const imageAlignmentClassNames = {
  left: { cell: "text-left", image: "" },
  center: { cell: "text-center", image: "mx-auto" },
  right: { cell: "text-right", image: "ml-auto mr-0" },
} as const satisfies Record<
  CampaignImageAlignment,
  { readonly cell: string; readonly image: string }
>;

/** Wraps a linked image's picture in its link; an unlinked one stays bare. */
const linked = (href: string | undefined, image: ReactNode) =>
  href === undefined ? image : <Link href={href}>{image}</Link>;

/**
 * An email body image, as wide as it is up to the body column, in its own
 * cell aligned like the editor shows it. An image without a known width, such
 * as one saved before images had a width, fills the column as it always has.
 * A preview may hold values saving refuses; they render as the defaults. A
 * linked image wraps only the picture in its link, inside the cell.
 */
export const EmailBodyImage = ({
  src,
  alt,
  align,
  width,
  href,
}: {
  readonly src: string;
  readonly alt: string;
  readonly align?: CampaignBodyAttributeValue;
  readonly width?: CampaignBodyAttributeValue;
  readonly href?: string;
}) => {
  if (!isCampaignImageWidth(width)) {
    return linked(
      href,
      <Img
        alt={alt}
        className="mt-4 block h-auto w-full max-w-full rounded-2xl"
        src={src}
        width={campaignBodyColumnWidth}
      />
    );
  }
  const alignment = isCampaignImageAlignment(align)
    ? align
    : defaultCampaignImageAlignment;
  const classNames = imageAlignmentClassNames[alignment];

  return (
    // Outlook drops table margins, so the cell's padding spaces the image.
    <Row>
      <Column align={alignment} className={`pt-4 ${classNames.cell}`}>
        {linked(
          href,
          <Img
            alt={alt}
            className={`block h-auto max-w-full rounded-2xl ${classNames.image}`}
            src={src}
            width={Math.min(width, campaignBodyColumnWidth)}
          />
        )}
      </Column>
    </Row>
  );
};

/** The body's call-to-action button, centered on its own row. */
export const EmailCtaButton = ({
  href,
  label,
}: {
  readonly href: string;
  readonly label: ReactNode;
}) => (
  <Section className="mt-6 text-center">
    <Button
      className="rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
      href={href}
      style={{ backgroundColor: "#00df99", color: "#00024f" }}
    >
      {label}
    </Button>
  </Section>
);

/**
 * Renders email body rich text, a TipTap document of the campaign body
 * content set, as React Email components. Legacy campaign bodies and reusable
 * email text components both render through this one mapping.
 */
export const renderEmailRichText = (
  doc: JSONContent | CampaignBodyNode
): ReactNode =>
  renderToReactElement({
    content: campaignBodySchema.nodeFromJSON(doc),
    extensions: campaignBodyExtensions,
    options: {
      nodeMapping: {
        heading: ({ node, children }) => {
          const level = headingLevel(node);
          return (
            <Heading as={`h${level}`} className={headingClassNames[level]}>
              {children}
            </Heading>
          );
        },
        // Email clients add paragraph margins inside list items; keep list
        // items tight and give top-level paragraphs the body spacing.
        paragraph: ({ node, parent, children }) =>
          isInListItem(parent) ? (
            <Text className="m-0 text-[16px] leading-[25px] text-[#373a59]">
              {node.childCount > 0 ? children : "\u00a0"}
            </Text>
          ) : (
            <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
              {node.childCount > 0 ? children : "\u00a0"}
            </Text>
          ),
        bulletList: ({ children }) => (
          <ul className={listClassName}>{children}</ul>
        ),
        orderedList: ({ node, children }) => (
          <ol className={listClassName} start={node.attrs.start ?? 1}>
            {children}
          </ol>
        ),
        listItem: ({ children }) => <li className="mt-1">{children}</li>,
        image: ({ node }) => (
          <EmailBodyImage
            align={node.attrs.align}
            alt={node.attrs.alt ?? ""}
            src={node.attrs.src}
            width={node.attrs.width}
          />
        ),
        horizontalRule: () => (
          <Hr className="m-0 mt-6 border-[#e6ded2] border-solid" />
        ),
        ctaButton: ({ node }) => (
          <EmailCtaButton href={node.attrs.href} label={node.attrs.label} />
        ),
      },
      markMapping: {
        bold: ({ children }) => <strong>{children}</strong>,
        italic: ({ children }) => <em>{children}</em>,
        link: ({ mark, children }) => (
          <Link className="text-green underline" href={mark.attrs.href}>
            {children}
          </Link>
        ),
      },
    },
  });
