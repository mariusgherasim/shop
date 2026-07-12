import { getSearchIndex } from '../lib/products.js';

export async function GET() {
  return new Response(JSON.stringify(getSearchIndex()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
