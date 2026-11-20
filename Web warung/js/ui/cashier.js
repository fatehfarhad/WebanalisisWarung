import { state, reloadRawMaterials, reloadReceipts } from "../state.js";
import {
  insertReceipt,
  updateMaterialBatchStock,
  countExistingReceipts,
} from "../db.js";
import {
  formatRupiah,
  convertRecipeAmountToStock,
  getExpiryStatus,
} from "../utils.js";
import {
  cancelActionConfirmation,
  closeModal,
  openActionConfirmation,
  openModal,
} from "./modals.js";
import { renderRawMaterialsTable } from "./materials.js";
import { renderFefoTable } from "./fefo.js";
import { getPriceForDate, todayLocal } from "../promoEval.js";
import { showToast } from "./toast.js";

let lastSavedReceipt = null;
let cashPaymentInitialized = false;

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Terjadi kesalahan yang tidak diketahui.";
}

export function playCashierTone(success = false) {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const frequencies = success ? [660, 880] : [740];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.1;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });
    window.setTimeout(() => context.close(), success ? 450 : 250);
  } catch (error) {
    console.warn("Umpan balik suara kasir tidak dapat diputar:", error);
  }
}

function getReceiptDate() {
  return document.getElementById("receiptDate").value || todayLocal();
}

export function setReceiptItemPrice(receiptItem, menu, date) {
  const { price, promo } = getPriceForDate(menu, state.promotions, date);
  receiptItem.price = price;
  receiptItem.subtotal = price * receiptItem.qty;
  receiptItem.profit =
    (price - Number(menu.cost) - (Number(menu.other_cost) || 0)) *
    receiptItem.qty;
  delete receiptItem.normalPrice;
  delete receiptItem.promoId;
  if (promo) {
    receiptItem.normalPrice = Number(menu.price);
    receiptItem.promoId = promo.id;
  }
}

export function addItemToReceipt() {
  const select = document.getElementById("receiptMenuSelect");
  const qtyInput = document.getElementById("receiptQty");
  const requestedQty = Number.parseInt(qtyInput?.value || "1", 10);
  const menu = state.menuCatalog.find((m) => m.id === (select?.value || ""));
  if (!menu) {
    showToast("Pilih menu aktif sebelum menambahkan item.", "warn");
    return;
  }
  if (!Number.isInteger(requestedQty) || requestedQty < 1) {
    showToast("Jumlah porsi minimal 1.", "warn");
    return;
  }

  const existingIndex = state.currentReceiptItems.findIndex(
    (item) => item.menuId === menu.id,
  );

  if (existingIndex >= 0) {
    state.currentReceiptItems[existingIndex].qty += requestedQty;
    setReceiptItemPrice(
      state.currentReceiptItems[existingIndex],
      menu,
      getReceiptDate(),
    );
  } else {
    const receiptItem = {
      menuId: menu.id,
      name: menu.name,
      qty: requestedQty,
    };
    setReceiptItemPrice(receiptItem, menu, getReceiptDate());
    state.currentReceiptItems.push(receiptItem);
  }

  if (qtyInput) qtyInput.value = "1";
  renderReceiptPendingItems();
  playCashierTone();
}

export function removeItemFromReceipt(index) {
  state.currentReceiptItems.splice(index, 1);
  renderReceiptPendingItems();
}

