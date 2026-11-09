import { createRoot } from "react-dom/client";
import { RememberSharedReferralCode } from "./remember-shared-referral-code";

// Mounts the real component and reports what the shown page remembers: on a
// page Chrome prerendered, once it is activated.
const initiallyPrerendered =
  (document as Document & { readonly prerendering?: boolean }).prerendering ===
  true;
const framed = window.self !== window.top;
const report = () => {
  // Leave the component's own activation handler time to run first.
  setTimeout(() => {
    void fetch("/evidence", {
      body: JSON.stringify({
        cookie: document.cookie,
        framed,
        initiallyPrerendered,
      }),
      method: "POST",
    });
  }, 250);
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<RememberSharedReferralCode />);
if (initiallyPrerendered) {
  document.addEventListener("prerenderingchange", report, { once: true });
} else {
  report();
}
