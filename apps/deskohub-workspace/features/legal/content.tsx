import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";

export type LegalDocumentKey =
  | "privacy-policy"
  | "terms-and-conditions"
  | "cookie-policy"
  | "operating-rules";

type LegalSection = {
  heading: string;
  body: ReactNode[];
};

export type LegalDocumentContent = {
  title: string;
  lead: string;
  updatedAt: string;
  sections: LegalSection[];
};

const companyName = workspaceSiteConstants.brand.legalName;
const contactEmail = workspaceSiteConstants.contact.infoEmail;
const companyAddress = `${workspaceSiteConstants.contact.address.street}, ${workspaceSiteConstants.contact.address.postalCode} ${workspaceSiteConstants.contact.address.city} - ${workspaceSiteConstants.contact.address.cityDistrict}`;
const commercialRegisterDisclosure = {
  "en-US":
    "Commercial register details are available in the linked official company extract.",
  "cs-CZ":
    "Údaje o zápisu v obchodním rejstříku jsou k dispozici v odkazovaném oficiálním výpisu společnosti.",
} as const;

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Úvodní ustanovení",
    body: [
      <>
        1.1 Tyto všeobecné obchodní podmínky (dále jen „VOP“) upravují vzájemná
        práva a povinnosti smluvních stran vznikající v souvislosti s
        poskytováním služeb společností {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, se sídlem
        Turnovská 430/10, Praha 8, zapsané v obchodním rejstříku vedeném
        Městským soudem v Praze (dále jen „Poskytovatel“), a klientem (dále jen
        „Klient“).
      </>,
      "1.2 Tyto VOP se vztahují na poskytování coworkingových služeb a na krátkodobý pronájem prostor pro konání akcí.",
      "1.3 Ustanovení těchto VOP jsou nedílnou součástí každé smlouvy uzavřené mezi Poskytovatelem a Klientem.",
      "1.4 Právní vztahy neupravené těmito VOP se řídí právním řádem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník.",
    ],
  },
  {
    heading: "2. Vymezení pojmů",
    body: [
      "2.1 Klientem se rozumí fyzická nebo právnická osoba, která využívá služby Poskytovatele.",
      "2.2 Spotřebitelem se rozumí Klient, který jedná mimo rámec své podnikatelské činnosti.",
      "2.3 Prostory jsou coworkingové a eventové prostory provozované Poskytovatelem.",
      "2.4 Službami se rozumí coworkingové služby a pronájem prostor pro akce.",
      "2.5 Tarifem se rozumí konkrétní rozsah coworkingových služeb a podmínek jejich čerpání dle aktuálního Ceníku Poskytovatele.",
      "2.6 Přístupovým PIN kódem se rozumí jedinečný kód umožňující vstup do prostor Poskytovatele.",
    ],
  },
  {
    heading: "3. Předmět smlouvy",
    body: [
      "3.1 Poskytovatel poskytuje Klientovi coworkingové služby spočívající v dočasném umožnění užívání sdíleného pracovního prostoru v prostorách Poskytovatele, a to v rozsahu zvoleného tarifu. Sdíleným pracovním prostorem se rozumí nevýhradně určené pracovní místo nebo část coworkingových prostor určená k běžné práci, bez garance konkrétního stolu či místa, není-li u konkrétního tarifu výslovně uvedeno jinak.",
      "3.2 Poskytovatel dále umožňuje Klientovi krátkodobé užívání prostor pro účely pořádání akcí, a to vždy na základě individuální dohody.",
      "3.3 Poskytování služeb podle těchto VOP nepředstavuje nájem ve smyslu ustanovení občanského zákoníku o nájmu prostor sloužících podnikání.",
    ],
  },
  {
    heading: "4. Uzavření smlouvy",
    body: [
      "4.1 Smlouva o poskytování coworkingových služeb je uzavřena okamžikem, kdy Klient uhradí cenu služby a Poskytovatel mu zašle potvrzení včetně přístupového PIN kódu. Odeslání rezervačního formuláře na webu představuje pouze poptávku/žádost a samo o sobě nezakládá závaznou rezervaci ani smlouvu, dokud ji Poskytovatel nepotvrdí podle těchto VOP. Požadavky na kávu, pracovní místo nebo monitory podléhají dostupnosti a potvrzení Poskytovatele.",
      "4.2 Smlouva o pronájmu prostoru pro akce je uzavřena na základě individuální nabídky Poskytovatele a jejího přijetí Klientem.",
      "4.3 Poskytovatel není povinen uzavřít smlouvu s každým Klientem a vyhrazuje si právo jakoukoli poptávku odmítnout.",
    ],
  },
  {
    heading: "5. Cena a platební podmínky",
    body: [
      "5.1 Poskytovatel není plátcem daně z přidané hodnoty. Veškeré ceny jsou konečné.",
      "5.2 Cena coworkingových služeb se řídí aktuálním Ceníkem Poskytovatele a je splatná před jejich poskytnutím.",
      "5.3 Cena za pronájem prostor pro akce je stanovena individuálně dle charakteru akce.",
    ],
  },
  {
    heading: "6. Tarify coworkingu",
    body: [
      "6.1 Rozsah coworkingových služeb, obsah jednotlivých tarifů a podmínky jejich čerpání jsou určeny aktuálním Ceníkem Poskytovatele.",
      "6.2 Jednotlivé tarify mohou zahrnovat zejména přístup do sdíleného coworkingového prostoru, doplňkové služby, vyhrazené pracovní místo nebo přístup k vybavení, a to vždy dle aktuálního Ceníku Poskytovatele.",
      "6.3 Označení jednotlivých tarifů, jejich dostupnost a konkrétní obsah stanoví aktuální Ceník Poskytovatele.",
      "6.4 Poskytovatel je oprávněn nabídku tarifů, jejich obsah i označení průběžně měnit, a to zveřejněním aktualizovaného Ceníku.",
      "6.5 Není-li mezi Poskytovatelem a Klientem výslovně sjednáno jinak, rozhodující je znění Ceníku účinné ke dni objednání služby.",
    ],
  },
  {
    heading: "7. Přístup a užívání služeb",
    body: [
      "7.1 Přístup do prostor je umožněn prostřednictvím přístupového PIN kódu zaslaného Klientovi elektronicky.",
      "7.2 Přístupový PIN kód je nepřenosný a jeho časová platnost se řídí aktuálním Ceníkem, případně konkrétní objednávkou služby.",
      "7.3 Klient není oprávněn zpřístupnit PIN kód třetím osobám.",
    ],
  },
  {
    heading: "8. Storno a odstoupení od smlouvy",
    body: [
      "8.1 Klient je oprávněn zrušit rezervaci coworkingového vstupu pouze do okamžiku, než mu bude doručen přístupový PIN kód.",
      "8.2 Doručením přístupového PIN kódu dochází k zahájení poskytování služby.",
      "8.3 Po zahájení poskytování služby není Klient oprávněn od smlouvy odstoupit ani požadovat vrácení ceny.",
      "8.4 Klient výslovně souhlasí se zahájením poskytování služby před uplynutím lhůty pro odstoupení od smlouvy.",
    ],
  },
  {
    heading: "9. Pravidla užívání prostor",
    body: ["9.1 Klient je povinen dodržovat provozní řád Poskytovatele."],
  },
  {
    heading: "10. Práva a povinnosti smluvních stran",
    body: [
      "10.1 Klient je povinen užívat prostory řádně, v souladu s jejich určením a těmito VOP.",
      "10.2 Klient odpovídá za škodu způsobenou Poskytovateli.",
      "10.3 Poskytovatel je oprávněn omezit nebo ukončit poskytování služeb v případě porušení těchto VOP.",
    ],
  },
  {
    heading: "11. Odpovědnost",
    body: [
      "11.1 Poskytovatel neodpovídá za odložené věci Klienta.",
      "11.2 Poskytovatel neodpovídá za podnikatelskou činnost Klienta vykonávanou v prostorách.",
      "11.3 Poskytovatel neodpovídá za dočasnou nedostupnost služeb.",
    ],
  },
  {
    heading: "12. Zvláštní ustanovení pro akce",
    body: [
      "12.1 Klient odpovídá za průběh akce a za osoby, které se akce účastní.",
      "12.2 Poskytovatel je oprávněn akci ukončit v případě porušení právních předpisů nebo těchto VOP.",
    ],
  },
  {
    heading: "13. Závěrečná ustanovení",
    body: [
      "13.1 Poskytovatel je oprávněn tyto VOP jednostranně měnit.",
      "13.2 Tyto VOP nabývají účinnosti dne 12. 4. 2026.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Úvodní ustanovení",
    body: [
      <>
        1.1 Tento provozní řád (dále jen „Provozní řád“) upravuje pravidla
        chování a užívání coworkingových a eventových prostor provozovaných
        společností {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, se sídlem
        Turnovská 430/10, Praha 8 (dále jen „Provozovatel“).
      </>,
      "1.2 Tento Provozní řád je závazný pro všechny osoby nacházející se v prostorách Provozovatele (dále jen „Uživatel“).",
      "1.3 Každý Uživatel je povinen se s tímto Provozním řádem seznámit a dodržovat jej.",
    ],
  },
  {
    heading: "2. Základní pravidla chování",
    body: [
      "2.1 Uživatel je povinen chovat se v prostorách ohleduplně a s respektem k ostatním osobám.",
      "2.2 Uživatel je povinen zachovávat klid odpovídající běžné tiché konverzaci.",
      "2.3 Uživatel nesmí svým jednáním nadměrně rušit ostatní uživatele ani omezovat jejich užívání prostor.",
    ],
  },
  {
    heading: "3. Zákazy v prostorách",
    body: [
      "3.1 V prostorách je zakázáno:",
      "a) kouřit, včetně používání elektronických cigaret,",
      "b) užívat omamné nebo psychotropní látky,",
      "c) vstupovat do prostor pod vlivem alkoholu nebo jiných návykových látek v míře omezující schopnost bezpečného chování,",
      "d) vykonávat činnosti v rozporu s právními předpisy,",
      "e) poškozovat vybavení nebo zařízení prostor,",
      "f) obtěžovat ostatní uživatele nevhodným nebo agresivním chováním.",
    ],
  },
  {
    heading: "4. Užívání prostor",
    body: [
      "4.1 Uživatel je povinen užívat prostory výhradně k účelům odpovídajícím jejich povaze a určení.",
      "4.2 Uživatel je povinen udržovat pořádek a čistotu a po skončení užívání uvést využívané místo do odpovídajícího stavu.",
      "4.3 Uživatel nesmí bez souhlasu Provozovatele přemisťovat vybavení nebo zasahovat do zařízení prostor.",
    ],
  },
  {
    heading: "5. Občerstvení",
    body: [
      "5.1 Uživatel je povinen využívat občerstvení přiměřeně a s ohledem na ostatní uživatele.",
      "5.2 Uživatel nesmí občerstvení zneužívat nebo s ním neodůvodněně plýtvat.",
    ],
  },
  {
    heading: "6. Bezpečnost",
    body: [
      "6.1 Uživatel je povinen dbát na bezpečnost svou i ostatních osob.",
      "6.2 Uživatel nesmí blokovat únikové cesty ani jinak ohrožovat bezpečný provoz prostor.",
      "6.3 Uživatel je povinen bez zbytečného odkladu upozornit Provozovatele na vznik nebezpečné situace nebo závady.",
      "6.4 Pokud je Uživatelům umožněn vstup do prostor prostřednictvím přístupového PIN kódu, jsou povinni s tímto kódem nakládat obezřetně a chránit jej před zpřístupněním nebo odpozorováním třetí osobou.",
      "6.5 Uživatel je povinen zadávat přístupový PIN kód se zvýšenou opatrností a dbát na to, aby při jeho zadávání nestála v jeho bezprostřední blízkosti žádná neoprávněná osoba.",
      "6.6 Porušení povinností podle tohoto článku může být považováno za porušení Provozního řádu a za zneužití přístupového oprávnění.",
    ],
  },
  {
    heading: "7. Odpovědnost za škodu",
    body: [
      "7.1 Uživatel odpovídá za škodu, kterou způsobí na majetku Provozovatele nebo třetích osob.",
      "7.2 Uživatel je povinen vznik škody neprodleně oznámit Provozovateli.",
    ],
  },
  {
    heading: "8. Porušení Provozního řádu",
    body: [
      "8.1 V případě porušení tohoto Provozního řádu je Provozovatel oprávněn přijmout přiměřená opatření k zajištění pořádku a ochrany ostatních uživatelů.",
      "8.2 Tato opatření mohou zahrnovat zejména vykázání Uživatele z prostor nebo omezení jeho dalšího užívání služeb.",
    ],
  },
  {
    heading: "9. Závěrečná ustanovení",
    body: [
      "9.1 Provozovatel je oprávněn tento Provozní řád jednostranně měnit.",
      "9.2 Tento Provozní řád nabývá účinnosti dne 11. 4. 2026.",
    ],
  },
];

const termsAndConditionsSectionsEn: LegalSection[] = [
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
      "1.2 These GTC apply to the provision of coworking services and the short-term rental of premises for events.",
      "1.3 The provisions of these GTC are an integral part of every contract concluded between the Provider and the Client.",
      "1.4 Legal relationships not regulated by these GTC are governed by the laws of the Czech Republic, in particular Act No. 89/2012 Coll., the Civil Code.",
    ],
  },
  {
    heading: "2. Definition of Terms",
    body: [
      "2.1 Client means a natural or legal person who uses the Provider's services.",
      "2.2 Consumer means a Client acting outside the scope of their business activity.",
      "2.3 Premises means the coworking and event spaces operated by the Provider.",
      "2.4 Services means coworking services and the rental of premises for events.",
      "2.5 Tariff means the specific scope of coworking services and the conditions for their use according to the Provider's current Price List.",
      "2.6 Access PIN Code means a unique code enabling entry into the Provider's premises.",
    ],
  },
  {
    heading: "3. Subject of the Contract",
    body: [
      "3.1 The Provider provides the Client with coworking services consisting of temporarily enabling the use of a shared workspace in the Provider's premises, within the scope of the selected tariff. Shared workspace means a non-exclusively designated workstation or part of the coworking space intended for routine work, without a guarantee of a specific desk or seat, unless expressly stated otherwise for a specific tariff.",
      "3.2 The Provider further enables the Client to use the premises short-term for the purpose of organizing events, always based on an individual agreement.",
      "3.3 The provision of services under these GTC does not constitute a lease within the meaning of the provisions of the Civil Code regarding the lease of premises used for business.",
    ],
  },
  {
    heading: "4. Conclusion of the Contract",
    body: [
      "4.1 A contract for the provision of coworking services is concluded at the moment the Client pays the price of the service and the Provider sends them a confirmation including the access PIN code. Submitting a reservation form on the website constitutes an enquiry/request only and does not create a binding reservation or contract until confirmed by the Provider in accordance with these GTC. Requested coffee, workstation, or monitor preferences are subject to availability and Provider confirmation.",
      "4.2 A contract for the rental of premises for events is concluded on the basis of an individual offer from the Provider and its acceptance by the Client.",
      "4.3 The Provider is not obliged to conclude a contract with every Client and reserves the right to reject any inquiry.",
    ],
  },
  {
    heading: "5. Price and Payment Conditions",
    body: [
      "5.1 The Provider is not a payer of Value Added Tax (VAT). All prices are final.",
      "5.2 The price of coworking services is governed by the Provider's current Price List and is payable prior to their provision.",
      "5.3 The price for the rental of premises for events is determined individually based on the nature of the event.",
    ],
  },
  {
    heading: "6. Coworking Tariffs",
    body: [
      "6.1 The scope of coworking services, the content of individual tariffs, and the conditions for their use are determined by the Provider's current Price List.",
      "6.2 Individual tariffs may include, in particular, access to shared coworking space, supplementary services, a dedicated workstation, or access to equipment, always according to the current Price List.",
      "6.3 The designations of individual tariffs, their availability, and specific content are set by the current Price List.",
      "6.4 The Provider is entitled to continuously change the range of tariffs, their content, and designations by publishing an updated Price List.",
      "6.5 Unless expressly agreed otherwise between the Provider and the Client, the version of the Price List effective on the day the service is ordered shall be decisive.",
    ],
  },
  {
    heading: "7. Access and Use of Services",
    body: [
      "7.1 Access to the premises is enabled via an access PIN code sent to the Client electronically.",
      "7.2 The access PIN code is non-transferable, and its temporal validity is governed by the current Price List or the specific service order.",
      "7.3 The Client is not entitled to disclose the PIN code to third parties.",
    ],
  },
  {
    heading: "8. Cancellation and Withdrawal from the Contract",
    body: [
      "8.1 The Client is entitled to cancel a coworking entry reservation only until the moment the access PIN code is delivered to them.",
      "8.2 Upon delivery of the access PIN code, the provision of the service commences.",
      "8.3 After the provision of the service has commenced, the Client is not entitled to withdraw from the contract or demand a refund of the price.",
      "8.4 The Client expressly consents to the commencement of the service provision before the expiry of the period for withdrawal from the contract.",
    ],
  },
  {
    heading: "9. Rules for Using the Premises",
    body: [
      "9.1 The Client is obliged to comply with the Provider's Operating Rules.",
    ],
  },
  {
    heading: "10. Rights and Obligations of the Contracting Parties",
    body: [
      "10.1 The Client is obliged to use the premises properly, in accordance with their purpose and these GTC.",
      "10.2 The Client is liable for damage caused to the Provider.",
      "10.3 The Provider is entitled to restrict or terminate the provision of services in the event of a breach of these GTC.",
    ],
  },
  {
    heading: "11. Liability",
    body: [
      "11.1 The Provider is not responsible for items left behind by the Client.",
      "11.2 The Provider is not responsible for the Client's business activities carried out on the premises.",
      "11.3 The Provider is not responsible for temporary unavailability of services.",
    ],
  },
  {
    heading: "12. Special Provisions for Events",
    body: [
      "12.1 The Client is responsible for the course of the event and for the persons participating in the event.",
      "12.2 The Provider is entitled to terminate the event in the case of a breach of legal regulations or these GTC.",
    ],
  },
  {
    heading: "13. Final Provisions",
    body: [
      "13.1 The Provider is entitled to unilaterally change these GTC.",
      "13.2 These GTC become effective on April 12, 2026.",
      "13.3 These GTC are issued in Czech and English. In the event of any discrepancies or inconsistencies between the language versions, the Czech version shall be authoritative and take precedence.",
    ],
  },
];

