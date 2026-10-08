export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const formatNamesWithNumericRanges = (
  names: readonly (string | null | undefined)[]
): string => {
  const seenNames = new Set<string>();
  const numericNames: { readonly name: string; readonly value: number }[] = [];
  const otherNames: string[] = [];

  for (const candidate of names) {
    const name = candidate?.trim();
    if (!name || seenNames.has(name)) continue;

    seenNames.add(name);

    if (/^(0|[1-9]\d*)$/.test(name)) {
      const value = Number(name);
      if (Number.isSafeInteger(value)) {
        numericNames.push({ name, value });
        continue;
      }
    }

    otherNames.push(name);
  }

  numericNames.sort((left, right) => left.value - right.value);

  const formattedNumericNames: string[] = [];
  let start = 0;

  while (start < numericNames.length) {
    const first = numericNames[start];
    if (!first) break;

    let last = first;
    let next = start + 1;

    while (next < numericNames.length) {
      const candidate = numericNames[next];
      if (!candidate || candidate.value !== last.value + 1) break;

      last = candidate;
      next += 1;
    }

    if (next - start >= 3) {
      formattedNumericNames.push(`${first.name}-${last.name}`);
    } else {
      for (let index = start; index < next; index += 1) {
        const numericName = numericNames[index];
        if (numericName) formattedNumericNames.push(numericName.name);
      }
    }

    start = next;
  }

  return [...formattedNumericNames, ...otherNames].join(", ");
};
