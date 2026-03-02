import fs from 'fs';
import path from 'path';
import { logger } from '../logger/logger';

const STORAGE_DIR = path.join(process.cwd(), 'volume', 'data');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

function filePath(name: string): string {
    return path.join(STORAGE_DIR, `${name}.json`);
}

function writeJson<T>(name: string, data: T): void {
    try {
        fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
    } catch (err) {
        logger.error('[JsonStore] Write failed', { name, err: String(err) });
    }
}

function readJson<T>(name: string, fallback: T): T {
    const file = filePath(name);
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch (err) {
        logger.error('[JsonStore] Read failed', { name, err: String(err) });
        return fallback;
    }
}

export interface Store<V> {
    getAll: () => Record<string, V>;
    get: (key: string) => V | undefined;
    set: (key: string, val: V) => void;
    remove: (key: string) => void;
    count: () => number;
}

export function createStore<V>(name: string): Store<V> {
    // Load from disk into memory once at creation
    let cache: Record<string, V> = readJson<Record<string, V>>(name, {});
    logger.info(`[JsonStore] Loaded '${name}'`, { entries: Object.keys(cache).length });

    function persist() {
        writeJson(name, cache);
    }

    return {
        getAll: () => cache,
        get: (key) => cache[key],
        set: (key, val) => { cache[key] = val; persist(); },
        remove: (key) => { delete cache[key]; persist(); },
        count: () => Object.keys(cache).length,
    };
}
