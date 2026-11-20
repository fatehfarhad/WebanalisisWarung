import { addDays, parseLocalDate } from "./promoEval.js";

export const MAKS_SISA_HARI = 5;
export const DISKON_HIJAU_PCT = 10;
export const DISKON_MAKS_PCT = 20;
export const MIN_SISA_PORSI = 3;
export const MIN_SISA_NILAI = 25000;
export const MIN_PORSI_DASAR = 3;
export const MARGIN_MIN = 10;
export const MARGIN_MAKS = 40;
export const MARGIN_DEFAULT = 30;
export const SELISIH_VONIS = 5000;
export const FREKUENSI_HARI = 30;
export const FREKUENSI_BATAS = 2;
export const TERBUANG_HARI = 60;
export const TERBUANG_BATAS = 2;
export const U_MAKS = 5;
export const MIN_DATA_HARI = 3;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function selisihHari(fromDate, toDate) {
  const from = parseLocalDate(fromDate);
  const to = parseLocalDate(toDate);
  return Math.round((from - to) / 86400000);
}

export function sisaHari(expStr, todayStr) {
  return selisihHari(expStr, todayStr);
}

export function lastUsable(expStr) {
  return addDays(expStr, -1);
}

export function zonaDiskon(normal, promo) {
  const normalPrice = toNumber(normal);
  const promoPrice = toNumber(promo);
  if (promoPrice >= normalPrice) return "tidak_ada";
  const potongan = normalPrice - promoPrice;
  if (potongan * 10 <= normalPrice) return "hijau";
  if (potongan * 5 <= normalPrice) return "kuning";
  return "ditolak";
}

export function validasiHarga({ normal, promo, biayaTotal, pctDiketik }) {
  const normalPrice = toNumber(normal);
  const promoPrice = toNumber(promo);
  const cost = toNumber(biayaTotal);
  const pct = toNumber(pctDiketik);

  if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
    return { ok: false, zona: "tidak_valid", alasan: "tidak_valid" };
  }

  const zona = zonaDiskon(normalPrice, promoPrice);
  if (zona === "tidak_ada") {
    return { ok: false, zona, alasan: "diskon_terlalu_kecil" };
  }

  if ((Number.isFinite(pct) && pct > 20) || zona === "ditolak") {
    return { ok: false, zona, alasan: "melebihi_batas" };
  }

  if (promoPrice <= cost) {
    return { ok: false, zona, alasan: "di_bawah_modal" };
  }

  return { ok: true, zona, alasan: "" };
}

