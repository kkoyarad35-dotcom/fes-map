import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { EMPTY_BUNDLE, loadBundle } from './data';
import { type DayKey, longLabel, occursOn, relativeLabel, timeLabelFor } from './date';
import {
  FALLBACK_CENTER,
  distanceMeters,
  getCurrentPosition,
  watchPosition,
  type LatLon,
} from './geo';
import { EventMap } from './map';
import { CategoryChips } from './ui/chips';
import { DateStrip } from './ui/dateStrip';
import { PEEK_PX, Sheet } from './ui/sheet';
import { creditBlock, detailView, emptyState, eventCard } from './ui/views';
import { setupUpdateButton } from './update';
import type { EventBundle, EventCategory, EventItem } from './types';

/** 何日先まで見られるようにするか。「1ヶ月先まで」の要件をこれで満たす。 */
const HORIZON_DAYS = 31;
/**
 * 一覧に一度に出す件数。1日に900件を超えることがあり、
 * 全部DOMに出すとシートのスクロールが重くなる。
 */
const LIST_PAGE_SIZE = 60;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

interface State {
  bundle: EventBundle;
  day: DayKey;
  categories: Set<EventCategory>;
  query: string;
  origin: LatLon | null;
  selected: EventItem | null;
  mode: 'list' | 'detail' | 'cluster';
  /** かたまりを押したときに、その中身だけを一覧表示するための保持。 */
  cluster: EventItem[] | null;
  /** 「さらに表示」で増えていく、一覧の表示上限。 */
  listLimit: number;
  /** events.json がまだ届いていない状態。「0件」と「読み込み中」を混同させないため。 */
  loading: boolean;
}

