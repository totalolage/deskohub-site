/**
 * Whole sentences joined into one paragraph. A condition that does not hold
 * (`false`) leaves its sentence out.
 */
export const joinSentences = (
  ...sentences: ReadonlyArray<string | false>
): string =>
  sentences
    .filter((sentence): sentence is string => sentence !== false)
    .join(" ");
