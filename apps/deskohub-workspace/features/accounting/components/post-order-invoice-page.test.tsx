import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { m } from "@/features/i18n";
import { reservationAccessTokenSchema } from "@/features/reservation/reservation-access-token";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/accounting/actions/manage-post-order-invoice", () => ({
  managePostOrderInvoice: async () => ({}),
}));

registerWorkspaceComponentTestEnv();
// React DOM, which @testing-library/react loads, must load after the
// happy-dom registration to handle input events.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { PostOrderInvoicePage } = await import("./post-order-invoice-page");
const accessToken = reservationAccessTokenSchema.make("signed-capability");
const locale = "en-US";
const orderId = "reservation-id" as never;

type ActionCallbacks = {
  readonly onSuccess: (result: { data?: unknown }) => void;
  readonly onError: (result: {
    error: { serverError?: string | undefined };
  }) => void;
  readonly onTransportError: () => void;
};

// Captures the page's action callbacks and lets a test choose whether the
// action is running.
const captureAction = ({ isExecuting = false } = {}) => {
  const execute = mock();
  let callbacks: ActionCallbacks | undefined;
  workspaceUseAction.mockImplementation((_action, options) => {
    callbacks = options as ActionCallbacks;
    return { execute, isExecuting } as never;
  });
  const settle = (run: (callbacks: ActionCallbacks) => void) =>
    act(() => {
      if (!callbacks) throw new Error("Invoice action was not set up");
      run(callbacks);
    });
  return { execute, settle };
};

const stateOf = (container: HTMLElement) =>
  container
    .querySelector("[data-post-order-invoice]")
    ?.getAttribute("data-post-order-invoice");

