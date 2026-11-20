import { toInputDate } from "./utils.js";

export const PERIODE_OPSI = [28, 56];
export const PERIODE_DEFAULT = 28;
export const MIN_SAMPLE = 3;
export const MIN_HARI_EVALUABLE = 5;
export const MIN_PORSI = 28;
export const MENU_BARU_HARI = 14;
export const MIN_HARI_PROMO_SARAN = 4;
export const DISKON_AWAL_PCT = 5;
export const URUTAN_HARI = [1, 2, 3, 4, 5, 6, 0];
export const NAMA_HARI = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

export const FAKTOR_LARIS = 0.7;
export const MIN_MENU = 3;
export const MIN_HARI_DATA = 7;

export function classifyMenus(items) {
  const n = items.length;
  const totalPorsi = items.reduce((sum, item) => sum + Number(item.porsi), 0);
  const totalUntung = items.reduce(
    (sum, item) =>
      sum + Number(item.porsi) * Number(item.untungPerPorsi),
    0,
  );
  const summary = { n, totalPorsi, totalUntung };

  if (n < MIN_MENU) {
    return { ok: false, reason: "terlalu_sedikit_menu", ...summary };
  }
  if (totalPorsi < MIN_PORSI) {
    return { ok: false, reason: "terlalu_sedikit_porsi", ...summary };
  }
  if (totalUntung <= 0) {
    return { ok: false, reason: "untung_tidak_positif", ...summary };
  }

  const batasPorsi = (FAKTOR_LARIS * totalPorsi) / n;
  const rataUntungPerPorsi = totalUntung / totalPorsi;
  return {
    ok: true,
    ...summary,
    batasPorsi,
    batasPorsiTampil: Math.ceil(batasPorsi - 1e-9),
    rataUntungPerPorsi,
    items: items.map((item) => {
      const porsi = Number(item.porsi);
      const untungPerPorsi = Number(item.untungPerPorsi);
      const totalUntungMenu = porsi * untungPerPorsi;
      const laris = 10 * n * porsi >= 7 * totalPorsi;
      const untungBesar = untungPerPorsi >= rataUntungPerPorsi - 1e-9;
      return {
        ...item,
        porsi,
        untungPerPorsi,
        persenPorsi: (porsi / totalPorsi) * 100,
        totalUntungMenu,
        persenUntung: (totalUntungMenu / totalUntung) * 100,
        laris,
        untungBesar,
        kelas: laris
          ? untungBesar
            ? "bintang"
            : "sapi_perah"
          : untungBesar
            ? "teka_teki"
            : "beban",
      };
    }),
  };
}

export function priceLiftOptions(price) {
  const deltas = [3, 5].map((percentage) =>
    Math.max(
      500,
      Math.round((Number(price) * percentage) / 100 / 500) * 500,
    ),
  );
  return [...new Set(deltas)].sort((a, b) => a - b);
}

export function priceLiftImpact({ porsi, untungPerPorsi, delta }) {
  if (untungPerPorsi <= 0) return null;
  const totalAtCurrentPrice = untungPerPorsi + delta;
  const porsiTurun5 = (porsi * 95) / 100;
  return {
    maxTurunPct: (delta / totalAtCurrentPrice) * 100,
    porsiMinimalAman: Math.ceil(
      (porsi * untungPerPorsi) / totalAtCurrentPrice - 1e-9,
    ),
    porsiTurun5,
    selisihTurun5:
      porsiTurun5 * totalAtCurrentPrice - porsi * untungPerPorsi,
  };
}

export function tambahanUntung10Porsi(untungPerPorsi) {
  return 10 * untungPerPorsi;
}

export function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(dateString, amount) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + amount);
  return toInputDate(date);
}

export function ambilWindow(periodeHari, todayStr) {
  return {
    start: addDays(todayStr, -periodeHari),
    end: addDays(todayStr, -1),
  };
}

export function umurHariMenu(createdAtISO, todayStr) {
  const createdDate = toInputDate(new Date(createdAtISO));
  return Math.round(
    (parseLocalDate(todayStr) - parseLocalDate(createdDate)) / 86400000,
  );
}

export function agregasiPorsi(receipts, start, end) {
  const portionsByMenu = new Map();
  receipts.forEach((receipt) => {
    if (receipt.date < start || receipt.date > end) return;
    (receipt.items || []).forEach((item) => {
      if (item.menuId === null || item.menuId === undefined || item.menuId === "")
        return;
      portionsByMenu.set(
        item.menuId,
        (portionsByMenu.get(item.menuId) || 0) + Number(item.qty || 0),
      );
    });
  });
  return portionsByMenu;
}
