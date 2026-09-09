const unavailableError = {
  message: "Unavailable in component renderer",
  status: 503,
} as const;

export const authClient = {
  getSession: async () => ({
    data: {
      session: { id: "synthetic-session" },
      user: { id: "synthetic-user", email: "ada@example.test" },
    },
    error: null,
  }),
  signIn: {
    magicLink: async () => ({ error: unavailableError }),
  },
  signOut: async () => ({ error: unavailableError }),
};