export function renderReceiptPendingItems() {
  const container = document.getElementById("receiptItemsList");
  const grandTotalEl = document.getElementById("receiptGrandTotal");

  if (state.currentReceiptItems.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-slate-400 italic">Belum ada item ditambahkan.</p>';
    grandTotalEl.innerText = "Rp 0";
  } else {
    let grandTotal = 0;
    container.innerHTML = "";
    state.currentReceiptItems.forEach((item, idx) => {
      grandTotal += item.subtotal;
      const paidPrice = item.promoId
        ? `<span class="text-rose-500 line-through">${formatRupiah(item.normalPrice)}</span> <span class="font-bold text-emerald-700">${formatRupiah(item.price)}</span> <span class="rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700">PROMO</span>`
        : `<span>${formatRupiah(item.price)}</span>`;
      const row = document.createElement("div");
      row.className =
        "flex items-center justify-between gap-2 rounded border border-slate-200 bg-white p-2 text-xs";
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 truncate">${item.name}</div>
          <div class="text-slate-500">${item.qty} x ${paidPrice}</div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <button type="button" data-receipt-qty="dec" data-index="${idx}" class="w-7 px-1 py-1 text-base font-bold text-slate-600 hover:bg-slate-200">−</button>
            <span class="min-w-[2rem] text-center font-bold text-slate-700">${item.qty}</span>
            <button type="button" data-receipt-qty="inc" data-index="${idx}" class="w-7 px-1 py-1 text-base font-bold text-slate-600 hover:bg-slate-200">+</button>
          </div>
          <span class="font-bold text-emerald-600">${formatRupiah(item.subtotal)}</span>
          <button type="button" data-receipt-remove="${idx}" class="text-base font-bold text-rose-500 hover:text-rose-700">&times;</button>
        </div>
      `;
      container.appendChild(row);
    });
    grandTotalEl.innerText = formatRupiah(grandTotal);
  }

  document.dispatchEvent(
    new CustomEvent("forecastbiz:receipt-draft-changed", {
      detail: {
        menuIds: [...new Set(state.currentReceiptItems.map((item) => item.menuId))],
      },
    }),
  );
  document.dispatchEvent(
    new CustomEvent("forecastbiz:receipt-lines-changed", {
      detail: {
        menuIds: [...new Set(state.currentReceiptItems.map((item) => item.menuId))],
      },
    }),
  );

  document.querySelectorAll("[data-receipt-qty]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const item = state.currentReceiptItems[index];
      if (!item) return;
      const direction = button.dataset.receiptQty;
      const menu = state.menuCatalog.find((m) => m.id === item.menuId);
      if (!menu) return;
      if (direction === "inc") {
        if (item.qty >= 99) return;
        item.qty += 1;
      } else {
        item.qty -= 1;
      }
      if (item.qty <= 0) {
        state.currentReceiptItems.splice(index, 1);
      } else {
        setReceiptItemPrice(item, menu, getReceiptDate());
      }
      renderReceiptPendingItems();
    });
  });

  document.querySelectorAll("[data-receipt-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.receiptRemove);
      removeItemFromReceipt(index);
    });
  });
}

export function handleReceiptDateChange() {
  const date = getReceiptDate();
  if (state.currentReceiptItems.length) {
    state.currentReceiptItems.forEach((receiptItem) => {
      const menu = state.menuCatalog.find(
        (item) => item.id === receiptItem.menuId,
      );
      if (menu) setReceiptItemPrice(receiptItem, menu, date);
    });
    renderReceiptPendingItems();
    let notice = document.getElementById("receiptPromoDateNotice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "receiptPromoDateNotice";
      notice.className = "text-[11px] text-emerald-700";
      document.getElementById("receiptItemsList").after(notice);
    }
    notice.textContent = `Harga diperbarui sesuai promo pada tanggal ${date}.`;
    notice.classList.remove("hidden");
  }
}

// Merancang rencana pengurangan stok (FEFO: batch yang paling cepat
// kedaluwarsa dipakai lebih dulu) sebelum benar-benar menyimpan ke Supabase.
function buildStockConsumptionPlan() {
  const plan = [];
  const batches = state.rawMaterials.flatMap((material) =>
    (material.batches && material.batches.length
      ? material.batches
      : [
          {
            id: material.id,
            materialId: material.id,
            stok: material.stok,
            harga: material.harga,
            tanggalExpired: material.tanggalExpired,
          },
        ]
    ).map((batch) => ({ ...batch, material })),
  );
  const availableByBatch = new Map(
    batches.map((batch) => [batch.id, batch.stok]),
  );

  for (const receiptItem of state.currentReceiptItems) {
    const menu = state.menuCatalog.find(
      (item) => item.id === receiptItem.menuId,
    );
    if (!menu || !menu.recipes || menu.recipes.length === 0) continue;

    for (const recipe of menu.recipes) {
      const matchingBatches = batches
        .filter(
          (batch) =>
            batch.material.nama.toLowerCase() ===
            recipe.materialName.toLowerCase(),
        )
        .sort(
          (a, b) =>
            new Date(`${a.tanggalExpired}T00:00:00`) -
            new Date(`${b.tanggalExpired}T00:00:00`),
        );

      if (matchingBatches.length === 0)
        return {
          error: `${recipe.materialName} belum terdaftar di bahan baku.`,
        };

      const usableBatches = matchingBatches.filter(
        (batch) => getExpiryStatus(batch.tanggalExpired).status !== "Expired",
      );
      let remaining = recipe.amount * receiptItem.qty;
      for (const batch of usableBatches) {
        const amountInStockUnit = convertRecipeAmountToStock(
          { ...recipe, amount: remaining },
          batch.material,
        );
        if (amountInStockUnit === null) {
          return {
            error: `Satuan resep ${recipe.unit} tidak sesuai dengan stok ${batch.material.nama} (${batch.material.satuan}).`,
          };
        }
        const used = Math.min(
          availableByBatch.get(batch.id) || 0,
          amountInStockUnit,
        );
        if (used > 0) {
          plan.push({ batch, amount: used });
          availableByBatch.set(
            batch.id,
            (availableByBatch.get(batch.id) || 0) - used,
          );
          const unitLower = recipe.unit.toLowerCase();
          const stockLower = batch.material.satuan.toLowerCase();
          remaining -=
            unitLower === "gram" && stockLower === "kg"
              ? used * 1000
              : unitLower === "ml" && stockLower === "liter"
                ? used * 1000
                : used;
        }
        if (remaining <= 0.000001) break;
      }
      if (remaining > 0.000001) {
        return {
          error:
            usableBatches.length === 0 && matchingBatches.some((batch) => batch.stok > 0)
              ? `Stok ${recipe.materialName} yang tersisa sudah kedaluwarsa dan tidak bisa digunakan. Buang batch kedaluwarsa atau tambahkan stok baru.`
              : `Stok layak pakai ${recipe.materialName} tidak cukup untuk ${receiptItem.name} x${receiptItem.qty}.`,
        };
      }
    }
  }
  return { plan };
}

async function applyStockConsumption(plan) {
  const usedByBatch = new Map();
  plan.forEach(({ batch, amount }) =>
    usedByBatch.set(batch.id, {
      batch,
      amount: (usedByBatch.get(batch.id)?.amount || 0) + amount,
    }),
  );
  for (const { batch, amount } of usedByBatch.values()) {
    const newStok = Math.max(0, batch.stok - amount);
    await updateMaterialBatchStock(batch.id, batch.materialId, newStok);
  }
}

function getReceiptTotal() {
  return state.currentReceiptItems.reduce((sum, item) => sum + item.subtotal, 0);
}

function updateCashChange() {
  const total = getReceiptTotal();
  const tendered = Number(document.getElementById("cashTenderedInput").value) || 0;
  const change = Math.max(0, tendered - total);
  const totalEl = document.getElementById("cashPaymentTotal");
  const changeEl = document.getElementById("cashChangeAmount");
  totalEl.textContent = formatRupiah(total);
  changeEl.textContent = formatRupiah(change);
  changeEl.classList.toggle("text-rose-600", tendered < total);
  changeEl.classList.toggle("text-emerald-700", tendered >= total);
  changeEl.classList.toggle("text-slate-800", tendered === 0);
  if (typeof changeEl.animate === "function") {
    changeEl.animate(
      [
        { transform: "scale(0.96)", opacity: 0.65 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 180, easing: "ease-out" },
    );
  }
}

export function closeCashPayment() {
  closeModal("modal-cash-payment");
}

export function initCashierInteractions() {
  if (cashPaymentInitialized) return;
  cashPaymentInitialized = true;

  const amountInput = document.getElementById("cashTenderedInput");
  amountInput.addEventListener("input", updateCashChange);
  document.querySelectorAll("[data-cash-tender]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.cashTender;
      amountInput.value = value === "exact" ? String(getReceiptTotal()) : value;
      updateCashChange();
    });
  });
  document.querySelectorAll("[data-print-width]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-print-width]").forEach((option) => {
        const selected = option === button;
        option.classList.toggle("is-selected", selected);
        option.classList.toggle("border-emerald-300", selected);
        option.classList.toggle("bg-emerald-50", selected);
        option.classList.toggle("text-emerald-800", selected);
        option.classList.toggle("border-slate-200", !selected);
        option.classList.toggle("text-slate-600", !selected);
        option.setAttribute("aria-pressed", String(selected));
      });
    });
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditable =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const paymentModal = document.getElementById("modal-cash-payment");
    const paymentIsOpen = !paymentModal.classList.contains("hidden");
    const cashierIsActive =
      !document.getElementById("tab-cashier").classList.contains("hidden");

    if (event.key === "Escape") {
      const openModals = [...document.querySelectorAll(".fixed.inset-0:not(.hidden)")];
      const topModal = openModals.at(-1);
      if (topModal?.id === "modal-cash-payment") closeCashPayment();
      else if (topModal?.id === "modal-action-confirm") cancelActionConfirmation();
      else if (topModal && topModal.id !== "analyticsPopup") closeModal(topModal.id);
      return;
    }

    if (!cashierIsActive || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const anotherModalIsOpen = [
      ...document.querySelectorAll(".fixed.inset-0:not(.hidden)"),
    ].some((modal) => modal.id !== "modal-cash-payment");
    if (anotherModalIsOpen) return;
    if (event.key === "F2") {
      if (paymentIsOpen) return;
      event.preventDefault();
      document.getElementById("cashierSearchInput").focus();
    } else if (
      event.key === "F9" ||
      (event.code === "Space" && !isEditable)
    ) {
      event.preventDefault();
      if (paymentIsOpen) confirmReceiptPayment();
      else requestReceiptSave();
    }
  });
}

export function requestReceiptSave() {
  if (!state.currentReceiptItems.length) {
    showToast("Tambahkan minimal satu item ke struk sebelum membayar.", "warn");
    return;
  }
  document.getElementById("cashPaymentError").classList.add("hidden");
  document.getElementById("cashTenderedInput").value = "";
  updateCashChange();
  openModal("modal-cash-payment");
  document.getElementById("cashTenderedInput").focus();
}

export function confirmReceiptPayment() {
  const total = getReceiptTotal();
  const tendered = Number(document.getElementById("cashTenderedInput").value);
  const errorEl = document.getElementById("cashPaymentError");
  if (!Number.isFinite(tendered) || tendered < total) {
    errorEl.textContent = "Uang yang diterima harus sama dengan atau lebih besar dari total.";
    errorEl.classList.remove("hidden");
    document.getElementById("cashTenderedInput").focus();
    return;
  }
  closeCashPayment();
  requestReceiptConfirmation(tendered);
}

function requestReceiptConfirmation(tendered) {
  const total = state.currentReceiptItems.reduce(
    (sum, item) => sum + item.subtotal,
    0,
  );
  const itemSummary = state.currentReceiptItems.length
    ? state.currentReceiptItems
        .map((item) => `${escapeHtml(item.name)} x${item.qty}`)
        .join(", ")
    : "Belum ada item";
  openActionConfirmation(
    "Verifikasi Simpan Transaksi",
    "Periksa kembali struk sebelum disimpan.",
    `<b>Isi struk:</b> ${itemSummary}<br/><b>Total:</b> ${formatRupiah(total)}<br/><b>Uang diterima:</b> ${formatRupiah(tendered)}<br/><b>Kembalian:</b> ${formatRupiah(tendered - total)}<br/><span class="text-amber-700">Stok bahan dan rekap penjualan akan diperbarui di Supabase.</span>`,
    () => submitCompleteReceipt(tendered),
  );
}

async function submitCompleteReceipt(tendered) {
  if (state.currentReceiptItems.length === 0) {
    showToast("Tambahkan minimal satu item ke struk sebelum menyimpan.", "warn");
    return;
  }

  const consumption = buildStockConsumptionPlan();
  if (consumption.error) {
    showToast(`Transaksi belum disimpan: ${consumption.error}`, "error");
    return;
  }

  const receiptTotal = state.currentReceiptItems.reduce(
    (sum, item) => sum + item.subtotal,
    0,
  );
  const receiptProfit = state.currentReceiptItems.reduce(
    (sum, item) => sum + item.profit,
    0,
  );

  let receiptSaved = false;
  let stockError = null;
  const savedItems = state.currentReceiptItems.map((item) => ({ ...item }));
  try {
    const existingCount = await countExistingReceipts();
    const receiptNo = "#TRX-" + (100 + existingCount + 1);
    const timeStr = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const tanggal =
      document.getElementById("receiptDate").value ||
      todayLocal();

    await insertReceipt({
      receiptNo,
      tanggal,
      waktu: timeStr,
      total: receiptTotal,
      profit: receiptProfit,
      items: state.currentReceiptItems,
    });
    receiptSaved = true;
    playCashierTone(true);
    lastSavedReceipt = {
      receiptNo,
      tanggal,
      waktu: timeStr,
      total: receiptTotal,
      tendered,
      change: tendered - receiptTotal,
      items: savedItems,
    };
    state.currentReceiptItems = [];
    renderReceiptPendingItems();

    try {
      await applyStockConsumption(consumption.plan);
    } catch (error) {
      stockError = error;
      console.error("Struk tersimpan, tetapi stok gagal diperbarui:", error);
    }

    await Promise.all([reloadReceipts(), reloadRawMaterials()]);
    renderReceiptHistoryList();
    renderRawMaterialsTable();
    renderFefoTable();
    document.dispatchEvent(new CustomEvent("forecastbiz:receipt-saved"));

    showToast(
      stockError
        ? `Struk ${receiptNo} tersimpan, tetapi stok gagal diperbarui: ${getErrorMessage(stockError)} Sesuaikan stok secara manual.`
        : `Struk ${receiptNo} berhasil disimpan · ${formatRupiah(receiptTotal)}`,
      stockError ? "warn" : "success",
      {
        actionLabel: "Cetak struk",
        onAction: () => printReceipt(lastSavedReceipt),
        duration: 7000,
      },
    );
  } catch (error) {
    console.error("Gagal menyimpan struk kasir:", error);
    showToast(
      receiptSaved
        ? `Struk tersimpan, tetapi data terbaru gagal dimuat. Muat ulang halaman sebelum melanjutkan. ${getErrorMessage(error)}`
        : `Struk gagal disimpan. Periksa koneksi Supabase lalu coba lagi. ${getErrorMessage(error)}`,
      "error",
      receiptSaved
        ? {
            actionLabel: "Cetak struk",
            onAction: () => printReceipt(lastSavedReceipt),
            duration: 7000,
          }
        : undefined,
    );
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function printReceipt(receipt) {
  if (!receipt) return;
  let printArea = document.getElementById("receiptPrintArea");
  if (!printArea) {
    printArea = document.createElement("section");
    printArea.id = "receiptPrintArea";
    printArea.className = "receipt-print-area";
    document.body.appendChild(printArea);
  }
  const width = document.querySelector("[data-print-width].is-selected")?.dataset.printWidth || "58";
  printArea.style.setProperty("--receipt-width", `${width}mm`);
  printArea.innerHTML = `
    <header class="receipt-print-header">
      <strong>Warung F&amp;B Berkah</strong>
      <span>ForecastBiz AI</span>
      <span>${escapeHtml(receipt.tanggal)} · ${escapeHtml(receipt.waktu)}</span>
      <span>${escapeHtml(receipt.receiptNo)}</span>
    </header>
    <div class="receipt-print-items">
      ${receipt.items.map((item) => `
        <div class="receipt-print-item">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <span>${formatRupiah(item.subtotal)}</span>
        </div>
      `).join("")}
    </div>
    <div class="receipt-print-totals">
      <div><span>Total</span><strong>${formatRupiah(receipt.total)}</strong></div>
      <div><span>Tunai</span><span>${formatRupiah(receipt.tendered)}</span></div>
      <div><span>Kembali</span><span>${formatRupiah(receipt.change)}</span></div>
    </div>
    <p class="receipt-print-thanks">Terima kasih. Selamat menikmati!</p>
  `;
  window.print();
}

export function renderReceiptHistoryList() {
  const tbody = document.getElementById("receiptHistoryTableBody");
  tbody.innerHTML = "";

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysReceipts = state.receiptHistory.filter(
    (r) => r.date === todayStr,
  );

  if (todaysReceipts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Belum ada struk tersimpan hari ini.</td></tr>`;
    return;
  }

  todaysReceipts.forEach((r) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 font-bold text-slate-700">${r.no}</td>
        <td class="p-3 text-slate-500">${r.time}</td>
        <td class="p-3 text-slate-800">${r.rincian}</td>
        <td class="p-3 text-right font-bold text-emerald-600">${formatRupiah(r.total)}</td>
      </tr>`;
  });
}
