import {
  state,
  reloadRawMaterials,
  reloadMaterialBatchDisposedLoss,
  reloadMaterialBatchDisposals,
} from "../state.js";
import {
  insertRawMaterial,
  updateRawMaterial,
  addMaterialBatch,
  correctMaterialBatchExpiry,
  fetchMaterialBatchExpiryHistory,
  disposeExpiredMaterialBatch,
  deleteRawMaterial,
} from "../db.js";
import {
  formatRupiah,
  formatQuantity,
  formatDateDisplay,
  getExpiryStatus,
  toInputDate,
} from "../utils.js";
import { openModal, closeModal, openActionConfirmation } from "./modals.js";

let materialPriceChartInstance = null;
let pendingExpiryCorrection = null;
let pendingExpiredBatchDisposal = null;

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

function getMaterialBatches(material) {
  return material.batches && material.batches.length
    ? material.batches
    : [
        {
          id: material.id,
          materialId: material.id,
          stok: material.stok,
          harga: material.harga,
          tanggalInput: material.tanggalInput,
          tanggalExpired: material.tanggalExpired,
        },
      ];
}

function getEarliestBatch(material) {
  const stockedBatches = getMaterialBatches(material).filter(
    (batch) => Number(batch.stok) > 0,
  );
  return [
    ...(stockedBatches.length ? stockedBatches : getMaterialBatches(material)),
  ].sort(
    (a, b) =>
      new Date(`${a.tanggalExpired}T00:00:00`) -
      new Date(`${b.tanggalExpired}T00:00:00`),
  )[0];
}

function getExpiryHighlight(materialBatches) {
  const statuses = materialBatches.map((batch) =>
    getExpiryStatus(batch.tanggalExpired),
  );
  if (statuses.some((expiry) => expiry.status === "Expired")) {
    return {
      rowClasses: "bg-rose-100 hover:bg-rose-200",
      badgeClasses: "bg-rose-200 text-rose-800",
      label: "Ada batch kedaluwarsa",
    };
  }
  if (statuses.some((expiry) => expiry.status === "Warning")) {
    return {
      rowClasses: "bg-amber-100 hover:bg-amber-200",
      badgeClasses: "bg-amber-200 text-amber-900",
      label: "Mendekati kedaluwarsa",
    };
  }
  return null;
}

export function calculateUsableMaterialStock(material) {
  return getMaterialBatches(material).reduce(
  (total, batch) =>
    total +
      (getExpiryStatus(batch.tanggalExpired).status === "Expired"
        ? 0
        : Number(batch.stok) || 0),
    0,
  );
}

export function calculateProcurementEstimate() {
  return state.rawMaterials.reduce((total, material) => {
    const recommendQty = Math.max(
      0,
      material.batasROP * 2 - calculateUsableMaterialStock(material),
    );
    return total + recommendQty * material.harga;
  }, 0);
}

