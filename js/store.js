// Storage layer: Firestore when js/config.js has a Firebase config, otherwise localStorage.
// Every path is "collection/doc/collection/doc…", the same shape in both.
import { firebaseConfig } from "./config.js";

const FIREBASE_VERSION = "10.12.2";

export function genId() {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (const n of crypto.getRandomValues(new Uint8Array(10))) s += a[n % a.length];
  return s;
}

export async function createStore() {
  if (firebaseConfig && firebaseConfig.projectId) {
    try { return await firestoreStore(firebaseConfig); }
    catch (e) { console.error("Firebase failed to load, falling back to this browser only", e); }
  }
  return localStore();
}

async function firestoreStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const db = fs.getFirestore(initializeApp(cfg));
  const toObj = (d) => ({ id: d.id, ...d.data() });
  return {
    mode: "shared",
    watchCollection: (path, cb, err) => fs.onSnapshot(fs.collection(db, path), (s) => cb(s.docs.map(toObj)), err),
    watchDoc: (path, cb, err) => fs.onSnapshot(fs.doc(db, path), (d) => cb(d.exists() ? toObj(d) : null), err),
    set: (path, data) => fs.setDoc(fs.doc(db, path), data),
    update: (path, data) => fs.updateDoc(fs.doc(db, path), data),
    remove: (path) => fs.deleteDoc(fs.doc(db, path)),
    add: async (path, data) => (await fs.addDoc(fs.collection(db, path), data)).id,
    list: async (path) => (await fs.getDocs(fs.collection(db, path))).docs.map(toObj),
    arrayToggle: (path, field, value, on) =>
      fs.updateDoc(fs.doc(db, path), { [field]: on ? fs.arrayUnion(value) : fs.arrayRemove(value) }),
  };
}

function localStore() {
  const KEY = "retro-board-local-v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let docs = load();
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(docs)); } catch {} emit(); };
  window.addEventListener("storage", (e) => { if (e.key === KEY) { docs = load(); emit(); } });
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const last = (p) => p.split("/").pop();
  const watch = (fn) => { subs.add(fn); queueMicrotask(fn); return () => subs.delete(fn); };
  const inCollection = (path) => Object.keys(docs).filter((k) => parent(k) === path).map((k) => ({ id: last(k), ...structuredClone(docs[k]) }));
  return {
    mode: "local",
    watchCollection: (path, cb) => watch(() => cb(inCollection(path))),
    watchDoc: (path, cb) => watch(() => cb(docs[path] ? { id: last(path), ...structuredClone(docs[path]) } : null)),
    set: async (path, data) => { docs[path] = structuredClone(data); save(); },
    update: async (path, data) => { if (!docs[path]) throw new Error("Not found"); docs[path] = { ...docs[path], ...structuredClone(data) }; save(); },
    remove: async (path) => { delete docs[path]; save(); },
    add: async (path, data) => { const id = genId(); docs[path + "/" + id] = structuredClone(data); save(); return id; },
    list: async (path) => inCollection(path),
    arrayToggle: async (path, field, value, on) => {
      const d = docs[path]; if (!d) return;
      const arr = Array.isArray(d[field]) ? d[field] : [];
      d[field] = on ? [...new Set([...arr, value])] : arr.filter((v) => v !== value);
      save();
    },
  };
}
