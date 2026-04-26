import Constants from 'expo-constants';
import { Platform } from 'react-native';

const FALLBACK_API_BASE_URL = 'http://192.168.1.5:3000';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isLocalHost(host) {
  return LOCAL_HOSTS.has(String(host || '').toLowerCase());
}

function isPrivateIPv4(host) {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isPreferredLanHost(host) {
  if (!host) {
    return false;
  }

  return isLocalHost(host) || isPrivateIPv4(host);
}

function getExpoHost() {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  return hostUri ? hostUri.split(':')[0] : '';
}

function getWebHost() {
  if (typeof window === 'undefined' || !window?.location) {
    return '';
  }

  return window.location.hostname || '';
}

function buildApiUrl(host) {
  if (!host) {
    return '';
  }

  return `http://${host}:3000`;
}

function resolveApiBaseUrl() {
  const envUrl = trimTrailingSlash(process.env.EXPO_PUBLIC_API_BASE_URL);

  if (envUrl) {
    return envUrl;
  }

  const fallbackHost = getHostFromUrl(FALLBACK_API_BASE_URL);
  const preferredHost = Platform.OS === 'web'
    ? (() => {
        const webHost = getWebHost();
        const expoHost = getExpoHost();
        return isLocalHost(webHost)
          ? (isPreferredLanHost(expoHost) ? expoHost : fallbackHost)
          : webHost;
      })()
    : (() => {
        const expoHost = getExpoHost();
        return isPreferredLanHost(expoHost) ? expoHost : fallbackHost;
      })();
  const derivedUrl = trimTrailingSlash(buildApiUrl(preferredHost));

  if (derivedUrl) {
    return derivedUrl;
  }

  return FALLBACK_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();
