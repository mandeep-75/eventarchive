import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './client'

const BUCKET = 'event-media'

/** Signed URLs are temporary, so they are minted on demand rather than stored. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7

/**
 * Uploads land at `events/{eventId}/{uid}/{folder}/{file}`.
 *
 * The event id is segment 2, and that is the segment the storage policies read
 * to work out which department owns the file — so it must stay at index 2 and
 * must be the real event id. The uploader's own id follows it, taken from the
 * signed-in session rather than passed in, so a caller cannot file an upload
 * under someone else's folder.
 *
 * The returned value is the storage *path*, not a URL. The bucket is private so
 * that the "any signed-in teacher may read" rule in schema.sql actually applies;
 * render it through useSignedUrl (cover) or useOnDemandSigner (everything else).
 */
async function pathFor(eventId: string, folder: string, fileName: string) {
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) throw new Error('You must be signed in to upload files.')
  return `events/${eventId}/${uid}/${folder}/${fileName}`
}

/** Must match `file_size_limit` on the event-media bucket in schema.sql. */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * The largest file the browser will even try to read, as opposed to the largest
 * one the bucket will accept.
 *
 * Deliberately separate from MAX_BYTES. An image is re-encoded before it is
 * uploaded, so a 14 MB phone photo is no longer a problem — it lands as a few
 * hundred KB. Holding it to the bucket's limit would reject the exact case the
 * compression exists to rescue. A report is never re-encoded, so it is still
 * held to MAX_BYTES, and this is only the ceiling on what we are willing to
 * decode into memory.
 */
const MAX_INPUT_BYTES = 40 * 1024 * 1024

/**
 * Longest edge, in pixels, of an uploaded image.
 *
 * Sized to the largest an image is ever *drawn*: the cover is a `max-w-3xl`
 * article, so ~670px wide, and a gallery tile is an aspect-square box of about
 * 300px. A gallery photo is also linked at full size, so this is not a crop to
 * what the UI happens to show today — it is the point past which the extra
 * pixels are paid for on every view and looked at by nobody.
 */
const MAX_EDGE = 1600

/** Re-encode quality. Below ~0.75 artefacts show on projectors; above ~0.85 the bytes do too. */
const QUALITY = 0.8

/**
 * How long a stored object may be reused, written as object metadata.
 *
 * Measured, not assumed: this reaches `GET /object/authenticated/…` — which
 * answers `cache-control: public, max-age=300` — but Supabase's *signed* URL
 * response carries no `cache-control` at all, and a signed URL is the only way
 * this app reads media. So this does not reduce egress today. It is kept because
 * it is correct, costs nothing, and is the difference if the read path ever
 * stops going through a signature.
 *
 * `images` and `report` paths both carry a timestamp, so one path only ever holds
 * one file and could be cached indefinitely. `cover` is the exception: it is one
 * fixed path written with upsert, so a teacher who replaces the photo would keep
 * seeing the old one until this expires.
 *
 * Note what is *not* fixed here, and cannot be from this file: a signature is
 * unique per mint, so a fresh page load asks Storage for a fresh URL for the same
 * bytes and the browser has no cache entry to match it against. Reusing one
 * signature across loads would cut repeat cover traffic, but it means holding a
 * 7-day bearer token per photo in the browser, so it is a deliberate decision
 * rather than a default.
 */
function cacheControlFor(folder: string): string {
  return folder === 'cover' ? '300' : '31536000'
}

/** Replaces a trailing extension, or appends one when the name has none. */
function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.')
  // A leading dot is a dotfile, not an extension.
  return dot > 0 ? name.slice(0, dot) + ext : name + ext
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

/** What a re-encode produced, or null when the original should be uploaded as-is. */
type Encoded = { body: Blob; type: string; ext: string }

/**
 * Re-encodes an image before it is uploaded.
 *
 * Why: egress is charged per byte served, and this archive shows a cover to
 * every teacher who opens a list and every colleague who opens the event. A
 * modern phone photo is routinely 4-8 MB as it comes off the camera, and the
 * cover is painted into a 670px box — so almost all of that is paid for on every
 * view and never seen. Compressing on the way in costs each file once and
 * reduces it on every view for the life of the archive.
 *
 * Compression rather than cropping, on purpose. Cropping to the aspect the UI
 * happens to want throws away pixels a teacher may want when they open the photo
 * full size, and it has to guess that aspect before the file is stored. Scaling
 * the long edge and re-encoding keeps the whole frame and simply stops paying
 * for the part nobody looks at.
 *
 * Two properties matter more than the ratio achieved:
 *
 *   - It never returns something larger than it was given. An already-optimised
 *     file is passed through untouched rather than re-encoded worse, which is
 *     what stops this from quietly making egress go up.
 *   - It never throws. A browser that cannot decode the image, or a canvas that
 *     will not cooperate, uploads the original — failing to store a photo is
 *     worse than storing a large one.
 */
