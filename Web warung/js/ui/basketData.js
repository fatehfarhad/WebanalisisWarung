import {
  analyze,
  buildBaskets,
  countBaskets,
  countReceiptPortions,
  MENU_BARU_HARI,
  PERIODE_DEFAULT,
} from "../marketBasket.js";
import {
  ambilWindow,
  parseLocalDate,
  umurHariMenu,
} from "../menuEngineering.js";
import { fetchEarliestReceiptDate, fetchReceiptsSince } from "../db.js";
import { state } from "../state.js";
import { toInputDate } from "../utils.js";
import { getRecipeCost } from "./forecasting.js";

const cache = new Map();
const pending = new Map();
let cacheGeneration = 0;

export function invalidateBasketCache() {
  cacheGeneration += 1;
  cache.clear();
  pending.clear();
}

document.addEventListener("forecastbiz:receipt-saved", invalidateBasketCache);
document.addEventListener("forecastbiz:menu-changed", invalidateBasketCache);
document.addEventListener("forecastbiz:materials-changed", invalidateBasketCache);

function availableDays(earliestDate, todayStr) {
  if (!earliestDate) return 0;
  return Math.max(
    0,
    Math.round((parseLocalDate(todayStr) - parseLocalDate(earliestDate)) / 86400000),
  );
}

async function loadAnalysis(period) {
  const todayStr = toInputDate(new Date());
  const { start, end } = ambilWindow(period, todayStr);
  const [receipts, earliestDate] = await Promise.all([
    fetchReceiptsSince(start),
    fetchEarliestReceiptDate(),
  ]);
  const menus = [];
  let menusNote = 0;
  state.menuCatalog.forEach((menu) => {
    const age = menu.created_at
      ? umurHariMenu(menu.created_at, todayStr)
      : Number.NaN;
    if (!menu.active || !Number.isFinite(age) || age < MENU_BARU_HARI) {
      menusNote += 1;
      return;
    }
    const recipeCost = getRecipeCost(menu);
    const totalCost =
      Math.max(Number(menu.cost) || 0, recipeCost) +
      (Number(menu.other_cost) || 0);
    menus.push({
      id: menu.id,
      name: menu.name,
      untungPerPorsi: Number(menu.price) - totalCost,
    });
  });

  const validMenuIds = new Set(state.menuCatalog.map((menu) => menu.id));
  const baskets = buildBaskets(receipts, validMenuIds, start, end);
  const counts = {
    ...countBaskets(baskets),
    ...countReceiptPortions(receipts, validMenuIds, start, end),
  };
  const analysis = analyze(counts, menus);
  return {
    analysis,
    counts,
    period,
    start,
    end,
    jumlahHariData: availableDays(earliestDate, todayStr),
    menusNote,
  };
}

export async function loadBasketAnalysis(periodeHari = PERIODE_DEFAULT) {
  const period = Number(periodeHari);
  if (![30, 60, 90].includes(period)) {
    console.warn("Periode analisis menu tidak didukung:", periodeHari);
    return { error: true };
  }
  if (cache.has(period)) return cache.get(period);
  if (pending.has(period)) return pending.get(period);

  const generation = cacheGeneration;
  let request;
  request = loadAnalysis(period)
    .then((result) => {
      if (generation === cacheGeneration) cache.set(period, result);
      if (pending.get(period) === request) pending.delete(period);
      return result;
    })
    .catch((error) => {
      if (pending.get(period) === request) pending.delete(period);
      console.warn("Analisis menu yang sering dibeli belum dapat dimuat:", error);
      return { error: true };
    });
  pending.set(period, request);
  return request;
}