export function renderRawMaterialsTable() {
  const tbody = document.getElementById("rawMaterialsTableBody");
  if (!tbody.dataset.expiryDetailsBound) {
    tbody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-material-expiry-details]");
      if (!(button instanceof HTMLButtonElement)) return;
      openMaterialBatchExpiryDetails(button.dataset.materialExpiryDetails);
    });
    tbody.dataset.expiryDetailsBound = "true";
  }
  tbody.innerHTML = "";

  if (state.rawMaterials.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="p-8 text-center text-slate-400 italic">Belum ada bahan baku. Tambahkan bahan baru untuk mulai mengelola persediaan.</td></tr>';
  }

  [...state.rawMaterials]
    .sort(
      (a, b) =>
        new Date(`${getEarliestBatch(a).tanggalExpired}T00:00:00`) -
        new Date(`${getEarliestBatch(b).tanggalExpired}T00:00:00`),
    )
    .forEach((rm) => {
      const usableStock = calculateUsableMaterialStock(rm);
      const recommendQty = Math.max(0, rm.batasROP * 2 - usableStock);
      const subtotalCost = recommendQty * rm.harga;

      const materialBatches = getMaterialBatches(rm)
        .filter((batch) => Number(batch.stok) > 0)
        .sort(
          (a, b) =>
            new Date(`${a.tanggalExpired}T00:00:00`) -
            new Date(`${b.tanggalExpired}T00:00:00`),
        );
      const expiryHighlight = getExpiryHighlight(materialBatches);
      const earliestBatch = getEarliestBatch(rm);
      const expiry = getExpiryStatus(earliestBatch.tanggalExpired);
      const shelfLife = Math.max(1, Number(rm.dayaTahanHari) || expiry.sisaHari || 1);
      const remainingPercent = Math.min(
        100,
        Math.max(0, (expiry.sisaHari / shelfLife) * 100),
      );
      const expiryColor =
        expiry.status === "Expired" || remainingPercent <= 25
          ? "bg-rose-500"
          : remainingPercent <= 60
            ? "bg-amber-400"
            : "bg-emerald-500";
      const lowStock = usableStock <= rm.batasROP;
      tbody.innerHTML += `
        <tr class="${expiryHighlight?.rowClasses || "hover:bg-slate-50"} ${lowStock ? "stock-low-row" : ""}">
          <td class="p-4 font-bold text-slate-800">${rm.nama}
            ${lowStock ? '<span class="stock-alert-pulse mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"><i class="fa-solid fa-triangle-exclamation"></i> Stok di bawah ROP</span>' : ""}
            <div class="mt-2 max-w-36" title="${expiry.label}">
              <div class="mb-1 flex justify-between text-[10px] font-normal text-slate-500">
                <span>Daya tahan</span><span>${expiry.sisaHari <= 0 ? "0" : expiry.sisaHari} hari</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Sisa daya tahan ${rm.nama}" aria-valuenow="${Math.round(remainingPercent)}" aria-valuemin="0" aria-valuemax="100">
                <div class="h-full rounded-full ${expiryColor} transition-all duration-500" style="width:${remainingPercent}%"></div>
              </div>
            </div>${
            expiryHighlight
              ? `<span class="mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${expiryHighlight.badgeClasses}">${expiryHighlight.label}</span>`
              : ""
          }</td>
          <td class="p-4 font-semibold ${usableStock <= rm.batasROP ? "text-amber-600" : "text-slate-700"}">${formatQuantity(rm.stok)} ${rm.satuan}<span class="block text-[10px] font-normal text-slate-500">${formatQuantity(usableStock)} ${rm.satuan} layak pakai</span></td>
          <td class="p-4 text-slate-500">${formatQuantity(rm.batasROP)} ${rm.satuan}</td>
          <td class="p-4 text-slate-600">${formatRupiah(rm.harga)} / ${rm.satuan}</td>
          <td class="p-4 text-xs">${
            materialBatches.length
              ? `<button type="button" data-material-expiry-details="${escapeHtml(rm.id)}" class="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-50"><i class="fa-regular fa-calendar mr-1"></i>Lihat ${materialBatches.length} batch</button>`
              : '<span class="text-slate-400">Tidak ada stok batch</span>'
          }</td>
          <td class="p-4 font-bold text-blue-600">${formatQuantity(recommendQty)} ${rm.satuan}</td>
          <td class="p-4 text-right font-bold text-emerald-600">${formatRupiah(subtotalCost)}</td>
          <td class="p-4 text-center whitespace-nowrap">
            <button onclick="openBatchForm('${rm.id}')" title="Tambah stok baru" class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-emerald-600 hover:bg-emerald-50"><i class="fa-solid fa-boxes-stacked"></i></button>
            <button onclick="openMaterialForm('${rm.id}')" title="Edit bahan baku" class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="requestDeleteMaterial('${rm.id}')" title="Hapus bahan baku" class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    });

  document.getElementById("grandProcurementCostText").innerText =
    `Grand Total Belanja: ${formatRupiah(calculateProcurementEstimate())}`;
  updateExpiredLossCard();
  populateRawMaterialDropdowns();
  updateMaterialPriceChart();
}

export function openMaterialBatchExpiryDetails(materialId) {
  const material = state.rawMaterials.find((item) => item.id === materialId);
  if (!material) {
    alert("Data bahan tidak ditemukan. Muat ulang halaman lalu coba lagi.");
    return;
  }

  const container = document.getElementById("materialBatchExpiryDetails");
  document.getElementById("materialBatchExpiryTitle").textContent =
    `Tanggal EXP · ${material.nama}`;
  container.replaceChildren();

  const batches = getMaterialBatches(material)
    .filter((batch) => Number(batch.stok) > 0)
    .sort(
      (a, b) =>
        new Date(`${a.tanggalExpired}T00:00:00`) -
        new Date(`${b.tanggalExpired}T00:00:00`),
    );

  if (batches.length === 0) {
    container.textContent = "Tidak ada batch dengan stok tersisa.";
  } else {
    batches.forEach((batch) => {
      const expiry = getExpiryStatus(batch.tanggalExpired);
      const item = document.createElement("div");
      item.className = `flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        expiry.status === "Expired"
          ? "border-rose-300 bg-rose-100"
          : expiry.status === "Warning"
            ? "border-amber-300 bg-amber-100"
            : "border-slate-200"
      }`;

      const details = document.createElement("div");
      const date = document.createElement("p");
      date.className = "font-bold text-slate-800";
      date.textContent = `Kedaluwarsa ${formatDateDisplay(batch.tanggalExpired)}`;
      const stock = document.createElement("p");
      stock.className = "text-sm text-slate-600";
      stock.textContent =
        `Stok tersisa: ${formatQuantity(batch.stok)} ${material.satuan}`;
      const status = document.createElement("span");
      status.className =
        `inline-block rounded-full px-2.5 py-1 text-xs font-bold ${expiry.classes}`;
      status.textContent = expiry.label;
      details.append(date, stock, status);
      item.append(details);

      if (expiry.status === "Expired" && state.materialBatchDisposalReady) {
        const disposeButton = document.createElement("button");
        disposeButton.type = "button";
        disposeButton.className =
          "rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700";
        disposeButton.innerHTML =
          '<i class="fa-solid fa-trash mr-1"></i>Buang stok';
        disposeButton.addEventListener("click", () => {
          closeModal("modal-material-batch-expiry");
          openExpiredBatchDisposal(material.id, batch.id);
        });
        item.append(disposeButton);
      }
      container.append(item);
    });
  }

  openModal("modal-material-batch-expiry");
}

export function calculateExpiredLoss() {
  const waitingToDispose = state.rawMaterials.reduce(
    (total, material) =>
      total +
      getMaterialBatches(material).reduce((batchTotal, batch) => {
        const expiry = getExpiryStatus(batch.tanggalExpired);
        return (
          batchTotal +
          (expiry.status === "Expired" ? batch.stok * batch.harga : 0)
        );
      }, 0),
    0,
  );
  return waitingToDispose + state.materialBatchDisposedLoss;
}

function updateExpiredLossCard() {
  const el = document.getElementById("statExpiredLoss");
  if (el) el.innerText = formatRupiah(calculateExpiredLoss());
}

export function populateRawMaterialDropdowns() {
  const ropSelect = document.getElementById("ropMaterialSelect");
  const eoqSelect = document.getElementById("eoqMaterialSelect");
  if (!ropSelect || !eoqSelect) return;

  ropSelect.innerHTML = "";
  eoqSelect.innerHTML = "";

  state.rawMaterials.forEach((rm) => {
    ropSelect.innerHTML += `<option value="${rm.id}">${rm.nama} (Layak pakai: ${calculateUsableMaterialStock(rm)} ${rm.satuan})</option>`;
    eoqSelect.innerHTML += `<option value="${rm.id}">${rm.nama}</option>`;
  });
}

export function openMaterialForm(id = "") {
  const material = state.rawMaterials.find((rm) => rm.id === id);
  document.getElementById("editingMaterialId").value = id;
  document.getElementById("materialFormTitle").innerText = material
    ? "Edit Data Master Bahan"
    : "Tambah Bahan Baku Baru";
  document.getElementById("materialName").value = material ? material.nama : "";
  document.getElementById("materialStock").value = material
    ? material.stok
    : "";
  document.getElementById("materialUnit").value = material
    ? material.satuan.toLowerCase() === "buah"
      ? "pcs"
      : material.satuan.toLowerCase()
    : "";
  document.getElementById("materialRop").value = material
    ? material.batasROP
    : "";
  document.getElementById("materialShelfLife").value = material
    ? material.dayaTahanHari
    : "";
  document.getElementById("materialPrice").value = material
    ? material.harga
    : "";
  document.getElementById("materialInputDate").value = material
    ? material.tanggalInput
    : toInputDate(new Date());
  document.getElementById("materialExpiryDate").value = material
    ? material.tanggalExpired
    : "";
  document.getElementById("materialStock").readOnly = Boolean(material);
  document.getElementById("materialPrice").readOnly = Boolean(material);
  document.getElementById("materialInputDate").readOnly = Boolean(material);
  document.getElementById("materialExpiryDate").readOnly = Boolean(material);
  if (!material) updateMaterialExpiryDate();
  openModal("modal-material-form");
}

export function openBatchForm(id) {
  const material = state.rawMaterials.find((rm) => rm.id === id);
  if (!material) return;
  document.getElementById("batchMaterialId").value = id;
  document.getElementById("batchMaterialName").innerText =
    `${material.nama} (stok saat ini: ${material.stok} ${material.satuan})`;
  document.getElementById("batchStock").value = "";
  document.getElementById("batchPrice").value = material.harga;
  document.getElementById("batchInputDate").value = toInputDate(new Date());
  document.getElementById("batchExpiryDate").value = "";
  document.getElementById("batchShelfLife").value =
    material.dayaTahanHari || "";
  updateBatchExpiryDate();
  openModal("modal-batch-form");
}

export async function openBatchExpiryCorrection(materialId, batchId) {
  const material = state.rawMaterials.find((item) => item.id === materialId);
  const batch = material?.batches?.find((item) => item.id === batchId);
  if (!material || !batch || batch.stok <= 0) {
    alert(
      "Batch tidak ditemukan atau stoknya sudah habis. Muat ulang data lalu coba lagi.",
    );
    return;
  }

  pendingExpiryCorrection = { materialId, batchId };
  document.getElementById("expiryCorrectionMaterial").textContent =
    `${material.nama} · Batch masuk ${formatDateDisplay(batch.tanggalInput)}`;
  document.getElementById("expiryCorrectionOldDate").textContent =
    formatDateDisplay(batch.tanggalExpired);
  document.getElementById("expiryCorrectionStock").textContent =
    `${formatQuantity(batch.stok)} ${material.satuan}`;
  document.getElementById("expiryCorrectionNewDate").value =
    batch.tanggalExpired;
  document.getElementById("expiryCorrectionChangedBy").value =
    "Pemilik warung";
  document.getElementById("expiryCorrectionReason").value = "";
  document.getElementById("expiryCorrectionWarning").classList.add("hidden");

  const historyContainer = document.getElementById("expiryCorrectionHistory");
  historyContainer.textContent = "Memuat riwayat koreksi...";
  openModal("modal-expiry-correction");

  try {
    const history = await fetchMaterialBatchExpiryHistory(batchId);
    historyContainer.replaceChildren();
    if (history.length === 0) {
      historyContainer.textContent =
        "Belum ada koreksi tanggal untuk batch ini.";
      return;
    }

    history.forEach((entry) => {
      const item = document.createElement("div");
      item.className =
        "border-b border-slate-100 pb-2 last:border-0 last:pb-0";
      const dates = document.createElement("p");
      dates.className = "font-semibold text-slate-700";
      dates.textContent = `${formatDateDisplay(entry.old_expiry)} → ${formatDateDisplay(entry.new_expiry)}`;
      const details = document.createElement("p");
      details.className = "mt-1 text-slate-500";
      details.textContent =
        `${new Date(entry.created_at).toLocaleString("id-ID")} · ` +
        `${entry.changed_by} · ${entry.reason}`;
      item.append(dates, details);
      historyContainer.append(item);
    });
  } catch (error) {
    console.error("Gagal memuat riwayat koreksi tanggal batch:", error);
    historyContainer.textContent =
      "Riwayat koreksi tidak dapat dimuat. Periksa koneksi database sebelum melanjutkan.";
    alert(
      "Riwayat koreksi tidak dapat dimuat. Koreksi dibatalkan agar perubahan tetap dapat diaudit.",
    );
    closeModal("modal-expiry-correction");
  }
}

export function updateExpiryCorrectionWarning() {
  if (!pendingExpiryCorrection) return;
  const material = state.rawMaterials.find(
    (item) => item.id === pendingExpiryCorrection.materialId,
  );
  const batch = material?.batches?.find(
    (item) => item.id === pendingExpiryCorrection.batchId,
  );
  const newDate = document.getElementById("expiryCorrectionNewDate").value;
  const warning = document.getElementById("expiryCorrectionWarning");
  const messages = [];
  const today = toInputDate(new Date());

  if (newDate && newDate <= today) {
    messages.push(
      "Tanggal EXP baru hari ini atau sudah lewat. Batch akan ditandai kedaluwarsa dan tidak layak digunakan.",
    );
  }
  if (newDate && batch?.tanggalInput && newDate < batch.tanggalInput) {
    messages.push(
      "Tanggal EXP baru lebih awal daripada tanggal masuk batch; pastikan kembali dengan label kemasan.",
    );
  }

  warning.textContent = messages.join(" ");
  warning.classList.toggle("hidden", messages.length === 0);
}

export function requestBatchExpiryCorrection() {
  if (!pendingExpiryCorrection) return;
  const { materialId, batchId } = pendingExpiryCorrection;
  const material = state.rawMaterials.find((item) => item.id === materialId);
  const batch = material?.batches?.find((item) => item.id === batchId);
  const newDate = document.getElementById("expiryCorrectionNewDate").value;
  const changedBy = document
    .getElementById("expiryCorrectionChangedBy")
    .value.trim();
  const reason = document.getElementById("expiryCorrectionReason").value.trim();

  if (!material || !batch || batch.stok <= 0) {
    alert(
      "Batch tidak lagi tersedia untuk dikoreksi. Muat ulang data terlebih dahulu.",
    );
    return;
  }
  if (!newDate || !changedBy || !reason) {
    alert("Tanggal EXP baru, nama operator, dan alasan koreksi wajib diisi.");
    return;
  }
  if (newDate === batch.tanggalExpired) {
    alert(
      "Tanggal EXP tidak berubah. Masukkan tanggal yang benar terlebih dahulu.",
    );
    return;
  }

  const warning = document.getElementById("expiryCorrectionWarning");
  const warningText = warning.classList.contains("hidden")
    ? ""
    : `<br/><span class="text-amber-700">${escapeHtml(warning.textContent)}</span>`;
  openActionConfirmation(
    "Konfirmasi Koreksi Tanggal EXP",
    "Pastikan tanggal baru sudah dicocokkan dengan label kemasan batch.",
    `EXP lama: <b>${formatDateDisplay(batch.tanggalExpired)}</b><br/>` +
      `EXP baru: <b>${formatDateDisplay(newDate)}</b><br/>` +
      `Nama operator: <b>${escapeHtml(changedBy)}</b><br/>` +
      `Alasan: ${escapeHtml(reason)}<br/>` +
      `Stok batch tetap: <b>${batch.stok}</b> (tidak berubah)${warningText}`,
    async () => {
      try {
        await correctMaterialBatchExpiry(
          batchId,
          newDate,
          reason,
          changedBy,
        );
      } catch (error) {
        console.error("Gagal mengoreksi tanggal EXP batch:", error);
        alert(
          `Tanggal EXP gagal dikoreksi. Data tidak diubah. ${error.message || "Periksa koneksi dan migrasi database."}`,
        );
        return;
      }

      closeModal("modal-expiry-correction");
      pendingExpiryCorrection = null;
      try {
        await reloadRawMaterials();
        renderRawMaterialsTable();
        document.dispatchEvent(new CustomEvent("forecastbiz:materials-changed"));
        alert("Tanggal EXP batch berhasil dikoreksi dan riwayatnya telah dicatat.");
      } catch (error) {
        console.error(
          "Tanggal EXP tersimpan tetapi tampilan bahan gagal dimuat ulang:",
          error,
        );
        alert(
          "Tanggal EXP berhasil dikoreksi dan dicatat, tetapi tampilan gagal diperbarui. Muat ulang halaman untuk melihat data terbaru.",
        );
      }
    },
  );
}

export function openExpiredBatchDisposal(materialId, batchId) {
  if (!state.materialBatchDisposalReady) {
    alert(
      "Fitur pembuangan belum siap. Jalankan migrasi 20261019_material_batch_disposals.sql di Supabase, lalu muat ulang aplikasi.",
    );
    return;
  }
  const material = state.rawMaterials.find((item) => item.id === materialId);
  const batch = material?.batches?.find((item) => item.id === batchId);
  if (
    !material ||
    !batch ||
    batch.stok <= 0 ||
    getExpiryStatus(batch.tanggalExpired).status !== "Expired"
  ) {
    alert(
      "Batch tidak ditemukan, stoknya habis, atau tanggal EXP belum terlewati. Muat ulang data lalu periksa kembali.",
    );
    return;
  }

  pendingExpiredBatchDisposal = { materialId, batchId };
  document.getElementById("expiredDisposalMaterial").textContent =
    `${material.nama} · EXP ${formatDateDisplay(batch.tanggalExpired)}`;
  document.getElementById("expiredDisposalStock").textContent =
    `${batch.stok} ${material.satuan}`;
  document.getElementById("expiredDisposalUnitCost").textContent =
    formatRupiah(batch.harga);
  document.getElementById("expiredDisposalQuantity").max = batch.stok;
  document.getElementById("expiredDisposalQuantity").value = batch.stok;
  document.getElementById("expiredDisposalChangedBy").value = "Pemilik warung";
  document.getElementById("expiredDisposalNote").value = "";
  updateExpiredDisposalPreview();
  openModal("modal-expired-disposal");
}

export function updateExpiredDisposalPreview() {
  if (!pendingExpiredBatchDisposal) return;
  const material = state.rawMaterials.find(
    (item) => item.id === pendingExpiredBatchDisposal.materialId,
  );
  const batch = material?.batches?.find(
    (item) => item.id === pendingExpiredBatchDisposal.batchId,
  );
  const quantity = Number(
    document.getElementById("expiredDisposalQuantity").value,
  );
  const preview = document.getElementById("expiredDisposalLossPreview");
  preview.textContent =
    batch && Number.isFinite(quantity) && quantity > 0
      ? formatRupiah(quantity * batch.harga)
      : formatRupiah(0);
}

export function requestExpiredBatchDisposal() {
  if (!pendingExpiredBatchDisposal) return;
  const { materialId, batchId } = pendingExpiredBatchDisposal;
  const material = state.rawMaterials.find((item) => item.id === materialId);
  const batch = material?.batches?.find((item) => item.id === batchId);
  const quantity = Number(
    document.getElementById("expiredDisposalQuantity").value,
  );
  const changedBy = document
    .getElementById("expiredDisposalChangedBy")
    .value.trim();
  const note = document.getElementById("expiredDisposalNote").value.trim();

  if (
    !material ||
    !batch ||
    batch.stok <= 0 ||
    getExpiryStatus(batch.tanggalExpired).status !== "Expired"
  ) {
    alert(
      "Batch tidak lagi dapat dibuang sebagai bahan kedaluwarsa. Muat ulang data terlebih dahulu.",
    );
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > batch.stok) {
    alert(
      `Jumlah pembuangan harus lebih dari 0 dan maksimal ${formatQuantity(batch.stok)}.`,
    );
    return;
  }
  if (!changedBy) {
    alert("Nama operator wajib diisi.");
    return;
  }

  const reason = note
    ? `Kedaluwarsa: ${note}`
    : "Kedaluwarsa";
  openActionConfirmation(
    "Konfirmasi Pembuangan Bahan Kedaluwarsa",
    "Batch yang sudah kedaluwarsa tidak layak digunakan atau dijual.",
    `<b>${escapeHtml(material.nama)}</b><br/>EXP: <b>${formatDateDisplay(batch.tanggalExpired)}</b><br/>Jumlah dibuang: <b>${formatQuantity(quantity)} ${escapeHtml(material.satuan)}</b><br/>Operator: <b>${escapeHtml(changedBy)}</b><br/>Alasan: ${escapeHtml(reason)}<br/>Nilai kerugian tercatat: <b>${formatRupiah(quantity * batch.harga)}</b><br/>Sisa batch setelah pembuangan: <b>${formatQuantity(batch.stok - quantity)} ${escapeHtml(material.satuan)}</b>`,
    async () => {
      try {
        await disposeExpiredMaterialBatch(
          batchId,
          quantity,
          changedBy,
          reason,
        );
      } catch (error) {
        console.error("Gagal membuang batch kedaluwarsa:", error);
        alert(
          `Pembuangan gagal. Data stok tidak diubah. ${error.message || "Periksa koneksi dan migrasi database."}`,
        );
        return;
      }

      pendingExpiredBatchDisposal = null;
      closeModal("modal-expired-disposal");
      try {
        await Promise.all([
          reloadRawMaterials(),
          reloadMaterialBatchDisposedLoss(),
          reloadMaterialBatchDisposals(),
        ]);
        renderRawMaterialsTable();
        document.dispatchEvent(new CustomEvent("forecastbiz:materials-changed"));
        alert(
          `${formatQuantity(quantity)} ${material.satuan} ${material.nama} berhasil dicatat sebagai dibuang. Jumlah stok dan rekomendasi belanja diperbarui.`,
        );
      } catch (error) {
        console.error(
          "Pembuangan tersimpan tetapi data tampilan gagal dimuat ulang:",
          error,
        );
        alert(
          "Pembuangan berhasil dicatat, tetapi tampilan gagal diperbarui. Muat ulang halaman untuk melihat stok dan rekomendasi terbaru.",
        );
      }
    },
  );
}

export function updateBatchExpiryDate() {
  const inputDate = document.getElementById("batchInputDate").value;
  const shelfLifeDays = parseInt(
    document.getElementById("batchShelfLife").value,
    10,
  );
  if (!inputDate || !Number.isFinite(shelfLifeDays) || shelfLifeDays < 0)
    return;
  const expiryDate = new Date(`${inputDate}T00:00:00`);
  expiryDate.setDate(expiryDate.getDate() + shelfLifeDays);
  document.getElementById("batchExpiryDate").value = toInputDate(expiryDate);
}

export function updateMaterialExpiryDate() {
  const inputDate = document.getElementById("materialInputDate").value;
  const shelfLifeDays = parseInt(
    document.getElementById("materialShelfLife").value,
    10,
  );
  if (!inputDate || !Number.isFinite(shelfLifeDays) || shelfLifeDays < 0)
    return;
  const expiryDate = new Date(`${inputDate}T00:00:00`);
  expiryDate.setDate(expiryDate.getDate() + shelfLifeDays);
  document.getElementById("materialExpiryDate").value = toInputDate(expiryDate);
}

export async function saveMaterial() {
  const id = document.getElementById("editingMaterialId").value;
  const name = document.getElementById("materialName").value.trim();
  const unit = document.getElementById("materialUnit").value.trim();
  const stock = parseFloat(document.getElementById("materialStock").value);
  const rop = parseFloat(document.getElementById("materialRop").value);
  const shelfLifeDays = parseInt(
    document.getElementById("materialShelfLife").value,
    10,
  );
  const harga = parseFloat(document.getElementById("materialPrice").value);
  const tanggalInput = document.getElementById("materialInputDate").value;
  const tanggalExpired = document.getElementById("materialExpiryDate").value;

  if (
    !name ||
    !unit ||
    [stock, rop, shelfLifeDays, harga].some(
      (v) => !Number.isFinite(v) || v < 0,
    ) ||
    harga === 0 ||
    shelfLifeDays === 0 ||
    !tanggalInput ||
    !tanggalExpired
  ) {
    alert("Mohon isi semua data bahan baku dengan nilai yang valid.");
    return;
  }

  if (!id && !confirmUnusualExpiryDate(tanggalInput, tanggalExpired)) return;

  const payload = {
    nama: name,
    satuan: unit,
    stok: stock,
    batasROP: rop,
    dayaTahanHari: shelfLifeDays,
    harga,
    tanggalInput,
    tanggalExpired,
  };

  if (id) {
    await updateRawMaterial(id, payload, false, "");
  } else {
    await insertRawMaterial(payload);
  }

  closeModal("modal-material-form");
  await reloadRawMaterials();
  renderRawMaterialsTable();
  document.dispatchEvent(new CustomEvent("forecastbiz:materials-changed"));
  alert(
    id
      ? "Bahan baku berhasil diperbarui."
      : "Bahan baku baru berhasil ditambahkan.",
  );
}

export async function saveMaterialBatch() {
  const materialId = document.getElementById("batchMaterialId").value;
  const material = state.rawMaterials.find((rm) => rm.id === materialId);
  const stok = parseFloat(document.getElementById("batchStock").value);
  const harga = parseFloat(document.getElementById("batchPrice").value);
  const tanggalInput = document.getElementById("batchInputDate").value;
  const tanggalExpired = document.getElementById("batchExpiryDate").value;

  if (
    !material ||
    !Number.isFinite(stok) ||
    stok <= 0 ||
    !Number.isFinite(harga) ||
    harga <= 0 ||
    !tanggalInput ||
    !tanggalExpired
  ) {
    alert(
      "Mohon isi jumlah, harga, tanggal masuk, dan tanggal kedaluwarsa batch dengan benar.",
    );
    return;
  }

  if (!confirmUnusualExpiryDate(tanggalInput, tanggalExpired)) return;

  await addMaterialBatch(materialId, {
    stok,
    harga,
    tanggalInput,
    tanggalExpired,
    totalStok: material.stok + stok,
  });
  closeModal("modal-batch-form");
  await reloadRawMaterials();
  renderRawMaterialsTable();
  document.dispatchEvent(new CustomEvent("forecastbiz:materials-changed"));
  alert(`Batch baru ${stok} ${material.satuan} berhasil ditambahkan.`);
}

function confirmUnusualExpiryDate(tanggalInput, tanggalExpired) {
  const today = toInputDate(new Date());
  const warnings = [];
  if (tanggalExpired <= today) {
    warnings.push(
      `Tanggal EXP ${formatDateDisplay(tanggalExpired)} adalah hari ini atau sudah lewat.`,
    );
  }
  if (tanggalExpired < tanggalInput) {
    warnings.push(
      `Tanggal EXP lebih awal daripada tanggal masuk ${formatDateDisplay(tanggalInput)}.`,
    );
  }
  if (warnings.length === 0) return true;

  return confirm(
    `${warnings.join("\n")}\nPastikan tanggal sesuai label kemasan. Tetap simpan batch?`,
  );
}

export function requestDeleteMaterial(id) {
  const material = state.rawMaterials.find((rm) => rm.id === id);
  if (!material) return;
  openActionConfirmation(
    "Verifikasi Hapus Bahan Baku",
    "Anda akan menghapus bahan baku ini dari daftar pengadaan.",
    `<b>${material.nama}</b><br/>Stok saat ini: ${material.stok} ${material.satuan}<br/><span class="text-rose-700">Data bahan ini tidak dapat dipulihkan setelah dihapus.</span>`,
    () => deleteMaterialConfirmed(id),
  );
}

async function deleteMaterialConfirmed(id) {
  await deleteRawMaterial(id);
  await reloadRawMaterials();
  renderRawMaterialsTable();
  document.dispatchEvent(new CustomEvent("forecastbiz:materials-changed"));
}

export function initMaterialPriceChart() {
  const ctx = document.getElementById("materialPriceChart").getContext("2d");
  materialPriceChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Harga Satuan",
          data: [],
          borderColor: "#059669",
          backgroundColor: "rgba(5, 150, 105, 0.12)",
          borderWidth: 3,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => formatRupiah(c.parsed.y) } },
      },
      scales: {
        y: { beginAtZero: false, ticks: { callback: (v) => formatRupiah(v) } },
      },
    },
  });
  updateMaterialPriceChart();
}

export function updateMaterialPriceChart() {
  const select = document.getElementById("materialPriceChartSelect");
  if (!select || !materialPriceChartInstance) return;
  const selectedId =
    select.value || (state.rawMaterials[0] && state.rawMaterials[0].id);
  select.innerHTML = state.rawMaterials
    .map((rm) => `<option value="${rm.id}">${rm.nama}</option>`)
    .join("");
  if (!state.rawMaterials.length) {
    materialPriceChartInstance.data.labels = [];
    materialPriceChartInstance.data.datasets[0].data = [];
    materialPriceChartInstance.update();
    return;
  }
  select.value = state.rawMaterials.some((rm) => rm.id === selectedId)
    ? selectedId
    : state.rawMaterials[0].id;
  const material = state.rawMaterials.find((rm) => rm.id === select.value);
  const history =
    material.priceHistory && material.priceHistory.length
      ? material.priceHistory
      : [{ date: "Saat ini", price: material.harga }];
  materialPriceChartInstance.data.labels = history.map((e) => e.date);
  materialPriceChartInstance.data.datasets[0].label = `Harga ${material.nama} / ${material.satuan}`;
  materialPriceChartInstance.data.datasets[0].data = history.map(
    (e) => e.price,
  );
  materialPriceChartInstance.update();
}
