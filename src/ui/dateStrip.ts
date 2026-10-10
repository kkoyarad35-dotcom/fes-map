import {
  type DayKey,
  dayKeyRange,
  isWeekend,
  relativeLabel,
  shortLabel,
  weekdayOf,
} from '../date';

export interface DateStripOptions {
  /** 今日から何日先まで並べるか。 */
  days: number;
  onSelect: (key: DayKey) => void;
}

/**
 * 今日から1ヶ月先までを横スクロールで並べる帯。
 * 各日にイベントがあるかを点で示し、日付選択の当たりをつけやすくする。
 */
export class DateStrip {
  readonly keys: DayKey[];
  private root: HTMLElement;
  private buttons = new Map<DayKey, HTMLButtonElement>();
  private selected: DayKey;

  constructor(root: HTMLElement, opts: DateStripOptions) {
    this.root = root;
    this.keys = dayKeyRange(opts.days);
    this.selected = this.keys[0];

    for (const key of this.keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `day${isWeekend(key) ? (weekdayOf(key) === '土' ? ' day--sat' : ' day--sun') : ''}`;
      btn.setAttribute('aria-pressed', String(key === this.selected));
      btn.dataset.key = key;

      const dow = document.createElement('span');
      dow.className = 'day__dow';
      dow.textContent = relativeLabel(key) ?? weekdayOf(key);

      const num = document.createElement('span');
      num.className = 'day__num';
      num.textContent = shortLabel(key);

      const dot = document.createElement('span');
      dot.className = 'day__dot';

      btn.append(dow, num, dot);
      btn.addEventListener('click', () => {
        this.select(key);
        opts.onSelect(key);
      });

      this.buttons.set(key, btn);
      this.root.appendChild(btn);
    }
  }

  get value(): DayKey {
    return this.selected;
  }

  select(key: DayKey, scroll = false): void {
    if (!this.buttons.has(key)) return;
    this.buttons.get(this.selected)?.setAttribute('aria-pressed', 'false');
    this.selected = key;
    const btn = this.buttons.get(key)!;
    btn.setAttribute('aria-pressed', 'true');
    if (scroll) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /** 日付ごとの件数を受け取り、イベントのある日に点を出す。 */
  setCounts(counts: Map<DayKey, number>): void {
    for (const [key, btn] of this.buttons) {
      btn.classList.toggle('day--has', (counts.get(key) ?? 0) > 0);
      const n = counts.get(key) ?? 0;
      btn.title = n > 0 ? `${shortLabel(key)}: ${n}件` : `${shortLabel(key)}: イベントなし`;
    }
  }
}
