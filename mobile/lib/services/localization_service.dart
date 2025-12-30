import 'dart:convert';
import 'dart:ui';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Localization service that loads translations from WebView's _locales
class LocalizationService {
  static final LocalizationService _instance = LocalizationService._internal();
  factory LocalizationService() => _instance;
  LocalizationService._internal();

  static const String _prefKey = 'selected_locale';

  Map<String, String> _messages = {};
  String _currentLocale = 'en';
  String? _userSelectedLocale; // null means auto (system locale)
  bool _initialized = false;

  List<String> _supportedLocales = const [];
  final Map<String, String> _localeNames = {};

  /// Supported locales (ordered) loaded from build/mobile/_locales/registry.json
  List<String> get supportedLocales => _supportedLocales;

  /// Get locale display name (native) from registry
  String getLocaleDisplayName(String localeCode) =>
      _localeNames[localeCode] ?? localeCode;

  /// Note: Do NOT keep a hardcoded locale mapping list.
  /// We resolve system locale dynamically based on _supportedLocales loaded from registry.json.

  /// Get current locale
  String get currentLocale => _currentLocale;

  /// Get user selected locale (null means auto)
  String? get userSelectedLocale => _userSelectedLocale;

  /// Check if using auto locale
  bool get isAutoLocale => _userSelectedLocale == null;

  /// Check if initialized
  bool get isInitialized => _initialized;

  /// Initialize with saved or system locale
  Future<void> init() async {
    if (_initialized) return;

    await _loadLocaleRegistry();

    // Load saved preference
    final prefs = await SharedPreferences.getInstance();
    _userSelectedLocale = prefs.getString(_prefKey);

    String localeCode;
    if (_userSelectedLocale != null) {
      // Use saved locale
      localeCode = _userSelectedLocale!;
    } else {
      // Use system locale
      localeCode = _getSystemLocale();
    }

    await _loadLocale(localeCode);
    _initialized = true;
  }

  Future<void> _loadLocaleRegistry() async {
    try {
      final jsonString = await rootBundle.loadString(
        'build/mobile/_locales/registry.json',
      );
      final Map<String, dynamic> data = jsonDecode(jsonString);

      final locales = (data['locales'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();

      _supportedLocales = locales
          .map((e) => (e['code'] as String?)?.trim())
          .whereType<String>()
          .where((e) => e.isNotEmpty)
          .toList(growable: false);

      _localeNames.clear();
      for (final entry in locales) {
        final code = (entry['code'] as String?)?.trim();
        final name = (entry['name'] as String?)?.trim();
        if (code != null && code.isNotEmpty && name != null && name.isNotEmpty) {
          _localeNames[code] = name;
        }
      }

      if (_supportedLocales.isEmpty) {
        _supportedLocales = const ['en'];
      }
    } catch (_) {
      // Fallback to a minimal set if registry is missing.
      _supportedLocales = const ['en'];
      _localeNames.clear();
      _localeNames['en'] = 'English';
    }
  }

  /// Get system locale code
  String _getSystemLocale() {
    final systemLocale = PlatformDispatcher.instance.locale;
    final languageCode = systemLocale.languageCode;
    final countryCode = systemLocale.countryCode?.toUpperCase();

    // Handle Chinese variants (zh_TW for TW/HK/MO, zh_CN for others)
    if (languageCode == 'zh') {
      if (countryCode == 'TW' || countryCode == 'HK' || countryCode == 'MO') {
        return 'zh_TW';
      }
      return 'zh_CN';
    }

    // Handle Portuguese variants (pt_PT for Portugal, pt_BR for others)
    if (languageCode == 'pt') {
      if (countryCode == 'PT') {
        return 'pt_PT';
      }
      return 'pt_BR';
    }

    // Try exact match first: language_COUNTRY
    if (countryCode != null && countryCode.isNotEmpty) {
      final exact = '${languageCode}_$countryCode';
      if (_supportedLocales.contains(exact)) {
        return exact;
      }
    }

    // Then try language only
    if (_supportedLocales.contains(languageCode)) {
      return languageCode;
    }
    return 'en';
  }

  /// Change locale (null for auto/system locale)
  Future<void> setLocale(String? localeCode) async {
    final prefs = await SharedPreferences.getInstance();
    
    if (localeCode == null) {
      // Auto mode - use system locale
      await prefs.remove(_prefKey);
      _userSelectedLocale = null;
      await _loadLocale(_getSystemLocale());
    } else {
      // Manual selection
      await prefs.setString(_prefKey, localeCode);
      _userSelectedLocale = localeCode;
      await _loadLocale(localeCode);
    }
  }

  /// Load a specific locale
  Future<void> _loadLocale(String localeCode) async {
    try {
      if (_supportedLocales.isNotEmpty && !_supportedLocales.contains(localeCode)) {
        localeCode = 'en';
      }
      final jsonString = await rootBundle.loadString(
        'build/mobile/_locales/$localeCode/messages.json',
      );
      final Map<String, dynamic> data = jsonDecode(jsonString);

      _messages = {};
      for (final entry in data.entries) {
        if (entry.value is Map && entry.value['message'] != null) {
          _messages[entry.key] = entry.value['message'] as String;
        }
      }
      _currentLocale = localeCode;
    } catch (e) {
      // Fallback to English if locale not found
      if (localeCode != 'en') {
        await _loadLocale('en');
      }
    }
  }

  /// Translate a key with optional substitutions
  /// Substitutions use {0}, {1}, etc. placeholders
  String translate(String key, [List<String>? substitutions]) {
    String message = _messages[key] ?? key;

    if (substitutions != null) {
      for (int i = 0; i < substitutions.length; i++) {
        message = message.replaceAll('{$i}', substitutions[i]);
      }
    }

    return message;
  }

  /// Shorthand for translate
  String t(String key, [List<String>? substitutions]) =>
      translate(key, substitutions);
}

/// Global instance for easy access
final localization = LocalizationService();
