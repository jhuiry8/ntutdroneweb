import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { renderLandingPage, renderAdminDashboard, renderLogin } from '../src/templates.js';

test('PWA & Mobile Ready test suite', async (t) => {
    await t.test('manifest.webmanifest and manifest.json exist and contain required PWA fields', () => {
        assert.ok(existsSync('public/manifest.webmanifest'), 'manifest.webmanifest must exist');
        assert.ok(existsSync('public/manifest.json'), 'manifest.json must exist');

        const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
        assert.equal(manifest.name, '北科無人機社 | NTUT Drone Club');
        assert.equal(manifest.short_name, '北科無人機');
        assert.equal(manifest.display, 'standalone');
        assert.equal(manifest.start_url, '/?source=pwa');
        assert.equal(manifest.background_color, '#0b0f19');
        assert.equal(manifest.theme_color, '#0f172a');
        assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 6, 'Should include multiple icon sizes');
        assert.ok(manifest.icons.some(i => i.sizes === '192x192'), 'Must include 192x192 icon');
        assert.ok(manifest.icons.some(i => i.sizes === '512x512'), 'Must include 512x512 icon');
        assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'Must include maskable icon');
    });

    await t.test('all generated PWA icons and apple-touch-icon exist in public directory', () => {
        const requiredIcons = [
            'public/assets/icons/icon-72x72.png',
            'public/assets/icons/icon-96x96.png',
            'public/assets/icons/icon-128x128.png',
            'public/assets/icons/icon-144x144.png',
            'public/assets/icons/icon-152x152.png',
            'public/assets/icons/icon-192x192.png',
            'public/assets/icons/icon-384x384.png',
            'public/assets/icons/icon-512x512.png',
            'public/assets/icons/apple-touch-icon.png',
            'public/assets/icons/maskable-icon-512x512.png',
            'public/apple-touch-icon.png'
        ];
        for (const iconPath of requiredIcons) {
            assert.ok(existsSync(iconPath), `Icon ${iconPath} must exist`);
        }
    });

    await t.test('sw.js exists, registers offline cache and handles navigation and static assets', () => {
        assert.ok(existsSync('public/sw.js'), 'sw.js must exist');
        assert.ok(existsSync('public/offline.html'), 'offline.html must exist');
        const sw = readFileSync('public/sw.js', 'utf8');
        assert.match(sw, /CACHE_NAME\s*=/);
        assert.match(sw, /addEventListener\('install'/);
        assert.match(sw, /addEventListener\('activate'/);
        assert.match(sw, /addEventListener\('fetch'/);
        assert.match(sw, /\/offline\.html/);
    });

    await t.test('HTML templates inject Apple iOS PWA meta tags and manifest links', () => {
        const landingHtml = renderLandingPage([], 'zh', {});
        assert.match(landingHtml, /rel="manifest"\s+href="\/manifest\.webmanifest"/);
        assert.match(landingHtml, /name="apple-mobile-web-app-capable"\s+content="yes"/);
        assert.match(landingHtml, /name="apple-mobile-web-app-status-bar-style"/);
        assert.match(landingHtml, /viewport-fit=cover/);
        assert.match(landingHtml, /mobile-bottom-nav/);

        const adminHtml = renderAdminDashboard([], [], { role: 'president' });
        assert.match(adminHtml, /rel="manifest"/);
        assert.match(adminHtml, /apple-mobile-web-app-capable/);

        const loginHtml = renderLogin();
        assert.match(loginHtml, /rel="manifest"/);
        assert.match(loginHtml, /apple-mobile-web-app-capable/);
    });

    await t.test('index.html contains mobile app showcase, PWA modal and bottom navigation', () => {
        const indexHtml = readFileSync('index.html', 'utf8');
        assert.match(indexHtml, /id="mobile-app"/);
        assert.match(indexHtml, /id="pwa-install-modal"/);
        assert.match(indexHtml, /mobile-bottom-nav/);
        assert.match(indexHtml, /rel="manifest"/);
        assert.match(indexHtml, /apple-touch-icon/);
    });

    await t.test('Android project files and GitHub Actions workflow exist and are valid', () => {
        assert.ok(existsSync('android/app/src/main/AndroidManifest.xml'), 'AndroidManifest.xml must exist');
        assert.ok(existsSync('android/app/src/main/java/club/ntut/drone/MainActivity.java'), 'MainActivity.java must exist');
        assert.ok(existsSync('android/build.gradle'), 'Root build.gradle must exist');
        assert.ok(existsSync('android/app/build.gradle'), 'App build.gradle must exist');
        assert.ok(existsSync('android/settings.gradle'), 'settings.gradle must exist');
        assert.ok(existsSync('android/gradlew'), 'gradlew must exist');
        assert.ok(existsSync('android/gradlew.bat'), 'gradlew.bat must exist');
        assert.ok(existsSync('android/gradle/wrapper/gradle-wrapper.jar'), 'gradle-wrapper.jar must exist');
        assert.ok(existsSync('.github/workflows/android.yml'), '.github/workflows/android.yml must exist');

        const manifestXml = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
        assert.match(manifestXml, /package="club\.ntut\.drone"/);
        assert.match(manifestXml, /android\.permission\.INTERNET/);
        assert.match(manifestXml, /android:name="\.MainActivity"/);

        const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
        for (const density of densities) {
            assert.ok(existsSync(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`), `ic_launcher for ${density} must exist`);
            assert.ok(existsSync(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`), `ic_launcher_round for ${density} must exist`);
        }
    });
});

