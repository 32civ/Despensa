// Normaliza a EAN-13 (UPC-A de 12 dígitos se completa con un 0 al inicio).
export const normalizeBarcode = (raw) => {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 6 || d.length > 14) return "";
  return d.length === 12 ? `0${d}` : d;
};

const ZONE_HINTS = [
  ["congelador", /frozen|ice-cream|helado|congelad/],
  ["refrigerador", /dairies|milks|cheeses|yogurts|butters|eggs|fresh|meats|sausages|cold-cuts|lacteo|embutid/],
  ["especias", /spices|herbs|seasoning|salts|especia/],
  ["limpieza", /cleaning|detergent|soaps|limpieza/],
];
const EMOJI_HINTS = [
  [/milks|leche/, "🥛"], [/eggs|huevo/, "🥚"], [/cheese|queso/, "🧀"], [/yogurt/, "🥣"],
  [/rice|arroz/, "🍚"], [/pasta|noodle/, "🍝"], [/bread|pan\b/, "🍞"], [/coffee|cafe/, "☕"],
  [/water|agua/, "💧"], [/juice|jugo/, "🧃"], [/tuna|fish|atun|sardine/, "🐟"],
  [/chicken|pollo/, "🍗"], [/meat|carne/, "🥩"], [/sugar|azucar/, "🍬"],
  [/chocolate|cocoa/, "🍫"], [/cookie|biscuit|galleta/, "🍪"], [/detergent|soap|limpi/, "🧴"],
];

/** Busca el producto en Open Food Facts. Devuelve null si no existe o no hay red. */
export async function lookupProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_es,brands,categories_tags`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name = (p.product_name_es || p.product_name || "").trim();
    if (!name) return null;
    const brand = (p.brands || "").split(",")[0].trim();
    const full = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} ${brand}` : name;
    const hay = `${(p.categories_tags || []).join(" ")} ${full}`.toLowerCase();
    return {
      name: full.slice(0, 80),
      zone: ZONE_HINTS.find(([, re]) => re.test(hay))?.[0] ?? "alacena",
      emoji: EMOJI_HINTS.find(([re]) => re.test(hay))?.[1] ?? "🛒",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
