import { Hono } from 'hono';

/**
 * Three stubbed core services in one process. Each one has a latency dial and a
 * fail switch, because the interesting behaviour of the BFF is what it does when
 * these misbehave, and a demo needs to be able to cause that on purpose.
 *
 *   curl -X POST localhost:4000/_control/orders  -d '{"fail":true}'
 *   curl -X POST localhost:4000/_control/promise -d '{"latency_ms":2000}'
 *   curl -X POST localhost:4000/_control/reset
 */

type Control = { fail: boolean; latency_ms: number };

const DEFAULTS = {
  catalogue: { fail: false, latency_ms: 40 },
  orders: { fail: false, latency_ms: 60 },
  promise: { fail: false, latency_ms: 80 },
} as const;

type ServiceName = keyof typeof DEFAULTS;


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATEGORIES = ['sofas', 'lighting', 'outdoor', 'storage', 'dining', 'decor'];

/** Synthetic, but plausible — a demo reads very differently with real-sounding products. */
const NAMES: Record<string, string[]> = {
  sofas: ['Kaia 3-seater sofa', 'Brisa modular sofa', 'Olmo linen loveseat', 'Duna corner sofa', 'Alba bouclé armchair', 'Teo sofa bed', 'Marès chaise longue', 'Sella velvet sofa'],
  lighting: ['Noor rattan pendant', 'Lume ceramic table lamp', 'Palma floor lamp', 'Oda wall sconce', 'Cala paper pendant', 'Rim brass desk lamp', 'Nube linen shade', 'Faro outdoor lantern'],
  outdoor: ['Cadaqués teak lounger', 'Sal rope armchair', 'Mistral outdoor table', 'Ibiza parasol', 'Roca garden bench', 'Deià bistro set', 'Sóller hanging chair', 'Coral outdoor rug'],
  storage: ['Vela oak sideboard', 'Arca rattan cabinet', 'Tira wall shelf', 'Nido bookcase', 'Bruma chest of drawers', 'Llum media unit', 'Cesta seagrass basket', 'Riba shoe cabinet'],
  dining: ['Olivo dining table', 'Mimbre dining chair', 'Tàula extendable table', 'Aura bar stool', 'Sobremesa bench', 'Gira round table', 'Pino stacking chair', 'Mesa travertine table'],
  decor: ['Terra stoneware vase', 'Onda wall mirror', 'Lino throw blanket', 'Arena jute rug', 'Salt ceramic bowl', 'Brisa linen cushion', 'Pedra candle holder', 'Ola framed print'],
};

const CATALOGUE = Array.from({ length: 48 }, (_, i) => ({
  id: `sku_${String(i + 1).padStart(4, '0')}`,
  title: NAMES[CATEGORIES[i % CATEGORIES.length]!]![Math.floor(i / CATEGORIES.length)]!,
  category: CATEGORIES[i % CATEGORIES.length]!,
  price_cents: 1900 + (i % 12) * 4500,
  image: `https://picsum.photos/seed/sklum${i}/600/600`,
  created_days_ago: i % 90,
}));

export function createStubsApp() {
  const control: Record<ServiceName, Control> = structuredClone(DEFAULTS) as Record<ServiceName, Control>;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/_control/reset', (c) => {
    Object.assign(control, structuredClone(DEFAULTS));
    return c.json(control);
  });


app.post('/_control/:service', async (c) => {
  const service = c.req.param('service') as ServiceName;
  if (!(service in control)) return c.json({ error: 'unknown service' }, 404);
  const body = await c.req.json<Partial<Control>>().catch(() => ({}));
  Object.assign(control[service]!, body);
  return c.json({ service, control: control[service] });
});

app.get('/_control', (c) => c.json(control));

async function gate(service: ServiceName) {
  const cfg = control[service]!;
  await sleep(cfg.latency_ms);
  if (cfg.fail) throw new Error(`${service} stub failing on purpose`);
}

app.get('/catalogue/products', async (c) => {
  await gate('catalogue');
  const limit = Number(c.req.query('limit') ?? 24);
  return c.json({ products: CATALOGUE.slice(0, limit) });
});

app.get('/orders/:customerId', async (c) => {
  await gate('orders');
  const customerId = c.req.param('customerId');
  return c.json({
    orders: [
      {
        id: 'ord_10231',
        customer_id: customerId,
        status: 'in_transit',
        placed_at: new Date(Date.now() - 6 * 864e5).toISOString(),
        line_items: [{ sku: 'sku_0007', title: CATALOGUE[6]!.title, qty: 1 }],
      },
    ],
  });
});

app.get('/promise/:sku', async (c) => {
  await gate('promise');
  const sku = c.req.param('sku');
  const seed = sku.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const windowDays = 3 + (seed % 12);
  return c.json({
    sku,
    promise_window_days: windowDays,
    earliest: new Date(Date.now() + windowDays * 864e5).toISOString(),
    confidence: windowDays <= 5 ? 'high' : windowDays <= 10 ? 'medium' : 'low',
    source: 'live',
  });
});

app.onError((err, c) => c.json({ error: err.message }, 503));
  return app;
}

