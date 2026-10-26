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
import { type Locale, m } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ProfileScreenProps } from "./profile-screen";

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

const czechOption = m.accountProfileScreenLanguageOptionCs(
  {},
  { locale: "en-US" }
);

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

  const renderLanguageControl = (locale: Locale = "en-US") =>
    render(
      <ProfileScreen
        email={adaAddress}
        firstName="Ada"
        lastName="Lovelace"
        locale={locale}
      >
        {profileFields}
      </ProfileScreen>
    );

  const languageTrigger = (view: RenderResult) =>
    view.getByRole("combobox", {
      name: m.accountProfileScreenLanguageLabel({}, { locale: "en-US" }),
    });

  const openLanguageListbox = async (view: RenderResult) => {
    await act(async () => {
      fireEvent.keyDown(languageTrigger(view), { key: "Enter" });
    });
    return view.findByRole("listbox");
  };

  const chooseLanguage = async (view: RenderResult, name: string) => {
    await openLanguageListbox(view);
    const option = view.getByRole("option", { name });
    const optionLabel = option.textContent ?? "";
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });
    return optionLabel;
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

    const chosenLabel = await chooseLanguage(view, czechOption);

    expect(updateLocalePreference).toHaveBeenCalledWith({ locale: "cs-CZ" });
    expect(window.location.pathname).toBe("/en-US/account/profile");
    // The control shows the choice and stays locked while the switch runs.
    expect(chosenLabel).not.toBe("");
    expect(languageTrigger(view).textContent).toContain(chosenLabel);
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