async function boot(): Promise<void> {
  const bootEl = $('boot');

  /*
   * 起動の順番が体感速度をほぼ決める。
   * 以前はイベントJSON（gzip 1.4MB）と現在地の**両方**を待ってから地図を作っていたので、
   * 現在地の許可ダイアログに答えるまで地図が1枚も出なかった（最長8秒＋ユーザーの操作待ち）。
   * いまは地図を最初に作り、JSONと現在地は届いた順に後から流し込む。
   */
  const bundlePromise = loadBundle();
  const positionPromise = getCurrentPosition();

  const state: State = {
    bundle: EMPTY_BUNDLE,
    day: '',
    categories: new Set(),
    query: '',
    origin: null,
    selected: null,
    mode: 'list',
    cluster: null,
    listLimit: LIST_PAGE_SIZE,
    loading: true,
  };

  const sheet = new Sheet($('sheet'), $('sheet-grip'), $('sheet-head'), $('sheet-body'));
  const chips = new CategoryChips($('chips'), (selected) => {
    state.categories = selected;
    state.listLimit = LIST_PAGE_SIZE;
    refresh();
  });
  const strip = new DateStrip($('datestrip'), {
    days: HORIZON_DAYS,
    onSelect: (key) => {
      state.day = key;
      state.selected = null;
      state.mode = 'list';
      state.listLimit = LIST_PAGE_SIZE;
      refresh({ fit: true });
    },
  });
  state.day = strip.value;

  // 現在地はまだ分からないので、いったん東京駅で作る。届いたら寄り直す
  const map = new EventMap($('map'), FALLBACK_CENTER, {
    onSelectEvent: (ev) => selectEvent(ev),
    onSelectCluster: (events, zoomIn) => {
      // 寄れば分かれるなら寄る。同じ会場で分かれないものは中身を一覧で見せる。
      if (zoomIn) zoomIn();
      else showClusterList(events);
    },
    onVisibleChange: (count, markers, mode) => updateViewBadge(count, markers, mode),
  });

  // タイルが出たら起動オーバーレイを外す。イベントの読み込みはまだ続いていてよい
  map.map.once('load', () => {
    bootEl.classList.add('is-hiding');
    window.setTimeout(() => (bootEl.hidden = true), 320);
  });

  // 自分で地図を動かしたあとに現在地へ飛ばすと操作を奪うので、見張っておく
  let userMoved = false;
  map.map.on('movestart', (e) => {
    if ((e as { originalEvent?: unknown }).originalEvent) userMoved = true;
  });

  // ---- 絞り込み ----

  /** 日付以外の条件（カテゴリ・キーワード）を適用した集合。日別件数の計算にも使う。 */
  function baseFiltered(): EventItem[] {
    const q = state.query.trim().toLowerCase();
    return state.bundle.events.filter((ev) => {
      if (state.categories.size > 0 && !state.categories.has(ev.category)) return false;
      if (q) {
        const hay = `${ev.title} ${ev.venue ?? ''} ${ev.address ?? ''} ${ev.organizer ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function forDay(events: EventItem[], day: DayKey): EventItem[] {
    const list = events.filter((ev) => occursOn(ev, day));
    const origin = state.origin;
    if (origin) {
      return list.sort(
        (a, b) =>
          distanceMeters(origin, { lat: a.lat, lon: a.lon }) -
          distanceMeters(origin, { lat: b.lat, lon: b.lon }),
      );
    }
    return list.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  // ---- 描画 ----

  function refresh(opts: { fit?: boolean } = {}): void {
    const base = baseFiltered();
    const dayEvents = forDay(base, state.day);

    // 日付ストリップの点（キーワード・カテゴリ絞り込みを反映した件数）
    const counts = new Map<DayKey, number>();
    for (const key of strip.keys) counts.set(key, 0);
    for (const ev of base) {
      for (const key of strip.keys) {
        if (occursOn(ev, key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    strip.setCounts(counts);

    // カテゴリチップの件数は、その日のイベントだけを数える
    const byCat = new Map<EventCategory, number>();
    const dayAll = state.bundle.events.filter((ev) => occursOn(ev, state.day));
    for (const ev of dayAll) byCat.set(ev.category, (byCat.get(ev.category) ?? 0) + 1);
    chips.setCounts(byCat, dayAll.length);

    map.setEvents(dayEvents);
    map.setSelected(state.selected?.id ?? null);

    if (state.mode === 'detail' && state.selected) {
      renderDetail(state.selected);
    } else if (state.mode === 'cluster' && state.cluster) {
      renderClusterHead(state.cluster.length);
      renderList(state.cluster);
    } else {
      renderHead(dayEvents.length);
      renderList(dayEvents);
    }

    if (opts.fit && dayEvents.length > 0 && !state.origin) map.fitTo(dayEvents.slice(0, 40));
  }

  function renderHead(count: number): void {
    sheet.head.replaceChildren();
    const title = document.createElement('div');
    title.className = 'sheet__title';
    const rel = relativeLabel(state.day);
    title.append(
      document.createTextNode(rel ? `${rel}のイベント` : longLabel(state.day)),
    );
    const c = document.createElement('span');
    c.className = 'sheet__count';
    c.textContent = state.loading ? '読み込み中' : `${count}件`;
    title.appendChild(c);

    const sub = document.createElement('div');
    sub.className = 'sheet__sub';
    sub.textContent = state.loading
      ? 'イベントを読み込んでいます'
      : state.origin
        ? '現在地から近い順'
        : '位置情報が使えないため、開始時刻順で表示しています';

    sheet.head.append(title, sub);
  }

  function renderList(events: EventItem[]): void {
    sheet.body.replaceChildren();
    if (state.loading) {
      // 出典は events.json に入っているので、確定するまでクレジットは出さない
      sheet.body.appendChild(
        emptyState('イベントを読み込んでいます…', '地図はもう動かせます'),
      );
      return;
    }
    if (events.length === 0) {
      sheet.body.appendChild(
        emptyState(
          'この日のイベントは見つかりませんでした',
          '別の日付を選ぶか、絞り込みを外してみてください',
        ),
      );
    } else {
      const shown = events.slice(0, state.listLimit);
      for (const ev of shown) {
        const card = eventCard(ev, state.day, state.origin, ev.id === state.selected?.id);
        card.addEventListener('click', () => selectEvent(ev));
        sheet.body.appendChild(card);
      }

      if (events.length > shown.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = `さらに表示（残り ${events.length - shown.length}件）`;
        more.addEventListener('click', () => {
          state.listLimit += LIST_PAGE_SIZE;
          renderList(events);
        });
        sheet.body.appendChild(more);
      }
    }
    sheet.body.appendChild(creditBlock(state.bundle));
  }

  function renderDetail(ev: EventItem): void {
    sheet.body.replaceChildren();
    sheet.body.scrollTop = 0;
    sheet.body.appendChild(
      detailView(ev, state.day, state.origin, {
        onBack: () => {
          // かたまりから開いたなら、その一覧に戻したほうが迷わない
          state.mode = state.cluster ? 'cluster' : 'list';
          state.selected = null;
          map.setSelected(null);
          refresh();
        },
      }),
    );
    sheet.head.replaceChildren();
    const title = document.createElement('div');
    title.className = 'sheet__title';
    title.textContent = timeLabelFor(ev, state.day);
    sheet.head.appendChild(title);
  }

  function selectEvent(ev: EventItem): void {
    state.selected = ev;
    state.mode = 'detail';
    map.setSelected(ev.id);
    map.focusEvent(ev, PEEK_PX);
    sheet.raiseAtLeast('half');
    renderDetail(ev);
  }

  // ---- 地図上の件数バッジ ----

  const hint = $('hint');
  let hintTimer: number | undefined;
  let badgeText = '';

  /** 表示範囲に何件あるかを常時出す。丸を押せば中身が見られる、の入口。 */
  function updateViewBadge(count: number, markers: number, mode: 'pref' | 'pin'): void {
    if (state.loading) {
      badgeText = 'イベントを読み込んでいます…';
    } else if (count === 0) {
      badgeText = 'この範囲にイベントはありません';
    } else if (mode === 'pref') {
      // 都道府県ごとにまとめている段。丸を押せば1件ずつに分かれる
      badgeText = `この範囲に ${count}件（${markers}都道府県）押すと拡大`;
    } else if (markers < count) {
      // 同じ会場に複数あるぶんだけ、ピンの数が件数より少なくなる
      badgeText = `この範囲に ${count}件（${markers}か所）`;
    } else {
      badgeText = `この範囲に ${count}件`;
    }
    if (hintTimer === undefined) {
      hint.textContent = badgeText;
      hint.hidden = false;
    }
  }

  /** 一時的なお知らせ。消えたら件数バッジに戻す。 */
  function flashMessage(text: string, ms = 3600): void {
    window.clearTimeout(hintTimer);
    hint.textContent = text;
    hint.hidden = false;
    hintTimer = window.setTimeout(() => {
      hintTimer = undefined;
      hint.textContent = badgeText;
      hint.hidden = badgeText === '';
    }, ms);
  }

  // ---- かたまりの中身を一覧で見せる ----

  function showClusterList(events: EventItem[]): void {
    state.cluster = [...events].sort((a, b) => b.scale - a.scale);
    state.mode = 'cluster';
    state.selected = null;
    state.listLimit = LIST_PAGE_SIZE;
    map.setSelected(null);
    sheet.raiseAtLeast('half');
    refresh();
  }

  function renderClusterHead(count: number): void {
    sheet.head.replaceChildren();

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'detail__back';
    back.textContent = '← すべてのイベントに戻る';
    back.addEventListener('click', () => {
      state.cluster = null;
      state.mode = 'list';
      state.listLimit = LIST_PAGE_SIZE;
      refresh();
    });

    const title = document.createElement('div');
    title.className = 'sheet__title';
    title.append(document.createTextNode('この場所のイベント'));
    const c = document.createElement('span');
    c.className = 'sheet__count';
    c.textContent = `${count}件`;
    title.appendChild(c);

    sheet.head.append(back, title);
  }

  // ---- 入力 ----

  const search = $<HTMLInputElement>('search');
  let searchTimer: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = search.value;
      state.selected = null;
      state.mode = 'list';
      state.listLimit = LIST_PAGE_SIZE;
      refresh();
    }, 180);
  });

  const locate = $<HTMLButtonElement>('locate');
  let stopWatch: (() => void) | null = null;
  locate.addEventListener('click', async () => {
    const pos = state.origin ?? (await getCurrentPosition());
    if (!pos) {
      flashMessage('位置情報を取得できませんでした。ブラウザの権限設定をご確認ください。', 4000);
      return;
    }
    state.origin = pos;
    map.setMyLocation(pos);
    map.flyTo(pos, 14);
    locate.classList.add('is-tracking');
    if (!stopWatch) {
      stopWatch = watchPosition((p) => {
        state.origin = p;
        map.setMyLocation(p);
      });
    }
    refresh();
  });

  setupUpdateButton($<HTMLButtonElement>('update'));

  refresh();
  strip.select(state.day, true);

  // ---- 遅れて届くものを、届いた順に反映する ----

  positionPromise.then((pos) => {
    if (!pos) return;
    state.origin = pos;
    map.setMyLocation(pos);
    locate.classList.add('is-tracking');
    // すでに自分で地図を動かしていたら、視点は奪わない
    if (!userMoved) map.flyTo(pos, 14);
    refresh();
  });

  const bundle = await bundlePromise;
  state.bundle = bundle;
  state.loading = false;
  refresh({ fit: true });

  if (bundle.events.length === 0) {
    flashMessage('イベントデータがありません。npm run collect で収集してください。', 10000);
  }
}

boot().catch((err) => {
  console.error(err);
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.textContent = `起動に失敗しました: ${String(err)}`;
});
