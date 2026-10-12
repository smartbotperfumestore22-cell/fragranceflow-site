// Illustrative bottle photos, used until a perfume has a real photo in the Sheet (Perfumes.image_url),
// and as the fallback when that photo cannot be loaded.
export const IMG = {
  c1: '/images/bottle-floral.webp',
  c2: '/images/bottle-fresh.webp',
  c3: '/images/bottle-oriental.webp',
  c4: '/images/bottle-aromatic.webp',
  c5: '/images/bottle-woody.webp'
};

// Cloudinary delivery URL → optimised for the cards: automatic format (WebP/AVIF) and quality,
// never wider than `w` px (enough for the largest card on a 2× screen). Other URLs are left as they are.
// A URL that already carries a transformation (e.g. .../upload/w_500/...) is not changed.
export function cdn(url, w = 800) {
  const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(url || '');
  if (!m) return url;
  const first = m[2].split('/')[0];
  if (/^[a-z]{1,3}_[^/]*$/.test(first) && !/^v\d+$/.test(first)) return url;
  return m[1] + `f_auto,q_auto,c_limit,w_${w}/` + m[2];
}

// Image to show for a perfume: its real photo when the Sheet has one, else the illustrative photo.
// Every real photo gets a fallback, used if it fails to load (see watchImageErrors).
const FALLBACK = {};
export function imageFor(imageUrl, imageKey) {
  const fallback = IMG[imageKey] || IMG.c2;
  if (!imageUrl) return { image: fallback, realImage: false };
  const image = cdn(imageUrl);
  FALLBACK[image] = fallback;
  return { image, realImage: true };
}

// One listener for the whole page (homepage, catalogue, fragrance page, quiz results):
// a real photo that fails to load is swapped for its illustrative photo, so no broken-image icon shows.
export function watchImageErrors() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const fb = FALLBACK[img.getAttribute('src')];
    if (fb && !img.dataset.ffFallback) { img.dataset.ffFallback = '1'; img.src = fb; }
  }, true);
}
