export * from './types.js'
export { capturePage, capturePageWithBrowser, resolveSeedUrl, resolveSeedUrlWithBrowser, defaultCaptureHandler, categorizeRequestBodyContentType } from './capture.js'
export { launchHardened } from './launch.js'
export {
  performLogin,
  checkAuthStillValid,
  normalizeForComparison,
  LoginFailedError,
  AuthExpiredError,
  AuthWallError,
  SeedAuthenticationError,
  type LoginCredentials,
  type StorageState,
  type StorageStateCookie,
} from './auth.js'
import { capturePage } from './capture.js'
export default capturePage
