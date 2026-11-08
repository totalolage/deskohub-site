"use client";

import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useEmailDraftForm } from "./email-draft-form";
import { emailEditorProblemsId } from "./email-editor-field-ids";
import {
  type EmailEditorProblem,
  emailEditorProblems,
} from "./email-editor-problems";

type EmailEditorState = {
  /** The Workspace languages every publication needs, in tab order. */
  readonly locales: readonly Locale[];
  /** The language whose texts the editor shows. */
  readonly activeLocale: Locale;
  readonly setActiveLocale: (locale: Locale) => void;
  /** The Cloudinary account editor uploads go to, for image checks. */
  readonly imageCloudName: string | undefined;
  readonly problems: readonly EmailEditorProblem[];
  readonly problemsByField: ReadonlyMap<string, readonly string[]>;
  /** Shows the problem's language and moves focus to its field. */
  readonly focusProblem: (problem: EmailEditorProblem) => void;
};

const EmailEditorContext = createContext<EmailEditorState | undefined>(
  undefined
);

/** The editor's shared state; field components read it from here. */
export const useEmailEditor = (): EmailEditorState => {
  const state = use(EmailEditorContext);
  if (!state)
    throw new Error("Email editor fields need an EmailEditorProvider.");
  return state;
};

const focusWhenMounted = (fieldId: string): (() => void) => {
  const focus = () => {
    const element = document.getElementById(fieldId);
    if (!element) return false;
    element.scrollIntoView?.({ block: "center" });
    element.focus();
    return true;
  };
  if (focus()) return () => {};
  // A field in another language or a rich text editor mounts a little later.
  const observer = new MutationObserver(() => {
    if (focus()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setTimeout(() => observer.disconnect(), 2000);
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
};

/**
 * Provides the active language and the draft's live problems to the editor's
 * fields. Must sit inside the host's draft form.
 */
export function EmailEditorProvider({
  children,
  imageCloudName,
  locales,
  publishedImageSources,
}: {
  readonly children: ReactNode;
  readonly imageCloudName?: string;
  readonly locales: readonly Locale[];
  readonly publishedImageSources?: readonly string[];
}) {
  const locale = useRouteLocale();
  const { control, getValues } = useEmailDraftForm();
  // Subscribes to every change; `getValues` then reads the whole typed draft.
  useWatch({ control });
  const draft = getValues();
  const [activeLocale, setActiveLocale] = useState<Locale>(
    () => locales[0] ?? locale
  );
  // A new object per request, so asking for the same field again refocuses it.
  const [focusRequest, setFocusRequest] = useState<{
    readonly fieldId: string;
  }>();
  const publishedSources = useMemo(
    () => new Set(publishedImageSources),
    [publishedImageSources]
  );
  const problems = emailEditorProblems({
    draft,
    currentLocales: locales,
    locale,
    imageCloudName,
    publishedImageSources: publishedSources,
  });
  const problemsByField = new Map<string, string[]>();
  for (const problem of problems) {
    if (!problem.fieldId) continue;
    const messages = problemsByField.get(problem.fieldId) ?? [];
    if (!messages.includes(problem.message)) messages.push(problem.message);
    problemsByField.set(problem.fieldId, messages);
  }

  useEffect(
    () => focusRequest && focusWhenMounted(focusRequest.fieldId),
    [focusRequest]
  );

  const state: EmailEditorState = {
    locales,
    activeLocale,
    setActiveLocale,
    imageCloudName,
    problems,
    problemsByField,
    focusProblem: (problem) => {
      if (problem.locale && locales.includes(problem.locale as Locale))
        setActiveLocale(problem.locale as Locale);
      if (problem.fieldId) setFocusRequest({ fieldId: problem.fieldId });
    },
  };
  return <EmailEditorContext value={state}>{children}</EmailEditorContext>;
}

/**
 * The problems of one field and the attributes that tie them to its control:
 * spread `invalid` as `aria-invalid` and `describedBy` as
 * `aria-describedby`, and render `EmailFieldProblems` with the same id.
 */
export const useEmailFieldProblems = (fieldId: string) => {
  const { problemsByField } = useEmailEditor();
  const messages = problemsByField.get(fieldId) ?? [];
  const invalid = messages.length > 0;
  return {
    invalid,
    messages,
    describedBy: invalid ? emailEditorProblemsId(fieldId) : undefined,
    /** Spread on the field's control. */
    controlProps: {
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? emailEditorProblemsId(fieldId) : undefined,
    },
  } as const;
};

/** The localized problems of one field, which its control describes itself by. */
export function EmailFieldProblems({ fieldId }: { readonly fieldId: string }) {
  const { messages } = useEmailFieldProblems(fieldId);
  return (
    messages.length > 0 && (
      <ul
        className="mt-1 space-y-0.5 text-burned-orange-ink text-sm"
        id={emailEditorProblemsId(fieldId)}
      >
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    )
  );
}
