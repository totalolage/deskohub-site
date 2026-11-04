"use client";

import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useEmailEditor } from "./email-editor-context";

/**
 * Everything that keeps the draft from publication. Each item shows its
 * field's language and moves focus there; saving the draft never waits on
 * these.
 */
export function EmailProblemSummary() {
  const locale = useRouteLocale();
  const { problems, focusProblem } = useEmailEditor();
  return (
    <section
      aria-labelledby="email-editor-problems-heading"
      className="rounded-xl border border-navy-blue/10 bg-white p-5"
    >
      <h2
        className="mb-2 font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]"
        id="email-editor-problems-heading"
      >
        {m.emailsEditorProblemsHeading({}, { locale })}
      </h2>
      <p className="font-medium text-navy-blue text-sm" role="status">
        {problems.length > 0
          ? m.emailsEditorProblemsCount({ count: problems.length }, { locale })
          : m.emailsEditorProblemsNone({}, { locale })}
      </p>
      <p className="mt-1 text-navy-blue/60 text-xs">
        {m.emailsEditorProblemsDraftNote({}, { locale })}
      </p>
      {problems.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {problems.map((problem, index) => (
            <li
              // Problems have no identity of their own; their order is stable.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={index}
            >
              <button
                className="w-full rounded px-2 py-1 text-left text-burned-orange-ink text-sm underline-offset-2 hover:bg-burned-orange/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange disabled:no-underline"
                disabled={!problem.fieldId}
                onClick={() => focusProblem(problem)}
                type="button"
              >
                {m.emailsEditorProblemSummaryItem(
                  { place: problem.place, message: problem.message },
                  { locale }
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
