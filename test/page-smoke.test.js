'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

test('页面关键 DOM 和脚本加载顺序完整', () => {
    const html = read('index.html');
    const requiredIds = [
        'dateButtons', 'industryChart', 'conceptChart', 'leaderContent', 'focusContent',
        'modalOverlay', 'trendModalOverlay', 'stockPanelList', 'loadStatus'
    ];
    for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`));

    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1].split('?')[0]);
    const expected = ['chart.umd.min.js', 'config.js', 'stock-utils.js', 'calc.js', 'data.js', 'charts.js', 'leaders.js', 'modals.js', 'app.js'];
    let previous = -1;
    for (const script of expected) {
        const index = scripts.indexOf(script);
        assert.ok(index > previous, `${script} 加载顺序错误或缺失`);
        previous = index;
    }
});

test('页面不再包含内联事件处理器', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('原页面日期选择仅展示最近10日并彻底隐藏滚动条', () => {
    const html = read('index.html');
    const config = read('config.js');
    const data = read('data.js');
    const css = read('style.css');
    const app = read('app.js');
    assert.match(html, /style\.css\?v=20260729-0930/);
    assert.match(html, /app\.js\?v=20260729-0930/);
    assert.match(html, /id="dateButtons" style="overflow:hidden;scrollbar-width:none;"/);
    assert.match(config, /const DATE_BUTTON_LIMIT = 10;/);
    assert.match(data, /sorted\.slice\(-DATE_BUTTON_LIMIT\)/);
    const selectorRule = css.match(/\.date-selector\s*\{([\s\S]*?)\}/)?.[1] || '';
    const legacyButtonsRule = css.match(/\.date-buttons\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.match(selectorRule, /display:\s*grid/);
    assert.match(selectorRule, /grid-template-columns:\s*repeat\(10, minmax\(0, 1fr\)\)/);
    assert.match(selectorRule, /overflow:\s*hidden/);
    assert.match(selectorRule, /scrollbar-width:\s*none/);
    assert.match(css, /\.date-selector::-webkit-scrollbar\s*\{\s*display:\s*none/);
    assert.match(app, /dateButtons\.style\.overflow = 'hidden'/);
    assert.match(app, /dateButtons\.style\.scrollbarWidth = 'none'/);
    assert.match(legacyButtonsRule, /overflow:\s*visible/);
    assert.doesNotMatch(legacyButtonsRule, /overflow-x:\s*auto|scrollbar-width/);
});

test('原页面包含可编辑、可拖动并持久化的悬浮便签', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('style.css');

    for (const id of ['floatingNote', 'floatingNoteHandle', 'floatingNoteText', 'floatingNoteToggle', 'floatingNoteStatus']) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /style\.css\?v=20260729-0930/);
    assert.match(html, /app\.js\?v=20260729-0930/);
    assert.match(app, /const FLOATING_NOTE_STORAGE_KEY = 'floatingNoteV1'/);
    assert.match(app, /function initFloatingNote\(\)/);
    assert.match(app, /localStorage\.getItem\(FLOATING_NOTE_STORAGE_KEY\)/);
    assert.match(app, /localStorage\.setItem\(FLOATING_NOTE_STORAGE_KEY/);
    assert.match(app, /handle\.addEventListener\('pointerdown'/);
    assert.match(app, /handle\.addEventListener\('pointermove'/);
    assert.match(app, /handle\.addEventListener\('pointerup'/);
    assert.match(app, /textarea\.addEventListener\('input'/);
    assert.match(app, /initFloatingNote\(\);/);
    assert.match(css, /\.floating-note\s*\{[\s\S]*?position:\s*fixed/);
    assert.match(css, /\.floating-note\.collapsed/);
    assert.match(css, /touch-action:\s*none/);
});

test('list.json 全部指向可读取且结构有效的 schema v3 数据', () => {
    const manifest = JSON.parse(read('list.json'));
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
    for (const entry of manifest.files) {
        assert.equal(entry.schemaVersion, 3);
        const data = JSON.parse(read(entry.path));
        assert.equal(data.schemaVersion, 3);
        assert.equal(data.交易日期, entry.tradingDate);
        assert.ok(data.股票字典 && typeof data.股票字典 === 'object');
        for (const group of ['行业板块资金流向', '概念板块资金流向']) {
            assert.ok(Array.isArray(data[group]));
            for (const sector of data[group]) {
                assert.ok(Array.isArray(sector.股票键));
                assert.equal(Number(sector.股票数量), sector.股票键.length);
                for (const stockKey of sector.股票键) assert.ok(data.股票字典[stockKey], `${entry.path} 缺少 ${stockKey}`);
            }
        }
    }
});
