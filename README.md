# shop.gherasimmarius.com

Catalog de ceasuri și accesorii cu vânzare prin afiliere (2Performant). Site static, generat cu **Astro**, găzduit pe **GitHub Pages**, cu DNS pe **Squarespace**.

## Instalare locală

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # generează /dist (folderul care se publică)
npm run preview   # servește /dist local, ca să verifici build-ul final
```

## Cum adaugi un produs

Editează `src/data/products.json` — fiecare produs e un obiect cu acest schema:

```json
{
  "id": "id-unic",
  "source_site": "ceasuri-shop.ro",
  "brand": "Curren",
  "title": "Titlul complet al produsului",
  "category": ["ceasuri", "oferte"],
  "price": 109.99,
  "old_price": 149.99,
  "offer_end": "2026-07-20T23:59:59",
  "currency": "RON",
  "availability": true,
  "draft": false,
  "image_url": "https://...",
  "official_url": "https://...",
  "affiliate_url": "https://event.2performant.com/events/click?...",
  "specs": { "mecanism": "Quartz", "rezistenta_apa": "3 ATM" }
}
```

- `draft: true` → produsul NU apare nicăieri pe site (util cât timp completezi preț/link de afiliere).
- `discount_percent` se calculează automat din `price` / `old_price` — nu-l seta manual.
- `offer_end` e opțional — dacă lipsește sau a trecut data, badge-ul de countdown dispare automat.
- Categoriile posibile în momentul de față: `ceasuri`, `ochelari-de-soare`, `modele-noi`. Poți adăuga altele noi și le folosești direct în `getProductsByCategory('noua-categorie')` pe o pagină nouă.

## Publicare (GitHub Pages)

1. Creezi un repo nou pe contul `mariusgherasim`, ex: `shop`.
2. `git init && git remote add origin git@github.com:mariusgherasim/shop.git`
3. Push pe branch `main` — workflow-ul din `.github/workflows/deploy.yml` face automat `npm ci && npm run build` și publică `/dist` pe GitHub Pages.
4. În Settings → Pages ale repo-ului, la **Build and deployment** alegi sursa **GitHub Actions** (nu "branch").
5. Tot în Settings → Pages, la **Custom domain** pui `shop.gherasimmarius.com` (fișierul `public/CNAME` e deja pregătit cu asta, deci GitHub îl preia automat).

## DNS (Squarespace)

În Squarespace Domains, la domeniul `gherasimmarius.com`, adaugi un record:

| Tip | Host | Valoare |
|---|---|---|
| CNAME | `shop` | `mariusgherasim.github.io` |

(verifică exact ce ai deja la `carti` și `copywriting` — dacă acolo ai pus IP-uri A record către GitHub în loc de CNAME, foloseşte acelaşi tipar aici pentru consistenţă).

## MailerLite

În `src/components/Newsletter.astro`, înlocuiește valoarea `action` cu URL-ul formularului tău embedded din MailerLite (Forms → Embedded → HTML → copiezi doar `action="..."` din `<form>`).

## De completat înainte de lansare

- [ ] Textele juridice complete în `politica-de-confidentialitate.astro` și `termeni-si-conditii.astro` (recomand o trecere rapidă cu un jurist, mai ales pt. conformitate ANPC).
- [ ] URL-ul real al formularului MailerLite.
- [ ] Produsul Festina (`233614`) are `draft: true` — completează `price` și `affiliate_url` din 2Performant, apoi scoate `draft`.
- [ ] Adaugă primele produse pentru categoria `ochelari-de-soare`.
