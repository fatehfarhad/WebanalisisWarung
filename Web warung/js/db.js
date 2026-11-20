import { supabase } from "./supabaseClient.js";

// ---------- MENU CATALOG ----------
function normalizeMenuRow(row) {
  return {
    ...row,
    image_url: row?.image_url ?? undefined,
    image_path: row?.image_path ?? undefined,
    other_cost: Number(row?.other_cost) || 0,
  };
}

export function mapMenuImageError(error) {
  const message = (error && typeof error === "object" && error.message) || "";
  const lower = String(message).toLowerCase();
  const code = error && typeof error === "object" ? error.code : "";

  if (
    code === "PGRST204" ||
    lower.includes("menu-images") ||
    lower.includes("bucket") ||
    lower.includes("column \"image_url\"") ||
    lower.includes("column image_url") ||
    lower.includes("does not exist") ||
    lower.includes("not found")
  ) {
    return "Fitur foto belum aktif. Jalankan migration_menu_images.sql di Supabase.";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("offline") ||
    lower.includes("fetch")
  ) {
    return "Foto gagal diunggah. Periksa koneksi lalu coba lagi.";
  }

  return "Foto tidak bisa disimpan. Coba lagi.";
}

export async function fetchMenuCatalog() {
  const { data: menus, error } = await supabase
    .from("menu_catalog")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const { data: recipes, error: recipeError } = await supabase
    .from("menu_recipes")
    .select("*");
  if (recipeError) throw recipeError;

  return (menus || []).map((m) => ({
    ...normalizeMenuRow(m),
    recipes: (recipes || [])
      .filter((r) => r.menu_id === m.id)
      .map((r) => ({
        materialName: r.material_name,
        amount: r.amount,
        unit: r.unit,
      })),
  }));
}

export async function insertMenu(menu) {
  const payload = {
    name: menu.name,
    category: menu.category || "Makanan",
    price: menu.price,
    cost: menu.cost,
    other_cost: Number(menu.otherCost) || 0,
    active: true,
  };

  if (Object.prototype.hasOwnProperty.call(menu, "image_url")) {
    payload.image_url = menu.image_url ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(menu, "image_path")) {
    payload.image_path = menu.image_path ?? null;
  }

  const { data, error } = await supabase
    .from("menu_catalog")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  await replaceMenuRecipes(data.id, menu.recipes || []);
  return data;
}

export async function updateMenu(id, menu) {
  const payload = {
    name: menu.name,
    category: menu.category || "Makanan",
    price: menu.price,
    cost: menu.cost,
    other_cost: Number(menu.otherCost) || 0,
  };

  if (Object.prototype.hasOwnProperty.call(menu, "image_url")) {
    payload.image_url = menu.image_url ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(menu, "image_path")) {
    payload.image_path = menu.image_path ?? null;
  }

  const { error } = await supabase
    .from("menu_catalog")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
  await replaceMenuRecipes(id, menu.recipes || []);
}

