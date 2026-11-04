"use client";

// CONTRACT STUB: the inline-text clone replaces this implementation with a
// TipTap editor; the props below are the stable contract.

import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
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

/** One translated text, edited inline. */
export function EmailInlineTextField({
  contentLocale,
  fieldId,
  hideLabel,
  label,
  target,
}: EmailInlineTextFieldProps) {
  const [parts, setParts] = useEmailTranslatedText(contentLocale, target);
  const { controlProps } = useEmailFieldProblems(fieldId);
  const text = (parts ?? [])
    .map((part) =>
      part._tag === "Text" ? (part.text ?? "") : `{${part.name ?? ""}}`
    )
    .join("");
  return (
    <div>
      <label className={hideLabel ? "sr-only" : undefined} htmlFor={fieldId}>
        {label}
      </label>
      <input
        {...controlProps}
        id={fieldId}
        lang={contentLocale}
        onChange={(event) =>
          setParts([{ _tag: "Text", text: event.target.value }])
        }
        value={text}
      />
      <EmailFieldProblems fieldId={fieldId} />
    </div>
  );
}
