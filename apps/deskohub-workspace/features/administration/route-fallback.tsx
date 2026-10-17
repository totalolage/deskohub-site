import type { ReactNode } from "react";

/** The administration frame's content for a missing or failed page. */
export function AdministrationRouteFallback({
  action,
  description,
  eyebrow,
  title,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly eyebrow?: string;
  readonly title: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[92rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9"
    >
      {eyebrow && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-burned-orange-ink">
          {eyebrow}
        </p>
      )}
      <h1 className="text-3xl leading-tight tracking-[-0.025em] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-navy-blue/62">
        {description}
      </p>
      <div className="mt-6">{action}</div>
    </main>
  );
}
