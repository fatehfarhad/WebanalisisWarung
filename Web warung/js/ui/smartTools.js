import { state, reloadRawMaterials } from "../state.js";
import { updateRawMaterial } from "../db.js";
import { formatRupiah, convertRecipeAmountToStock } from "../utils.js";
import { renderRawMaterialsTable } from "./materials.js";

export function calculateWeeklyMaterialUsage(materialId) {
  const material = state.rawMaterials.find((item) => item.id === materialId);
  if (!material) return 0;

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  return state.receiptHistory.reduce((total, receipt) => {
    const receiptDate = new Date(`${receipt.date}T00:00:00`);
    if (receiptDate < sevenDaysAgo || receiptDate > today || !receipt.items) return total;
    return (
      total +
      receipt.items.reduce((receiptTotal, soldItem) => {
        const menu = state.menuCatalog.find((item) => item.id === soldItem.menuId);
        if (!menu) return receiptTotal;
        return (
          receiptTotal +
          (menu.recipes || []).reduce((recipeTotal, recipe) => {
            if (recipe.materialName.toLowerCase() !== material.nama.toLowerCase()) return recipeTotal;
            const amount = convertRecipeAmountToStock(recipe, material);
            return amount === null ? recipeTotal : recipeTotal + amount * soldItem.qty;
          }, 0)
        );
      }, 0)
    );
  }, 0);
}

// ---------------- ROP ----------------
export function updateROPDemandInput() {
  const materialId = document.getElementById("ropMaterialSelect").value;
  const mode = document.getElementById("ropDemandMode").value;
  const input = document.getElementById("ropWeeklyDemand");
  const source = document.getElementById("ropDemandSource");
  const material = state.rawMaterials.find((item) => item.id === materialId);

  if (mode === "auto") {
    const automaticUsage = calculateWeeklyMaterialUsage(materialId);
    input.value = automaticUsage;
    input.readOnly = true;
    input.classList.add("bg-slate-100");
    source.innerText = automaticUsage > 0
      ? `Otomatis: ${automaticUsage} ${material ? material.satuan : "unit"} terpakai dalam 7 hari terakhir.`
      : "Belum ada penjualan 7 hari terakhir; gunakan mode manual untuk memasukkan estimasi.";
  } else {
    input.readOnly = false;
    input.classList.remove("bg-slate-100");
    source.innerText = "Manual: angka ini akan digunakan sebagai override data otomatis.";
  }
}

export async function calculateROP() {
  const matId = document.getElementById("ropMaterialSelect").value;
  const leadTime = parseFloat(document.getElementById("ropLeadTime").value) || 0;
  const weeklyDemand = parseFloat(document.getElementById("ropWeeklyDemand").value) || 0;

  const dailyDemand = weeklyDemand / 7;
  const safetyStock = Math.round(dailyDemand * 1);
  const rop = Math.round(dailyDemand * leadTime + safetyStock);

  const mat = state.rawMaterials.find((rm) => rm.id === matId);
  if (mat) {
    await updateRawMaterial(mat.id, { ...mat, batasROP: rop }, false, "");
    await reloadRawMaterials();
    renderRawMaterialsTable();
  }

  const resDiv = document.getElementById("ropResult");
  resDiv.classList.remove("hidden");
  resDiv.innerHTML = `
    <b>Hasil Perhitungan ROP (${mat ? mat.nama : ""}):</b><br/>
    • Safety Stock (Pengaman): <b>${safetyStock} ${mat ? mat.satuan : ""}</b><br/>
    • Reorder Point (Titik Pesan Lagi): <b>${rop} ${mat ? mat.satuan : ""}</b><br/>
    <i>Data ROP di tabel persediaan bahan baku (Supabase) telah diperbarui otomatis!</i>`;
}

