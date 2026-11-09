import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { analytics } from "../../analytics/analytics";
import { clientRoot } from "../../testing/client-root";
import { useAccessPinView } from "./access-pin-view";

const { render } = clientRoot();

let capture: ReturnType<typeof spyOn<typeof analytics, "capture">>;
beforeEach(() => {
  capture = spyOn(analytics, "capture").mockImplementation(() => undefined);
});
afterEach(async () => {
  await render(null);
  capture.mockRestore();
});

/** A screen showing an order's PIN; `focused` is whether it is in front. */
const PinOnScreen = ({ focused }: { readonly focused: boolean }) => {
  useAccessPinView(focused);
  return null;
};

const views = () =>
  capture.mock.calls.filter(([event]) => event.name === "access PIN viewed")
    .length;

describe("access PIN view", () => {
  test("records one view when the PIN is shown, however often the screen renders", async () => {
    await render(<PinOnScreen focused />);
    await render(<PinOnScreen focused />);

    expect(capture.mock.calls).toEqual([[{ name: "access PIN viewed" }]]);
  });

  test("records another view each time the screen comes back to the front", async () => {
    await render(<PinOnScreen focused />);
    await render(<PinOnScreen focused={false} />);
    expect(views()).toBe(1);

    await render(<PinOnScreen focused />);
    expect(views()).toBe(2);
  });

  test("records no view while the screen is behind another", async () => {
    await render(<PinOnScreen focused={false} />);

    expect(views()).toBe(0);
  });

  test("records a new view when the PIN is shown again after it was withdrawn", async () => {
    await render(<PinOnScreen focused />);
    await render(null);
    await render(<PinOnScreen focused />);

    expect(views()).toBe(2);
  });
});
