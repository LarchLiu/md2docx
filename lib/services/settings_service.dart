import 'package:shared_preferences/shared_preferences.dart';

/// Service for persisting user settings
class SettingsService {
  static const String _keyTheme = 'theme';
  static const String _keyFontSize = 'fontSize';
  static const String _keyHrPageBreak = 'hrPageBreak';
  static const String _keyLocale = 'locale';
  static const String _keySupportMermaid = 'supportMermaid';
  static const String _keySupportVega = 'supportVega';
  static const String _keySupportVegaLite = 'supportVegaLite';
  static const String _keySupportDot = 'supportDot';
  static const String _keySupportInfographic = 'supportInfographic';

  SharedPreferences? _prefs;

  /// Initialize the settings service
  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // Theme
  String get theme => _prefs?.getString(_keyTheme) ?? 'default';
  set theme(String value) => _prefs?.setString(_keyTheme, value);

  // Font size
  int get fontSize => _prefs?.getInt(_keyFontSize) ?? 16;
  set fontSize(int value) => _prefs?.setInt(_keyFontSize, value);

  // HR as page break in DOCX export
  bool get hrPageBreak => _prefs?.getBool(_keyHrPageBreak) ?? true;
  set hrPageBreak(bool value) => _prefs?.setBool(_keyHrPageBreak, value);

  // Locale
  String get locale => _prefs?.getString(_keyLocale) ?? 'system';
  set locale(String value) => _prefs?.setString(_keyLocale, value);

  // Supported file extensions
  bool get supportMermaid => _prefs?.getBool(_keySupportMermaid) ?? true;
  set supportMermaid(bool value) => _prefs?.setBool(_keySupportMermaid, value);

  bool get supportVega => _prefs?.getBool(_keySupportVega) ?? true;
  set supportVega(bool value) => _prefs?.setBool(_keySupportVega, value);

  bool get supportVegaLite => _prefs?.getBool(_keySupportVegaLite) ?? true;
  set supportVegaLite(bool value) => _prefs?.setBool(_keySupportVegaLite, value);

  bool get supportDot => _prefs?.getBool(_keySupportDot) ?? true;
  set supportDot(bool value) => _prefs?.setBool(_keySupportDot, value);

  bool get supportInfographic => _prefs?.getBool(_keySupportInfographic) ?? true;
  set supportInfographic(bool value) => _prefs?.setBool(_keySupportInfographic, value);

  /// Get list of allowed file extensions based on settings
  List<String> get allowedExtensions {
    final extensions = ['md', 'markdown'];
    if (supportMermaid) extensions.add('mermaid');
    if (supportVega) extensions.add('vega');
    if (supportVegaLite) {
      extensions.add('vl');
      extensions.add('vega-lite');
    }
    if (supportDot) extensions.add('gv');
    if (supportInfographic) extensions.add('infographic');
    return extensions;
  }

  /// Get all settings as a map
  Map<String, dynamic> toMap() {
    return {
      'theme': theme,
      'fontSize': fontSize,
      'hrPageBreak': hrPageBreak,
      'locale': locale,
      'supportMermaid': supportMermaid,
      'supportVega': supportVega,
      'supportVegaLite': supportVegaLite,
      'supportDot': supportDot,
      'supportInfographic': supportInfographic,
    };
  }
}

/// Global settings service instance
final settingsService = SettingsService();
