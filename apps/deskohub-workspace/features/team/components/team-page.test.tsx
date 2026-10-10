import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: () => null,
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("presents the existing team profiles under one page heading", async () => {
  const { TeamPage } = await import("./team-page");
  const view = render(<TeamPage locale="en-US" />);

  expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    view.getByRole("heading", { level: 1, name: "Our team" })
  ).toBeTruthy();
  expect(view.container.querySelector("main")?.className).toContain(
    "pt-[calc(var(--site-header-height)+4rem)]"
  );
  expect(
    view
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
  ).toEqual(["The brains", "The software", "The hardware"]);
  expect(view.getByText("Danica")).toBeTruthy();
  expect(view.getByText("Filip")).toBeTruthy();
  expect(
    view.getByText(
      "Workstations, access systems, lighting and power, internet access, and much more."
    )
  ).toBeTruthy();
});
