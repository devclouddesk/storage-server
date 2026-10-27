import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/env.js';
import { filesStore } from './files-store.js';

export interface FolderItem {
  id: string;
  name: string;
  path: string;
  parent: string;
  count: number;
  createdAt: number;
}

class FoldersStore {
  private filePath: string;

  constructor(filePath: string = path.join(paths.config, 'folders.json')) {
    this.filePath = filePath;
  }

  private ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readExplicitFolders(): FolderItem[] {
    this.ensureDir();
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private saveExplicitFolders(folders: FolderItem[]) {
    this.ensureDir();
    const tempFile = `${this.filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tempFile, JSON.stringify(folders, null, 2), 'utf-8');
    try {
      fs.renameSync(tempFile, this.filePath);
    } catch (err: any) {
      if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EEXIST' || err.code === 'EACCES') {
        fs.copyFileSync(tempFile, this.filePath);
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      } else {
        throw err;
      }
    }
  }

  private sanitizeFolderPath(input: string): string {
    if (!input || input === '.' || input === '/') return '';
    const normalized = path.normalize(input).replace(/^(\.\.[\/\\])+/, '');
    if (normalized === '.' || normalized === './') return '';
    return normalized.replace(/^[\/\\]+|[\/\\]+$/g, '').replace(/\\/g, '/');
  }

  /**
   * Returns all folders (both explicitly created and derived from uploaded media)
   * with accurate real-time file counts.
   */
  async listFolders(parent?: string): Promise<FolderItem[]> {
    const explicit = this.readExplicitFolders();
    const { files } = await filesStore.listMediaFiles(10000, 0);

    const folderMap = new Map<string, FolderItem>();

    // 1. Seed explicit folders
    for (const f of explicit) {
      const cleanPath = this.sanitizeFolderPath(f.path);
      if (!cleanPath) continue;
      const parts = cleanPath.split('/');
      const name = parts[parts.length - 1];
      const p = parts.slice(0, -1).join('/');

      folderMap.set(cleanPath, {
        id: f.id || cleanPath,
        name,
        path: cleanPath,
        parent: p,
        count: 0,
        createdAt: f.createdAt || Date.now(),
      });
    }

    // 2. Discover implicit folders from existing files and calculate file counts
    for (const file of files) {
      const fileFolder = this.sanitizeFolderPath(file.folder || '');
      if (!fileFolder || fileFolder === '/' || fileFolder === '.') continue;

      // Add parent path hierarchy if not already present
      const segments = fileFolder.split('/');
      let currentAcc = '';
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segParent = currentAcc;
        currentAcc = currentAcc ? `${currentAcc}/${seg}` : seg;

        if (!folderMap.has(currentAcc)) {
          folderMap.set(currentAcc, {
            id: currentAcc,
            name: seg,
            path: currentAcc,
            parent: segParent,
            count: 0,
            createdAt: file.createdAt ? file.createdAt * 1000 : Date.now(),
          });
        }
      }

      // Increment file count for the exact folder
      const folderEntry = folderMap.get(fileFolder);
      if (folderEntry) {
        folderEntry.count += 1;
      }
    }

    let result = Array.from(folderMap.values());

    // Filter by parent if requested (for hierarchical browsing)
    if (parent !== undefined) {
      const cleanParent = this.sanitizeFolderPath(parent);
      result = result.filter((f) => f.parent === cleanParent);
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /**
   * Creates a new folder (e.g. "avatars", "products", "products/shoes")
   */
  async createFolder(rawPath: string): Promise<FolderItem> {
    const cleanPath = this.sanitizeFolderPath(rawPath);
    if (!cleanPath) {
      throw new Error('Folder name cannot be empty');
    }

    const explicit = this.readExplicitFolders();
    const existing = explicit.find((f) => this.sanitizeFolderPath(f.path) === cleanPath);
    if (existing) {
      return existing;
    }

    const parts = cleanPath.split('/');
    const name = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join('/');

    const newItem: FolderItem = {
      id: cleanPath,
      name,
      path: cleanPath,
      parent,
      count: 0,
      createdAt: Date.now(),
    };

    explicit.push(newItem);
    this.saveExplicitFolders(explicit);

    return newItem;
  }

  /**
   * Deletes a folder and all files contained within it
   */
  async deleteFolder(rawPath: string): Promise<{ success: boolean; deletedCount: number }> {
    const cleanPath = this.sanitizeFolderPath(rawPath);
    if (!cleanPath) {
      return { success: false, deletedCount: 0 };
    }

    // 1. Remove from explicit folders list
    const explicit = this.readExplicitFolders();
    const filtered = explicit.filter(
      (f) => f.path !== cleanPath && !f.path.startsWith(`${cleanPath}/`)
    );
    this.saveExplicitFolders(filtered);

    // 2. Find and delete all media files inside this folder
    const { files } = await filesStore.listMediaFiles(10000, 0);
    let deletedCount = 0;

    for (const file of files) {
      const fileFolder = this.sanitizeFolderPath(file.folder || '');
      if (fileFolder === cleanPath || fileFolder.startsWith(`${cleanPath}/`)) {
        await filesStore.deleteMediaFile(file.publicId);
        deletedCount += 1;
      }
    }

    return { success: true, deletedCount };
  }
}

export const foldersStore = new FoldersStore();
