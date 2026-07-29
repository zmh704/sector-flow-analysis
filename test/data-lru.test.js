'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadDataContext() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
    const context = {
        console,
        Date,
        Map,
        Set,
        Number,
        Math,
        AbortController,
        TREND_CHART_DAYS: 10,
        DATA_ANALYSIS_DAYS: 12,
        MAX_LOADED_DATES: 3,
        DATE_BUTTON_LIMIT: 10,
        allDataByDate: {},
        dateFileList: [],
        currentDateFile: null,
        _sortedDateFileList: null,
        _stockFieldIndex: {},
        _stockKeysByDate: {},
        _stockNameKeyIndex: new Map(),
        _dataManifest: [],
        _manifestEntryByPath: new Map(),
        _dateAccessOrder: new Map(),
        _loadGeneration: 0,
        _loadAbortController: null,
        getSectorStocks: sector => sector._parsedStocks || [],
        getStockKey: (_code, name) => `legacy:name:${name}`,
        invalidateDateCaches() {},
        showLoadingProgress() {},
        showLoadingStatus() {},
        showWarningStatus() {},
        showSuccessStatus() {},
        updateCharts() {},
        renderEmptyState() { return ''; },
        document: { getElementById() { return null; }, createElement() { return null; }, querySelectorAll() { return []; } },
        fetch: async () => { throw new Error('not used'); }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}

function seedDate(context, filename, accessedAt) {
    context.storeDataForDate(filename, {
        交易日期: filename,
        行业板块资金流向: [],
        概念板块资金流向: []
    }, { skipInvalidate: true, tradingDate: filename });
    context._dateAccessOrder.set(filename, accessedAt);
}

test('LRU 超过上限时回收最久未访问日期并保护当前窗口', () => {
    const context = loadDataContext();
    seedDate(context, 'd1', 1);
    seedDate(context, 'd2', 2);
    seedDate(context, 'd3', 3);
    seedDate(context, 'd4', 4);
    context.currentDateFile = 'd4';

    const removed = context.evictLoadedDates(new Set(['d3', 'd4']));
    assert.deepEqual(Array.from(removed), ['d1']);
    assert.equal(context.allDataByDate.d1, undefined);
    assert.ok(context.allDataByDate.d2);
    assert.ok(context.allDataByDate.d3);
    assert.ok(context.allDataByDate.d4);
    assert.equal(context.dateFileList.length, 3);
});

test('覆盖已加载日期时只清理该日期关联的股票索引', () => {
    const context = loadDataContext();
    const sector = stocks => ({ _parsedStocks: stocks });
    const stock = (name, code, netYi) => ({ name, code, stockKey: `SZ:${code}`, netYi });

    context.storeDataForDate('d1', {
        行业板块资金流向: [sector([stock('甲', '000001', 1), stock('乙', '000002', 2)])],
        概念板块资金流向: []
    }, { skipInvalidate: true, tradingDate: 'd1' });
    context.storeDataForDate('d2', {
        行业板块资金流向: [sector([stock('甲', '000001', 3)])],
        概念板块资金流向: []
    }, { skipInvalidate: true, tradingDate: 'd2' });

    context.storeDataForDate('d1', {
        行业板块资金流向: [sector([stock('丙', '000003', 4)])],
        概念板块资金流向: []
    }, { skipInvalidate: true, tradingDate: 'd1' });

    assert.equal(context._stockFieldIndex['SZ:000001'].d1, undefined);
    assert.equal(context._stockFieldIndex['SZ:000001'].d2.net, 3);
    assert.equal(context._stockFieldIndex['SZ:000002'], undefined);
    assert.equal(context._stockFieldIndex['SZ:000003'].d1.net, 4);
    assert.deepEqual(Array.from(context._stockKeysByDate.d1), ['SZ:000003']);
});

test('日期选择器只渲染最近10个交易日并默认选中最新日期', () => {
    const context = loadDataContext();
    const appended = [];
    const container = {
        innerHTML: '',
        appendChild(button) { appended.push(button); },
        querySelectorAll() { return appended; }
    };
    context.document = {
        getElementById(id) { return id === 'dateButtons' ? container : null; },
        createElement() {
            const classes = new Set();
            return {
                dataset: {},
                classList: {
                    add(value) { classes.add(value); },
                    toggle(value, force) { if (force) classes.add(value); else classes.delete(value); },
                    contains(value) { return classes.has(value); }
                }
            };
        },
        querySelectorAll() { return []; }
    };
    context._dataManifest = Array.from({ length: 15 }, (_, index) => {
        const day = String(index + 1).padStart(2, '0');
        const path = `data/2026-07-${day}.json`;
        return { path, tradingDate: `2026-07-${day}`, schemaVersion: 3 };
    });
    context._manifestEntryByPath = new Map(context._dataManifest.map(entry => [entry.path, entry]));

    context.renderDateButtons();

    assert.equal(appended.length, 10);
    assert.equal(appended[0].dataset.datefile, 'data/2026-07-06.json');
    assert.equal(appended.at(-1).dataset.datefile, 'data/2026-07-15.json');
    assert.equal(context.currentDateFile, 'data/2026-07-15.json');
    assert.equal(appended.at(-1).classList.contains('active'), true);
});
