// =========================================================
// Utilitas umum yang dipakai di banyak modul UI
// =========================================================

export function formatRupiah(value) {
  const num = Number(value) || 0;
  return `Rp ${num.toLocaleString("id-ID")}`;
}

export function formatQuantity(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

export function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateDisplay(dateString) {
  if (!dateString) return "-";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getExpiryStatus(tanggalExpired) {
  const hariIni = new Date();
  hariIni.setHours(0, 0, 0, 0);
  const tanggalExp = new Date(`${tanggalExpired}T00:00:00`);
  const sisaHari = Math.ceil((tanggalExp - hariIni) / (1000 * 60 * 60 * 24));

  if (sisaHari <= 0) {
    return {
      sisaHari,
      status: "Expired",
      label:
        sisaHari === 0
          ? "Kedaluwarsa Hari Ini"
          : `Kedaluwarsa ${Math.abs(sisaHari)} Hari Lalu`,
      classes: "bg-rose-100 text-rose-700",
    };
  }
  if (sisaHari <= 3) {
    return {
      sisaHari,
      status: "Warning",
      label: `Sisa ${sisaHari} Hari lagi!`,
      classes: "bg-amber-100 text-amber-700",
    };
  }
  return {
    sisaHari,
    status: "Aman",
    label: `Aman, sisa ${sisaHari} Hari`,
    classes: "bg-emerald-100 text-emerald-700",
  };
}

function normalizeUnit(unit) {
  const value = (unit || "").toLowerCase().trim();
  if (value === "buah" || value === "piece" || value === "pieces") return "pcs";
  if (value === "l" || value === "liter") return "liter";
  if (value === "kilogram") return "kg";
  return value;
}

// Mengonversi takaran resep (mis. gram/ml) ke satuan stok bahan (mis. kg/liter)
export function convertRecipeAmountToStock(recipe, material) {
  const recipeUnit = normalizeUnit(recipe.unit);
  const stockUnit = normalizeUnit(material.satuan);
  if (recipeUnit === "gram" && (stockUnit === "kg" || stockUnit === "kilogram"))
    return recipe.amount / 1000;
  if (recipeUnit === "ml" && stockUnit === "liter") return recipe.amount / 1000;
  if (recipeUnit === stockUnit) return recipe.amount;
  return null;
}

export function getPriceTrend(material) {
  const history = material.priceHistory || [];
  if (history.length < 2) return "stabil";
  const previous = history[history.length - 2].price;
  const current = history[history.length - 1].price;
  if (current < previous) return "turun";
  if (current > previous) return "naik";
  return "stabil";
}
