import { fetchEarliestReceiptDate, fetchReceiptsSince } from "../db.js";
import { state } from "../state.js";
import { formatRupiah, toInputDate } from "../utils.js";
import {
  agregasiPorsi,
  ambilWindow,
  classifyMenus,
  MENU_BARU_HARI,
  MIN_HARI_DATA,
  MIN_MENU,
  MIN_PORSI,
  priceLiftImpact,
  priceLiftOptions,
  tambahanUntung10Porsi,
  umurHariMenu,
} from "../menuEngineering.js";
import { getRecipeCost } from "./forecasting.js";

const GROUPS = [
  {
    key: "teka_teki",
    name: "Teka-teki",
    description: "Untung per porsi besar, tetapi kurang laris. Didorong.",
    classes: "border-sky-200 bg-sky-50 text-sky-900",
    badge: "bg-sky-100 text-sky-800",
  },
  {
    key: "bintang",
    name: "Bintang",
    description: "Laris dan untung per porsi besar. Dijaga.",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-900",
    badge: "bg-emerald-100 text-emerald-800",
  },
  {
    key: "beban",
    name: "Beban",
    description: "Kurang laris dan untung per porsi kecil. Dievaluasi.",
    classes: "border-slate-200 bg-slate-100 text-slate-800",
    badge: "bg-slate-200 text-slate-700",
  },
  {
    key: "sapi_perah",
    name: "Sapi Perah",
    description: "Laris, tetapi untung per porsi kecil. Naikkan untungnya.",
    classes: "border-amber-200 bg-amber-50 text-amber-900",
    badge: "bg-amber-100 text-amber-800",
  },
];

let requestSequence = 0;

