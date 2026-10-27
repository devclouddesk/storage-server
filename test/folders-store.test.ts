import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldersStore } from '../src/core/folders-store.js';

describe('foldersStore (Virtual & Physical Folder Management)', () => {
  let tempConfigPath: string;
  let originalFilePath: string;

  beforeEach(() => {
    tempConfigPath = path.join(os.tmpdir(), `folders-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    originalFilePath = (foldersStore as any).filePath;
    (foldersStore as any).filePath = tempConfigPath;
  });

  afterEach(() => {
    (foldersStore as any).filePath = originalFilePath;
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  it('creates and normalizes a folder path', async () => {
    const folder = await foldersStore.createFolder('products/summer-sale//');

    expect(folder.path).toBe('products/summer-sale');
    expect(folder.name).toBe('summer-sale');
    expect(folder.parent).toBe('products');
    expect(folder.count).toBe(0);
    expect(folder.createdAt).toBeGreaterThan(0);
  });

  it('lists created folders correctly', async () => {
    await foldersStore.createFolder('users');
    await foldersStore.createFolder('products');
    await foldersStore.createFolder('products/shoes');

    const allFolders = await foldersStore.listFolders();
    const paths = allFolders.map((f) => f.path);

    expect(paths).toContain('users');
    expect(paths).toContain('products');
    expect(paths).toContain('products/shoes');
  });

  it('filters folders by parent directory', async () => {
    await foldersStore.createFolder('docs');
    await foldersStore.createFolder('docs/api');
    await foldersStore.createFolder('docs/guides');

    const subFolders = await foldersStore.listFolders('docs');
    expect(subFolders.length).toBe(2);
    expect(subFolders.map((f) => f.path)).toEqual(['docs/api', 'docs/guides']);
  });

  it('deletes an explicit folder', async () => {
    await foldersStore.createFolder('temp-folder');
    const beforeList = await foldersStore.listFolders();
    expect(beforeList.some((f) => f.path === 'temp-folder')).toBe(true);

    const { success } = await foldersStore.deleteFolder('temp-folder');
    expect(success).toBe(true);

    const afterList = await foldersStore.listFolders();
    expect(afterList.some((f) => f.path === 'temp-folder')).toBe(false);
  });
});
