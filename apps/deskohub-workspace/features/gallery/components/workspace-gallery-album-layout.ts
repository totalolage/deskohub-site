/** Masonry columns for the album's width: one on phones, two on tablets, else three. */
export const galleryAlbumColumns = (containerWidth: number): number => {
  if (containerWidth < 520) return 1;
  if (containerWidth < 900) return 2;
  return 3;
};

/** The gap between album photos, tighter on phones. */
export const galleryAlbumSpacing = (containerWidth: number): number =>
  containerWidth < 640 ? 14 : 18;
