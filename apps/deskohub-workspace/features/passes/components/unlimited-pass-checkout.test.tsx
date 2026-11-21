import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { type OrderId, orderIdSchema } from "@/features/order";
import { currencyCZK } from "@/shared/money/currencies";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { unlimitedCheckoutPredecessorLimit } from "../unlimited-pass-checkout";

mock.module("next/image", () => ({ default: () => null }));

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { QueryProvider } = await import("@/shared/components/query-provider");
const { m } = await import("@/features/i18n");
const { UnlimitedPassCheckout } = await import("./unlimited-pass-checkout");

const replaceState = spyOn(window.history, "replaceState").mockImplementation(
  () => {}
);
afterEach(() => {
  cleanup();
  replaceState.mockClear();
});
afterAll(() => {
  replaceState.mockRestore();
  return unregisterWorkspaceComponentTestEnv();
});

const checkoutUrl = () => {
  const path = replaceState.mock.calls.at(-1)?.[2];
  if (!path) throw new Error("Checkout did not update its URL");
  return new URL(path, "https://deskohub.example");
};

const locale = "en-US";
const today = plainDateStringSchema.make("2026-10-25");
const openSpaceStart = plainDateStringSchema.make("2026-11-01");
const monitorStart = plainDateStringSchema.make("2026-11-02");
const lastStartDate = plainDateStringSchema.make("2026-11-24");
const buyerEmail = testEmailAddress("unlimited-pass-buyer");
const holderEmail = testEmailAddress("unlimited-pass-holder");
const recipientName = "Ája O’Connell-Svobodová";
const recipientNameLabel = m.unlimitedPassRecipientName({}, { locale });
const enterRecipientName = (view: {
  getByRole: (role: string, options: { name: string }) => Element;
}) =>
  fireEvent.change(view.getByRole("textbox", { name: recipientNameLabel }), {
    target: { value: recipientName },
  });
const earlyStart = m.unlimitedPassEarlyStartConsent({}, { locale });
const availability = {
  status: "ready",
  today,
  lastStartDate,
  starts: {
    "open-space": [openSpaceStart],
    "reserved-desk": [],
    "reserved-desk-workstation": {
      "2x27-qhd": [openSpaceStart],
      "2x32-qhd": [monitorStart],
      "2x27-4k": [],
      "2x32-4k": [],
    },
  },
} as const;

const base = {
  locale,
  buyer: { kind: "linked", name: "Fixture Buyer", email: buyerEmail },
  initialOptions: { tier: "open-space", coffee: false },
  initialStartDate: openSpaceStart,
  initialBounds: { today, lastStartDate },
  discountCodeEntryEnabled: false,
  getAvailability: async () => ({ data: availability }),
  beginCheckout: async () => ({}),
  repriceCheckout: async () => ({}),
  payCheckout: async () => ({}),
} as const;

const readyCheckout = {
  status: "ready",
  validFrom: openSpaceStart,
  lastUsableDate: "2026-11-30",
  disclosure: { documents: [] },
  price: {
    fingerprint: "a".repeat(64),
    subtotal: currencyCZK(349000),
    total: currencyCZK(349000),
    discounts: [],
  },
} as const;

test("Continue uses the selected tier's full-window starts and discards irrelevant add-ons", async () => {
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout {...base} />
    </QueryProvider>
  );
  const continueButton = view.getByRole<HTMLButtonElement>("button", {
    name: /continue/i,
  });
  await waitFor(() => expect(continueButton.disabled).toBe(false));
  expect(
    view.getByRole("switch", { name: /coffee for 30 days/i })
  ).toBeDefined();
  fireEvent.click(view.getByRole("switch"));
  fireEvent.click(
    view.getByRole("radio", { name: /^reserved desk (?!with workstation)/i })
  );
  expect(view.queryByRole("switch")).toBeNull();
  expect(view.queryByText(/same monitor setup/i)).toBeNull();
  expect(
    view.getByText("There are no available start dates for this selection.")
  ).toBeDefined();
  expect(continueButton.disabled).toBe(true);

  fireEvent.click(
    view.getByRole("radio", { name: /reserved desk with workstation/i })
  );
  expect(continueButton.disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: /November 1st, 2026/i }));
  expect(continueButton.disabled).toBe(false);
  expect(view.getAllByText("Not free on all 30 days")).toHaveLength(3);
  fireEvent.click(view.getByRole("radio", { name: /32.*qhd/i }));
  expect(checkoutUrl().searchParams.has("startDate")).toBe(false);
  expect(continueButton.disabled).toBe(true);
  const unavailableStart = view.getByRole<HTMLButtonElement>("button", {
    name: /November 1st, 2026/i,
  });
  expect(
    unavailableStart.disabled ||
      unavailableStart.getAttribute("aria-disabled") === "true"
  ).toBe(true);
  fireEvent.click(unavailableStart);
  expect(continueButton.disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: /November 2nd, 2026/i }));
  expect(continueButton.disabled).toBe(false);
  fireEvent.click(continueButton);
  expect(view.getByText("Reserved Desk with workstation")).toBeDefined();
});

