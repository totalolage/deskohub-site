import type { Locale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import type { ReservationConfirmationData } from "../types/email.types";

/**
 * Email template for confirmed reservations
 */
export function renderReservationConfirmedEmail(
  data: ReservationConfirmationData,
  locale: Locale
) {
  const isEnglish = locale.startsWith("en");

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: siteConstants.workingHours.timezone,
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: siteConstants.workingHours.timezone,
    });
  };

  const subject = isEnglish
    ? `✅ Reservation Confirmed - ${formatDate(data.datetime)}`
    : `✅ Rezervace potvrzena - ${formatDate(data.datetime)}`;

  const html = `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <div style="background: white; width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h1 style="color: white; margin: 0; font-size: 28px;">
          ${isEnglish ? "Reservation Confirmed!" : "Rezervace potvrzena!"}
        </h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          ${isEnglish ? `Dear ${data.customerName},` : `Vážený/á ${data.customerName},`}
        </p>
        
        <p style="font-size: 16px; margin-bottom: 20px; color: #16a34a; font-weight: bold;">
          ${
            isEnglish
              ? "Great news! Your reservation has been confirmed."
              : "Skvělé zprávy! Vaše rezervace byla potvrzena."
          }
        </p>

        <p style="font-size: 16px; margin-bottom: 20px;">
          ${
            isEnglish
              ? "We look forward to seeing you at DeskoHub. Please find your reservation details below."
              : "Těšíme se na vás v DeskoHub. Níže najdete detaily vaší rezervace."
          }
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #22c55e;">
          <h2 style="color: #16a34a; margin-top: 0;">
            ${isEnglish ? "Confirmed Reservation Details" : "Potvrzené detaily rezervace"}
          </h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Reservation ID:" : "ID rezervace:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-family: monospace;">
                #${data.reservationId}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Date:" : "Datum:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${formatDate(data.datetime)}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Time:" : "Čas:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${formatTime(data.datetime)}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Duration:" : "Doba trvání:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${data.duration} ${isEnglish ? "hours" : "hodin"}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Number of Guests:" : "Počet hostů:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${data.guestCount}
              </td>
            </tr>
            ${
              data.tableName
                ? `
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Table:" : "Stůl:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${data.tableName}
              </td>
            </tr>
            `
                : ""
            }
            ${
              data.specialRequests
                ? `
            <tr>
              <td style="padding: 10px 0;">
                <strong>${isEnglish ? "Special Requests:" : "Speciální požadavky:"}</strong>
              </td>
              <td style="padding: 10px 0;">
                ${data.specialRequests}
              </td>
            </tr>
            `
                : ""
            }
          </table>
        </div>

        <div style="background: #dcfce7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 0; color: #166534;">
            <strong>${isEnglish ? "Important Information:" : "Důležité informace:"}</strong><br>
            ${
              isEnglish
                ? "• Please arrive on time for your reservation<br>• If you need to cancel or modify, please contact us at least 24 hours in advance<br>• We'll hold your table for 15 minutes after the reservation time"
                : "• Prosíme o včasný příchod<br>• V případě potřeby zrušení nebo změny nás kontaktujte alespoň 24 hodin předem<br>• Váš stůl budeme držet 15 minut po času rezervace"
            }
          </p>
        </div>

        ${
          data.confirmationUrl
            ? `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.confirmationUrl.toString()}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            ${isEnglish ? "View Reservation" : "Zobrazit rezervaci"}
          </a>
        </div>
        `
            : ""
        }

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <h3 style="color: #333;">
            ${isEnglish ? "Need to make changes?" : "Potřebujete provést změny?"}
          </h3>
          <p style="font-size: 14px; color: #666;">
            ${
              isEnglish
                ? `Contact us at ${siteConstants.contact.infoEmail} or call ${siteConstants.contact.phone}`
                : `Kontaktujte nás na ${siteConstants.contact.infoEmail} nebo volejte ${siteConstants.contact.phone}`
            }
          </p>
        </div>

        <p style="font-size: 16px; margin-top: 30px;">
          ${isEnglish ? "See you soon!" : "Brzy na viděnou!"}<br>
          <strong>DeskoHub Team</strong>
        </p>
      </div>

      <div style="text-align: center; padding: 20px; color: #999; font-size: 14px;">
        <p>
          DeskoHub<br>
          ${isEnglish ? "Board Game Bar & Coworking Space" : "Deskové hry & Coworking"}<br>
          📍 Prague, Czech Republic<br>
          📧 ${siteConstants.contact.infoEmail} | 📞 ${siteConstants.contact.phone}
        </p>
      </div>
    </body>
    </html>
  `;

  const text = isEnglish
    ? `✅ Reservation Confirmed!

Dear ${data.customerName},

Great news! Your reservation has been confirmed.

We look forward to seeing you at DeskoHub. Please find your reservation details below.

Confirmed Reservation Details:
- Reservation ID: #${data.reservationId}
- Date: ${formatDate(data.datetime)}
- Time: ${formatTime(data.datetime)}
- Duration: ${data.duration} hours
- Number of Guests: ${data.guestCount}
${data.tableName ? `- Table: ${data.tableName}` : ""}
${data.specialRequests ? `- Special Requests: ${data.specialRequests}` : ""}

Important Information:
• Please arrive on time for your reservation
• If you need to cancel or modify, please contact us at least 24 hours in advance
• We'll hold your table for 15 minutes after the reservation time

Need to make changes?
Contact us at ${siteConstants.contact.infoEmail} or call ${siteConstants.contact.phone}

See you soon!
DeskoHub Team

DeskoHub - Board Game Bar & Coworking Space
Prague, Czech Republic
${siteConstants.contact.infoEmail} | ${siteConstants.contact.phone}`
    : `✅ Rezervace potvrzena!

Vážený/á ${data.customerName},

Skvělé zprávy! Vaše rezervace byla potvrzena.

Těšíme se na vás v DeskoHub. Níže najdete detaily vaší rezervace.

Potvrzené detaily rezervace:
- ID rezervace: #${data.reservationId}
- Datum: ${formatDate(data.datetime)}
- Čas: ${formatTime(data.datetime)}
- Doba trvání: ${data.duration} hodin
- Počet hostů: ${data.guestCount}
${data.tableName ? `- Stůl: ${data.tableName}` : ""}
${data.specialRequests ? `- Speciální požadavky: ${data.specialRequests}` : ""}

Důležité informace:
• Prosíme o včasný příchod
• V případě potřeby zrušení nebo změny nás kontaktujte alespoň 24 hodin předem
• Váš stůl budeme držet 15 minut po času rezervace

Potřebujete provést změny?
Kontaktujte nás na ${siteConstants.contact.infoEmail} nebo volejte ${siteConstants.contact.phone}

Brzy na viděnou!
DeskoHub Team

DeskoHub - Deskové hry & Coworking
Praha, Česká republika
${siteConstants.contact.infoEmail} | ${siteConstants.contact.phone}`;

  return { subject, html, text };
}
