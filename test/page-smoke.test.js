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

    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
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
