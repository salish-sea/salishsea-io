# SalishSea.io Design System

## Intent

**Who:** Naturalists, community scientists, whale watchers, and researchers in the Salish Sea region. On boats at dawn, on shore with binoculars, at desks reviewing sightings. Tracking the Southern Resident Killer Whales and other marine mammals.

**What they do:** Record precise sightings with location and time. Navigate to known whale ranges (SRKW, San Juans, Puget Sound). Review community observations. Track patterns across the region.

**How it should feel:** Like a well-worn field guide. Trustworthy, unfussy, built for the water. Calm and sturdy like morning tide. The interface gets out of the way - the data speaks. Not slick, not competitive. Connected to place: the Salish Sea, the Pacific Northwest, the whales.

---

## Domain

Marine field observation: depth charts, coordinates, whale pods, logbooks, waypoints, tides, nautical charts, field journals.

---

## Foundation

### Color Palette

**Primary: Ocean Depths**
- `--navy-deep: rgb(8, 13, 38)` - Header, primary surfaces
- `--navy-dark: rgb(15, 23, 42)` - Depth variation

**Neutrals: Salish Sea Grays**
- `--slate-900: #1e293b` - Darkest text
- `--slate-700: #334155` - Body text
- `--slate-500: #64748b` - Secondary text
- `--slate-300: #cbd5e1` - Borders
- `--slate-100: #f1f5f9` - Subtle backgrounds
- `--white: #ffffff` - Primary backgrounds

**Accent: Ocean Blue**
- `--ocean-blue: #1976d2` - Primary actions, links
- `--ocean-blue-hover: #1565c0` - Hover states
- `--ocean-blue-light: #e3f2fd` - Light backgrounds

**Data: Orca Contrast**
- `--whale-gray: rgba(128, 128, 128, 0.1)` - User content backgrounds
- `--kelp-green: #059669` - Success states
- `--alert-orange: #ea580c` - Warnings, rare sightings
- `--depth-blue: #0ea5e9` - Data highlights

**Why:** Colors from the Salish Sea environment - deep water, overcast skies, whale markings. The palette is restrained and earthy, not bright or digital. Ocean blue for actions feels natural and trustworthy.

---

### Typography

**Typeface:** Mukta (Helvetica, Arial fallbacks)

**Scale:**
- `--text-xs: 0.75rem` (12px) - Metadata, timestamps
- `--text-sm: 0.8125rem` (13px) - Form inputs, dense data
- `--text-base: 0.875rem` (14px) - Body text, buttons
- `--text-lg: 1rem` (16px) - Labels, secondary headings
- `--text-xl: 1.2rem` (19.2px) - H1 header
- `--text-2xl: 1.5rem` (24px) - Panel headings

**Weights:**
- 400 (regular) - Body text, most UI
- 500 (medium) - Emphasized text, links
- 600 (semibold) - Headings (use sparingly)

**Line Height:** 1.5 for readability in data contexts

**Why:** Mukta is approachable, legible at small sizes (critical for data-dense displays), and slightly rounded - friendly without being casual. The scale is compact to maximize space for map and data.

---

### Spacing

**Base unit:** 8px (0.5rem)

**Scale:**
- `--space-1: 0.25rem` (4px) - Tight groupings
- `--space-2: 0.5rem` (8px) - Standard gap, padding
- `--space-3: 0.75rem` (12px) - Form element padding
- `--space-4: 1rem` (16px) - Section gaps
- `--space-6: 1.5rem` (24px) - Component spacing
- `--space-8: 2rem` (32px) - Major sections

**Why:** 8px base aligns with the existing code and provides enough granularity for data-dense layouts without overthinking it.

---

### Depth & Elevation

**Philosophy:** Subtle, like paper charts on a desk. Not floating cards.

**Borders:** `1px solid var(--slate-300)` - Primary separator
**Box shadows:** Minimal. Use only for modals/dialogs:
- `--shadow-dialog: 0 8px 16px rgba(8, 13, 38, 0.15)`

**Backdrop:** `backdrop-filter: blur(0.5rem)` for dialogs

**Why:** The map is the primary surface. UI panels should feel grounded and stable, not layered. Borders provide structure without visual weight.

---

### Surfaces & Temperature

**Elevation scale:**
1. **Base:** `--white` - Main backgrounds, panels
2. **Recessed:** `--slate-100` - Input fields, inactive states
3. **Elevated:** `--navy-deep` - Header (inverted)
4. **Overlay:** Semi-transparent with backdrop blur - Dialogs

**User content:** `--whale-gray` background distinguishes user-created data from community data

**Why:** Most surfaces are neutral white/gray - calm, receding. The dark header anchors the top like deep water. User content gets a subtle background to create distinction without hierarchy.

---

## Components

### Buttons

**Primary Action:**
```css
background: var(--ocean-blue);
border: 1px solid var(--ocean-blue);
border-radius: 4px;
color: white;
padding: 0.5rem 1rem;
font-size: var(--text-base);
cursor: pointer;

:hover {
  background: var(--ocean-blue-hover);
  border-color: var(--ocean-blue-hover);
}
```