test("renewal fixes the start date and carries the source through self-purchase", async () => {
  const renewsPassId = orderIdSchema.make(crypto.randomUUID());
  const requests: unknown[] = [];
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        renewsPassId={renewsPassId}
        initialOptions={{ tier: "open-space", coffee: true }}
        getAvailability={async () => ({
          data: {
            ...availability,
            starts: {
              ...availability.starts,
              "open-space": [openSpaceStart, monitorStart],
            },
          },
        })}
        beginCheckout={async (input) => {
          requests.push(input);
          return { data: readyCheckout };
        }}
      />
    </QueryProvider>
  );
  const continueButton = view.getByRole<HTMLButtonElement>("button", {
    name: /continue/i,
  });
  await waitFor(() => expect(continueButton.disabled).toBe(false));
  expect(
    view
      .getByRole("switch", { name: /coffee for 30 days/i })
      .getAttribute("aria-checked")
  ).toBe("true");
  const otherDate = view.getByRole<HTMLButtonElement>("button", {
    name: /November 2nd, 2026/i,
  });
  expect(
    otherDate.disabled || otherDate.getAttribute("aria-disabled") === "true"
  ).toBe(true);
  fireEvent.click(continueButton);
  expect(checkoutUrl().searchParams.get("renew")).toBe(renewsPassId);
  expect(
    view.queryByRole("checkbox", {
      name: m.entryPackCheckoutGift({}, { locale }),
    })
  ).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    renewsPassId,
    buyerEmail,
    selection: {
      tier: "open-space",
      coffee: true,
      startDate: openSpaceStart,
    },
  });
  expect(requests[0]).not.toHaveProperty("holderEmail");
});

test("gift Details preserves the buyer and billing, and Pay renders one combined consent", async () => {
  const requests: unknown[] = [];
  const payments: unknown[] = [];
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        beginCheckout={async (input) => {
          requests.push(input);
          return {
            data: {
              status: "ready",
              validFrom: openSpaceStart,
              lastUsableDate: "2026-11-30",
              price: {
                fingerprint: "a".repeat(64),
                subtotal: currencyCZK(418000),
                total: currencyCZK(418000),
                discounts: [],
              },
              disclosure: {
                documents: [
                  {
                    key: "terms-and-conditions",
                    path: "/terms",
                    hash: "one",
                    hashAlgorithm: "sha256",
                  },
                  {
                    key: "operating-rules",
                    path: "/rules",
                    hash: "two",
                    hashAlgorithm: "sha256",
                  },
                ],
                earlyStartRequest: earlyStart,
              },
            },
          };
        }}
        payCheckout={async (input) => {
          payments.push(input);
          return { data: { status: "purchase_error", reason: "unavailable" } };
        }}
      />
    </QueryProvider>
  );
  const continueButton = view.getByRole<HTMLButtonElement>("button", {
    name: /continue/i,
  });
  await waitFor(() => expect(continueButton.disabled).toBe(false));
  fireEvent.click(view.getByRole("switch"));
  fireEvent.click(continueButton);
  fireEvent.click(
    view.getByRole("checkbox", {
      name: m.entryPackCheckoutGift({}, { locale }),
    })
  );
  enterRecipientName(view);
  fireEvent.change(
    view.getByLabelText(m.entryPackCheckoutHolderEmail({}, { locale })),
    {
      target: { value: holderEmail },
    }
  );
  fireEvent.click(
    view.getByRole("switch", {
      name: m.reservationPurposeBusinessLabel({}, { locale }),
    })
  );
  const billingFields = [
    [m.reservationBillingCompanyNameLabel({}, { locale }), "Fixture Company"],
    [m.reservationBillingCompanyIdLabel({}, { locale }), "12345679"],
    [m.reservationBillingAddressLine1Label({}, { locale }), "Fixture Street 1"],
    [m.reservationBillingCityLabel({}, { locale }), "Praha"],
    [m.reservationBillingPostalCodeLabel({}, { locale }), "18000"],
  ] as const;
  for (const [label, value] of billingFields) {
    fireEvent.change(view.getByLabelText(label), {
      target: { value },
    });
  }
  fireEvent.click(
    view.getByRole("button", {
      name: m.reservationSelectionChange({}, { locale }),
    })
  );
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: /continue/i })
        .disabled
    ).toBe(false)
  );
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  expect(
    view.getByLabelText<HTMLInputElement>(
      m.entryPackCheckoutHolderEmail({}, { locale })
    ).value
  ).toBe(holderEmail);
  expect(
    view.getByLabelText<HTMLInputElement>(
      m.reservationBillingCompanyNameLabel({}, { locale }),
      { exact: false }
    ).value
  ).toBe("Fixture Company");

  enterRecipientName(view);
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await waitFor(() =>
    expect(view.getByText(earlyStart, { exact: false })).toBeDefined()
  );
  expect(requests).toEqual([
    expect.objectContaining({
      locale,
      buyerEmail,
      holderEmail,
      recipientName,
      selection: {
        tier: "open-space",
        startDate: openSpaceStart,
        coffee: true,
      },
    }),
  ]);
  expect(view.getAllByRole("checkbox")).toHaveLength(1);
  const pay = view.getByRole<HTMLButtonElement>("button", { name: /pay/i });
  expect(pay.disabled).toBe(true);
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.click(pay);
  await waitFor(() =>
    expect(payments).toEqual([
      expect.objectContaining({
        accepted: true,
        unlimitedEarlyStartAccepted: true,
        acceptedDocuments: [
          { key: "terms-and-conditions", hash: "one" },
          { key: "operating-rules", hash: "two" },
        ],
        billing: {
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: "Fixture Company",
            companyId: "12345679",
            address: {
              line1: "Fixture Street 1",
              city: "Praha",
              postalCode: "18000",
              country: "CZ",
            },
          },
        },
        displayedPriceFingerprint: "a".repeat(64),
      }),
    ])
  );
});

