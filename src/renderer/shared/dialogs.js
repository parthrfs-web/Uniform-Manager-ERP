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

function setProgressStatus(status) {
  if (status === undefined || status === null || status === "") return;
  const value = String(status);
  const statusEl = document.getElementById("progressStatus");
  if (statusEl) statusEl.textContent = value;
  const skippedText = document.getElementById("progressSkippedText");
  if (skippedText) skippedText.textContent = value;
}

function updateProgress(data = {}) {
  if (data.status) setProgressStatus(data.status);
  const bar = document.getElementById("progressBar");
  const percentLabel = document.getElementById("progressPercent");
  const meter = document.getElementById("processingMeter");
  const skippedPercent = document.getElementById("progressSkippedPercent");
  const modal = document.getElementById("progressModal");
  const hasProgress = typeof data.progress === "number" && Number.isFinite(data.progress);
  if (bar) {
    bar.style.width = hasProgress ? `${Math.max(0, Math.min(100, data.progress))}%` : "0%";
    bar.classList.toggle("indeterminate", !hasProgress);
  }
  if (modal) modal.classList.toggle("has-measured-progress", hasProgress);
  if (percentLabel) percentLabel.textContent = hasProgress ? `${Math.floor(Math.max(0, Math.min(100, data.progress)))}%` : "In progress";
  if (meter) {
    if (hasProgress) meter.setAttribute("aria-valuenow", String(Math.floor(Math.max(0, Math.min(100, data.progress)))));
    else meter.removeAttribute("aria-valuenow");
    meter.setAttribute("aria-valuetext", hasProgress ? `${Math.floor(Math.max(0, Math.min(100, data.progress)))} percent` : "Progress not available");
  }
  if (skippedPercent) skippedPercent.textContent = hasProgress ? `${Math.floor(Math.max(0, Math.min(100, data.progress)))}%` : "";
  const stage = document.getElementById("progressStage");
  if (stage && Number.isFinite(data.stageIndex) && Number.isFinite(data.stageCount) && data.stageCount > 0) {
    stage.hidden = false;
    stage.textContent = `STAGE ${String(data.stageIndex).padStart(2, "0")} / ${String(data.stageCount).padStart(2, "0")} · ${data.stage || "Processing"}`;
  } else if (stage && data.stage) {
    stage.hidden = false;
    stage.textContent = String(data.stage);
  } else if (stage) {
    stage.hidden = true;
    stage.textContent = "";
  }
  const recordPanel = document.getElementById("progressRecords");
  const recordValue = document.getElementById("progressRecordsValue");
  if (recordPanel && recordValue && Number.isFinite(data.recordsProcessed) && Number.isFinite(data.recordsTotal)) {
    recordPanel.hidden = false;
    recordValue.textContent = `${data.recordsProcessed.toLocaleString()} / ${data.recordsTotal.toLocaleString()}`;
  } else if (recordPanel) {
    recordPanel.hidden = true;
  }
}

function startProgress(options = {}) {
  const config = typeof options === "string" ? { title: options } : options;
  const isNewOperation = !progressActive;
  if (isNewOperation) {
    progressActive = true;
    progressSkipped = false;
    progressOperation = config;
    progressStartTime = Date.now();
    const bar = document.getElementById("progressBar");
    if (bar) { bar.style.width = "0%"; bar.classList.add("indeterminate"); }
    const percent = document.getElementById("progressPercent");
    if (percent) percent.textContent = "In progress";
    const meter = document.getElementById("processingMeter");
    if (meter) { meter.removeAttribute("aria-valuenow"); meter.setAttribute("aria-valuetext", "Progress not available"); }
    document.getElementById("progressModal")?.classList.remove("has-measured-progress");
    const stage = document.getElementById("progressStage");
    if (stage) { stage.hidden = true; stage.textContent = ""; }
    const records = document.getElementById("progressRecords");
    if (records) records.hidden = true;
    const notice = document.getElementById("progressSkippedNotice");
    if (notice) notice.hidden = true;
    setProgressStatus(config.status || "Preparing operation...");
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      const elapsed = formatTime(Date.now() - progressStartTime);
      const timeEl = document.getElementById("progressTime");
      const topTimeEl = document.getElementById("progressElapsedTop");
      if (timeEl) timeEl.textContent = elapsed;
      if (topTimeEl) topTimeEl.textContent = elapsed;
    }, 1000);
  } else {
    progressOperation = { ...progressOperation, ...config };
  }

  const titleEl = document.getElementById("progressTitle");
  const descriptionEl = document.getElementById("progressDescription");
  const kickerEl = document.getElementById("progressKicker");
  if (titleEl) titleEl.textContent = progressOperation.title || "Processing Request";
  if (descriptionEl) descriptionEl.textContent = progressOperation.description || "Working with your local application data.";
  if (kickerEl) kickerEl.textContent = progressOperation.kicker || "SYSTEM TASK";

  const modal = document.getElementById("progressModal");
  if (!progressSkipped && modal && !modal.classList.contains("show")) {
    if (progressShowTimer) clearTimeout(progressShowTimer);
    const show = () => {
      progressShowTimer = null;
      if (!progressActive || progressSkipped) return;
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
    };
    if (config.immediate || !isNewOperation) show();
    else progressShowTimer = setTimeout(show, 420);
  }
}

function skipProgressAnimation() {
  if (!progressActive) return;
  progressSkipped = true;
  if (progressShowTimer) clearTimeout(progressShowTimer);
  progressShowTimer = null;
  const modal = document.getElementById("progressModal");
  if (modal) { modal.classList.remove("show"); modal.setAttribute("aria-hidden", "true"); }
  const notice = document.getElementById("progressSkippedNotice");
  if (notice) notice.hidden = false;
}

function stopProgress() {
  if (progressShowTimer) clearTimeout(progressShowTimer);
  progressShowTimer = null;
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  progressActive = false;
  progressSkipped = false;
  progressOperation = null;
  const modal = document.getElementById("progressModal");
  if (modal) { modal.classList.remove("show", "has-measured-progress"); modal.setAttribute("aria-hidden", "true"); }
  const notice = document.getElementById("progressSkippedNotice");
  if (notice) notice.hidden = true;
}

document.getElementById("skipProgressAnimation")?.addEventListener("click", skipProgressAnimation);

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
