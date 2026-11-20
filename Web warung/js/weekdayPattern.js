import { toInputDate } from "./utils.js";

export const PERIODE_OPSI = [28, 56];
export const PERIODE_DEFAULT = 28;
export const MIN_SAMPLE = 3;
export const MIN_HARI_EVALUABLE = 5;
const MIN_PORSI_PERIODE = 28;
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

let selectedPeriod = PERIODE_DEFAULT;

export function getSelectedPeriod() {
  return selectedPeriod;
}

export function setSelectedPeriod(value) {
  const normalized = Number(value);
  if (PERIODE_OPSI.includes(normalized)) {
    selectedPeriod = normalized;
  }
  return selectedPeriod;
}

export function parseLocalDate(dateString) {
  if (!dateString) return new Date(NaN);
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function weekdayOf(dateString) {
  return parseLocalDate(dateString).getDay();
}

export function addDays(dateString, amount) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + Number(amount || 0));
  return toInputDate(date);
}

export function ambilWindow(periodeHari, todayStr) {
  const count = Number(periodeHari) || PERIODE_DEFAULT;
  return {
    start: addDays(todayStr, -count),
    end: addDays(todayStr, -1),
  };
}

export function umurHariMenu(createdAtISO, todayStr) {
  if (!createdAtISO || !todayStr) return 0;
  const createdDate = toInputDate(new Date(createdAtISO));
  const diffMs = parseLocalDate(todayStr) - parseLocalDate(createdDate);
  return Math.round(diffMs / 86400000);
}

export function collectSamples({
  start,
  end,
  qtyByDate = {},
  openDates = [],
  promoDates = [],
  firstDate,
}) {
  const openSet = new Set(openDates);
  const promoSet = new Set(promoDates);
  const byWeekday = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  let closedCount = 0;
  let promoExcludedCount = 0;

  for (
    let date = start;
    date <= end;
    date = addDays(date, 1)
  ) {
    if (firstDate && date < firstDate) continue;
    if (!openSet.has(date)) {
      closedCount += 1;
      continue;
    }
    if (promoSet.has(date)) {
      promoExcludedCount += 1;
      continue;
    }
    const qty = Number(qtyByDate[date] || 0);
    byWeekday[weekdayOf(date)].push(qty);
  }

  return { byWeekday, closedCount, promoExcludedCount };
}

function valuesForDay(byWeekday, dayIndex) {
  return Array.isArray(byWeekday?.[dayIndex]) ? byWeekday[dayIndex] : [];
}

function valuesBelow(values, totalSum, totalN) {
  return values.filter((value) => Number(value) * totalN < totalSum).length;
}

function valuesAbove(values, totalSum, totalN) {
  return values.filter((value) => Number(value) * totalN > totalSum).length;
}

