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
import { testEmailAddress } from "@deskohub/test-email";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import type { Locale } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ProfileScreenCopy, ProfileScreenProps } from "./profile-screen";

let ProfileScreen: (props: ProfileScreenProps) => React.ReactNode;

type LanguageActionResult = {
  readonly data?: { readonly status?: string };
  readonly serverError?: string;
};

// The real shared locale switch runs; only its Server Action is replaced.
const updateLocalePreference = mock(
  (_input: { locale: Locale }): Promise<LanguageActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);

mock.module("@/features/account/actions", () => ({
  updateLocalePreference,
}));

registerWorkspaceComponentTestEnv();
({ ProfileScreen } = await import("./profile-screen"));

const adaAddress = testEmailAddress("ada");

const englishCopy: ProfileScreenCopy = {
  emailLabel: "Email",
  emailVerification: {
    unverified: "This email still needs verification.",
    verified: "This email has been successfully verified.",
  },
  languageLabel: "Preferred language",
  languageOptionCs: "Čeština",
  languageOptionEn: "English (US)",
  memberFallback: "Workspace member",
  title: "Member profile and settings",
  verifiedEmail: "Verified login email",
};

const profileFields = (
  <>
    <div>
      <label htmlFor="profile-first-name">First name</label>
      <Input
        id="profile-first-name"
        name="firstName"
        required
        type="text"
        variant="error"
      />
    </div>
    <div>
      <label htmlFor="profile-last-name">Last name</label>
      <Input id="profile-last-name" name="lastName" type="text" />
    </div>
    <div>
      <label htmlFor="profile-phone">Phone</label>
      <Input id="profile-phone" name="phone" type="tel" />
    </div>
  </>
);

describe("ProfileScreen", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const renderLanguageControl = (
    locale: Locale = "en-US",
    copy: ProfileScreenCopy = englishCopy
  ) =>
    render(
      <ProfileScreen
        copy={copy}
        email={adaAddress}
        firstName="Ada"
        lastName="Lovelace"
        locale={locale}
      >
        {profileFields}
      </ProfileScreen>
    );

  const languageTrigger = (
    view: RenderResult,
    copy: ProfileScreenCopy = englishCopy
  ) => view.getByRole("combobox", { name: copy.languageLabel });

  const openLanguageListbox = async (
    view: RenderResult,
    copy: ProfileScreenCopy = englishCopy
  ) => {
    await act(async () => {
      fireEvent.keyDown(languageTrigger(view, copy), { key: "Enter" });
    });
    return view.findByRole("listbox");
  };

  const chooseLanguage = async (view: RenderResult, name: string) => {
    await openLanguageListbox(view);
    const option = view.getByRole("option", { name });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });
  };

  beforeEach(() => {
    updateLocalePreference.mockReset();
    updateLocalePreference.mockImplementation(() =>
      Promise.resolve({ data: { status: "saved" } })
    );
    window.location.href = "http://localhost/en-US/account/profile?ref=menu";
  });

  test("saves the chosen language, then moves the document to it", async () => {
    const saved = Promise.withResolvers<LanguageActionResult>();
    updateLocalePreference.mockImplementationOnce(() => saved.promise);
    const view = renderLanguageControl();

    await chooseLanguage(view, "Čeština");

    expect(updateLocalePreference).toHaveBeenCalledWith({ locale: "cs-CZ" });
    expect(window.location.pathname).toBe("/en-US/account/profile");
    // The control shows the choice and stays locked while the switch runs.
    expect(languageTrigger(view).textContent).toContain("Čeština");
    expect((languageTrigger(view) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      saved.resolve({ data: { status: "saved" } });
      await saved.promise;
    });

    await waitFor(() =>
      expect(window.location.pathname).toBe("/cs-CZ/account/profile")
    );
    expect(window.location.search).toBe("?ref=menu");
    expect(updateLocalePreference).toHaveBeenCalledTimes(1);
  });

  test("keeps the language control out of the surrounding profile form submission", async () => {
    let submitted = 0;
    const view = render(
      <form
        data-testid="profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
      >
        <ProfileScreen
          copy={englishCopy}
          email={adaAddress}
          firstName="Ada"
          lastName="Lovelace"
          locale="en-US"
        >
          {profileFields}
        </ProfileScreen>
      </form>
    );
    const form = view.getByTestId("profile-form") as HTMLFormElement;

    expect(languageTrigger(view).getAttribute("type")).toBe("button");
    expect([...new FormData(form).keys()]).not.toContain("language");

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(submitted).toBe(1);
    expect(updateLocalePreference).not.toHaveBeenCalled();
  });
});
