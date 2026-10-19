// Adaptador Cloudflare Workers. El estado de los mocks vive en memoria por instancia: suficiente para la demo.

import { createApp } from './app.ts';
import { MockTools } from '../tools/mocks.ts';

const mock = new MockTools();
const app = createApp(mock, mock);

export default {
  fetch(request: Request): Promise<Response> {
    return app(request);
  },
};
