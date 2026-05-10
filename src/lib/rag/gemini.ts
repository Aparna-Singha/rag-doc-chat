import { GoogleGenAI } from "@google/genai";

import { getServerConfig } from "@/lib/server-config";

let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (geminiClient) {
    return geminiClient;
  }

  const config = getServerConfig();
  geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return geminiClient;
}
