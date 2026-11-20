export const KATEGORI = ["Makanan", "Minuman", "Camilan", "Paket", "Lainnya"];

export const MAX_BYTES = 300 * 1024;
export const LANGKAH_KUALITAS = [
  [800, 0.82],
  [800, 0.7],
  [640, 0.65],
  [480, 0.6],
];
export const MAKS_FILE_ASAL_MB = 12;

export function computeCrop(w, h) {
  let cropW = w;
  let cropH = h;
  let offX = 0;
  let offY = 0;

  if (w * 3 >= h * 4) {
    cropH = h;
    cropW = Math.round((h * 4) / 3);
  } else {
    cropW = w;
    cropH = Math.round((w * 3) / 4);
  }

  offX = Math.floor((w - cropW) / 2);
  offY = Math.floor((h - cropH) / 2);

  return { cropW, cropH, offX, offY };
}

export function computeOutputSize(cropW, cropH, maxW) {
  const scale = Math.min(1, maxW / cropW);
  return {
    w: Math.round(cropW * scale),
    h: Math.round(cropH * scale),
  };
}

export function initialsOf(nama) {
  const tokens = String(nama || "")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (!tokens.length) return "?";

  const firstChars = tokens.slice(0, 2).map((token) => token.charAt(0));
  if (tokens.length >= 2) {
    return firstChars.join("").toUpperCase();
  }

  return `${tokens[0].slice(0, 2)}`.toUpperCase();
}

export const PALET = [
  ["#d1fae5", "#064e3b"],
  ["#e0f2fe", "#0f172a"],
  ["#fef3c7", "#78350f"],
  ["#ffe4e6", "#881337"],
  ["#ede9fe", "#4c1d95"],
  ["#ccfbf1", "#134e4a"],
  ["#ffedd5", "#9a4d00"],
  ["#e0e7ff", "#312e81"],
];

export function colorIndexOf(nama) {
  const text = String(nama || "");
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += text.charCodeAt(i);
  }
  return total % PALET.length;
}

export function matchesQuery(nama, query) {
  const target = String(nama || "").toLowerCase();
  const terms = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) return true;
  return terms.every((term) => target.includes(term));
}

export function sortMenus(menus) {
  const order = Object.fromEntries(KATEGORI.map((cat, index) => [cat, index]));
  return [...(menus || [])].sort((a, b) => {
    const aCategory = order[String(a?.category || "Makanan")] ?? 99;
    const bCategory = order[String(b?.category || "Makanan")] ?? 99;
    if (aCategory !== bCategory) return aCategory - bCategory;
    return String(a?.name || "").localeCompare(String(b?.name || ""), "id-ID");
  });
}
