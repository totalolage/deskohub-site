import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
  "privacy-policy": {
    title: "Chính sách bảo vệ dữ liệu cá nhân",
    lead: "Trang này giải thích cách Desktechub s.r.o. xử lý dữ liệu cá nhân trên trang web Deskohub Workspace, bao gồm tài khoản khách hàng, biểu mẫu liên hệ và đặt chỗ.",
  },
  "marketing-communications": {
    title: "Đồng ý nhận thông tin tiếp thị",
    lead: "Thông báo này giải thích sự đồng ý không bắt buộc đối với việc nhận thông tin tiếp thị và thông tin cộng đồng của Deskohub Workspace qua email từ công ty Desktechub s.r.o. trong tương lai.",
  },
  "terms-and-conditions": {
    title: "Điều kiện Giao dịch Chung",
    lead: "Điều kiện Giao dịch Chung này điều chỉnh các lượt vào coworking và việc đặt chỗ trực tuyến phòng họp và văn phòng riêng tại Deskohub Workspace.",
  },
  "cookie-policy": {
    title: "Chính sách cookie",
    lead: "Trang này giải thích cách trang web Deskohub Workspace sử dụng cookie và cách Quý khách có thể quản lý tùy chọn của mình.",
  },
  "operating-rules": {
    title: "Nội quy",
    lead: "Nội quy này quy định việc ứng xử và sử dụng không gian coworking, phòng họp, văn phòng riêng và không gian sự kiện của Deskohub Workspace.",
  },
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
