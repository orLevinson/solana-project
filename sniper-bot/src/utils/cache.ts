interface CacheEntry<V> {
    value: V;
    timestamp: number;
}

export class LRUCache<K, V> {
    private map: Map<K, CacheEntry<V>>;
    private readonly maxSize: number;
    private readonly ttl: number;

    constructor(capacity: number, ttl: number = 0) {
        this.map = new Map();
        this.maxSize = capacity;
        this.ttl = ttl;
    }

    get(key: K): V | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;

        // TTL check — evict if expired
        if (this.ttl > 0 && entry.timestamp + this.ttl < Date.now()) {
            this.map.delete(key);
            return undefined;
        }

        // LRU promotion — move to back so it's evicted last
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    has(key: K): boolean {
        return this.get(key) !== undefined; // delegates to get() so TTL is checked
    }

    set(key: K, value: V): void {
        // Evict existing entry first (will re-insert at back)
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.maxSize) {
            // Evict oldest (first key in insertion-order Map)
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) this.map.delete(firstKey);
        }
        this.map.set(key, { value, timestamp: Date.now() });
    }


    delete(key: K): void {
        this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    size(): number {
        return this.map.size;
    }

    keys(): IterableIterator<K> {
        return this.map.keys();
    }

    values(): MapIterator<CacheEntry<V>> {
        return this.map.values();
    }

    entries(): MapIterator<[K, CacheEntry<V>]> {
        return this.map.entries();
    }
}