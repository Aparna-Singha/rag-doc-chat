import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { load } from "cheerio";

import { AppError } from "@/lib/errors";
import { getServerConfig } from "@/lib/server-config";
import type { ExtractedPage } from "@/lib/types";

const MAX_REDIRECTS = 3;
const URL_FETCH_USER_AGENT = "Ask My Doc RAG/1.0";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function deriveFallbackSourceName(url: URL): string {
  const pathname = url.pathname === "/" ? "" : url.pathname;
  return `${url.hostname}${pathname}` || url.hostname;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalizedAddress = address.toLowerCase().split("%")[0] ?? address.toLowerCase();

  return (
    normalizedAddress === "::" ||
    normalizedAddress === "::1" ||
    normalizedAddress.startsWith("fc") ||
    normalizedAddress.startsWith("fd") ||
    normalizedAddress.startsWith("fe8") ||
    normalizedAddress.startsWith("fe9") ||
    normalizedAddress.startsWith("fea") ||
    normalizedAddress.startsWith("feb")
  );
}

function isBlockedIpAddress(address: string): boolean {
  const ipVersion = isIP(address);

  if (ipVersion === 4) {
    return isPrivateIpv4(address);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(address);
  }

  return false;
}

async function assertPublicHostname(url: URL): Promise<void> {
  const hostname = url.hostname.trim().toLowerCase();

  if (!hostname) {
    throw new AppError("Enter a valid public URL.", 400);
  }

  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    throw new AppError("Local or private URLs are not allowed.", 400);
  }

  if (isBlockedIpAddress(hostname)) {
    throw new AppError("Local or private URLs are not allowed.", 400);
  }

  try {
    const resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });

    if (resolvedAddresses.some((result) => isBlockedIpAddress(result.address))) {
      throw new AppError("Local or private URLs are not allowed.", 400);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("We couldn't resolve that URL.", 400);
  }
}

function validatePublicUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError("Enter a valid URL.", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("Only public http and https URLs are supported.", 400);
  }

  if (url.username || url.password) {
    throw new AppError("Authenticated URLs are not supported.", 400);
  }

  return url;
}

async function fetchUrlWithRedirects(initialUrl: URL): Promise<{
  response: Response;
  finalUrl: URL;
}> {
  const { urlFetchTimeoutMs } = getServerConfig();
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHostname(currentUrl);

    const response = await fetch(currentUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": URL_FETCH_USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(urlFetchTimeoutMs),
    });

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.get("location");

      if (!location) {
        throw new AppError("The URL redirected without a valid location.", 400);
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return {
      response,
      finalUrl: currentUrl,
    };
  }

  throw new AppError("The URL redirected too many times.", 400);
}

async function readResponseText(response: Response): Promise<string> {
  const { urlMaxBytes } = getServerConfig();
  const contentLengthHeader = response.headers.get("content-length");
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : null;

  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > urlMaxBytes
  ) {
    throw new AppError(
      `The web page is too large to ingest. Maximum size is ${urlMaxBytes} bytes.`,
      400,
    );
  }

  if (!response.body) {
    throw new AppError("The URL response did not include readable content.", 400);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    receivedBytes += value.byteLength;

    if (receivedBytes > urlMaxBytes) {
      throw new AppError(
        `The web page is too large to ingest. Maximum size is ${urlMaxBytes} bytes.`,
        400,
      );
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

function extractReadableTextFromHtml(html: string): {
  sourceName: string | null;
  text: string;
} {
  const $ = load(html);

  $(
    [
      "script",
      "style",
      "noscript",
      "nav",
      "header",
      "footer",
      "aside",
      "form",
      "iframe",
      "svg",
      "canvas",
      "button",
    ].join(","),
  ).remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  const sourceName = normalizeWhitespace($("title").first().text()) || null;
  const preferredRoot =
    $("main").first().length > 0
      ? $("main").first()
      : $("article").first().length > 0
        ? $("article").first()
        : $("body").first();
  const blockSelectors = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th";
  const blocks = preferredRoot.find(blockSelectors);
  const segments: string[] = [];

  if (blocks.length > 0) {
    blocks.each((_, element) => {
      const text = normalizeWhitespace($(element).text());

      if (text) {
        segments.push(text);
      }
    });
  }

  const text =
    segments.length > 0
      ? segments.join("\n\n")
      : normalizeWhitespace(preferredRoot.text());

  return {
    sourceName,
    text,
  };
}

export async function extractTextFromUrl(rawUrl: string): Promise<{
  sourceName: string;
  sourceUrl: string;
  text: string;
  pages: ExtractedPage[];
}> {
  const url = validatePublicUrl(rawUrl);
  const { response, finalUrl } = await fetchUrlWithRedirects(url);

  if (!response.ok) {
    throw new AppError(
      `We couldn't fetch that URL. The server responded with ${response.status}.`,
      400,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml") &&
    !contentType.includes("text/plain")
  ) {
    throw new AppError("That URL did not return a supported text or HTML page.", 400);
  }

  const responseText = await readResponseText(response);
  const extracted =
    contentType.includes("text/plain")
      ? {
          sourceName: null,
          text: normalizeWhitespace(responseText),
        }
      : extractReadableTextFromHtml(responseText);
  const text = extracted.text.trim();

  if (!text) {
    throw new AppError("We couldn't extract readable text from that web page.", 400);
  }

  return {
    sourceName: extracted.sourceName ?? deriveFallbackSourceName(finalUrl),
    sourceUrl: finalUrl.toString(),
    text,
    pages: [
      {
        pageNumber: 1,
        text,
      },
    ],
  };
}
