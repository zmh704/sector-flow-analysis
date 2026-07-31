'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLeadersContext() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'leaders.js'), 'utf8');
    const stockKey = 'SZ:000001';
    const stock = {
        stockKey,
        name: '测试股份',
        code: '000001',
        net: '1亿',
        change: '+1.00%',
        changePct: 1
    };
    const sectors = [{ name: '测试行业', type: '行业', days: 1 }];
    const context = {
        console,
        Map,
        Set,
        Math,
        Number,
        LEADER_STOCK_MIN_DAYS: 1,
        LEADER_GAP: 1,
        LEADER_COND_HIGH_HIGHER: true,
        LEADER_COND_FOCUS_REQUIRED: true,
        LEADER_COND_CLOSE_OPEN_RATIO: true,
        LEADER_COND_AVG5_GE_AVG10: true,
        LEADER_COND_CLOSE_ABOVE_AVG5: true,
        currentDateFile: 'd2',
        _todayLeadersCache: null,
        getActiveData: () => ({
            行业板块资金流向: [{ 板块: '测试行业', stocks: [stock] }],
            概念板块资金流向: []
        }),
        getPrevDayData: () => ({ 行业板块资金流向: [], 概念板块资金流向: [] }),
        buildSectorMap: () => new Map(),
        getSectorStocks: sector => sector.stocks || [],
        condNotPlaceholder: () => true,
        calcStockConsecutiveDays: () => new Map([[stockKey, 1]]),
        getFocusSectors: () => new Set(['行业|测试行业']),
        buildStockSectorsMap: () => new Map([[stockKey, sectors]]),
        buildLeaderSectorMaps: () => ({}),
        isStockAmountNotTooHigh: () => true,
        isStockVolumeUpChangeLimited: () => true,
        isStockHighHigherThanPrev: () => false,
        isStockCloseOpenRatioOk: () => true,
        isStockAvg5GeAvg10: () => true,
        isStockCloseAboveAvg5: () => true,
        resolveStockKey: value => value,
        document: { getElementById: () => null },
        renderEmptyState: () => '',
        escapeHtml: value => String(value),
        isStockPreselected: () => false
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}

test('原项目最高价突破开关切换后重新计算推荐结果', () => {
    const context = loadLeadersContext();

    assert.equal(context.calcTodayLeaders().length, 0, '开启条件时应排除未突破前高的股票');
    assert.equal(context._todayLeadersCache.highHigher, true);

    context.LEADER_COND_HIGH_HIGHER = false;
    assert.equal(context.calcTodayLeaders().length, 1, '关闭条件时不应复用开启状态的缓存结果');
    assert.equal(context._todayLeadersCache.highHigher, false);

    context.LEADER_COND_HIGH_HIGHER = true;
    assert.equal(context.calcTodayLeaders().length, 0, '重新开启条件时应再次执行最高价比较');
});

test('关联关注板块开关切换后重新计算推荐结果', () => {
    const context = loadLeadersContext();
    // 默认开启，股票在关注板块中，应能通过
    context.LEADER_COND_HIGH_HIGHER = false; // 关闭最高价突破，避免被该条件排除
    assert.equal(context.calcTodayLeaders().length, 1, '开启关联关注板块时应保留该股票');

    // 关闭该条件，股票即使不在关注板块也应通过
    context.LEADER_COND_FOCUS_REQUIRED = false;
    context.getFocusSectors = () => new Set(); // 空集合，模拟股票板块不在关注板块
    assert.equal(context.calcTodayLeaders().length, 1, '关闭关联关注板块时不应因板块不在关注集合而排除');
    assert.equal(context._todayLeadersCache.focusRequired, false);

    // 重新开启，应排除
    context.LEADER_COND_FOCUS_REQUIRED = true;
    assert.equal(context.calcTodayLeaders().length, 0, '重新开启关联关注板块时应排除不在关注集合的股票');
    assert.equal(context._todayLeadersCache.focusRequired, true);
});

test('收盘/开盘比开关切换后重新计算推荐结果', () => {
    const context = loadLeadersContext();
    context.LEADER_COND_HIGH_HIGHER = false; // 关闭其他限制条件

    // 默认开启，模拟通过
    context.isStockCloseOpenRatioOk = () => true;
    assert.equal(context.calcTodayLeaders().length, 1, '开启收盘/开盘比时应保留符合条件股票');
    assert.equal(context._todayLeadersCache.closeOpenRatio, true);

    // 关闭条件，即使不符合也应通过
    context.LEADER_COND_CLOSE_OPEN_RATIO = false;
    context.isStockCloseOpenRatioOk = () => false;
    assert.equal(context.calcTodayLeaders().length, 1, '关闭收盘/开盘比时不应因该条件排除');
    assert.equal(context._todayLeadersCache.closeOpenRatio, false);

    // 重新开启，应排除
    context.LEADER_COND_CLOSE_OPEN_RATIO = true;
    assert.equal(context.calcTodayLeaders().length, 0, '重新开启收盘/开盘比时应排除不满足条件的股票');
    assert.equal(context._todayLeadersCache.closeOpenRatio, true);
});

test('5日均价>=10日均价开关切换后重新计算推荐结果', () => {
    const context = loadLeadersContext();
    context.LEADER_COND_HIGH_HIGHER = false; // 关闭其他限制条件

    // 默认开启，模拟通过
    context.isStockAvg5GeAvg10 = () => true;
    assert.equal(context.calcTodayLeaders().length, 1, '开启均价条件时应保留符合条件股票');
    assert.equal(context._todayLeadersCache.avg5GeAvg10, true);

    // 关闭条件，即使不符合也应通过
    context.LEADER_COND_AVG5_GE_AVG10 = false;
    context.isStockAvg5GeAvg10 = () => false;
    assert.equal(context.calcTodayLeaders().length, 1, '关闭均价条件时不应因该条件排除');
    assert.equal(context._todayLeadersCache.avg5GeAvg10, false);

    // 重新开启，应排除
    context.LEADER_COND_AVG5_GE_AVG10 = true;
    assert.equal(context.calcTodayLeaders().length, 0, '重新开启均价条件时应排除不满足条件的股票');
    assert.equal(context._todayLeadersCache.avg5GeAvg10, true);
});

test('价>5日线开关切换后重新计算推荐结果', () => {
    const context = loadLeadersContext();
    context.LEADER_COND_HIGH_HIGHER = false;

    // 默认开启，模拟通过
    context.isStockCloseAboveAvg5 = () => true;
    assert.equal(context.calcTodayLeaders().length, 1, '开启价>5日线时应保留符合条件股票');
    assert.equal(context._todayLeadersCache.closeAboveAvg5, true);

    // 关闭条件
    context.LEADER_COND_CLOSE_ABOVE_AVG5 = false;
    context.isStockCloseAboveAvg5 = () => false;
    assert.equal(context.calcTodayLeaders().length, 1, '关闭价>5日线时不应因该条件排除');
    assert.equal(context._todayLeadersCache.closeAboveAvg5, false);

    // 重新开启
    context.LEADER_COND_CLOSE_ABOVE_AVG5 = true;
    assert.equal(context.calcTodayLeaders().length, 0, '重新开启价>5日线时应排除不满足条件的股票');
    assert.equal(context._todayLeadersCache.closeAboveAvg5, true);
});
