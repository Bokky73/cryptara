# Cryptara read client

Private ESM TypeScript package, usable from Node 22+ and modern browsers. It has
no runtime dependencies and exposes only GET requests. Install/build separately:

```sh
cd packages/read-client
npm ci
npm test
npm run build
```

```ts
import { createReadClient } from "@cryptara/read-client";
const client = createReadClient({ baseUrl: "https://your-deployment.example" });
const page = await client.history.transactions({ limit: 25 }, {
  signal: AbortSignal.timeout(5000),
});
// page.items, page.total, page.nextCursor; do not assume other resources share this shape.
```

`baseUrl` is the application origin/deployment prefix, without `/api`. A fetch
implementation may be injected. Requests omit ambient cookies by default;
browser callers may explicitly select `same-origin` or `include`, and Node callers
may supply their session cookie in request headers. Credentials and response
bodies are not logged or persisted. The client does not create wallet sessions.
Redirects are refused to avoid forwarding caller credentials to another origin.

There is one additional attempt by default, capped at three. Only 429/502/503/504
responses retry. Both numeric and HTTP-date Retry-After values are respected;
delays exceeding the configured ceiling fail instead of retrying early. Abort
stops fetch, response reading and retry timers. Authentication and compatibility
errors never retry. Network failures return a typed transport error.

Resource schemas validate exported typed fields, including nested records, and
retain unknown additive fields as `unknown`. Unknown envelope shapes and snapshot
schema versions fail with `CompatibilityError`. Network names and exact amount
strings are never normalized or coerced. The baseline portfolio already exposes
numeric balances: this package preserves those numbers and cannot recover digits
the server discarded. Exact sequence/activity amount strings remain strings.

See [supported routes and compatibility](../../docs/features/read-client.md).
The browser and Node examples are type-checked by `npm run build`.
