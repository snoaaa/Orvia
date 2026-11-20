import packageInfo from '../../package.json';

export const environment = {
  appVersion: packageInfo.version,
  production: false,
  apiUrl: 'http://localhost:8084',
  googleClientId: '914322029670-38rtk1a8enu127ht753ifsr9h3haehhe.apps.googleusercontent.com'
};