test.each(["capacity_unavailable", "draft_voided"] as const)(
  "renewal reports the %s dates and keeps its fixed start",
  async (status) => {
    const renewsPassId = orderIdSchema.make(crypto.randomUUID());
    const view = render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          renewsPassId={renewsPassId}
          initialDetails={{
            tier: "open-space",
            coffee: false,
            startDate: openSpaceStart,
          }}
          beginCheckout={async () => ({
            data: { status, blockingDates: [monitorStart] },
          })}
        />
      </QueryProvider>
    );
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    const alert = await view.findByText(
      "Your pass can’t cover Nov 2, 2026 in the renewal period."
    );
    expect(alert.getAttribute("role")).toBe("alert");
    const { searchParams } = checkoutUrl();
    expect(searchParams.get("renew")).toBe(renewsPassId);
    expect(searchParams.get("startDate")).toBe(openSpaceStart);
  }
);

test.each(["capacity_unavailable", "draft_voided"] as const)(
  "a %s result clears the owned draft and starts a fresh choice",
  async (status) => {
    const existingOrderId = orderIdSchema.make(
      "018f8000-0000-7000-8000-000000000001"
    );
    const requests: Array<{
      orderId: string;
      supersedeOrderIds?: readonly string[];
    }> = [];
    const view = render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          initialDetails={{
            tier: "open-space",
            coffee: false,
            startDate: openSpaceStart,
          }}
          draft={{ kind: "resume", orderId: existingOrderId }}
          beginCheckout={async (input) => {
            requests.push(input);
            return {
              data: {
                status,
                blockingDates: [monitorStart],
                retiredPredecessorOrderIds: [existingOrderId],
              },
            };
          }}
        />
      </QueryProvider>
    );
    fireEvent.click(
      view.getByRole("checkbox", {
        name: m.entryPackCheckoutGift({}, { locale }),
      })
    );
    enterRecipientName(view);
    fireEvent.change(
      view.getByLabelText(m.entryPackCheckoutHolderEmail({}, { locale })),
      {
        target: { value: holderEmail },
      }
    );
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(view.getByText(/pass can’t cover Nov 2, 2026/i)).toBeDefined()
    );
    expect(requests).toEqual([
      expect.objectContaining({
        orderId: expect.not.stringMatching(existingOrderId),
        supersedeOrderIds: [existingOrderId],
        holderEmail,
      }),
    ]);
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: /continue/i })
        .disabled
    ).toBe(true);
    const reopenedUrl = checkoutUrl();
    expect(reopenedUrl.searchParams.get("supersedeOrder")).toBeNull();
    expect(reopenedUrl.searchParams.get("submittedOrder")).toBeNull();
    expect(reopenedUrl.searchParams.getAll("predecessorOrder")).toEqual([]);
    expect(reopenedUrl.searchParams.get("order")).toBeNull();
    expect(reopenedUrl.searchParams.get("step")).toBeNull();
    expect(reopenedUrl.pathname).toBe("/en-US/passes/unlimited");
    fireEvent.click(view.getByRole("button", { name: /November 1st, 2026/i }));
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    enterRecipientName(view);
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.orderId).not.toBe(requests[0]?.orderId);
    expect(requests[1]?.supersedeOrderIds).toBeUndefined();
  }
);

