// Documents that asked the browser to load another one. A document restored
// from the back-forward cache stays put, so the restore clears it.
const leavingDocuments = new WeakSet<Document>();

const resetOnRestore = (event: PageTransitionEvent) => {
  if (event.persisted) leavingDocuments.delete(document);
};

/**
 * Leaves this document for `url` with `location.assign`, or `replace`. Later
 * document navigations replace an earlier pending one, so a redirect that
 * could fire meanwhile, such as the signed-out account redirect after a
 * deletion, checks `isLeavingDocument` first. Reports whether the browser
 * accepted the navigation.
 */
export const leaveDocument = (
  url: string,
  { replace = false }: { readonly replace?: boolean } = {}
): boolean => {
  try {
    if (replace) window.location.replace(url);
    else window.location.assign(url);
  } catch {
    // The document is already leaving or the browser blocked navigation.
    return false;
  }
  leavingDocuments.add(document);
  window.addEventListener("pageshow", resetOnRestore, { once: true });
  return true;
};

/** Whether this document already asked the browser to load another one. */
export const isLeavingDocument = () => leavingDocuments.has(document);
