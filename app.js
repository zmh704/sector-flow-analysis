let allDataByDate = {};
let dateFileList = [];
let currentDateFile = null;
let _sortedDateFileList = null;

let industryChart = null;
let conceptChart = null;
let trendChart = null;

Chart.register({
    id: 'alternatingRows',
    beforeDraw: function(chart) {
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const yScale = chart.scales.y;
        if (!yScale || !yScale.ticks || yScale.ticks.length < 2) return;

        ctx.save();

        const ticks = yScale.ticks;
        for (let i = 0; i < ticks.length; i++) {
            if (i % 2 === 0) continue;

            const topY = i === 0
                ? chartArea.top
                : (ticks[i - 1].y + ticks[i].y) / 2;
            const bottomY = i === ticks.length - 1
                ? chartArea.bottom
                : (ticks[i].y + ticks[i + 1].y) / 2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(chartArea.left, topY, chartArea.right - chartArea.left, bottomY - topY);
        }

        ctx.restore();
    }
});

function extractDateLabel(filename) {
    const m1 = filename.match(/(\d{1,2}月\d{1,2}日)/);
    if (m1) return m1[1];

    const m2 = filename.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
    if (m2) return m2[1];

    return filename.replace(/_.*$/, '');
}

/** 将日期标签（如"6月18日"）转为可排序的数字（如 618），解决跨月排序问题 */
function toDateNum(label) {
    const m = label.match(/(\d{1,2})月(\d{1,2})日/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

/** 按日期标签排序 dateFileList，返回排序后的新数组（带缓存） */
function sortDateFileList() {
    if (_sortedDateFileList) return _sortedDateFileList;
    _sortedDateFileList = [...dateFileList].sort((a, b) => {
        const labelA = allDataByDate[a]?.dateLabel || a;
        const labelB = allDataByDate[b]?.dateLabel || b;
        return toDateNum(labelA) - toDateNum(labelB);
    });
    return _sortedDateFileList;
}

function storeDataForDate(filename, data) {
    const key = filename;
    allDataByDate[key] = {
        filename: filename,
        dateLabel: extractDateLabel(filename),
        data: data
    };

    if (!dateFileList.includes(key)) {
        dateFileList.push(key);
        _sortedDateFileList = null;
    }

    // 预解析涉及股票并缓存
    const industryList = data.行业板块资金流向 || [];
    const conceptList = data.概念板块资金流向 || [];
    for (const item of [...industryList, ...conceptList]) {
        if (item.涉及股票) {
            item._parsedStocks = parseStocks(item.涉及股票);
        }
    }
}

function getCurrentData() {
    return currentDateFile ? allDataByDate[currentDateFile] : null;
}

function getActiveData() {
    return getCurrentData()?.data || {
        行业板块资金流向: [],
        概念板块资金流向: [],
        分析总结: null
    };
}

function updateActiveDataMeta() {
    const current = getCurrentData();
    const data = current?.data || {};
    const label = current ? `${current.dateLabel}｜${current.filename}` : '未选择数据';

    const prevDayData = getPrevDayData();
    const prevLabel = prevDayData ? '（黄色为前一日期数据）' : '';

    if (data.生成时间) {
        document.getElementById('generateTime').textContent = data.生成时间;
        document.getElementById('dataDate').textContent = `当前显示：${label}${prevLabel}｜数据生成时间：${data.生成时间}`;
    } else {
        document.getElementById('generateTime').textContent = '-';
        document.getElementById('dataDate').textContent = `当前显示：${label}${prevLabel}`;
    }
}

function renderDateButtons() {
    const container = document.getElementById('dateButtons');
    container.innerHTML = '';

    if (dateFileList.length === 0) {
        container.innerHTML = '<span style="color: #999; font-size: 14px;">暂无数据，请点击「加载数据」</span>';
        return;
    }

    const sorted = sortDateFileList();

    const isOverflow = sorted.length > 10;
    const shown = isOverflow ? sorted.slice(-10) : sorted;

    shown.forEach(filename => {
        container.appendChild(createDateButton(filename));
    });

    if (isOverflow) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'date-btn';
        moreBtn.textContent = '更多▼';
        moreBtn.onclick = function() {
            container.innerHTML = '';
            sorted.forEach(filename => {
                container.appendChild(createDateButton(filename));
            });
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'date-btn';
            collapseBtn.textContent = '收起▲';
            collapseBtn.onclick = function() {
                renderDateButtons();
            };
            container.appendChild(collapseBtn);
        };
        container.appendChild(moreBtn);
    }

    if (!currentDateFile && dateFileList.length > 0) {
        currentDateFile = sorted[sorted.length - 1];
        const btns = container.querySelectorAll('.date-btn');
        if (btns.length > 0) {
            btns[btns.length - 1].classList.add('active');
        }
    }
}

/** 创建日期切换按钮 */
function createDateButton(filename) {
    const item = allDataByDate[filename];
    const btn = document.createElement('button');
    btn.className = 'date-btn';
    btn.textContent = item?.dateLabel || filename;
    btn.onclick = function() {
        currentDateFile = filename;
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCharts();
    };
    if (filename === currentDateFile) {
        btn.classList.add('active');
    }
    return btn;
}

function resetLoadedData() {
    allDataByDate = {};
    dateFileList = [];
    currentDateFile = null;
    _sortedDateFileList = null;
}

async function loadAllJsonFiles() {
    const statusDiv = document.getElementById('loadStatus');
    statusDiv.textContent = '正在扫描并加载数据文件...';

    resetLoadedData();

    let fileList = [];
    try {
        const response = await fetch('/api/list?' + Date.now());
        if (response.ok) {
            fileList = await response.json();
            statusDiv.textContent = `API 返回了 ${fileList.length} 个文件`;
        } else {
            throw new Error('服务器 API 不可用，状态码: ' + response.status);
        }
    } catch (_error) {
        // 本地服务器不可用时，回退到 list.json（GitHub Pages 模式）
        statusDiv.textContent = '⚠️ 本地服务器不可用，尝试通过静态列表加载...';
        try {
            const fallbackResp = await fetch('list.json?t=' + Date.now());
            if (fallbackResp.ok) {
                fileList = await fallbackResp.json();
                statusDiv.textContent = '📄 静态列表返回了 ' + fileList.length + ' 个文件';
            } else {
                throw new Error('list.json 加载失败');
            }
        } catch (_fallbackError) {
            statusDiv.textContent = '⚠️ 数据加载失败：本地服务器和静态列表均不可用。请确保已启动服务器（双击 start.cmd）或部署到 GitHub Pages';
            return;
        }
    }

    if (fileList.length === 0) {
        statusDiv.textContent = '⚠️ data/ 目录下没有找到板块资金流向 JSON 文件';
        return;
    }

    let loadedCount = 0;
    const nowTs = Date.now();
    const results = await Promise.all(fileList.map(async (filename) => {
        try {
            const response = await fetch(filename + '?t=' + nowTs);
            if (response.ok) {
                const data = await response.json();
                return { filename, data };
            }
        } catch (error) {
            console.error(`加载文件 ${filename} 失败:`, error);
        }
        return null;
    }));
    for (const result of results) {
        if (result) {
            storeDataForDate(result.filename, result.data);
            loadedCount++;
        }
    }

    renderDateButtons();

    try {
        updateCharts();
        statusDiv.textContent = `✅ 已加载 ${loadedCount} 个文件`;
    } catch (error) {
        console.error('❌ 渲染图表失败:', error);
        statusDiv.textContent = '⚠️ 数据加载成功，但渲染失败: ' + error.message;
    }

    setTimeout(() => { statusDiv.textContent = ''; }, 4000);
}

window.onload = function() {
    loadAllJsonFiles();
};

function prepareChartData(data, count, prevDayData, flowFilter) {
    let positive = [];
    let negative = [];
    if (flowFilter === 'inflow') {
        positive = data.filter(item => Number(item.主力净额) > 0);
    } else if (flowFilter === 'outflow') {
        negative = data.filter(item => Number(item.主力净额) < 0);
    } else {
        positive = data.filter(item => Number(item.主力净额) > 0);
        negative = data.filter(item => Number(item.主力净额) < 0);
    }

    positive.sort((a, b) => Number(b.主力净额) - Number(a.主力净额));
    negative.sort((a, b) => Number(a.主力净额) - Number(b.主力净额));

    const topPositive = positive.slice(0, count);
    const topNegative = negative.slice(0, count);
    const combined = [...topPositive, ...topNegative];

    const hasPrev = prevDayData && Array.isArray(prevDayData) && prevDayData.length > 0;
    let prevMap = {};
    if (hasPrev) {
        prevDayData.forEach(item => {
            prevMap[item.板块] = Number(item.主力净额);
        });
    }

    const bothPositive = hasPrev ? combined.map(item => {
        const curr = Number(item.主力净额) > 0;
        const prev = prevMap[item.板块] !== undefined ? Number(prevMap[item.板块]) > 0 : false;
        return curr && prev;
    }) : combined.map(() => false);

    return {
        labels: combined.map(item => item.板块),
        values: combined.map(item => Number(item.主力净额) / 100000000),
        rawValues: combined.map(item => Number(item.主力净额)),
        items: combined,
        colors: combined.map(item => Number(item.主力净额) >= 0 ? 'rgba(229, 57, 53, 0.8)' : 'rgba(67, 160, 71, 0.8)'),
        borderColors: combined.map(item => Number(item.主力净额) >= 0 ? 'rgba(229, 57, 53, 1)' : 'rgba(67, 160, 71, 1)'),
        hasPrevData: hasPrev,
        prevValues: hasPrev ? combined.map(item => {
            const pv = prevMap[item.板块];
            return pv !== undefined ? pv / 100000000 : null;
        }) : [],
        prevRawValues: hasPrev ? combined.map(item => {
            return prevMap[item.板块] !== undefined ? prevMap[item.板块] : null;
        }) : [],
        bothPositive: bothPositive
    };
}

function createChart(ctx, chartData, title, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const datasets = [{
        label: '当日主力净额',
        data: chartData.values,
        backgroundColor: chartData.colors,
        borderColor: chartData.borderColors,
        borderWidth: 2,
        borderRadius: 6
    }];

    if (chartData.hasPrevData) {
        datasets.push({
            label: '前一日期主力净额',
            data: chartData.prevValues,
            backgroundColor: 'transparent',
            borderColor: chartData.prevValues.map(value => {
                if (value == null) return 'rgba(150, 150, 150, 0.5)';
                return value > 0 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(34, 197, 94, 0.85)';
            }),
            borderWidth: 3,
            borderRadius: 6
        });
    }

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: datasets
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            barPercentage: 0.8,
            categoryPercentage: 0.9,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: { size: 14 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const datasetIndex = context.datasetIndex;
                            const rawValues = datasetIndex === 0 ? chartData.rawValues : chartData.prevRawValues;
                            const value = rawValues[context.dataIndex];
                            if (value == null) {
                                return context.dataset.label + ': 无数据';
                            }
                            const formatted = (value / 100000000).toFixed(2);
                            const sign = value >= 0 ? '+' : '';
                            return `${context.dataset.label}: ${sign}${formatted} 亿元`;
                        },
                        afterLabel: function(context) {
                            if (context.datasetIndex === 1) return [];
                            const item = chartData.items[context.dataIndex];
                            if (item) {
                                return [
                                    `成交额: ${(item.成交额 / 100000000).toFixed(2)} 亿元`,
                                    `股票数: ${item.股票数量}`
                                ];
                            }
                            return [];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        font: { size: 12 },
                        callback: function(value) {
                            return value + ' 亿';
                        }
                    },
                    title: {
                        display: true,
                        text: '主力净额（亿元）',
                        font: { size: 14, weight: 'bold' }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        font: function(context) {
                            const idx = context.tick?.index;
                            if (idx != null && chartData.bothPositive && chartData.bothPositive[idx]) {
                                return { weight: 'bold', size: 13 };
                            }
                            return { weight: 'normal', size: 12 };
                        },
                        color: function(context) {
                            const idx = context.tick?.index;
                            if (idx != null && chartData.bothPositive && chartData.bothPositive[idx]) {
                                return '#2563eb';
                            }
                            return '#555';
                        }
                    }
                }
            }
        }
    });

    return chart;
}

