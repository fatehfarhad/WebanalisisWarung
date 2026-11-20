import {
  fetchEarliestReceiptDate,
  fetchPromotions,
  fetchReceiptsSince,
  insertPromotion,
  insertSalesEvent,
  stopPromotion,
  updatePromotionResult,
} from "../db.js";
import { state, reloadPromotions } from "../state.js";
import { formatRupiah } from "../utils.js";
import {
  addDays,
  effectivePromoEndDate,
  evaluatePromo,
  getPromoStatus,
  listPromoDays,
  parseLocalDate,
  promoAppliesOn,
  promosConflict,
  todayLocal,
} from "../promoEval.js";
import { getRecipeCost } from "./forecasting.js";
import { closeModal, openActionConfirmation, openModal } from "./modals.js";

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DAY_NAMES_FULL = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
let formMenuId = "";
let simulationResult = null;

function formatPercent(value) {
  return `${Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatApproximateRupiah(value) {
  return formatRupiah(Math.round(Math.abs(value) / 100) * 100);
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseLocalDate(dateString));
}

function selectedWeekdays() {
  return [
    ...document.querySelectorAll(
      "#modal-promo-form [data-promo-weekday].is-selected",
    ),
  ]
    .map((button) => Number(button.dataset.promoWeekday))
    .sort((a, b) => a - b);
}

function syncDurationButtons() {
  const startDate = document.getElementById("promotionStartDate").value;
  const endDate = document.getElementById("promotionEndDate").value;
  const duration =
    startDate && endDate && endDate >= startDate
      ? (parseLocalDate(endDate) - parseLocalDate(startDate)) / 86400000 + 1
      : 0;

  document
    .querySelectorAll("#modal-promo-form [data-promo-duration]")
    .forEach((button) => {
      const active = Number(button.dataset.promoDuration) === duration;
      button.classList.toggle("is-selected", active);
      button.classList.toggle("bg-emerald-600", active);
      button.classList.toggle("text-white", active);
      button.classList.toggle("border-emerald-600", active);
      button.classList.toggle("bg-white", !active);
      button.classList.toggle("text-slate-700", !active);
      button.classList.toggle("border-slate-300", !active);
      button.setAttribute("aria-pressed", String(active));
    });
}

function formValues() {
  return {
    menuId: formMenuId,
    promoPrice: Number(document.getElementById("promotionPrice").value),
    startDate: document.getElementById("promotionStartDate").value,
    endDate: document.getElementById("promotionEndDate").value,
    weekdays: selectedWeekdays(),
  };
}

function promoCandidate(values, menu) {
  return {
    ...values,
    normalPrice: Number(menu.price),
  };
}

function promoDayDescription(weekdays) {
  if (!weekdays.length) return "setiap hari";
  return weekdays.map((day) => DAY_NAMES_FULL[day]).join(", ");
}

function getFormValidation(values, menu) {
  if (!menu || !menu.active) return "Menu harus aktif untuk menjalankan promo.";
  if (
    !Number.isFinite(values.promoPrice) ||
    values.promoPrice <= 0 ||
    values.promoPrice >= Number(menu.price)
  ) {
    return "Isi harga promo lebih dari Rp0 dan lebih rendah dari harga normal.";
  }
  const totalCost =
    Math.max(Number(menu.cost) || 0, getRecipeCost(menu)) +
    (Number(menu.other_cost) || 0);
  if (values.promoPrice - totalCost <= 0) {
    return "Harga promo harus di atas modal agar promo bisa dijalankan.";
  }
  const today = todayLocal();
  if (!values.startDate || values.startDate < today) {
    return "Tanggal mulai tidak boleh sebelum hari ini.";
  }
  if (!values.endDate || values.endDate < values.startDate) {
    return "Tanggal selesai harus sama atau sesudah tanggal mulai.";
  }
  const duration =
    (parseLocalDate(values.endDate) - parseLocalDate(values.startDate)) /
      86400000 +
    1;
  if (duration > 366) return "Durasi promo maksimal 366 hari.";
  if (listPromoDays(promoCandidate(values, menu)).length === 0) {
    return "Rentang tanggal ini tidak mencakup hari yang Anda pilih.";
  }
  return "";
}

function promotionDatabaseError(error) {
  const code = error && typeof error === "object" ? error.code : "";
  const message =
    error && typeof error === "object" ? String(error.message || "") : "";
  const lowerMessage = message.toLowerCase();

  if (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "PGRST204" ||
    lowerMessage.includes("does not exist") ||
    lowerMessage.includes("schema cache")
  ) {
    return "Pastikan supabase/migration_sales_events.sql dan supabase/migration_promotions.sql sudah dijalankan di SQL Editor Supabase (migrasi sales events lebih dulu).";
  }
  if (code === "42501" || lowerMessage.includes("permission")) {
    return "Akses database ditolak. Periksa kebijakan RLS pada tabel promotions.";
  }
  return message || "Periksa koneksi dan coba lagi.";
}

function renderPromotionFormSummary() {
  syncDurationButtons();
  const menu = state.menuCatalog.find((item) => item.id === formMenuId);
  const values = formValues();
  const error = getFormValidation(values, menu);
  const summary = document.getElementById("promotionSummary");
  const errorElement = document.getElementById("promotionFormError");
  const startDate = document.getElementById("promotionStartDate").value;
  const endDate = document.getElementById("promotionEndDate").value;
  const promoDays =
    menu && startDate && endDate && endDate >= startDate
      ? listPromoDays(promoCandidate(values, menu)).length
      : 0;
  const discount =
    menu && menu.price > 0
      ? ((menu.price - values.promoPrice) / menu.price) * 100
      : 0;
  const totalCost = menu
    ? Math.max(Number(menu.cost) || 0, getRecipeCost(menu)) +
      (Number(menu.other_cost) || 0)
    : 0;
  const normalProfit = menu ? Number(menu.price) - totalCost : 0;
  const promoProfit = values.promoPrice - totalCost;
  const breakEven =
    promoProfit > 0 ? (normalProfit / promoProfit - 1) * 100 : null;
  const amountText =
    breakEven === null
      ? "Belum bisa dihitung sampai harga promo di atas modal."
      : `Penjualan harus naik minimal ${formatPercent(breakEven)} supaya total untung tidak turun.`;
  if (menu) {
    summary.replaceChildren(
      document.createTextNode(
        `Harga normal ${formatRupiah(menu.price)} jadi ${formatRupiah(values.promoPrice)} (diskon ${formatPercent(discount)}). Untung per porsi: `,
      ),
    );
    const normalProfitElement = document.createElement("s");
    normalProfitElement.textContent = formatRupiah(normalProfit);
    const promoProfitElement = document.createElement("strong");
    promoProfitElement.textContent = formatRupiah(promoProfit);
    summary.append(
      normalProfitElement,
      document.createTextNode(" → "),
      promoProfitElement,
      document.createTextNode(
        `. ${amountText} Berlaku: ${promoDayDescription(values.weekdays)}, ${startDate ? formatDate(startDate) : "-"} sampai ${endDate ? formatDate(endDate) : "-"} (${promoDays} hari promo).`,
      ),
    );
  } else {
    summary.textContent = "Pilih menu yang aktif.";
  }
  errorElement.textContent = error;
  errorElement.classList.toggle("hidden", !error);
  document.getElementById("promotionSaveButton").disabled = Boolean(error);
}

function setPromoPriceFromDiscount() {
  const menu = state.menuCatalog.find((item) => item.id === formMenuId);
  const discountInput = document.getElementById("promotionDiscount");
  const enteredDiscount = Number(discountInput.value);
  if (menu && Number.isFinite(enteredDiscount)) {
    const discount = Math.round(enteredDiscount * 10) / 10;
    discountInput.value = discount.toFixed(1);
    document.getElementById("promotionPrice").value = String(
      menu.price * (1 - discount / 100),
    );
  }
  renderPromotionFormSummary();
}

function setDiscountFromPromoPrice() {
  const menu = state.menuCatalog.find((item) => item.id === formMenuId);
  const price = Number(document.getElementById("promotionPrice").value);
  document.getElementById("promotionDiscount").value =
    menu && price > 0
      ? (((menu.price - price) / menu.price) * 100).toFixed(1)
      : "";
  renderPromotionFormSummary();
}

export function initPromoForm() {
  const form = document.getElementById("promotionForm");
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = "true";
  document
    .getElementById("promotionPrice")
    .addEventListener("input", setDiscountFromPromoPrice);
  document
    .getElementById("promotionDiscount")
    .addEventListener("input", setPromoPriceFromDiscount);
  ["promotionStartDate", "promotionEndDate"].forEach((id) =>
    document
      .getElementById(id)
      .addEventListener("input", renderPromotionFormSummary),
  );
  document
    .querySelectorAll("#modal-promo-form [data-promo-weekday]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const active = !button.classList.contains("is-selected");
        button.classList.toggle("is-selected", active);
        button.classList.toggle("bg-emerald-600", active);
        button.classList.toggle("text-white", active);
        button.classList.toggle("border-emerald-600", active);
        button.classList.toggle("bg-white", !active);
        button.classList.toggle("text-slate-600", !active);
        button.classList.toggle("border-slate-300", !active);
        button.setAttribute("aria-pressed", String(active));
        renderPromotionFormSummary();
      });
    });
  document
    .querySelectorAll("#modal-promo-form [data-promo-duration]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const startDate = document.getElementById("promotionStartDate").value;
        if (!startDate) return;
        const duration = Number(button.dataset.promoDuration);
        document.getElementById("promotionEndDate").value = addDays(
          startDate,
          duration - 1,
        );
        renderPromotionFormSummary();
      });
    });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    requestCreatePromotion();
  });
}

export function openPromotionForm(menuId, promoPrice, scenario = null) {
  const menu = state.menuCatalog.find((item) => item.id === menuId);
  if (!menu || !menu.active) return;
  formMenuId = menuId;
  simulationResult = scenario;
  document.getElementById("promotionMenuName").textContent = menu.name;
  document.getElementById("promotionNormalPrice").textContent =
    formatRupiah(menu.price);
  document.getElementById("promotionPrice").value = Number.isFinite(
    Number(promoPrice),
  )
    ? Number(promoPrice)
    : "";
  document.getElementById("promotionStartDate").min = todayLocal();
  document.getElementById("promotionStartDate").value = todayLocal();
  document.getElementById("promotionEndDate").value = todayLocal();
  document.getElementById("promotionDiscount").value = "";
  document
    .querySelectorAll("#modal-promo-form [data-promo-weekday]")
    .forEach((button) => {
      button.classList.remove(
        "is-selected",
        "bg-emerald-600",
        "text-white",
        "border-emerald-600",
      );
      button.classList.add("bg-white", "text-slate-600", "border-slate-300");
      button.setAttribute("aria-pressed", "false");
    });
  setDiscountFromPromoPrice();
  openModal("modal-promo-form");
}

async function requestCreatePromotion() {
  const menu = state.menuCatalog.find((item) => item.id === formMenuId);
  const values = formValues();
  const validation = getFormValidation(values, menu);
  if (validation) {
    document.getElementById("promotionFormError").textContent = validation;
    document.getElementById("promotionFormError").classList.remove("hidden");
    return;
  }

  let latestPromotions;
  try {
    latestPromotions = await fetchPromotions({ throwOnError: true });
  } catch (error) {
    console.error("Gagal memeriksa jadwal promo:", error);
    document.getElementById("promotionFormError").textContent =
      `Jadwal promo belum bisa diperiksa. ${promotionDatabaseError(error)}`;
    document.getElementById("promotionFormError").classList.remove("hidden");
    return;
  }
  const proposed = promoCandidate(values, menu);
  const conflict = latestPromotions.find(
    (promo) => promo.menuId === menu.id && promosConflict(promo, proposed),
  );
  if (conflict) {
    document.getElementById("promotionFormError").textContent =
      `Menu ini sudah punya promo yang bertabrakan: ${conflict.startDate} sampai ${conflict.endDate}, ${promoDayDescription(conflict.weekdays)}. Hentikan promo itu dulu atau ubah tanggal/hari.`;
    document.getElementById("promotionFormError").classList.remove("hidden");
    return;
  }

  const promoDays = listPromoDays(proposed);
  const discount = ((menu.price - values.promoPrice) / menu.price) * 100;
  const lossWarning =
    simulationResult?.verdict === "rugi"
      ? `<div class="mt-2 rounded-lg bg-amber-50 p-2 text-amber-800">Simulasi memperkirakan RUGI sekitar ${formatApproximateRupiah(simulationResult.profitDifference)} per hari. Tetap jalankan?</div>`
      : "";
  closeModal("modal-promo-form");
  openActionConfirmation(
    "Verifikasi Mulai Promo",
    "Periksa kembali promo sebelum dijalankan.",
    `<b>${menu.name}</b><br/>${formatRupiah(menu.price)} menjadi ${formatRupiah(values.promoPrice)} (diskon ${formatPercent(discount)})<br/>${promoDayDescription(values.weekdays)}, ${formatDate(values.startDate)} sampai ${formatDate(values.endDate)} (${promoDays.length} hari promo).<br/><span class="text-emerald-700">Kasir akan otomatis memakai harga promo pada hari yang berlaku.</span>${lossWarning}`,
    () => savePromotion(proposed),
  );
}

async function savePromotion(promo) {
  try {
    await insertPromotion(promo);
    await reloadPromotions();
    renderPromotions();
    document.dispatchEvent(new CustomEvent("forecastbiz:promotion-changed"));
    closeModal("modal-promo-form");
  } catch (error) {
    console.error("Gagal menyimpan promo:", error);
    alert(`Promo belum tersimpan. ${promotionDatabaseError(error)}`);
  }
}

function getPromotionResultText(promo) {
  if (promo.resultStatus === "recorded") return promo.resultNote || "-";
  if (promo.resultStatus === "insufficient") {
    return `Belum bisa dinilai: ${promo.resultNote || "data belum cukup."}`;
  }
  return "Belum selesai";
}

function statusClass(status) {
  return {
    berjalan: "bg-emerald-100 text-emerald-700",
    terjadwal: "bg-blue-100 text-blue-700",
    selesai: "bg-slate-100 text-slate-600",
    dihentikan: "bg-orange-100 text-orange-700",
  }[status];
}

function renderPromoRows() {
  const body = document.getElementById("promotionsTableBody");
  if (!body) return;
  body.replaceChildren();
  const ordered = [...state.promotions].sort((a, b) => {
    const order = { berjalan: 0, terjadwal: 1, selesai: 2, dihentikan: 2 };
    const statusDifference =
      order[getPromoStatus(a)] - order[getPromoStatus(b)];
    return statusDifference || b.startDate.localeCompare(a.startDate);
  });
  if (!ordered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "p-4 text-center text-sm text-slate-500";
    cell.textContent =
      "Belum ada promo. Buat dari Simulasi Promo di tab Analytics.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  ordered.forEach((promo) => {
    const menu = state.menuCatalog.find((item) => item.id === promo.menuId);
    const status = getPromoStatus(promo);
    const row = document.createElement("tr");
    const cells = [
      menu?.name || "Menu dihapus",
      formatRupiah(promo.promoPrice),
      `${formatDate(promo.startDate)} – ${formatDate(effectivePromoEndDate(promo))} (${promoDayDescription(promo.weekdays)})`,
    ];
    cells.forEach((value) => {
      const cell = document.createElement("td");
      cell.className = "p-3 align-top";
      cell.textContent = value;
      row.appendChild(cell);
    });
    const statusCell = document.createElement("td");
    statusCell.className = "p-3 align-top";
    statusCell.innerHTML = `<span class="rounded-full px-2 py-1 text-xs font-semibold ${statusClass(status)}">${status[0].toUpperCase()}${status.slice(1)}</span>`;
    row.appendChild(statusCell);
    const resultCell = document.createElement("td");
    resultCell.className = "p-3 align-top text-xs";
    resultCell.textContent = getPromotionResultText(promo);
    row.appendChild(resultCell);
    const actionCell = document.createElement("td");
    actionCell.className = "p-3 align-top";
    if (status === "berjalan" || status === "terjadwal") {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "rounded-lg border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50";
      button.textContent = "Hentikan";
      button.addEventListener("click", () => requestStopPromotion(promo));
      actionCell.appendChild(button);
    } else {
      actionCell.textContent = "-";
    }
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

function requestStopPromotion(promo) {
  const menu = state.menuCatalog.find((item) => item.id === promo.menuId);
  openActionConfirmation(
    "Verifikasi Hentikan Promo",
    "Promo ini akan dihentikan mulai hari ini.",
    `<b>${menu?.name || "Menu"}</b><br/>Harga promo ${formatRupiah(promo.promoPrice)}<br/>Berakhir pada ${formatDate(todayLocal())}.`,
    () => confirmStopPromotion(promo),
  );
}

async function confirmStopPromotion(promo) {
  try {
    await stopPromotion(promo.id, todayLocal());
    await reloadPromotions();
    renderPromotions();
    document.dispatchEvent(new CustomEvent("forecastbiz:promotion-changed"));
  } catch (error) {
    console.error("Gagal menghentikan promo:", error);
    alert("Promo belum bisa dihentikan. Periksa koneksi lalu coba lagi.");
  }
}

function resultSummary(result) {
  if (result.vonis === "untung") {
    return `Untung: total untung naik sekitar ${formatApproximateRupiah(result.selisihPerHariPromo)} per hari promo (penjualan naik ${formatPercent(result.kenaikan * 100)}, batas impas ${formatPercent(result.kenaikanImpas * 100)}).`;
  }
  if (result.vonis === "rugi") {
    const salesChange =
      result.kenaikan < 0
        ? `turun ${formatPercent(Math.abs(result.kenaikan) * 100)}`
        : `naik ${formatPercent(result.kenaikan * 100)}`;
    return `Rugi: total untung turun sekitar ${formatApproximateRupiah(result.selisihPerHariPromo)} per hari promo (penjualan hanya ${salesChange}, padahal harus naik minimal ${formatPercent(result.kenaikanImpas * 100)}).`;
  }
  return "Kira-kira impas: total untung hampir sama dengan tanpa promo.";
}

async function evaluateOnePromotion(promo) {
  const endDate = effectivePromoEndDate(promo);
  const earliestDate = await fetchEarliestReceiptDate();
  const receipts = await fetchReceiptsSince(addDays(promo.startDate, -35));
  const qtyByDate = {};
  receipts.forEach((receipt) => {
    if (receipt.date > endDate) return;
    (receipt.items || []).forEach((item) => {
      if (item.menuId !== promo.menuId) return;
      qtyByDate[receipt.date] =
        (qtyByDate[receipt.date] || 0) + (Number(item.qty) || 0);
    });
  });
  const menu = state.menuCatalog.find((item) => item.id === promo.menuId);
  if (!menu) {
    await updatePromotionResult(
      promo.id,
      "insufficient",
      "Menu sudah tidak tersedia untuk dibandingkan.",
    );
    return;
  }
  const result = evaluatePromo({
    promo: { ...promo, endDate },
    biayaTotal: (Number(menu.cost) || 0) + (Number(menu.other_cost) || 0),
    qtyByDate,
    earliestReceiptDate: earliestDate,
  });
  if (result.status === "insufficient") {
    await updatePromotionResult(promo.id, "insufficient", result.alasan);
    return;
  }

  const discountPct = Number(result.diskonPct.toFixed(1));
  try {
    await insertSalesEvent({
      date: promo.startDate,
      menuId: promo.menuId,
      predicted: result.rataNormalPerHari,
      actual: result.rataPromoPerHari,
      deviationPct: result.kenaikan,
      category: "promo",
      discountPct,
      promoId: promo.id,
      isRecurring: false,
      note: `Promo otomatis ${discountPct}% selama ${result.hariPromo.length} hari promo.`,
    });
  } catch (error) {
    if (error.code !== "23505") throw error;
  }
  await updatePromotionResult(promo.id, "recorded", resultSummary(result));
}

export async function evaluateFinishedPromos() {
  let promos;
  try {
    promos = await fetchPromotions();
    for (const promo of promos) {
      const status = getPromoStatus(promo);
      if (
        promo.resultStatus === "pending" &&
        (status === "selesai" || status === "dihentikan")
      ) {
        try {
          await evaluateOnePromotion(promo);
        } catch (error) {
          console.warn(`Hasil promo ${promo.id} belum dapat dihitung:`, error);
        }
      }
    }
    await reloadPromotions();
    renderPromoRows();
  } catch (error) {
    console.warn("Hasil promo belum dapat diperbarui:", error);
  }
}

export async function renderPromotions() {
  await reloadPromotions();
  renderPromoRows();
}

export function promoIsActiveOn(menuId, date) {
  const menu = state.menuCatalog.find((item) => item.id === menuId);
  return state.promotions.some((promo) =>
    promoAppliesOn(promo, menu, date),
  );
}

export { DAY_NAMES };