export function weekdayStats(byWeekday) {
  const perWeekday = {};
  let evaluableCount = 0;
  let totalSum = 0;
  let totalN = 0;

  for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
    const values = valuesForDay(byWeekday, dayIndex);
    const n = values.length;
    const sum = values.reduce((acc, value) => acc + Number(value || 0), 0);
    const avg = n ? sum / n : null;
    perWeekday[dayIndex] = {
      n,
      sum,
      avg,
      evaluable: n >= MIN_SAMPLE,
      below: 0,
      above: 0,
      deltaPct: 0,
      jelasLemah: false,
      jelasKuat: false,
    };
    if (n >= MIN_SAMPLE) {
      evaluableCount += 1;
      totalSum += sum;
      totalN += n;
    }
  }

  if (evaluableCount < MIN_HARI_EVALUABLE) {
    return { ok: false, reason: "data_kurang_hari", evaluableCount, totalSum };
  }

  const avgTotal = totalN ? totalSum / totalN : 0;

  for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
    const entry = perWeekday[dayIndex];
    if (!entry.evaluable) continue;
    const values = valuesForDay(byWeekday, dayIndex);
    entry.below = valuesBelow(values, totalSum, totalN);
    entry.above = valuesAbove(values, totalSum, totalN);
    entry.deltaPct = avgTotal === 0 ? 0 : ((entry.avg - avgTotal) / avgTotal) * 100;
    entry.jelasLemah =
      100 * entry.sum * totalN <= 85 * totalSum * entry.n &&
      4 * entry.below >= 3 * entry.n;
    entry.jelasKuat =
      100 * entry.sum * totalN >= 115 * totalSum * entry.n &&
      4 * entry.above >= 3 * entry.n;
  }

  if (totalSum < MIN_PORSI_PERIODE) {
    return { ok: false, reason: "terlalu_sedikit_porsi", evaluableCount, totalSum };
  }

  const weakCandidates = [0, 1, 2, 3, 4, 5, 6].filter((day) => perWeekday[day].jelasLemah);
  const strongCandidates = [0, 1, 2, 3, 4, 5, 6].filter((day) => perWeekday[day].jelasKuat);

  const weakest = weakCandidates.length
    ? weakCandidates.reduce((best, current) => {
        const bestAvg = perWeekday[best].avg;
        const currentAvg = perWeekday[current].avg;
        if (currentAvg < bestAvg) return current;
        if (currentAvg === bestAvg) {
          return URUTAN_HARI.indexOf(current) < URUTAN_HARI.indexOf(best) ? current : best;
        }
        return best;
      }, weakCandidates[0])
    : null;

  const strongest = strongCandidates.length
    ? strongCandidates.reduce((best, current) => {
        const bestAvg = perWeekday[best].avg;
        const currentAvg = perWeekday[current].avg;
        if (currentAvg > bestAvg) return current;
        if (currentAvg === bestAvg) {
          return URUTAN_HARI.indexOf(current) < URUTAN_HARI.indexOf(best) ? current : best;
        }
        return best;
      }, strongCandidates[0])
    : null;

  const evaluableDays = [0, 1, 2, 3, 4, 5, 6].filter((day) => perWeekday[day].evaluable);
  const lowest = evaluableDays.length
    ? evaluableDays.reduce((best, current) => {
        const bestAvg = perWeekday[best].avg;
        const currentAvg = perWeekday[current].avg;
        if (currentAvg < bestAvg) return current;
        if (currentAvg === bestAvg) {
          return URUTAN_HARI.indexOf(current) < URUTAN_HARI.indexOf(best) ? current : best;
        }
        return best;
      }, evaluableDays[0])
    : null;

  const highest = evaluableDays.length
    ? evaluableDays.reduce((best, current) => {
        const bestAvg = perWeekday[best].avg;
        const currentAvg = perWeekday[current].avg;
        if (currentAvg > bestAvg) return current;
        if (currentAvg === bestAvg) {
          return URUTAN_HARI.indexOf(current) < URUTAN_HARI.indexOf(best) ? current : best;
        }
        return best;
      }, evaluableDays[0])
    : null;

  return {
    ok: true,
    totalSum,
    totalN,
    avg: avgTotal,
    evaluableCount,
    perWeekday: perWeekday,
    weakest,
    strongest,
    lowest,
    highest,
  };
}

export function baselineForWeekdays(stats, weekdays) {
  if (!stats || !stats.ok || !Array.isArray(weekdays) || weekdays.length === 0) {
    return null;
  }
  const selected = [...new Set(weekdays.map(Number))];
  const missing = selected.some((day) => !stats.perWeekday?.[day]?.evaluable);
  if (missing) return null;
  const avg = selected.reduce((sum, day) => sum + Number(stats.perWeekday[day].avg || 0), 0) / selected.length;
  const n = selected.reduce((sum, day) => sum + Number(stats.perWeekday[day].n || 0), 0);
  return { avg, n };
}

export function suggestPromoEnd(startStr, weekdays, minDays = MIN_HARI_PROMO_SARAN) {
  if (!startStr) return null;
  const targetDays = Array.isArray(weekdays) && weekdays.length
    ? [...new Set(weekdays.map(Number))]
    : null;
  let count = 0;
  let current = startStr;
  for (let index = 0; index < 366; index += 1) {
    if (!targetDays || targetDays.includes(weekdayOf(current))) {
      count += 1;
      if (count >= Number(minDays || MIN_HARI_PROMO_SARAN)) {
        return current;
      }
    }
    current = addDays(current, 1);
  }
  return null;
}

export function describeWeekdays(list) {
  const unique = [...new Set((list || []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => URUTAN_HARI.indexOf(a) - URUTAN_HARI.indexOf(b));
  if (!unique.length || unique.length === 7) return "setiap hari";
  const names = unique.map((day) => NAMA_HARI[day]);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, dan ${names[names.length - 1]}`;
}

export function todayLocal() {
  return toInputDate(new Date());
}
