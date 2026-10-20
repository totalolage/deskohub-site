import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type Mock,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { Schema } from "effect";
import { StrictMode, useEffect, useState } from "react";
import {
  type Resolver,
  type UseFormReturn,
  useForm,
  useWatch,
} from "react-hook-form";
import { m } from "@/features/i18n";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import type {
  ReservationCheckoutCustomerForm,
  ReservationExistingCustomerForm,
} from "@/features/reservation/reservation-existing-customer";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { publishQuoteTool } from "./site-tool-catalog";
import {
  agentToolEventStream,
  installFakeModelContext,
  mockAgentToolEndpoint,
  publishedQuoteTool,
  recordUnhandledRejections,
} from "./webmcp.test-utils";

const preparePayState = mock();
const submitReservation = mock();
const verifyEmail = mock();

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));
mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  preparePayState,
}));
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation,
}));
mock.module(
  "@/features/reservation/components/use-checkout-email-verification",
  () => ({
    useCheckoutEmailVerification: () => ({
      clearError: mock(),
      error: undefined,
      isVerifying: false,
      verify: verifyEmail,
    }),
  })
);
// The step lives in the URL; the tool fills the form at its contact step.
mock.module(
  "@/features/reservation/components/use-reservation-checkout-step",
  () => ({
    useReservationCheckoutStep: () => {
      const [step, setStep] = useState<"selection" | "contact">("contact");
      return { goTo: setStep, step };
    },
  })
);

const { ReservationCheckoutForm } = await import(
  "@/features/reservation/components/reservation-checkout-form"
);

const toolName = "prepare_reservation";
const payPath = "/en-US/checkout/pay?payState=sealed-state&orderId=order-1";
const payExpiresAt = "2099-07-29T08:10:00.000Z";
const fullyBookedMessage = "That day is fully booked.";

type HarnessValues = {
  readonly billing: { readonly purpose: "personal"; readonly invoice: "none" };
  readonly date: string;
  readonly email: string;
  readonly marketingConsent: boolean;
  readonly name: string;
  readonly phone: string;
};

const contactResolver: Resolver<HarnessValues> = async (values) => {
  const missing = (["name", "email", "phone"] as const).filter(
    (field) => !values[field]
  );
  return missing.length === 0
    ? { values, errors: {} }
    : {
        values: {},
        errors: Object.fromEntries(
          missing.map((field) => [
            field,
            { type: "required", message: `Enter your ${field}.` },
          ])
        ),
      };
};

/** Availability for the watched date settles a moment after it changes. */
function useHarnessAvailability(date: string, unavailableDates: string[]) {
  const [settledDate, setSettledDate] = useState(date);
  useEffect(() => {
    const timer = setTimeout(() => setSettledDate(date), 5);
    return () => clearTimeout(timer);
  }, [date]);
  return {
    isPending: settledDate !== date,
    unavailableMessage:
      settledDate === date && unavailableDates.includes(date)
        ? fullyBookedMessage
        : undefined,
  };
}

type HarnessKind = "cowork" | "office";

// The mounted harness form, for a test acting as the customer.
let harnessForm: UseFormReturn<HarnessValues> | undefined;

const getHarnessCheckoutCustomer = ({
  existingCustomer,
  signedOut,
  typedEmail,
}: {
  readonly existingCustomer: ReservationExistingCustomerForm | undefined;
  readonly signedOut: boolean;
  readonly typedEmail: string | undefined;
}): ReservationCheckoutCustomerForm => {
  if (existingCustomer) {
    return { status: "linked", existingCustomer, replacesTypedContact: false };
  }
  if (signedOut) return { status: "signed-out" };
  return {
    status: "profile-missing",
    email: typedEmail ?? "",
    continuesCheckout: false,
  };
};

/**
 * Without a saved profile the account books with the typed details;
 * `signedOut` types them before the email verification instead.
 */
