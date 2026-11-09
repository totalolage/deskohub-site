/**
 * The contact a review account books with: its synthetic login email on the
 * reserved test domain, a fixed name, and a London number Ofcom reserves for
 * drama, so nobody can be reached through it. It's never stored.
 */
export const getReviewAccountContact = (email: string) => ({
  name: "App Review",
  email,
  phone: "+44 20 7946 0123",
});
