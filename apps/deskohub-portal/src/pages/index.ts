import type { APIRoute } from "astro";

import { createLocaleRedirectResponse } from "../lib/locale-routing";

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  return createLocaleRedirectResponse(request);
};

export const HEAD: APIRoute = ({ request }) => {
  return createLocaleRedirectResponse(request);
};
