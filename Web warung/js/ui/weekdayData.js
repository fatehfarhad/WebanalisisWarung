import { fetchEarliestReceiptDate, fetchReceiptsSince } from "../db.js";
import { state } from "../state.js";
import {
  PERIODE_DEFAULT,
  PERIODE_OPSI,
  MENU_BARU_HARI,
  collectSamples,
  weekdayStats,
  ambilWindow,
  setSelectedPeriod as setPatternPeriod,
  getSelectedPeriod as getPatternPeriod,
} from "../weekdayPattern.js";

let rawCache = null;
let selectedPeriod = PERIODE_DEFAULT;

export function getSelectedPeriod() {
  return selectedPeriod;
}

export function setSelectedPeriod(value) {
  const nextValue = Number(value);
  if (PERIODE_OPSI.includes(nextValue)) {
    selectedPeriod = nextValue;
    setPatternPeriod(nextValue);
  }
  return selectedPeriod;
}

export async function loadWeekdayData(periodeHari = selectedPeriod) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const window = ambilWindow(periodeHari, todayStr);

  try {
    const [receipts, earliestDate] = await Promise.all([
      fetchReceiptsSince(window.start),
      fetchEarliestReceiptDate(),
    ]);

    const qtyByMenuDate = new Map();
    const openDates = new Set();
    const menuIds = new Set((state.menuCatalog || []).filter((menu) => menu.active).map((menu) => menu.id));

    for (const receipt of receipts) {
      openDates.add(receipt.date);
      if (!receipt.items) continue;
      for (const item of receipt.items) {
        if (!item.menuId || !menuIds.has(item.menuId)) continue;
        const current = qtyByMenuDate.get(item.menuId) || {};
        current[receipt.date] = (Number(current[receipt.date] || 0) + Number(item.qty || 0));
        qtyByMenuDate.set(item.menuId, current);
      }
    }

    const rows = [];
    const baruMenus = [];
    const nonaktifCount = (state.menuCatalog || []).filter((menu) => !menu.active).length;
    const activeMenus = (state.menuCatalog || []).filter((menu) => menu.active);

    for (const menu of activeMenus) {
      const createdAt = menu.created_at || menu.createdAt;
      const createdLocal = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : null;
      const age = createdLocal ? Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${createdLocal}T00:00:00`)) / 86400000) : 0;
      if (age < MENU_BARU_HARI) {
        baruMenus.push({ menuId: menu.id, name: menu.name, days: age });
        continue;
      }

      const menuData = qtyByMenuDate.get(menu.id) || {};
      const firstDate = earliestDate && createdLocal ? (createdLocal > earliestDate ? createdLocal : earliestDate) : earliestDate;
      const samples = collectSamples({
        start: window.start,
        end: window.end,
        qtyByDate: menuData,
        openDates: [...openDates],
        promoDates: new Set(),
        firstDate,
      });
      const stats = weekdayStats(samples.byWeekday);
      rows.push({ menuId: menu.id, name: menu.name, stats, promoExcludedCount: samples.promoExcludedCount });
    }

    rows.sort((a, b) => {
      if (a.stats.ok !== b.stats.ok) return a.stats.ok ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), "id");
    });

    const jumlahHariData = earliestDate
      ? Math.max(0, Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${earliestDate}T00:00:00`)) / 86400000))
      : 0;

    rawCache = {
      period: periodeHari,
      start: window.start,
      end: window.end,
      jumlahHariData,
      closedCount: 0,
      rows,
      shop: {
        stats: { ok: true },
      },
      baruMenus,
      nonaktifCount,
      error: false,
    };

    return rawCache;
  } catch (error) {
    console.warn("Data hari ramai belum bisa dimuat:", error);
    rawCache = { period: periodeHari, error: true, rows: [], baruMenus: [], nonaktifCount: 0 };
    return rawCache;
  }
}

export function getMenuStats(menuId, periodeHari = selectedPeriod) {
  if (!rawCache || rawCache.period !== periodeHari) return null;
  const row = rawCache.rows.find((item) => item.menuId === menuId);
  return row ? row.stats : null;
}

export function clearWeekdayCache() {
  rawCache = null;
}
