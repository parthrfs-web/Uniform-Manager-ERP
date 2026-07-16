function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3600);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startProgress() {
  const modal = document.getElementById("progressModal");
  if (modal) {
    modal.classList.add("show");
    document.getElementById("progressStatus").textContent = "Preparing...";
    document.getElementById("progressBar").style.width = "0%";
    document.getElementById("progressPercent").textContent = "0%";
    document.getElementById("progressTime").textContent = "00:00";
  }
  
  progressStartTime = Date.now();
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => {
     const elapsed = Date.now() - progressStartTime;
     const timeEl = document.getElementById("progressTime");
     if (timeEl) timeEl.textContent = formatTime(elapsed);
  }, 1000);
}

function stopProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  const modal = document.getElementById("progressModal");
  if (modal) modal.classList.remove("show");
}

function showImportError(message) {
  const panel = document.getElementById("importError");
  panel.textContent = message;
  panel.classList.add("show");
  setView("dashboard");
}

function clearImportError() {
  const panel = document.getElementById("importError");
  panel.textContent = "";
  panel.classList.remove("show");
}