import { state, reloadMenuCatalog } from "../state.js";
import {
  insertMenu,
  updateMenu,
  setMenuActive,
  deleteMenu,
  uploadMenuImage,
  deleteMenuImage,
  setMenuImage,
} from "../db.js";
import { formatRupiah } from "../utils.js";
import { openModal, closeModal, openActionConfirmation } from "./modals.js";
import { getPriceForDate, getPromoStatus, todayLocal } from "../promoEval.js";
import { DAY_NAMES } from "./promos.js";
import { KATEGORI, colorIndexOf, initialsOf, PALET } from "../imageUtils.js";

function getMenuPriceCell(menu) {
  const today = todayLocal();
  const { promo } = getPriceForDate(menu, state.promotions, today);
  if (promo) {
    return `<span class="mr-1 text-slate-400 line-through">${formatRupiah(menu.price)}</span><span class="rounded bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">PROMO ${formatRupiah(promo.promoPrice)}</span>`;
  }
  const activePromo = state.promotions.find(
    (candidate) =>
      candidate.menuId === menu.id &&
      getPromoStatus(candidate) === "berjalan",
  );
  const days = activePromo?.weekdays || [];
  const schedule =
    !days.length || days.length === 7
      ? "setiap hari"
      : days.map((day) => DAY_NAMES[day]).join(", ");
  return `<span>${formatRupiah(menu.price)}</span>${activePromo ? `<small class="ml-2 block text-slate-500">Promo tiap ${schedule}</small>` : ""}`;
}

export function renderMenuCatalogTable() {
  const tbody = document.getElementById("menuCatalogTableBody");
  tbody.innerHTML = "";

  state.menuCatalog.forEach((m) => {
    const profit = m.price - m.cost - (Number(m.other_cost) || 0);
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-4 font-bold text-slate-800">${m.name}</td>
        <td class="p-4"><span class="px-2 py-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">${m.category}</span></td>
        <td class="p-4 font-semibold">${getMenuPriceCell(m)}</td>
        <td class="p-4 text-slate-500">${formatRupiah(m.cost)}</td>
        <td class="p-4 font-bold text-emerald-600">${formatRupiah(profit)}</td>
        <td class="p-4">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${m.active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}">
            ${m.active ? "Aktif" : "Non-Aktif"}
          </span>
        </td>
        <td class="p-4 text-center">
          <button onclick="openMenuForm('${m.id}')" title="Edit menu dan resep" class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="requestMenuStatusChange('${m.id}')" class="text-xs px-3 py-1 border rounded-lg hover:bg-slate-100 font-semibold text-slate-600">
            ${m.active ? "Nonaktifkan" : "Aktifkan"}
          </button>
          <button onclick="requestMenuDelete('${m.id}')" title="Hapus menu" class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
  });
}

export function populateMenuDropdowns() {
  const receiptSelect = document.getElementById("receiptMenuSelect");
  const chartSelect = document.getElementById("forecastChartMenuSelect");

  receiptSelect.innerHTML = "";
  chartSelect.innerHTML =
    '<option value="ALL">📊 Semua Menu (Semua Kurva Tren)</option>';

  state.menuCatalog
    .filter((m) => m.active)
    .forEach((m) => {
      const date =
        document.getElementById("receiptDate")?.value || todayLocal();
      const { price, promo } = getPriceForDate(m, state.promotions, date);
      receiptSelect.innerHTML += `<option value="${m.id}">${m.name} (${formatRupiah(price)}${promo ? " promo" : ""})</option>`;
      chartSelect.innerHTML += `<option value="${m.id}">${m.name}</option>`;
    });
}

export function requestMenuStatusChange(id) {
  const item = state.menuCatalog.find((m) => m.id === id);
  if (!item) return;
  const nextStatus = item.active ? "menonaktifkan" : "mengaktifkan";
  openActionConfirmation(
    "Verifikasi Status Menu",
    `Anda akan ${nextStatus} menu ini.`,
    `<b>${item.name}</b><br/>Status saat ini: ${item.active ? "Aktif" : "Non-Aktif"}<br/>Status setelah tindakan: ${item.active ? "Non-Aktif" : "Aktif"}`,
    () => toggleMenuStatus(id),
  );
}

async function toggleMenuStatus(id) {
  const item = state.menuCatalog.find((m) => m.id === id);
  if (!item) return;
  await setMenuActive(id, !item.active);
  await reloadMenuCatalog();
  renderMenuCatalogTable();
  populateMenuDropdowns();
  document.dispatchEvent(new CustomEvent("forecastbiz:menu-changed"));
}

