import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { LandingPageContactSection } from "./landing-page-contact-section";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("keeps contact actions on the homepage without rendering FAQ content", () => {
  const view = render(
    <LandingPageContactSection
      contactHref="/en-US/contact"
      deskohubBarCtaHref="/en-US#overview"
      locale="en-US"
    />
  );

  expect(
    view.getByRole("heading", {
      level: 2,
      name: "Need a booking, tour, or team setup?",
    })
  ).toBeTruthy();
  expect(
    view.getByRole("link", { name: "Contact us" }).getAttribute("href")
  ).toBe("/en-US/contact");
  expect(
    view.getByRole("link", { name: "Deskohub Bar" }).getAttribute("href")
  ).toBe("/en-US#overview");
  expect(
    view
      .getByRole("link", { name: "workspace@deskohub.cz" })
      .getAttribute("href")
  ).toBe("mailto:workspace@deskohub.cz");
  expect(view.queryByText("How does it work?")).toBeNull();
});
