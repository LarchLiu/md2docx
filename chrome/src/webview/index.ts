/**
 * Platform Entry Point
 * 
 * This module initializes and exports the platform API instance.
 * Import this module to get the platform-specific implementation.
 */

import { chromePlatform, ChromePlatformAPI } from './api-impl';
import type { PlatformAPI } from '../../../src/types/index';

// Extend globalThis type
declare global {
  var platform: PlatformAPI;
}

// Set global platform instance
// This allows other modules to access platform services without importing
globalThis.platform = chromePlatform;

// Export for explicit imports
export default chromePlatform;
export { chromePlatform as platform };
