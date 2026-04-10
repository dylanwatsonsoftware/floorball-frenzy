export interface InAppBrowserInfo {
  isInApp: boolean;
  appName?: string;
}

/**
 * Detects if the current browser is an in-app browser for Facebook, Messenger, Instagram, or LinkedIn.
 * @returns {InAppBrowserInfo} Object containing whether it's an in-app browser and the identified app name.
 */
export function detectInAppBrowser(): InAppBrowserInfo {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";

  // Facebook and Messenger
  // FBAN = Facebook App for iOS
  // FBAV = Facebook App Version
  // FB_IAB = Facebook In-App Browser
  // Messenger usually identifies with "Messenger" or "FBAN/Messenger"
  if (ua.indexOf("FBAN") > -1 || ua.indexOf("FBAV") > -1) {
    if (ua.indexOf("Messenger") > -1 || ua.indexOf("FB_IAB/MESSENGER") > -1) {
      return { isInApp: true, appName: "Messenger" };
    }
    return { isInApp: true, appName: "Facebook" };
  }

  // Instagram
  if (ua.indexOf("Instagram") > -1) {
    return { isInApp: true, appName: "Instagram" };
  }

  // LinkedIn
  if (ua.indexOf("LinkedInApp") > -1) {
    return { isInApp: true, appName: "LinkedIn" };
  }

  return { isInApp: false };
}
