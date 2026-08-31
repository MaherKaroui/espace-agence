import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.izisuivis.app',
  appName: 'IZISUIVIS',
  webDir: 'capacitor-web',
  server: {
    url: 'https://izisuivis.com',
    cleartext: false,
  },
};

export default config;