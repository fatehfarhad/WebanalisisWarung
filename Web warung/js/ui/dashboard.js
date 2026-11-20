import { state, getTodayTotals, reloadDashboardSnapshots } from "../state.js";
import {
  fetchSalesForecasts,
  fetchEventAdjustment,
  fetchSalesEvents,
  insertSalesForecasts,
  insertSalesEvent,
  upsertDashboardSnapshot,
} from "../db.js";
import { formatDateDisplay, formatRupiah } from "../utils.js";
import {
  calculateExpiredLoss,
  calculateProcurementEstimate,
  calculateUsableMaterialStock,
} from "./materials.js";

let forecastChartInstance = null;
let salesEvents = [];
let pendingSalesEvent = null;
let salesEventsReady = false;

const EVENT_CATEGORY_LABELS = {
  promo: "Promo/diskon",
  cuaca: "Cuaca",
  libur: "Hari libur/acara",
  viral: "Bahan baru/viral",
  stok_habis: "Kehabisan stok",
  lainnya: "Lainnya",
};

const EVENT_PROMPT_STORAGE_KEY = "forecastbiz:sales-event-prompt:";

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function syncDashboardSnapshot() {
  const { totalSales, totalProfit } = getTodayTotals();
  await upsertDashboardSnapshot({
    date: getTodayDate(),
    sales: totalSales,
    profit: totalProfit,
    procurementEstimate: calculateProcurementEstimate(),
    expiredLoss: calculateExpiredLoss(),
  });
  await reloadDashboardSnapshots();
}

function renderDashboardHistory() {
  const tbody = document.getElementById("dashboardHistoryBody");
  if (!tbody) return;

  const snapshotByDate = new Map(
    state.dashboardSnapshots.map((snapshot) => [snapshot.date, snapshot]),
  );
  const receiptDates = state.receiptHistory.map((receipt) => receipt.date);
  const dates = [
    ...new Set([
      ...state.dashboardSnapshots.map((snapshot) => snapshot.date),
      ...receiptDates,
    ]),
  ].sort((a, b) => b.localeCompare(a));

  if (!dates.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Belum ada histori dashboard.</td></tr>';
    return;
  }

  tbody.innerHTML = dates
    .map((date) => {
      const snapshot = snapshotByDate.get(date);
      const receipts = state.receiptHistory.filter(
        (receipt) => receipt.date === date,
      );
      const sales =
        snapshot?.sales ??
        receipts.reduce((sum, receipt) => sum + receipt.total, 0);
      const profit =
        snapshot?.profit ??
        receipts.reduce((sum, receipt) => sum + receipt.profit, 0);
      return `<tr class="hover:bg-slate-50">
      <td class="p-3 font-semibold text-slate-700">${formatDateDisplay(date)}</td>
      <td class="p-3 font-bold text-slate-800">${formatRupiah(sales)}</td>
      <td class="p-3 font-bold text-emerald-600">${formatRupiah(profit)}</td>
      <td class="p-3">${snapshot ? formatRupiah(snapshot.procurementEstimate) : '<span class="text-slate-400">Belum tersimpan</span>'}</td>
      <td class="p-3">${snapshot ? formatRupiah(snapshot.expiredLoss) : '<span class="text-slate-400">Belum tersimpan</span>'}</td>
    </tr>`;
    })
    .join("");
}

const dateLabels = [
  "H-6",
  "H-5",
  "H-4",
  "H-3",
  "H-2",
  "H-1",
  "Hari Ini",
  "Besok (Prediksi)",
  "Lusa (Prediksi)",
];

