import { state } from "../state.js";
import { getPriceForDate, todayLocal, weekdayOf } from "../promoEval.js";
import { formatRupiah } from "../utils.js";
import { colorIndexOf, initialsOf, KATEGORI, matchesQuery, PALET, sortMenus } from "../imageUtils.js";
import { playCashierTone, setReceiptItemPrice } from "./cashier.js";

function getMenuQty(menuId) {
  return state.currentReceiptItems.find((item) => item.menuId === menuId)?.qty || 0;
}

function menuHasQty(menuId) {
  return getMenuQty(menuId) > 0;
}

const WEEKDAY_NAMES = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function getScheduledPromoForDate(menu, date) {
  return state.promotions.find((promo) => {
    const weekdays = promo.weekdays?.map(Number) || [];
    return (
      promo.menuId === menu.id &&
      promo.startDate <= date &&
      date <= promo.endDate &&
      (!promo.stoppedOn || date < promo.stoppedOn) &&
      weekdays.length > 0 &&
      !weekdays.includes(weekdayOf(date)) &&
      Number(promo.promoPrice) < Number(menu.price)
    );
  });
}

function addToReceipt(menu) {
  const date =
    document.getElementById("receiptDate")?.value || todayLocal();
  const existing = state.currentReceiptItems.find((item) => item.menuId === menu.id);
  if (existing) {
    existing.qty += 1;
    setReceiptItemPrice(existing, menu, date);
  } else {
    const item = { menuId: menu.id, name: menu.name, qty: 1 };
    setReceiptItemPrice(item, menu, date);
    state.currentReceiptItems.push(item);
  }
  document.dispatchEvent(new CustomEvent("forecastbiz:receipt-lines-changed", { detail: { menuIds: state.currentReceiptItems.map((item) => item.menuId) } }));
  const event = new CustomEvent("forecastbiz:receipt-draft-changed", { detail: { menuIds: state.currentReceiptItems.map((item) => item.menuId) } });
  document.dispatchEvent(event);
  playCashierTone();
  if (typeof window.renderReceiptPendingItems === "function") {
    window.renderReceiptPendingItems();
  }
}

function renderTile(menu) {
  if (menu.image_url) {
    return `
      <div class="relative h-28 overflow-hidden rounded-2xl bg-slate-100">
        <img src="${menu.image_url}" alt="${menu.name}" class="h-full w-full object-cover" loading="lazy" />
      </div>
    `;
  }

  const index = colorIndexOf(menu.name || "");
  const [bg, text] = PALET[index] || PALET[0];
  return `
    <div class="flex h-28 items-center justify-center rounded-2xl text-2xl font-black tracking-tight" style="background:${bg};color:${text};">
      ${initialsOf(menu.name)}
    </div>
  `;
}

function renderMenuCard(menu) {
  const qty = getMenuQty(menu.id);
  const date =
    document.getElementById("receiptDate")?.value || todayLocal();
  const context = getPriceForDate(menu, state.promotions, date);
  const price = Number(context.price) || Number(menu.price) || 0;
  const normal = Number(menu.price) || 0;
  const scheduledPromo = context.promo
    ? null
    : getScheduledPromoForDate(menu, date);
  const promoLabel = context.promo ? `
    <span class="text-slate-400 line-through">${formatRupiah(normal)}</span>
    <span class="ml-1 font-bold text-emerald-700">${formatRupiah(price)}</span>
    <span class="ml-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">PROMO</span>
  ` : `<span class="font-bold text-emerald-700">${formatRupiah(price)}</span>${
    scheduledPromo
      ? `<small class="block pt-1 text-amber-700">Promo berlaku ${scheduledPromo.weekdays.map(Number).sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[day]).join(", ")}; tidak berlaku pada tanggal transaksi ini.</small>`
      : ""
  }`;
  const qtyBadge = qty ? `<span class="absolute right-2 top-2 rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white shadow">${qty}</span>` : "";

  return `
    <article class="menu-card group relative rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 ${qty ? "ring-2 ring-emerald-400 ring-offset-1" : ""}" data-menu-id="${menu.id}">
      ${qtyBadge}
      <div class="mb-3">${renderTile(menu)}</div>
      <div class="space-y-2">
        <div class="min-h-[42px]">
          <h4 class="line-clamp-2 text-sm font-bold text-slate-800">${menu.name}</h4>
        </div>
        <div class="text-xs text-slate-600">${promoLabel}</div>
        <button type="button" data-add-menu="${menu.id}" class="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700">
          ${qty ? `+ Tambah (${qty})` : "+ Tambah"}
        </button>
      </div>
    </article>
  `;
}

export function renderCashierGrid() {
  const container = document.getElementById("cashierMenuGrid");
  if (!container) return;

  const searchInput = document.getElementById("cashierSearchInput");
  const filterValue = document.getElementById("cashierCategoryFilter")?.value || "Semua";
  const query = (searchInput?.value || "").trim();

  const items = sortMenus(
    state.menuCatalog.filter((menu) => {
      if (!menu.active) return false;
      if (filterValue !== "Semua" && menu.category !== filterValue) return false;
      return matchesQuery(menu.name, query);
    }),
  );

  if (!items.length) {
    container.innerHTML = `
      <div class="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
        <div class="mb-2 font-semibold text-slate-700">Menu tidak ditemukan. Coba kata lain atau pilih 'Semua'.</div>
        <button type="button" data-reset-menu-search class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Hapus pencarian</button>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((menu) => renderMenuCard(menu)).join("");
  const info = document.getElementById("cashierMenuInfo");
  if (info) {
    info.textContent = `Menampilkan ${items.length} dari ${state.menuCatalog.filter((menu) => menu.active).length} menu`;
  }
}

export function initCashierGrid() {
  const filter = document.getElementById("cashierCategoryFilter");
  const search = document.getElementById("cashierSearchInput");
  if (filter) {
    filter.innerHTML = ["Semua", ...KATEGORI]
      .map((category) => `<option value="${category}">${category}</option>`)
      .join("");
    filter.addEventListener("change", renderCashierGrid);
  }
  if (search) {
    search.addEventListener("input", renderCashierGrid);
  }
  const receiptDate = document.getElementById("receiptDate");
  if (receiptDate) {
    ["change", "input"].forEach((eventName) =>
      receiptDate.addEventListener(eventName, renderCashierGrid),
    );
  }

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-menu]");
    if (addButton) {
      const menu = state.menuCatalog.find((item) => item.id === addButton.dataset.addMenu);
      if (menu) addToReceipt(menu);
      return;
    }

    const resetButton = event.target.closest("[data-reset-menu-search]");
    if (resetButton) {
      if (search) search.value = "";
      if (filter) filter.value = "Semua";
      renderCashierGrid();
    }
  });

  document.addEventListener("forecastbiz:receipt-lines-changed", () => {
    renderCashierGrid();
  });
}

export function syncCashierMenuSelection(menuId) {
  const cards = document.querySelectorAll(".menu-card");
  cards.forEach((card) => {
    const active = card.getAttribute("data-menu-id") === menuId;
    card.classList.toggle("ring-2", active);
    card.classList.toggle("ring-emerald-400", active);
    card.classList.toggle("ring-offset-1", active);
  });
}
