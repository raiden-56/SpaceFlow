// Local-disk asset storage with strict validation. Uploaded files are never executed or served
// with an executable content type; GLB files are checked for their magic header and PNG/JPEG/SVG
// floor plans are sniffed. SVG is sanitised by rejecting any <script>/on* handlers.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AssetKind } from '@prisma/client';
import type { AssetDto } from '@spaceflow/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assetUrl } from '../../utils/mappers.js';

const ALLOWED: Record<AssetKind, { mimes: string[]; exts: string[] }> = {
  BUILDING_MODEL: { mimes: ['model/gltf-binary', 'application/octet-stream'], exts: ['.glb'] },
  FLOOR_MODEL: { mimes: ['model/gltf-binary', 'application/octet-stream'], exts: ['.glb'] },
  FLOOR_PLAN_IMAGE: { mimes: ['image/png', 'image/jpeg', 'image/svg+xml'], exts: ['.png', '.jpg', '.jpeg', '.svg'] },
};

function sniff(buffer: Buffer, ext: string): string | null {
  if (ext === '.glb') return buffer.subarray(0, 4).toString('ascii') === 'glTF' ? 'model/gltf-binary' : null;
  if (ext === '.png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null;
  if (ext === '.jpg' || ext === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 ? 'image/jpeg' : null;
  if (ext === '.svg') {
    const head = buffer.subarray(0, 4096).toString('utf8');
    if (!/<svg[\s>]/i.test(head)) return null;
    const all = buffer.toString('utf8');
    if (/<script|on[a-z]+\s*=|javascript:|<foreignObject|<iframe|xlink:href\s*=\s*["']?\s*(?!#)/i.test(all)) return null;
    return 'image/svg+xml';
  }
  return null;
}

export async function storeAsset(opts: {
  orgId: string;
  kind: AssetKind;
  fileName: string;
  buffer: Buffer;
  uploadedById: string;
}): Promise<AssetDto> {
  const ext = path.extname(opts.fileName).toLowerCase();
  const rule = ALLOWED[opts.kind];
  if (!rule.exts.includes(ext)) throw AppError.unsupportedFile(`Unsupported file type ${ext || '(none)'}. Allowed: ${rule.exts.join(', ')}`);
  if (opts.buffer.length > env.MAX_UPLOAD_MB * 1024 * 1024) throw AppError.fileTooLarge(`File exceeds the ${env.MAX_UPLOAD_MB} MB limit`);
  if (opts.buffer.length === 0) throw AppError.badRequest('Uploaded file is empty');
  const mime = sniff(opts.buffer, ext);
  if (!mime) throw AppError.unsupportedFile('The file content does not match its extension or contains disallowed content.');

  const checksum = createHash('sha256').update(opts.buffer).digest('hex');
  const dir = path.join(env.uploadDirAbs, opts.orgId);
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${checksum.slice(0, 16)}-${Date.now()}${ext}`;
  const storagePath = path.join(opts.orgId, storedName);
  await fs.writeFile(path.join(env.uploadDirAbs, storagePath), opts.buffer, { flag: 'wx' });

  const row = await prisma.asset.create({
    data: {
      orgId: opts.orgId,
      kind: opts.kind,
      fileName: path.basename(opts.fileName).replace(/[^\w.\- ]/g, '_').slice(0, 120),
      mimeType: mime,
      sizeBytes: opts.buffer.length,
      storagePath,
      checksum,
      uploadedById: opts.uploadedById,
    },
  });
  return toAssetDto(row);
}

export function toAssetDto(a: { id: string; kind: AssetKind; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date }): AssetDto {
  return { id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: assetUrl(a.id)!, createdAt: a.createdAt.toISOString() };
}

export async function readAssetFile(orgId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, orgId } });
  if (!asset) throw AppError.notFound('Asset');
  const abs = path.join(env.uploadDirAbs, asset.storagePath);
  if (!abs.startsWith(env.uploadDirAbs)) throw AppError.notFound('Asset');
  return { asset, abs };
}

export async function deleteAsset(orgId: string, assetId: string) {
  const { asset, abs } = await readAssetFile(orgId, assetId);
  await prisma.asset.delete({ where: { id: asset.id } });
  await fs.unlink(abs).catch(() => undefined);
}
