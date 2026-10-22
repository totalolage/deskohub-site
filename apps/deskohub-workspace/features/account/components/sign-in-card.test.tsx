import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { maskEmailAddress } from "@/shared/utils";

const adaAddress = testEmailAddress("ada");

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration, or
// React's synthetic change events never fire against controlled inputs.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { renderToStaticMarkup } = await import("react-dom/server");
const { rememberEmailSignInRequest } = await import(
  "@/features/account/email-sign-in-request"
);
const { getAuthCallbackPath } = await import("@/features/account/routes");

const locale = "en-US";

type AuthResponse = {
  readonly data?: unknown;
  readonly error: { readonly status?: number; readonly code?: string } | null;
};

const signInMagicLink = mock(
  (): Promise<AuthResponse> => Promise.resolve({ error: null })
);
const signInEmailOtp = mock(
  (_body: {
    readonly email: string;
    readonly otp: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({ data: { token: "synthetic" }, error: null })
);
const signInEmail = mock(
  (_body: {
    readonly email: string;
    readonly password: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({
      data: { redirect: false, token: "synthetic" },
      error: null,
    })
);
const passwordStep = (): Promise<AuthResponse> =>
  Promise.resolve({ data: { status: true, method: "password" }, error: null });
/**
 * The passkey endpoints and the browser's ceremony, settled the way a
 * customer who ignores the email field's autofill would: options arrive at
 * once unless `holdsOptions`, the button's ceremony picks a passkey at once
 * unless `modalRefusal`, and a conditional ceremony waits. Like `fetch` and
 * `credentials.get`, a request rejects once its signal aborts, unless
 * `ignoresAbort`: a response that still arrives afterwards.
 */
type PasskeyAnswer = AuthResponse | { readonly id: string };

type PasskeyRequest = {
  readonly name: string;
  readonly signal: AbortSignal;
  readonly resolve: (value: PasskeyAnswer) => void;
  readonly reject: (cause: unknown) => void;
};
const passkeyRequests: PasskeyRequest[] = [];
const passkeyOptions = { data: { challenge: "c2lnbi1pbg" }, error: null };
const signedInResponse: AuthResponse = {
  data: { session: { userId: "account-1" }, user: { id: "account-1" } },
  error: null,
};
let holdsOptions = false;
let ignoresAbort = false;
let modalRefusal: DOMException | undefined;
let verifyResponse = signedInResponse;

const startPasskeyRequest = (
  name: string,
  signal: AbortSignal,
  answer?: () => PasskeyAnswer
) => {
  const { promise, resolve, reject } = Promise.withResolvers<PasskeyAnswer>();
  passkeyRequests.push({ name, signal, resolve, reject });
  if (!ignoresAbort) {
    signal.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError"))
    );
  }
  if (answer) {
    try {
      resolve(answer());
    } catch (cause) {
      reject(cause);
    }
  }
  return promise;
};
const passkeyFetch = mock(
  (path: string, { signal }: { readonly signal: AbortSignal }) =>
    path.endsWith("/verify-authentication")
      ? startPasskeyRequest("verify", signal, () => verifyResponse)
      : startPasskeyRequest(
          "options",
          signal,
          holdsOptions ? undefined : () => passkeyOptions
        )
);
const getPasskeyAssertion = mock(
  (
    _options: PublicKeyCredentialRequestOptionsJSON,
    {
      conditional,
      signal,
    }: { readonly conditional: boolean; readonly signal: AbortSignal }
  ) =>
    conditional
      ? startPasskeyRequest("conditional", signal)
      : startPasskeyRequest("modal", signal, () => {
          if (modalRefusal) throw modalRefusal;
          return { id: "credential" };
        })
);
mock.module("@/shared/browser/webauthn-assertion", () => ({
  getPasskeyAssertion,
}));

const passkeyRequestNames = () =>
  passkeyRequests.map((request) => request.name);

const passkeyRequest = (name: string, index = 0) => {
  const request = passkeyRequests.filter(
    (candidate) => candidate.name === name
  )[index];
  if (request === undefined) throw new Error(`No ${name} request ${index}.`);
  return request;
};

const getSession = mock(
  (): Promise<{ readonly data: unknown; readonly error: null }> =>
    Promise.resolve({ data: null, error: null })
);

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: {
      email: signInEmail,
      emailOtp: signInEmailOtp,
      magicLink: signInMagicLink,
    },
    $fetch: passkeyFetch,
    $store: { notify: () => undefined },
  },
}));

const codeRequestStorageKey = "deskohub:account-sign-in-code";
const navigations: string[] = [];
const originalReplace = window.location.replace;

const sentWithCode = (): Promise<AuthResponse> =>
  Promise.resolve({ data: { status: true, signInCode: true }, error: null });

