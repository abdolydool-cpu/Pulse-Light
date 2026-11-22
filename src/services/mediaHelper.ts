import { SCHEMA_LIMITS } from '../core/types';

export interface CompressedAttachment {
  kind: 'image' | 'audio';
  name: string;
  bytes: number;
  dataUrl: string;
}

/**
 * Compresses an image file client-side onto a small canvas (max 360px wide)
 * so low-bandwidth users send tiny thumbnails (typically 8–45 KB instead of MBs).
 */
export async function compressImageFile(file: File): Promise<CompressedAttachment> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = bitmapUrl;
    });

    const maxDim = 360;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D unavailable');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.62;
    let dataUrl = canvas.toDataURL('image/webp', quality);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    while (dataUrl.length > SCHEMA_LIMITS.MAX_ATTACHMENT_BYTES && quality > 0.25) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > SCHEMA_LIMITS.MAX_ATTACHMENT_BYTES) {
      throw new Error('Image remains larger than 120 KB after compression.');
    }

    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'photo';
    return {
      kind: 'image',
      name: `${baseName}_lite.jpg`,
      bytes: dataUrl.length,
      dataUrl,
    };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to encode audio clip'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Audio read error'));
    reader.readAsDataURL(blob);
  });
}
