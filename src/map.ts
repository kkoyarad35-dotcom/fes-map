import maplibregl, {
  Map as MapLibreMap,
  Marker,
  type LngLatLike,
  type StyleSpecification,
} from 'maplibre-gl';
import { CATEGORY_META, type EventCategory, type EventItem } from './types';
import type { LatLon } from './geo';

import { PREF_CENTERS } from './pref-centers';
import mapStyle from './map-style.json';

/**
 * 下地は OpenFreeMap（OpenStreetMap のベクトルタイル）。APIキー不要・無料。
 * Googleマップ／タイムズカーシェアのような色付きの地図で、公園・道路・水面が色で分かる。
 * スタイルは scripts/build-map-style.mjs が日本語表記に直して同梱したもの。
 *
 * 以前は地理院タイルの淡色地図（ラスタ）だった。軽いが色が無く、場所の見当がつけにくかった。
 */
const BASE_STYLE = mapStyle as unknown as StyleSpecification;

/**
 * 表示の段は2つだけ。
 *
 * - このズーム未満 … **都道府県ごと**にまとめた数字丸（「東京都 42件」）
 * - このズーム以上 … イベント **1件ずつ** のピン。座標はそのイベントの実際の位置
 *
 * 間に「画面ピクセルのグリッドでまとめる」段を挟んでいたのをやめた。
 * グリッドだと、数字丸を押して寄っても同じグリッドに入り直して分かれず、
 * 丸の位置も中身の重心（＝イベントが無い場所）になっていた。
 */
const PIN_ZOOM = 9;
/** 県の丸の大きさ（px）。1件のとき MIN、件数が増えると MAX まで大きくなる。 */
const PREF_MIN_PX = 20;
const PREF_MAX_PX = 40;
/**
 * 県が小さくてもこれ以上は縮めない。数字が読める大きさを保つ。
 * 以前は8pxまで縮めて県の枠に収めていたが、数字の無い点ばかりになって読めなかった。
 * 枠からはみ出す分は、丸どうしを押し離して（layoutPrefs）重ならないようにする。
 */
const PREF_DOT_PX = 22;
/** 丸どうしの最低限のすき間（px）。 */
const PREF_GAP_PX = 3;

/**
 * 県の形から求めた真ん中だと、地図の都市名と離れて見える県。
 * 東京都は多摩の山まで含むので真ん中が奥多摩寄りになり、「東京都」の文字から遠かった。
 */
const ANCHOR_OVERRIDES: Record<string, LatLon> = {
  '東京都': { lat: 35.6895, lon: 139.6917 }, // 都庁
};
/** これより小さい丸では数字が読めないので出さない。 */
const PREF_NUMBER_MIN_PX = 16;
/** 丸の下に出す県名の高さ（px）。 */
const PREF_NAME_PX = 16;
/** 一度に描くDOMマーカーの上限。1日分に絞られているので、普通はここまで来ない。 */
const MAX_MARKERS = 600;
/** このズーム以上で、ピンにイベント名を出す。 */
const LABEL_FROM_ZOOM = 12.5;
/**
 * ピンの丸（座標を指している部分）の画面上の大きさ。
 * この丸の中心がイベントの座標に一致する。
 */
const HEAD_PX = 30;

/** 1件のイベントと、その現在の画面座標。 */
interface Projected {
  ev: EventItem;
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface EventMapCallbacks {
  onSelectEvent: (ev: EventItem) => void;
  /**
   * まとまった丸を押したとき（都道府県の丸、または同じ会場で重なっているピン）。
   * `zoomIn` があれば、それを呼べば1件ずつに分かれるズームまで寄る。
   * `null` は座標が同じで**これ以上ズームしても分かれない**ので、一覧で見せるしかない。
   */
  onSelectCluster: (events: EventItem[], zoomIn: (() => void) | null) => void;
  /** 表示中の件数とマーカーの数。「この範囲に◯件」表示用。 */
  onVisibleChange: (visibleCount: number, markerCount: number, mode: 'pref' | 'pin') => void;
}

export class EventMap {
  readonly map: MapLibreMap;
  private markers: Marker[] = [];
  private meMarker: Marker | null = null;
  private events: EventItem[] = [];
  private selectedId: string | null = null;
  private cb: EventMapCallbacks;
  private ready = false;
  /** scheduleRender() が取った requestAnimationFrame のID。二重描画を防ぐ。 */
  private frame: number | null = null;
  /** 県の丸の大きさをズームに合わせ直す関数。描き直しを待たずにズーム中も追従させる。 */
  private prefSizers: ((zoom: number) => void)[] = [];
  /** 重なりを避けるために、県の丸の位置と今の大きさを持っておく。 */
  private prefLayout: { marker: Marker; anchor: LatLon; size: () => number }[] = [];

