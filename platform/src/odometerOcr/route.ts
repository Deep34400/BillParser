/**
 * Odometer OCR Routes — completely separate from invoice parsing.
 * Uses the SAME pipeline settings (single/split, provider, model) from Settings page.
 * POST /api/odometer/extract — extract odometer reading from an image URL or uploaded file.
 * POST /api/odometer/batch   — extract from multiple image URLs.
 */
import type { FastifyInstance } from 'fastify';
import { extractOdometerReading, fetchImageFromUrl } from './service.js';

export async function odometerRoutes(app: FastifyInstance) {
  /**
   * POST /api/odometer/extract
   * Body (JSON): { imageUrl: string, crossVerify?: boolean, lastKnownKm?: number }
   * OR multipart form with file upload.
   */
  app.post('/api/odometer/extract', async (req, reply) => {
    const contentType = req.headers['content-type'] ?? '';
    let buf: Buffer;
    let source: string;
    let crossVerify = false;
    let lastKnownKm: number | undefined;

    if (contentType.includes('multipart/form-data')) {
      const file = await req.file();
      if (!file) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      buf = await file.toBuffer();
      source = file.filename ?? 'upload';
      const fields = file.fields as any;
      if (fields?.crossVerify?.value === 'true') crossVerify = true;
      if (fields?.lastKnownKm?.value) lastKnownKm = Number(fields.lastKnownKm.value) || undefined;
    } else {
      const body = req.body as { imageUrl?: string; crossVerify?: boolean; lastKnownKm?: number };
      if (!body?.imageUrl) {
        return reply.status(400).send({ success: false, error: 'imageUrl is required' });
      }
      source = body.imageUrl;
      if (body.crossVerify) crossVerify = true;
      if (body.lastKnownKm != null) lastKnownKm = Number(body.lastKnownKm) || undefined;

      try {
        buf = await fetchImageFromUrl(body.imageUrl);
      } catch (err) {
        return reply.status(400).send({ success: false, error: `Failed to fetch image: ${(err as Error).message}` });
      }
    }

    if (buf.length < 100) {
      return reply.status(400).send({ success: false, error: 'Image too small or invalid' });
    }

    try {
      const result = await extractOdometerReading(buf, { crossVerify, lastKnownKm });
      return {
        success: true,
        data: {
          odometer_km: result.final_km,
          source,
          pipelineMode: result.pipelineMode,
          providers: result.providers,
          needsReview: result.needsReview,
          reviewReason: result.reviewReason,
          primary: result.primary,
          secondary: result.secondary ?? null,
        },
      };
    } catch (err) {
      console.error('[OdometerOCR] Extraction failed:', err);
      return reply.status(500).send({
        success: false,
        error: `Extraction failed: ${(err as Error).message}`,
      });
    }
  });

  /**
   * POST /api/odometer/batch
   * Body: { images: Array<{ url: string, id?: string }>, crossVerify?: boolean }
   */
  app.post('/api/odometer/batch', async (req, reply) => {
    const body = req.body as {
      images?: Array<{ url: string; id?: string }>;
      crossVerify?: boolean;
    };

    if (!body?.images?.length) {
      return reply.status(400).send({ success: false, error: 'images array is required' });
    }

    if (body.images.length > 20) {
      return reply.status(400).send({ success: false, error: 'Maximum 20 images per batch' });
    }

    const crossVerify = body.crossVerify ?? false;

    const results = await Promise.allSettled(
      body.images.map(async (img) => {
        const buf = await fetchImageFromUrl(img.url);
        const result = await extractOdometerReading(buf, { crossVerify });
        return {
          id: img.id ?? img.url,
          url: img.url,
          odometer_km: result.final_km,
          confidence: result.primary.confidence,
          provider: result.primary.provider,
          model: result.primary.model,
          pipelineMode: result.pipelineMode,
          raw_text: result.primary.raw_text,
          notes: result.primary.notes,
          latency_ms: result.primary.latency_ms,
          needsReview: result.needsReview,
          reviewReason: result.reviewReason,
        };
      }),
    );

    const data = results.map((r, i) => {
      if (r.status === 'fulfilled') return { ...r.value, success: true };
      return {
        id: body.images![i].id ?? body.images![i].url,
        url: body.images![i].url,
        success: false,
        error: (r.reason as Error).message,
        odometer_km: null,
      };
    });

    return { success: true, data };
  });
}
