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
