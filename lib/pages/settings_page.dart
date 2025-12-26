import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'dart:convert';
import '../services/cache_service.dart';
import '../services/localization_service.dart';
import '../services/settings_service.dart';
import '../services/theme_asset_service.dart';
import '../services/theme_registry_service.dart';
import '../widgets/theme_picker.dart';

/// Settings page for the app
class SettingsPage extends StatefulWidget {
  final WebViewController? webViewController;

  const SettingsPage({
    super.key,
    this.webViewController,
  });

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  bool _clearingCache = false;
  bool _loadingStats = false;
  String _cacheSize = '';
  int _cacheCount = 0;

  @override
  void initState() {
    super.initState();
    _loadCacheStats();
  }

  Future<void> _loadCacheStats() async {
    setState(() {
      _loadingStats = true;
    });

    try {
      // Get stats directly from Flutter cache service
      final stats = await cacheService.getStats();
      
      if (mounted) {
        setState(() {
          _cacheSize = '${stats.totalSizeMB} MB';
          _cacheCount = stats.itemCount;
        });
      }
    } catch (e) {
      debugPrint('[Settings] Failed to load cache stats: $e');
      if (mounted) {
        setState(() {
          _cacheSize = '';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loadingStats = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(localization.t('tab_settings')),
      ),
      body: ListView(
        children: [
          // Interface section
          _SectionHeader(title: localization.t('settings_interface_title')),
          ListTile(
            leading: const Icon(Icons.palette_outlined),
            title: Text(localization.t('theme')),
            subtitle: Text(_getCurrentThemeDisplayName()),
            trailing: const Icon(Icons.chevron_right),
            onTap: _pickTheme,
          ),
          ListTile(
            leading: const Icon(Icons.language_outlined),
            title: Text(localization.t('language')),
            subtitle: Text(_getCurrentLanguageDisplayName()),
            trailing: const Icon(Icons.chevron_right),
            onTap: _pickLanguage,
          ),
          const Divider(),

          // Display section
          _SectionHeader(title: localization.t('settings_general_title')),
          _FontSizeTile(
            fontSize: settingsService.fontSize,
            onChanged: (size) {
              setState(() {
                settingsService.fontSize = size;
              });
              _applyFontSize(size);
            },
          ),
          _SwitchTile(
            title: localization.t('mobile_settings_soft_line_breaks_title'),
            subtitle: localization.t('mobile_settings_soft_line_breaks_desc'),
            value: settingsService.lineBreaks,
            onChanged: (value) {
              setState(() {
                settingsService.lineBreaks = value;
              });
              _applyLineBreaks(value);
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.cleaning_services_outlined),
            title: Text(localization.t('cache_clear')),
            subtitle: Text(
              '${localization.t('cache_stat_size_label')}: ${_loadingStats ? '…' : (_cacheSize.isEmpty ? '…' : _cacheSize)}\n'
              '${localization.t('cache_stat_item_label')}: $_cacheCount',
            ),
            trailing: _clearingCache
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.chevron_right),
            onTap: _clearingCache ? null : _clearCache,
          ),
        ],
      ),
    );
  }

  Future<void> _applyFontSize(int size) async {
    final controller = widget.webViewController;
    if (controller == null) return;

    try {
      await controller.runJavaScript(
        "if(window.setFontSize){window.setFontSize($size);}",
      );
    } catch (e) {
      debugPrint('[Settings] Failed to apply font size: $e');
    }
  }

  Future<void> _applyLineBreaks(bool enabled) async {
    final controller = widget.webViewController;
    if (controller == null) return;

    try {
      await controller.runJavaScript(
        "if(window.setLineBreaks){window.setLineBreaks($enabled);}",
      );
    } catch (e) {
      debugPrint('[Settings] Failed to apply line breaks: $e');
    }
  }

  Future<void> _clearCache() async {
    setState(() {
      _clearingCache = true;
    });

    try {
      // Clear Flutter cache service directly
      await cacheService.clear();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(localization.t('cache_clear_success'))),
        );
        // Refresh stats after clearing
        await _loadCacheStats();
      }
    } catch (e) {
      debugPrint('[Settings] Failed to clear cache: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(localization.t('cache_clear_failed'))),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _clearingCache = false;
        });
      }
    }
  }

  String _getCurrentThemeDisplayName() {
    final currentTheme = settingsService.theme;
    final useChinese = themeRegistry.useChineseNames;
    final theme = themeRegistry.themes
        .where((t) => t.id == currentTheme)
        .cast<dynamic?>()
        .firstWhere((t) => t != null, orElse: () => null);
    if (theme == null) return currentTheme;

    final zhName = (theme as dynamic).displayNameZh as String?;
    final enName = (theme as dynamic).displayName as String?;
    return (useChinese ? (zhName ?? enName) : (enName ?? zhName)) ?? currentTheme;
  }

  Future<void> _pickTheme() async {
    final selectedTheme = await ThemePicker.show(context, settingsService.theme);
    if (!mounted) return;
    if (selectedTheme == null || selectedTheme == settingsService.theme) return;

    settingsService.theme = selectedTheme;
    setState(() {});

    final controller = widget.webViewController;
    if (controller == null) return;

    try {
      final themeData = await themeAssetService.getCompleteThemeData(selectedTheme);
      final json = jsonEncode(themeData);
      final escaped = json.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
      await controller.runJavaScript(
        "if(window.applyThemeData){window.applyThemeData('$escaped');}",
      );
    } catch (e) {
      debugPrint('[Settings] Failed to apply theme: $e');
    }
  }

  String _getCurrentLanguageDisplayName() {
    // Same mapping used in the main menu picker
    const localeKeyMap = {
      'da': 'settings_language_da',
      'de': 'settings_language_de',
      'en': 'settings_language_en',
      'es': 'settings_language_es',
      'fi': 'settings_language_fi',
      'fr': 'settings_language_fr',
      'hi': 'settings_language_hi',
      'id': 'settings_language_id',
      'it': 'settings_language_it',
      'ja': 'settings_language_ja',
      'ko': 'settings_language_ko',
      'nl': 'settings_language_nl',
      'no': 'settings_language_no',
      'pl': 'settings_language_pl',
      'pt_BR': 'settings_language_pt_br',
      'pt_PT': 'settings_language_pt_pt',
      'ru': 'settings_language_ru',
      'sv': 'settings_language_sv',
      'th': 'settings_language_th',
      'tr': 'settings_language_tr',
      'vi': 'settings_language_vi',
      'zh_CN': 'settings_language_zh_cn',
      'zh_TW': 'settings_language_zh_tw',
    };

    final selected = localization.userSelectedLocale;
    if (selected == null) {
      return localization.t('mobile_settings_language_auto');
    }
    final key = localeKeyMap[selected] ?? 'settings_language_en';
    return localization.t(key);
  }

  void _pickLanguage() {
    // Locale code to translation key mapping
    const localeKeyMap = {
      'da': 'settings_language_da',
      'de': 'settings_language_de',
      'en': 'settings_language_en',
      'es': 'settings_language_es',
      'fi': 'settings_language_fi',
      'fr': 'settings_language_fr',
      'hi': 'settings_language_hi',
      'id': 'settings_language_id',
      'it': 'settings_language_it',
      'ja': 'settings_language_ja',
      'ko': 'settings_language_ko',
      'nl': 'settings_language_nl',
      'no': 'settings_language_no',
      'pl': 'settings_language_pl',
      'pt_BR': 'settings_language_pt_br',
      'pt_PT': 'settings_language_pt_pt',
      'ru': 'settings_language_ru',
      'sv': 'settings_language_sv',
      'th': 'settings_language_th',
      'tr': 'settings_language_tr',
      'vi': 'settings_language_vi',
      'zh_CN': 'settings_language_zh_cn',
      'zh_TW': 'settings_language_zh_tw',
    };

    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                localization.t('language'),
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  RadioListTile<String?>(
                    title: Text(localization.t('mobile_settings_language_auto')),
                    value: null,
                    groupValue: localization.userSelectedLocale,
                    onChanged: (value) async {
                      await localization.setLocale(null);
                      if (mounted) {
                        Navigator.pop(context);
                        setState(() {});
                        final controller = widget.webViewController;
                        if (controller != null) {
                          controller.runJavaScript(
                            "if(window.setLocale){window.setLocale('${localization.currentLocale}');}",
                          );
                        }
                      }
                    },
                  ),
                  const Divider(height: 1),
                  ...LocalizationService.supportedLocales.map((locale) {
                    final key = localeKeyMap[locale] ?? 'settings_language_en';
                    return RadioListTile<String?>(
                      title: Text(localization.t(key)),
                      value: locale,
                      groupValue: localization.userSelectedLocale,
                      onChanged: (value) async {
                        if (value == null) return;
                        await localization.setLocale(value);
                        if (mounted) {
                          Navigator.pop(context);
                          setState(() {});
                          final controller = widget.webViewController;
                          if (controller != null) {
                            controller.runJavaScript(
                              "if(window.setLocale){window.setLocale('$value');}",
                            );
                          }
                        }
                      },
                    );
                  }),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _FontSizeTile extends StatelessWidget {
  final int fontSize;
  final void Function(int) onChanged;

  const _FontSizeTile({
    required this.fontSize,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.format_size),
      title: Text(localization.t('zoom')),
      subtitle: Text('$fontSize pt'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.remove_circle_outline),
            onPressed: fontSize > 12 ? () => onChanged(fontSize - 1) : null,
          ),
          SizedBox(
            width: 40,
            child: Text(
              '$fontSize',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: fontSize < 24 ? () => onChanged(fontSize + 1) : null,
          ),
        ],
      ),
    );
  }
}

class _SwitchTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool value;
  final void Function(bool) onChanged;

  const _SwitchTile({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      secondary: const Icon(Icons.wrap_text),
      title: Text(title),
      subtitle: Text(subtitle),
      value: value,
      onChanged: onChanged,
    );
  }
}
