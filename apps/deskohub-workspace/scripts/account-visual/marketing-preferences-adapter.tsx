import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { MarketingPreferencesForm } from "@/features/legal/components/marketing-preferences-form";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { useNavigationState } from "./stubs/next-navigation";
import type { AccountVisualAdapterProps } from "./types";

type MarketingPreferencesScenario =
  | "pending-link"
  | "account-absent"
  | "account-active"
  | "account-withdrawn"
  | "link-absent"
  | "link-active"
  | "link-withdrawn"
  | "unavailable"
  | "invalid-link";

const defaultScenario: MarketingPreferencesScenario = "pending-link";

const scenarios = new Set<MarketingPreferencesScenario>([
  "pending-link",
  "account-absent",
  "account-active",
  "account-withdrawn",
  "link-absent",
  "link-active",
  "link-withdrawn",
  "unavailable",
  "invalid-link",
]);

const readScenario = (): MarketingPreferencesScenario => {
  if (globalThis.window === undefined) return defaultScenario;
  const value = new URLSearchParams(window.location.search).get("case");
  return value !== null && scenarios.has(value as MarketingPreferencesScenario)
    ? (value as MarketingPreferencesScenario)
    : defaultScenario;
};

const readContext = (scenario: MarketingPreferencesScenario) => {
  if (globalThis.window === undefined) return `synthetic-${scenario}-context-a`;
  const suffix =
    new URLSearchParams(window.location.search).get("context") === "b"
      ? "b"
      : "a";
  return `synthetic-${scenario}-context-${suffix}`;
};

const readDismissalContext = (scenario: MarketingPreferencesScenario) => {
  if (globalThis.window === undefined) {
    return `synthetic-${scenario}-dismissal-context-a`;
  }
  const suffix =
    new URLSearchParams(window.location.search).get("context") === "b"
      ? "b"
      : "a";
  return `synthetic-${scenario}-dismissal-context-${suffix}`;
};

const readAccountsEnabled = () => {
  if (globalThis.window === undefined) return true;
  return (
    new URLSearchParams(window.location.search).get("accountsEnabled") !==
    "false"
  );
};

const stateForScenario = (
  scenario: MarketingPreferencesScenario,
  context: string,
  dismissalContext: string
): MarketingPreferencesState => {
  if (scenario === "pending-link") {
    return { context, dismissalContext, status: "pending-link" };
  }
  if (scenario === "unavailable" || scenario === "invalid-link") {
    return scenario === "invalid-link"
      ? { dismissalContext, status: "invalid-link" }
      : { status: "unavailable" };
  }

  const [source, status] = scenario.split("-") as [
    "account" | "link",
    "absent" | "active" | "withdrawn",
  ];
  return source === "link"
    ? { context, dismissalContext, source, status }
    : { context, source, status };
};

const isContextReplaceable = (
  state: MarketingPreferencesState
): state is Extract<MarketingPreferencesState, { readonly context: string }> =>
  "context" in state;

export const accountVisualAdapterMetadata = {
  owner: "marketing preferences controlled browser adapter",
  fixture:
    "synthetic marketing-preferences states with local controlled actions; component-only evidence",
} as const;

export function MarketingPreferencesAdapter({
  locale,
}: AccountVisualAdapterProps) {
  useNavigationState();
  const router = useRouter();
  const scenario = readScenario();
  const context = readContext(scenario);
  const dismissalContext = readDismissalContext(scenario);
  const accountsEnabled = readAccountsEnabled();
  const state = useMemo(
    () => stateForScenario(scenario, context, dismissalContext),
    [context, dismissalContext, scenario]
  );

  const replaceContext = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("context", params.get("context") === "b" ? "a" : "b");
    router.replace(`${window.location.pathname}?${params.toString()}`);
  };

  return (
    <main
      className="min-h-screen min-w-0 bg-[#f8f6f1] p-4 sm:p-8"
      data-marketing-preferences-fixture
    >
      <header className="mx-auto flex min-w-0 max-w-3xl items-center">
        <h1 className="min-w-0 break-words text-2xl font-semibold leading-8 text-[#00024f]">
          Marketing preferences
        </h1>
      </header>
      <div className="mx-auto min-w-0 max-w-3xl">
        <MarketingPreferencesForm
          accountsEnabled={accountsEnabled}
          locale={locale}
          state={state}
        />
        {isContextReplaceable(state) && (
          <button
            className="mt-6 h-auto max-w-full whitespace-normal rounded-full border border-navy-blue/20 bg-white px-4 py-2 text-left text-sm font-semibold leading-5 text-navy-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
            data-marketing-preferences-replace-context
            onClick={replaceContext}
            type="button"
          >
            Replace synthetic context
          </button>
        )}
      </div>
    </main>
  );
}

export default MarketingPreferencesAdapter;
