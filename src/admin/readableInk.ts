/**
 * Picks text colour that stays readable on a background chosen at runtime.
 *
 * Team members carry their own colour, set in the Team studio and stored per
 * organization, and it is painted onto the initials chips inline. The text on
 * those chips was always white, so a light swatch produced initials at around
 * 3:1 — under the 4.5:1 the accessibility check requires, and hard to read at
 * the size these chips are drawn.
 *
 * CSS cannot fix that, because the colour is data rather than a declaration.
 * This computes the answer per colour instead of constraining what a business
 * is allowed to pick.
 */

/** Relative luminance, per WCAG 2.x. */
function relativeLuminance(red: number, green: number, blue: number): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split('').map((d) => d + d).join('')
      : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  return null;
}

/** The dark ink used when white would be too faint. Matches --admin-ink. */
const DARK_INK = '#17352d';

/**
 * Returns whichever of white or the studio's dark ink contrasts better with
 * `background`. An unparseable colour falls back to white, which is what the
 * chips did before and never looks broken on the palette's own swatches.
 */
export function readableInk(background: string | null | undefined): string {
  if (!background) return '#ffffff';
  const parsed = parseColor(background);
  if (!parsed) return '#ffffff';

  const backgroundLuminance = relativeLuminance(...parsed);
  const darkLuminance = relativeLuminance(0x17, 0x35, 0x2d);

  const againstWhite = 1.05 / (backgroundLuminance + 0.05);
  const againstDark = (backgroundLuminance + 0.05) / (darkLuminance + 0.05);

  return againstWhite >= againstDark ? '#ffffff' : DARK_INK;
}
