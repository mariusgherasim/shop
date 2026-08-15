import { getOffersIndex } from '../lib/products.js';

export async function GET() {
  return new Response(JSON.stringify(getOffersIndex()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