function getPrevDayData() {
    if (dateFileList.length < 2) return null;
    if (!currentDateFile) return null;

    const sorted = sortDateFileList();

    const idx = sorted.indexOf(currentDateFile);
    if (idx <= 0) return null;

    const prevFilename = sorted[idx - 1];
    const prevData = allDataByDate[prevFilename];
    return prevData?.data || null;
}

function updateCharts() {
    try {
        if (typeof Chart === 'undefined') {
            document.getElementById('loadStatus').textContent = '⚠️ Chart.js 库加载失败，请检查网络连接后刷新页面';
            return;
        }

        updateActiveDataMeta();

        const activeData = getActiveData();
        const prevDayData = getPrevDayData();
        const industryCount = parseInt(document.getElementById('industryCount').value) || 10;
        const conceptCount = parseInt(document.getElementById('conceptCount').value) || 10;

        const flowRadio = document.querySelector('input[name="flowFilter"]:checked');
        const flowFilter = flowRadio ? flowRadio.value : 'inflow';

        const industryPrev = prevDayData?.['行业板块资金流向'] || null;
        const industryData = prepareChartData(activeData.行业板块资金流向 || [], industryCount, industryPrev, flowFilter);
        const ctx1 = document.getElementById('industryChart').getContext('2d');
        industryChart = createChart(ctx1, industryData, '行业板块资金流向', industryChart);

        const conceptPrev = prevDayData?.['概念板块资金流向'] || null;
        const conceptData = prepareChartData(activeData.概念板块资金流向 || [], conceptCount, conceptPrev, flowFilter);
        const ctx2 = document.getElementById('conceptChart').getContext('2d');
        conceptChart = createChart(ctx2, conceptData, '概念板块资金流向', conceptChart);

        updateLeaderArea(activeData);
        updateFocusArea(activeData);
    } catch (error) {
        console.error('❌ updateCharts 错误:', error);
        document.getElementById('loadStatus').textContent = '⚠️ 图表渲染出错: ' + error.message;
    }
}

