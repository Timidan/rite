---
name: Rite
description: A bright verification instrument for mapped authorization checks.
colors:
  paper: "#faf8f3"
  panel: "#fffefb"
  ink: "#1c1f26"
  muted: "#4f5562"
  line: "#d8d2c4"
  cobalt: "#1f3ff0"
  cobalt-deep: "#1630c4"
  cobalt-tint: "#e6ebff"
  coral: "#c42b12"
  coral-tint: "#fce9e4"
  on-cobalt: "#ffffff"
typography:
  display:
    fontFamily: "Seravek, Avenir Next, Segoe UI, Gill Sans Nova, Ubuntu, Cantarell, Noto Sans, Calibri, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 1.2rem + 5.2vw, 4.75rem)"
    fontWeight: 750
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Seravek, Avenir Next, Segoe UI, Gill Sans Nova, Ubuntu, Cantarell, Noto Sans, Calibri, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Seravek, Avenir Next, Segoe UI, Gill Sans Nova, Ubuntu, Cantarell, Noto Sans, Calibri, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Seravek, Avenir Next, Segoe UI, Gill Sans Nova, Ubuntu, Cantarell, Noto Sans, Calibri, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Seravek, Avenir Next, Segoe UI, Gill Sans Nova, Ubuntu, Cantarell, Noto Sans, Calibri, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Code, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  indicator: "2px"
  inner: "4px"
  scrollbar: "6px"
  outer: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    typography: "{typography.body}"
    rounded: "{rounded.inner}"
    padding: "0 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.inner}"
    padding: "0 20px"
    height: "44px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.outer}"
    padding: "20px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
    padding: "0 12px"
    height: "44px"
---

# Design System: Rite

## Overview

**Creative North Star: "The Verification Instrument"**

Rite looks like a precise bench instrument translated to the browser: bright, compact, and organized around signals moving from rules through mapped paths to a verdict. Warm paper and restrained graphite keep the interface approachable; cobalt marks active evidence and coral is reserved for failure.

The system favors direct observation over marketing explanation. Humanist sans-serif type carries hierarchy and action, while monospace appears only where code, identifiers, hashes, or measured output require it. It deliberately avoids Overcode's dark, monospaced editorial identity.

**Key Characteristics:**
- Warm, bright surfaces with crisp graphite boundaries.
- Compact rule → path → gate → verdict structures.
- Cobalt for action and passing evidence; coral only for failure.
- Strong humanist typography with prose kept short.

## Colors

The palette reads like a clean diagnostic workspace: warm neutrals, one electric signal color, and one unambiguous fault color.

### Primary
- **Signal Cobalt:** Drives primary actions, focus, selected states, active wires, and passing verdicts.
- **Deep Cobalt:** Carries cobalt text where the stronger contrast is needed.
- **Cobalt Tint:** Marks selected and gate surfaces without adding visual weight.

### Secondary
- **Fault Coral:** Appears only when a check fails or an error needs attention.
- **Fault Tint:** Provides the quiet failure surface behind coral text and borders.

### Neutral
- **Warm Paper:** The page and inset-data background.
- **Instrument Panel:** Raised working surfaces and controls.
- **Graphite Ink:** Primary text and structural borders.
- **Measured Gray:** Secondary copy, metadata, and idle states.
- **Calibration Line:** Dividers and low-emphasis borders.
- **Signal White:** Text placed on cobalt controls.

### Named Rules
**The Two-Signal Rule.** Cobalt means action or verified success; coral means failure. Do not create another semantic accent.

**The Coral Is Evidence Rule.** Never use coral decoratively. Its rarity makes failed observations immediately legible.

## Typography

**Display Font:** Seravek with the humanist system stack
**Body Font:** Seravek with the humanist system stack
**Label/Mono Font:** UI monospace stack

**Character:** The sans stack is open and practical rather than editorial. Weight and scale create authority; monospace is a measurement tool, not the product's voice.

### Hierarchy
- **Display** (750, fluid, 1.02): The single product proposition and large verdict labels.
- **Headline** (700, 1.375rem, 1.2): Panel, detail, and disclosure titles.
- **Title** (700, 1.5rem, 1.2): Compact idle verdicts and prominent local state.
- **Body** (400, 1rem, 1.55): Brief explanation and operating copy.
- **Label** (700, 0.8125rem, 0.06em): Uppercase instrument roles and table headings.
- **Mono** (400, 0.9em, 1.55): Function names, hashes, commands, identifiers, and numerical evidence.

