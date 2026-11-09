type ConfirmationSearchParams = {
  [key: string]: string | string[] | undefined;
};

type TrainingRoomContact = {
  company: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  role: string | undefined;
};

/** Names the requester as the company (with the contact person when complete) or the person. */
export const getTrainingRoomDisplayName = ({
  company,
  firstName,
  lastName,
  role,
}: TrainingRoomContact): string => {
  if (company) {
    if (firstName && lastName && role) {
      return `${company} - ${firstName} ${lastName} (${role})`;
    }
    return company;
  }
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  return "";
};

/** Builds the confirmation details from the query parameters the request form submits. */
export const getTrainingRoomConfirmationDetails = (
  searchParams: ConfirmationSearchParams
) => {
  const dateString = searchParams.date as string | undefined;

  return {
    id: "", // No ID for training room reservations
    name: getTrainingRoomDisplayName({
      company: searchParams.company as string | undefined,
      firstName: searchParams.firstName as string | undefined,
      lastName: searchParams.lastName as string | undefined,
      role: searchParams.role as string | undefined,
    }),
    email: (searchParams.email as string) || "",
    phone: (searchParams.phone as string) || "",
    date: dateString ? new Date(dateString) : new Date(),
    time: (searchParams.time as string) || "",
    duration: searchParams.duration
      ? parseInt(searchParams.duration as string, 10)
      : undefined,
    specialRequests: searchParams.specialRequirements as string | undefined,
  };
};
