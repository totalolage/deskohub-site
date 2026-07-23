import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { m } from "@/features/i18n";
import {
  workspaceRouterPush as routerPush,
  workspaceRouterReplace as routerReplace,
  workspaceUseFeatureFlagEnabled as useFeatureFlagEnabled,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const execute = mock();
let actionCallCount = 0;
let pendingActionCall: number | undefined;
let actionOptions: {
  onSuccess?: (input: {
    data?: { status: string; freshPayUrl?: string };
  }) => void;
  onError?: () => void;
  onTransportError?: () => void;
};

mock.module("@/features/checkout/actions/apply-discount-code", () => ({
  applyDiscountCode: mock(),
}));
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation: mock(),
}));

describe("CheckoutDiscountCodeForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    routerReplace.mockReset();
    routerPush.mockReset();
    useFeatureFlagEnabled.mockReset();
    execute.mockReset();
    actionCallCount = 0;
    pendingActionCall = undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      actionCallCount += 1;
      actionOptions = options as typeof actionOptions;
      return {
        execute,
        executeAsync: async (input: unknown) => {
          execute(input);
          return undefined;
        },
        isExecuting:
          pendingActionCall !== undefined &&
          actionCallCount % pendingActionCall === 0,
        result: {},
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test.each([
    undefined,
    false,
  ])("stays hidden while the release flag is %s", async (enabled) => {
    useFeatureFlagEnabled.mockReturnValue(enabled);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending={false}
        initialEnabled={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(view.queryByRole("textbox")).toBeNull();
  });

  test("submits the raw field through its independent action", async () => {
    useFeatureFlagEnabled.mockReturnValue(true);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending={false}
        initialEnabled
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const codeInput = view.getByRole("textbox") as HTMLInputElement;
    await act(async () => {
      fireEvent.input(codeInput, {
        target: { value: " save20 " },
      });
    });
    expect(codeInput.value).toBe(" save20 ");
    fireEvent.submit(codeInput.closest("form")!);

    expect(execute).toHaveBeenCalledWith({
      locale: "en-US",
      payStateToken: "signed-state",
      submittedCode: " save20 ",
    });
  });

  test("shows one field error while retaining the current summary", async () => {
    useFeatureFlagEnabled.mockReturnValue(true);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending={false}
        initialEnabled
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    act(() => {
      actionOptions.onSuccess?.({ data: { status: "unavailable" } });
    });

    expect(
      view.getByText(m.checkoutDiscountCodeUnavailable({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(view.getByRole("textbox")).toBeDefined();
  });

  test("navigates only to the newly signed URL after success", async () => {
    useFeatureFlagEnabled.mockReturnValue(true);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    render(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending={false}
        initialEnabled
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    act(() => {
      actionOptions.onSuccess?.({
        data: {
          status: "applied",
          freshPayUrl: "/en-US/checkout/pay?payState=fresh",
        },
      });
    });

    expect(routerReplace).toHaveBeenCalledWith(
      "/en-US/checkout/pay?payState=fresh"
    );
  });

  test("ignores a late code result after payment navigation starts", async () => {
    useFeatureFlagEnabled.mockReturnValue(true);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending={false}
        initialEnabled
        locale="en-US"
        payStateToken="signed-state"
      />
    );
    view.rerender(
      <CheckoutDiscountCodeForm
        checkoutNavigationPending
        initialEnabled
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    act(() => {
      actionOptions.onSuccess?.({
        data: {
          status: "applied",
          freshPayUrl: "/en-US/checkout/pay?payState=fresh",
        },
      });
    });

    expect(routerReplace).not.toHaveBeenCalled();
  });

  test("celebrates the applied adjustment without showing the code", async () => {
    useFeatureFlagEnabled.mockReturnValue(false);
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        appliedAdjustment={{ kind: "percentage", basisPoints: 2000 }}
        checkoutNavigationPending={false}
        initialEnabled={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(
      view.getByText(
        m.checkoutDiscountCodeApplied({ discount: "20%" }, { locale: "en-US" })
      )
    ).toBeDefined();
    expect(view.getByRole("status").className).toContain(
      "bg-aquamarine-green/12"
    );
    expect(view.queryByRole("textbox")).toBeNull();
  });

  test("does not disable payment while the code form is pending", async () => {
    useFeatureFlagEnabled.mockReturnValue(true);
    pendingActionCall = 2;
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        discountCodeEntryEnabled
        locale="en-US"
        payStateToken="signed-state"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApplying({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", true);
    fireEvent.click(view.getByRole("checkbox"));
    expect(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApplying({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", true);
    expect(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", false);
  });
});