// ---------------- EOQ ----------------
export function updateEOQInputs() {
  const materialId = document.getElementById("eoqMaterialSelect").value;
  const material = state.rawMaterials.find((item) => item.id === materialId);
  const usageInput = document.getElementById("eoqDailyUsage");
  const priceInput = document.getElementById("eoqMaterialPrice");
  const usageSource = document.getElementById("eoqUsageSource");
  const priceSource = document.getElementById("eoqPriceSource");
  if (!material) return;

  document.getElementById("eoqShelfLife").value = material.dayaTahanHari || 3;

  const usageMode = document.getElementById("eoqUsageMode").value;
  if (usageMode === "auto") {
    const weeklyUsage = calculateWeeklyMaterialUsage(materialId);
    usageInput.value = (weeklyUsage / 7).toFixed(2);
    usageInput.readOnly = true;
    usageInput.classList.add("bg-slate-100");
    usageSource.innerText = weeklyUsage > 0
      ? `Otomatis: rata-rata ${(weeklyUsage / 7).toFixed(2)} ${material.satuan}/hari dari penjualan 7 hari.`
      : "Belum ada penjualan 7 hari terakhir; gunakan mode manual untuk estimasi.";
  } else {
    usageInput.readOnly = false;
    usageInput.classList.remove("bg-slate-100");
    usageSource.innerText = "Manual: angka ini menjadi override data otomatis.";
  }

  const priceMode = document.getElementById("eoqPriceMode").value;
  if (priceMode === "auto") {
    priceInput.value = material.harga;
    priceInput.readOnly = true;
    priceInput.classList.add("bg-slate-100");
    priceSource.innerText = `Otomatis: harga ${material.nama} dari data bahan baku.`;
  } else {
    priceInput.readOnly = false;
    priceInput.classList.remove("bg-slate-100");
    priceSource.innerText = "Manual: harga ini menjadi override harga bahan baku.";
  }
}

export function calcEOQ() {
  const dailyUsage = parseFloat(document.getElementById("eoqDailyUsage").value) || 0;
  const price = parseFloat(document.getElementById("eoqMaterialPrice").value) || 0;
  const distance = parseFloat(document.getElementById("eoqDistance").value) || 0;
  const transportRate = parseFloat(document.getElementById("eoqTransportRate").value) || 0;
  const shelfLife = parseFloat(document.getElementById("eoqShelfLife").value) || 0;

  if (dailyUsage <= 0 || price <= 0) {
    alert("Mohon masukkan penggunaan harian dan harga bahan baku!");
    return;
  }

  const D = dailyUsage * 30;
  const S = distance * 2 * transportRate + 5000;
  const H = price * 0.05;

  const rawEOQ = Math.sqrt((2 * D * S) / H);
  const rawDays = rawEOQ / dailyUsage;
  const maxFreshQty = dailyUsage * shelfLife;

  let isCapped = false;
  let finalEOQ = rawEOQ;
  if (shelfLife > 0 && rawEOQ > maxFreshQty) {
    finalEOQ = maxFreshQty;
    isCapped = true;
  }
  finalEOQ = Math.round(finalEOQ);
  const daysInterval = Math.max(1, Math.round(finalEOQ / dailyUsage));
  const frequencyPerMonth = Math.round(30 / daysInterval);

  document.getElementById("eoqResultBox").classList.remove("hidden");
  document.getElementById("eoqRecommendedQty").innerText = `${finalEOQ} Unit / Pesanan`;
  document.getElementById("eoqFrequencyText").innerText =
    `Frekuensi Belanja: ${daysInterval} Hari Sekali (~${frequencyPerMonth}x dalam sebulan)`;

  const alertBox = document.getElementById("eoqFreshnessAlert");
  if (isCapped) {
    alertBox.classList.remove("hidden");
    alertBox.innerHTML = `⚠️ <b>Proteksi Kesegaran Aktif:</b> Hitungan matematika awal menyarankan <b>${Math.round(rawEOQ)} unit</b> (${Math.round(rawDays)} hari sekali). Namun disesuaikan menjadi <b>${finalEOQ} unit (${shelfLife} hari sekali)</b> agar bahan baku tidak busuk/basi.`;
  } else {
    alertBox.classList.add("hidden");
  }
}