test("an unknown Continue outcome retries the same draft", async () => {
  const orderIds: string[] = [];
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{
          tier: "open-space",
          coffee: false,
          startDate: openSpaceStart,
        }}
        beginCheckout={async ({ orderId }) => {
          orderIds.push(orderId);
          throw new Error("Synthetic network failure");
        }}
      />
    </QueryProvider>
  );
  const submit = view.getByRole<HTMLButtonElement>("button", {
    name: /continue/i,
  });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(
      view.getByText(m.actionFailedUnexpectedly({}, { locale }))
    ).toBeDefined()
  );
  fireEvent.click(submit);
  await waitFor(() => expect(orderIds).toHaveLength(2));
  expect(orderIds[1]).toBe(orderIds[0]);
});

test("a reload during Continue retries the committed gift and a date change supersedes it", async () => {
  const response = Promise.withResolvers<{ data: typeof readyCheckout }>();
  const selection = { ...base.initialOptions, startDate: openSpaceStart };
  const openDrafts = new Set<OrderId>();
  const priorOrderId = orderIdSchema.make(crypto.randomUUID());
  openDrafts.add(priorOrderId);
  const beginCheckout = mock(
    async (input: {
      orderId: OrderId;
      supersedeOrderIds?: readonly OrderId[];
      selection: { startDate: string };
      holderEmail?: string;
      recipientName?: string;
    }) => {
      expect(checkoutUrl().searchParams.get("submittedOrder")).toBe(
        input.orderId
      );
      expect(checkoutUrl().search).not.toContain(
        encodeURIComponent(holderEmail)
      );
      expect(decodeURIComponent(checkoutUrl().search)).not.toContain(
        recipientName
      );
      for (const id of input.supersedeOrderIds ?? []) openDrafts.delete(id);
      if (!openDrafts.has(input.orderId)) {
        if (openDrafts.size)
          throw new Error("Fixture draft still holds capacity");
        openDrafts.add(input.orderId);
      }
      if (beginCheckout.mock.calls.length === 1) return response.promise;
      throw new Error("Synthetic network failure");
    }
  );
  const renderCheckout = (
    draft: Parameters<typeof UnlimitedPassCheckout>[0]["draft"]
  ) =>
    render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          draft={draft}
          initialDetails={selection}
          getAvailability={async () => ({
            data: {
              ...availability,
              starts: {
                ...availability.starts,
                "open-space": [openSpaceStart, monitorStart],
              },
            },
          })}
          beginCheckout={beginCheckout}
        />
      </QueryProvider>
    );
  const original = renderCheckout({
    kind: "replace",
    orderId: priorOrderId,
    holderEmail,
  });
  enterRecipientName(original);
  fireEvent.click(original.getByRole("button", { name: /continue/i }));
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));
  const submittedId = orderIdSchema.make(
    checkoutUrl().searchParams.get("submittedOrder") ?? ""
  );
  expect(openDrafts).toEqual(new Set([submittedId]));
  const predecessorOrderIds = checkoutUrl()
    .searchParams.getAll("predecessorOrder")
    .map((id) => orderIdSchema.make(id));
  original.unmount();

  const reloaded = renderCheckout({
    kind: "submitted",
    orderId: submittedId,
    predecessorOrderIds,
    holderEmail,
  });
  const submit = () =>
    fireEvent.click(reloaded.getByRole("button", { name: /continue/i }));
  expect(reloaded.getByDisplayValue(holderEmail)).toBeDefined();
  expect(
    reloaded.getByRole<HTMLInputElement>("textbox", {
      name: recipientNameLabel,
    }).value
  ).toBe("");
  enterRecipientName(reloaded);
  submit();
  await waitFor(() =>
    expect(
      reloaded.getByText(m.actionFailedUnexpectedly({}, { locale }))
    ).toBeDefined()
  );
  expect(beginCheckout.mock.calls[1]?.[0]).toMatchObject({
    orderId: submittedId,
    holderEmail,
    recipientName,
    supersedeOrderIds: [priorOrderId],
  });
  expect(openDrafts).toEqual(new Set([submittedId]));

  fireEvent.click(
    reloaded.getByRole("button", {
      name: m.reservationSelectionChange({}, { locale }),
    })
  );
  const newDate = await reloaded.findByRole("button", {
    name: /November 2nd, 2026/i,
  });
  fireEvent.click(newDate);
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    submittedId,
    priorOrderId,
  ]);
  submit();
  enterRecipientName(reloaded);
  submit();
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(3));
  const replacement = beginCheckout.mock.calls[2]?.[0];
  expect(replacement).toMatchObject({
    selection: { startDate: monitorStart },
    holderEmail,
    supersedeOrderIds: [submittedId, priorOrderId],
  });
  expect(replacement?.orderId).not.toBe(submittedId);
  expect(openDrafts).toEqual(new Set([replacement?.orderId]));
  expect(checkoutUrl().searchParams.get("step")).toBe("details");
  await act(async () => response.resolve({ data: readyCheckout }));
  expect(checkoutUrl().searchParams.get("submittedOrder")).toBe(
    replacement?.orderId
  );
  expect(reloaded.queryByRole("button", { name: /pay/i })).toBeNull();
});

