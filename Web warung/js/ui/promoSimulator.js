import {
  fetchEarliestReceiptDate,
  fetchPromoSalesEvents,
  fetchReceiptsSince,
} from "../db.js";
import { state } from "../state.js";
import { formatRupiah } from "../utils.js";
import {
  buildPromoComparison,
  calculatePromoScenario,
  choosePromoUplift,
} from "../promoMath.js";
import { getRecipeCost } from "./forecasting.js";
import {
  addDays,
  calculateNormalSalesPerDay,
  getDiscountSimilarPromoEvents,
  todayLocal,
} from "../promoEval.js";
import { openPromotionForm } from "./promos.js";

const COMPARISON_DISCOUNTS = [5, 10, 15, 20, 25, 30];

let initialized = false;
let selectedMenuId = "";
let baselineEdited = false;
let upliftEdited = false;
let loadSequence = 0;
let promoEventsCache = null;

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value).toLocaleString("id-ID", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

function formatPercent(value) {
  return `${formatNumber(value * 100)}%`;
}

function formatAdditionalPortions(value) {
  return Math.ceil(Math.max(0, value) - 1e-9);
}

function formatApproximateRupiah(value) {
  const rounded = Math.round(value / 100) * 100;
  return `sekitar ${formatRupiah(rounded)}`;
}

function parseOptionalNumber(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getSelectedPromoWeekdays() {
  return [
    ...document.querySelectorAll(
      "#promoWeekdayBtns [data-promo-weekday].is-selected",
    ),
  ]
    .map((button) => Number(button.dataset.promoWeekday))
    .sort((a, b) => a - b);
}

function syncSelectedPromoWeekdayButtons(weekdays = []) {
  const selectedDays = new Set(weekdays.map(Number));
  document
    .querySelectorAll("#promoWeekdayBtns [data-promo-weekday]")
    .forEach((button) => {
      const day = Number(button.dataset.promoWeekday);
      const active = selectedDays.has(day);
      button.classList.toggle("is-selected", active);
      button.classList.toggle("bg-emerald-600", active);
      button.classList.toggle("text-white", active);
      button.classList.toggle("border-emerald-600", active);
      button.classList.toggle("bg-white", !active);
      button.classList.toggle("text-slate-600", !active);
      button.classList.toggle("border-slate-300", !active);
      button.setAttribute("aria-pressed", String(active));
    });
}

function getSelectedMenu() {
  return state.menuCatalog.find(
    (menu) => menu.id === selectedMenuId && menu.active,
  );
}

function populatePromoMenuSelect() {
  const select = document.getElementById("promoMenuSelect");
  const previousValue = select.value;
  const activeMenus = state.menuCatalog.filter((menu) => menu.active);
  select.replaceChildren();

  activeMenus.forEach((menu) => {
    const option = document.createElement("option");
    option.value = menu.id;
    option.textContent = menu.name;
    select.appendChild(option);
  });

  if (activeMenus.some((menu) => menu.id === previousValue)) {
    select.value = previousValue;
  } else if (activeMenus.length) {
    select.value = activeMenus[0].id;
  }
  return select.value;
}

function getRecipeCostWarning(menu, recipeCost) {
  const cost = Number(menu.cost) || 0;
  if (cost > 0 && recipeCost <= cost) return "";
  if (cost <= 0) {
    return (
      `HPP belum diisi. Simulasi memakai biaya dari resep (${formatRupiah(recipeCost)}), ` +
      "yang hanya mencakup bahan resep dan mungkin lebih rendah dari modal sebenarnya."
    );
  }
  return (
    `Biaya bahan dari resep (${formatRupiah(recipeCost)}) lebih tinggi dari HPP yang Anda isi ` +
    `(${formatRupiah(cost)}). Simulasi memakai angka yang lebih tinggi. Perbarui HPP di Katalog Menu jika perlu.`
  );
}

function renderCostSummary(menu, recipeCost) {
  const costSummary = document.getElementById("promoCostSummary");
  const costWarning = document.getElementById("promoCostWarning");
  const materialCost = Math.max(Number(menu.cost) || 0, recipeCost);
  const otherCost = Number(menu.other_cost) || 0;
  const profitPerPortion = Number(menu.price) - materialCost - otherCost;

  costSummary.textContent =
    `Harga jual ${formatRupiah(menu.price)} | Modal ${formatRupiah(materialCost)} | ` +
    `Biaya lain ${formatRupiah(otherCost)} | Untung per porsi ${formatRupiah(profitPerPortion)}`;
  const warning = getRecipeCostWarning(menu, recipeCost);
  costWarning.textContent = warning;
  costWarning.classList.toggle("hidden", !warning);
}

function makeScenario(menu, recipeCost) {
  return calculatePromoScenario({
    menu,
    recipeCost,
    promoPrice: parseOptionalNumber(
      document.getElementById("promoPricePromo").value,
    ),
    baselinePortions: parseOptionalNumber(
      document.getElementById("promoBaselinePortions").value,
    ),
    uplift:
      parseOptionalNumber(document.getElementById("promoUpliftPct").value) ===
      null
        ? null
        : Number(document.getElementById("promoUpliftPct").value) / 100,
  });
}

function renderResult(scenario) {
  const result = document.getElementById("promoResult");
  result.className =
    "rounded-xl border p-4 text-sm " +
    (scenario.verdict === "untung"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : scenario.verdict === "rugi" ||
          scenario.status === "normal-not-profitable" ||
          scenario.status === "promo-below-cost"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-slate-200 bg-slate-50 text-slate-700");

  if (scenario.status === "normal-not-profitable") {
    result.textContent =
      `Menu ini sudah tidak untung di harga normal (untung ${formatRupiah(scenario.normalProfitPerPortion)} per porsi). ` +
      "Periksa dulu harga jual dan modal di Katalog Menu sebelum membuat promo.";
    return;
  }
  if (scenario.status === "invalid-promo-price") {
    result.textContent =
      "Isi harga promo yang lebih dari Rp0 dan lebih rendah daripada harga jual.";
    return;
  }
  if (scenario.status === "promo-below-cost") {
    result.textContent =
      `Harga promo ${formatRupiah(scenario.promoPrice)} di bawah modal ${formatRupiah(scenario.totalCost)}. ` +
      "Setiap porsi terjual rugi, berapa pun penjualan naik.";
    return;
  }
  if (scenario.status === "promo-at-cost") {
    result.textContent =
      "Harga promo sama dengan modal. Tidak ada untung sama sekali dari promo ini.";
    return;
  }

  const breakEvenText =
    `Agar promo ini tidak merugikan, penjualan harus naik minimal ${formatPercent(scenario.breakEvenIncrease)}`;
  if (scenario.breakEvenIncrease > 1) {
    if (scenario.baselinePortions === null) {
      result.textContent =
        `${breakEvenText}. Isi penjualan normal untuk melihat jumlah porsi. ` +
        `Sangat sulit tercapai: penjualan harus naik menjadi ${formatNumber(1 + scenario.breakEvenIncrease)} kali lipat.`;
      return;
    }
  }

  const portionBreakEven =
    scenario.baselinePortions === null
      ? "."
      : ` (perlu tambahan sekitar ${formatAdditionalPortions(scenario.minimumPortions - scenario.baselinePortions)} porsi/pcs per hari; ` +
        `dari ${formatNumber(scenario.baselinePortions)} menjadi ${formatNumber(scenario.minimumPortions)} porsi per hari).`;
  let text = `${breakEvenText}${portionBreakEven}`;
  if (scenario.breakEvenIncrease > 1) {
    text +=
      ` Sangat sulit tercapai: penjualan harus naik menjadi ${formatNumber(1 + scenario.breakEvenIncrease)} kali lipat.`;
  }

  if (scenario.baselinePortions === null) {
    text += " Isi penjualan normal per hari untuk melihat jumlah porsi dan total untung.";
  } else if (scenario.verdict === "untung") {
    text +=
      ` Perkiraan UNTUNG: total untung per hari naik ${formatApproximateRupiah(Math.abs(scenario.profitDifference))}` +
      ` (dari ${formatRupiah(Math.round(scenario.normalProfitTotal / 100) * 100)} jadi ${formatApproximateRupiah(scenario.promoProfitTotal)}).`;
  } else if (scenario.verdict === "rugi") {
    text +=
      ` Perkiraan RUGI: total untung per hari turun ${formatApproximateRupiah(Math.abs(scenario.profitDifference))}` +
      ` (dari ${formatRupiah(Math.round(scenario.normalProfitTotal / 100) * 100)} jadi ${formatApproximateRupiah(scenario.promoProfitTotal)}).`;
  } else if (scenario.verdict === "impas") {
    text += " Kira-kira impas: total untung hampir sama dengan tanpa promo.";
  } else {
    text +=
      " Belum bisa diperkirakan hasilnya karena belum ada catatan promo. Isi perkiraan kenaikan penjualan Anda di atas.";
  }
  result.textContent = text;
}

function getComparisonVerdict(scenario) {
  if (!scenario.verdict) return "-";
  if (scenario.verdict === "untung") return "🟢 Untung";
  if (scenario.verdict === "rugi") return "🔴 Rugi";
  return "⚪ Impas";
}

function renderComparison(menu, recipeCost) {
  const baseline = parseOptionalNumber(
    document.getElementById("promoBaselinePortions").value,
  );
  const upliftPercent = parseOptionalNumber(
    document.getElementById("promoUpliftPct").value,
  );
  const rows = buildPromoComparison({
    menu,
    recipeCost,
    discountPercentages: COMPARISON_DISCOUNTS,
    baselinePortions: baseline,
    uplift: upliftPercent === null ? null : upliftPercent / 100,
  });
  const body = document.getElementById("promoTableBody");
  body.replaceChildren();

  rows.forEach((scenario) => {
    const row = document.createElement("tr");
    const cannotSimulate = scenario.status === "normal-not-profitable";
    const values = [
      `${scenario.discountPercentage}%`,
      cannotSimulate || scenario.promoPrice === null
        ? "-"
        : formatRupiah(scenario.promoPrice),
      cannotSimulate || scenario.promoProfitPerPortion === null
        ? "-"
        : formatRupiah(scenario.promoProfitPerPortion),
      cannotSimulate || scenario.breakEvenIncrease === null
        ? "-"
        : scenario.baselinePortions === null
          ? formatPercent(scenario.breakEvenIncrease)
          : `${formatPercent(scenario.breakEvenIncrease)} (+${formatAdditionalPortions(scenario.minimumPortions - scenario.baselinePortions)} porsi/pcs per hari)`,
      cannotSimulate ? "-" : getComparisonVerdict(scenario),
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.className = "p-3";
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function renderDiscountAmount(menu) {
  const amount = document.getElementById("promoDiscountAmount");
  const promoPrice = parseOptionalNumber(
    document.getElementById("promoPricePromo").value,
  );
  if (!menu) {
    amount.textContent = "Pilih menu untuk melihat nominal potongan.";
    return;
  }
  if (
    promoPrice === null ||
    promoPrice <= 0 ||
    promoPrice >= Number(menu.price)
  ) {
    amount.textContent =
      "Masukkan diskon (%) atau harga promo (Rp) untuk melihat nominal potongan.";
    return;
  }

  const discountAmount = Number(menu.price) - promoPrice;
  const discountPercent = (discountAmount / Number(menu.price)) * 100;
  amount.textContent =
    `Potongan ${formatNumber(discountPercent)}% = ${formatRupiah(discountAmount)}. ` +
    `Harga setelah diskon: ${formatRupiah(promoPrice)}.`;
}

function renderUpliftPortions() {
  const output = document.getElementById("promoUpliftPortions");
  const baseline = parseOptionalNumber(
    document.getElementById("promoBaselinePortions").value,
  );
  const uplift = parseOptionalNumber(
    document.getElementById("promoUpliftPct").value,
  );
  if (baseline === null || baseline <= 0 || uplift === null) {
    output.textContent =
      "Isi perkiraan penjualan normal dan kenaikan (%) untuk melihat jumlah porsi.";
    return;
  }

  const projected = Math.max(0, baseline * (1 + uplift / 100));
  const change = projected - baseline;
  const amount = formatAdditionalPortions(Math.abs(change));
  const direction =
    change > 0 ? "bertambah" : change < 0 ? "berkurang" : "tidak berubah";
  output.textContent =
    `Perkiraan penjualan ${direction} sekitar ${amount} porsi/pcs per hari ` +
    `(dari ${formatNumber(baseline)} menjadi ${formatNumber(projected)} porsi per hari).`;
}

function syncPromoDiscountSlider() {
  const discount = parseOptionalNumber(
    document.getElementById("promoDiscountPct").value,
  );
  const slider = document.getElementById("promoDiscountSlider");
  const label = document.getElementById("promoDiscountSliderValue");
  if (discount === null) {
    slider.value = "5";
    label.textContent = "5%";
    slider.setAttribute("aria-valuetext", "5 persen");
    return;
  }
  slider.value = String(Math.min(50, Math.max(5, discount)));
  label.textContent = `${formatNumber(discount)}%`;
  slider.setAttribute("aria-valuetext", `${formatNumber(discount)} persen`);
}

function renderSimulation() {
  syncPromoDiscountSlider();
  const menu = getSelectedMenu();
  const result = document.getElementById("promoResult");
  const launchButton = document.getElementById("launchPromotionButton");
  const launchHelp = document.getElementById("launchPromotionHelp");
  renderDiscountAmount(menu);
  renderUpliftPortions();
  if (!menu) {
    document.getElementById("promoCostSummary").textContent =
      "Belum ada menu aktif untuk disimulasikan.";
    document.getElementById("promoCostWarning").classList.add("hidden");
    result.textContent = "Aktifkan atau tambahkan menu untuk mulai simulasi.";
    document.getElementById("promoTableBody").replaceChildren();
    launchButton.disabled = true;
    launchHelp.textContent = "Pilih menu aktif untuk menjalankan promo.";
    return;
  }

  const recipeCost = getRecipeCost(menu);
  renderCostSummary(menu, recipeCost);
  const scenario = makeScenario(menu, recipeCost);
  renderResult(scenario);
  renderComparison(menu, recipeCost);
  const canLaunch =
    scenario.promoPrice !== null &&
    scenario.promoProfitPerPortion > 0 &&
    menu.active;
  launchButton.disabled = !canLaunch;
  launchHelp.textContent = canLaunch
    ? "Promo akan dibuat untuk menu dan harga yang sedang disimulasikan."
    : "Harga promo harus valid dan tetap menyisakan untung per porsi.";
}

async function loadNormalSales(menu, sequence) {
  const source = document.getElementById("promoBaselineSource");
  const input = document.getElementById("promoBaselinePortions");
  source.textContent = "Memuat data...";
  input.placeholder = "Memuat data...";

  const today = todayLocal();
  try {
    const [receipts, earliestDate] = await Promise.all([
      fetchReceiptsSince(addDays(today, -7)),
      fetchEarliestReceiptDate(),
    ]);
    if (sequence !== loadSequence) return;

    const { average, daysAvailable, excludedPromoDays } = calculateNormalSalesPerDay(
      receipts,
      earliestDate,
      menu.id,
      today,
      state.menuCatalog,
      state.promotions,
    );
    if (average === null || average === 0) {
      source.textContent = baselineEdited
        ? "Menu ini belum punya penjualan 7 hari terakhir. Nilai diubah manual."
        : excludedPromoDays
          ? `${excludedPromoDays} hari promo tidak dihitung. Semua hari tersedia sedang promo atau belum ada hari penjualan; isi perkiraan Anda.`
          : "Menu ini belum punya penjualan 7 hari terakhir. Isi perkiraan Anda.";
      input.placeholder = "Isi perkiraan Anda";
      if (!baselineEdited) input.value = "";
    } else {
      const averageLabel =
        daysAvailable === 7
          ? "Rata-rata 7 hari terakhir"
          : `Rata-rata ${daysAvailable} hari data toko tersedia`;
      source.textContent = baselineEdited
        ? `${averageLabel}.${excludedPromoDays ? ` ${excludedPromoDays} hari promo tidak dihitung.` : ""} Nilai diubah manual.`
        : `${averageLabel}.${excludedPromoDays ? ` ${excludedPromoDays} hari promo tidak dihitung.` : ""}`;
      input.placeholder = "Masukkan porsi per hari";
      if (!baselineEdited) {
        input.value = Number(average.toFixed(1)).toString();
      }
    }
    renderSimulation();
  } catch (error) {
    console.warn("Data penjualan normal belum dapat dimuat:", error);
    if (sequence !== loadSequence) return;
    source.textContent =
      "Data penjualan belum dapat dimuat. Isi perkiraan Anda sendiri.";
    input.placeholder = "Isi perkiraan Anda";
    renderSimulation();
  }
}

export function getPromoUpliftSource(events, menuId, discountPct) {
  const similarSelection = getDiscountSimilarPromoEvents(
    events,
    menuId,
    discountPct,
  );
  if (similarSelection?.scope === "menu") {
    const selected = chooseAverage(similarSelection.events);
    return {
      ...selected,
      source: "similar-menu",
      message: `Dari rata-rata ${selected.count} promo ber-diskon mirip (${discountPct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%) di menu ini.`,
    };
  }
  if (similarSelection?.scope === "all") {
    const selected = chooseAverage(similarSelection.events);
    return {
      ...selected,
      source: "similar-all",
      message: `Dari rata-rata ${selected.count} promo ber-diskon mirip di semua menu.`,
    };
  }

  const selected = choosePromoUplift(events, menuId);
  if (selected.source === "menu") {
    return {
      ...selected,
      message: `Dari rata-rata ${selected.count} catatan promo menu ini. Besar diskon tiap promo bisa berbeda, jadi anggap ini perkiraan kasar.`,
    };
  }
  if (selected.source === "all") {
    return {
      ...selected,
      message: `Dari rata-rata ${selected.count} catatan promo (semua menu). Besar diskon tiap promo bisa berbeda, jadi anggap ini perkiraan kasar.`,
    };
  }
  return {
    ...selected,
    message: `Baru ada ${selected.totalCount} catatan promo (minimal 3). Isi perkiraan Anda sendiri.`,
  };
}

function chooseAverage(events) {
  return {
    count: events.length,
    average:
      events.reduce((sum, event) => sum + Number(event.deviationPct), 0) /
      events.length,
  };
}

async function loadPromoUplift(menu, sequence) {
  const source = document.getElementById("promoUpliftSource");
  const input = document.getElementById("promoUpliftPct");
  source.textContent = "Memuat data...";
  input.placeholder = "Memuat data...";
  let events = [];
  try {
    events = await fetchPromoSalesEvents();
  } catch (error) {
    console.warn("Catatan promo belum dapat dimuat:", error);
  }
  if (sequence !== loadSequence) return;
  promoEventsCache = events;
  refreshPromoUpliftSource(menu);
}

function refreshPromoUpliftSource(menu) {
  if (!menu) return;
  const source = document.getElementById("promoUpliftSource");
  const input = document.getElementById("promoUpliftPct");
  const discount = parseOptionalNumber(
    document.getElementById("promoDiscountPct").value,
  );
  const sourceInfo = getPromoUpliftSource(
    promoEventsCache || [],
    menu.id,
    discount ?? NaN,
  );
  source.textContent = upliftEdited
    ? `${sourceInfo.message} Nilai diubah manual.`
    : sourceInfo.message;
  input.placeholder = "Boleh negatif";
  if (!upliftEdited) {
    input.value = sourceInfo.average !== null
      ? Number((sourceInfo.average * 100).toFixed(1)).toString()
      : "";
  }
  renderSimulation();
}

function updatePriceFromDiscount() {
  const menu = getSelectedMenu();
  const discountInput = document.getElementById("promoDiscountPct");
  const priceInput = document.getElementById("promoPricePromo");
  const discount = parseOptionalNumber(discountInput.value);
  if (!menu || discount === null) {
    priceInput.value = "";
  } else {
    priceInput.value = (
      Number(menu.price) * (1 - discount / 100)
    ).toString();
  }
  syncPromoDiscountSlider();
  renderSimulation();
  refreshPromoUpliftSource(menu);
}

function updateDiscountFromPrice() {
  const menu = getSelectedMenu();
  const priceInput = document.getElementById("promoPricePromo");
  const discountInput = document.getElementById("promoDiscountPct");
  const promoPrice = parseOptionalNumber(priceInput.value);
  if (!menu || promoPrice === null || Number(menu.price) <= 0) {
    discountInput.value = "";
  } else {
    discountInput.value = Number(
      (
        ((Number(menu.price) - promoPrice) / Number(menu.price)) *
        100
      ).toFixed(1),
    ).toString();
  }
  syncPromoDiscountSlider();
  renderSimulation();
  refreshPromoUpliftSource(menu);
}

export function initPromoSimulator() {
  if (initialized) return renderPromoSimulator();
  initialized = true;
  const menuSelect = document.getElementById("promoMenuSelect");
  menuSelect.addEventListener("change", () => {
    selectedMenuId = menuSelect.value;
    baselineEdited = false;
    upliftEdited = false;
    promoEventsCache = null;
    document.getElementById("promoBaselinePortions").value = "";
    document.getElementById("promoUpliftPct").value = "";
    document.getElementById("promoPlannedNote").classList.add("hidden");
    if (document.getElementById("promoDiscountPct").value !== "") {
      updatePriceFromDiscount();
    }
    renderPromoSimulator();
  });

  document
    .querySelectorAll("#promoWeekdayBtns [data-promo-weekday]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const active = !button.classList.contains("is-selected");
        button.classList.toggle("is-selected", active);
        button.classList.toggle("bg-emerald-600", active);
        button.classList.toggle("text-white", active);
        button.classList.toggle("border-emerald-600", active);
        button.classList.toggle("bg-white", !active);
        button.classList.toggle("text-slate-600", !active);
        button.classList.toggle("border-slate-300", !active);
        button.setAttribute("aria-pressed", String(active));
        renderPromoSimulator();
      });
    });
  document.addEventListener("forecastbiz:promo-weekdays-changed", () => {
    renderPromoSimulator();
  });

  document
    .getElementById("promoDiscountPct")
    .addEventListener("input", updatePriceFromDiscount);
  document
    .getElementById("promoDiscountSlider")
    .addEventListener("input", (event) => {
      document.getElementById("promoDiscountPct").value = event.target.value;
      syncPromoDiscountSlider();
      updatePriceFromDiscount();
    });
  document
    .getElementById("promoPricePromo")
    .addEventListener("input", updateDiscountFromPrice);
  document
    .getElementById("promoBaselinePortions")
    .addEventListener("input", (event) => {
      baselineEdited = true;
      document.getElementById("promoBaselineSource").textContent =
        "Nilai diubah manual.";
      renderSimulation();
    });
  document.getElementById("promoUpliftPct").addEventListener("input", () => {
    upliftEdited = true;
    document.getElementById("promoUpliftSource").textContent =
      "Nilai diubah manual.";
    renderSimulation();
  });
  document.querySelectorAll("[data-promo-discount]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("promoDiscountPct").value =
        button.dataset.promoDiscount;
      updatePriceFromDiscount();
    });
  });
  document
    .getElementById("launchPromotionButton")
    .addEventListener("click", () => {
      const menu = getSelectedMenu();
      if (!menu) return;
      const recipeCost = getRecipeCost(menu);
      openPromotionForm(
        menu.id,
        Number(document.getElementById("promoPricePromo").value),
        makeScenario(menu, recipeCost),
      );
    });
  return renderPromoSimulator();
}

export async function renderPromoSimulator() {
  if (!document.getElementById("promoMenuSelect")) return;
  const nextMenuId = populatePromoMenuSelect();
  if (nextMenuId !== selectedMenuId) {
    selectedMenuId = nextMenuId;
    baselineEdited = false;
    upliftEdited = false;
    promoEventsCache = null;
    document.getElementById("promoBaselinePortions").value = "";
    document.getElementById("promoUpliftPct").value = "";
    document.getElementById("promoDiscountPct").value = "";
    document.getElementById("promoPricePromo").value = "";
  }
  const menu = getSelectedMenu();
  const sequence = ++loadSequence;
  renderSimulation();
  if (menu) {
    await Promise.all([
      loadNormalSales(menu, sequence),
      loadPromoUplift(menu, sequence),
    ]);
  } else {
    document.getElementById("promoBaselineSource").textContent =
      "Pilih menu aktif untuk memuat penjualan normal.";
    document.getElementById("promoUpliftSource").textContent =
      "Pilih menu aktif untuk memuat catatan promo.";
  }
}
