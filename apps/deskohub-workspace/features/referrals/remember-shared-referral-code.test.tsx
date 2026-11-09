import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { referralCodeCookieName } from "./referral-code-cookie";
import { RememberSharedReferralCode } from "./remember-shared-referral-code";

const rememberedCode = () =>
  document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${referralCodeCookieName}=`))
    ?.slice(referralCodeCookieName.length + 1);

const openPage = (url: string, prerendering = false) => {
  window.happyDOM.setURL(url);
  Object.defineProperty(document, "prerendering", {
    configurable: true,
    get: () => prerendering,
  });
};

describe("RememberSharedReferralCode", () => {
  let originalUrl: string;
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    originalUrl = window.location.href;
  });
  afterEach(() => {
    cleanup();
    document.cookie = `${referralCodeCookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    Reflect.deleteProperty(document, "prerendering");
    window.happyDOM.setURL(originalUrl);
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("remembers the shared code of a page that is already shown", () => {
    openPage("https://deskohub.test/en-US/reservation/cowork?ref=rfl12345");

    render(<RememberSharedReferralCode />);

    expect(rememberedCode()).toBe("RFL12345");
  });

  test("keeps a code the browser already remembers", () => {
    document.cookie = `${referralCodeCookieName}=RFLFIRST1; Path=/`;
    openPage("https://deskohub.test/en-US/account?ref=RFLSECOND");

    render(<RememberSharedReferralCode />);

    expect(rememberedCode()).toBe("RFLFIRST1");
  });

  test.each(["", "a", "bad code!"])(
    "ignores an address value that cannot be a referral code: %p",
    (value) => {
      openPage(
        `https://deskohub.test/en-US/account?ref=${encodeURIComponent(value)}`
      );

      render(<RememberSharedReferralCode />);

      expect(rememberedCode()).toBeUndefined();
    }
  );
});
