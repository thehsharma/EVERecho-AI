import type { AppConfig } from './load';

/**
 * "EverEcho" is a working codename pending trademark clearance. Every
 * customer-visible reference to the product name resolves through here so a
 * rename is a configuration change, not a find-and-replace across the codebase.
 */
export interface Branding {
  productName: string;
  productCodename: string;
  supportEmail: string;
  dataRegion: string;
  jurisdiction: string;
  consentCopyVersion: string;
  legalCopyVersion: string;
  policyEngineVersion: string;
  trademarkStatus: 'working-codename-pending-clearance';
}

export function branding(cfg: AppConfig): Branding {
  return {
    productName: cfg.env.PRODUCT_NAME,
    productCodename: cfg.env.PRODUCT_CODENAME,
    supportEmail: cfg.env.SUPPORT_EMAIL,
    dataRegion: cfg.env.DATA_REGION,
    jurisdiction: cfg.env.JURISDICTION,
    consentCopyVersion: cfg.env.CONSENT_COPY_VERSION,
    legalCopyVersion: cfg.env.LEGAL_COPY_VERSION,
    policyEngineVersion: cfg.env.POLICY_ENGINE_VERSION,
    trademarkStatus: 'working-codename-pending-clearance',
  };
}

export interface FeatureFlags {
  performMode: false;
  p4InferenceInAnswers: boolean;
  successionExecution: false;
  demoMode: boolean;
  billing: boolean;
  adminTools: boolean;
}

export function features(cfg: AppConfig): FeatureFlags {
  return {
    // Typed as `false`: the compiler refuses code that switches these on.
    performMode: false,
    successionExecution: false,
    p4InferenceInAnswers: cfg.env.FEATURE_P4_INFERENCE_IN_ANSWERS,
    demoMode: cfg.env.FEATURE_DEMO_MODE,
    billing: cfg.env.FEATURE_BILLING,
    adminTools: cfg.env.FEATURE_ADMIN_TOOLS,
  };
}