describe("PostOrderInvoicePage", () => {
  beforeEach(() => {
    workspaceUseAction.mockReset();
  });
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("renders a blank masked personal billing form with visible validation", async () => {
    const { execute } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );

    expect(
      (
        view.getByLabelText(
          m.reservationBillingAddressLine1Label({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe("");
    expect(view.queryByLabelText("Legal company name")).toBeNull();
    expect(view.queryByLabelText("Email")).toBeNull();
    expect(view.getByRole("option", { name: "Czechia" })).toBeTruthy();
    expect(
      view.getByRole("button", {
        name: m.postOrderInvoiceCreateButton({}, { locale }),
      })
    ).toBeTruthy();
    expect(
      view.container
        .querySelector("[data-post-order-invoice]")
        ?.getAttribute("data-ph-no-capture")
    ).toBe("");

    const form = view.container.querySelector("form");
    if (!form) throw new Error("Invoice form missing");
    fireEvent.submit(form);
    expect(
      (await view.findAllByText("This field is required.")).length
    ).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
  });

  const fillAddress = (view: ReturnType<typeof render>) => {
    const fields = {
      [m.reservationBillingAddressLine1Label({}, { locale })]: "Test street 1",
      [m.reservationBillingCityLabel({}, { locale })]: "Prague",
      [m.reservationBillingPostalCodeLabel({}, { locale })]: "110 00",
    };
    for (const [label, value] of Object.entries(fields)) {
      act(() => {
        fireEvent.change(view.getByLabelText(label), { target: { value } });
      });
    }
  };

  // Submits the address form and lets its asynchronous validation settle.
  const submitAddress = async (view: ReturnType<typeof render>) => {
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Invoice form missing");
    await act(async () => {
      fireEvent.submit(form);
    });
  };

  test("creates the invoice for the entered address with the reservation access", async () => {
    const { execute, settle } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );
    settle(({ onTransportError }) => onTransportError());
    expect(view.container.querySelector("output")?.textContent).toBe(
      m.postOrderInvoiceActionError({}, { locale })
    );
    fillAddress(view);
    await submitAddress(view);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({
      locale,
      orderId,
      accessToken,
      operation: "create",
      address: {
        line1: "Test street 1",
        city: "Prague",
        postalCode: "110 00",
        country: "CZ",
      },
    });
    // Starting a request clears the previous notice.
    expect(view.container.querySelector("output")).toBeNull();
  });

  test("doesn't send invoice requests without reservation access", async () => {
    const { execute } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );
    fillAddress(view);
    await submitAddress(view);
    expect(execute).not.toHaveBeenCalled();
    cleanup();

    const resendView = render(
      <PostOrderInvoicePage
        initialState="issued"
        locale={locale}
        orderId={orderId}
      />
    );
    fireEvent.click(
      resendView.getByRole("button", {
        name: m.postOrderInvoiceResendButton({}, { locale }),
      })
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test("shows the created invoice and offers a resend only when delivery failed", () => {
    const { settle } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );

    settle(({ onSuccess }) =>
      onSuccess({ data: { status: "created", delivered: false } })
    );
    expect(stateOf(view.container)).toBe("created");
    expect(view.container.querySelector("form")).toBeNull();
    expect(
      view.getByText(
        m.postOrderInvoiceCreatedDeliveryFailedLead({}, { locale })
      )
    ).toBeTruthy();
    expect(
      view.getByRole("button", {
        name: m.postOrderInvoiceResendButton({}, { locale }),
      })
    ).toBeTruthy();

    settle(({ onSuccess }) =>
      onSuccess({ data: { status: "created", delivered: true } })
    );
    expect(
      view.getByText(m.postOrderInvoiceCreatedLead({}, { locale }))
    ).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
  });

  test("switches to the issued invoice when one already exists", () => {
    const { settle } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );

    settle(({ onSuccess }) => onSuccess({ data: undefined }));
    expect(stateOf(view.container)).toBe("create");

    settle(({ onSuccess }) =>
      onSuccess({ data: { status: "already-issued", delivered: true } })
    );
    expect(stateOf(view.container)).toBe("issued");
    expect(
      view.getByText(m.postOrderInvoiceIssuedTitle({}, { locale }))
    ).toBeTruthy();
    expect(
      view.getByRole("button", {
        name: m.postOrderInvoiceResendButton({}, { locale }),
      })
    ).toBeTruthy();
  });

  test("resends the issued invoice and reports failures in the notice", () => {
    const { execute, settle } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="issued"
        locale={locale}
        orderId={orderId}
      />
    );

    settle(({ onError }) => onError({ error: { serverError: "Server says" } }));
    expect(view.container.querySelector("output")?.textContent).toBe(
      "Server says"
    );

    fireEvent.click(
      view.getByRole("button", {
        name: m.postOrderInvoiceResendButton({}, { locale }),
      })
    );
    expect(execute).toHaveBeenCalledWith({
      locale,
      orderId,
      accessToken,
      operation: "resend",
    });
    expect(view.container.querySelector("output")).toBeNull();

    settle(({ onError }) => onError({ error: {} }));
    expect(view.container.querySelector("output")?.textContent).toBe(
      m.postOrderInvoiceActionError({}, { locale })
    );
  });

  test("clears the delivery warning after a successful resend", () => {
    const { settle } = captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialDeliveryFailed
        initialState="created"
        locale={locale}
        orderId={orderId}
      />
    );

    expect(
      view.getByText(
        m.postOrderInvoiceCreatedDeliveryFailedLead({}, { locale })
      )
    ).toBeTruthy();
    settle(({ onSuccess }) => onSuccess({ data: { status: "resent" } }));

    expect(
      view.queryByText(
        m.postOrderInvoiceCreatedDeliveryFailedLead({}, { locale })
      )
    ).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
    expect(
      view.getByText(m.postOrderInvoiceResentLead({}, { locale }))
    ).toBeTruthy();
  });

  test("disables and relabels the request buttons while a request runs", () => {
    captureAction({ isExecuting: true });
    const createView = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="create"
        locale={locale}
        orderId={orderId}
      />
    );
    const creating = createView.getByRole("button", {
      name: m.postOrderInvoiceCreatingButton({}, { locale }),
    }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);
    cleanup();

    const resendView = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="issued"
        locale={locale}
        orderId={orderId}
      />
    );
    const resending = resendView.getByRole("button", {
      name: m.postOrderInvoiceResendingButton({}, { locale }),
    }) as HTMLButtonElement;
    expect(resending.disabled).toBe(true);
  });

  test("offers no form or resend when invoice management is unavailable", () => {
    captureAction();
    const view = render(
      <PostOrderInvoicePage
        accessToken={accessToken}
        initialState="unavailable"
        locale={locale}
        orderId={orderId}
      />
    );

    expect(stateOf(view.container)).toBe("unavailable");
    expect(
      view.getByText(m.postOrderInvoiceUnavailableTitle({}, { locale }))
    ).toBeTruthy();
    expect(view.container.querySelector("form")).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
  });
});