export function requestMenuDelete(id) {
  const item = state.menuCatalog.find((m) => m.id === id);
  if (!item) return;
  openActionConfirmation(
    "Verifikasi Hapus Menu",
    "Menu akan dihapus dari katalog.",
    `<b>${item.name}</b><br/>Resep menu juga akan dihapus dari katalog.<br/><span class="text-amber-700">Riwayat transaksi tetap dipertahankan.</span>`,
    () => deleteMenuConfirmed(id),
  );
}

async function deleteMenuConfirmed(id) {
  await deleteMenu(id);
  await reloadMenuCatalog();
  renderMenuCatalogTable();
  populateMenuDropdowns();
  document.dispatchEvent(new CustomEvent("forecastbiz:menu-changed"));
  alert("Menu berhasil dihapus dari katalog.");
}

function renderMenuImagePreview(menu) {
  const preview = document.getElementById("newMenuImagePreview");
  const status = document.getElementById("newMenuImageStatus");
  if (!preview || !status) return;

  if (!menu?.image_url) {
    preview.innerHTML = "";
    status.textContent = "Belum ada foto menu.";
    return;
  }

  const idx = colorIndexOf(menu.name || "");
  const [bg, text] = PALET[idx] || PALET[0];
  preview.innerHTML = `
    <div class="relative h-28 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <img src="${menu.image_url}" alt="${menu.name || "Menu"}" class="h-full w-full object-cover" />
      <button type="button" data-action="remove-menu-photo" class="absolute right-2 top-2 rounded-full bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white">Hapus foto</button>
    </div>
  `;
  status.textContent = "Foto aktif.";
  preview.querySelector("[data-action='remove-menu-photo']")?.addEventListener("click", () => {
    document.getElementById("newMenuPhotoRemove").value = "1";
    renderMenuImagePreview({ ...menu, image_url: "" });
  });
}

export function openMenuForm(id = "") {
  const menu = state.menuCatalog.find((item) => item.id === id);
  document.getElementById("editingMenuId").value = id;
  document.getElementById("menuFormTitle").innerText = menu
    ? "Edit Menu & Resep"
    : "Tambah Menu F&B Baru";
  document.getElementById("newMenuName").value = menu ? menu.name : "";
  document.getElementById("newMenuCategory").value = menu
    ? menu.category || "Makanan"
    : "Makanan";
  document.getElementById("newMenuPrice").value = menu ? menu.price : "";
  document.getElementById("newMenuCost").value = menu ? menu.cost : "";
  document.getElementById("newMenuOtherCost").value = menu
    ? Number(menu.other_cost) || 0
    : "";
  document.getElementById("newMenuPhotoInput").value = "";
  document.getElementById("newMenuPhotoRemove").value = "";
  renderMenuImagePreview(menu || null);
  clearRecipeRows();
  (menu?.recipes || []).forEach((recipe) => addRecipeRow(recipe));
  openModal("modal-add-menu");
}

export function addRecipeRow(recipe = null) {
  const container = document.getElementById("newMenuRecipeRows");
  const emptyMessage = document.getElementById("newMenuRecipeEmpty");
  const row = document.createElement("div");
  row.className = "grid grid-cols-[1fr_5rem_5.5rem_2rem] gap-2 items-center";
  row.innerHTML = `<select class="recipe-material p-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500">${state.rawMaterials
    .map(
      (material) =>
        `<option value="${material.nama}">${material.nama} (${material.satuan})</option>`,
    )
    .join(
      "",
    )}</select><input type="number" min="0.01" step="0.01" value="${recipe?.amount || ""}" class="recipe-amount p-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Takaran"><select class="recipe-unit p-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500"><option value="gram" ${recipe?.unit === "gram" ? "selected" : ""}>gram</option><option value="ml" ${recipe?.unit === "ml" ? "selected" : ""}>ml</option><option value="liter" ${recipe?.unit === "liter" ? "selected" : ""}>liter</option><option value="pcs" ${recipe?.unit === "pcs" ? "selected" : ""}>pcs</option></select><button type="button" onclick="this.parentElement.remove(); updateRecipeEmptyState()" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>`;
  if (recipe) row.querySelector(".recipe-material").value = recipe.materialName;
  container.appendChild(row);
  emptyMessage.classList.add("hidden");
}

export function updateRecipeEmptyState() {
  const container = document.getElementById("newMenuRecipeRows");
  document
    .getElementById("newMenuRecipeEmpty")
    .classList.toggle("hidden", container.children.length > 0);
}

function clearRecipeRows() {
  const container = document.getElementById("newMenuRecipeRows");
  if (!container) return;
  container.innerHTML = "";
  updateRecipeEmptyState();
}

function collectRecipeRows() {
  return [...document.querySelectorAll("#newMenuRecipeRows > div")]
    .map((row) => ({
      materialName: row.querySelector(".recipe-material").value,
      amount: parseFloat(row.querySelector(".recipe-amount").value),
      unit: row.querySelector(".recipe-unit").value,
    }))
    .filter((r) => r.materialName && Number.isFinite(r.amount) && r.amount > 0);
}

