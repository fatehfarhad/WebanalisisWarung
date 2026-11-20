import { loadWeekdayData, setSelectedPeriod, getSelectedPeriod } from "./weekdayData.js";
import { PERIODE_DEFAULT } from "../weekdayPattern.js";

export async function renderWeekdayCard() {
  const statusEl = document.getElementById("weekdayStatus");
  const summaryEl = document.getElementById("weekdaySummary");
  const rowsEl = document.getElementById("weekdayRows");
  const newMenusEl = document.getElementById("weekdayNewMenus");
  const periodEl = document.getElementById("weekdayPeriod");
  const guideEl = document.getElementById("weekdayGuide");

  if (!statusEl || !summaryEl || !rowsEl || !newMenusEl) return;
  if (periodEl) {
    periodEl.value = String(getSelectedPeriod() || PERIODE_DEFAULT);
  }

  if (guideEl) {
    guideEl.classList.toggle("hidden", guideEl.dataset.open !== "true");
  }

  statusEl.textContent = "Memuat data penjualan...";
  summaryEl.textContent = "";
  rowsEl.innerHTML = "";
  newMenusEl.innerHTML = "";

  const period = Number(periodEl?.value || getSelectedPeriod() || PERIODE_DEFAULT);
  const data = await loadWeekdayData(period);
  if (data.error) {
    statusEl.textContent = "Data penjualan belum bisa dimuat. Coba lagi nanti.";
    summaryEl.textContent = "";
    return;
  }

  statusEl.textContent = "Data siap ditampilkan.";
  summaryEl.textContent = `Pola dihitung dari ${data.period} hari terakhir (${data.start} s.d. ${data.end}). Hari tanpa struk dan hari promo tidak dihitung.`;
  rowsEl.innerHTML = `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      Semua menu digabung
    </div>
  `;

  if (data.baruMenus?.length) {
    newMenusEl.innerHTML = data.baruMenus
      .map((item) => `<div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">${item.name}: baru ${item.days} hari, dinilai setelah 14 hari.</div>`)
      .join("");
  }
}

export async function renderPromoTrackCard() {
  const statusEl = document.getElementById("promoTrackStatus");
  const summaryEl = document.getElementById("promoTrackSummary");
  const listEl = document.getElementById("promoTrackList");
  const noteEl = document.getElementById("promoTrackNote");

  if (!statusEl || !summaryEl || !listEl || !noteEl) return;
  statusEl.textContent = "Memuat data promo...";
  summaryEl.textContent = "";
  listEl.innerHTML = "";
  noteEl.textContent = "Hasil tiap promo bisa berbeda. Jangan menyimpulkan dari satu promo saja. Penilaian memakai modal menu saat ini.";

  const { state } = await import("../state.js");
  const promos = (state.promotions || []).filter((promo) => promo.resultStatus === "selesai" || promo.resultStatus === "dihentikan").slice(0, 10);
  if (!promos.length) {
    statusEl.textContent = "Belum ada promo yang selesai.";
    summaryEl.textContent = "Belum ada promo yang selesai. Buat promo dari Simulasi Promo dan jalankan minimal 4 hari promo.";
    return;
  }

  statusEl.textContent = `${promos.length} promo selesai.`;
  summaryEl.textContent = `${promos.length} promo selesai.`;
  listEl.innerHTML = promos
    .map((promo) => `<div class="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">${promo.id}</div>`)
    .join("");
}

export function initWeekdayCard() {
  const periodEl = document.getElementById("weekdayPeriod");
  if (periodEl) {
    periodEl.value = String(getSelectedPeriod() || 28);
    periodEl.addEventListener("change", () => {
      const next = Number(periodEl.value);
      setSelectedPeriod(next);
      renderWeekdayCard();
    });
  }

  const guideEl = document.getElementById("weekdayGuide");
  if (guideEl) {
    guideEl.dataset.open = "false";
    guideEl.classList.add("hidden");
    guideEl.addEventListener("click", () => {
      const next = guideEl.dataset.open === "true" ? "false" : "true";
      guideEl.dataset.open = next;
      guideEl.classList.toggle("hidden", next !== "true");
    });
  }
}
