/** A discount form's save outcome, shown until the operator edits the form. */
export type MutationFormFeedback<Values> = {
  readonly kind: "error" | "success";
  readonly message: string;
  /** The form values this feedback was shown with; unset until it renders. */
  readonly formValues?: Values;
};

/**
 * New feedback adopts the values it first renders with, which already include
 * a success reset; any later edit to those values clears it. Returns the same
 * feedback when nothing changes.
 */
export const reconcileMutationFormFeedback = <Values>(
  feedback: MutationFormFeedback<Values> | null,
  formValues: Values
): MutationFormFeedback<Values> | null => {
  if (!feedback || feedback.formValues === formValues) return feedback;
  return feedback.formValues ? null : { ...feedback, formValues };
};
