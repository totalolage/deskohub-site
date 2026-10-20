import { Check } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { NavItem } from "@/shared/components/ui/nav-item";
import { cn } from "@/shared/utils";

type CheckoutFlowLayoutProps = {
  readonly activeStepKey: CheckoutFlowStage;
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly stepLinks?: Partial<Record<CheckoutStepKey, CheckoutStepLink>>;
  /** Replaces the steps, for a page whose current step changes in place. */
  readonly steps?: ReactNode;
};

type CheckoutStepsProps = {
  readonly activeStepKey: CheckoutFlowStage;
  readonly locale: Locale;
  readonly stepLinks?: Partial<Record<CheckoutStepKey, CheckoutStepLink>>;
};

type CheckoutStepLink =
  | ({ readonly navigation?: "client" } & Pick<
      ComponentProps<typeof Link>,
      "href" | "prefetch"
    >)
  | {
      readonly href: string;
      readonly navigation: "document";
    }
  | {
      /** Changes the step in place, without navigating. */
      readonly onSelect: () => void;
    };

const checkoutFlowSteps = [
  { key: "chooseSpace", getLabel: m.checkoutOrderStepChooseSpace },
  { key: "contact", getLabel: m.checkoutOrderStepContact },
  { key: "pay", getLabel: m.checkoutOrderStepPayment },
] as const;

type CheckoutStepKey = (typeof checkoutFlowSteps)[number]["key"];

/** The current step, or `complete` once every step is done. */
type CheckoutFlowStage = CheckoutStepKey | "complete";

export function CheckoutSteps({
  activeStepKey,
  locale,
  stepLinks,
}: CheckoutStepsProps) {
  const activeStepIndex =
    activeStepKey === "complete"
      ? checkoutFlowSteps.length
      : checkoutFlowSteps.findIndex((step) => step.key === activeStepKey);

  return (
    <ol
      className="grid gap-2 sm:grid-cols-3"
      aria-label={m.checkoutOrderStepsLabel({}, { locale })}
    >
      {checkoutFlowSteps.map((step, index) => {
        const isCompleted = index < activeStepIndex;
        const isCurrentStep = step.key === activeStepKey;
        const link = isCurrentStep ? undefined : stepLinks?.[step.key];
        const content = (
          <>
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                isCompleted && "bg-aquamarine-green text-aquamarine-ink",
                isCurrentStep && "bg-burned-orange text-white",
                !isCompleted &&
                  !isCurrentStep &&
                  "border border-white/18 text-white/64"
              )}
            >
              {isCompleted ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                index + 1
              )}
            </span>
            <span className={cn("min-w-0", isCurrentStep && "text-white")}>
              {step.getLabel({}, { locale })}
            </span>
            {isCompleted && (
              <span className="sr-only">
                {m.checkoutOrderStepCompleted({}, { locale })}
              </span>
            )}
          </>
        );
        let stepContent = (
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/12 bg-white/7 px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/68 lg:gap-2 lg:px-3 lg:text-xs lg:tracking-[0.08em]">
            {content}
          </div>
        );

        if (link && "onSelect" in link) {
          stepContent = (
            <NavItem asChild layout="step" tone="translucent">
              <button className="w-full" onClick={link.onSelect} type="button">
                {content}
              </button>
            </NavItem>
          );
        } else if (link?.navigation === "document") {
          stepContent = (
            <NavItem asChild layout="step" tone="translucent">
              <a href={link.href}>{content}</a>
            </NavItem>
          );
        } else if (link) {
          stepContent = (
            <NavItem asChild layout="step" tone="translucent">
              <Link href={link.href} prefetch={link.prefetch}>
                {content}
              </Link>
            </NavItem>
          );
        }

        return (
          <li
            key={step.key}
            className="min-w-0"
            aria-current={isCurrentStep ? "step" : undefined}
          >
            {stepContent}
          </li>
        );
      })}
    </ol>
  );
}

export function CheckoutFlowLayout({
  activeStepKey,
  children,
  locale,
  stepLinks,
  steps,
}: CheckoutFlowLayoutProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-24 sm:pb-24 sm:pt-32">
        <div className="absolute left-1/2 top-16 -z-10 h-80 w-3xl -translate-x-1/2 rotate-[-9deg] rounded-full bg-burned-orange/16 blur-3xl" />
        <div className="absolute -right-28 bottom-24 -z-10 h-72 w-72 rounded-full bg-aquamarine-green/14 blur-3xl" />

        <Container className="flex flex-col gap-6">
          {steps ?? (
            <CheckoutSteps
              activeStepKey={activeStepKey}
              locale={locale}
              stepLinks={stepLinks}
            />
          )}
          {children}
        </Container>
      </section>
    </main>
  );
}