  constructor(container: HTMLElement, center: LatLon, cb: EventMapCallbacks) {
    this.cb = cb;
    this.map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [center.lon, center.lat],
      zoom: 12,
      minZoom: 4,
      maxZoom: 18,
      attributionControl: { compact: true },      // 傾き・回転は今回のUIでは使わないので切って、誤操作を防ぐ
      pitchWithRotate: false,
      dragRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    // 開発中だけ、画面確認のスクリプトから地図を動かせるようにしておく
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = this.map;
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    this.map.on('load', () => {
      this.ready = true;
      this.render();
    });
    // 1回の操作で moveend と zoomend の両方が飛んでくるので、次のフレームまでまとめる
    this.map.on('moveend', () => this.scheduleRender());
    this.map.on('zoomend', () => this.scheduleRender());
    // ズームの途中でも丸の大きさと重なりよけを毎フレーム直す
    this.map.on('zoom', () => {
      const zoom = this.map.getZoom();
      for (const apply of this.prefSizers) apply(zoom);
      if (this.prefLayout.length > 0) this.layoutPrefs();
    });
  }

  /** 表示対象のイベント集合を差し替える（日付やカテゴリのフィルタ後の配列）。 */
  setEvents(events: EventItem[]): void {
    this.events = events;
    this.scheduleRender();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.scheduleRender();
  }

  /** 現在地の青い点。 */
  setMyLocation(pos: LatLon): void {
    if (!this.meMarker) {
      const el = document.createElement('div');
      el.className = 'me-dot';
      el.innerHTML = '<span class="me-pulse"></span><span class="me-core"></span>';
      this.meMarker = new maplibregl.Marker({ element: el })
        .setLngLat([pos.lon, pos.lat])
        .addTo(this.map);
    } else {
      this.meMarker.setLngLat([pos.lon, pos.lat]);
    }
  }

  flyTo(pos: LatLon, zoom?: number): void {
    this.map.flyTo({
      center: [pos.lon, pos.lat],
      zoom: zoom ?? Math.max(this.map.getZoom(), 14),
      speed: 1.4,
      essential: true,
    });
  }

  /** 選択中のイベントが下部シートに隠れないよう、少し上にずらして寄る。 */
  focusEvent(ev: EventItem, bottomInsetPx: number): void {
    this.map.easeTo({
      center: [ev.lon, ev.lat],
      zoom: Math.max(this.map.getZoom(), 15),
      offset: [0, -bottomInsetPx / 2],
      duration: 500,
    });
  }

