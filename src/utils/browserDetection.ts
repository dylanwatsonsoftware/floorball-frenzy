export interface InAppInfo {
  isInApp: boolean;
  appName: string;
}

export function detectInAppBrowser(): InAppInfo {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";

  if (/Messenger|FB_IAB|MESSENGER/i.test(ua)) {
    return { isInApp: true, appName: "Messenger" };
  }
  if (/FBAN|FBAV/i.test(ua)) {
    return { isInApp: true, appName: "Facebook" };
  }
  if (/Instagram/i.test(ua)) {
    return { isInApp: true, appName: "Instagram" };
  }
  if (/LinkedIn/i.test(ua)) {
    return { isInApp: true, appName: "LinkedIn" };
  }
  if (/Threads/i.test(ua)) {
    return { isInApp: true, appName: "Threads" };
  }
  if (/Twitter|TeslaApp/i.test(ua)) {
    return { isInApp: true, appName: "X (Twitter)" };
  }

  return { isInApp: false, appName: "" };
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad Pro
}

export function isStandalone(): boolean {
  return (window.navigator as any).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}
