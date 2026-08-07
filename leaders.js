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

/** 条件D：当日成交额 < 前一日成交额 * RATIO_TURNOVER_HIGH（防止放量过快） */
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

    // 行业/概念净流入前3名（排除热门条件使用）
    const top3 = (list) => new Set(
        (list || []).filter(s => condNotPlaceholder(s) && Number.isFinite(Number(s.主力净额)))
            .sort((a, b) => Number(b.主力净额) - Number(a.主力净额))
            .slice(0, 3)
            .map(s => s.板块)
    );
    const hot = {
        ind: top3(activeData['行业板块资金流向']),
        con: top3(activeData['概念板块资金流向'])
    };

    return {
        hot,
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

/** 条件E：净流入天数最大的所属板块，当日成交额均 < 板块前一日成交额 × RATIO_TURNOVER_HIGH
 *  只检查天数最大的板块，忽略天数较小的板块（可能刚启动放量正常） */
function leaderCondAllSectorsDecreased(stockName, sectors, sectorMaps) {
    if (!sectors || sectors.length === 0) return true;
    const maxDays = Math.max(...sectors.map(s => s.days));
    const topSectors = sectors.filter(s => s.days === maxDays);
    return topSectors.every(s => {
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

/** 条件I：当日成交量 > 昨日成交量（放量）时，涨幅必须 < 5%（放量大跌不限制） */
function leaderCondVolumeUpChangeLimited(stockName) {
    return isStockVolumeUpChangeLimited(stockName);
}

/** 条件J：当日最高价 > 前一日最高价（由 LEADER_COND_HIGH_HIGHER 控制开关） */
function leaderCondHighHigher(stockName) {
    if (!LEADER_COND_HIGH_HIGHER) return true;
    return isStockHighHigherThanPrev(stockName);
}

/** 条件K：收盘价/开盘价 < CLOSE_OPEN_RATIO_MAX（由 LEADER_COND_CLOSE_OPEN_RATIO 控制开关） */
function leaderCondCloseOpenRatio(stockName) {
    if (!LEADER_COND_CLOSE_OPEN_RATIO) return true;
    return isStockCloseOpenRatioOk(stockName);
}

/** 条件L：5日均价 >= 10日均价（由 LEADER_COND_AVG5_GE_AVG10 控制开关） */
function leaderCondAvg5GeAvg10(stockName) {
    if (!LEADER_COND_AVG5_GE_AVG10) return true;
    return isStockAvg5GeAvg10(stockName);
}

/** 条件M：收盘价 > 5日均价（由 LEADER_COND_CLOSE_ABOVE_AVG5 控制开关） */
function leaderCondCloseAboveAvg5(stockName) {
    if (!LEADER_COND_CLOSE_ABOVE_AVG5) return true;
    return isStockCloseAboveAvg5(stockName);
}

/** 条件N：排除所属板块在行业/概念净流入前3名的股票（由 LEADER_COND_EXCLUDE_HOT 控制开关） */
function leaderCondExcludeHot(stockName, sectors, sectorMaps) {
    if (!LEADER_COND_EXCLUDE_HOT) return true;
    if (!sectors || sectors.length === 0) return true;
    const hot = sectorMaps && sectorMaps.hot;
    if (!hot) return true;
    const inHot = sectors.some(s => {
        const set = s.type === '行业' ? hot.ind : hot.con;
        return set && set.has(s.name);
    });
    return !inHot;
}

/**
 * 今日推荐股票的完整筛选逻辑（加星逻辑也复用此函数，保持一致）
 * 修改下方任一条件的注释状态，今日推荐与加星会自动同步
 * @param {Object} sectorMaps - 预构建的板块 Maps（由 buildLeaderSectorMaps() 生成），避免每次条件判断重复构建
 */
function passesLeaderConditions(stockName, stockDays, sectors, focusSectors, sectorMaps) {
    // if (!leaderCondMinDays(stockDays)) return false;                     // 条件A：股票连续主力净流入天数 ≥ LEADER_STOCK_MIN_DAYS（暂时关闭）
    // 条件B：至少一个所属板块在关注板块中（可由 LEADER_COND_FOCUS_REQUIRED 开关关闭）
    if (LEADER_COND_FOCUS_REQUIRED) {
        const inFocus = sectors.some(s => focusSectors.has(s.type + '|' + s.name));
        if (!inFocus) return false;
    }
    // if (!leaderCondTurnoverNotTooLow(stockName)) return false;           // 条件C：股票当日成交额 > 前一日成交额 * 0.9（防缩量）
    if (!leaderCondAmountNotTooHigh(stockName)) return false;               // 条件D
    // if (!leaderCondAllSectorsDecreased(stockName, sectors, sectorMaps)) return false; // 条件E：板块成交额放量检查（已注释，该逻辑属于关注板块筛选，今日推荐不重复检查）
    // if (!leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors, sectorMaps)) return false; // 条件F：高天数板块成交额 > 板块前一日 * 0.9
    // if (!leaderCondDaysWithinGap(stockDays, sectors)) return false;       // 条件G：股票天数在板块最大天数 ±1 范围内（暂时关闭）
    // if (!leaderCondVolumeDecreased(stockName)) return false;             // 条件H：股票当日成交量 < 近5日内最大成交量
    if (!leaderCondVolumeUpChangeLimited(stockName)) return false;          // 条件I（放量时涨幅<5%，放量大跌不限制）
    if (!leaderCondHighHigher(stockName)) return false;                     // 条件J
    if (!leaderCondCloseOpenRatio(stockName)) return false;                  // 条件K
    if (!leaderCondAvg5GeAvg10(stockName)) return false;                     // 条件L
    if (!leaderCondCloseAboveAvg5(stockName)) return false;                 // 条件M
    if (!leaderCondExcludeHot(stockName, sectors, sectorMaps)) return false; // 条件N
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
        const identity = stock.stockKey || resolveStockKey(stock.name);
        const stockDays = daysMap.get(identity) || 0;
        const sectors = stockSectorsMap.get(identity) || [];
        if (passesLeaderConditions(identity, stockDays, sectors, focusSectors, sectorMaps)) {
            starSet.add(identity);
        }
    }
    return starSet;
}

// ============================

/** 统计当前日期与前一日期最高价的可比较情况 */
function getCurrentPriceDataStats() {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    const stats = { total: 0, comparable: 0, missing: 0 };
    if (currentIdx <= 0) return stats;
    const previousDate = sorted[currentIdx - 1];
    for (const stockKey of Object.keys(_stockFieldIndex || {})) {
        const current = _stockFieldIndex[stockKey][currentDateFile];
        if (!current) continue;
        stats.total++;
        const previous = _stockFieldIndex[stockKey][previousDate];
        if (Number.isFinite(current.high) && Number.isFinite(previous?.high)) stats.comparable++;
        else stats.missing++;
    }
    return stats;
}

/**
 * 计算今日推荐股票列表（首页今日推荐区与弹窗【今日推荐】页签共用，保证两处一致）
 * 返回 [{ name, code, net, change, stockDays, sectors, _allSectors }]，按连续天数降序
 */
function calcTodayLeaders() {
    if (_todayLeadersCache
        && _todayLeadersCache.dateFile === currentDateFile
        && _todayLeadersCache.highHigher === LEADER_COND_HIGH_HIGHER
        && _todayLeadersCache.focusRequired === LEADER_COND_FOCUS_REQUIRED
        && _todayLeadersCache.closeOpenRatio === LEADER_COND_CLOSE_OPEN_RATIO
        && _todayLeadersCache.avg5GeAvg10 === LEADER_COND_AVG5_GE_AVG10
        && _todayLeadersCache.closeAboveAvg5 === LEADER_COND_CLOSE_ABOVE_AVG5
        && _todayLeadersCache.excludeHot === LEADER_COND_EXCLUDE_HOT) {
        return _todayLeadersCache.value;
    }
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
    const stockInfo = new Map(); // stockKey→股票字段（取首次出现的字段）
    for (const sector of allCurrentSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = getSectorStocks(sector);
        for (const stock of stocks) {
            if (!stockInfo.has(stock.stockKey)) {
                stockInfo.set(stock.stockKey, stock);
            }
        }
    }

    // 预构建板块 Maps（避免条件判断中重复构建）
    const sectorMaps = buildLeaderSectorMaps();

    // 筛选龙头股票（条件集中在 passesLeaderConditions，加星逻辑也复用，自动同步）
    const leaders = [];
    for (const [stockKey, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockKey) || 0;
        if (!passesLeaderConditions(stockKey, stockDays, sectors, focusSectors, sectorMaps)) continue;

        const info = stockInfo.get(stockKey) || {};
        const sectorNames = sectors
            .filter(s => s.days >= 1)
            .map(s => `${s.name}(${s.type}${s.days}天)`);
        leaders.push({
            name: info.name || stockKey,
            stockKey,
            code: info.code || '',
            net: info.net || '',
            change: info.change || '',
            changePct: info.changePct,
            stockDays: stockDays,
            sectors: sectorNames,
            _allSectors: sectors
        });
    }

    // 按股票连续天数降序排列
    leaders.sort((a, b) => b.stockDays - a.stockDays || a.name.localeCompare(b.name));
    _todayLeadersCache = {
        dateFile: currentDateFile,
        highHigher: LEADER_COND_HIGH_HIGHER,
        focusRequired: LEADER_COND_FOCUS_REQUIRED,
        closeOpenRatio: LEADER_COND_CLOSE_OPEN_RATIO,
        avg5GeAvg10: LEADER_COND_AVG5_GE_AVG10,
        closeAboveAvg5: LEADER_COND_CLOSE_ABOVE_AVG5,
        excludeHot: LEADER_COND_EXCLUDE_HOT,
        value: leaders
    };
    return leaders;
}

function updateLeaderArea(activeData) {
    const container = document.getElementById('leaderContent');
    if (!container) return;

    // 条件J提示：开关开启但当前日期无价格数据时，标注该条件未生效（不影响筛选行为）
    const condHint = document.getElementById('condHighHigherHint');
    if (condHint) {
        const priceStats = getCurrentPriceDataStats();
        if (!LEADER_COND_HIGH_HIGHER || priceStats.total === 0 || priceStats.missing === 0) {
            condHint.textContent = '';
        } else if (priceStats.comparable === 0) {
            condHint.textContent = '（当前日期无可比较价格，未生效）';
        } else {
            condHint.textContent = `（${priceStats.missing}/${priceStats.total} 只缺少可比较价格，仅对其余股票生效）`;
        }
    }

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
        const changeNum = leader.changePct;
        const changeColor = changeNum != null && changeNum >= 0 ? '#e53935' : '#43a047';
        const changeArrow = changeNum != null && changeNum >= 0 ? '▲' : '▼';
        const isPreselected = isStockPreselected(leader.name);
        return `<span class="leader-item leader-clickable${isPreselected ? ' leader-preselected' : ''}" title="连续流入${leader.stockDays}天 | 所属板块: ${leader.sectors.map(s => escapeHtml(s)).join('、')}" data-stock="${escapeHtml(leader.name)}" data-sectors='${secJson}'>
            <span class="leader-name">${escapeHtml(leader.name)}</span>
            <span class="leader-days">${leader.stockDays}天</span>
            <span class="leader-change" style="color:${changeColor}">${changeArrow} ${leader.change}</span>
        </span>`;
    }).join('');
    container.innerHTML = html;
}

/**
 * 计算关注板块的结构化数据（首页关注板块区与弹窗【关注板块】页签共用，保证两处一致）。
 * 返回 { industries, concepts, allPairs, buildDataAttrs(item, type) }
 *   - industries/concepts: [{ name, days, stocks:Set, stockStr }]，未排序
 *   - allPairs: 行业↔概念共同股票配对
 *   - getSectorPayload(name, type): 返回 { matched, stocks, common } 供点击时打开弹窗
 */
function calcFocusSectorsData(activeData) {
    if (_focusDataCache && _focusDataCache.dateFile === currentDateFile && _focusDataCache.data === activeData) {
        return _focusDataCache.value;
    }
    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];

    const industries = filterSectors(industryList, '行业板块资金流向').map(i => ({
        name: i.板块,
        days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
        net: i.主力净额,
        stocks: new Map(getSectorStocks(i).map(s => [s.stockKey, s])),
        stockStr: i.涉及股票
    }));

    const concepts = filterSectors(conceptList, '概念板块资金流向').map(c => ({
        name: c.板块,
        days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
        net: c.主力净额,
        stocks: new Map(getSectorStocks(c).map(s => [s.stockKey, s])),
        stockStr: c.涉及股票
    }));

    // 以股票为中心建立行业↔概念关联，只生成真实存在的组合
    const memberships = new Map();
    for (const industry of industries) {
        for (const stockKey of industry.stocks.keys()) {
            if (!memberships.has(stockKey)) memberships.set(stockKey, { industries: [], concepts: [] });
            memberships.get(stockKey).industries.push(industry);
        }
    }
    for (const concept of concepts) {
        for (const stockKey of concept.stocks.keys()) {
            if (!memberships.has(stockKey)) memberships.set(stockKey, { industries: [], concepts: [] });
            memberships.get(stockKey).concepts.push(concept);
        }
    }
    const pairMap = new Map();
    for (const [stockKey, membership] of memberships) {
        for (const industry of membership.industries) {
            for (const concept of membership.concepts) {
                const key = industry.name + '|' + concept.name;
                if (!pairMap.has(key)) pairMap.set(key, { industry, concept, commonStocks: [] });
                const stock = industry.stocks.get(stockKey) || concept.stocks.get(stockKey);
                pairMap.get(key).commonStocks.push(stock ? stock.name : stockKey);
            }
        }
    }
    const allPairs = [...pairMap.values()].map(pair => ({ ...pair, commonCount: pair.commonStocks.length }));
    const payloadBySectorKey = new Map();

    function buildPayload(item, isIndustry) {
        const targetField = isIndustry ? 'industry' : 'concept';
        const otherField = isIndustry ? 'concept' : 'industry';
        const relatedPairs = allPairs.filter(pair => pair[targetField] === item);
        const matched = relatedPairs.map(pair => ({
            name: pair[otherField].name,
            days: pair[otherField].days,
            commonStocks: pair.commonStocks
        }));
        const common = [...new Set(relatedPairs.flatMap(pair => pair.commonStocks))];
        const stocks = [...item.stocks.values()].map(stock => ({
            name: stock.name,
            code: stock.code,
            stockKey: stock.stockKey,
            net: stock.net,
            netYi: stock.netYi,
            change: stock.change,
            changePct: stock.changePct
        }));
        return { matched, stocks, common };
    }
    for (const item of industries) payloadBySectorKey.set('行业板块资金流向|' + item.name, buildPayload(item, true));
    for (const item of concepts) payloadBySectorKey.set('概念板块资金流向|' + item.name, buildPayload(item, false));

    function getSectorPayload(name, type) {
        return payloadBySectorKey.get(type + '|' + name) || { matched: [], stocks: [], common: [] };
    }

    const value = { industries, concepts, allPairs, payloadBySectorKey, getSectorPayload };
    _focusDataCache = { dateFile: currentDateFile, data: activeData, value };
    return value;
}

