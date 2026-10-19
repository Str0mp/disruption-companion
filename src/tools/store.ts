// Estado de las tools de escritura simuladas. En memoria para local y tests; en Cloudflare KV para el Worker,
// donde cada petición puede caer en una instancia distinta y la idempotencia necesita estado compartido.
// En el sistema real este estado lo guardan los proveedores (reservas, casos, notificaciones), no este servicio.

import type { HumanCaseRequest, PassengerMessage } from './contracts.ts';

export type RebookingRecord = { request_id: string; expires_at: string };
export type HumanCaseRecord = HumanCaseRequest & { case_id: string };

export type Snapshot = { rebookings: Array<[string, RebookingRecord]>; human_cases: HumanCaseRecord[]; notifications: PassengerMessage[] };

export interface WriteStore {
  findRebooking(idempotencyKey: string): Promise<RebookingRecord | null>;
  saveRebooking(idempotencyKey: string, record: RebookingRecord): Promise<void>;
  nextSequence(name: 'rbk' | 'hc' | 'nt'): Promise<number>;
  addHumanCase(record: HumanCaseRecord): Promise<void>;
  addNotification(message: PassengerMessage): Promise<void>;
  snapshot(): Promise<Snapshot>;
}

export class MemoryWriteStore implements WriteStore {
  readonly rebookings = new Map<string, RebookingRecord>();
  readonly humanCases: HumanCaseRecord[] = [];
  readonly notifications: PassengerMessage[] = [];
  private seq: Record<string, number> = {};

  async findRebooking(key: string) { return this.rebookings.get(key) ?? null; }
  async saveRebooking(key: string, record: RebookingRecord) { this.rebookings.set(key, record); }
  async nextSequence(name: string) { this.seq[name] = (this.seq[name] ?? 0) + 1; return this.seq[name]; }
  async addHumanCase(record: HumanCaseRecord) { this.humanCases.push(record); }
  async addNotification(message: PassengerMessage) { this.notifications.push(message); }
  async snapshot(): Promise<Snapshot> { return { rebookings: [...this.rebookings.entries()], human_cases: [...this.humanCases], notifications: [...this.notifications] }; }
}

/** Subconjunto de la API de KV de Cloudflare que se usa, para no depender de sus tipos. */
export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(opts: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
};

export class KVWriteStore implements WriteStore {
  private readonly kv: KVLike;
  constructor(kv: KVLike) { this.kv = kv; }

  async findRebooking(key: string) { const v = await this.kv.get(`rbk:${key}`); return v ? (JSON.parse(v) as RebookingRecord) : null; }
  async saveRebooking(key: string, record: RebookingRecord) { await this.kv.put(`rbk:${key}`, JSON.stringify(record)); }
  async nextSequence(name: string) {
    // Contador con lectura y escritura no atómicas: aceptable para una demo; un sistema real usaría un Durable Object.
    const n = Number((await this.kv.get(`seq:${name}`)) ?? '0') + 1;
    await this.kv.put(`seq:${name}`, String(n));
    return n;
  }
  async addHumanCase(record: HumanCaseRecord) { await this.kv.put(`hc:${record.case_id}`, JSON.stringify(record)); }
  async addNotification(message: PassengerMessage) { const n = await this.nextSequence('ntlist'); await this.kv.put(`nt:${String(n).padStart(6, '0')}`, JSON.stringify(message)); }
  async snapshot(): Promise<Snapshot> {
    const read = async <T>(prefix: string): Promise<Array<[string, T]>> => {
      const { keys } = await this.kv.list({ prefix });
      const out: Array<[string, T]> = [];
      for (const k of keys) { const v = await this.kv.get(k.name); if (v) out.push([k.name.slice(prefix.length), JSON.parse(v) as T]); }
      return out;
    };
    return {
      rebookings: await read<RebookingRecord>('rbk:'),
      human_cases: (await read<HumanCaseRecord>('hc:')).map(([, v]) => v),
      notifications: (await read<PassengerMessage>('nt:')).map(([, v]) => v),
    };
  }
}
