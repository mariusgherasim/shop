import raw from '../data/products.json';

/**
 * A product is "live" when it's not a draft, has a price and an affiliate link.
 * Use `draft: true` in products.json for items you're still completing
 * (missing price / affiliate link) — they simply won't render anywhere.
 */
function isLive(p) {
  return !p.draft && p.availability !== false && p.price != null && !!p.affiliate_url;
}

function withComputed(p) {
  const discount_percent =
    p.old_price && p.price ? Math.round(100 - (p.price / p.old_price) * 100) : null;

  const offerActive = p.offer_end ? new Date(p.offer_end).getTime() > Date.now() : false;

  return { ...p, discount_percent, offerActive };
}

export function getAllProducts() {
  return raw.filter(isLive).map(withComputed);
}

export function getProductsByCategory(category) {
  return getAllProducts().filter((p) => p.category.includes(category));
}

export function getProductsUnderPrice(maxPrice) {
  return getAllProducts().filter((p) => p.price <= maxPrice);
}

/** Recomandările curente (homepage) — selecție manuală prin `"recomandat": true`.
 *  Dacă nu ai marcat niciun produs, cade automat pe primele 3 din fișier,
 *  ca homepage-ul să nu rămână gol. */
export function getRecommended() {
  const marked = getAllProducts().filter((p) => p.recomandat === true);
  return marked.length > 0 ? marked : getAllProducts().slice(0, 3);
}

/** Ofertele săptămânii — selecție manuală, marcată cu `featured: true` în products.json. */
export function getFeatured() {
  return getAllProducts().filter((p) => p.featured === true);
}

export function getOffers() {
  return getAllProducts().filter((p) => p.offerActive || p.discount_percent);
}

export function getProductById(id) {
  return getAllProducts().find((p) => p.id === id);
}

/** Very small client-side search index: id, title, brand, category. */
export function getSearchIndex() {
  return getAllProducts().map((p) => ({
    id: p.id,
    title: p.title,
    brand: p.brand,
    category: p.category,
    price: p.price,
    image_url: p.image_url,
    affiliate_url: p.affiliate_url,
  }));
}
