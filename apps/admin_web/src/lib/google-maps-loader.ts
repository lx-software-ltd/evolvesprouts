const SCRIPT_FLAG = 'data-admin-google-maps';

type GoogleMapsNamespace = typeof google.maps;

let loadPromise: Promise<GoogleMapsNamespace> | null = null;

function mapsFromWindow(): GoogleMapsNamespace | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.google?.maps ?? null;
}

/** Load the Maps JavaScript API once. The key must already be present. */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsNamespace> {
  const existing = mapsFromWindow();
  if (existing) {
    return Promise.resolve(existing);
  }
  if (loadPromise) {
    return loadPromise;
  }
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const maps = mapsFromWindow();
      if (!maps) {
        loadPromise = null;
        reject(new Error('Google Maps failed to initialize.'));
        return;
      }
      resolve(maps);
    };

    const tagged = document.querySelector(`script[${SCRIPT_FLAG}="true"]`);
    if (tagged) {
      tagged.addEventListener('load', finish);
      tagged.addEventListener('error', () => {
        loadPromise = null;
        reject(new Error('Failed to load Google Maps.'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.setAttribute(SCRIPT_FLAG, 'true');
    script.addEventListener('load', finish);
    script.addEventListener('error', () => {
      loadPromise = null;
      reject(new Error('Failed to load Google Maps.'));
    });
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function resetGoogleMapsLoaderForTests(): void {
  loadPromise = null;
}
