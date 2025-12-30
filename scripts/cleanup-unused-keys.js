#!/usr/bin/env node

/**
 * Automatically detect and remove unused translation keys from all locale files
 */

import fs from 'fs';
import path from 'path';
import { findI18nKeysInCode } from './shared/find-i18n-keys-in-code.js';

const LOCALES_DIR = path.join(import.meta.dirname, '../src/_locales');

// Get all locale directories
function getLocaleDirs() {
  return fs.readdirSync(LOCALES_DIR)
    .filter(file => {
      const fullPath = path.join(LOCALES_DIR, file);
      return fs.statSync(fullPath).isDirectory() && file !== 'node_modules';
    })
    .sort();
}

// Load messages.json from a locale directory
function loadMessages(locale) {
  const messagesPath = path.join(LOCALES_DIR, locale, 'messages.json');
  try {
    const content = fs.readFileSync(messagesPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading ${locale}/messages.json:`, error.message);
    return null;
  }
}

// Find all translation key references in source code
function findKeysInCode() {
  return findI18nKeysInCode().all;
}

// Detect unused keys
function detectUnusedKeys() {
  const locales = getLocaleDirs();
  const allKeys = new Set();
  
  // Collect all defined keys
  locales.forEach(locale => {
    const messages = loadMessages(locale);
    if (messages) {
      Object.keys(messages).forEach(key => allKeys.add(key));
    }
  });
  
  // Find keys used in code
  const usedKeys = findKeysInCode();
  
  // Find potentially unused keys
  const potentiallyUnused = Array.from(allKeys).filter(key => !usedKeys.has(key));

  // Intentionally do NOT use full-text fallback.
  return potentiallyUnused;
}

// Remove unused keys from a locale
function cleanupLocale(locale, unusedKeys) {
  const messagesPath = path.join(LOCALES_DIR, locale, 'messages.json');
  
  try {
    const content = fs.readFileSync(messagesPath, 'utf8');
    const messages = JSON.parse(content);
    
    let removedCount = 0;
    
    // Remove unused keys
    unusedKeys.forEach(key => {
      if (messages[key]) {
        delete messages[key];
        removedCount++;
      }
    });
    
    if (removedCount > 0) {
      // Write back with proper formatting
      const updatedContent = JSON.stringify(messages, null, 2) + '\n';
      fs.writeFileSync(messagesPath, updatedContent, 'utf8');
    }
    
    console.log(`  ${locale}: removed ${removedCount} keys`);
    return removedCount;
    
  } catch (error) {
    console.error(`  ❌ Error processing ${locale}:`, error.message);
    return 0;
  }
}

function main() {
  console.log('🔍 Detecting unused translation keys...\n');
  
  const unusedKeys = detectUnusedKeys();
  
  if (unusedKeys.length === 0) {
    console.log('✅ No unused keys found. All keys are in use.\n');
    return;
  }
  
  console.log(`Found ${unusedKeys.length} unused key(s):`);
  unusedKeys.forEach(key => console.log(`  - ${key}`));
  console.log();
  
  console.log('🧹 Removing unused keys from all locales...\n');
  
  const locales = getLocaleDirs();
  let totalRemoved = 0;
  
  locales.forEach(locale => {
    totalRemoved += cleanupLocale(locale, unusedKeys);
  });
  
  console.log(`\n✨ Cleanup complete! Removed ${totalRemoved} key(s) total.`);
  console.log('\n💡 Run "node scripts/check-missing-keys.js" to verify.');
}

main();
