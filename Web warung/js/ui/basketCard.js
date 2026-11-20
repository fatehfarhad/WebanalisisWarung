import {
  liftLabel,
  PERIODE_DEFAULT,
  SKENARIO_PERSEN,
  simulateOffer,
  WARN_MULTI_PCT,
} from "../marketBasket.js";
import { formatRupiah } from "../utils.js";
import { loadBasketAnalysis } from "./basketData.js";

let initialized = false;
let requestSequence = 0;
let lastLoaded = null;

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatApproximateRupiah(value) {
  const rounded = Math.round(Math.abs(value) / 100) * 100;
  return `sekitar ${formatRupiah(rounded)}`;
}

function formatPortions(value, menuName) {
  const quantity = Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${quantity} porsi ${menuName}`;
}

function clearDetails() {
  ["basketSummary", "basketRecs", "basketRare", "basketSim", "basketNote"].forEach(
    (id) => {
      const node = document.getElementById(id);
      if (node) {
        node.replaceChildren();
        node.classList.add("hidden");
      }
    },
  );
}

function statusForFailure(analysis) {
  if (analysis.reason === "terlalu_sedikit_struk") {
    return `Data belum cukup untuk mencari pasangan menu. Dibutuhkan minimal 50 struk dalam periode ini (sekarang ${analysis.N}).`;
  }
  if (analysis.reason === "terlalu_sedikit_menu") {
    return "Dibutuhkan minimal 2 menu aktif yang sudah dijual lebih dari 14 hari.";
  }
  return "Semua struk berisi satu menu saja, jadi belum ada pasangan yang bisa dicari. Jika pelanggan sering memesan lebih dari satu menu, pastikan semua pesanan satu pelanggan dicatat dalam satu struk.";
}

function renderSummary(result, period) {
  const summary = document.getElementById("basketSummary");
  summary.replaceChildren();
  summary.classList.remove("hidden");
  const analysis = result.analysis;
  summary.appendChild(
    element(
      "p",
      "text-sm text-slate-700",
      `Dari ${analysis.N} struk dalam ${period} hari terakhir, ${analysis.multiItemReceipts} struk (${formatNumber(analysis.sharePctMulti)}%) berisi 2 menu atau lebih. Rata-rata ${formatNumber(analysis.avgDistinct)} menu per struk.`,
    ),
  );
  if (result.jumlahHariData < period) {
    summary.appendChild(
      element(
        "p",
        "mt-2 text-xs text-slate-500",
        `Data yang tersedia baru ${result.jumlahHariData} hari.`,
      ),
    );
  }
  if (100 * analysis.multiItemReceipts < WARN_MULTI_PCT * analysis.N) {
    summary.appendChild(
      element(
        "p",
        "mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800",
        `Hanya ${formatNumber(analysis.sharePctMulti)}% struk berisi lebih dari satu menu. Jika pelanggan sering memesan beberapa menu sekaligus, pastikan satu pesanan dicatat dalam satu struk.`,
      ),
    );
  }
  if (result.menusNote > 0) {
    summary.appendChild(
      element(
        "p",
        "mt-2 text-xs text-slate-500",
        `${result.menusNote} menu baru atau non-aktif tidak diikutkan.`,
      ),
    );
  }
}

function renderRecommendations(recs, period) {
  const container = document.getElementById("basketRecs");
  container.replaceChildren();
  container.classList.remove("hidden");
  container.appendChild(
    element("h4", "font-bold text-slate-800", "Tawaran yang disarankan di kasir"),
  );
  if (!recs.length) {
    container.appendChild(
      element(
        "p",
        "rounded-xl bg-slate-50 p-4 text-sm text-slate-600",
        "Belum ada pasangan menu yang cukup kuat untuk disarankan. Daftar ini terisi otomatis seiring struk baru.",
      ),
    );
    return;
  }

  recs.slice(0, 5).forEach((rec, index) => {
    const card = element(
      "article",
      "space-y-2 rounded-xl border border-slate-200 bg-white p-4",
    );
    card.appendChild(
      element(
        "h5",
        "font-semibold text-slate-800",
        `Struk berisi ${rec.fromName} → tawarkan ${rec.offerName}`,
      ),
    );
    card.appendChild(
      element(
        "p",
        "text-sm text-slate-600",
        `${Math.round(rec.conf * 100)}% struk yang berisi ${rec.fromName} juga berisi ${rec.offerName} (${rec.nBoth} dari ${rec.nFrom} struk). Keterkaitan: ${liftLabel(rec.nBoth, lastLoaded.analysis.N, rec.nFrom, lastLoaded.counts.countByMenu.get(rec.offer))} (${formatNumber(rec.lift)} kali lebih sering dari kebetulan).`,
      ),
    );
    card.appendChild(
      element(
        "p",
        "text-sm text-slate-600",
        `Di struk berisi ${rec.fromName} yang belum berisi ${rec.offerName}, tercatat ${formatPortions(rec.portionsWithoutOffer, rec.fromName)}. Jika ${SKENARIO_PERSEN}% dari porsi tersebut menerima tawaran, untung bertambah ${formatApproximateRupiah((rec.portionsWithoutOffer * SKENARIO_PERSEN * rec.untungOffer) / 100)} dalam ${period} hari.`,
      ),
    );
    const button = element(
      "button",
      "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100",
      "Simulasikan",
    );
    button.type = "button";
    button.addEventListener("click", () => {
      const select = document.getElementById("basketSimRecommendation");
      if (select) {
        select.value = String(index);
        updateSimulatorResult();
      }
    });
    card.appendChild(button);
    container.appendChild(card);
  });
}

function renderRare(jarang, period) {
  const container = document.getElementById("basketRare");
  container.replaceChildren();
  container.classList.toggle("hidden", jarang.length === 0);
  if (!jarang.length) return;
  container.appendChild(
    element(
      "h4",
      "font-bold text-slate-800",
      "Jarang dibeli bersamaan (kurang cocok dijadikan paket)",
    ),
  );
  const list = element("ul", "list-disc space-y-2 pl-5 text-sm text-slate-600");
  jarang.slice(0, 3).forEach((pair) => {
    list.appendChild(
      element(
        "li",
        "",
        `${pair.aName} dan ${pair.bName}: dibeli bersamaan hanya ${pair.nBoth} kali dalam ${period} hari (jika acak, diharapkan sekitar ${Math.round(pair.diharapkan)} kali). Kurang cocok dijadikan paket.`,
      ),
    );
  });
  container.appendChild(list);
}

function renderSimulator() {
  const container = document.getElementById("basketSim");
  const recs = lastLoaded?.analysis?.recs || [];
  container.replaceChildren();
  container.classList.toggle("hidden", recs.length === 0);
  if (!recs.length) return;

  const heading = element("h4", "font-bold text-slate-800", "Simulasi tawaran");
  container.appendChild(heading);
  const selectLabel = element(
    "label",
    "block space-y-1 text-xs font-semibold text-slate-600",
    "Pilih tawaran",
  );
  const select = document.createElement("select");
  select.id = "basketSimRecommendation";
  select.className =
    "w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-normal";
  recs.slice(0, 5).forEach((rec, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `Struk berisi ${rec.fromName} → tawarkan ${rec.offerName}`;
    select.appendChild(option);
  });
  selectLabel.appendChild(select);
  container.appendChild(selectLabel);

  const inputs = element("div", "grid gap-3 sm:grid-cols-2");
  const plainLabel = element(
    "label",
    "space-y-1 text-xs font-semibold text-slate-600",
    "Porsi yang menerima tawaran tanpa diskon (%)",
  );
  const plainInput = document.createElement("input");
  plainInput.id = "basketPlainPct";
  plainInput.type = "number";
  plainInput.min = "0";
  plainInput.max = "100";
  plainInput.value = String(SKENARIO_PERSEN);
  plainInput.className =
    "w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal";
  plainLabel.appendChild(plainInput);
  inputs.appendChild(plainLabel);

  const discountLabel = element(
    "label",
    "space-y-1 text-xs font-semibold text-slate-600",
    "Hemat paket (Rp)",
  );
  const discountInput = document.createElement("input");
  discountInput.id = "basketDiscount";
  discountInput.type = "number";
  discountInput.min = "0";
  discountInput.step = "1";
  discountInput.value = "0";
  discountInput.className =
    "w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal";
  discountLabel.appendChild(discountInput);
  inputs.appendChild(discountLabel);
  container.appendChild(inputs);

  const bundleLabel = element(
    "label",
    "hidden space-y-1 text-xs font-semibold text-slate-600",
    "Porsi yang menerima tawaran paket hemat (%)",
  );
  bundleLabel.id = "basketBundlePctLabel";
  const bundleInput = document.createElement("input");
  bundleInput.id = "basketBundlePct";
  bundleInput.type = "number";
  bundleInput.min = "0";
  bundleInput.max = "100";
  bundleInput.value = String(SKENARIO_PERSEN);
  bundleInput.className =
    "w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal";
  bundleLabel.appendChild(bundleInput);
  container.appendChild(bundleLabel);
  const result = element("div", "space-y-2 text-sm text-slate-700");
  result.id = "basketSimResult";
  container.appendChild(result);
  container.appendChild(
    element(
      "p",
      "text-[11px] text-slate-500",
      "Perkiraan, bukan jaminan. Hasil nyata tergantung respons pelanggan.",
    ),
  );

  [select, plainInput, discountInput, bundleInput].forEach((input) => {
    input.addEventListener("input", updateSimulatorResult);
    input.addEventListener("change", updateSimulatorResult);
  });
  updateSimulatorResult();
}

function updateSimulatorResult() {
  const recs = lastLoaded?.analysis?.recs?.slice(0, 5) || [];
  const rec = recs[Number(document.getElementById("basketSimRecommendation")?.value) || 0];
  if (!rec) return;
  const plainInput = document.getElementById("basketPlainPct");
  const discountInput = document.getElementById("basketDiscount");
  const bundleInput = document.getElementById("basketBundlePct");
  const discount = Math.max(0, Math.round(Number(discountInput.value) || 0));
  const plainPct = Number(plainInput.value);
  const bundlePct = Number(bundleInput.value);
  const bundleLabel = document.getElementById("basketBundlePctLabel");
  bundleLabel.classList.toggle("hidden", discount <= 0);
  const output = document.getElementById("basketSimResult");
  output.replaceChildren();

  const simulation = simulateOffer({
    nFrom: rec.portionsWithoutOffer + rec.offerPortionsInBoth,
    nBoth: rec.offerPortionsInBoth,
    untungOffer: rec.untungOffer,
    setujuPlainPct: plainPct,
    hemat: discount,
    setujuBundlePct: bundlePct,
  });
  if (simulation.tanpa === 0) {
    output.appendChild(
      element(
        "p",
        "",
        `Tidak ada porsi ${rec.fromName} pada struk yang belum berisi ${rec.offerName}.`,
      ),
    );
    return;
  }

  const validPlain =
    plainInput.value !== "" &&
    Number.isFinite(plainPct) &&
    plainPct >= 0 &&
    plainPct <= 100;
  const validBundle =
    bundleInput.value !== "" &&
    Number.isFinite(bundlePct) &&
    bundlePct >= 0 &&
    bundlePct <= 100;
  const validDiscount =
    discountInput.value !== "" &&
    Number.isFinite(Number(discountInput.value)) &&
    Number(discountInput.value) >= 0;
  if (!validPlain || !validDiscount || (discount > 0 && !validBundle)) {
    output.appendChild(
      element("p", "text-rose-700", "Isi persentase 0 sampai 100 dan hemat paket minimal Rp0."),
    );
    return;
  }

  output.appendChild(
    element(
      "p",
      "",
      `Tawaran tanpa diskon: dari ${formatPortions(simulation.tanpa, rec.fromName)} pada struk yang belum berisi ${rec.offerName}, jika ${plainPct}% menerima tawaran (${formatPortions(simulation.takersPlain, rec.offerName)}), untung bertambah ${formatApproximateRupiah(simulation.tambahPlain)} dalam ${lastLoaded.period} hari.`,
    ),
  );
  if (discount <= 0) return;
  if (!simulation.bundle.valid) {
    output.appendChild(
      element(
        "p",
        "rounded-lg bg-amber-50 p-3 text-amber-800",
        `Potongan ${formatRupiah(discount)} sama dengan atau lebih besar dari untung ${rec.offerName} per porsi (${formatRupiah(rec.untungOffer)}). Paket seperti ini tidak menambah untung.`,
      ),
    );
    return;
  }

  const bundle = simulation.bundle;
  const verdictStyle =
    bundle.vonis === "untung"
      ? "font-bold text-emerald-700"
      : bundle.vonis === "rugi"
        ? "font-bold text-rose-700"
        : "font-bold text-slate-600";
  const signedNewProfit =
    bundle.tambahBaru < 0 ? "-" : "+";
  const netVerdict = bundle.vonis.toUpperCase();
  const netAmount = formatApproximateRupiah(bundle.tambahBundle);
  const bundleText =
    `Paket hemat ${formatRupiah(discount)}: jika ${bundlePct}% menerima tawaran (${formatPortions(bundle.takersBundle, rec.offerName)}), untung dari porsi baru sekitar ${signedNewProfit}${formatRupiah(Math.round(Math.abs(bundle.tambahBaru) / 100) * 100)}, tapi ${formatPortions(rec.offerPortionsInBoth, rec.offerName)} yang memang sudah tercatat pada struk bersama ikut mendapat potongan (sekitar -${formatRupiah(Math.round(bundle.biayaLama / 100) * 100)}). Hasil bersih: ${netVerdict} ${netAmount} dalam ${lastLoaded.period} hari.`;
  output.appendChild(element("p", verdictStyle, bundleText));

  const thresholds = [];
  if (bundle.persenImpas !== null) {
    thresholds.push(
      `Agar paket hemat ini tidak merugikan, minimal ${formatNumber(bundle.persenImpas)}% dari porsi yang bisa ditawarkan itu harus diterima.`,
    );
  }
  if (bundle.setujuBundleMinPct !== null) {
    thresholds.push(
      `Agar lebih untung daripada tawaran tanpa diskon, minimal ${formatNumber(bundle.setujuBundleMinPct)}% porsi harus menerima tawaran (jika tanpa diskon diperkirakan ${plainPct}%).`,
    );
  }
  const impossible =
    bundle.persenImpas > 100 || bundle.setujuBundleMinPct > 100;
  if (impossible) {
    thresholds.push(
      `Tidak mungkin tercapai karena yang bisa ditawarkan hanya ${formatPortions(simulation.tanpa, rec.fromName)}.`,
    );
  }
  if (thresholds.length) {
    output.appendChild(element("p", "", thresholds.join(" ")));
  }
  if (bundle.selisihVsPlain > 0) {
    output.appendChild(
      element(
        "p",
        "",
        `Paket hemat lebih menguntungkan ${formatApproximateRupiah(bundle.selisihVsPlain)} dibanding tawaran tanpa diskon.`,
      ),
    );
  } else if (bundle.selisihVsPlain < 0) {
    output.appendChild(
      element(
        "p",
        "",
        `Tawaran tanpa diskon lebih menguntungkan ${formatApproximateRupiah(bundle.selisihVsPlain)}.`,
      ),
    );
  }
}

function clearFailureView(status) {
  status.textContent = "Data penjualan belum bisa dimuat. Coba lagi nanti.";
  clearDetails();
}

export function initBasketCard() {
  if (initialized) return;
  const period = document.getElementById("basketPeriod");
  if (!period) return;
  initialized = true;
  period.value = String(PERIODE_DEFAULT);
  period.addEventListener("change", renderBasketCard);
}

export async function renderBasketCard() {
  const periodSelect = document.getElementById("basketPeriod");
  if (!periodSelect) return;
  const sequence = ++requestSequence;
  const period = Number(periodSelect.value);
  const status = document.getElementById("basketStatus");
  status.textContent = "Memuat data penjualan...";
  clearDetails();
  const loaded = await loadBasketAnalysis(period);
  if (sequence !== requestSequence) return;
  if (!loaded || loaded.error) {
    clearFailureView(status);
    return;
  }
  lastLoaded = loaded;
  const analysis = loaded.analysis;
  if (!analysis.ok) {
    status.textContent = statusForFailure(analysis);
    clearDetails();
    return;
  }
  status.textContent = `Periode ${period} hari: ${loaded.start} sampai ${loaded.end}.`;
  renderSummary(loaded, period);
  renderRecommendations(analysis.recs, period);
  renderRare(analysis.jarang, period);
  const note = document.getElementById("basketNote");
  note.textContent =
    "Keterkaitan menu dihitung berdasarkan struk, sedangkan simulasi jumlah tawaran memakai porsi menu pemicu pada struk yang belum berisi menu tawaran. Ini perkiraan, bukan jaminan respons pelanggan. Paket hemat belum bisa dijalankan di kasir; saran tawaran tanpa diskon muncul otomatis di halaman kasir.";
  note.classList.remove("hidden");
  renderSimulator();
}

export { updateSimulatorResult as renderBasketSimulator };
