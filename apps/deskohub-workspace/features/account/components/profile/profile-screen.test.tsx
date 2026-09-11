import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/shared/components/ui/input";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ProfileScreenCopy, ProfileScreenProps } from "./profile-screen";
import { ProfileScreen } from "./profile-screen";

const englishCopy: ProfileScreenCopy = {
  avatarUnavailableDescription: "Profile photos are not available here.",
  avatarUnavailableLabel: "Profile photo unavailable",
  emailLabel: "Email",
  emailVerification: {
    unverified: "This email still needs verification.",
    verified: "This email has been successfully verified.",
  },
  languageLabel: "Preferred communication language",
  languageUnavailableValue: "Not set",
  memberFallback: "Workspace member",
  title: "Member profile and settings",
  verifiedEmail: "Verified login email",
};

const czechCopy: ProfileScreenCopy = {
  avatarUnavailableDescription: "Profilové fotografie nejsou k dispozici.",
  avatarUnavailableLabel: "Profilová fotografie není k dispozici",
  emailLabel: "E-mail",
  emailVerification: {
    unverified: "Tento e-mail stále vyžaduje ověření.",
    verified: "Tento e-mail byl úspěšně ověřen.",
  },
  languageLabel: "Preferovaný komunikační jazyk",
  languageUnavailableValue: "Nenastaveno",
  memberFallback: "Člen Workspace",
  title: "Profil a nastavení",
  verifiedEmail: "Ověřený přihlašovací e-mail",
};

const formerLanguageUnavailableDescriptions = {
  "en-US": "Language preferences are not saved yet.",
  "cs-CZ": "Preference jazyka se zatím neukládají.",
} as const;

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

