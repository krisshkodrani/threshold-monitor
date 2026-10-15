import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { expect, test } from "vitest";
import { DataTable, type Column } from "./DataTable";

type Fruit = { id: string; name: string; count: number };

const fruits: Fruit[] = [
  { id: "a", name: "Apple", count: 3 },
  { id: "b", name: "Banana", count: 12 },
];

const columns: Column<Fruit>[] = [
  { id: "name", header: "Name", cell: (f) => f.name, title: (f) => f.name },
  {
    id: "count",
    header: "Count",
    cell: (f) => <strong>{f.count}</strong>,
    width: "6rem",
    className: "num",
  },
];

function renderTable(rows: Fruit[] = fruits) {
  return render(
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(f) => f.id}
      label="Scrollable fruit list"
      rowClassName={(f) => (f.count > 10 ? "many" : undefined)}
      empty={<p>No fruit.</p>}
      minWidth="20rem"
    />,
  );
}

test("renders a header row and one row per item, with cells from the columns", () => {
  renderTable();
  const [head, ...body] = screen.getAllByRole("row");
  expect(
    within(head!)
      .getAllByRole("columnheader")
      .map((th) => th.textContent),
  ).toEqual(["Name", "Count"]);
  expect(body).toHaveLength(2);
  expect(within(body[1]!).getByText("12").tagName).toBe("STRONG");
});

test("applies column widths, cell classes, titles and row classes", () => {
  const { container } = renderTable();
  const cols = container.querySelectorAll("col");
  expect(cols[0]!.style.width).toBe("");
  expect(cols[1]!.style.width).toBe("6rem");
  expect(screen.getByText("12").closest("td")).toHaveClass("num");
  expect(screen.getByText("Apple").closest("td")).toHaveAttribute(
    "title",
    "Apple",
  );
  expect(screen.getByText("Banana").closest("tr")).toHaveClass("many");
  expect(screen.getByText("Apple").closest("tr")).not.toHaveAttribute("class");
});

test("the scroll area is a named, focusable region", () => {
  renderTable();
  const region = screen.getByRole("region", { name: "Scrollable fruit list" });
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region).toContainElement(screen.getByRole("table"));
});

test("shows the empty element and no table when there are no rows", () => {
  renderTable([]);
  expect(screen.getByText("No fruit.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("has no detectable accessibility violations", async () => {
  const { container } = renderTable();
  const results = await axe.run(container, {
    // jsdom cannot compute colors; contrast is checked in the browser.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
