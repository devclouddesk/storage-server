import { describe, expect, it } from 'vitest';
import { formatAssetResponse } from '../src/core/asset-serializer.js';
import type { MediaFileRecord } from '../src/types/index.js';

describe('formatAssetResponse (Cloudinary & SDK Compatibility)', () => {
  it('formats an image asset response correctly with Cloudinary and camelCase fields', () => {
    const mockRecord: MediaFileRecord = {
      id: 'ast_12345678',
      publicId: 'users/avatars/profile_pic',
      originalName: 'photo.jpg',
      folder: 'users/avatars',
      mimeType: 'image/jpeg',
      format: 'jpg',
      bytes: 245000,
      width: 1200,
      height: 800,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'etag_abc123',
      access: 'public',
      createdAt: 1761570000,
    };

    const baseUrl = 'http://localhost:7100';
    const res = formatAssetResponse(mockRecord, baseUrl);

    // Standard Cloudinary fields
    expect(res.asset_id).toBe('ast_12345678');
    expect(res.public_id).toBe('users/avatars/profile_pic');
    expect(res.version).toBe(1761570000);
    expect(res.version_id).toBe('v1761570000');
    expect(res.signature).toBe('etag_abc123');
    expect(res.width).toBe(1200);
    expect(res.height).toBe(800);
    expect(res.format).toBe('jpg');
    expect(res.resource_type).toBe('image');
    expect(res.bytes).toBe(245000);
    expect(res.type).toBe('upload');
    expect(res.url).toBe('http://localhost:7100/image/upload/users/avatars/profile_pic.jpg');
    expect(res.secure_url).toBe('http://localhost:7100/image/upload/users/avatars/profile_pic.jpg');
    expect(res.original_filename).toBe('photo');
    expect(res.display_name).toBe('photo.jpg');
    expect(res.folder).toBe('users/avatars');
    expect(res.access).toBe('public');

    // CamelCase aliases
    expect(res.publicId).toBe('users/avatars/profile_pic');
    expect(res.resourceType).toBe('image');
    expect(res.secureUrl).toBe('http://localhost:7100/image/upload/users/avatars/profile_pic.jpg');
    expect(res.rawUrl).toBe('http://localhost:7100/raw/upload/users/avatars/profile_pic.jpg');
    expect(res.createdAt).toBe(1761570000);
  });

  it('formats raw documents/archives using raw/upload endpoint prefix', () => {
    const rawRecord: MediaFileRecord = {
      id: 'raw_887766',
      publicId: 'contracts/legal_agreement',
      originalName: 'NDA_Signed.pdf',
      folder: 'contracts',
      mimeType: 'application/pdf',
      format: 'pdf',
      bytes: 1048576,
      resourceType: 'raw',
      storageDriver: 's3',
      etag: 'etag_pdf_999',
      access: 'private',
      createdAt: 1761580000,
    };

    const res = formatAssetResponse(rawRecord, 'https://cdn.example.com/');

    expect(res.resource_type).toBe('raw');
    expect(res.url).toBe('https://cdn.example.com/raw/upload/contracts/legal_agreement.pdf');
    expect(res.secure_url).toBe('https://cdn.example.com/raw/upload/contracts/legal_agreement.pdf');
    expect(res.access).toBe('private');
    expect(res.storageDriver).toBe('s3');
  });

  it('handles root folder slash normalization cleanly', () => {
    const rootRecord: MediaFileRecord = {
      id: 'root_1',
      publicId: 'banner',
      originalName: 'banner.png',
      folder: '/',
      mimeType: 'image/png',
      format: 'png',
      bytes: 50000,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'etag_1',
      createdAt: 1761500000,
    };

    const res = formatAssetResponse(rootRecord, 'http://localhost:7100');
    expect(res.folder).toBe('');
    expect(res.url).toBe('http://localhost:7100/image/upload/banner.png');
  });
});
