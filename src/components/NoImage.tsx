import { ImageOff } from 'lucide-react'

/**
 * Stands in for a cover that was never uploaded.
 *
 * An event with no cover used to render no header at all, which left a bare
 * white band across the top of the page and made cards in the list two different
 * heights for no reason. This is drawn rather than loaded: it is inline SVG, so
 * it costs no request and nothing to cache, which matters on a page whose whole
 * point is not fetching media nobody asked for.
 *
 * The hatching is a deliberate "nothing here yet" rather than a grey box, so it
 * cannot be mistaken for a photo that failed to load.
 */
export default function NoImage({
  className = '',
  label = 'No cover image',
}: {
  className?: string
  label?: string
}) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-slate-50 ${className}`}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full text-slate-200"
        preserveAspectRatio="none"
        viewBox="0 0 8 8"
      >
        <rect width="8" height="8" fill="currentColor" opacity="0.35" />
        <path d="M-2 10 L10 -2 M0 12 L12 0" stroke="currentColor" strokeWidth="0.4" />
      </svg>
      <div className="relative flex flex-col items-center gap-1.5 px-3 text-center">
        <ImageOff className="h-6 w-6 text-slate-400" />
        {label && <span className="text-xs font-medium text-slate-500">{label}</span>}
      </div>
    </div>
  )
}
