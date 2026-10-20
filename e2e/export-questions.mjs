import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
const source = new URL("../docs/interview-questions.html", import.meta.url);
const destination = fileURLToPath(
  new URL("../docs/interview-questions.pdf", import.meta.url),
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(source.href);
  if ((await page.locator("article").count()) !== 14)
    throw new Error("Expected 14 interview questions");
  await page.pdf({
    path: destination,
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font-size:9px;color:#637083;width:100%;text-align:center">Threshold Monitor · Interview questions · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  console.log(`Exported ${destination}`);
} finally {
  await browser.close();
}
