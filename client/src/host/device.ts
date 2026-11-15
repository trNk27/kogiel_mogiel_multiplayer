/**
 * Is this browser a phone (send it to the join page) rather than a TV, laptop or tablet (host)?
 *
 * The browser's own word comes first: `userAgentData.mobile`, or "Mobile" in an Android user
 * agent, "iPhone" and the like. Screen size alone is not enough: a phone with a large display
 * size setting, or a browser that reports odd screen dimensions, used to slip through and get
 * the TV screen. TV browsers (Android TV, Fire TV, Tizen, webOS, Xbox) never count as phones.
 */
export function looksLikePhone(nav: Pick<Navigator, 'userAgent'> & { userAgentData?: { mobile?: boolean } } = navigator, media = matchMedia, scr: Pick<Screen, 'width' | 'height'> = screen): boolean {
  const ua = nav.userAgent;
  if (/\bTV\b|SMART-TV|SmartTV|GoogleTV|AndroidTV|CrKey|\bAFT\w|Web0S|webOS|Tizen|Xbox|PlayStation|Nintendo/i.test(ua)) return false;
  if (/iPad/.test(ua)) return false; // tablets host (an iPad's user agent says "Mobile" too)
  if (nav.userAgentData?.mobile) return true;
  if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) return true;
  // A desktop-mode browser on a phone hides all that: fall back to a touch screen that's phone-sized.
  return media('(pointer: coarse)').matches && Math.min(scr.width, scr.height) < 600;
}
