import { toInputDate } from "./utils.js";

export function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function weekdayOf(dateString) {
  return parseLocalDate(dateString).getDay();
}

export function addDays(dateString, amount) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + amount);
  return formatLocalDate(date);
}

export function todayLocal() {
  return toInputDate(new Date());
}

function getWeekdays(promo) {
  return promo.weekdays?.length
    ? promo.weekdays.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
}

function effectiveEndDate(promo) {
  if (!promo.stoppedOn) return promo.endDate;
  return promo.stoppedOn <= promo.endDate
    ? addDays(promo.stoppedOn, -1)
    : promo.endDate;
}

export function promoAppliesOn(promo, menu, dateString) {
  return Boolean(
    promo &&
      menu &&
      promo.menuId === menu.id &&
      promo.startDate <= dateString &&
      dateString <= promo.endDate &&
      (!promo.stoppedOn || dateString < promo.stoppedOn) &&
      (!promo.weekdays?.length ||
        promo.weekdays.map(Number).includes(weekdayOf(dateString))) &&
      Number(promo.promoPrice) < Number(menu.price),
  );
}

export function getPriceForDate(menu, promos, dateString) {
  const promo = promos.find((candidate) =>
    promoAppliesOn(candidate, menu, dateString),
  );
  return {
    price: promo ? Number(promo.promoPrice) : Number(menu.price),
    promo: promo || null,
  };
}

export function calculateNormalSalesPerDay(
  receipts,
  earliestDate,
  menuId,
  today,
  menus,
  promos,
) {
  if (!earliestDate) {
    return { average: null, daysAvailable: 0, excludedPromoDays: 0 };
  }
  const windowStart = addDays(today, -7);
  const availableStart =
    earliestDate > windowStart ? earliestDate : windowStart;
  const menu = menus.find((item) => item.id === menuId);
  let daysAvailable = 0;
  let excludedPromoDays = 0;
  let totalPortions = 0;
  for (let date = availableStart; date < today; date = addDays(date, 1)) {
    if (promos.some((promo) => promoAppliesOn(promo, menu, date))) {
      excludedPromoDays++;
      continue;
    }
    daysAvailable++;
    totalPortions += receipts
      .filter((receipt) => receipt.date === date)
      .reduce(
        (sum, receipt) =>
          sum +
          (receipt.items || []).reduce(
            (itemSum, item) =>
              itemSum +
              (item.menuId === menuId ? Number(item.qty) || 0 : 0),
            0,
          ),
        0,
      );
  }
  return {
    average: daysAvailable ? totalPortions / daysAvailable : null,
    daysAvailable,
    excludedPromoDays,
  };
}

export function getDiscountSimilarPromoEvents(events, menuId, discountPct) {
  if (!Number.isFinite(discountPct)) return null;
  const similar = events.filter(
    (event) =>
      event.discountPct !== null &&
      event.discountPct !== undefined &&
      Number.isFinite(Number(event.discountPct)) &&
      Math.abs(Number(event.discountPct) - discountPct) <= 5 &&
      Number.isFinite(Number(event.deviationPct)),
  );
  const menuEvents = similar.filter((event) => event.menuId === menuId);
  if (menuEvents.length >= 2) {
    return { scope: "menu", events: menuEvents };
  }
  if (similar.length >= 3) {
    return { scope: "all", events: similar };
  }
  return null;
}

export function promosConflict(first, second) {
  if (!first || !second || first.menuId !== second.menuId) return false;
  const firstEnd = effectiveEndDate(first);
  const secondEnd = effectiveEndDate(second);
  if (firstEnd < first.startDate || secondEnd < second.startDate) return false;

  const overlapStart =
    first.startDate > second.startDate ? first.startDate : second.startDate;
  const overlapEnd = firstEnd < secondEnd ? firstEnd : secondEnd;
  if (overlapStart > overlapEnd) return false;

  const firstWeekdays = new Set(getWeekdays(first));
  const secondWeekdays = new Set(getWeekdays(second));
  for (
    let date = overlapStart;
    date <= overlapEnd;
    date = addDays(date, 1)
  ) {
    const weekday = weekdayOf(date);
    if (firstWeekdays.has(weekday) && secondWeekdays.has(weekday)) return true;
  }
  return false;
}

