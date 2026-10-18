import { describe, expect, mock, test } from "bun:test";
import { isValidElement } from "react";

let screenRenders = 0;

mock.module(
  "@/features/access-codes/admin/access-codes-administration-screen",
  () => ({
    AccessCodesAdministrationScreen: () => {
      screenRenders += 1;
      return null;
    },
  })
);

describe("access codes admin route", () => {
  test("renders the access-code screen without blocking the route", async () => {
    const { default: AccessCodesAdminPage } = await import("./page");

    const page = AccessCodesAdminPage();

    expect(isValidElement(page)).toBe(true);
    expect(screenRenders).toBe(0);
  });
});
