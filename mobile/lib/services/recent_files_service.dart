import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Model for a recently opened file
class RecentFile {
  final String path;
  final String name;
  final int lastOpened;
  final bool isCached; // Whether content is cached in app directory
  final String? cachedPath; // Path to cached content file

  RecentFile({
    required this.path,
    required this.name,
    required this.lastOpened,
    this.isCached = false,
    this.cachedPath,
  });

  factory RecentFile.fromJson(Map<String, dynamic> json) {
    return RecentFile(
      path: json['path'] as String,
      name: json['name'] as String,
      lastOpened: json['lastOpened'] as int,
      isCached: json['isCached'] as bool? ?? false,
      cachedPath: json['cachedPath'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'path': path,
      'name': name,
      'lastOpened': lastOpened,
      'isCached': isCached,
      'cachedPath': cachedPath,
    };
  }

  /// Create a copy with updated fields
  RecentFile copyWith({
    String? path,
    String? name,
    int? lastOpened,
    bool? isCached,
    String? cachedPath,
  }) {
    return RecentFile(
      path: path ?? this.path,
      name: name ?? this.name,
      lastOpened: lastOpened ?? this.lastOpened,
      isCached: isCached ?? this.isCached,
      cachedPath: cachedPath ?? this.cachedPath,
    );
  }
}

/// Service for managing recently opened files
class RecentFilesService extends ChangeNotifier {
  static const String _key = 'recent_files';
  static const int _maxItems = 20;

  SharedPreferences? _prefs;
  List<RecentFile> _files = [];
  String? _cacheDir;

  /// Initialize the service
  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    
    // Get cache directory for storing file contents
    final appDir = await getApplicationDocumentsDirectory();
    _cacheDir = '${appDir.path}/recent_files_cache';
    
    // Create cache directory if not exists
    final dir = Directory(_cacheDir!);
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    
    _load();
  }

  /// Load recent files from storage
  void _load() {
    final json = _prefs?.getString(_key);
    if (json != null) {
      try {
        final list = jsonDecode(json) as List<dynamic>;
        _files = list
            .map((item) => RecentFile.fromJson(item as Map<String, dynamic>))
            .toList();
      } catch (e) {
        _files = [];
      }
    }
  }

  /// Save recent files to storage
  Future<void> _save() async {
    final json = jsonEncode(_files.map((f) => f.toJson()).toList());
    await _prefs?.setString(_key, json);
  }

  /// Get all recent files (sorted by lastOpened, newest first)
  List<RecentFile> getAll() {
    return List.unmodifiable(_files);
  }

  /// Generate a unique cache filename
  String _generateCacheFilename(String originalName) {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final safeName = originalName.replaceAll(RegExp(r'[^\w\.]'), '_');
    return '${timestamp}_$safeName';
  }

  /// Add or update a file in the recent list, with optional content caching
  Future<void> add(String path, String name, {String? content}) async {
    String? cachedPath;
    bool isCached = false;

    // If content is provided, cache it
    if (content != null && _cacheDir != null) {
      try {
        final cacheFilename = _generateCacheFilename(name);
        cachedPath = '$_cacheDir/$cacheFilename';
        await File(cachedPath).writeAsString(content);
        isCached = true;
      } catch (e) {
        debugPrint('[RecentFilesService] Failed to cache content: $e');
        cachedPath = null;
        isCached = false;
      }
    }

    // Check if file already exists in the list
    final existingIndex = _files.indexWhere((f) => f.path == path);
    if (existingIndex != -1) {
      final existing = _files[existingIndex];
      // Delete old cached file if we're caching new content
      if (isCached && existing.cachedPath != null && existing.cachedPath != cachedPath) {
        try {
          await File(existing.cachedPath!).delete();
        } catch (e) {
          // Ignore delete errors
        }
      }
      // If not caching new content, keep existing cache
      if (!isCached && existing.isCached) {
        cachedPath = existing.cachedPath;
        isCached = existing.isCached;
      }
      _files.removeAt(existingIndex);
    }

    // Add new entry at the beginning
    _files.insert(
      0,
      RecentFile(
        path: path,
        name: name,
        lastOpened: DateTime.now().millisecondsSinceEpoch,
        isCached: isCached,
        cachedPath: cachedPath,
      ),
    );

    // Trim to max items and delete old cache files
    while (_files.length > _maxItems) {
      final removed = _files.removeLast();
      if (removed.cachedPath != null) {
        try {
          await File(removed.cachedPath!).delete();
        } catch (e) {
          // Ignore delete errors
        }
      }
    }

    await _save();
    notifyListeners();
  }

  /// Remove a file from the recent list
  Future<void> remove(String path) async {
    final index = _files.indexWhere((f) => f.path == path);
    if (index != -1) {
      final file = _files[index];
      // Delete cached content if exists
      if (file.cachedPath != null) {
        try {
          await File(file.cachedPath!).delete();
        } catch (e) {
          // Ignore delete errors
        }
      }
      _files.removeAt(index);
      await _save();
      notifyListeners();
    }
  }

  /// Remove a file and delete the original file if it's an imported file
  Future<bool> removeAndDeleteFile(String path) async {
    final index = _files.indexWhere((f) => f.path == path);
    if (index == -1) return false;

    final file = _files[index];
    bool fileDeleted = false;

    // Try to delete the original file if it's in the Imported directory
    try {
      final originalFile = File(path);
      if (await originalFile.exists()) {
        // Only delete if in Imported directory
        final appDir = await getApplicationDocumentsDirectory();
        final importedPath = '${appDir.path}/Imported';
        if (path.startsWith(importedPath)) {
          await originalFile.delete();
          fileDeleted = true;
        }
      }
    } catch (e) {
      debugPrint('[RecentFilesService] Failed to delete original file: $e');
    }

    // Delete cached content if exists
    if (file.cachedPath != null) {
      try {
        await File(file.cachedPath!).delete();
      } catch (e) {
        // Ignore delete errors
      }
    }

    _files.removeAt(index);
    await _save();
    notifyListeners();

    return fileDeleted;
  }

  /// Check if a file is an imported file (from sharing)
  Future<bool> isImportedFile(String path) async {
    try {
      final appDir = await getApplicationDocumentsDirectory();
      final importedPath = '${appDir.path}/Imported';
      return path.startsWith(importedPath);
    } catch (e) {
      return false;
    }
  }

  /// Clear all recent files
  Future<void> clear() async {
    // Delete all cached files
    for (final file in _files) {
      if (file.cachedPath != null) {
        try {
          await File(file.cachedPath!).delete();
        } catch (e) {
          // Ignore delete errors
        }
      }
    }
    _files.clear();
    await _save();
    notifyListeners();
  }

  /// Check if a file exists in recent list
  bool contains(String path) {
    return _files.any((f) => f.path == path);
  }

  /// Try to read file content, using cache if original is not accessible
  Future<String?> readContent(RecentFile file) async {
    // First try to read from original path
    try {
      final originalFile = File(file.path);
      if (await originalFile.exists()) {
        return await originalFile.readAsString();
      }
    } catch (e) {
      debugPrint('[RecentFilesService] Cannot read original file: $e');
    }

    // Fall back to cached content
    if (file.isCached && file.cachedPath != null) {
      try {
        final cachedFile = File(file.cachedPath!);
        if (await cachedFile.exists()) {
          return await cachedFile.readAsString();
        }
      } catch (e) {
        debugPrint('[RecentFilesService] Cannot read cached file: $e');
      }
    }

    return null;
  }
}

/// Global instance
final recentFilesService = RecentFilesService();
