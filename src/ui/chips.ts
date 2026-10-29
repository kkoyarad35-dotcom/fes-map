import { ALL_CATEGORIES, CATEGORY_META, type EventCategory } from '../types';

const LONG_PRESS_MS = 450;

let tipEl: HTMLDivElement | null = null;
let tipTimer: number | undefined;

/** チップの下に説明の吹き出しを出す。どこかを触るか、しばらくすると消える。 */
function showTip(anchor: HTMLElement, title: string, desc: string): void {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'chip-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    document.addEventListener('pointerdown', hideTip, true);
  }
  const strong = document.createElement('strong');
  strong.textContent = title;
  tipEl.replaceChildren(strong, document.createTextNode(desc));
  tipEl.hidden = false;

  // 画面の端からはみ出さないよう、左右を詰める
  const r = anchor.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 24);
  const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, 12), window.innerWidth - width - 12);
  tipEl.style.width = `${width}px`;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${r.bottom + 8}px`;

  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(hideTip, 4000);
}

function hideTip(): void {
  window.clearTimeout(tipTimer);
  if (tipEl) tipEl.hidden = true;
}

/**
 * カテゴリの絞り込みチップ。
 * 「すべて」を含め、選択なし = すべて表示、という素直な挙動にしている。
 */
export class CategoryChips {
  private buttons = new Map<EventCategory | 'all', HTMLButtonElement>();
  private counts = new Map<EventCategory | 'all', HTMLSpanElement>();
  private selected = new Set<EventCategory>();
  private onChange: (selected: Set<EventCategory>) => void;

  constructor(root: HTMLElement, onChange: (selected: Set<EventCategory>) => void) {
    this.onChange = onChange;

    this.add(root, 'all', 'すべて', '✨', null, 'カテゴリで絞らずに全部を見る');
    for (const cat of ALL_CATEGORIES) {
      const meta = CATEGORY_META[cat];
      this.add(root, cat, meta.label, meta.emoji, meta.color, meta.desc);
    }
    this.sync();
  }

  private add(
    root: HTMLElement,
    key: EventCategory | 'all',
    label: string,
    emoji: string,
    color: string | null,
    desc: string,
  ): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.title = desc; // パソコンではマウスを乗せると出る
    if (color) btn.style.setProperty('--chip-color', color);

    const text = document.createElement('span');
    text.textContent = `${emoji} ${label}`;
    const count = document.createElement('span');
    count.className = 'chip__count';

    btn.append(text, count);

    // 長押しで、そのカテゴリに何が入っているかを出す。長押しのあとの click では切り替えない
    let timer: number | undefined;
    let longPressed = false;
    let downX = 0;
    btn.addEventListener('pointerdown', (e) => {
      longPressed = false;
      downX = e.clientX;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        longPressed = true;
        showTip(btn, `${emoji} ${label}`, desc);
      }, LONG_PRESS_MS);
    });
    // 段を横にすべらせているだけなら長押しにしない
    btn.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - downX) > 8) window.clearTimeout(timer);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
      btn.addEventListener(type, () => window.clearTimeout(timer));
    }
    // スマホの長押しメニュー（コピー等）を出さない
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      this.toggle(key);
    });

    this.buttons.set(key, btn);
    this.counts.set(key, count);
    root.appendChild(btn);
  }

  private toggle(key: EventCategory | 'all'): void {
    if (key === 'all') {
      this.selected.clear();
    } else if (this.selected.has(key)) {
      this.selected.delete(key);
    } else {
      this.selected.add(key);
    }
    this.sync();
    this.onChange(new Set(this.selected));
  }

  private sync(): void {
    for (const [key, btn] of this.buttons) {
      const on = key === 'all' ? this.selected.size === 0 : this.selected.has(key);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  /** その日のカテゴリ別件数をチップに出す。0件のカテゴリは薄くする。 */
  setCounts(byCategory: Map<EventCategory, number>, total: number): void {
    this.counts.get('all')!.textContent = total > 0 ? String(total) : '';
    for (const cat of ALL_CATEGORIES) {
      const n = byCategory.get(cat) ?? 0;
      this.counts.get(cat)!.textContent = n > 0 ? String(n) : '';
      const btn = this.buttons.get(cat)!;
      btn.style.opacity = n === 0 && !this.selected.has(cat) ? '0.42' : '1';
    }
  }

  get value(): Set<EventCategory> {
    return new Set(this.selected);
  }
}
