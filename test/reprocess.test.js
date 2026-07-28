'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareResults, isKnownDuplicateCorrection, parseArgs } = require('../reprocess.js');

function sector(overrides = {}) {
    return {
        板块: '测试概念',
        成交额: 100,
        主力净额: 20,
        股票数量: 1,
        涉及股票: '样例(000001|100|20|1)',
        ...overrides
    };
}

function result(industry, concept) {
    return {
        行业板块资金流向: industry,
        概念板块资金流向: concept
    };
}

test('迁移参数默认 dry-run，--apply 显式开启写入', () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs(['--apply']).apply, true);
    assert.equal(parseArgs(['--dry-run']).apply, false);
    assert.throws(() => parseArgs(['--unknown']), /不支持的参数/);
});

test('迁移校验接受完全一致数据', () => {
    const data = result([sector({ 板块: '行业' })], [sector()]);
    const comparison = compareResults(data, structuredClone(data));
    assert.equal(comparison.safe, true);
    assert.equal(comparison.classification, 'exact');
});

test('迁移校验仅接受旧版重复聚合的二倍修正', () => {
    const oldRow = sector({ 成交额: 200, 主力净额: 40, 股票数量: 2 });
    const newRow = sector();
    assert.equal(isKnownDuplicateCorrection(oldRow, newRow), true);
    const comparison = compareResults(result([], [oldRow]), result([], [newRow]));
    assert.equal(comparison.safe, true);
    assert.equal(comparison.classification, 'duplicate-correction');
});

test('迁移校验阻止普通金额变化、板块缺失和新增板块', () => {
    const amountChanged = compareResults(result([], [sector()]), result([], [sector({ 成交额: 101 })]));
    assert.equal(amountChanged.safe, false);
    assert.equal(amountChanged.classification, 'incompatible');

    assert.equal(compareResults(result([], [sector()]), result([], [])).safe, false);
    assert.equal(compareResults(result([], []), result([], [sector()])).safe, false);
});