**Secondary/Utility:**
```css
background: white;
border: 1px solid var(--slate-300);
border-radius: 4px;
padding: 0.375rem 0.5rem;
font-size: var(--text-sm);
cursor: pointer;

:hover:not(:disabled) {
  background: var(--slate-100);
}

:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Why:** Primary buttons use ocean blue for clear affordance. Secondary buttons are minimal - borders only, letting the map and data dominate. Small radius (4px) feels precise, not rounded.

---

### Forms

**Inputs (text, date, select):**
```css
box-sizing: border-box;
padding: 0.375rem 0.5rem;
border: 1px solid var(--slate-300);
border-radius: 4px;
font-family: inherit;
font-size: var(--text-sm);
background: white;
```

**Focus state:**
```css
:focus {
  outline: 2px solid var(--ocean-blue);
  outline-offset: 2px;
}
```

**Why:** Compact padding for data density. Border-based with neutral colors keeps forms from competing with content. Clear focus states for accessibility.

---

### Panels

**Observation Panel:**
```css
border-left: 1px solid var(--slate-300); /* desktop */
border-top: 1px solid var(--slate-300); /* mobile */
padding: 0.5rem 0.5rem 5.5rem 0.5rem;
background: white;
```

**Headers within panels:**
```css
text-align: center;
font-size: var(--text-2xl);
font-weight: 400;
margin: 1rem 0 0 0;
```

**Why:** Single border separates from map. White background stays neutral. Extra bottom padding accounts for scrolling sighting list. Headers centered and minimal weight - not shouting.

---

### Header

```css
background: var(--navy-deep);
color: white;
padding: 0.5rem;
display: flex;
justify-content: space-between;
align-items: baseline;
```

**Why:** Deep navy grounds the top like deep water. White text inverts the relationship. Minimal padding keeps it compact.

---

### Dialog/Modal

```css
max-width: 30rem;
padding: 0.5rem;
border-radius: 4px;

::backdrop {
  backdrop-filter: blur(0.5rem);
}
```

**Why:** Blurred backdrop keeps context visible while focusing attention. Max-width prevents unwieldy text columns.

---

### Observation Summary

**Accent Border:**
```css
border-left: 3px solid var(--slate-300); /* gray for all */
border-left-color: var(--ocean-blue); /* blue when focused */
```

**Full-width treatment:**
```css
margin-left: -0.5rem;
margin-right: -0.5rem;
padding-left: calc(0.5rem - 3px); /* compensate for border */
padding-right: 0.5rem;
```

**Focused state:**
```css
background-color: var(--ocean-blue-light); /* #e3f2fd */
border-left-color: var(--ocean-blue);
```

**Layout:**
- Header: Flex row with species info on left, time on right
- Attribution: Small gray text (`--text-sm`, `--slate-500`)
- Body paragraphs: `0.5rem` top margin for tighter spacing
- Photos: Flex wrap with `0.5rem` gap
- Actions: Right-aligned button-styled links

**Why:** Accent border delineates each observation like entries in a field journal. Gray for standard entries, blue for focused. Full-width treatment makes the accent border flush with sidebar edge. Focused state uses ocean blue background + border without adding visual weight. Action buttons right-aligned keeps them out of the reading flow.

---

## Patterns

### Date Navigation

Arrow buttons (◀ ▶) + date input + location selector in a compact horizontal form. Tomorrow button disabled when date = today.

### Accent Borders

**3px left borders** as the primary way to delineate list items and indicate state:
- `var(--slate-300)` for standard items
- `var(--ocean-blue)` for focused/active items

**Why:** Cleaner than horizontal rules. Creates visual rhythm without adding weight. Feels precise, like coordinates in a logbook.

### User-Generated Content

Background: `var(--whale-gray)` to distinguish user submissions from community/imported data.

### Map-First Layout

Desktop: Map takes remaining space, panel fixed width (25rem) on right
Mobile: Map top (50% viewport), panel scrollable below

### Full-Bleed Elements

Elements that extend to the sidebar edges (overcoming panel padding):
```css
margin-left: -0.5rem;
margin-right: -0.5rem;
```

Use for: Forms, summaries with accent borders, any element that needs to be flush with container edges.

### Data Display

Timestamps, coordinates, species - favor compact text sizes (`--text-sm`, `--text-xs`) to maximize information density.

**Paragraph spacing in summaries:** `0.5rem` top margin for tight, scannable text blocks.

---

## Temperature

**Cold/Technical:**
- Precise coordinates
- Timestamps
- Database-sourced observations

**Warm/Human:**
- User-submitted sightings (gray background)
- Photos
- Community data

**Why:** The balance between scientific tool and community resource. Technical data stays neutral and precise. Human contributions get subtle warmth (not color, just distinction).

---

## What NOT to do

- ❌ Bright, saturated colors (not trustworthy for field data)
- ❌ Heavy shadows or floating cards (map is the primary surface)
- ❌ Large, bold headings (data should dominate)
- ❌ Rounded, "friendly" aesthetics (this is a working tool)
- ❌ Unnecessary animations (calm and stable)
- ❌ Decorative elements (let the whale sightings be the content)

---

## Responsive Behavior

**Breakpoint:** `@media (max-aspect-ratio: 1)` (portrait orientation)

Portrait: Stack map top, panel below
Landscape: Map left, panel right

**Why:** Aspect ratio is more meaningful than width for a map-based tool. Prioritize map visibility.

---

## Accessibility

- Clear focus states with 2px outline
- Semantic HTML (forms, buttons, headings)
- Color not sole differentiator (use text, icons, borders)
- Form inputs inherit font-family for consistency
- Disabled states clearly indicated (opacity 0.5)

---

_Last updated: 2026-02-11 (observation summary patterns)_