const operatingRulesSectionsEn: LegalSection[] = [
  {
    heading: "1. Introductory Provisions",
    body: [
      <>
        1.1 These House Rules (hereinafter referred to as the "House Rules")
        govern the rules of conduct and the use of coworking and event spaces
        operated by the company {companyName}, ID No.:{" "}
        {workspaceSiteConstants.company.identificationNumber}, with its
        registered office at Turnovská 430/10, Prague 8 (hereinafter referred to
        as the "Operator").
      </>,
      '1.2 These House Rules are binding for all persons located on the Operator\'s premises (hereinafter referred to as the "User").',
      "1.3 Every User is obliged to familiarize themselves with these House Rules and to comply with them.",
    ],
  },
  {
    heading: "2. Basic Rules of Conduct",
    body: [
      "2.1 The User is obliged to behave considerately and with respect toward other persons within the premises.",
      "2.2 The User is obliged to maintain a level of quiet corresponding to normal, quiet conversation.",
      "2.3 The User must not excessively disturb other users through their actions or restrict their use of the premises.",
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
      "f) harassing other users with inappropriate or aggressive behavior.",
    ],
  },
  {
    heading: "4. Use of the Premises",
    body: [
      "4.1 The User is obliged to use the premises exclusively for purposes corresponding to their nature and designation.",
      "4.2 The User is obliged to maintain order and cleanliness and, after finishing their use, to return the used space to a corresponding condition.",
      "4.3 The User must not move equipment or interfere with the facilities of the premises without the Operator's consent.",
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
      "6.4 If Users are granted entry to the premises via an access PIN code, they are obliged to handle this code with caution and protect it from being disclosed to or observed by a third party.",
      "6.5 The User is obliged to enter the access PIN code with increased caution and ensure that no unauthorized person is standing in their immediate vicinity during entry.",
      "6.6 A breach of the obligations under this article may be considered a violation of the House Rules and an abuse of access authorization.",
    ],
  },
  {
    heading: "7. Liability for Damage",
    body: [
      "7.1 The User is liable for damage they cause to the Operator's property or the property of third parties.",
      "7.2 The User is obliged to immediately notify the Operator of any damage occurred.",
    ],
  },
  {
    heading: "8. Violation of House Rules",
    body: [
      "8.1 In the event of a violation of these House Rules, the Operator is entitled to take appropriate measures to ensure order and the protection of other users.",
      "8.2 These measures may include, in particular, the expulsion of the User from the premises or the restriction of their further use of services.",
    ],
  },
  {
    heading: "9. Final Provisions",
    body: [
      "9.1 The Operator is entitled to unilaterally change these House Rules.",
      "9.2 These House Rules become effective on April 11, 2026.",
      "9.3 These House Rules are issued in Czech and English. In the event of any discrepancies or inconsistencies between the language versions, the Czech version shall be authoritative and take precedence.",
    ],
  },
];

