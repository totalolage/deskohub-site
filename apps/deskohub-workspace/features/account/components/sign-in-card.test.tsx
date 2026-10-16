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
const signInPasskey = mock(
  (_options?: { readonly autoFill?: boolean }): Promise<AuthResponse> =>
    Promise.resolve({
      data: { session: { userId: "account-1" }, user: { id: "account-1" } },
      error: null,
    })
);
const getSession = mock(
  (): Promise<{ readonly data: unknown; readonly error: null }> =>
    Promise.resolve({ data: null, error: null })
);

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: {
      emailOtp: signInEmailOtp,
      magicLink: signInMagicLink,
      passkey: signInPasskey,
    },
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

const submitEmail = async (view: ReturnType<typeof render>) => {
  fireEvent.change(
    view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
    { target: { value: adaAddress } }
  );
  await act(async () => {
    fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
  });
};

describe("account components", () => {
  beforeEach(() => {
    navigations.length = 0;
    window.location.replace = ((href: string) => {
      navigations.push(href);
    }) as typeof window.location.replace;
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    window.location.replace = originalReplace;
    signInMagicLink.mockClear();
    signInMagicLink.mockImplementation(() => Promise.resolve({ error: null }));
    signInEmailOtp.mockClear();
    signInPasskey.mockClear();
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
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
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
    [
      { status: 403, code: "BOT_DETECTED" },
      () => m.accountSignInRequestFailed({}, { locale }),
    ],
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
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
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
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);

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
    expect(signInPasskey).not.toHaveBeenCalled();
  });

  test("sign-in card signs in with a passkey and opens the account", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} passkeysEnabled />);
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

    expect(signInPasskey).toHaveBeenCalledWith({ autoFill: false });
    expect(navigations).toEqual(["/en-US/account"]);
    expect(localStorage.getItem("deskohub:passkey-held:account-1")).toBe("1");
  });

  test("sign-in card continues a passkey sign-in to its return target", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(
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
    const view = render(<SignInCard locale={locale} passkeysEnabled />);
    const passkeyButton = () =>
      view.getByRole("button", {
        name: m.accountSignInPasskey({}, { locale }),
      });

    signInPasskey.mockResolvedValueOnce({
      data: null,
      error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", status: 400 },
    });
    await act(async () => {
      fireEvent.click(passkeyButton());
    });
    expect(
      view.queryByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeNull();

    signInPasskey.mockResolvedValueOnce({
      data: null,
      error: { code: "AUTHENTICATION_FAILED", status: 400 },
    });
    await act(async () => {
      fireEvent.click(passkeyButton());
    });
    expect(
      view.getByText(m.accountSignInPasskeyFailed({}, { locale }))
    ).toBeTruthy();
    expect(navigations).toEqual([]);
  });

  test("sign-in card starts passkey autofill where the browser supports it", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: { isConditionalMediationAvailable: async () => true },
    });
    signInPasskey.mockImplementation(() => new Promise(() => undefined));
    const { SignInCard } = await import("./sign-in-card");

    try {
      await act(async () => {
        render(<SignInCard locale={locale} passkeysEnabled />);
        await Promise.resolve();
      });

      expect(signInPasskey).toHaveBeenCalledWith({ autoFill: true });
    } finally {
      signInPasskey.mockReset();
    }
  });
});
