import Papa from "papaparse";

import { AppError } from "@/lib/errors";
import { normalizeDocumentText } from "@/lib/rag/text";
import type { ExtractedFileContent } from "@/lib/types";

function buildReadableRow(
  headers: string[],
  row: string[],
  rowIndex: number,
): string {
  const cells = headers.map((header, columnIndex) => {
    const rawValue = row[columnIndex] ?? "";
    const value = normalizeDocumentText(rawValue).replace(/\n/g, " ");
    return `${header}: ${value}`;
  });

  return `Row ${rowIndex}: ${cells.join("; ")}`;
}

export function extractCsvText(buffer: Buffer): ExtractedFileContent {
  const rawText = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<string[]>(rawText, {
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    const rowHint =
      typeof firstError.row === "number"
        ? ` near row ${firstError.row + 1}`
        : "";
    throw new AppError(
      `Unable to parse the uploaded CSV file${rowHint}: ${firstError.message}`,
      400,
    );
  }

  const rows = parsed.data.filter((row): row is string[] => Array.isArray(row));

  if (rows.length === 0) {
    throw new AppError("The uploaded CSV file is empty.", 400);
  }

  const headers = rows[0].map(
    (value, index) => normalizeDocumentText(value) || `column_${index + 1}`,
  );
  const bodyRows = rows.slice(1);

  const lines = [
    `Columns: ${headers.join("; ")}`,
    ...bodyRows.map((row, rowIndex) => buildReadableRow(headers, row, rowIndex + 1)),
  ];

  const text = normalizeDocumentText(lines.join("\n"));

  if (!text) {
    throw new AppError("The uploaded CSV file is empty.", 400);
  }

  return {
    text,
    pages: [
      {
        pageNumber: 1,
        text,
      },
    ],
    pageCount: 1,
  };
}
