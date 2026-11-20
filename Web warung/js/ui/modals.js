let pendingConfirmationAction = null;

export function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

export function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

export function openActionConfirmation(title, message, detail, action) {
  pendingConfirmationAction = action;
  document.getElementById("confirmTitle").innerText = title;
  document.getElementById("confirmMessage").innerText = message;
  document.getElementById("confirmDetail").innerHTML = detail;
  document.getElementById("confirmStepLabel").innerText = "Langkah 1 dari 2";
  document.getElementById("confirmStepOne").classList.remove("hidden");
  document.getElementById("confirmStepTwo").classList.add("hidden");
  document.getElementById("confirmAcknowledgement").checked = false;
  toggleFinalConfirmation();
  openModal("modal-action-confirm");
}

export function continueActionConfirmation() {
  document.getElementById("confirmStepLabel").innerText = "Langkah 2 dari 2";
  document.getElementById("confirmStepOne").classList.add("hidden");
  document.getElementById("confirmStepTwo").classList.remove("hidden");
}

export function toggleFinalConfirmation() {
  const button = document.getElementById("confirmFinalButton");
  const enabled = document.getElementById("confirmAcknowledgement").checked;
  button.disabled = !enabled;
  button.classList.toggle("opacity-50", !enabled);
  button.classList.toggle("cursor-not-allowed", !enabled);
}

export function cancelActionConfirmation() {
  pendingConfirmationAction = null;
  closeModal("modal-action-confirm");
}

export async function executeConfirmedAction() {
  const action = pendingConfirmationAction;
  pendingConfirmationAction = null;
  closeModal("modal-action-confirm");
  if (action) await action();
}
