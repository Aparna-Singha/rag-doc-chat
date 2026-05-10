import { randomUUID } from "node:crypto";

import type { ExtractedPage, SupportedFileType, DocumentChunk } from "@/lib/types";

const MIN_CHUNK_CHARS = 900;
const MAX_CHUNK_CHARS = 1_200;
const CHUNK_OVERLAP_CHARS = 180;
const SNIPPET_MAX_CHARS = 240;
const WORD_BOUNDARY_ADJUSTMENT_LIMIT = 40;

function createSnippet(text: string): string {
  const flattenedText = text.replace(/\s+/g, " ").trim();

  if (flattenedText.length <= SNIPPET_MAX_CHARS) {
    return flattenedText;
  }

  return `${flattenedText.slice(0, SNIPPET_MAX_CHARS - 3).trimEnd()}...`;
}

function findLastBoundaryEnd(
  segment: string,
  pattern: RegExp,
  minimumRelativeEnd: number,
): number | null {
  let lastBoundaryEnd: number | null = null;
  const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
  let match: RegExpExecArray | null = globalPattern.exec(segment);

  while (match) {
    const boundaryEnd = match.index + match[0].length;

    if (boundaryEnd >= minimumRelativeEnd) {
      lastBoundaryEnd = boundaryEnd;
    }

    match = globalPattern.exec(segment);
  }

  return lastBoundaryEnd;
}

function findFallbackBoundaryEnd(
  segment: string,
  minimumRelativeEnd: number,
): number {
  for (let index = segment.length - 1; index >= minimumRelativeEnd; index -= 1) {
    if (/\s/.test(segment[index])) {
      return index + 1;
    }
  }

  return segment.length;
}

function findChunkEnd(text: string, start: number): number {
  const maximumEnd = Math.min(start + MAX_CHUNK_CHARS, text.length);

  if (maximumEnd >= text.length) {
    return text.length;
  }

  const segment = text.slice(start, maximumEnd);
  const minimumRelativeEnd = Math.min(MIN_CHUNK_CHARS, segment.length);
  const boundaryPatterns = [
    /\n{2,}/,
    /[.!?]["')\]]?\s+/,
    /\n/,
    /;\s+/,
    /,\s+/,
    /\s+/,
  ];

  for (const pattern of boundaryPatterns) {
    const boundaryEnd = findLastBoundaryEnd(
      segment,
      pattern,
      minimumRelativeEnd,
    );

    if (boundaryEnd !== null) {
      return start + boundaryEnd;
    }
  }

  return start + findFallbackBoundaryEnd(segment, minimumRelativeEnd);
}

function findNextChunkStart(text: string, currentEnd: number): number {
  if (currentEnd >= text.length) {
    return text.length;
  }

  const desiredStart = Math.max(0, currentEnd - CHUNK_OVERLAP_CHARS);
  let nextStart = desiredStart;

  if (
    nextStart > 0 &&
    /\S/.test(text[nextStart]) &&
    /\S/.test(text[nextStart - 1])
  ) {
    let backwardStart = nextStart;

    while (
      backwardStart > 0 &&
      /\S/.test(text[backwardStart - 1]) &&
      desiredStart - backwardStart < WORD_BOUNDARY_ADJUSTMENT_LIMIT
    ) {
      backwardStart -= 1;
    }

    if (backwardStart !== nextStart) {
      nextStart = backwardStart;
    } else {
      let forwardStart = nextStart;

      while (
        forwardStart < currentEnd &&
        /\S/.test(text[forwardStart]) &&
        forwardStart - desiredStart < WORD_BOUNDARY_ADJUSTMENT_LIMIT
      ) {
        forwardStart += 1;
      }

      nextStart = forwardStart;
    }
  }

  while (nextStart < text.length && /\s/.test(text[nextStart])) {
    nextStart += 1;
  }

  return nextStart;
}

function buildPageChunks(params: {
  documentId: string;
  fileName: string;
  fileType: SupportedFileType;
  page: ExtractedPage;
  startingChunkIndex: number;
}): DocumentChunk[] {
  const pageText = params.page.text.trim();

  if (!pageText) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < pageText.length) {
    const end = findChunkEnd(pageText, start);
    const chunkText = pageText.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        id: randomUUID(),
        documentId: params.documentId,
        fileName: params.fileName,
        fileType: params.fileType,
        chunkIndex: params.startingChunkIndex + chunks.length,
        pageNumber: params.page.pageNumber,
        snippet: createSnippet(chunkText),
        text: chunkText,
      });
    }

    if (end >= pageText.length) {
      break;
    }

    const nextStart = findNextChunkStart(pageText, end);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

export function chunkText(params: {
  documentId: string;
  fileName: string;
  fileType: SupportedFileType;
  text: string;
  pages?: ExtractedPage[];
}): DocumentChunk[] {
  const sourcePages =
    params.pages && params.pages.length > 0
      ? params.pages
      : [
          {
            pageNumber: 1,
            text: params.text,
          },
        ];

  const chunks: DocumentChunk[] = [];

  for (const page of sourcePages) {
    const pageChunks = buildPageChunks({
      documentId: params.documentId,
      fileName: params.fileName,
      fileType: params.fileType,
      page,
      startingChunkIndex: chunks.length,
    });

    chunks.push(...pageChunks);
  }

  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}