test("Unlimited gift requires a private name and clears it when returning to self-purchase", async () => {
  const beginCheckout = mock(async () => ({ data: readyCheckout }));
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{ ...base.initialOptions, startDate: openSpaceStart }}
        beginCheckout={beginCheckout}
      />
    </QueryProvider>
  );
  const gift = view.getByRole("checkbox", {
    name: m.entryPackCheckoutGift({}, { locale }),
  });
  expect(view.queryByRole("textbox", { name: recipientNameLabel })).toBeNull();
  fireEvent.click(gift);
  const name = view.getByRole<HTMLInputElement>("textbox", {
    name: recipientNameLabel,
  });
  expect(name.required).toBe(true);
  expect(name.hasAttribute("data-ph-mask")).toBe(true);
  expect(name.hasAttribute("data-ph-no-capture")).toBe(true);
  fireEvent.change(
    view.getByLabelText(m.entryPackCheckoutHolderEmail({}, { locale })),
    { target: { value: holderEmail } }
  );
  fireEvent.change(name, { target: { value: "   " } });
  fireEvent.submit(name.form!);
  expect(await view.findByText("Enter the recipient’s name.")).toBeDefined();
  expect(beginCheckout).not.toHaveBeenCalled();

  enterRecipientName(view);
  fireEvent.click(gift);
  fireEvent.click(gift);
  expect(
    view.getByRole<HTMLInputElement>("textbox", { name: recipientNameLabel })
      .value
  ).toBe("");
  fireEvent.click(gift);
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  expect(await view.findByRole("button", { name: /pay/i })).toBeDefined();
  expect(beginCheckout).toHaveBeenCalledWith(
    expect.not.objectContaining({ recipientName })
  );
});

test("holder edits to a reloaded self-purchase retain every uncertain predecessor", async () => {
  const originalId = orderIdSchema.make(crypto.randomUUID());
  const beginCheckout = mock(
    async (_input: {
      orderId: OrderId;
      supersedeOrderIds?: readonly OrderId[];
    }) => {
      throw new Error("Synthetic network failure");
    }
  );
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{ ...base.initialOptions, startDate: openSpaceStart }}
        draft={{
          kind: "submitted",
          orderId: originalId,
          predecessorOrderIds: [],
          holderEmail: null,
        }}
        beginCheckout={beginCheckout}
      />
    </QueryProvider>
  );
  fireEvent.click(
    view.getByRole("checkbox", {
      name: m.entryPackCheckoutGift({}, { locale }),
    })
  );
  const input = view.getByLabelText(
    m.entryPackCheckoutHolderEmail({}, { locale })
  );
  enterRecipientName(view);
  const submit = view.getByRole("button", { name: /continue/i });
  fireEvent.change(input, {
    target: { value: testEmailAddress("unlimited-replacement-holder") },
  });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(
      view.getByText(m.actionFailedUnexpectedly({}, { locale }))
    ).toBeDefined()
  );
  const firstId = beginCheckout.mock.calls[0]?.[0].orderId;
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    originalId,
  ]);

  fireEvent.change(input, {
    target: { value: testEmailAddress("unlimited-second-holder") },
  });
  fireEvent.click(submit);
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(2));
  expect(beginCheckout.mock.calls[1]?.[0].supersedeOrderIds).toEqual([
    firstId,
    originalId,
  ]);
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    firstId,
    originalId,
  ]);
});

