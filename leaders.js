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

/**
 * 预构建今日推荐所需的板块 Maps（调用一次即可，避免每次条件判断重复构建）
 * 返回 { '行业板块资金流向': { curr: Map, prev: Map }, '概念板块资金流向': { curr: Map, prev: Map } }
 */
function buildLeaderSectorMaps() {
    const activeData = getActiveData();
    const prevDayData = getPrevDayData();
    return {
        '行业板块资金流向': {
            curr: buildSectorMap(activeData['行业板块资金流向'] || []),
            prev: buildSectorMap(prevDayData?.['行业板块资金流向'] || [])
        },
        '概念板块资金流向': {
            curr: buildSectorMap(activeData['概念板块资金流向'] || []),
            prev: buildSectorMap(prevDayData?.['概念板块资金流向'] || [])
        }
    };
}

/** 条件E：所有所属板块当日成交额均 < 板块前一日成交额 × RATIO_TURNOVER_HIGH */
function leaderCondAllSectorsDecreased(stockName, sectors, sectorMaps) {
    return sectors.every(s => {
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        const maps = sectorMaps[st];
        return maps ? isSectorTurnoverDecreased(s.name, maps.curr, maps.prev) : true;
    });
}

/** 条件F：所属板块中净流入天数 >= 股票天数的板块，成交额需 > 昨日成交额 × RATIO_TURNOVER_LOW */
function leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors, sectorMaps) {
    return sectors.every(s => {
        if (s.days < stockDays) return true;
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        const maps = sectorMaps[st];
        return maps ? isSectorAbove090(s.name, maps.curr, maps.prev) : true;
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
 * @param {Object} sectorMaps - 预构建的板块 Maps（由 buildLeaderSectorMaps() 生成），避免每次条件判断重复构建
 */
function passesLeaderConditions(stockName, stockDays, sectors, focusSectors, sectorMaps) {
    if (!leaderCondMinDays(stockDays)) return false;       // 条件A：股票连续天数 >= 最小值
    // 条件B：至少一个所属板块在关注板块中（直接复用 getFocusSectors 的板块集合）
    const inFocus = sectors.some(s => focusSectors.has(s.name));
    if (!inFocus) return false;
    // if (!leaderCondTurnoverNotTooLow(stockName)) return false;           // 条件C：股票当日成交额 > 前一日成交额 * 0.9（防缩量）
    if (!leaderCondAmountNotTooHigh(stockName)) return false;        // 条件D：股票当日成交额 < 前一日成交额 * 1.5（防放量）
    if (!leaderCondAllSectorsDecreased(stockName, sectors, sectorMaps)) return false; // 条件E：所有所属板块成交额 < 板块前一日 * 1.5
    // if (!leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors, sectorMaps)) return false; // 条件F：高天数板块成交额 > 板块前一日 * 0.9
    if (!leaderCondDaysWithinGap(stockDays, sectors)) return false; // 条件G：股票天数在所属板块最大天数 ± LEADER_GAP 范围内
    // if (!leaderCondVolumeDecreased(stockName)) return false;             // 条件H：股票当日成交量 < 近5日内最大成交量
    if (!leaderCondVolumeUpChangeLimited(stockName)) return false; // 条件I：放量时涨跌幅必须 < 5%
    return true;
}

/** 计算给定股票列表的加星集合（复用今日推荐完整筛选逻辑，自动同步条件开关） */
function calcLeaderStarSet(stocks, stockDaysMap) {
    const daysMap = stockDaysMap || calcStockConsecutiveDays();
    const stockSectorsMap = buildStockSectorsMap();
    const focusSectors = getFocusSectors(getActiveData());
    const sectorMaps = buildLeaderSectorMaps();  // 预构建一次，避免条件判断重复构建
    const starSet = new Set();
    for (const stock of stocks) {
        const stockDays = daysMap.get(stock.name) || 0;
        const sectors = stockSectorsMap.get(stock.name) || [];
        if (passesLeaderConditions(stock.name, stockDays, sectors, focusSectors, sectorMaps)) {
            starSet.add(stock.name);
        }
    }
    return starSet;
}

// ============================

/**
 * 计算今日推荐股票列表（首页今日推荐区与弹窗【今日推荐】页签共用，保证两处一致）
 * 返回 [{ name, code, net, change, stockDays, sectors, _allSectors }]，按连续天数降序
 */
function calcTodayLeaders() {
    const activeData = getActiveData();
    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const allCurrentSectors = [...industryList, ...conceptList];
    if (allCurrentSectors.length === 0) return [];

    // 计算所有股票的连续流入天数
    const stockConsecutiveDays = calcStockConsecutiveDays();

    // 关注板块集合（与关注板块区一致，复用公共函数避免阈值分歧）
    const focusSectors = getFocusSectors(activeData);

    // 建立当前日期 股票→所属板块 的映射（复用共享函数 buildStockSectorsMap）
    const stockSectors = buildStockSectorsMap();
    const stockInfo = new Map(); // 股票→{code, net, change}（取首次出现的字段）
    for (const sector of allCurrentSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
        for (const stock of stocks) {
            if (!stockInfo.has(stock.name)) {
                stockInfo.set(stock.name, stock);
            }
        }
    }

    // 预构建板块 Maps（避免条件判断中重复构建）
    const sectorMaps = buildLeaderSectorMaps();

    // 筛选龙头股票（条件集中在 passesLeaderConditions，加星逻辑也复用，自动同步）
    const leaders = [];
    for (const [stockName, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockName) || 0;
        if (!passesLeaderConditions(stockName, stockDays, sectors, focusSectors, sectorMaps)) continue;

        const info = stockInfo.get(stockName) || {};
        const sectorNames = sectors
            .filter(s => s.days >= 1)
            .map(s => `${s.name}(${s.type}${s.days}天)`);
        leaders.push({
            name: stockName,
            code: info.code || '',
            net: info.net || '',
            change: info.change || '',
            stockDays: stockDays,
            sectors: sectorNames,
            _allSectors: sectors
        });
    }

    // 按股票连续天数降序排列
    leaders.sort((a, b) => b.stockDays - a.stockDays || a.name.localeCompare(b.name));
    return leaders;
}

function updateLeaderArea(activeData) {
    const container = document.getElementById('leaderContent');
    if (!container) return;

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const allCurrentSectors = [...industryList, ...conceptList];

    if (allCurrentSectors.length === 0) {
        container.innerHTML = renderEmptyState('📭', '暂无数据', '请点击「加载数据」获取板块数据');
        return;
    }

    const leaders = calcTodayLeaders();

    // 渲染
    container.innerHTML = '';
    if (leaders.length === 0) {
        container.innerHTML = renderEmptyState('🏆', '暂无符合条件的龙头股票', '尝试调整筛选条件或切换日期');
        return;
    }

    const html = leaders.map(leader => {
        const secJson = escapeHtml(JSON.stringify(leader._allSectors));
        const changeNum = parseFloat(leader.change);
        const changeColor = changeNum >= 0 ? '#e53935' : '#43a047';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        const isPreselected = isStockPreselected(leader.name);
        return `<span class="leader-item leader-clickable${isPreselected ? ' leader-preselected' : ''}" title="连续流入${leader.stockDays}天 | 所属板块: ${leader.sectors.map(s => escapeHtml(s)).join('、')}" data-stock="${escapeHtml(leader.name)}" data-sectors='${secJson}'>
            <span class="leader-name">${escapeHtml(leader.name)}</span>
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

    const industries = filterSectors(industryList, '行业板块资金流向').map(i => ({
        name: i.板块,
        days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
        stocks: new Set((i._parsedStocks || parseStocks(i.涉及股票)).map(s => s.name)),
        stockStr: i.涉及股票
    }));

    const concepts = filterSectors(conceptList, '概念板块资金流向').map(c => ({
        name: c.板块,
        days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
        stocks: new Set((c._parsedStocks || parseStocks(c.涉及股票)).map(s => s.name)),
        stockStr: c.涉及股票
    }));

    if (industries.length === 0 && concepts.length === 0) {
        container.innerHTML = renderEmptyState('📌', '暂无符合条件的关注板块', '尝试切换日期或调整筛选条件');
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

    /**
     * 生成关注板块标签的 data-* 属性字符串（供事件委托使用）
     */
    function buildSectorDataAttrs(item, type, allPairs, stockStr) {
        const otherType = type === '行业板块资金流向' ? '概念' : '行业';
        const matched = allPairs
            .filter(p => {
                const targetField = type === '行业板块资金流向' ? 'industry' : 'concept';
                return p[targetField].name === item.name;
            })
            .map(p => {
                const otherField = type === '行业板块资金流向' ? 'concept' : 'industry';
                return { name: p[otherField].name, days: p[otherField].days, commonStocks: p.commonStocks };
            });
        const commonStocks = new Set(allPairs
            .filter(p => {
                const targetField = type === '行业板块资金流向' ? 'industry' : 'concept';
                return p[targetField].name === item.name;
            })
            .flatMap(p => p.commonStocks)
        );
        const stocks = parseStocks(stockStr);
        const attrs = {
            sector: item.name,
            type: type,
            matched: JSON.stringify(matched),
            stocks: JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net, change: s.change }))),
            common: JSON.stringify([...commonStocks])
        };
        return Object.entries(attrs).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
    }

    // 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        industries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '行业板块资金流向');
            const matched = allPairs
                .filter(p => p.industry.name === item.name)
                .map(p => ({ name: p.concept.name, days: p.concept.days, commonStocks: p.commonStocks }));
            div.setAttribute('data-matched', JSON.stringify(matched));
            const stocks = parseStocks(item.stockStr || '');
            div.setAttribute('data-stocks', JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net, change: s.change }))));
            const commonStocks = new Set(allPairs.filter(p => p.industry.name === item.name).flatMap(p => p.commonStocks));
            div.setAttribute('data-common', JSON.stringify([...commonStocks]));
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
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '概念板块资金流向');
            const matched = allPairs
                .filter(p => p.concept.name === item.name)
                .map(p => ({ name: p.industry.name, days: p.industry.days, commonStocks: p.commonStocks }));
            div.setAttribute('data-matched', JSON.stringify(matched));
            const stocks = parseStocks(item.stockStr || '');
            div.setAttribute('data-stocks', JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net, change: s.change }))));
            const commonStocks = new Set(allPairs.filter(p => p.concept.name === item.name).flatMap(p => p.commonStocks));
            div.setAttribute('data-common', JSON.stringify([...commonStocks]));
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}
