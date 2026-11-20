import { analyticsGroupMeta, getAnalyticsEntries, getAnalyticsEntryById } from "./analyticsRegistry.js";

const popupState = {
  currentId: null,
  lastFocused: null,
  pendingRender: null,
};

function getPopup() {
  return document.getElementById("analyticsPopup");
}

function getPopupBody() {
  return document.getElementById("analyticsPopupBody");
}

function getPopupTitle() {
  return document.getElementById("analyticsPopupTitle");
}

function getPopupIcon() {
  return document.getElementById("analyticsPopupIcon");
}

function getVault() {
  return document.getElementById("analyticsVault");
}

function ensureCardBackInVault(card) {
  const vault = getVault();
  if (!card || !vault || vault.contains(card)) return;
  vault.appendChild(card);
}

function applyCardRender(entry) {
  if (!entry || typeof entry.render !== "function") return;
  entry.render();
}

function saveScrollState() {
  document.body.style.overflow = "hidden";
}

function restoreScrollState() {
  document.body.style.overflow = "";
}

function openPopupAfterRender(entry) {
  if (!entry) return;
  const popup = getPopup();
  if (!popup) return;
  const popupBody = getPopupBody();
  const title = getPopupTitle();
  const icon = getPopupIcon();
  if (!popupBody || !title || !icon) return;

  const card = document.getElementById(entry.id);
  if (card) {
    popupBody.replaceChildren();
    popupBody.appendChild(card);
  }

  const meta = analyticsGroupMeta[entry.group] || analyticsGroupMeta.Lainnya;
  const colorMap = {
    emerald: "#10b981",
    sky: "#0ea5e9",
    violet: "#8b5cf6",
    slate: "#64748b",
  };
  title.textContent = entry.title;
  icon.className = `fa-solid ${entry.icon}`;
  icon.style.color = colorMap[meta.accent] || colorMap.slate;
  popup.classList.remove("hidden");
  popup.setAttribute("aria-hidden", "false");
  popup.dataset.open = "true";
  popup.classList.add("opacity-100", "translate-y-0");
  popup.classList.remove("opacity-0", "translate-y-4");
  saveScrollState();
  popupState.currentId = entry.id;

  window.setTimeout(() => {
    title.focus();
    document.dispatchEvent(new CustomEvent("forecastbiz:popup-opened", { detail: { id: entry.id } }));
  }, 20);

  applyCardRender(entry);
}

export function openAnalyticsPopup(id) {
  const entry = getAnalyticsEntryById(id);
  if (!entry) return;

  const existingOpen = popupState.currentId && popupState.currentId !== id;
  if (existingOpen) {
    closeAnalyticsPopup();
  }

  const popup = getPopup();
  if (!popup) return;
  popupState.lastFocused = document.activeElement;
  openPopupAfterRender(entry);
}

export function closeAnalyticsPopup() {
  const popup = getPopup();
  if (!popup) return;

  const popupBody = getPopupBody();
  const currentId = popupState.currentId;
  if (currentId) {
    const currentCard = popupBody.querySelector(`#${CSS.escape(currentId)}`) || document.getElementById(currentId);
    ensureCardBackInVault(currentCard);
  }

  popup.classList.add("hidden");
  popup.setAttribute("aria-hidden", "true");
  popup.dataset.open = "false";
  popup.classList.remove("opacity-100", "translate-y-0");
  popup.classList.add("opacity-0", "translate-y-4");
  restoreScrollState();
  if (popupState.lastFocused && popupState.lastFocused instanceof HTMLElement && popupState.lastFocused.isConnected) {
    popupState.lastFocused.focus();
  }
  popupState.currentId = null;
  document.dispatchEvent(new CustomEvent("forecastbiz:popup-closed", { detail: { id: currentId } }));
}

function handleKeydown(event) {
  const popup = getPopup();
  if (!popup || popup.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    const hasOpenModal = document.querySelector(".fixed.z-50:not(.hidden)");
    if (!hasOpenModal) {
      event.preventDefault();
      closeAnalyticsPopup();
    }
    return;
  }

  if (event.key === "Tab") {
    const focusable = popup.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const items = Array.from(focusable).filter((item) => !item.disabled && item.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function handleBackdrop(event) {
  const popup = getPopup();
  if (!popup || popup.classList.contains("hidden")) return;
  if (event.target instanceof HTMLElement && event.target.dataset.analyticsClose === "true") {
    closeAnalyticsPopup();
  }
}

function triggerPopupRefresh() {
  if (!popupState.currentId) return;
  const entry = getAnalyticsEntryById(popupState.currentId);
  if (entry && typeof entry.render === "function") {
    window.clearTimeout(popupState.pendingRender);
    popupState.pendingRender = window.setTimeout(() => {
      applyCardRender(entry);
    }, 300);
  }
}

function bindRefreshEvents() {
  [
    "forecastbiz:receipt-saved",
    "forecastbiz:menu-changed",
    "forecastbiz:materials-changed",
    "forecastbiz:promotion-changed",
  ].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      triggerPopupRefresh();
    });
  });
}