test.each([0, unlimitedCheckoutPredecessorLimit])(
  "a holder change after pre-commit reload replaces the committed draft with %i predecessors",
  async (predecessorCount) => {
    const originalId = orderIdSchema.make(crypto.randomUUID());
    const predecessorOrderIds = Array.from({ length: predecessorCount }, () =>
      orderIdSchema.make(crypto.randomUUID())
    );
    const beginCheckout = mock(
      async (input: {
        orderId: OrderId;
        holderEmail?: string;
        supersedeOrderIds?: readonly OrderId[];
      }) => {
        expect(checkoutUrl().searchParams.get("submittedOrder")).toBe(
          input.orderId
        );
        expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual(
          input.supersedeOrderIds ?? []
        );
        return input.orderId === originalId
          ? {
              data: {
                status: "purchase_error" as const,
                reason: "draft-changed",
                retiredPredecessorOrderIds: predecessorOrderIds,
              },
            }
          : { data: readyCheckout };
      }
    );
    const view = render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          initialDetails={{ ...base.initialOptions, startDate: openSpaceStart }}
          draft={{
            kind: "submitted",
            orderId: originalId,
            predecessorOrderIds,
          }}
          beginCheckout={beginCheckout}
        />
      </QueryProvider>
    );
    fireEvent.click(
      view.getByRole("checkbox", {
        name: m.entryPackCheckoutGift({}, { locale }),
      })
    );
    enterRecipientName(view);
    fireEvent.change(
      view.getByLabelText(m.entryPackCheckoutHolderEmail({}, { locale })),
      { target: { value: holderEmail } }
    );
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    expect(await view.findByRole("button", { name: /pay/i })).toBeDefined();
    expect(beginCheckout).toHaveBeenCalledTimes(2);
    expect(beginCheckout.mock.calls[0]?.[0]).toMatchObject({
      orderId: originalId,
      holderEmail,
    });
    expect(beginCheckout.mock.calls[0]?.[0].supersedeOrderIds ?? []).toEqual(
      predecessorOrderIds
    );
    expect(beginCheckout.mock.calls[1]?.[0]).toMatchObject({
      holderEmail,
      supersedeOrderIds: [originalId],
    });
    expect(beginCheckout.mock.calls[1]?.[0].orderId).not.toBe(originalId);
  }
);

test("a failed Continue frees only acknowledged predecessor slots and preserves the current draft", async () => {
  const orderId = orderIdSchema.make(crypto.randomUUID());
  const predecessorOrderIds = Array.from(
    { length: unlimitedCheckoutPredecessorLimit },
    () => orderIdSchema.make(crypto.randomUUID())
  );
  const unresolved = predecessorOrderIds.at(-1)!;
  const beginCheckout = mock(async (_input: { orderId: OrderId }) => ({
    data: {
      status: "purchase_error" as const,
      reason: "holds-unavailable",
      retiredPredecessorOrderIds: predecessorOrderIds.slice(0, -1),
    },
  }));
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{ ...base.initialOptions, startDate: openSpaceStart }}
        draft={{ kind: "submitted", orderId, predecessorOrderIds }}
        beginCheckout={beginCheckout}
      />
    </QueryProvider>
  );
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await view.findByText(m.actionFailedUnexpectedly({}, { locale }));
  expect(checkoutUrl().searchParams.get("submittedOrder")).toBe(orderId);
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    unresolved,
  ]);
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(2));
  expect(beginCheckout).toHaveBeenLastCalledWith(
    expect.objectContaining({ orderId, supersedeOrderIds: [unresolved] })
  );
});

test("Details cannot hand off another selection while Begin is creating holds", async () => {
  const response = Promise.withResolvers<{
    data: { status: "purchase_error"; reason: "unavailable" };
  }>();
  const beginCheckout = mock(() => response.promise);
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{
          tier: "open-space",
          coffee: false,
          startDate: openSpaceStart,
        }}
        beginCheckout={beginCheckout}
      />
    </QueryProvider>
  );
  const submit = view.getByRole<HTMLButtonElement>("button", {
    name: /continue/i,
  });
  fireEvent.click(submit);
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));
  expect(
    view.queryByRole("button", { name: /choose your 30 days/i })
  ).toBeNull();
  expect(
    view.getByRole<HTMLButtonElement>("button", {
      name: m.reservationSelectionChange({}, { locale }),
    }).disabled
  ).toBe(true);

  const form = submit.form;
  if (!form) throw new Error("Continue is missing its form");
  fireEvent.submit(form);
  expect(beginCheckout).toHaveBeenCalledTimes(1);
  response.resolve({
    data: { status: "purchase_error", reason: "unavailable" },
  });
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: /choose your 30 days/i })
    ).toBeDefined()
  );
});

test("later calendar months load their own authoritative availability", async () => {
  const futureMonth = plainDateStringSchema.make("2027-02-01");
  const futureStart = plainDateStringSchema.make("2027-02-10");
  const getAvailability = mock(async ({ startsOn }: { startsOn?: string }) => ({
    data: {
      ...availability,
      starts: {
        ...availability.starts,
        "open-space": startsOn === futureMonth ? [futureStart] : [],
      },
    },
  }));
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialStartDate={futureStart}
        initialBounds={{
          today,
          lastStartDate: plainDateStringSchema.make("2027-04-25"),
        }}
        getAvailability={getAvailability}
      />
    </QueryProvider>
  );
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: /continue/i })
        .disabled
    ).toBe(false)
  );
  expect(getAvailability).toHaveBeenCalledWith({
    locale,
    startsOn: futureMonth,
  });
  fireEvent.click(view.getByRole("button", { name: /next month/i }));
  await waitFor(() =>
    expect(getAvailability).toHaveBeenCalledWith({
      locale,
      startsOn: "2027-03-01",
    })
  );
  expect(
    view.getByRole<HTMLButtonElement>("button", { name: /continue/i }).disabled
  ).toBe(true);
});

