# Error catalog

P8 requires errors to carry enough data for an automated fix. This catalog records the canonical guidance in [SPEC.md](../SPEC.md) and the errors currently emitted by [type.js](../src/core/type.js).

## Runtime payload

The requested compact catalog shape is `{ "at", "want", "fix", "seed" }`. Its documentation-only projection for the example below is:

```json
{
  "at": { "line": 2, "col": 1 },
  "want": "body.msg present with type text",
  "fix": "include \"msg\": \"<text>\" at body.msg",
  "seed": 7
}
```

The current runtime does **not** emit those key names. `type.js` throws an error whose `.detail` has this shape:

```json
{
  "error": "type",
  "pos": { "line": 2, "col": 1 },
  "expected": "body.msg present with type text",
  "fix": "include \"msg\": \"<text>\" at body.msg",
  "seed": 7
}
```

For the compact shape, map `at` to `pos` and `want` to `expected`; `fix` and `seed` are unchanged. The runtime also includes `error` as a category. Positions emitted by `type.js` use the source line and column `1`. The Worker sends `.detail` directly as a JSON HTTP 400 response when a handled error has detail; see [worker/index.js](../src/host/worker/index.js).

## Type and request-validation errors

| Case | `error` | `expected` (`want`) | `fix` |
|---|---|---|---|
| `typeCheck` receives something other than a `Program` AST | `type` | `a Program AST from parse.js` | `parse(source) first` |
| A `Need` has an empty or non-string path | `type` | `need <path> <type>` | `need body.msg text` |
| A `Need` uses a type outside `text`, `number`, `bool`, `array`, `object` | `type` | `one of types: text, number, bool, array, object` | `need <path> text` |
| A required request path is missing, e.g. `body.msg` | `type` | `<path> present with type <type>` | `include "<last path part>": "<type>" at <path>` |
| A present request value has the wrong type | `type` | `<path> : <type>` | `change <path> from <actual type> to <type>` |

The actual type labels are `text`, `number`, `bool`, `array`, `object`, `null` (for `null` or `undefined`), or `unknown` for other values. For example, a numeric `body.msg` where `text` is required produces `expected: "body.msg : text"` and `fix: "change body.msg from number to text"`.

## Canonical-form guidance (D12)

These rewrites come from the canonical table in SPEC; they are guidance, not a separate runtime catalog of canonicalization errors.

| Non-canonical input | Canonical form | Suggested correction |
|---|---|---|
| `let x = 1` or `x == 1` | `name = expr` | Use a bare name and one `=`. |
| `btn Add` or `each tasks` | `btn "Label"` block; `each list name` block | Quote the label; add the loop variable and body. |
| `f(x)` | No canonical form | Function calls are unsupported; there is no direct canonical rewrite. |
| `if ...` or `while ...` | No canonical form | Branching and while-loops are unsupported; there is no direct canonical rewrite. |
| `page /about` | `page /` | v1 accepts only `/`; use the root path. |
| Tabs or mixed indentation | Two spaces per nested block | Replace tabs with consistent spaces. |
| `need body.msg string`; `@store.add("n", 1)` | `need body.msg text`; `@store.add "n" 1` | Use canonical types and space-separated effect arguments. |

## Canonicalizer status

There is no `src/core/canon.js` in the checked-in tree or its Git history at the main commit this catalog was based on. The current [lexer](../src/core/lex.js) and [parser](../src/core/parse.js) emit generic `syntax` errors with the same runtime keys (`error`, `pos`, `expected`, `fix`, `seed`); they do not expose a dedicated canonicalization error type. Accordingly, the D12 table above records SPEC corrections, while the type section records exact `type.js` diagnostics. No runtime schema or code was changed for this catalog.
