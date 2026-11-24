# 10ms SPEC — D12 canonical forms

## Canonical D12
| Sai / không chuẩn | Dạng chuẩn | Sửa đúng |
|---|---|---|
| `let x = 1` or `x == 1` | `name = expr` | Use a bare name and one `=`. |
| `btn Add` or `each tasks` | `btn "Label"` block; `each list name` block | Quote the label; add the loop variable and body. |
| `f(x)` | No canonical form | Hard syntax error; function calls are unsupported. |
| `if ...` or `while ...` | No canonical form | Hard syntax error; branching and while-loops are unsupported. |
| `page /about` | `page /` | v1 accepts only `/`; `/about` is a hard syntax error. |
| Tabs or mixed indentation | Two spaces per nested block | Replace tabs with consistent spaces. |
| `need body.msg string`; `@store.add("n", 1)` | `need body.msg text`; `@store.add "n" 1` | Use canonical types and space-separated effect arguments. |

## Grammar
| Area | Canonical form |
|---|---|
| Program / block | `program = statement*`; `block = NL INDENT statement+ DEDENT`; one statement per line, 2-space indentation, blank lines ignored, no tabs. |
| Web statements | `page /`; `input name`; `btn "label" block`; `p expr`; `each expr name block`; `name = expr`. |
| Worker handlers | `on GET /path block`; `on POST /path block`; `on every 1h block`. |
| Worker statements | `need body.path type`; `reply expr`; `@effect args`; `name = expr` is allowed (`Assign` in `run.js` `execStmt`). |
| Values / need types | Integer; `"text"`; `name`; `body.path`; `[]`; `[expr]`; `{key: expr}`; types: `text`, `number`, `bool`, `array`, `object`. |

## Polymorphic `+`
Valid for same-type pairs: `number + number → number`; `text + text → text`; `list + list → concatenated list`.

## Effects
`@store.get` (read); `@store.add` (numeric add); `@store.del` (delete); `@store.set` (write).
`@net.fetch` (network request); `@time.now` (current time); `@rand.int` (random integer).
These seven are the complete canonical `@` effects; outputs are logged for deterministic replay.

## Examples
Web (matches `tests/core/web.test.js`):
```10ms
page /
  tasks = []
  text = ""
  input text
  btn "Add"
    tasks = tasks + [text]
    text = ""
  each tasks t
    p t
```

Worker (matches `tests/host/worker.test.js` fixture):
```10ms
on POST /echo
  need body.msg text
  reply {echo: body.msg}

on GET /hits
  reply {hits: @store.add "hits" 1}

on every 1h
  @store.del "hits"
```
