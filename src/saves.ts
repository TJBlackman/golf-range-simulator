export const SAVE_VERSION = 1;
export const SAVE_PREFIX = "fairway:save:";
export const SAVE_NAME_LIMIT = 48;
export const ACTIVE_SHIFT_KEY = "fairway:active-shift";

export interface SaveStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveSummary = { time: number; cash: number; yards: number; over: boolean };
export type SaveEntry = { id: string; name: string; savedAt: number; summary?: SaveSummary; error?: string };
export type SavedGame<T> = { version: 1; id: string; name: string; savedAt: number; summary: SaveSummary; payload: T };

/** Only an explicitly activated tab may replace the shared automatic save.
 * A new document gets a new token; reloads cannot silently reclaim ownership. */
export class SaveOwnership {
  private readonly storage: Pick<SaveStorage, "getItem" | "setItem">;
  private readonly token: string;
  constructor(storage: Pick<SaveStorage, "getItem" | "setItem">, token: string) {
    this.storage = storage;
    this.token = token;
  }
  claim() { this.storage.setItem(ACTIVE_SHIFT_KEY, this.token); }
  owns() { return this.storage.getItem(ACTIVE_SHIFT_KEY) === this.token; }
}

export function normalizeSaveName(input: string) {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name || Array.from(name).length > SAVE_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error(`Enter a save name between 1 and ${SAVE_NAME_LIMIT} characters.`);
  return name;
}

/** Separate, atomic slot writes protect named games from autosave failures. */
export class SaveStore<T> {
  private readonly storage: SaveStorage;
  private readonly validate: (input: unknown) => T;
  private readonly now: () => number;
  private readonly createId: () => string;
  constructor(
    storage: SaveStorage,
    validate: (input: unknown) => T,
    now: () => number = Date.now,
    createId: () => string = () => `slot-${crypto.randomUUID()}`,
  ) { this.storage = storage; this.validate = validate; this.now = now; this.createId = createId; }

  private key(id: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("The save identifier is invalid.");
    return SAVE_PREFIX + id;
  }

  private readRaw(id: string) {
    try { return this.storage.getItem(this.key(id)); }
    catch (error) { throw this.storageError(error); }
  }

  private storageError(error: unknown) {
    const full = error instanceof Error && /quota|storage.*full/i.test(error.name + error.message);
    return new Error(full
      ? "Browser storage is full. Delete an old named save, then try again. Your previous saves are unchanged."
      : "This browser could not access saved games. Allow site storage and try again.");
  }

  private decode(id: string, raw: string): SavedGame<T> {
    let source: Record<string, unknown>;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      source = value;
    } catch { throw new Error("This save is damaged and could not be read. It has been kept unchanged."); }
    if (source.version !== SAVE_VERSION) throw new Error("This save uses an unsupported version. It has been kept unchanged.");
    if (source.id !== id || typeof source.name !== "string" || !Number.isSafeInteger(source.savedAt) || (source.savedAt as number) < 0)
      throw new Error("This save's details are invalid. It has been kept unchanged.");
    const name = normalizeSaveName(source.name);
    const summary = source.summary as Record<string, unknown> | undefined;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)
      || ![summary.time, summary.cash, summary.yards].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
      || typeof summary.over !== "boolean") throw new Error("This save's shift summary is invalid. It has been kept unchanged.");
    let payload: T;
    try { payload = this.validate(source.payload); }
    catch (error) { throw new Error(`${error instanceof Error ? error.message : "The saved game is invalid."} It has been kept unchanged.`); }
    return { version: 1, id, name, savedAt: source.savedAt as number,
      summary: { time: summary.time as number, cash: summary.cash as number, yards: summary.yards as number, over: summary.over }, payload };
  }

  read(id: string): SavedGame<T> | null {
    const raw = this.readRaw(id);
    return raw === null ? null : this.decode(id, raw);
  }

  list(): SaveEntry[] {
    let ids: string[];
    try {
      ids = Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
        .filter((key): key is string => !!key?.startsWith(SAVE_PREFIX))
        .map(key => key.slice(SAVE_PREFIX.length));
    } catch (error) { throw this.storageError(error); }
    const entries = ids.map((id): SaveEntry => {
      try {
        const saved = this.read(id);
        if (!saved) return { id, name: "Missing save", savedAt: 0, error: "This save is no longer available." };
        return { id, name: saved.name, savedAt: saved.savedAt, summary: saved.summary };
      } catch (error) {
        return { id, name: id === "autosave" ? "Automatic save" : "Unreadable named save", savedAt: 0,
          error: error instanceof Error ? error.message : "This save could not be read." };
      }
    });
    return entries.sort((a, b) => (a.id === "autosave" ? -1 : b.id === "autosave" ? 1 : b.savedAt - a.savedAt));
  }

  private write(id: string, name: string, payload: T, summary: SaveSummary) {
    const envelope: SavedGame<T> = { version: 1, id, name: normalizeSaveName(name), savedAt: this.now(), summary: { ...summary }, payload };
    const raw = JSON.stringify(envelope);
    // Decode the serialized form before committing to catch invalid exports.
    const saved = this.decode(id, raw);
    try { this.storage.setItem(this.key(id), raw); }
    catch (error) { throw this.storageError(error); }
    return saved;
  }

  autosave(payload: T, summary: SaveSummary, replaceUnreadable = false) {
    if (!replaceUnreadable) this.read("autosave");
    return this.write("autosave", "Automatic save", payload, summary);
  }

  saveNamed(name: string, payload: T, summary: SaveSummary) {
    const normalized = normalizeSaveName(name);
    if (this.list().some(entry => entry.id !== "autosave" && !entry.error && entry.name.toLocaleLowerCase() === normalized.toLocaleLowerCase()))
      throw new Error("A save with that name already exists. Use its Overwrite button to replace it.");
    let id = this.createId();
    if (id === "autosave" || this.readRaw(id) !== null) throw new Error("A unique save slot could not be created. Try again.");
    return this.write(id, normalized, payload, summary);
  }

  overwrite(id: string, payload: T, summary: SaveSummary) {
    if (id === "autosave") return this.autosave(payload, summary, true);
    const saved = this.read(id);
    if (!saved) throw new Error("This save no longer exists. Create a new named save instead.");
    return this.write(id, saved.name, payload, summary);
  }

  remove(id: string) {
    try { this.storage.removeItem(this.key(id)); }
    catch (error) { throw this.storageError(error); }
  }
}
