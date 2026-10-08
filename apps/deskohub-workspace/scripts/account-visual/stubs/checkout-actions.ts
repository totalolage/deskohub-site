const unavailableMessage =
  "Unavailable in component renderer: checkout action was not executed.";

const rendererGlobal = globalThis as typeof globalThis & {
  __accountVisualCheckoutActionCalls?: number;
};

rendererGlobal.__accountVisualCheckoutActionCalls = 0;

/**
 * The checkout visual fixture proves the real form's visible field-error
 * state. Its bound Server Action must remain unavailable in this component-
 * only renderer and is never invoked by the capture.
 */
export const applyDiscountCodeForm = async () => {
  rendererGlobal.__accountVisualCheckoutActionCalls =
    (rendererGlobal.__accountVisualCheckoutActionCalls ?? 0) + 1;
  return { serverError: unavailableMessage };
};