export async function addNewMenuItem() {
  const editingMenuId = document.getElementById("editingMenuId").value;
  const name = document.getElementById("newMenuName").value.trim();
  const category = document.getElementById("newMenuCategory").value || "Makanan";
  const price = parseFloat(document.getElementById("newMenuPrice").value) || 0;
  const cost = parseFloat(document.getElementById("newMenuCost").value) || 0;
  const otherCost =
    parseFloat(document.getElementById("newMenuOtherCost").value) || 0;
  const recipes = collectRecipeRows();
  const file = document.getElementById("newMenuPhotoInput")?.files?.[0] || null;
  const removePhoto = document.getElementById("newMenuPhotoRemove").value === "1";

  if (!name || price <= 0) {
    alert("Mohon isi nama menu dan harga jual secara valid!");
    return;
  }
  if (recipes.length === 0) {
    alert("Tambahkan minimal satu bahan baku dan takarannya untuk resep menu!");
    return;
  }

  try {
    const currentMenu = state.menuCatalog.find((item) => item.id === editingMenuId);
    if (editingMenuId) {
      const nextPayload = {
        name,
        category,
        price,
        cost,
        otherCost,
        recipes,
      };

      if (file) {
        nextPayload.image_url = currentMenu?.image_url || undefined;
        nextPayload.image_path = currentMenu?.image_path || undefined;
      } else if (removePhoto) {
        nextPayload.image_url = null;
        nextPayload.image_path = null;
      }

      await updateMenu(editingMenuId, nextPayload);

      if (file) {
        const upload = await uploadMenuImage(editingMenuId, file);
        await setMenuImage(editingMenuId, upload);
      } else if (removePhoto && currentMenu?.image_path) {
        await deleteMenuImage(currentMenu.image_path);
        await setMenuImage(editingMenuId, { url: null, path: null });
      }
    } else {
      const created = await insertMenu({
        name,
        category,
        price,
        cost,
        otherCost,
        recipes,
      });
      if (file) {
        const uploaded = await uploadMenuImage(created.id, file);
        await setMenuImage(created.id, uploaded);
      }
    }
  } catch (error) {
    console.error("Gagal menyimpan menu:", error);
    const message = error && typeof error === "object" && error.friendly
      ? error.friendly
      : "Menu belum tersimpan. Periksa koneksi dan pastikan migration biaya lain sudah dijalankan di Supabase.";
    alert(message);
    return;
  }

  document.getElementById("newMenuName").value = "";
  document.getElementById("newMenuCategory").value = "Makanan";
  document.getElementById("newMenuPrice").value = "";
  document.getElementById("newMenuCost").value = "";
  document.getElementById("newMenuOtherCost").value = "";
  document.getElementById("newMenuPhotoInput").value = "";
  document.getElementById("newMenuPhotoRemove").value = "";
  document.getElementById("editingMenuId").value = "";
  clearRecipeRows();
  closeModal("modal-add-menu");

  await reloadMenuCatalog();
  renderMenuCatalogTable();
  populateMenuDropdowns();
  document.dispatchEvent(new CustomEvent("forecastbiz:menu-changed"));
  alert(
    editingMenuId
      ? "Menu dan resep berhasil diperbarui."
      : "Menu baru berhasil ditambahkan.",
  );
}

export function openMenuPhotoPicker() {
  document.getElementById("newMenuPhotoInput")?.click();
}

export function handleMenuPhotoSelection(event) {
  const file = event.target.files?.[0];
  const preview = document.getElementById("newMenuImagePreview");
  const status = document.getElementById("newMenuImageStatus");
  const removeFlag = document.getElementById("newMenuPhotoRemove");
  if (removeFlag) removeFlag.value = "";

  if (!file) {
    status.textContent = "Belum ada foto menu.";
    preview.innerHTML = "";
    return;
  }

  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!validTypes.includes(file.type)) {
    alert("File harus berupa foto (JPG, PNG, atau WebP).");
    event.target.value = "";
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    alert("Foto terlalu besar (maksimal 12 MB).");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    preview.innerHTML = `
      <div class="relative h-28 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <img src="${reader.result}" alt="Pratinjau foto" class="h-full w-full object-cover" />
        <button type="button" data-action="remove-menu-photo" class="absolute right-2 top-2 rounded-full bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white">Hapus foto</button>
      </div>
    `;
    status.textContent = "Foto siap diunggah.";
    preview.querySelector("[data-action='remove-menu-photo']")?.addEventListener("click", () => {
      event.target.value = "";
      document.getElementById("newMenuPhotoRemove").value = "1";
      preview.innerHTML = "";
      status.textContent = "Belum ada foto menu.";
    });
  };
  reader.readAsDataURL(file);
}
