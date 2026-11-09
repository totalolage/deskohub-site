import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { NavItem } = await import("./nav-item");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("marks only the active item as the current page and fills it", () => {
  const view = render(
    <nav>
      <NavItem active>Profile</NavItem>
      <NavItem>Billing</NavItem>
    </nav>
  );
  const active = view.getByRole("button", { name: "Profile" });
  const inactive = view.getByRole("button", { name: "Billing" });

  expect(active.getAttribute("aria-current")).toBe("page");
  expect(active.className).toContain("bg-navy-blue");
  expect(inactive.hasAttribute("aria-current")).toBe(false);
  expect(inactive.className).not.toContain("bg-navy-blue");
  expect(active.getAttribute("type")).toBe("button");
});

test("danger items use the danger fill when active", () => {
  const view = render(
    <NavItem active tone="danger">
      Danger zone
    </NavItem>
  );
  expect(view.getByRole("button").className).toContain("bg-[#e71545]");
});

test("asChild renders a link with the requested aria-current kind", () => {
  const view = render(
    <NavItem active asChild current="location">
      <a href="/admin/orders">Orders</a>
    </NavItem>
  );
  const link = view.getByRole("link", { name: "Orders" });

  expect(link.getAttribute("aria-current")).toBe("location");
  expect(link.hasAttribute("type")).toBe(false);
});

test("inverse items highlight the active entry in sunset yellow", () => {
  const view = render(
    <nav>
      <NavItem active asChild caps tone="inverse">
        <a href="/en-US/account">Account</a>
      </NavItem>
      <NavItem aria-label="Contact" layout="icon" tone="inverse">
        <svg />
      </NavItem>
    </nav>
  );
  const active = view.getByRole("link", { name: "Account" });
  const inactive = view.getByRole("button", { name: "Contact" });

  expect(active.className).toContain("text-sunset-yellow");
  expect(active.className).toContain("uppercase");
  expect(active.getAttribute("aria-current")).toBe("page");
  expect(inactive.className).toContain("text-white/80");
  expect(inactive.className).toContain("size-10");
  expect(inactive.className.split(" ")).not.toContain("text-sunset-yellow");
});

test("step items are translucent tiles with an outer focus ring", () => {
  const view = render(
    <NavItem asChild layout="step" tone="translucent">
      <a href="/en-US/reservation/cowork">Reservation</a>
    </NavItem>
  );
  const classes = view
    .getByRole("link", { name: "Reservation" })
    .className.split(" ");

  expect(classes).toContain("flex");
  expect(classes).not.toContain("inline-flex");
  expect(classes).toContain("bg-white/7");
  expect(classes).toContain("hover:bg-white/12");
  expect(classes).toContain("focus-visible:ring-burned-orange");
  expect(classes).not.toContain("focus-visible:ring-inset");
});
