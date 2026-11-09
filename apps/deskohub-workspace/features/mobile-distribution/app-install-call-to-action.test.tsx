import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { androidAppIntentUrl } from "./install-android-app";
import type { AppInstallDecision } from "./install-decision";

mock.module("next/navigation", () => ({
  usePathname: () => "/cs-CZ",
}));

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const loadComponents = () => import("./app-install-call-to-action");

describe("AppInstallOffer", () => {
  test("opens the installed Android app through its intent link", async () => {
    const { AppInstallOffer } = await loadComponents();
    const view = render(
      <AppInstallOffer
        decision="open-android-app"
        locale="cs-CZ"
        onInstallWebApp={() => undefined}
      />
    );

    expect(view.getByRole("link").getAttribute("href")).toBe(
      androidAppIntentUrl
    );
    expect(view.queryByRole("button")).toBeNull();
  });

  test("links the locale's Android download page", async () => {
    const { AppInstallOffer } = await loadComponents();
    const view = render(
      <AppInstallOffer
        decision="download-android"
        locale="en-US"
        onInstallWebApp={() => undefined}
      />
    );

    expect(view.getByRole("link").getAttribute("href")).toBe("/en-US/android");
  });

  test("links the web app for Add to Home Screen on iOS", async () => {
    const { AppInstallOffer } = await loadComponents();
    const view = render(
      <AppInstallOffer
        decision="ios-add-to-home-screen"
        locale="cs-CZ"
        onInstallWebApp={() => undefined}
      />
    );

    expect(view.getByRole("link").getAttribute("href")).toBe("/app/");
    expect(view.queryByRole("button")).toBeNull();
  });

  test("shows the browser's install prompt from a button", async () => {
    const { AppInstallOffer } = await loadComponents();
    const onInstallWebApp = mock(() => undefined);
    const view = render(
      <AppInstallOffer
        decision="install-web-app"
        locale="cs-CZ"
        onInstallWebApp={onInstallWebApp}
      />
    );

    fireEvent.click(view.getByRole("button"));
    expect(onInstallWebApp).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("link")).toBeNull();
  });

  test("renders nothing when there is nothing to offer", async () => {
    const { AppInstallOffer } = await loadComponents();
    const view = render(
      <AppInstallOffer
        decision={"none" satisfies AppInstallDecision}
        locale="cs-CZ"
        onInstallWebApp={() => undefined}
      />
    );

    expect(view.container.innerHTML).toBe("");
  });
});

describe("AppInstallCallToAction", () => {
  test("renders nothing on the server", async () => {
    const { AppInstallCallToAction } = await loadComponents();

    expect(renderToString(<AppInstallCallToAction locale="cs-CZ" />)).toBe("");
  });

  test("offers the captured install prompt after mount", async () => {
    const { AppInstallCallToAction } = await loadComponents();
    const view = render(<AppInstallCallToAction locale="cs-CZ" />);

    expect(view.queryByRole("button")).toBeNull();
    const prompt = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      }
    );
    act(() => {
      window.dispatchEvent(prompt);
    });

    expect(view.getByRole("button")).toBeTruthy();
  });
});
