
import { useEffect } from 'react';
import { requestBanner, releaseBanner } from '../services/bannerAdService';

export default function HomeBannerAd() {
  useEffect(() => {
    void requestBanner('home');

    return () => {
      releaseBanner('home');
    };
  }, []);

  return null;
}
