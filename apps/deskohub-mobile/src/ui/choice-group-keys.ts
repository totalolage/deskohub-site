/**
 * The option a key press in a radio group lands on, as the ARIA radio group
 * pattern has it: arrows step to the next or previous option, wrapping at
 * either end, Home and End jump to the first and last, and Space chooses the
 * focused one. Any other key is left to the platform.
 */
export const choiceIndexForKey = (
  key: string,
  index: number,
  count: number
): number | undefined => {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case " ":
      return index;
    default:
      return undefined;
  }
};

/**
 * The option holding the group's one keyboard tab stop: the chosen one, or
 * the first while none is.
 */
export const tabStopIndex = <T>(values: ReadonlyArray<T>, value: T) =>
  Math.max(values.indexOf(value), 0);