function bindPlanPromoEvent() {
  document.addEventListener("forecastbiz:plan-promo", (event) => {
    const detail = event.detail || {};
    const menuId = detail.menuId || "";
    const weekday = detail.weekday;
    const discount = detail.discount || "";
    openAnalyticsPopup("promoSimulatorCard");
    window.setTimeout(() => {
      const menuSelect = document.getElementById("promoMenuSelect");
      const selectWeekday = (targetWeekday) => {
        document
          .querySelectorAll("#promoWeekdayBtns [data-promo-weekday]")
          .forEach((button) => {
            const active =
              Number(button.dataset.promoWeekday) === Number(targetWeekday);
            button.classList.toggle("is-selected", active);
            button.classList.toggle("bg-emerald-600", active);
            button.classList.toggle("text-white", active);
            button.classList.toggle("border-emerald-600", active);
            button.classList.toggle("bg-white", !active);
            button.classList.toggle("text-slate-600", !active);
            button.classList.toggle("border-slate-300", !active);
            button.setAttribute("aria-pressed", String(active));
          });
        document.dispatchEvent(new Event("forecastbiz:promo-weekdays-changed"));
      };
      if (menuSelect && menuId) {
        menuSelect.value = menuId;
        menuSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (weekday !== undefined && weekday !== null && weekday !== "") {
        selectWeekday(weekday);
      }
      const discountInput = document.getElementById("promoDiscountPct");
      if (discountInput && discount !== "") {
        discountInput.value = String(discount);
        discountInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const note = document.getElementById("promoPlannedNote");
      if (note) {
        note.textContent = `Direncanakan dari ${detail.label || "Hari ini"}.`;
        note.classList.remove("hidden");
      }
    }, 50);
  });
}

export function renderAnalyticsLaunchers() {
  const root = document.getElementById("analyticsLauncherArea");
  if (!root) return;

  const entries = getAnalyticsEntries();
  const groups = ["Promo dan Harga", "Menu dan Penjualan", "Saran", "Lainnya"];
  const html = groups
    .map((groupName) => {
      const cards = entries.filter((entry) => entry.group === groupName);
      if (!cards.length) return "";
      const meta = analyticsGroupMeta[groupName] || analyticsGroupMeta.Lainnya;
      const accentColor = {
        emerald: "#10b981",
        sky: "#0ea5e9",
        violet: "#8b5cf6",
        slate: "#64748b",
      }[meta.accent] || "#64748b";
      return `
        <div class="space-y-3">
          <h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">${meta.title}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${cards
              .map(
                (entry) => `
                  <button type="button" data-analytics-open-id="${entry.id}" class="analytics-launcher w-full rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-emerald-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500" style="border-color: rgba(148, 163, 184, 0.35);">
                    <div class="mb-4 flex items-center justify-between gap-3">
                      <div class="flex h-10 w-10 items-center justify-center rounded-xl" style="background:${accentColor}20; color:${accentColor};">
                        <i class="fa-solid ${entry.icon}"></i>
                      </div>
                    </div>
                    <h4 class="text-base font-bold text-slate-800">${entry.title}</h4>
                    <p class="mt-2 text-xs leading-5 text-slate-500">${entry.summary}</p>
                    <span class="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-emerald-600 hover:text-white">Buka</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  root.innerHTML = html;
  root.querySelectorAll("[data-analytics-open-id]").forEach((button) => {
    button.addEventListener("click", () => openAnalyticsPopup(button.dataset.analyticsOpenId));
  });
}

export function initAnalyticsExperience() {
  const section = document.getElementById("tab-forecasting");
  const vault = getVault();
  if (section && vault) {
    const cardIds = getAnalyticsEntries().map((entry) => entry.id);
    cardIds.forEach((id) => {
      const card = document.getElementById(id);
      if (card && !vault.contains(card)) {
        vault.appendChild(card);
      }
    });
  }

  renderAnalyticsLaunchers();
  bindRefreshEvents();
  bindPlanPromoEvent();

  const popup = getPopup();
  if (popup) {
    popup.addEventListener("click", handleBackdrop);
    popup.addEventListener("keydown", handleKeydown);
  }
}

export function resetAnalyticsVault() {
  const vault = getVault();
  if (!vault) return;
  const cardIds = getAnalyticsEntries().map((entry) => entry.id);
  cardIds.forEach((id) => {
    const card = document.getElementById(id);
    if (card && !vault.contains(card)) {
      vault.appendChild(card);
    }
  });
}
