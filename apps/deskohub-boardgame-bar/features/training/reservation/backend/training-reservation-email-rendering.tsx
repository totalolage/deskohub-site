import type { ReactNode } from "react";
import {
  BoardgameEmailRow,
  MultilineEmailText,
  renderBoardgameEmailHtml,
} from "@/features/email/backend/email-rendering";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { siteConstants } from "@/shared/utils/constants";

// Business email copy is Czech regardless of the customer locale.
const businessEmailLocale: Locale = "cs-CZ";

const containerStyle = {
  fontFamily: "Arial, sans-serif",
  maxWidth: "600px",
  margin: "0 auto",
} as const;
const headingStyle = { color: "#333" } as const;
const subheadingStyle = { color: "#666" } as const;
const tableStyle = { width: "100%", borderCollapse: "collapse" } as const;
const cellStyle = { padding: "8px", borderBottom: "1px solid #eee" } as const;
const hrStyle = {
  margin: "30px 0",
  border: "none",
  borderTop: "1px solid #eee",
} as const;
const footerStyle = { color: "#999", fontSize: "12px" } as const;

const TrainingEmailContainer = ({
  children,
}: {
  readonly children: ReactNode;
}) => <div style={containerStyle}>{children}</div>;

export const renderBusinessTrainingReservationEmailHtml = ({
  fullName,
  company,
  role,
  email,
  phone,
  formattedDate,
  formattedTime,
  formattedDuration,
  specialRequirements,
}: {
  readonly fullName: string;
  readonly company: string;
  readonly role: string;
  readonly email: string;
  readonly phone: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly formattedDuration: string;
  readonly specialRequirements?: string;
}) =>
  renderBoardgameEmailHtml(
    <TrainingEmailContainer>
      <h2 style={headingStyle}>
        {m["trainingReservation.email.businessHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h2>

      <h3 style={subheadingStyle}>
        {m["trainingReservation.email.contactDetailsHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h3>
      <table style={tableStyle}>
        <tbody>
          {fullName ? (
            <BoardgameEmailRow
              label={m["trainingReservation.email.nameLabel"](undefined, {
                locale: businessEmailLocale,
              })}
              value={fullName}
              cellStyle={cellStyle}
            />
          ) : null}
          {company ? (
            <BoardgameEmailRow
              label={m["trainingReservation.email.companyLabel"](undefined, {
                locale: businessEmailLocale,
              })}
              value={company}
              cellStyle={cellStyle}
            />
          ) : null}
          {role ? (
            <BoardgameEmailRow
              label={m["trainingReservation.email.roleLabel"](undefined, {
                locale: businessEmailLocale,
              })}
              value={role}
              cellStyle={cellStyle}
            />
          ) : null}
          <BoardgameEmailRow
            label={m["trainingReservation.email.emailLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={email}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["trainingReservation.email.phoneLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={phone}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>
        {m["trainingReservation.email.reservationDetailsHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label={m["trainingReservation.email.dateLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={formattedDate}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["trainingReservation.email.timeLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={formattedTime}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["trainingReservation.email.durationLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={formattedDuration}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      {specialRequirements ? (
        <>
          <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>
            {m["trainingReservation.email.specialRequirementsHeading"](
              undefined,
              { locale: businessEmailLocale }
            )}
          </h3>
          <p
            style={{
              backgroundColor: "#f5f5f5",
              padding: "12px",
              borderRadius: "4px",
              whiteSpace: "pre-wrap",
            }}
          >
            <MultilineEmailText value={specialRequirements} />
          </p>
        </>
      ) : null}

      <div
        style={{
          backgroundColor: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "4px",
          padding: "15px",
          marginTop: "20px",
        }}
      >
        <h3 style={{ color: "#856404", marginTop: 0 }}>
          {m["trainingReservation.email.actionHeading"](undefined, {
            locale: businessEmailLocale,
          })}
        </h3>
        <p style={{ color: "#856404", margin: 0 }}>
          <strong>
            {m["trainingReservation.email.actionCall"](undefined, {
              locale: businessEmailLocale,
            })}
          </strong>
          <br />
          {m["trainingReservation.email.phoneLabel"](undefined, {
            locale: businessEmailLocale,
          })}{" "}
          <strong>{phone}</strong>
        </p>
      </div>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        {m["trainingReservation.email.footer"](undefined, {
          locale: businessEmailLocale,
        })}
      </p>
    </TrainingEmailContainer>
  );

export const renderTrainingReservationConfirmationEmailHtml = ({
  locale,
  formattedDate,
  formattedTime,
  formattedDuration,
}: {
  readonly locale?: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly formattedDuration: string;
}) => {
  const messageLocale: Locale = locale === "cs-CZ" ? "cs-CZ" : "en-US";
  return renderBoardgameEmailHtml(
    <TrainingEmailContainer>
      <h2 style={headingStyle}>
        {m["trainingReservation.email.confirmationHeading"](undefined, {
          locale: messageLocale,
        })}
      </h2>
      <p>
        {m["trainingReservation.email.confirmationThankYou"](undefined, {
          locale: messageLocale,
        })}
      </p>

      <div
        style={{
          backgroundColor: "#e8f5e9",
          border: "1px solid #4caf50",
          borderRadius: "4px",
          padding: "15px",
          margin: "20px 0",
        }}
      >
        <p style={{ color: "#2e7d32", margin: 0 }}>
          <strong>
            {m["trainingReservation.email.whatsNextHeading"](undefined, {
              locale: messageLocale,
            })}
          </strong>
          <br />
          {m["trainingReservation.email.whatsNextCall"](undefined, {
            locale: messageLocale,
          })}
        </p>
      </div>

      <h3 style={subheadingStyle}>
        {m["trainingReservation.email.confirmationDetailsHeading"](undefined, {
          locale: messageLocale,
        })}
      </h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label={m["trainingReservation.email.dateLabel"](undefined, {
              locale: messageLocale,
            })}
            value={formattedDate}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["trainingReservation.email.timeLabel"](undefined, {
              locale: messageLocale,
            })}
            value={formattedTime}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["trainingReservation.email.durationLabel"](undefined, {
              locale: messageLocale,
            })}
            value={formattedDuration}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <p style={{ marginTop: "20px" }}>
        {m["trainingReservation.email.confirmationContactLine"](
          { contactEmail: siteConstants.contact.reservationEmail },
          { locale: messageLocale }
        )}
      </p>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        DeskoHub
        <br />
        {m["trainingReservation.email.footerTagline"](undefined, {
          locale: messageLocale,
        })}
      </p>
    </TrainingEmailContainer>
  );
};