function extractLiteralColor(
  markup: string,
  utility: "bg" | "text",
  context: RegExp
): string {
  const fragment = markup.match(context)?.[0];
  const color = fragment?.match(
    new RegExp(`${utility}-\\[#([0-9a-f]{6})\\]`)
  )?.[1];
  if (!color) {
    throw new Error(`Could not find ${utility} color in rendered markup`);
  }
  return `#${color}`;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [0, 2, 4].map(
      (offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255
    );
    const linearChannels = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return (
      linearChannels[0]! * 0.2126 +
      linearChannels[1]! * 0.7152 +
      linearChannels[2]! * 0.0722
    );
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function renderProfile(overrides: Partial<ProfileScreenProps> = {}): string {
  return renderToStaticMarkup(
    <ProfileScreen
      {...overrides}
      copy={overrides.copy ?? englishCopy}
      email={overrides.email ?? "ada@example.test"}
      firstName={overrides.firstName ?? "Ada"}
      lastName={
        "lastName" in overrides ? (overrides.lastName ?? null) : "Lovelace"
      }
      locale={overrides.locale ?? "en-US"}
      footer={overrides.footer ?? <button type="button">Save profile</button>}
    >
      {overrides.children ?? profileFields}
    </ProfileScreen>
  );
}

describe("ProfileScreen", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders the caller fields and footer without owning a form", () => {
    const markup = renderProfile();

    expect(markup).toContain('data-slot="profile-screen"');
    expect(markup).toContain("Member profile and settings");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Save profile");
    expect(markup).not.toMatch(/<form\b/);

    const namedControls = [...markup.matchAll(/\bname="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(namedControls).toEqual(["firstName", "lastName", "phone"]);
    expect(markup).not.toMatch(/name="(?:email|language)"/);
  });

  test("keeps the login email visual, verified, and non-editable", () => {
    const markup = renderProfile();

    expect(markup).toContain("ada@example.test");
    expect(markup).toContain("break-all");
    expect(markup).toContain("Verified login email");
    expect(markup).toContain("<fieldset");
    const emailFieldset = markup.match(
      /<legend[^>]*id="[^"]+-email-label">Email<\/legend>/
    );
    expect(emailFieldset).toBeTruthy();
    expect(markup).not.toContain(
      "This verified address cannot be changed here."
    );
    expect(markup).not.toMatch(/id="[^"]+-email-description"/);
    const emailFieldsetElement = markup.match(
      /<fieldset[^>]*aria-labelledby="[^"]+-email-label"[^>]*>/
    )?.[0];
    expect(emailFieldsetElement).toBeDefined();
    expect(emailFieldsetElement).not.toContain("aria-describedby");
    expect(markup).not.toMatch(/<span[^>]*aria-label="Verified login email"/);
    expect(markup).not.toMatch(/name="email"/);
    expect(markup).not.toMatch(/<input[^>]*ada@example\.test/);
  });

  test("retains shared Input error state and only scopes local sizing", () => {
    const markup = renderProfile();
    const errorInput = markup.match(/<input\b[^>]*name="firstName"[^>]*>/)?.[0];
    const gridClass = markup
      .match(/<div class="([^"]*sm:grid-cols-2[^"]*)">/)?.[1]
      ?.replaceAll("&amp;", "&");

    expect(errorInput).toContain("border-burned-orange");
    expect(gridClass).toBeDefined();
    expect(gridClass).not.toContain("[&_input]:border-[#cad3df]");
    expect(gridClass).not.toContain("[&_[data-slot=input]]:border-[#cad3df]");
  });

  test("emits responsive wrapping constraints for a long Czech email status", () => {
    const longCzechVerificationCopy =
      "Ověřený přihlašovací e-mail pro rezervace a zákaznický účet Workspace";
    const longCzechEmail =
      "jan.novak.velmi.dlouhy.alias@example.workspace.deskohub.cz";
    const markup = renderProfile({
      copy: {
        ...englishCopy,
        emailVerification: {
          ...englishCopy.emailVerification,
          verified: longCzechVerificationCopy,
        },
      },
      email: longCzechEmail,
    });
    const emailFieldsetClass = markup.match(
      /<fieldset[^>]*class="([^"]*)"/
    )?.[1];
    const verificationButton = markup.match(
      /<button class="([^"]*size-8 shrink-0[^"]*text-emerald-800[^"]*)"[^>]*aria-label="[^"]+"/
    )?.[1];

    expect(markup).toContain(longCzechEmail);
    expect(markup).toContain(longCzechVerificationCopy);
    expect(emailFieldsetClass).toContain("min-w-0");
    expect(emailFieldsetClass).toContain("sm:col-span-2");
    expect(emailFieldsetClass).toContain("lg:col-span-1");
    expect(verificationButton).toContain("size-8");
    expect(verificationButton).toContain("shrink-0");
    expect(verificationButton).toContain("text-emerald-800");
  });

  test("disables unavailable camera and language controls without a preference", () => {
    const markup = renderProfile();
    const disabledButtons = markup.match(/<button\b[^>]*disabled=""/g) ?? [];
    const options = markup.match(/<option\b/g) ?? [];

    expect(disabledButtons).toHaveLength(2);
    expect(markup).toContain('aria-label="Profile photo unavailable"');
    expect(markup).toContain('data-slot="select-trigger"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toMatch(
      /<select\b[^>]*aria-hidden="true"[^>]*tabindex="-1"/
    );
    expect(markup).not.toMatch(/<select\b[^>]*name=/);
    expect(markup).not.toMatch(/<option\b/);
    expect(options).toHaveLength(0);
    expect(markup).toContain("Not set");
    expect(markup).not.toContain(
      formerLanguageUnavailableDescriptions["en-US"]
    );
    expect(markup).not.toContain("Czech");
  });

  test("renders the unavailable language control as a disabled localized combobox", () => {
    for (const [locale, copy] of [
      ["en-US", englishCopy],
      ["cs-CZ", czechCopy],
    ] as const) {
      const view = render(
        <form data-testid="profile-form">
          <ProfileScreen
            copy={copy}
            email="ada@example.test"
            firstName="Ada"
            footer={<button type="button">Save profile</button>}
            lastName="Lovelace"
            locale={locale}
          >
            {profileFields}
          </ProfileScreen>
        </form>
      );
      const languageTrigger = view.getByRole("combobox", {
        name: copy.languageLabel,
      });
      const languageIcon = languageTrigger.querySelector("svg");
      const languageWrapper =
        languageTrigger.closest<HTMLElement>('[role="group"]');
      const nativeSelect = view.container.querySelector<HTMLSelectElement>(
        'select[aria-hidden="true"]'
      );

      for (const description of Object.values(
        formerLanguageUnavailableDescriptions
      )) {
        expect(view.queryByText(description)).toBeNull();
      }
      expect(languageTrigger.getAttribute("data-slot")).toBe("select-trigger");
      expect(languageTrigger.tagName).toBe("BUTTON");
      expect((languageTrigger as HTMLButtonElement).disabled).toBe(true);
      expect(languageWrapper).not.toBeNull();
      expect(languageWrapper?.classList.contains("w-full")).toBe(true);
      expect(languageTrigger.className).toContain("min-h-11");
      expect(languageTrigger.className).toContain("w-full");
      expect(languageTrigger.className).toContain("rounded-2xl");
      expect(languageTrigger.className).toContain("px-3");
      expect(languageIcon?.getAttribute("class")).toContain("h-4 w-4 shrink-0");
      expect(languageTrigger.textContent).toContain(
        copy.languageUnavailableValue
      );
      expect(view.getByLabelText(copy.languageLabel)).toBe(languageTrigger);
      expect(languageTrigger.getAttribute("aria-describedby")).toBeNull();
      expect(
        view.getByRole("button", { name: copy.emailVerification.verified })
      ).toBeTruthy();
      expect(nativeSelect).not.toBeNull();
      expect(nativeSelect?.disabled).toBe(true);

      const form = view.getByTestId("profile-form") as HTMLFormElement;
      expect([...new FormData(form).keys()]).not.toContain("language");

      fireEvent.click(languageTrigger);
      fireEvent.keyDown(languageTrigger, { key: "ArrowDown" });

      expect(view.queryByRole("listbox")).toBeNull();
      expect(languageTrigger.textContent).toContain(
        copy.languageUnavailableValue
      );
      cleanup();
    }
  });

  test("keeps informational text and the verification indicator contrast-safe", () => {
    const markup = renderProfile();
    const sectionClass = markup.match(/<section[^>]*class="([^"]*)"/)?.[1];
    const informationalText = extractLiteralColor(
      markup,
      "text",
      /<p class="[^"]*"[^>]*>Profile photos are not available here\.<\/p>/
    );
    const emailBackground = extractLiteralColor(
      markup,
      "bg",
      /<div class="[^"]*bg-\[#f8fafc\][^"]*">/
    );
    const verificationButton = markup.match(
      /<button class="([^"]*text-emerald-800[^"]*)"[^>]*aria-label="This email has been successfully verified\."/
    )?.[1];
    const languageTrigger =
      /<button[^>]*data-slot="select-trigger"[^>]*bg-\[#f8fafc\][^>]*>/;
    const languageText = extractLiteralColor(markup, "text", languageTrigger);
    const languageBackground = extractLiteralColor(
      markup,
      "bg",
      languageTrigger
    );

    expect(sectionClass).toContain("bg-white");
    expect(emailBackground).toBe("#f8fafc");
    expect(verificationButton).toContain("text-emerald-800");
    expect(contrastRatio(informationalText, "#ffffff")).toBeGreaterThanOrEqual(
      4.5
    );
    expect(
      contrastRatio(languageText, languageBackground)
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("uses real Unicode code points and a neutral icon when names are absent", () => {
    const unicodeMarkup = renderProfile({
      firstName: "  𐐀da",
      lastName: "😀ski  ",
    });
    expect(unicodeMarkup).toContain("𐐀da 😀ski");
    expect(unicodeMarkup).toContain("𐐀😀");
    expect(unicodeMarkup).not.toContain("�");

    const fallbackMarkup = renderProfile({ firstName: "  ", lastName: null });
    expect(fallbackMarkup).toContain("Workspace member");
    expect(fallbackMarkup).toContain("lucide-user-round");
    expect(fallbackMarkup).not.toContain(">WM<");
  });

  test("renders injected localized copy without inventing membership claims", () => {
    const markup = renderProfile({
      copy: czechCopy,
      firstName: "",
      lastName: null,
      locale: "cs-CZ",
    });

    const { emailVerification, ...localizedStrings } = czechCopy;
    const localizedValues = [
      ...Object.values(localizedStrings),
      emailVerification.verified,
    ];
    for (const copyValue of localizedValues) {
      expect(markup).toContain(copyValue);
    }
    expect(markup).not.toMatch(/member since|Prague|Czechia|turnstile|access/i);
  });
});
