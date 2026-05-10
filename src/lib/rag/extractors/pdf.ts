import { AppError } from "@/lib/errors";
import { normalizeDocumentText } from "@/lib/rag/text";
import type { ExtractedFileContent, ExtractedPage } from "@/lib/types";

type CanvasRuntimeModule = typeof import("@napi-rs/canvas");
type PdfParseRuntimeModule = typeof import("pdf-parse");

function installCanvasPolyfills(canvasModule: CanvasRuntimeModule): void {
  const globalScope = globalThis as Record<string, unknown>;

  globalScope.DOMMatrix ??= canvasModule.DOMMatrix;
  globalScope.DOMPoint ??= canvasModule.DOMPoint;
  globalScope.DOMRect ??= canvasModule.DOMRect;
  globalScope.Image ??= canvasModule.Image;
  globalScope.ImageData ??= canvasModule.ImageData;
  globalScope.Path2D ??= canvasModule.Path2D;
}

async function loadPdfParser(): Promise<PdfParseRuntimeModule["PDFParse"]> {
  try {
    const canvasModule = await import("@napi-rs/canvas");
    installCanvasPolyfills(canvasModule);

    const pdfParseModule = await import("pdf-parse");
    return pdfParseModule.PDFParse;
  } catch {
    throw new AppError(
      "PDF extraction is currently unavailable on the server. Please try again later.",
      500,
    );
  }
}

export async function extractPdfText(
  buffer: Buffer,
): Promise<ExtractedFileContent> {
  const PDFParse = await loadPdfParser();
  const parser = new PDFParse({ data: buffer });

  try {
    const textResult = await parser.getText();
    let pdfPageMetadata: Array<{
      pageNumber: number;
      pageLabel?: string | null;
      width?: number;
      height?: number;
    }> = [];

    try {
      const infoResult = await parser.getInfo({ parsePageInfo: true });
      pdfPageMetadata = infoResult.pages.map((page) => ({
        pageNumber: page.pageNumber,
        pageLabel: page.pageLabel,
        width: page.width,
        height: page.height,
      }));
    } catch {
      pdfPageMetadata = [];
    }

    const pages: ExtractedPage[] = textResult.pages
      .map((page) => {
        const text = normalizeDocumentText(page.text);
        const metadata = pdfPageMetadata.find(
          (item) => item.pageNumber === page.num,
        );

        return {
          pageNumber: page.num,
          text,
          pageLabel: metadata?.pageLabel,
          width: metadata?.width,
          height: metadata?.height,
        };
      })
      .filter((page) => page.text.length > 0);

    return {
      text: pages.map((page) => page.text).join("\n\n").trim(),
      pages,
      pageCount: textResult.total,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "We couldn't extract readable text from the uploaded PDF.",
      400,
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