### Named Rules
**The Mono Measures Rule.** Use monospace only for code and data. Navigation, buttons, headings, and prose remain humanist sans.

## Layout

The desktop shell is a centered 1360px workspace with 32px side padding. Hero and workbench use asymmetric 5/7 and 7/5 grids so the proposition and live instrument carry distinct weight. Cards use compact 20px interiors and sections rely on 24–48px separation instead of oversized whitespace.

Below 1080px, hero, workbench, and paired panels become single columns and the sticky case detail returns to normal flow. Below 720px, side padding becomes 16px and the horizontal signal instrument becomes a top-to-bottom sequence. Controls retain a minimum 44px touch target and result tables scroll horizontally when needed.

## Elevation & Depth

The system is flat by default. Depth comes from warm tonal layers, dark structural borders, and a single one-pixel baseline shadow on the primary instrument; it does not use diffuse card shadows or glass effects.

### Shadow Vocabulary
- **Instrument Baseline** (`0 1px 0 var(--ink)`): A restrained physical edge used only on the rule-to-verdict instrument.

### Named Rules
**The Bench-Flat Rule.** Surfaces stay flat and bordered; reserve the baseline shadow for the signature instrument.

## Shapes

Corners are gently mechanical: 4px for controls and internal modules, 8px for panels and major containers. Borders are usually one pixel and graphite; selected gates and final verdicts may use a two-pixel semantic border. Small status dots are squared-off 2px indicators rather than decorative circles.

## Components

### Buttons
- **Shape:** Compact rectangular control with a 4px corner and at least 44px height.
- **Primary:** Cobalt fill, white text, 20px horizontal padding, and semibold sans type.
- **Hover / Focus:** Deep cobalt on hover; a two-pixel cobalt focus outline with two-pixel offset; active presses scale to 96%.
- **Secondary:** Panel fill with graphite border; hover reverses to graphite with white text.

### Segmented Path Filter
- **Style:** A graphite-bordered panel contains three tightly grouped 44px controls.
- **State:** The selected path uses graphite fill and white text; hover uses the cobalt tint.

### Result Matrix
- **Style:** A compact bordered table pairs uppercase labels with full-cell actions.
- **State:** Cobalt dot and text indicate PASS; coral indicates FAIL or ERROR; selection adds a cobalt inset border.

### Cards / Containers
- **Corner Style:** 8px outer radius with 4px internal modules.
- **Background:** Instrument Panel over Warm Paper.
- **Shadow Strategy:** Flat except for the signature instrument baseline.
- **Border:** One-pixel graphite for major containers; Calibration Line for internal divisions.
- **Internal Padding:** 20px on desktop and 16px on mobile.

### Inputs / Fields
- **Style:** Full-width warm-paper select with a graphite border, 4px radius, and 44px minimum height.
- **Focus:** The shared cobalt focus outline.
- **Error / Disabled:** Disabled fields reduce opacity; nearby error messages use Fault Tint and Fault Coral.

### Navigation
- **Style:** A sticky warm-paper bar with compact sans links and a calibration-line baseline.
- **State:** Links use cobalt tint and deep cobalt on hover; focus uses the shared outline.
- **Mobile:** Side padding and link padding contract while 44px targets remain intact.

### Rule-to-Verdict Instrument
- **Style:** Two mapped path channels feed a shared cobalt gate and a verdict rail through animated signal wires.
- **State:** Idle is gray, passing evidence is cobalt, and failed evidence switches only the affected path and verdict to coral.
- **Motion:** The signal pulse replays after a run and is disabled when reduced motion is requested.

## Do's and Don'ts

### Do:
- **Do** lead with observed state, the mapped scope, and the next action.
- **Do** use cobalt consistently for interactive state and verified passing evidence.
- **Do** preserve 44px controls, visible keyboard focus, and the vertical mobile instrument flow.
- **Do** keep explanatory text short enough that the instrument remains the visual center.

### Don't:
- **Don't** turn Rite into a dark, monospaced editorial interface.
- **Don't** use coral for decoration, emphasis, or neutral warnings.
- **Don't** add gradients, glass effects, diffuse card shadows, or oversized decorative radii.
- **Don't** use monospace for headings, navigation, buttons, or ordinary prose.
