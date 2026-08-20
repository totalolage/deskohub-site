import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomerSummary } from "./administration.service";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

const capturedLinks: CapturedLink[] = [];

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });
    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("next/navigation", () => ({
  usePathname: () => "/admin/customers",
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  capturedLinks.length = 0;
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("does not prefetch live administration routes", async () => {
  const { AdminShell } = await import("./admin-shell");
  const { AdministrationCustomerTable } = await import("./customer-table");
  const customerId =
    "customer-id" as AdministrationCustomerSummary["customerId"];

  render(
    <AdminShell breadcrumb={<span>Customers</span>}>
      <AdministrationCustomerTable
        customers={[
          {
            customer: null,
            customerId,
            lastActivityAt: "2026-08-14T12:00:00Z",
            reservationCount: 1,
          },
        ]}
        sorting={{ direction: "desc", field: "activity" }}
      />
    </AdminShell>
  );

  expect(capturedLinks.length).toBeGreaterThan(0);
  expect(capturedLinks.every(({ prefetch }) => prefetch === false)).toBe(true);
  expect(capturedLinks.map(({ href }) => href)).toContain(
    "/admin/customers?sort=reservations&direction=asc"
  );
  expect(capturedLinks.map(({ href }) => href)).toContain(
    "/admin/customers?sort=activity&direction=asc"
  );
});