  /**
   * 渡したイベントが収まるところまで動かす。
   *
   * `minZoom` を渡すと、範囲に収めるだけでは足りなくてもそのズームまでは必ず寄る。
   * 都道府県の丸を押したときに1件ずつへ分かれるのは、これが効いているから
   * （`fitBounds` には「最低このズームまで」が無い）。
   * 底上げが必要になった場合は範囲の中心ではなく `preferCenter` に寄る。
   * 東京都のように離島まで含む県だと、範囲の中心が太平洋の上になるため。
   */
  fitTo(events: EventItem[], opts: { minZoom?: number; preferCenter?: LatLon } = {}): void {
    if (events.length === 0) return;
    const minZoom = opts.minZoom ?? 0;

    if (events.length === 1) {
      this.flyTo({ lat: events[0].lat, lon: events[0].lon }, Math.max(16, minZoom));
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    for (const e of events) bounds.extend([e.lon, e.lat]);
    const padding = { top: 140, bottom: 260, left: 40, right: 40 };

    const camera = this.map.cameraForBounds(bounds, { padding, maxZoom: 17 });

    // 範囲に収めるだけで minZoom に届くなら、素直にフィットさせる
    if (camera?.zoom === undefined || camera.zoom >= minZoom) {
      this.map.fitBounds(bounds, { padding, maxZoom: 17, duration: 600 });
      return;
    }

    const center: LngLatLike = opts.preferCenter
      ? [opts.preferCenter.lon, opts.preferCenter.lat]
      : (camera.center ?? bounds.getCenter());
    this.map.easeTo({ center, zoom: minZoom, offset: [0, -60], duration: 600 });
  }

  private clearMarkers(): void {
    for (const m of this.markers) m.remove();
    this.markers = [];
    this.prefSizers = [];
    this.prefLayout = [];
  }

  /**
   * 県の丸が重なったら押し離す。大きい丸（件数の多い県）ほど動かさない。
   * 47個しかないので総当たりで足りる。ズーム中も毎フレーム呼ぶ。
   */
  private layoutPrefs(): void {
    const items = this.prefLayout.map((it) => {
      const p = this.map.project([it.anchor.lon, it.anchor.lat]);
      return { it, x0: p.x, y0: p.y, x: p.x, y: p.y, r: it.size() / 2 + PREF_GAP_PX / 2 };
    });

    for (let iter = 0; iter < 40; iter += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r;
          if (d >= min) continue;
          if (d < 0.01) {
            // 同じ位置なら、ずらす向きを決められないので横に逃がす
            dx = 1;
            dy = 0;
            d = 1;
          }
          const push = min - d;
          const wa = b.r / (a.r + b.r);
          a.x -= (dx / d) * push * wa;
          a.y -= (dy / d) * push * wa;
          b.x += (dx / d) * push * (1 - wa);
          b.y += (dy / d) * push * (1 - wa);
          moved = true;
        }
      }
      if (!moved) break;
    }

    for (const p of items) p.it.marker.setOffset([p.x - p.x0, p.y - p.y0]);
  }

  /**
   * 描画を次のフレームまでまとめる。
   * moveend + zoomend の二重描画や、refresh() の setEvents→setSelected の連続を1回にする。
   */
  private scheduleRender(): void {
    if (!this.ready || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    if (!this.ready) return;
    this.clearMarkers();

    const zoom = this.map.getZoom();
    const inView = this.projectInView();

    if (zoom < PIN_ZOOM) this.renderPrefectures(inView);
    else this.renderPins(inView, zoom);

    this.cb.onVisibleChange(inView.length, this.markers.length, zoom < PIN_ZOOM ? 'pref' : 'pin');
  }

  /**
   * 画面に入っているイベントを、画面座標つきで取り出す。
   * 座標変換はここ1回だけ。あとの判定は全部この結果を使う。
   */
  private projectInView(): Projected[] {
    // 画面外を描いても意味がないので、少し広げた範囲だけを対象にする
    const bounds = this.map.getBounds();
    const padX = (bounds.getEast() - bounds.getWest()) * 0.2;
    const padY = (bounds.getNorth() - bounds.getSouth()) * 0.2;
    const west = bounds.getWest() - padX;
    const east = bounds.getEast() + padX;
    const south = bounds.getSouth() - padY;
    const north = bounds.getNorth() + padY;

    const out: Projected[] = [];
    for (const ev of this.events) {
      if (ev.lon < west || ev.lon > east || ev.lat < south || ev.lat > north) continue;
      const p = this.map.project([ev.lon, ev.lat]);
      out.push({ ev, x: p.x, y: p.y });
    }
    return out;
  }

  // ---- 引いたとき: 都道府県ごとの数字丸 ----

  private renderPrefectures(items: Projected[]): void {
    const groups = new Map<string, Projected[]>();
    for (const item of items) {
      const key = item.ev.pref ?? 'その他';
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }

    // 件数の多い県から置く。上限に当たっても主要な県は残る
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [name, group] of sorted.slice(0, MAX_MARKERS)) this.addPrefCircle(name, group);
    this.layoutPrefs();
  }

