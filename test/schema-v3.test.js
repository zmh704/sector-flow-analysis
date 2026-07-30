'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toSchemaV3, validateSchemaV3 } = require('../lib/schema-v3.js');
const { getSectorStocks } = require('../stock-utils.js');

function fixture() {
    const stock = {
        stockKey: 'SZ:000001', name: '平安银行', code: '000001',
        amountText: '2.00亿', netText: '+1.00亿', changeText: '+1.00%', volumeText: '10万手',
        amountYi: 2, netYi: 1, changePct: 1, volumeWanShou: 10,
        high: 12, open: 11, low: 10, close: 11.5, avg5: 11.2, avg10: 10.8
    };
    return {
        schemaVersion: 2,
        交易日期: '2026-07-28',
        行业板块资金流向: [{ 板块: '银行', 成交额: 2e8, 主力净额: 1e8, 股票数量: 1, 涉及股票: '兼容文本', 股票明细: [stock] }],
        概念板块资金流向: [{ 板块: '沪股通', 成交额: 2e8, 主力净额: 1e8, 股票数量: 1, 涉及股票: '兼容文本', 股票明细: [stock] }]
    };
}

test('schema v3 将跨板块重复股票提取为单一字典记录', () => {
    const v2 = fixture();
    const v3 = toSchemaV3(v2);
    assert.equal(v3.schemaVersion, 3);
    assert.deepEqual(Object.keys(v3.股票字典), ['SZ:000001']);
    assert.deepEqual(v3.行业板块资金流向[0].股票键, ['SZ:000001']);
    assert.equal('股票明细' in v3.行业板块资金流向[0], false);
    assert.equal('涉及股票' in v3.行业板块资金流向[0], false);
    assert.deepEqual(validateSchemaV3(v2, v3), { valid: true, errors: [] });
});

test('getSectorStocks 可从 schema v3 股票字典水合股票', () => {
    const v3 = toSchemaV3(fixture());
    const stocks = getSectorStocks(v3.行业板块资金流向[0], v3.股票字典);
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].stockKey, 'SZ:000001');
    assert.equal(stocks[0].netYi, 1);
});

test('schema v3 校验发现缺失股票引用', () => {
    const v2 = fixture();
    const v3 = toSchemaV3(v2);
    delete v3.股票字典['SZ:000001'];
    const validation = validateSchemaV3(v2, v3);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('\n'), /缺少股票/);
});
