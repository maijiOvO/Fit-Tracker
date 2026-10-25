/**
 * 配重片刻度轨的「咔哒」：每过一片一声清脆的短响 + 一下短振（2026-10-25 用户定：像拨一个带棘轮的滑块）。
 *
 * 声音用 WebAudio 现场合成，不带音频文件：一段约 4 kHz 的方波急衰减 + 一小截 6 kHz 以上的噪声，约 12ms。
 * 2026-10-25 真机：2.3 kHz / 25ms 听着发闷，调高、调短才脆。
 * 跟着「触觉反馈」开关走（hapticsEnabled）——安静的馆里关了振动的人，多半也不想听见咔哒。
 * AudioContext 第一次用时才建（必须在用户手势里），之后复用；被系统挂起时 resume。
 */
import { haptic, hapticsEnabled, H } from './haptics';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastAt = 0;
/** 拖得飞快时一秒几十片：声音挤成嗡嗡，间隔至少这么长 */
const MIN_GAP_MS = 28;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.006), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** dir：往重（1）音高略低、往轻（−1）略高，听得出方向 */
export function tick(dir: 1 | -1 = 1): void {
  if (!hapticsEnabled()) return;
  haptic(H.tick);
  const now = performance.now();
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0.28;
    out.connect(ac.destination);

    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(dir > 0 ? 3800 : 4400, t);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.015);

    if (noise) {
      const src = ac.createBufferSource();
      src.buffer = noise;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      src.connect(hp).connect(out);
      src.start(t);
    }
  } catch {
    /* 没有声音不影响改重量 */
  }
}
