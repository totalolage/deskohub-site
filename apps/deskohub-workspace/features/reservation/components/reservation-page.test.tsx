import { describe, expect, mock, test } from "bun:test";
import { isValidElement, Suspense } from "react";
import type { Locale } from "@/features/i18n";

mock.module("server-only", () => ({}));

const getReservationPageSuspenseBoundary = async () => {
  const { ReservationPage } = await import("./reservation-page");
  const page = ReservationPage({
    children: "reservation form",
    fallback: "reservation fallback",
    locale: "en" as Locale,
  });

  if (!isValidElement(page)) {
    throw new Error("ReservationPage did not return a React element");
  }

  const flowChildren = (
    page.props as {
      children?: unknown;
    }
  ).children;
  const suspenseBoundary = Array.isArray(flowChildren)
    ? flowChildren.find(
        (child) => isValidElement(child) && child.type === Suspense
      )
    : flowChildren;

  if (!isValidElement(suspenseBoundary)) {
    throw new Error("ReservationPage did not render a Suspense boundary");
  }

  return suspenseBoundary;
};

describe("ReservationPage", () => {
  test("keeps dynamic reservation content inside the localized loading boundary", async () => {
    const suspenseBoundary = await getReservationPageSuspenseBoundary();

    expect(suspenseBoundary.type).toBe(Suspense);
    expect(suspenseBoundary.props).toMatchObject({
      children: "reservation form",
      fallback: "reservation fallback",
    });
  });
});
