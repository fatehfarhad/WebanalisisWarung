import {
  state,
  reloadAll,
  reloadRawMaterials,
  reloadReceipts,
} from "./state.js";
import { supabase } from "./supabaseClient.js";
import { showToast } from "./ui/toast.js";
import {
  renderMenuCatalogTable,
  populateMenuDropdowns,
  requestMenuStatusChange,
  requestMenuDelete,
  openMenuForm,
  addRecipeRow,
  updateRecipeEmptyState,
  addNewMenuItem,
  openMenuPhotoPicker,
  handleMenuPhotoSelection,
} from "./ui/menu.js";
import {
  renderRawMaterialsTable,
  openMaterialBatchExpiryDetails,
  openMaterialForm,
  openBatchForm,
  updateMaterialExpiryDate,
  updateBatchExpiryDate,
  openBatchExpiryCorrection,
  updateExpiryCorrectionWarning,
  requestBatchExpiryCorrection,
  openExpiredBatchDisposal,
  updateExpiredDisposalPreview,
  requestExpiredBatchDisposal,
  saveMaterial,
  saveMaterialBatch,
  requestDeleteMaterial,
  initMaterialPriceChart,
  updateMaterialPriceChart,
} from "./ui/materials.js?v=20261019-2";
import {
  renderFefoTable,
  activatePromoRecommendation,
} from "./ui/fefo.js?v=20261019-4";
import { openFefoPromoModal } from "./ui/fefoPromoModal.js";
import {
  addItemToReceipt,
  removeItemFromReceipt,
  renderReceiptPendingItems,
  requestReceiptSave,
  renderReceiptHistoryList,
  handleReceiptDateChange,
  initCashierInteractions,
  confirmReceiptPayment,
  closeCashPayment,
} from "./ui/cashier.js";
import {
  initCashierGrid,
  renderCashierGrid,
  syncCashierMenuSelection,
} from "./ui/cashierGrid.js";
import {
  updateROPDemandInput,
  calculateROP,
  updateEOQInputs,
  calcEOQ,
} from "./ui/smartTools.js";
import {
  updateDashboardCards,
  initForecastChart,
  updateForecastChart,
  saveSalesEvent,
  skipSalesEvent,
  syncDashboardSnapshot,
} from "./ui/dashboard.js";
import { renderAiRecommendations, askAiAdvisor } from "./ui/forecasting.js";
import {
  initAnalyticsExperience,
  resetAnalyticsVault,
} from "./ui/analyticsPopup.js";
import {
  initPromoSimulator,
  renderPromoSimulator,
} from "./ui/promoSimulator.js";
import {
  initWeekdayCard,
  renderWeekdayCard,
  renderPromoTrackCard,
} from "./ui/weekdayCard.js";
import {
  initMenuEngineeringCard,
  renderMenuEngineeringCard,
} from "./ui/menuEngineeringCard.js";
import { initBasketCard, renderBasketCard } from "./ui/basketCard.js";
import {
  initBasketHint,
  preloadBasketHintAnalysis,
  renderBasketHintForCurrentDraft,
} from "./ui/basketHint.js";
import {
  evaluateFinishedPromos,
  initPromoForm,
  renderPromotions,
} from "./ui/promos.js";
import {
  openModal,
  closeModal,
  continueActionConfirmation,
  toggleFinalConfirmation,
  cancelActionConfirmation,
  executeConfirmedAction,
} from "./ui/modals.js";
import { toInputDate } from "./utils.js";

let realtimeChannel = null;
let realtimeRefreshTimer = null;
const pendingRealtimeTables = new Set();

// ---------- NAVIGASI TAB & SIDEBAR ----------
function switchTab(tabId) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.remove("bg-emerald-50", "text-emerald-600", "font-bold");
  });

  document.getElementById(`tab-${tabId}`).classList.remove("hidden");
  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav)
    activeNav.classList.add("bg-emerald-50", "text-emerald-600", "font-bold");

  if (window.innerWidth < 768) {
    document.getElementById("sidebar").classList.add("-translate-x-full");
  }
  if (tabId === "forecasting") {
    resetAnalyticsVault();
  } else if (tabId === "cashier") {
    preloadBasketHintAnalysis();
    renderBasketHintForCurrentDraft();
  } else if (tabId === "menu-catalog") {
    renderPromotions();
    evaluateFinishedPromos();
  }
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("-translate-x-full");
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-tab]");
  if (!tabButton) return;

  event.preventDefault();
  const tabId = tabButton.dataset.tab;
  if (typeof window.switchTab === "function") {
    window.switchTab(tabId);
  } else {
    switchTab(tabId);
  }
});

