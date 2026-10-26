
import { useEffect } from 'react';
import { requestBanner, releaseBanner } from '../services/bannerAdService';

export default function ProfileBannerAd() {
  useEffect(() => {
    void requestBanner('profile');

    return () => {
      releaseBanner('profile');
    };
  }, []);

  return null;
}
