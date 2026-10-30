import { type DayKey, isMultiDay, longLabel, periodLabel, timeLabelFor } from '../date';
import { distanceMeters, formatDistance, type LatLon } from '../geo';
import { CATEGORY_META, type EventBundle, type EventItem } from '../types';

/** 'https://www.example.com/a/b' → 'example.com'。表示用なので失敗しても落とさない。 */
export function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * 公式サイトが分からないイベント（自治体CSVはURL列が空のことが多い）向けの逃げ道。
 * イベント名と会場でウェブ検索させる。
 */
function searchUrl(ev: EventItem): string {
  const q = [ev.title, ev.venue ?? ev.address ?? ''].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function externalLink(href: string, text: string, className: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

function row(dt: string, dd: string | Node): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'detail__row';
  const t = document.createElement('dt');
  t.textContent = dt;
  const d = document.createElement('dd');
  if (typeof dd === 'string') d.textContent = dd;
  else d.appendChild(dd);
  el.append(t, d);
  return el;
}

/** 「🎡 動物園・遊園地・🧸 アニメ」のように、入っているカテゴリを全部並べる。 */
function categoryLabel(ev: EventItem): string {
  return (ev.categories ?? [ev.category])
    .map((c) => {
      const m = CATEGORY_META[c] ?? CATEGORY_META.other;
      return `${m.emoji} ${m.label}`;
    })
    .join('　');
}

/** 一覧に出す紹介文。説明文の空白を詰めただけのもの（行数は CSS で切る）。 */
function summaryOf(ev: EventItem): string | null {
  const text = ev.description?.replace(/\s+/g, ' ').trim();
  if (!text || text === ev.title) return null;
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/** 一覧の1件分。距離が分かるときは右端に出す。 */
export function eventCard(
  ev: EventItem,
  dayKey: DayKey,
  origin: LatLon | null,
  active: boolean,
): HTMLButtonElement {
  const meta = CATEGORY_META[ev.category] ?? CATEGORY_META.other;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `card${active ? ' is-active' : ''}`;
  card.style.setProperty('--cat-color', meta.color);
  card.dataset.id = ev.id;

  /*
   * サムネイル。4,979件のうち4,912件が画像を持っているので、一覧の見分けはこれが主役。
   * 画像は絵文字タイルの**上**に重ねるだけにしておき、読み込みに失敗したら
   * <img> を消す。そうすると下の絵文字がそのまま出るので、穴が空かない。
   */
  const thumb = document.createElement('span');
  thumb.className = 'card__thumb';

  const emoji = document.createElement('span');
  emoji.className = 'card__emoji';
  emoji.textContent = meta.emoji;
  thumb.appendChild(emoji);

  if (ev.imageUrl) {
    /*
     * 写真は縦長・横長・ロゴ入りのチラシとまちまちなので、切り抜くと肝心な所が見切れる。
     * 同じ写真をぼかして下に敷き、その上に全体が収まる大きさ（contain）で重ねる。
     */
    const make = (className: string): HTMLImageElement => {
      const img = document.createElement('img');
      img.className = className;
      img.src = ev.imageUrl!;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // 共有URLを画像の配信元に渡さない（配信ヘッダ側でも no-referrer にしてある）
      img.referrerPolicy = 'no-referrer';
      return img;
    };
    const backdrop = make('card__img card__img--backdrop');
    const img = make('card__img');
    img.addEventListener('error', () => {
      img.remove();
      backdrop.remove();
    });
    thumb.append(backdrop, img);
  }

  const main = document.createElement('span');
  main.className = 'card__main';

  // 何のイベントかを先に見せる。期間よりカテゴリと中身の紹介を優先する
  const cat = document.createElement('span');
  cat.className = 'card__cat';
  cat.textContent = categoryLabel(ev);

  const title = document.createElement('span');
  title.className = 'card__title';
  title.textContent = ev.title;

  main.append(cat, title);

  const summary = summaryOf(ev);
  if (summary) {
    const desc = document.createElement('span');
    desc.className = 'card__desc';
    desc.textContent = summary;
    main.appendChild(desc);
  }

  // 日時と場所は1行に控えめに。期間の詳しい表示は詳細画面に任せる
  const metaRow = document.createElement('span');
  metaRow.className = 'card__meta';
  const time = document.createElement('span');
  time.className = 'card__time';
  time.textContent = isMultiDay(ev) ? `${periodLabel(ev)}` : timeLabelFor(ev, dayKey);
  metaRow.appendChild(time);
  if (ev.venue || ev.address) {
    const venue = document.createElement('span');
    venue.className = 'card__venue';
    venue.textContent = `📍 ${ev.venue || ev.address || ''}`;
    metaRow.appendChild(venue);
  }
  main.appendChild(metaRow);

  card.append(thumb, main);

  if (origin) {
    const dist = document.createElement('span');
    dist.className = 'card__dist';
    const meters = distanceMeters(origin, { lat: ev.lat, lon: ev.lon });
    // 市区町村の代表点しか無いイベントは、距離もその精度でしかない
    dist.textContent = ev.approx ? `約${formatDistance(meters)}` : formatDistance(meters);
    card.appendChild(dist);
  }

  return card;
}

export function emptyState(message: string, sub?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'empty';
  const emoji = document.createElement('span');
  emoji.className = 'empty__emoji';
  emoji.textContent = '🗓️';
  el.appendChild(emoji);
  el.appendChild(document.createTextNode(message));
  if (sub) {
    el.appendChild(document.createElement('br'));
    const small = document.createElement('small');
    small.textContent = sub;
    el.appendChild(small);
  }
  return el;
}

/** 出典クレジット。オープンデータの利用条件を満たすために必ず出す。 */
export function creditBlock(bundle: EventBundle): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'credit';
  const parts: string[] = [];
  for (const s of bundle.sources) parts.push(`${s.label}（${s.count}件）`);

  el.appendChild(
    document.createTextNode(
      `データ出典: ${parts.length ? parts.join(' / ') : '—'}｜地図: OpenFreeMap © OpenMapTiles © OpenStreetMap contributors`,
    ),
  );
  if (bundle.generatedAt) {
    el.appendChild(document.createElement('br'));
    const d = new Date(bundle.generatedAt);
    el.appendChild(
      document.createTextNode(
        `最終更新: ${d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' })}`,
      ),
    );
  }
  return el;
}

export interface DetailCallbacks {
  onBack: () => void;
}

export function detailView(
  ev: EventItem,
  dayKey: DayKey,
  origin: LatLon | null,
  cb: DetailCallbacks,
): DocumentFragment {
  const meta = CATEGORY_META[ev.category] ?? CATEGORY_META.other;
  const frag = document.createDocumentFragment();

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'detail__back';
  back.textContent = '← 一覧に戻る';
  back.addEventListener('click', cb.onBack);
  frag.appendChild(back);

  // 写真が主役。カテゴリの札を写真の上に重ねて、見出しまでを1かたまりに見せる
  if (ev.imageUrl) {
    const hero = document.createElement('div');
    hero.className = 'detail__hero';
    hero.style.setProperty('--cat-color', meta.color);

    const img = document.createElement('img');
    img.className = 'detail__image';
    img.src = ev.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    // 画像が消えていても詳細が崩れないように、失敗したら枠ごと消す
    img.addEventListener('error', () => hero.remove());
    hero.appendChild(img);

    const tag = document.createElement('span');
    tag.className = 'detail__cat detail__cat--onhero';
    tag.textContent = categoryLabel(ev);
    hero.appendChild(tag);

    frag.appendChild(hero);
  } else {
    const cat = document.createElement('div');
    cat.className = 'detail__cat';
    cat.style.setProperty('--cat-color', meta.color);
    cat.textContent = categoryLabel(ev);
    frag.appendChild(cat);
  }

  const title = document.createElement('h2');
  title.className = 'detail__title';
  title.textContent = ev.title;
  frag.appendChild(title);

  const rows = document.createElement('dl');
  rows.className = 'detail__rows';
  rows.appendChild(row('開催日', isMultiDay(ev) ? periodLabel(ev) : longLabel(dayKey)));
  rows.appendChild(row('時間', timeLabelFor(ev, dayKey)));
  if (ev.venue) rows.appendChild(row('会場', ev.venue));
  if (ev.address) rows.appendChild(row('住所', ev.address));
  if (origin) {
    const meters = formatDistance(distanceMeters(origin, { lat: ev.lat, lon: ev.lon }));
    rows.appendChild(row('現在地から', ev.approx ? `約${meters}` : meters));
  }
  if (ev.approx) {
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = '地図上の位置は市区町村のおおよその場所です。正確な会場は公式サイトをご確認ください。';
    rows.appendChild(row('位置の精度', note));
  }
  if (ev.price) rows.appendChild(row('料金', ev.price));
  if (ev.organizer) rows.appendChild(row('主催', ev.organizer));
  if (ev.url) {
    rows.appendChild(row('公式サイト', externalLink(ev.url, hostLabel(ev.url) ?? ev.url, 'link')));
  }
  rows.appendChild(row('出典', ev.sourceLabel ?? ev.source));
  frag.appendChild(rows);

  if (ev.description) {
    const desc = document.createElement('p');
    desc.className = 'detail__desc';
    desc.textContent = ev.description;
    frag.appendChild(desc);
  }

  const actions = document.createElement('div');
  actions.className = 'detail__actions';

  // 公式サイトが分かっているならそれを主役に、無ければ検索で代替する
  if (ev.url) {
    actions.appendChild(externalLink(ev.url, '🔗 公式サイトを開く', 'btn btn--primary'));
  } else {
    actions.appendChild(externalLink(searchUrl(ev), '🔍 公式サイトを検索', 'btn btn--primary'));
  }
  actions.appendChild(
    externalLink(
      `https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lon}`,
      '🧭 経路を調べる',
      'btn',
    ),
  );

  frag.appendChild(actions);
  return frag;
}
