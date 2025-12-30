import 'package:flutter/material.dart';
import 'package:getwidget/getwidget.dart';
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
          GFListTile(
            avatar: GFAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(
                Icons.palette_outlined,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            titleText: localization.t('theme'),
            subTitleText: _getCurrentThemeDisplayName(),
            icon: const Icon(Icons.chevron_right),
            onTap: _pickTheme,
          ),
          GFListTile(
            avatar: GFAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(
                Icons.language_outlined,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            titleText: localization.t('language'),
            subTitleText: _getCurrentLanguageDisplayName(),
            icon: const Icon(Icons.chevron_right),
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
            title: localization.t('settings_docx_hr_page_break'),
            subtitle: localization.t('settings_docx_hr_page_break_note'),
            value: settingsService.hrPageBreak,
            onChanged: (value) {
              setState(() {
                settingsService.hrPageBreak = value;
              });
              // Settings are read via platform storage abstraction when exporting
            },
          ),
          const Divider(),

          // Supported file formats section
          _SectionHeader(title: localization.t('settings_supported_formats_title')),
          _SwitchTile(
            title: localization.t('settings_support_mermaid'),
            iconData: Icons.account_tree_outlined,
            value: settingsService.supportMermaid,
            onChanged: (value) {
              setState(() {
                settingsService.supportMermaid = value;
              });
            },
          ),
          _SwitchTile(
            title: localization.t('settings_support_vega'),
            iconData: Icons.bar_chart_outlined,
            value: settingsService.supportVega,
            onChanged: (value) {
              setState(() {
                settingsService.supportVega = value;
              });
            },
          ),
          _SwitchTile(
            title: localization.t('settings_support_vega_lite'),
            iconData: Icons.show_chart_outlined,
            value: settingsService.supportVegaLite,
            onChanged: (value) {
              setState(() {
                settingsService.supportVegaLite = value;
              });
            },
          ),
          _SwitchTile(
            title: localization.t('settings_support_dot'),
            iconData: Icons.hub_outlined,
            value: settingsService.supportDot,
            onChanged: (value) {
              setState(() {
                settingsService.supportDot = value;
              });
            },
          ),
          _SwitchTile(
            title: localization.t('settings_support_infographic'),
            iconData: Icons.info_outline,
            value: settingsService.supportInfographic,
            onChanged: (value) {
              setState(() {
                settingsService.supportInfographic = value;
              });
            },
          ),
          const Divider(),
          GFListTile(
            avatar: GFAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(
                Icons.cleaning_services_outlined,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            titleText: localization.t('cache_clear'),
            subTitleText: '${localization.t('cache_stat_size_label')}: ${_loadingStats ? '…' : (_cacheSize.isEmpty ? '…' : _cacheSize)}\n'
              '${localization.t('cache_stat_item_label')}: $_cacheCount',
            icon: _clearingCache
                ? const GFLoader(type: GFLoaderType.circle, size: GFSize.SMALL)
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
    final selected = localization.userSelectedLocale;
    if (selected == null) {
      return localization.t('mobile_settings_language_auto');
    }
    // Use display name from registry.json
    return localization.getLocaleDisplayName(selected);
  }

  void _pickLanguage() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) => _LanguagePickerSheet(
          scrollController: scrollController,
          onLocaleSelected: (locale) async {
            await localization.setLocale(locale);
            if (mounted) {
              Navigator.pop(context);
              setState(() {});
              final controller = widget.webViewController;
              if (controller != null) {
                final localeToSend = locale ?? localization.currentLocale;
                controller.runJavaScript(
                  "if(window.setLocale){window.setLocale('$localeToSend');}",
                );
              }
            }
          },
        ),
      ),
    );
  }
}

/// Language picker bottom sheet with GetWidget style
class _LanguagePickerSheet extends StatelessWidget {
  final ScrollController scrollController;
  final void Function(String?) onLocaleSelected;

  const _LanguagePickerSheet({
    required this.scrollController,
    required this.onLocaleSelected,
  });

  @override
  Widget build(BuildContext context) {
    final currentLocale = localization.userSelectedLocale;
    
    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: Theme.of(context).dividerColor),
            ),
          ),
          child: Row(
            children: [
              const Icon(Icons.language_outlined),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  localization.t('language'),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
        // Language list
        Expanded(
          child: ListView(
            controller: scrollController,
            children: [
              // Auto option
              _LanguageItem(
                title: localization.t('mobile_settings_language_auto'),
                isSelected: currentLocale == null,
                onTap: () => onLocaleSelected(null),
              ),
              const Divider(height: 1, indent: 56),
              // All supported locales
              ...localization.supportedLocales.map((locale) {
                return _LanguageItem(
                  title: localization.getLocaleDisplayName(locale),
                  isSelected: currentLocale == locale,
                  onTap: () => onLocaleSelected(locale),
                );
              }),
            ],
          ),
        ),
      ],
    );
  }
}

/// Single language item with GetWidget style
class _LanguageItem extends StatelessWidget {
  final String title;
  final bool isSelected;
  final VoidCallback onTap;

  const _LanguageItem({
    required this.title,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GFListTile(
      avatar: isSelected
          ? Icon(Icons.check, color: Theme.of(context).colorScheme.primary, size: 20)
          : const SizedBox(width: 20),
      titleText: title,
      onTap: onTap,
      selected: isSelected,
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
    return GFListTile(
      avatar: GFAvatar(
        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
        child: Icon(
          Icons.format_size,
          color: Theme.of(context).colorScheme.onPrimaryContainer,
        ),
      ),
      titleText: localization.t('zoom'),
      subTitleText: '$fontSize pt',
      icon: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: Icon(Icons.remove_circle_outline, 
              color: fontSize > 12 ? Theme.of(context).colorScheme.primary : Theme.of(context).disabledColor,
            ),
            iconSize: 28,
            onPressed: fontSize > 12 ? () => onChanged(fontSize - 1) : null,
          ),
          SizedBox(
            width: 40,
            child: Text(
              '$fontSize',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.add_circle_outline,
              color: fontSize < 24 ? Theme.of(context).colorScheme.primary : Theme.of(context).disabledColor,
            ),
            iconSize: 28,
            onPressed: fontSize < 24 ? () => onChanged(fontSize + 1) : null,
          ),
        ],
      ),
    );
  }
}

class _SwitchTile extends StatelessWidget {
  final String title;
  final String? subtitle;
  final bool value;
  final void Function(bool) onChanged;
  final IconData iconData;

  const _SwitchTile({
    required this.title,
    this.subtitle,
    required this.value,
    required this.onChanged,
    this.iconData = Icons.insert_page_break_outlined,
  });

  @override
  Widget build(BuildContext context) {
    return GFListTile(
      avatar: GFAvatar(
        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
        child: Icon(
          iconData,
          color: Theme.of(context).colorScheme.onPrimaryContainer,
        ),
      ),
      titleText: title,
      subTitleText: subtitle,
      icon: GFToggle(
        onChanged: (val) => onChanged(val ?? false),
        value: value,
        type: GFToggleType.ios,
        enabledThumbColor: Theme.of(context).colorScheme.primary,
        enabledTrackColor: Theme.of(context).colorScheme.primaryContainer,
      ),
    );
  }
}
