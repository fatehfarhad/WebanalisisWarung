let toastId = 0;

export function showToast(message, tone = "success", options = {}) {
  let container = document.getElementById("toast-root");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-root";
    container.className =
      "pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions");
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const id = ++toastId;
  const toneStyle =
    tone === "error"
      ? {
          icon: "fa-circle-exclamation",
          classes: "border-rose-200 bg-white text-rose-800",
        }
      : tone === "warn"
        ? {
            icon: "fa-triangle-exclamation",
            classes: "border-amber-200 bg-white text-amber-800",
          }
        : {
            icon: "fa-circle-check",
            classes: "border-emerald-200 bg-white text-emerald-800",
          };

  toast.className = `toast-enter pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg ${toneStyle.classes}`;
  toast.dataset.toastId = String(id);
  toast.setAttribute("role", tone === "error" ? "alert" : "status");

  const icon = document.createElement("i");
  icon.className = `fa-solid ${toneStyle.icon} mt-0.5`;
  icon.setAttribute("aria-hidden", "true");
  toast.appendChild(icon);

  const content = document.createElement("div");
  content.className = "min-w-0 flex-1 text-sm font-medium";
  content.textContent = message;
  toast.appendChild(content);

  if (options.actionLabel && typeof options.onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "shrink-0 text-xs font-bold underline underline-offset-2";
    action.textContent = options.actionLabel;
    action.addEventListener("click", () => {
      options.onAction();
      toast.remove();
      if (!container.childElementCount) container.remove();
    });
    toast.appendChild(action);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "shrink-0 text-slate-400 hover:text-slate-700";
  close.setAttribute("aria-label", "Tutup notifikasi");
  close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  close.addEventListener("click", () => toast.remove());
  toast.appendChild(close);

  container.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("toast-exit");
    window.setTimeout(() => {
      toast.remove();
      if (!container.childElementCount) container.remove();
    }, 180);
  }, options.duration || 3600);
}
