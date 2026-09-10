/// <reference types="google.maps" />

/** Pull `@types/google.maps` into the Next/tsc program (it is not auto-included). */
export {};

declare global {
  interface Window {
    google?: typeof google;
  }
}
