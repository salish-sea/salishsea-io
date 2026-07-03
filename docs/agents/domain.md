# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary.
- **`PRODUCT.md`** — audiences, requirements and their rationale, scope.
- **`docs/decisions/`** — numbered decision records touching the area you're about
  to work in. (This repo uses `docs/decisions/`, not the default `docs/adr/`.)

If any of these don't exist, **proceed silently**. Don't flag their absence; the
producer skill (`/grill-with-docs`) creates them lazily when terms or decisions
actually get resolved.

## File structure (single-context)

```
/
├── CONTEXT.md
├── PRODUCT.md
└── docs/
    └── decisions/
        ├── 001-product-framing.md
        └── 002-static-spa-edge-architecture.md
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md` (provider vs
collection, occurrence, aggregator pattern, SRC-01). Don't drift to synonyms the
glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/grill-with-docs`).

## Flag decision conflicts

If your output contradicts an existing decision record, surface it explicitly rather
than silently overriding:

> _Contradicts docs/decisions/005 (SRC-01 export exclusion) — but worth reopening because…_