export function updateDashboardCards() {
  const { totalSales, totalProfit } = getTodayTotals();
  document.getElementById("statTodaySales").innerText =
    formatRupiah(totalSales);
  document.getElementById("statProfitMargin").innerText =
    formatRupiah(totalProfit);

  const marginPercent =
    totalSales > 0 ? Math.round((totalProfit / totalSales) * 100) : 0;
  document.getElementById("statProfitMarginPercent").innerText =
    `Margin Total: ${marginPercent}%`;

  const lowStockCount = state.rawMaterials.filter(
    (m) => calculateUsableMaterialStock(m) <= m.batasROP,
  ).length;
  document.getElementById("statLowStockCount").innerText =
    `${lowStockCount} Bahan`;

  document.getElementById("statExpiredLoss").innerText = formatRupiah(
    calculateExpiredLoss(),
  );
  document.getElementById("statProcurementEst").innerText = formatRupiah(
    calculateProcurementEstimate(),
  );
  renderDashboardHistory();
}

// The chart uses daily receipt history and selects a forecast model by data length.
function buildActualSeries(menuId) {
  return getRecentChartDates().slice(0, 7).map((dateStr) => {
    const receiptsOfDay = state.receiptHistory.filter(
      (r) => r.date === dateStr,
    );
    let qty = 0;
    receiptsOfDay.forEach((r) =>
      (r.items || []).forEach((item) => {
        if (menuId === "ALL" || item.menuId === menuId) qty += item.qty;
      }),
    );
    return qty;
  });
}

