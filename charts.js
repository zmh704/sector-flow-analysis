// ===== 主图表（行业/概念板块资金流向柱状图） =====

function prepareChartData(data, count, prevDayData, flowFilter) {
    let positive = [];
    let negative = [];
    if (flowFilter === 'inflow') {
        positive = data.filter(item => Number(item.主力净额) > 0);
    } else {
        // outflow（HTML 仅有 inflow/outflow 两个 radio）
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
        borderRadius: 6,
        hoverBorderWidth: 3,
        hoverBorderColor: chartData.borderColors.map(c => c.replace('0.8', '1'))
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
            borderRadius: 6,
            borderDash: [6, 3] // 虚线区分前一日期
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
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            barPercentage: 0.8,
            categoryPercentage: 0.9,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: { size: 14 },
                        usePointStyle: true,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 30, 40, 0.92)',
                    titleFont: { size: 14 },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
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
                        color: 'rgba(0, 0, 0, 0.1)',
                        drawTicks: false
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
        },
        plugins: [{
            // 零值参考线插件（在 x=0 处绘制虚线）
            id: 'zeroLine',
            beforeDraw: function(chart) {
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                const xScale = chart.scales.x;
                if (!xScale) return;
                const zeroPos = xScale.getPixelForValue(0);
                if (zeroPos < chartArea.left || zeroPos > chartArea.right) return;
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.lineWidth = 1.5;
                ctx.moveTo(zeroPos, chartArea.top);
                ctx.lineTo(zeroPos, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            }
        }, {
            // Top-3 数据标签插件
            id: 'topLabels',
            afterDraw: function(chart) {
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data) return;

                const topCount = Math.min(3, meta.data.length);
                ctx.save();
                ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';

                for (let i = 0; i < topCount; i++) {
                    const bar = meta.data[i];
                    if (!bar || !bar.skip) {
                        const x = bar.x;
                        const y = bar.y;
                        const value = chartData.values[i];
                        if (value == null) continue;
                        const label = (value >= 0 ? '+' : '') + value.toFixed(2) + '亿';
                        ctx.fillStyle = value >= 0 ? '#c62828' : '#2e7d32';
                        const offset = value >= 0 ? 8 : -ctx.measureText(label).width - 8;
                        ctx.fillText(label, x + offset, y);
                    }
                }
                ctx.restore();
            }
        }]
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

// 渲染防抖标志：防止 updateCharts 在异步操作中重入
let _updatingCharts = false;

function updateCharts() {
    try {
        if (_updatingCharts) return;
        _updatingCharts = true;
        setChartLoading(true);

        if (typeof Chart === 'undefined') {
            showWarningStatus('Chart.js 库加载失败，请检查网络连接后刷新页面');
            return;
        }

        updateActiveDataMeta();

        const activeData = getActiveData();
        const prevDayData = getPrevDayData();
        const industryCount = parseInt(document.getElementById('industryCount').value) || 10;
        const conceptCount = parseInt(document.getElementById('conceptCount').value) || 10;

        const industryRadio = document.querySelector('input[name="flowFilterIndustry"]:checked');
        const industryFlowFilter = industryRadio ? industryRadio.value : 'inflow';

        const conceptRadio = document.querySelector('input[name="flowFilterConcept"]:checked');
        const conceptFlowFilter = conceptRadio ? conceptRadio.value : 'inflow';

        const industryPrev = prevDayData?.['行业板块资金流向'] || null;
        const industryData = prepareChartData(activeData.行业板块资金流向 || [], industryCount, industryPrev, industryFlowFilter);
        const ctx1 = document.getElementById('industryChart').getContext('2d');
        industryChart = createChart(ctx1, industryData, '行业板块资金流向', industryChart);

        const conceptPrev = prevDayData?.['概念板块资金流向'] || null;
        const conceptData = prepareChartData(activeData.概念板块资金流向 || [], conceptCount, conceptPrev, conceptFlowFilter);
        const ctx2 = document.getElementById('conceptChart').getContext('2d');
        conceptChart = createChart(ctx2, conceptData, '概念板块资金流向', conceptChart);

        updateLeaderArea(activeData);
        updateFocusArea(activeData);
    } catch (error) {
        console.error('❌ updateCharts 错误:', error);
        showWarningStatus('图表渲染出错: ' + error.message);
    } finally {
        setChartLoading(false);
        _updatingCharts = false;
    }
}

// 防抖版本：供数字输入等高频触发场景使用，300ms 延迟
const debouncedUpdateCharts = debounce(updateCharts, 300);
