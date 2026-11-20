import { state } from "../state.js";
import {
  formatDateDisplay,
  formatQuantity,
  formatRupiah,
  getExpiryStatus,
} from "../utils.js";
import {
  openBatchExpiryCorrection,
  openExpiredBatchDisposal,
} from "./materials.js?v=20261019-2";

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

export function renderFefoTable() {
  const tbody = document.getElementById("fefoTableBody");
  if (!tbody.dataset.actionsBound) {
    tbody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-fefo-action]");
      if (!button || !(button instanceof HTMLButtonElement)) return;

      const { fefoAction, materialId, batchId } = button.dataset;
      if (fefoAction === "dispose") {
        openExpiredBatchDisposal(materialId, batchId);
      } else if (fefoAction === "correct") {
        openBatchExpiryCorrection(materialId, batchId).catch((error) => {
          console.error("Gagal membuka koreksi tanggal batch:", error);
          alert(
            `Koreksi EXP gagal dibuka. ${error.message || "Periksa koneksi dan konfigurasi Supabase."}`,
          );
        });
      }
    });
    tbody.dataset.actionsBound = "true";
  }

  const setupWarning = document.getElementById("materialDisposalSetupWarning");
  setupWarning.classList.toggle(
    "hidden",
    state.materialBatchDisposalReady,
  );
  const sortedBatches = state.rawMaterials
    .flatMap((material) =>
      material.batches && material.batches.length
        ? material.batches.map((batch) => ({
            ...batch,
            material,
            canCorrect: true,
            canDispose: true,
          }))
        : [
            {
              material,
              canCorrect: false,
              canDispose: false,
              stok: material.stok,
              harga: material.harga,
              tanggalInput: material.tanggalInput,
              tanggalExpired: material.tanggalExpired,
            },
          ],
    )
    .filter((batch) => batch.stok > 0)
    .sort(
      (a, b) =>
        new Date(`${a.tanggalExpired}T00:00:00`) -
        new Date(`${b.tanggalExpired}T00:00:00`),
    );
  tbody.innerHTML = sortedBatches.length
    ? sortedBatches
        .map((batch, index) => {
          const { material } = batch;
          const expiry = getExpiryStatus(batch.tanggalExpired);
          const recommendation =
            expiry.status === "Warning"
              ? `<button onclick="openFefoPromoModal('${material.id}')" class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold whitespace-nowrap"><i class="fa-solid fa-tag mr-1"></i> Rencanakan Promo</button>`
              : expiry.status === "Expired"
                ? '<span class="text-xs text-rose-600 font-semibold">Jangan digunakan</span>'
                : '<span class="text-xs text-slate-400">Pantau stok</span>';
          return `<tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-500">#${index + 1}</td>
            <td class="p-3 font-bold text-slate-800">${escapeHtml(material.nama)}<span class="block text-[10px] text-slate-400">Batch masuk ${formatDateDisplay(batch.tanggalInput)}</span></td>
            <td class="p-3">${formatQuantity(batch.stok)} ${material.satuan}</td>
            <td class="p-3 text-slate-600">${formatDateDisplay(batch.tanggalExpired)}</td>
            <td class="p-3"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${expiry.classes}">${expiry.label}</span></td>
            <td class="p-3">${recommendation}</td>
            <td class="p-3 whitespace-nowrap">
              ${batch.canCorrect ? `<button type="button" data-fefo-action="correct" data-material-id="${escapeHtml(material.id)}" data-batch-id="${escapeHtml(batch.id)}" title="Koreksi tanggal EXP dan lihat riwayat" class="mb-1 px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 text-xs font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i>Koreksi EXP</button>` : ""}
              ${batch.canDispose && expiry.status === "Expired" && state.materialBatchDisposalReady ? `<button type="button" data-fefo-action="dispose" data-material-id="${escapeHtml(material.id)}" data-batch-id="${escapeHtml(batch.id)}" title="Buang stok batch yang kedaluwarsa" class="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 text-xs font-semibold"><i class="fa-solid fa-trash mr-1"></i>Buang stok</button>` : ""}
              ${!batch.canCorrect ? '<span class="text-xs text-slate-400">Batch lama tidak tersedia untuk dikoreksi atau dibuang</span>' : ""}
            </td>
          </tr>`;
        })
        .join("")
    : '<tr><td colspan="7" class="p-6 text-center text-slate-400 italic">Belum ada data bahan baku.</td></tr>';

  renderDisposalHistory();
}

function renderDisposalHistory() {
  const tbody = document.getElementById("expiredDisposalHistoryTable");
  const history = state.materialBatchDisposals || [];
  if (history.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Belum ada riwayat pembuangan.</td></tr>';
    return;
  }

  tbody.innerHTML = history
    .map(
      (entry) => `
        <tr class="hover:bg-slate-50">
          <td class="p-3 whitespace-nowrap">${new Date(entry.created_at).toLocaleString("id-ID")}</td>
          <td class="p-3">${escapeHtml(entry.material_name)}<span class="block text-xs text-slate-500">EXP ${formatDateDisplay(entry.batch_expiry)}</span></td>
          <td class="p-3">${formatQuantity(entry.quantity)} ${entry.unit}</td>
          <td class="p-3 font-semibold text-rose-700">${formatRupiah(entry.total_loss)}</td>
          <td class="p-3">${escapeHtml(entry.changed_by)}<span class="block text-xs text-slate-500">${escapeHtml(entry.reason)}</span></td>
        </tr>`,
    )
    .join("");
}

export function activatePromoRecommendation(id) {
  if (typeof window.openFefoPromoModal === "function") {
    window.openFefoPromoModal(id);
    return;
  }

  const material = state.rawMaterials.find((item) => item.id === id);
  if (!material) return;
  alert(
    `Rekomendasi promo aktif: prioritaskan menu terkait bahan ${material.nama} agar stok segera terpakai.`,
  );
}
