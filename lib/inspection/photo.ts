/**
 * Photo capture on site: compressed on the device before it ever joins
 * the queue (this prompt), and stamped with when and where it was taken.
 *
 * Compressing before queueing rather than before uploading is the point.
 * A phone camera photo is 3-8MB; twenty of them is well over 100MB of
 * IndexedDB on a device that may also be low on space, and it is that
 * queue — not the upload — that has to survive a day on site. Compressed
 * first, the same twenty photos are a few megabytes.
 *
 * The sizing and quality decisions are pure and tested; the canvas work
 * itself needs a browser and is deliberately kept to the thinnest
 * possible wrapper around them.
 */

/** Longest edge, in pixels, after compression. Enough to read a certificate or a room label; far less than a 12MP original. */
export const MAX_PHOTO_EDGE_PX = 1600;
export const PHOTO_JPEG_QUALITY = 0.72;
/** Below this, re-encoding costs quality and saves nothing worth having. */
export const COMPRESS_ABOVE_BYTES = 300 * 1024;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Scales to fit the longest edge, preserving aspect ratio, and never
 * enlarges — a photo already smaller than the limit is left at its own
 * size rather than upscaled into a bigger file.
 */
export function targetDimensions(source: Dimensions, maxEdge = MAX_PHOTO_EDGE_PX): Dimensions {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge || longest === 0) return { width: source.width, height: source.height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
}

export function shouldCompress(sizeBytes: number, threshold = COMPRESS_ABOVE_BYTES): boolean {
  return sizeBytes > threshold;
}

export interface CapturedPhoto {
  blob: Blob;
  capturedAt: string;
  geoLat: number | null;
  geoLng: number | null;
  originalBytes: number;
  compressedBytes: number;
}

/**
 * Geolocation, best effort and time-boxed. A photo without coordinates is
 * still worth keeping — a labour accommodation is often a concrete
 * building with no GPS lock — so this resolves to nulls rather than
 * rejecting, and never blocks the capture for more than a few seconds.
 */
export function readGeolocation(timeoutMs = 5000): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: timeoutMs, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}

/** Draws the image at the target size and re-encodes it as JPEG. Browser only. */
async function compressToJpeg(file: Blob, dimensions: Dimensions): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY));
    // If the re-encode somehow came out larger, keep the original — the
    // point is a smaller queue, not a re-encode for its own sake.
    return encoded && encoded.size < file.size ? encoded : file;
  } finally {
    bitmap.close();
  }
}

/**
 * Prepares a camera capture for the queue: compressed, timestamped and
 * located. Falls back to the original bytes if anything about the
 * compression fails — a photo that can't be shrunk is still evidence,
 * and losing it on site is the worse outcome.
 */
export async function capturePhoto(file: File): Promise<CapturedPhoto> {
  const capturedAt = new Date().toISOString();
  const geo = await readGeolocation();

  let blob: Blob = file;
  if (shouldCompress(file.size)) {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = targetDimensions({ width: bitmap.width, height: bitmap.height });
      bitmap.close();
      blob = await compressToJpeg(file, dimensions);
    } catch {
      blob = file;
    }
  }

  return {
    blob,
    capturedAt,
    geoLat: geo.lat,
    geoLng: geo.lng,
    originalBytes: file.size,
    compressedBytes: blob.size,
  };
}
