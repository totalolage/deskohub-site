import { createLocaleRedirectResponse } from "./locale-routing";

const expectedSearch = "?utm_source=newsletter&utm_campaign=launch&gclid=abc";
const response = createLocaleRedirectResponse(
  new Request(`https://www.deskohub.cz/${expectedSearch}`)
);
const location = response.headers.get("location");

if (!location) {
  throw new Error("Expected locale redirect to include a location header");
}

const search = new URL(location).search;

if (search !== expectedSearch) {
  throw new Error(`Expected ${expectedSearch}, received ${search}`);
}
