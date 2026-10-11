# Grab a Page design system

The extension uses a dark, precise visual language: near-black surfaces, warm white text, square corners, thin borders, and a restrained amber accent. Primary capture and download actions use a light surface to establish a clear hierarchy.

## Foundations

`extension/design-system.css` owns the shared tokens, local font declarations, buttons, brand, section labels, notices, focus states, and reduced-motion handling. Both extension pages load it before their own layout styles.

| Role | Token | Value |
| --- | --- | --- |
| Background | `--color-bg` | `#111111` |
| Surface | `--color-surface` | `#191919` |
| Raised surface | `--color-raised` | `#202020` |
| Border | `--color-border` | `#383838` |
| Strong border | `--color-border-strong` | `#666666` |
| Primary text | `--color-text` | `#f9f8f7` |
| Supporting text | `--color-muted` | `#b2b0ad` |
| Metadata | `--color-subtle` | `#91908d` |
| Accent / focus | `--color-accent` | `#eea052` |

Headings and the wordmark use bundled Stack Sans Notch. Metadata, controls, and numeric inputs use bundled DM Mono. Body copy uses the platform sans-serif. Font licenses live with the assets in `extension/fonts/`; fonts load locally without network requests.

Spacing follows a 4, 8, 12, 16, 24, 32, 48 px scale. Icons use unfilled geometric paths, consistent 1.5 px strokes, and a capture-frame motif. The browser toolbar icons are regenerated with `node scripts/generate-icons.mjs`.

## Components and states

- **Primary action:** warm white background, dark text, square corners. The full-page card is the largest action; visible-area capture is secondary.
- **Secondary action:** transparent or dark surface with a thin border. Disabled actions dim and expose the native disabled state.
- **Section label:** small uppercase monospace text with a bracketed section number.
- **Settings:** native, labeled inputs with visible units and ranges; two columns for numeric fields. Saving reflects normalized values, and editing clears the saved message.
- **Progress:** textual section/pixel counts, an amber activity indicator, and immediate finish/cancel controls. The activity indicator is indeterminate, not a completion percentage.
- **Notice:** amber-tinted surface with a border, readable explanatory text, and an alert or status role.
- **Preview:** bordered output panels on a subtle dot grid, with image downloads in the panel header and dimensions in the caption.
- **Keyboard focus:** a 2 px amber outline with a 4 px offset. Reduced-motion preferences disable decorative movement.

## Layout

The popup declares a fixed 460 px width, minimum width, and 600 px height on the root element, independent of Chrome's initial viewport during automatic sizing. The body fills that width with 24 px side padding. The stable height keeps capture actions, settings, and the footer visible as local fonts finish loading. The root scrolls vertically when expanded settings or progress exceed the popup height. The preview has a 1,200 px container and adapts its header, export actions, and image panels for small viewports.

The floating capture bar uses an isolated shadow root and the same palette, square controls, and capture-frame motif. It uses system fonts to avoid exposing extension font resources to visited pages. On narrow pages, its actions wrap below the capture status.
