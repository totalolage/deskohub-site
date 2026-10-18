const segmentsOf = (path: string) => path.split("/").filter(Boolean);

// Next.js prefers a static segment to a dynamic one, a dynamic one to a
// catch-all, and a catch-all to an optional catch-all.
const segmentRank = (segment: string) => {
  if (segment.startsWith("[[...")) return 3;
  if (segment.startsWith("[...")) return 2;
  if (segment.startsWith("[")) return 1;
  return 0;
};

const matchesRouteTemplate = (
  templateSegments: readonly string[],
  pathSegments: readonly string[]
) => {
  for (const [index, segment] of templateSegments.entries()) {
    const rank = segmentRank(segment);
    if (rank === 3) return true;
    if (rank === 2) return pathSegments.length > index;
    if (index >= pathSegments.length) return false;
    if (rank === 0 && segment !== pathSegments[index]) return false;
  }
  return pathSegments.length === templateSegments.length;
};

const compareSpecificity = (
  left: readonly string[],
  right: readonly string[]
) => {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference =
      segmentRank(left[index] ?? "") - segmentRank(right[index] ?? "");
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

/**
 * Builds a lookup from a pathname to the Next.js app route template, such as
 * `/[locale]/reservation/status/[orderId]`, that would render it. A template
 * with static segments wins over one with dynamic segments, as in Next.js.
 */
export const routeTemplateMatcher = <Template extends string>(
  templates: readonly Template[]
) => {
  const ordered = templates
    .map((template) => ({ template, segments: segmentsOf(template) }))
    .sort((left, right) => compareSpecificity(left.segments, right.segments));

  return (pathname: string): Template | undefined => {
    const pathSegments = segmentsOf(pathname);
    return ordered.find(({ segments }) =>
      matchesRouteTemplate(segments, pathSegments)
    )?.template;
  };
};
