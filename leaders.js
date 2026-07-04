// ===== 今日推荐 & 关注板块渲染 =====

// ============================
// 今日推荐股票筛选条件（各条件独立方法，可注释/取消注释来开关）
// ============================

/** 条件A：股票连续流入天数 >= LEADER_STOCK_MIN_DAYS */
function leaderCondMinDays(stockDays) {
    return stockDays >= LEADER_STOCK_MIN_DAYS;
}

/** 条件B：至少有一个所属板块在重点关注（关注板块）中（直接复用 getFocusSectors 的板块集合） */

/** 条件C：当日成交额 > 前一日成交额 * 0.9（防止缩量过快） */
function leaderCondTurnoverNotTooLow(stockName) {
    return isStockTurnoverNotTooLow(stockName);
}

/** 条件D：当日成交额 < 前一日成交额 * 1.5（防止放量过快） */
function leaderCondAmountNotTooHigh(stockName) {
    return isStockAmountNotTooHigh(stockName);
}

/** 条件E：所有所属板块当日成交额均 < 板块前一日成交额 × 1.5 */
function leaderCondAllSectorsDecreased(stockName, sectors) {
    return sectors.every(s => {
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        return isSectorTurnoverDecreased(s.name, st);
    });
}

/** 条件F：所属板块中净流入天数 >= 股票天数的板块，成交额需 > 昨日成交额 × 0.9 */
function leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors) {
    return sectors.every(s => {
        if (s.days < stockDays) return true;
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        return isSectorAbove090(s.name, st);
    });
}

/** 条件G：股票连续流入天数在板块最大天数范围内（容差LEADER_GAP） */
function leaderCondDaysWithinGap(stockDays, sectors) {
    if (!sectors || sectors.length === 0) return false;
    const maxSectorDays = Math.max(...sectors.map(s => s.days));
    return stockDays >= maxSectorDays - LEADER_GAP && stockDays <= maxSectorDays;
}

/** 条件H：股票当日成交量 < 近5日内最大成交量（缩量） */
function leaderCondVolumeDecreased(stockName) {
    return isStockVolumeDecreased(stockName);
}

/** 条件I：当日成交量 > 昨日成交量时，涨跌幅必须 < 5% */
function leaderCondVolumeUpChangeLimited(stockName) {
    return isStockVolumeUpChangeLimited(stockName);
}

/**
 * 今日推荐股票的完整筛选逻辑（加星逻辑也复用此函数，保持一致）
 * 修改下方任一条件的注释状态，今日推荐与加星会自动同步
 */
function passesLeaderConditions(stockName, stockDays, sectors, focusSectors) {
    const _isDebug = stockName === '三花智控';
    if (_isDebug) console.log('三花智控 passesLeaderConditions 开始', { stockDays, sectorCount: sectors.length, sectorNames: sectors.map(s=>s.name), sectorDays: sectors.map(s=>s.days) });

    if (!leaderCondMinDays(stockDays)) { if (_isDebug) console.log('× 条件A 不通过', { stockDays }); return false; }       // 条件A：股票连续天数 >= 最小值
    // 条件B：至少一个所属板块在关注板块中（直接复用 getFocusSectors 的板块集合）
    const inFocus = sectors.some(s => focusSectors.has(s.name));
    if (_isDebug) console.log('条件B 结果', { inFocus, focusSectors: [...focusSectors] });
    if (!inFocus) { if (_isDebug) console.log('× 条件B 不通过'); return false; }
    // if (!leaderCondTurnoverNotTooLow(stockName)) return false;           // 条件C：股票当日成交额 > 前一日成交额 * 0.9（防缩量）
    if (!leaderCondAmountNotTooHigh(stockName)) { if (_isDebug) console.log('× 条件D 不通过'); return false; }        // 条件D：股票当日成交额 < 前一日成交额 * 1.5（防放量）
    if (!leaderCondAllSectorsDecreased(stockName, sectors)) { if (_isDebug) console.log('× 条件E 不通过'); return false; } // 条件E：所有所属板块成交额 < 板块前一日 * 1.5
    // if (!leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors)) return false; // 条件F：高天数板块成交额 > 板块前一日 * 0.9
    if (!leaderCondDaysWithinGap(stockDays, sectors)) { if (_isDebug) console.log('× 条件G 不通过', { stockDays, maxSectorDays: Math.max(...sectors.map(s=>s.days)), LEADER_GAP }); return false; } // 条件G：股票天数在所属板块最大天数 ± LEADER_GAP 范围内
    // if (!leaderCondVolumeDecreased(stockName)) return false;             // 条件H：股票当日成交量 < 近5日内最大成交量
    if (!leaderCondVolumeUpChangeLimited(stockName)) { if (_isDebug) console.log('× 条件I 不通过'); return false; } // 条件I：放量时涨跌幅必须 < 5%
    if (_isDebug) console.log('✅ 三花智控 全部通过');
    return true;
}

