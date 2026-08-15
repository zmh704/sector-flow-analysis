#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
胜率分析 v6 — 条件直接使用 JSON 原始字段(changePct/netYi/amountYi/volumeWanShou/close/open等),
最近一周数据(2026-08-06~08-12), 剔除涨停, 按日 leave-one-out 回测。
"""
import json
import glob
import os
import math
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'outputs')

RECENT_DATES = ['2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12']

def num(v):
    return v if isinstance(v, (int, float)) else float('nan')

def limit_pct(code):
    c = str(code)
    return 19.5 if c.startswith(('300', '301', '688', '689')) else 9.5

def make_conditions():
    """
    条件仅由 JSON 原始字段构成:
      数值字段: changePct(%), netYi(亿), amountYi(亿), volumeWanShou(万手), open/high/low/close(元)
      字段间比较: close vs open/high/low 等
    """
    conds = []
    def add(name, fn):
        conds.append((name, fn))

    # ---- 数值字段阈值(基于JSON原始字段) ----
    for t in [0, 1, 2, 3, 5, 7]:
        add(f'changePct>{t}', lambda f, v=t: f['changePct'] > v)
    for t in [0, 0.5, 1, 2, 3, 5]:
        add(f'netYi>{t}', lambda f, v=t: f['netYi'] > v)
    for t in [10, 30, 50, 80, 100]:
        add(f'amountYi>{t}', lambda f, v=t: f['amountYi'] > v)
    for t in [20, 50, 80, 100]:
        add(f'volumeWanShou>{t}', lambda f, v=t: f['volumeWanShou'] > v)

    # ---- 价格字段间比较(原始字段 open/high/low/close) ----
    add('close>open', lambda f: f['close'] > f['open'])          # 收阳
    add('close>=open', lambda f: f['close'] >= f['open'])         # 平或阳
    add('high>open', lambda f: f['high'] > f['open'])             # 盘中冲过开盘
    add('open<close', lambda f: f['open'] < f['close'])           # 同 close>open
    add('close>low', lambda f: f['close'] > f['low'])             # 未收在最低
    add('close>=high', lambda f: f['close'] >= f['high'])         # 收在最高(封板/一字)
    return conds

def wilson_lo(n, w):
    if n == 0:
        return 0.0
    r = w / n
    z = 1.96
    denom = 1 + z * z / n
    center = (r + z * z / (2 * n)) / denom
    half = z * math.sqrt(r * (1 - r) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half)

def main():
    by = {}
    for d in RECENT_DATES:
        p = os.path.join(DATA_DIR, f'{d}_板块资金流向.v3.json')
        with open(p, encoding='utf-8') as fh:
            by[d] = json.load(fh).get('股票字典', {})

    feat_dates = RECENT_DATES[:-1]
    samples = []
    excluded = 0
    for d in feat_dates:
        nxt = by[RECENT_DATES[RECENT_DATES.index(d) + 1]]
        for sk, det in by[d].items():
            nd = nxt.get(sk)
            if not nd or not isinstance(nd.get('changePct'), (int, float)):
                continue
            chg = det.get('changePct')
            if isinstance(chg, (int, float)) and chg >= limit_pct(det.get('code', '')):
                excluded += 1
                continue
            samples.append((d, sk, det, 1 if nd['changePct'] > 0 else 0))
    N = len(samples)
    labs = [s[3] for s in samples]

    # 条件求值直接使用原始字段
    conds = make_conditions()
    C = len(conds)
    cond_mask = []
    for _, fn in conds:
        m = 0
        for j, s in enumerate(samples):
            det = s[2]
            try:
                if fn(det):
                    m |= (1 << j)
            except Exception:
                pass
        cond_mask.append(m)

    labs_mask = 0
    for j, lab in enumerate(labs):
        if lab:
            labs_mask |= (1 << j)

    day_idx = defaultdict(list)
    for j, s in enumerate(samples):
        day_idx[s[0]].append(j)
    days = feat_dates
    base = sum(labs) / N

    def sub_stats(mask, idxs):
        n = 0
        w = 0
        for j in idxs:
            if (mask >> j) & 1:
                n += 1
                w += labs[j]
        return n, (w / n if n else 0)

    def search_on(train_idx, min_n):
        combos = []
        for i in range(C):
            n, r = sub_stats(cond_mask[i], train_idx)
            if n >= min_n:
                combos.append(([conds[i][0]], cond_mask[i], n, r))
        for a in range(C):
            for b in range(a + 1, C):
                m = cond_mask[a] & cond_mask[b]
                n, r = sub_stats(m, train_idx)
                if n >= min_n:
                    combos.append(([conds[a][0], conds[b][0]], m, n, r))
        for a in range(C):
            for b in range(a + 1, C):
                m2 = cond_mask[a] & cond_mask[b]
                n2, _ = sub_stats(m2, train_idx)
                if n2 < min_n:
                    continue
                for c in range(b + 1, C):
                    m = m2 & cond_mask[c]
                    n, r = sub_stats(m, train_idx)
                    if n >= min_n:
                        combos.append(([conds[a][0], conds[b][0], conds[c][0]], m, n, r))
        best_by_mask = {}
        for names, m, n, r in combos:
            if m not in best_by_mask or (r, -len(names)) > (best_by_mask[m][3], -len(best_by_mask[m][0])):
                best_by_mask[m] = (names, m, n, r)
        flat = list(best_by_mask.values())
        flat.sort(key=lambda x: (-x[3], -x[2]))
        return flat

    print('=' * 84)
    print('胜率分析 v6 — 条件用 JSON 原始字段 (最近一周, 剔除涨停, 按日回测)')
    print('=' * 84)
    print(f'参考数据: {RECENT_DATES[0]} ~ {RECENT_DATES[-1]}  可买样本: {N} (剔除涨停{excluded})')
    print(f'基线次日上涨率: {base*100:.1f}%   条件池: {C} 个(全部为JSON原始字段条件)')
    print()
    print('条件池字段说明:')
    print('  changePct 涨跌幅(%) / netYi 主力净额(亿) / amountYi 成交额(亿)')
    print('  volumeWanShou 成交量(万手) / open/high/low/close 价格(元)')
    print()

    # 全样本 top
    all_top = search_on(list(range(N)), min_n=25)
    print('【最近一周 全样本 top15 (原始字段条件, 样本>=25)】')
    print(f'  {"组合":<46}{"样本":>5}{"胜率":>8}{"95%下限":>9}')
    for names, m, n, r in all_top[:15]:
        lo = wilson_lo(n, round(r * n))
        print(f'  {" & ".join(names):<44}{n:>5}{r*100:>7.1f}%{lo*100:>8.1f}%')
    print()

    # 按日 leave-one-out
    print('【按日 leave-one-out 回测: 3天训练选top20 -> 1天验证】')
    combo_acc = defaultdict(lambda: {'appear': 0, 'te_n': 0, 'te_w': 0})
    for te in range(len(days)):
        te_day = days[te]
        tr_idx = []
        for j in range(len(days)):
            if j != te:
                tr_idx += day_idx[days[j]]
        cands = search_on(tr_idx, min_n=20)[:20]
        te_n_total = 0
        te_w_total = 0
        for names, m, trn, trr in cands:
            tn, tw = 0, 0
            for j in day_idx[te_day]:
                if (m >> j) & 1:
                    tn += 1
                    tw += labs[j]
            if tn >= 3:
                key = ' & '.join(names)
                combo_acc[key]['appear'] += 1
                combo_acc[key]['te_n'] += tn
                combo_acc[key]['te_w'] += tw
            te_n_total += tn
            te_w_total += tw
        own_base = sum(labs[j] for j in day_idx[te_day]) / len(day_idx[te_day])
        print(f'  验证{te_day}: 训练{len(tr_idx)}样本 -> top20, 验证命中{te_n_total}条, '
              f'胜率{te_w_total/te_n_total*100 if te_n_total else 0:.1f}%  (当日基线{own_base*100:.0f}%)')
    print()

    print('【反复回测汇总: 至少2天出现 且 验证样本>=15 的组合】')
    agg = []
    for key, s in combo_acc.items():
        if s['appear'] >= 2 and s['te_n'] >= 15:
            agg.append((key, s['appear'], s['te_n'], s['te_w'] / s['te_n'],
                        wilson_lo(s['te_n'], s['te_w'])))
    agg.sort(key=lambda x: (-x[1], -x[3], -x[2]))
    if agg:
        print(f'  {"组合":<52}{"出现天数":>7}{"验证样本":>8}{"验证胜率":>9}{"95%下限":>9}')
        for key, app, te_n, te_r, lo in agg[:15]:
            print(f'  {key:<50}{app:>7}{te_n:>8}{te_r*100:>8.1f}%{lo*100:>8.1f}%')
        best = sorted(agg, key=lambda x: (-x[3], -x[2]))[0]
        print()
        print('【结论 — 反复回测胜率最高的组合】')
        print(f'  组合: {best[0]}')
        print(f'  验证胜率: {best[3]*100:.1f}%  验证样本: {best[2]}  出现天数: {best[1]}/4')
        print(f'  95%置信下限: {best[4]*100:.1f}%   基线: {base*100:.1f}%')
    else:
        best = None
        print('  无满足条件(>=2天且验证样本>=15)的组合。')
    print()

    os.makedirs(OUT_DIR, exist_ok=True)
    report = {
        'version': 6,
        'condition_source': 'json_raw_fields',
        'data_range': RECENT_DATES,
        'feat_dates': feat_dates,
        'exclude_limit_up': True,
        'excluded_count': excluded,
        'total_samples': N,
        'baseline_winrate': round(base, 4),
        'condition_pool_size': C,
        'full_top': [
            {'combo': names, 'n': n, 'rate': round(r, 4),
             'wilson_lo': round(wilson_lo(n, round(r * n)), 4)}
            for names, m, n, r in all_top[:15]
        ],
        'agg_combos': [
            {'combo': key, 'appear': app, 'test_n': te_n, 'test_rate': round(te_r, 4),
             'wilson_lo': round(lo, 4)}
            for key, app, te_n, te_r, lo in agg
        ],
        'best': (None if not agg else {
            'combo': best[0], 'test_rate': round(best[3], 4), 'test_n': best[2],
            'appear': best[1], 'wilson_lo': round(best[4], 4)
        }),
    }
    path = os.path.join(OUT_DIR, 'winrate_combo_report_v6_raw_fields.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f'报告已保存: {path}')

if __name__ == '__main__':
    main()
