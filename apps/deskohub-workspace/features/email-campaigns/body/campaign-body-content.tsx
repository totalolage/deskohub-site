import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
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
import type { CampaignBodyDocument } from "./campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "./campaign-body-extensions";
import {
  type CampaignImageAlignment,
  campaignBodyColumnWidth,
  defaultCampaignImageAlignment,
  isCampaignImageAlignment,
  isCampaignImageWidth,
} from "./campaign-image";

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

/**
 * An image as wide as it is, up to the body column, in its own cell aligned
 * like the editor shows it. An image without a known width, such as one saved
 * before images had a width, fills the column as it always has. A preview may
 * hold values saving refuses; they render as the defaults.
 */
const CampaignBodyImage = ({ node }: { readonly node: ProseMirrorNode }) => {
  if (!isCampaignImageWidth(node.attrs.width)) {
    return (
      <Img
        alt={node.attrs.alt ?? ""}
        className="mt-4 block h-auto w-full max-w-full rounded-2xl"
        src={node.attrs.src}
        width={campaignBodyColumnWidth}
      />
    );
  }
  const align = isCampaignImageAlignment(node.attrs.align)
    ? node.attrs.align
    : defaultCampaignImageAlignment;
  const classNames = imageAlignmentClassNames[align];

  return (
    // Outlook drops table margins, so the cell's padding spaces the image.
    <Row>
      <Column align={align} className={`pt-4 ${classNames.cell}`}>
        <Img
          alt={node.attrs.alt ?? ""}
          className={`block h-auto max-w-full rounded-2xl ${classNames.image}`}
          src={node.attrs.src}
          width={Math.min(node.attrs.width, campaignBodyColumnWidth)}
        />
      </Column>
    </Row>
  );
};

/** Renders a campaign body as React Email components. */
export function CampaignBodyContent({
  body,
}: {
  readonly body: CampaignBodyDocument;
}) {
  return renderToReactElement({
    content: campaignBodySchema.nodeFromJSON(body.doc),
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
              {node.childCount > 0 ? children : " "}
            </Text>
          ) : (
            <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
              {node.childCount > 0 ? children : " "}
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
        image: ({ node }) => <CampaignBodyImage node={node} />,
        horizontalRule: () => (
          <Hr className="m-0 mt-6 border-[#e6ded2] border-solid" />
        ),
        ctaButton: ({ node }) => (
          <Section className="mt-6 text-center">
            <Button
              className="rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
              href={node.attrs.href}
              style={{ backgroundColor: "#00df99", color: "#00024f" }}
            >
              {node.attrs.label}
            </Button>
          </Section>
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
}
