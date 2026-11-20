import { PERIODE_DEFAULT, pickCashierHints } from "../marketBasket.js";
import { state } from "../state.js";
import { loadBasketAnalysis } from "./basketData.js";

let pendingMenuIds = [];
let initialized = false;
let renderSequence = 0;

function makeElement(tag, className, text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function hideHint() {
  const container = document.getElementById("basketHint");
  if (!container) return;
  container.replaceChildren();
  container.classList.add("hidden");
}

async function renderHint(menuIds) {
  pendingMenuIds = [...new Set(menuIds)];
  const sequence = ++renderSequence;
  const container = document.getElementById("basketHint");
  if (!container || !pendingMenuIds.length) {
    hideHint();
    return;
  }

  const loaded = await loadBasketAnalysis(PERIODE_DEFAULT);
  if (sequence !== renderSequence) return;
  if (!loaded || loaded.error || !loaded.analysis?.ok) {
    hideHint();
    return;
  }
  const select = document.getElementById("receiptMenuSelect");
  const offerableIds = new Set(
    [...(select?.options || [])].map((option) => option.value).filter(Boolean),
  );
  const menuById = new Map(
    state.menuCatalog.map((menu) => [menu.id, menu]),
  );
  const isDrink = (menuId) =>
    String(menuById.get(menuId)?.category || "").trim().toLowerCase() ===
    "minuman";
  const hasNonDrinkOrder = pendingMenuIds.some((menuId) => !isDrink(menuId));
  const relevantRecommendations = loaded.analysis.recs.filter(
    (recommendation) =>
      (!hasNonDrinkOrder || !isDrink(recommendation.from)) &&
      (hasNonDrinkOrder || !isDrink(recommendation.offer)),
  );
  const hints = pickCashierHints(
    relevantRecommendations,
    pendingMenuIds,
    offerableIds,
  );
  container.replaceChildren();
  container.classList.toggle("hidden", hints.length === 0);
  if (!hints.length) return;

  hints.forEach((hint) => {
    const recommendation = loaded.analysis.recs.find(
      (item) => item.from === hint.from && item.offer === hint.offer,
    );
    const offer = state.menuCatalog.find((menu) => menu.id === hint.offer);
    if (!recommendation || !offer) return;
    const row = makeElement(
      "div",
      "flex flex-col gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-xs sm:flex-row sm:items-center sm:justify-between",
    );
    row.appendChild(
      makeElement(
        "p",
        "text-slate-700",
        `Tawarkan ${recommendation.offerName}. Sekitar ${Math.round(recommendation.conf * 100)}% pembeli ${recommendation.fromName} juga membelinya.`,
      ),
    );
    const button = makeElement(
      "button",
      "shrink-0 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700",
      "Pilih menu ini",
    );
    button.type = "button";
    button.addEventListener("click", () => {
      select.value = hint.offer;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("receiptQty")?.focus();
    });
    row.appendChild(button);
    container.appendChild(row);
  });
}

export function initBasketHint() {
  if (initialized) return;
  initialized = true;
  document.addEventListener("forecastbiz:receipt-draft-changed", (event) => {
    renderHint(event.detail?.menuIds || []);
  });
}

export function renderBasketHintForCurrentDraft() {
  renderHint(state.currentReceiptItems.map((item) => item.menuId));
}

export function preloadBasketHintAnalysis() {
  loadBasketAnalysis(PERIODE_DEFAULT);
}