const legalDocuments: Record<
  Locale,
  Record<LegalDocumentKey, LegalDocumentContent>
> = {
  "en-US": {
    "privacy-policy": {
      title: "Privacy Policy",
      lead: "This page explains how Desktechub s.r.o. handles personal data submitted through the public Deskohub Workspace website, including contact and reservation forms.",
      updatedAt: "27 April 2026",
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
            commercialRegisterDisclosure["en-US"],
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
              contact form, plus reservation form details: your name, email,
              optional phone number, optional message, requested entry tier,
              reservation date, coffee preference, and monitor or workstation
              preference.
            </>,
            <>
              For website operation and abuse prevention, we may also process
              limited technical data such as IP address, User-Agent, origin or
              host information where available, and short-lived rate-limit or
              anti-spam signals connected with a submission.
            </>,
            <>
              If you consent to analytics cookies or similar technologies, we
              and our analytics service providers may process website usage and
              campaign measurement data, such as pageviews, browser and device
              information, IP-derived technical data, event types, and standard
              campaign parameters from URLs. These campaign parameters are
              limited to utm_source, utm_medium, utm_campaign, utm_content, and
              utm_term.
            </>,
          ],
        },
        {
          heading: "3. Why we process the data",
          body: [
            <>
              We use submitted contact and reservation data to process your
              enquiry or reservation request, send an internal business
              notification to the workspace team, send you a confirmation email,
              follow up about the request, and protect the website and forms
              against abuse, spam, or excessive automated submissions.
            </>,
            <>
              We do not use reservation or enquiry data for marketing unless you
              separately consent to receive marketing communication.
            </>,
            <>
              With your analytics consent, we use analytics and external
              measurement services to understand site usage, reservation
              submission performance, and campaign effectiveness. Reservation
              submitted conversion events are used only at category and purpose
              level and do not include reservation form values or personal
              details such as name, email, phone, message, reservation date,
              selected tier, coffee preference, or monitor preference.
            </>,
          ],
        },
        {
          heading: "4. Legal basis",
          body: [
            <>
              For reservation handling, the main legal basis is taking steps at
              your request before entering into a contract or performing the
              requested service. For follow-up communication, internal handling,
              website security, and abuse prevention, we rely on our legitimate
              interests.
            </>,
            <>
              Optional non-essential cookies are processed only on the basis of
              your consent. Analytics and campaign measurement processing is
              based on consent, which you can withdraw or change at any time via
              cookie settings.
            </>,
          ],
        },
        {
          heading: "5. Retention period",
          body: [
            <>
              We keep enquiry and reservation data only for as long as needed to
              handle the request, complete follow-up communication, or meet
              legal obligations and protect our legitimate interests. Technical
              abuse-prevention signals are short-lived and used on a best-effort
              basis.
            </>,
            <>
              Analytics and campaign measurement data is retained according to
              the applicable analytics and technical provider settings and only
              as long as necessary for the stated measurement purposes.
            </>,
          ],
        },
        {
          heading: "6. Recipients",
          body: [
            <>
              Your data may be accessed by our internal workspace team and by
              website, hosting, email, analytics, external measurement, and
              technical service providers when necessary for secure website
              operation, reservation handling, communication delivery, and
              consented analytics or campaign measurement. We use appropriate
              contractual, organizational, and technical safeguards for provider
              access.
            </>,
          ],
        },
        {
          heading: "7. Your rights",
          body: [
            <>
              Under applicable data protection law, you may request access,
              rectification, erasure, restriction, objection, or data
              portability where applicable, and you may also lodge a complaint
              with the competent supervisory authority.
            </>,
          ],
        },
      ],
    },
    "terms-and-conditions": {
      title: "General Terms and Conditions",
      lead: "These General Terms and Conditions govern the provision of coworking services and the short-term rental of premises for events.",
      updatedAt: "27 April 2026",
      sections: termsAndConditionsSectionsEn,
    },
    "cookie-policy": {
      title: "Cookie Policy",
      lead: "This page explains how the Deskohub Workspace website uses cookies and how you can manage your preferences.",
      updatedAt: "27 April 2026",
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
              Necessary cookies support core website operation, language
              handling, security, and storing your cookie consent state. These
              cookies are always active because the site cannot work reliably
              without them.
            </>,
          ],
        },
        {
          heading: "3. Preference cookies",
          body: [
            <>
              Preference cookies remember optional display or interaction
              settings when such features are enabled on the website.
            </>,
          ],
        },
        {
          heading: "4. Analytics and marketing cookies",
          body: [
            <>
              Analytics and marketing cookies are optional. If analytics,
              external measurement, campaign measurement, or similar technical
              provider tools are used on the site, they are activated only after
              your consent through the cookie banner or the cookie settings
              page.
            </>,
            <>
              Analytics cookies help us understand site usage, reservation
              submission performance, and campaign effectiveness. Depending on
              the provider category, the processed data may include pageviews,
              browser and device information, IP-derived technical data, event
              types, and standard campaign parameters from URLs: utm_source,
              utm_medium, utm_campaign, utm_content, and utm_term.
            </>,
            <>
              Reservation submitted conversion events do not include reservation
              form values or personal details such as name, email, phone,
              message, reservation date, selected tier, coffee preference, or
              monitor preference.
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
      title: "House Rules",
      lead: "These House Rules govern the rules of conduct and the use of coworking and event spaces operated by Desktechub s.r.o.",
      updatedAt: "11 April 2026",
      sections: operatingRulesSectionsEn,
    },
  },
  "cs-CZ": {
    "privacy-policy": {
      title: "Zásady ochrany osobních údajů",
      lead: "Na této stránce vysvětlujeme, jak Desktechub s.r.o. nakládá s osobními údaji zaslanými přes veřejný web Deskohub Workspace, včetně kontaktního a rezervačního formuláře.",
      updatedAt: "27. dubna 2026",
      sections: [
        {
          heading: "1. Správce",
          body: [
            <>
              {companyName}, IČO{" "}
              {workspaceSiteConstants.company.identificationNumber}, s adresou
              provozovny {companyAddress} a ID provozovny{" "}
              {workspaceSiteConstants.company.establishmentId}, je správcem
              vašich osobních údajů.
            </>,
            commercialRegisterDisclosure["cs-CZ"],
            <>
              V případě dotazů k ochraně osobních údajů nám napište na{" "}
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
          heading: "2. Jaké údaje zpracováváme",
          body: [
            <>
              Zpracováváme údaje, které nám poskytnete přes veřejný web, zejména
              kontaktní údaje a obsah zprávy odeslané přes kontaktní formulář a
              údaje z rezervačního formuláře: jméno, e-mail, volitelný telefon,
              volitelnou zprávu, požadovaný typ vstupu, datum rezervace,
              preferenci kávy a preferenci monitorů nebo pracovní stanice.
            </>,
            <>
              Pro provoz webu a ochranu před zneužitím můžeme zpracovávat také
              omezené technické údaje, například IP adresu, User-Agent,
              informace o originu nebo hostu, pokud jsou dostupné, a krátkodobé
              signály pro rate limiting nebo ochranu proti spamu související s
              odesláním formuláře.
            </>,
            <>
              Pokud udělíte souhlas s analytickými cookies nebo obdobnými
              technologiemi, můžeme my a poskytovatelé analytických služeb
              zpracovávat údaje o používání webu a měření kampaní, například
              zobrazení stránek, informace o prohlížeči a zařízení, technické
              údaje odvozené z IP adresy, typy událostí a standardní kampanové
              parametry z URL. Tyto kampanové parametry jsou omezené na
              utm_source, utm_medium, utm_campaign, utm_content a utm_term.
            </>,
          ],
        },
        {
          heading: "3. Za jakým účelem údaje používáme",
          body: [
            <>
              Kontaktní a rezervační údaje používáme pro vyřízení vaší poptávky
              nebo rezervace, odeslání interního obchodního upozornění workspace
              týmu, zaslání potvrzovacího e-mailu, navazující komunikaci a
              ochranu webu a formulářů před zneužitím, spamem nebo nadměrným
              automatizovaným odesíláním.
            </>,
            <>
              Rezervační ani poptávkové údaje nepoužíváme pro marketing, pokud k
              tomu neudělíte samostatný souhlas.
            </>,
            <>
              S vaším analytickým souhlasem používáme analytické a externí
              měřicí služby, abychom porozuměli používání webu, výkonu odeslání
              rezervací a účinnosti kampaní. Konverzní události o odeslání
              rezervace používáme pouze na úrovni kategorie a účelu a neobsahují
              hodnoty z rezervačního formuláře ani osobní údaje, jako je jméno,
              e-mail, telefon, zpráva, datum rezervace, vybraný tarif,
              preference kávy nebo preference monitorů.
            </>,
          ],
        },
        {
          heading: "4. Právní základ",
          body: [
            <>
              Pro vyřízení rezervace je hlavním právním základem provedení
              opatření na vaši žádost před uzavřením smlouvy nebo plnění
              požadované služby. Pro navazující komunikaci, interní zpracování,
              zabezpečení webu a ochranu před zneužitím vycházíme z našeho
              oprávněného zájmu.
            </>,
            <>
              Nepovinné cookies zpracováváme pouze na základě vašeho souhlasu.
              Analytické a kampanové měření je založené na souhlasu, který
              můžete kdykoli odvolat nebo změnit v nastavení cookies.
            </>,
          ],
        },
        {
          heading: "5. Doba uchování",
          body: [
            <>
              Údaje z poptávky a rezervace uchováváme pouze po dobu nutnou k
              vyřízení požadavku, navazujícímu kontaktu nebo splnění právních
              povinností a ochraně našich oprávněných zájmů. Technické signály
              pro ochranu před zneužitím jsou krátkodobé a používáme je v režimu
              best-effort.
            </>,
            <>
              Analytické údaje a údaje pro kampanové měření uchováváme podle
              nastavení příslušných analytických a technických poskytovatelů a
              pouze po dobu potřebnou pro uvedené účely měření.
            </>,
          ],
        },
        {
          heading: "6. Příjemci",
          body: [
            <>
              K údajům může mít přístup náš interní workspace tým a naši
              poskytovatelé hostingu, e-mailu, analytických, externích měřicích
              a technických služeb, pokud je to nutné pro bezpečný provoz webu,
              vyřízení rezervace, doručení komunikace a odsouhlasené analytické
              nebo kampanové měření. Pro přístup poskytovatelů používáme
              přiměřené smluvní, organizační a technické záruky.
            </>,
          ],
        },
        {
          heading: "7. Vaše práva",
          body: [
            <>
              Podle platných předpisů můžete požadovat přístup, opravu, výmaz,
              omezení zpracování, vznést námitku nebo požadovat přenositelnost
              údajů, pokud je použitelná. Zároveň můžete podat stížnost u
              příslušného dozorového úřadu.
            </>,
          ],
        },
      ],
    },
    "terms-and-conditions": {
      title: "Všeobecné obchodní podmínky",
      lead: "Tyto všeobecné obchodní podmínky upravují poskytování coworkingových služeb a krátkodobý pronájem prostor pro konání akcí.",
      updatedAt: "27. dubna 2026",
      sections: termsAndConditionsSections,
    },
    "cookie-policy": {
      title: "Zásady používání cookies",
      lead: "Na této stránce vysvětlujeme, jak web Deskohub Workspace používá cookies a jak můžete spravovat své preference.",
      updatedAt: "27. dubna 2026",
      sections: [
        {
          heading: "1. Co jsou cookies",
          body: [
            <>
              Cookies jsou malé textové soubory uložené v prohlížeči, které webu
              pomáhají pamatovat si technické volby, zlepšovat použitelnost a
              řídit zapnutí volitelných funkcí.
            </>,
          ],
        },
        {
          heading: "2. Nezbytné cookies",
          body: [
            <>
              Nezbytné cookies podporují základní provoz webu, práci s jazykem,
              zabezpečení a uložení stavu vašeho souhlasu s cookies. Tyto
              cookies jsou vždy aktivní, protože bez nich web nemůže spolehlivě
              fungovat.
            </>,
          ],
        },
        {
          heading: "3. Preferenční cookies",
          body: [
            <>
              Preferenční cookies si pamatují volitelná nastavení zobrazení nebo
              interakce, pokud jsou takové funkce na webu aktivní.
            </>,
          ],
        },
        {
          heading: "4. Analytické a marketingové cookies",
          body: [
            <>
              Analytické a marketingové cookies jsou volitelné. Pokud jsou
              analytické, externí měřicí, kampanové nebo obdobné technické
              nástroje poskytovatelů na webu využité, aktivují se až po vašem
              souhlasu přes cookie banner nebo stránku s nastavením cookies.
            </>,
            <>
              Analytické cookies nám pomáhají porozumět používání webu, výkonu
              odesílání rezervací a účinnosti kampaní. Podle kategorie
              poskytovatele mohou zpracovávané údaje zahrnovat zobrazení
              stránek, informace o prohlížeči a zařízení, technické údaje
              odvozené z IP adresy, typy událostí a standardní kampanové
              parametry z URL: utm_source, utm_medium, utm_campaign, utm_content
              a utm_term.
            </>,
            <>
              Konverzní události o odeslání rezervace neobsahují hodnoty z
              rezervačního formuláře ani osobní údaje, jako je jméno, e-mail,
              telefon, zpráva, datum rezervace, vybraný tarif, preference kávy
              nebo preference monitorů.
            </>,
          ],
        },
        {
          heading: "5. Jak spravovat souhlas",
          body: [
            <>
              Můžete přijmout všechny volitelné kategorie, odmítnout nepovinné
              kategorie nebo je spravovat jednotlivě přes cookie banner a
              samostatnou stránku s nastavením cookies dostupnou z patičky.
            </>,
          ],
        },
      ],
    },
    "operating-rules": {
      title: "Provozní řád",
      lead: "Tento provozní řád upravuje pravidla chování a užívání coworkingových a eventových prostor provozovaných společností Desktechub s.r.o.",
      updatedAt: "11. dubna 2026",
      sections: operatingRulesSections,
    },
  },
};

export function getLegalDocument(
  locale: Locale,
  documentKey: LegalDocumentKey
) {
  return legalDocuments[locale][documentKey];
}
