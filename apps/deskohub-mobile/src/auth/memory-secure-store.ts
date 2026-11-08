/**
 * SecureStore's key-value shape over a Map. It holds a session that isn't the
 * app's yet, and stands in for SecureStore in tests, where it outlives an
 * "app restart" like the device keychain does.
 */
export const makeMemorySecureStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};

export type MemorySecureStore = ReturnType<typeof makeMemorySecureStore>;
