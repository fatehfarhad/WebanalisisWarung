import {
  fetchMenuCatalog,
  fetchRawMaterials,
  fetchReceipts,
  fetchDashboardSnapshots,
  fetchPromotions,
  fetchMaterialBatchDisposalLoss,
  fetchMaterialBatchDisposals,
} from "./db.js";

// Cache lokal supaya UI tidak perlu query ulang setiap render.
// Sumber kebenaran (source of truth) tetap di Supabase — cache ini
// hanya disegarkan lagi (reload) setiap kali ada perubahan data.
export const state = {
  menuCatalog: [],
  rawMaterials: [],
  receiptHistory: [],
  currentReceiptItems: [], // item yang sedang dirakit di form struk (belum disimpan)
  dashboardSnapshots: [],
  promotions: [],
  materialBatchDisposedLoss: 0,
  materialBatchDisposals: [],
  materialBatchDisposalReady: false,
};

export async function reloadMenuCatalog() {
  state.menuCatalog = await fetchMenuCatalog();
  return state.menuCatalog;
}

export async function reloadRawMaterials() {
  state.rawMaterials = await fetchRawMaterials();
  return state.rawMaterials;
}

export async function reloadReceipts() {
  state.receiptHistory = await fetchReceipts();
  return state.receiptHistory;
}

export async function reloadDashboardSnapshots() {
  state.dashboardSnapshots = await fetchDashboardSnapshots();
  return state.dashboardSnapshots;
}

export async function reloadPromotions() {
  try {
    state.promotions = await fetchPromotions();
  } catch (error) {
    console.warn("Daftar promo belum dapat dimuat:", error);
  }
  return state.promotions;
}

export async function reloadMaterialBatchDisposedLoss() {
  state.materialBatchDisposedLoss = await fetchMaterialBatchDisposalLoss();
  return state.materialBatchDisposedLoss;
}

export async function reloadMaterialBatchDisposals() {
  state.materialBatchDisposals = await fetchMaterialBatchDisposals();
  return state.materialBatchDisposals;
}

export async function reloadAll() {
  await Promise.all([
    reloadMenuCatalog(),
    reloadRawMaterials(),
    reloadReceipts(),
    reloadDashboardSnapshots(),
    reloadPromotions(),
  ]);

  try {
    await Promise.all([
      reloadMaterialBatchDisposedLoss(),
      reloadMaterialBatchDisposals(),
    ]);
    state.materialBatchDisposalReady = true;
  } catch (error) {
    state.materialBatchDisposalReady = false;
    console.error(
      "Fitur pembuangan batch belum siap. Jalankan migrasi Supabase 20261019_material_batch_disposals.sql:",
      error,
    );
  }
}

export function getTodayTotals() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayReceipts = state.receiptHistory.filter((r) => r.date === todayStr);
  const totalSales = todayReceipts.reduce((sum, r) => sum + r.total, 0);
  const totalProfit = todayReceipts.reduce((sum, r) => sum + r.profit, 0);
  return { totalSales, totalProfit };
}

export function getSalesByMenu() {
  const sales = new Map(state.menuCatalog.map((m) => [m.id, 0]));
  state.receiptHistory.forEach((receipt) =>
    (receipt.items || []).forEach((item) => {
      if (!item.menuId) return;
      sales.set(item.menuId, (sales.get(item.menuId) || 0) + item.qty);
    }),
  );
  return sales;
}
