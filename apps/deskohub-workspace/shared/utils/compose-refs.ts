import { Predicate } from "effect";
import type { Ref, RefCallback } from "react";

/** One ref callback that sets every given ref to the element. */
export const composeRefs =
  <Element>(
    ...refs: ReadonlyArray<Ref<Element> | undefined>
  ): RefCallback<Element> =>
  (element) => {
    for (const ref of refs) {
      if (Predicate.isFunction(ref)) ref(element);
      else if (ref) ref.current = element;
    }
  };