function collectDates(todayStr, endStr) {
  const dates = [];
  const end = parseLocalDate(endStr);
  let cursor = parseLocalDate(todayStr);
  while (cursor <= end) {
    dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function simulasiFefo(batches, demandByDate, todayStr, endStr) {
  const working = (batches || []).map((batch) => ({
    ...batch,
    stock: toNumber(batch.stock),
    harga: toNumber(batch.harga),
    lastUsable: batch.lastUsable || batch.tanggalExpired || batch.expiry || batch.last_usable,
  }));

  const ordered = [...working].sort((a, b) => {
    const dateCompare = (a.lastUsable || "9999-12-31").localeCompare(b.lastUsable || "9999-12-31");
    if (dateCompare !== 0) return dateCompare;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const waste = {};
  const shortage = {};
  const byId = new Map(ordered.map((batch) => [batch.id, { ...batch }]));

  for (const date of collectDates(todayStr, endStr)) {
    let remaining = toNumber(demandByDate?.[date] ?? 0);
    if (remaining <= 0) continue;

    for (const batch of ordered) {
      if (remaining <= 0) break;
      const usable = batch.lastUsable && batch.lastUsable >= date;
      if (!usable || batch.stock <= 0) continue;
      const used = Math.min(batch.stock, remaining);
      batch.stock -= used;
      remaining -= used;
      const tracked = byId.get(batch.id);
      if (tracked) {
        tracked.stock = batch.stock;
      }
    }

    if (remaining > 0) shortage[date] = (shortage[date] || 0) + remaining;
  }

  for (const batch of ordered) {
    waste[batch.id] = Math.max(0, batch.stock);
  }

  return { waste, shortage };
}

export function buatPermintaan({ todayStr, endStr, menus }) {
  const items = (menus || []).map((menu) => {
    const normalized = { ...menu, a: toNumber(menu.a), base: {} };
    const dates = collectDates(todayStr, endStr);
    for (const date of dates) {
      const base = toNumber(menu.prediksiPerTanggal?.[date] ?? 0);
      normalized.base[date] = date === todayStr ? Math.max(0, base - toNumber(menu.terjualHariIni)) : base;
    }
    return normalized;
  });
  return items;
}

function carryDemand(baseMap, date, multiplier) {
  return toNumber(baseMap?.[date] ?? 0) * multiplier;
}

export function evaluasiPromoFefo(opsi) {
  const todayStr = opsi.todayStr;
  const startStr = opsi.startStr;
  const targetBatch = (opsi.batches || []).find((batch) => batch.id === opsi.targetId) || null;
  const targetEnd = targetBatch ? targetBatch.lastUsable : startStr;
  const horizonDates = collectDates(todayStr, targetEnd);
  const promoDates = collectDates(startStr, targetEnd);

  const menuMap = new Map((opsi.menus || []).map((menu) => [menu.id, menu]));
  const promoMenu = menuMap.get(opsi.promoMenuId) || null;
  const promoBase = promoMenu?.base || {};
  const Bm = promoDates.reduce((sum, date) => sum + carryDemand(promoBase, date, 1), 0);

  const grouped = (opsi.batches || []).filter((batch) => batch.lastUsable && batch.lastUsable <= targetEnd);
  const normalDemand = {};
  for (const date of horizonDates) {
    let total = 0;
    for (const menu of opsi.menus || []) {
      const demand = toNumber(menu.base?.[date] ?? 0) * toNumber(menu.a ?? 0) * toNumber(opsi.skalaPermintaan ?? 1);
      total += demand;
    }
    normalDemand[date] = total;
  }

  const withoutPromo = simulasiFefo(grouped, normalDemand, todayStr, targetEnd);
  const sisaA = Object.values(withoutPromo.waste || {}).reduce((sum, value) => sum + toNumber(value), 0);
  const nilaiA = grouped.reduce((sum, batch) => {
    const wasteAmount = toNumber(withoutPromo.waste?.[batch.id] ?? 0);
    return sum + wasteAmount * toNumber(batch.harga ?? 0);
  }, 0);
  const sisaPorsi = promoMenu && toNumber(promoMenu.a) > 0 ? sisaA / toNumber(promoMenu.a) : 0;

  const uplift = toNumber(opsi.uplift ?? 0);
  const adjustedDemand = {};
  for (const date of horizonDates) {
    let total = 0;
    for (const menu of opsi.menus || []) {
      const base = toNumber(menu.base?.[date] ?? 0);
      const menuFactor = menu.id === opsi.promoMenuId && promoDates.includes(date) ? 1 + uplift : 1;
      total += base * toNumber(menu.a ?? 0) * menuFactor * toNumber(opsi.skalaPermintaan ?? 1);
    }
    adjustedDemand[date] = total;
  }

  const withPromo = simulasiFefo(grouped, adjustedDemand, todayStr, targetEnd);
  const sisaB = Object.values(withPromo.waste || {}).reduce((sum, value) => sum + toNumber(value), 0);
  const nilaiB = grouped.reduce((sum, batch) => {
    const wasteAmount = toNumber(withPromo.waste?.[batch.id] ?? 0);
    return sum + wasteAmount * toNumber(batch.harga ?? 0);
  }, 0);

  const x = Bm * uplift;
  const normalMargin = toNumber(normal) - toNumber(promo);
  const delta = x * (toNumber(promo) - toNumber(biayaTotal)) - normalMargin * Bm + (nilaiA - nilaiB);
  const persenSelamat = sisaA > 0 ? ((sisaA - sisaB) / sisaA) * 100 : null;

  let vonis = null;
  if (opsi.uplift !== null && opsi.uplift !== undefined && Number.isFinite(Number(opsi.uplift))) {
    if (delta >= SELISIH_VONIS) vonis = "untung";
    else if (delta <= -SELISIH_VONIS) vonis = "rugi";
    else vonis = "impas";
  }

  const findThreshold = (targetFn) => {
    let low = 0;
    let high = U_MAKS;
    let best = null;
    for (let step = 0; step < 80; step += 1) {
      const midpoint = (low + high) / 2;
      const result = targetFn(midpoint);
      if (result) {
        best = midpoint;
        high = midpoint;
      } else {
        low = midpoint;
      }
    }
    return best;
  };

  const uGoal = findThreshold((candidate) => {
    const candidateDemand = {};
    for (const date of horizonDates) {
      let total = 0;
      for (const menu of opsi.menus || []) {
        const base = toNumber(menu.base?.[date] ?? 0);
        const menuFactor = menu.id === opsi.promoMenuId && promoDates.includes(date) ? 1 + candidate : 1;
        total += base * toNumber(menu.a ?? 0) * menuFactor * toNumber(opsi.skalaPermintaan ?? 1);
      }
      candidateDemand[date] = total;
    }
    const outcome = simulasiFefo(grouped, candidateDemand, todayStr, targetEnd);
    const remaining = Object.values(outcome.waste || {}).reduce((sum, value) => sum + toNumber(value), 0);
    return remaining <= 0.000001;
  });

  const uImpas = findThreshold((candidate) => {
    const candidateDemand = {};
    for (const date of horizonDates) {
      let total = 0;
      for (const menu of opsi.menus || []) {
        const base = toNumber(menu.base?.[date] ?? 0);
        const menuFactor = menu.id === opsi.promoMenuId && promoDates.includes(date) ? 1 + candidate : 1;
        total += base * toNumber(menu.a ?? 0) * menuFactor * toNumber(opsi.skalaPermintaan ?? 1);
      }
      candidateDemand[date] = total;
    }
    const outcome = simulasiFefo(grouped, candidateDemand, todayStr, targetEnd);
    const remainingWaste = Object.values(outcome.waste || {}).reduce((sum, value) => sum + toNumber(value), 0);
    const promoValue = (candidate * Bm) * (toNumber(promo) - toNumber(biayaTotal)) - (toNumber(normal) - toNumber(promo)) * Bm + (nilaiA - grouped.reduce((sum, batch) => {
      const wasteAmount = toNumber(outcome.waste?.[batch.id] ?? 0);
      return sum + wasteAmount * toNumber(batch.harga ?? 0);
    }, 0));
    return remainingWaste <= 0.000001 || promoValue >= 0;
  });

  const hasUplift = opsi.uplift !== null && opsi.uplift !== undefined && Number.isFinite(Number(opsi.uplift));
  if (!hasUplift) {
    return { Bm, sisaA, nilaiA, sisaPorsi, sisaB, nilaiB, x, delta, persenSelamat, vonis, uGoal, uImpas };
  }

  return { Bm, sisaA, nilaiA, sisaPorsi, sisaB, nilaiB, x, delta, persenSelamat, vonis, uGoal, uImpas };
}

export function kisaranSisa(opsi, margin) {
  const edge = Number(margin) / 100;
  const low = evaluasiPromoFefo({ ...opsi, skalaPermintaan: 1 + edge, uplift: 0 });
  const mid = evaluasiPromoFefo({ ...opsi, skalaPermintaan: 1, uplift: 0 });
  const high = evaluasiPromoFefo({ ...opsi, skalaPermintaan: 1 - edge, uplift: 0 });
  return { rendah: low, titik: mid, tinggi: high };
}

export function clampMargin(mapePct) {
  if (mapePct === null || mapePct === undefined || mapePct === "") {
    return 0.3;
  }
  const value = Number(mapePct) / 100;
  return Math.min(MARGIN_MAKS / 100, Math.max(MARGIN_MIN / 100, value));
}

export function perluPromo({ sisaPorsi, nilaiA }) {
  return Number(sisaPorsi) >= MIN_SISA_PORSI && Number(nilaiA) >= MIN_SISA_NILAI;
}

export function rankMenuPromo(kandidat) {
  return [...(kandidat || [])]
    .filter((item) => Number(item.baseTotal || 0) >= MIN_PORSI_DASAR)
    .sort((left, right) => {
      const leftGoal = left.uGoal == null ? Number.POSITIVE_INFINITY : Number(left.uGoal);
      const rightGoal = right.uGoal == null ? Number.POSITIVE_INFINITY : Number(right.uGoal);
      if (leftGoal !== rightGoal) return leftGoal - rightGoal;
      const leftProfit = Number(left.untungPerPorsi || 0);
      const rightProfit = Number(right.untungPerPorsi || 0);
      if (leftProfit !== rightProfit) return rightProfit - leftProfit;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });
}

export function imputasiHariPromo(deret, promoDates) {
  if (!Array.isArray(deret) || !deret.length) return null;
  const promoSet = new Set((promoDates || []).map(String));
  const nonPromo = deret.filter((entry) => !promoSet.has(String(entry.date)));
  const weekdayMap = new Map();
  for (const item of deret) {
    const weekday = parseLocalDate(item.date).getDay();
    weekdayMap.set(weekday, (weekdayMap.get(weekday) || []).concat(Number(item.qty || 0)));
  }

  const imputed = deret.map((entry) => {
    if (!promoSet.has(String(entry.date))) return { ...entry, qty: Number(entry.qty || 0) };
    const weekday = parseLocalDate(entry.date).getDay();
    const sameWeekday = (weekdayMap.get(weekday) || []).filter((value) => value !== undefined);
    if (sameWeekday.length) {
      const avg = sameWeekday.reduce((sum, value) => sum + value, 0) / sameWeekday.length;
      return { ...entry, qty: avg };
    }
    const fallback = nonPromo.length ? nonPromo.reduce((sum, item) => sum + Number(item.qty || 0), 0) / nonPromo.length : null;
    return { ...entry, qty: fallback }; 
  });

  return imputed.every((entry) => promoSet.has(String(entry.date))) && !nonPromo.length ? null : imputed;
}

export function peringatanFrekuensi(promos, menuId, todayStr) {
  const windowStart = addDays(todayStr, -FREKUENSI_HARI);
  const matches = (promos || []).filter((promo) => {
    if (promo.menuId !== menuId) return false;
    if (promo.source !== "fefo") return false;
    return promo.startDate >= windowStart && promo.startDate <= todayStr;
  });
  return matches.length >= FREKUENSI_BATAS;
}

export function seringTerbuang(pembuangan, namaBahan, todayStr) {
  const records = (pembuangan || []).filter((entry) => {
    if (!entry || !entry.materialName && !entry.material_name) return false;
    const materialName = entry.materialName || entry.material_name;
    if (String(materialName).toLowerCase() !== String(namaBahan || "").toLowerCase()) return false;
    const reason = String(entry.reason || entry.alasan || "").toLowerCase();
    return reason.includes("kedaluwarsa") || reason.includes("expired");
  });

  const windowStart = addDays(todayStr, -TERBUANG_HARI);
  const recent = records.filter((entry) => {
    const date = entry.date || entry.created_at || entry.tanggal || entry.createdAt;
    return date && date >= windowStart && date <= todayStr;
  });
  return recent.length >= TERBUANG_BATAS;
}

export function needsPromo({ sisaPorsi, nilaiA }) {
  return perluPromo({ sisaPorsi, nilaiA });
}
