import { workspaceSiteConstants } from "@/shared/utils";
import type {
  LegalDocumentBodies,
  LegalDocumentTranslation,
  LegalSection,
} from "../../legal-document-body";
import { companyAddress, companyName, contactEmail } from "../operator-details";

const commercialRegisterDisclosure =
  "Commercial register details are available in the linked official company extract.";

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Introductory Provisions",
    body: [
      <>
        1.1 These General Terms and Conditions (hereinafter referred to as
        "GTC") govern the mutual rights and obligations of the contracting
        parties arising in connection with the provision of services by{" "}
        {companyName}, ID No.:{" "}
        {workspaceSiteConstants.company.identificationNumber}, with its
        registered office at Turnovská 430/10, Prague 8, registered in the
        Commercial Register maintained by the Municipal Court in Prague
        (hereinafter referred to as the "Provider"), and the client (hereinafter
        referred to as the "Client").
      </>,
      "1.2 These GTC apply to coworking entries, online bookings of the meeting room and private office, and individually agreed short-term use of premises for events.",
      "1.3 The provisions of these GTC are an integral part of every contract concluded between the Provider and the Client.",
      "1.4 Legal relationships not regulated by these GTC are governed by the laws of the Czech Republic, in particular Act No. 89/2012 Coll., the Civil Code.",
      "1.5 If the Client is a Consumer, these GTC do not limit rights that cannot be waived under mandatory law.",
    ],
  },
  {
    heading: "2. Definition of Terms",
    body: [
      "2.1 Client means a natural or legal person who uses the Provider's services.",
      "2.2 Consumer means a Client acting outside the scope of their business activity.",
      "2.3 Premises means the coworking spaces, meeting room, private office, and event spaces operated by the Provider.",
      "2.4 Services means time-limited use of the selected Premises and the related services stated in the order.",
      "2.5 Tariff means the specific scope of coworking services and the conditions for their use according to the Provider's current Price List.",
      "2.6 Access PIN Code means the current code enabling entry into the Provider's premises.",
      "2.7 Booking means an order for a specific coworking entry, a meeting-room time slot, or a private-office date range, day count, and seat count.",
    ],
  },
  {
    heading: "3. Subject of the Contract",
    body: [
      "3.1 The Provider provides the Client with coworking services consisting of temporarily enabling the use of a shared workspace in the Provider's premises, within the scope of the selected tariff. Shared workspace means a non-exclusively designated workstation or part of the coworking space intended for routine work, without a guarantee of a specific desk or seat, unless expressly stated otherwise for a specific tariff.",
      "3.2 A meeting-room Booking entitles the Client to exclusive use of the selected room for the confirmed time and duration of one hour, four hours, or one Prague calendar day. A whole-day Booking runs from midnight on the selected day to midnight on the following day in the Europe/Prague time zone.",
      "3.3 A private-office Booking entitles the Client to exclusive use of the office for the confirmed number of seats throughout the selected calendar days. Each day runs from midnight to the following midnight in the Europe/Prague time zone, and the last date stated in the confirmation is included in the Booking.",
      "3.4 The specific capacity, equipment, price, time, and scope of a Booking are stated on the reservation page and in the order summary. The Client must not exceed the confirmed capacity and is responsible for guests and any other persons to whom the Client grants access.",
      "3.5 The Provider also enables short-term use of premises for events, always under an individual agreement.",
      "3.6 The Services grant a limited right to use the designated Premises and related services; they do not create a tenancy, registered office, establishment, or other real-property interest. Without a separate written agreement, the Client must not use the Premises' address as a registered office, business address, establishment, or mailing address.",
    ],
  },
  {
    heading: "4. Conclusion of the Contract",
    body: [
      "4.1 Service information on the website is an invitation to place an order. Before submitting the order, the Client reviews the selected Service, time, scope, final price, and contact or billing details and actively accepts these GTC and the House Rules.",
      '4.2 By selecting the "Order and pay" button, the Client submits a binding order with an obligation to pay the stated final price. The contract is concluded when the Provider sends confirmation after successful payment or, for an order with a zero final price, confirmation that the order has been completed. The confirmation contains the agreed Booking details and a secure link to its status and access information.',
      "4.3 Until the contract is concluded, capacity is held only temporarily. The Provider may reject an order in particular because of unavailability, an obvious pricing error, suspected fraud, or failure to meet the Booking conditions; any payment received will then be refunded without undue delay.",
      "4.4 Requests for coffee, a particular workstation, monitor, equipment, or other extras are subject to availability and are binding only if stated in the confirmation.",
      "4.5 A contract for an individually arranged event space is concluded when the Client accepts the Provider's specific offer.",
    ],
  },
  {
    heading: "5. Price and Payment Conditions",
    body: [
      "5.1 The Provider is not a payer of Value Added Tax (VAT). All prices are final.",
      "5.2 The final price shown in the order summary immediately before submission is decisive. The price is payable before the Service is provided using the offered payment method.",
      "5.3 The private-office price is calculated for each selected day as the daily office price plus the daily price for each confirmed seat. The meeting-room price corresponds to the selected one-hour, four-hour, or whole-day product.",
      "5.4 A discount applies only if shown in the order summary. If the price or an applicable discount changes before payment starts, the Provider will show a new summary and obtain the Client's renewed confirmation.",
      "5.5 The price of an individually arranged event space is stated in the offer according to the nature of the event.",
    ],
  },
  {
    heading: "6. Availability and Booking Changes",
    body: [
      "6.1 Availability is confirmed only for the time, scope, capacity, and product stated in the confirmation. A change of date, time, duration, day count, seat count, or product requires a new Booking or the Provider's express confirmation.",
      "6.2 A Booking may not be transferred or resold without the Provider's prior consent.",
      "6.3 The Provider may change the range, prices, and content of Services for future orders. A change does not affect an already concluded contract.",
      "6.4 If the Provider cannot supply a confirmed Service, it will, depending on the circumstances, offer a comparable replacement time or space, a proportionate price reduction, or a refund for the part not provided. This does not affect the Client's other statutory rights.",
    ],
  },
  {
    heading: "7. Access and Use of Services",
    body: [
      "7.1 The confirmation email contains a secure link to the Booking access page. Once a Booking is paid, confirmed locally and by live verification, and an Access PIN Code has been issued, the protected page displays that PIN together with the exact programmed validity bounds of the code. Acceptance of the code is determined solely by the lock system's programmed AlgoPIN bounds; the application does not impose its own display clock. The PIN is not included directly in the confirmation email.",
      "7.2 The Provider may change the Access PIN Code; the Client must use the code currently displayed on the Booking access page. Displaying the PIN does not extend the confirmed use of the Premises and creates no right to enter outside the confirmed time or into other premises. The Premises may be used only during the confirmed Booking time.",
      "7.3 The Client may disclose the PIN Code only to people authorized to attend the Booking, must protect it from everyone else, and is responsible for its use by the Client's guests. Suspected misuse must be reported to the Provider without delay.",
      "7.4 The Client and guests must observe the capacity, Booking purpose, confirmed time, and House Rules. The Client must ensure that guests leave the Premises by the end of the Booking.",
    ],
  },
  {
    heading: "8. Booking Cancellation",
    body: [
      <>
        8.1 The Client may request cancellation by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The Provider will process the request under the conditions shown in
        the order summary or individual offer and under mandatory law.
      </>,
      "8.2 Unless the order summary or individual offer states otherwise, cancellation alone does not create a separate contractual right to a refund. This does not affect rights arising from defective performance, a Consumer's statutory withdrawal right, or a failure by the Provider to supply the Service.",
      "8.3 Individually arranged events are cancelled under the conditions of the specific offer.",
      "8.4 The Client is not entitled to a refund merely because the Premises were not used, the Client arrived late, or the Client left early, unless the refund conditions under this article or mandatory law are met.",
    ],
  },
  {
    heading: "9. Consumer Right of Withdrawal",
    body: [
      "9.1 A Consumer may withdraw from a contract concluded online without giving a reason within 14 days after the contract is concluded, unless the right is excluded by law or has already expired in the particular case.",
      "9.2 If the Service is to begin before the period expires, as part of confirming the order the Consumer expressly requests that the Provider begin performance before the period ends and acknowledges that the withdrawal right expires after the Service has been fully performed. If the Consumer withdraws after performance begins but before it is complete, the Consumer pays a proportionate part of the price for performance already supplied, provided the statutory conditions are met.",
      <>
        9.3 Withdrawal may be sent as an unequivocal statement to the Provider's
        registered-office address or by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The deadline is met if the notice is sent before it expires.
      </>,
      "9.4 Following a valid withdrawal, the Provider will reimburse payments received without undue delay and no later than 14 days, using the same payment method unless the parties agree otherwise without additional cost to the Consumer.",
      "9.5 Model notice: “I hereby give notice that I withdraw from my contract for the following Service: [description and Booking number], ordered on [date]. Consumer name: [complete]. Consumer address: [complete]. Date: [complete]. Signature only if submitted on paper.” Use of the model is optional.",
      "9.6 The rights in this article apply only to a Consumer and operate alongside any more favorable cancellation terms stated in the order summary or individual offer.",
    ],
  },
  {
    heading: "10. Use Rules and Client Responsibility",
    body: [
      "10.1 The Client must use the Premises properly, only for the confirmed purpose, and in accordance with these GTC, the House Rules, safety instructions, and applicable law.",
      "10.2 The Client is responsible for guests and for damage caused by the Client's or guests' breach of duty. Normal wear and tear is not damage. Damage or a defect must be reported without undue delay.",
      "10.3 The Provider may proportionately restrict or end a Service for a serious or repeated breach of the GTC or House Rules, exceeding capacity, dangerous or illegal conduct, or misuse of access. This does not affect the Client's rights if the measure was not justified.",
    ],
  },
  {
    heading: "11. Provider Liability",
    body: [
      "11.1 The Provider is responsible for properly supplying the confirmed Service and for harm to the extent required by law. Nothing in these GTC excludes or limits liability that cannot validly be excluded or a Consumer's statutory rights.",
      "11.2 The Client is responsible for the Client's business activities, data, and items brought into the Premises. The Provider is liable for loss of or damage to an item only to the extent required by law; the Client should therefore not leave items unattended and should secure them appropriately.",
      "11.3 The Provider is not liable for an obstacle beyond its control that it could not reasonably foresee or prevent. If such an obstacle or temporary unavailability prevents a material part of the confirmed Service from being supplied, Article 6.4 applies.",
      "11.4 To the maximum extent permitted by law, the Provider is not liable to a Client who is not a Consumer for indirect loss, loss of profit, or loss of data unless caused intentionally or by gross negligence.",
    ],
  },
  {
    heading: "12. Defects and Complaints",
    body: [
      "12.1 The Client must report a Service defect without undue delay so that it can be remedied and provide at least contact details, the Booking number, a description of the defect, and the requested resolution.",
      <>
        12.2 A complaint may be made at the establishment, at the Provider's
        address, or by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The Provider will give a Consumer written confirmation of receipt and
        resolution.
      </>,
      "12.3 The Provider will decide a Consumer complaint immediately or, in a complex case, within three business days, and resolve it, including remedying the defect, without undue delay and no later than 30 days unless a longer period is agreed with the Consumer.",
      "12.4 Depending on the defect, the Client may request a remedy, replacement performance, a proportionate price reduction, or withdrawal from the contract if the statutory conditions are met.",
    ],
  },
  {
    heading: "13. Alternative Consumer Dispute Resolution",
    body: [
      "13.1 If a consumer dispute arising from a Service contract cannot be resolved directly, the Consumer may submit it to the Czech Trade Inspection Authority, Central Inspectorate – ADR Department, Gorazdova 1969/24, 120 00 Prague 2.",
      <>
        13.2 Information and the electronic form are available at{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . The Consumer must submit the claim no later than one year after first
        asserting the right with the Provider.
      </>,
    ],
  },
  {
    heading: "14. Special Provisions for Events",
    body: [
      "14.1 The Client is responsible for an individually arranged event and its participants.",
      "14.2 The Provider may end an event for a breach of law, the specific offer, these GTC, or the House Rules.",
    ],
  },
  {
    heading: "15. Final Provisions",
    body: [
      "15.1 The Provider may amend these GTC for contracts concluded after a new version takes effect. An already concluded Booking is governed by the version accepted at checkout unless a later amendment is more favorable to the Client or the Client expressly accepts it.",
      "15.2 An individual agreement takes precedence over these GTC. If one provision is invalid or ineffective, the remaining provisions are unaffected.",
      "15.3 These GTC become effective on August 12, 2026.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Introductory Provisions",
    body: [
      <>
        1.1 These House Rules (hereinafter referred to as the "House Rules")
        govern the rules of conduct and the use of coworking spaces, the meeting
        room, the private office, and event spaces operated by {companyName}, ID
        No.: {workspaceSiteConstants.company.identificationNumber}, with its
        registered office at Turnovská 430/10, Prague 8 (hereinafter referred to
        as the "Operator").
      </>,
      '1.2 These House Rules are binding for all persons located on the Operator\'s premises (hereinafter referred to as the "User").',
      "1.3 A Client who makes a Booking must ensure that guests and everyone granted access are familiar with and comply with these House Rules.",
    ],
  },
  {
    heading: "2. Basic Rules of Conduct",
    body: [
      "2.1 The User is obliged to behave considerately and with respect toward other persons within the premises.",
      "2.2 In shared and common areas, a User must maintain a level of quiet corresponding to normal, quiet conversation. In a meeting room or private office, noise must be contained within the booked space.",
      "2.3 A User must not excessively disturb other users or restrict their use of the premises. The Client is responsible for guests' conduct.",
    ],
  },
  {
    heading: "3. Prohibitions on the Premises",
    body: [
      "3.1 The following are prohibited on the premises:",
      "a) smoking, including the use of electronic cigarettes;",
      "b) using narcotic or psychotropic substances;",
      "c) entering the premises under the influence of alcohol or other addictive substances to an extent that limits the ability for safe behavior;",
      "d) performing activities in violation of legal regulations;",
      "e) damaging the equipment or facilities of the premises;",
      "f) harassing other users with inappropriate or aggressive behavior;",
      "g) exceeding confirmed capacity or transferring or reselling a Booking to an unauthorized person;",
      "h) using the Premises' address as a registered office, business address, establishment, or mailing address without a written agreement.",
    ],
  },
  {
    heading: "4. Use of the Premises",
    body: [
      "4.1 The User is obliged to use the premises exclusively for purposes corresponding to their nature and designation.",
      "4.2 A meeting room or private office may be used only during the confirmed time and within the confirmed capacity. Users must leave it with all their belongings by the end of the Booking.",
      "4.3 The User must maintain order and cleanliness and return the used space and shared equipment to an appropriate condition after use.",
      "4.4 Without the Operator's consent, a User must not move equipment, make alterations, install devices, or interfere with technical systems.",
      "4.5 A User must operate audiovisual, conferencing, and other equipment according to instructions and report a defect without undue delay. Equipment must be safely switched off after the Booking where appropriate.",
    ],
  },
  {
    heading: "5. Refreshments",
    body: [
      "5.1 The User is obliged to use refreshments reasonably and with regard to other users.",
      "5.2 The User must not abuse refreshments or waste them without justification.",
    ],
  },
  {
    heading: "6. Safety",
    body: [
      "6.1 The User is obliged to look out for their own safety and the safety of other persons.",
      "6.2 The User must not block escape routes or otherwise jeopardize the safe operation of the premises.",
      "6.3 The User is obliged to notify the Operator of any dangerous situation or defect without undue delay.",
      "6.4 The Client may disclose an Access PIN Code only to people authorized to attend the Booking. Users must protect it from disclosure to or observation by an unauthorized person and take particular care when entering it.",
      "6.5 Displaying the PIN on the Booking access page neither limits nor extends the authorized use of the Premises; acceptance of the code is determined solely by the lock system. Users may enter and remain only during the confirmed Booking time.",
      "6.6 Doors and other secured entrances must not be left open. Suspected code misuse or entry by an unauthorized person must be reported to the Operator without delay.",
      "6.7 The Client must ensure guests arrive and leave safely and must not grant them access outside the confirmed time or to other premises.",
      "6.8 The Operator or its authorized representative may enter a booked space when necessary for an emergency, safety, damage prevention, or essential maintenance and will inform the Client in advance where circumstances allow.",
    ],
  },
  {
    heading: "7. Liability for Damage",
    body: [
      "7.1 The User is liable for damage they cause to the Operator's property or the property of third parties.",
      "7.2 The Client is also responsible for damage caused by guests. Normal wear and tear is not damage.",
      "7.3 A User must immediately report damage, a lost key or access device, or a defect to the Operator.",
    ],
  },
  {
    heading: "8. Violation of House Rules",
    body: [
      "8.1 In the event of a violation of these House Rules, the Operator is entitled to take appropriate measures to ensure order and the protection of other users.",
      "8.2 Measures may include a request to remedy the breach, restricting access, removing a User from the premises, or ending a Booking where proportionate to the nature and seriousness of the breach.",
      "8.3 Where possible and the breach is not serious or dangerous, the Operator will give a reasonable opportunity to remedy it before ending a Booking.",
    ],
  },
  {
    heading: "9. Final Provisions",
    body: [
      "9.1 The Operator may amend these House Rules for future Bookings. A confirmed Booking is governed by the version accepted at checkout unless an immediate measure is necessary for safety or under mandatory law.",
      "9.2 These House Rules become effective on August 12, 2026.",
    ],
  },
];

const legalDocuments = {
  "privacy-policy": {
    updatedAt: "8 November 2026",
    sections: [
      {
        heading: "1. Controller",
        body: [
          <>
            The controller of your personal data is {companyName}, ID No.{" "}
            {workspaceSiteConstants.company.identificationNumber}, with
            establishment address at {companyAddress} and establishment ID{" "}
            {workspaceSiteConstants.company.establishmentId}.
          </>,
          commercialRegisterDisclosure,
          <>
            If you have any privacy-related request, contact us at{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
        ],
      },
      {
        heading: "2. What data we process",
        body: [
          <>
            We process the data you provide through our public website,
            especially contact details and message content sent through the
            contact form, plus reservation details: your name, email, phone
            number, selected reservation family and product, date or date range,
            start time, duration, seat count, and any coworking refreshment,
            monitor, or workstation preferences.
          </>,
          <>
            When you continue to checkout, we also process the quoted and paid
            amount, currency, applied discounts, payment and reservation
            identifiers and status, which terms you accepted and when, whether
            access was issued, and any optional billing details you request us
            to use for an accounting document. We do not receive your complete
            payment-card details from the payment provider.
          </>,
          <>
            If you create a customer account, we process your verified email
            address, your profile details, and the sign-in data needed to keep
            the account secure. We never ask for a password.
          </>,
          <>
            If you connect an AI assistant, such as ChatGPT or Claude, to your
            customer account, we process which assistant it is, the permissions
            you gave it and when, and the access credentials it uses. When the
            assistant starts a reservation for you, we record which assistant
            started it.
          </>,
          <>
            To run the website and prevent spam and abuse, we may also briefly
            process technical data such as your IP address and browser
            information.
          </>,
          <>
            To understand how search engines and AI assistants use the website,
            we sort requests into broad traffic categories based on browser
            information. We tell our analytics provider only the category, the
            name of a recognized assistant or search engine, the page and
            language, which form a blocked automated request tried to use, and,
            for our booking tools for AI assistants, which tool was used and
            whether it worked. We send nothing that identifies you, and this
            does not depend on analytics consent. We also add the category and
            the name of a recognized assistant to the reservation and payment
            records described in section 3.
          </>,
          <>
            If you consent to analytics cookies or similar technologies, we and
            our analytics service providers may process website usage and
            campaign measurement data, such as pageviews, browser and device
            information, IP-derived technical data, event types, and standard
            campaign parameters from links. With your analytics consent, we also
            add the records of your reservations and payments described in
            section 3 to your account's analytics profile.
          </>,
          <>
            If you separately opt in to future marketing communications, we also
            process your name, email address, preferred language, consent time,
            and the version of the marketing notice you accepted. We also record
            where you gave consent, for example in the reservation form, in your
            account, or through an assistant, and keep your choice with your
            customer record.
          </>,
        ],
      },
      {
        heading: "3. Why we process the data",
        body: [
          <>
            We use submitted contact, reservation, order, and payment data to
            check availability, prepare and confirm a Booking, hold capacity,
            collect or verify payment, issue access, send confirmations, provide
            requested accounting documents, handle cancellation or complaints,
            prevent duplicate or fraudulent orders, and support the Booking when
            you contact us.
          </>,
          <>
            We use customer account data to authenticate you, let you manage
            your profile, and connect the account with reservations made using
            the same verified email address.
          </>,
          <>
            If you connect an AI assistant, we use the connection so that, on
            your instructions, it can look up our offers, start a reservation
            that you then confirm and pay for on our website, and show you your
            reservations.
          </>,
          <>
            We do not use reservation or enquiry data for marketing unless you
            separately consent to receive marketing communication.
          </>,
          <>
            When you give that optional consent, we may use your email address
            for future Deskohub Workspace marketing and community
            communications. We do not share your contact details with another
            business for its own marketing.
          </>,
          <>
            With your analytics consent, we use analytics and external
            measurement services to understand site usage, reservation
            submission performance, and campaign effectiveness. These
            measurements don't include what you enter in the reservation form.
          </>,
          <>
            Whether or not you give analytics consent, we also send our
            analytics provider a record of each reservation and payment step,
            such as a started, completed, failed, or abandoned payment and its
            amount. We use these records to measure how reservations and
            payments go and to spot payment problems. They are linked to your
            reservation and, with your analytics consent, to your account's
            analytics profile. They don't include your name or contact details.
          </>,
          <>
            We also send selected customer data from our booking system Dotypos
            to our analytics provider to understand how customers use our
            services and how that relates to their activity on the website: the
            customer identifier, name, company name, email, phone, address,
            birthday, discount group, loyalty points, customer tags, and when
            the customer record was created, last changed, or deleted. Notes and
            other customer data stay in Dotypos. For a signed-in customer who
            gave analytics consent, the customer identifier links this data to
            their website analytics.
          </>,
        ],
      },
      {
        heading: "4. Legal basis",
        body: [
          <>
            Before a contract is concluded, we process reservation data to take
            steps at your request. After conclusion, we process it to perform
            the contract, including payment, access, support, cancellation, and
            complaints. We process accounting and transaction records where
            necessary to comply with legal obligations.
          </>,
          <>
            Account authentication, profile management, and the reservation
            history are processed to provide the account service you request
            and, where applicable, to perform or prepare the related reservation
            contract. Account security, session integrity, and abuse prevention
            are based on our legitimate interests.
          </>,
          <>
            Connecting an AI assistant and handling its requests is processed to
            provide the account service you request and, where applicable, to
            prepare the related reservation contract at your request.
          </>,
          <>
            For website security, abuse and fraud prevention, reliable payment
            and reservation evidence, and the establishment, exercise, or
            defense of legal claims, we rely on our legitimate interests where
            those interests are not overridden by your rights.
          </>,
          <>
            Optional non-essential cookies are processed only on the basis of
            your consent. Analytics of your website use and campaign measurement
            are based on consent, which you can withdraw or change at any time
            via cookie settings.
          </>,
          <>
            Measuring automated traffic by category is based on our legitimate
            interest in operating the website and improving it for search
            engines and AI assistants. It uses no data that identifies you.
          </>,
          <>
            Recording reservation and payment steps is based on our legitimate
            interest in measuring how reservations and payments go and spotting
            failed or abandoned payments, where that interest is not overridden
            by your rights. You can object to this processing at any time.
            Linking these records to your account's analytics profile is based
            on your analytics consent.
          </>,
          <>
            Sending customer data from our booking system to our analytics
            provider is based on our legitimate interest in understanding and
            improving our services, where that interest is not overridden by
            your rights. You can object to this processing at any time.
          </>,
          <>
            Future marketing communications are based on your separate consent.
            Giving this consent is voluntary and is not a condition of making or
            paying for a reservation.
          </>,
        ],
      },
      {
        heading: "5. Retention period",
        body: [
          <>
            We keep unsuccessful enquiries and abandoned reservation data only
            for as long as needed to handle the request, recover an incomplete
            checkout, prevent abuse, or protect legal claims. For completed
            Bookings, we retain the transaction, accounting, legal-acceptance,
            and complaint records for the periods required by applicable law or
            reasonably necessary to establish, exercise, or defend legal claims.
            Technical abuse-prevention signals are short-lived.
          </>,
          <>
            We keep the customer account while it is active; sign-in sessions
            and links expire automatically and are deleted regularly. Deleting
            the account deletes your login and sign-in data and deactivates the
            linked customer profile. Reservation, payment, accounting,
            fraud-prevention, and legal evidence records are not erased with the
            login account and remain only for the applicable service, statutory,
            or legitimate retention period.
          </>,
          <>
            A connected assistant's access credentials expire automatically and
            are deleted regularly. The connection and the permissions you gave
            last until you disconnect the assistant in Connected assistants in
            your account or delete your account. Disconnecting the assistant or
            deleting your account ends the connection and its permissions right
            away: the assistant's access credentials stop working immediately
            and are deleted. The record of which assistant started a reservation
            stays with that reservation.
          </>,
          <>
            Analytics and campaign measurement data, including customer data
            sent to our analytics provider, is retained according to the
            applicable analytics and technical provider settings and only as
            long as necessary for the stated measurement purposes.
          </>,
          <>
            We keep the record of your marketing consent, including any
            withdrawal, with your customer record so that we can show what you
            chose.
          </>,
        ],
      },
      {
        heading: "6. Recipients",
        body: [
          <>
            Your data may be accessed by our internal workspace team and, as
            necessary for their role, by providers of website hosting,
            reservation and customer management, payment processing, email
            delivery, accounting-document generation, security, analytics,
            external measurement, and other technical services. Payment data is
            sent to the payment provider only to create and verify the
            transaction. We use appropriate contractual, organizational, and
            technical safeguards for provider access.
          </>,
          <>
            Customer profiles and reservations are kept in our booking system,
            Dotypos.
          </>,
          <>
            If you connect an AI assistant, what it retrieves at your request,
            such as our offers and your reservations, goes to that assistant's
            provider, which handles it under its own terms as a recipient you
            chose. That provider may be outside the European Union, for example
            in the United States, and your data goes there because you asked for
            it.
          </>,
          <>
            If we send marketing communications in the future, our email
            delivery provider may process the contact and delivery information
            needed to send them on our behalf.
          </>,
        ],
      },
      {
        heading: "7. Transfers outside the EU",
        body: [
          <>
            Some of our providers, or companies working for them, are outside
            the European Union, so your data may be processed there. In the
            United States, we use only companies certified under the EU–US Data
            Privacy Framework or bound by the European Commission's standard
            contractual clauses. The map on our website comes from a provider in
            the United Kingdom. The European Commission has decided that the
            United Kingdom, and US companies certified under the framework,
            protect personal data adequately. To learn more about these
            transfers or get a copy of the safeguards, write to us at{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
          <>
            Our door-lock provider is in Singapore, which has no such decision.
            To give you door access for your reservation, it receives details of
            your door code, such as when the code is valid. We send them only
            because they are needed to provide the service you booked.
          </>,
        ],
      },
      {
        heading: "8. Your rights",
        body: [
          <>
            Under applicable data protection law, you may request access,
            rectification, erasure, restriction, objection, or data portability
            where applicable. You may lodge a complaint with the Czech Office
            for Personal Data Protection at{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="https://uoou.gov.cz/en"
              rel="noreferrer"
              target="_blank"
            >
              uoou.gov.cz
            </a>
            .
          </>,
          <>
            You can give or withdraw marketing consent at any time on the
            privacy page in your account, through the link in any marketing
            email, or by writing to us at{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Withdrawal does not affect processing that took place before it.
          </>,
          <>
            You can delete the customer account from its profile page. This
            self-service action deletes the login account but does not replace a
            broader data-protection request concerning reservations or legally
            retained records; send those requests to{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
        ],
      },
    ],
  },
  "marketing-communications": {
    updatedAt: "5 August 2026",
    sections: [
      {
        heading: "1. Who may contact you",
        body: [
          <>
            For future marketing communications, {companyName} is the sender and
            controller, ID No.{" "}
            {workspaceSiteConstants.company.identificationNumber}, at{" "}
            {companyAddress}.
          </>,
        ],
      },
      {
        heading: "2. What you agree to",
        body: [
          "You agree that we may use your name, email address, and preferred language for future Deskohub Workspace marketing and community communications by email.",
          "The consent covers marketing by email for our own Deskohub Workspace services. We do not give your contact details to another business for its own marketing.",
          "The consent belongs to the relevant customer record, not to an email address. If that customer record's email address changes, the consent follows that record. Customer records that use the same email address have separate consent choices.",
        ],
      },
      {
        heading: "3. Your choice",
        body: [
          "This consent is voluntary and separate from your reservation. Leaving the marketing checkbox unchecked does not prevent you from making or paying for a reservation.",
          "Leaving the marketing checkbox unchecked does not withdraw an existing preference.",
          "We record the time and version of the notice with the relevant customer preference so that we can show what you accepted.",
          "An anonymous booking can create an initial customer marketing preference only when no preference exists. It cannot overwrite an existing preference.",
        ],
      },
      {
        heading: "4. Managing and withdrawing consent",
        body: [
          <>
            You can opt in to or withdraw consent on the privacy page in your
            account when you are signed in with a verified account linked to the
            relevant customer record. A dedicated customer-specific link in a
            future marketing message can also let you opt in or withdraw. If
            neither option is available, contact our support team at{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Withdrawal applies to future marketing and does not affect prior
            lawful processing.
          </>,
        ],
      },
      {
        heading: "5. Providers and your rights",
        body: [
          <>
            If we send marketing communications in the future, our email
            delivery provider may process the contact and delivery information
            needed to send them on our behalf. More information about
            recipients, safeguards, and your data protection rights is in our{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/en-US/privacy-policy"
            >
              Privacy Policy
            </a>
            .
          </>,
        ],
      },
    ],
  },
  "terms-and-conditions": {
    updatedAt: "12 August 2026",
    sections: termsAndConditionsSections,
  },
  "cookie-policy": {
    updatedAt: "8 November 2026",
    sections: [
      {
        heading: "1. What cookies are",
        body: [
          <>
            Cookies are small text files stored in your browser that help a
            website remember technical choices, improve usability, and
            understand whether optional features may be enabled.
          </>,
        ],
      },
      {
        heading: "2. Necessary cookies",
        body: [
          <>
            Necessary cookies support core website operation, language handling,
            security, and storing your cookie consent state. These cookies are
            always active because the site cannot work reliably without them.
          </>,
          <>
            When you sign in to your customer account, a strictly necessary
            session cookie keeps you signed in for up to 30 days. It is set only
            after you sign in and is removed when you sign out or delete your
            account.
          </>,
          <>
            When you open a referral link shared by another customer, a strictly
            necessary cookie remembers its referral code for up to 30 days so
            the invitation discount you asked for can be applied when you
            complete your profile or book. A referral link opened later does not
            replace a code that is already remembered, but a referral code you
            enter at checkout that is accepted does. The cookie is removed once
            the referral is recorded or your first booking is paid, and it is
            not used for tracking.
          </>,
        ],
      },
      {
        heading: "3. Preference cookies",
        body: [
          <>
            Preference cookies remember optional display or interaction settings
            when such features are enabled on the website.
          </>,
        ],
      },
      {
        heading: "4. Analytics and marketing cookies",
        body: [
          <>
            Analytics and marketing cookies are optional. If analytics, external
            measurement, campaign measurement, or similar technical provider
            tools are used on the site, they are activated only after your
            consent through the cookie banner or the cookie settings page.
          </>,
          <>
            Analytics cookies help us understand site usage, reservation
            submission performance, and campaign effectiveness. Depending on the
            provider category, the processed data may include pageviews, browser
            and device information, IP-derived technical data, event types, and
            standard campaign parameters from URLs: utm_source, utm_medium,
            utm_campaign, utm_content, and utm_term.
          </>,
          <>
            With your analytics consent, we also add the records of your
            reservations and payments to your account's analytics profile, as
            described in our{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/en-US/privacy-policy"
            >
              Privacy Policy
            </a>
            .
          </>,
          <>
            Reservation submitted conversion events do not include reservation
            form values or personal details such as name, email, phone, message,
            reservation dates or times, duration, seat count, selected product,
            or refreshment, monitor, or workstation choices.
          </>,
        ],
      },
      {
        heading: "5. How to manage consent",
        body: [
          <>
            You can accept all optional categories, reject non-essential
            categories, or manage them individually through the cookie banner
            and the dedicated cookie settings page linked in the footer.
          </>,
        ],
      },
    ],
  },
  "operating-rules": {
    updatedAt: "12 August 2026",
    sections: operatingRulesSections,
  },
} satisfies LegalDocumentBodies;

export const translation = {
  translationNotice:
    "This is a translation of the Czech original. In case of any discrepancy between this translation and the Czech version, the Czech version governs.",
  documents: legalDocuments,
} satisfies LegalDocumentTranslation;
