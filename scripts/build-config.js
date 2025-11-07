// Shared build configuration for esbuild
import fs from 'fs';
import path from 'path';

export const createBuildConfig = () => {
  const config = {
    entryPoints: {
      'content-detector': 'src/content-detector.js',
      'content': 'src/content.js',
      'background': 'src/background.js',
      'popup': 'src/popup.js',
      'offscreen': 'src/offscreen.js',
      'styles': 'src/styles.css'
    },
    bundle: true,
    outdir: 'dist',
    format: 'iife', // Use IIFE for Chrome extension content scripts
    target: ['chrome120'], // Target modern Chrome
    treeShaking: true,
    // Define globals
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    loader: {
      '.css': 'css', // Load CSS files properly to handle @import
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.eot': 'file'
    },
    assetNames: '[name]', // Use original filename without hash
    minify: true,
    sourcemap: false,
    plugins: [
      // Plugin to copy static files and create complete extension
      {
        name: 'create-complete-extension',
        setup(build) {
          build.onEnd(() => {
            try {
              // 1. Copy manifest.json from src/ to dist/
              if (fs.existsSync('src/manifest.json')) {
                fs.copyFileSync('src/manifest.json', 'dist/manifest.json');
                console.log('📄 Copied manifest.json from src/');
              }
              
              // 2. Copy icons to dist/
              if (fs.existsSync('icons')) {
                const iconsDir = 'dist/icons';
                if (!fs.existsSync(iconsDir)) {
                  fs.mkdirSync(iconsDir, { recursive: true });
                }
                const iconFiles = fs.readdirSync('icons');
                for (const iconFile of iconFiles) {
                  fs.copyFileSync(path.join('icons', iconFile), path.join(iconsDir, iconFile));
                }
                console.log('📄 Copied icons/');
              }
              
              // 3. Copy popup HTML files to dist/
              if (fs.existsSync('src/popup.html')) {
                fs.copyFileSync('src/popup.html', 'dist/popup.html');
              }
              
              // 4. Copy offscreen HTML files to dist/
              if (fs.existsSync('src/offscreen.html')) {
                fs.copyFileSync('src/offscreen.html', 'dist/offscreen.html');
              }
              
              // 5. Copy JavaScript libraries for offscreen document
              const libFiles = [
                { src: 'node_modules/html2canvas/dist/html2canvas.min.js', dest: 'dist/html2canvas.min.js' }
              ];
              
              for (const { src, dest } of libFiles) {
                if (fs.existsSync(src)) {
                  const destDir = path.dirname(dest);
                  if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                  }
                  fs.copyFileSync(src, dest);
                }
              }
              console.log('📄 Copied JavaScript libraries');
              
              // 6. Copy and fix font paths in styles.css (includes KaTeX CSS import)
              const stylesCssSource = 'dist/styles.css'; // This will be processed by esbuild first
              
              // Read the built styles.css and fix font paths
              if (fs.existsSync(stylesCssSource)) {
                let stylesContent = fs.readFileSync(stylesCssSource, 'utf8');
                // Replace KaTeX font paths with extension resource URLs
                stylesContent = stylesContent.replace(
                  /url\("\.\/KaTeX_([^"]+)"\)/g, 
                  'url("chrome-extension://__MSG_@@extension_id__/fonts/KaTeX_$1")'
                );
                fs.writeFileSync(stylesCssSource, stylesContent);
                console.log('📄 Fixed font paths in styles.css');
              }
              
              // Copy KaTeX fonts to dist/fonts/
              const katexFontsSource = 'node_modules/katex/dist/fonts';
              const katexFontsDest = 'dist/fonts';
              
              if (fs.existsSync(katexFontsSource)) {
                if (!fs.existsSync(katexFontsDest)) {
                  fs.mkdirSync(katexFontsDest, { recursive: true });
                }
                const fontFiles = fs.readdirSync(katexFontsSource);
                for (const fontFile of fontFiles) {
                  fs.copyFileSync(
                    path.join(katexFontsSource, fontFile), 
                    path.join(katexFontsDest, fontFile)
                  );
                }
                console.log('📄 Copied KaTeX fonts');
              }
              
              console.log('✅ Complete extension created in dist/');
              console.log('🎯 Ready for Chrome: chrome://extensions/ → Load unpacked → select dist/');
            } catch (error) {
              console.error('Error creating complete extension:', error.message);
            }
          });
        }
      }
    ]
  };

  return config;
};