test("Refresh quote from first Pay carries the existing order into the next Continue", async () => {
  const selection = { ...base.initialOptions, startDate: openSpaceStart };
  const beginCheckout = mock(
    async (_input: {
      orderId: OrderId;
      supersedeOrderIds?: readonly OrderId[];
    }) => ({
      data: readyCheckout,
    })
  );
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={selection}
        beginCheckout={beginCheckout}
        payCheckout={async () => ({
          data: { status: "purchase_error", reason: "quote-expired" },
        })}
      />
    </QueryProvider>
  );
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  const pay = await view.findByRole("button", { name: /pay/i });
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.click(pay);
  fireEvent.click(
    await view.findByRole("button", {
      name: m.entryPackCheckoutRefreshQuote({}, { locale }),
    })
  );
  const originalId = beginCheckout.mock.calls[0]?.[0].orderId;
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    originalId,
  ]);
  expect(view.queryByRole("button", { name: /pay/i })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(2));
  expect(beginCheckout.mock.calls[1]?.[0].orderId).not.toBe(originalId);
  expect(beginCheckout.mock.calls[1]?.[0].supersedeOrderIds).toEqual([
    originalId,
  ]);
});

test.each(["Details", "sign-in"] as const)(
  "Pay preserves an unacknowledged predecessor on return through %s",
  async (destination) => {
    const orderId = orderIdSchema.make(crypto.randomUUID());
    const predecessorOrderIds = [orderIdSchema.make(crypto.randomUUID())];
    const assign = spyOn(window.location, "assign").mockImplementation(
      () => {}
    );
    try {
      const view = render(
        <QueryProvider>
          <UnlimitedPassCheckout
            {...base}
            initialDetails={{
              ...base.initialOptions,
              startDate: openSpaceStart,
            }}
            draft={{ kind: "submitted", orderId, predecessorOrderIds }}
            beginCheckout={async () => ({
              data: { ...readyCheckout, retiredPredecessorOrderIds: [] },
            })}
            payCheckout={async () => ({ data: { status: "signed_out" } })}
          />
        </QueryProvider>
      );
      fireEvent.click(view.getByRole("button", { name: /continue/i }));
      const pay = await view.findByRole("button", { name: /pay/i });
      let url: URL;
      if (destination === "Details") {
        fireEvent.click(
          view.getByRole("button", {
            name: new RegExp(
              m.unlimitedPassCheckoutHolder({}, { locale }),
              "i"
            ),
          })
        );
        url = checkoutUrl();
      } else {
        fireEvent.click(view.getByRole("checkbox"));
        fireEvent.click(pay);
        await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
        const signIn = new URL(
          assign.mock.calls[0]![0],
          "https://deskohub.example"
        );
        url = new URL(signIn.searchParams.get("returnTo")!, signIn.origin);
      }
      expect(url.searchParams.get("step")).toBe("details");
      expect(url.searchParams.get("submittedOrder")).toBe(orderId);
      expect(url.searchParams.getAll("predecessorOrder")).toEqual(
        predecessorOrderIds
      );
    } finally {
      assign.mockRestore();
    }
  }
);

test("Refresh quote at the predecessor limit clears a voided draft and lets the buyer select a new date", async () => {
  const orderId = orderIdSchema.make(crypto.randomUUID());
  const predecessorOrderIds = Array.from(
    { length: unlimitedCheckoutPredecessorLimit },
    () => orderIdSchema.make(crypto.randomUUID())
  );
  const unresolvedPredecessor = predecessorOrderIds.at(-1)!;
  let cutoffReached = false;
  const beginCheckout = mock(async (input: { orderId: OrderId }) =>
    cutoffReached && input.orderId === orderId
      ? {
          data: {
            status: "draft_voided" as const,
            blockingDates: [openSpaceStart],
            retiredPredecessorOrderIds: predecessorOrderIds.slice(0, -1),
          },
        }
      : { data: { ...readyCheckout, retiredPredecessorOrderIds: [] } }
  );
  const view = render(
    <QueryProvider>
      <UnlimitedPassCheckout
        {...base}
        initialDetails={{ ...base.initialOptions, startDate: openSpaceStart }}
        draft={{ kind: "submitted", orderId, predecessorOrderIds }}
        beginCheckout={beginCheckout}
        getAvailability={async () => ({
          data: {
            ...availability,
            starts: { ...availability.starts, "open-space": [monitorStart] },
          },
        })}
        payCheckout={async () => ({
          data: { status: "purchase_error", reason: "quote-expired" },
        })}
      />
    </QueryProvider>
  );
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  const pay = await view.findByRole("button", { name: /pay/i });
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.click(pay);
  fireEvent.click(
    await view.findByRole("button", {
      name: m.entryPackCheckoutRefreshQuote({}, { locale }),
    })
  );
  expect(checkoutUrl().searchParams.get("submittedOrder")).toBe(orderId);
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual(
    predecessorOrderIds
  );
  cutoffReached = true;
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await view.findByText(/pass can’t cover Nov 1, 2026/i);
  expect(beginCheckout).toHaveBeenLastCalledWith(
    expect.objectContaining({ orderId, supersedeOrderIds: predecessorOrderIds })
  );
  expect(checkoutUrl().searchParams.get("submittedOrder")).toBeNull();
  expect(checkoutUrl().searchParams.getAll("predecessorOrder")).toEqual([
    unresolvedPredecessor,
  ]);
  fireEvent.click(
    await view.findByRole("button", { name: /November 2nd, 2026/i })
  );
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  fireEvent.click(view.getByRole("button", { name: /continue/i }));
  await view.findByRole("button", { name: /pay/i });
  expect(beginCheckout).toHaveBeenCalledTimes(3);
  expect(beginCheckout).toHaveBeenLastCalledWith(
    expect.objectContaining({
      orderId: expect.not.stringMatching(orderId),
      selection: { ...base.initialOptions, startDate: monitorStart },
      supersedeOrderIds: [unresolvedPredecessor],
    })
  );
});