/** 解析涉及股票字符串为结构化数组 */
function parseStocks(stockStr) {
    if (!stockStr) return [];
    return stockStr.split(',').map(s => {
        const m = s.trim().match(/^(.+?)\(([^)]+)\)$/);
        if (m) {
            if (!m[1] || m[1] === '股票简称') return null;
            const parts = m[2].split('|');
            return {
                name: m[1],
                code: parts[0] || '',
                amount: parts[1] || '',
                net: parts[2] || '',
                change: parts[3] || ''
            };
        }
        const nameOnly = s.trim().match(/^(.+?)\(/);
        if (nameOnly && nameOnly[1] === '股票简称') return null;
        return nameOnly ? { name: nameOnly[1], code: '', amount: '', net: '', change: '' } : null;
    }).filter(Boolean);
}

// 点击股票 → 打开东方财富个股详情页
function openInTDX(stockName, stockCode) {
    if (!stockCode) {
        alert('未找到股票「' + stockName + '」的代码');
        return;
    }
    // A股市场判断：6开头 → sh(上海)，其余 → sz(深圳)
    const exchange = stockCode.startsWith('6') ? 'sh' : 'sz';
    const url = 'https://quote.eastmoney.com/' + exchange + stockCode + '.html';
    window.open(url, '_blank');
}