/** 计算给定股票列表的加星集合（复用今日推荐完整筛选逻辑，自动同步条件开关） */
function calcLeaderStarSet(stocks, stockDaysMap) {
    const daysMap = stockDaysMap || calcStockConsecutiveDays();
    const stockSectorsMap = buildStockSectorsMap();
    const focusSectors = getFocusSectors(getActiveData());
    const starSet = new Set();
    for (const stock of stocks) {
        const stockDays = daysMap.get(stock.name) || 0;
        const sectors = stockSectorsMap.get(stock.name) || [];
        if (passesLeaderConditions(stock.name, stockDays, sectors, focusSectors)) {
            starSet.add(stock.name);
        }
    }
    return starSet;
}

// ============================

function updateLeaderArea(activeData) {
    const container = document.getElementById('leaderContent');
    if (!container) return;

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const allCurrentSectors = [...industryList, ...conceptList];

    if (allCurrentSectors.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无数据</span>';
        return;
    }

    // 计算所有股票的连续流入天数
    const stockConsecutiveDays = calcStockConsecutiveDays();

    // 关注板块集合（与关注板块区一致，复用公共函数避免阈值分歧）
    const focusSectors = getFocusSectors(activeData);

    // 建立当前日期 股票→所属板块 的映射（复用共享函数 buildStockSectorsMap）
    const stockSectors = buildStockSectorsMap();
    const stockChange = new Map(); // 股票→涨跌幅
    for (const sector of allCurrentSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
        for (const stock of stocks) {
            if (!stockChange.has(stock.name)) {
                stockChange.set(stock.name, stock.change);
            }
        }
    }

    // 筛选龙头股票（条件集中在 passesLeaderConditions，加星逻辑也复用，自动同步）
    const leaders = [];
    for (const [stockName, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockName) || 0;
        if (!passesLeaderConditions(stockName, stockDays, sectors, focusSectors)) continue;

        const sectorNames = sectors
            .filter(s => s.days >= 1)
            .map(s => `${s.name}(${s.type}${s.days}天)`);
        leaders.push({
            name: stockName,
            stockDays: stockDays,
            change: stockChange.get(stockName) || '',
            sectors: sectorNames,
            _allSectors: stockSectors.get(stockName)
        });
    }

    // 渲染
    container.innerHTML = '';
    if (leaders.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的龙头股票</span>';
        return;
    }

    // 按股票连续天数降序排列
    leaders.sort((a, b) => b.stockDays - a.stockDays || a.name.localeCompare(b.name));

    const html = leaders.map(leader => {
        const secJson = JSON.stringify(leader._allSectors).replace(/'/g, "\\'");
        const changeNum = parseFloat(leader.change);
        const changeColor = changeNum >= 0 ? '#e53935' : '#43a047';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        return `<span class="leader-item leader-clickable" title="连续流入${leader.stockDays}天 | 所属板块: ${leader.sectors.join('、')}" onclick='showStockLeader("${leader.name}", ${secJson})'>
            <span class="leader-name">${leader.name}</span>
            <span class="leader-days">${leader.stockDays}天</span>
            <span class="leader-change" style="color:${changeColor}">${changeArrow} ${leader.change}</span>
        </span>`;
    }).join('');
    container.innerHTML = html;
}

function updateFocusArea(activeData) {
    const container = document.getElementById('focusContent');
    if (!container) return;
    container.innerHTML = '';

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];

    const industries = industryList
        .filter(i => condNotPlaceholder(i))                                // 条件②：板块名 ≠ '所属行业' / '所属概念'
        .filter(i => condNetPositive(i))                                   // 条件①：主力净额 > 0
        .filter(i => condAmountNotTooHigh(i.板块, '行业板块资金流向'))      // 条件③：板块成交额 < 昨日成交额 × 1.5
        .filter(i => condTurnoverTrend(i.板块, '行业板块资金流向'))         // 条件④：成交额趋势（连续变小→>昨日×0.85 / 变大→也变大）
        .map(i => ({
            name: i.板块,
            days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
            stocks: new Set((i._parsedStocks || parseStocks(i.涉及股票)).map(s => s.name))
        }))
        .filter(i => condMinDays(i.name, '行业板块资金流向'));              // 条件⑤：连续流入天数 >= FOCUS_MIN_DAYS

    const concepts = conceptList
        .filter(c => condNotPlaceholder(c))                                // 条件②：板块名 ≠ '所属行业' / '所属概念'
        .filter(c => condNetPositive(c))                                   // 条件①：主力净额 > 0
        .filter(c => condAmountNotTooHigh(c.板块, '概念板块资金流向'))      // 条件③：板块成交额 < 昨日成交额 × 1.5
        .filter(c => condTurnoverTrend(c.板块, '概念板块资金流向'))         // 条件④：成交额趋势（连续变小→>昨日×0.85 / 变大→也变大）
        .map(c => ({
            name: c.板块,
            days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
            stocks: new Set((c._parsedStocks || parseStocks(c.涉及股票)).map(s => s.name))
        }))
        .filter(c => condMinDays(c.name, '概念板块资金流向'));              // 条件⑤：连续流入天数 >= FOCUS_MIN_DAYS

    if (industries.length === 0 && concepts.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的关注板块</span>';
        return;
    }

    // 建立行业↔概念共同股票配对（供弹窗展示关联板块使用）
    const allPairs = [];
    industries.forEach(ind => {
        concepts.forEach(con => {
            const common = [...ind.stocks].filter(s => con.stocks.has(s));
            if (common.length > 0) {
                allPairs.push({ industry: ind, concept: con, commonCount: common.length, commonStocks: common });
            }
        });
    });

    // 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        industries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const industryStockStr = (industryList.find(i => i.板块 === item.name) || {}).涉及股票 || '';
            div.onclick = function() {
                const matchedConceptsForIndustry = allPairs
                    .filter(p => p.industry.name === item.name)
                    .map(p => ({ name: p.concept.name, days: p.concept.days, commonStocks: p.commonStocks }));
                const industryCommonStocks = new Set(
                    allPairs.filter(p => p.industry.name === item.name)
                        .flatMap(p => p.commonStocks)
                );
                showSingleTrendModal(item.name, '行业板块资金流向', '🏛️ ' + item.name + '（行业）', matchedConceptsForIndustry, parseStocks(industryStockStr), industryCommonStocks);
            };
            indSection.appendChild(div);
        });
        container.appendChild(indSection);
    }

    // 2. 渲染概念部分
    {
        const conSection = document.createElement('div');

        concepts.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const conceptStockStr = (conceptList.find(c => c.板块 === item.name) || {}).涉及股票 || '';
            div.onclick = function() {
                const matchedIndustriesForConcept = allPairs
                    .filter(p => p.concept.name === item.name)
                    .map(p => ({ name: p.industry.name, days: p.industry.days, commonStocks: p.commonStocks }));
                const conceptCommonStocks = new Set(
                    allPairs.filter(p => p.concept.name === item.name)
                        .flatMap(p => p.commonStocks)
                );
                showSingleTrendModal(item.name, '概念板块资金流向', '💡 ' + item.name + '（概念）', matchedIndustriesForConcept, parseStocks(conceptStockStr), conceptCommonStocks);
            };
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}
