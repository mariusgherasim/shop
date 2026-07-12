const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// ⚠️ Pune aici link-ul tău de feed XML (Copy XML link din 2Performant → My Feeds).
// XML-ul are toate câmpurile (product_id, category, brand, url oficial, old_price) —
// CSV-ul de la 2Performant e un format vechi, fix la 6 coloane, indiferent ce
// activezi în "Fields". Foloseste XML.
const FEED_URL = "https://api.2performant.com/feed/9ac9d95ae.xml";

// ---------- utilitare ----------

function cleanText(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toNumber(s) {
    if (s == null || s === "") return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

const KNOWN_COLORS = [
    "Negru", "Maro", "Rosu", "Albastru", "Verde", "Roz", "Auriu", "Argintiu",
    "Gri", "Portocaliu", "Alb", "Mov", "Turcoaz", "Bej", "Kaki", "Bronz",
    "Bleumarin", "Vişiniu", "Visiniu", "Galben",
];

// Categoriile 2Performant care ne interesează, mapate la categoriile site-ului.
const CATEGORY_MAP = {
    "ceasuri de mana": "ceasuri",
    "ceasuri": "ceasuri",
    "ochelari de soare": "ochelari-de-soare",
};

const FIELD_MAP = [
    ["Mecanism", "mecanism", "text"],
    ["Display", "afisaj", "text"],
    ["Rezistenta la apa", "rezistenta_apa", "text"],
    ["Capac care permite gravura personalizata", "gravura_posibila", "bool"],
    ["Culoare cadran", "culoare_cadran", "text"],
    ["Material geam", "material_geam", "text"],
    ["Dimensiune carcasa", "diametru_cadran_mm", "number"],
    ["Material carcasa", "material_carcasa", "text"],
    ["Culoare carcasa", "culoare_carcasa", "text"],
    ["Grosime carcasa", "grosime_carcasa_mm", "number"],
    ["Material curea/bratara", "material_bratara", "text"],
    ["Culoare curea/bratara", "culoare_bratara", "text"],
    ["Latime curea/bratara (telescop)", "latime_bratara_mm", "number"],
    ["Sistem inchidere", "inchidere", "text"],
    ["Greutate", "greutate_g", "number"],
    ["Stil rama", "stil_rama", "auto"],
    ["Culoare rama", "culoare_rama", "text"],
    ["Culoare lentile", "culoare_lentila", "text"],
    ["Material rama", "material_rama", "text"],
    ["Tip lentila", "tip_lentila", "text"],
    ["Tip rama", "tip_rama", "text"],
    ["Latime lentile", "latime_lentila_mm", "number"],
    ["Lungime brate", "lungime_brat_mm", "number"],
    ["Punte nazala", "punte_nazala_mm", "number"],
    ["Protectie", "protectie_uv", "text"],
];

const IGNORED_LABELS = [
    "Stil", "Colectia", "Denumire mecanism", "Provenienta mecanism", "Indica",
    "Afiseaza", "Tip citire cadran", "Forma carcasei", "Dimensiune cadran",
    "Design curea/bratara", "Finisaj curea/bratara", "Circumferinta curea/bratara",
    "Culoare interior curea/bratara", "Cronograf", "Cronometru", "Numaratoare inversa",
    "Calendar", "Data", "Ziua Saptamanii", "Alarma", "Iluminare", "Antisoc",
    "Antimagnetic", "Dual Time", "GPS", "Bluetooth", "Baterie solara", "Tahimetru",
    "Moon Phase", "Alte detalii", "Modul", "Producator",
];

const ALL_LABELS = [...FIELD_MAP.map((f) => f[0]), ...IGNORED_LABELS, "Pentru"];
ALL_LABELS.sort((a, b) => b.length - a.length);
const LABEL_REGEX = new RegExp(
    "(" + ALL_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + "):",
    "g"
);

function parseDescription(desc) {
    const specs = {};
    let gender = null;
    if (!desc) return { specs, gender };

    const parts = desc.split(LABEL_REGEX);
    for (let i = 1; i < parts.length; i += 2) {
        const label = parts[i];
        const rawValue = cleanText(parts[i + 1] || "");
        if (!rawValue) continue;

        if (label === "Pentru") {
            gender = rawValue;
            continue;
        }

        const entry = FIELD_MAP.find((f) => f[0] === label);
        if (!entry) continue;

        const [, key, type] = entry;

        if (type === "text") {
            specs[key] = rawValue;
        } else if (type === "number") {
            const n = toNumber(rawValue);
            if (n != null) specs[key] = n;
        } else if (type === "bool") {
            specs[key] = /^da$/i.test(rawValue);
        } else if (type === "auto") {
            if (KNOWN_COLORS.some((c) => rawValue.toLowerCase() === c.toLowerCase())) {
                specs.culoare_rama = rawValue;
            } else {
                specs.stil_rama = rawValue;
            }
        }
    }

    return { specs, gender };
}

const MULTI_WORD_BRANDS = [
    "Michael Kors", "Karl Lagerfeld", "Jacques Lemans", "Tommy Hilfiger",
    "Swiss Alpine Military", "Ray-Ban", "Guess Factory", "Italia Independent",
    "Web Eyewear", "Calvin Klein", "Lorus by Seiko",
];

function extractBrand(titleAfterPrefix) {
    for (const brand of MULTI_WORD_BRANDS) {
        if (titleAfterPrefix.startsWith(brand)) return brand;
    }
    const firstWord = titleAfterPrefix.split(" ")[0];
    return firstWord || "";
}

function genderToCategoryTags(gender) {
    if (!gender) return [];
    const g = gender.toLowerCase();
    if (g === "barbati") return ["cadouri-pentru-el"];
    if (g === "dama") return ["cadouri-pentru-ea"];
    if (g === "unisex") return ["cadouri-pentru-el", "cadouri-pentru-ea"];
    return [];
}

async function main() {
    let xmlText;
    if (fs.existsSync("feed-sample.xml")) {
        console.log("Folosesc feed-sample.xml local (mod test)...");
        xmlText = fs.readFileSync("feed-sample.xml", "utf8");
    } else {
        console.log("Descarc feed-ul XML...");
        const res = await fetch(FEED_URL);
        if (!res.ok) throw new Error(`Feed a raspuns cu status ${res.status}`);
        xmlText = await res.text();
    }

    console.log("Parsez XML-ul (poate dura câteva secunde, e un fișier mare)...");
    const parser = new XMLParser();
    const data = parser.parse(xmlText);
    const items = data.items.item;
    console.log(`Total produse în feed: ${items.length}`);

    const products = [];
    let skippedCategory = 0;
    let skippedInactive = 0;

    for (const item of items) {
        if (item.product_active !== true && item.product_active !== "true") {
            skippedInactive++;
            continue;
        }

        const feedCategory = cleanText(item.category).toLowerCase();
        const category = CATEGORY_MAP[feedCategory];
        if (!category) {
            skippedCategory++;
            continue;
        }

        const title = cleanText(item.title);
        const id = cleanText(item.product_id);
        const price = toNumber(item.price);
        const oldPrice = toNumber(item.old_price);
        const affiliateUrl = cleanText(item.aff_code);
        const officialUrl = cleanText(item.url);
        const sourceSite = cleanText(item.campaign_name);
        const feedBrand = cleanText(item.brand);
        const { specs, gender } = parseDescription(item.description);

        const prefixMatch = title.match(/^(Ceas(?:uri)?(?: de soare)?(?: barbati| dama| copii)?|Ochelari de soare(?: barbati| dama| copii)?)\s+/i);
        const afterPrefix = prefixMatch ? title.slice(prefixMatch[0].length) : title;
        const brand = feedBrand || extractBrand(afterPrefix);

        const categoryTags = [category, ...genderToCategoryTags(gender)];

        products.push({
            id,
            source_site: sourceSite,
            brand,
            title,
            category: categoryTags,
            price,
            old_price: oldPrice && oldPrice > price ? oldPrice : null,
            offer_end: null,
            currency: "RON",
            availability: true,
            draft: true,
            image_url: cleanText(item.image_urls).split(",")[0].trim(),
            official_url: officialUrl,
            affiliate_url: affiliateUrl,
            specs,
        });
    }

    fs.writeFileSync("feed-import.json", JSON.stringify(products, null, 2) + "\n");

    const withOfficialUrl = products.filter((p) => p.official_url).length;
    const withOldPrice = products.filter((p) => p.old_price != null).length;
    const byCategory = {};
    for (const p of products) {
        for (const c of p.category) byCategory[c] = (byCategory[c] || 0) + 1;
    }

    console.log("\n--- Rezumat ---");
    console.log(`Produse importate: ${products.length}`);
    console.log(`Ignorate (inactive pe magazin): ${skippedInactive}`);
    console.log(`Ignorate (categorie irelevantă — bijuterii, rame de vedere, etc.): ${skippedCategory}`);
    console.log(`Cu official_url completat: ${withOfficialUrl} / ${products.length}`);
    console.log(`Cu old_price (ofertă activă): ${withOldPrice} / ${products.length}`);
    console.log("Pe categorii:", byCategory);
    console.log(`\nFișier generat: feed-import.json (toate cu "draft": true)`);
}

main().catch((err) => {
    console.error("Eroare:", err.message);
    process.exit(1);
});
