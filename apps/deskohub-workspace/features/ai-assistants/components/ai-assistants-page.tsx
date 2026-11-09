import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { DocumentPage } from "@/shared/components/document-page";
import {
  type AiAssistantsGuide,
  type AiAssistantsGuideBlock,
  getAiAssistantsGuide,
} from "../ai-assistants-guide";

type GuideTextProps = {
  text: string;
  links: AiAssistantsGuide["links"];
};

function GuideText({ text, links }: GuideTextProps) {
  const className =
    "font-medium text-navy-blue underline decoration-burned-orange/60 underline-offset-4 transition-colors hover:text-burned-orange";

  return (
    <Interpolate
      string={text}
      mapping={Object.fromEntries(
        Object.entries(links).map(([name, href]) => [
          name,
          (content: ReactNode) =>
            href.startsWith("mailto:") ? (
              <a href={href} className={className}>
                {content}
              </a>
            ) : (
              <Link href={href} prefetch={false} className={className}>
                {content}
              </Link>
            ),
        ])
      )}
    />
  );
}

type GuideBlockProps = {
  block: AiAssistantsGuideBlock;
  links: AiAssistantsGuide["links"];
};

function GuideBlock({ block, links }: GuideBlockProps) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p>
          <GuideText text={block.text} links={links} />
        </p>
      );
    case "steps":
      return (
        <ol className="list-decimal space-y-2 pl-6 marker:font-semibold marker:text-burned-orange">
          {block.items.map((item) => (
            <li key={item} className="pl-1">
              <GuideText text={item} links={links} />
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="list-disc space-y-2 pl-6 marker:text-burned-orange">
          {block.items.map((item) => (
            <li key={item} className="pl-1">
              <GuideText text={item} links={links} />
            </li>
          ))}
        </ul>
      );
    case "url":
      return (
        <p>
          <code className="inline-block max-w-full select-all break-all rounded-xl border border-navy-blue/10 bg-navy-blue/4 px-4 py-3 font-mono text-sm text-navy-blue sm:text-base">
            {block.url}
          </code>
        </p>
      );
  }
}

type AiAssistantsPageProps = {
  locale: Locale;
};

/** How to use Deskohub Workspace from ChatGPT, Claude, and MCP clients. */
export function AiAssistantsPage({ locale }: AiAssistantsPageProps) {
  const guide = getAiAssistantsGuide(locale);

  return (
    <DocumentPage
      eyebrow={m.aiAssistantsPageEyebrow({}, { locale })}
      title={guide.title}
      lead={guide.lead}
    >
      {guide.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="scroll-mt-[calc(var(--site-header-height)+1.5rem)] space-y-3"
        >
          <h2 id={`${section.id}-heading`} className="text-2xl leading-tight">
            {section.heading}
          </h2>
          <div className="space-y-3 text-base leading-7 text-navy-blue/78">
            {section.blocks.map((block, index) => (
              <GuideBlock
                // biome-ignore lint/suspicious/noArrayIndexKey: A section's blocks are authored in a fixed order.
                key={`${section.id}-${index}`}
                block={block}
                links={guide.links}
              />
            ))}
          </div>
        </section>
      ))}
    </DocumentPage>
  );
}