export function listPromoDays(promo) {
  const days = [];
  const endDate = effectiveEndDate(promo);
  if (endDate < promo.startDate) return days;
  const weekdays = new Set(getWeekdays(promo));
  for (
    let date = promo.startDate;
    date <= endDate;
    date = addDays(date, 1)
  ) {
    if (weekdays.has(weekdayOf(date))) days.push(date);
  }
  return days;
}

export function getPromoStatus(promo, todayString = todayLocal()) {
  if (promo.stoppedOn) return "dihentikan";
  if (todayString < promo.startDate) return "terjadwal";
  if (todayString <= promo.endDate) return "berjalan";
  return "selesai";
}

function getComparisonDates(weekday, startDate, earliestReceiptDate) {
  const dates = [];
  let date = addDays(startDate, -1);
  while (weekdayOf(date) !== weekday) date = addDays(date, -1);
  for (let index = 0; index < 4; index++) {
    if (!earliestReceiptDate || date >= earliestReceiptDate) dates.push(date);
    date = addDays(date, -7);
  }
  return dates;
}

export function evaluatePromo({
  promo,
  biayaTotal,
  qtyByDate,
  earliestReceiptDate,
}) {
  const hariPromo = listPromoDays(promo);
  if (hariPromo.length < 2) {
    return {
      status: "insufficient",
      alasan: "Hari promo kurang dari 2, belum cukup untuk dinilai.",
    };
  }

  const comparisonsByWeekday = new Map();
  for (const date of hariPromo) {
    const weekday = weekdayOf(date);
    if (comparisonsByWeekday.has(weekday)) continue;
    const comparisonDates = getComparisonDates(
      weekday,
      promo.startDate,
      earliestReceiptDate,
    );
    if (comparisonDates.length < 2) {
      return {
        status: "insufficient",
        alasan:
          "Data penjualan sebelum promo belum cukup (minimal 2 hari pembanding).",
      };
    }
    const average =
      comparisonDates.reduce(
        (sum, comparisonDate) => sum + (Number(qtyByDate[comparisonDate]) || 0),
        0,
      ) / comparisonDates.length;
    comparisonsByWeekday.set(weekday, average);
  }

  const porsiNormalTotal = hariPromo.reduce(
    (sum, date) => sum + comparisonsByWeekday.get(weekdayOf(date)),
    0,
  );
  const porsiPromoTotal = hariPromo.reduce(
    (sum, date) => sum + (Number(qtyByDate[date]) || 0),
    0,
  );
  if (porsiNormalTotal === 0) {
    return {
      status: "insufficient",
      alasan:
        "Menu ini belum ada penjualan di hari pembanding, hasilnya tidak bisa dibandingkan.",
    };
  }

  const kenaikan = porsiPromoTotal / porsiNormalTotal - 1;
  const untungNormal = Number(promo.normalPrice) - Number(biayaTotal);
  const untungPromo = Number(promo.promoPrice) - Number(biayaTotal);
  const untungTotalNormal = porsiNormalTotal * untungNormal;
  const untungTotalPromo = porsiPromoTotal * untungPromo;
  const selisihTotal = untungTotalPromo - untungTotalNormal;
  const selisihPerHariPromo = selisihTotal / hariPromo.length;
  const threshold = Math.abs(untungTotalNormal) * 0.02;
  const vonis =
    untungTotalNormal === 0
      ? selisihTotal > 0
        ? "untung"
        : selisihTotal < 0
          ? "rugi"
          : "impas"
      : selisihTotal > threshold
        ? "untung"
        : selisihTotal < -threshold
          ? "rugi"
          : "impas";
  const kenaikanImpas =
    untungPromo > 0 ? untungNormal / untungPromo - 1 : null;
  const diskonPct =
    (1 - Number(promo.promoPrice) / Number(promo.normalPrice)) * 100;

  return {
    status: "ok",
    hariPromo,
    porsiNormalTotal,
    porsiPromoTotal,
    kenaikan,
    kenaikanImpas,
    untungTotalNormal,
    untungTotalPromo,
    selisihTotal,
    selisihPerHariPromo,
    vonis,
    diskonPct,
    rataNormalPerHari: porsiNormalTotal / hariPromo.length,
    rataPromoPerHari: porsiPromoTotal / hariPromo.length,
  };
}

export function effectivePromoEndDate(promo) {
  return effectiveEndDate(promo);
}
