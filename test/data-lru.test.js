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
        allDataByDate: {},
        dateFileList: [],
        currentDateFile: null,
        _sortedDateFileList: null,
        _stockFieldIndex: {},
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
        document: { getElementById() { return null; }, querySelectorAll() { return []; } },
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