async function compressImage(file: File): Promise<Encoded | null> {
  // createImageBitmap rather than an <img> element: it decodes off the main
  // thread, it takes a File directly with no object URL to revoke, and it does
  // not put a second request for the file in front of the upload.
  if (typeof createImageBitmap !== 'function') return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null // a format this browser will not decode — upload it untouched
  }

  try {
    // Only ever downscale. An image already inside the cap keeps its pixels and
    // is judged purely on whether re-encoding made it smaller.
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // JPEG has no alpha channel, so an unpainted canvas comes through black
    // behind anything that was transparent. White is what flattening a PNG in an
    // image editor would have produced.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    // WebP first because it is materially smaller at the same quality, then
    // JPEG as the floor. `canvas.toBlob` does not fail when it cannot honour the
    // requested type — it silently hands back PNG, which is *larger* than what we
    // started with — so the returned type is checked rather than assumed.
    for (const type of ['image/webp', 'image/jpeg'] as const) {
      const blob = await canvasToBlob(canvas, type, QUALITY)
      if (!blob || blob.type !== type) continue
      if (blob.size >= file.size) continue
      return {
        body: blob,
        type,
        ext: type === 'image/webp' ? '.webp' : '.jpg',
      }
    }
    return null
  } finally {
    bitmap.close()
  }
}

async function upload(
  file: File,
  eventId: string,
  folder: string,
  fileName: string,
): Promise<string> {
  // A report is a document, not a picture: re-encoding a PDF as an image would
  // destroy it. So only the image folders are squeezed, and the bucket's own
  // limit still applies to everything that reaches it.
  const isReport = folder === 'report'
  const limit = isReport ? MAX_BYTES : MAX_INPUT_BYTES

  // Checked before the request: Storage answers an oversized file with a bare
  // 400, which is indistinguishable from a permissions failure in the console.
  if (file.size > limit) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
        (isReport
          ? `Reports must be under ${MAX_BYTES / 1024 / 1024} MB — compress or shorten it first.`
          : `Images must be under ${limit / 1024 / 1024} MB.`),
    )
  }

  const compressed = isReport ? null : await compressImage(file)
  const body = compressed ? compressed.body : file

  // The stored name has to agree with the stored bytes. A `.png` path holding
  // WebP is served with the wrong Content-Type by anything that trusts the
  // extension, and `cover.jpg` is already the name the cover lives under.
  const storedName = compressed ? withExtension(fileName, compressed.ext) : fileName

  const path = await pathFor(eventId, folder, storedName)
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    // Cover and gallery images replace any previous file at the same path.
    upsert: !isReport,
    // Sent explicitly so a File with an empty or odd `type` still lands as an
    // image rather than application/octet-stream.
    contentType: compressed ? compressed.type : file.type || 'image/jpeg',
    cacheControl: cacheControlFor(folder),
  })
  if (error) {
    // Storage reports policy denials, missing buckets and oversize files all
    // as a bare "400". Keep the status so the cause is not lost.
    throw new Error(`${error.message} (storage ${error.status ?? 'error'})`)
  }
  return path
}

export function uploadCoverImage(eventId: string, file: File) {
  return upload(file, eventId, 'cover', 'cover.jpg')
}

export function uploadEventImage(eventId: string, file: File, stamp: number | string) {
  return upload(file, eventId, 'images', `${stamp}-${file.name}`)
}

export function uploadReport(eventId: string, file: File) {
  return upload(file, eventId, 'report', `${Date.now()}-${file.name}`)
}

export async function deleteImage(path: string) {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) throw error
  } catch {
    // Ignore missing files
  }
}

/** Turns a stored storage path into a temporary URL that can go in `src`. */
export async function signUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error) return null
  return data.signedUrl
}

/**
 * Signs a path when someone asks for it, rather than when the page loads.
 *
 * A gallery holds a dozen photos and a report is often a multi-page PDF, and the
 * storage policy lets any signed-in teacher read all of it — so signing a whole
 * event's media on arrival means every teacher who opens the page pulls every
 * file, whether or not they ever look at it. Nothing is fetched here either: this
 * only mints the URL, and the file itself is requested by whoever opens it.
 *
 * The cover is the deliberate exception, in `useSignedUrl` below. It is the one
 * image a list shows, so a card without it is not a card.
 *
 * Returns the URL rather than opening it, so the caller decides what "See" means:
 * a photo is shown in its own tile, and a report is handed to a new tab because a
 * document is not something to render inside a page.
 *
 * Results are cached by path for the life of the page, because a signature is
 * good for `SIGNED_URL_TTL` and re-opening the same photo should not ask again —
 * so a second view is immediate and never touches the network.
 *
 * `urls` holds everything signed so far, so a gallery tile can render the photo
 * it asked for without the component keeping its own copy. It is a map rather than
 * one string because a teacher can open several tiles in a row, and `pending` is a
 * map for the same reason: a single slot would make a second tile look idle while
 * the first was still loading, and clicking it would then be a no-op.
 */
export function useOnDemandSigner() {
  const cache = useRef<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  const sign = useCallback(async (path: string): Promise<string | null> => {
    const cached = cache.current[path]
    if (cached) return cached
    setError('')
    setPending((p) => ({ ...p, [path]: true }))
    try {
      const url = await signUrl(path)
      if (!url) {
        setError(
          'That file could not be opened. It may have been removed, or you may not have access.',
        )
        return null
      }
      cache.current[path] = url
      setUrls((u) => ({ ...u, [path]: url }))
      return url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be opened.')
      return null
    } finally {
      setPending((p) => {
        const next = { ...p }
        delete next[path]
        return next
      })
    }
  }, [])

  return { sign, urls, pending, error }
}

/**
 * Signs one path for display.
 *
 * The result is keyed by the path it was signed for, so switching to a different
 * event cannot briefly show the previous event's image while the new signature
 * is in flight. Nothing is set synchronously: the URL is only committed once the
 * signature actually arrives.
 */
export function useSignedUrl(path: string | null | undefined) {
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    void signUrl(path).then((url) => {
      if (!cancelled && url) setSigned({ path, url })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return signed && signed.path === path ? signed.url : null
}
