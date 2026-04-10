import { describe, it, expect, vi } from 'vitest';
import { detectInAppBrowser } from '../src/utils/browserDetection';

describe('browserDetection', () => {
  it('detects Facebook', () => {
    const facebookUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/18D52 [FBAN/FBIOS;FBAV/305.0.0.34.112;FBBV/273347571;FBDV/iPhone11,8;FBMD/iPhone;FBSN/iOS;FBSV/14.4;FBSS/2;FBID/phone;FBLC/en_GB;FBOP/5;FBCR/]";
    vi.stubGlobal('navigator', { userAgent: facebookUA });
    expect(detectInAppBrowser()).toEqual({ isInApp: true, appName: "Facebook" });
  });

  it('detects Messenger', () => {
    const messengerUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/18D52 [FBAN/MessengerForiOS;FBAV/305.0.0.34.112;FBBV/273347571;FBDV/iPhone11,8;FBMD/iPhone;FBSN/iOS;FBSV/14.4;FBSS/2;FBID/phone;FBLC/en_GB;FBOP/5;FBCR/]";
    vi.stubGlobal('navigator', { userAgent: messengerUA });
    expect(detectInAppBrowser()).toEqual({ isInApp: true, appName: "Messenger" });
  });

  it('detects Instagram', () => {
    const instagramUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/18D52 Instagram 173.0.0.28.118 (iPhone11,8; iOS 14_4; en_GB; en-GB; scale=2.00; 828x1792; 273347571)";
    vi.stubGlobal('navigator', { userAgent: instagramUA });
    expect(detectInAppBrowser()).toEqual({ isInApp: true, appName: "Instagram" });
  });

  it('detects LinkedIn', () => {
    const linkedInUA = "Mozilla/5.0 (Linux; Android 15; 2210129SG Build/AQ3A.240912.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36 [LinkedInApp]/2.234.32";
    vi.stubGlobal('navigator', { userAgent: linkedInUA });
    expect(detectInAppBrowser()).toEqual({ isInApp: true, appName: "LinkedIn" });
  });

  it('returns false for standard Safari', () => {
    const safariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1";
    vi.stubGlobal('navigator', { userAgent: safariUA });
    expect(detectInAppBrowser()).toEqual({ isInApp: false });
  });
});