export async function uploadMenuImage(menuId, blob) {
  try {
    const mime = blob?.type || "image/webp";
    const extension = mime.includes("png")
      ? "png"
      : mime.includes("webp")
        ? "webp"
        : "jpg";
    const path = `${menuId}/${Date.now()}.${extension}`;
    const uploadResult = await supabase.storage.from("menu-images").upload(path, blob, {
      contentType: mime,
      cacheControl: "31536000",
      upsert: false,
    });

    if (uploadResult.error) {
      const friendly = mapMenuImageError(uploadResult.error);
      const err = new Error(friendly);
      err.code = uploadResult.error.code || "MENU_IMAGE_UPLOAD";
      err.friendly = friendly;
      throw err;
    }

    const publicUrl = supabase.storage.from("menu-images").getPublicUrl(path);
    if (!publicUrl?.data?.publicUrl) {
      const err = new Error(mapMenuImageError(new Error("missing public url")));
      err.code = "MENU_IMAGE_PUBLIC_URL";
      err.friendly = err.message;
      throw err;
    }

    return { path, url: publicUrl.data.publicUrl };
  } catch (error) {
    const friendly = mapMenuImageError(error);
    const wrapped = new Error(friendly);
    wrapped.code = error && typeof error === "object" ? error.code : "MENU_IMAGE_UPLOAD";
    wrapped.friendly = friendly;
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function deleteMenuImage(path) {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from("menu-images").remove([path]);
    if (error) {
      console.warn("Foto menu gagal dihapus dari storage:", error);
    }
  } catch (error) {
    console.warn("Foto menu gagal dihapus dari storage:", error);
  }
}

export async function setMenuImage(menuId, { url, path }) {
  const { error } = await supabase
    .from("menu_catalog")
    .update({
      image_url: url ?? null,
      image_path: path ?? null,
    })
    .eq("id", menuId);
  if (error) throw error;
}

export async function replaceMenuRecipes(menuId, recipes) {
  const { error: delError } = await supabase
    .from("menu_recipes")
    .delete()
    .eq("menu_id", menuId);
  if (delError) throw delError;
  if (recipes.length === 0) return;
  const { error: insError } = await supabase.from("menu_recipes").insert(
    recipes.map((r) => ({
      menu_id: menuId,
      material_name: r.materialName,
      amount: r.amount,
      unit: r.unit,
    })),
  );
  if (insError) throw insError;
}

export async function setMenuActive(id, active) {
  const { error } = await supabase
    .from("menu_catalog")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteMenu(id) {
  // Keep receipt history readable even when its menu is removed from the catalog.
  const { error: receiptError } = await supabase
    .from("receipt_items")
    .update({ menu_id: null })
    .eq("menu_id", id);
  if (receiptError) throw receiptError;

  const { error } = await supabase.from("menu_catalog").delete().eq("id", id);
  if (error) throw error;
}

// ---------- RAW MATERIALS ----------
export async function fetchRawMaterials() {
  const { data: materials, error } = await supabase
    .from("raw_materials")
    .select("*")
    .order("nama", { ascending: true });
  if (error) throw error;

  const { data: batches, error: batchError } = await supabase
    .from("material_batches")
    .select("*")
    .order("tanggal_expired", { ascending: true });
  if (batchError && batchError.code !== "42P01") throw batchError;

  const { data: history, error: histError } = await supabase
    .from("material_price_history")
    .select("*")
    .order("recorded_at", { ascending: true });
  if (histError) throw histError;

  return materials.map((m) => {
    const materialBatches = (batches || [])
      .filter((b) => b.material_id === m.id)
      .sort(
        (a, b) =>
          new Date(`${b.tanggal_input}T00:00:00`) -
          new Date(`${a.tanggal_input}T00:00:00`),
      );
    const latestBatch = materialBatches[0];
    return {
      id: m.id,
      nama: m.nama,
      stok: Number(
        materialBatches.length
          ? materialBatches.reduce((sum, b) => sum + Number(b.stok), 0)
          : m.stok,
      ),
      satuan: m.satuan,
      harga: Number(latestBatch?.harga || m.harga),
      batasROP: Number(m.batas_rop),
      dayaTahanHari: Number(m.daya_tahan_hari),
      tanggalInput: m.tanggal_input,
      tanggalExpired: m.tanggal_expired,
      batches: materialBatches.map((b) => ({
        id: b.id,
        materialId: m.id,
        stok: Number(b.stok),
        harga: Number(b.harga),
        tanggalInput: b.tanggal_input,
        tanggalExpired: b.tanggal_expired,
      })),
      priceHistory: history
        .filter((h) => h.material_id === m.id)
        .map((h) => ({ date: h.label, price: Number(h.price) })),
    };
  });
}

export async function insertRawMaterial(material) {
  const { data, error } = await supabase
    .from("raw_materials")
    .insert({
      nama: material.nama,
      stok: 0,
      satuan: material.satuan,
      harga: material.harga,
      batas_rop: material.batasROP,
      daya_tahan_hari: material.dayaTahanHari,
      tanggal_input: material.tanggalInput,
      tanggal_expired: material.tanggalExpired,
    })
    .select()
    .single();
  if (error) throw error;
  await addMaterialBatch(data.id, material);
  return data;
}

export async function updateRawMaterial(
  id,
  material,
  priceChanged,
  priceLabel,
) {
  const { error } = await supabase
    .from("raw_materials")
    .update({
      nama: material.nama,
      satuan: material.satuan,
      batas_rop: material.batasROP,
      daya_tahan_hari: material.dayaTahanHari,
    })
    .eq("id", id);
  if (error) throw error;
  if (priceChanged && material.harga)
    await addPriceHistory(id, priceLabel, material.harga);
}

export async function updateRawMaterialStock(id, newStok) {
  const { error } = await supabase
    .from("raw_materials")
    .update({ stok: newStok })
    .eq("id", id);
  if (error) throw error;
}

export async function addMaterialBatch(materialId, batch) {
  const { data, error } = await supabase
    .from("material_batches")
    .insert({
      material_id: materialId,
      stok: batch.stok,
      harga: batch.harga,
      tanggal_input: batch.tanggalInput,
      tanggal_expired: batch.tanggalExpired,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: summaryError } = await supabase
    .from("raw_materials")
    .update({
      stok: batch.totalStok,
      harga: batch.harga,
      tanggal_input: batch.tanggalInput,
      tanggal_expired: batch.tanggalExpired,
    })
    .eq("id", materialId);
  if (summaryError) throw summaryError;
  await addPriceHistory(materialId, batch.tanggalInput, batch.harga);
  return data;
}

export async function updateMaterialBatchStock(batchId, materialId, newStok) {
  const { error } = await supabase
    .from("material_batches")
    .update({ stok: newStok })
    .eq("id", batchId)
    .select("id")
    .single();
  if (!error) return;
  if (error.code !== "42P01" && error.code !== "PGRST116") throw error;
  await updateRawMaterialStock(materialId, newStok);
}

export async function fetchMaterialBatchExpiryHistory(batchId) {
  const { data, error } = await supabase
    .from("material_batch_expiry_history")
    .select("old_expiry, new_expiry, reason, changed_by, created_at")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function correctMaterialBatchExpiry(
  batchId,
  newExpiry,
  reason,
  changedBy,
) {
  const { error } = await supabase.rpc("correct_material_batch_expiry", {
    p_batch_id: batchId,
    p_new_expiry: newExpiry,
    p_reason: reason,
    p_changed_by: changedBy,
  });
  if (error) throw error;
}

export async function disposeExpiredMaterialBatch(
  batchId,
  quantity,
  changedBy,
  reason,
) {
  const { data, error } = await supabase.rpc("dispose_expired_material_batch", {
    p_batch_id: batchId,
    p_quantity: quantity,
    p_changed_by: changedBy,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function fetchMaterialBatchDisposals(limit = 100) {
  const { data, error } = await supabase
    .from("material_batch_disposal_history")
    .select(
      "material_name, batch_expiry, quantity, unit, unit_cost, total_loss, changed_by, reason, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchMaterialBatchDisposalLoss() {
  const { data, error } = await supabase.rpc(
    "get_material_batch_disposal_loss",
  );
  if (error) throw error;
  return Number(data) || 0;
}

export async function deleteRawMaterial(id) {
  const { error } = await supabase.from("raw_materials").delete().eq("id", id);
  if (error) throw error;
}

export async function addPriceHistory(materialId, label, price) {
  const { error } = await supabase
    .from("material_price_history")
    .insert({ material_id: materialId, label, price });
  if (error) throw error;
}

// ---------- RECEIPTS ----------
export async function fetchReceipts(limit = 100) {
  const { data: receipts, error } = await supabase
    .from("receipts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const { data: items, error: itemError } = await supabase
    .from("receipt_items")
    .select("*");
  if (itemError) throw itemError;

  return receipts.map((r) => ({
    id: r.id,
    no: r.receipt_no,
    date: r.tanggal,
    time: r.waktu,
    total: Number(r.total),
    profit: Number(r.profit),
    items: items
      .filter((it) => it.receipt_id === r.id)
      .map((it) => ({ menuId: it.menu_id, name: it.name, qty: it.qty })),
    rincian: items
      .filter((it) => it.receipt_id === r.id)
      .map((it) => `${it.name} x${it.qty}`)
      .join(", "),
  }));
}

export async function fetchReceiptsSince(startDate) {
  const receipts = [];
  const receiptPageSize = 1000;
  for (let offset = 0; ; offset += receiptPageSize) {
    const { data, error } = await supabase
      .from("receipts")
      .select("*")
      .gte("tanggal", startDate)
      .order("tanggal", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + receiptPageSize - 1);
    if (error) throw error;
    receipts.push(...(data || []));
    if (!data || data.length < receiptPageSize) break;
  }

  const itemsByReceipt = new Map(receipts.map((receipt) => [receipt.id, []]));
  const receiptIdBatchSize = 100;
  for (let index = 0; index < receipts.length; index += receiptIdBatchSize) {
    const receiptIds = receipts
      .slice(index, index + receiptIdBatchSize)
      .map((receipt) => receipt.id);
    for (let offset = 0; ; offset += receiptPageSize) {
      const { data, error } = await supabase
        .from("receipt_items")
        .select("*")
        .in("receipt_id", receiptIds)
        .order("id", { ascending: true })
        .range(offset, offset + receiptPageSize - 1);
      if (error) throw error;
      (data || []).forEach((item) => {
        itemsByReceipt.get(item.receipt_id)?.push(item);
      });
      if (!data || data.length < receiptPageSize) break;
    }
  }

  return receipts.map((receipt) => {
    const items = itemsByReceipt.get(receipt.id) || [];
    return {
      id: receipt.id,
      no: receipt.receipt_no,
      date: receipt.tanggal,
      time: receipt.waktu,
      total: Number(receipt.total),
      profit: Number(receipt.profit),
      items: items.map((item) => ({
        menuId: item.menu_id,
        name: item.name,
        qty: Number(item.qty),
        price: Number(item.price),
        profit: Number(item.profit),
        normalPrice:
          item.normal_price === null || item.normal_price === undefined
            ? undefined
            : Number(item.normal_price),
        promoId: item.promo_id || undefined,
      })),
      rincian: items.map((item) => `${item.name} x${item.qty}`).join(", "),
    };
  });
}

export async function fetchEarliestReceiptDate() {
  const { data, error } = await supabase
    .from("receipts")
    .select("tanggal")
    .order("tanggal", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.tanggal || null;
}

export async function insertReceipt({
  receiptNo,
  tanggal,
  waktu,
  total,
  profit,
  items,
}) {
  const { data: receipt, error } = await supabase
    .from("receipts")
    .insert({ receipt_no: receiptNo, tanggal, waktu, total, profit })
    .select()
    .single();
  if (error) throw error;

  const { error: itemError } = await supabase.from("receipt_items").insert(
    items.map((it) => ({
      receipt_id: receipt.id,
      menu_id: it.menuId,
      name: it.name,
      qty: it.qty,
      price: it.price,
      subtotal: it.subtotal,
      profit: it.profit,
      ...(it.promoId
        ? { normal_price: it.normalPrice, promo_id: it.promoId }
        : {}),
    })),
  );
  if (itemError) throw itemError;
  return receipt;
}

export async function countExistingReceipts() {
  const { count, error } = await supabase
    .from("receipts")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

// ---------- DASHBOARD HISTORY ----------
export async function fetchDashboardSnapshots() {
  const { data, error } = await supabase
    .from("dashboard_daily_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false });
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return data.map((snapshot) => ({
    date: snapshot.snapshot_date,
    sales: Number(snapshot.sales),
    profit: Number(snapshot.profit),
    procurementEstimate: Number(snapshot.procurement_estimate),
    expiredLoss: Number(snapshot.expired_loss),
  }));
}

export async function upsertDashboardSnapshot(snapshot) {
  const { error } = await supabase.from("dashboard_daily_snapshots").upsert(
    {
      snapshot_date: snapshot.date,
      sales: snapshot.sales,
      profit: snapshot.profit,
      procurement_estimate: snapshot.procurementEstimate,
      expired_loss: snapshot.expiredLoss,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "snapshot_date" },
  );
  if (error && error.code !== "42P01") throw error;
}

export async function fetchSalesForecasts(startDate, endDate) {
  const { data, error } = await supabase
    .from("daily_sales_forecasts")
    .select("target_date, menu_key, predicted")
    .gte("target_date", startDate)
    .lte("target_date", endDate);
  if (error) throw error;
  return data.map((forecast) => ({
    date: forecast.target_date,
    menuId: forecast.menu_key,
    predicted: Number(forecast.predicted),
  }));
}

export async function insertSalesForecasts(forecasts) {
  if (!forecasts.length) return;
  const { error } = await supabase.from("daily_sales_forecasts").upsert(
    forecasts.map((forecast) => ({
      target_date: forecast.date,
      menu_key: forecast.menuId,
      predicted: forecast.predicted,
      issued_on: forecast.issuedOn,
    })),
    {
      onConflict: "target_date,menu_key",
      ignoreDuplicates: true,
    },
  );
  if (error) throw error;
}

// ---------- SALES EVENTS ----------
export async function fetchSalesEvents() {
  const data = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error } = await supabase
      .from("sales_events")
      .select("*")
      .order("tanggal", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
  }
  return data.map((event) => ({
    id: event.id,
    date: event.tanggal,
    menuId: event.menu_id,
    predicted: Number(event.predicted),
    actual: Number(event.actual),
    deviationPct: Number(event.deviation_pct),
    category: event.category,
    note: event.note,
    isRecurring: event.is_recurring,
    discountPct:
      event.discount_pct === null || event.discount_pct === undefined
        ? null
        : Number(event.discount_pct),
    promoId: event.promo_id || null,
  }));
}

export async function fetchPromoSalesEvents() {
  const events = await fetchSalesEvents();
  return events.filter((event) => event.category === "promo");
}

export async function fetchEventAdjustment(category) {
  const { data, error } = await supabase
    .from("sales_events")
    .select("deviation_pct")
    .eq("category", category);
  if (error) throw error;
  const adjustmentCount = data.length;
  const adjustment =
    adjustmentCount > 0
      ? data.reduce((sum, event) => sum + Number(event.deviation_pct), 0) /
        adjustmentCount
      : 0;
  return { adjustment, adjustmentCount };
}

export async function insertSalesEvent(event) {
  const { data, error } = await supabase
    .from("sales_events")
    .insert({
      tanggal: event.date,
      menu_id: event.menuId || null,
      predicted: event.predicted,
      actual: event.actual,
      deviation_pct: event.deviationPct,
      category: event.category,
      note: event.note || null,
      is_recurring: event.isRecurring,
      ...(event.discountPct === undefined
        ? {}
        : { discount_pct: event.discountPct }),
      ...(event.promoId ? { promo_id: event.promoId } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    date: data.tanggal,
    menuId: data.menu_id,
    predicted: Number(data.predicted),
    actual: Number(data.actual),
    deviationPct: Number(data.deviation_pct),
    category: data.category,
    note: data.note,
    isRecurring: data.is_recurring,
    discountPct:
      data.discount_pct === null || data.discount_pct === undefined
        ? null
        : Number(data.discount_pct),
    promoId: data.promo_id || null,
  };
}

// ---------- PROMOTIONS ----------
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function mapPromotion(promo) {
  const weekdays = (promo.weekdays || []).map(Number);
  const appliesEveryDay =
    weekdays.length === ALL_WEEKDAYS.length &&
    ALL_WEEKDAYS.every((day) => weekdays.includes(day));
  return {
    id: promo.id,
    menuId: promo.menu_id,
    normalPrice: Number(promo.normal_price),
    promoPrice: Number(promo.promo_price),
    startDate: promo.start_date,
    endDate: promo.end_date,
    weekdays: appliesEveryDay ? [] : weekdays,
    stoppedOn: promo.stopped_on,
    resultStatus: promo.result_status,
    resultNote: promo.result_note,
    source: promo.source || "manual",
    batchId: promo.batch_id || null,
    ingredientName: promo.ingredient_name || null,
    surplusUnitsEst:
      promo.surplus_units_est === null || promo.surplus_units_est === undefined
        ? null
        : Number(promo.surplus_units_est),
    createdAt: promo.created_at,
  };
}

export async function fetchPromotions({ throwOnError = false } = {}) {
  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPromotion);
  } catch (error) {
    console.warn("Daftar promo belum tersedia:", error);
    if (throwOnError) throw error;
    return [];
  }
}

export async function insertPromotion(promo) {
  try {
    const weekdays = promo.weekdays?.length
      ? promo.weekdays
      : ALL_WEEKDAYS;
    const payload = {
      menu_id: promo.menuId,
      normal_price: promo.normalPrice,
      promo_price: promo.promoPrice,
      start_date: promo.startDate,
      end_date: promo.endDate,
      weekdays,
      ...(promo.source ? { source: promo.source } : {}),
      ...(promo.batchId ? { batch_id: promo.batchId } : {}),
      ...(promo.ingredientName ? { ingredient_name: promo.ingredientName } : {}),
      ...(promo.surplusUnitsEst !== undefined && promo.surplusUnitsEst !== null
        ? { surplus_units_est: promo.surplusUnitsEst }
        : {}),
    };
    const { data, error } = await supabase
      .from("promotions")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return mapPromotion(data);
  } catch (error) {
    console.error("Gagal menyimpan promo:", error);
    throw error;
  }
}

export async function stopPromotion(id, stoppedOn) {
  try {
    const { data, error } = await supabase
      .from("promotions")
      .update({ stopped_on: stoppedOn })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return mapPromotion(data);
  } catch (error) {
    console.error("Gagal menghentikan promo:", error);
    throw error;
  }
}

export async function updatePromotionResult(id, status, note) {
  try {
    const { data, error } = await supabase
      .from("promotions")
      .update({ result_status: status, result_note: note })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return mapPromotion(data);
  } catch (error) {
    console.error("Gagal memperbarui hasil promo:", error);
    throw error;
  }
}
