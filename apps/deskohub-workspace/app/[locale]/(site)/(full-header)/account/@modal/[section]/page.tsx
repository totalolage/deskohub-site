/**
 * The slot at a section's path, which renders nothing like the bare account
 * path's slot page. Without it the slot resolves to its default there, so a
 * revalidating Server Action after the navigation switches from the bare path
 * to a section in place returns a slot tree the router cannot patch onto the
 * bare path's, and it reloads the whole page.
 */
export default function AccountModalSectionPage() {
  return null;
}