// openModal butuh sedikit logika tambahan sebelum tampil (isi ulang tabel/select)
function openModalWithSetup(id) {
  openModal(id);
  if (id === "modal-fefo") renderFefoTable();
  if (id === "modal-rop") updateROPDemandInput();
  if (id === "modal-eoq") updateEOQInputs();
}

// Dipanggil setiap kali ada perubahan data supaya semua tampilan konsisten
async function refreshEverything() {
  await syncDashboardSnapshot();
  updateDashboardCards();
  await updateForecastChart();
  await renderPromoSimulator();
  renderMenuEngineeringCard();
  await renderPromotions();
  renderRawMaterialsTable();
  updateMaterialPriceChart();
  renderFefoTable();
  renderAiRecommendations();
  renderWeekdayCard();
  renderPromoTrackCard();
  renderBasketCard();
  renderBasketHintForCurrentDraft();
}

document.addEventListener("forecastbiz:menu-changed", refreshEverything);
document.addEventListener("forecastbiz:materials-changed", refreshEverything);
document.addEventListener("forecastbiz:receipt-saved", refreshEverything);
document.addEventListener("forecastbiz:promotion-changed", async () => {
  await renderPromotions();
  renderMenuCatalogTable();
  populateMenuDropdowns();
  await renderPromoSimulator();
  renderWeekdayCard();
  renderPromoTrackCard();
});

function updateRealtimeStatus(status) {
  const indicator = document.getElementById("realtimeStatus");
  if (!indicator) return;
  const styles = {
    SUBSCRIBED: {
      label: "Real-time aktif",
      classes: "text-emerald-600",
      icon: "fa-circle-check",
    },
    CHANNEL_ERROR: {
      label: "Real-time terputus",
      classes: "text-rose-600",
      icon: "fa-circle-exclamation",
    },
    TIMED_OUT: {
      label: "Real-time timeout",
      classes: "text-amber-600",
      icon: "fa-triangle-exclamation",
    },
  };
  const display = styles[status] || {
    label: "Menghubungkan real-time...",
    classes: "text-slate-500",
    icon: "fa-arrows-rotate",
  };
  indicator.className = `text-xs font-medium flex items-center gap-1 mt-1 ${display.classes}`;
  indicator.replaceChildren();
  const icon = document.createElement("i");
  icon.className = `fa-solid ${display.icon}`;
  indicator.append(icon, document.createTextNode(` ${display.label}`));
}

function scheduleRealtimeRefresh(table) {
  pendingRealtimeTables.add(table);
  window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(async () => {
    const changedTables = new Set(pendingRealtimeTables);
    pendingRealtimeTables.clear();
    const receiptChanged =
      changedTables.has("receipts") || changedTables.has("receipt_items");
    const materialChanged =
      changedTables.has("raw_materials") ||
      changedTables.has("material_batches");

    try {
      const reloads = [];
      if (receiptChanged) reloads.push(reloadReceipts());
      if (materialChanged) reloads.push(reloadRawMaterials());
      await Promise.all(reloads);

      if (receiptChanged) {
        await syncDashboardSnapshot();
        renderReceiptHistoryList();
        await updateForecastChart();
        await renderPromoSimulator();
        renderMenuEngineeringCard();
        renderWeekdayCard();
        renderPromoTrackCard();
        renderBasketCard();
      }
      if (materialChanged) {
        renderRawMaterialsTable();
        renderFefoTable();
        updateMaterialPriceChart();
      }
      updateDashboardCards();
    } catch (error) {
      console.error("Gagal menyegarkan data dari Supabase Realtime:", error);
      showToast(
        `Perubahan real-time diterima, tetapi data gagal diperbarui. ${error.message || "Muat ulang halaman."}`,
        "error",
      );
    }
  }, 350);
}

function initRealtimeSubscriptions() {
  if (realtimeChannel) return;
  const tables = ["receipts", "receipt_items", "raw_materials", "material_batches"];
  let channel = supabase.channel("forecastbiz-live-updates");
  tables.forEach((table) => {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => scheduleRealtimeRefresh(table),
    );
  });
  realtimeChannel = channel.subscribe((status, error) => {
    updateRealtimeStatus(status);
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("Supabase Realtime tidak tersedia:", error || status);
      showToast(
        "Sinkronisasi real-time tidak tersedia. Pastikan tabel diaktifkan pada Supabase Realtime.",
        "warn",
        { duration: 6000 },
      );
    }
  });
}