const storeCodeRequest = (requestedAt: number) => {
  sessionStorage.setItem(
    codeRequestStorageKey,
    JSON.stringify({ email: adaAddress, requestedAt })
  );
};

const codeInput = (view: ReturnType<typeof render>) =>
  view.getByLabelText(
    m.accountSignInCodeLabel({}, { locale })
  ) as HTMLInputElement;

const submitEmail = async (
  view: ReturnType<typeof render>,
  requestLocale: "en-US" | "cs-CZ" = locale
) => {
  fireEvent.change(
    view.getByLabelText(
      m.accountSignInEmailLabel({}, { locale: requestLocale })
    ),
    { target: { value: adaAddress } }
  );
  await act(async () => {
    fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
  });
};

/** Renders and lets the browser capability checks settle. */
const renderSettled = async (ui: Parameters<typeof render>[0]) => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(ui);
  });
  return view!;
};

const supportPasskeyAutofill = () => {
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: { isConditionalMediationAvailable: async () => true },
  });
};

describe("account components", () => {
  beforeEach(() => {
    navigations.length = 0;
    window.location.replace = ((href: string) => {
      navigations.push(href);
    }) as typeof window.location.replace;
  });

  afterEach(async () => {
    cleanup();
    // Settle what a test left pending, so no attempt outlives it.
    for (const request of passkeyRequests) {
      request.reject(new DOMException("Aborted", "AbortError"));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    passkeyRequests.length = 0;
    holdsOptions = false;
    ignoresAbort = false;
    modalRefusal = undefined;
    verifyResponse = signedInResponse;
    passkeyFetch.mockClear();
    getPasskeyAssertion.mockClear();
    rememberEmailSignInRequest(null);
    sessionStorage.clear();
    window.location.replace = originalReplace;
    signInMagicLink.mockClear();
    signInMagicLink.mockImplementation(() => Promise.resolve({ error: null }));
    signInEmailOtp.mockClear();
    signInEmail.mockClear();
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
    localStorage.clear();
    getSession.mockClear();
    getSession.mockImplementation(() =>
      Promise.resolve({ data: null, error: null })
    );
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const passwordInput = (view: ReturnType<typeof render>) =>
    view.container.querySelector(
      "#account-sign-in-password"
    ) as HTMLInputElement | null;

  const submitPassword = async (
    view: ReturnType<typeof render>,
    password: string
  ) => {
    fireEvent.change(passwordInput(view)!, { target: { value: password } });
    await act(async () => {
      fireEvent.submit(
        view.container.querySelector("#account-sign-in-password-form")!
      );
    });
  };

  test.each([
    ["the account", undefined, undefined],
    ["an assistant connection", "assistant", "/en-US/auth/connect?signed_in=1"],
  ] as const)(
    "sign-in card signs a review login in to %s with its password, without an email",
    async (_case, purpose, returnTo) => {
      signInMagicLink.mockImplementationOnce(passwordStep);
      const { SignInCard } = await import("./sign-in-card");
      const view = await renderSettled(
        <SignInCard locale={locale} purpose={purpose} returnTo={returnTo} />
      );

      await submitEmail(view);

      expect(passwordInput(view)?.type).toBe("password");
      expect(passwordInput(view)?.autocomplete).toBe("current-password");
      expect(view.container.querySelector("#account-sign-in-code")).toBeNull();
      await submitPassword(view, "synthetic-review-password");

      const callbackURL = getAuthCallbackPath(locale, { returnTo });
      expect(signInEmail).toHaveBeenCalledWith({
        email: adaAddress,
        password: "synthetic-review-password",
        callbackURL,
      });
      expect(navigations).toEqual([callbackURL]);
    }
  );

  test("sign-in card keeps a review login on its password after a wrong one", async () => {
    signInMagicLink.mockImplementationOnce(passwordStep);
    signInEmail.mockImplementationOnce(() =>
      Promise.resolve({
        error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      })
    );
    const { SignInCard } = await import("./sign-in-card");
    const view = await renderSettled(<SignInCard locale={locale} />);

    await submitEmail(view);
    await submitPassword(view, "synthetic-wrong-password");

    expect(passwordInput(view)?.getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput(view)?.value).toBe("");
    expect(navigations).toEqual([]);
  });

  test("sign-in card never shows customers a password field", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: true, signInCode: true }, error: null })
    );
    const { SignInCard } = await import("./sign-in-card");
    const view = await renderSettled(<SignInCard locale={locale} />);

    expect(passwordInput(view)).toBeNull();
    await submitEmail(view);

    expect(passwordInput(view)).toBeNull();
    expect(view.container.querySelector('input[type="password"]')).toBeNull();
  });

  test("server markup cannot submit an email through a native GET", async () => {
    const { SignInCard } = await import("./sign-in-card");
    const markup = renderToStaticMarkup(<SignInCard locale={locale} />);
    const serverDocument = new DOMParser().parseFromString(markup, "text/html");
    const form = serverDocument.querySelector(
      "#account-sign-in-form"
    ) as HTMLFormElement;
    const email = serverDocument.querySelector(
      "#account-sign-in-email"
    ) as HTMLInputElement;
    const submit = serverDocument.querySelector(
      "#account-sign-in-submit"
    ) as HTMLButtonElement;

    expect(form.getAttribute("method")).toBe("post");
    expect(form.hasAttribute("action")).toBe(false);
    expect(email.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "sign-in card tells a visitor sent from a reservation link why they sign in in %s",
    async (locale) => {
      const { SignInCard } = await import("./sign-in-card");
      const view = render(<SignInCard locale={locale} purpose="reservation" />);

      expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
        m.accountSignInReservationTitle({}, { locale })
      );
      expect(
        view.getByText(m.accountSignInReservationDescription({}, { locale }))
      ).toBeTruthy();
      cleanup();
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "sign-in card tells a visitor connecting an AI assistant why they sign in in %s",
    async (locale) => {
      const { SignInCard } = await import("./sign-in-card");
      const view = render(<SignInCard locale={locale} purpose="assistant" />);

      expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
        m.customerAgentSignInTitle({}, { locale })
      );
      expect(
        view.getByText(m.customerAgentSignInDescription({}, { locale }))
      ).toBeTruthy();
      cleanup();
    }
  );

  test("sign-in card shows the no-longer-waiting notice above the email field until a new email is sent", async () => {
    const { SignInCard } = await import("./sign-in-card");

    expect(
      await render(<SignInCard locale="cs-CZ" noLongerWaiting />).findByText(
        m.accountSignInNoLongerWaitingNotice({}, { locale: "cs-CZ" })
      )
    ).toBeTruthy();
    cleanup();

    const view = render(<SignInCard locale={locale} noLongerWaiting />);
    const notice = await view.findByText(
      m.accountSignInNoLongerWaitingNotice({}, { locale })
    );
    expect(
      notice.compareDocumentPosition(
        view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await submitEmail(view);
    fireEvent.click(
      view.getByRole("button", {
        name: m.accountSignInAcceptedAgain({}, { locale }),
      })
    );

    expect(
      view.queryByText(m.accountSignInNoLongerWaitingNotice({}, { locale }))
    ).toBeNull();
    expect(
      render(<SignInCard locale={locale} />).container.textContent
    ).not.toContain(m.accountSignInNoLongerWaitingNotice({}, { locale }));
  });

  test("sign-in page renders the no-longer-waiting notice as a status that describes the email field", async () => {
    const { SignInCard } = await import("./sign-in-card");
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <SignInCard locale={locale} noLongerWaiting />
    );

    const notice = page.querySelector(
      `#${page.querySelector("#account-sign-in-email")?.getAttribute("aria-describedby")}`
    );
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe(
      m.accountSignInNoLongerWaitingNotice({}, { locale })
    );
  });

  test("sign-in modal mounts the no-longer-waiting status before its text and keeps it on the email field's description", async () => {
    const { SignInCard } = await import("./sign-in-card");
    const insertions: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      insertions.push(...records)
    );
    observer.observe(document.body, { childList: true, subtree: true });

    const view = render(<SignInCard locale={locale} noLongerWaiting />);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    insertions.push(...observer.takeRecords());
    observer.disconnect();
    const text = m.accountSignInNoLongerWaitingNotice({}, { locale });
    const notice = view.getByRole("status");
    expect(notice.textContent).toBe(text);
    // A client navigation, as when the verify modal hands over, announces
    // the notice only if its region was already there.
    expect(
      insertions.some(
        (record) =>
          record.target === notice &&
          [...record.addedNodes].some((node) => node.textContent === text)
      )
    ).toBe(true);

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });
    const description = view
      .getByLabelText(m.accountSignInEmailLabel({}, { locale }))
      .getAttribute("aria-describedby")
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(description).toEqual([
      text,
      m.contactValidationEmailRequired({}, { locale }),
    ]);
  });

  test("sign-in card validates invalid email with localized copy before requesting a link", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const en = render(<SignInCard locale={locale} />);
    fireEvent.change(
      en.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: "not-an-email" },
      }
    );
    await act(async () => {
      fireEvent.submit(en.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });
    const enEmail = en.getByLabelText(
      m.accountSignInEmailLabel({}, { locale })
    );
    expect(
      en.getByText(m.contactValidationEmailInvalid({}, { locale }))
    ).toBeTruthy();
    expect(enEmail.getAttribute("aria-invalid")).toBe("true");
    expect(enEmail.getAttribute("aria-describedby")).toBeTruthy();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    fireEvent.change(
      cs.getByLabelText(m.accountSignInEmailLabel({}, { locale: "cs-CZ" })),
      {
        target: { value: "not-an-email" },
      }
    );
    await act(async () => {
      fireEvent.submit(cs.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });

    expect(
      cs.getByText(m.contactValidationEmailInvalid({}, { locale: "cs-CZ" }))
    ).toBeTruthy();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test("sign-in card swaps to the generic accepted state after the request succeeds", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: ` ${adaAddress} ` },
      }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: adaAddress,
        callbackURL: "/en-US/auth/callback",
        metadata: { locale: "en-US" },
      })
    );
    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
    expect(
      view.getByText(m.accountSignInAcceptedBody({}, { locale }))
    ).toBeTruthy();

    expect(document.activeElement?.textContent).toBe(
      m.accountSignInAcceptedTitle({}, { locale })
    );

    fireEvent.click(
      view.getByText(m.accountSignInAcceptedAgain({}, { locale }))
    );
    expect(document.activeElement).toBe(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    );
  });

  test("sign-in card shows a visible pending submit and sends only once", async () => {
    let resolveRequest!: (result: { error: null }) => void;
    const request = new Promise<{ error: null }>((resolve) => {
      resolveRequest = resolve;
    });
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const submit = view.getByRole("button", {
      name: m.accountSignInSubmitting({}, { locale }),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.querySelector("svg")).toBeTruthy();

    fireEvent.click(submit);
    expect(signInMagicLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ error: null });
      await request;
    });

    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card reports rejected requests and allows retry", async () => {
    const request = Promise.reject(new Error("network failure"));
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      await request.catch(() => undefined);
    });

    expect(
      view.getByText(m.accountSignInRequestFailed({}, { locale }))
    ).toBeTruthy();
    const submit = view.getByRole("button", {
      name: m.accountSignInSubmit({}, { locale }),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(signInMagicLink).toHaveBeenCalledTimes(2);
    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card keeps the typed email after a failed request", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText(m.accountSignInRequestFailed({}, { locale }))
    ).toBeTruthy();
    expect(
      (
        view.getByLabelText(
          m.accountSignInEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(adaAddress);
  });

  test("sign-in card keeps today's link-only state when the email has no code", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: true, signInCode: false },
        error: null,
      })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    await submitEmail(view);

    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
    expect(
      view.queryByText(m.accountSignInCodeTitle({}, { locale }))
    ).toBeNull();
    // Kept link-only, so a reload or the verify page can continue it.
    expect(
      JSON.parse(sessionStorage.getItem(codeRequestStorageKey) ?? "{}")
    ).toMatchObject({ signInCode: false });
  });

  test("sign-in card asks for the code when the email carries one", async () => {
    signInMagicLink.mockImplementationOnce(sentWithCode);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    await submitEmail(view);

    expect(
      view.getByRole("heading", {
        name: m.accountSignInCodeTitle({}, { locale }),
      })
    ).toBeTruthy();
    expect(view.queryByText(m.accountSignInEyebrow({}, { locale }))).toBeNull();
    expect(
      view.getByText(
        m.accountSignInCodeBody(
          { email: maskEmailAddress(adaAddress) },
          { locale }
        )
      )
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain(adaAddress);
    expect(codeInput(view)).toBeTruthy();
    // The email stays in this tab's storage, never in the URL.
    expect(
      JSON.parse(sessionStorage.getItem(codeRequestStorageKey) ?? "{}").email
    ).toBe(adaAddress);
    expect(window.location.search).not.toContain("example");
  });

  test("sign-in card asks for the code when this tab's storage rejects writes", async () => {
    const storage = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage"
    );
    const rejectingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("storage unavailable", "SecurityError");
      },
    };
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => rejectingStorage,
    });
    try {
      signInMagicLink.mockImplementationOnce(sentWithCode);
      const { SignInCard } = await import("./sign-in-card");

      const view = render(<SignInCard locale={locale} />);
      await submitEmail(view);

      expect(codeInput(view)).toBeTruthy();
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInCodeChangeEmail({}, { locale }),
        })
      );
      expect(
        view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
      ).toBeTruthy();
    } finally {
      if (storage) Object.defineProperty(globalThis, "sessionStorage", storage);
    }
  });

  test.each([
    [
      { status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" },
      () => m.accountSignInEmailLimitReached({}, { locale }),
    ],
    [{ status: 429 }, () => m.accountSignInRateLimited({}, { locale })],
    [{ status: 503 }, () => m.accountSignInRequestFailed({}, { locale })],
  ] as const)(
    "sign-in card explains a rejected email %o",
    async (error, message) => {
      signInMagicLink.mockImplementationOnce(() => Promise.resolve({ error }));
      const { SignInCard } = await import("./sign-in-card");

      const view = render(<SignInCard locale={locale} />);
      await submitEmail(view);

      expect(view.getByText(message())).toBeTruthy();
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "sign-in card explains an automated request in %s",
    async (requestLocale) => {
      signInMagicLink.mockImplementationOnce(() =>
        Promise.resolve({ error: { status: 403, code: "BOT_DETECTED" } })
      );
      const { SignInCard } = await import("./sign-in-card");

      const view = render(<SignInCard locale={requestLocale} />);
      await submitEmail(view, requestLocale);

      expect(
        view.getByText(
          m.accountSignInAutomatedRequest({}, { locale: requestLocale })
        )
      ).toBeTruthy();
    }
  );

  test("sign-in card restores a pending code step after a reload", async () => {
    storeCodeRequest(Date.now() - 60 * 1000);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);

    expect(codeInput(view)).toBeTruthy();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test("sign-in card drops a code step older than the code", async () => {
    storeCodeRequest(Date.now() - 10 * 60 * 1000 - 1);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);

    expect(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    ).toBeTruthy();
    expect(
      view.queryByLabelText(m.accountSignInCodeLabel({}, { locale }))
    ).toBeNull();
  });

  test("sign-in card signs in with the code and navigates once through the callback", async () => {
    storeCodeRequest(Date.now());
    getSession.mockImplementation(() =>
      Promise.resolve({
        data: {
          session: { createdAt: new Date() },
          user: { emailVerified: true },
        },
        error: null,
      })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    await act(async () => {
      fireEvent.change(codeInput(view), { target: { value: "482913" } });
    });
    // A focus check after the verified code must not navigate again.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(signInEmailOtp).toHaveBeenCalledWith({
      email: adaAddress,
      otp: "482913",
      callbackURL: "/en-US/auth/callback",
    });
    expect(navigations).toEqual(["/en-US/auth/callback"]);
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
    expect(
      view.getByText(m.accountSignInCodeVerified({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card continues a reloaded code step once the link signed this browser in", async () => {
    storeCodeRequest(Date.now());
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(navigations).toEqual([]);
    expect(codeInput(view)).toBeTruthy();

    getSession.mockImplementation(() =>
      Promise.resolve({
        data: {
          session: { createdAt: new Date() },
          user: { emailVerified: true },
        },
        error: null,
      })
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(navigations).toEqual(["/en-US/account"]);
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
  });

  const pendingReturnTo = "/en-US/cowork?date=2026-11-02&contact=sealed-a";
  const otherReturnTo = "/en-US/meeting-room?date=2026-11-03";
  const signedInSession = () =>
    Promise.resolve({
      data: {
        session: { createdAt: new Date() },
        user: { emailVerified: true },
      },
      error: null,
    } as const);

  const typeCode = async (view: ReturnType<typeof render>) => {
    await act(async () => {
      fireEvent.change(codeInput(view), { target: { value: "482913" } });
    });
  };

  const focusSignedInTab = async () => {
    getSession.mockImplementation(signedInSession);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
  };

  test.each([
    ["without a destination", undefined],
    ["for the same destination", pendingReturnTo],
  ] as const)(
    "sign-in card reopened %s verifies a pending code to the request's destination",
    async (_case, returnTo) => {
      rememberEmailSignInRequest({
        email: adaAddress,
        requestedAt: Date.now(),
        returnTo: pendingReturnTo,
      });
      getSession.mockImplementation(signedInSession);
      const { SignInCard } = await import("./sign-in-card");

      const view = render(<SignInCard locale={locale} returnTo={returnTo} />);
      await typeCode(view);

      const callbackURL = getAuthCallbackPath(locale, {
        returnTo: pendingReturnTo,
      });
      expect(signInEmailOtp).toHaveBeenCalledWith({
        email: adaAddress,
        otp: "482913",
        callbackURL,
      });
      expect(navigations).toEqual([callbackURL]);
    }
  );

  test.each([
    ["without a destination", undefined],
    ["for the same destination", pendingReturnTo],
  ] as const)(
    "sign-in card reopened %s continues a link sign-in to the request's destination",
    async (_case, returnTo) => {
      rememberEmailSignInRequest({
        email: adaAddress,
        requestedAt: Date.now(),
        returnTo: pendingReturnTo,
      });
      const { SignInCard } = await import("./sign-in-card");

      const view = render(<SignInCard locale={locale} returnTo={returnTo} />);
      expect(codeInput(view)).toBeTruthy();
      await focusSignedInTab();

      expect(navigations).toEqual([pendingReturnTo]);
    }
  );

  test("sign-in card opened for another destination starts a fresh request instead of the pending one", async () => {
    rememberEmailSignInRequest({
      email: adaAddress,
      requestedAt: Date.now(),
      returnTo: pendingReturnTo,
    });
    signInMagicLink.mockImplementation(sentWithCode);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(
      <SignInCard locale={locale} returnTo={otherReturnTo} />
    );
    // The pending request's code would land on its own destination.
    expect(
      view.queryByLabelText(m.accountSignInCodeLabel({}, { locale }))
    ).toBeNull();
    // Its link already lands there, so this tab no longer follows it.
    await focusSignedInTab();
    expect(navigations).toEqual([]);
    getSession.mockImplementation(() =>
      Promise.resolve({ data: null, error: null })
    );

    await submitEmail(view);
    const callbackURL = getAuthCallbackPath(locale, {
      returnTo: otherReturnTo,
    });
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL })
    );
    expect(
      JSON.parse(sessionStorage.getItem(codeRequestStorageKey) ?? "{}")
    ).toMatchObject({ returnTo: otherReturnTo });

    getSession.mockImplementation(signedInSession);
    await typeCode(view);
    expect(signInEmailOtp).toHaveBeenCalledWith({
      email: adaAddress,
      otp: "482913",
      callbackURL,
    });
    expect(navigations).toEqual([callbackURL]);
  });

  test("sign-in card opened for a destination starts fresh over a pending plain sign-in", async () => {
    storeCodeRequest(Date.now());
    const { SignInCard } = await import("./sign-in-card");

    const view = render(
      <SignInCard locale={locale} returnTo={otherReturnTo} />
    );

    expect(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    ).toBeTruthy();
    expect(
      view.queryByLabelText(m.accountSignInCodeLabel({}, { locale }))
    ).toBeNull();
  });

  test("sign-in card returns to the prefilled email step to change the address", async () => {
    storeCodeRequest(Date.now());
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    const changeEmail = view.getByRole("button", {
      name: m.accountSignInCodeChangeEmail({}, { locale }),
    });
    changeEmail.focus();
    fireEvent.click(changeEmail);

    const emailInput = view.getByLabelText(
      m.accountSignInEmailLabel({}, { locale })
    ) as HTMLInputElement;
    expect(emailInput.value).toBe(adaAddress);
    // The activated button is gone; keyboard focus lands in the email field.
    expect(document.activeElement).toBe(emailInput);
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
  });

  test("sign-in card falls back to the link-only state when a new email has no code", async () => {
    storeCodeRequest(Date.now() - 61 * 1000);
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: true, signInCode: false },
        error: null,
      })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    const resend = view.container.querySelector<HTMLButtonElement>(
      "#account-sign-in-code-resend"
    )!;
    resend.focus();
    await act(async () => {
      fireEvent.click(resend);
    });

    // The resend button is gone; focus moves to the new state's heading.
    expect(document.activeElement).toBe(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    );
    // Kept link-only, so a reload or the verify page can continue it.
    expect(
      JSON.parse(sessionStorage.getItem(codeRequestStorageKey) ?? "{}")
    ).toMatchObject({ signInCode: false });
  });

  test("sign-in card does not reopen a cancelled code step after resend resolves", async () => {
    storeCodeRequest(Date.now() - 61 * 1000);
    let resolveRequest!: (result: AuthResponse) => void;
    let requestSettled = false;
    const request = new Promise<AuthResponse>((resolve) => {
      resolveRequest = (result) => {
        requestSettled = true;
        resolve(result);
      };
    });
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    await act(async () => {
      fireEvent.click(
        view.container.querySelector("#account-sign-in-code-resend")!
      );
    });
    expect(signInMagicLink).toHaveBeenCalledTimes(1);
    expect(requestSettled).toBe(false);

    fireEvent.click(
      view.getByRole("button", {
        name: m.accountSignInCodeChangeEmail({}, { locale }),
      })
    );
    expect(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    ).toBeTruthy();
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
    expect(requestSettled).toBe(false);

    await act(async () => {
      resolveRequest({
        data: { status: true, signInCode: true },
        error: null,
      });
      await request;
    });

    expect(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card offers no passkey while passkeys are off", async () => {
    supportPasskeyAutofill();
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(<SignInCard locale={locale} />);

    expect(
      view
        .getByLabelText(m.accountSignInEmailLabel({}, { locale }))
        .getAttribute("autocomplete")
    ).toBe("email");
    expect(
      view.queryByRole("button", {
        name: m.accountSignInPasskey({}, { locale }),
      })
    ).toBeNull();
    expect(passkeyFetch).not.toHaveBeenCalled();
  });

  test("sign-in card signs in with a passkey and opens the account", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    expect(
      view
        .getByLabelText(m.accountSignInEmailLabel({}, { locale }))
        .getAttribute("autocomplete")
    ).toBe("email webauthn");

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });

    expect(passkeyRequestNames()).toEqual(["options", "modal", "verify"]);
    expect(navigations).toEqual(["/en-US/account"]);
    expect(localStorage.getItem("deskohub:passkey-held:account-1")).toBe("1");
  });

  test("sign-in card continues a passkey sign-in to its return target", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard
        locale={locale}
        passkeysEnabled
        returnTo="/en-US/admin/invoices?page=2"
      />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });

    expect(navigations).toEqual(["/en-US/admin/invoices?page=2"]);
  });

  test("sign-in card reports a failed passkey sign-in but not a cancelled one", async () => {
    const { SignInCard } = await import("./sign-in-card");
    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    const passkeyButton = () =>
      view.getByRole("button", {
        name: m.accountSignInPasskey({}, { locale }),
      });

    modalRefusal = new DOMException("Dismissed", "NotAllowedError");
    await act(async () => {
      fireEvent.click(passkeyButton());
    });
    expect(
      view.queryByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeNull();

    modalRefusal = undefined;
    verifyResponse = {
      data: null,
      error: { code: "AUTHENTICATION_FAILED", status: 400 },
    };
    await act(async () => {
      fireEvent.click(passkeyButton());
    });
    expect(
      view.getByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeTruthy();
    expect(navigations).toEqual([]);
  });

  test("sign-in card starts passkey autofill where the browser supports it", async () => {
    supportPasskeyAutofill();
    const { SignInCard } = await import("./sign-in-card");

    await renderSettled(<SignInCard locale={locale} passkeysEnabled />);

    expect(passkeyRequestNames()).toEqual(["options", "conditional"]);
  });

  test("sign-in card offers the passkey button at once without passkey autofill", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: { isConditionalMediationAvailable: async () => false },
    });
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );

    expect(passkeyFetch).not.toHaveBeenCalled();
    expect(
      (
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  test("sign-in card keeps quiet when autofill cannot be armed", async () => {
    supportPasskeyAutofill();
    getPasskeyAssertion.mockImplementationOnce(() =>
      Promise.reject(new DOMException("Bad domain", "SecurityError"))
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );

    expect(passkeyRequestNames()).toEqual(["options"]);
    expect(
      view.queryByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeNull();
  });

  test("sign-in card cancels a pending autofill when the passkey button is clicked", async () => {
    supportPasskeyAutofill();
    holdsOptions = true;
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    const passkeyButton = view.getByRole("button", {
      name: m.accountSignInPasskey({}, { locale }),
    }) as HTMLButtonElement;
    // The autofill request is still waiting for its options.
    expect(passkeyRequestNames()).toEqual(["options"]);
    expect(passkeyButton.disabled).toBe(false);
    expect(passkeyButton.getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      fireEvent.click(passkeyButton);
    });
    expect(passkeyRequest("options", 0).signal.aborted).toBe(true);
    await act(async () => {
      passkeyRequest("options", 1).resolve(passkeyOptions);
    });

    expect(passkeyRequestNames()).toEqual([
      "options",
      "options",
      "modal",
      "verify",
    ]);
    expect(navigations).toEqual(["/en-US/account"]);
  });

  test("sign-in card starts no autofill after a click during the browser's autofill check", async () => {
    const { promise: checked, resolve: answerCheck } =
      Promise.withResolvers<boolean>();
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: { isConditionalMediationAvailable: () => checked },
    });
    holdsOptions = true;
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });
    await act(async () => {
      answerCheck(true);
    });
    expect(passkeyRequestNames()).toEqual(["options"]);

    await act(async () => {
      passkeyRequest("options").resolve(passkeyOptions);
    });
    expect(passkeyRequestNames()).toEqual(["options", "modal", "verify"]);
    expect(passkeyRequest("modal").signal.aborted).toBe(false);
    expect(navigations).toEqual(["/en-US/account"]);
  });

  test("sign-in card starts autofill again after a failed passkey button attempt", async () => {
    supportPasskeyAutofill();
    verifyResponse = {
      data: null,
      error: { code: "AUTHENTICATION_FAILED", status: 400 },
    };
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });

    expect(
      view.getByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeTruthy();
    expect(passkeyRequestNames()).toEqual([
      "options",
      "conditional",
      "options",
      "modal",
      "verify",
      "options",
      "conditional",
    ]);
    expect(passkeyRequest("conditional", 0).signal.aborted).toBe(true);
    expect(passkeyRequest("conditional", 1).signal.aborted).toBe(false);
  });

  test("sign-in card ignores the late autofill options of a card mounted before it", async () => {
    supportPasskeyAutofill();
    holdsOptions = true;
    ignoresAbort = true;
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <div>
        <SignInCard
          locale={locale}
          passkeysEnabled
          returnTo="/en-US/admin/invoices?page=1"
        />
      </div>
    );
    await act(async () => {
      view.rerender(
        <div>
          <SignInCard
            locale={locale}
            passkeysEnabled
            returnTo="/en-US/admin/invoices?page=1"
          />
          <SignInCard
            locale={locale}
            passkeysEnabled
            returnTo="/en-US/admin/invoices?page=2"
          />
        </div>
      );
    });
    expect(passkeyRequest("options", 0).signal.aborted).toBe(true);

    await act(async () => {
      passkeyRequest("options", 0).resolve(passkeyOptions);
    });
    expect(passkeyRequestNames()).toEqual(["options", "options"]);
    await act(async () => {
      passkeyRequest("options", 1).resolve(passkeyOptions);
    });
    await act(async () => {
      passkeyRequest("conditional").resolve({ id: "credential" });
    });

    expect(navigations).toEqual(["/en-US/admin/invoices?page=2"]);
  });

  test("sign-in card opened for another destination drops its earlier autofill", async () => {
    supportPasskeyAutofill();
    holdsOptions = true;
    ignoresAbort = true;
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard
        locale={locale}
        passkeysEnabled
        returnTo="/en-US/admin/invoices?page=3"
      />
    );
    await act(async () => {
      view.rerender(
        <SignInCard
          locale={locale}
          passkeysEnabled
          returnTo="/en-US/admin/invoices?page=4"
        />
      );
    });
    await act(async () => {
      passkeyRequest("options", 0).resolve(passkeyOptions);
    });
    expect(passkeyRequestNames()).toEqual(["options", "options"]);

    await act(async () => {
      passkeyRequest("options", 1).resolve(passkeyOptions);
    });
    await act(async () => {
      passkeyRequest("conditional").resolve({ id: "credential" });
    });

    expect(passkeyRequestNames()).toEqual([
      "options",
      "options",
      "conditional",
      "verify",
    ]);
    expect(navigations).toEqual(["/en-US/admin/invoices?page=4"]);
  });

  test("sign-in card opened for another destination cancels a passkey button attempt waiting for its options", async () => {
    holdsOptions = true;
    ignoresAbort = true;
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard
        locale={locale}
        passkeysEnabled
        returnTo="/en-US/admin/invoices?page=3"
      />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });
    expect(passkeyRequestNames()).toEqual(["options"]);

    await act(async () => {
      view.rerender(
        <SignInCard
          locale={locale}
          passkeysEnabled
          returnTo="/en-US/admin/invoices?page=4"
        />
      );
    });
    expect(passkeyRequest("options").signal.aborted).toBe(true);
    // The superseded options still arrive.
    await act(async () => {
      passkeyRequest("options").resolve(passkeyOptions);
    });

    expect(passkeyRequestNames()).toEqual(["options"]);
    expect(navigations).toEqual([]);
    expect(
      view.getByRole("button", {
        name: m.accountSignInPasskey({}, { locale }),
      })
    ).toBeDefined();
  });

  test("sign-in card opened for another destination cancels a passkey button ceremony and continues to the new one", async () => {
    ignoresAbort = true;
    getPasskeyAssertion.mockImplementationOnce((_options, { signal }) =>
      startPasskeyRequest("modal", signal)
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard
        locale={locale}
        passkeysEnabled
        returnTo="/en-US/admin/invoices?page=3"
      />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });
    expect(passkeyRequestNames()).toEqual(["options", "modal"]);

    await act(async () => {
      view.rerender(
        <SignInCard
          locale={locale}
          passkeysEnabled
          returnTo="/en-US/admin/invoices?page=4"
        />
      );
    });
    expect(passkeyRequest("modal").signal.aborted).toBe(true);
    // The superseded ceremony still picks a passkey.
    await act(async () => {
      passkeyRequest("modal").resolve({ id: "credential" });
    });
    expect(passkeyRequestNames()).toEqual(["options", "modal"]);
    expect(navigations).toEqual([]);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });
    expect(passkeyRequestNames()).toEqual([
      "options",
      "modal",
      "options",
      "modal",
      "verify",
    ]);
    expect(navigations).toEqual(["/en-US/admin/invoices?page=4"]);
  });

  test("sign-in card closed during a passkey ceremony cancels it", async () => {
    getPasskeyAssertion.mockImplementationOnce((_options, { signal }) =>
      startPasskeyRequest("modal", signal)
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = await renderSettled(
      <SignInCard locale={locale} passkeysEnabled />
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSignInPasskey({}, { locale }),
        })
      );
    });
    expect(passkeyRequestNames()).toEqual(["options", "modal"]);

    view.unmount();

    expect(passkeyRequest("modal").signal.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(passkeyRequestNames()).toEqual(["options", "modal"]);
    expect(navigations).toEqual([]);
  });
});
