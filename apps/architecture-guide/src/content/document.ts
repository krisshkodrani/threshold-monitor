import { learningPath } from "./learningPath";
import { sourceHref } from "./sourceHref";
import shell from "./shell.html?raw";
import overview from "./overview.html?raw";
import simulator from "./simulator.html?raw";
import code from "./code.html?raw";
const pages: Record<string, string> = {
  overview,
  simulator,
  code,
  language: learningPath(),
};
// Only repository-authored HTML is rendered here. User input never enters this template.
const document = shell.replace(
  /\{\{(\w+)\}\}/g,
  (_, page: string) => pages[page] ?? "",
);

export const guideDocument = document.replace(
  /href="(\.\.\/[^"]+|architecture\.md|proposed-improvements\.md)"/g,
  (_, href: string) => {
    const path = href.startsWith("../") ? href.slice(3) : "docs/" + href;
    return `href="${sourceHref(path)}"`;
  },
);