// ---------- INISIALISASI ----------
async function init() {
  document.getElementById("receiptDate").value = toInputDate(new Date());
  document.getElementById("receiptDate").addEventListener("change", () => {
    handleReceiptDateChange();
    populateMenuDropdowns();
  });
  document.getElementById("receiptDate").addEventListener("input", () => {
    handleReceiptDateChange();
    populateMenuDropdowns();
  });
  initPromoForm();
  initWeekdayCard();
  initMenuEngineeringCard();
  initBasketCard();
  initBasketHint();
  initCashierInteractions();
  const receiptSelect = document.getElementById("receiptMenuSelect");
  if (receiptSelect) {
    receiptSelect.addEventListener("change", () => {
      const selected = receiptSelect.value;
      if (!selected) return;
      const targetCard = document.querySelector(`[data-menu-id="${selected}"]`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
        targetCard.classList.remove("ring-2", "ring-emerald-400", "ring-offset-1");
        targetCard.classList.add("ring-2", "ring-emerald-400", "ring-offset-1");
        window.setTimeout(() => {
          targetCard.classList.remove("ring-2", "ring-emerald-400", "ring-offset-1");
        }, 2000);
      }
    });
  }

  try {
    await reloadAll();
    await syncDashboardSnapshot();
  } catch (err) {
    console.error("Gagal memuat data dari Supabase:", err);
    const message =
      err instanceof Error ? err.message : "Kesalahan tidak diketahui.";
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    const diagnostic =
      message === "Failed to fetch"
        ? "Periksa koneksi internet dan URL proyek Supabase."
        : `${message}${code ? ` (kode ${code})` : ""}`;
    showToast(
      `Gagal memuat data inti dari Supabase: ${diagnostic}\n\nPastikan URL dan publishable/anon key di js/config.js benar, proyek dapat diakses, dan schema.sql sudah dijalankan. Migrasi pembuangan batch bersifat terpisah; jika belum dijalankan, peringatannya akan muncul di Manajemen FEFO.`,
      "error",
      { duration: 12000 },
    );
  }

  renderMenuCatalogTable();
  populateMenuDropdowns();
  initCashierGrid();
  renderCashierGrid();
  renderReceiptPendingItems();
  initAnalyticsExperience();
  await renderPromotions();
  renderRawMaterialsTable();
  initMaterialPriceChart();
  renderReceiptHistoryList();
  initRealtimeSubscriptions();
  await initForecastChart();
  await initPromoSimulator();
  renderMenuEngineeringCard();
  renderWeekdayCard();
  renderPromoTrackCard();
  updateDashboardCards();
  renderAiRecommendations();
  evaluateFinishedPromos();
}

document.addEventListener("DOMContentLoaded", init);

// ---------- EXPOSE KE WINDOW (dipakai oleh atribut onclick di index.html) ----------
const globalFunctions = {
  switchTab,
  toggleSidebar,
  openModal: openModalWithSetup,
  closeModal,
  continueActionConfirmation,
  toggleFinalConfirmation,
  cancelActionConfirmation,
  executeConfirmedAction,

  openMenuForm,
  requestMenuStatusChange,
  requestMenuDelete,
  addRecipeRow,
  updateRecipeEmptyState,
  addNewMenuItem,
  openMenuPhotoPicker,
  handleMenuPhotoSelection,

  openMaterialBatchExpiryDetails,
  openMaterialForm,
  openBatchForm,
  updateMaterialExpiryDate,
  updateBatchExpiryDate,
  openBatchExpiryCorrection,
  updateExpiryCorrectionWarning,
  requestBatchExpiryCorrection,
  openExpiredBatchDisposal,
  updateExpiredDisposalPreview,
  requestExpiredBatchDisposal,
  saveMaterial,
  saveMaterialBatch,
  requestDeleteMaterial,

  renderFefoTable,
  activatePromoRecommendation,
  openFefoPromoModal,

  addItemToReceipt,
  removeItemFromReceipt,
  renderReceiptPendingItems,
  requestReceiptSave,
  handleReceiptDateChange,
  confirmReceiptPayment,
  closeCashPayment,
  renderCashierGrid,
  syncCashierMenuSelection,

  updateROPDemandInput,
  calculateROP,
  updateEOQInputs,
  calcEOQ,

  updateForecastChart,
  saveSalesEvent,
  skipSalesEvent,
  updateMaterialPriceChart,
  askAiAdvisor,
  renderAiRecommendations,
};

Object.assign(window, globalFunctions);
Object.keys(globalFunctions).forEach((key) => {
  window[key] = globalFunctions[key];
});
