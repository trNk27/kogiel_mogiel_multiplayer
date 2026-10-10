import type { IceJson, IceServersResponse } from '../../../shared/protocol';

let ice: Promise<RTCIceServer[]> | null = null;

/** STUN/TURN servers from the Worker (fetched once per page; TURN credentials last 12 hours). */
export function iceServers(): Promise<RTCIceServer[]> {
  ice ??= fetch('/api/ice')
    .then((r) => (r.ok ? (r.json() as Promise<IceServersResponse>) : Promise.reject(new Error(String(r.status)))))
    .then((d) => d.iceServers as RTCIceServer[])
    .catch(() => {
      ice = null;
      return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    });
  return ice;
}

export function iceJson(c: RTCIceCandidate): IceJson {
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment };
}

/**
 * Runs async steps one after another. Signalling messages arrive in order over the socket, but
 * applying one (setRemoteDescription) is async: a candidate must wait for the description before it.
 */
export function serial() {
  let chain: Promise<unknown> = Promise.resolve();
  return (step: () => Promise<unknown>) => {
    chain = chain.then(step).catch((err) => console.warn('[mirror]', err));
  };
}

/** Can this browser share its own screen (the host side of a second screen)? */
export function canShareScreen(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}
