import type { Express, Request, Response } from "express";
import { openai } from "./client";
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { isStaffOrAdmin } from '../../core/middleware';

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", isStaffOrAdmin, async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: size as "1024x1024" | "512x512" | "256x256",
      });

      const imageData = response.data?.[0];
      res.json({
        url: imageData?.url,
        b64_json: imageData?.b64_json,
      });
    } catch (error: unknown) {
      logger.error("Error generating image:", { extra: { error: getErrorMessage(error) } });
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}
