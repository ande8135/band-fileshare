/** Runtime settings from /config.js, which Terraform writes next to the site. */
export interface AppConfig {
  apiUrl: string;
  cognitoDomain: string;
  clientId: string;
  redirectUri: string;
}

declare global {
  interface Window {
    APP_CONFIG: AppConfig;
  }
}

export const cfg: AppConfig = window.APP_CONFIG;
