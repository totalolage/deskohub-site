import { describe, expect, mock, test } from "bun:test";
import { isValidElement, Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { QueryProvider } from "@/shared/components/query-provider";

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
  test("keeps the query provider and dynamic content inside the localized loading boundary", async () => {
    const suspenseBoundary = await getReservationPageSuspenseBoundary();
    const suspenseProps = suspenseBoundary.props as {
      children: unknown;
      fallback: unknown;
    };

    expect(suspenseBoundary.type).toBe(Suspense);
    expect(suspenseProps.fallback).toBe("reservation fallback");

    if (!isValidElement(suspenseProps.children)) {
      throw new Error("ReservationPage did not render a query provider");
    }

    expect(suspenseProps.children.type).toBe(QueryProvider);
    expect(suspenseProps.children.props).toMatchObject({
      children: "reservation form",
    });
  });
});
