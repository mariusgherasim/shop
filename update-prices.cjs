const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");

const IMG_PROXY = "https://img-proxy.gherasimmarius75.workers.dev/?url=";
const PRODUCTS_PATH = "src/data/products.json";
const CONCURRENCY = 3;
const SAVE_EVERY = 50;

/** Asigură că image_url folosește proxy-ul — apelat la orice produs watchshop.ro. */
function ensureProxiedImage(product) {
  if (
    product.image_url &&
    product.image_url.startsWith("https://cdn.watchshop.ro/") &&
    !product.image_url.startsWith(IMG_PROXY)
  ) {
    product.image_url = IMG_PROXY + product.image_url;
  }
}

/**
 * Transformă un text de preț ("109,99 Lei", "1.164,99 Lei", "109.99") într-un
 * număr JS (109.99, 1164.99). Formatul românesc Gomag folosește punct pentru
 * mii și virgulă pentru zecimale.
 */
function parsePrice(text) {
  if (!text) return null;

  let clean = text
    .replace(/lei/i, "")
    .replace(/\s+/g, "")
    .trim();

  if (clean.includes(".") && clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }

  const value = parseFloat(clean);
  return isNaN(value) ? null : value;
}

function getFirstText($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim().replace(/\s+/g, " ");
    if (value) return value;
  }
  return "";
}

function isPlausibleOldPrice(oldPrice, price) {
  if (!oldPrice || !price) return false;
  return oldPrice > price && oldPrice <= price * 5;
}

const GOMAG_PRICE_SELECTORS = [
  ".pp-action-price-value",
  ".product-price",
  ".price-final",
  ".price",
];
const GOMAG_OLD_PRICE_SELECTORS = [
  ".pp-action-price-old-value",
  ".product-price-old",
  ".price-full",
  ".price-old",
];

async function updateCeasuriShop(product) {
  const response = await axios.get(product.official_url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const $ = cheerio.load(response.data);

  const currentText = getFirstText($, GOMAG_PRICE_SELECTORS);
  const oldText = getFirstText($, GOMAG_OLD_PRICE_SELECTORS);

  const price = parsePrice(currentText);
  const oldPrice = parsePrice(oldText);

  if (price == null) {
    console.log("⚠ Nu am găsit prețul:", product.title);
    console.log("🔴 Dezactivat automat:", product.title);
    product.draft = true;
    return;
  }

  product.price = price;
  product.old_price = isPlausibleOldPrice(oldPrice, price) ? oldPrice : null;
  console.log("✔", product.title, product.price, product.old_price ? `(vechi: ${product.old_price})` : "");
}

const WATCHSHOP_PRICE_SELECTORS = [
  ".price-box .price-value",
  ".price-value",
];
const WATCHSHOP_OLD_PRICE_SELECTORS = [
  "p.old_price del",        // confirmat din markup real (august 2026)
  ".price-box .price-value-old",
  ".price-box .old-price-value",
  ".price-box del",
  ".price-old .price-value",
];

async function updateWatchshop(product, browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "ro-RO",
  });
  const page = await context.newPage();

  try {
    await Promise.race([
      page.goto(product.official_url, { waitUntil: "networkidle", timeout: 30000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout 35s")), 35000)),
    ]);

    let currentText = "";
    let oldText = "";

    for (const sel of WATCHSHOP_PRICE_SELECTORS) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        currentText = (await el.textContent())?.trim() || "";
        if (currentText) break;
      }
    }
    for (const sel of WATCHSHOP_OLD_PRICE_SELECTORS) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        oldText = (await el.textContent())?.trim() || "";
        if (oldText) break;
      }
    }

    const price = parsePrice(currentText);
    const oldPrice = parsePrice(oldText);

    if (price == null) {
      const pageTitle = await page.title();
      console.log("⚠ Nu am găsit prețul (watchshop):", product.title);
      console.log("   URL final:", page.url());
      console.log("   Titlu pagină:", pageTitle);
      console.log("🔴 Dezactivat automat:", product.title);
      product.draft = true;
      return;
    }

    product.price = price;
    product.old_price = isPlausibleOldPrice(oldPrice, price) ? oldPrice : null;
    ensureProxiedImage(product);

    console.log("✔", product.title, product.price, product.old_price ? `(vechi: ${product.old_price})` : "");
  } finally {
    await page.close();
    await context.close();
  }
}

// Procesează un singur produs — wrapper cu error handling
async function processProduct(product, browser) {
  if (product.draft) return { skipped: true };
  if (!product.official_url) {
    console.log("⏭ Fără official_url, ignor:", product.title);
    return { skipped: true };
  }

  try {
    if (product.source_site === "ceasuri-shop.ro") {
      await updateCeasuriShop(product);
    } else if (product.source_site === "watchshop.ro") {
      await updateWatchshop(product, browser);
    } else {
      console.log("⏭ Sursă necunoscută, ignor:", product.title, product.source_site);
      return { skipped: true };
    }
    return { deactivated: product.draft };
  } catch (error) {
    console.log("\n❌", product.title);
    console.log(error.message);
    console.log("   Păstrez prețul existent:", product.price);
    return { error: true };
  }
}

async function updatePrices() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));

  // Separă produsele care trebuie procesate
  const toProcess = products.filter(p => !p.draft && p.official_url &&
    (p.source_site === "watchshop.ro" || p.source_site === "ceasuri-shop.ro"));
  const skippedDraft = products.filter(p => p.draft).length;

  console.log(`Total produse: ${products.length}`);
  console.log(`Sărite (draft): ${skippedDraft}`);
  console.log(`De procesat: ${toProcess.length}`);
  console.log(`Concurență: ${CONCURRENCY} | Salvare la fiecare: ${SAVE_EVERY} produse\n`);

  let browser = null;
  const hasWatchshop = toProcess.some(p => p.source_site === "watchshop.ro");
  if (hasWatchshop) {
    console.log("🌐 Pornesc Chromium pentru watchshop.ro...");
    browser = await chromium.launch({ headless: true });
  }

  const deactivated = [];
  let processed = 0;
  let errors = 0;

  // Procesare în batches de CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (product) => {
        const result = await processProduct(product, browser);
        if (result.deactivated) deactivated.push(product);
        if (result.error) errors++;
        if (!result.skipped) processed++;
      })
    );

    // Salvare incrementală la fiecare SAVE_EVERY produse procesate
    if (processed > 0 && processed % SAVE_EVERY === 0) {
      fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n");
      console.log(`\n💾 Salvat progres: ${processed}/${toProcess.length} produse procesate\n`);
    }
  }

  if (browser) {
    await browser.close();
    console.log("🌐 Chromium închis.");
  }

  // Salvare finală
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n");

  console.log(`\n✔ Procesate: ${processed}`);
  console.log(`❌ Erori (preț păstrat): ${errors}`);
  console.log(`⏭ Sărite (draft): ${skippedDraft}`);

  if (deactivated.length > 0) {
    console.log(`\n🔴 Dezactivate automat (${deactivated.length}) — nu mai există la sursă:`);
    for (const p of deactivated) {
      console.log(`   - [${p.id}] ${p.title} (${p.source_site})`);
    }
  } else {
    console.log("\n✔ Niciun produs dezactivat automat.");
  }

  console.log("\nToate prețurile au fost actualizate.");
}

updatePrices();
