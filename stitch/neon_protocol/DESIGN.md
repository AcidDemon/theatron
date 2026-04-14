# Design System Document

## 1. Overview & Creative North Star: "The Terminal Architect"

This design system is engineered for the high-stakes environments of cybersecurity and systems development. We are moving away from the "generic SaaS" look and toward a **Terminal Architect** aesthetic. 

The North Star of this system is **High-Contrast Precision**. It bridges the gap between the raw utility of a command-line interface (CLI) and the sophisticated hierarchy of modern editorial design. By utilizing intentional asymmetry, monospaced data structures, and a "No-Line" philosophy, we create a workspace that feels like a powerful instrument rather than a basic web tool. This is a system built for focus, where the UI recedes to let critical session data and technical insights take center stage.

---

## 2. Colors & Surface Philosophy

The color palette is rooted in the "Invizible" matrix—a deep, obsidian base punctuated by high-frequency greens.

### The Palette (Material Design Tokens)
*   **Primary Core:** `primary_container` (#00FF41) – The "Active Pulse" of the system.
*   **The Deep Base:** `surface` (#131313) and `surface_container_lowest` (#0E0E0E).
*   **Data Signals:** `secondary` (#56E15B) for success/active states; `error` (#FFB4AB) for critical security alerts.

### The "No-Line" Rule
Standard 1px borders are strictly prohibited for sectioning. They create visual noise that distracts from dense technical data. 
*   **Boundaries:** Define sections using background shifts. A `surface_container_low` sidebar should sit directly against a `surface` main stage. 
*   **Hierarchy via Nesting:** Treat the UI as layers of "Signal Density." Use `surface_container_highest` for the most interactive, foregrounded elements (like a floating command palette) and `surface_container_low` for the structural foundations.

### The "Glass & Gradient" Rule
To elevate the "Terminal" look into a premium experience:
*   **Glassmorphism:** For overlays, modals, or floating filters, use a semi-transparent `surface_variant` with a `24px` backdrop-blur. 
*   **Signature Textures:** Apply a subtle linear gradient (from `primary_container` to `on_primary_container`) on primary CTAs to simulate the glow of a high-end phosphorescent display.

---

## 3. Typography: Monospaced Authority

The system uses a dual-font strategy to balance technical utility with editorial readability.

*   **Display & Headline (Space Grotesk):** These fonts provide a modern, architectural structure to the page. `headline-lg` (2rem) should be used sparingly to define major modules.
*   **Body & Technical Data (Inter / Share Tech Mono):** 
    *   **Inter** handles standard UI labels and descriptive text for maximum legibility.
    *   **Share Tech Mono** is the system's "Source of Truth." It must be used for all code blocks, session logs, IP addresses, and terminal outputs.
*   **Hierarchy Tip:** Use `label-sm` in uppercase with `0.05em` letter spacing for metadata (e.g., "TIMESTAMP" or "SOURCE_IP") to evoke a professional "Military-Grade" documentation style.

---

## 4. Elevation & Depth: Tonal Layering

Shadows are almost non-existent in this system; depth is expressed through light and transparency.

*   **The Layering Principle:** Place a `surface_container_lowest` card on a `surface_container_low` background to create a "recessed" look for data tables.
*   **Ambient Shadows:** If a floating element (like a context menu) requires separation, use an ultra-diffused shadow: `0 12px 40px rgba(0, 255, 65, 0.08)`. The shadow is tinted with the primary green to suggest the element is "emitting light" onto the surface below.
*   **The Ghost Border:** If high-density data requires a container (like a search bar), use a **Ghost Border**: `outline_variant` at 15% opacity. It provides a structural hint without cluttering the view.

---

## 5. Components

### Buttons
*   **Primary:** Solid `primary_container` (#00FF41) with `on_primary` (#003907) text. Radius: `sm` (0.125rem) for a sharp, technical feel.
*   **Secondary:** Ghost style. Transparent background with a `primary_container` Ghost Border (20% opacity).
*   **Tertiary:** Text-only, monospaced, using `primary_fixed` color with a `_` (underscore) suffix to mimic terminal cursors.

### Efficient Data Tables
*   **Rule:** Forbid horizontal dividers. Use subtle alternating row colors (`surface` and `surface_container_low`).
*   **Typography:** All cell data should use `body-sm` in monospaced font for perfect vertical alignment of numbers and hashes.
*   **Active State:** Use a 2px vertical "pulse" line of `primary_container` on the far left of a selected row.

### Search & Filtering (The Command Bar)
*   **Style:** A centered, floating element using Glassmorphism. 
*   **Interaction:** On focus, the backdrop should dim slightly using a `surface_dim` overlay to pull the user into a "Search Mode."

### Chips & Tags
*   **Security Tags:** Use `surface_container_highest` backgrounds with monospaced labels. No rounded "pills"—use the `sm` (0.125rem) corner radius to maintain the architectural language.

---

## 6. Do’s and Don’ts

### Do
*   **DO** use whitespace as your primary separator.
*   **DO** align all monospaced text to a strict vertical grid to emphasize the "Terminal" feel.
*   **DO** use `error` and `secondary` colors only for status; never for decorative elements.
*   **DO** ensure all interactive elements have a clear "hover" state using a `surface_bright` tint.

### Don’t
*   **DON’T** use standard rounded corners (full radius). It breaks the technical, precise aesthetic.
*   **DON’T** use 1px solid borders to create "boxes." Use color blocks.
*   **DON’T** use drop shadows that are black or grey; always tint them with the surface or primary accent color.
*   **DON’T** mix monospaced and sans-serif fonts within the same text string. Keep their roles distinct.