export const getAdministrationPagination = ({
  pageSize,
  requestedPage,
  total,
}: {
  readonly pageSize: number;
  readonly requestedPage?: number;
  readonly total: number;
}) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage ?? 1), pageCount);
  return {
    offset: (page - 1) * pageSize,
    page,
    pageCount,
  };
};

export const getAdministrationExternalOrderPageIds = <
  ExternalId extends string,
  Id extends string,
>({
  offset,
  orderedExternalIds,
  pageSize,
  references,
}: {
  readonly offset: number;
  readonly orderedExternalIds: readonly ExternalId[];
  readonly pageSize: number;
  readonly references: readonly {
    readonly externalId: ExternalId | null;
    readonly id: Id;
  }[];
}) => {
  const externalOrder = new Map(
    orderedExternalIds.map((externalId, index) => [externalId, index] as const)
  );
  return references
    .toSorted((left, right) => {
      const leftIndex = left.externalId
        ? externalOrder.get(left.externalId)
        : undefined;
      const rightIndex = right.externalId
        ? externalOrder.get(right.externalId)
        : undefined;
      if (leftIndex === undefined && rightIndex === undefined) {
        return left.id.localeCompare(right.id);
      }
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex || left.id.localeCompare(right.id);
    })
    .slice(offset, offset + pageSize)
    .map(({ id }) => id);
};
