import { afterEach, describe, expect, mock, test } from "bun:test";
import { Calendar } from "lucide-react";
import { LocalizedLink } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import { ReservationButton } from "./reservation-button";

const initialTableReservations = siteConstants.featureFlags.tableReservations;

afterEach(() => {
  siteConstants.featureFlags.tableReservations = initialTableReservations;
});

const renderButton = (props: Parameters<typeof ReservationButton>[0]) => {
  siteConstants.featureFlags.tableReservations = true;
  const tree = ReservationButton(props);
  const [button] = findElementsOfType(tree, Button);

  return { tree, button };
};

const buttonClasses = (className: string | undefined) =>
  className?.split(" ").filter(Boolean);

describe("ReservationButton", () => {
  test("renders nothing while table reservations are disabled", () => {
    siteConstants.featureFlags.tableReservations = false;

    expect(ReservationButton({})).toBeNull();
  });

  test("links a default-sized button without an icon to the reservation page", () => {
    const { tree, button } = renderButton({});

    expect(findElementsOfType(tree, LocalizedLink)[0]?.props.href).toBe(
      "/reservation"
    );
    expect(button?.props.size).toBe("default");
    expect(findElementsOfType(tree, Calendar)).toHaveLength(0);
    expect(buttonClasses(button?.props.className)).not.toContain("w-full");
  });

  test("stretches the full variant and keeps the caller's classes", () => {
    const { button } = renderButton({ variant: "full", className: "mt-4" });
    const { button: defaultButton } = renderButton({ className: "mt-4" });

    expect(buttonClasses(button?.props.className)).toEqual(
      expect.arrayContaining(["w-full", "font-semibold", "mt-4"])
    );
    expect(buttonClasses(defaultButton?.props.className)).toContain("mt-4");
    expect(buttonClasses(defaultButton?.props.className)).not.toContain(
      "font-semibold"
    );
  });

  test("passes the size, icon, and click handler through", () => {
    const onClick = mock();
    const { tree, button } = renderButton({
      size: "sm",
      showIcon: true,
      onClick,
    });

    expect(button?.props.size).toBe("sm");
    expect(button?.props.onClick).toBe(onClick);
    expect(findElementsOfType(tree, Calendar)).toHaveLength(1);
  });
});
