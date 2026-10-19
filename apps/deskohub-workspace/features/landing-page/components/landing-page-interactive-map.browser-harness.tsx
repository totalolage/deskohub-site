import { createRoot } from "react-dom/client";
import { LandingPageInteractiveMap } from "./landing-page-interactive-map";

// Mounts the real map the way the home page shows it: on a direct load of the
// home page, or after a client-side navigation from another page, where the
// document keeps the policy of the page that loaded it.
const homePath = "/cs-CZ";
const root = document.getElementById("root");
const showMap = () => {
  if (root) createRoot(root).render(<LandingPageInteractiveMap />);
};

if (window.location.pathname === homePath) {
  showMap();
} else {
  document.getElementById("home-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    window.history.pushState(null, "", homePath);
    showMap();
  });
}
