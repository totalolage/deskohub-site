import { siteConstants } from "@/shared/utils/constants";

export const gdprEnglish = (
  <section>
    <h2>Data Controller</h2>
    <p>
      deskohub s.r.o., Company ID: {siteConstants.contact.ico}, registered at{" "}
      {siteConstants.contact.address.street},{" "}
      {siteConstants.contact.address.postalCode}{" "}
      {siteConstants.contact.address.city}{" "}
      {siteConstants.contact.address.countryCode}, e-mail:{" "}
      {siteConstants.contact.gdprEmail}.
    </p>

    <h2>1. What data we process and why</h2>
    <p>
      We process the data you provide to us via the reservation/contact form:
    </p>
    <ul>
      <li>full name</li>
      <li>contact information (email, phone)</li>
      <li>other information provided in the form</li>
    </ul>
    <p>Purpose: processing the reservation / inquiry.</p>
    <p>Legal basis: your explicit consent under Article 6(1)(a) GDPR.</p>

    <h2>2. Photos and video – purpose, public use, and retention</h2>
    <p>
      During events, we take photographs and videos for the purpose of promoting
      our business, including publication on our website, social media, and
      other communication channels.
    </p>
    <p>
      <strong>Indefinite use:</strong> If you give consent, these photos and
      videos may be stored and used indefinitely for promotional and public
      purposes.
    </p>
    <p>
      <strong>Withdrawal of consent:</strong> You have the right to withdraw
      your consent at any time by contacting us at{" "}
      {siteConstants.contact.gdprEmail} or by another easily accessible method.
      Withdrawal of consent applies to future use and means that we will stop
      using your images in new media.
    </p>

    <h3>What happens to already published content:</h3>
    <ul>
      <li>
        Withdrawal of consent does not mean that previously legally published
        materials were processed unlawfully — GDPR does not require retroactive
        deletion of processing that has already occurred.
      </li>
      <li>
        If you wish to remove specific photos or videos that have already been
        published, we will do so whenever it is technically feasible and as soon
        as possible after receiving your request. The technical feasibility of
        removing content from public channels (e.g., archived social media posts
        or external media) may be limited, in which case we will inform you
        accordingly.
      </li>
    </ul>

    <h2>3. Who processes your data</h2>
    <ul>
      <li>deskohub s.r.o. (data controller)</li>
      <li>our technical processors (based on a data processing agreement)</li>
      <li>other recipients only with your consent or if required by law</li>
    </ul>

    <h2>4. Your rights</h2>
    <p>In accordance with GDPR, you have the right at any time to:</p>
    <ul>
      <li>access your data</li>
      <li>request correction of inaccurate data</li>
      <li>withdraw your consent (see above)</li>
      <li>
        request deletion of personal data, if there is no other legal basis for
        further processing
      </li>
      <li>request restriction of processing</li>
      <li>file a complaint with the Office for Personal Data Protection</li>
    </ul>
    <p>
      Consent can be withdrawn at any time via e-mail:{" "}
      {siteConstants.contact.gdprEmail}.
    </p>
  </section>
);