function getRecentChartDates() {
  const today = new Date(`${getTodayDate()}T00:00:00Z`);
  return Array.from({ length: 9 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    return date.toISOString().slice(0, 10);
  });
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const FORECAST_WINDOW = 7;

function simpleMovingAverage(values, windowSize = FORECAST_WINDOW) {
  const window = values.slice(-windowSize);
  return window.length
    ? window.reduce((sum, value) => sum + value, 0) / window.length
    : 0;
}

function buildHistoricalSeries(menuId) {
  const today = getTodayDate();
  const totalsByDate = new Map();

  state.receiptHistory.forEach((receipt) => {
    if (!receipt.date || receipt.date > today) return;

    let qty = 0;
    (receipt.items || []).forEach((item) => {
      if (menuId === "ALL" || item.menuId === menuId) {
        qty += Number(item.qty) || 0;
      }
    });
    totalsByDate.set(receipt.date, (totalsByDate.get(receipt.date) || 0) + qty);
  });

  const historicalDates = [...totalsByDate.keys()].sort();
  if (!historicalDates.length) return [];

  const startDate = new Date(`${historicalDates[0]}T00:00:00Z`);
  const endDate = new Date(`${today}T00:00:00Z`);
  const series = [];
  for (
    let date = startDate;
    date <= endDate;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    series.push(totalsByDate.get(date.toISOString().slice(0, 10)) || 0);
  }
  return series;
}

function simpleMovingAverageForecast(historicalSeries, stepsAhead = 2) {
  const forecast = [];
  const projectedSeries = [...historicalSeries];
  for (let i = 0; i < stepsAhead; i++) {
    const nextValue = simpleMovingAverage(projectedSeries);
    forecast.push(Math.max(0, Math.round(nextValue)));
    projectedSeries.push(nextValue);
  }
  return forecast;
}

function doubleMovingAverageForecast(historicalSeries, stepsAhead = 2) {
  const movingAverages = [];
  for (let i = FORECAST_WINDOW - 1; i < historicalSeries.length; i++) {
    movingAverages.push(
      simpleMovingAverage(
        historicalSeries.slice(i - FORECAST_WINDOW + 1, i + 1),
      ),
    );
  }

  const firstAverage = simpleMovingAverage(historicalSeries);
  const secondAverage = simpleMovingAverage(movingAverages);
  const level = 2 * firstAverage - secondAverage;
  const trend = (2 / (FORECAST_WINDOW - 1)) * (firstAverage - secondAverage);

  return Array.from({ length: stepsAhead }, (_, index) =>
    Math.max(0, Math.round(level + (index + 1) * trend)),
  );
}

function runHoltWinters(historicalSeries, alpha, beta, gamma, stepsAhead = 2) {
  const seasonals = Array(FORECAST_WINDOW).fill(0);
  const initialSeason = historicalSeries.slice(0, FORECAST_WINDOW);
  let level = simpleMovingAverage(initialSeason);
  let trend = 0;

  initialSeason.forEach((value, index) => {
    seasonals[index] = value - level;
  });

  const absolutePercentageErrors = [];
  for (let t = FORECAST_WINDOW; t < historicalSeries.length; t++) {
    const value = historicalSeries[t];
    const previousSeasonal = seasonals[(t - FORECAST_WINDOW) % FORECAST_WINDOW];
    const predicted = level + trend + previousSeasonal;
    if (value > 0) {
      absolutePercentageErrors.push(Math.abs((value - predicted) / value));
    }

    const previousLevel = level;
    level = alpha * (value - previousSeasonal) + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    seasonals[t % FORECAST_WINDOW] =
      gamma * (value - level) + (1 - gamma) * previousSeasonal;
  }

  const mape = absolutePercentageErrors.length
    ? (absolutePercentageErrors.reduce((sum, error) => sum + error, 0) /
        absolutePercentageErrors.length) *
      100
    : null;
  const forecast = Array.from({ length: stepsAhead }, (_, index) => {
    const seasonal =
      seasonals[(historicalSeries.length + index) % FORECAST_WINDOW];
    return Math.max(0, Math.round(level + (index + 1) * trend + seasonal));
  });

  return { forecast, mape };
}

function holtWintersForecast(historicalSeries, stepsAhead = 2) {
  let bestFit = null;

  for (let alphaStep = 1; alphaStep <= 8; alphaStep++) {
    for (let betaStep = 1; betaStep <= 8; betaStep++) {
      for (let gammaStep = 1; gammaStep <= 8; gammaStep++) {
        const fit = runHoltWinters(
          historicalSeries,
          alphaStep / 10,
          betaStep / 10,
          gammaStep / 10,
          stepsAhead,
        );
        if (fit.mape !== null && (!bestFit || fit.mape < bestFit.mape)) {
          bestFit = fit;
        }
      }
    }
  }

  return bestFit || runHoltWinters(historicalSeries, 0.1, 0.1, 0.1, stepsAhead);
}

function forecastWithExistingMethod(history, stepsAhead = 2) {
  if (history.length >= FORECAST_WINDOW * 2) {
    return holtWintersForecast(history).forecast;
  }
  if (history.length >= FORECAST_WINDOW) {
    return doubleMovingAverageForecast(history, stepsAhead);
  }
  return simpleMovingAverageForecast(history, stepsAhead);
}

export async function getEventAdjustment(category) {
  if (!category || category === "normal") {
    return { adjustment: 0, adjustmentCount: 0 };
  }
  return fetchEventAdjustment(category);
}

function calculateResidualStandardDeviation(history, throughIndex) {
  const residuals = [];
  const firstIndex = Math.max(1, throughIndex - 30);
  for (let index = firstIndex; index < throughIndex; index++) {
    const pastPrediction = forecastWithExistingMethod(
      history.slice(0, index),
      1,
    )[0];
    if (pastPrediction > 0) {
      residuals.push((history[index] - pastPrediction) / pastPrediction);
    }
  }
  if (residuals.length < 2) return null;

  const mean = residuals.reduce((sum, residual) => sum + residual, 0) /
    residuals.length;
  const variance =
    residuals.reduce((sum, residual) => sum + (residual - mean) ** 2, 0) /
    residuals.length;
  return Math.sqrt(variance);
}

function getTodaySalesEventCandidate() {
  const today = getTodayDate();
  if (!state.receiptHistory.some((receipt) => receipt.date === today)) {
    return null;
  }
  const history = buildHistoricalSeries("ALL");
  if (history.length < 3) return null;

  const predicted = forecastWithExistingMethod(history.slice(0, -1), 1)[0];
  const actual = history[history.length - 1];
  const standardDeviation = calculateResidualStandardDeviation(
    history,
    history.length - 1,
  );
  if (predicted <= 0 || standardDeviation === null) return null;

  const deviationPct = Math.abs(actual - predicted) / predicted;
  if (deviationPct <= 1.5 * standardDeviation) return null;
  return {
    date: today,
    predicted,
    actual,
    signedDeviationPct: (actual - predicted) / predicted,
  };
}

function formatPorsions(value) {
  return Number(value).toLocaleString("id-ID", {
    maximumFractionDigits: 1,
  });
}

function showSalesEventPrompt(candidate) {
  const promptKey = `${EVENT_PROMPT_STORAGE_KEY}${candidate.date}`;
  if (localStorage.getItem(promptKey)) return;
  if (salesEvents.some((event) => event.date === candidate.date)) {
    localStorage.setItem(promptKey, "saved");
    return;
  }

  pendingSalesEvent = candidate;
  const changePct = candidate.signedDeviationPct * 100;
  const sign = changePct > 0 ? "+" : "";
  document.getElementById("salesEventSummary").innerText =
    `Penjualan ${formatDateDisplay(candidate.date)} beda dari biasanya: ` +
    `Prediksi ${formatPorsions(candidate.predicted)} porsi → Aktual ` +
    `${formatPorsions(candidate.actual)} porsi (${sign}${changePct.toFixed(1)}%)`;
  document.getElementById("salesEventError").classList.add("hidden");
  document.getElementById("modal-sales-event").classList.remove("hidden");
  localStorage.setItem(promptKey, "shown");
}

function updateOtherCategoryNote() {
  const isOther =
    document.querySelector('input[name="salesEventCategory"]:checked')?.value ===
    "lainnya";
  const label = document.getElementById("salesEventNoteLabel");
  const input = document.getElementById("salesEventNote");
  label.classList.toggle("hidden", !isOther);
  input.required = isOther;
}

export function skipSalesEvent() {
  pendingSalesEvent = null;
  document.getElementById("modal-sales-event").classList.add("hidden");
}

export async function saveSalesEvent() {
  if (!pendingSalesEvent) return;
  const category = document.querySelector(
    'input[name="salesEventCategory"]:checked',
  )?.value;
  const errorEl = document.getElementById("salesEventError");
  const note = document.getElementById("salesEventNote").value.trim();
  const isRecurring =
    document.querySelector('input[name="salesEventRecurring"]:checked')
      ?.value === "true";
  if (!category || (category === "lainnya" && !note)) {
    errorEl.innerText = "Pilih kejadian dan lengkapi keterangannya.";
    errorEl.classList.remove("hidden");
    return;
  }

  let savedEvent;
  try {
    savedEvent = await insertSalesEvent({
      ...pendingSalesEvent,
      menuId: null,
      deviationPct: pendingSalesEvent.signedDeviationPct,
      category,
      note: note || null,
      isRecurring,
    });
  } catch (error) {
    console.error("Gagal menyimpan catatan kejadian penjualan:", error);
    errorEl.innerText =
      "Catatan belum tersimpan. Periksa koneksi dan pastikan migration sudah dijalankan.";
    errorEl.classList.remove("hidden");
    return;
  }

  salesEvents.unshift(savedEvent);
  pendingSalesEvent = null;
  document.getElementById("modal-sales-event").classList.add("hidden");
  document.getElementById("salesEventNote").value = "";
  document.querySelectorAll('input[name="salesEventCategory"]').forEach((input) => {
    input.checked = false;
  });
  document.querySelector('input[name="salesEventRecurring"][value="false"]').checked =
    true;
  updateOtherCategoryNote();
  await updateForecastChart();
}

async function initializeSalesEventFeatures() {
  const adjustmentMessage = document.getElementById(
    "salesEventAdjustmentMessage",
  );
  document
    .querySelectorAll('input[name="salesEventCategory"]')
    .forEach((input) => input.addEventListener("change", updateOtherCategoryNote));
  updateOtherCategoryNote();

  try {
    salesEvents = await fetchSalesEvents();
    salesEventsReady = true;
  } catch (error) {
    console.error("Gagal memuat catatan kejadian penjualan:", error);
    adjustmentMessage.innerText =
      "Catatan kejadian belum tersedia. Pastikan migration sales_events sudah dijalankan.";
  }
}

export async function initForecastChart() {
  const ctx = document
    .getElementById("dashboardForecastChart")
    .getContext("2d");
  forecastChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: dateLabels, datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        subtitle: {
          display: true,
          text: "Prediksi historis memakai data sebelum tanggal target; aktual hari ini masih sementara",
          font: { size: 11 },
          padding: { bottom: 8 },
        },
      },
      scales: { y: { beginAtZero: true } },
    },
  });
  await initializeSalesEventFeatures();
  await updateForecastChart();
}

