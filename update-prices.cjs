const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");

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
        // 1.164,99 -> 1164.99
        clean = clean.replace(/\./g, "").replace(",", ".");
    } else if (clean.includes(",")) {
        // 109,99 -> 109.99
        clean = clean.replace(",", ".");
    }
    // dacă are deja doar punct, îl lăsăm așa (109.99)

    const value = parseFloat(clean);
    return isNaN(value) ? null : value;
}

function getFirstText($, selectors) {
    for (const selector of selectors) {
        // NU ștergem elementele copil (ex: <sup>,00</sup>) — pe watchshop.ro
        // zecimalele sunt chiar acolo, ștergerea lor rupe complet prețul.
        const value = $(selector).first().text().trim().replace(/\s+/g, " ");
        if (value) return value;
    }
    return "";
}

function calculateDiscount(oldPrice, newPrice) {
    if (!oldPrice || !newPrice || oldPrice <= newPrice) return null;
    return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

// Siguranță: selectoarele de "preț vechi" pe watchshop.ro nu sunt confirmate
// cu markup real (spre deosebire de cel de preț curent) — pot prinde din
// greșeală alt număr de pe pagină (SKU, telefon etc.). Un preț vechi de peste
// 5x prețul curent e aproape sigur o eroare, nu o reducere reală.
function isPlausibleOldPrice(oldPrice, price) {
    if (!oldPrice || !price) return false;
    return oldPrice > price && oldPrice <= price * 5;
}

// Selectoare încercate în ordine — platforma Gomag (ceasuri-shop.ro) folosește
// de obicei una din variantele astea pe pagina de produs. Dacă niciuna nu
// prinde, verifică manual pagina (click dreapta -> Inspect pe preț) și
// trimite-mi clasa CSS exactă ca s-o adaug.
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
        console.log("🔴 Dezactivat automat (produs inactiv la sursă):", product.title);
        product.draft = true;
        return;
    }

    product.price = price;

    if (isPlausibleOldPrice(oldPrice, price)) {
        product.old_price = oldPrice;
    } else {
        product.old_price = null;
    }

    console.log("✔", product.title, product.price, product.old_price ? `(vechi: ${product.old_price})` : "");
}

// watchshop.ro are protecție anti-bot — necesită Chromium real, nu cereri simple.
// Selectoarele de mai jos sunt cea mai bună estimare; dacă nu prind, scriptul
// afișează titlul paginii + URL-ul final, ca să poți verifica manual și să-mi
// trimiți clasa corectă.
// watchshop.ro — confirmat direct din markup-ul real (14 iulie 2026):
// <div class="price-box"><p class="price-value">3.522<sup>,00</sup> lei</p></div>
// Selectorul specific e primul — cei generici rămân doar ca ultimă soluție,
// dar au cauzat prinderea unui preț greșit (dintr-un carusel de produse
// similare) când selectorul specific lipsea din listă.
const WATCHSHOP_PRICE_SELECTORS = [
    ".price-box .price-value",
    ".price-value",
];
const WATCHSHOP_OLD_PRICE_SELECTORS = [
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
        await page.goto(product.official_url, { waitUntil: "networkidle", timeout: 30000 });

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
            console.log("🔴 Dezactivat automat (produs inactiv la sursă):", product.title);
            product.draft = true;
            return;
        }

        product.price = price;
        product.old_price = isPlausibleOldPrice(oldPrice, price) ? oldPrice : null;

        console.log("✔", product.title, product.price, product.old_price ? `(vechi: ${product.old_price})` : "");
    } finally {
        await page.close();
        await context.close();
    }
}

async function updatePrices() {
    const products = JSON.parse(fs.readFileSync("src/data/products.json", "utf8"));

    let browser = null;
    let skippedDraft = 0;
    const deactivated = [];

    for (const product of products) {
        // IMPORTANT: produsele draft nu sunt live pe site — n-are rost să le
        // ținem prețul "proaspăt". La un catalog mare (mii de draft-uri din
        // import feed), asta economisește ore întregi de scraping inutil.
        if (product.draft) {
            skippedDraft++;
            continue;
        }

        if (!product.official_url) {
            console.log("⏭ Fără official_url, ignor:", product.title);
            continue;
        }

        try {
            console.log("Actualizez:", product.title);

            if (product.source_site === "ceasuri-shop.ro") {
                await updateCeasuriShop(product);
            } else if (product.source_site === "watchshop.ro") {
                if (!browser) {
                    console.log("🌐 Pornesc Chromium pentru watchshop.ro...");
                    browser = await chromium.launch({ headless: true });
                }
                await updateWatchshop(product, browser);
            } else {
                console.log("⏭ Sursă necunoscută, ignor:", product.title, product.source_site);
            }

            // Produsul a fost draft:false la intrarea în buclă (le sărim pe cele
            // draft mai sus) — dacă acum e draft:true, updateCeasuriShop/updateWatchshop
            // tocmai l-a dezactivat automat pentru că nu a găsit prețul la sursă.
            if (product.draft) {
                deactivated.push(product);
            }
        } catch (error) {
            console.log("\n❌", product.title);
            console.log(error.message);
            console.log("   Păstrez prețul existent:", product.price);
        }
    }

    if (browser) {
        await browser.close();
        console.log("🌐 Chromium închis.");
    }

    fs.writeFileSync("src/data/products.json", JSON.stringify(products, null, 2) + "\n");
    console.log(`\n⏭ Sărite (draft): ${skippedDraft}`);

    if (deactivated.length > 0) {
        console.log(`\n🔴 Produse dezactivate automat în această rulare (${deactivated.length}) — nu mai există la sursă, verifică-le manual dacă vrei să le repari sau să le ștergi din products.json:`);
        for (const p of deactivated) {
            console.log(`   - [${p.id}] ${p.title} (${p.source_site})`);
        }
    } else {
        console.log("\n✔ Niciun produs dezactivat automat — toate prețurile s-au găsit corect.");
    }

    console.log("\nToate prețurile au fost actualizate.");
}

updatePrices();
