/**
 * The placeholder product brand (week 10: "add a fake product name or logo, for example in the top banner").
 * homeclause is a made-up name for a concept app built on PPD; it is not CableLabs' or the program's name.
 * Everything brand-related lives here (plus public/favicon.svg and public/icons/), so a partner's brand can replace it.
 *
 * The mark is the "o" from the name with a roof over it; the wordmark carries the same roof over its "o".
 */
export const BRAND = {
  name: 'homeclause',
  tagline: 'Your home’s privacy rules, sent to every device.',
  ppd: 'PPD lets smart devices receive your household’s privacy rules and confirm them.',
}

/** The roofed-o mark. Draws in currentColor, so it takes the colour of where it sits. */
export function BrandMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg className="bmark" width={size} height={size} viewBox="0 0 48 48" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M10 22.5 24 9.5l14 13" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="31" r="8.5" fill="none" stroke="currentColor" strokeWidth="5" />
    </svg>
  )
}

/** "homeclause" with a roof over the o. */
export function Wordmark() {
  return (
    <span className="bword" aria-label={BRAND.name}>
      <span aria-hidden="true">h<span className="broof">o<svg viewBox="0 0 40 20"><path d="M5 16.5 20 4l15 12.5" /></svg></span>meclause</span>
    </span>
  )
}

/** The mark in a blue rounded square, like the home-screen icon. */
export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="btile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.25) }}>
      <BrandMark size={Math.round(size * 0.75)} />
    </span>
  )
}

/** Tile and wordmark together, as in the top banner and the side rail. */
export function BrandLockup({ size = 28 }: { size?: number }) {
  return <span className="brand"><BrandTile size={size} /><Wordmark /></span>
}
