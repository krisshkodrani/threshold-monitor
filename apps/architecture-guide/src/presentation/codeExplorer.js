export function mountCodeExplorer({ $, $$, listen, navigate, t }) {
  const topicPicker = $("#code-topic");
  const reader = $(".code-reader");
  const buttons = $$("[data-code]");
  const order = [...buttons]
    .sort((a, b) => Number(a.dataset.codeOrder) - Number(b.dataset.codeOrder))
    .map((button) => button.dataset.code);
  let selected = order[0];
  $$("[data-code-group]").forEach((group) => {
    const options = document.createElement("optgroup");
    options.label = group.dataset.codeGroup;
    group.querySelectorAll("[data-code]").forEach((button) => {
      const option = document.createElement("option");
      option.value = button.dataset.code;
      option.textContent = button.querySelector("strong").textContent;
      options.append(option);
    });
    topicPicker.append(options);
  });
  listen($("#code-previous"), "click", () =>
    selectCode(order[order.indexOf(selected) - 1]),
  );
  listen($("#code-next"), "click", () =>
    selectCode(order[order.indexOf(selected) + 1]),
  );
  listen(topicPicker, "change", () => selectCode(topicPicker.value));
  function selectCode(id) {
    const button = $(`[data-code="${id}"]`);
    if (!button) return;
    selected = id;
    topicPicker.value = id;
    reader.scrollTop = 0;
    const index = order.indexOf(id);
    $("#code-example-position").textContent = `${index + 1} / ${order.length}`;
    $("#code-previous").disabled = index === 0;
    $("#code-next").disabled = index === order.length - 1;
    if (!$("#code").hidden) {
      const files = $(".file-browser");
      const item = button.getBoundingClientRect();
      const viewport = files.getBoundingClientRect();
      if (item.bottom > viewport.bottom)
        files.scrollTop += item.bottom - viewport.bottom + 8;
      else if (item.top < viewport.top)
        files.scrollTop -= viewport.top - item.top + 8;
    }
    if (button?.closest("details")) button.closest("details").open = true;
    $$("[data-code]").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.code === id),
    );
    $$("[data-code-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.codePanel !== id;
      panel.id = "code-panel-" + panel.dataset.codePanel;
      panel.tabIndex = -1;
    });
    $$("[data-code]").forEach((button) =>
      button.setAttribute("aria-controls", "code-panel-" + button.dataset.code),
    );
  }
  $$("[data-code]").forEach((b) =>
    listen(b, "click", () => selectCode(b.dataset.code)),
  );
  selectCode("source");
  let toastTimer;
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toast").hidden = true), 2600);
  }
  listen(document, "click", async (e) => {
    const open = e.target.closest("[data-open-code]");
    if (open) {
      selectCode(open.dataset.openCode);
      navigate("code");
      const panel = $("#code-panel-" + open.dataset.openCode);
      panel.focus({ preventScroll: true });
      reader.scrollTop = 0;
    }
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try {
        if (!navigator.clipboard) throw Error("Clipboard unavailable");
        await navigator.clipboard.writeText(
          $("#snippet-" + copy.dataset.copy).textContent,
        );
        toast(t("Code excerpt copied."));
      } catch {
        const range = document.createRange();
        range.selectNodeContents($("#snippet-" + copy.dataset.copy));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        toast(t("Excerpt selected. Press Ctrl+C or ⌘C to copy."));
      }
    }
  });
  return {
    selectCode,
    dispose() {
      clearTimeout(toastTimer);
    },
  };
}
