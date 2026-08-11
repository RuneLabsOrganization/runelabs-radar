/**
 * Client-side chart export: serializes the first <svg> inside a container,
 * stamps it on the scope surface with a watermark strip, renders 2x to a
 * canvas, then copies to clipboard (or downloads as fallback).
 * No dependencies — the charts are hand-rolled SVG with attribute styling,
 * which serializes cleanly.
 */

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export async function exportChartAsPng(
  container: HTMLElement,
  opts: { title: string; brand: string },
): Promise<'clipboard' | 'download'> {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg in chart frame');

  const { width, height } = svg.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const chartXml = new XMLSerializer().serializeToString(clone);

  const strip = 26;
  const bg = cssVar('--scope-1', '#0e141b');
  const ink = cssVar('--ink-4', '#68798a');
  const watermark = escapeXml(`${opts.title} · ${opts.brand}`);

  const combined =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + strip}">` +
    `<rect width="${w}" height="${h + strip}" fill="${bg}"/>` +
    chartXml +
    `<text x="10" y="${h + 17}" font-family="ui-monospace, monospace" font-size="10" letter-spacing="1.5" fill="${ink}">${watermark}</text>` +
    `</svg>`;

  const svgUrl = URL.createObjectURL(new Blob([combined], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('svg raster failed'));
      el.src = svgUrl;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = (h + strip) * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('png encode failed');

    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'clipboard';
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      return 'download';
    }
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
