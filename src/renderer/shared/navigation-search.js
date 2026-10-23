(() => {
  const input = document.getElementById("globalNavSearchInput");
  const shell = document.getElementById("globalNavSearch");
  const results = document.getElementById("globalNavSearchResults");
  if (!input || !shell || !results) return;

  const aliasesByRoute = {
    dashboard: ["home", "overview", "start"],
    import: ["excel", "workbook", "upload", "spreadsheet"],
    employees: ["staff", "personnel", "people"],
    issues: ["distribution", "uniform issue", "issued", "register"],
    policies: ["entitlement", "policy", "annual policy", "unit policy"],
    review: ["reviews", "excess", "pending", "decision"],
    held_records: ["hold", "held", "on hold"],
    deductions: ["payroll", "salary", "deduction", "recovery"],
    correction: ["correct", "edit decision"],
    correction_history: ["history", "audit", "correction audit"],
    analytics_monthly: ["report", "monthly", "analytics"],
    analytics_yearly: ["report", "yearly", "annual report", "analytics"],
    analytics_unit: ["report", "unit report", "client report", "analytics"],
    analytics_item: ["report", "item report", "product report", "analytics"],
    analytics_employee: ["report", "employee report", "staff report", "analytics"],
    analytics_payroll_summary: ["report", "payroll", "deduction", "summary"],
    analytics_detailed_report: ["report", "detailed", "deduction", "employee"],
    reset: ["settings", "backup", "restore", "database", "data management"],
  };

  const iconsByRoute = {
    dashboard: "◫", import: "⇧", employees: "◎", issues: "≡", policies: "◇",
    review: "✓", held_records: "◷", deductions: "▤", correction: "⌁",
    correction_history: "◴", reset: "⚙",
  };
  let pages = [];
  let filteredPages = [];
  let activeIndex = -1;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function getSection(button) {
    let sibling = button.previousElementSibling;
    while (sibling && !sibling.classList.contains("nav-header")) sibling = sibling.previousElementSibling;
    if (sibling) return sibling.textContent.trim();
    return button.classList.contains("danger-nav") ? "Settings" : "Workspace";
  }

  function buildPageIndex() {
    const seen = new Set();
    pages = Array.from(document.querySelectorAll(".sidebar .nav-button[data-view]"))
      .filter((button) => {
        const route = button.dataset.view;
        if (!route || seen.has(route)) return false;
        seen.add(route);
        return true;
      })
      .map((button, order) => ({
        route: button.dataset.view,
        label: button.textContent.trim(),
        section: getSection(button),
        aliases: aliasesByRoute[button.dataset.view] || [],
        icon: iconsByRoute[button.dataset.view] || "▥",
        order,
      }));
  }

  function scorePage(page, query) {
    const label = page.label.toLocaleLowerCase();
    if (label === query) return 1000;
    if (label.startsWith(query)) return 800;
    if (label.includes(query)) return 650;
    const aliasScores = page.aliases.map((alias) => {
      const value = alias.toLocaleLowerCase();
      if (value === query) return 600;
      if (value.startsWith(query)) return 500;
      if (value.includes(query)) return 400;
      return 0;
    });
    if (aliasScores.length && Math.max(...aliasScores) > 0) return Math.max(...aliasScores);
    const section = page.section.toLocaleLowerCase();
    if (section === query) return 380;
    if (section.startsWith(query)) return 360;
    if (section.includes(query)) return 340;
    const words = query.split(/\s+/).filter(Boolean);
    return words.length > 1 && words.every((word) => `${label} ${page.aliases.join(" ").toLocaleLowerCase()}`.includes(word)) ? 250 : 0;
  }

  function highlightLabel(label, query) {
    const index = label.toLocaleLowerCase().indexOf(query);
    if (index < 0 || !query) return escapeHtml(label);
    return `${escapeHtml(label.slice(0, index))}<mark>${escapeHtml(label.slice(index, index + query.length))}</mark>${escapeHtml(label.slice(index + query.length))}`;
  }

  function setOpen(isOpen) {
    results.hidden = !isOpen;
    results.classList.toggle("open", isOpen);
    input.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderResults() {
    // The boot process injects a few functional routes asynchronously; rebuild
    // from the live sidebar whenever search is opened or refined.
    buildPageIndex();
    const query = input.value.trim().toLocaleLowerCase();
    if (!query) {
      filteredPages = [];
      activeIndex = -1;
      results.innerHTML = `<div class="global-nav-prompt">Type a page name or feature to search the sidebar.</div>`;
      setOpen(document.activeElement === input);
      return;
    }

    filteredPages = pages
      .map((page) => ({ page, score: scorePage(page, query) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.page.order - right.page.order)
      .map((match) => match.page);

    if (!filteredPages.length) {
      activeIndex = -1;
      results.innerHTML = `<div class="global-nav-empty"><strong>No matching pages</strong><span>Try a page name such as Review Queue or Payroll Register.</span></div>`;
      setOpen(true);
      return;
    }

    if (activeIndex >= filteredPages.length || activeIndex < 0) activeIndex = 0;
    results.innerHTML = filteredPages.map((page, index) => `
      <button class="global-nav-result${index === activeIndex ? " active" : ""}" id="globalNavResult${index}" type="button" role="option" aria-selected="${index === activeIndex}" data-route="${escapeHtml(page.route)}" data-result-index="${index}">
        <span class="global-nav-result-icon" aria-hidden="true">${escapeHtml(page.icon)}</span>
        <span class="global-nav-result-copy"><strong>${highlightLabel(page.label, query)}</strong><small>${escapeHtml(page.section)}</small></span>
        <kbd>Enter</kbd>
      </button>
    `).join("");
    setOpen(true);
    input.setAttribute("aria-activedescendant", `globalNavResult${activeIndex}`);
  }

  function setActiveResult(index) {
    if (!filteredPages.length) return;
    activeIndex = (index + filteredPages.length) % filteredPages.length;
    results.querySelectorAll(".global-nav-result").forEach((button, buttonIndex) => {
      const selected = buttonIndex === activeIndex;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    input.setAttribute("aria-activedescendant", `globalNavResult${activeIndex}`);
    results.querySelector(`#globalNavResult${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }

  function navigate(route) {
    const destination = document.querySelector(`.sidebar .nav-button[data-view="${CSS.escape(route)}"]`);
    if (!destination) return;
    setOpen(false);
    input.value = "";
    filteredPages = [];
    destination.click();
    input.blur();
  }

  input.addEventListener("input", () => {
    activeIndex = 0;
    renderResults();
  });
  input.addEventListener("focus", renderResults);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && filteredPages.length) {
      event.preventDefault();
      setActiveResult(activeIndex + 1);
    } else if (event.key === "ArrowUp" && filteredPages.length) {
      event.preventDefault();
      setActiveResult(activeIndex - 1);
    } else if (event.key === "Enter" && filteredPages.length && activeIndex >= 0) {
      event.preventDefault();
      navigate(filteredPages[activeIndex].route);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!results.hidden) setOpen(false);
      else if (input.value) input.value = "";
      input.focus();
    }
  });

  results.addEventListener("mousedown", (event) => event.preventDefault());
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (button) navigate(button.dataset.route);
  });
  document.addEventListener("click", (event) => {
    if (!shell.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLocaleLowerCase() !== "k") return;
    const target = event.target;
    const isEditable = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (isEditable && target !== input) return;
    event.preventDefault();
    input.focus();
    renderResults();
  });

  window.addEventListener("DOMContentLoaded", () => {
    buildPageIndex();
    // The app boot callback installs dynamic sidebar destinations before this one.
  });
})();
