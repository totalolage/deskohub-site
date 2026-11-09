"use client";

import { Placeholder, UndoRedo } from "@tiptap/extensions";
import {
  EditorContent,
  type JSONContent,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import { useMemo } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { cn } from "@/shared/utils";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import { campaignBodyExtensions } from "../../body/campaign-body-extensions";
import { CampaignCtaButton } from "../../body/campaign-cta-button";
import { campaignBodyColumnWidth } from "../../body/campaign-image";
import { CampaignBodyToolbar } from "./campaign-body-toolbar";
import { CtaButtonNodeView } from "./cta-button-node-view";

/**
 * The shared content set plus editing-only behavior: history, hints, views.
 * `locale` is the admin's language for the empty-body hint.
 */
const campaignBodyEditorExtensions = (locale: Locale) => [
  ...campaignBodyExtensions.filter(
    (extension) => extension.name !== CampaignCtaButton.name
  ),
  CampaignCtaButton.extend({
    addNodeView: () => ReactNodeViewRenderer(CtaButtonNodeView),
  }),
  UndoRedo,
  Placeholder.configure({
    placeholder: m.emailCampaignsEditorPlaceholder({}, { locale }),
  }),
];

/** Rich-text editor for one locale's campaign body. */
export function CampaignBodyEditor({
  contentLocale,
  id,
  invalid,
  label,
  onChange,
  value,
}: {
  /** The language of the body being written. */
  readonly contentLocale: Locale;
  readonly id?: string;
  readonly invalid?: boolean;
  readonly label: string;
  readonly onChange: (doc: CampaignBodyNode) => void;
  /** The initial document; later changes come from the editor itself. */
  readonly value: CampaignBodyNode;
}) {
  const locale = useRouteLocale();
  const extensions = useMemo(
    () => campaignBodyEditorExtensions(locale),
    [locale]
  );
  const editor = useEditor({
    extensions,
    content: value as JSONContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        lang: contentLocale,
        style: `--campaign-image-max-width:${campaignBodyColumnWidth}px`,
        ...(id && { id }),
        ...(invalid && { "aria-invalid": "true" }),
        class: cn(
          "min-h-80 px-4 py-3 text-[15px] leading-7 text-navy-blue focus:outline-none",
          "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-2xl [&_h1]:leading-tight",
          "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-xl [&_h2]:leading-snug",
          "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-lg",
          "[&_p]:my-2 [&_a]:text-burned-orange-ink [&_a]:underline",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-0.5",
          "[&_hr]:my-5 [&_hr]:border-navy-blue/20",
          "[&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-w-[min(100%,var(--campaign-image-max-width))] [&_img:not([width])]:w-[var(--campaign-image-max-width)] [&_img]:rounded-md [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-navy-blue",
          "[&_img[data-align=center]]:mx-auto [&_img[data-align=right]]:ml-auto",
          "[&_hr.ProseMirror-selectednode]:border-navy-blue",
          "[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-navy-blue/40 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]"
        ),
      },
    },
    // ProseMirror builds node attributes as null-prototype objects, which a
    // Server Action can't receive: React passes them as opaque references.
    // A structured clone gives the form plain objects.
    onUpdate: ({ editor }) =>
      onChange(structuredClone(editor.getJSON()) as CampaignBodyNode),
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-white focus-within:ring-2 focus-within:ring-burned-orange/40",
        invalid ? "border-burned-orange" : "border-navy-blue/20"
      )}
    >
      <CampaignBodyToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
