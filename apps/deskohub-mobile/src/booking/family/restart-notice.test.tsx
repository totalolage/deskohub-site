import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { isValidElement } from "react";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { Notice } from "../../ui/notice";
import { elementTree } from "../../ui/testing/element-tree";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { restartMessage } from "./booking-family-copy";
import { RestartNotice } from "./restart-notice";

/** The Notice a family screen shows for `reason`, in English. */
const noticeFor = (reason: Option.Option<CheckoutRestartReason>) => {
  const tree = elementTree(RestartNotice, { reason }, (component) => (
    <AppLocaleProvider locale="en-US">{component}</AppLocaleProvider>
  ));
  if (!isValidElement<{ tone: string; message?: string }>(tree)) {
    throw new Error("RestartNotice rendered no element");
  }
  expect(tree.type).toBe(Notice);
  return tree.props;
};

describe("RestartNotice", () => {
  test("says the hold expired after an expired hold's return", () => {
    expect(noticeFor(Option.some("hold_expired"))).toEqual({
      tone: "info",
      message: restartMessage("hold_expired", "en-US"),
    });
  });

  test("stays mounted and empty without a reason, so the next one is announced", () => {
    expect(noticeFor(Option.none())).toEqual({
      tone: "info",
      message: undefined,
    });
  });
});
