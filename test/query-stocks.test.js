'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterStocks } = require('../query-stocks.js');

function entry(stock, dateKey) {
    return { stock, sectors: [], dateKey };
}

function stockIndex(entries) {
    return new Map([['SZ:000001', new Map(entries)]]);
}

test('intersection 要求全部条件成立', () => {
    const allStocks = stockIndex([
        ['2026-07-28', entry({ netYi: 1, changePct: -2 }, '2026-07-28')]
    ]);
    const config = {
        combine: 'intersection',
        conditions: [
            { date: '2026-07-28', field: 'netYi', operator: '>', value: 0 },
            { date: '2026-07-28', field: 'changePct', operator: '>', value: 0 }
        ]
    };
    assert.equal(filterStocks(allStocks, config).length, 0);
});

test('union 任一条件成立即可入选', () => {
    const allStocks = stockIndex([
        ['2026-07-28', entry({ netYi: 1, changePct: -2 }, '2026-07-28')]
    ]);
    const config = {
        combine: 'union',
        conditions: [
            { date: '2026-07-28', field: 'netYi', operator: '<', value: 0 },
            { date: '2026-07-28', field: 'changePct', operator: '<', value: 0 }
        ]
    };
    assert.equal(filterStocks(allStocks, config).length, 1);
});

test('union 中缺少某条件日期不影响其他条件命中', () => {
    const allStocks = stockIndex([
        ['2026-07-28', entry({ netYi: 1 }, '2026-07-28')]
    ]);
    const config = {
        combine: 'union',
        conditions: [
            { date: '2026-07-27', field: 'netYi', operator: '>', value: 0 },
            { date: '2026-07-28', field: 'netYi', operator: '>', value: 0 }
        ]
    };
    assert.equal(filterStocks(allStocks, config).length, 1);
});

test('跨日期参考字段比较按指定日期执行', () => {
    const allStocks = stockIndex([
        ['2026-07-27', entry({ high: 10 }, '2026-07-27')],
        ['2026-07-28', entry({ high: 11 }, '2026-07-28')]
    ]);
    const config = {
        combine: 'intersection',
        conditions: [{
            date: '2026-07-28',
            field: 'high',
            operator: '>',
            refDate: '2026-07-27',
            refField: 'high'
        }]
    };
    assert.equal(filterStocks(allStocks, config).length, 1);
});