function formatPercent(value) {
  return `${Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatApproximateRupiah(value) {
  const rounded = Math.round(Math.abs(value) / 100) * 100;
  return `sekitar ${formatRupiah(rounded)}`;
}

function formatPortions(value) {
  return Number(value).toLocaleString("id-ID", {
    maximumFractionDigits: 0,
  });
}

function getEligibleMenus(todayStr, portionsByMenu) {
  const eligible = [];
  const newMenus = [];
  let inactiveCount = 0;

  state.menuCatalog.forEach((menu) => {
    if (!menu.active) {
      inactiveCount += 1;
      return;
    }
    const age = menu.created_at
      ? umurHariMenu(menu.created_at, todayStr)
      : Number.NaN;
    if (age < MENU_BARU_HARI) {
      newMenus.push({ ...menu, age });
      return;
    }
    if (!Number.isFinite(age)) return;

    const recipeCost = getRecipeCost(menu);
    const materialCost = Math.max(Number(menu.cost) || 0, recipeCost);
    const totalCost = materialCost + (Number(menu.other_cost) || 0);
    eligible.push({
      id: menu.id,
      name: menu.name,
      price: Number(menu.price),
      porsi: portionsByMenu.get(menu.id) || 0,
      untungPerPorsi: Number(menu.price) - totalCost,
      totalCost,
      warning:
        totalCost <= 0
          ? "Modal menu ini belum diisi, untung per porsi mungkin terlalu tinggi."
          : Number(menu.price) === totalCost
            ? "Harga jual sama dengan modal."
            : Number(menu.price) < totalCost
              ? "Harga jual di bawah modal."
              : "",
    });
  });
  return { eligible, newMenus, inactiveCount };
}

function makeElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderNewMenus(newMenus) {
  const container = document.getElementById("menuEngNewMenus");
  container.replaceChildren();
  container.classList.toggle("hidden", newMenus.length === 0);
  if (!newMenus.length) return;

  container.appendChild(
    makeElement(
      "h4",
      "font-bold text-slate-800",
      "Menu baru (belum dinilai)",
    ),
  );
  const list = makeElement(
    "ul",
    "list-disc space-y-1 pl-5 text-sm text-slate-600",
  );
  newMenus.forEach((menu) => {
    list.appendChild(
      makeElement(
        "li",
        "",
        `${menu.name}: baru ${formatPortions(menu.age)} hari, dinilai setelah ${MENU_BARU_HARI} hari.`,
      ),
    );
  });
  container.appendChild(list);
}

function createTableCell(row, text, className = "p-3") {
  const cell = makeElement("td", className, text);
  row.appendChild(cell);
  return cell;
}

function renderTable(items, classified) {
  const body = document.getElementById("menuEngTableBody");
  const table = document.getElementById("menuEngTable");
  body.replaceChildren();
  table.classList.toggle("min-w-[760px]", classified);
  table.classList.toggle("min-w-[420px]", !classified);
  document.getElementById("menuEngContributionHeader").classList.toggle(
    "hidden",
    !classified,
  );
  document.getElementById("menuEngClassHeader").classList.toggle(
    "hidden",
    !classified,
  );
  document.getElementById("menuEngProfitHeader").classList.toggle(
    "hidden",
    !classified,
  );

  const sorted = [...items].sort((a, b) =>
    classified
      ? b.totalUntungMenu - a.totalUntungMenu
      : b.porsi - a.porsi,
  );
  sorted.forEach((item) => {
    const row = document.createElement("tr");
    row.className = "border-t border-slate-100";
    const nameCell = createTableCell(row, "");
    nameCell.appendChild(makeElement("span", "font-semibold", item.name));
    if (item.warning) {
      const warning = makeElement("span", "ml-2 text-amber-600", "⚠");
      warning.title = item.warning;
      warning.setAttribute("role", "img");
      warning.setAttribute("aria-label", item.warning);
      nameCell.appendChild(warning);
    }
    createTableCell(
      row,
      classified
        ? `${formatPortions(item.porsi)} porsi (${formatPercent(item.persenPorsi)})`
        : `${formatPortions(item.porsi)} porsi`,
    );
    createTableCell(row, formatRupiah(item.untungPerPorsi));
    if (classified) {
      createTableCell(row, formatRupiah(item.totalUntungMenu));
      createTableCell(row, formatPercent(item.persenUntung));
      const group = GROUPS.find((candidate) => candidate.key === item.kelas);
      const classCell = createTableCell(row, "");
      classCell.appendChild(
        makeElement(
          "span",
          `rounded-full px-2.5 py-1 text-xs font-bold ${group.badge}`,
          group.name,
        ),
      );
    }
    body.appendChild(row);
  });
}

function renderThreshold(result, period) {
  const allowance = result.totalPorsi / result.n;
  document.getElementById("menuEngThreshold").textContent =
    `Menu dianggap laris jika terjual minimal ${formatPortions(result.batasPorsiTampil)} porsi dalam ${period} hari ` +
    `(70% dari jatah rata-rata tiap menu, ${formatPortions(allowance)} porsi). ` +
    `Untung per porsi dianggap besar jika di atas rata-rata toko, yaitu ${formatRupiah(Math.round(result.rataUntungPerPorsi))}.`;
}

function renderGrid(items) {
  const grid = document.getElementById("menuEngGrid");
  grid.replaceChildren();
  const wrapper = makeElement("div", "space-y-2");
  wrapper.appendChild(
    makeElement(
      "p",
      "text-[11px] text-slate-500",
      "Atas ke bawah: untung per porsi besar → kecil",
    ),
  );
  const axisGrid = makeElement("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
  GROUPS.forEach((group) => {
    const members = items.filter((item) => item.kelas === group.key);
    const card = makeElement(
      "section",
      `min-h-32 rounded-xl border p-4 ${group.classes}`,
    );
    const heading = makeElement("div", "flex items-center justify-between gap-2");
    heading.appendChild(makeElement("h4", "font-bold", group.name));
    heading.appendChild(
      makeElement(
        "span",
        "rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold",
        `${members.length} menu`,
      ),
    );
    card.appendChild(heading);
    card.appendChild(
      makeElement("p", "mt-1 text-xs opacity-80", group.description),
    );
    const list = makeElement("ul", "mt-3 space-y-1 text-sm");
    if (!members.length) {
      list.appendChild(makeElement("li", "opacity-70", "Tidak ada menu"));
    } else {
      members.forEach((item) =>
        list.appendChild(makeElement("li", "", item.name)),
      );
    }
    card.appendChild(list);
    axisGrid.appendChild(card);
  });
  wrapper.appendChild(axisGrid);
  wrapper.appendChild(
    makeElement(
      "p",
      "text-right text-[11px] text-slate-500",
      "Kiri ke kanan: kurang laris → laris",
    ),
  );
  grid.appendChild(wrapper);
}

function actionText(item, group, result, period) {
  const zeroSales =
    item.porsi === 0
      ? `Belum terjual sama sekali dalam ${period} hari. `
      : "";
  if (group === "bintang") {
    return (
      `${zeroSales}Laris dan untungnya besar: menyumbang ${formatPercent(item.persenUntung)} dari total untung. ` +
      "Pertimbangkan untuk mempertahankan menu ini, tidak memberi diskon, dan memastikan bahan utamanya selalu tersedia."
    );
  }
  if (group === "teka_teki") {
    return (
      `${zeroSales}Untung per porsi besar (${formatRupiah(item.untungPerPorsi)}) tapi baru terjual ${formatPortions(item.porsi)} porsi. ` +
      `Setiap tambahan 10 porsi menambah untung ${formatApproximateRupiah(tambahanUntung10Porsi(item.untungPerPorsi))} per ${period} hari. ` +
      "Coba dorong lewat tawaran dari kasir atau tempatkan di posisi menonjol di daftar menu. " +
      "Jika ingin menguji promo untuk menu ini, hitung dulu di Simulasi Promo di atas."
    );
  }

  const opening =
    `${zeroSales}${group === "sapi_perah" ? "Laris" : "Kurang laris"} ` +
    `(${formatPortions(item.porsi)} porsi, ${formatPercent(item.persenPorsi)} dari semua porsi) ` +
    (group === "sapi_perah"
      ? `tapi untung per porsi ${formatRupiah(item.untungPerPorsi)}`
      : `dan untung per porsi kecil (${formatRupiah(item.untungPerPorsi)})`);
  if (item.untungPerPorsi <= 0) {
    return `${opening}. Harga jual sama dengan atau di bawah modal. Naikkan harga atau turunkan modal dulu.`;
  }

  if (group === "sapi_perah") {
    const options = priceLiftOptions(item.price);
    const impacts = options.map((delta) => ({
      delta,
      impact: priceLiftImpact({
        porsi: item.porsi,
        untungPerPorsi: item.untungPerPorsi,
        delta,
      }),
    }));
    const highProfitText =
      ` di bawah rata-rata toko ${formatRupiah(Math.round(result.rataUntungPerPorsi))}. ` +
      "Pertimbangkan naikkan harga sedikit:";
    const lines = impacts.map(
      ({ delta, impact }) =>
        `- Naik ${formatRupiah(delta)}: aman selama penjualan turun kurang dari ${formatPercent(impact.maxTurunPct)} ` +
        `(tidak di bawah ${formatPortions(impact.porsiMinimalAman)} porsi per ${period} hari).`,
    );
    const largest = impacts[impacts.length - 1];
    const difference = largest.impact.selisihTurun5;
    const changeText =
      difference >= 0
        ? `untung ${period} hari tetap naik ${formatApproximateRupiah(difference)}`
        : `untung justru turun ${formatApproximateRupiah(difference)}`;
    return (
      `${opening}${highProfitText}\n${lines.join("\n")}\n` +
      `Contoh: jika penjualan turun 5% (jadi ${formatPortions(largest.impact.porsiTurun5)} porsi), ${changeText} ` +
      `(untuk kenaikan ${formatRupiah(largest.delta)}). Ini batas hitungan, bukan jaminan: coba di satu menu dulu dan pantau 2 minggu.`
    );
  }

  const delta = priceLiftOptions(item.price)[0];
  const impact = priceLiftImpact({
    porsi: item.porsi,
    untungPerPorsi: item.untungPerPorsi,
    delta,
  });
  return (
    `${opening}; hanya menyumbang ${formatPercent(item.persenUntung)} dari total untung. ` +
    `Pertimbangkan: naikkan harga ${formatRupiah(delta)} (aman selama penjualan turun kurang dari ${formatPercent(impact.maxTurunPct)}), ` +
    "turunkan modal, atau ganti dengan menu yang lebih menguntungkan. " +
    "Jika menu ini memang pelengkap yang dicari pelanggan, boleh tetap dipertahankan."
  );
}

function renderActions(items, result, period) {
  const actions = document.getElementById("menuEngActions");
  actions.replaceChildren();
  const ordered = GROUPS.flatMap((group) => {
    const groupItems = items.filter((item) => item.kelas === group.key);
    groupItems.sort((a, b) => {
      if (group.key === "teka_teki")
        return b.untungPerPorsi - a.untungPerPorsi;
      if (group.key === "sapi_perah") return b.porsi - a.porsi;
      if (group.key === "beban")
        return a.persenUntung - b.persenUntung;
      return b.totalUntungMenu - a.totalUntungMenu;
    });
    return groupItems.map((item) => ({ item, group }));
  });
  if (!ordered.length) {
    actions.classList.add("hidden");
    return;
  }
  actions.classList.remove("hidden");
  actions.appendChild(
    makeElement("h4", "font-bold text-slate-800", "Tindakan yang disarankan"),
  );
  ordered.forEach(({ item, group }) => {
    const block = makeElement(
      "article",
      "rounded-xl border border-slate-200 bg-white p-4",
    );
    const heading = makeElement(
      "div",
      "mb-2 flex flex-wrap items-center gap-2 font-semibold text-slate-800",
    );
    heading.appendChild(makeElement("span", "", item.name));
    heading.appendChild(
      makeElement(
        "span",
        `rounded-full px-2.5 py-1 text-xs font-bold ${group.badge}`,
        group.name,
      ),
    );
    block.appendChild(heading);
    block.appendChild(
      makeElement(
        "p",
        "whitespace-pre-line text-sm leading-6 text-slate-600",
        actionText(item, group.key, result, period),
      ),
    );
    actions.appendChild(block);
  });
}

function showInsufficientData(result, eligibleCount, availableDays) {
  const status = document.getElementById("menuEngStatus");
  const grid = document.getElementById("menuEngGrid");
  const actions = document.getElementById("menuEngActions");
  const threshold = document.getElementById("menuEngThreshold");
  grid.replaceChildren();
  actions.replaceChildren();
  actions.classList.add("hidden");
  threshold.textContent = "";

  if (
    result.reason === "untung_tidak_positif" &&
    availableDays >= MIN_HARI_DATA
  ) {
    status.textContent =
      "Total untung dari menu-menu ini nol atau negatif. Periksa harga jual dan modal di Katalog Menu dulu.";
    return;
  }
  status.textContent =
    `Data belum cukup untuk mengelompokkan menu. Dibutuhkan: minimal ${MIN_HARI_DATA} hari data struk ` +
    `(sekarang ${availableDays} hari), minimal ${MIN_PORSI} porsi terjual (sekarang ${formatPortions(result.totalPorsi)}), ` +
    `dan minimal ${MIN_MENU} menu yang sudah lebih dari ${MENU_BARU_HARI} hari (sekarang ${eligibleCount}).`;
}

export function initMenuEngineeringCard() {
  const period = document.getElementById("menuEngPeriod");
  if (!period || period.dataset.initialized) return;
  period.dataset.initialized = "true";
  period.value = "30";
  period.addEventListener("change", renderMenuEngineeringCard);
}

export async function renderMenuEngineeringCard() {
  const periodSelect = document.getElementById("menuEngPeriod");
  if (!periodSelect) return;
  const sequence = ++requestSequence;
  const period = Number(periodSelect.value);
  const todayStr = toInputDate(new Date());
  const { start, end } = ambilWindow(period, todayStr);
  const status = document.getElementById("menuEngStatus");
  const threshold = document.getElementById("menuEngThreshold");
  status.textContent = "Memuat data penjualan...";
  threshold.textContent = "";
  document.getElementById("menuEngGrid").replaceChildren();
  document.getElementById("menuEngActions").replaceChildren();
  document.getElementById("menuEngActions").classList.add("hidden");

  let receipts;
  let earliestDate;
  try {
    [receipts, earliestDate] = await Promise.all([
      fetchReceiptsSince(start),
      fetchEarliestReceiptDate(),
    ]);
  } catch (error) {
    if (sequence !== requestSequence) return;
    console.warn("Peta menu belum dapat memuat data penjualan:", error);
    status.textContent = "Data penjualan belum bisa dimuat. Coba lagi nanti.";
    threshold.textContent = "";
    document.getElementById("menuEngNotes").textContent = "";
    document.getElementById("menuEngGrid").replaceChildren();
    document.getElementById("menuEngTableBody").replaceChildren();
    document.getElementById("menuEngActions").replaceChildren();
    document.getElementById("menuEngActions").classList.add("hidden");
    document.getElementById("menuEngNewMenus").replaceChildren();
    document.getElementById("menuEngNewMenus").classList.add("hidden");
    return;
  }
  if (sequence !== requestSequence) return;

  const availableDays = earliestDate
    ? Math.max(
        0,
        Math.round(
          (new Date(`${todayStr}T00:00:00`) -
            new Date(`${earliestDate}T00:00:00`)) /
            86400000,
        ),
      )
    : 0;
  const portionsByMenu = agregasiPorsi(receipts, start, end);
  const { eligible, newMenus, inactiveCount } = getEligibleMenus(
    todayStr,
    portionsByMenu,
  );
  renderNewMenus(newMenus);

  const notes = [];
  if (availableDays < period)
    notes.push(`Data yang tersedia baru ${availableDays} hari.`);
  if (inactiveCount)
    notes.push(`${inactiveCount} menu non-aktif tidak dihitung.`);
  document.getElementById("menuEngNotes").textContent = notes.join(" ");

  const result = classifyMenus(eligible);
  const enoughDays = availableDays >= MIN_HARI_DATA;
  const canClassify = result.ok && enoughDays;
  renderTable(canClassify ? result.items : eligible, canClassify);
  if (!enoughDays) {
    showInsufficientData(result, eligible.length, availableDays);
    return;
  }
  if (!result.ok) {
    showInsufficientData(result, eligible.length, availableDays);
    return;
  }

  status.textContent = `Periode ${period} hari: ${start} sampai ${end}.`;
  renderThreshold(result, period);
  renderGrid(result.items);
  renderActions(result.items, result, period);
}
