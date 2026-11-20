import { fetchReceiptsSince } from "../db.js";
import { state } from "../state.js";
import { addDays, listPromoDays, todayLocal } from "../promoEval.js";
import {
  MAKS_SISA_HARI,
  perluPromo,
  validasiHarga,
  zonaDiskon,
} from "../fefoPromo.js";
import { convertRecipeAmountToStock, formatRupiah, formatQuantity } from "../utils.js";
import { closeModal, openModal } from "./modals.js";
import { openPromotionForm } from "./promos.js";

function findTargetBatch(material) {
  const batches = (material?.batches || []).filter((batch) => Number(batch.stok) > 0);
  if (!batches.length) return null;
  return [...batches].sort((a, b) => {
    const aDate = new Date(`${a.tanggalExpired || a.tanggal_expired || a.expiry || "9999-12-31"}T00:00:00`);
    const bDate = new Date(`${b.tanggalExpired || b.tanggal_expired || b.expiry || "9999-12-31"}T00:00:00`);
    return aDate - bDate;
  })[0];
}

function getRecipeAmount(menu, material) {
  const recipe = (menu.recipes || []).find((candidate) => {
    const materialName = String(candidate.materialName || "").trim().toLowerCase();
    const targetName = String(material?.nama || "").trim().toLowerCase();
    return materialName === targetName;
  });
  if (!recipe) return null;
  return convertRecipeAmountToStock(recipe, material);
}

