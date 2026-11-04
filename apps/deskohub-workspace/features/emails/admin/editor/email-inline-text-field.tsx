"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useId, useMemo } from "react";
import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { cn } from "@/shared/utils";
import type {
  EmailDraftInlineParts,
  EmailDraftTranslation,
} from "./email-draft-form";
import { useEmailDraftForm } from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import {
  emailInlinePartsEqual,
  emailInlinePartsToTipTap,
  normalizeEmailInlineParts,
  singleLineEmailInlineText,
  tipTapToEmailInlineParts,
  unformattedEmailInlineParts,
} from "./email-inline-parts";
import {
  emailInlineTextExtensions,
  replaceEmailInlineContent,
  setEmailInlineValueNames,
} from "./email-inline-text-extensions";
import { EmailInlineTextToolbar } from "./email-inline-text-toolbar";
import {
  type EmailTranslatedTextTarget,
  useEmailTranslatedText,
} from "./email-translated-text";

export type EmailInlineTextFieldProps = {
  /** The DOM id of the editable control, from `emailEditorFieldIds`. */
  readonly fieldId: string;
  /** The visible label, in the administrator's language. */
  readonly label: string;
  /** Hides the label visually; it still names the control. */
  readonly hideLabel?: boolean;
  /** The language of the text, a Workspace locale; sets `lang`. */
  readonly contentLocale: string;
  /** Which translated text of `contentLocale` the field edits. */
  readonly target: EmailTranslatedTextTarget;
  /**
   * `rich` texts take bold, italic, links and values; `plain` texts only
   * values.
   */
  readonly mode: "rich" | "plain";
  /** Rich texts: the owning block's shared destinations, by link key. */
  readonly links?: Readonly<Record<string, string>>;
};

const noLinks: Readonly<Record<string, string>> = {};

/**
 * The text as its editor shows it: on one line, and without formatting in a
 * plain text. The form keeps a stored line break or formatting until the
 * text is edited; a plain text's formatting is a problem the author sees.
 */
const editorParts = (
  parts: EmailDraftInlineParts,
  mode: "rich" | "plain"
): EmailDraftInlineParts => {
  const oneLine = parts.map((part) =>
    part._tag === "Text" && part.text
      ? { ...part, text: singleLineEmailInlineText(part.text) }
      : part
  );
  return mode === "rich"
    ? normalizeEmailInlineParts(oneLine)
    : unformattedEmailInlineParts(oneLine);
};

/** The translated text `target` names in one language's entry. */
const targetParts = (
  translation: EmailDraftTranslation | undefined,
  target: EmailTranslatedTextTarget
): EmailDraftInlineParts | undefined =>
  target.kind === "text"
    ? translation?.texts?.[target.textKey]
    : translation?.[target.kind];

/** The editable element's attributes; PM writes every given value. */
const editorAttributes = ({
  contentLocale,
  describedBy,
  fieldId,
  invalid,
  labelId,
}: {
  readonly contentLocale: string;
  readonly describedBy: string | undefined;
  readonly fieldId: string;
  readonly invalid: boolean;
  readonly labelId: string;
}): Record<string, string> => ({
  id: fieldId,
  lang: contentLocale,
  role: "textbox",
  "aria-labelledby": labelId,
  "aria-multiline": "false",
  ...(invalid && { "aria-invalid": "true" }),
  ...(describedBy && { "aria-describedby": describedBy }),
  class:
    "min-h-8 px-2 py-1 text-navy-blue text-sm leading-6 focus:outline-none [&_p]:m-0",
});

/**
 * One translated text, edited inline: a single line of text and value
 * references, with bold, italic and the block's links in rich texts. The
 * editor follows the form value, so a host `reset()` or another control's
 * change shows at once.
 */
export function EmailInlineTextField({
  contentLocale,
  fieldId,
  hideLabel,
  label,
  links = noLinks,
  mode,
  target,
}: EmailInlineTextFieldProps) {
  const locale = useRouteLocale();
  const labelId = useId();
  const { control, getValues } = useEmailDraftForm();
  const [parts, setParts] = useEmailTranslatedText(contentLocale, target);
  const definitions = useWatch({ control, name: "values" }) ?? [];
  const { invalid, describedBy } = useEmailFieldProblems(fieldId);
  const missingValueLabel = m.emailsEditorInlineValueMissing({}, { locale });
  const extensions = useMemo(
    () => emailInlineTextExtensions({ mode, missingValueLabel }),
    [mode, missingValueLabel]
  );
  const shown = editorParts(parts ?? [], mode);
  const editor = useEditor(
    {
      extensions,
      content: emailInlinePartsToTipTap(shown),
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: editorAttributes({
          contentLocale,
          describedBy,
          fieldId,
          invalid,
          labelId,
        }),
      },
    },
    // A mode change needs a new schema; everything else updates in place.
    [extensions]
  );

  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: editorAttributes({
          contentLocale,
          describedBy,
          fieldId,
          invalid,
          labelId,
        }),
      },
    });
  }, [editor, contentLocale, describedBy, fieldId, invalid, labelId]);

  useEffect(() => {
    if (!editor) return;
    const write = () => {
      // ProseMirror builds attributes as null-prototype objects, which a
      // Server Action can't receive; a structured clone makes them plain.
      const next = structuredClone(tipTapToEmailInlineParts(editor.getJSON()));
      setParts(next);
    };
    editor.on("update", write);
    return () => {
      editor.off("update", write);
    };
  }, [editor, setParts]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editorParts(
      targetParts(getValues(`translations.${contentLocale}`), target) ?? [],
      mode
    );
    // The form changed again since this render, maybe by the editor's own
    // typing; the render that change brings syncs with it.
    if (!emailInlinePartsEqual(current, shown)) return;
    if (
      emailInlinePartsEqual(tipTapToEmailInlineParts(editor.getJSON()), current)
    )
      return;
    // A change from outside replaces the text and its undo history, and
    // writes nothing back.
    replaceEmailInlineContent(editor, emailInlinePartsToTipTap(current));
  }, [editor, shown, getValues, contentLocale, target, mode]);

  const definedNames = JSON.stringify(
    definitions.flatMap((definition) =>
      definition.name ? [definition.name] : []
    )
  );
  useEffect(() => {
    if (editor)
      setEmailInlineValueNames(
        editor,
        new Set(JSON.parse(definedNames) as string[])
      );
  }, [editor, definedNames]);

  return (
    <div>
      <div
        className={cn(
          "mb-1 font-medium text-navy-blue text-sm",
          hideLabel && "sr-only"
        )}
        id={labelId}
      >
        {label}
      </div>
      <div
        className={cn(
          "flex items-start gap-1 rounded-md border bg-white pr-1 focus-within:ring-2 focus-within:ring-burned-orange/40",
          invalid ? "border-burned-orange" : "border-navy-blue/20"
        )}
      >
        <EditorContent className="min-h-8 min-w-0 flex-1" editor={editor} />
        <EmailInlineTextToolbar
          definitions={definitions}
          editor={editor}
          links={links}
          mode={mode}
        />
      </div>
      <EmailFieldProblems fieldId={fieldId} />
    </div>
  );
}
