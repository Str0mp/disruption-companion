// Adaptador Cloudflare Workers. El estado de escritura de los mocks va en KV, porque cada petición
// puede caer en una instancia distinta y la idempotencia necesita estado compartido.

import { createApp } from './app.ts';
import { MockTools } from '../tools/mocks.ts';
import { KVWriteStore, type KVLike } from '../tools/store.ts';

type Env = { STORE: KVLike };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const mock = new MockTools({ store: new KVWriteStore(env.STORE) });
    return createApp(mock, mock)(request);
  },
};
