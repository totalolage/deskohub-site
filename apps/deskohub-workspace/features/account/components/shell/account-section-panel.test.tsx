import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { cleanup, render } = await import("@testing-library/react");
const { AccountSectionPanel } = await import("./account-section-panel");

describe("AccountSectionPanel", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("labels the section by its generated heading and renders only the body by default", () => {
    const view = render(
      <AccountSectionPanel title="Profile">
        <p>Body</p>
      </AccountSectionPanel>
    );

    const section = view.getByRole("region", { name: "Profile" });
    const heading = view.getByRole("heading", { level: 2, name: "Profile" });
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
    expect(section.dataset.slot).toBe("account-section-panel");
    expect(section.dataset.size).toBe("default");
    expect(section.dataset.variant).toBe("default");
    expect(view.getByText("Body")).toBeDefined();
    // Header row and body only: no actions slot and no footer.
    expect(section.querySelector("header")?.children).toHaveLength(1);
    expect(section.children).toHaveLength(2);
  });

  test("uses the supplied heading id, actions, footer, and section attributes", () => {
    const view = render(
      <AccountSectionPanel
        actions={<button type="button">Edit</button>}
        data-slot="ignored"
        data-testid="panel"
        footer={<button type="submit">Save</button>}
        size="compact"
        title="Delete account"
        titleId="delete-heading"
        variant="destructive"
      >
        <p>Body</p>
      </AccountSectionPanel>
    );

    const section = view.getByTestId("panel");
    expect(section.getAttribute("aria-labelledby")).toBe("delete-heading");
    expect(view.getByRole("heading", { level: 2 }).id).toBe("delete-heading");
    // The panel's own data attributes win over passed-through props.
    expect(section.dataset.slot).toBe("account-section-panel");
    expect(section.dataset.size).toBe("compact");
    expect(section.dataset.variant).toBe("destructive");
    expect(
      section.querySelector("header")?.contains(
        view.getByRole("button", {
          name: "Edit",
        })
      )
    ).toBe(true);
    const footer = view.getByRole("button", { name: "Save" }).parentElement;
    expect(footer?.parentElement).toBe(section);
    expect(section.lastElementChild).toBe(footer);
  });

  test("keeps the footer slot for an explicitly empty footer", () => {
    const view = render(
      <AccountSectionPanel data-testid="panel" footer={null} title="Billing">
        <p>Body</p>
      </AccountSectionPanel>
    );

    const section = view.getByTestId("panel");
    expect(section.children).toHaveLength(3);
    expect(section.lastElementChild?.childNodes).toHaveLength(0);
  });
});
