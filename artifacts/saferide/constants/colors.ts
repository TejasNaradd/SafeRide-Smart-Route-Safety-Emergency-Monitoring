/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#15241d',
    tint: '#0b8f58',

    // Core surfaces
    background: '#f5f8f6',
    foreground: '#15241d',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#15241d',

    // Primary action color (buttons, links, active states)
    primary: '#0b8f58',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e7f3ec',
    secondaryForeground: '#17633e',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#edf2ee',
    mutedForeground: '#6b7d73',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#d7f0e1',
    accentForeground: '#17633e',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#d9e5dd',
    input: '#d9e5dd',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 14,
};

export default colors;
