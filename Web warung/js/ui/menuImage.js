import { setMenuImage, uploadMenuImage, deleteMenuImage } from "../db.js";
import { colorIndexOf, initialsOf, PALET } from "../imageUtils.js";

export async function ensureMenuImage(menu, source = "") {
  if (!menu || !menu.id) return null;
  if (!menu.image_url) return null;
  try {
    const img = new Image();
    img.src = menu.image_url;
    await img.decode();
    return menu.image_url;
  } catch (error) {
    console.warn("Gambar menu rusak, kembali ke inisial.", source, error);
    return null;
  }
}

export function renderMenuImageTile(menu, options = {}) {
  const { className = "", size = "" } = options;
  const fallback = `tile-menu ${className}`.trim();

  if (!menu?.image_url) {
    const index = colorIndexOf(menu?.name || "");
    const [bg, text] = PALET[index] || PALET[0];
    return `
      <div class="${fallback} flex items-center justify-center font-black tracking-tight" style="background:${bg};color:${text};${size ? `width:${size};height:${size};` : ""}">
        ${initialsOf(menu?.name || "")}
      </div>
    `;
  }

  return `
    <div class="${fallback} overflow-hidden" style="${size ? `width:${size};height:${size};` : ""}">
      <img src="${menu.image_url}" alt="${menu.name || "Menu"}" class="h-full w-full object-cover" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='${(function () { const index = colorIndexOf(menu?.name || ""); const [bg, text] = PALET[index] || PALET[0]; return `<div class=\"flex h-full w-full items-center justify-center font-black tracking-tight\" style=\"background:${bg};color:${text};\">${initialsOf(menu?.name || "")}</div>`; })()}';" />
    </div>
  `;
}

export async function uploadAndSetMenuImage(menuId, file, { replace = false } = {}) {
  if (!file) return null;
  const allowed = ["image/webp", "image/jpeg", "image/png"];
  if (!allowed.includes(file.type)) {
    throw new Error("File harus berupa foto (JPG, PNG, atau WebP).");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Foto terlalu besar (maksimal 12 MB).");
  }

  const blob = file;
  const uploadResult = await uploadMenuImage(menuId, blob);
  if (replace && uploadResult?.path) {
    await setMenuImage(menuId, { url: uploadResult.url, path: uploadResult.path });
  }
  return uploadResult;
}

export async function removeMenuImage(menu, options = {}) {
  const { onDelete } = options;
  if (!menu?.image_path) return;
  try {
    await deleteMenuImage(menu.image_path);
    await setMenuImage(menu.id, { url: null, path: null });
    if (onDelete) onDelete();
  } catch (error) {
    console.warn("Hapus foto menu gagal.", error);
  }
}
