import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const documentNavigations: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  window.location.assign = ((href: string) => {
    documentNavigations.push(`assign:${href}`);
  }) as typeof window.location.assign;
  window.location.replace = ((href: string) => {
    documentNavigations.push(`replace:${href}`);
  }) as typeof window.location.replace;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("records that the document is leaving once the browser accepts it", async () => {
  const { isLeavingDocument, leaveDocument } = await import(
    "./document-navigation"
  );

  expect(isLeavingDocument()).toBe(false);
  expect(leaveDocument("/en-US/account/deleted")).toBe(true);
  expect(leaveDocument("/en-US/auth/sign-in", { replace: true })).toBe(true);

  expect(isLeavingDocument()).toBe(true);
  expect(documentNavigations).toEqual([
    "assign:/en-US/account/deleted",
    "replace:/en-US/auth/sign-in",
  ]);
});

test("stays put when the page comes back from the back-forward cache", async () => {
  const { isLeavingDocument } = await import("./document-navigation");

  window.dispatchEvent(
    Object.assign(new Event("pageshow"), { persisted: true })
  );

  expect(isLeavingDocument()).toBe(false);
});
