// Set NODE_ENV if not set
process.env.NODE_ENV = process.env.NODE_ENV || "development";

import { env } from "@/env";

async function fetchRawProducts() {
  const cloudId = env.DOTYPOS_CLOUD_ID;
  const token = env.DOTYPOS_API_TOKEN;

  const url = `https://api.dotypos.com/v2/clouds/${cloudId}/products?limit=100&offset=0&includes=deleted`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Find the test localization product
    const products = data.data || [];
    const testProduct = products.find(
      (p: any) =>
        p.name?.toLowerCase().includes("test") &&
        p.name.toLowerCase().includes("localization")
    );

    if (testProduct) {
    } else {
      products.forEach((_p: any) => {});
    }

    // Log first product to see structure
    if (products.length > 0) {
    }
  } catch (error) {
    console.error("Error fetching products:", error);
  }
}

fetchRawProducts();
