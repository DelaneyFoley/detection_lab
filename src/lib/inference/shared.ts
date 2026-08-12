import fs from "fs";
import path from "path";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".avif": "image/avif",
};

export async function fetchImageAsBase64(imageUri: string): Promise<{ base64: string; mimeType: string }> {
  if (imageUri.startsWith("data:")) {
    const match = imageUri.match(/^data:([^;]+);base64,(.+)$/);
    if (match) return { base64: match[2], mimeType: match[1] };
  }

  if (imageUri.startsWith("/") || imageUri.startsWith("./")) {
    const resolved = imageUri.startsWith("./") ? path.resolve(process.cwd(), imageUri) : imageUri;
    const data = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return { base64: data.toString("base64"), mimeType: IMAGE_MIME_BY_EXT[ext] || "image/jpeg" };
  }

  if (imageUri.startsWith("http")) {
    const resp = await fetch(imageUri);
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "";
    const ext = path.extname(new URL(imageUri).pathname).toLowerCase();
    const mimeType = contentType.startsWith("image/") ? contentType.split(";")[0] : (IMAGE_MIME_BY_EXT[ext] || "image/jpeg");
    return { base64: buf.toString("base64"), mimeType };
  }

  const resolved = path.join(process.cwd(), "data", "uploads", imageUri);
  if (fs.existsSync(resolved)) {
    const data = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return { base64: data.toString("base64"), mimeType: IMAGE_MIME_BY_EXT[ext] || "image/jpeg" };
  }

  throw new Error(`Cannot resolve image URI: ${imageUri}`);
}
