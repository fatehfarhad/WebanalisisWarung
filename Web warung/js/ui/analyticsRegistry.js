import { renderAiRecommendations } from "./forecasting.js";
import { renderBasketCard } from "./basketCard.js";
import { renderMenuEngineeringCard } from "./menuEngineeringCard.js";
import { renderPromoSimulator } from "./promoSimulator.js";
import { renderPromoTrackCard, renderWeekdayCard } from "./weekdayCard.js";

export const analyticsGroupMeta = {
  "Promo dan Harga": {
    title: "Promo dan Harga",
    icon: "fa-percent",
    accent: "emerald",
  },
  "Menu dan Penjualan": {
    title: "Menu dan Penjualan",
    icon: "fa-table-cells-large",
    accent: "sky",
  },
  Saran: {
    title: "Saran",
    icon: "fa-robot",
    accent: "violet",
  },
  Lainnya: {
    title: "Lainnya",
    icon: "fa-chart-line",
    accent: "slate",
  },
};

export const analyticsEntries = [
  {
    id: "promoSimulatorCard",
    group: "Promo dan Harga",
    title: "Simulasi Promo",
    icon: "fa-percent",
    summary: "Cek apakah diskon untung atau rugi sebelum dijalankan.",
    cardSelector: "#promoSimulatorCard",
    render: renderPromoSimulator,
  },
  {
    id: "weekdayCard",
    group: "Promo dan Harga",
    title: "Hari Ramai dan Sepi",
    icon: "fa-calendar-days",
    summary: "Lihat hari penjualan paling sepi dan paling ramai tiap menu.",
    cardSelector: "#weekdayCard",
    render: renderWeekdayCard,
  },
  {
    id: "promoTrackCard",
    group: "Promo dan Harga",
    title: "Rekam Jejak Promo",
    icon: "fa-clock-rotate-left",
    summary: "Hasil promo yang sudah selesai: untung atau rugi.",
    cardSelector: "#promoTrackCard",
    render: renderPromoTrackCard,
  },
  {
    id: "menuEngCard",
    group: "Menu dan Penjualan",
    title: "Peta Menu",
    icon: "fa-table-cells-large",
    summary: "Kelompokkan menu: Bintang, Sapi Perah, Teka-teki, Beban.",
    cardSelector: "#menuEngCard",
    render: renderMenuEngineeringCard,
  },
  {
    id: "basketCard",
    group: "Menu dan Penjualan",
    title: "Menu yang Sering Dibeli Bersamaan",
    icon: "fa-link",
    summary: "Temukan menu yang cocok ditawarkan bersama.",
    cardSelector: "#basketCard",
    render: renderBasketCard,
  },
  {
    id: "aiAdvisorCard",
    group: "Saran",
    title: "AI Advisor",
    icon: "fa-robot",
    summary: "Ringkasan dan saran dari data toko Anda.",
    cardSelector: "#aiAdvisorCard",
    render: renderAiRecommendations,
  },
];

export function getAnalyticsEntries() {
  const visible = [...analyticsEntries];
  const seen = new Set(visible.map((entry) => entry.id));
  const extras = Array.from(document.querySelectorAll("#tab-forecasting [id]"))
    .filter((element) => !element.closest("#analyticsPopup") && !element.closest("#analyticsVault"))
    .filter((element) => !seen.has(element.id))
    .filter((element) => ["analyticsVault", "analyticsLauncherArea", "tab-forecasting"].includes(element.id) === false)
    .map((element) => {
      const title = element.querySelector("h3, h2, h4")?.textContent?.trim() || "Kartu lainnya";
      const summary = element.querySelector("p")?.textContent?.trim() || "Ringkasan analitik tambahan.";
      return {
        id: element.id,
        group: "Lainnya",
        title,
        icon: "fa-chart-line",
        summary: summary.length > 92 ? `${summary.slice(0, 89)}...` : summary,
        cardSelector: `#${element.id}`,
        render: null,
      };
    });

  return [...visible, ...extras];
}

export function getAnalyticsEntryById(id) {
  return getAnalyticsEntries().find((entry) => entry.id === id) || null;
}
