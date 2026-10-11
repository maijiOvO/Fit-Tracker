/**
 * 头像缩成 256×256 的 JPEG（avatar-bloats-storage）。
 *
 * 原先把相册原图整张 base64 存了两份（约 210 万字符，占掉 localStorage 四成），还跟着每次推送进同步快照；
 * 换一张手机原图就会写满，之后标签、改名、单位等写入都被静默吞掉。
 * 头像只在圆形 object-cover 里显示，所以居中裁成正方形再缩，看起来和原图一样，只有几十 KB。
 */
export const AVATAR_PX = 256;

/** 超过这么长的已存头像当成旧的原图，启动时缩一次 */
export const AVATAR_LEGACY_MIN_CHARS = 150_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

export async function shrinkAvatar(src: Blob | string): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('empty image');
    const out = Math.min(AVATAR_PX, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    // JPEG 没有透明通道：透明 PNG 先垫白，不然底色变黑
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      out,
      out,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}