function Harness({
  existingCustomer,
  typed = {},
  signedOut = false,
  kind = "cowork",
  priceError = false,
  unavailableDates = [],
}: {
  readonly existingCustomer?: ReservationExistingCustomerForm;
  readonly kind?: HarnessKind;
  readonly typed?: Partial<Pick<HarnessValues, "name" | "email" | "phone">>;
  readonly signedOut?: boolean;
  readonly priceError?: boolean;
  readonly unavailableDates?: string[];
}) {
  const checkoutCustomer = getHarnessCheckoutCustomer({
    existingCustomer,
    signedOut,
    typedEmail: typed.email,
  });
  const form = useForm<HarnessValues>({
    defaultValues: {
      billing: { purpose: "personal", invoice: "none" },
      date: "2099-07-30",
      email: existingCustomer?.contact.email ?? typed.email ?? "",
      marketingConsent: false,
      name: existingCustomer?.contact.name ?? typed.name ?? "",
      phone: existingCustomer?.contact.phone ?? typed.phone ?? "",
    },
    resolver: contactResolver,
  });
  useEffect(() => {
    harnessForm = form;
  }, [form]);
  const date = useWatch({ control: form.control, name: "date" });

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        isError: priceError,
        isFetching: false,
        retry: () => undefined,
        token: `signed-price-${date}`,
      }}
      availability={useHarnessAvailability(date, unavailableDates)}
      checkoutCustomer={checkoutCustomer}
      form={form}
      getReservation={({ date: reservationDate, email, name, phone }) =>
        ({ kind, reservationDate, email, name, phone }) as never
      }
      locale="en-US"
      selectionSummary={{
        reservationTitle: "Open Space",
        rows: [{ label: "Date", value: date }],
      }}
      selection={{
        kind,
        fromSearchParams: (searchParams) => ({
          date: searchParams.get("date") ?? "",
        }),
      }}
    >
      <output data-testid="date">{date}</output>
      <output data-testid="kind">{kind}</output>
    </ReservationCheckoutForm>
  );
}

/**
 * The reservation pages as client navigation swaps them: pushing another
 * family's page unmounts this form and mounts that family's form.
 */
function ReservationPages(props: Parameters<typeof Harness>[0]) {
  const [kind, setKind] = useState<HarnessKind>("cowork");
  useEffect(() => {
    workspaceRouterPush.mockImplementation(((path: string) => {
      const opened = path.match(/\/reservation\/(cowork|office)\b/)?.[1];
      if (opened) setTimeout(() => act(() => setKind(opened as HarnessKind)));
    }) as never);
  }, []);
  return <Harness key={kind} {...props} kind={kind} />;
}

/** The customer fills in a contact field the tool asked for. */
const fillContactField = (name: "email" | "phone", value: string) =>
  act(() =>
    harnessForm?.setValue(name, value, {
      shouldDirty: true,
      shouldValidate: true,
    })
  );

const accountCustomer = (
  hasMarketingConsent = false
): ReservationExistingCustomerForm => ({
  contact: {
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777777777",
  },
  hasMarketingConsent,
  initialMode: "account",
  otherContact: { name: "", email: "", phone: "" },
});

const typedContact = {
  name: "Grace Hopper",
  email: testEmailAddress("grace"),
  phone: "+420606060606",
};

const quoteFor = (family: string, date: string) => ({
  family,
  total: { amount: "290.00", currency: "CZK" },
  regular_price: { amount: "290.00", currency: "CZK" },
  quoted_at: "2099-07-29T08:00:00Z",
  reservation_url: `https://deskohub.test/reservation/${family}?entryTier=open-space&date=${date}&coffee=false`,
});

let modelContext: ReturnType<typeof installFakeModelContext>;
let endpoint: ReturnType<typeof mockAgentToolEndpoint>;
type PrepareActionResult = {
  readonly data?:
    | {
        readonly status: "ready";
        readonly redirectUrl: string;
        readonly expiresAt: string;
      }
    | { readonly status: "error"; readonly message: string };
};

let executeAsync: Mock<
  (input: PreparePayStateInput) => Promise<PrepareActionResult>
>;

