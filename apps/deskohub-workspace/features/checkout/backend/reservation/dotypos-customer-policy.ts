export const splitCustomerName = (name: string) => {
  const [firstName = "", ...lastNameParts] = name.trim().split(/\s+/);
  return {
    firstName,
    lastName: lastNameParts.join(" ") || undefined,
  };
};
