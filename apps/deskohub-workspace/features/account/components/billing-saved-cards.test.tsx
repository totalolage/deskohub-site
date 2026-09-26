import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { type ComponentPropsWithoutRef, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  SavedCardFlowFeedback,
  SavedCardsPageState,
  SavedCardView,
} from "../contracts";
import type { BillingScreenCopy } from "./billing/billing-screen";

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly prefetch?: boolean | "auto" | null;
};

function MockNextLink({ children, href, ...props }: MockNextLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const routerRefresh = mock(() => undefined);
mock.module("next/navigation", () => ({
  usePathname: () => "/en-US/account",
  useRouter: () => ({ refresh: routerRefresh }),
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));

type SavedCardActionResult = {
  readonly data?:
    | { readonly status: "redirect"; readonly hostedPage: string }
    | { readonly status: "removed" }
    | { readonly status: "retry" };
  readonly serverError?: string;
};

const startSavedCardEnrollment = mock(
  (): Promise<SavedCardActionResult> => Promise.resolve({})
);
const removeSavedCard = mock(
  (_input: { readonly contractId: string }): Promise<SavedCardActionResult> =>
    Promise.resolve({})
);

mock.module("@/features/account/saved-card-actions", () => ({
  removeSavedCard,
  startSavedCardEnrollment,
}));

const windowAssign = mock((_url: string) => undefined);

beforeAll(() => {
  (window.location as { assign: (url: string) => void }).assign = windowAssign;
});

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<SavedCardActionResult>,
    options?: {
      readonly onSuccess?: (args: {
        readonly data?: SavedCardActionResult["data"];
      }) => void;
      readonly onError?: () => void;
    }
  ) => {
    const [isExecuting, setIsExecuting] = useState(false);
    const [hasError, setHasError] = useState(false);

    const execute = (input: never) => {
      setIsExecuting(true);
      void action(input)
        .then((nextResult) => {
          setIsExecuting(false);
          if (nextResult.serverError) {
            setHasError(true);
            options?.onError?.();
            return;
          }
          options?.onSuccess?.({ data: nextResult.data });
        })
        .catch(() => {
          setIsExecuting(false);
          options?.onError?.();
        });
    };

    return {
      execute,
      isExecuting,
      result: hasError ? { serverError: "x" } : {},
    };
  },
}));

const billingCopy = (locale: Locale): BillingScreenCopy => ({
  addPaymentCard: m.accountBillingAddPaymentCard({}, { locale }),
  billingDetailsTitle: m.accountBillingDetailsTitle({}, { locale }),
  currency: m.accountBillingCurrency({}, { locale }),
  downloadInvoice: m.accountBillingDownloadInvoice({}, { locale }),
  exportInvoices: m.accountBillingExportInvoices({}, { locale }),
  invoiceHistoryTitle: m.accountBillingInvoiceHistoryTitle({}, { locale }),
  invoiceHistoryUnavailable: m.accountBillingInvoiceHistoryUnavailable(
    {},
    { locale }
  ),
  paymentMethodsTitle: m.accountBillingPaymentMethodsTitle({}, { locale }),
  paymentMethodsUnavailable: m.accountBillingPaymentMethodsUnavailable(
    {},
    { locale }
  ),
  removePaymentCard: m.accountBillingRemovePaymentCard({}, { locale }),
  syncAres: m.accountBillingSyncAres({}, { locale }),
  title: m.accountSectionBilling({}, { locale }),
});

registerWorkspaceComponentTestEnv();

const { BillingScreen } = await import("./billing/billing-screen");

const card = (overrides: Partial<SavedCardView>): SavedCardView => ({
  contractId: "card-contract-1",
  ...overrides,
});

function renderBilling(options?: {
  readonly cardFlow?: SavedCardFlowFeedback;
  readonly cards?: SavedCardsPageState;
  readonly locale?: Locale;
}) {
  const locale = options?.locale ?? "en-US";
  return render(
    <BillingScreen
      cardFlow={options?.cardFlow}
      cards={options?.cards ?? { kind: "loaded", cards: [] }}
      copy={billingCopy(locale)}
      locale={locale}
    >
      <div>Caller-owned billing fields</div>
    </BillingScreen>
  );
}

