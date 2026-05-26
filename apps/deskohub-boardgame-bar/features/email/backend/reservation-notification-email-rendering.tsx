import type {
  Customer,
  Reservation,
} from "@deskohub/dotypos/generated/types.gen";
import {
  BoardgameEmailRow,
  MultilineEmailText,
  renderBoardgameEmailHtml,
} from "./email-rendering";

const containerStyle = {
  fontFamily: "Arial, sans-serif",
  maxWidth: "600px",
  margin: "0 auto",
} as const;
const cellStyle = { padding: "8px", borderBottom: "1px solid #eee" } as const;

export const renderReservationNotificationEmailHtml = ({
  reservation,
  customerName,
  customerEmail,
  customerPhone,
  formattedDate,
  formattedTime,
  duration,
  specialRequests,
  adminReservationUrl,
  locale,
  receivedAt,
}: {
  readonly reservation: Reservation;
  readonly customerName: string;
  readonly customerEmail?: Customer["email"];
  readonly customerPhone?: Customer["phone"];
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly duration: number;
  readonly specialRequests?: string;
  readonly adminReservationUrl: string;
  readonly locale: string;
  readonly receivedAt: string;
}) =>
  renderBoardgameEmailHtml(
    <div style={containerStyle}>
      <h2 style={{ color: "#333" }}>Nová rezervace stolů</h2>

      <div
        style={{
          backgroundColor: "#f0f0f0",
          padding: "15px",
          borderRadius: "5px",
          margin: "20px 0",
        }}
      >
        <p style={{ margin: "5px 0" }}>
          <strong>ID rezervace:</strong> {reservation.id ?? "pending"}
        </p>
        <p style={{ margin: "5px 0" }}>
          <strong>Datum:</strong> {formattedDate}
        </p>
        <p style={{ margin: "5px 0" }}>
          <strong>Čas:</strong> {formattedTime}
        </p>
        <p style={{ margin: "5px 0" }}>
          <strong>Doba trvání:</strong> {duration}{" "}
          {duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}
        </p>
        <p style={{ margin: "5px 0" }}>
          <strong>Počet hostů:</strong> {reservation.seats}
        </p>
      </div>

      <h3 style={{ color: "#666" }}>Kontaktní údaje zákazníka:</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <BoardgameEmailRow
            label="Jméno:"
            value={customerName}
            cellStyle={cellStyle}
          />
          {customerEmail ? (
            <BoardgameEmailRow
              label="Email:"
              value={<a href={`mailto:${customerEmail}`}>{customerEmail}</a>}
              cellStyle={cellStyle}
            />
          ) : null}
          {customerPhone ? (
            <BoardgameEmailRow
              label="Telefon:"
              value={<a href={`tel:${customerPhone}`}>{customerPhone}</a>}
              cellStyle={cellStyle}
            />
          ) : null}
        </tbody>
      </table>

      {specialRequests ? (
        <>
          <h3 style={{ color: "#666", marginTop: "20px" }}>
            Speciální požadavky:
          </h3>
          <div
            style={{
              backgroundColor: "#fff3cd",
              padding: "12px",
              borderRadius: "4px",
              borderLeft: "4px solid #ffc107",
            }}
          >
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              <MultilineEmailText value={specialRequests} />
            </p>
          </div>
        </>
      ) : null}

      <div
        style={{
          marginTop: "30px",
          padding: "15px",
          backgroundColor: "#e8f5e9",
          borderRadius: "5px",
        }}
      >
        <p style={{ margin: "5px 0", color: "#2e7d32" }}>
          <strong>Akce potřebná:</strong>
        </p>
        <p style={{ margin: "5px 0" }}>
          Tato rezervace čeká na potvrzení{" "}
          <a
            href={adminReservationUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            v systému Dotypos
          </a>
          .
        </p>
        <p style={{ margin: "5px 0" }}>
          Zákazník obdržel email s informací, že rezervace byla přijata a čeká
          na potvrzení.
        </p>
      </div>

      <hr
        style={{
          margin: "30px 0",
          border: "none",
          borderTop: "1px solid #eee",
        }}
      />
      <p style={{ color: "#999", fontSize: "12px" }}>
        Jazyk zákazníka: {locale}
        <br />
        Zdroj: Webový formulář
        <br />
        Čas přijetí: {receivedAt}
      </p>
    </div>
  );
