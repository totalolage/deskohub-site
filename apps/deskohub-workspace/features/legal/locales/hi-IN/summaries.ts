import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
  "privacy-policy": {
    title: "गोपनीयता नीति",
    lead: "इस पेज पर हम बताते हैं कि Desktechub s.r.o. Deskohub Workspace वेबसाइट पर, ग्राहक खातों, संपर्क फ़ॉर्म और बुकिंग सहित, व्यक्तिगत डेटा का प्रसंस्करण कैसे करती है।",
  },
  "marketing-communications": {
    title: "मार्केटिंग संदेशों के लिए सहमति",
    lead: "यह सूचना Desktechub s.r.o. की ओर से email द्वारा भेजे जाने वाले Deskohub Workspace के भविष्य के मार्केटिंग और समुदाय संबंधी संदेशों के लिए वैकल्पिक सहमति के बारे में बताती है।",
  },
  "terms-and-conditions": {
    title: "सामान्य नियम और शर्तें",
    lead: "ये सामान्य नियम और शर्तें Deskohub Workspace में कोवर्किंग प्रवेश, और मीटिंग रूम तथा निजी ऑफ़िस की ऑनलाइन बुकिंग को नियंत्रित करती हैं।",
  },
  "cookie-policy": {
    title: "कुकी नीति",
    lead: "इस पेज पर हम बताते हैं कि Deskohub Workspace वेबसाइट कुकीज़ का उपयोग कैसे करती है, और आप अपनी प्राथमिकताओं का प्रबंधन कैसे करें।",
  },
  "operating-rules": {
    title: "परिसर नियमावली",
    lead: "यह परिसर नियमावली Deskohub Workspace के कोवर्किंग स्पेस, मीटिंग रूम, निजी ऑफ़िस और कार्यक्रम स्थलों में आचरण और उनके उपयोग को नियंत्रित करती है।",
  },
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
