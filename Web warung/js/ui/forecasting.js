import { state, getSalesByMenu } from "../state.js";
import {
  formatRupiah,
  convertRecipeAmountToStock,
  getPriceTrend,
  getExpiryStatus,
} from "../utils.js";
import { calculateExpiredLoss } from "./materials.js";

export function getRecipeCost(menu) {
  return (menu.recipes || []).reduce((total, recipe) => {
    const material = state.rawMaterials.find(
      (item) => item.nama.toLowerCase() === recipe.materialName.toLowerCase(),
    );
    if (!material) return total;
    const amount = convertRecipeAmountToStock(recipe, material);
    return amount === null ? total : total + amount * material.harga;
  }, 0);
}

function getWarningBatch(material) {
  const batches =
    material.batches && material.batches.length
      ? material.batches
      : [
          {
            stok: material.stok,
            harga: material.harga,
            tanggalExpired: material.tanggalExpired,
          },
        ];
  return batches
    .filter((batch) => batch.stok > 0)
    .sort(
      (a, b) =>
        new Date(`${a.tanggalExpired}T00:00:00`) -
        new Date(`${b.tanggalExpired}T00:00:00`),
    )
    .find(
      (batch) => getExpiryStatus(batch.tanggalExpired).status === "Warning",
    );
}

export function renderAiRecommendations() {
  const summary = document.getElementById("aiRecommendationSummary");
  const list = document.getElementById("aiRecommendationList");
  if (!summary || !list) return;

  const sales = getSalesByMenu();
  const ranked = [...state.menuCatalog].sort(
    (a, b) => (sales.get(b.id) || 0) - (sales.get(a.id) || 0),
  );
  const topMenu = ranked.find((menu) => (sales.get(menu.id) || 0) > 0);
  const expiredLoss = calculateExpiredLoss();

  summary.innerHTML = `
    <div class="p-3 rounded-xl bg-rose-50 border border-rose-200"><span class="block text-[10px] uppercase font-bold text-rose-500">Kerugian Expired</span><b class="text-lg text-rose-700">${formatRupiah(expiredLoss)}</b></div>
    <div class="p-3 rounded-xl bg-blue-50 border border-blue-200"><span class="block text-[10px] uppercase font-bold text-blue-500">Menu Terlaris</span><b class="text-lg text-blue-700">${topMenu ? `${topMenu.name} (${sales.get(topMenu.id)}x)` : "Belum ada transaksi"}</b></div>`;

  const recommendations = [];

  const warningEntry = state.rawMaterials
    .map((material) => ({ material, batch: getWarningBatch(material) }))
    .find((entry) => entry.batch);
  if (warningEntry) {
    const warningMaterial = warningEntry.material;
    const expiry = getExpiryStatus(warningEntry.batch.tanggalExpired);
    recommendations.push(`
      <div class="p-4 rounded-xl bg-amber-50 border border-amber-200">
        <b class="text-amber-800">FEFO Emergency: ${warningMaterial.nama}</b>
        <p class="text-xs text-slate-700 mt-1">Stok ${warningMaterial.stok} ${warningMaterial.satuan} akan kedaluwarsa dalam ${expiry.sisaHari} hari. Prioritaskan menu yang memakai bahan ini.</p>
      </div>`);
  }

  if (!recommendations.length) {
    recommendations.push(
      `<div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">Belum ada rekomendasi otomatis. Gunakan Simulasi Promo di atas untuk menilai rencana promo Anda.</div>`,
    );
  }

  list.innerHTML = recommendations.join("");
}

export function askAiAdvisor() {
  const question = document.getElementById("aiQuestion").value.trim();
  const answerBox = document.getElementById("aiConsultationAnswer");
  const warningEntry = state.rawMaterials
    .map((material) => ({ material, batch: getWarningBatch(material) }))
    .find((entry) => entry.batch);
  const warningMaterial = warningEntry?.material;
  const priceDrop = state.rawMaterials.find(
    (material) => getPriceTrend(material) === "turun",
  );

  if (!question) {
    answerBox.innerText =
      "Tuliskan pertanyaan tentang promo, stok, penjualan, atau keuntungan terlebih dahulu.";
  } else if (/promo|diskon|promosikan|jual/i.test(question)) {
    answerBox.innerText =
      "Untuk menilai promo, pakai Simulasi Promo di atas: pilih menu dan besar diskon, lalu lihat penjualan harus naik berapa persen supaya total untung tidak turun.";
  } else if (
    /expired|kadaluwarsa|basi|stok/i.test(question) &&
    warningMaterial
  ) {
    const expiry = getExpiryStatus(warningEntry.batch.tanggalExpired);
    answerBox.innerText =
      `Bahan ${warningMaterial.nama} (${warningEntry.batch.stok} ${warningMaterial.satuan}) ` +
      `akan kedaluwarsa dalam ${expiry.sisaHari} hari. Pakai bahan ini lebih dulu sebelum bahan lain.`;
  } else if (/harga|murah|bahan/i.test(question) && priceDrop) {
    answerBox.innerText =
      `Harga ${priceDrop.nama} sedang turun dari catatan terakhir. Perbarui HPP menu yang memakai bahan ini di Katalog Menu supaya perhitungan untung tetap akurat.`;
  } else {
    answerBox.innerText =
      `Kerugian bahan kedaluwarsa saat ini ${formatRupiah(calculateExpiredLoss())}. Gunakan Simulasi Promo dan peringatan di atas sebagai acuan.`;
  }
  answerBox.classList.remove("hidden");
}
