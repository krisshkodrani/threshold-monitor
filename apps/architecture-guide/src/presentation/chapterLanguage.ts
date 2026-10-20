import german from "../content/translations/de.json";
export type ChapterLanguage = "en" | "de";
const translations: Readonly<Record<string, string>> = german;
const LANGUAGE_KEY = "threshold-guide-chapter-language";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(translations)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([english, translated]) => {
    const slots: string[] = [];
    const pattern = english
      .split(/(\{\d+\})/)
      .map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          slots.push(part);
          return "(.+?)";
        }
        return escapePattern(part);
      })
      .join("");
    return {
      regex: new RegExp("^" + pattern + "$"),
      slots,
      translated,
      weight: english.replace(/\{\d+\}/g, "").length,
    };
  })
  .sort((a, b) => b.weight - a.weight);
const reverse = new Map(
  Object.entries(translations)
    .filter(([key]) => !/\{\d+\}/.test(key))
    .map(([en, de]) => [de, en]),
);
export function chapterText(
  text: string,
  language: ChapterLanguage,
  depth = 0,
): string {
  if (language === "en") return text;
  const key = normalize(text);
  if (translations[key]) return translations[key];
  if (depth > 2) return text;
  for (const { regex, slots, translated } of patterns) {
    const match = key.match(regex);
    if (!match) continue;
    const values = new Map(
      slots.map((slot, i) => [
        slot,
        chapterText(match[i + 1]!, language, depth + 1),
      ]),
    );
    return translated.replace(/\{\d+\}/g, (slot) => values.get(slot) ?? slot);
  }
  return text;
}
export function chapterTitles(language: ChapterLanguage) {
  return Object.fromEntries(
    Object.entries({
      overview: "System overview",
      simulator: "Live simulator",
      code: "Code explorer",
    }).map(([id, title]) => [id, chapterText(title, language)]),
  );
}

/** Translate presentation-owned text in place, including freshly rendered SVGs
 * and tooltips. Source code, wire payloads, and React portals keep their owners. */
export function mountChapterLanguage(
  onChange: (language: ChapterLanguage) => void,
) {
  const protectedText =
    "pre, code, .chapter-language, #sim-relay-records, #sim-monitor-records, #sim-control-records, #project-navigation-target";
  const texts = new WeakMap<Text, { english: string; translated: string }>();
  const attrs = new WeakMap<
    Element,
    Map<string, { english: string; translated: string }>
  >();
  const names = ["aria-label", "title", "placeholder", "label", "alt"];
  let language: ChapterLanguage = "en";
  let disposed = false;
  const protocolNames = new Set([
    "hello",
    "welcome",
    "reading",
    "alert",
    "accepted",
    "ack",
    "acknowledged",
    "settings",
    "setSettings",
    "settingsApplied",
    "sensorStatus",
  ]);
  function localizeText(node: Text) {
    if (node.parentElement?.closest(protectedText)) return;
    if (
      node.parentElement?.closest(
        ".message-type, .sim-route-label, .tag-list",
      ) &&
      protocolNames.has(normalize(node.data))
    )
      return;
    const raw = node.data,
      previous = texts.get(node);
    const english =
      previous && raw === previous.translated
        ? previous.english
        : translations[normalize(raw)]
          ? raw
          : (reverse.get(normalize(raw)) ?? raw);
    const axisLabel =
      node.parentElement?.localName === "text" &&
      ["upper", "lower"].includes(normalize(english));
    const translated =
      language === "de" && axisLabel
        ? normalize(english) === "upper"
          ? "oben"
          : "unten"
        : language === "en"
          ? english
          : chapterText(english, language);
    const output =
      translated === english
        ? english
        : (english.match(/^\s*/)?.[0] ?? "") +
          translated +
          (english.match(/\s*$/)?.[0] ?? "");
    texts.set(node, { english, translated: output });
    if (raw !== output) node.data = output;
  }
  function localizeElement(element: Element) {
    if (
      element.closest(
        "#sim-relay-records, #sim-monitor-records, #sim-control-records, #project-navigation-target, .chapter-language",
      )
    )
      return;
    if (element.matches("pre, code")) {
      element.setAttribute("lang", "en");
      element.setAttribute("translate", "no");
    }
    let records = attrs.get(element);
    if (!records) {
      records = new Map();
      attrs.set(element, records);
    }
    for (const name of names) {
      const raw = element.getAttribute(name);
      if (!raw) continue;
      const previous = records.get(name);
      const english =
        previous && raw === previous.translated
          ? previous.english
          : (reverse.get(raw) ?? raw);
      let translated = chapterText(english, language);
      if (language === "de" && /^Copy .+ excerpt$/.test(english))
        translated = `Codeauszug aus ${english.slice(5, -8)} kopieren`;
      if (language === "de" && english.startsWith("Code excerpt from "))
        translated = "Codeauszug aus " + english.slice(18);
      records.set(name, { english, translated });
      if (raw !== translated) element.setAttribute(name, translated);
    }
  }
  function scan(root: Node) {
    if (disposed || !root.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      localizeText(root as Text);
      return;
    }
    if (!(root instanceof Element)) return;
    localizeElement(root);
    if (root.matches(protectedText)) return;
    for (const code of root.querySelectorAll("pre, code")) {
      code.setAttribute("lang", "en");
      code.setAttribute("translate", "no");
    }
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node instanceof Element && node.matches(protectedText)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node instanceof Element) localizeElement(node);
      else localizeText(node as Text);
    }
  }
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-guide-language]"),
  );
  function apply(next: ChapterLanguage) {
    language = next;
    document.documentElement.lang = next;
    for (const chapter of document.querySelectorAll<HTMLElement>(".page"))
      chapter.lang = next;
    for (const excerpt of document.querySelectorAll<HTMLElement>("pre, code")) {
      excerpt.lang = "en";
      excerpt.translate = false;
    }
    for (const button of buttons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.guideLanguage === next),
      );
    scan(document.body);
  }
  function onClick(event: Event) {
    const button = (event.target as Element).closest<HTMLElement>(
      "[data-guide-language]",
    );
    const next = button?.dataset.guideLanguage;
    if ((next !== "en" && next !== "de") || language === next) return;
    apply(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      /* Preference storage is optional. */
    }
    onChange(next);
    button?.focus({ preventScroll: true });
  }
  let saved: ChapterLanguage = "en";
  try {
    if (localStorage.getItem(LANGUAGE_KEY) === "de") saved = "de";
  } catch {
    /* Use English without storage. */
  }
  apply(saved);
  onChange(saved);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(scan);
      else scan(record.target);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: names,
  });
  document.addEventListener("click", onClick);
  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick);
    apply("en");
    disposed = true;
  };
}