test("an expired status-originated payment retry returns to that same order", async () => {
  const orderId = orderIdSchema.make("018f8000-0000-7000-8000-000000000002");
  const replace = spyOn(window.location, "replace").mockImplementation(
    () => {}
  );
  try {
    const view = render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          retryPayment={{
            orderId,
            selection: {
              tier: "open-space",
              coffee: false,
              startDate: openSpaceStart,
            },
            state: {
              validFrom: openSpaceStart,
              lastUsableDate: "2026-11-30",
              billing: { purpose: "personal", invoice: "none" },
              disclosure: { documents: [] },
              price: {
                fingerprint: "a".repeat(64),
                subtotal: currencyCZK(349000),
                total: currencyCZK(349000),
                discounts: [],
              },
            },
          }}
          payCheckout={async () => ({
            data: { status: "purchase_error", reason: "quote-expired" },
          })}
        />
      </QueryProvider>
    );
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(view.getByRole("button", { name: /pay/i }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/en-US/reservation/status/${orderId}`
      )
    );
  } finally {
    replace.mockRestore();
  }
});

test("desktop final-month view loads the preceding visible month and lets the buyer choose it", async () => {
  const aprilStart = plainDateStringSchema.make("2027-04-15");
  const marchStart = plainDateStringSchema.make("2027-03-15");
  let isWide = false;
  const media = window.matchMedia("(min-width: 64rem)");
  Object.defineProperty(media, "matches", { get: () => isWide });
  const matchMedia = spyOn(window, "matchMedia").mockReturnValue(media);
  const getAvailability = mock(async ({ startsOn }: { startsOn?: string }) => ({
    data: {
      ...availability,
      starts: {
        ...availability.starts,
        "open-space":
          startsOn === "2027-03-01" ? [marchStart, aprilStart] : [aprilStart],
      },
    },
  }));
  try {
    const view = render(
      <QueryProvider>
        <UnlimitedPassCheckout
          {...base}
          initialStartDate={aprilStart}
          initialBounds={{
            today,
            lastStartDate: plainDateStringSchema.make("2027-04-25"),
          }}
          getAvailability={getAvailability}
        />
      </QueryProvider>
    );
    await waitFor(() =>
      expect(
        view.getByRole<HTMLButtonElement>("button", { name: /continue/i })
          .disabled
      ).toBe(false)
    );
    expect(getAvailability).toHaveBeenCalledWith({
      locale,
      startsOn: "2027-04-01",
    });

    act(() => {
      isWide = true;
      media.dispatchEvent(new Event("change"));
    });
    await waitFor(() =>
      expect(getAvailability).toHaveBeenCalledWith({
        locale,
        startsOn: "2027-03-01",
      })
    );
    const marchDay = () =>
      view.getByRole<HTMLButtonElement>("button", {
        name: /March 15th, 2027/i,
      });
    await waitFor(() => {
      expect(marchDay().disabled).toBe(false);
      expect(marchDay().getAttribute("aria-disabled")).not.toBe("true");
    });
    fireEvent.click(marchDay());
    await waitFor(() =>
      expect(checkoutUrl().searchParams.get("startDate")).toBe(marchStart)
    );
    fireEvent.click(view.getByRole("button", { name: /continue/i }));
    const detailsUrl = checkoutUrl();
    expect(detailsUrl.searchParams.get("startDate")).toBe(marchStart);
    expect(detailsUrl.searchParams.get("step")).toBe("details");
  } finally {
    matchMedia.mockRestore();
  }
});