/** 计算每只股票从当天往前连续主力净额>0的天数 */
function calcStockConsecutiveDays() {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx < 0) return new Map();

    // 预处理：每日期所有股票及其净额状态
    const dateStockMaps = [];
    for (let i = 0; i <= currentIdx; i++) {
        const dayData = allDataByDate[sorted[i]]?.data;
        const dayMap = new Map();
        if (dayData) {
            const allSectors = [
                ...(dayData.行业板块资金流向 || []),
                ...(dayData.概念板块资金流向 || [])
            ];
            for (const sector of allSectors) {
                const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
                for (const stock of stocks) {
                    if (!dayMap.has(stock.name)) {
                        const netNum = parseFloat(stock.net);
                        dayMap.set(stock.name, !isNaN(netNum) && netNum > 0);
                    }
                }
            }
        }
        dateStockMaps.push(dayMap);
    }

    // 从当天往前查连续天数
    const stockDays = new Map();
    const allNames = new Set();
    for (const dayMap of dateStockMaps) {
        for (const name of dayMap.keys()) allNames.add(name);
    }
    for (const name of allNames) {
        let count = 0;
        for (let i = currentIdx; i >= 0; i--) {
            const netPositive = dateStockMaps[i].get(name);
            if (netPositive === true) {
                count++;
            } else {
                break;
            }
        }
        stockDays.set(name, count);
    }

    return stockDays;
}