function openFocusSector(sectorName, dataType) {
    if (!sectorName || !dataType) return false;
    const { getSectorPayload } = calcFocusSectorsData(getActiveData());
    const { matched, stocks, common } = getSectorPayload(sectorName, dataType);
    const typeLabel = dataType === '行业板块资金流向' ? '🏛️' : '💡';
    showSingleTrendModal(sectorName, dataType, typeLabel + ' ' + sectorName, matched, stocks, new Set(common));
    return true;
}

function updateFocusArea(activeData) {
    const container = document.getElementById('focusContent');
    if (!container) return;
    container.innerHTML = '';

    const { industries, concepts } = calcFocusSectorsData(activeData);

    // 排除热门：过滤掉行业/概念净流入前3名的板块
    let filteredIndustries = industries, filteredConcepts = concepts;
    if (FOCUS_EXCLUDE_HOT) {
        const indList = (activeData.行业板块资金流向 || []).filter(s => condNotPlaceholder(s));
        const conList = (activeData.概念板块资金流向 || []).filter(s => condNotPlaceholder(s));
        const hotInd = new Set([...indList].sort((a, b) => Number(b.主力净额) - Number(a.主力净额)).slice(0, 3).map(s => s.板块));
        const hotCon = new Set([...conList].sort((a, b) => Number(b.主力净额) - Number(a.主力净额)).slice(0, 3).map(s => s.板块));
        filteredIndustries = industries.filter(i => !hotInd.has(i.name));
        filteredConcepts = concepts.filter(c => !hotCon.has(c.name));
    }

    if (filteredIndustries.length === 0 && filteredConcepts.length === 0) {
        container.innerHTML = renderEmptyState('📌', '暂无符合条件的关注板块', '尝试切换日期或调整筛选条件');
        return;
    }

    // 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        filteredIndustries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '行业板块资金流向');
            indSection.appendChild(div);
        });
        container.appendChild(indSection);
    }

    // 2. 渲染概念部分
    {
        const conSection = document.createElement('div');

        filteredConcepts.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '概念板块资金流向');
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}
