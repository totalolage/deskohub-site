import { idleLiveRegionLayout } from "./notice-presentation";

/**
 * How a form field presents its validation error. A missing or empty error
 * leaves the field valid. The error's live region stays mounted either way,
 * so assistive tech announces the next error, and while idle it takes no
 * layout space. It announces politely: a form that moves focus to its first
 * invalid field, or a field checked on blur, isn't cut off mid-sentence.
 */
export const fieldErrorPresentation = (error: string | undefined) => {
  const invalid = error !== undefined && error !== "";
  return {
    invalid,
    /** The field's accessible description, read when it gains focus. */
    description: invalid ? error : undefined,
    role: "status",
    live: "polite",
    /** The live region's layout while there is no error to show. */
    idleLayout: invalid ? undefined : idleLiveRegionLayout,
  } as const;
};
