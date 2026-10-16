import type { ReactNode } from "react";
import "./DataTable.css";

/**
 * One column: what it shows, not how the table works. `cell` is a render
 * function, so each app keeps its own formats, chips and buttons.
 */
export type Column<T> = {
  /** Unique within the table; the React key of the column. */
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** A CSS length. Columns without a width share the rest of the table. */
  width?: string;
  /** A class for each cell of the column, for example "num". */
  className?: string;
  /** Tooltip text for each cell, for content that the column cuts with "…". */
  title?: (row: T) => string;
};

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** The accessible name of the scroll area, for example "Scrollable alert log". */
  label: string;
  rowClassName?: (row: T) => string | undefined;
  /** Shown in place of the table when there are no rows. */
  empty?: ReactNode;
  /** Below this width the table scrolls sideways, not squashed. */
  minWidth?: string;
};

/**
 * A table for live lists. It does the layout work once for both apps:
 * - a box with a fixed height: the rows scroll, and the header row stays;
 * - a fixed layout: a change in a cell does not move the columns;
 * - a focusable, named region, so keyboard users can scroll it too.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  rowClassName,
  empty = null,
  minWidth,
}: DataTableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="data-table" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table__table" style={{ minWidth }}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              // The key, so a row can be found again after live updates.
              data-key={rowKey(row)}
              className={rowClassName?.(row)}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={column.className}
                  title={column.title?.(row)}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
