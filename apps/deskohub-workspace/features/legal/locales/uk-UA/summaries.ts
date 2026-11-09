import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
  "privacy-policy": {
    title: "Політика конфіденційності",
    lead: "На цій сторінці ми пояснюємо, як компанія Desktechub s.r.o. обробляє персональні дані на вебсайті Deskohub Workspace, зокрема в облікових записах клієнтів, у контактній формі та під час бронювання.",
  },
  "marketing-communications": {
    title: "Згода на маркетингові повідомлення",
    lead: "Це інформаційне повідомлення пояснює необовʼязкову згоду на отримання від компанії Desktechub s.r.o. майбутніх маркетингових повідомлень і повідомлень для спільноти Deskohub Workspace електронною поштою.",
  },
  "terms-and-conditions": {
    title: "Загальні умови надання послуг",
    lead: "Ці загальні умови надання послуг регулюють відвідування коворкінгу та онлайн-бронювання переговорної кімнати й приватного офісу в Deskohub Workspace.",
  },
  "cookie-policy": {
    title: "Політика використання файлів cookie",
    lead: "На цій сторінці ми пояснюємо, як вебсайт Deskohub Workspace використовує файли cookie і як Ви можете керувати своїми вподобаннями.",
  },
  "operating-rules": {
    title: "Правила внутрішнього розпорядку",
    lead: "Ці правила внутрішнього розпорядку встановлюють правила поведінки та користування простором коворкінгу, переговорною кімнатою, приватним офісом і приміщеннями для заходів Deskohub Workspace.",
  },
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
