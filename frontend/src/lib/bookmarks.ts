export type Bookmark = { id: string; noteId: string; title: string; anchor?: string; createdAt: number };
export type BookmarkGroup = { id: string; name: string; bookmarkIds: string[] };
export type BookmarkStore = { version: 1; bookmarks: Bookmark[]; groups: BookmarkGroup[] };
const empty = (): BookmarkStore => ({ version: 1, bookmarks: [], groups: [] });
export function loadBookmarks(key = "inkism.bookmarks"): BookmarkStore { try { const x = JSON.parse(localStorage.getItem(key) || "null"); return x?.version === 1 && Array.isArray(x.bookmarks) && Array.isArray(x.groups) ? x : empty(); } catch { return empty(); } }
export function saveBookmarks(store: BookmarkStore, key = "inkism.bookmarks") { try { localStorage.setItem(key, JSON.stringify(store)); } catch { /* storage unavailable */ } }
export function addBookmark(store: BookmarkStore, value: Omit<Bookmark, "id" | "createdAt">): BookmarkStore { const b = { ...value, id: `bookmark-${crypto.randomUUID()}`, createdAt: Date.now() }; return { ...store, bookmarks: [...store.bookmarks, b] }; }
export function addGroup(store: BookmarkStore, name: string): BookmarkStore { return { ...store, groups: [...store.groups, { id: `bookmark-group-${crypto.randomUUID()}`, name: name.trim().slice(0, 80) || "새 그룹", bookmarkIds: [] }] }; }
export function toggleGroup(store: BookmarkStore, groupId: string, bookmarkId: string): BookmarkStore { return { ...store, groups: store.groups.map(g => g.id === groupId ? { ...g, bookmarkIds: g.bookmarkIds.includes(bookmarkId) ? g.bookmarkIds.filter(id => id !== bookmarkId) : [...g.bookmarkIds, bookmarkId] } : g) }; }
