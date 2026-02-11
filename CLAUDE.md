# Claude Development Guidelines for SalishSea.io

## Project Overview
SalishSea.io is a web application for tracking and visualizing marine life sightings (cetaceans, pinnipeds) in the Salish Sea. The app integrates data from iNaturalist, Whale Alert, Orca Network, and HappyWhale.

## Tech Stack
- **Frontend Framework**: Lit (Web Components)
- **Map Library**: OpenLayers
- **Build Tool**: Vite
- **Language**: TypeScript
- **Backend**: Supabase (PostgreSQL)
- **Styling**: CSS-in-JS with Lit's css tagged template

## Verification Requirements

### Always Run Build After Code Changes
After making any code changes, **always verify by running**:
```bash
npm run build
```

This command runs:
1. TypeScript compilation (`tsc`)
2. Vite build
3. HTML validation
4. CSP hash verification

Report any build errors or new warnings introduced by your changes.

## Code Style Guidelines

### Design Tokens
- Use CSS custom properties (design tokens) instead of hardcoded colors
- Available tokens include: `--slate-300`, `--slate-400`, etc.
- Example: Use `var(--slate-300)` instead of `#ccc`

### Web Components (Lit)
- Keep render methods pure - no DOM side effects
- Use `willUpdate()` for computing derived state
- Use reactive properties with `@property()` decorator
- Prefix intentionally-unused properties with `_` or make them `protected`

### File Operations
- Always read files before editing them
- Use dedicated tools (Read, Edit, Write) instead of bash commands

## Architecture Notes

### Key Components
- `salish-sea.ts` - Main app component, manages global state and routing
- `obs-map.ts` - OpenLayers map wrapper, handles map interactions
- `obs-panel.ts` - Sidebar with sighting list and forms
- `obs-summary.ts` - Individual sighting display card
- `sighting-form.ts` - Form for creating/editing sightings

### State Management
- URL query parameters store: date (`d`), map position (`x`, `y`, `z`), focused occurrence (`o`)
- Context API (Lit) for user, contributor, map, and drawing source
- Supabase for data persistence

### Map Behavior
- Features must be loaded before they can be selected
- `setOccurrences()` is called after data fetch, check for focused occurrences there
- Use `willUpdate()` lifecycle to handle property changes in map component

## Common Patterns

### Handling Query Parameters on Load
When handling URL parameters that affect map/UI state:
1. Parse params in `parseUrlParams()`
2. Set initial state from params
3. Ensure data is loaded before trying to reference it
4. Re-check state after async data loads (e.g., in `setOccurrences()`)

### Form Field Validation
- Use TanStack Form for form state management
- Field errors should be nested inside label grid structure
- Validation runs on change events

## Testing
- Manual testing in browser is primary verification method
- Check that map interactions work (clicking features, URL params)
- Verify forms validate correctly

## Git Workflow
- Only commit when explicitly asked
- Use descriptive commit messages focusing on "why" not "what"
- Always include co-author: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`
- Review staged changes before committing
