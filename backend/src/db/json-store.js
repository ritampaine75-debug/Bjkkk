/**
 * Local JSON document store used for development and automated tests.
 * Implements the same small interface as the Firestore adapter so the
 * repository layer is storage agnostic.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../utils/ids.js';

const MIN = Symbol('min');
const MAX = Symbol('max');

function normalizePath(p) {
  const trimmed = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) throw new Error('Store path is required');
  if (trimmed.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`Invalid store path: ${p}`);
  }
  return trimmed;
}

function collectionOf(docPath) {
  const segments = docPath.split('/');
  segments.pop();
  return segments.join('/');
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === MIN || a === undefined || a === null) return -1;
  if (b === MAX || b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matchesWhere(doc, where) {
  if (!where) return true;
  return where.every(({ field, op, value }) => {
    const current = getField(doc, field);
    switch (op) {
      case '==':
        return current === value;
      case '!=':
        return current !== value;
      case '>':
        return current > value;
      case '>=':
        return current >= value;
      case '<':
        return current < value;
      case '<=':
        return current <= value;
      case 'in':
        return Array.isArray(value) && value.includes(current);
      case 'not-in':
        return Array.isArray(value) && !value.includes(current);
      case 'array-contains':
        return Array.isArray(current) && current.includes(value);
      case 'array-contains-any':
        return Array.isArray(current) && Array.isArray(value) && current.some((v) => value.includes(v));
      default:
        throw new Error(`Unsupported query operator: ${op}`);
    }
  });
}

export function getField(doc, field) {
  if (doc == null) return undefined;
  if (!field.includes('.')) return doc[field];
  return field.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);
}

export class JsonStore {
  constructor({ filePath = null, documents = {} } = {}) {
    this.kind = 'json';
    this.filePath = filePath;
    this.docs = new Map(Object.entries(documents));
    this.writeTimer = null;
    this.writeChain = Promise.resolve();
    if (filePath) this.loadSync();
  }

  loadSync() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.docs = new Map(Object.entries(parsed.documents || {}));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  schedulePersist() {
    if (!this.filePath) return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persist().catch((err) => console.error('json-store persist failed', err.message));
    }, 25);
    if (typeof this.writeTimer.unref === 'function') this.writeTimer.unref();
  }

  async persist() {
    if (!this.filePath) return;
    const snapshot = JSON.stringify({ version: 1, documents: Object.fromEntries(this.docs) });
    this.writeChain = this.writeChain.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.filePath);
    });
    return this.writeChain;
  }

  async flush() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.persist();
  }

  /** Document API ------------------------------------------------------- */
  get doc() {
    const store = this;
    return {
      async get(docPath) {
        const p = normalizePath(docPath);
        const data = store.docs.get(p);
        if (!data) return null;
        return structuredClone({ id: p.split('/').pop(), ...data });
      },
      async set(docPath, data) {
        const p = normalizePath(docPath);
        store.docs.set(p, structuredClone(data));
        store.schedulePersist();
        return true;
      },
      async update(docPath, partial) {
        const p = normalizePath(docPath);
        const existing = store.docs.get(p);
        if (!existing) return false;
        store.docs.set(p, structuredClone({ ...existing, ...partial }));
        store.schedulePersist();
        return true;
      },
      async delete(docPath) {
        const p = normalizePath(docPath);
        const existed = store.docs.delete(p);
        if (existed) store.schedulePersist();
        return existed;
      },
      /** Atomic create-if-absent, used for webhook deduplication. */
      async create(docPath, data) {
        const p = normalizePath(docPath);
        if (store.docs.has(p)) return false;
        store.docs.set(p, structuredClone(data));
        store.schedulePersist();
        return true;
      },
    };
  }

  /** Collection API ----------------------------------------------------- */
  async add(collectionPath, data) {
    const id = data.id || newId();
    const docPath = `${normalizePath(collectionPath)}/${id}`;
    await this.doc.set(docPath, { ...data, id });
    return id;
  }

  async query(collectionPath, { where = [], orderBy = null, limit = null, offset = 0, ids = null } = {}) {
    const collection = normalizePath(collectionPath);
    const prefix = `${collection}/`;
    let items = [];
    for (const [docPath, data] of this.docs.entries()) {
      if (!docPath.startsWith(prefix)) continue;
      const remainder = docPath.slice(prefix.length);
      if (remainder.includes('/')) continue; // exclude nested subcollection docs
      const id = remainder;
      if (ids && !ids.includes(id)) continue;
      items.push({ id, ...structuredClone(data) });
    }
    if (where && where.length > 0) items = items.filter((doc) => matchesWhere(doc, where));
    if (orderBy) {
      const { field, direction = 'asc' } = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      const dir = String(direction).toLowerCase() === 'desc' ? -1 : 1;
      items.sort((a, b) => {
        const av = getField(a, field);
        const bv = getField(b, field);
        return dir * compareValues(av ?? (dir === 1 ? MIN : MAX), bv ?? (dir === 1 ? MAX : MIN));
      });
    }
    const start = Number(offset) || 0;
    const end = limit == null ? undefined : start + Number(limit);
    return items.slice(start, end);
  }

  async count(collectionPath, options = {}) {
    const rows = await this.query(collectionPath, { ...options, limit: null, offset: 0 });
    return rows.length;
  }

  /** Recursively remove a document and everything beneath it. */
  async deleteTree(prefixPath) {
    const prefix = `${normalizePath(prefixPath)}/`;
    let removed = 0;
    for (const key of [...this.docs.keys()]) {
      if (key === prefixPath || key.startsWith(prefix)) {
        this.docs.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.schedulePersist();
    return removed;
  }

  async reset() {
    this.docs.clear();
    this.schedulePersist();
  }
}
