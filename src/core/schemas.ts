import { z } from 'zod';

export const UploadSignSchema = z.object({
  folder: z.string().optional(),
  maxBytes: z.coerce.number().positive().optional(),
  expiresInSeconds: z.coerce.number().int().positive().default(300),
  webhookUrl: z.string().url().optional(),
  access: z.enum(['public', 'private']).default('public'),
});

export const DownloadSignSchema = z.object({
  publicId: z.string().min(1, 'publicId is required'),
  expiresInSeconds: z.coerce.number().int().positive().default(300),
  resourceType: z.enum(['image', 'raw']).default('image'),
  transform: z.string().optional(),
});

export const CreateFolderSchema = z.object({
  path: z.string().min(1, 'Folder path is required'),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1, 'API key name is required'),
  type: z.enum(['public', 'secret']).default('secret'),
  permissions: z.array(z.enum(['read', 'write', 'delete', 'admin'])).optional(),
  rateLimit: z.coerce.number().int().positive().default(120),
});

export const StorageConfigSchema = z.object({
  provider: z.enum(['local', 's3']),
  s3: z
    .object({
      endpoint: z.string().optional(),
      region: z.string().default('us-east-1'),
      bucket: z.string().min(1, 'Bucket name is required'),
      accessKeyId: z.string().min(1, 'Access key ID is required'),
      secretAccessKey: z.string().min(1, 'Secret access key is required'),
      forcePathStyle: z.boolean().default(false),
    })
    .optional(),
});
