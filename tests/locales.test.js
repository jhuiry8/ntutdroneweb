import test from 'node:test';
import assert from 'node:assert/strict';
import { locales } from '../src/locales.js';

test('Locales test suite - Traditional Chinese & English dictionaries', async (t) => {
    await t.test('should export zh and en dictionaries', () => {
        assert.ok(locales.zh, 'zh locale dictionary must exist');
        assert.ok(locales.en, 'en locale dictionary must exist');
        assert.equal(typeof locales.zh, 'object');
        assert.equal(typeof locales.en, 'object');
    });

    await t.test('should have essential navigation keys in zh and en', () => {
        const requiredNavKeys = ['navAbout', 'navFeatures', 'navBlog', 'navFaq', 'navAdmin', 'navJoin'];
        for (const key of requiredNavKeys) {
            assert.ok(locales.zh[key], `zh dictionary missing key: ${key}`);
            assert.ok(locales.en[key], `en dictionary missing key: ${key}`);
        }
    });

    await t.test('should contain target SEO keywords in Chinese dictionary', () => {
        const zhHeroDesc = locales.zh.heroDesc;
        const targetKeywords = ['北科無人機社', '北科大無人機社團', 'FPV 穿越機', '空拍機', '組裝教學', '模擬器練習'];
        
        for (const keyword of targetKeywords) {
            assert.ok(zhHeroDesc.includes(keyword), `heroDesc should contain SEO keyword: ${keyword}`);
        }
    });

    await t.test('should have matching key structure between zh and en', () => {
        const zhKeys = Object.keys(locales.zh).sort();
        const enKeys = Object.keys(locales.en).sort();
        
        // Assert all zh keys exist in en dictionary
        for (const key of zhKeys) {
            assert.ok(key in locales.en, `en locale is missing key "${key}" present in zh locale`);
        }
    });
});
