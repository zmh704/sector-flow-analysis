'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCalcContext() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'calc.js'), 'utf8');
    const context = {
        console,
        Map,
        Set,
        Number,
        Math,
        RATIO_TURNOVER_LOW: 0.9,
        RATIO_TURNOVER_HIGH: 1.6,
        FOCUS_MIN_DAYS: 1,
        StockUtils: {},
        sortDateFileList: () => [],
        currentDateFile: null,
        _stockFieldIndex: {},
        _stockNameKeyIndex: new Map(),
        allDataByDate: {},
        _consecutiveInflowCache: null,
        _sectorFilterCache: null,
        _dailySectorMapCache: new Map()
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}

const sector = turnover => ({ 板块: '测试板块', 成交额: turnover, 主力净额: 1 });

test('关注板块条件③在缺少昨日对应数据时不通过', () => {
    const context = loadCalcContext();
    const current = new Map([['测试板块', sector(100)]]);
    assert.equal(context.isSectorTurnoverDecreased('测试板块', current, new Map()), false);
});

test('关注板块条件④仅缺少昨日数据时不通过，更早数据缺失则降级比较', () => {
    const context = loadCalcContext();
    const current = new Map([['测试板块', sector(100)]]);
    const previous = new Map([['测试板块', sector(95)]]);
    const previous2 = new Map([['测试板块', sector(90)]]);
    const previous3 = new Map([['测试板块', sector(85)]]);

    assert.equal(context.isSectorTurnoverNotTooLow('测试板块', current, new Map(), previous2, previous3), false);
    assert.equal(context.isSectorTurnoverNotTooLow('测试板块', current, previous, null, previous3), true);
    assert.equal(context.isSectorTurnoverNotTooLow('测试板块', current, previous, previous2, new Map()), true);
    assert.equal(context.isSectorTurnoverNotTooLow('测试板块', current, previous, previous2, previous3), true);
});
