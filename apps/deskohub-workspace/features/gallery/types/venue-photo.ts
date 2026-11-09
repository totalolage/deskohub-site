import type { SlideImage } from "yet-another-react-lightbox";
import type {} from "yet-another-react-lightbox/plugins/captions";

export type VenuePhoto = {
  readonly id: string;
  readonly publicId: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly caption?: string;
  readonly detail?: string;
  readonly lightbox: SlideImage;
};
