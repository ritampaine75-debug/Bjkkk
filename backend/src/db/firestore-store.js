/**
 * Firestore adapter exposing the same document/collection interface as the
 * local JSON store. Requires the Firebase Admin SDK and server credentials.
 */
function normalizePath(p) {
  const trimmed = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) throw new Error('Store path is required');
  const segments = trimmed.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw new Error(`Invalid store path: ${p}`);
  return trimmed;
}

export class FirestoreStore {
  constructor({ db }) {
    if (!db) throw new Error('FirestoreStore requires a Firestore instance');
    this.kind = 'firestore';
    this.db = db;
  }

  docRef(docPath) {
    const segments = normalizePath(docPath).split('/');
    if (segments.length % 2 !== 0) throw new Error(`Document path must have an even number of segments: ${docPath}`);
    let ref = this.db.collection(segments[0]).doc(segments[1]);
    for (let i = 2; i < segments.length; i += 2) {
      ref = ref.collection(segments[i]).doc(segments[i + 1]);
    }
    return ref;
  }

  collectionRef(collectionPath) {
    const segments = normalizePath(collectionPath).split('/');
    if (segments.length % 2 !== 1) throw new Error(`Collection path must have an odd number of segments: ${collectionPath}`);
    let ref = this.db.collection(segments[0]);
    for (let i = 1; i < segments.length; i += 2) {
      ref = ref.doc(segments[i]).collection(segments[i + 1]);
    }
    return ref;
  }

  get doc() {
    const store = this;
    return {
      async get(docPath) {
        const snap = await store.docRef(docPath).get();
        if (!snap.exists) return null;
        return { id: snap.id, ...snap.data() };
      },
      async set(docPath, data) {
        const { id, ...rest } = data || {};
        await store.docRef(docPath).set(rest, { merge: false });
        return true;
      },
      async update(docPath, partial) {
        const { id, ...rest } = partial || {};
        try {
          await store.docRef(docPath).update(rest);
          return true;
        } catch (err) {
          if (err.code === 5 || /NOT_FOUND/.test(err.message)) return false;
          throw err;
        }
      },
      async delete(docPath) {
        const ref = store.docRef(docPath);
        const snap = await ref.get();
        if (!snap.exists) return false;
        await ref.delete();
        return true;
      },
      async create(docPath, data) {
        const { id, ...rest } = data || {};
        try {
          await store.docRef(docPath).create(rest);
          return true;
        } catch (err) {
          if (err.code === 6 || /ALREADY_EXISTS/.test(err.message)) return false;
          throw err;
        }
      },
    };
  }

  async add(collectionPath, data) {
    const ref = data?.id
      ? this.collectionRef(collectionPath).doc(data.id)
      : this.collectionRef(collectionPath).doc();
    const { id, ...rest } = data || {};
    await ref.set(rest);
    return ref.id;
  }

  async query(collectionPath, { where = [], orderBy = null, limit = null, offset = 0, ids = null } = {}) {
    let ref = this.collectionRef(collectionPath);
    for (const clause of where || []) ref = ref.where(clause.field, clause.op, clause.value);
    if (ids) ref = ref.where('__name__', 'in', ids.slice(0, 30));
    if (orderBy) {
      const { field, direction = 'asc' } = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      ref = ref.orderBy(field, String(direction).toLowerCase() === 'desc' ? 'desc' : 'asc');
    }
    if (offset) ref = ref.offset(offset);
    if (limit != null) ref = ref.limit(limit);
    const snap = await ref.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async count(collectionPath, options = {}) {
    const rows = await this.query(collectionPath, { ...options, limit: null, offset: 0 });
    return rows.length;
  }

  async deleteTree(prefixPath) {
    const segments = normalizePath(prefixPath).split('/');
    const ref = segments.length % 2 === 1 ? this.collectionRef(prefixPath) : this.docRef(prefixPath);
    await this.db.recursiveDelete(ref);
    return true;
  }

  async reset() {
    throw new Error('reset() is not available for Firestore');
  }
}
