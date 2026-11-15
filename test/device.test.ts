import { describe, expect, it } from 'vitest';
import { looksLikePhone } from '../client/src/host/device';

const media = (coarse: boolean) => ((q: string) => ({ matches: coarse && q.includes('coarse') })) as unknown as typeof matchMedia;
const check = (userAgent: string, opts: { mobile?: boolean; coarse?: boolean; w?: number; h?: number } = {}) =>
  looksLikePhone({ userAgent, userAgentData: opts.mobile === undefined ? undefined : { mobile: opts.mobile } }, media(opts.coarse ?? true), {
    width: opts.w ?? 412,
    height: opts.h ?? 915,
  });

describe('looksLikePhone', () => {
  it('sends phones to the join page even when their screen looks big', () => {
    const pixel = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    expect(check(pixel)).toBe(true);
    expect(check(pixel, { w: 640, h: 1400 })).toBe(true);
    expect(check('Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0', { w: 700 })).toBe(true);
    expect(check('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(true);
    expect(check('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36', { mobile: true, w: 980 })).toBe(true);
  });

  it('still catches a phone in desktop mode by its small touch screen', () => {
    expect(check('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', { mobile: false })).toBe(true);
  });

  it('lets TVs, consoles, tablets and laptops host', () => {
    expect(check('Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series S) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', { coarse: false, w: 1920, h: 1080 })).toBe(false);
    expect(check('Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.0 like Chrome/112.0 Mobile Safari/537.36', { w: 960, h: 540 })).toBe(false);
    expect(check('Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36', { w: 1920, h: 1080 })).toBe(false);
    expect(check('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', { w: 744, h: 1133 })).toBe(false);
    expect(check('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', { mobile: false, w: 800, h: 1280 })).toBe(false);
    expect(check('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', { mobile: false, coarse: false, w: 1920, h: 1080 })).toBe(false);
  });
});