const quoteEndpoint = (quote: Schema.JsonObject) =>
  mockAgentToolEndpoint(({ params }) =>
    params.name === "get_quote"
      ? agentToolEventStream({ structuredContent: quote })
      : agentToolEventStream({ structuredContent: {} })
  );

const renderForm = async (
  props: Parameters<typeof Harness>[0] = {},
  Page: typeof Harness = Harness
) => {
  const view = render(<Page {...props} />);
  act(() => publishQuoteTool(publishedQuoteTool));
  await waitFor(() => expect(modelContext.registered.has(toolName)).toBe(true));
  return view;
};

const runTool = (input: Schema.JsonObject) =>
  // As Chrome 151 calls it: with the input alone.
  modelContext.getTool(toolName).execute(input);

const getMarketingConsentCheckbox = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLButtonElement>(
    "#reservation-marketing-consent"
  );

const lastPrepareInput = () => executeAsync.mock.calls.at(-1)?.[0];

describe("prepare_reservation site tool", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    window.happyDOM.setURL("https://deskohub.test/en-US/reservation/cowork");
    modelContext = installFakeModelContext();
    endpoint = quoteEndpoint(quoteFor("cowork", "2099-07-31"));
    verifyEmail.mockClear();
    executeAsync = mock((_input: PreparePayStateInput) =>
      Promise.resolve<PrepareActionResult>({
        data: {
          status: "ready",
          redirectUrl: payPath,
          expiresAt: payExpiresAt,
        },
      })
    );
    // Like next-safe-action, a settled call runs the hook's callbacks first.
    workspaceUseAction.mockImplementation(((
      action: typeof preparePayState,
      options: {
        readonly onSuccess?: (result: PrepareActionResult) => void;
      }
    ) => ({
      executeAsync: async (input: PreparePayStateInput) => {
        const result = await executeAsync(input);
        if (action === preparePayState && result.data) {
          act(() => options.onSuccess?.(result));
        }
        return result;
      },
      isExecuting: false,
      result: {},
    })) as never);
  });

  afterEach(() => {
    cleanup();
    act(() => publishQuoteTool(undefined));
    modelContext.uninstall();
    endpoint.restore();
    workspaceUseAction.mockReset();
    workspaceRouterPush.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("publishes the quote input plus an optional, default-free marketingConsent, with the exact consent wording", async () => {
    await renderForm();
    const tool = modelContext.getTool(toolName);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: true,
    });
    expect(tool.inputSchema).toEqual({
      ...publishedQuoteTool.inputSchema,
      properties: {
        ...publishedQuoteTool.inputSchema.properties,
        marketingConsent: {
          type: "boolean",
          description:
            "Optional. Set to true only when the customer has explicitly asked, in this conversation, to receive Deskohub Workspace marketing communication (occasional news, event invitations and offers by email). Never infer it from other requests, never default it, and never set it on the customer's behalf. Otherwise omit it. Omitting it or sending false records no consent and never withdraws a consent the customer gave earlier.",
        },
      },
    });
    expect(tool.inputSchema?.required).not.toContain("marketingConsent");
    expect(tool.inputSchema).not.toHaveProperty([
      "properties",
      "marketingConsent",
      "default",
    ]);
    expect(
      tool.description.endsWith(
        "Set marketingConsent to true only when the customer has explicitly asked in this conversation to receive marketing communication; never infer or default it. The customer accepts the terms and operating rules and pays on the Pay page; this tool cannot do either."
      )
    ).toBe(true);
    expect(tool.title).toBe(
      m.siteToolPrepareReservationTitle({}, { locale: "en-US" })
    );
  });

  test("quotes the selection, fills the form, and submits a filled account form once, returning the Pay URL", async () => {
    const view = await renderForm({ existingCustomer: accountCustomer() });

    const result = await runTool({ family: "cowork", date: "2099-07-31" });

    expect(endpoint.requests.at(-1)?.params).toEqual({
      name: "get_quote",
      arguments: { family: "cowork", date: "2099-07-31", locale: "en-US" },
    });
    expect(view.getByTestId("date").textContent).toBe("2099-07-31");
    expect(executeAsync).toHaveBeenCalledTimes(1);
    expect(lastPrepareInput()).toMatchObject({
      advertisedPriceToken: "signed-price-2099-07-31",
      customer: "account",
      reservation: { reservationDate: "2099-07-31" },
    });
    expect(result).toEqual({
      status: "ready",
      pay_url: `https://deskohub.test${payPath}`,
      expires_at: payExpiresAt,
      summary: {
        family: "cowork",
        total: { amount: "290.00", currency: "CZK" },
        regular_price: { amount: "290.00", currency: "CZK" },
        quoted_at: "2099-07-29T08:00:00Z",
      },
      marketingConsent: "not_submitted",
    });
    expect(workspaceRouterPush).toHaveBeenCalledWith(payPath);
  });

  test("asks for missing contact details without calling the action, leaving the form filled", async () => {
    const view = await renderForm({ typed: { name: "Grace Hopper" } });

    const result = await runTool({ family: "cowork", date: "2099-07-31" });

    expect(result).toEqual({
      error: {
        code: "contact_details_required",
        message: m.siteToolContactDetailsRequired({}, { locale: "en-US" }),
        missing_fields: ["email", "phone"],
      },
    });
    expect(executeAsync).not.toHaveBeenCalled();
    expect(view.getByTestId("date").textContent).toBe("2099-07-31");
  });

  test("leaves a signed-out customer's checkout to the email verification it starts", async () => {
    await renderForm({ typed: typedContact, signedOut: true });

    const result = await runTool({ family: "cowork", date: "2099-07-31" });

    expect(result).toEqual({
      error: {
        code: "email_verification_required",
        message: m.siteToolEmailVerificationRequired({}, { locale: "en-US" }),
      },
    });
    expect(verifyEmail).toHaveBeenCalledWith(
      expect.objectContaining(typedContact)
    );
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test("returns the form's own message when the selection is no longer available", async () => {
    await renderForm({
      typed: typedContact,
      unavailableDates: ["2099-07-31"],
    });

    expect(await runTool({ family: "cowork", date: "2099-07-31" })).toEqual({
      error: { code: "selection_unavailable", message: fullyBookedMessage },
    });
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test("stops on a price the form could not load", async () => {
    await renderForm({ typed: typedContact, priceError: true });

    expect(await runTool({ family: "cowork", date: "2099-07-31" })).toEqual({
      error: {
        code: "price_unavailable",
        message: m.reservationAdvertisedPriceError({}, { locale: "en-US" }),
      },
    });
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test.each([
    ["an expired price", m.reservationErrorMessage({}, { locale: "en-US" })],
    [
      "a bot protection rejection",
      m.automatedRequestRejected({}, { locale: "en-US" }),
    ],
  ])("returns the form's message for %s", async (_case, message) => {
    executeAsync.mockImplementation(() =>
      Promise.resolve({ data: { status: "error", message } })
    );
    const view = await renderForm({ typed: typedContact });

    expect(await runTool({ family: "cowork", date: "2099-07-31" })).toEqual({
      error: { code: "checkout_failed", message },
    });
    await waitFor(() => expect(view.getByText(message)).toBeTruthy());
  });

  test("returns a quote error as its typed error object without touching the form", async () => {
    const error = { code: "invalid_input", message: "Check the date." };
    endpoint.restore();
    endpoint = mockAgentToolEndpoint(() =>
      agentToolEventStream({ structuredContent: { error }, isError: true })
    );
    const view = await renderForm({ typed: typedContact });

    expect(await runTool({ family: "cowork", date: "nope" })).toEqual({
      error,
    });
    expect(view.getByTestId("date").textContent).toBe("2099-07-30");
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test("for another family, opens its reservation page and prepares the reservation on the form there", async () => {
    endpoint.restore();
    endpoint = quoteEndpoint(quoteFor("office", "2099-08-03"));
    const view = await renderForm({ typed: typedContact }, ReservationPages);
    const coworkRegistration = modelContext.registered.get(toolName);

    const result = await runTool({
      family: "office",
      date: "2099-08-03",
      marketingConsent: true,
    });

    expect(workspaceRouterPush.mock.calls).toEqual([
      [
        "/en-US/reservation/office?entryTier=open-space&date=2099-08-03&coffee=false",
      ],
      [payPath],
    ]);
    expect(view.getByTestId("kind").textContent).toBe("office");
    expect(view.getByTestId("date").textContent).toBe("2099-08-03");
    expect(coworkRegistration?.signal?.aborted).toBe(true);
    expect(executeAsync).toHaveBeenCalledTimes(1);
    expect(lastPrepareInput()).toMatchObject({
      advertisedPriceToken: "signed-price-2099-08-03",
      marketingConsent: true,
      marketingConsentSource: "site_tool",
      reservation: { kind: "office", reservationDate: "2099-08-03" },
    });
    await waitFor(() =>
      expect(
        getMarketingConsentCheckbox(view)?.getAttribute("aria-checked")
      ).toBe("true")
    );
    expect(result).toMatchObject({
      status: "ready",
      pay_url: `https://deskohub.test${payPath}`,
      summary: { family: "office" },
      marketingConsent: "submitted",
    });
  });

  test("for another family, asks for missing contact details on the form there", async () => {
    endpoint.restore();
    endpoint = quoteEndpoint(quoteFor("office", "2099-08-03"));
    const view = await renderForm(
      { typed: { name: "Grace Hopper" } },
      ReservationPages
    );

    expect(await runTool({ family: "office", date: "2099-08-03" })).toEqual({
      error: {
        code: "contact_details_required",
        message: m.siteToolContactDetailsRequired({}, { locale: "en-US" }),
        missing_fields: ["email", "phone"],
      },
    });
    expect(view.getByTestId("kind").textContent).toBe("office");
    expect(executeAsync).not.toHaveBeenCalled();
  });

  describe("marketing consent", () => {
    test.each([
      ["absent", {}],
      ["false", { marketingConsent: false }],
      ['"true"', { marketingConsent: "true" }],
      ["1", { marketingConsent: 1 }],
      ["null", { marketingConsent: null }],
    ])(
      "%s leaves the checkbox alone and sends no consent",
      async (_case, consent) => {
        const view = await renderForm({ typed: typedContact });

        const result = await runTool({
          family: "cowork",
          date: "2099-07-31",
          ...consent,
        });

        expect(
          getMarketingConsentCheckbox(view)?.getAttribute("aria-checked")
        ).toBe("false");
        expect(lastPrepareInput()?.marketingConsent).toBe(false);
        expect(lastPrepareInput()).not.toHaveProperty("marketingConsentSource");
        expect(result).toMatchObject({ marketingConsent: "not_submitted" });
      }
    );

    test("keeps a box the customer ticked, as the customer's own consent", async () => {
      const view = await renderForm({ typed: typedContact });
      const checkbox = getMarketingConsentCheckbox(view);
      if (!checkbox) throw new Error("Missing marketing consent checkbox");
      fireEvent.click(checkbox);

      const result = await runTool({ family: "cowork", date: "2099-07-31" });

      expect(checkbox.getAttribute("aria-checked")).toBe("true");
      expect(lastPrepareInput()?.marketingConsent).toBe(true);
      expect(lastPrepareInput()).not.toHaveProperty("marketingConsentSource");
      expect(result).toMatchObject({ marketingConsent: "submitted" });
    });

    test("true on a box the customer already ticked labels the consent as the site tool's", async () => {
      const view = await renderForm({ typed: typedContact });
      const checkbox = getMarketingConsentCheckbox(view);
      if (!checkbox) throw new Error("Missing marketing consent checkbox");
      fireEvent.click(checkbox);

      const result = await runTool({
        family: "cowork",
        date: "2099-07-31",
        marketingConsent: true,
      });

      expect(checkbox.getAttribute("aria-checked")).toBe("true");
      expect(lastPrepareInput()).toMatchObject({
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      expect(result).toMatchObject({ marketingConsent: "submitted" });
    });

    test("true keeps the site tool's label on a retry after missing contact details", async () => {
      const view = await renderForm({ typed: { name: "Grace Hopper" } });
      const input = {
        family: "cowork",
        date: "2099-07-31",
        marketingConsent: true,
      };

      expect(await runTool(input)).toMatchObject({
        error: { code: "contact_details_required" },
      });
      await waitFor(() =>
        expect(
          getMarketingConsentCheckbox(view)?.getAttribute("aria-checked")
        ).toBe("true")
      );
      await fillContactField("email", typedContact.email);
      await fillContactField("phone", typedContact.phone);

      const result = await runTool(input);

      expect(executeAsync).toHaveBeenCalledTimes(1);
      expect(lastPrepareInput()).toMatchObject({
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      expect(result).toMatchObject({
        status: "ready",
        marketingConsent: "submitted",
      });
    });

    test("true ticks the visible checkbox and labels the consent as the site tool's", async () => {
      const view = await renderForm({ typed: typedContact });

      const result = await runTool({
        family: "cowork",
        date: "2099-07-31",
        marketingConsent: true,
      });

      await waitFor(() =>
        expect(
          getMarketingConsentCheckbox(view)?.getAttribute("aria-checked")
        ).toBe("true")
      );
      expect(lastPrepareInput()).toMatchObject({
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      expect(result).toMatchObject({ marketingConsent: "submitted" });
    });

    test("true for an account that already consented sends neither field", async () => {
      const view = await renderForm({
        existingCustomer: accountCustomer(true),
      });

      const result = await runTool({
        family: "cowork",
        date: "2099-07-31",
        marketingConsent: true,
      });

      expect(getMarketingConsentCheckbox(view)).toBeNull();
      expect(executeAsync).toHaveBeenCalledTimes(1);
      expect(lastPrepareInput()).not.toHaveProperty("marketingConsent");
      expect(lastPrepareInput()).not.toHaveProperty("marketingConsentSource");
      expect(result).toMatchObject({ marketingConsent: "already_granted" });
    });
  });

  test("stops before the Pay page: it never submits the reservation itself", async () => {
    await renderForm({ typed: typedContact });

    await runTool({ family: "cowork", date: "2099-07-31" });

    expect(submitReservation).not.toHaveBeenCalled();
    expect(
      workspaceUseAction.mock.calls.every(
        ([action]) => action === preparePayState
      )
    ).toBe(true);
  });

  test("unregisters when the form unmounts", async () => {
    const view = await renderForm();

    view.unmount();

    expect(modelContext.registered.has(toolName)).toBe(false);
  });

  test("a Strict Mode double mount leaves one registration and no rejection", async () => {
    const unhandled = recordUnhandledRejections();
    try {
      const view = render(
        <StrictMode>
          <Harness />
        </StrictMode>
      );
      act(() => publishQuoteTool(publishedQuoteTool));

      await waitFor(() =>
        expect(modelContext.registered.has(toolName)).toBe(true)
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const registrations = modelContext.registerTool.mock.calls.filter(
        ([tool]) => tool.name === toolName
      );
      expect(
        registrations.filter(([, options]) => !options?.signal?.aborted)
      ).toHaveLength(1);

      view.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        registrations.every(([, options]) => options?.signal?.aborted)
      ).toBe(true);
      expect(unhandled.rejections).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  test("an unmount while the registration is pending leaves no rejection", async () => {
    const unhandled = recordUnhandledRejections();
    const pendingRegistration = Promise.withResolvers<undefined>();
    modelContext.registerTool.mockImplementation(
      () => pendingRegistration.promise
    );
    try {
      const view = render(<Harness />);
      act(() => publishQuoteTool(publishedQuoteTool));
      await waitFor(() => expect(modelContext.registerTool).toHaveBeenCalled());

      view.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        modelContext.registerTool.mock.calls.every(
          ([, options]) => options?.signal?.aborted
        )
      ).toBe(true);
      expect(unhandled.rejections).toEqual([]);
    } finally {
      pendingRegistration.resolve(undefined);
      unhandled.stop();
    }
  });

  test("is not registered while the site tools are not", async () => {
    render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });
});
