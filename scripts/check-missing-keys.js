#!/usr/bin/env node

/**
 * Check missing translation keys across all locale files
 * and verify key usage in source code
 * Usage: node check-missing-keys.js
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

// Get all keys from a messages object
function getKeys(messages) {
  return Object.keys(messages).sort();
}

// Find all translation key references in source code
function findKeysInCode() {
  return findI18nKeysInCode();
}

// Main function
function main() {
  console.log('🔍 Checking translation keys across all locales...\n');
  
  const locales = getLocaleDirs();
  console.log(`Found locales: ${locales.join(', ')}\n`);
  
  // Load all locales and collect all keys
  const localeData = new Map();
  const allKeys = new Set();
  
  locales.forEach(locale => {
    const messages = loadMessages(locale);
    if (messages) {
      const keys = getKeys(messages);
      localeData.set(locale, new Set(keys));
      keys.forEach(key => allKeys.add(key));
    }
  });
  
  const allKeysArray = Array.from(allKeys).sort();
  console.log(`📋 Total unique keys found across all locales: ${allKeysArray.length}\n`);
  
  // Find which keys are missing in which locales
  const missingKeysMap = new Map(); // key -> Set of locales missing this key
  
  allKeysArray.forEach(key => {
    const missingLocales = new Set();
    locales.forEach(locale => {
      const keys = localeData.get(locale);
      if (keys && !keys.has(key)) {
        missingLocales.add(locale);
      }
    });
    
    if (missingLocales.size > 0) {
      missingKeysMap.set(key, missingLocales);
    }
  });
  
  // Display missing keys table
  if (missingKeysMap.size > 0) {
    console.log('❌ Missing Keys (by message key):');
    console.log('─'.repeat(80));
    
    // Only show locales that have missing keys
    const localesWithMissingKeys = new Set();
    missingKeysMap.forEach((localesSet) => {
      localesSet.forEach(locale => localesWithMissingKeys.add(locale));
    });
    
    const relevantLocales = Array.from(localesWithMissingKeys).sort();
    
    if (relevantLocales.length > 0) {
      const missingTable = {};
      missingKeysMap.forEach((localesSet, key) => {
        const row = { Key: key };
        relevantLocales.forEach(locale => {
          row[locale] = localesSet.has(locale) ? '❌' : '✅';
        });
        missingTable[key] = row;
      });
      
      console.table(Object.values(missingTable));
      console.log(`\nShowing ${relevantLocales.length} locale(s) with missing keys: ${relevantLocales.join(', ')}`);
    }

    console.log('\n🛠️  Suggested action:');
    console.log('  - Batch fix with: node scripts/update-locale-keys.js');
    console.log('  - Add missing key(s) to scripts/i18n/update-locale-keys.json (keys + translations; no English placeholders).');
    console.log('  - Re-check: node scripts/check-missing-keys.js');
  }
  
  if (missingKeysMap.size === 0) {
    console.log('\n🎉 All locales are complete and synchronized!\n');
  } else {
    console.log(`\n⚠️  Found ${missingKeysMap.size} key(s) with missing translations.\n`);
  }
  
  // Check for unused and undefined keys
  console.log('\n📝 Checking key usage in source code...\n');
  
  const usedKeys = findKeysInCode();
  console.log(`Found ${usedKeys.all.size} unique keys used in source code:`);
  console.log(`  - ${usedKeys.inJS.size} keys in JavaScript files`);
  console.log(`  - ${usedKeys.inHTML.size} keys in HTML files`);
  console.log(`  - ${usedKeys.inDart.size} keys in Flutter/Dart files\n`);
  
  // Keys defined but not used
  const definedKeys = allKeysArray;
  const unusedKeys = definedKeys.filter(key => !usedKeys.all.has(key));

  // NOTE: We intentionally do NOT use full-text search for "unused" detection.
  // Only real i18n call-sites are considered usage, to avoid false positives like
  // common tokens (e.g. action values such as 'remove').
  const trulyUnusedKeys = unusedKeys;

  if (trulyUnusedKeys.length > 0) {
    console.log('⚠️  Keys defined in messages.json but NOT used in code:');
    console.log('─'.repeat(80));
    
    // Build table showing which locales have these unused keys
    // Only show locales that have at least one of these keys
    const localesWithUnusedKeys = new Set();
    trulyUnusedKeys.forEach(key => {
      locales.forEach(locale => {
        const keys = localeData.get(locale);
        if (keys && keys.has(key)) {
          localesWithUnusedKeys.add(locale);
        }
      });
    });
    
    const relevantLocales = Array.from(localesWithUnusedKeys).sort();
    
    if (relevantLocales.length > 0) {
      const unusedTable = {};
      trulyUnusedKeys.forEach(key => {
        const row = { Key: key };
        relevantLocales.forEach(locale => {
          const keys = localeData.get(locale);
          row[locale] = keys && keys.has(key) ? '✅' : '❌';
        });
        unusedTable[key] = row;
      });
      
      console.table(Object.values(unusedTable));
      console.log(`\nShowing ${relevantLocales.length} locale(s) with unused keys: ${relevantLocales.join(', ')}`);
    }
    console.log(`Total unused keys: ${trulyUnusedKeys.length}\n`);

    console.log('🛠️  Suggested action:');
    console.log('  - Clean up with: node scripts/cleanup-unused-keys.js');
    console.log('  - Re-check: node scripts/check-missing-keys.js\n');
  } else if (unusedKeys.length === 0) {
    console.log('✅ All defined keys are used in code.\n');
  }
  
  // Keys used but not defined
  const undefinedKeys = Array.from(usedKeys.all).filter(key => !allKeys.has(key));
  
  if (undefinedKeys.length > 0) {
    console.log('❌ Keys used in code but NOT defined in messages.json:');
    console.log('─'.repeat(80));
    undefinedKeys.forEach(key => {
      console.log(`  ⚠️  ${key}`);
    });
    console.log(`\nTotal undefined keys: ${undefinedKeys.length}\n`);

    const localesNeedingTranslations = locales.filter(l => l !== 'en').sort();
    console.log('🛠️  Suggested action:');
    console.log('  - Fix with: node scripts/update-locale-keys.js');
    console.log('  - Add each key to scripts/i18n/update-locale-keys.json, then provide translations for locales:');
    console.log(`    ${localesNeedingTranslations.join(', ')}`);
    console.log('  - Re-check: node scripts/check-missing-keys.js\n');
  } else {
    console.log('✅ All used keys are defined in messages.json.\n');
  }
  
  // Summary
  console.log('═'.repeat(80));
  console.log('📊 Summary:');
  console.log(`  • Total keys defined: ${definedKeys.length}`);
  console.log(`  • Total keys used in code: ${usedKeys.all.size}`);
  console.log(`  • Unused keys: ${trulyUnusedKeys.length}`);
  console.log(`  • Undefined keys: ${undefinedKeys.length}`);
  console.log(`  • Missing translations: ${missingKeysMap.size}`);
  console.log('═'.repeat(80) + '\n');
}

// Run the script
main();