afterEach(() => {
  cleanup();
  removeSavedCard.mockClear();
  routerRefresh.mockClear();
  startSavedCardEnrollment.mockClear();
  windowAssign.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

describe("billing saved cards", () => {
  test("renders a card row with the real catalog sentence for circuit and suffix", () => {
    const view = renderBilling({
      cards: {
        kind: "loaded",
        cards: [card({ circuit: "Visa", suffix: "6152" })],
      },
    });
    expect(
      view.getByText(
        m.accountSavedCardDisplayWithSuffix(
          { circuit: "Visa", suffix: "6152" },
          { locale: "en-US" }
        )
      )
    ).toBeTruthy();
  });

  test("renders the Czech suffix-less sentence when the suffix is missing", () => {
    const view = renderBilling({
      cards: { kind: "loaded", cards: [card({ circuit: "Visa" })] },
      locale: "cs-CZ",
    });
    expect(
      view.getByText(
        m.accountSavedCardDisplayWithoutSuffix({}, { locale: "cs-CZ" })
      )
    ).toBeTruthy();
  });

  test("renders the quiet empty state when loaded and empty", () => {
    const view = renderBilling({ cards: { kind: "loaded", cards: [] } });
    expect(
      view.getByText(m.accountSavedCardListEmpty({}, { locale: "en-US" }))
    ).toBeTruthy();
  });

  test("renders the unavailable state without fake cards and keeps Add functional", () => {
    const view = renderBilling({ cards: { kind: "unavailable" } });
    expect(
      view.getByText(m.accountSavedCardListUnavailable({}, { locale: "en-US" }))
    ).toBeTruthy();
    const addButton = view.getByRole("button", {
      name: billingCopy("en-US").addPaymentCard,
    });
    expect((addButton as HTMLButtonElement).disabled).toBe(false);
  });

  test("add button is a real enabled button with no future-feature wrapper", () => {
    const view = renderBilling();
    const addButton = view.getByRole("button", {
      name: billingCopy("en-US").addPaymentCard,
    });
    expect(addButton.tagName).toBe("BUTTON");
    expect((addButton as HTMLButtonElement).disabled).toBe(false);
    expect(addButton.getAttribute("type")).toBe("button");
    expect(addButton.closest("[tabindex='0']")).toBeNull();
  });

  test("add invokes the action and navigates on the redirect result", async () => {
    startSavedCardEnrollment.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: "redirect", hostedPage: "https://hosted.example.test" },
      })
    );
    const view = renderBilling();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: billingCopy("en-US").addPaymentCard })
      );
      await Promise.resolve();
    });
    expect(startSavedCardEnrollment).toHaveBeenCalledTimes(1);
    expect(windowAssign).toHaveBeenCalledWith("https://hosted.example.test");
  });

  test("add surfaces generic feedback on an unexpected result", async () => {
    startSavedCardEnrollment.mockImplementationOnce(() =>
      Promise.resolve({ serverError: "unavailable" })
    );
    const view = renderBilling();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: billingCopy("en-US").addPaymentCard })
      );
      await Promise.resolve();
    });
    expect(
      view.getByText(m.accountSavedCardGenericError({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain(
      m.accountSavedCardGenericError({}, { locale: "en-US" })
    );
  });

  test("remove is confirmation-gated and refreshes on removal success", async () => {
    removeSavedCard.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "removed" } })
    );
    const view = renderBilling({
      cards: {
        kind: "loaded",
        cards: [card({ circuit: "Visa", suffix: "6152" })],
      },
    });
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: billingCopy("en-US").removePaymentCard,
        })
      );
    });
    expect(removeSavedCard).not.toHaveBeenCalled();

    const confirm = view.baseElement.querySelector(
      "#remove-saved-card-confirm"
    );
    if (!confirm) throw new Error("Remove confirmation button missing");
    await act(async () => {
      confirm.focus();
      fireEvent.keyDown(confirm, { key: "Enter" });
      fireEvent.click(confirm);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        view.getByText(m.accountSavedCardRemoved({}, { locale: "en-US" }))
      ).toBeTruthy()
    );
    expect(removeSavedCard).toHaveBeenCalledWith({
      contractId: "card-contract-1",
    });
    expect(routerRefresh).toHaveBeenCalled();
  });

  test("surfaces retryable feedback on a retry result", async () => {
    removeSavedCard.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "retry" } })
    );
    const view = renderBilling({
      cards: { kind: "loaded", cards: [card({ suffix: "6152" })] },
    });
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: billingCopy("en-US").removePaymentCard,
        })
      );
    });
    const confirm = view.baseElement.querySelector(
      "#remove-saved-card-confirm"
    );
    if (!confirm) throw new Error("Remove confirmation button missing");
    await act(async () => {
      fireEvent.click(confirm);
      await Promise.resolve();
    });
    expect(
      view.getByText(m.accountSavedCardRemovalRetry({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test.each([
    [
      "confirmed",
      () => m.accountSavedCardFlowConfirmed({}, { locale: "en-US" }),
    ],
    [
      "cancelled",
      () => m.accountSavedCardFlowCancelled({}, { locale: "en-US" }),
    ],
    ["failed", () => m.accountSavedCardFlowFailed({}, { locale: "en-US" })],
    ["pending", () => m.accountSavedCardFlowPending({}, { locale: "en-US" })],
    ["session", () => m.accountSessionExpired({}, { locale: "en-US" })],
  ] as const)("announces the %s cardFlow feedback", (flow, message) => {
    const view = renderBilling({ cardFlow: flow });
    expect(view.getByRole("status").textContent).toContain(message());
  });

  test("announces nothing when there is no feedback state", () => {
    const view = renderBilling();
    expect(view.getByRole("status").textContent).toBe("");
  });

  test("dismissible flow feedback clears on dismiss", async () => {
    const view = renderBilling({ cardFlow: "confirmed" });
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSavedCardFeedbackDismiss({}, { locale: "en-US" }),
        })
      );
    });
    expect(view.getByRole("status").textContent).toBe("");
  });

  test("unknown cardFlow values are never announced by the component contract", () => {
    expect(
      renderBilling({ cardFlow: undefined }).getByRole("status").textContent
    ).toBe("");
  });
});
