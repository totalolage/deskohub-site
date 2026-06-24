import "server-only";

import { generateStaticMapImage } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

export const generateWorkspaceLocationMapImage = () =>
  generateStaticMapImage(workspaceLocationMapImageOptions);
