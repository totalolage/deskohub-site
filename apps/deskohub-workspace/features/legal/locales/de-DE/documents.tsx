import { workspaceSiteConstants } from "@/shared/utils";
import type {
  LegalDocumentBodies,
  LegalDocumentTranslation,
  LegalSection,
} from "../../legal-document-body";
import { companyAddress, companyName, contactEmail } from "../operator-details";

const commercialRegisterDisclosure =
  "Die Angaben zur Eintragung im Handelsregister sind im verlinkten amtlichen Auszug der Gesellschaft abrufbar.";

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Einleitende Bestimmungen",
    body: [
      <>
        1.1 Diese Allgemeinen Geschäftsbedingungen (nachfolgend „AGB“) regeln
        die gegenseitigen Rechte und Pflichten der Vertragsparteien, also der
        Gesellschaft {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, mit Sitz in
        Turnovská 430/10, Praha 8, eingetragen im Handelsregister, das beim
        Městský soud v Praze (Stadtgericht Prag) geführt wird (nachfolgend
        „Anbieter“), und des Kunden (nachfolgend „Kunde“), die im Zusammenhang
        mit der Erbringung von Leistungen durch den Anbieter entstehen.
      </>,
      "1.2 Diese AGB gelten für den Coworking-Zutritt, für Online-Reservierungen des Meetingraums und des Privatbüros sowie für die kurzfristige Nutzung von Räumen für individuell vereinbarte Veranstaltungen.",
      "1.3 Die Bestimmungen dieser AGB sind fester Bestandteil jedes zwischen dem Anbieter und dem Kunden geschlossenen Vertrags.",
      "1.4 Rechtsverhältnisse, die nicht durch diese AGB geregelt sind, richten sich nach der Rechtsordnung der Tschechischen Republik, insbesondere nach dem Gesetz Nr. 89/2012 Slg., Bürgerliches Gesetzbuch (Občanský zákoník).",
      "1.5 Ist der Kunde Verbraucher, werden durch diese AGB keine Rechte eingeschränkt, auf die er nach zwingenden Rechtsvorschriften nicht verzichten kann.",
    ],
  },
  {
    heading: "2. Begriffsbestimmungen",
    body: [
      "2.1 Kunde ist jede natürliche oder juristische Person, die Leistungen des Anbieters in Anspruch nimmt.",
      "2.2 Verbraucher ist ein Kunde, der außerhalb seiner unternehmerischen Tätigkeit handelt.",
      "2.3 Räumlichkeiten sind die vom Anbieter betriebenen Coworking-Räume, der Meetingraum, das Privatbüro und die Veranstaltungsräume.",
      "2.4 Leistungen sind die zeitlich begrenzte Ermöglichung der Nutzung der gewählten Räumlichkeiten sowie die in der Bestellung angegebenen damit verbundenen Leistungen.",
      "2.5 Tarif ist ein bestimmter Umfang von Coworking-Leistungen und der Bedingungen ihrer Inanspruchnahme gemäß der aktuellen Preisliste des Anbieters.",
      "2.6 Zugangs-PIN ist der jeweils aktuelle Code, der den Zutritt zu den Räumen des Anbieters ermöglicht.",
      "2.7 Reservierung ist die Bestellung eines bestimmten Coworking-Zutritts, eines Termins für den Meetingraum oder eines Termins, einer Anzahl von Tagen und einer Anzahl von Plätzen im Privatbüro.",
    ],
  },
  {
    heading: "3. Vertragsgegenstand",
    body: [
      "3.1 Der Anbieter erbringt dem Kunden Coworking-Leistungen, die in der vorübergehenden Ermöglichung der Nutzung eines gemeinsam genutzten Arbeitsorts in den Räumen des Anbieters bestehen, und zwar im Umfang des gewählten Tarifs. Ein gemeinsam genutzter Arbeitsort ist ein nicht ausschließlich zugewiesener Platz oder ein für gewöhnliche Arbeit bestimmter Teil der Coworking-Räume, ohne Garantie eines bestimmten Tisches oder Platzes, sofern beim jeweiligen Tarif nicht ausdrücklich etwas anderes angegeben ist.",
      "3.2 Die Reservierung des Meetingraums berechtigt den Kunden zur ausschließlichen Nutzung des gewählten Raums zum bestätigten Termin und im Umfang von einer Stunde, vier Stunden oder einem Prager Kalendertag. Eine ganztägige Reservierung dauert von Mitternacht des gewählten Tages bis Mitternacht des Folgetages in der Zeitzone Europe/Prague.",
      "3.3 Die Reservierung des Privatbüros berechtigt den Kunden zur ausschließlichen Nutzung des Büros mit der bestätigten Anzahl von Plätzen an den gesamten gewählten Kalendertagen. Jeder Tag dauert von Mitternacht bis zur folgenden Mitternacht in der Zeitzone Europe/Prague, und der letzte in der Bestätigung angegebene Tag ist in der Reservierung enthalten.",
      "3.4 Die konkrete Kapazität, die Ausstattung, der Preis, der Termin und der Umfang der Reservierung sind auf der Reservierungsseite und in der Bestellübersicht angegeben. Der Kunde darf die bestätigte Kapazität nicht überschreiten und ist für seine Gäste und weitere Personen verantwortlich, denen er den Zutritt ermöglicht.",
      "3.5 Der Anbieter ermöglicht dem Kunden ferner die kurzfristige Nutzung von Räumen zur Durchführung von Veranstaltungen, und zwar stets auf der Grundlage einer individuellen Vereinbarung.",
      "3.6 Die Leistungen stellen eine kurzfristige Berechtigung zur Nutzung der bestimmten Räumlichkeiten und der damit verbundenen Leistungen dar; sie begründen weder ein Mietrecht noch einen Sitz, einen Standort oder ein sonstiges dingliches Recht an den Räumlichkeiten. Der Kunde darf die Adresse der Räumlichkeiten ohne gesonderte schriftliche Vereinbarung nicht als Sitz, Geschäftsort, Standort oder Zustellanschrift verwenden.",
    ],
  },
  {
    heading: "4. Vertragsschluss",
    body: [
      "4.1 Die Angaben zu den Leistungen auf der Website stellen eine Aufforderung zur Abgabe einer Bestellung dar. Vor dem Absenden der Bestellung überprüft der Kunde die gewählte Leistung, den Termin, den Umfang, den Endpreis sowie die Kontakt- oder Rechnungsdaten und akzeptiert aktiv diese AGB und die Hausordnung.",
      "4.2 Mit dem Klick auf die Schaltfläche „Zahlungspflichtig bestellen“ gibt der Kunde eine verbindliche Bestellung mit der Verpflichtung zur Zahlung des angegebenen Endpreises ab. Der Vertrag ist mit Zugang der Bestätigung des Anbieters nach erfolgreicher Zahlung geschlossen oder, bei einer Bestellung mit einem Endpreis von null, mit Zugang der Bestätigung ihres Abschlusses. Die Bestätigung enthält die vereinbarten Angaben der Reservierung und einen sicheren Link zu ihrem Status und den Zugangsinformationen.",
      "4.3 Bis zum Vertragsschluss handelt es sich lediglich um ein vorübergehendes Vorhalten der Kapazität. Der Anbieter kann die Bestellung insbesondere bei fehlender Verfügbarkeit, einem offensichtlichen Preisfehler, Betrugsverdacht oder Nichterfüllung der Bedingungen der Reservierung ablehnen; eine erhaltene Zahlung erstattet er in diesem Fall unverzüglich.",
      "4.4 Wünsche nach Kaffee, einem bestimmten Platz, einem Monitor, Ausstattung oder sonstigem Zubehör stehen unter dem Vorbehalt der Verfügbarkeit und sind nur verbindlich, wenn sie in der Bestätigung angegeben sind.",
      "4.5 Der Vertrag über Räume für eine individuell vereinbarte Veranstaltung kommt mit der Annahme eines konkreten Angebots des Anbieters durch den Kunden zustande.",
    ],
  },
  {
    heading: "5. Preis und Zahlungsbedingungen",
    body: [
      "5.1 Der Anbieter ist in Tschechien nicht als Umsatzsteuerzahler registriert. Alle Preise sind Endpreise.",
      "5.2 Maßgeblich ist der Endpreis, der in der Bestellübersicht unmittelbar vor dem Absenden der Bestellung angezeigt wird. Der Preis ist vor Erbringung der Leistung über die angebotene Zahlungsmethode fällig.",
      "5.3 Der Preis des Privatbüros wird für jeden gewählten Tag als Tagespreis für das Büro zuzüglich des Tagespreises für jeden bestätigten Platz berechnet. Der Preis des Meetingraums entspricht dem gewählten einstündigen, vierstündigen oder ganztägigen Produkt.",
      "5.4 Rabatte werden nur gewährt, wenn sie in der Bestellübersicht angegeben sind. Ändert sich vor Beginn der Zahlung der Preis oder ein anwendbarer Rabatt, zeigt der Anbieter eine neue Übersicht an und holt eine neue Bestätigung des Kunden ein.",
      "5.5 Der Preis für Räume für eine individuell vereinbarte Veranstaltung wird im Angebot je nach Art der Veranstaltung festgelegt.",
    ],
  },
  {
    heading: "6. Verfügbarkeit und Änderungen der Reservierung",
    body: [
      "6.1 Die Verfügbarkeit ist nur für den Termin, den Umfang, die Kapazität und das Produkt bestätigt, die in der Bestätigung angegeben sind. Eine Änderung des Datums, der Uhrzeit, der Dauer, der Anzahl der Tage, der Anzahl der Plätze oder des Produkts erfordert eine neue Reservierung oder eine ausdrückliche Bestätigung des Anbieters.",
      "6.2 Die Reservierung darf ohne vorherige Zustimmung des Anbieters weder übertragen noch weiterverkauft werden.",
      "6.3 Der Anbieter kann das Angebot, die Preise und den Inhalt der Leistungen für künftige Bestellungen ändern. Die Änderung hat keinen Einfluss auf einen bereits geschlossenen Vertrag.",
      "6.4 Kann der Anbieter eine bestätigte Leistung nicht erbringen, bietet er dem Kunden je nach den Umständen einen vergleichbaren Ersatztermin oder Ersatzraum oder eine angemessene Preisminderung an oder erstattet den Preis für den nicht erbrachten Teil der Leistung. Weitere gesetzliche Rechte des Kunden bleiben davon unberührt.",
    ],
  },
  {
    heading: "7. Zutritt und Nutzung der Leistungen",
    body: [
      "7.1 Die Bestätigungs-E-Mail enthält einen sicheren Link zur Zugangsseite der Reservierung. Sobald die Reservierung bezahlt, bestätigt und in Echtzeit verifiziert ist und für sie eine Zugangs-PIN ausgestellt wurde, zeigt die geschützte Seite diese PIN zusammen mit den genau programmierten Gültigkeitsgrenzen des Codes an. Ob das Schließsystem den Code annimmt, bestimmen ausschließlich die programmierten Grenzen des AlgoPIN; die Anwendungen geben dafür keine eigene Uhrzeit vor. Die PIN ist nicht direkt in der Bestätigungs-E-Mail enthalten.",
      "7.2 Der Anbieter kann die Zugangs-PIN ändern; der Kunde verwendet den aktuell auf der Zugangsseite der Reservierung angezeigten Code. Die Anzeige der PIN verlängert die bestätigte Nutzungsdauer der Räumlichkeiten nicht und begründet kein Recht auf Zutritt außerhalb dieser Zeit oder zu anderen Räumen. Die Nutzung der Räumlichkeiten ist nur während der bestätigten Zeit der Reservierung möglich.",
      "7.3 Der Kunde darf die PIN nur Personen mitteilen, die zur Teilnahme an seiner Reservierung berechtigt sind, muss sie vor anderen Personen schützen und ist für ihre Verwendung durch seine Gäste verantwortlich. Einen Verdacht auf Missbrauch meldet er dem Anbieter unverzüglich.",
      "7.4 Der Kunde und seine Gäste sind verpflichtet, die Kapazität, den Zweck der Reservierung, die bestätigte Zeit und die Hausordnung einzuhalten. Der Kunde stellt sicher, dass die Gäste die Räumlichkeiten spätestens am Ende der Reservierung verlassen.",
    ],
  },
  {
    heading: "8. Stornierung der Reservierung",
    body: [
      <>
        8.1 Der Kunde kann die Stornierung der Reservierung per E-Mail an{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>{" "}
        beantragen. Der Anbieter bearbeitet den Antrag gemäß den in der
        Bestellübersicht oder im individuellen Angebot angegebenen Bedingungen
        und gemäß den zwingenden Rechtsvorschriften.
      </>,
      "8.2 Sofern in der Bestellübersicht oder im individuellen Angebot nichts anderes angegeben ist, begründet die Stornierung allein keinen besonderen vertraglichen Anspruch auf Erstattung des Preises. Die Rechte aus mangelhafter Leistung, das gesetzliche Widerrufsrecht des Verbrauchers sowie der Fall, dass der Anbieter die Leistung nicht erbracht hat, bleiben davon unberührt.",
      "8.3 Individuell vereinbarte Veranstaltungen werden gemäß den Bedingungen des jeweiligen Angebots storniert.",
      "8.4 Der Kunde hat keinen Anspruch auf Erstattung des Preises allein deshalb, weil er die Räumlichkeiten nicht genutzt hat, zu spät gekommen oder vorzeitig gegangen ist, sofern die Voraussetzungen für eine Erstattung nach diesem Artikel oder nach einer zwingenden Rechtsvorschrift nicht erfüllt sind.",
    ],
  },
  {
    heading: "9. Widerrufsrecht des Verbrauchers",
    body: [
      "9.1 Der Verbraucher kann einen online geschlossenen Vertrag innerhalb von 14 Tagen ab seinem Abschluss ohne Angabe von Gründen widerrufen, es sei denn, das Widerrufsrecht ist im konkreten Fall gesetzlich ausgeschlossen oder bereits erloschen.",
      "9.2 Soll die Leistung vor Ablauf dieser Frist beginnen, verlangt der Verbraucher im Rahmen der Bestätigung der Bestellung ausdrücklich, dass der Anbieter vor Ablauf der Frist mit der Erbringung beginnt, und nimmt zur Kenntnis, dass das Widerrufsrecht mit vollständiger Erbringung der Leistung erlischt. Widerruft er nach Beginn, aber vor vollständiger Erbringung der Leistung, zahlt er einen anteiligen Betrag des Preises für die bereits erbrachte Leistung, sofern die gesetzlichen Voraussetzungen erfüllt sind.",
      <>
        9.3 Der Widerruf kann durch eine eindeutige Erklärung an die Adresse des
        Sitzes des Anbieters oder per E-Mail an{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>{" "}
        übermittelt werden. Die Frist ist gewahrt, wenn die Mitteilung vor ihrem
        Ablauf abgesendet wird.
      </>,
      "9.4 Nach einem wirksamen Widerruf erstattet der Anbieter die erhaltenen Geldbeträge unverzüglich, spätestens innerhalb von 14 Tagen, auf demselben Weg, auf dem sie empfangen wurden, sofern die Parteien nicht etwas anderes vereinbaren, ohne dass dem Verbraucher dadurch weitere Kosten entstehen.",
      "9.5 Muster der Mitteilung: „Hiermit teile ich mit, dass ich den Vertrag über folgende Leistung widerrufe: [Beschreibung und Nummer der Reservierung], bestellt am [Datum]. Vor- und Nachname des Verbrauchers: [ergänzen]. Anschrift des Verbrauchers: [ergänzen]. Datum: [ergänzen]. Unterschrift nur bei Mitteilung in Papierform.“ Die Verwendung des Musters ist nicht verpflichtend.",
      "9.6 Die Rechte nach diesem Artikel stehen nur dem Verbraucher zu und gelten neben etwaigen günstigeren Stornierungsbedingungen, die in der Bestellübersicht oder im individuellen Angebot angegeben sind.",
    ],
  },
  {
    heading: "10. Nutzungsregeln und Haftung des Kunden",
    body: [
      "10.1 Der Kunde ist verpflichtet, die Räumlichkeiten ordnungsgemäß, nur für den bestätigten Zweck und im Einklang mit diesen AGB, der Hausordnung, den Sicherheitsanweisungen und den Rechtsvorschriften zu nutzen.",
      "10.2 Der Kunde ist für das Verhalten seiner Gäste verantwortlich und haftet für Schäden, die er oder seine Gäste durch eine Pflichtverletzung verursachen. Gewöhnliche Abnutzung gilt nicht als Schaden. Einen Schaden oder Defekt meldet der Kunde unverzüglich.",
      "10.3 Der Anbieter kann die Erbringung der Leistung bei einem schwerwiegenden oder wiederholten Verstoß gegen die AGB oder die Hausordnung, bei Überschreitung der Kapazität, bei gefährlichem oder rechtswidrigem Verhalten oder bei Missbrauch des Zugangs angemessen einschränken oder beenden. Die Rechte des Kunden bleiben davon unberührt, falls die Maßnahme nicht berechtigt war.",
    ],
  },
  {
    heading: "11. Haftung des Anbieters",
    body: [
      "11.1 Der Anbieter haftet für die ordnungsgemäße Erbringung der bestätigten Leistung und für Schäden in dem durch die Rechtsvorschriften bestimmten Umfang. Nichts in diesen AGB schließt eine Haftung, die nicht wirksam ausgeschlossen werden kann, oder die gesetzlichen Rechte des Verbrauchers aus oder beschränkt sie.",
      "11.2 Der Kunde ist für seine unternehmerische Tätigkeit, seine eigenen Daten und die in die Räumlichkeiten eingebrachten Sachen verantwortlich. Der Anbieter haftet für den Verlust oder die Beschädigung einer Sache nur in dem durch die Rechtsvorschriften bestimmten Umfang; der Kunde lässt seine Sachen daher nicht unbeaufsichtigt und sichert sie angemessen.",
      "11.3 Der Anbieter haftet nicht für ein Hindernis, das unabhängig von seinem Willen eingetreten ist und das er vernünftigerweise weder vorhersehen noch abwenden konnte. Dauert ein solches Hindernis oder eine vorübergehende Nichtverfügbarkeit so lange an, dass ein wesentlicher Teil der bestätigten Leistung nicht erbracht werden kann, wird nach Artikel 6.4 verfahren.",
      "11.4 Gegenüber einem Kunden, der nicht Verbraucher ist, haftet der Anbieter im gesetzlich zulässigen Höchstumfang nicht für mittelbare Schäden, entgangenen Gewinn oder Datenverlust, sofern er diese nicht vorsätzlich oder grob fahrlässig verursacht hat.",
    ],
  },
  {
    heading: "12. Mängel und Reklamationen",
    body: [
      "12.1 Der Kunde meldet einen Mangel der Leistung unverzüglich, damit er behoben werden kann, und gibt dabei mindestens seine Kontaktdaten, die Nummer der Reservierung, eine Beschreibung des Mangels und die gewünschte Art der Erledigung an.",
      <>
        12.2 Eine Reklamation kann am Standort, an der Adresse des Anbieters
        oder per E-Mail an{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>{" "}
        geltend gemacht werden. Der Anbieter stellt dem Verbraucher eine
        Bestätigung über ihren Eingang und ihre Erledigung aus.
      </>,
      "12.3 Über die Reklamation eines Verbrauchers entscheidet der Anbieter sofort, in komplizierten Fällen innerhalb von drei Arbeitstagen; die Reklamation einschließlich der Beseitigung des Mangels erledigt er unverzüglich, spätestens innerhalb von 30 Tagen, sofern er mit dem Verbraucher keine längere Frist vereinbart.",
      "12.4 Je nach Art des Mangels kann der Kunde Abhilfe, eine Ersatzleistung oder eine angemessene Preisminderung verlangen oder vom Vertrag zurücktreten, sofern die gesetzlichen Voraussetzungen erfüllt sind.",
    ],
  },
  {
    heading: "13. Außergerichtliche Beilegung von Verbraucherstreitigkeiten",
    body: [
      "13.1 Entsteht zwischen dem Anbieter und dem Verbraucher eine Streitigkeit aus dem Vertrag über die Erbringung der Leistungen, die nicht direkt beigelegt werden kann, kann der Verbraucher einen Antrag auf außergerichtliche Streitbeilegung bei der Česká obchodní inspekce (Tschechische Handelsinspektion), Ústřední inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2, stellen.",
      <>
        13.2 Informationen und ein elektronisches Formular finden Sie unter{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . Der Verbraucher muss den Antrag spätestens innerhalb eines Jahres ab
        dem Tag stellen, an dem er sein Recht beim Anbieter erstmals geltend
        gemacht hat.
      </>,
    ],
  },
  {
    heading: "14. Besondere Bestimmungen für Veranstaltungen",
    body: [
      "14.1 Der Kunde ist für den Ablauf der individuell vereinbarten Veranstaltung und für die daran teilnehmenden Personen verantwortlich.",
      "14.2 Der Anbieter ist berechtigt, die Veranstaltung bei einem Verstoß gegen Rechtsvorschriften, das konkrete Angebot, diese AGB oder die Hausordnung zu beenden.",
    ],
  },
  {
    heading: "15. Schlussbestimmungen",
    body: [
      "15.1 Der Anbieter kann diese AGB für Verträge ändern, die nach dem Inkrafttreten der neuen Fassung geschlossen werden. Für eine bereits geschlossene Reservierung gilt die vom Kunden bei der Bestellung akzeptierte Fassung, es sei denn, eine spätere Änderung ist für den Kunden günstiger oder er akzeptiert sie ausdrücklich.",
      "15.2 Abweichende individuelle Vereinbarungen haben Vorrang vor diesen AGB. Die Ungültigkeit oder Unwirksamkeit einer Bestimmung berührt die übrigen Bestimmungen nicht.",
      "15.3 Diese AGB treten am 12. August 2026 in Kraft.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Einleitende Bestimmungen",
    body: [
      <>
        1.1 Diese Hausordnung (nachfolgend „Hausordnung“) regelt die Verhaltens-
        und Nutzungsregeln für die Coworking-Räume, den Meetingraum, das
        Privatbüro und die Veranstaltungsräume, die von der Gesellschaft{" "}
        {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, mit Sitz in
        Turnovská 430/10, Praha 8 (nachfolgend „Betreiber“), betrieben werden.
      </>,
      "1.2 Diese Hausordnung ist für alle Personen verbindlich, die sich in den Räumen des Betreibers aufhalten (nachfolgend „Nutzer“).",
      "1.3 Der Kunde, der die Reservierung vorgenommen hat, stellt sicher, dass auch seine Gäste und weitere Personen, denen er den Zutritt ermöglicht, die Hausordnung zur Kenntnis nehmen und einhalten.",
    ],
  },
  {
    heading: "2. Grundlegende Verhaltensregeln",
    body: [
      "2.1 Der Nutzer ist verpflichtet, sich in den Räumen rücksichtsvoll und respektvoll gegenüber anderen Personen zu verhalten.",
      "2.2 In den gemeinsam genutzten und gemeinschaftlichen Räumen hält der Nutzer eine Lautstärke ein, die einer gewöhnlichen leisen Unterhaltung entspricht. Im Meetingraum oder im Privatbüro sorgt er dafür, dass der Lärm auf den reservierten Raum beschränkt bleibt.",
      "2.3 Der Nutzer darf andere Nutzer durch sein Verhalten nicht übermäßig stören oder sie in ihrer Nutzung der Räume einschränken. Der Kunde ist für das Verhalten seiner Gäste verantwortlich.",
    ],
  },
  {
    heading: "3. Verbote in den Räumen",
    body: [
      "3.1 In den Räumen ist es verboten:",
      "a) zu rauchen, einschließlich der Verwendung elektronischer Zigaretten,",
      "b) Betäubungsmittel oder psychotrope Stoffe zu konsumieren,",
      "c) die Räume unter dem Einfluss von Alkohol oder anderen Suchtmitteln in einem Maß zu betreten, das die Fähigkeit zu sicherem Verhalten einschränkt,",
      "d) Tätigkeiten auszuüben, die gegen Rechtsvorschriften verstoßen,",
      "e) die Ausstattung oder die Einrichtungen der Räume zu beschädigen,",
      "f) andere Nutzer durch unangemessenes oder aggressives Verhalten zu belästigen,",
      "g) die bestätigte Kapazität zu überschreiten oder eine Reservierung einer nicht berechtigten Person zu überlassen oder an sie weiterzuverkaufen,",
      "h) die Adresse der Räume ohne schriftliche Vereinbarung als Sitz, Geschäftsort, Standort oder Zustellanschrift zu verwenden.",
    ],
  },
  {
    heading: "4. Nutzung der Räume",
    body: [
      "4.1 Der Nutzer ist verpflichtet, die Räume ausschließlich für Zwecke zu nutzen, die ihrer Art und Bestimmung entsprechen.",
      "4.2 Der Meetingraum und das Privatbüro dürfen nur während der bestätigten Zeit und mit der bestätigten Kapazität genutzt werden. Die Nutzer verlassen die Räume spätestens am Ende der Reservierung und nehmen ihre Sachen mit.",
      "4.3 Der Nutzer ist verpflichtet, Ordnung und Sauberkeit zu wahren und nach dem Ende der Nutzung den genutzten Platz und die gemeinsame Ausstattung in einen angemessenen Zustand zu versetzen.",
      "4.4 Der Nutzer darf ohne Zustimmung des Betreibers keine Ausstattung umstellen, keine Veränderungen vornehmen, keine Geräte installieren und nicht in die technischen Leitungen eingreifen.",
      "4.5 Der Nutzer verwendet audiovisuelle, Konferenz- und sonstige Ausstattung gemäß den Anweisungen und meldet einen Defekt unverzüglich. Nach dem Ende der Reservierung schaltet er die Geräte sicher aus, sofern ihre Art dies erfordert.",
    ],
  },
  {
    heading: "5. Verpflegung",
    body: [
      "5.1 Der Nutzer ist verpflichtet, die Verpflegung in angemessenem Maß und mit Rücksicht auf andere Nutzer in Anspruch zu nehmen.",
      "5.2 Der Nutzer darf die Verpflegung nicht missbrauchen oder unbegründet verschwenden.",
    ],
  },
  {
    heading: "6. Sicherheit",
    body: [
      "6.1 Der Nutzer ist verpflichtet, auf seine eigene Sicherheit und die anderer Personen zu achten.",
      "6.2 Der Nutzer darf keine Fluchtwege blockieren oder den sicheren Betrieb der Räume auf andere Weise gefährden.",
      "6.3 Der Nutzer ist verpflichtet, den Betreiber unverzüglich auf das Entstehen einer gefährlichen Situation oder eines Defekts hinzuweisen.",
      "6.4 Die Zugangs-PIN darf der Kunde nur Personen mitteilen, die zur Teilnahme an seiner Reservierung berechtigt sind. Die Nutzer schützen sie davor, dass sie einer nicht berechtigten Person zugänglich gemacht oder von ihr ausgespäht wird, und lassen bei der Eingabe besondere Vorsicht walten.",
      "6.5 Die Anzeige der PIN auf der Zugangsseite der Reservierung schränkt die Dauer der berechtigten Nutzung der Räume in keiner Weise ein und verlängert sie auch nicht; über die Annahme des Codes entscheidet ausschließlich das Schließsystem. Die Nutzer dürfen die Räume nur während der bestätigten Zeit der Reservierung betreten und sich dort aufhalten.",
      "6.6 Türen und andere gesicherte Eingänge dürfen nicht offen gelassen werden. Einen Verdacht auf Missbrauch des Codes oder auf den Zutritt einer nicht berechtigten Person meldet der Nutzer dem Betreiber unverzüglich.",
      "6.7 Der Kunde sorgt für das sichere Kommen und Gehen seiner Gäste und darf ihnen keinen Zutritt außerhalb der bestätigten Zeit oder zu anderen als den berechtigt genutzten Räumen ermöglichen.",
      "6.8 Der Betreiber oder eine von ihm beauftragte Person darf den reservierten Raum betreten, wenn dies wegen eines außergewöhnlichen Ereignisses, aus Sicherheitsgründen, zur Abwendung eines Schadens oder für notwendige Wartungsarbeiten erforderlich ist; soweit die Umstände es zulassen, informiert er den Kunden im Voraus.",
    ],
  },
  {
    heading: "7. Haftung für Schäden",
    body: [
      "7.1 Der Nutzer haftet für Schäden, die er am Eigentum des Betreibers oder Dritter verursacht.",
      "7.2 Der Kunde haftet auch für Schäden, die seine Gäste verursachen. Gewöhnliche Abnutzung gilt nicht als Schaden.",
      "7.3 Der Nutzer ist verpflichtet, das Entstehen eines Schadens, den Verlust eines Schlüssels oder Zugangsmittels und einen Defekt unverzüglich dem Betreiber zu melden.",
    ],
  },
  {
    heading: "8. Verstöße gegen die Hausordnung",
    body: [
      "8.1 Bei einem Verstoß gegen diese Hausordnung ist der Betreiber berechtigt, angemessene Maßnahmen zur Wahrung der Ordnung und zum Schutz der anderen Nutzer zu ergreifen.",
      "8.2 Diese Maßnahmen können insbesondere eine Aufforderung zur Abhilfe, eine Einschränkung des Zugangs, die Verweisung des Nutzers aus den Räumen oder die Beendigung der Reservierung umfassen, sofern dies der Art und Schwere des Verstoßes angemessen ist.",
      "8.3 Ist dies möglich und ist der Verstoß weder schwerwiegend noch gefährlich, gibt der Betreiber vor der Beendigung der Reservierung angemessen Gelegenheit zur Abhilfe.",
    ],
  },
  {
    heading: "9. Schlussbestimmungen",
    body: [
      "9.1 Der Betreiber kann diese Hausordnung für künftige Reservierungen ändern. Für eine bereits bestätigte Reservierung ist die bei der Bestellung akzeptierte Fassung maßgeblich, sofern nicht aus Sicherheitsgründen oder aufgrund einer zwingenden Rechtsvorschrift sofortige Maßnahmen erforderlich sind.",
      "9.2 Diese Hausordnung tritt am 12. August 2026 in Kraft.",
    ],
  },
];

const legalDocuments = {
  "privacy-policy": {
    updatedAt: "8. November 2026",
    sections: [
      {
        heading: "1. Verantwortlicher",
        body: [
          <>
            {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, mit der
            Adresse des Standorts {companyAddress} und der Standort-ID{" "}
            {workspaceSiteConstants.company.establishmentId}, ist der
            Verantwortliche für Ihre personenbezogenen Daten.
          </>,
          commercialRegisterDisclosure,
          <>
            Bei Fragen zum Schutz personenbezogener Daten schreiben Sie uns an{" "}
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
        heading: "2. Welche Daten wir verarbeiten",
        body: [
          <>
            Wir verarbeiten Daten, die Sie uns über die öffentliche Website zur
            Verfügung stellen, insbesondere Kontaktdaten und den Inhalt einer
            über das Kontaktformular gesendeten Nachricht sowie
            Reservierungsdaten: Name, E-Mail, Telefonnummer, die gewählte
            Produktfamilie und das gewählte Produkt der Reservierung, Datum oder
            Datumsbereich, Beginn, Dauer, Anzahl der Plätze und etwaige
            Coworking-Wünsche zu Verpflegung, Monitoren oder Workstation.
          </>,
          <>
            Wenn Sie mit der Bestellung fortfahren, verarbeiten wir außerdem den
            angebotenen und den bezahlten Betrag, die Währung, angewendete
            Rabatte, Kennungen und Status der Zahlung und der Reservierung,
            welche Bedingungen Sie wann akzeptiert haben, ob ein Zugang
            ausgestellt wurde, sowie optionale Rechnungsdaten, die nach Ihrem
            Wunsch auf der Rechnung verwendet werden sollen. Vom
            Zahlungsdienstleister erhalten wir nicht die vollständigen Daten
            Ihrer Zahlungskarte.
          </>,
          <>
            Wenn Sie ein Kundenkonto erstellen, verarbeiten wir Ihre
            verifizierte E-Mail-Adresse, Ihre Profildaten und die zur Sicherung
            des Kontos erforderlichen Anmeldedaten. Nach einem Passwort fragen
            wir Sie nie.
          </>,
          <>
            Wenn Sie mit Ihrem Kundenkonto einen KI-Assistenten verbinden, zum
            Beispiel ChatGPT oder Claude, verarbeiten wir Angaben dazu, um
            welchen Assistenten es sich handelt, welche Berechtigungen Sie ihm
            wann erteilt haben, sowie die Zugangsdaten, die der Assistent
            verwendet. Wenn der Assistent in Ihrem Namen eine Reservierung
            einleitet, vermerken wir bei ihr, welcher Assistent sie eingeleitet
            hat.
          </>,
          <>
            Für den Betrieb der Website und zum Schutz vor Spam und Missbrauch
            können wir kurzzeitig auch technische Daten verarbeiten, zum
            Beispiel Ihre IP-Adresse und Angaben zum Browser.
          </>,
          <>
            Um zu verstehen, wie Suchmaschinen und KI-Assistenten die Website
            nutzen, ordnen wir Anfragen anhand der Browserangaben allgemeinen
            Zugriffskategorien zu. Dem Analysedienstleister teilen wir nur diese
            Kategorie mit, den Namen des erkannten Assistenten oder der
            Suchmaschine, die Seite und die Sprache, das Formular, das eine
            blockierte automatisierte Anfrage zu verwenden versucht hat, und bei
            unseren Reservierungstools für KI-Assistenten, welches Tool
            verwendet wurde und ob es erfolgreich war. Wir geben nichts weiter,
            was Sie identifizieren würde, und diese Messung hängt nicht von der
            Analyse-Einwilligung ab. Diese Kategorie und den Namen des erkannten
            Assistenten fügen wir auch den in Abschnitt 3 beschriebenen
            Aufzeichnungen über Reservierungen und Zahlungen hinzu.
          </>,
          <>
            Wenn Sie in Analyse-Cookies oder vergleichbare Technologien
            einwilligen, können wir und die Analysedienstleister Daten über die
            Nutzung der Website und die Kampagnenmessung verarbeiten, zum
            Beispiel Seitenaufrufe, Browser- und Geräteinformationen, aus der
            IP-Adresse abgeleitete technische Daten, Ereignistypen und
            Standard-Kampagnenparameter aus Links. Mit Ihrer
            Analyse-Einwilligung ordnen wir dem Analyseprofil Ihres Kontos auch
            die in Abschnitt 3 beschriebenen Aufzeichnungen über Ihre
            Reservierungen und Zahlungen zu.
          </>,
          <>
            Wenn Sie gesondert künftige Marketingnachrichten abonnieren,
            verarbeiten wir außerdem Ihren Namen, Ihre E-Mail-Adresse, Ihre
            bevorzugte Sprache, den Zeitpunkt der Einwilligung und die Version
            des Hinweises zur Marketingkommunikation, den Sie akzeptiert haben.
            Wir erfassen auch, wo Sie die Einwilligung erteilt haben, zum
            Beispiel im Reservierungsformular, in Ihrem Konto oder über einen
            Assistenten, und speichern Ihre Wahl bei Ihrem Kundendatensatz.
          </>,
        ],
      },
      {
        heading: "3. Wofür wir die Daten verwenden",
        body: [
          <>
            Kontakt-, Reservierungs-, Bestell- und Zahlungsdaten verwenden wir,
            um die Verfügbarkeit zu prüfen, die Reservierung vorzubereiten und
            zu bestätigen, Kapazität vorübergehend vorzuhalten, Zahlungen
            entgegenzunehmen oder zu überprüfen, den Zugang auszustellen,
            Bestätigungen zu senden, die gewünschte Rechnung auszustellen,
            Stornierungen oder Reklamationen zu bearbeiten, doppelte oder
            betrügerische Bestellungen zu verhindern und Sie bei der
            Reservierung zu unterstützen, wenn Sie uns kontaktieren.
          </>,
          <>
            Die Daten des Kundenkontos verwenden wir, um Sie zu verifizieren,
            Ihr Profil zu verwalten und das Konto mit Reservierungen zu
            verknüpfen, die mit derselben verifizierten E-Mail-Adresse
            vorgenommen wurden.
          </>,
          <>
            Wenn Sie einen KI-Assistenten verbinden, nutzen wir seine
            Verbindung, damit er nach Ihren Anweisungen unser Angebot
            durchsuchen, eine Reservierung einleiten kann, die Sie anschließend
            auf unserer Website bestätigen und bezahlen, und Ihnen Ihre
            Reservierungen anzeigen kann.
          </>,
          <>
            Reservierungs- und Anfragedaten verwenden wir nicht für Marketing,
            sofern Sie dazu keine gesonderte Einwilligung erteilen.
          </>,
          <>
            Wenn Sie diese optionale Einwilligung erteilen, können wir Ihre
            E-Mail-Adresse für künftige Marketing- und Community-Nachrichten von
            Deskohub Workspace verwenden. Ihre Kontaktdaten geben wir an kein
            anderes Unternehmen für dessen eigenes Marketing weiter.
          </>,
          <>
            Mit Ihrer Analyse-Einwilligung nutzen wir Analyse- und externe
            Messdienste, um die Nutzung der Website, den Erfolg beim Absenden
            von Reservierungen und die Wirksamkeit von Kampagnen zu verstehen.
            Diese Messung umfasst keine Daten, die Sie in das
            Reservierungsformular eingeben.
          </>,
          <>
            Unabhängig von der Analyse-Einwilligung übermitteln wir dem
            Analysedienstleister außerdem Aufzeichnungen über die einzelnen
            Schritte der Reservierung und der Zahlung, zum Beispiel über eine
            begonnene, abgeschlossene, fehlgeschlagene oder abgebrochene Zahlung
            und ihren Betrag. Diese Aufzeichnungen verwenden wir, um den Ablauf
            von Reservierungen und Zahlungen zu messen und Probleme mit
            Zahlungen zu erkennen. Sie sind mit Ihrer Reservierung und, mit
            Ihrer Analyse-Einwilligung, auch mit dem Analyseprofil Ihres Kontos
            verknüpft. Sie enthalten weder Ihren Namen noch Ihre Kontaktdaten.
          </>,
          <>
            Ausgewählte Kundendaten aus unserem Reservierungssystem Dotypos
            übermitteln wir außerdem an unseren Analysedienstleister, um zu
            verstehen, wie Kunden unsere Leistungen nutzen und wie dies mit
            ihrer Aktivität auf der Website zusammenhängt: Kundenkennung, Name,
            Firmenname, E-Mail, Telefon, Adresse, Geburtsdatum, Rabattgruppe,
            Treuepunkte, Kunden-Tags und die Angabe, wann der Kundendatensatz
            erstellt, zuletzt geändert oder gelöscht wurde. Notizen und weitere
            Kundendaten verbleiben in Dotypos. Bei einem angemeldeten Kunden,
            der die Analyse-Einwilligung erteilt hat, verknüpft die
            Kundenkennung diese Daten mit seiner Website-Analyse.
          </>,
        ],
      },
      {
        heading: "4. Rechtsgrundlage",
        body: [
          <>
            Vor Vertragsschluss verarbeiten wir Reservierungsdaten zur
            Durchführung vorvertraglicher Maßnahmen, die auf Ihre Anfrage
            erfolgen. Nach Vertragsschluss verarbeiten wir sie zu seiner
            Erfüllung, einschließlich Zahlung, Zugang, Support, Stornierung und
            Reklamationen. Buchhaltungs- und Transaktionsaufzeichnungen
            verarbeiten wir auch zur Erfüllung rechtlicher Verpflichtungen.
          </>,
          <>
            Die Anmeldung beim Konto, die Profilverwaltung und den
            Reservierungsverlauf verarbeiten wir, um den von Ihnen gewünschten
            Kontodienst zu erbringen und, je nach den Umständen, auch um den
            damit verbundenen Reservierungsvertrag zu erfüllen oder
            vorzubereiten. Die Sicherheit des Kontos, die Integrität der
            Sitzungen und der Schutz vor Missbrauch beruhen auf unseren
            berechtigten Interessen.
          </>,
          <>
            Die Verbindung eines KI-Assistenten und die Bearbeitung seiner
            Anfragen verarbeiten wir, um den von Ihnen gewünschten Kontodienst
            zu erbringen und, je nach den Umständen, auf Ihre Anfrage den damit
            verbundenen Reservierungsvertrag vorzubereiten.
          </>,
          <>
            Für die Sicherheit der Website, die Verhinderung von Missbrauch und
            Betrug, den verlässlichen Nachweis von Zahlung und Reservierung
            sowie die Geltendmachung, Ausübung oder Verteidigung von
            Rechtsansprüchen stützen wir uns auf unsere berechtigten Interessen,
            sofern Ihre Rechte nicht überwiegen.
          </>,
          <>
            Optionale Cookies verarbeiten wir nur auf der Grundlage Ihrer
            Einwilligung. Die Analyse Ihrer Nutzung der Website und die
            Kampagnenmessung beruhen auf einer Einwilligung, die Sie jederzeit
            in den Cookie-Einstellungen widerrufen oder ändern können.
          </>,
          <>
            Die Messung automatisierter Zugriffe nach Kategorien beruht auf
            unserem berechtigten Interesse am Betrieb der Website und an ihrer
            Verbesserung für Suchmaschinen und KI-Assistenten. Sie verwendet
            keine Daten, die Sie identifizieren würden.
          </>,
          <>
            Die Aufzeichnung der Reservierungs- und Zahlungsschritte beruht auf
            unserem berechtigten Interesse, den Ablauf von Reservierungen und
            Zahlungen zu messen und fehlgeschlagene oder abgebrochene Zahlungen
            zu erkennen, sofern Ihre Rechte nicht überwiegen. Sie können dieser
            Verarbeitung jederzeit widersprechen. Die Verknüpfung dieser
            Aufzeichnungen mit dem Analyseprofil Ihres Kontos beruht auf Ihrer
            Analyse-Einwilligung.
          </>,
          <>
            Die Übermittlung von Kundendaten aus unserem Reservierungssystem an
            den Analysedienstleister beruht auf unserem berechtigten Interesse,
            unsere Leistungen zu verstehen und zu verbessern, sofern Ihre Rechte
            nicht überwiegen. Sie können dieser Verarbeitung jederzeit
            widersprechen.
          </>,
          <>
            Künftige Marketingnachrichten beruhen auf Ihrer gesonderten
            Einwilligung. Die Erteilung der Einwilligung ist freiwillig und
            keine Voraussetzung für das Erstellen oder Bezahlen einer
            Reservierung.
          </>,
        ],
      },
      {
        heading: "5. Speicherdauer",
        body: [
          <>
            Daten aus erfolglosen Anfragen und abgebrochenen Reservierungen
            speichern wir nur so lange, wie es zur Bearbeitung der Anfrage, zur
            Wiederaufnahme einer nicht abgeschlossenen Bestellung, zur
            Verhinderung von Missbrauch oder zum Schutz von Rechtsansprüchen
            erforderlich ist. Bei abgeschlossenen Reservierungen speichern wir
            Transaktions-, Buchhaltungs-, Reklamations- und rechtliche
            Aufzeichnungen so lange, wie es die Rechtsvorschriften verlangen
            oder wie es zur Geltendmachung, Ausübung oder Verteidigung von
            Rechtsansprüchen vernünftigerweise erforderlich ist. Technische
            Signale zum Schutz vor Missbrauch sind kurzlebig.
          </>,
          <>
            Das Kundenkonto speichern wir, solange es genutzt wird;
            Anmeldesitzungen und Anmeldelinks laufen automatisch ab und werden
            regelmäßig gelöscht. Mit der Löschung des Kontos löschen wir Ihre
            Anmeldedaten und deaktivieren das verknüpfte Kundenprofil.
            Reservierungs-, Zahlungs- und Buchhaltungsaufzeichnungen sowie
            Aufzeichnungen, die zur Betrugsprävention oder als rechtliche
            Nachweise erforderlich sind, werden nicht zusammen mit dem
            Anmeldekonto gelöscht und bleiben nur für die jeweilige
            vertragliche, gesetzliche oder berechtigte Speicherdauer erhalten.
          </>,
          <>
            Die Zugangsdaten eines verbundenen Assistenten laufen automatisch ab
            und werden regelmäßig gelöscht. Die Verbindung und die erteilten
            Berechtigungen bestehen, bis Sie den Assistenten im Bereich
            „Verbundene Assistenten“ Ihres Kontos trennen oder Ihr Konto
            löschen. Mit dem Trennen des Assistenten oder der Löschung des
            Kontos enden die Verbindung und die Berechtigungen sofort: Die
            Zugangsdaten des Assistenten funktionieren sofort nicht mehr und
            werden gelöscht. Die Angabe, welcher Assistent die Reservierung
            eingeleitet hat, bleibt beim Reservierungsdatensatz erhalten.
          </>,
          <>
            Analysedaten und Daten für die Kampagnenmessung, einschließlich der
            an den Analysedienstleister übermittelten Kundendaten, speichern wir
            gemäß den Einstellungen der jeweiligen Analyse- und
            Technikdienstleister und nur so lange, wie es für die genannten
            Messzwecke erforderlich ist.
          </>,
          <>
            Die Aufzeichnung Ihrer Marketing-Einwilligung, einschließlich ihres
            Widerrufs, speichern wir bei Ihrem Kundendatensatz, damit wir
            nachweisen können, wie Sie sich entschieden haben.
          </>,
        ],
      },
      {
        heading: "6. Empfänger",
        body: [
          <>
            Zugriff auf die Daten können unser internes Workspace-Team und,
            soweit es für ihre Rolle erforderlich ist, Dienstleister für
            Hosting, Reservierungs- und Kundensystem, Zahlungsabwicklung,
            E-Mail-Zustellung, Rechnungserstellung, Sicherheit, Analyse, externe
            Messung und weitere technische Dienste haben. Zahlungsdaten
            übermitteln wir dem Zahlungsdienstleister nur zur Erstellung und
            Überprüfung der Transaktion. Für den Zugriff der Dienstleister
            setzen wir angemessene vertragliche, organisatorische und technische
            Garantien ein.
          </>,
          <>
            Kundenprofile und Reservierungen führen wir in unserem
            Reservierungssystem Dotypos.
          </>,
          <>
            Wenn Sie einen KI-Assistenten verbinden, übermitteln wir die
            Informationen, die er auf Ihre Anfrage abruft, zum Beispiel unser
            Angebot und Ihre Reservierungen, an den Anbieter dieses Assistenten,
            der mit ihnen nach seinen eigenen Bedingungen als der von Ihnen
            gewählte Empfänger umgeht. Dieser Anbieter kann seinen Sitz
            außerhalb der Europäischen Union haben, zum Beispiel in den
            Vereinigten Staaten, und Ihre Daten gelangen dorthin, weil Sie dies
            verlangt haben.
          </>,
          <>
            Wenn wir künftig Marketingnachrichten versenden, kann unser
            E-Mail-Dienstleister in unserem Namen die für ihren Versand
            erforderlichen Kontakt- und Zustelldaten verarbeiten.
          </>,
        ],
      },
      {
        heading: "7. Übermittlung in Länder außerhalb der EU",
        body: [
          <>
            Einige unserer Dienstleister oder Unternehmen, die für sie arbeiten,
            haben ihren Sitz außerhalb der Europäischen Union, sodass Ihre Daten
            auch dort verarbeitet werden können. In den Vereinigten Staaten
            nutzen wir nur Unternehmen, die nach dem EU-US-Datenschutzrahmen
            zertifiziert oder an Standardvertragsklauseln der Europäischen
            Kommission gebunden sind. Die Karte auf unserer Website wird von
            einem Dienstleister im Vereinigten Königreich geladen. Die
            Europäische Kommission hat entschieden, dass das Vereinigte
            Königreich und nach diesem Rahmen zertifizierte US-Unternehmen ein
            angemessenes Schutzniveau für personenbezogene Daten gewährleisten.
            Informationen über die Übermittlung oder eine Kopie der jeweiligen
            Garantien erhalten Sie auf Anfrage unter{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
          <>
            Unser Dienstleister für Türschlösser hat seinen Sitz in Singapur,
            für das es keine solche Entscheidung gibt. Für den Zutritt zu den
            Räumen während Ihrer Reservierung erhält er Daten zu Ihrem
            Zugangscode, zum Beispiel dessen Gültigkeitsdauer. Wir übermitteln
            sie nur, weil sie zur Erbringung der von Ihnen reservierten Leistung
            erforderlich sind.
          </>,
        ],
      },
      {
        heading: "8. Ihre Rechte",
        body: [
          <>
            Nach den geltenden Vorschriften können Sie Auskunft, Berichtigung,
            Löschung und Einschränkung der Verarbeitung verlangen, Widerspruch
            einlegen oder, soweit anwendbar, die Datenübertragbarkeit verlangen.
            Eine Beschwerde können Sie beim Úřad pro ochranu osobních údajů
            (tschechische Datenschutzaufsichtsbehörde) unter{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="https://uoou.gov.cz/"
              rel="noreferrer"
              target="_blank"
            >
              uoou.gov.cz
            </a>{" "}
            einreichen.
          </>,
          <>
            Ihre Marketing-Einwilligung können Sie jederzeit erteilen oder
            widerrufen: auf der Datenschutzseite Ihres Kontos, über den Link in
            jeder Marketing-E-Mail oder per E-Mail an{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Der Widerruf berührt nicht die Verarbeitung, die vor ihm erfolgt
            ist.
          </>,
          <>
            Ihr Kundenkonto können Sie auf Ihrer Profilseite löschen. Diese
            Löschung, die Sie selbst vornehmen, entfernt das Anmeldekonto,
            ersetzt aber keinen umfassenderen Antrag nach den
            Datenschutzvorschriften zu Reservierungen oder gesetzlich
            aufbewahrten Aufzeichnungen; einen solchen Antrag senden Sie an{" "}
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
    updatedAt: "5. August 2026",
    sections: [
      {
        heading: "1. Wer Sie kontaktieren kann",
        body: [
          <>
            Bei künftigen Marketingnachrichten ist der Absender und
            Verantwortliche {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, mit der
            Anschrift {companyAddress}.
          </>,
        ],
      },
      {
        heading: "2. Worin Sie einwilligen",
        body: [
          "Sie willigen ein, dass wir Ihren Namen, Ihre E-Mail-Adresse und Ihre bevorzugte Sprache verwenden, um Ihnen künftig Marketing- und Community-Nachrichten von Deskohub Workspace per E-Mail zu senden.",
          "Die Einwilligung gilt für E-Mail-Marketing für unsere eigenen Leistungen bei Deskohub Workspace. Ihre Kontaktdaten geben wir an kein anderes Unternehmen für dessen eigenes Marketing weiter.",
          "Die Einwilligung ist mit dem jeweiligen Kundendatensatz verknüpft, nicht mit der E-Mail-Adresse. Ändert sich die E-Mail-Adresse dieses Datensatzes, bleibt die Einwilligung bei diesem Datensatz. Kundendatensätze mit derselben E-Mail-Adresse haben getrennte Einwilligungen.",
        ],
      },
      {
        heading: "3. Ihre Wahl",
        body: [
          "Die Einwilligung ist freiwillig und von der Reservierung getrennt. Wenn Sie das Marketing-Kästchen nicht ankreuzen, hindert Sie das in keiner Weise daran, eine Reservierung zu erstellen oder zu bezahlen.",
          "Wenn Sie das Marketing-Kästchen nicht ankreuzen, widerrufen Sie damit keine bereits bestehende Präferenz.",
          "Die Einwilligung erfassen wir beim jeweiligen Kundendatensatz zusammen mit dem Zeitpunkt und der Version des Hinweises, damit wir nachweisen können, was Sie akzeptiert haben.",
          "Eine anonyme Reservierung kann eine anfängliche Marketing-Präferenz des Kunden nur dann festlegen, wenn noch keine Präferenz besteht. Eine bestehende Präferenz kann sie nicht überschreiben.",
        ],
      },
      {
        heading: "4. Verwaltung und Widerruf der Einwilligung",
        body: [
          <>
            Sie können die Einwilligung auf der Datenschutzseite Ihres Kontos
            erteilen oder widerrufen, wenn Sie mit einem verifizierten Konto
            angemeldet sind, das mit dem jeweiligen Kundendatensatz verknüpft
            ist. Auch ein persönlicher, kundenspezifischer Link in einer
            künftigen Marketingnachricht kann Ihnen die Erteilung oder den
            Widerruf der Einwilligung ermöglichen. Ist keine dieser
            Möglichkeiten verfügbar, wenden Sie sich an unseren Support unter{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Der Widerruf gilt für künftiges Marketing und berührt nicht die
            vorherige rechtmäßige Verarbeitung.
          </>,
        ],
      },
      {
        heading: "5. Dienstleister und Ihre Rechte",
        body: [
          <>
            Wenn wir künftig Marketingnachrichten versenden, kann unser
            E-Mail-Dienstleister in unserem Namen die für ihren Versand
            erforderlichen Kontakt- und Zustelldaten verarbeiten. Weitere
            Informationen zu Empfängern, Garantien und Ihren Rechten finden Sie
            in unserer{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/de-DE/privacy-policy"
            >
              Datenschutzerklärung
            </a>
            .
          </>,
        ],
      },
    ],
  },
  "terms-and-conditions": {
    updatedAt: "12. August 2026",
    sections: termsAndConditionsSections,
  },
  "cookie-policy": {
    updatedAt: "8. November 2026",
    sections: [
      {
        heading: "1. Was sind Cookies",
        body: [
          <>
            Cookies sind kleine Textdateien, die im Browser gespeichert werden
            und der Website helfen, sich technische Einstellungen zu merken, die
            Benutzerfreundlichkeit zu verbessern und die Aktivierung optionaler
            Funktionen zu steuern.
          </>,
        ],
      },
      {
        heading: "2. Notwendige Cookies",
        body: [
          <>
            Notwendige Cookies unterstützen den grundlegenden Betrieb der
            Website, die Sprachauswahl, die Sicherheit und die Speicherung des
            Status Ihrer Cookie-Einwilligung. Diese Cookies sind immer aktiv, da
            die Website ohne sie nicht zuverlässig funktionieren kann.
          </>,
          <>
            Nach der Anmeldung bei Ihrem Kundenkonto hält Sie ein notwendiges
            Sitzungscookie höchstens 30 Tage lang angemeldet. Es wird erst nach
            der Anmeldung gesetzt und bei der Abmeldung oder der Löschung des
            Kontos entfernt.
          </>,
          <>
            Wenn Sie einen Empfehlungslink eines anderen Kunden öffnen, merkt
            sich ein notwendiges Cookie höchstens 30 Tage lang dessen
            Empfehlungscode, damit der von Ihnen gewünschte Rabatt beim
            Vervollständigen des Profils oder bei der Reservierung angewendet
            werden kann. Ein später geöffneter Empfehlungslink ersetzt den
            gespeicherten Code nicht; ersetzt wird er jedoch durch einen
            Empfehlungscode, den Sie im Bestellvorgang eingeben und der
            akzeptiert wird. Das Cookie wird entfernt, sobald die Empfehlung
            erfasst oder Ihre erste Reservierung bezahlt ist, und wird nicht zum
            Tracking verwendet.
          </>,
        ],
      },
      {
        heading: "3. Präferenz-Cookies",
        body: [
          <>
            Präferenz-Cookies merken sich optionale Anzeige- oder
            Interaktionseinstellungen, sofern solche Funktionen auf der Website
            aktiv sind.
          </>,
        ],
      },
      {
        heading: "4. Analyse- und Marketing-Cookies",
        body: [
          <>
            Analyse- und Marketing-Cookies sind optional. Sofern Analyse-,
            externe Mess-, Kampagnen- oder vergleichbare technische Tools von
            Dienstleistern auf der Website eingesetzt werden, werden sie erst
            nach Ihrer Einwilligung über das Cookie-Banner oder die Seite mit
            den Cookie-Einstellungen aktiviert.
          </>,
          <>
            Analyse-Cookies helfen uns, die Nutzung der Website, den Erfolg beim
            Absenden von Reservierungen und die Wirksamkeit von Kampagnen zu
            verstehen. Je nach Kategorie des Dienstleisters können die
            verarbeiteten Daten Seitenaufrufe, Browser- und Geräteinformationen,
            aus der IP-Adresse abgeleitete technische Daten, Ereignistypen und
            Standard-Kampagnenparameter aus der URL umfassen: utm_source,
            utm_medium, utm_campaign, utm_content und utm_term.
          </>,
          <>
            Mit Ihrer Analyse-Einwilligung ordnen wir dem Analyseprofil Ihres
            Kontos auch Aufzeichnungen über Ihre Reservierungen und Zahlungen
            zu, wie in unserer{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/de-DE/privacy-policy"
            >
              Datenschutzerklärung
            </a>{" "}
            beschrieben.
          </>,
          <>
            Konversionsereignisse zum Absenden einer Reservierung enthalten
            weder Werte aus dem Reservierungsformular noch personenbezogene
            Daten wie Name, E-Mail, Telefon, Nachricht, Datumsangaben oder
            Uhrzeiten der Reservierung, Dauer, Anzahl der Plätze, das gewählte
            Produkt oder die Auswahl zu Verpflegung, Monitor oder Workstation.
          </>,
        ],
      },
      {
        heading: "5. So verwalten Sie Ihre Einwilligung",
        body: [
          <>
            Sie können alle optionalen Kategorien akzeptieren, die optionalen
            Kategorien ablehnen oder sie einzeln über das Cookie-Banner und die
            gesonderte Seite mit den Cookie-Einstellungen verwalten, die über
            die Fußzeile erreichbar ist.
          </>,
        ],
      },
    ],
  },
  "operating-rules": {
    updatedAt: "12. August 2026",
    sections: operatingRulesSections,
  },
} satisfies LegalDocumentBodies;

export const translation = {
  translationNotice:
    "Dies ist eine Übersetzung des tschechischen Originals. Bei Abweichungen zwischen dieser Übersetzung und der tschechischen Fassung ist die tschechische Fassung maßgebend.",
  documents: legalDocuments,
} satisfies LegalDocumentTranslation;