let forecastUpdateSequence = 0;

export async function updateForecastChart() {
  const selectedVal = document.getElementById("forecastChartMenuSelect").value;
  if (!forecastChartInstance) return;
  const updateSequence = ++forecastUpdateSequence;
  const chartDates = getRecentChartDates();
  const today = getTodayDate();
  const selectedMenuIds = new Set([
    "ALL",
    ...state.menuCatalog.map((menu) => menu.id),
    selectedVal,
  ]);
  const forecastByMenu = new Map();
  for (const menuId of selectedMenuIds) {
    const historical = buildHistoricalSeries(menuId);
    let forecast;
    if (historical.length >= FORECAST_WINDOW * 2) {
      forecast = holtWintersForecast(historical).forecast;
    } else if (historical.length >= FORECAST_WINDOW) {
      forecast = doubleMovingAverageForecast(historical);
    } else {
      forecast = simpleMovingAverageForecast(historical);
    }
    forecastByMenu.set(menuId, { historical, forecast });
  }

  const forecastByDateAndMenu = new Map();
  const forecastKey = (date, menuId) => `${date}|${menuId}`;
  let forecastStorageError = null;
  try {
    const storedForecasts = await fetchSalesForecasts(
      chartDates[0],
      chartDates[chartDates.length - 1],
    );
    storedForecasts.forEach((forecast) => {
      forecastByDateAndMenu.set(
        forecastKey(forecast.date, forecast.menuId),
        forecast.predicted,
      );
    });

    const forecastsToInsert = [];
    for (const [menuId, result] of forecastByMenu) {
      chartDates.slice(7).forEach((date, index) => {
        const key = forecastKey(date, menuId);
        if (!forecastByDateAndMenu.has(key)) {
          forecastsToInsert.push({
            date,
            menuId,
            predicted: result.forecast[index],
            issuedOn: today,
          });
        }
      });
    }
    await insertSalesForecasts(forecastsToInsert);
    const savedForecasts = await fetchSalesForecasts(
      chartDates[0],
      chartDates[chartDates.length - 1],
    );
    savedForecasts.forEach((forecast) => {
      forecastByDateAndMenu.set(
        forecastKey(forecast.date, forecast.menuId),
        forecast.predicted,
      );
    });
  } catch (error) {
    forecastStorageError = error;
    console.error("Gagal memuat atau menyimpan prediksi harian:", error);
  }

  if (updateSequence !== forecastUpdateSequence) return;

  const buildBacktestPrediction = (menuId, targetDate) => {
    const { historical } = forecastByMenu.get(menuId);
    const historicalDates = state.receiptHistory
      .map((receipt) => receipt.date)
      .filter((date) => date && date <= today)
      .sort();
    const firstDate = historicalDates[0];
    if (!firstDate || targetDate <= firstDate || targetDate > today) return null;

    const dayIndex =
      (new Date(`${targetDate}T00:00:00Z`) -
        new Date(`${firstDate}T00:00:00Z`)) /
      86400000;
    const trainingHistory = historical.slice(0, dayIndex);
    if (!trainingHistory.length) return null;
    return forecastWithExistingMethod(trainingHistory, 1)[0];
  };

  const buildDataset = (menuId, label, color) => {
    const actual = buildActualSeries(menuId);
    const { historical, forecast } = forecastByMenu.get(menuId);
    const predictions = chartDates.map((date, index) => {
      const saved = forecastByDateAndMenu.get(forecastKey(date, menuId));
      if (saved !== undefined) return saved;
      if (index < 7) return buildBacktestPrediction(menuId, date);
      return forecast[index - 7] ?? null;
    });
    const annotations = salesEvents
      .filter(
        (event) =>
          (!event.menuId || menuId === "ALL" || event.menuId === menuId) &&
          chartDates.indexOf(event.date) >= 0 &&
          chartDates.indexOf(event.date) < 7,
      )
      .map((event) => {
        const dayIndex = chartDates.indexOf(event.date);
        const annotationData = Array(9).fill(null);
        annotationData[dayIndex] = actual[dayIndex];
        return {
          label: EVENT_CATEGORY_LABELS[event.category] || "Kejadian",
          data: annotationData,
          isSalesEvent: true,
          salesEvent: event,
          showLine: false,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointStyle: "triangle",
          pointBackgroundColor: "#f97316",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 1,
        };
      });
    return {
      dataDays: historical.length,
      forecast,
      predictions,
      actual,
      datasets: [
        {
          label: `${label} (Aktual)`,
          data: [...actual, null, null],
          isActualSeries: true,
          borderColor: color,
          backgroundColor: color + "22",
          borderWidth: 3,
          tension: 0.3,
          fill: true,
        },
        {
          label: `${label} (Prediksi)`,
          data: predictions,
          borderColor: color,
          borderDash: [5, 5],
          borderWidth: 2,
          tension: 0.3,
        },
        ...annotations,
      ],
    };
  };

  const selectedMenu = state.menuCatalog.find((menu) => menu.id === selectedVal);
  const forecastSummary =
    selectedVal === "ALL"
      ? buildDataset("ALL", "Semua Menu", "#059669")
      : buildDataset(selectedVal, selectedMenu?.name || "Menu", "#0284c7");

  const adjustmentSelect = document.getElementById("salesEventAdjustment");
  const selectedCategory = adjustmentSelect?.value || "normal";
  const otherAdjustmentInput = document.getElementById(
    "salesEventAdjustmentOther",
  );
  const customAdjustmentLabel = otherAdjustmentInput?.value.trim();
  otherAdjustmentInput?.classList.toggle(
    "hidden",
    selectedCategory !== "lainnya",
  );
  if (otherAdjustmentInput) {
    otherAdjustmentInput.required = selectedCategory === "lainnya";
  }
  const adjustmentMessage = document.getElementById(
    "salesEventAdjustmentMessage",
  );
  let adjustment = 0;
  let adjustmentCount = 0;
  try {
    if (
      selectedCategory !== "normal" &&
      (selectedCategory !== "lainnya" || customAdjustmentLabel)
    ) {
      ({ adjustment, adjustmentCount } =
        await getEventAdjustment(selectedCategory));
    }
  } catch (error) {
    console.error("Gagal menghitung koreksi dari catatan kejadian:", error);
    if (adjustmentMessage) {
      adjustmentMessage.innerText =
        "Koreksi belum dapat dimuat. Periksa koneksi dan pastikan migration sudah dijalankan.";
    }
  }
  if (updateSequence !== forecastUpdateSequence) return;

  const normalTomorrow = forecastSummary.forecast[0] || 0;
  const missingOtherLabel =
    selectedCategory === "lainnya" && !customAdjustmentLabel;
  const adjustedTomorrow =
    selectedCategory !== "normal" && !missingOtherLabel && adjustmentCount > 0
      ? Math.max(0, Math.round(normalTomorrow * (1 + adjustment)))
      : normalTomorrow;
  forecastSummary.datasets[1].data[7] = adjustedTomorrow;
  if (adjustmentMessage && salesEventsReady) {
    if (selectedCategory === "normal") {
      adjustmentMessage.innerText =
        `Prediksi besok memakai angka normal: ${formatPorsions(normalTomorrow)} porsi.`;
    } else if (missingOtherLabel) {
      adjustmentMessage.innerText =
        `Tuliskan dulu kejadian yang dimaksud pada kolom Lainnya. Prediksi sementara tetap ${formatPorsions(normalTomorrow)} porsi.`;
    } else if (adjustmentCount === 0) {
      const selectedEventLabel =
        selectedCategory === "lainnya"
          ? customAdjustmentLabel || "kejadian lainnya"
          : EVENT_CATEGORY_LABELS[selectedCategory]?.toLowerCase() || "kejadian";
      adjustmentMessage.innerText =
        `Belum ada histori ${selectedEventLabel} sebelumnya, prediksi memakai angka normal dulu (${formatPorsions(normalTomorrow)} porsi).`;
    } else {
      const selectedEventLabel =
        selectedCategory === "lainnya"
          ? customAdjustmentLabel || "Lainnya"
          : EVENT_CATEGORY_LABELS[selectedCategory];
      const direction =
        adjustedTomorrow > normalTomorrow
          ? "dinaikkan"
          : adjustedTomorrow < normalTomorrow
            ? "diturunkan"
            : "disesuaikan";
      adjustmentMessage.innerText =
        `Karena besok Anda tandai ${selectedEventLabel}, ` +
        `prediksi ${direction} dari ${formatPorsions(normalTomorrow)} jadi ` +
        `${formatPorsions(adjustedTomorrow)} porsi (berdasarkan rata-rata ` +
        `${adjustmentCount} kejadian ${EVENT_CATEGORY_LABELS[selectedCategory].toLowerCase()} sebelumnya).`;
    }
  }

  forecastChartInstance.data.datasets = forecastSummary.datasets;
  forecastChartInstance.options.plugins.subtitle.text =
    "Prediksi historis memakai data sebelum tanggal target; aktual hari ini masih sementara";
  forecastChartInstance.options.plugins.legend.labels.filter = (
    legendItem,
    chartData,
  ) => !chartData.datasets[legendItem.datasetIndex].isSalesEvent;
  forecastChartInstance.options.plugins.tooltip.callbacks = {
    label(context) {
      const event = context.dataset.salesEvent;
      if (event) {
        const category = EVENT_CATEGORY_LABELS[event.category] || "Kejadian";
        return event.note ? `${category}: ${event.note}` : category;
      }
      if (context.dataset.isActualSeries && context.dataIndex === 6) {
        return `${context.dataset.label}: ${context.formattedValue} porsi (sementara)`;
      }
      return `${context.dataset.label}: ${context.formattedValue}`;
    },
  };

  const mapeEl = document.getElementById("mapeScore");
  if (mapeEl) {
    const historicalErrors = forecastSummary.predictions
      .slice(0, 6)
      .map((predicted, index) =>
        predicted === null || predicted === undefined
          ? null
          : Math.abs(forecastSummary.actual[index] - predicted),
      )
      .filter((error) => error !== null && Number.isFinite(error));
    if (historicalErrors.length) {
      const averageError =
        historicalErrors.reduce((sum, error) => sum + error, 0) /
        historicalErrors.length;
      mapeEl.className =
        "text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded";
      mapeEl.innerText =
        `Selisih rata-rata: ${formatPorsions(averageError)} porsi (${historicalErrors.length} hari)`;
    } else {
      mapeEl.className =
        "text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded";
      mapeEl.innerText = "Belum cukup data untuk menilai prediksi historis";
    }
  }

  const storageStatus = document.getElementById("forecastStorageStatus");
  if (storageStatus) {
    if (!forecastStorageError) {
      storageStatus.classList.add("hidden");
      storageStatus.textContent = "";
    } else {
      const message =
        ["42P01", "PGRST205"].includes(forecastStorageError.code)
          ? "Penyimpanan prediksi belum aktif. Jalankan supabase/migrations/20261101_daily_sales_forecasts.sql di SQL Editor Supabase."
          : "Prediksi ke depan belum dapat disimpan ke Supabase. Periksa koneksi dan izin akses database.";
      storageStatus.textContent = message;
      storageStatus.classList.remove("hidden");
    }
  }

  forecastChartInstance.update();
  if (salesEventsReady) {
    const today = getTodayDate();
    if (!localStorage.getItem(`${EVENT_PROMPT_STORAGE_KEY}${today}`)) {
      const candidate = getTodaySalesEventCandidate();
      if (candidate) showSalesEventPrompt(candidate);
    }
  }
}
