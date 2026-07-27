'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    createManifest,
    extractTradingDate,
    getHasPriceData,
} = require('../lib/manifest.js');
const { generateFileList } = require('../generate-list.js');

function withFixture(t) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-manifest-'));
    const dataDir = path.join(rootDir, 'data');
    fs.mkdirSync(dataDir);
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    return { rootDir, dataDir };
}

function writeData(dataDir, name, data) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(data), 'utf8');
}

test('交易日期优先读取 JSON，并支持 ISO 和中文文件名回退', () => {
    const now = new Date('2026-07-27T12:00:00Z');
    assert.equal(extractTradingDate({ '交易日期': '2026年7月3日' }, '2025-01-01_板块资金流向.json', { now }), '2026-07-03');
    assert.equal(extractTradingDate({}, '2026-07-02_板块资金流向.json', { now }), '2026-07-02');
    assert.equal(extractTradingDate({}, '7月1日_板块资金流向.json', { now }), '2026-07-01');
    assert.equal(extractTradingDate({}, '12月31日_板块资金流向.json', { now }), '2025-12-31');
    assert.equal(extractTradingDate({}, '2月30日_板块资金流向.json', { now }), null);
});

test('manifest 按业务日期排序并按 schema、价格数据、ISO 文件名去重', t => {
    const { rootDir, dataDir } = withFixture(t);
    const now = new Date('2026-07-27T12:00:00Z');

    writeData(dataDir, '7月1日_板块资金流向.json', { schemaVersion: 1 });
    writeData(dataDir, 'legacy-price-7月1日_板块资金流向.json', {
        schemaVersion: 2,
        '行业板块资金流向': [{ '最高价': 10 }],
    });
    writeData(dataDir, '2026年7月1日_板块资金流向.json', {
        schemaVersion: 2,
        hasPriceData: true,
    });
    writeData(dataDir, '2026-07-01_板块资金流向.json', {
        schemaVersion: 2,
        hasPriceData: true,
    });
    writeData(dataDir, '2026-06-30_板块资金流向.json', {
        '交易日期': '2026-07-03',
        schemaVersion: 5,
    });
    writeData(dataDir, '2026-07-02_板块资金流向.json', {
        schemaVersion: 1,
        hasPriceData: false,
    });

    // Make mtimes deliberately conflict with business ordering.
    fs.utimesSync(path.join(dataDir, '2026-06-30_板块资金流向.json'), new Date(0), new Date(0));
    fs.utimesSync(path.join(dataDir, '2026-07-01_板块资金流向.json'), new Date(), new Date());

    const manifest = createManifest({ rootDir, dataDir, now });
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.generatedAt, now.toISOString());
    assert.deepEqual(manifest.files, [
        {
            path: 'data/2026-07-01_板块资金流向.json',
            tradingDate: '2026-07-01',
            schemaVersion: 2,
            hasPriceData: true,
        },
        {
            path: 'data/2026-07-02_板块资金流向.json',
            tradingDate: '2026-07-02',
            schemaVersion: 1,
            hasPriceData: false,
        },
        {
            path: 'data/2026-06-30_板块资金流向.json',
            tradingDate: '2026-07-03',
            schemaVersion: 5,
            hasPriceData: false,
        },
    ]);
});

test('价格数据可从字段或现有股票编码字符串识别', () => {
    assert.equal(getHasPriceData({ rows: [{ '收盘价': 12.3 }] }), true);
    assert.equal(getHasPriceData({ '股票明细': [{ high: 12.3, open: null, low: null, close: null }] }), true);
    assert.equal(getHasPriceData({ rows: [{ '涉及股票': '示例(000001|1亿|+1万|+1%|2万手|10|9|8|9.5)' }] }), true);
    assert.equal(getHasPriceData({ rows: [{ '涉及股票': '示例(000001|1亿|+1万|+1%|2万手)' }] }), false);
    assert.equal(getHasPriceData({ hasPriceData: false, rows: [{ '最高价': 10 }] }), false);
});

test('generate-list 复用 manifest helper 写出 v2 list.json', t => {
    const { rootDir, dataDir } = withFixture(t);
    const outputPath = path.join(rootDir, 'list.json');
    const now = new Date('2026-07-27T12:00:00Z');
    writeData(dataDir, '2026-07-01_板块资金流向.json', { schemaVersion: 2 });

    const result = generateFileList({ rootDir, dataDir, outputPath, now, quiet: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), result);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.files[0].path, 'data/2026-07-01_板块资金流向.json');
});
