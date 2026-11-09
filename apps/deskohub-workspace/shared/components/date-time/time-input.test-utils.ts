/**
 * Types a complete time into a time field the way browsers keep it: a time
 * outside the field's `min` and `max` stays the field's value and is flagged
 * as out of range. happy-dom empties such a time instead, which hides what a
 * person typing it sees. The field holds what it is given from then on.
 */
export const typeTimeAsBrowsers = async (
  field: HTMLInputElement,
  time: string
) => {
  // React DOM must load after a test registers its DOM, so this helper module
  // can't import Testing Library up front.
  const { fireEvent } = await import("@testing-library/react");
  let held = time;
  Object.defineProperty(field, "value", {
    configurable: true,
    get: () => held,
    set: (next: string) => {
      held = String(next);
    },
  });
  fireEvent.input(field);
};