  private addPrefCircle(name: string, group: Projected[]): void {
    const n = group.length;
    const events = group.map((it) => it.ev);
    /*
     * 丸は地図上の**その県の真ん中**（src/pref-centers.ts）に置く。
     * 以前は「県内イベントの重心にいちばん近いイベント」に置いていたが、
     * イベントが県境や県庁所在地に偏っていると、丸が隣の県の上に乗って見えた。
     * 県庁所在地に置く案も試したが、関東・関西で丸が重なり合って読めなかった。
     * 表に無い名前（「その他」）だけ従来どおりイベントの上に置く。
     */
    const center = PREF_CENTERS[name];
    const anchor: LatLon = ANCHOR_OVERRIDES[name] ?? center ?? nearestToCentroid(group).ev;
    const meta = CATEGORY_META[topCategory(events)] ?? CATEGORY_META.other;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pref';
    el.style.setProperty('--pin-color', meta.color);
    el.setAttribute('aria-label', `${name} ${n}件。押すと1件ずつ表示されるところまで拡大します`);

    const count = document.createElement('span');
    count.className = 'pref__count';
    count.textContent = String(n);
    el.appendChild(count);

    const label = document.createElement('span');
    label.className = 'pref__name';
    label.textContent = name;
    el.appendChild(label);

    /*
     * 丸は県の枠からはみ出さない大きさにする。
     * 件数で決めた大きさを、「中心から県境までの距離（km）」を今のズームでピクセルに
     * 直した値で頭打ちにする。東京都や大阪府のような小さい県は、引くほど小さくなる。
     * 小さすぎて数字が読めない大きさでは数字を消し、県名も枠に収まるときだけ出す。
     */
    const wanted = Math.min(PREF_MIN_PX + Math.log2(n) * 5, PREF_MAX_PX);
    const labelWidth = name.length * 11 + 12;
    let current = wanted;
    const applySize = (zoom: number) => {
      let size = wanted;
      let showName = true;
      if (center) {
        const radius = (center.km * 1000) / metersPerPixel(center.lat, zoom);
        size = Math.max(Math.min(wanted, radius * 2), PREF_DOT_PX);
        // 名前は丸の下に出るので、丸の半径＋名前の高さと、名前の幅の半分が県の中に収まるか
        showName = radius >= size / 2 + 3 + PREF_NAME_PX && radius >= labelWidth / 2;
      }
      current = size;
      el.style.setProperty('--pref-size', `${size}px`);
      el.style.setProperty('--pref-font', `${Math.max(Math.round(size * 0.42), 9)}px`);
      count.hidden = size < PREF_NUMBER_MIN_PX;
      label.hidden = !showName;
    };
    applySize(this.map.getZoom());
    this.prefSizers.push(applySize);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      // 必ず PIN_ZOOM まで寄る。ここで底上げしないと、県全体に収めただけで
      // まだ PIN_ZOOM に届かず、押しても数字のままになる
      this.cb.onSelectCluster(events, () =>
        this.fitTo(events, {
          minZoom: PIN_ZOOM,
          preferCenter: anchor,
        }),
      );
    });

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([anchor.lon, anchor.lat])
      .addTo(this.map);
    this.markers.push(marker);
    this.prefLayout.push({ marker, anchor, size: () => current });
  }

  // ---- 寄ったとき: 1件ずつのピン ----

  private renderPins(items: Projected[], zoom: number): void {
    /*
     * まとめるのは「座標が完全に同じ」ものだけ。つまり同じ会場で開かれている複数の催し。
     * 座標が同じなのでいくらズームしても離れず、重ねるしかない。
     * それ以外は1件1ピンで、必ずそのイベントの座標の上に立つ。
     */
    const stacks = new Map<string, Projected[]>();
    for (const item of items) {
      const key = `${item.ev.lat.toFixed(5)},${item.ev.lon.toFixed(5)}`;
      const stack = stacks.get(key);
      if (stack) stack.push(item);
      else stacks.set(key, [item]);
    }

    const list = [...stacks.values()];
    // 同じ会場の中では規模の大きいものを代表にする
    for (const stack of list) stack.sort((a, b) => b.ev.scale - a.ev.scale);
    // 上限に当たったときに残るのが「選択中」と「規模の大きいもの」になるように並べる
    list.sort((a, b) => {
      const selA = a.some((it) => it.ev.id === this.selectedId) ? 1 : 0;
      const selB = b.some((it) => it.ev.id === this.selectedId) ? 1 : 0;
      if (selA !== selB) return selB - selA;
      return b[0].ev.scale - a[0].ev.scale;
    });

    const placed: Rect[] = [];
    for (const stack of list.slice(0, MAX_MARKERS)) this.addPin(stack, zoom, placed);
  }

  private addPin(stack: Projected[], zoom: number, placed: Rect[]): void {
    // 選択中のものがこの会場にあるなら、それを表に出す
    const head = stack.find((it) => it.ev.id === this.selectedId) ?? stack[0];
    const ev = head.ev;
    const extra = stack.length - 1;
    const meta = CATEGORY_META[ev.category] ?? CATEGORY_META.other;
    const selected = ev.id === this.selectedId;

    const label = ev.title.length > 16 ? `${ev.title.slice(0, 16)}…` : ev.title;

    // 丸の中心がイベントの座標。名前はそこから右に伸びるだけで位置に影響しないので、
    // ぶつかり判定だけを右へ広げる。
    const half = HEAD_PX / 2;
    const iconRect: Rect = { x: head.x - half, y: head.y - half, w: HEAD_PX, h: HEAD_PX };
    const labelWidth = Math.min(label.length * 12 + 16, 180);
    const labelRect: Rect = { ...iconRect, w: half + 5 + labelWidth };

    // 名前を出すと横に広がるぶん、隣のピンとぶつかりやすくなる。
    // 先に置いたものとぶつかる場合は、名前を落としてアイコンだけにする。
    const wantsLabel = zoom >= LABEL_FROM_ZOOM || selected;

    let showLabel = false;
    if (wantsLabel && !placed.some((r) => intersects(labelRect, r))) {
      showLabel = true;
      placed.push(labelRect);
    } else {
      placed.push(iconRect);
    }

    const el = document.createElement('button');
    el.type = 'button';
    el.className = `pin${selected ? ' pin--selected' : ''}`;
    el.style.setProperty('--pin-color', meta.color);
    el.setAttribute(
      'aria-label',
      extra > 0 ? `${ev.title} ほか${extra}件（同じ会場）` : ev.title,
    );

    const headEl = document.createElement('span');
    headEl.className = 'pin__head';
    headEl.textContent = meta.emoji;
    el.appendChild(headEl);

    if (showLabel) {
      const span = document.createElement('span');
      span.className = 'pin__label';
      span.textContent = label;
      el.appendChild(span);
    }

    // 同じ会場に他にもあることは、丸の位置を変えずに肩のバッジで示す
    if (extra > 0) {
      const badge = document.createElement('span');
      badge.className = 'pin__badge';
      badge.textContent = `+${extra}`;
      el.appendChild(badge);
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      // 座標が同じものは寄っても分かれないので、一覧で見せる（zoomIn は null）
      if (extra > 0) this.cb.onSelectCluster(stack.map((it) => it.ev), null);
      else this.cb.onSelectEvent(ev);
    });

    this.markers.push(
      // 丸の中心をイベントの座標に合わせる。名前は絶対配置でこの箱の外に出してある
      new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([ev.lon, ev.lat])
        .addTo(this.map),
    );
  }
}

/** そのズームで1ピクセルが何メートルか（MapLibre は 512px タイル基準）。 */
function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** 重心にいちばん近い1件。丸を必ず実在のイベントの上に置くために使う。 */
function nearestToCentroid(items: Projected[]): Projected {
  let sumX = 0;
  let sumY = 0;
  for (const it of items) {
    sumX += it.x;
    sumY += it.y;
  }
  const cx = sumX / items.length;
  const cy = sumY / items.length;

  let best = items[0];
  let bestDistance = Infinity;
  for (const it of items) {
    const d = (it.x - cx) ** 2 + (it.y - cy) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = it;
    }
  }
  return best;
}

/** いちばん多いカテゴリ。丸の色に使う。 */
function topCategory(events: EventItem[]): EventCategory {
  const counts = new Map<EventCategory, number>();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);

  let top: EventCategory = 'other';
  let max = -1;
  for (const [category, n] of counts) {
    if (n > max) {
      max = n;
      top = category;
    }
  }
  return top;
}
