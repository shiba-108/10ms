# Cloudflare Worker: bound work per request

This example shows a small request handler whose input-dependent work is bounded. It does not guarantee every request stays below 10 ms: CPU also depends on request size, parsing, the Workers runtime, and deployment conditions. Measure CPU on the target Worker with representative inputs.

## 10ms program

```10ms
on POST /count
  need body.items array
  total = 0
  each body.items item
    total = total + 1
  reply {count: total}
```

The handler counts array entries. The current Worker host rejects an `each` list longer than 100 items with a machine-readable `cost` error, so the loop has a fixed upper bound. Keep request bodies small as well; JSON parsing happens before the 10ms handler runs.

## Cloudflare module

The current Worker host accepts an AST, not 10ms source text. Until Worker parsing/code generation is connected, the AST below is the handwritten equivalent of the program above. It uses the same `createWorker` entry point as [`cloudflare.js`](../src/host/worker/cloudflare.js).

For a standalone example, save this module as `src/host/worker/count-example.js` and set `main = "src/host/worker/count-example.js"` in `wrangler.toml`:

```js
import { createWorker } from "./index.js";

const ast = {
  type: "Program",
  body: [{
    type: "On",
    method: "POST",
    path: "/count",
    line: 1,
    body: [
      { type: "Need", path: "body.items", ty: "array", line: 2 },
      {
        type: "Assign",
        name: "total",
        value: { type: "Number", value: 0 },
        line: 3,
      },
      {
        type: "Each",
        list: { type: "Path", path: "body.items" },
        var: "item",
        line: 4,
        body: [{
          type: "Assign",
          name: "total",
          value: {
            type: "Binary",
            op: "+",
            left: { type: "Var", name: "total" },
            right: { type: "Number", value: 1 },
          },
          line: 5,
        }],
      },
      {
        type: "Reply",
        line: 6,
        value: {
          type: "Object",
          entries: [{ key: "count", value: { type: "Var", name: "total" } }],
        },
      },
    ],
  }],
};

const app = createWorker({ ast, seed: 7 });

export default {
  fetch(request) {
    return app.fetch(request);
  },
};
```

Run locally with Wrangler:

```sh
npx wrangler dev --local
```

Then send a bounded test request:

```sh
curl -X POST http://localhost:8787/count \
  -H 'content-type: application/json' \
  -d '{"items":[1,2,3]}'
```

Expected response:

```json
{"count":3}
```

An array with more than 100 entries returns HTTP 400 with an `error: "cost"` payload. Treat this as a workload bound, not proof that all Worker CPU usage is below a platform limit; benchmark representative traffic before deployment.
