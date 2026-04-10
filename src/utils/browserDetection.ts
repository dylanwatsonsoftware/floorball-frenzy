export interface InAppInfo {
  isInApp: boolean;
  appName: string;
}

export function detectInAppBrowser(): InAppInfo {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";

  if (/Messenger/i.test(ua)) {
    return { isInApp: true, appName: "Messenger" };
  }
  if (/FBAN|FBAV/i.test(ua)) {
    return { isInApp: true, appName: "Facebook" };
  }
  if (/Instagram/i.test(ua)) {
    return { isInApp: true, appName: "Instagram" };
  }
  if (/LinkedInApp/i.test(ua)) {
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