/** 判断某股票当日成交额是否小于近5日内最大成交额 */
function isStockTurnoverDecreased(stockName, activeData) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    // 取近5日（含当日）数据
    const startIdx = Math.max(0, currentIdx - 4);
    const amounts = [];

    for (let i = startIdx; i <= currentIdx; i++) {
        const dayData = allDataByDate[sorted[i]]?.data;
        if (!dayData) { amounts.push(null); continue; }
        let found = null;
        const allSectors = [
            ...(dayData.行业板块资金流向 || []),
            ...(dayData.概念板块资金流向 || [])
        ];
        for (const sector of allSectors) {
            const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
            for (const stock of stocks) {
                if (stock.name === stockName) {
                    found = parseFloat(stock.amount);
                    break;
                }
            }
            if (found !== null) break;
        }
        amounts.push(found);
    }

    // 需要至少2天数据（含当日）
    const validAmounts = amounts.filter(a => a !== null);
    if (validAmounts.length < 2) return true;

    const current = validAmounts[validAmounts.length - 1];
    const maxPrev = Math.max(...validAmounts.slice(0, -1));
    return current < maxPrev;
}

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

    // 计算哪些板块会在关注板块中显示（净额>0 且 连续流入>=3）
    const focusSectors = new Set();
    for (const sector of industryList) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        if (Number(sector.主力净额) > 0) {
            const d = calcConsecutiveInflow(sector.板块, '行业板块资金流向');
            if (d >= 3) focusSectors.add(sector.板块);
        }
    }
    for (const sector of conceptList) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        if (Number(sector.主力净额) > 0 && Number(sector.股票数量) > 1) {
            const d = calcConsecutiveInflow(sector.板块, '概念板块资金流向');
            if (d >= 3) focusSectors.add(sector.板块);
        }
    }

    // 建立当前日期 股票→所属板块 的映射（过滤占位板块）
    const stockSectors = new Map();
    const stockChange = new Map(); // 股票→涨跌幅
    for (const sector of allCurrentSectors) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        const isIndustry = industryList.includes(sector);
        const type = isIndustry ? '行业板块资金流向' : '概念板块资金流向';
        const sectorDays = calcConsecutiveInflow(sector.板块, type);
        const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
        for (const stock of stocks) {
            if (!stockSectors.has(stock.name)) {
                stockSectors.set(stock.name, []);
                stockChange.set(stock.name, stock.change);
            }
            stockSectors.get(stock.name).push({
                name: sector.板块,
                type: isIndustry ? '行业' : '概念',
                days: sectorDays
            });
        }
    }

    // 筛选龙头股票
    const leaders = [];
    for (const [stockName, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockName) || 0;
        if (stockDays < 3) continue;

        // 至少有一个所属板块在重点关注中
        const inFocus = sectors.some(s => focusSectors.has(s.name));
        if (!inFocus) continue;

        // 成交额小于前一日
        if (!isStockTurnoverDecreased(stockName, activeData)) continue;

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
        .filter(i => Number(i.主力净额) > 0 && i.板块 !== '所属行业' && i.板块 !== '所属概念')
        .map(i => ({
            name: i.板块,
            days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
            stocks: new Set((i._parsedStocks || parseStocks(i.涉及股票)).map(s => s.name))
        }))
        .filter(i => i.days >= 3);

    const concepts = conceptList
        .filter(c => Number(c.主力净额) > 0 && Number(c.股票数量) > 1 && c.板块 !== '所属行业' && c.板块 !== '所属概念')
        .map(c => ({
            name: c.板块,
            days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
            stocks: new Set((c._parsedStocks || parseStocks(c.涉及股票)).map(s => s.name))
        }))
        .filter(c => c.days >= 3);

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
            const daysColor = item.days >= 3 ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
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
            const daysColor = item.days >= 3 ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
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

function calcConsecutiveInflow(sectorName, type) {
    if (dateFileList.length < 2) return 0;
    if (!currentDateFile) return 0;

    const sorted = sortDateFileList();

    const idx = sorted.indexOf(currentDateFile);
    if (idx < 0) return 0;

    let count = 0;

    for (let i = idx; i >= 0; i--) {
        const dayData = allDataByDate[sorted[i]]?.data;
        if (!dayData) break;

        const sectorList = dayData[type] || [];
        const sector = sectorList.find(s => s.板块 === sectorName);

        if (!sector || Number(sector.主力净额) <= 0) {
            break;
        }
        count++;
    }

    return count;
}

// ===== 查看全部弹窗 =====

let modalSortState = { key: 'net', asc: false };
let modalDataType = '';
let modalDataCache = [];

function renderModalTable() {
    const tbody = document.getElementById('modalBody');
    tbody.innerHTML = '';

    if (modalDataCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">暂无数据</td></tr>';
        return;
    }

    const filterInvalid = document.getElementById('filterInvalid').checked;
    let filtered = modalDataCache;
    if (filterInvalid && modalDataType === '概念板块资金流向') {
        filtered = modalDataCache.filter(item => Number(item.股票数量) > 1);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">过滤后无数据，请取消「过滤无效」</td></tr>';
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        let va, vb;
        if (modalSortState.key === 'name') {
            va = a.板块;
            vb = b.板块;
            return modalSortState.asc ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (modalSortState.key === 'net') {
            va = a._val;
            vb = b._val;
        } else if (modalSortState.key === 'turnover') {
            va = a._turnover;
            vb = b._turnover;
        } else if (modalSortState.key === 'days') {
            va = a._days === '-' ? -1 : a._days;
            vb = b._days === '-' ? -1 : b._days;
        } else if (modalSortState.key === 'count') {
            va = a._stockCount;
            vb = b._stockCount;
        }
        return modalSortState.asc ? va - vb : vb - va;
    });

    sorted.forEach(item => {
        const val = item._val;
        const cls = val >= 0 ? 'positive' : 'negative';
        const formattedVal = (val / 100000000).toFixed(2);
        const turnover = (item._turnover / 100000000).toFixed(2);
        const sign = val >= 0 ? '+' : '';

        const sectorStyle = item._highlighted
            ? 'color:#e53935;font-weight:700'
            : '';
        const daysStyle = item._days >= 2 && item._days !== '-'
            ? 'color:#e53935;font-weight:700'
            : 'color:#555';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="${sectorStyle}white-space:nowrap">${item.板块}</td>
            <td style="text-align:right;white-space:nowrap">${sign}${formattedVal} 亿</td>
            <td style="text-align:right;white-space:nowrap">${turnover} 亿</td>
            <td style="text-align:center;${daysStyle}white-space:nowrap">${item._days}</td>
            <td style="text-align:right;white-space:nowrap">${item.股票数量}</td>
            <td style="font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.涉及股票 || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    ['name', 'net', 'turnover', 'days', 'count'].forEach(k => {
        const arrow = document.getElementById('sortArrow' + k.charAt(0).toUpperCase() + k.slice(1));
        if (arrow) {
            if (modalSortState.key === k) {
                arrow.textContent = modalSortState.asc ? '▲' : '▼';
                arrow.className = 'sort-arrow active';
            } else {
                arrow.textContent = '';
                arrow.className = 'sort-arrow';
            }
        }
    });
}

function sortModalTable(key) {
    if (modalSortState.key === key) {
        modalSortState.asc = !modalSortState.asc;
    } else {
        modalSortState.key = key;
        modalSortState.asc = key === 'net';
    }
    renderModalTable();
}

function showAllData(type) {
    const activeData = getActiveData();
    const list = activeData[type] || [];
    const title = type === '行业板块资金流向' ? '🏛️ 全部行业板块' : '💡 全部概念板块';

    document.getElementById('modalTitle').textContent = title;

    modalDataType = type;
    modalDataCache = list.map(item => {
        const val = Number(item.主力净额);
        let days = '-';
        let highlighted = false;
        if (val > 0) {
            days = calcConsecutiveInflow(item.板块, type);
            highlighted = days >= 2;
        }
        return {
            ...item,
            _val: val,
            _turnover: Number(item.成交额),
            _stockCount: Number(item.股票数量),
            _days: days,
            _highlighted: highlighted
        };
    });

    modalSortState = { key: 'days', asc: false };
    renderModalTable();

    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modalOverlay').classList.remove('active');
}

// ===== 趋势对比弹窗 =====

function getTrendData(sectorName, type) {
    const sorted = sortDateFileList();

    let available = sorted;
    if (currentDateFile) {
        const idx = sorted.indexOf(currentDateFile);
        if (idx >= 0) {
            available = sorted.slice(0, idx + 1);
        }
    }

    const recent = available.slice(-10);

    const dates = [];
    const values = [];

    for (const filename of recent) {
        const entry = allDataByDate[filename];
        dates.push(entry?.dateLabel || filename);

        const dayData = entry?.data;
        if (!dayData) {
            values.push(0);
            continue;
        }

        const sectorList = dayData[type] || [];
        const sectorMap = new Map();
        for (const s of sectorList) {
            sectorMap.set(s.板块, s);
        }
        const sector = sectorMap.get(sectorName);
        if (sector) {
            values.push(Number(sector.主力净额) / 100000000);
        } else {
            values.push(0);
        }
    }

    return { dates, values };
}

function createBarChart(ctx, trendData, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const colors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        return v >= 0 ? 'rgba(229, 57, 53, 0.8)' : 'rgba(67, 160, 71, 0.8)';
    });
    const borderColors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        return v >= 0 ? 'rgba(229, 57, 53, 1)' : 'rgba(67, 160, 71, 1)';
    });

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: trendData.dates,
            datasets: [{
                data: trendData.values,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            const sign = val >= 0 ? '+' : '';
                            return `主力净额: ${sign}${val.toFixed(2)} 亿`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '日期',
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.06)'
                    },
                    ticks: {
                        font: { size: 12 }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '主力净额（亿）',
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        font: { size: 12 },
                        callback: function(value) {
                            const sign = value >= 0 ? '+' : '';
                            return sign + value.toFixed(1);
                        }
                    }
                }
            }
        }
    });

    return chart;
}

