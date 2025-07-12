import { drinkMenu, foodMenu } from "../menu-data";

export function generateMenuPDF() {
  // Create a simple HTML content for PDF generation
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Deskohub Menu</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { color: #22c55e; font-size: 24px; font-weight: bold; }
        .section { margin-bottom: 30px; }
        .section-title { color: #22c55e; font-size: 20px; font-weight: bold; margin-bottom: 15px; }
        .item { display: flex; justify-content: space-between; margin-bottom: 10px; padding: 8px; border-bottom: 1px solid #eee; }
        .item-name { font-weight: bold; }
        .item-description { color: #666; font-size: 12px; }
        .item-price { font-weight: bold; color: #22c55e; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">🎲 Deskohub</div>
        <h1>Menu</h1>
      </div>
      
      ${foodMenu
        .map(
          (section) => `
        <div class="section">
          <div class="section-title">${section.title}</div>
          ${section.items
            .map(
              (item) => `
            <div class="item">
              <div>
                <div class="item-name">${item.name} ${item.weight ? `(${item.weight})` : ""}</div>
                ${item.description ? `<div class="item-description">${item.description}</div>` : ""}
              </div>
              <div class="item-price">${item.price} Kč</div>
            </div>
          `
            )
            .join("")}
        </div>
      `
        )
        .join("")}
      
      ${drinkMenu
        .map(
          (section) => `
        <div class="section">
          <div class="section-title">${section.title}</div>
          ${section.items
            .map(
              (item) => `
            <div class="item">
              <div>
                <div class="item-name">${item.name}</div>
                ${item.description ? `<div class="item-description">${item.description}</div>` : ""}
              </div>
              <div class="item-price">${item.price} Kč</div>
            </div>
          `
            )
            .join("")}
        </div>
      `
        )
        .join("")}
    </body>
    </html>
  `;

  // Create a blob and download link
  const blob = new Blob([htmlContent], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "deskohub-menu.html";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
