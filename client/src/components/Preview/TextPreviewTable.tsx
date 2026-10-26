import { useMemo } from "react";
import { parsePreviewTable } from "../../features/workspace/textPreviewFormats";

export function TextPreviewTable({
  text,
  delimiter,
  complete,
}: {
  text: string;
  delimiter: string;
  complete: boolean;
}) {
  const result = useMemo(
    () => parsePreviewTable(text, delimiter, complete),
    [text, delimiter, complete],
  );
  return (
    <>
      <p className="text-preview-note">
        Table preview: at most 200 rows, 32 columns and 2,048 characters per cell. First row is the
        header. Search and copy use raw loaded text.
      </p>
      {result.limited && (
        <p className="text-preview-note">
          Table truncated at a row, column or cell limit. Raw text remains available.
        </p>
      )}
      {result.incomplete && (
        <p className="text-preview-note">
          Incomplete final record omitted. More bytes may contain the rest of a quoted field.
        </p>
      )}
      {result.invalid && (
        <p role="alert">Malformed quoted table. Switch to Raw text to inspect the original.</p>
      )}
      {/* Keyboard users must be able to scroll wide tables. */}
      <div
        className="text-table-scroll"
        data-preview-scroll
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The table viewport must support keyboard scrolling.
        tabIndex={0}
        role="region"
        aria-label="Table content"
      >
        <table>
          <thead>
            <tr>
              {result.rows[0]?.map((cell, index) => (
                <th scope="col" key={index}>
                  {cell || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(1).map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!result.rows.length && <p>No complete records in the loaded chunk.</p>}
      </div>
    </>
  );
}