function getCurrentActiveData() {
    const activeData = allDataByDate[currentDateFile];
    return activeData ? activeData.data : null;
}

/** 渲染股票表格 */
function renderStockTable(panelList, stocks, bgSet, starSet, stockDaysMap) {
    panelList.innerHTML = '';
    if (!stocks || stocks.length === 0) {
        panelList.innerHTML = '<span style="color:#999;">无涉及股票数据</span>';
        return;
    }

    const bs = bgSet || new Set();
    const ss = starSet || bs;
    const sdm = stockDaysMap || new Map();

    // 排序：共同股票（背景色）放前面，其余放后面，各自按主力净额降序
    const commonStocks = stocks.filter(s => bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const otherStocks = stocks.filter(s => !bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const sortedStocks = [...commonStocks, ...otherStocks];

    const table = document.createElement('table');
    table.className = 'stock-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>股票名称</th><th>成交额</th><th>主力净额</th><th>涨跌幅</th><th>连续天数</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedStocks.forEach((stock, i) => {
        const tr = document.createElement('tr');
        const isBg = bs.has(stock.name);
        const isStarred = ss.has(stock.name);
        if (isBg) tr.classList.add('stock-common');
        const escName = stock.name.replace(/'/g, "\\'");
        const changeNum = parseFloat(stock.change);
        const changeColor = changeNum >= 0 ? 'color:#e53935;' : 'color:#43a047;';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        const stockDays = sdm.get(stock.name) || 0;
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${isStarred ? '⭐ ' : ''}${stock.name}</td>
            <td>${stock.amount}</td>
            <td style="${changeColor}">${stock.net}</td>
            <td style="${changeColor}font-weight:600;">${changeArrow} ${stock.change}</td>
            <td style="text-align:center;color:#888;font-size:11px;">${stockDays > 0 ? stockDays + '天' : '-'}</td>
        `;
        tr.style.cursor = 'pointer';
        tr.onclick = function() { openInTDX(escName, stock.code); };
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panelList.appendChild(table);
}

function showStocksInPanel(sectorName, type, commonStockNames) {
    const panelList = document.getElementById('stockPanelList');
    const panelTitle = document.getElementById('stockPanelTitle');
    if (!panelList) return;

    const activeData = getCurrentActiveData();
    if (!activeData) {
        panelList.innerHTML = '<span style="color:#999;">暂无数据</span>';
        return;
    }

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === sectorName);
    if (!sector) {
        panelList.innerHTML = '<span style="color:#999;">未找到该板块数据</span>';
        return;
    }

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

    if (panelTitle) {
        const typeLabel = type === '行业板块资金流向' ? '🏛️' : '💡';
        panelTitle.textContent = `${typeLabel} ${sectorName}`;
    }

    // 计算五角星：股票净流入天数 >= 板块净流入天数
    const sectorDays = calcConsecutiveInflow(sectorName, type);
    const stockDaysMap = calcStockConsecutiveDays();
    const starSet = new Set();
    for (const stock of stocks) {
        const sDays = stockDaysMap.get(stock.name) || 0;
        if (sDays >= sectorDays) starSet.add(stock.name);
    }

    renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
}

/** 切换趋势弹窗的图表和股票面板到指定板块 */
function switchTrendView(sectorName, type, commonStockNames) {
    // 更新图表
    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }
    const trend = getTrendData(sectorName, type);
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = createBarChart(ctx, trend, trendChart);

    // 更新股票面板
    showStocksInPanel(sectorName, type, commonStockNames);
}

function showSingleTrendModal(sectorName, type, label, matchedSectors, stocks, commonStockNames) {
    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }

    const typeIcon = type === '行业板块资金流向' ? '🏛️' : '💡';
    const sectorDays = calcConsecutiveInflow(sectorName, type);
    const titleEl = document.getElementById('trendModalTitle');
    titleEl.innerHTML = `${typeIcon} <span id="trendModalTitleSpan" style="color:#667eea;">${sectorName}</span> <span style="font-size:14px;color:#dc2626;font-weight:700;">${sectorDays}天</span>`;
    titleEl.style.cursor = 'pointer';
    titleEl.title = '切换图表和股票到该板块';
    titleEl.onclick = null;
    titleEl.onclick = function() {
        switchTrendView(sectorName, type, commonStockNames);
    };

    // 渲染匹配的对面板块列表（可点击）
    const matchedContainer = document.getElementById('trendMatchedSectors');
    if (matchedContainer) {
        matchedContainer.innerHTML = '';
        if (matchedSectors && matchedSectors.length > 0) {
            matchedContainer.style.display = '';
            const otherType = type === '行业板块资金流向' ? '概念' : '行业';
            const otherDataType = type === '行业板块资金流向' ? '概念板块资金流向' : '行业板块资金流向';
            const otherColor = type === '行业板块资金流向' ? '#7c3aed' : '#2563eb';
            const matchLabel = type === '行业板块资金流向' ? '相关概念' : '相关行业';
            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-weight:600;margin-right:6px;';
            titleSpan.textContent = `匹配的${matchLabel}：`;
            matchedContainer.appendChild(titleSpan);
            matchedSectors.sort((a, b) => b.days - a.days).forEach((s) => {
                const tag = document.createElement('span');
                tag.className = 'pair clickable';
                const sDaysColor = s.days >= 3 ? '#dc2626' : otherColor;
                tag.innerHTML = `<span style="color:${otherColor};">${s.name}</span> <span style="color:${sDaysColor};font-size:11px;">${s.days}天</span>`;
                tag.title = '点击查看涉及股票';
                const sCommonStocks = s.commonStocks || [];
                tag.onclick = function(e) {
                    e.stopPropagation();
                    const dataType = s._dataType || otherDataType;
                    switchTrendView(s.name, dataType, new Set(sCommonStocks));
                };
                matchedContainer.appendChild(tag);
            });
        } else {
            matchedContainer.style.display = 'none';
        }
    }

    // 默认显示当前板块的股票（共同股票优先）
    if (stocks && stocks.length > 0) {
        const panelTitle = document.getElementById('stockPanelTitle');
        if (panelTitle) {
            panelTitle.textContent = `${typeIcon} ${sectorName}`;
        }
        const panelList = document.getElementById('stockPanelList');
        if (panelList) {
            // 计算五角星：股票净流入天数 >= 板块净流入天数
            const sectorDays = calcConsecutiveInflow(sectorName, type);
            const stockDaysMap = calcStockConsecutiveDays();
            const starSet = new Set();
            for (const stock of stocks) {
                const sDays = stockDaysMap.get(stock.name) || 0;
                if (sDays >= sectorDays) starSet.add(stock.name);
            }
            renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
        }
    } else {
        showStocksInPanel(sectorName, type);
    }

    // 绘制趋势图
    const trend = getTrendData(sectorName, type);
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = createBarChart(ctx, trend, trendChart);

    document.getElementById('trendModalOverlay').classList.add('active');
}

function closeTrendModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('trendModalOverlay').classList.remove('active');

    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }
}

// ==================== 今日龙头弹窗 ====================

function showStockLeader(stockName, sectors) {
    // 选择连续天数最多的板块作为默认显示
    const best = [...sectors].sort((a, b) => b.days - a.days)[0];
    if (!best) return;

    const type = best.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
    const activeData = getCurrentActiveData();
    if (!activeData) return;

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === best.name);
    if (!sector) return;

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

    // 将股票所属的所有其他板块作为匹配板块展示
    const matchedSectors = sectors
        .filter(s => s.name !== best.name)
        .map(s => ({
            name: s.name,
            days: s.days,
            commonStocks: [stockName],
            _dataType: s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向'
        }));

    showSingleTrendModal(
        best.name, type,
        `🐉 ${stockName} → ${best.name}(${best.type})`,
        matchedSectors, stocks,
        new Set([stockName])
    );
}

// ==================== 解析数据 ====================

function parseExcelFile() {
    document.getElementById('excelFileInput').click();
}

async function handleExcelFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusDiv = document.getElementById('loadStatus');
    statusDiv.textContent = '⏳ 正在上传并解析Excel文件...';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || '服务器解析失败');
        }

        const result = await response.json();
        statusDiv.textContent = `✅ 解析完成：${result.industries} 个行业，${result.concepts} 个概念`;

        // 刷新数据
        await loadAllJsonFiles();

    } catch (err) {
        console.error('解析失败:', err);
        statusDiv.textContent = '❌ 解析失败: ' + err.message;
    } finally {
        event.target.value = '';
    }
}