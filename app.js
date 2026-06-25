let allDataByDate = {};
let dateFileList = [];
let currentDateFile = null;

let industryChart = null;
let conceptChart = null;
let trendIndustryChart = null;
let trendConceptChart = null;

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

function storeDataForDate(filename, data) {
    const key = filename;
    allDataByDate[key] = {
        filename: filename,
        dateLabel: extractDateLabel(filename),
        data: data
    };

    if (!dateFileList.includes(key)) {
        dateFileList.push(key);
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

    const sorted = [...dateFileList].sort((a, b) => {
        const itemA = allDataByDate[a];
        const itemB = allDataByDate[b];
        return (itemA?.dateLabel || a).localeCompare(itemB?.dateLabel || b);
    });

    const isOverflow = sorted.length > 10;
    const shown = isOverflow ? sorted.slice(-10) : sorted;

    shown.forEach(filename => {
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
        container.appendChild(btn);
    });

    if (isOverflow) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'date-btn';
        moreBtn.textContent = '更多▼';
        moreBtn.onclick = function() {
            container.innerHTML = '';
            sorted.forEach(filename => {
                const item = allDataByDate[filename];
                const btn = document.createElement('button');
                btn.className = 'date-btn';
                btn.textContent = item?.dateLabel || filename;
                btn.onclick = function() {
                    currentDateFile = filename;
                    container.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateCharts();
                };
                if (filename === currentDateFile) {
                    btn.classList.add('active');
                }
                container.appendChild(btn);
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

function resetLoadedData() {
    allDataByDate = {};
    dateFileList = [];
    currentDateFile = null;
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
    } catch (error) {
        statusDiv.textContent = '⚠️ 连接服务器失败: ' + error.message + '。请确保已启动服务器（双击 start.cmd），然后访问 http://localhost:3000';
        return;
    }

    if (fileList.length === 0) {
        statusDiv.textContent = '⚠️ data/ 目录下没有找到板块资金流向 JSON 文件';
        return;
    }

    let loadedCount = 0;
    for (const filename of fileList) {
        try {
            const response = await fetch(filename + '?t=' + Date.now());
            if (response.ok) {
                const data = await response.json();
                storeDataForDate(filename, data);
                loadedCount++;
            }
        } catch (error) {
            console.error(`加载文件 ${filename} 失败:`, error);
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
    flowFilter = flowFilter || 'inflow';

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

    const combined = [
        ...topPositive.sort((a, b) => Number(b.主力净额) - Number(a.主力净额)),
        ...topNegative.sort((a, b) => Number(a.主力净额) - Number(b.主力净额))
    ];

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

    const sorted = [...dateFileList].sort((a, b) => {
        const itemA = allDataByDate[a];
        const itemB = allDataByDate[b];
        return (itemA?.dateLabel || a).localeCompare(itemB?.dateLabel || b);
    });

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

        updateFocusArea(activeData);
    } catch (error) {
        console.error('❌ updateCharts 错误:', error);
        document.getElementById('loadStatus').textContent = '⚠️ 图表渲染出错: ' + error.message;
    }
}

function parseStocks(stockStr) {
    if (!stockStr) return [];
    return stockStr.split(',').map(s => {
        const m = s.trim().match(/^(.+?)\(/);
        return m ? m[1] : null;
    }).filter(Boolean);
}

function updateFocusArea(activeData) {
    const container = document.getElementById('focusContent');
    if (!container) return;
    container.innerHTML = '';

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];

    const industries = industryList
        .filter(i => Number(i.主力净额) > 0)
        .map(i => ({
            name: i.板块,
            days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
            stocks: new Set(parseStocks(i.涉及股票))
        }))
        .filter(i => i.days > 1);

    const concepts = conceptList
        .filter(c => Number(c.主力净额) > 0 && Number(c.股票数量) > 1)
        .map(c => ({
            name: c.板块,
            days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
            stocks: new Set(parseStocks(c.涉及股票))
        }))
        .filter(c => c.days > 1);

    // 1. 建立所有多对多配对
    const allPairs = [];
    industries.forEach(ind => {
        concepts.forEach(con => {
            const common = [...ind.stocks].filter(s => con.stocks.has(s));
            if (common.length > 0) {
                allPairs.push({ industry: ind, concept: con, commonCount: common.length });
            }
        });
    });

    if (allPairs.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的重点关注数据</span>';
        return;
    }

    // 2. 所有只要能配对成功的行业和概念都收集起来（多对多，各自去重）
    const matchedIndustrySet = new Set();
    const matchedConceptSet = new Set();
    const matchedIndustries = [];
    const matchedConcepts = [];
    allPairs.forEach(pair => {
        if (!matchedIndustrySet.has(pair.industry.name)) {
            matchedIndustrySet.add(pair.industry.name);
            matchedIndustries.push(pair.industry);
        }
        if (!matchedConceptSet.has(pair.concept.name)) {
            matchedConceptSet.add(pair.concept.name);
            matchedConcepts.push(pair.concept);
        }
    });

    if (matchedIndustries.length === 0 && matchedConcepts.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的重点关注数据</span>';
        return;
    }

    // 3. 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        matchedIndustries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势及匹配的概念`;
            const daysColor = item.days >= 3 ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const matchedConceptsForIndustry = allPairs
                .filter(p => p.industry.name === item.name)
                .map(p => ({ name: p.concept.name, days: p.concept.days }));
            div.onclick = function() {
                showSingleTrendModal(item.name, '行业板块资金流向', '🏛️ ' + item.name + '（行业）', matchedConceptsForIndustry);
            };
            indSection.appendChild(div);
        });
        container.appendChild(indSection);
    }

    // 4. 渲染概念部分
    {
        const conSection = document.createElement('div');

        matchedConcepts.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势及匹配的行业`;
            const daysColor = item.days >= 3 ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const matchedIndustriesForConcept = allPairs
                .filter(p => p.concept.name === item.name)
                .map(p => ({ name: p.industry.name, days: p.industry.days }));
            div.onclick = function() {
                showSingleTrendModal(item.name, '概念板块资金流向', '💡 ' + item.name + '（概念）', matchedIndustriesForConcept);
            };
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}

function calcConsecutiveInflow(sectorName, type) {
    if (dateFileList.length < 2) return 1;
    if (!currentDateFile) return 1;

    const sorted = [...dateFileList].sort((a, b) => {
        const itemA = allDataByDate[a];
        const itemB = allDataByDate[b];
        return (itemA?.dateLabel || a).localeCompare(itemB?.dateLabel || b);
    });

    const idx = sorted.indexOf(currentDateFile);
    if (idx < 0) return 1;

    let count = 1;

    for (let i = idx - 1; i >= 0; i--) {
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
    const sorted = [...dateFileList].sort((a, b) => {
        const itemA = allDataByDate[a];
        const itemB = allDataByDate[b];
        return (itemA?.dateLabel || a).localeCompare(itemB?.dateLabel || b);
    });

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

    recent.forEach(filename => {
        const entry = allDataByDate[filename];
        dates.push(entry?.dateLabel || filename);

        const dayData = entry?.data;
        if (!dayData) {
            values.push(0);
            return;
        }

        const sectorList = dayData[type] || [];
        const sector = sectorList.find(s => s.板块 === sectorName);
        if (sector) {
            values.push(Number(sector.主力净额) / 100000000);
        } else {
            values.push(0);
        }
    });

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

function showSingleTrendModal(sectorName, type, label, matchedSectors) {
    if (trendIndustryChart) {
        trendIndustryChart.destroy();
        trendIndustryChart = null;
    }
    if (trendConceptChart) {
        trendConceptChart.destroy();
        trendConceptChart = null;
    }

    document.getElementById('trendModalTitle').textContent = label;
    document.getElementById('trendIndustryLabel').textContent = label;

    const trendBoxes = document.querySelectorAll('.trend-chart-box');
    if (trendBoxes.length >= 2) {
        trendBoxes[0].style.display = '';
        trendBoxes[1].style.display = 'none';
    }

    // 渲染匹配的对面板块列表
    const matchedContainer = document.getElementById('trendMatchedSectors');
    if (matchedContainer) {
        matchedContainer.innerHTML = '';
        if (matchedSectors && matchedSectors.length > 0) {
            matchedContainer.style.display = '';
            const otherType = type === '行业板块资金流向' ? '概念' : '行业';
            const otherColor = type === '行业板块资金流向' ? '#7c3aed' : '#2563eb';
            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-weight:600;margin-right:6px;';
            titleSpan.textContent = `匹配的${otherType}：`;
            matchedContainer.appendChild(titleSpan);
            matchedSectors.sort((a, b) => b.days - a.days).forEach((s, i) => {
                const tag = document.createElement('span');
                tag.className = 'pair';
                tag.style.display = 'inline-block';
                tag.style.margin = '2px 6px 2px 0';
                tag.style.padding = '2px 10px';
                tag.style.background = '#fef3c7';
                tag.style.borderRadius = '6px';
                tag.style.fontWeight = '600';
                const sDaysColor = s.days >= 3 ? '#dc2626' : otherColor;
                tag.innerHTML = `<span style="color:${otherColor};">${s.name}</span> <span style="color:${sDaysColor};font-size:11px;">${s.days}天</span>`;
                matchedContainer.appendChild(tag);
            });
        } else {
            matchedContainer.style.display = 'none';
        }
    }

    const trend = getTrendData(sectorName, type);

    const ctx1 = document.getElementById('trendIndustryChart').getContext('2d');
    trendIndustryChart = createBarChart(ctx1, trend, trendIndustryChart);

    document.getElementById('trendModalOverlay').classList.add('active');
}

function closeTrendModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('trendModalOverlay').classList.remove('active');

    const trendBoxes = document.querySelectorAll('.trend-chart-box');
    if (trendBoxes.length >= 2) {
        trendBoxes[0].style.display = '';
        trendBoxes[1].style.display = '';
    }

    const matchedContainer = document.getElementById('trendMatchedSectors');
    if (matchedContainer) {
        matchedContainer.style.display = '';
    }

    if (trendIndustryChart) {
        trendIndustryChart.destroy();
        trendIndustryChart = null;
    }
    if (trendConceptChart) {
        trendConceptChart.destroy();
        trendConceptChart = null;
    }
}