async function buildMenuCandidates(material, batch) {
  const todayStr = todayLocal();
  const receipts = await fetchReceiptsSince(addDays(todayStr, -56));
  const salesByMenu = new Map();

  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (!item.menuId) continue;
      const menuId = String(item.menuId);
      const date = receipt.date;
      const existing = salesByMenu.get(menuId) || {};
      existing[date] = (existing[date] || 0) + Number(item.qty || 0);
      salesByMenu.set(menuId, existing);
    }
  }

  const candidates = [];
  for (const menu of state.menuCatalog.filter((item) => item.active)) {
    const amount = getRecipeAmount(menu, material);
    if (!amount) continue;
    const history = Array.from(new Set(Object.keys(salesByMenu.get(menu.id) || {}))).sort();
    const baseTotal = history.reduce((sum, date) => sum + Number(salesByMenu.get(menu.id)?.[date] || 0), 0);
    const baseAverage = history.length ? baseTotal / history.length : 0;
    const daysLeft = Math.max(1, Math.min(MAKS_SISA_HARI, Math.max(0, Math.ceil((new Date(`${batch.tanggalExpired}T00:00:00`) - new Date(`${todayStr}T00:00:00`)) / 86400000))));
    const projected = Math.max(0, baseAverage * daysLeft);
    const stockValue = Number(batch.stok) * Number(batch.harga || material.harga || 0);
    const sisaPorsi = stockValue > 0 && Number(menu.price) > 0 ? (Number(batch.stok) / amount) : 0;
    const uGoal = projected > 0 && sisaPorsi > 0 ? Math.max(0, (sisaPorsi / projected) - 1) * 100 : null;
    const untungPerPorsi = Number(menu.price || 0) - (Number(menu.cost || 0) + Number(menu.other_cost || 0));
    if (projected > 0 || sisaPorsi > 0) {
      candidates.push({
        menu,
        amount,
        baseTotal: Number(projected.toFixed(1)),
        sisaPorsi: Number(sisaPorsi.toFixed(1)),
        uGoal: uGoal == null ? null : Number(uGoal.toFixed(1)),
        untungPerPorsi,
        discountPct: 10,
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.baseTotal > 0 || candidate.sisaPorsi > 0)
    .sort((a, b) => {
      const aValue = a.uGoal == null ? Number.MAX_SAFE_INTEGER : a.uGoal;
      const bValue = b.uGoal == null ? Number.MAX_SAFE_INTEGER : b.uGoal;
      if (aValue !== bValue) return aValue - bValue;
      return Number(b.untungPerPorsi || 0) - Number(a.untungPerPorsi || 0);
    })
    .slice(0, 3);
}

function renderCandidateCards(candidates, selectedIndex = 0) {
  const panel = document.getElementById("fefoPromoCandidateList");
  if (!panel) return;
  if (!candidates.length) {
    panel.innerHTML = '<p class="text-sm text-slate-500">Belum ada menu yang memenuhi syarat untuk promo habiskan stok.</p>';
    return;
  }

  panel.innerHTML = candidates
    .map((candidate, index) => `
      <label class="block cursor-pointer rounded-2xl border ${index === selectedIndex ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"} p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2">
            <input type="radio" name="fefoPromoCandidate" value="${index}" ${index === selectedIndex ? "checked" : ""} class="mt-1 accent-amber-500" />
            <div>
              <div class="text-sm font-bold text-slate-800">${candidate.menu.name}</div>
              <div class="text-xs text-slate-500">1 porsi = ${formatQuantity(candidate.amount)} ${candidate.menu.recipes?.[0]?.unit || "satuan"}</div>
            </div>
          </div>
          <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">${candidate.uGoal == null ? "sisa sulit" : `naik ${candidate.uGoal.toFixed(1)}%`}</span>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs text-slate-600">
          <span>Perkiraan laku ${candidate.baseTotal.toFixed(1)} porsi</span>
          <span>Untung <s>${formatRupiah(candidate.untungPerPorsi)}</s> → <strong id="fefoPromoProfit${index}">${formatRupiah(candidate.menu.price * (1 - candidate.discountPct / 100) - (Number(candidate.menu.price) - candidate.untungPerPorsi))}</strong></span>
        </div>
      </label>
    `)
    .join("");
}

function configureDiscountInputs(candidate, selectedIndex) {
  const discountInput = document.getElementById("fefoPromoDiscountInput");
  const priceInput = document.getElementById("fefoPromoPriceInput");
  const normal = Number(candidate.menu.price);
  const discount = Number(candidate.discountPct || 10);
  const price = normal * (1 - discount / 100);

  discountInput.value = String(discount);
  priceInput.value = String(price);
  priceInput.step = "any";

  const updateValidation = () => {
    const promo = Number(priceInput.value);
    const validation = validasiHarga({
      normal,
      promo,
      biayaTotal: Number(candidate.menu.cost || 0) + Number(candidate.menu.other_cost || 0),
      pctDiketik: Number(discountInput.value),
    });
    const validationText = document.getElementById("fefoPromoValidation");
    validationText.textContent = validation.ok
      ? `Zona ${zonaDiskon(normal, promo)} • Harga aman.`
      : validation.alasan === "diskon_terlalu_kecil"
        ? "Diskon harus membuat harga lebih rendah dari harga normal."
        : validation.alasan === "melebihi_batas"
          ? "Diskon maksimal 20% (harga Rp80% dari normal)."
          : validation.alasan === "di_bawah_modal"
            ? "Harga promo harus di atas modal agar tiap porsi tetap untung."
            : "Harga promo belum valid.";
    document.getElementById("fefoPromoStartButton").disabled = !validation.ok;
    const profitElement = document.getElementById(`fefoPromoProfit${selectedIndex}`);
    if (profitElement) {
      const totalCost = Number(candidate.menu.price) - candidate.untungPerPorsi;
      profitElement.textContent = formatRupiah(promo - totalCost);
    }
  };

  const updateFromDiscount = () => {
    const entered = Number(discountInput.value) || 0;
    const rounded = Math.min(20, Math.max(0, entered));
    const nextPrice = normal * (1 - rounded / 100);
    priceInput.value = String(nextPrice);
    discountInput.value = String(rounded);
    updateValidation();
  };

  const updateFromPrice = () => {
    const entered = Number(priceInput.value) || normal;
    const computed = Math.min(20, Math.max(0, ((normal - entered) / normal) * 100));
    discountInput.value = computed.toFixed(1);
    updateValidation();
  };

  discountInput.oninput = updateFromDiscount;
  priceInput.oninput = updateFromPrice;
  updateValidation();
}

export async function openFefoPromoModal(materialId) {
  const material = state.rawMaterials.find((item) => item.id === materialId);
  if (!material) return;

  const targetBatch = findTargetBatch(material);
  if (!targetBatch) return;

  let candidates = [];
  try {
    candidates = await buildMenuCandidates(material, targetBatch);
  } catch (error) {
    console.warn("Gagal membuat perkiraan promo FEFO:", error);
  }

  const content = document.getElementById("fefoPromoContent");
  let selectedIndex = 0;
  let candidate = candidates[selectedIndex] || null;

  const sisaHariValue = Math.max(0, Math.ceil((new Date(`${targetBatch.tanggalExpired}T00:00:00`) - new Date(`${todayLocal()}T00:00:00`)) / 86400000));
  const warningText = sisaHariValue <= 1 ? '<p class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Waktu promo tinggal hari ini.</p>' : "";
  const promoValue = Number(targetBatch.stok) * Number(targetBatch.harga || material.harga || 0);
  const summary = candidate && perluPromo({ sisaPorsi: candidate.sisaPorsi, nilaiA: Number(targetBatch.stok) * Number(targetBatch.harga || material.harga || 0) })
    ? `<div id="fefoPromoSummary" class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Promo layak dibuat: sisa bahan masih bernilai sekitar ${formatRupiah(promoValue)}.</div>`
    : `<div id="fefoPromoSummary" class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Stok kemungkinan habis sendiri sebelum tanggal kadaluwarsa. Cek lagi besok.</div>`;

  content.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <h3 class="text-xl font-bold text-slate-800">Promo Habiskan Stok: ${material.nama}</h3>
          <p class="text-sm text-slate-500">${formatQuantity(targetBatch.stok)} ${material.satuan} • ${formatRupiah(Number(targetBatch.stok) * Number(targetBatch.harga || material.harga || 0))} • kedaluwarsa ${targetBatch.tanggalExpired} (${sisaHariValue} hari)</p>
        </div>
        <button type="button" onclick="closeModal('modal-fefo-promo')" class="text-xl font-bold text-slate-400 hover:text-slate-600">&times;</button>
      </div>
      ${warningText}
      ${summary}
      <div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div class="space-y-3">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div class="text-xs font-bold uppercase tracking-wide text-slate-500">Perkiraan tanpa promo</div>
            <div class="mt-2 text-sm text-slate-700">
              <p id="fefoPromoEstimate">Tanpa promo, perkiraan sampai ${targetBatch.tanggalExpired}: ${(candidate?.baseTotal || 0).toFixed(1)} porsi menu ${candidate?.menu?.name || "terkait"} terjual.</p>
              <p class="mt-2">Sisa yang akan terbuang: ${formatQuantity(targetBatch.stok)} ${material.satuan}, senilai sekitar ${formatRupiah(Number(targetBatch.stok) * Number(targetBatch.harga || material.harga || 0))}.</p>
            </div>
          </div>
          <div>
            <div class="mb-2 text-sm font-bold text-slate-700">Pilih menu</div>
            <div id="fefoPromoCandidateList" class="space-y-2"></div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
          <div class="text-sm font-bold text-slate-700">Atur promo</div>
          <label class="block text-xs font-semibold text-slate-600">
            Diskon (%)
            <input id="fefoPromoDiscountInput" type="number" min="0" max="20" step="0.1" class="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" />
          </label>
          <label class="block text-xs font-semibold text-slate-600">
            Harga promo (Rp)
            <input id="fefoPromoPriceInput" type="number" min="1" step="500" class="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" />
          </label>
          <div id="fefoPromoValidation" class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"></div>
          <div class="flex gap-2">
            <button type="button" onclick="closeModal('modal-fefo-promo')" class="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600">Tutup</button>
            <button type="button" id="fefoPromoStartButton" class="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Mulai Promo</button>
          </div>
        </div>
      </div>
    </div>
  `;

  renderCandidateCards(candidates, selectedIndex);
  if (candidate) {
    configureDiscountInputs(candidate, selectedIndex);
    const promoButton = document.getElementById("fefoPromoStartButton");
    document.getElementById("fefoPromoCandidateList").addEventListener("change", (event) => {
      if (event.target.name !== "fefoPromoCandidate") return;
      selectedIndex = Number(event.target.value);
      candidate = candidates[selectedIndex];
      renderCandidateCards(candidates, selectedIndex);
      configureDiscountInputs(candidate, selectedIndex);
      document.getElementById("fefoPromoEstimate").textContent =
        `Tanpa promo, perkiraan sampai ${targetBatch.tanggalExpired}: ${candidate.baseTotal.toFixed(1)} porsi menu ${candidate.menu.name} terjual.`;
      const summaryElement = document.getElementById("fefoPromoSummary");
      const promoIsRecommended = perluPromo({ sisaPorsi: candidate.sisaPorsi, nilaiA: promoValue });
      summaryElement.className = promoIsRecommended
        ? "rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        : "rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700";
      summaryElement.textContent = promoIsRecommended
        ? `Promo layak dibuat: sisa bahan masih bernilai sekitar ${formatRupiah(promoValue)}.`
        : "Stok kemungkinan habis sendiri sebelum tanggal kadaluwarsa. Cek lagi besok.";
    });
    promoButton.onclick = () => {
      const selectedMenu = candidate.menu;
      const priceValue = Number(document.getElementById("fefoPromoPriceInput").value) || Number(selectedMenu.price);
      openPromotionForm(selectedMenu.id, priceValue, null);
      closeModal("modal-fefo-promo");
    };
  }

  openModal("modal-fefo-promo");
}

if (typeof window !== "undefined") {
  window.openFefoPromoModal = openFefoPromoModal;
}
