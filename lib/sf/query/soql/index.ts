export {
  SalesforceAuthError,
  SalesforceTokenCache,
  loadSalesforceCredentials,
  signSalesforceJwt,
  exchangeJwtForToken,
  getSalesforceToken,
  type SalesforceCredentials,
  type SalesforceToken,
} from './auth';

export { validateSoql, clampSoqlLimit, type ValidationResult } from './validator';

export {
  executeSoql,
  SalesforceQueryError,
  SF_API_VERSION,
  type QueryResult,
  type SoqlRecord,
} from './executor';

export type { SystemRuleRow } from './system-rules';
