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
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const execute = mock();

interface CancelActionInput {
  readonly reservationId: string;
  readonly accessGrantUpdatedAt: string | null;
  readonly providerCredentialRemoved: boolean;
  readonly sendCancellationEmail: boolean;
}

type ActionOptions = {
  readonly execute: (input: CancelActionInput) => void;
  readonly isExecuting: boolean;
  readonly onSuccess: (args: {
    readonly data?: { readonly email: "failed" | "not_requested" | "sent" };
  }) => void;
  readonly onError: (args: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

let actionOptions: ActionOptions | undefined;

mock.module("./actions", () => ({
  cancelAdministrationReservation: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  execute.mockClear();
  actionOptions = undefined;
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation(() => ({
    execute,
    isExecuting: false,
    result: {},
  }));
});

const withActionOptions = () => {
  workspaceUseAction.mockImplementation((_action, options) => {
    actionOptions = options as ActionOptions | undefined;
    return { execute, isExecuting: false, result: {} };
  });
};

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unregisterWorkspaceComponentTestEnv();
});

const fixtureReservationId = "01980000-0000-7000-8000-00000000abcd";

const renderCancellation = async (
  props?: Partial<{
    canCancel: boolean;
    accessGrantUpdatedAt: string | null;
    requiresProviderCredentialRemoval: boolean;
    reservationId: string;
  }>,
  locale: "cs-CZ" | "en-US" = "en-US"
) => {
  const { ReservationCancellation } = await import(
    "./reservation-cancellation"
  );
  return render(
    <RouteLocaleProvider locale={locale}>
      <ReservationCancellation
        accessGrantUpdatedAt="2026-09-28T10:00:00.000Z"
        canCancel={true}
        requiresProviderCredentialRemoval={false}
        reservationId={fixtureReservationId}
        {...props}
      />
    </RouteLocaleProvider>
  );
};

const openDialog = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.click(
      view.getAllByRole("button", { name: "Cancel reservation" })[0]
    );
  });
};

const submitDialog = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.submit(
      within(view.getByRole("dialog")).getByRole("form", {
        name: "Cancel this reservation",
      })
    );
  });
};

describe("ReservationCancellation", () => {
  test("submits exact action args without provider credential removal", async () => {
    withActionOptions();
    const view = await renderCancellation({
      accessGrantUpdatedAt: "2026-09-28T10:00:00.000Z",
    });
    await openDialog(view);

    await submitDialog(view);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({
      accessGrantUpdatedAt: "2026-09-28T10:00:00.000Z",
      providerCredentialRemoved: false,
      reservationId: fixtureReservationId,
      sendCancellationEmail: true,
    });
  });

  test("keeps the execute button disabled until the lock removal is confirmed", async () => {
    withActionOptions();
    const view = await renderCancellation({
      requiresProviderCredentialRemoval: true,
    });
    await openDialog(view);

    const dialog = within(view.getByRole("dialog"));
    const confirmCheckbox = dialog.getByRole("checkbox", {
      name: "I removed the active door PIN from the lock in Igloohome",
    });
    expect(confirmCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(
      dialog
        .getByRole("button", { name: "Cancel reservation" })
        .hasAttribute("disabled")
    ).toBe(true);

    await submitDialog(view);
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(confirmCheckbox);
    expect(confirmCheckbox.getAttribute("aria-checked")).toBe("true");
    expect(
      dialog
        .getByRole("button", { name: "Cancel reservation" })
        .hasAttribute("disabled")
    ).toBe(false);

    await submitDialog(view);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      providerCredentialRemoved: true,
      sendCancellationEmail: true,
    });
  });

  test("submits the unchecked email checkbox when the operator opts out", async () => {
    withActionOptions();
    const view = await renderCancellation({ accessGrantUpdatedAt: null });
    await openDialog(view);

    fireEvent.click(
      within(view.getByRole("dialog")).getByRole("checkbox", {
        name: "Send a cancellation email to the customer",
      })
    );

    await submitDialog(view);
    expect(execute.mock.calls[0][0]).toEqual({
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: fixtureReservationId,
      sendCancellationEmail: false,
    });
  });

  test("renders the failure email-outcome notice and closes the dialog", async () => {
    withActionOptions();
    const view = await renderCancellation();
    await openDialog(view);

    await submitDialog(view);
    act(() => {
      actionOptions?.onSuccess({ data: { email: "failed" } });
    });

    expect(
      view.getByText(
        "Reservation cancelled, but the cancellation email could not be sent."
      )
    ).toBeDefined();
    expect(
      view.queryByRole("form", { name: "Cancel this reservation" })
    ).toBeNull();
  });

  test("speaks Czech on a Czech route, including validation and outcome", async () => {
    withActionOptions();
    const view = await renderCancellation(
      { requiresProviderCredentialRemoval: true },
      "cs-CZ"
    );
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Zrušit rezervaci" }));
    });

    const dialog = within(view.getByRole("dialog"));
    expect(dialog.getByText("Zrušit tuto rezervaci?")).toBeDefined();
    expect(
      dialog.getByRole("checkbox", {
        name: "Poslat zákazníkovi e-mail o zrušení",
      })
    ).toBeDefined();
    await act(async () => {
      fireEvent.submit(
        dialog.getByRole("form", { name: "Zrušit tuto rezervaci" })
      );
    });
    expect(
      await dialog.findByText(
        "Potvrďte, že byl PIN ke dveřím odebrán ze zámku."
      )
    ).toBeDefined();
    expect(execute).not.toHaveBeenCalled();

    act(() => {
      actionOptions?.onSuccess({ data: { email: "sent" } });
    });
    expect(
      view.getByText("Rezervace byla zrušena a zákazník dostal e-mail.")
    ).toBeDefined();
  });
});
