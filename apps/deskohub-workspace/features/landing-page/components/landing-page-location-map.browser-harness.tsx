import { createRoot } from "react-dom/client";
import { LandingPageLocationMap } from "./landing-page-location-map";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <LandingPageLocationMap activateLabel="Activate map" label="Location" />
  );
}
