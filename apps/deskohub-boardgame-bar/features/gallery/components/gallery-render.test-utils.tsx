import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The locale the rendered gallery components read from the route. */
export const routeLocale = "en-US";

/** Renders a client component on the route of {@link routeLocale}. */
export const renderOnLocaleRoute = (node: ReactNode) =>
  renderToStaticMarkup(
    <PathParamsContext.Provider value={{ locale: routeLocale }}>
      {node}
    </PathParamsContext.Provider>
  );

/** A promise React's `use` reads without suspending. */
export const settled = <T,>(value: T): Promise<T> =>
  Object.assign(Promise.resolve(value), { status: "fulfilled", value });

export const galleryAsset = (publicId: string, caption?: string) =>
  ({
    public_id: publicId,
    secure_url: `https://res.cloudinary.com/cloud/image/upload/${publicId}.jpg`,
    width: 1600,
    height: 900,
    format: "jpg",
    resource_type: "image",
    created_at: "2026-01-01T00:00:00Z",
    context: {
      custom: { alt: `Alt for ${publicId}`, ...(caption && { caption }) },
    },
  }) as unknown as CloudinaryAsset;

/** The alt texts of the rendered images, in document order. */
export const renderedImageAlts = (html: string) =>
  [...html.matchAll(/<img[^>]*\salt="([^"]*)"/g)].map(([, alt]) => alt);
