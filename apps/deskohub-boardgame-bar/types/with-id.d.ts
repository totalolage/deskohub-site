export type WithId<T extends { id?: unknown }> = T & {
  id: NonNullable<T["id"]>;
};
