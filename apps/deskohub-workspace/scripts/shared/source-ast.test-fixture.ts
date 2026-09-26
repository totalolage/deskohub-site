/**
 * Fixture module for the source-ast regression tests: a deliberately varied
 * snippet that mimics the tracked lane wiring (two ordered awaited captures
 * inside one callback) without belonging to any runtime path.
 */
type FixturePage = { readonly url: string };

type FixtureTarget = { readonly id: string };

declare function captureAccountReview(
  page: FixturePage,
  target: FixtureTarget
): Promise<void>;

export const makeFixtureCallback =
  (page: FixturePage, desktop: FixtureTarget, mobileTarget?: FixtureTarget) =>
  async (): Promise<void> => {
    await captureAccountReview(page, desktop);
    if (mobileTarget) {
      await captureAccountReview(page, mobileTarget);
    }
  };
